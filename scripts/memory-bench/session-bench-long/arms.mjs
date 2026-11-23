/**
 * Plan 218.5 Task 5: the long bench's arms. Every arm shares Session-Bench v3's model, sampling, tools, system prompt,
 * scope message, window and limits (G6, `../session-bench/run.mjs` `sharedConfig`); only `memory` differs. v3's own arms
 * (`../session-bench/arms/prism.mjs`) are imported, never edited: `memory-off-llm`, `mem0` and `amnesic` are v3's.
 *
 * The systems under test live here and in `run.mjs`, never in the benchmark's core files (G2). A memory package is
 * imported lazily, inside `longArmPackages`.
 *
 * Plan 218.5 Task 6 freezes these configs into the rule (`live.mjs` `SESSION_BENCH_LONG_RULE`, which pins each arm's
 * config hash); the owner's approval of the rule's hash confirms `WM_TRIGGER_TOKENS` and the arm list.
 */
import {
  configHash,
  keepRecentTokens,
  thirdPartyContextPackage,
  armMemoryConfig as v3ArmMemoryConfig,
} from "../session-bench/arms/prism.mjs";
import { dependencyEvidence } from "./agents.mjs";

/** The decision arms (plan 218.5 Task 6): the verdict reads these only. */
export const LONG_DECISION_ARMS = Object.freeze(["memory-off-llm", "STM-only", "STM-only-protect", "STM+WM", "STM+WM-deterministic"]);
/** The side arm the owner kept (Task 2): reported beside the decision arms, never read by the verdict. */
export const LONG_SIDE_ARMS = Object.freeze(["mem0"]);
/** The benchmark's own instruments: the floor and the ceiling. They differ from the decision arms by design. */
export const LONG_CALIBRATION_ARMS = Object.freeze(["amnesic", "oracle-notes"]);
export const LONG_ARMS = Object.freeze([...LONG_DECISION_ARMS, ...LONG_SIDE_ARMS, ...LONG_CALIBRATION_ARMS]);
/** The arms that run on session memory, and so have a ledger to instrument. */
export const MEMORY_SYSTEM_ARMS = Object.freeze(["STM-only", "STM-only-protect", "STM+WM", "STM+WM-deterministic"]);
/** The arms that set a scope through `memory:scope`, so WM runs. */
export const WM_ARMS = Object.freeze(["STM+WM", "STM+WM-deterministic"]);

/**
 * `wm.triggerTokens` for both WM arms, frozen in Task 6's rule as recommended (plan 218.5 Task 3 finding 1). At the product default (10,000) WM's first pass comes at about task 89, after the pool has
 * overflowed at about task 53; at 3,000 (one `wm.batchTokens` batch per pass) it comes at about task 27.
 */
export const WM_TRIGGER_TOKENS = 3_000;

/**
 * The 0.14.0 defaults plus the arm's eviction order; a WM arm turns WM on (`wm: {}` is off by default since 0.14.0).
 * Rehearsal is not configured: the memory system turns it on only when `wm` and `ltm` both are, and no arm turns
 * `ltm` on, so no arm runs the Rehearsal drop (plan 218.5 Task 5 finding).
 */
const memorySystemConfig = ({ eviction, wm }) => ({
  enabled: true,
  stm: { model: "$worker" },
  ...(wm ? { wm: { model: "$worker", ...wm } } : {}),
  context: { eviction },
});

/**
 * The memory part of a long arm's configuration (data only; `longArmPackages` turns it into packages).
 * - `memory-off-llm`, `mem0`, `amnesic`: v3's.
 * - `STM-only`: the memory system at the 0.14.0 defaults with Task 1's fixes (WM off), `context.eviction: "relevance"`.
 * - `STM-only-protect`: the same with `"protect-user"` (Task 3's candidate order).
 * - `STM+WM`: the same as `STM-only`, with each phase's scope set through `memory:scope`, so WM runs on its model policy.
 * - `STM+WM-deterministic`: the same with `wm.policy: "deterministic"` (no WM model call).
 * - `oracle-notes`: `memory-off-llm` plus a harness block, before each task, of every dependency's current evidence
 *   ({@link oracleNotes}). It replaces v3's `oracle-context`: no window holds a 100-task session.
 */
