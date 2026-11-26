/**
 * Plan 218.5 Task 5: the long run's instrumentation. After each task the runner hands the session store's entries here,
 * and gets counts back: the block's size, STM's active pool, what the bound left out (by relevance), the Rehearsal
 * drops, and for the WM arms the WM items, tombstones and passes. For each dependent it records whether its sources'
 * records were in the block when the task started (record ids only).
 *
 * It reads the stored session as data and imports nothing from the memory system: the ledger's record types and the
 * product's `isDurableOrUserStatement` are mirrored, and `run.test.mjs` holds the mirror to the product. Every value it
 * returns is a number, a boolean, a relevance name or a 12-hex record id: never a prompt, a tool output or a record's
 * text (`row_counts_hold_no_text`).
 */
import { blockTokens } from "./pressure.mjs";

const LEDGER_KEY = "memory.session.ledger";
const RECORDED = "memory.session.observations.recorded";
const DROPPED = "memory.session.observations.dropped";
const TOMBSTONED = "memory.session.observations.tombstoned";
const WM_RECORDED = "memory.session.wm.recorded";
export const RELEVANCES = Object.freeze(["low", "medium", "high", "critical"]);

/** The product's `isDurableOrUserStatement` (`attribution.ts`), mirrored: durable, or a user statement or verbatim message. */
export const isDurableOrUserStatement = (record) =>
  record.durable !== undefined ||
  ((record.attribution === "user" || record.attribution === "mixed") && (record.kind === "statement" || record.verbatim === true));

const textOf = (message) =>
  Array.isArray(message?.content)
    ? message.content.map((block) => (block.type === "text" ? block.text : "")).join("")
    : String(message?.content ?? "");
const byRelevance = () => Object.fromEntries(RELEVANCES.map((level) => [level, 0]));
const sum = (values) => values.reduce((total, value) => total + value, 0);

/**
 * The ledger and blocks of one stored session, folded in entry order. `taskOf` maps an entry to its task (0 before the
 * first prompt; a phase scope belongs to the task before it). Returns the records (with the task they cite), the
 * compactions (each with the records active at that point and the ones it kept) and the WM state.
 */
export function foldStoredSession(entries) {
  const taskOf = new Map();
  let task = 0;
  for (const entry of entries) {
    if (entry.kind === "message" && entry.message?.role === "user") {
      const match = /^Task (\d+)\./.exec(textOf(entry.message));
      if (match) task = Number(match[1]);
    }
    taskOf.set(entry.id, task);
  }
  const records = new Map();
  const gone = new Set();
  const rehearsalDrops = [];
  const tombstoned = new Set();
  const wmItems = new Map();
  const supersededItems = new Set();
  const wmPasses = [];
  const compactions = [];
  for (const entry of entries) {
    const at = taskOf.get(entry.id) ?? 0;
    if (entry.kind === "compaction" && Array.isArray(entry.data?.memory?.observations)) {
      const kept = new Set(entry.data.memory.observations.map((record) => record.id));
      const active = [...records.values()].filter((record) => !gone.has(record.id));
      compactions.push({
        task: at,
        kept,
        active,
        descriptionTokens: sum(entry.data.memory.observations.map((record) => record.tokenCount ?? 0)),
        blockTokens: typeof entry.summary === "string" ? blockTokens(entry.summary) : 0,
        wmItems: Array.isArray(entry.data.memory.wmItems) ? entry.data.memory.wmItems.length : 0,
        fullFold: entry.data.memory.fullFold === true,
      });
      continue;
    }
    const data = entry.kind === "package_state" && entry.data?.key === LEDGER_KEY ? entry.data.value : undefined;
    if (!data) continue;
    if (data.type === RECORDED) {
      for (const record of data.observations ?? []) {
        if (records.has(record.id)) continue;
        const cited = (record.sourceEntryIds ?? []).flatMap((id) => (taskOf.has(id) ? [taskOf.get(id)] : []));
        records.set(record.id, {
          id: record.id,
          tokenCount: record.tokenCount ?? 0,
          relevance: record.relevance,
          protected: isDurableOrUserStatement(record),
          task: cited.length ? Math.max(...cited) : at,
        });
      }
    } else if (data.type === DROPPED) {
      for (const id of data.observationIds ?? []) {
        if (!gone.has(id) && data.reason !== "superseded") rehearsalDrops.push({ task: at, id });
        gone.add(id);
      }
    } else if (data.type === TOMBSTONED) {
      for (const id of data.observationIds ?? []) {
        tombstoned.add(id);
        gone.add(id);
      }
    } else if (data.type === WM_RECORDED) {
      for (const id of data.supersededItemIds ?? []) supersededItems.add(id);
      for (const item of data.items ?? []) {
        if (!wmItems.has(item.id)) wmItems.set(item.id, item);
        supersededItems.delete(item.id);
      }
      if (data.processedIds?.length) wmPasses.push(at);
    }
  }
  return { taskOf, records, gone, rehearsalDrops, tombstoned, wmItems, supersededItems, wmPasses, compactions };
}

