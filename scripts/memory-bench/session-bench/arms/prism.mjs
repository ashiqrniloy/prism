/**
 * Plan 218.3 Tasks 9-10: Session-Bench's arms. The Prism decision arms and the calibration arms are here; the
 * reference compactors are in `references.mjs` and the third-party memory systems in `third-party.mjs`, and this file
 * gives every arm its configuration. The systems under test live in `arms/` and `run.mjs`, never in the benchmark's
 * core files (G2: `generate.mjs`, `templates/`, `env/`, `checks.mjs`, `agents.mjs` and `score.mjs` import nothing from
 * `packages/memory/**`).
 *
 * Every arm shares the model, sampling, workspace tools, system prompt, scope message, window and limits (G6); only
 * `memory` differs, and `armConfig` returns the whole configuration so `run.mjs` can hash and compare it.
 */
import { createHash } from "node:crypto";
import { createDefaultCompactor, definePackage } from "@arnilo/prism";
import { REFERENCE_ARMS, REFERENCE_PROMPTS, referencePrompt } from "./references.mjs";
import { MEM0_ARM_CONFIG, THIRD_PARTY_ARMS } from "./third-party.mjs";

/** The decision arms (plan 218.3 Task 10), all at the package defaults after Tasks 2-8. */
export const PRISM_ARMS = Object.freeze(["memory-off-llm", "STM-only", "STM+WM"]);
/** The benchmark's own instruments: the ceiling and the floor. They differ from the decision arms by design. */
export const CALIBRATION_ARMS = Object.freeze(["oracle-context", "amnesic"]);
/**
 * The reported side arms (plan 218.3 Task 10): the reference compactors and the included third-party systems. Each runs
 * on `memory-off-llm`'s compaction and differs from it in one named part; Task 12 reports them beside the decision arms.
 */
/**
 * The no-memory baseline (owner, 2026-11-20: "no compacted summary or STM or WM"): one continuous session like
 * memory-off-llm, but a compaction drops the old messages and keeps nothing of them. Unlike `amnesic` (a fresh session
 * per task), the turns still in the window stay.
 */
export const NO_MEMORY_ARMS = Object.freeze(["memory-off-drop"]);
export const SIDE_ARMS = Object.freeze([...REFERENCE_ARMS, ...THIRD_PARTY_ARMS, ...NO_MEMORY_ARMS]);
export const SESSION_BENCH_ARMS = Object.freeze([...PRISM_ARMS, ...SIDE_ARMS, ...CALIBRATION_ARMS]);
export { REFERENCE_ARMS, THIRD_PARTY_ARMS };
/** The calibration ceiling's window: large enough that no session compacts. */
export const ORACLE_CONTEXT_WINDOW = 1_000_000;

/**
 * The memory part of an arm's configuration (data only; `armPackages` turns it into packages).
 * - `memory-off-llm`: the memory system is not listed; `@arnilo/prism-extensions/compaction` (Prism's LLM-driven
 *   compaction) holds the slot at its default trigger (the kernel's, 80% of the input cap). Its kept tail is matched to
 *   session memory's default rule (`keepRecentTokens` = 20% of the input cap) instead of the package's absolute 20,000:
 *   at W = 32K a 20,000-token tail plus one large tool output never fits, so every run after the first overflowed
 *   (Task 9 finding). Matching the keep budget leaves the arms differing in how they compact, not in how much they keep.
 * - `STM-only`: the memory system at its defaults; no scope is set, so WM does not run (plan 218.3 Task 1 decision 4).
 * - `STM+WM`: the same memory system config; the scope is set through `memory:scope`, so WM runs on its model policy.
 * - `claude-code-prompt`, `codex-prompt` (references): `memory-off-llm` with the package's `summaryPrompt` replaced by
 *   the production prompt (`references.mjs`; the config carries the text's sha256, the package gets the text).
 * - `mem0` (third party): `memory-off-llm`'s compaction plus Mem0 at its documented defaults in its documented pattern
 *   (`third-party.mjs`); `thirdParty` records what is Mem0's default and what the harness sets.
 * - `memory-off-drop` (no memory): `memory-off-llm`'s trigger and kept tail, but the compaction writes no summary: the
 *   dropped messages are replaced by one fixed line ({@link DROPPED_CONTEXT_LINE}; the kernel needs a non-empty summary
 *   to apply a compaction), no model call, no STM, no WM.
 * - `oracle-context`: no compaction package, a window no session reaches.
 * - `amnesic`: no compaction package; each task in a fresh session holding the scope message only.
 */
