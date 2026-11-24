/**
 * Plan 218.5 Task 4: the long bench's generator and frozen partitions.
 *
 *   timeout 600 bun scripts/memory-bench/session-bench-long/generate.mjs --check   # regenerate and compare byte for byte
 *   timeout 600 bun scripts/memory-bench/session-bench-long/generate.mjs --write   # a new benchmark version only (G1)
 *
 * Sessions are a pure function of `SESSION_BENCH_LONG_SEED` and their id; they are rebuilt on demand, never committed.
 * The partition file `../work-outcome-session-bench-long.json` pins the seed, the hash of every source file that defines
 * the benchmark (`templateHash`, Session-Bench v3's imported files included), the hash of every generated session and
 * of every phase scope, the label-blind three-way draw and its `idsHash`. Any change to a pinned file is a new
 * benchmark version and voids earlier evidence (G1). Session-Bench v3's own pins are not touched.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createWorkspace, initialObservableText } from "../session-bench/env/workspace.mjs";
import { idsHash, partitionIds } from "../session-bench/generate.mjs";
import { MIN_TASK_GAP, SIDE_ARTIFACT_TOKENS } from "../session-bench/templates/build.mjs";
import { runScripted } from "./agents.mjs";
import { BUCKETS, buildLongSession, CLASS_LAYOUT, estimateTokens, FAMILIES, LAYOUT, LONG_TASKS, PHASE_TASKS, scopeText } from "./build.mjs";
import { DEPENDENCY_CLASSES, REVOKE_CLASS } from "./checks.mjs";
import {
  FIXED_REQUEST_TOKENS,
  harnessInputCap,
  LONG_JOB_ARTIFACT_TOKENS,
  WINDOW_TOKENS,
  WORST_REQUEST_SHARE,
  worstRequest,
} from "./pressure.mjs";

/** Version 2 (plan 218.5 Task 7, owner 2026-11-24): 150 tasks, the buckets from the live pool overflow. */
export const SESSION_BENCH_LONG_VERSION = 2;
export const SESSION_BENCH_LONG_SEED = "prism-218.5-session-bench-long-v1";
export const SESSIONS_PER_FAMILY = 12;
/** Sessions per partition and family: [dev, heldout-a, heldout-b] (owner, plan 218.5 Task 2: 12 dev sessions). */
export const SESSION_BENCH_LONG_STRATA = Object.freeze([4, 4, 4]);
export const PARTITIONS = Object.freeze(["dev", "heldout-a", "heldout-b"]);
/** A dependency spans at least this many windows, from its last source to its dependent (v3's rule). */
export const MIN_SPAN_WINDOWS = 1.5;
/** A phase scope stays under this many bytes. */
export const MAX_SCOPE_BYTES = 32_768;
/** `after` checks the dev set must hold per class (owner, plan 218.5 Task 2). */
export const MIN_DEV_AFTER_CHECKS = Object.freeze({ D2: 60, D4: 60 });
/**
 * The worst case plan 218.5 Task 2 measured on 36 STM-only sessions (the gate record's `design.render` and
 * `design.rounds`): the costliest rendering of the block, and the costliest tool round beyond its artifact.
 */
export const MEASURED_WORST_CASE = Object.freeze({
  render: Object.freeze({ lineCharsPerDescriptionToken: 5.2442, headerChars: 1187 }),
  round: Object.freeze({ overheadTokens: 2222, escapeRatio: 1.0275 }),
});

export const PARTITION_FILE = new URL("../work-outcome-session-bench-long.json", import.meta.url);
/** The files that define the benchmark (G1, G2): their bytes make `templateHash`. v3's are read, never edited. */
export const CORE_FILES = Object.freeze([
  "../session-bench/env/workspace.mjs",
  "../session-bench/templates/families.mjs",
  "../session-bench/templates/build.mjs",
  "../session-bench/checks.mjs",
  "../session-bench/agents.mjs",
  "pressure.mjs",
  "build.mjs",
  "checks.mjs",
  "agents.mjs",
  "generate.mjs",
]);

const sha = (text) => createHash("sha256").update(text).digest("hex");

export function templateHash() {
  return sha(CORE_FILES.map((file) => `${file}\n${sha(readFileSync(new URL(file, import.meta.url)))}`).join("\n"));
}

export const sessionBenchLongIds = () =>
  FAMILIES.flatMap((family) => Array.from({ length: SESSIONS_PER_FAMILY }, (_, i) => `sbl-${family.short}-${String(i).padStart(2, "0")}`));

