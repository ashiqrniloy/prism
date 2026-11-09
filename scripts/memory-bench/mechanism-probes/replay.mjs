/**
 * Plan 210 Task 2: realistic trigger rates. One development history per source is replayed offline
 * through the product path (the fabric package on its preset) with scripted model replies: each
 * user turn runs as a real agent turn and the model "says" the history's own assistant text. Per
 * turn, the probe reads what the agent received; after the replay it reads the store and runs one
 * maintenance pass. A mechanism firing on fewer than 1% of its eligible units is `rare`.
 *
 * Only counts and hashes leave the process; no history text is emitted.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DATASETS, normalizeDataset } from "../datasets.mjs";
import { createPersona } from "../lifecycle/persona.mjs";
import { robustnessDraw } from "../robustness.mjs";
import { createWorkPersona, personaIds } from "../work-outcome/personas.mjs";
import { blocksOf, fabricAgent, packages, tailSourceText, tailText, withTempRoot } from "./harness.mjs";

export const RARE_BELOW = 0.01;
const CACHE = join(process.env.PRISM_CACHE_DIR ?? join(homedir(), ".cache/prism"), "memory-bench");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const CUE =
  /\b(?:all|any|compare|count|each|earliest|every|first|how many|last|latest|least|list|most|number of|oldest|order|timeline|when|which|who)\b/iu;

/**
 * Stream LongMemEval-M (2.7 GB, one top-level JSON array) and parse only the first row whose
 * question id is in the development partition. Nothing else is decoded.
 */
async function firstDevRow(path, devIds) {
  const wanted = new Set(devIds.map(String));
  let depth = 0;
  let inString = false;
  let escaped = false;
  let parts = [];
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 22 })) {
    let start = depth > 0 ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (byte === 0x5c) escaped = true;
        else if (byte === 0x22) inString = false;
        continue;
      }
      if (byte === 0x22) inString = true;
      else if (byte === 0x7b) {
        if (depth === 0) start = i;
        depth++;
      } else if (byte === 0x7d) {
        depth--;
        if (depth === 0 && start >= 0) {
          parts.push(chunk.subarray(start, i + 1));
          const head = Buffer.concat(parts.length === 1 ? parts : [parts[0]])
            .subarray(0, 4096)
            .toString("utf8");
          const id = /"question_id"\s*:\s*"([^"]+)"/.exec(head)?.[1];
          if (id !== undefined && wanted.has(id)) return JSON.parse(Buffer.concat(parts).toString("utf8"));
          parts = [];
          start = -1;
        }
      }
    }
    if (depth > 0 && start >= 0) parts.push(chunk.subarray(start));
  }
  return undefined;
}

/** One development history per source, as `{ id, sessions: [{ key, project, turns: [{ user, assistant }] }] }`. */
export async function loadHistories({ maxSessions = 60 } = {}) {
  const histories = [];
  const skipped = [];
  const fromQuestion = (suite, question) => ({
    suite,
    idSha256: sha256(String(question.id)),
    sessionsTotal: question.sessions.length,
    preset: "conversational",
    sessions: question.sessions.slice(0, maxSessions).map((session, index) => ({
      key: `${suite}-${index}`,
      project: "probe",
      turns: pairs(session.messages.map((message) => ({ role: message.role, text: message.text }))),
    })),
  });
  // LongMemEval-M: the first development row in file order.
  const lme = join(CACHE, DATASETS["longmemeval-m"].file);
  if (existsSync(lme)) {
    const dev = Object.values(robustnessDraw("longmemeval-m").abilities.dev).flat();
    const row = await firstDevRow(lme, dev);
    if (row) histories.push(fromQuestion("longmemeval-m", normalizeDataset([row], "longmemeval-m")[0]));
    else skipped.push({ suite: "longmemeval-m", reason: "no development row found" });
  } else skipped.push({ suite: "longmemeval-m", reason: "dataset not cached" });
  // BEAM-100K: decoding needs the benchmark-only pyarrow; the first development question's chat.
  const venv = join(import.meta.dir, "../../../.cache/memory-bench/python/bin/python");
  if (process.env.PRISM_MEMORY_BENCH_PYTHON === undefined && existsSync(venv)) process.env.PRISM_MEMORY_BENCH_PYTHON = venv;
  try {
    const { loadDataset } = await import("../datasets.mjs");
    const rows = normalizeDataset(await loadDataset("beam-100k"), "beam-100k");
    const dev = new Set(Object.values(robustnessDraw("beam-100k").abilities.dev).flat().map(String));
    const question = rows.find((row) => dev.has(String(row.id)));
    if (question) histories.push(fromQuestion("beam-100k", question));
    else skipped.push({ suite: "beam-100k", reason: "no development row found" });
  } catch (error) {
    skipped.push({ suite: "beam-100k", reason: String(error?.message ?? error).slice(0, 160) });
  }
  // The coding lifecycle persona (plan 202 Task 16): one session per step, one user turn each.
  const persona = createPersona({ seed: 7 });
  histories.push({
    suite: "coding-lifecycle-persona",
    idSha256: sha256(persona.id),
    sessionsTotal: persona.schedule.length,
    preset: "coding",
    sessions: persona.schedule.map((step, index) => ({
      key: `coding-${index}`,
      project: step.project,
      turns: [{ user: step.script, assistant: "Done." }],
    })),
  });
  // The work-outcome persona (plan 209): the opening turn, then the correction when the step has one.
  const family = "coding";
  const work = createWorkPersona(family, personaIds(family).indexOf(personaIds(family)[0]));
  histories.push({
    suite: "work-outcome-persona",
    idSha256: sha256(work.id),
    sessionsTotal: work.schedule.length,
    preset: "coding",
    sessions: work.schedule.map((step, index) => ({
      key: `work-${index}`,
      project: step.project,
      turns: [{ user: step.opening, assistant: "Written." }, ...(step.correction ? [{ user: step.correction, assistant: "Fixed." }] : [])],
    })),
  });
  return { histories, skipped };
}

