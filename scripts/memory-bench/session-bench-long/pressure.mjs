/**
 * Plan 218.5 Task 2: the long-session design review's measurements. Offline: it reads stored sessions and makes no
 * model call.
 *
 *   timeout 600 bun scripts/memory-bench/session-bench-long/pressure.mjs --ledgers <dir> [--window 32000] [--write]
 *
 * `<dir>` holds `<session>.ledger.json` files: the session store after a live STM-only run, as the runner's `inspect`
 * hook writes it (`{ [sessionId]: entries }`). The files stay outside the repository; the report holds ids, counts,
 * rates and hashes only, never a prompt, a tool output or a record's text.
 *
 * It answers three questions before any long-session bench code lands:
 *
 * 1. **Pressure.** How many description tokens STM records per task, and so the task at which the compaction block's
 *    pool overflows and records start to be left out.
 * 2. **Render ratio.** How many request tokens the block costs per description token. The pool bounds description
 *    tokens (4 characters each), but the provider wrapper counts the rendered block (3.5 characters each, and each line
 *    carries an id, a time, a relevance, a kind and marks).
 * 3. **Overflow risk.** The largest request after a mid-loop compaction with the pool at its bound, and so the largest
 *    job artifact a long session may hold.
 *
 * Two units are in play, and the review keeps them apart:
 *
 * - **window tokens**: the harness's count of a request (v3 `run.mjs` `requestTokens`): the kernel's estimate for an
 *   unknown model family (3.5 characters per token plus 6 per message) plus the tool declarations. The provider wrapper
 *   rejects a request over W minus the output reserve.
 * - **product tokens**: session memory's own count (4 characters per token). The pool, the kept tail and the mid-loop
 *   trigger are all sized in these, from the kernel's input cap (W minus the output reserve minus 1,024).
 *
 * G2: this file imports the kernel's estimators only. Session memory's sizing rules are mirrored in
 * {@link PRODUCT_RULES}, and `pressure.test.mjs` holds the mirror to the product.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateMessageTokens, resolveInputCap } from "@arnilo/prism";

export const PRESSURE_REPORT_KIND = "session-bench-long-pressure-v1";
export const WINDOW_TOKENS = 32_000;
/** The harness's output reserve (v3 `run.mjs` `MAX_OUTPUT_TOKENS`): the provider wrapper's cap is W minus this. */
export const MAX_OUTPUT_TOKENS = 2_048;
/** Session memory's sizing rules (`packages/memory/system/src/session/config.ts`), mirrored: no product import here. */
export const PRODUCT_RULES = Object.freeze({
  poolMaxTokens: 20_000,
  poolCapRatio: 0.3,
  compactAtRatio: 0.8,
  keepRecentRatio: 0.2,
  rehearsalTargetTokens: 20_000,
});
/** Characters per token: the harness's request count, and session memory's own count. */
export const WINDOW_CHARS_PER_TOKEN = 3.5;
export const PRODUCT_CHARS_PER_TOKEN = 4;
/** The kernel's per-message overhead for an unknown model family, which is how the harness counts every request. */
export const WINDOW_MESSAGE_OVERHEAD_TOKENS = 6;
/**
 * A main-agent request's fixed part on the session-memory arms, in window tokens: the 14 tool declarations (the
 * workspace's 13 and `recall`) and the instruction message. A model that declares no tool support (the offline mocks)
 * also gets the kernel's tool list message. Measured on the v3 runner; `pressure.test.mjs` re-measures it.
 */