const familyOf = (id) => {
  const family = FAMILIES.find((row) => id.startsWith(`sbl-${row.short}-`));
  if (!family) throw new Error(`SessionBenchLongGenerate: no family for ${id}`);
  return family;
};

/** Build one session by id; throws when it breaks a size rule or leaks an answer (the generator ships no such session). */
export function createSession(id, { verify = true } = {}) {
  const session = buildLongSession(familyOf(id), Number(id.slice(-2)), SESSION_BENCH_LONG_SEED);
  if (verify) {
    sessionSizes(session);
    const leaks = dependencyLeaks(session);
    if (leaks.length)
      throw new Error(`SessionBenchLongGenerate: ${id} leaks ${leaks.map((leak) => `${leak.dep} in ${leak.where.join(", ")}`).join("; ")}`);
  }
  return session;
}

/**
 * The size rules, refused at build time. Sizes come from the scripted agents' traces at 3.5 characters per token.
 *
 * - Every job artifact sits in `LONG_JOB_ARTIFACT_TOKENS`.
 * - The largest single tool output either scripted agent reads keeps the worst request after a compaction within
 *   `WORST_REQUEST_SHARE` of the input cap (`pressure.mjs` `worstRequest`, at plan 218.5 Task 2's measured worst case).
 * - The worst task, with the request's fixed part, fits the input cap.
 * - Every dependency spans at least `MIN_TASK_GAP` whole tasks and `MIN_SPAN_WINDOWS` × W, from its last source to its
 *   dependent.
 * - Every class has its pre-registered number of dependents in each bucket, and no dependent sits between the buckets.
 * - Every phase scope stays under `MAX_SCOPE_BYTES`.
 */
export function sessionSizes(session, window = WINDOW_TOKENS) {
  const fail = (text) => {
    throw new Error(`SessionBenchLongGenerate: ${session.id} ${text}`);
  };
  if (session.tasks.length !== LONG_TASKS) fail(`holds ${session.tasks.length} tasks, expected ${LONG_TASKS}`);
  const initial = createWorkspace(session.env);
  const jobArtifacts = session.tasks.map((task) => estimateTokens(initial.call(...task.plan[0].calls[0])));
  const [low, high] = LONG_JOB_ARTIFACT_TOKENS;
  jobArtifacts.forEach((tokens, i) => {
    if (tokens < low || tokens > high) fail(`task ${i + 1} reads a job artifact of ${tokens} tokens, outside ${low}-${high}`);
  });
  const oracle = runScripted(session, "oracle").trace;
  const amnesic = runScripted(session, "amnesic").trace;
  const largestOutput = Math.max(...oracle.map((row) => row.largest), ...amnesic.map((row) => row.largest));
  const worst = worstRequest({ window, artifactTokens: largestOutput, ...MEASURED_WORST_CASE });
  if (worst.tokens > WORST_REQUEST_SHARE * worst.cap)
    fail(
      `has a ${largestOutput}-token tool output: the worst request after a compaction is ${worst.tokens} tokens, ${worst.share} of the cap`,
    );
  const maxTaskTokens = Math.max(...oracle.map((row) => row.tokens), ...amnesic.map((row) => row.tokens));
  if (maxTaskTokens + FIXED_REQUEST_TOKENS > harnessInputCap(window))
    fail(`has a task of ${maxTaskTokens} tokens, which does not fit the window`);
  const spans = session.deps.map((dep) => {
    const from = Math.max(...dep.sources);
    const between = oracle.filter((row) => row.task > from && row.task < dep.dependent);
    const tokens = between.reduce((sum, row) => sum + row.tokens, 0);
    if (between.length < MIN_TASK_GAP || tokens < MIN_SPAN_WINDOWS * window)
      fail(`${dep.id} spans ${between.length} tasks and ${tokens} tokens`);
    return { dep: dep.id, class: dep.class, bucket: dep.bucket, tasks: between.length, tokens };
  });
  const buckets = bucketCounts([session]);
  for (const [cls, want] of Object.entries(CLASS_LAYOUT))
    for (const bucket of ["before", "after"])
      if (buckets[bucket][cls] !== want[bucket]) fail(`has ${buckets[bucket][cls]} ${cls} ${bucket} dependents, expected ${want[bucket]}`);
  if (session.deps.some((dep) => dep.bucket === null)) fail("has a dependent between the buckets");
  for (const phase of session.phases)
    if (Buffer.byteLength(phase.scope) > MAX_SCOPE_BYTES) fail(`phase ${phase.n} has a scope of ${Buffer.byteLength(phase.scope)} bytes`);
  return {
    total: oracle.reduce((sum, row) => sum + row.tokens, 0),
    spans,
    maxTaskTokens,
    jobArtifactTokens: [Math.min(...jobArtifacts), Math.max(...jobArtifacts)],
    largestOutputTokens: largestOutput,
    worstRequest: worst,
  };
}

