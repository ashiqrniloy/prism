import type {
  Agent,
  AgentConfig,
  Message,
  OwnershipScope,
  RunResult,
  SecretRedactor,
  Session,
  SessionOptions,
} from "@arnilo/prism";
import type { ExecutionTimeline, TimelineFolder } from "./types.js";
import { EvalError } from "./errors.js";
import { failureInjection, failingStore, type FailureInjectionOptions } from "./failure-injection.js";
import { HARD_MAX_TRIALS } from "./limits.js";
import { scoreRun } from "./score.js";
import type { EvalManifest, EvaluationRecord, ExperimentTrials, Scorer } from "./types.js";
import { toErrorInfo } from "./util.js";

export { failureInjection, failingStore, type FailureInjectionOptions };

// ─── Eval Manifest Validation (R-E12) ─────────────────────────────────────────

/**
 * Validates frozen eval manifest binding runtime and dataset revisions.
 * Fails closed on missing or corrupt required fields.
 */
export function validateEvalManifest(manifest: EvalManifest): void {
  if (!manifest || typeof manifest !== "object") {
    throw new EvalError("eval manifest must be a non-null object", "ERR_PRISM_EVAL_MANIFEST");
  }
  if (typeof manifest.runtimeRevision !== "string" || !manifest.runtimeRevision.trim()) {
    throw new EvalError("eval manifest is missing required runtimeRevision", "ERR_PRISM_EVAL_MANIFEST");
  }
  if (typeof manifest.datasetVersion !== "string" || !manifest.datasetVersion.trim()) {
    throw new EvalError("eval manifest is missing required datasetVersion", "ERR_PRISM_EVAL_MANIFEST");
  }
}

/**
 * Additive release-evidence binding. Requires the two-field manifest plus
 * promptVersion (or promptId+promptVersion), toolFingerprint, model, and policyRevision.
 */
export function validateReleaseEvalManifest(manifest: EvalManifest): void {
  validateEvalManifest(manifest);
  const promptVersion = typeof manifest.promptVersion === "string" ? manifest.promptVersion.trim() : "";
  if (!promptVersion) {
    throw new EvalError("release eval manifest is missing required promptVersion", "ERR_PRISM_EVAL_MANIFEST");
  }
  if (typeof manifest.toolFingerprint !== "string" || !manifest.toolFingerprint.trim()) {
    throw new EvalError("release eval manifest is missing required toolFingerprint", "ERR_PRISM_EVAL_MANIFEST");
  }
  if (typeof manifest.model !== "string" || !manifest.model.trim()) {
    throw new EvalError("release eval manifest is missing required model", "ERR_PRISM_EVAL_MANIFEST");
  }
  if (typeof manifest.policyRevision !== "string" || !manifest.policyRevision.trim()) {
    throw new EvalError("release eval manifest is missing required policyRevision", "ERR_PRISM_EVAL_MANIFEST");
  }
}

// ─── Multi-Turn Scenarios (R-E12) ─────────────────────────────────────────────

export interface ScenarioTurn {
  readonly user: string | Message;
  /** Optional assertion verifying intermediate assistant reply. */
  readonly assertReply?: (text: string, result: RunResult) => void;
}

export type AgentFactory = (extra: Pick<AgentConfig, "hooks" | "slots">) => Promise<Agent>;

export interface ScenarioDefinition {
  readonly turns: readonly (string | ScenarioTurn)[];
  readonly scorers?: readonly Scorer[];
  /** Session options for the scenario's single session; omitted = agent defaults. Guardrail packs are package config on the agent, not a session option (plan 159 Task 5). */
  readonly sessionConfig?: SessionOptions;
  readonly maxTurns?: number;
  readonly redactor?: SecretRedactor;
  readonly ownership?: OwnershipScope;
  readonly signal?: AbortSignal;
  readonly timeline?: "off" | "metadata" | "redacted_io";
  readonly environment?: unknown;
}

export interface RunScenarioOptions extends Partial<ScenarioDefinition> {
  readonly agent: Agent | AgentFactory;
  readonly turns: readonly (string | ScenarioTurn)[];
  readonly hooks?: AgentConfig["hooks"];
  readonly slots?: AgentConfig["slots"];
}

export interface ScenarioResult {
  readonly status: "succeeded" | "failed";
  readonly turnsCompleted: number;
  readonly finalResult?: RunResult;
  readonly timeline?: ExecutionTimeline;
  readonly evaluations: readonly EvaluationRecord[];
  readonly error?: ReturnType<typeof toErrorInfo>;
}

export const DEFAULT_MAX_SCENARIO_TURNS = 8;
export const HARD_MAX_SCENARIO_TURNS = 32;