export const FIXED_REQUEST_PARTS = Object.freeze({ toolDeclarations: 1_318, instruction: 98, toolList: 410 });
/** The live model's fixed part (tool declarations and the instruction). */
export const LIVE_FIXED_REQUEST_TOKENS = FIXED_REQUEST_PARTS.toolDeclarations + FIXED_REQUEST_PARTS.instruction;
/** The largest fixed part: the offline mocks', with the tool list message. The worst case is sized from this one. */
export const FIXED_REQUEST_TOKENS = LIVE_FIXED_REQUEST_TOKENS + FIXED_REQUEST_PARTS.toolList;
/** The share of the provider wrapper's cap the worst request after a compaction may reach (plan 218.5 Task 2). */
export const WORST_REQUEST_SHARE = 0.9;
/** The long bench's job artifact sizes, in the generator's tokens (3.5 raw characters each). Task 4 builds to these. */
export const LONG_JOB_ARTIFACT_TOKENS = Object.freeze([6_000, 9_000]);
/** Tasks added to the mean overflow task before a dependent counts as `after` (plan 218.5 Task 4). */
export const AFTER_BUCKET_MARGIN_TASKS = 10;
/** A tool round counts as an artifact read from this many window tokens of result (v3's side artifacts stay under 4,500). */
const LARGE_RESULT_TOKENS = 10_000;
/** The messages one run can add before the trigger is read again: v3's limit of 30 turns, a call and a result each. */
const RUN_MESSAGES = 64;
const RELEVANCES = Object.freeze(["low", "medium", "high", "critical"]);
/** Eviction leaves out the lowest relevance first, so these are the last to go: where the user's rules and changes sit. */
const isHigh = (record) => record.relevance === "high" || record.relevance === "critical";

const LEDGER_KEY = "memory.session.ledger";
const RECORDED = "memory.session.observations.recorded";
const DROPPED = "memory.session.observations.dropped";
const TOMBSTONED = "memory.session.observations.tombstoned";
const HERE = dirname(fileURLToPath(import.meta.url));
export const GATE_FILE = join(HERE, "../../../docs/_evidence/memory-bench/218.5/gates/owner-gate-long.json");

/** The provider wrapper's input cap: what a request may not exceed. */
export const harnessInputCap = (window = WINDOW_TOKENS) => window - MAX_OUTPUT_TOKENS;
/** The input cap the product sizes itself from: the kernel's, which also holds back its default 1,024-token reserve. */
export const productInputCap = (window = WINDOW_TOKENS) =>
  resolveInputCap({}, { limits: { contextWindow: window, maxOutputTokens: MAX_OUTPUT_TOKENS } });
/** The compaction block's pool, in description tokens. */
export const poolTokens = (window = WINDOW_TOKENS) =>
  Math.min(PRODUCT_RULES.poolMaxTokens, Math.floor(productInputCap(window) * PRODUCT_RULES.poolCapRatio));
/** The mid-loop cut's kept tail beyond the newest tool round, in product tokens. */
export const keepRecentTokens = (window = WINDOW_TOKENS) => Math.floor(productInputCap(window) * PRODUCT_RULES.keepRecentRatio);
/** The mid-loop trigger, in product tokens over the messages and the summary (tools and instructions are not counted). */
export const compactAtTokens = (window = WINDOW_TOKENS) => productInputCap(window) * PRODUCT_RULES.compactAtRatio;

/** Window tokens of messages, as the harness counts them. */
export const windowTokens = (messages) => estimateMessageTokens(messages).tokens;
/** Product tokens of one message, as session memory's cut counts them (`session/tokens.ts`). */
export const productMessageTokens = (message) =>
  message.content.reduce((sum, block) => sum + Math.ceil(JSON.stringify(block).length / PRODUCT_CHARS_PER_TOKEN), 0);
/** The compaction summary as the request carries it: one system message. */
export const blockTokens = (summary) => windowTokens([{ role: "system", content: [{ type: "text", text: `Summary:\n${summary}` }] }]);

/**
 * The first task whose records put the pool over its bound, when a session starts with `fixedTokens` (the scope's
 * records) and adds `tokensPerTask` per task.
 */
export function poolOverflowTask(tokensPerTask, pool, fixedTokens = 0) {
  if (!(tokensPerTask > 0)) throw new Error("SessionBenchLongPressure: tokensPerTask must be positive");
  return Math.floor(Math.max(0, pool - fixedTokens) / tokensPerTask) + 1;
}

/**
 * The largest request the main agent can send after a mid-loop compaction with the pool at its bound, in window tokens.
 *
 * The cut keeps the newest tool round whole, and earlier messages only while the tail stays within `keepRecentTokens`.
 * So the tail is the round when the round is the larger, and at most the keep budget otherwise. No later compaction
 * can shrink this request: it must fit.
 */
