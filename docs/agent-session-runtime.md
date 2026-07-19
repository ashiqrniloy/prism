# Agent/session runtime

## What it does

The agent/session runtime adds the minimal shared SDK surface for running provider turns, dispatching complete host-owned tool calls, and subscribing to session events:

- `createAgent(config)`
- `createSecureAgent(options)` for opt-in fail-closed composition
- `createAgentSession(config)`
- `agent.createSession(config)`
- `session.run(input, options)` → `AgentRunResult`
- `session.prompt(input, options)` → `AgentRunResult`
- `session.stream(input, options)` → owned-run `AsyncIterable<AgentEvent>`
- `session.compact(options?)`
- `session.subscribe(options?)`
- `session.abort()`
- `session.entries()`
- `session.checkout(leafId?)`
- `session.fork(options?)`
- `session.clone(options?)`
- `resumeAgentRun(agent, ref, decision, options)`
- `createAgentRunLifecycle({ checkpoints, resolveAgent })` for host-selected remote status/resume adapters

The runtime streams provider text/tool-call content into `AgentEvent` values. Complete `tool_call` events are dispatched through the active host `ToolRegistry`, then returned as tool-result messages on the next provider turn. When a store is supplied, user, assistant, tool-result, and model-change entries are appended under the current branch leaf. Abort propagation and run exclusivity use native `AbortController`.

## When to use it

Use this runtime when a host already has an explicit `AIProvider` and wants to run a prompt through Prism's default input/prompt assembly, optionally execute selected host tools, and observe normalized session events.

Do not use it as a CLI/RPC adapter, whole-run retry framework, vector memory engine, provider registry, credential resolver, or app-tool pack.

## Inputs / request

```ts
createAgent(config: AgentConfig): Agent
createAgentSession(config: AgentSessionConfig & { agent: Agent }): AgentSession
```