/** User turns paired with the assistant reply that follows, in order. */
function pairs(messages) {
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== "user") continue;
    const reply = messages[i + 1]?.role === "assistant" ? messages[i + 1].text : "ok";
    out.push({ user: String(messages[i].text ?? ""), assistant: String(reply ?? "ok") });
  }
  return out;
}

/** Replay one history through the fabric package on its preset; count what each turn delivered. */
export async function replayHistory(history, root) {
  const { testing } = await packages();
  const counts = { turns: 0, cuedTurns: 0, passive: 0, directory: 0, rules: 0, excerptTurns: 0, nudges: 0 };
  let reply = "ok";
  const ui = testing.createScriptedHostUi({ confirm: true });
  const projects = [...new Set(history.sessions.map((session) => session.project))];
  const agents = new Map();
  const path = join(root, "memory.sqlite");
  try {
    for (const project of projects) {
      agents.set(
        project,
        await fabricAgent(join(root, project), {
          config: {
            preset: history.preset,
            tools: { root },
            store: { sqlite: { path } },
            scopes: { project: { id: `${project}--0123456789`.slice(0, 20), root: join(root, project) }, agent: true, user: true },
          },
          respond: (_request, ctx) => ctx.ev.say(reply),
          agentOptions: { host: { ui: ui.ui } },
        }),
      );
    }
    for (const session of history.sessions) {
      const h = agents.get(session.project);
      const before = h.requests.length;
      for (const turn of session.turns) {
        reply = turn.assistant.slice(0, 4000) || "ok";
        await h.run(session.key, turn.user.slice(0, 8000));
        const request = h.requests[before + counts.turns - (h.requests.length - before - 1) - 1]?.request ?? h.requests.at(-1)?.request;
        const first = h.requests.at(-1)?.request ?? request;
        counts.turns++;
        if (CUE.test(turn.user)) counts.cuedTurns++;
        if (tailText(first)) counts.passive++;
        if (blocksOf(first, "fabric-directory").length) counts.directory++;
        if (blocksOf(first, "fabric-rules").length) counts.rules++;
        if (tailSourceText(first, "fabric-lesson-nudge") || blocksOf(first, "fabric-lesson-nudge").length) counts.nudges++;
        // The delivery mode this turn ran under (the state machine advances once per user turn).
        if ((await h.command("memory:status", {}, session.key))?.delivery === "excerpts") counts.excerptTurns++;
      }
      await h.closeSession(session.key);
    }
    const first = agents.get(projects[0]);
    // Every scope's rows, read from the one SQLite file all project agents share (resource ids are the package's).
    const { Database } = await import("bun:sqlite");
    const db = new Database(path, { readonly: true });
    const rows = db
      .query("SELECT record FROM semantic_memory")
      .all()
      .map((row) => JSON.parse(row.record));
    db.close();
    const { fabric } = await packages();
    const notes = rows.map((row) => ({ metadata: fabric.parseMemoryNoteMetadata(row.metadata), status: row.metadata?.status }));
    const exchanges = notes.filter((note) => note.metadata?.kind === "exchange");
    const maintenance = await first.command("memory:maintain", {}, "maintain").catch(() => undefined);
    return {
      suite: history.suite,
      idSha256: history.idSha256,
      preset: history.preset,
      sessionsReplayed: history.sessions.length,
      sessionsTotal: history.sessionsTotal,
      ...counts,
      notes: notes.length,
      exchanges: exchanges.length,
      exchangesWithKeywords: exchanges.filter((note) => (note.metadata?.keywords ?? []).length > 0).length,
      exchangesWithDates: exchanges.filter((note) => (note.metadata?.dates ?? []).length > 0).length,
      exchangesWithSteps: exchanges.filter((note) => note.metadata?.steps !== undefined).length,
      candidates: notes.filter((note) => note.status === "candidate").length,
      verified: notes.filter((note) => note.status === "verified").length,
      // Verified by use: cited in verifyAfterSessions (2) sessions; a confirmed captured rule is verified without a use.
      verifiedByUse: notes.filter((note) => note.status === "verified" && (note.metadata?.useSessions ?? 0) >= 2).length,
      captured: notes.filter((note) => note.metadata?.kind !== "exchange" && note.metadata?.generated?.by !== "host").length,
      decisions: notes.filter((note) => note.metadata?.kind === "decision").length,
      confirmations: ui.requestsOf("confirm").length,
      maintenance: maintenance
        ? {
            archived: maintenance.archived,
            merged: maintenance.merged,
            evicted: maintenance.evicted,
            widened: maintenance.widened,
            superseded: maintenance.superseded,
          }
        : null,
    };
  } finally {
    for (const h of agents.values()) await h.close();
  }
}

