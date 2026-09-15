import type {
  Agent,
  AgentConfig,
  AgentRunResult,
  AgentSession,
  JsonObject,
  Message,
  OwnershipScope,
  SecretRedactor,
  ToolDefinition,
  ToolExecutionContext,
  ToolRegistry,
} from "@arnilo/prism";
import { createAgent } from "@arnilo/prism";
import { createTimelineFolder, type ExecutionTimeline, type TimelineFolder } from "../observability/index.js";
import { EvalError } from "./errors.js";
import { HARD_MAX_TRIALS } from "./limits.js";
import { scoreRun } from "./score.js";
import type { EvalManifest, EvaluationRecord, ExperimentTrials, Scorer } from "./types.js";
import { toErrorInfo } from "./util.js";

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
  readonly assertReply?: (text: string, result: AgentRunResult) => void;
}

export interface RunScenarioOptions {
  readonly agent: Agent;
  readonly turns: readonly (string | ScenarioTurn)[];
  readonly scorers?: readonly Scorer[];
  readonly maxTurns?: number;
  readonly redactor?: SecretRedactor;
  readonly ownership?: OwnershipScope;
  readonly signal?: AbortSignal;
  readonly timeline?: "off" | "metadata" | "redacted_io";
  readonly environment?: unknown;
}

export interface ScenarioResult {
  readonly status: "succeeded" | "failed";
  readonly turnsCompleted: number;
  readonly finalResult?: AgentRunResult;
  readonly timeline?: ExecutionTimeline;
  readonly evaluations: readonly EvaluationRecord[];
  readonly error?: ReturnType<typeof toErrorInfo>;
}

export const DEFAULT_MAX_SCENARIO_TURNS = 8;
export const HARD_MAX_SCENARIO_TURNS = 32;

/** Collect session events until `work` settles, then close the subscriber. No timeout drain. */
export async function collectWhileRunning<T>(
  session: Pick<AgentSession, "subscribe">,
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
 */
export async function runScenario(options: RunScenarioOptions): Promise<ScenarioResult> {
  const maxTurns = Math.min(options.maxTurns ?? DEFAULT_MAX_SCENARIO_TURNS, HARD_MAX_SCENARIO_TURNS);
  const turns = options.turns.slice(0, maxTurns);
  const session = options.agent.createSession();
  const shouldProject = options.timeline && options.timeline !== "off";
  const folder: TimelineFolder | undefined = shouldProject
    ? createTimelineFolder({ content: options.timeline, redactor: options.redactor })
    : undefined;

  let turnsCompleted = 0;
  let lastResult: AgentRunResult | undefined;
  let scenarioError: ReturnType<typeof toErrorInfo> | undefined;

  try {
    await collectWhileRunning(session, folder, async () => {
      for (const turn of turns) {
        options.signal?.throwIfAborted();
        const input = typeof turn === "string" ? turn : turn.user;
        const result = await session.run(input, {
          signal: options.signal,
          ownership: options.ownership,
          redactor: options.redactor,
        });
        lastResult = result;
        turnsCompleted++;
        if (typeof turn === "object" && turn.assertReply) {
          turn.assertReply(result.text, result);
        }
      }
    });
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

// ─── Controlled Failure Injection (R-E12) ─────────────────────────────────────

export interface FailureInjectionOptions {
  readonly failStore?: boolean;
  readonly denyTools?: readonly string[];
  readonly unknownEffect?: boolean;
}

function mutatingEffect(tool: ToolDefinition, args: JsonObject, ctx: ToolExecutionContext): boolean {
  if (!tool.effect) return false;
  try {
    const decl = typeof tool.effect === "function" ? tool.effect(args, ctx) : tool.effect;
    return decl.kind === "local_mutation" || decl.kind === "external_mutation";
  } catch {
    return true;
  }
}

function wrapTool(tool: ToolDefinition, deny: ReadonlySet<string>, unknownEffect: boolean): ToolDefinition {
  if (!deny.has(tool.name) && !unknownEffect) return tool;
  return {
    ...tool,
    execute(args, ctx) {
      if (deny.has(tool.name)) {
        return {
          toolCallId: ctx.toolCallId,
          name: tool.name,
          content: [{ type: "text", text: "injected tool denial" }],
          error: { message: "injected tool denial", code: "ERR_PRISM_EVAL_TOOL_DENIED" },
        };
      }
      if (unknownEffect && mutatingEffect(tool, args, ctx)) {
        return {
          toolCallId: ctx.toolCallId,
          name: tool.name,
          error: {
            message: "tool effect outcome requires reconciliation",
            code: "ERR_PRISM_TOOL_EFFECT_UNKNOWN",
          },
        };
      }
      return tool.execute(args, ctx);
    },
  };
}

function wrapTools(tools: AgentConfig["tools"], deny: ReadonlySet<string>, unknownEffect: boolean): AgentConfig["tools"] {
  if (!tools || (!deny.size && !unknownEffect)) return tools;
  if (Array.isArray(tools)) return tools.map((tool) => wrapTool(tool, deny, unknownEffect));
  const registry = tools as ToolRegistry;
  return {
    register(tool) {
      registry.register(wrapTool(tool, deny, unknownEffect));
    },
    get(name) {
      const found = registry.get(name);
      return found ? wrapTool(found, deny, unknownEffect) : undefined;
    },
    resolve(name) {
      return wrapTool(registry.resolve(name), deny, unknownEffect);
    },
    list() {
      return registry.list().map((tool) => wrapTool(tool, deny, unknownEffect));
    },
  };
}

function failStoreRun(session: AgentSession): AgentSession {
  return new Proxy(session, {
    get(target, prop, receiver) {
      if (prop === "run") {
        return async () => {
          throw new EvalError("injected store failure", "ERR_PRISM_EVAL_STORE_FAILURE");
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as (...args: never[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * Session wrapper with synthetic failure injection. Does not mutate production stores.
 * `failStore` fails on `run` (createSession succeeds). `denyTools` skip host execute and
 * return a denied error. `unknownEffect` skips mutating execute and returns unknown — never success.
 */
export function wrapAgentWithFailureInjection(agent: Agent, injection: FailureInjectionOptions): Agent {
  const deny = new Set(injection.denyTools ?? []);
  const config: AgentConfig = {
    ...agent.config,
    tools: wrapTools(agent.config.tools, deny, injection.unknownEffect === true),
  };
  const base: Agent = agent.config.model ? createAgent(config) : { ...agent, config };
  return {
    ...base,
    config,
    createSession(sessionConfig) {
      const session = base.createSession(sessionConfig);
      return injection.failStore ? failStoreRun(session) : session;
    },
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
