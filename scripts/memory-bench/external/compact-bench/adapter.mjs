/**
 * Plan 218.1 Task 2: Prism as a Compact-Bench summarizer.
 *
 * Upstream's methods map a history H to a summary S (`harness/e2_score.py` `compress_one`, `harness/e1_xb.py`
 * `compress_x`). Prism's S is produced by running the arm's memory, not by a prompt:
 *
 * 1. H is rendered in upstream's own transcript view (`transcript()` for retention, `build_transcript()` for task
 *    preservation: the per-block caps and the 250,000-character tail cap the LLM summarizers get), so every method
 *    starts from the same information. Each transcript line becomes one session message.
 * 2. The lines are replayed as turns through an agent session with the arm's memory package: the non-assistant lines
 *    of a turn are its input, and a local scripted provider answers with the turn's assistant lines. The memory worker
 *    is the only model that runs (a mock offline; the screen's worker live).
 * 3. Automatic compaction is off; the session compacts once at the end.
 * 4. S is what the model sees after that compaction, captured from the next provider request: the context blocks and
 *    summary messages (the memory block, uncapped) and then the kept messages in upstream's transcript format.
 *
 * Reported beside S: the memory-block-only S, and the text of the STM chunks the session holds (details reachable
 * through `recall`, scored separately and never added to retention).
 *
 * The `seam.py` shim hands S to upstream's own scoring (retention) or task runner (outcome), so PRE, the tests and the
 * scores stay upstream's.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgent,
  createMemorySessionStore,
  definePackage,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { armMemory, longSessionWmStats } from "../../work-outcome/long-session.mjs";

/** The arms this adapter replays. `OM-before` needs the pinned pre-216 worktree (as in gate M-2). */
export const COMPACT_BENCH_ARMS = Object.freeze(["memory-off", "OM-before", "STM-only", "WM"]);
/** Upstream's tail cap (`cb_common.H_CAP`). */
export const UPSTREAM_H_CAP = 250_000;
/** Kept messages after the final compaction: the session profile's `recentMessages` (gate M-2's arms). */
export const COMPACT_BENCH_RECENT_MESSAGES = 4;
/** Never reached by a capped transcript, so the only compaction is the final one. */
const NO_AUTO_COMPACTION_TOKENS = 100_000_000;
const MAIN_MODEL = Object.freeze({ provider: "cb-main", model: "replay", limits: { contextWindow: 10_000_000, maxOutputTokens: 0 } });
const PROBE = "<<compact-bench-probe>>";

// --- upstream's transcript views, ported. Python slices by code point, so these do too. ---