/** Trigger rate per ledger row: fired units over eligible units, pooled across the replays that can exercise it. */
export function triggerRates(replays) {
  const sum = (key) => replays.reduce((total, row) => total + (typeof row[key] === "number" ? row[key] : 0), 0);
  const maint = (key) => replays.reduce((total, row) => total + (row.maintenance?.[key] ?? 0), 0);
  const rate = (fired, eligible, unit, note) => ({
    fired,
    eligible,
    unit,
    rate: eligible ? fired / eligible : null,
    rare: eligible ? fired / eligible < RARE_BELOW : true,
    ...(note ? { note } : {}),
  });
  const turns = sum("turns");
  const notes = sum("notes");
  const exchanges = sum("exchanges");
  return {
    "delivery.passive-tail": rate(sum("passive"), turns, "turns"),
    "delivery.directory": rate(sum("directory"), turns, "turns"),
    "delivery.standing-rules": rate(sum("rules"), turns, "turns"),
    "delivery.weak-tool-caller": rate(
      sum("excerptTurns"),
      turns,
      "turns",
      "a session reaches excerpts after two cued turns without a memory.* call",
    ),
    "delivery.rule-capture": rate(sum("confirmations"), turns, "turns", "presets with rules.capture confirm only (coding)"),
    lessons: rate(sum("nudges"), turns, "turns", "lessons.nudge is off in both presets"),
    "write.keyword-enrichment": rate(sum("exchangesWithKeywords"), exchanges, "exchanges"),
    timeline: rate(sum("exchangesWithDates"), exchanges, "exchanges"),
    "write.exchange-steps": rate(sum("exchangesWithSteps"), exchanges, "exchanges", "exchanges.steps is off in both presets"),
    "lifecycle.verification": rate(
      sum("verifiedByUse"),
      notes,
      "notes",
      "only candidate notes cited as [id] in two sessions; scripted replies cite nothing",
    ),
    "lifecycle.archive-revival": rate(
      maint("archived"),
      notes,
      "notes",
      "one memory:maintain pass after the replay; on the conversational preset the archived notes are raw exchanges",
    ),
    "lifecycle.capacity-eviction": rate(maint("evicted"), notes, "notes", "evicted also counts exchange demotions"),
    "lifecycle.duplicate-merge": rate(maint("merged"), notes, "notes"),
    "lifecycle.widen-narrow": rate(maint("widened") + maint("superseded"), notes, "notes"),
    "kind.decision": rate(sum("decisions"), turns, "turns"),
  };
}

/** Run every available history; returns per-replay counts, pooled rates and what could not run. */
export async function runReplays({ maxSessions } = {}) {
  const { histories, skipped } = await loadHistories(maxSessions === undefined ? {} : { maxSessions });
  const replays = [];
  for (const history of histories) replays.push(await withTempRoot((root) => replayHistory(history, root)));
  return { replays, skipped, rates: triggerRates(replays), rareBelow: RARE_BELOW };
}