/** The task of a session's first `after` dependent: G11 asks the pool to overflow before it. */
export const firstAfterTask = (session) => Math.min(...session.deps.filter((dep) => dep.bucket === "after").map((dep) => dep.dependent));
/** Every `after` dependent's task, ascending (the live G11 reads how many sit past the measured overflow). */
export const afterTasks = (session) =>
  session.deps
    .filter((dep) => dep.bucket === "after")
    .map((dep) => dep.dependent)
    .sort((x, y) => x - y);

/** What the latest compaction up to and including task `n` (or before it, `before: true`) left in and out of the block. */
function blockAt(folded, n, { before = false } = {}) {
  const last = folded.compactions.filter((row) => (before ? row.task < n : row.task <= n)).at(-1);
  if (!last) return null;
  const leftOut = last.active.filter((record) => !last.kept.has(record.id));
  return { ...last, leftOut };
}

/**
 * The counts of task `n` (after the task ran). `block` is null before the session's first compaction; `leftOut` counts
 * the records active at the latest compaction that its bound left out.
 */
export function taskPressure(folded, n) {
  const block = blockAt(folded, n);
  const active = [...folded.records.values()].filter((record) => !folded.gone.has(record.id));
  const drops = folded.rehearsalDrops.filter((row) => row.task === n);
  const dropped = drops.map((row) => folded.records.get(row.id)).filter(Boolean);
  const leftOut = byRelevance();
  for (const record of block?.leftOut ?? []) leftOut[record.relevance] = (leftOut[record.relevance] ?? 0) + 1;
  return {
    task: n,
    block: block
      ? {
          descriptionTokens: block.descriptionTokens,
          renderedTokens: block.blockTokens,
          records: block.kept.size,
          wmItems: block.wmItems,
          fullFold: block.fullFold,
        }
      : null,
    compactions: folded.compactions.filter((row) => row.task === n).length,
    activeStmTokens: sum(active.map((record) => record.tokenCount)),
    activeRecords: active.length,
    leftOut,
    leftOutProtected: (block?.leftOut ?? []).filter((record) => record.protected).length,
    rehearsalDrops: drops.length,
    rehearsalDropsProtected: dropped.filter((record) => record.protected).length,
    wm: {
      items: [...folded.wmItems.keys()].filter((id) => !folded.supersededItems.has(id)).length,
      tombstones: folded.tombstoned.size,
      passes: folded.wmPasses.filter((task) => task <= n).length,
    },
  };
}

/**
 * For the dependent of each dependency at task `n`: its sources' records (by the task they cite) and which of them were
 * in the block when the task started. `block: false` means no compaction had run yet, so the transcript still held them.
 */
export function dependentBlocks(folded, session, n) {
  const block = blockAt(folded, n, { before: true });
  return session.deps
    .filter((dep) => dep.dependent === n)
    .map((dep) => {
      const records = [...folded.records.values()].filter((record) => dep.sources.includes(record.task)).map((record) => record.id);
      return {
        dep: dep.id,
        task: n,
        bucket: dep.bucket,
        block: Boolean(block),
        sourceRecords: records,
        inBlock: block ? records.filter((id) => block.kept.has(id)) : [],
      };
    });
}

/** The session-level reading: the first task whose block left a record out, and the WM arms' first pass. */
export function sessionPressureSummary(rows, folded) {
  const overflow = rows.find((row) => sum(Object.values(row.leftOut)) > 0 || row.block?.fullFold);
  return {
    firstOverflowTask: overflow?.task ?? null,
    firstWmPassTask: folded?.wmPasses[0] ?? null,
    wmPasses: folded?.wmPasses.length ?? 0,
    leftOutProtected: Math.max(0, ...rows.map((row) => row.leftOutProtected)),
    rehearsalDrops: sum(rows.map((row) => row.rehearsalDrops)),
    rehearsalDropsProtected: sum(rows.map((row) => row.rehearsalDropsProtected)),
    maxBlockRenderedTokens: Math.max(0, ...rows.map((row) => row.block?.renderedTokens ?? 0)),
    maxActiveStmTokens: Math.max(0, ...rows.map((row) => row.activeStmTokens)),
  };
}
