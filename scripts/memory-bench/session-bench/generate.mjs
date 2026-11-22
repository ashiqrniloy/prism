/**
 * Plan 218.3 Task 9: Session-Bench's generator and frozen partitions.
 *
 *   timeout 600 bun scripts/memory-bench/session-bench/generate.mjs --check   # regenerate and compare byte for byte
 *   timeout 600 bun scripts/memory-bench/session-bench/generate.mjs --write   # a new benchmark version only (G1)
 *
 * Sessions are a pure function of `SESSION_BENCH_SEED` and their id; they are rebuilt on demand, never committed. The
 * partition file `../work-outcome-session-bench.json` pins the seed, the hash of every source file that defines the
 * benchmark (`templateHash`), the hash of every generated session and of every scope, the label-blind three-way draw
 * and its `idsHash`. Any change to a pinned file is a new benchmark version and voids earlier evidence (G1).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { runScripted } from "./agents.mjs";
import { buildSession, estimateTokens, FAMILIES, MIN_TASK_GAP } from "./templates/build.mjs";

export const SESSION_BENCH_VERSION = 3;
export const SESSION_BENCH_SEED = "prism-218.3-session-bench-v1";
export const SESSIONS_PER_FAMILY = 20;
/** Sessions per partition and family: [dev, heldout-a, heldout-b]. */
export const SESSION_BENCH_STRATA = Object.freeze([12, 4, 4]);
export const PARTITIONS = Object.freeze(["dev", "heldout-a", "heldout-b"]);
/** The simulated model window W every arm shares (tokens), and the sensitivity window. */
export const WINDOW_TOKENS = 32_000;
export const SENSITIVITY_WINDOW_TOKENS = 64_000;
/** A session holds at least this many windows of context; a dependency spans at least this many. */
export const MIN_SESSION_WINDOWS = 4;
export const MIN_SPAN_WINDOWS = 1.5;

export const PARTITION_FILE = new URL("../work-outcome-session-bench.json", import.meta.url);
/** The files that define the benchmark (G1, G2): their bytes make `templateHash`. */
export const CORE_FILES = Object.freeze([
  "env/workspace.mjs",
  "templates/families.mjs",
  "templates/build.mjs",
  "checks.mjs",
  "agents.mjs",
  "generate.mjs",
  "score.mjs",
]);

const sha = (text) => createHash("sha256").update(text).digest("hex");

export function templateHash() {
  return sha(CORE_FILES.map((file) => `${file}\n${sha(readFileSync(new URL(file, import.meta.url)))}`).join("\n"));
}

export const sessionBenchIds = () =>
  FAMILIES.flatMap((family) => Array.from({ length: SESSIONS_PER_FAMILY }, (_, i) => `sb-${family.short}-${String(i).padStart(2, "0")}`));

const familyOf = (id) => {
  const family = FAMILIES.find((row) => id.startsWith(`sb-${row.short}-`));
  if (!family) throw new Error(`SessionBenchGenerate: no family for ${id}`);
  return family;
};

/** Build one session by id; throws when it breaks a size rule (the generator never ships a session that does). */
export function createSession(id, { verify = true } = {}) {
  const family = familyOf(id);
  const session = buildSession(family, Number(id.slice(-2)), SESSION_BENCH_SEED);
  if (verify) sessionSizes(session);
  return session;
}

/**
 * The size rules, read from the oracle's trace: the whole session holds at least `MIN_SESSION_WINDOWS` × W, and every
 * dependency's last source and its dependent are at least `MIN_TASK_GAP` whole tasks and `MIN_SPAN_WINDOWS` × W apart.
 */
export function sessionSizes(session, window = WINDOW_TOKENS) {
  const { trace } = runScripted(session, "oracle");
  const total = trace.reduce((sum, row) => sum + row.tokens, 0);
  if (total < MIN_SESSION_WINDOWS * window)
    throw new Error(`SessionBenchGenerate: ${session.id} holds ${total} tokens, under ${MIN_SESSION_WINDOWS} windows`);
  const spans = session.deps.map((dep) => {
    const from = Math.max(...dep.sources);
    const between = trace.filter((row) => row.task > from && row.task < dep.dependent);
    const tokens = between.reduce((sum, row) => sum + row.tokens, 0);
    if (between.length < MIN_TASK_GAP || tokens < MIN_SPAN_WINDOWS * window)
      throw new Error(`SessionBenchGenerate: ${session.id} ${dep.id} spans ${between.length} tasks and ${tokens} tokens`);
    return { dep: dep.id, class: dep.class, tasks: between.length, tokens };
  });
  return { total, spans, maxTaskTokens: Math.max(...trace.map((row) => row.tokens)) };
}