export function worstRequest({
  window = WINDOW_TOKENS,
  artifactTokens,
  render,
  round,
  fixedTokens = FIXED_REQUEST_TOKENS,
  pool = poolTokens(window),
}) {
  const block =
    Math.ceil((render.headerChars + render.lineCharsPerDescriptionToken * pool) / WINDOW_CHARS_PER_TOKEN) + WINDOW_MESSAGE_OVERHEAD_TOKENS;
  const artifactRound = Math.ceil(artifactTokens * round.escapeRatio) + round.overheadTokens;
  const keptTail = Math.ceil((keepRecentTokens(window) * PRODUCT_CHARS_PER_TOKEN) / WINDOW_CHARS_PER_TOKEN);
  const tail = Math.max(artifactRound, keptTail);
  const tokens = fixedTokens + block + tail;
  const cap = harnessInputCap(window);
  return { fixedTokens, blockTokens: block, tailTokens: tail, tokens, cap, share: round4(tokens / cap) };
}

/** The largest artifact whose worst request stays within `share` of the cap (0 when none does). */
export function maxArtifactTokens({ share = WORST_REQUEST_SHARE, ...options }) {
  const limit = share * harnessInputCap(options.window ?? WINDOW_TOKENS);
  if (worstRequest({ ...options, artifactTokens: 0 }).tokens > limit) return 0;
  let low = 0;
  let high = options.window ?? WINDOW_TOKENS;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (worstRequest({ ...options, artifactTokens: mid }).tokens <= limit) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * The largest request that stays under the mid-loop trigger, in window tokens. The trigger reads product tokens over
 * the messages and the summary, so it sits higher in window tokens, and the fixed part comes on top.
 */
export function underTriggerRequest({ window = WINDOW_TOKENS, fixedTokens = FIXED_REQUEST_TOKENS, messages = RUN_MESSAGES } = {}) {
  const tokens =
    Math.ceil((compactAtTokens(window) * PRODUCT_CHARS_PER_TOKEN) / WINDOW_CHARS_PER_TOKEN) +
    messages * WINDOW_MESSAGE_OVERHEAD_TOKENS +
    fixedTokens;
  const cap = harnessInputCap(window);
  return { tokens, cap, share: round4(tokens / cap) };
}

const round1 = (value) => Math.round(value * 10) / 10;
const round4 = (value) => Math.round(value * 10_000) / 10_000;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const mean = (values) => (values.length ? sum(values) / values.length : 0);
const textOf = (message) => message.content.map((block) => (block.type === "text" ? block.text : "")).join("");

/**
 * One stored STM-only session, as counts: what STM recorded per task, what the block cost to render, the tool rounds
 * that carried an artifact, and the request after each compaction.
 */
export function sessionPressure(entries, { window = WINDOW_TOKENS, fixedTokens = LIVE_FIXED_REQUEST_TOKENS } = {}) {
  // The task each entry belongs to: 0 is the scope exchange, N everything from "Task N." to the next prompt.
  const taskOf = new Map();
  const byId = new Map();
  let task = 0;
  let tasks = 0;
  for (const entry of entries) {
    byId.set(entry.id, entry);
    if (entry.kind === "message" && entry.message.role === "user") {
      const match = /^Task (\d+)\./.exec(textOf(entry.message));
      if (match) {
        task = Number(match[1]);
        tasks = Math.max(tasks, task);
      }
    }
    taskOf.set(entry.id, task);
  }
  if (!tasks) throw new Error("SessionBenchLongPressure: the session holds no task prompt");

  // The ledger's fold, as far as the pool reads it: a record is active until it is dropped or tombstoned.
  const records = new Map();
  const gone = new Set();
  for (const entry of entries) {
    const data = entry.kind === "package_state" && entry.data?.key === LEDGER_KEY ? entry.data.value : undefined;
    if (!data) continue;
    if (data.type === RECORDED) {
      for (const record of data.observations ?? []) {
        if (records.has(record.id)) continue;
        const sourceTasks = (record.sourceEntryIds ?? []).flatMap((id) => (taskOf.has(id) ? [taskOf.get(id)] : []));
        records.set(record.id, { ...record, task: sourceTasks.length ? Math.max(...sourceTasks) : taskOf.get(entry.id) });
      }
    } else if (data.type === DROPPED || data.type === TOMBSTONED) {
      for (const id of data.observationIds ?? []) gone.add(id);
    }
  }
  const all = [...records.values()];
  const active = all.filter((record) => !gone.has(record.id));
  const tokensOf = (list) => sum(list.map((record) => record.tokenCount));
  const scope = active.filter((record) => record.task === 0);
  const grown = active.filter((record) => record.task > 0);
  // What an eviction order that protects the user would never leave out: word-for-word messages, user statements, durable records.
  const protectedRecords = grown.filter((record) => record.verbatim || record.attribution === "user" || record.durable);

  // The block, at every compaction: its description tokens (what the pool bounds) against what the request carries.
  const compactions = entries
    .filter((entry) => entry.kind === "compaction" && Array.isArray(entry.data?.memory?.observations))
    .map((entry) => {
      const descriptionTokens = tokensOf(entry.data.memory.observations);
      const lines = entry.summary.split("\n").filter((line) => /^- \[[0-9a-f]{12}\] /.test(line));
      const lineChars = sum(lines.map((line) => line.length + 1));
      const kept = (entry.data.keepEntryIds ?? []).flatMap((id) => (byId.get(id)?.message ? [byId.get(id).message] : []));
      const block = blockTokens(entry.summary);
      return {
        records: entry.data.memory.observations.length,
        lines: lines.length,
        descriptionTokens,
        blockTokens: block,
        lineChars,
        headerChars: entry.summary.length + "Summary:\n".length - lineChars,
        fullFold: entry.data.memory.fullFold === true,
        point: entry.data.point,
        requestTokens: fixedTokens + block + windowTokens(kept),
        tailProductTokens: sum(kept.map(productMessageTokens)),
      };
    });
  const largest = compactions.reduce((best, row) => (row.descriptionTokens > (best?.descriptionTokens ?? -1) ? row : best), undefined);

  // Tool rounds that carried an artifact: what the round costs beyond the artifact itself.
  const rounds = [];
  const messages = entries.filter((entry) => entry.kind === "message").map((entry) => entry.message);
  for (let at = 0; at < messages.length; at += 1) {
    if (messages[at].role !== "assistant" || !messages[at].content.some((block) => block.type === "tool_call")) continue;
    let end = at + 1;
    while (end < messages.length && messages[end].role === "tool") end += 1;
    let largestResult;
    for (const message of messages.slice(at + 1, end))
      for (const block of message.content)
        if (block.type === "tool_result" && typeof block.result === "string" && block.result.length > (largestResult?.length ?? 0))
          largestResult = block.result;
    if (!largestResult) continue;
    const resultTokens = Math.ceil(JSON.stringify(largestResult).length / WINDOW_CHARS_PER_TOKEN);
    if (resultTokens < LARGE_RESULT_TOKENS) continue;
    rounds.push({
      overheadTokens: windowTokens(messages.slice(at, end)) - resultTokens,
      escapeRatio: JSON.stringify(largestResult).length / largestResult.length,
    });
  }

  return {
    tasks,
    records: { recorded: all.length, active: active.length, verbatim: active.filter((record) => record.verbatim).length },
    descriptionTokens: {
      recorded: tokensOf(all),
      active: tokensOf(active),
      scope: tokensOf(scope),
      verbatim: tokensOf(grown.filter((record) => record.verbatim)),
      protected: tokensOf(protectedRecords),
    },
    perTask: {
      records: round1(grown.length / tasks),
      tokens: round1(tokensOf(grown) / tasks),
      byRelevance: Object.fromEntries(
        RELEVANCES.map((level) => [level, round1(tokensOf(grown.filter((record) => record.relevance === level)) / tasks)]),
      ),
      highTokens: round1(tokensOf(grown.filter(isHigh)) / tasks),
      protectedTokens: round1(tokensOf(protectedRecords) / tasks),
      // The measure the plan's header used before Task 1: everything recorded, the scope and dropped records included.
      recordedTokens: round1(tokensOf(all) / tasks),
    },
    overflowTask: poolOverflowTask(tokensOf(grown) / tasks, poolTokens(window), tokensOf(scope)),
    rehearsalTask: poolOverflowTask(tokensOf(grown) / tasks, PRODUCT_RULES.rehearsalTargetTokens, tokensOf(scope)),
    render: largest
      ? {
          compactions: compactions.length,
          records: largest.records,
          renderedLines: largest.lines,
          descriptionTokens: largest.descriptionTokens,
          blockTokens: largest.blockTokens,
          ratio: round4(largest.blockTokens / largest.descriptionTokens),
          lineCharsPerDescriptionToken: round4(largest.lineChars / largest.descriptionTokens),
          headerChars: Math.max(...compactions.map((row) => row.headerChars)),
          fullFolds: compactions.filter((row) => row.fullFold).length,
        }
      : null,
    rounds: {
      artifactReads: rounds.length,
      overheadTokens: {
        mean: Math.round(mean(rounds.map((row) => row.overheadTokens))),
        max: Math.max(0, ...rounds.map((row) => row.overheadTokens)),
      },
      escapeRatio: round4(Math.max(1, ...rounds.map((row) => row.escapeRatio))),
    },
    afterCompaction: {
      midLoop: compactions.filter((row) => row.point === "mid-loop").length,
      betweenLoops: compactions.filter((row) => row.point === "between-loops").length,
      maxRequestTokens: Math.max(0, ...compactions.map((row) => row.requestTokens)),
      // A tail of several units never exceeds the keep budget; a larger tail is one tool round kept whole.
      maxTailProductTokens: Math.max(0, ...compactions.map((row) => row.tailProductTokens)),
    },
  };
}

/** Reads `<session>.ledger.json` files: one stored session each. Returns rows sorted by session id, and the files' hash. */
export function readLedgers(dir) {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".ledger.json"))
    .sort();
  if (!files.length) throw new Error(`SessionBenchLongPressure: no *.ledger.json in ${dir}`);
  const hash = createHash("sha256");
  const sessions = files.map((name) => {
    const text = readFileSync(join(dir, name), "utf8");
    hash.update(`${name}:${createHash("sha256").update(text).digest("hex")}\n`);
    const stored = Object.values(JSON.parse(text));
    if (stored.length !== 1) throw new Error(`SessionBenchLongPressure: ${name} holds ${stored.length} sessions, expected one`);
    return { session: name.slice(0, -".ledger.json".length), entries: stored[0] };
  });
  return { sessions, ledgersHash: hash.digest("hex") };
}