export function longArmMemoryConfig(arm) {
  switch (arm) {
    case "memory-off-llm":
    case "mem0":
    case "amnesic":
      return v3ArmMemoryConfig(arm);
    case "STM-only":
      return {
        package: "@arnilo/prism-memory-system",
        config: memorySystemConfig({ eviction: "relevance" }),
        setScope: false,
        freshSessionPerTask: false,
      };
    case "STM-only-protect":
      return { ...longArmMemoryConfig("STM-only"), config: memorySystemConfig({ eviction: "protect-user" }) };
    case "STM+WM":
      return {
        ...longArmMemoryConfig("STM-only"),
        config: memorySystemConfig({ eviction: "relevance", wm: { policy: "model", triggerTokens: WM_TRIGGER_TOKENS } }),
        setScope: true,
      };
    case "STM+WM-deterministic":
      return {
        ...longArmMemoryConfig("STM-only"),
        config: memorySystemConfig({ eviction: "relevance", wm: { policy: "deterministic", triggerTokens: WM_TRIGGER_TOKENS } }),
        setScope: true,
      };
    case "oracle-notes":
      return { ...v3ArmMemoryConfig("memory-off-llm"), oracleNotes: true };
    default:
      throw new Error(`SessionBenchLongArms: unknown arm ${arm}`);
  }
}

/** One arm's whole configuration: the shared part and its memory (G6 compares `configHash(shared)`). */
export function longArmConfig(arm, shared) {
  return { arm, shared, memory: longArmMemoryConfig(arm) };
}

/** G6 over the long arms: every arm but the calibration ones shares every field but `memory`. Returns the shared hash. */
export function assertLongEqualTreatment(configs) {
  const decision = configs.filter((row) => !LONG_CALIBRATION_ARMS.includes(row.arm));
  if (!decision.length) return null;
  const want = configHash(decision[0].shared);
  for (const row of decision)
    if (configHash(row.shared) !== want)
      throw new Error(`SessionBenchLongArms: arm ${row.arm} differs from ${decision[0].arm} outside its memory config (G6)`);
  return want;
}

const withRun = (value, { worker, keep }) =>
  JSON.parse(JSON.stringify(value), (_key, field) => (field === "$worker" ? worker : field === "$keep" ? keep : field));

/** The arm's packages. A memory package is imported lazily, so nothing in the core loads one. */
export async function longArmPackages(arm, { workerModel, inputCap, state }) {
  const memory = longArmMemoryConfig(arm);
  if (!memory.package) return [];
  const config = withRun(memory.config, { worker: workerModel, keep: keepRecentTokens(inputCap) });
  if (memory.package === "@arnilo/prism-extensions/compaction") {
    const { default: compaction } = await import("@arnilo/prism-extensions/compaction");
    return [compaction(config), ...(memory.thirdParty || memory.oracleNotes ? [thirdPartyContextPackage(state)] : [])];
  }
  const { default: memorySystem } = await import("@arnilo/prism-memory-system");
  return [memorySystem(config)];
}

/**
 * `oracle-notes`' block before task `n`: for each dependency story (`group`), the notes of the row whose newest source
 * comes latest before `n`, so a changed value shows its current form only. A note is the closing line a source task's
 * oracle reports; a dependency whose evidence no note carries (none today) gets its bare evidence string. Returns null
 * before the first source.
 */
export function oracleNotes(session, n) {
  const latest = new Map();
  for (const dep of session.deps) {
    const newest = Math.max(...dep.sources);
    if (newest >= n) continue;
    const seen = latest.get(dep.group);
    if (!seen || newest > Math.max(...seen.sources)) latest.set(dep.group, dep);
  }
  const lines = [];
  for (const dep of latest.values())
    for (const evidence of dependencyEvidence(dep)) {
      const notes = dep.sources
        .flatMap((source) => session.tasks[source - 1].notes)
        .map((note) => (typeof note === "string" ? note : note.known))
        .filter((note) => note.includes(evidence));
      for (const line of notes.length ? notes : [evidence]) if (!lines.includes(line)) lines.push(line);
    }
  return lines.length ? ["Notes from earlier in this session (each is current):", ...lines.map((line) => `- ${line}`)].join("\n") : null;
}