/** Dependents per bucket and class over a set of sessions. */
export function bucketCounts(sessions) {
  const counts = Object.fromEntries(
    ["before", "after"].map((bucket) => [bucket, Object.fromEntries(DEPENDENCY_CLASSES.map((cls) => [cls, 0]))]),
  );
  for (const session of sessions) for (const dep of session.deps) if (dep.bucket) counts[dep.bucket][dep.class]++;
  return counts;
}

const contains = (text, answer) =>
  new RegExp(`(^|[^A-Za-z0-9_.-])${answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9_-])`).test(text);

/**
 * G5 for the long bench. No dependency's answer or evidence appears in a scope or in its dependent task's prompt. For a
 * user-only dependency (`D2`, `D2R`) the answer appears in no file or tool output of the initial workspace, nor in any
 * prompt but its sources'. A superseded value (`D4`) is a weekday that several trains share by design (look-alike
 * values), so the rule reads its evidence instead (the train and its day together): that appears in no prompt but its
 * sources' and nowhere in the workspace, and the train's own document does not hold the current day. Returns the leaks.
 */
export function dependencyLeaks(session) {
  const leaks = [];
  const observable = initialObservableText(session.env);
  const scope = scopeText(session);
  for (const dep of session.deps) {
    const where = [];
    if (contains(scope, dep.answer) || scope.includes(dep.evidence)) where.push("scope");
    const dependent = session.tasks[dep.dependent - 1].prompt;
    if (contains(dependent, dep.answer) || dependent.includes(dep.evidence)) where.push("dependent-prompt");
    const elsewhere = session.tasks.filter((task) => !dep.sources.includes(task.n));
    if (dep.class === "D2" || dep.class === REVOKE_CLASS) {
      if (contains(observable, dep.answer)) where.push("workspace");
      for (const task of elsewhere) if (contains(task.prompt, dep.answer)) where.push(`prompt-${task.n}`);
    }
    if (dep.class === "D4") {
      if (observable.includes(dep.evidence) || contains(session.env.files[dep.document] ?? "", dep.answer)) where.push("workspace");
      for (const task of elsewhere) if (task.n < dep.dependent && task.prompt.includes(dep.evidence)) where.push(`prompt-${task.n}`);
    }
    if (where.length) leaks.push({ session: session.id, dep: dep.id, class: dep.class, where });
  }
  return leaks;
}

/** Label-blind draw: inside each family, ids ordered by SHA-256(seed + ":" + id), sliced by the strata (v3's draw). */
export function drawPartitions(ids = sessionBenchLongIds()) {
  const abilities = Object.fromEntries(PARTITIONS.map((partition) => [partition, {}]));
  for (const family of FAMILIES) {
    const own = ids.filter((id) => id.startsWith(`sbl-${family.short}-`));
    const needed = SESSION_BENCH_LONG_STRATA.reduce((sum, size) => sum + size, 0);
    if (own.length < needed) throw new Error(`SessionBenchLongGenerate: ${family.id} has ${own.length} of ${needed} sessions`);
    const ordered = [...own].sort((a, b) => sha(`${SESSION_BENCH_LONG_SEED}:${a}`).localeCompare(sha(`${SESSION_BENCH_LONG_SEED}:${b}`)));
    let start = 0;
    PARTITIONS.forEach((partition, i) => {
      abilities[partition][family.id] = ordered.slice(start, start + SESSION_BENCH_LONG_STRATA[i]);
      start += SESSION_BENCH_LONG_STRATA[i];
    });
  }
  return abilities;
}