/**
 * The design review's report over a set of stored sessions: pressure (mean, densest, sparsest), the render ratio, the
 * worst request and the artifact range, the distance buckets, and the findings that go to the owner.
 */
export function pressureReport({ sessions, ledgersHash, window = WINDOW_TOKENS, artifactTokens = LONG_JOB_ARTIFACT_TOKENS }) {
  const rows = sessions.map(({ session, entries }) => ({ session, ...sessionPressure(entries, { window }) }));
  const pool = poolTokens(window);
  const rate = rows.map((row) => row.perTask.tokens);
  const densest = rows.reduce((a, b) => (b.perTask.tokens > a.perTask.tokens ? b : a));
  const sparsest = rows.reduce((a, b) => (b.perTask.tokens < a.perTask.tokens ? b : a));
  const scopeTokens = mean(rows.map((row) => row.descriptionTokens.scope));
  const overflow = {
    mean: poolOverflowTask(mean(rate), pool, scopeTokens),
    densest: densest.overflowTask,
    sparsest: sparsest.overflowTask,
  };
  const rendered = rows.filter((row) => row.render);
  // The worst case is sized from the costliest session: the most rendered characters per description token.
  const render = {
    lineCharsPerDescriptionToken: Math.max(...rendered.map((row) => row.render.lineCharsPerDescriptionToken)),
    headerChars: Math.max(...rendered.map((row) => row.render.headerChars)),
  };
  const round = {
    overheadTokens: Math.max(...rows.map((row) => row.rounds.overheadTokens.max)),
    escapeRatio: Math.max(...rows.map((row) => row.rounds.escapeRatio)),
  };
  const worst = (tokens) => worstRequest({ window, artifactTokens: tokens, render, round });
  const atBound = worst(0).blockTokens;
  const protectedRate = mean(rows.map((row) => row.perTask.protectedTokens));
  const highRate = mean(rows.map((row) => row.perTask.highTokens));
  // The scope's records are word-for-word user messages, so they count with the high records.
  const highOverflowTask = poolOverflowTask(highRate, pool, scopeTokens);
  const rehearsal = {
    mean: poolOverflowTask(mean(rate), PRODUCT_RULES.rehearsalTargetTokens, scopeTokens),
    densest: densest.rehearsalTask,
  };
  return {
    kind: PRESSURE_REPORT_KIND,
    plan: "218.5 Task 2",
    source: { ledgers: rows.length, arm: "STM-only", ledgersHash },
    window,
    caps: {
      harnessInputCap: harnessInputCap(window),
      productInputCap: productInputCap(window),
      poolTokens: pool,
      keepRecentTokens: keepRecentTokens(window),
      compactAtTokens: round1(compactAtTokens(window)),
      fixedRequestTokens: { live: LIVE_FIXED_REQUEST_TOKENS, withToolList: FIXED_REQUEST_TOKENS },
    },
    pressure: {
      tasks: sum(rows.map((row) => row.tasks)),
      recordsPerTask: {
        mean: round1(mean(rows.map((row) => row.perTask.records))),
        densest: densest.perTask.records,
        sparsest: sparsest.perTask.records,
      },
      tokensPerTask: { mean: round1(mean(rate)), densest: densest.perTask.tokens, sparsest: sparsest.perTask.tokens },
      tokensPerTaskByRelevance: Object.fromEntries(
        RELEVANCES.map((level) => [level, round1(mean(rows.map((row) => row.perTask.byRelevance[level])))]),
      ),
      highTokensPerTask: round1(highRate),
      recordedTokensPerTask: round1(mean(rows.map((row) => row.perTask.recordedTokens))),
      verbatimTokensPerTask: round1(sum(rows.map((row) => row.descriptionTokens.verbatim)) / sum(rows.map((row) => row.tasks))),
      protectedTokensPerTask: round1(protectedRate),
      scopeTokens: round1(scopeTokens),
      largestPoolTokens: Math.max(...rows.map((row) => row.descriptionTokens.active)),
      overflowTask: overflow,
      // The task at which the high and critical records alone pass the pool: until then only lower records are left out.
      highOverflowTask,
      rehearsalTask: rehearsal,
      densestSession: densest.session,
      sparsestSession: sparsest.session,
    },
    render: {
      ratio: {
        measuredMean: round4(mean(rendered.map((row) => row.render.ratio))),
        measuredMin: Math.min(...rendered.map((row) => row.render.ratio)),
        measuredMax: Math.max(...rendered.map((row) => row.render.ratio)),
        atPoolBound: round4(atBound / pool),
      },
      lineCharsPerDescriptionToken: {
        mean: round4(mean(rendered.map((row) => row.render.lineCharsPerDescriptionToken))),
        max: render.lineCharsPerDescriptionToken,
      },
      headerChars: render.headerChars,
      blockTokensAtPoolBound: atBound,
      fullFolds: sum(rendered.map((row) => row.render.fullFolds)),
    },
    rounds: {
      artifactReads: sum(rows.map((row) => row.rounds.artifactReads)),
      overheadTokens: {
        mean: Math.round(mean(rows.filter((row) => row.rounds.artifactReads).map((row) => row.rounds.overheadTokens.mean))),
        max: round.overheadTokens,
      },
      escapeRatio: round.escapeRatio,
    },
    observed: {
      compactions: sum(rows.map((row) => row.afterCompaction.midLoop + row.afterCompaction.betweenLoops)),
      midLoop: sum(rows.map((row) => row.afterCompaction.midLoop)),
      maxRequestAfterCompaction: Math.max(...rows.map((row) => row.afterCompaction.maxRequestTokens)),
    },
    worstRequest: {
      share: WORST_REQUEST_SHARE,
      limitTokens: Math.floor(WORST_REQUEST_SHARE * harnessInputCap(window)),
      v3Artifact: worst(18_500),
      chosenArtifact: worst(artifactTokens[1]),
      maxArtifactTokens: maxArtifactTokens({ window, render, round }),
      underTrigger: underTriggerRequest({ window }),
      underTriggerLive: underTriggerRequest({ window, fixedTokens: LIVE_FIXED_REQUEST_TOKENS }),
    },
    artifactTokens: [...artifactTokens],
    buckets: {
      // `before`: the dependent's task comes before the densest session's overflow task.
      beforeBelowTask: overflow.densest,
      // `after`: the dependent's task comes after the mean overflow task plus the margin.
      afterAboveTask: overflow.mean + AFTER_BUCKET_MARGIN_TASKS,
      byLength: Object.fromEntries(
        [80, 100, 125, 150].map((length) => [
          length,
          {
            tasksPastOverflow: Math.max(0, length - overflow.mean + 1),
            shareUnderEviction: round4(Math.max(0, length - overflow.mean + 1) / length),
            tasksInAfterBucket: Math.max(0, length - (overflow.mean + AFTER_BUCKET_MARGIN_TASKS)),
            tasksPastHighOverflow: Math.max(0, length - highOverflowTask + 1),
          },
        ]),
      ),
    },
    findings: [
      {
        id: "pool-bounds-description-tokens",
        text: "The pool bound counts description tokens, but the block the request carries is larger.",
        poolTokens: pool,
        blockTokensAtPoolBound: atBound,
        ratio: round4(atBound / pool),
      },
      {
        id: "product-cap-below-harness-cap",
        text: "Session memory sizes itself from the kernel's input cap (W minus the output reserve minus 1,024), not the provider wrapper's.",
        productInputCap: productInputCap(window),
        harnessInputCap: harnessInputCap(window),
      },
      {
        id: "trigger-near-the-cap",
        text: "The mid-loop trigger counts 4 characters per token over messages and the summary; in window tokens with the fixed part, a request just under it is close to the cap.",
        ...underTriggerRequest({ window }),
        live: underTriggerRequest({ window, fixedTokens: LIVE_FIXED_REQUEST_TOKENS }),
      },
      {
        id: "eviction-reaches-medium-records-only",
        text: "Eviction leaves out the lowest relevance first. Word-for-word user messages and corrections are high, so until the high records alone pass the pool, only lower records are left out.",
        highTokensPerTask: round1(highRate),
        highOverflowTask,
      },
      {
        id: "rehearsal-drop-in-reach",
        text: "The rehearsal drop starts when active records pass its target. Its model is the session's unless rehearsal.model is set.",
        targetTokens: PRODUCT_RULES.rehearsalTargetTokens,
        task: rehearsal,
      },
      {
        id: "protected-records-fill-the-pool",
        text: "Word-for-word user messages, user statements and durable records alone reach the pool at this task: from there an order that protects them has nothing else to leave out.",
        protectedTokensPerTask: round1(protectedRate),
        task: poolOverflowTask(protectedRate, pool, scopeTokens),
      },
    ],
    sessions: rows,
  };
}