/** Collect session events until `work` settles, then close the subscriber. No timeout drain. */
export async function collectWhileRunning<T>(
  session: Pick<Session, "subscribe">,
  folder: TimelineFolder | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (!folder) return work();
  const iterator = session.subscribe()[Symbol.asyncIterator]();
  const pump = (async () => {
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done || !next.value) break;
        folder.push(next.value);
      }
    } catch {
      // subscriber closed or run aborted
    }
  })();
  try {
    return await work();
  } finally {
    await iterator.return?.();
    await pump;
  }
}

/**
 * Executes a scripted multi-turn conversational scenario (e.g. clarification, refusal)
 * over a single session, capturing timeline and scoring the last result.
 * Supports passing an agent or an agent factory.
 */
export async function runScenario(
  optionsOrScenario: RunScenarioOptions | ScenarioDefinition,
  maybeFactory?: AgentFactory,
  extraOptions?: { readonly hooks?: AgentConfig["hooks"]; readonly slots?: AgentConfig["slots"] },
): Promise<ScenarioResult> {
  const options: RunScenarioOptions =
    typeof maybeFactory === "function"
      ? {
          ...(optionsOrScenario as ScenarioDefinition),
          agent: maybeFactory,
          hooks: extraOptions?.hooks,
          slots: extraOptions?.slots,
        }
      : (optionsOrScenario as RunScenarioOptions);

  const maxTurns = Math.min(options.maxTurns ?? DEFAULT_MAX_SCENARIO_TURNS, HARD_MAX_SCENARIO_TURNS);
  const turns = options.turns.slice(0, maxTurns);
  const agent =
    typeof options.agent === "function"
      ? await options.agent({ hooks: options.hooks, slots: options.slots })
      : options.agent;
  const session = await agent.session(options.sessionConfig);
  const shouldProject = options.timeline && options.timeline !== "off";
  let folder: TimelineFolder | undefined;
  if (shouldProject) {
    const pkg = "@arnilo/prism-observability";
    const { createTimelineFolder } = (await import(pkg)) as any;
    folder = createTimelineFolder({ content: options.timeline, redactor: options.redactor });
  }

  let turnsCompleted = 0;
  let lastResult: RunResult | undefined;
  let scenarioError: ReturnType<typeof toErrorInfo> | undefined;

  try {
    // One subscription per turn: by default a subscriber is run-scoped and closes when the run settles
    // (`SubscribeOptions.acrossRuns` opts out of that close), so a single default subscription around
    // several runs would silently score a timeline missing every later turn.
    for (const turn of turns) {
      options.signal?.throwIfAborted();
      const input = typeof turn === "string" ? turn : turn.user;
      const result = await collectWhileRunning(session, folder, () =>
        session.run(input, {
          signal: options.signal,
          ownership: options.ownership,
          redactor: options.redactor,
        }),
      );
      lastResult = result;
      turnsCompleted++;
      if (typeof turn === "object" && turn.assertReply) {
        turn.assertReply(result.text, result);
      }
    }
  } catch (err) {
    scenarioError = toErrorInfo(err);
  }

  const timeline = folder?.snapshot();
  const evaluations =
    lastResult && options.scorers?.length
      ? await scoreRun({
          result: lastResult,
          scorers: options.scorers,
          ownership: options.ownership,
          redactor: options.redactor,
          signal: options.signal,
          timeline: options.timeline ?? "metadata",
          injectedTimeline: timeline,
          environment: options.environment,
        })
      : [];

  const status = scenarioError || lastResult?.status === "failed" ? "failed" : "succeeded";

  return {
    status,
    turnsCompleted,
    finalResult: lastResult,
    timeline,
    evaluations,
    error: scenarioError,
  };
}

// ─── Trials Resolution (R-E12) ────────────────────────────────────────────────

/** Seeded RNG in [0, 1). Not a claim of LLM determinism. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function resolveTrialsConfig(trials?: number, seed?: number): Omit<ExperimentTrials, "sampleCount" | "standardError"> {
  const count = trials ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > HARD_MAX_TRIALS) {
    throw new EvalError(`trials must be an integer in [1, ${HARD_MAX_TRIALS}]`, "ERR_PRISM_EVAL_TRIALS");
  }
  if (seed !== undefined && !Number.isInteger(seed)) {
    throw new EvalError("seed must be an integer", "ERR_PRISM_EVAL_TRIALS");
  }
  return {
    count,
    ...(seed !== undefined ? { seed } : {}),
    uncertaintyMethod: count > 1 ? "standard_error" : "single_sample",
  };
}