/** The frozen partition file: pins, the draw and counts only (no session text). */
export function partitionFile() {
  const ids = sessionBenchLongIds();
  const sessions = ids.map((id) => createSession(id));
  const abilities = drawPartitions(ids);
  const dev = new Set(partitionIds({ abilities }, "dev"));
  const devAfter = bucketCounts(sessions.filter((session) => dev.has(session.id))).after;
  for (const [cls, min] of Object.entries(MIN_DEV_AFTER_CHECKS))
    if (devAfter[cls] < min) throw new Error(`SessionBenchLongGenerate: dev holds ${devAfter[cls]} ${cls} after checks, under ${min}`);
  const sizes = sessions.map((session) => sessionSizes(session));
  const spans = sizes.flatMap((size) => size.spans);
  return {
    benchmark: "session-bench-long",
    version: SESSION_BENCH_LONG_VERSION,
    plan: "218.5",
    task: 4,
    seed: SESSION_BENCH_LONG_SEED,
    source:
      "scripts/memory-bench/session-bench-long (project-owned synthetic generator over Session-Bench v3's workspace and families); sessions rebuild from the seed, ids and hashes only",
    draw: `SHA-256("${SESSION_BENCH_LONG_SEED}:" + id), ascending inside each family; strata [dev, heldout-a, heldout-b]`,
    strata: Object.fromEntries(FAMILIES.map((family) => [family.id, [...SESSION_BENCH_LONG_STRATA]])),
    part: "dev | heldout-a | heldout-b; plan 218.5's pilot and run read dev only; heldout-a and heldout-b stay unread",
    window: {
      tokens: WINDOW_TOKENS,
      minSpanWindows: MIN_SPAN_WINDOWS,
      minTaskGap: MIN_TASK_GAP,
      jobArtifactTokens: [...LONG_JOB_ARTIFACT_TOKENS],
      sideArtifactTokens: [...SIDE_ARTIFACT_TOKENS],
      worstRequestShare: WORST_REQUEST_SHARE,
      measuredWorstCase: MEASURED_WORST_CASE,
    },
    layout: {
      tasks: LONG_TASKS,
      phaseTasks: PHASE_TASKS,
      buckets: BUCKETS,
      ranges: LAYOUT,
      dependentsPerSession: CLASS_LAYOUT,
    },
    templateHash: templateHash(),
    coreFiles: [...CORE_FILES],
    sessionsHash: sha(sessions.map((session) => sha(JSON.stringify(session))).join("\n")),
    scopesHash: sha(sessions.flatMap((session) => session.phases.map((phase) => sha(phase.scope))).join("\n")),
    counts: {
      sessions: sessions.length,
      tasks: sessions.reduce((sum, session) => sum + session.tasks.length, 0),
      checks: sessions.reduce((sum, session) => sum + session.tasks.reduce((n, task) => n + task.checks.length, 0), 0),
      dependents: bucketCounts(sessions),
      devDependents: bucketCounts(sessions.filter((session) => dev.has(session.id))),
      minSessionTokens: Math.min(...sizes.map((size) => size.total)),
      minSpanTokens: Math.min(...spans.map((span) => span.tokens)),
      minSpanTasks: Math.min(...spans.map((span) => span.tasks)),
      maxTaskTokens: Math.max(...sizes.map((size) => size.maxTaskTokens)),
      jobArtifactTokens: [
        Math.min(...sizes.map((size) => size.jobArtifactTokens[0])),
        Math.max(...sizes.map((size) => size.jobArtifactTokens[1])),
      ],
      largestOutputTokens: Math.max(...sizes.map((size) => size.largestOutputTokens)),
      worstRequestTokens: Math.max(...sizes.map((size) => size.worstRequest.tokens)),
      maxScopeBytes: Math.max(...sessions.flatMap((session) => session.phases.map((phase) => Buffer.byteLength(phase.scope)))),
    },
    idsHash: idsHash(abilities),
    abilities,
  };
}

export const serializePartitionFile = (file = partitionFile()) => `${JSON.stringify(file, null, 2)}\n`;

/** The committed partition file; refuses one that no longer regenerates byte for byte (G1). */
export function sessionBenchLongPartitions() {
  const text = readFileSync(PARTITION_FILE, "utf8");
  if (text !== serializePartitionFile())
    throw new Error(
      "SessionBenchLongPartitions: work-outcome-session-bench-long.json no longer regenerates byte for byte (G1: a new version)",
    );
  return JSON.parse(text);
}

export { partitionIds, WINDOW_TOKENS };

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--write")) {
    writeFileSync(PARTITION_FILE, serializePartitionFile());
    console.log("wrote work-outcome-session-bench-long.json");
  } else if (args.includes("--check")) {
    const expected = serializePartitionFile();
    let actual = "";
    try {
      actual = readFileSync(PARTITION_FILE, "utf8");
    } catch {}
    if (actual !== expected) {
      console.error("session-bench-long: work-outcome-session-bench-long.json does not regenerate byte for byte");
      process.exit(1);
    }
    const file = JSON.parse(expected);
    console.log(
      `session-bench-long v${file.version}: ${file.counts.sessions} sessions regenerate byte for byte (idsHash ${file.idsHash.slice(0, 12)})`,
    );
  } else {
    console.error("usage: generate.mjs --check | --write");
    process.exit(2);
  }
}