`AgentConfig.provider` must contain the host-selected provider. Prism does not resolve providers from hidden globals. Alternatively, set `AgentConfig.providerSource: ProviderResolver` (or override per run with `RunOptions.providerSource`, which wins) to resolve the provider from `model.provider` each run; when `AgentConfig.provider` is set it takes first precedence and the resolver is bypassed. See [Provider layer § Provider resolver](provider-layer.md#provider-resolver).

`session.run(input, options)` accepts the existing Prism input shape:

```ts
string | Message | readonly Message[]
```

`AgentSessionConfig.store` overrides `AgentConfig.store`; otherwise the session gets a private memory store. `AgentSessionConfig.leafId` selects the branch leaf to resume from.

`AgentConfig.limits` sets run ceilings; `RunOptions.limits` may only narrow configured agent values. Limits cover turns, provider attempts, tool rounds/calls, wall time, request/response bytes, tokens, and optional single-currency cost. A breach emits one `run_limit_exceeded` event and throws `AgentRunError` with `result.limit`; see [Runs and usage ledger](runs-and-usage.md#run-limits).

`RunOptions.model` can override the request model for a run. Model overrides append a `model_change` entry. `AgentConfig.inputLayout` selects the default input assembly layout (`"legacy"` by default, or opt-in `"cache_aware"`); `RunOptions.inputLayout` wins for one run. `AgentConfig.providerOptions`/`RunOptions.providerOptions` supply generic provider request options; `timeoutMs`, `maxRetries`, and `maxRetryDelayMs` are deprecated inert provider-level hints in first-party providers. Use `RunOptions.signal`/host abort controllers for timeouts and `AgentConfig.retry`/`RunOptions.retry` for retry. `AgentConfig.providerRequestPolicies`/`RunOptions.providerRequestPolicies` run before `AIProvider.generate()` and before `provider_request` middleware. `AgentConfig.systemPrompt` and `RunOptions.systemPrompt` add explicit layered system prompt contributions; `RunOptions.systemPrompt: false` disables configured prompt layers for that run while keeping `AgentConfig.instructions` as the base path. `RunOptions.compaction` can enable auto-compaction for that run or use `false` to disable configured auto-compaction. `RunOptions.retry` can enable provider-turn retry for that run or use `false` to disable configured retry. `RunOptions.metadata` is merged with agent/session metadata for assembly, provider requests, and tool contexts. Deprecated `RunOptions.maxToolRounds` narrows `limits.maxToolRounds`. `RunOptions.signal` is bridged into the per-run abort signal passed to assembly, providers, tools, auto-compaction, and retry backoff.

## Outputs / response / events

`session.run()` / `session.prompt()` resolve to an `AgentRunResult` with `sessionId`, `runId`, `status`, `text`, `content`, optional `message`/`usage`/`leafId`, and terminal `error`/`abortReason` when applicable. Callers may ignore the return value. Failed and aborted runs still emit their terminal events, then reject with `AgentRunError` whose `.result` carries the same shape.

`session.stream(input, options?)` subscribes first, starts exactly one run, yields only that run's events, and terminates when the run succeeds, fails, or aborts. Early consumer return aborts the owned run and releases the session. `SubscribeOptions.maxQueuedEvents` / `overflow` may be passed alongside `RunOptions`.

`session.subscribe(options?)` remains available for hosts that want a long-lived subscriber across runs. Subscribe before `run()` to observe that run's events. The consumer loop and `session.run()` must run concurrently (e.g. start the `for await` consumer, then `await Promise.all([consumer, session.run("Hi")])`): events are only emitted during a live run, so awaiting the subscribe loop before calling `run()` deadlocks. Prefer `session.stream()` when you only need one run's events. `SubscribeOptions.maxQueuedEvents` defaults to `1024` (minimum `1`) and caps events queued while the consumer is not awaiting `next()`. `SubscribeOptions.overflow` defaults to `"close"`; it clears queued payload events, delivers one `event_subscriber_overflow` notice to that subscriber, then closes it. `"drop_oldest"` keeps newest events; `"drop_newest"` ignores new events while full.

For a text-only provider turn, the runtime emits:

1. `agent_started`
2. `turn_started`
3. `message_started`
4. `message_delta`
5. `message_finished`
6. `turn_finished`
7. `agent_finished`

For tool calls, the runtime streams provider `tool_call_delta` fragments as `message_delta` events for UI consumers, reconstructs the final `tool_call` with the same rules as provider conformance helpers, dispatches each complete call sequentially through `dispatchToolCall()`, emits tool execution events, appends an assistant tool-call session entry and a tool-result session entry, adds returned `ToolResult` values to the next provider turn, and stops when the provider returns no tool calls or `maxToolRounds` is reached. Deltas are live events only; persisted transcripts contain final `tool_call` blocks. The next provider turn therefore receives the assistant `tool_call` followed by the matching role `tool` `tool_result` before any final assistant content.

Provider `thinking`/`reasoning` content emitted during a turn is preserved as `thinking` content blocks on the assistant message in session history. On the next turn, provider packages decide how to carry prior reasoning forward. For example, the NeuralWatt provider serializes prior `thinking` blocks under a `reasoning_content` field for reasoning-capable models (gated on `capabilities.reasoning` / `compat.preserve_thinking`, droppable via `compat.clear_thinking`); see [NeuralWatt provider](providers/neuralwatt.md). Non-reasoning providers/models receive no reasoning field, so prior thinking does not leak into providers that do not support it.

`session.compact(options?)` runs the selected compaction strategy, appends one `kind: "compaction"` entry under the current leaf, updates the leaf, emits `compaction_started` and `compaction_finished`, and returns the appended `CompactionResult`. If `AgentConfig.compaction` or `RunOptions.compaction` includes `thresholdEntries`, auto-compaction checks once after input/model-change entries are appended and before provider input assembly; `RunOptions.compaction: false` skips that run's auto-compaction.

`entries()` returns the current branch entries. `checkout(leafId?)` moves the session to an existing leaf and rebuilds history. `fork()` returns a session on the same store/session id at the selected leaf without copying entries. `clone({ id })` copies the current branch to a new session id with new entry ids.

Missing providers fail closed: `run()` emits `error` and rejects before calling any provider. Provider `error` events emit session `error` and reject unless configured retry handles a transient provider-turn failure before output. Unknown tools fail closed through the tool harness and do not execute. Tool exceptions emit `tool_execution_error`, return an error `ToolResult`, and may still continue to the next provider turn.

Only one `run()` may be active per session. Concurrent `run()` calls emit `error` and reject immediately; Prism does not queue them. Manual `compact()` also rejects while a run is active.

`session.abort(reason)` aborts the active run. The abort signal is passed to input assembly, provider requests, and tool execution; if a tool/provider path aborts after a tool call, Prism does not start another provider turn.

## Request/response example

```json
{
  "input": "Hi",
  "events": ["agent_started", "turn_started", "message_delta", "agent_finished"],
  "leafId": "entry_2"
}
```

## Implementation example

```ts
import { createAgent, createMemorySessionStore, createMockProvider, providerDone, providerTextDelta, type ToolDefinition } from "@arnilo/prism";

const echo: ToolDefinition = {
  name: "echo",
  execute: (args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: args }),
};

const store = createMemorySessionStore();
const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
  tools: [echo],
  store,
});

const session = agent.createSession({ id: "s1" });
const result = await session.run("Hi", { maxToolRounds: 1, compaction: { thresholdEntries: 20, keepRecentEntries: 6 }, retry: { maxAttempts: 3, baseDelayMs: 50 } });
console.log(result.text, result.usage?.totalTokens);

for await (const event of session.stream("Follow up")) console.log(event.type);

await session.compact({ keepRecentEntries: 4 });
const branch = await session.entries();
await session.checkout(branch.at(-1)?.id);
const clone = await session.clone({ id: "s2" });
```

## Extension and configuration notes

The runtime calls `assembleProviderInput()` on every turn and uses only runtime-consumed values supplied on `AgentConfig`: `instructions`, `systemPrompt`, `inputBuilder`, `promptBuilder`, `inputLayout`, `context`, selected `skills`, active `tools`, `middleware`, `resourceLoader`, metadata, `compaction`, `retry`, and `RunOptions.model`/`systemPrompt`/`inputLayout`/`compaction`/`retry`. Contributions remain inert until a host passes selected values into the agent config.

`AgentConfig` no longer accepts inert `extensions`, `settings`, or `credentials` fields. Load extensions with `createExtensionKernel()` before building config; read settings in the host before passing concrete runtime options; resolve credentials at the provider edge and pass exact secret values to redaction when needed.

The runtime calls `middleware.run("compaction", { context, result })` after a compaction strategy returns and before appending the standard compaction entry. Middleware can adjust the result summary/data, but the runtime still owns store append ordering and branch parent ids.

Provider request policy application is one ordered in-memory pass per provider turn. Policies can patch `ProviderRequest.options` and return exact secret values for provider-error redaction. The runtime then calls `middleware.run("provider_request", request)` once before provider generation.

The runtime calls `middleware.run("retry", { context, decision })` after the retry policy decision and before emitting `retry_scheduled`. Middleware can stop retrying or adjust the delay. Retry wraps only the current provider turn, reuses the same assembled request, and never retries after assistant output has been emitted.

`createAgent()` is a thin wrapper over explicit config. It does not scan packages, resolve credentials, read settings, call `Extension.setup()`, or consult hidden registries. External `AgentDefinition` implementations can call it from their own `create()` method:

```ts
import { createAgent, createContributionRegistries } from "@arnilo/prism";

const contributions = createContributionRegistries();
contributions.agents.register("demo", {
  name: "demo",
  create: () => createAgent({ model, provider, context: [projectContext], tools: [echo] }),
});

const agent = await contributions.agents.resolve("demo").create();
await agent.createSession().run("Hi", { model: overrideModel });
```

## Security and performance notes

- No hidden provider, tool, credential, resource, settings, or extension globals are created.
- Unknown providers fail before provider streaming.
- Unknown, denied, or malformed tool calls fail closed through `dispatchToolCall()`.
- Abort uses native `AbortController`/`AbortSignal` only; no polling, queue, or dependency is added. Retry backoff uses native abort-aware timers only when configured.
- Concurrent runs fail fast instead of creating a scheduler.
- System prompt composition uses caller-supplied strings only; Prism does not discover `SYSTEM.md`, settings, manifests, packages, or prompt files.
- Provider request policies are in-memory only; they add no cache store, tokenizer, filesystem, network, or worker.
- Cache keys should be safe caller/session identifiers, not prompt text or credential values.
- Retry context contains session/run ids, attempt, redacted error info, optional metadata, and signal only; it excludes provider request messages/content, provider objects, credentials, credential resolvers, settings, and hidden metadata.
- Compaction context contains branch entries and explicit compaction options only; it does not include provider objects, provider requests, credential resolvers, resolved credentials, settings, or hidden metadata.
- Store entries contain explicit session data only; Prism does not store provider objects, credential resolvers, resolved credentials, full provider requests, settings, or hidden metadata.
- Runtime events contain messages/content only; do not put secrets in prompts, metadata, provider events, session entries, or docs examples.
- The event broadcaster is in-memory, live-only, and bounded per subscriber by `SubscribeOptions`. It adds no dependency, timer, filesystem/network discovery, worker, or durable queue.

## Durable interruption

Set `runState` with a host-owned `CheckpointStore`, stable `definitionRevision`, and `interruptBeforeTool: true` to suspend at a persisted pre-side-effect boundary. A suspended result has `status: "suspended"`, a redacted `interruption`, and `runState.version`; it releases session resources before returning.

```ts
const result = await session.run("Publish draft", {
  runState: { checkpoints, definitionRevision: "2026-07-20.1", interruptBeforeTool: true },
});
if (result.status === "suspended") {
  await resumeAgentRun(agent, { runId: result.runId, sessionId: result.sessionId }, {
    decision: "approve", expectedVersion: result.runState!.version!,
  }, { checkpoints, definitionRevision: "2026-07-20.1" });
}
```

Resume requires exact checkpoint ownership, version, agent fingerprint, and revision. Prism CAS-claims approval before work, rechecks normal guardrail/permission/validation/limit paths, and marks a pending tool dispatched before its side effect. `createAgentRunLifecycle()` wraps the same core path for server/MCP hosts: adapters pass only authorized ownership, status returns only `{ state, version }`, and `resolveAgent()` supplies current agent/revision. Remote restart requires both checkpoint and session stores to be durable. A crash after that mark is ambiguous and is never replayed automatically; use host tool idempotency keyed by `runId`/`toolCallId` or resolve it manually. Checkpoints contain bounded redacted state plus session/leaf references, never provider objects, callbacks, signals, credentials, or raw secrets. Only built-in loop options are durable; custom `AgentLoopStrategy` rejects before provider work.

## Secure composition

`createSecureAgent()` is optional; `createAgent()` remains explicit and backward-compatible. Secure composition requires an ID, non-empty definition revision, exact non-empty ownership, redactor, permission and trust policies, finite explicit limits, a host `ToolArgumentValidator`, non-empty schema for every tool, and checkpoints. It builds a duplicate-error registry, rejects missing schemas, always enables durable pre-tool interruption, and reuses normal provider/request policies without discovery or background work.

Per-run options may narrow `limits` and append `guardrails`; they cannot replace secure ownership, redaction, validator, or durable checkpoint policy. Every active tool is trust-checked then permission-checked before validation and its side effect. See [`examples/secure-agent.ts`](../examples/secure-agent.ts).

## Guardrails

`AgentConfig.guardrails` applies typed input, output, tool-input, and tool-output checks to every run. `RunOptions.guardrails` appends checks for one run. Input checks run before session append; configured output checks buffer provider content until allowed, so blocked content is never emitted or stored. See [Guardrails](guardrails.md).

## Related APIs

- [Public contracts](public-contracts.md): `Agent`, `AgentSession`, `RunOptions`, and `AgentEvent` contracts.
- [Provider layer](provider-layer.md): `AIProvider`, provider events, and `createMockProvider()`.
- [Input and prompt assembly](input-and-prompt-assembly.md): request assembly used by `session.run()`.
- [System prompts](system-prompts.md): layered prompt composition used before default input assembly.
- [Session stores and branching](session-stores-and-branching.md): `SessionStore`, memory store, branch helpers, and context rebuild.
- [Compaction and retry policies](compaction-and-retry.md): compaction strategy/config APIs used by `session.compact()` and auto-compaction, plus retry policy/config APIs.
- [Tools](tools.md): host-owned tool harness used by the bounded runtime tool loop.
- [Middleware hooks](middleware-hooks.md): hooks that configured assembly/runtime can run.
- [CLI/RPC](cli-rpc.md): terminal and JSONL adapters over this runtime.
- [Workflows](workflows.md): optional DAG orchestration that calls `AgentSession.run()` for agent nodes.

`AgentConfig.loop` and `RunOptions.loop` select a replaceable per-run control loop (`singleShotLoop` default, or `generate-validate-revise` with host callbacks); see [Agent loops](agent-loops.md). `RunOptions.loop` wins over `AgentConfig.loop`. Built-in loops emit the same normal turn/message envelope around provider turns, and both add the first run input to live history once after the first provider turn so later turns see the same transcript shape.

`AgentConfig.redactor` and `RunOptions.redactor` redact exact known secret strings from provider requests, emitted events, and stored session entries. Redaction is opt-in and exact-match only.
