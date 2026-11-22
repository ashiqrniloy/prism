import { RAW_EMIT } from "../hooks/emit.js";
import { providerPackage } from "../provider-kit/package.js";
import type {
  Agent,
  AgentEvent,
  AgentEventType,
  RunResult,
  Session,
  ModelProvider,
  AroundHookName,
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
  askEveryTool,
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
  readonly provider?: ModelProvider;
  readonly input?: string;
  readonly store?: SessionStore;
  readonly limits?: RunLimits;
  readonly compaction?: CompactionOptions;
  readonly host?: HostPort;
  readonly runOptions?: RunOptions;
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
export function twoTurnProvider(call: { readonly id: string; readonly name: string; readonly args?: JsonObject }): ModelProvider {
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
export function textProvider(text = "done"): ModelProvider {
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
  const provider = options.provider ?? twoTurnProvider({ id: "call-1", name: "echo" });
  const agent = await createAgent({
    model: { provider: provider.id, model: "demo" },
    packages: [providerPackage("loop-conformance-provider", [provider])],
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
          for (const type of types)
            (ctx as unknown as Record<symbol, (event: AgentEvent) => void>)[RAW_EMIT]!({
              type,
              sessionId,
              runId: "",
            } as unknown as AgentEvent);
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
    try {
      const result = await session.run(options.input ?? "go", options.runOptions ?? {});
      return { result, ...(result.error ? { error: result.error } : {}), events, fired, agent, session };
    } catch (error) {
      return { error: errorToErrorInfo(error), events, fired, agent, session };
    }
  } finally {
    await session.close();
    await pump.catch(() => {});
  }
}

/**
 * Settlement conformance (plan 225 Task 4): every tool call of an assistant message has a result in the
 * branch once its round ends, however the round ends. Runs one scenario on `strategy`: a turn of three
 * calls under `maxToolCalls: 1`, so the round breaches its limit on the second call. Throws, naming the
 * unanswered call ids, when the strategy leaves any call without a result.
 */
export async function assertToolRoundSettlement(strategy: LoopStrategy): Promise<void> {
  const provider: ModelProvider = {
    id: "mock",
    async *generate() {
      for (const id of ["settle-1", "settle-2", "settle-3"]) yield { type: "tool_call" as const, call: toolCallContent(id, "echo", {}) };
      yield providerDone();
    },
  };
  const { session, agent } = await loopConformance({ loop: strategy, provider, probe: false, limits: { maxToolCalls: 1 } });
  const messages = await session.messages();
  await agent.dispose();
  const answered = new Set<string>();
  for (const message of messages) for (const block of message.content) if (block.type === "tool_result") answered.add(block.toolCallId);
  const unanswered: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) if (block.type === "tool_call" && !answered.has(block.id)) unanswered.push(block.id);
  }
  if (unanswered.length > 0) throw new Error(`Loop "${strategy.name}" left tool calls without a result: ${unanswered.join(", ")}`);
}

/**
 * Structured-output repair conformance (plan 235 Task 3): `run.end()` sends an invalid final reply back
 * once, so any loop that calls it gets the repair. Runs one scenario on `strategy`: a model without the
 * structured-output capability (prompted mode) answers prose first, then valid JSON. Throws when the
 * run does not end with the parsed value after exactly two provider requests.
 */
export async function assertStructuredOutputRepair(strategy: LoopStrategy): Promise<void> {
  let requests = 0;
  const provider: ModelProvider = {
    id: "mock",
    async *generate() {
      requests += 1;
      yield providerTextDelta(requests === 1 ? "not json" : '{"ok":true}');
      yield providerDone();
    },
  };
  const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
  const { result, error, agent } = await loopConformance({
    loop: strategy,
    provider,
    probe: false,
    runOptions: { providerOptions: { structuredOutput: { name: "repair_probe", schema } } },
  });
  await agent.dispose();
  if (error) throw new Error(`Loop "${strategy.name}" failed the structured-output repair run: ${error.message}`);
  if (requests !== 2 || JSON.stringify(result?.output) !== '{"ok":true}') {
    throw new Error(
      `Loop "${strategy.name}" did not repair an invalid structured reply through run.end(): ${requests} request(s), output ${JSON.stringify(result?.output)}`,
    );
  }
}

/**
 * Dropped-stream conformance (plan 227 Task 4): a stream that fails transiently after output began is
 * retried, and the failed attempt leaves nothing behind. Runs one scenario on `strategy`: the first
 * attempt streams text, a complete `echo` call and a partial one, then fails with `ECONNRESET`; the
 * second answers "done". Throws when the run does not complete with the second attempt's text, when
 * the failed attempt's tool call ran, or when its text reached the branch.
 */
export async function assertDroppedStreamRecovery(strategy: LoopStrategy): Promise<void> {
  let attempts = 0;
  let executed = 0;
  const provider: ModelProvider = {
    id: "mock",
    async *generate() {
      attempts += 1;
      if (attempts === 1) {
        yield providerTextDelta("dropped-partial");
        yield { type: "tool_call" as const, call: toolCallContent("dropped-1", "echo", {}) };
        yield { type: "tool_call_delta" as const, index: 1, id: "dropped-2", name: "echo", argumentsText: "{" };
        yield {
          type: "error" as const,
          error: { name: "TypeError", message: "socket reset", code: "ECONNRESET", failureClass: "transient" as const },
        };
        return;
      }
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
  const { result, error, session, agent } = await loopConformance({
    loop: strategy,
    provider,
    probe: false,
    tools: [echoTool(() => (executed += 1))],
    runOptions: { retry: { baseDelayMs: 0 } },
  });
  const messages = await session.messages();
  await agent.dispose();
  const failures: string[] = [];
  if (result?.status !== "completed") failures.push(`run ${result?.status ?? "rejected"}: ${error?.message ?? ""}`);
  else if (result.text !== "done") failures.push(`final text is ${JSON.stringify(result.text)}, not the retried attempt's "done"`);
  if (attempts !== 2) failures.push(`${attempts} provider attempts, expected 2`);
  if (executed > 0) failures.push("a tool call from the failed attempt ran");
  if (JSON.stringify(messages).includes("dropped-")) failures.push("the failed attempt's output reached the branch");
  if (failures.length > 0) throw new Error(`Loop "${strategy.name}" did not recover a dropped stream: ${failures.join("; ")}`);
}

/**
 * Concurrent-resume conformance (plan 231 Task 4): one strategy object serves two sessions whose runs suspend
 * on an approval and resume at the same time. Every tool call is gated (`askEveryTool`), the provider answers
 * one `echo` call and then "done". Both first runs must suspend and both resumes must complete. A loop that
 * keeps its state on the strategy object (`snapshot`/`restore` without `state: "run"`) fails here with
 * `ERR_PRISM_LOOP_SHARED_STATE`; a `state: "run"` loop keeps each run's `run.checkpoint` value separate.
 * Returns each session's stored loop state (`suspended_run` entry), keyed by session id, for further checks.
 */
export async function assertConcurrentLoopResume(strategy: LoopStrategy): Promise<Readonly<Record<string, unknown>>> {
  const turns = new Map<string, number>();
  const provider: ModelProvider = {
    id: "mock",
    async *generate(request) {
      const key = JSON.stringify(request.messages.find((message) => message.role === "user")?.content ?? "");
      const turn = (turns.get(key) ?? 0) + 1;
      turns.set(key, turn);
      if (turn === 1) yield { type: "tool_call" as const, call: toolCallContent(`call-${turns.size}`, "echo", {}) };
      else yield providerTextDelta("done");
      yield providerDone();
    },
  };
  const agent = await createAgent({
    model: { provider: provider.id, model: "demo" },
    packages: [providerPackage("loop-conformance-provider", [provider])],
    tools: { add: [echoTool()] },
    slots: { store: createMemorySessionStore(), loop: strategy },
    hooks: askEveryTool(),
  });
  const failures: string[] = [];
  const loopStates: Record<string, unknown> = {};
  try {
    const sessions = await Promise.all(["alpha", "beta"].map((id) => agent.session({ id: `concurrent-${id}`, create: true })));
    const first = await Promise.all(sessions.map((session) => session.run(`go ${session.id}`).catch((error: unknown) => error)));
    first.forEach((result, index) => {
      const status = (result as RunResult).status;
      if (status !== "suspended")
        failures.push(`${sessions[index]?.id} first run ${status ?? errorToErrorInfo(result).message}, expected suspended`);
    });
    if (failures.length === 0) {
      const resumed = await Promise.all(
        sessions.map(async (session, index) => {
          const pending = (first[index] as RunResult).pending ?? [];
          let last: AgentEvent | undefined;
          try {
            for await (const event of session.resume(pending.map((d) => ({ approvalId: d.approvalId, outcome: "allow_once" as const }))))
              last = event;
          } catch (error) {
            return errorToErrorInfo(error).message;
          }
          return last?.type === "run.completed"
            ? undefined
            : `${last?.type ?? "no event"}${last?.type === "run.failed" ? `: ${last.error.message}` : ""}`;
        }),
      );
      resumed.forEach((failure, index) => {
        if (failure) failures.push(`${sessions[index]?.id} resume ended ${failure}`);
      });
      for (const session of sessions) {
        const entries = await session.entries();
        const suspended = entries.find((entry) => entry.kind === "suspended_run");
        loopStates[session.id] = (suspended?.data as { loop?: { snapshot?: unknown } } | undefined)?.loop?.snapshot;
      }
    }
  } finally {
    await agent.dispose();
  }
  if (failures.length > 0) throw new Error(`Loop "${strategy.name}" did not resume two concurrent runs: ${failures.join("; ")}`);
  return loopStates;
}