/** Label-blind draw: inside each family, ids ordered by SHA-256(seed + ":" + id), sliced by the strata. */
export function drawPartitions(ids = sessionBenchIds()) {
  const abilities = Object.fromEntries(PARTITIONS.map((partition) => [partition, {}]));
  for (const family of FAMILIES) {
    const own = ids.filter((id) => id.startsWith(`sb-${family.short}-`));
    const needed = SESSION_BENCH_STRATA.reduce((sum, size) => sum + size, 0);
    if (own.length < needed) throw new Error(`SessionBenchGenerate: ${family.id} has ${own.length} of ${needed} sessions`);
    const ordered = [...own].sort((a, b) => sha(`${SESSION_BENCH_SEED}:${a}`).localeCompare(sha(`${SESSION_BENCH_SEED}:${b}`)));
    let start = 0;
    PARTITIONS.forEach((partition, i) => {
      abilities[partition][family.id] = ordered.slice(start, start + SESSION_BENCH_STRATA[i]);
      start += SESSION_BENCH_STRATA[i];
    });
  }
  return abilities;
}

/** sha256 of the canonical partition map (partition → family → ids). */
export function idsHash(abilities) {
  return sha(
    JSON.stringify(
      Object.fromEntries(
        PARTITIONS.map((partition) => [
          partition,
          Object.fromEntries(
            Object.keys(abilities[partition] ?? {})
              .sort()
              .map((family) => [family, [...abilities[partition][family]]]),
          ),
        ]),
      ),
    ),
  );
}

const sessionHash = (session) => sha(JSON.stringify(session));

/** The frozen partition file: pins, the draw and counts only (no session text). */
export function partitionFile() {
  const ids = sessionBenchIds();
  const sessions = ids.map((id) => createSession(id));
  const abilities = drawPartitions(ids);
  const classes = {};
  for (const session of sessions) for (const dep of session.deps) classes[dep.class] = (classes[dep.class] ?? 0) + 1;
  const sizes = sessions.map((session) => sessionSizes(session));
  return {
    benchmark: "session-bench",
    version: SESSION_BENCH_VERSION,
    plan: "218.3",
    task: 9,
    seed: SESSION_BENCH_SEED,
    source: "scripts/memory-bench/session-bench (project-owned synthetic generator); sessions rebuild from the seed, ids and hashes only",
    draw: `SHA-256("${SESSION_BENCH_SEED}:" + id), ascending inside each family; strata [dev, heldout-a, heldout-b]`,
    strata: Object.fromEntries(FAMILIES.map((family) => [family.id, [...SESSION_BENCH_STRATA]])),
    part: "dev | heldout-a | heldout-b; product tuning and plan 218.3's screen read dev only; heldout-a and heldout-b stay unread until the memory model's gate A",
    window: {
      tokens: WINDOW_TOKENS,
      sensitivityTokens: SENSITIVITY_WINDOW_TOKENS,
      minSessionWindows: MIN_SESSION_WINDOWS,
      minSpanWindows: MIN_SPAN_WINDOWS,
      minTaskGap: MIN_TASK_GAP,
    },
    templateHash: templateHash(),
    coreFiles: [...CORE_FILES],
    sessionsHash: sha(sessions.map(sessionHash).join("\n")),
    scopesHash: sha(sessions.map((session) => sha(session.scope)).join("\n")),
    counts: {
      sessions: sessions.length,
      tasks: sessions.reduce((sum, session) => sum + session.tasks.length, 0),
      checks: sessions.reduce((sum, session) => sum + session.tasks.reduce((n, task) => n + task.checks.length, 0), 0),
      dependencies: classes,
      minSessionTokens: Math.min(...sizes.map((size) => size.total)),
      minSpanTokens: Math.min(...sizes.flatMap((size) => size.spans.map((span) => span.tokens))),
      maxTaskTokens: Math.max(...sizes.map((size) => size.maxTaskTokens)),
    },
    idsHash: idsHash(abilities),
    abilities,
  };
}

export const serializePartitionFile = (file = partitionFile()) => `${JSON.stringify(file, null, 2)}\n`;

/** The committed partition file; refuses one that no longer regenerates byte for byte (G1). */
export function sessionBenchPartitions() {
  const text = readFileSync(PARTITION_FILE, "utf8");
  if (text !== serializePartitionFile())
    throw new Error("SessionBenchPartitions: work-outcome-session-bench.json no longer regenerates byte for byte (G1: a new version)");
  return JSON.parse(text);
}

/** Session ids of one partition, family order then draw order. */
export function partitionIds(file, partition) {
  const map = file.abilities[partition];
  if (!map) throw new Error(`SessionBenchGenerate: no partition ${partition}`);
  return FAMILIES.flatMap((family) => map[family.id] ?? []);
}

export { estimateTokens };

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--write")) {
    writeFileSync(PARTITION_FILE, serializePartitionFile());
    console.log("wrote work-outcome-session-bench.json");
  } else if (args.includes("--check")) {
    const expected = serializePartitionFile();
    let actual = "";
    try {
      actual = readFileSync(PARTITION_FILE, "utf8");
    } catch {}
    if (actual !== expected) {
      console.error("session-bench: work-outcome-session-bench.json does not regenerate byte for byte");
      process.exit(1);
    }
    const file = JSON.parse(expected);
    console.log(
      `session-bench v${file.version}: ${file.counts.sessions} sessions regenerate byte for byte (idsHash ${file.idsHash.slice(0, 12)})`,
    );
  } else {
    console.error("usage: generate.mjs --check | --write");
    process.exit(2);
  }
}