export function armMemoryConfig(arm) {
  switch (arm) {
    case "memory-off-llm":
      return {
        package: "@arnilo/prism-extensions/compaction",
        config: { model: "$worker", keepRecentTokens: "$keep" },
        setScope: false,
        freshSessionPerTask: false,
      };
    case "STM-only":
      return {
        package: "@arnilo/prism-memory-system",
        config: { enabled: true, stm: { model: "$worker" }, wm: { model: "$worker" } },
        setScope: false,
        freshSessionPerTask: false,
      };
    case "STM+WM":
      return {
        package: "@arnilo/prism-memory-system",
        config: { enabled: true, stm: { model: "$worker" }, wm: { model: "$worker" } },
        setScope: true,
        freshSessionPerTask: false,
      };
    case "claude-code-prompt":
    case "codex-prompt":
      return {
        ...armMemoryConfig("memory-off-llm"),
        config: {
          model: "$worker",
          keepRecentTokens: "$keep",
          summaryPrompt: { reference: arm, sha256: REFERENCE_PROMPTS[arm].sha256 },
        },
      };
    case "mem0":
      return { ...armMemoryConfig("memory-off-llm"), thirdParty: MEM0_ARM_CONFIG };
    case "memory-off-drop":
      return {
        package: "session-bench/drop-compaction",
        config: { keepRecentTokens: "$keep", line: DROPPED_CONTEXT_LINE },
        setScope: false,
        freshSessionPerTask: false,
      };
    case "oracle-context":
      return { package: null, config: {}, setScope: false, freshSessionPerTask: false, window: ORACLE_CONTEXT_WINDOW };
    case "amnesic":
      return { package: null, config: {}, setScope: false, freshSessionPerTask: true };
    default:
      throw new Error(`SessionBenchArms: unknown arm ${arm}`);
  }
}

/** The whole "summary" of a `memory-off-drop` compaction: says that messages left, never what they held. */
export const DROPPED_CONTEXT_LINE = "Earlier messages of this session were removed to fit the context window. Nothing of them was kept.";

/**
 * `memory-off-drop`'s compaction: the kernel default's cut (`keepRecentTokens`, a tool result never split from its
 * call), with the fixed line in place of the summary.
 */
export const dropCompactionPackage = ({ keepRecentTokens, line }) =>
  definePackage({
    name: "session-bench-drop-compaction",
    version: "0.0.0",
    requires: { api: 2 },
    capabilities: ["slot:compaction"],
    setup(prism) {
      const cut = createDefaultCompactor({ name: "drop", keepRecentTokens });
      prism.slots.compaction.provide({
        name: "drop",
        async compact(context) {
          const result = await cut.compact(context);
          return {
            summary: line,
            entries: (result.entries ?? []).map((entry) => (entry.kind === "compaction" ? { ...entry, summary: line } : entry)),
          };
        },
      });
    },
  });

/** Session memory's default kept tail: 20% of the input cap (`context.keepRecentTokens`). */
export const KEEP_RECENT_SHARE = 0.2;
export const keepRecentTokens = (inputCap) => Math.floor(inputCap * KEEP_RECENT_SHARE);

/** Fill the placeholders: `$worker` (the run's worker model; the answer model itself, live) and `$keep`. */
const withRun = (value, { worker, keep }) =>
  JSON.parse(JSON.stringify(value), (_key, field) => (field === "$worker" ? worker : field === "$keep" ? keep : field));

/**
 * A third-party arm's retrieval, as one context block for the current task's loop. `state.memoryBlock` is set by the
 * harness before each task and stays fixed through that task's turns, so the block never changes inside a loop.
 */
export const thirdPartyContextPackage = (state) =>
  definePackage({
    name: "session-bench-third-party-context",
    version: "0.0.0",
    requires: { api: 2 },
    setup(prism) {
      prism.hooks.on("context.build", (draft) =>
        state.memoryBlock
          ? {
              ...draft,
              context: [...(draft.context ?? []), { id: "session-bench-third-party", title: "Memory", content: state.memoryBlock }],
            }
          : undefined,
      );
    },
  });

/** The arm's packages. Imported lazily, so the core never loads a memory package. */
export async function armPackages(arm, { workerModel, inputCap, state }) {
  const memory = armMemoryConfig(arm);
  if (!memory.package) return [];
  const config = withRun(memory.config, { worker: workerModel, keep: keepRecentTokens(inputCap) });
  if (memory.package === "session-bench/drop-compaction") return [dropCompactionPackage(config)];
  if (memory.package === "@arnilo/prism-extensions/compaction") {
    const { default: compaction } = await import("@arnilo/prism-extensions/compaction");
    if (config.summaryPrompt) config.summaryPrompt = referencePrompt(config.summaryPrompt.reference);
    return [compaction(config), ...(memory.thirdParty ? [thirdPartyContextPackage(state)] : [])];
  }
  const { default: memorySystem } = await import("@arnilo/prism-memory-system");
  return [memorySystem(config)];
}

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
export const configHash = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

/**
 * One arm's whole configuration: the shared part (`shared`) and its memory. G6 compares `configHash(shared)` across the
 * decision arms; `configHash(config)` is the per-arm hash the gate record carries.
 */
export function armConfig(arm, shared) {
  const memory = armMemoryConfig(arm);
  const effective = memory.window ? { ...shared, window: memory.window } : shared;
  return { arm, shared: effective, memory };
}

/**
 * G6: the decision arms and the side arms (references, third-party systems) share every field but `memory`. Returns the shared
 * hash; throws naming the arm and the field that differs.
 */
export function assertEqualTreatment(configs) {
  const decision = configs.filter((row) => !CALIBRATION_ARMS.includes(row.arm));
  if (!decision.length) return null;
  const [first] = decision;
  const want = configHash(first.shared);
  for (const row of decision) {
    if (configHash(row.shared) === want) continue;
    const fields = [...new Set([...Object.keys(first.shared), ...Object.keys(row.shared)])].filter(
      (key) => configHash(first.shared[key] ?? null) !== configHash(row.shared[key] ?? null),
    );
    throw new Error(`SessionBenchArms: arm ${row.arm} differs from ${first.arm} outside its memory config (${fields.join(", ")}) (G6)`);
  }
  return want;
}
