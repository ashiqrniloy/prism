import type { EvaluationRecord } from "@arnilo/prism";
import { resolveRedactor } from "@arnilo/prism";
import type { AgentEvent, Agent, AgentConfig, Message, OwnershipScope, RunResult, SecretRedactor, Session, SessionOptions } from "@arnilo/prism";
import { EvalError } from "./errors.js";
import { loadTimeline } from "./timeline.js";
import { checkRequirements, scoreRun, skipScorers } from "./score.js";
import type { EvaluationTelemetrySink, ExecutionTimeline, Scorer, TimelineFolder, ScenarioInput, UserSimulatorSpec, UserSimulation } from "./types.js";
import { requireSimulator, nextSimulatedUser } from "./user-simulator.js";
import { toErrorInfo } from "./util.js";

// ─── Multi-Turn Scenarios (R-E12) ─────────────────────────────────────────────

export interface ScenarioTurn {
  readonly user: string | Message;
  /** Optional assertion verifying intermediate assistant reply. */
  readonly assertReply?: (text: string, result: RunResult) => void;
}

export type AgentFactory = (extra: Pick<AgentConfig, "hooks" | "slots">) => Promise<Agent>;

export interface ScenarioDefinition {
  readonly turns?: readonly (string | ScenarioTurn)[];
  readonly user?: UserSimulatorSpec;
  readonly scorers?: readonly Scorer[];
  /** Session options for the scenario's single session; omitted = agent defaults. Guardrail packs are package config on the agent, not a session option (plan 159 Task 5). */
  readonly sessionConfig?: SessionOptions;
  readonly maxTurns?: number;
  readonly redactor?: SecretRedactor;
  /** Equivalent redaction input when the host has no redactor instance; the entry point resolves both into the scorer seam. */
  readonly secrets?: readonly (string | undefined)[];
  readonly ownership?: OwnershipScope;
  readonly signal?: AbortSignal;
  readonly timeline?: "off" | "metadata" | "redacted_io";
  readonly environment?: unknown;
  readonly telemetry?: EvaluationTelemetrySink;
  /** `"last"` (default) scores the final turn; `"each"` scores every turn with its own timeline slice. */
  readonly scoreTurns?: "last" | "each";
}

export interface RunScenarioOptions extends Partial<ScenarioDefinition> {
  readonly agent: Agent | AgentFactory;
  readonly turns?: readonly (string | ScenarioTurn)[];
  readonly user?: UserSimulatorSpec;
  readonly hooks?: AgentConfig["hooks"];
  readonly slots?: AgentConfig["slots"];
}

export interface ScenarioResult {
  readonly status: "succeeded" | "failed" | "aborted";
  readonly turnsCompleted: number;
  readonly finalResult?: RunResult;
  readonly timeline?: ExecutionTimeline;
  readonly evaluations: readonly EvaluationRecord[];
  readonly error?: ReturnType<typeof toErrorInfo>;
  readonly simulation?: UserSimulation;
}

export const DEFAULT_MAX_SCENARIO_TURNS = 8;
export const HARD_MAX_SCENARIO_TURNS = 32;