const cp = (text) => Array.from(text);
const head = (text, n) => (text.length <= n ? text : cp(text).slice(0, n).join(""));
/** Python's `json.dumps(value, ensure_ascii=False)` for JSON values (`, ` and `: ` separators). */
export function pyJson(value) {
  if (value === null || value === undefined) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pyJson).join(", ")}]`;
  return `{${Object.entries(value)
    .map(([key, item]) => `${JSON.stringify(key)}: ${pyJson(item)}`)
    .join(", ")}}`;
}

/** `cb_common.textify` (E2): 4,000 characters per text block, 500 per tool block. */
export function textifyE2(content, limit = 4000) {
  if (typeof content === "string") return head(content, limit);
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const part of content) {
    const type = part?.type;
    if (type === "text") parts.push(head(part.text ?? "", limit));
    else if (type === "tool_use") parts.push(`[tool_use: ${part.name ?? "None"} ${head(pyJson(part.input ?? null), 500)}]`);
    else if (type === "tool_result") {
      const c = typeof part.content === "string" ? part.content : pyJson(part.content ?? null);
      parts.push(`[tool_result: ${head(c, 500)}]`);
    }
  }
  return parts.join("\n");
}

/** The lines of `cb_common.transcript` (E2), one per message with non-blank text. */
export function transcriptLinesE2(H) {
  const lines = [];
  for (const message of H) {
    const role = message.role ?? "user";
    const text = textifyE2(message.content);
    if (text.trim()) lines.push({ role, line: `[${role}] ${text}` });
  }
  return lines;
}

/** The lines of `cb_common.build_transcript` (E1), one per block: 2,000 characters per text block, 200 per tool block. */
export function transcriptLinesE1(H) {
  const lines = [];
  for (const message of H) {
    const role = message.role ?? "user";
    const content = message.content;
    if (typeof content === "string") lines.push({ role, line: `[${role}] ${head(content, 2000)}` });
    else if (Array.isArray(content))
      for (const part of content) {
        if (part?.type === "text") lines.push({ role, line: `[${role}] ${head(part.text ?? "", 2000)}` });
        else if (part?.type === "tool_use")
          lines.push({ role, line: `[${role}] [tool_use: ${part.name ?? "None"} ${head(pyJson(part.input ?? null), 200)}]` });
        else if (part?.type === "tool_result") {
          const c = typeof part.content === "string" ? part.content : pyJson(part.content ?? null);
          lines.push({ role, line: `[${role}] [tool_result: ${head(c, 200)}]` });
        }
      }
  }
  return lines;
}

/**
 * Apply upstream's tail cap (`"\n".join(lines)[-cap:]`) to the lines: whole lines from the end, and the first kept line
 * cut to the suffix the cap leaves. Joining the result with `\n` equals upstream's transcript string.
 */
export function tailCap(lines, cap = UPSTREAM_H_CAP) {
  const out = [];
  let used = 0;
  for (let index = lines.length - 1; index >= 0; index--) {
    const chars = cp(lines[index].line);
    const separator = out.length ? 1 : 0;
    if (used + separator + chars.length <= cap) {
      out.unshift(lines[index]);
      used += separator + chars.length;
      continue;
    }
    const room = cap - used - separator;
    if (room > 0) out.unshift({ ...lines[index], line: chars.slice(chars.length - room).join(""), cut: true });
    else if (room === 0 && separator) out.unshift({ ...lines[index], line: "", cut: true });
    break;
  }
  return out;
}

/** The transcript view of a track: `retention` (E2) or `outcome` (E1). */
export function transcriptView(H, track) {
  if (track === "retention") return tailCap(transcriptLinesE2(H));
  if (track === "outcome") return tailCap(transcriptLinesE1(H));
  throw new Error(`CompactBenchAdapter: unknown track ${track}`);
}

export const renderView = (lines) => lines.map((row) => row.line).join("\n");

// --- the replay ---

/** A line's text as a session message: the `[role] ` prefix is dropped for user and assistant lines only. */
function lineText({ role, line, cut }) {
  const prefix = `[${role}] `;
  return !cut && (role === "user" || role === "assistant") && line.startsWith(prefix) ? line.slice(prefix.length) : line;
}

/**
 * Group the view into turns: a turn's input is the run of non-assistant lines, its reply the run of assistant lines
 * after it. Non-user lines (tool, system) keep their `[role]` prefix and enter as user messages.
 */
export function replayTurns(view) {
  const turns = [];
  let current = { input: [], reply: [] };
  for (const row of view) {
    if (row.role === "assistant") current.reply.push(row);
    else {
      if (current.reply.length) {
        turns.push(current);
        current = { input: [], reply: [] };
      }
      current.input.push(row);
    }
  }
  if (current.input.length || current.reply.length) turns.push(current);
  return turns.map(({ input, reply }) => ({
    input: input.map((row) => ({
      role: "user",
      content: [{ type: "text", text: lineText(row) }],
      metadata: { compactBench: { role: row.role, line: row.line } },
    })),
    reply: reply.map(lineText).join("\n"),
    replyLines: reply.map((row) => row.line),
  }));
}

const textOf = (content) =>
  typeof content === "string"
    ? content
    : (content ?? [])
        .map((block) => (block?.type === "text" ? block.text : ""))
        .filter(Boolean)
        .join("\n");

/**
 * Render what the model sees after the final compaction. `block` is the memory: request context blocks and system
 * messages (the kernel's summary messages), uncapped. `kept` is every other message except the probe, each as the line
 * upstream would have printed for it.
 */
export function renderSeen(request, replyLines = new Map()) {
  const block = [];
  const kept = [];
  for (const item of request.context ?? []) {
    const text = textOf(item.content);
    if (text) block.push(text);
  }
  const messages = [...(request.messages ?? [])];
  const last = messages.at(-1);
  if (last?.role === "user" && textOf(last.content) === PROBE) messages.pop();
  for (const message of messages) {
    const text = textOf(message.content);
    if (message.role === "system") {
      if (text) block.push(text);
      continue;
    }
    const original = message.metadata?.compactBench?.line;
    if (original !== undefined) kept.push(original);
    else if (message.role === "assistant" && replyLines.has(text)) kept.push(...replyLines.get(text));
    else if (text.trim()) kept.push(`[${message.role}] ${text}`);
  }
  const blockText = block.join("\n\n");
  const keptText = kept.join("\n");
  return { S: [blockText, keptText].filter(Boolean).join("\n\n"), block: blockText, kept: kept.length };
}

/** The scripted main model: it answers each replayed turn with H's reply, and records the probe request. */
export function scriptedMain() {
  const replies = [];
  const state = { probe: null, calls: 0 };
  return {
    state,
    queue: (text) => replies.push(text),
    provider: {
      id: MAIN_MODEL.provider,
      async *generate(request) {
        state.calls++;
        const last = request.messages?.at(-1);
        if (last?.role === "user" && textOf(last.content) === PROBE) {
          state.probe = structuredClone({ messages: request.messages, context: request.context ?? [] });
          yield providerTextDelta("ok");
          yield providerDone();
          return;
        }
        const text = replies.shift();
        if (text) yield providerTextDelta(text);
        yield providerDone();
      },
    },
  };
}

/** A chunk store the adapter can read back at the end (STM-only and WM keep verbatim chunks). */
async function chunkReader() {
  const { createSqliteChunkStore, MEMORY_CHUNK_STORE_SERVICE } = await import("@arnilo/prism-memory-system");
  const store = await createSqliteChunkStore({ path: ":memory:" });
  return {
    store,
    package: definePackage({
      name: "compact-bench-chunks",
      version: "0.13.0",
      requires: { api: 1 },
      setup(prism) {
        prism.services.provide(MEMORY_CHUNK_STORE_SERVICE, store);
      },
    })(),
    async text(sessionId) {
      const listed = await store.list(sessionId);
      const texts = [];
      for (const { id } of listed) {
        const chunk = await store.get(id, sessionId);
        if (chunk?.text) texts.push(chunk.text);
      }
      return texts;
    },
  };
}

async function settle(agent, session, arm, deadlineMs) {
  if (arm === "memory-off") return;
  const status = arm === "OM-before" ? "om:status" : "memory:session:status";
  await new Promise((resolve) => setTimeout(resolve, 0));
  const deadline = Date.now() + deadlineMs;
  while ((await agent.commands.run(status, {}, { session }))?.inFlight) {
    if (Date.now() > deadline) throw new Error("CompactBenchAdapter: the memory worker did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** STM passes that ran and the events they recorded, from the session log (counts only). */
export function stmStats(entries) {
  const passes = entries.flatMap((entry) => {
    const value = entry.data?.op === "append" ? entry.data.value : undefined;
    return value?.type === "memory.session.observations.recorded" ? [value] : [];
  });
  return {
    passes: passes.length,
    events: passes.reduce((sum, pass) => sum + (Array.isArray(pass.observations) ? pass.observations.length : 0), 0),
  };
}

/** Plan 218.1 Task 3's engagement definition: at least one WM pass that wrote at least one item. */
export const wmEngaged = (wm) => (wm?.items ?? []).some((count) => count > 0);

/**
 * Summarize one history as `arm`. `workerProviders` serve `workerModel` (the arm's STM/WM/observer worker); offline they
 * are mocks. Returns S, the block-only S, the chunk texts and counts; the caller keeps the text out of evidence.
 */
export async function summarizeHistory({ H, track, arm, workerProviders = [], workerModel, id = "h", settleMs = 600_000 }) {
  if (!COMPACT_BENCH_ARMS.includes(arm)) throw new Error(`CompactBenchAdapter: unknown arm ${arm}`);
  if (arm !== "memory-off" && !workerModel) throw new Error("CompactBenchAdapter: a memory arm needs its worker model");
  const view = transcriptView(H, track);
  const turns = replayTurns(view);
  const main = scriptedMain();
  const chunks = arm === "STM-only" || arm === "WM" ? await chunkReader() : null;
  const memory =
    arm === "memory-off"
      ? []
      : await armMemory(arm, {
          workerModel,
          context: { compactAt: { maxTokens: NO_AUTO_COMPACTION_TOKENS }, recentMessages: COMPACT_BENCH_RECENT_MESSAGES },
        });
  const agent = await createAgent({
    model: MAIN_MODEL,
    packages: [
      providerPackage("compact-bench-main", [main.provider]),
      ...(workerProviders.length ? [providerPackage("compact-bench-worker", workerProviders)] : []),
      ...(chunks ? [chunks.package] : []),
      ...memory,
    ],
    slots: { store: createMemorySessionStore() },
    // memory-off: the kernel's default compactor, sized like the memory arms.
    compaction: { keepRecentEntries: COMPACT_BENCH_RECENT_MESSAGES },
    // Token limits count the scripted replay's own requests (the whole capped transcript each turn, never billed);
    // the byte hard caps keep their defaults.
    limits: { maxInputTokens: 5_000_000, maxTotalTokens: 5_100_000, maxOutputTokens: 1_000_000, maxWallTimeMs: 900_000 },
  });
  const sessionId = `cb-${arm}-${id}`.replace(/[^A-Za-z0-9_.-]/g, "_");
  const replyLines = new Map();
  let compactions = 0;
  let wm = null;
  let stm = null;
  try {
    const session = await agent.session({ id: sessionId, create: true });
    for (const turn of turns) {
      main.queue(turn.reply);
      if (turn.reply) replyLines.set(turn.reply, turn.replyLines);
      const result = await session.run(turn.input.length ? turn.input : []);
      if (!["completed", "stopped"].includes(result?.status))
        throw new Error(`CompactBenchAdapter: replay turn ended ${result?.status}: ${result?.error?.code ?? ""}`);
    }
    await settle(agent, session, arm, settleMs);
    if (typeof session.entries === "function")
      compactions = (await session.entries()).filter((entry) => entry.kind === "compaction").length;
    await session.compact();
    await settle(agent, session, arm, settleMs);
    await session.run({ role: "user", content: [{ type: "text", text: PROBE }] });
    if (!main.state.probe) throw new Error("CompactBenchAdapter: the probe request was not captured");
    if (typeof session.entries === "function") {
      const entries = await session.entries();
      wm = longSessionWmStats(entries);
      stm = stmStats(entries);
    }
    const seen = renderSeen(main.state.probe, replyLines);
    const chunkTexts = chunks ? await chunks.text(sessionId) : [];
    await session.close();
    return {
      id,
      arm,
      track,
      S: seen.S,
      block: seen.block,
      chunks: chunkTexts,
      counts: {
        viewLines: view.length,
        viewChars: cp(renderView(view)).length,
        viewSha256: sha256(renderView(view)),
        turns: turns.length,
        autoCompactionsBeforeFinal: compactions,
        keptMessages: seen.kept,
        sChars: cp(seen.S).length,
        blockChars: cp(seen.block).length,
        chunks: chunkTexts.length,
        ...(wm ? { wm, wmEngaged: wmEngaged(wm) } : {}),
        ...(stm ? { stm } : {}),
      },
    };
  } finally {
    await agent.dispose();
    await chunks?.store.close?.();
  }
}

// --- offline worker and the CLI ---

/**
 * The offline memory worker for every arm: STM records one event per replayed message (its first 300 characters),
 * the pre-216 observer one observation, and WM keeps every record it is sent. It reads only what the worker request
 * shows, never an annotation.
 */
export function compactBenchWorkerMock(id = "cb-worker") {
  return {
    id,
    async *generate(request) {
      const tools = (request.tools ?? []).map((tool) => tool.name);
      const shape = tools.includes("record_event") ? "event" : tools.includes("record_observation") ? "observation" : null;
      if ((!shape && !tools.includes("keep")) || request.messages.some((message) => message.role === "tool")) {
        yield providerDone();
        return;
      }
      const prompt = request.messages
        .filter((message) => message.role === "user")
        .map((message) => textOf(message.content))
        .join("\n");
      let n = 0;
      if (!shape) {
        for (const match of prompt.matchAll(/^- \[([0-9a-f]{12})\] /gm))
          yield providerToolCall(toolCallContent(`k${++n}`, "keep", { stmId: match[1], reason: "kept offline" }));
        yield providerDone();
        return;
      }
      for (const line of prompt.split("\n")) {
        const match = /^\[[^\]]+\] \[([^\]]+)\] (?:message|user|assistant): (\{"role":"(user|assistant)".*)$/.exec(line);
        if (!match) continue;
        let message;
        try {
          message = JSON.parse(match[2]);
        } catch {
          continue;
        }
        const text = textOf(message.content).slice(0, 300);
        if (!text.trim()) continue;
        const args =
          shape === "event"
            ? {
                kind: match[3] === "user" ? "statement" : "result",
                description: text,
                sourceEntryIds: [match[1]],
                relevance: "high",
                chunks: [{ sourceEntryId: match[1], text: textOf(message.content).slice(0, 1_000) }],
              }
            : { content: text, sourceEntryIds: [match[1]], relevance: "high" };
        yield providerToolCall(toolCallContent(`w${++n}`, shape === "event" ? "record_event" : "record_observation", args));
      }
      yield providerDone();
    },
  };
}

/** Load the drawn retention sessions (or outcome histories) from the pinned mirror. */
export function loadDrawnHistories({ track, draw, dataDir, limit = 0 }) {
  if (track === "retention") {
    const wanted = new Set(Object.values(draw.retention.strata).flat());
    const rows = [];
    for (const line of readFileSync(join(dataDir, "e2/sessions.jsonl"), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const sample = JSON.parse(line);
      if (wanted.has(sample.sample_id)) rows.push({ id: sample.sample_id, H: sample.H });
    }
    return limit ? rows.slice(0, limit) : rows;
  }
  const ids = limit ? draw.outcome.instances.slice(0, limit) : draw.outcome.instances;
  return ids.map((id) => ({ id, H: JSON.parse(readFileSync(join(dataDir, "e1/H3", `${id}.H3.json`), "utf8")).H }));
}

/** Score S records through upstream (`seam.py retention`); returns upstream's per-record rows. */
export function scoreRetention({ records, codeDir, dataDir, workDir, python = process.env.PRISM_MEMORY_BENCH_PYTHON ?? "python3" }) {
  const summaries = join(workDir, "summaries.jsonl");
  const out = join(workDir, "scored.json");
  writeFileSync(summaries, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  execFileSync(python, ["-I", SEAM, "retention", "--code", codeDir, "--summaries", summaries, "--out", out], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", CB_DATA_MIRROR: dataDir, PYTHONUTF8: "1" },
    stdio: ["ignore", "pipe", "inherit"],
    timeout: 1_800_000,
  });
  return JSON.parse(readFileSync(out, "utf8"));
}

const SEAM = fileURLToPath(new URL("./seam.py", import.meta.url));
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

/**
 * Offline validation (`--offline`): the drawn retention sessions replayed on mock workers for every arm this tree runs,
 * scored by upstream. Text stays in the bench cache; stdout carries counts and recalls only.
 */
if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  if (!args.includes("--offline")) {
    process.stderr.write(
      "usage: adapter.mjs --offline [--limit N] [--arms memory-off,STM-only,WM] (live runs belong to Task 3's screen)\n",
    );
    process.exit(2);
  }
  const { COMPACT_BENCH_PIN, compactBenchPaths, verifyCompactBenchCode } = await import("./fetch.mjs");
  const { COMPACT_BENCH_DRAW_FILE } = await import("./draw.mjs");
  const paths = compactBenchPaths(COMPACT_BENCH_PIN);
  verifyCompactBenchCode({ dir: paths.code });
  const draw = JSON.parse(readFileSync(COMPACT_BENCH_DRAW_FILE, "utf8"));
  const arms = (flag("--arms") ?? "memory-off,STM-only,WM").split(",");
  const histories = loadDrawnHistories({ track: "retention", draw, dataDir: paths.data, limit: Number(flag("--limit") ?? 0) });
  const workDir = join(paths.root, "offline", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(workDir, { recursive: true });
  const records = [];
  const counts = [];
  const started = performance.now();
  for (const { id, H } of histories)
    for (const arm of arms) {
      const result = await summarizeHistory({
        H,
        track: "retention",
        arm,
        id,
        workerProviders: [compactBenchWorkerMock()],
        workerModel: "cb-worker/mock",
      });
      records.push({ sample_id: id, arm, view: "context", S: result.S });
      records.push({ sample_id: id, arm, view: "block", S: result.block });
      if (result.chunks.length) records.push({ sample_id: id, arm, view: "chunks", S: result.chunks.join("\n") });
      counts.push({ id, arm, ...result.counts });
    }
  const scored = scoreRetention({ records, codeDir: paths.code, dataDir: paths.data, workDir });
  const summary = {};
  for (const arm of arms)
    for (const view of ["context", "block", "chunks"]) {
      const rows = scored.filter((row) => row.arm === arm && row.view === view);
      if (rows.length) summary[`${arm}/${view}`] = { n: rows.length, meanRecall: mean(rows.map((row) => row.recall)) };
    }
  writeFileSync(join(workDir, "counts.json"), JSON.stringify(counts, null, 2));
  process.stdout.write(
    `${JSON.stringify({ sessions: histories.length, arms, seconds: Math.round((performance.now() - started) / 1000), summary, workDir }, null, 2)}\n`,
  );
}
