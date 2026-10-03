import type {
  Agent,
  AgentEvent,
  AgentEventType,
  RunResult,
  Session,
  AIProvider,
  AroundHookName,
  CheckpointStore,
  CompactionOptions,
  DecideHookName,
  ErrorInfo,
  HostPort,
  HookKind,
  HookContext,
  HookName,
  HookRegistrar,
  JsonObject,
  LoopStrategy,
  ObserveHookName,
  RunLimits,
  RunOptions,
  SessionStore,
  ToolDefinition,
  TransformHookName,
} from "../index.js";
import {
  HOOK_CATALOG,
  createAgent,
  createMemorySessionStore,
  errorToErrorInfo,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "../index.js";

/**
 * Loop conformance (roadmap §2.2), promoted from the plan 144 test helper into `@arnilo/prism/testing`.
 * Takes a {@link LoopStrategy} (or the full options), runs one scripted mock scenario, and reports
 * which catalog hooks fired. It depends only on the public entry point.
 */

export interface LoopConformanceOptions {
  readonly loop?: LoopStrategy;
  /** Extra host hooks, registered after the built-in firing probes. */
  readonly hooks?: (hooks: HookRegistrar) => void;
  readonly tools?: readonly ToolDefinition[];
  readonly provider?: AIProvider;
  readonly input?: string;
  readonly store?: SessionStore;
  readonly limits?: RunLimits;
  readonly compaction?: CompactionOptions;
  readonly host?: HostPort;
  readonly runOptions?: RunOptions;
  readonly runState?: { readonly checkpoints: CheckpointStore; readonly definitionRevision: string };
  readonly sessionId?: string;
  /**
   * Extra observe events emitted through a hook during the run, keyed by type. Covers host-only
   * events (`package.event`) and the retired-loop artifact events that no kernel path emits any more.
   */
  readonly emitEvents?: readonly AgentEventType[];
  /** Skip the auto-registered probes (invariant tests that assert a specific error). */
  readonly probe?: boolean;
}

export interface LoopConformanceResult {
  /** The run's result, unless the run could not start at all. A failed or aborted run is a result. */
  readonly result?: RunResult;
  /** Why the run did not settle cleanly: the failed result's error, or a rejection from `session.run`. */
  readonly error?: ErrorInfo;
  readonly events: readonly AgentEvent[];
  /** Every catalog hook whose handler ran, including observe hooks. */
  readonly fired: ReadonlySet<HookName>;
  /** The agent and session, for tests that inspect entries or resume. Closed but readable. */
  readonly agent: Agent;
  readonly session: Session;
}

/** Two provider turns: one tool call, then a final text answer. Resets per provider instance. */
export function twoTurnProvider(call: { readonly id: string; readonly name: string; readonly args?: JsonObject }): AIProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1) {
        yield { type: "tool_call" as const, call: toolCallContent(call.id, call.name, call.args ?? {}) };
        yield providerDone();
        return;
      }
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
}

/** A single text turn. */
export function textProvider(text = "done"): AIProvider {
  return {
    id: "mock",
    async *generate() {
      yield providerTextDelta(text);
      yield providerDone();
    },
  };
}

/** The default tool set: one `echo` tool that succeeds. */
export function echoTool(onExecute?: () => void): ToolDefinition {
  return {
    name: "echo",
    parameters: {},
    execute: (_args, context) => {
      onExecute?.();
      return { toolCallId: context.toolCallId, name: "echo", value: "echoed" };
    },
  };
}

function registerProbe(hooks: HookRegistrar, name: HookName, kind: HookKind, fired: Set<HookName>): void {
  const record = () => {
    fired.add(name);
  };
  switch (kind) {
    case "observe":
      hooks.on(name as ObserveHookName, (() => record()) as never);
      return;
    case "transform":
      hooks.on(
        name as TransformHookName,
        ((value: unknown) => {
          record();
          return value;
        }) as never,
      );
      return;
    case "decide":
      hooks.on(
        name as DecideHookName,
        (() => {
          record();
          return undefined;
        }) as never,
      );
      return;
    case "around":
      hooks.on(
        name as AroundHookName,
        ((value: unknown, next: (v: unknown) => Promise<unknown>) => {
          record();
          return next(value);
        }) as never,
      );
      return;
  }
}

/**
 * Run one scripted scenario against `loop` (defaulting to the kernel default) and report which hooks
 * fired. All hooks get a firing probe unless `probe: false`, so `fired` is the coverage signal.
 * A bare `LoopStrategy` argument is shorthand for `{ loop }`.
 */
export function loopConformance(strategy: LoopStrategy): Promise<LoopConformanceResult>;
export function loopConformance(options?: LoopConformanceOptions): Promise<LoopConformanceResult>;
export async function loopConformance(input: LoopStrategy | LoopConformanceOptions = {}): Promise<LoopConformanceResult> {
  const options: LoopConformanceOptions = "run" in input ? { loop: input } : input;
  const fired = new Set<HookName>();
  const probe = options.probe ?? true;
  const sessionId = options.sessionId ?? "loop-conformance";
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    provider: options.provider ?? twoTurnProvider({ id: "call-1", name: "echo" }),
    tools: { add: options.tools ?? [echoTool()] },
    slots: {
      store: options.store ?? createMemorySessionStore(),
      ...(options.loop ? { loop: options.loop } : {}),
    },
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.compaction ? { compaction: options.compaction } : {}),
    ...(options.host ? { host: options.host } : {}),
    hooks: (hooks) => {
      if (probe) {
        for (const [name, entry] of Object.entries(HOOK_CATALOG)) registerProbe(hooks, name as HookName, entry.kind, fired);
      }
      options.hooks?.(hooks);
      if (options.emitEvents?.length) {
        // `turn.before` fires on the first turn of every loop, so a synthetic event list reaches the
        // session's observe dispatch path regardless of which loop drives the run.
        const types = options.emitEvents;
        hooks.on("turn.before", ((_payload: unknown, ctx: HookContext) => {
          for (const type of types) ctx.emit({ type, sessionId, runId: "" } as unknown as AgentEvent);
          return undefined;
        }) as never);
      }
    },
  });

  const session = await agent.session({ id: sessionId, create: true });
  const events: AgentEvent[] = [];
  const subscription = session.subscribe({ acrossRuns: true });
  const pump = (async () => {
    for await (const event of subscription) events.push(event);
  })();
  try {
    const runOptions: RunOptions = {
      ...options.runOptions,
      ...(options.runState ? { runState: options.runState } : {}),
    };
    try {
      const result = await session.run(options.input ?? "go", runOptions);
      return { result, ...(result.error ? { error: result.error } : {}), events, fired, agent, session };
    } catch (error) {
      return { error: errorToErrorInfo(error), events, fired, agent, session };
    }
  } finally {
    await session.close();
    await pump.catch(() => {});
  }
}