/** Collect session events until `work` settles, then close the subscriber. No timeout drain. */
export async function collectWhileRunning<T>(
  session: Pick<Session, "subscribe">,
  folder: TimelineFolder | undefined,
  work: () => Promise<T>,
  onEvent?: (event: AgentEvent) => void,
): Promise<T> {
  if (!folder && !onEvent) return work();
  const iterator = session.subscribe()[Symbol.asyncIterator]();
  const pump = (async () => {
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done || !next.value) break;
        onEvent?.(next.value);
        folder?.push(next.value);
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

  validateScenario(options);
  checkRequirements(options.scorers ?? [], {
    timeline: options.timeline !== undefined && options.timeline !== "off",
    trace: false,
    environment: options.environment !== undefined,
  });
  const agent = typeof options.agent === "function" ? await options.agent({ hooks: options.hooks, slots: options.slots }) : options.agent;
  const session = await agent.session(options.sessionConfig);
  const shouldProject = options.timeline && options.timeline !== "off";
  let folder: TimelineFolder | undefined;
  if (shouldProject) {
    const { createTimelineFolder } = await loadTimeline();
    folder = createTimelineFolder({ content: options.timeline, redactor: options.redactor });
  }

  let simulation: UserSimulation | undefined;
  const deferredTurns: { result: RunResult; timeline?: ExecutionTimeline; turnIndex: number }[] = [];
  let turnsCompleted = 0;
  let lastResult: RunResult | undefined;
  let scenarioError: ReturnType<typeof toErrorInfo> | undefined;
  const perTurn: EvaluationRecord[] = [];
  let scoredSteps = 0;

  const score = async (result: RunResult, turnTimeline: ExecutionTimeline | undefined, turnIndex?: number) =>
    await scoreRun({
      result,
      scorers: options.scorers ?? [],
      telemetry: options.telemetry,
      ownership: options.ownership,
      redactor: options.redactor,
      secrets: options.secrets,
      signal: options.signal,
      timeline: options.timeline ?? "metadata",
      injectedTimeline: turnTimeline,
      environment: options.environment,
      ...(turnIndex === undefined ? {} : { metadata: { turnIndex } }),
    });

  try {
    // One subscription per turn: by default a subscriber is run-scoped and closes when the run settles
    // (`SubscribeOptions.acrossRuns` opts out of that close), so a single default subscription around
    // several runs would silently score a timeline missing every later turn.
    simulation = await executeScenario(options, async input => {
      const result = await collectWhileRunning(session, folder, () =>
        session.run(input, { signal: options.signal, ownership: options.ownership, redactor: options.redactor }));
      lastResult = result;
      turnsCompleted++;
      return result;
    }, async (result, turnIndex) => {
      if (options.scoreTurns === "each") {
        // The folder snapshots cumulatively; score only the steps this turn added.
        const snapshot = folder?.snapshot();
        const stepCount = snapshot?.steps.length ?? 0;
        const slice = snapshot === undefined ? undefined : { ...snapshot, steps: snapshot.steps.slice(scoredSteps) };
        scoredSteps = stepCount;
        if (options.user) deferredTurns.push({ result, timeline: slice, turnIndex });
        else perTurn.push(...(await score(result, slice, turnIndex)));
      }
    });
  } catch (err) {
    scenarioError = toErrorInfo(err);
  }

  const timeline = folder?.snapshot();
  const simulatorFailed = scenarioError?.code === "ERR_PRISM_EVAL_USER_SIMULATOR";
  if (!simulatorFailed) for (const turn of deferredTurns) perTurn.push(...await score(turn.result, turn.timeline, turn.turnIndex));
  const evaluations = simulatorFailed ? await skipScorers({ result: lastResult, scorers: options.scorers ?? [],
    ownership: options.ownership, redactor: options.redactor, secrets: options.secrets, telemetry: options.telemetry }, "ERR_PRISM_EVAL_USER_SIMULATOR") :
    options.scoreTurns === "each" ? perTurn : lastResult && options.scorers?.length ? await score(lastResult, timeline) : [];

  const status =
    options.signal?.aborted || lastResult?.status === "aborted"
      ? "aborted"
      : scenarioError || lastResult?.status === "failed"
        ? "failed"
        : "succeeded";

  return {
    status,
    turnsCompleted,
    finalResult: lastResult,
    timeline,
    evaluations,
    error: scenarioError,
    simulation,
  };
}

/** Validate configuration before constructing an agent or opening a session. */
export function validateScenario(options: { turns?: readonly (string | ScenarioTurn)[]; user?: unknown; maxTurns?: number; scoreTurns?: string }): void {
  if ((options.turns !== undefined) === (options.user !== undefined)) {
    throw new EvalError("scenario requires exactly one of turns or user", "ERR_PRISM_EVAL_SCENARIO_BOUNDS");
  }
  if (options.user !== undefined) {
    requireSimulator(options.user as UserSimulatorSpec);
  }
  if (options.user === undefined && (!Array.isArray(options.turns) || options.turns.some(turn => typeof turn !== "string" &&
    (!turn || typeof turn !== "object" || !(typeof turn.user === "string" || (turn.user && typeof turn.user === "object" && "role" in turn.user)))))) {
    throw new EvalError("scenario turns must contain strings or ScenarioTurn objects", "ERR_PRISM_EVAL_SCENARIO_BOUNDS");
  }
  if (options.scoreTurns !== undefined && options.scoreTurns !== "last" && options.scoreTurns !== "each") {
    throw new EvalError("scoreTurns must be last or each", "ERR_PRISM_EVAL_SCENARIO_BOUNDS");
  }
  const requestedMax = options.maxTurns ?? DEFAULT_MAX_SCENARIO_TURNS;
  // Bound violations are configuration errors: a silently truncated scenario passes for the wrong reason.
  if (!Number.isInteger(requestedMax) || requestedMax < 1 || requestedMax > HARD_MAX_SCENARIO_TURNS) {
    throw new EvalError(`maxTurns must be an integer in [1, ${HARD_MAX_SCENARIO_TURNS}]`, "ERR_PRISM_EVAL_SCENARIO_BOUNDS");
  }
  if (options.turns && options.turns.length > requestedMax) {
    throw new EvalError(`scenario has ${options.turns!.length} turns but maxTurns is ${requestedMax}`, "ERR_PRISM_EVAL_SCENARIO_BOUNDS");
  }
}

export function isScenarioInput(input: unknown): input is ScenarioInput {
  return typeof input === "object" && input !== null && "kind" in input && input.kind === "scenario";
}

/** Internal turn loop shared by standalone scenarios and experiment trials. */
export async function executeScenario(
  options: Pick<ScenarioDefinition, "turns" | "user" | "maxTurns" | "signal" | "redactor" | "secrets">,
  run: (input: string | Message) => Promise<RunResult>,
  onTurn: (result: RunResult, turnIndex: number) => Promise<void>,
): Promise<UserSimulation | undefined> {
  const user = options.user ? requireSimulator(options.user) : undefined;
  const turns: { user: string; assistant: string }[] = [];
  const redactor = resolveRedactor(options.redactor, options.secrets);
  const simulation = (stopReason: UserSimulation["stopReason"]): UserSimulation => ({ turns, stopReason, simulatorModel: user!.simulatorModel });
  const maxTurns = user ? Math.min(user.maxTurns ?? 8, options.maxTurns ?? 32) : options.turns!.length;
  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex++) {
    const turn = user ? await nextSimulatedUser(user, turns, redactor, options.signal) : options.turns![turnIndex]!;
    if (user && turn === user.stop) return simulation("goal_reached");
    options.signal?.throwIfAborted();
    const result = await run(typeof turn === "string" ? turn : turn.user);
    if (typeof turn === "object" && turn.assertReply) {
      try { turn.assertReply(result.text, result); }
      catch (cause) {
        throw new EvalError(`turn ${turnIndex + 1} assertReply failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          "ERR_PRISM_EVAL_SCENARIO_ASSERTION", { cause });
      }
    }
    if (user) {
      const entry = { user: turn as string, assistant: result.text };
      turns.push(redactor ? redactor.redact(entry) : entry);
    }
    await onTurn(result, turnIndex);
    if (result.status !== "completed") return user ? simulation("agent_stopped") : undefined;
  }
  return user ? simulation("max_turns") : undefined;
}