/** Writes the report's summary into the gate record's `design` section; every other section is left as it is. */
export function writeDesign(report, file = GATE_FILE, date = new Date().toISOString().slice(0, 10)) {
  const gate = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { schemaVersion: 1, kind: "session-bench-long-owner-gate", plan: "218.5", ownerDecisions: [] };
  const { sessions, kind: _kind, plan: _plan, ...summary } = report;
  gate.design = {
    task: "plan 218.5 Task 2",
    date,
    script: "scripts/memory-bench/session-bench-long/pressure.mjs",
    ...summary,
    sessions: sessions.map((row) => ({
      session: row.session,
      tasks: row.tasks,
      records: row.records.active,
      descriptionTokens: row.descriptionTokens.active,
      tokensPerTask: row.perTask.tokens,
      overflowTask: row.overflowTask,
      renderRatio: row.render?.ratio ?? null,
    })),
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(gate, null, 2)}\n`);
  return gate;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const dir = value("--ledgers");
  if (!dir) {
    console.error("usage: pressure.mjs --ledgers <dir> [--window 32000] [--write]");
    process.exit(2);
  }
  const window = Number(value("--window") ?? WINDOW_TOKENS);
  const report = pressureReport({ ...readLedgers(dir), window });
  if (args.includes("--write")) writeDesign(report);
  const { sessions: _sessions, ...summary } = report;
  console.log(JSON.stringify(args.includes("--sessions") ? report : summary, null, 2));
}
