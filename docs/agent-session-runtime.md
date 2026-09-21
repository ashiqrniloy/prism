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
- `session.contextMeter()` → `ContextMeter` (latest provider-turn input tokens, reported or labeled estimate, with cap/budget/ratio)
- `session.subscribe(options?)`
- `session.close()` → dispatches `session_shutdown` middleware once, then closes every subscriber
- `session.abort()`
- `session.entries()`
- `session.checkout(leafId?)`
- `session.fork(options?)`
- `session.clone(options?)`
- `resumeAgentRun(agent, ref, decision, options)`
- `resumeAgentRunStream(agent, ref, decision, options)` → owned durable-resume `AsyncIterable<AgentEvent>`
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

`session.run(input, options)` accepts the existing Prism input shape. `RunOptions.toolNames` optionally allow-lists registered tool names for that run (omit = full registry; empty = none). See [Tools](tools.md#per-run-tool-scoping).

```ts
string | Message | readonly Message[]
```

`AgentSessionConfig.store` overrides `AgentConfig.store`; otherwise the session gets a private memory store. `AgentSessionConfig.leafId` selects the branch leaf to resume from. `AgentSessionConfig.snapshotCacheTtlMs` tunes the in-memory branch cache behind `session.snapshot()`: default `DEFAULT_SNAPSHOT_CACHE_TTL_MS` (1000 ms), `0` disables caching so every read rebuilds from the store, maximum `HARD_MAX_SNAPSHOT_CACHE_TTL_MS` (30 s); values outside `0..hard` fail session construction with `TypeError`. The cache is invalidated by any new leaf or mutation, so the TTL only bounds reuse of an unchanged branch.

`AgentConfig.limits` sets run ceilings; `RunOptions.limits` may only narrow configured agent values (`null` counts as no cap, so a configured finite ceiling still wins). Limits cover turns, provider attempts, tool rounds/calls, wall time, request/response bytes, tokens, and optional single-currency cost. Policy axes accept `null` (0.5.4) to disable the axis; request/response bytes reject `null` and stay process-hard at 64 MiB. A breach emits one `run_limit_exceeded` event and throws `AgentRunError` with `result.limit`; see [Runs and usage ledger](runs-and-usage.md#run-limits).

`RunOptions.model` can override the request model for a run. Model overrides append a `model_change` entry. `AgentConfig.inputLayout` selects the default input assembly layout (`"cache_aware"` by default, or opt-in `"legacy"`); `RunOptions.inputLayout` wins for one run. `AgentConfig.thinkingLevel` / `RunOptions.thinkingLevel` (run wins) is the session thinking intent — Prism snaps it onto the request after host `providerOptions`. `AgentConfig.providerOptions`/`RunOptions.providerOptions` supply generic provider request options (session/cache/header/compat/extra hints only — provider-level timeout/retry hints were removed in 0.1.5). Kernel construction always stamps `options.sessionId`/`cacheKey` from `session.id` when missing; `createSessionCachePolicy` is an overlay, not required. Use `RunOptions.signal`/host abort controllers for timeouts and `AgentConfig.retry`/`RunOptions.retry` for retry. `AgentConfig.providerRequestPolicies`/`RunOptions.providerRequestPolicies` run before `AIProvider.generate()` and before `provider_request` middleware. `AgentConfig.systemPrompt` and `RunOptions.systemPrompt` add explicit layered system prompt contributions; `RunOptions.systemPrompt: false` disables configured prompt layers for that run while keeping `AgentConfig.instructions` as the base path. `RunOptions.compaction` can enable auto-compaction for that run or use `false` to disable configured auto-compaction. `RunOptions.retry` can enable provider-turn retry for that run or use `false` to disable configured retry. `RunOptions.metadata` is merged with agent/session metadata for assembly, provider requests, and tool contexts. Run tool-round limits via `RunOptions.limits.maxToolRounds`. `RunOptions.signal` is bridged into the per-run abort signal passed to assembly, providers, tools, auto-compaction, and retry backoff.

`RunOptions.activeSkills` selects named skills from a configured `SkillRegistry`; `RunOptions.skills` replaces a plain `Skill[]` config for one run. When `AgentConfig.skills` is a registry and neither is set, **no skills activate** unless `activateAllSkills: true` (run or agent). `skillsDisclosure` (`"progressive"` default, `"eager"` opt-in; run wins) controls catalog vs full instruction bodies; the session-owned `LoadedSkillSet` is populated by `load_skill` when the host registers `createLoadSkillTool`. `toolResultFold` (off unless the host supplies `summarize`) optionally folds aged large tool results in provider input only. `AgentConfig.attentionCompiler` (or `true` for defaults) opts into the per-turn attention compiler; `RunOptions.attentionCompiler: false` disables it for one run and an options object may only relax the agent setting — the session resolves it with the run's model before the first provider turn, and keeps one sticky frontier per session so a stub made once stays applied. See [Context and skills](context-and-skills.md) and [Attention compiler](attention-compiler.md).

## Outputs / response / events

`session.fork(options?)` / `session.clone(options?)` take `AgentSessionForkOptions` / `AgentSessionCloneOptions` (leaf id, new session id, metadata, and store overrides), and `session.steer(input, options?)` takes `SteerOptions`. See [Public contracts](public-contracts.md) for the field tables, and the [options index](options-index.md) for every session option surface.

`session.close()` is the session teardown seam: it dispatches `session_shutdown` middleware exactly once (idempotent — a second `close()` dispatches nothing) and then closes every subscriber, run-scoped and `acrossRuns` alike. It does not abort an active run, so call it after the run settles. `session_start` middleware, the mirror dispatch, runs once at the session's first run start (the two hooks are the only per-session middleware calls — every other hook is per turn or per boundary). See [Middleware hooks](middleware-hooks.md).

`session.run()` / `session.prompt()` resolve to an `AgentRunResult` with `sessionId`, `runId`, `status`, `text`, `content`, optional `message`/`usage`/`leafId`, `limit`/`attribution` when the run died on a configured ceiling, and terminal `error`/`abortReason` when applicable. Callers may ignore the return value. Failed and aborted runs still emit their terminal events, then reject with `AgentRunError` whose `.result` carries the same shape.

`session.stream(input, options?)` subscribes first, starts exactly one run, yields only that run's events, and terminates when the run succeeds, fails, or aborts. The subscription belongs to `stream()`: it closes it when the owned run settles, so even a run that fails before its first event (a pre-flight validation rejection returns before run-end cleanup) ends the consumer instead of parking it, and no run-end close is required for `stream()` to be correct. Early consumer return aborts the owned run and releases the session. `SubscribeOptions.maxQueuedEvents` / `overflow` may be passed alongside `RunOptions`.

`resumeAgentRunStream(agent, ref, resume, options?)` does the same for one existing suspended durable run. It validates checkpoint ownership, revision/fingerprint, and `expectedVersion`, then subscribes before emitting `agent_started` / `agent_resumed` and resumed message/tool/terminal events. `AgentRunResumeStreamOptions` combines `AgentRunResumeOptions` (including the optional `onSession` observer seam a supervisor uses to attach a child event pump to the rebuilt session) with `maxQueuedEvents` and `overflow`; early return aborts only resumed execution. Since 0.8.0 (plan 080 Task 3), `AgentRunResumeOptions.signal` is inherited by both entrypoints, so `resumeAgentRun()` aborts a live resumed provider/tool turn the same way `resumeAgentRunStream()` does — checked before each preparation step and threaded into the resumed execution. It does not replay a claimed/dispatched tool, poll a ledger, or retain a worker. `createAgentRunLifecycle().resumeStream(ref, resume, request?)` adds the same behavior after host agent-capability resolution.

`session.subscribe(options?)` returns an in-memory live subscription. By default it is **run-scoped**: the run-end cleanup (`cleanupRun`), a durable suspension, and a durable denial all close it, which is what `stream()` and the examples rely on. `SubscribeOptions.acrossRuns: true` opts one subscriber out of that close, so it keeps receiving the next run's events on the same session; it is then ended only by the host (`break` out of the `for await`, or the iterator's `return()`/`[Symbol.asyncIterator]().return()`), by `closeSubscribers()` on session teardown, or by an overflow under the default `close` policy. The run-scoped close is `closeRunSubscribers()`; `closeSubscribers()` still means every subscriber. Subscribe before `run()` to observe that run's events. The consumer loop and `session.run()` must run concurrently (e.g. start the `for await` consumer, then `await Promise.all([consumer, session.run("Hi")])`): events are only emitted during a live run, so awaiting the subscribe loop before calling `run()` deadlocks. Prefer `session.stream()` when you only need one run's events. `SubscribeOptions.maxQueuedEvents` defaults to `1024` (minimum `1`) and caps events queued while the consumer is not awaiting `next()`. `SubscribeOptions.overflow` defaults to `"close"`; it clears queued payload events, delivers one `event_subscriber_overflow` notice to that subscriber, then closes it. `"drop_oldest"` keeps newest events; `"drop_newest"` ignores new events while full.

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

`session.compact(options?)` runs the selected compaction strategy, appends one `kind: "compaction"` entry under the current leaf, updates the leaf, emits `compaction_started` and `compaction_finished`, and returns the appended `CompactionResult`. If `AgentConfig.compaction` or `RunOptions.compaction` includes `thresholdEntries` (entry count) or `trigger` (entry count, input ratio against the compiler's cap, or a host callback), auto-compaction checks once after input/model-change entries are appended and before provider input assembly; `RunOptions.compaction: false` skips that run's auto-compaction. A branch that already ends with a `kind: "compaction"` entry is left alone.

`entries()` returns the current branch entries. `checkout(leafId?)` moves the session to an existing leaf and rebuilds history. `fork()` returns a session on the same store/session id at the selected leaf without copying entries. `clone({ id })` copies the current branch to a new session id with new entry ids.

Missing providers fail closed: `run()` emits `error` and rejects before calling any provider. Provider `error` events emit session `error` and reject unless configured retry handles a transient provider-turn failure before output. Unknown tools fail closed through the tool harness and do not execute. Tool exceptions emit `tool_execution_error`, return an error `ToolResult`, and may still continue to the next provider turn.

Only one `run()` may be active per session. Concurrent `run()` / `prompt` / `followUp` calls emit `error` and reject immediately; Prism does not queue second prompts. Manual `compact()` also rejects while a run is active.

### Mid-run steer (0.0.11)

`session.steer(input, options?)` enqueues user text into the **same** active run (fail closed when no run). Default: inject at the next turn boundary (after tool rounds / before next provider assemble). `options.softInterrupt: true` aborts only the current provider stream, then continues the same `runId` with steered text. Pending queue caps: **8** messages / **64 KiB** UTF-8 total (`DEFAULT_MAX_PENDING_STEERS` / `DEFAULT_MAX_PENDING_STEER_BYTES`); overflow throws. Steered messages pass input guardrails + normal session append/redaction. A `block`/`tripwire` on a steered message drops just that message: Prism emits `guardrail_decision` plus a `steer_rejected` event (redacted message + `GuardrailRecord`) and the run continues; the message never enters history or the session store. Run-start input blocking still fails the run. `interrupt` on a steered message fails closed (durable suspension is only for run-start input). Loops drain via optional `LoopContext.hasPendingSteers` / `applyPendingSteers`.

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
  thinkingLevel: "low",
});

const session = agent.createSession({ id: "s1" });
const result = await session.run("Hi", { limits: { maxToolRounds: 1 }, compaction: { thresholdEntries: 20, keepRecentEntries: 6 }, retry: { maxAttempts: 3, baseDelayMs: 50 } });
console.log(result.text, result.usage?.totalTokens);

for await (const event of session.stream("Follow up")) console.log(event.type);

await session.compact({ keepRecentEntries: 4 });
const branch = await session.entries();
await session.checkout(branch.at(-1)?.id);
const clone = await session.clone({ id: "s2" });
```

## Extension and configuration notes

**Internal file structure (0.1.4).** Since 0.1.4 the runtime is spread across sibling modules behind the `src/agents.ts` barrel: `src/agent-session.ts` (the `RuntimeAgentSession` class, session factories, and shared session helpers), `src/agent-run-lifecycle.ts` (resume lifecycle: `resumeAgentRun`/`resumeAgentRunStream`), `src/agent-approval.ts` (pending-decision and approval helpers), `src/agent-tool-dispatch.ts` (elicitation and tool-policy helpers), `src/agent-run-state.ts` (run-state persistence + agent fingerprint), and `src/agent-loops.ts`/`src/compaction.ts`. The public import surface is unchanged — `createAgent`/`createAgentSession`/`resumeAgentRun`/`resumeAgentRunStream` still resolve from the package entry.

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
- The event broadcaster is in-memory, live-only, and bounded per subscriber by `SubscribeOptions`. It adds no dependency, timer, filesystem/network discovery, worker, or durable queue. An `acrossRuns: true` subscriber holds that bounded queue (default `maxQueuedEvents` 1024) for the session's lifetime instead of one run, and it subscribes to no other session: the broadcaster stays session-scoped, so no subscriber can observe another session's or ownership scope's events.

## Durable interruption

Set `runState` with a host-owned `CheckpointStore`, stable `definitionRevision`, and `interruptBeforeTool: true` to suspend at a persisted pre-side-effect boundary. A compiled pack rule with `action: "ask"` gates exactly the calls it matches the same way, without the all-tools switch (see [Guardrails § ask rules](guardrails.md#asking-for-approval-ask-rules)). A suspended result has `status: "suspended"`, a redacted `interruption`, and `runState.version`; it releases session resources before returning. When a provider turn requests several tools, the round is collected into **one** suspension whose `interruption.pendingDecisions` holds one redacted `PendingDecision` per gated call (`approvalId`, kind, scope with tool name/effect kind/identity/arguments hash — never raw arguments); ungated calls still dispatch.

`resumeAgentRun` accepts exactly one of:

- `decision: "approve" | "deny"` — legacy single-approval path. `approve` allows every pending decision once; `deny` terminates the run as `denied`.
- `decision: "continue"` — crash recovery for a running-state checkpoint written by [`checkpointPolicy: "every-turn"`](durable-runs.md): resumes from the last provider-turn boundary without re-dispatching tools. It requires a running state and never bypasses a gate — a suspended run still needs `approve`/`deny` or a decision batch.
- `decisions: readonly RunDecision[]` — one atomic batch. Every entry validates against the recorded pending set (unknown/foreign `approvalId`, duplicates, stale `expectedVersion`, invalid outcomes fail the whole batch closed with `AgentDecisionError` and leave state and version untouched). Outcomes: `allow_once`, `allow_for_run`, `reject_once`, `reject_for_run`. `reject_*` continues the run with a blocked tool result carrying the bounded (2 KB) `reason`. `modifiedArguments` are revalidated (schema, then input guardrails — including the session's restored guardrail pack rules, so an edit into a pack-violating state, a `deny` or an `ask` rule alike, is refused here with `ERR_PRISM_DECISION_INVALID` naming the rule instead of being accepted and only stopped at dispatch; permission/trust re-run at dispatch) and produce a new arguments hash. `elicitation` payloads are validated against the pending decision's `elicitationSchema` (required keys plus the configured host validator) and resolve the suspended call without executing it. A batch deciding a strict subset persists the decided entries and re-suspends with the remainder pending at the bumped version.

`*_for_run` outcomes append a `StickyDecision` to the durable run state: later calls in the same run matching the scope exactly (all recorded fields) proceed or are blocked without a new suspension, policy still enforced at dispatch. Sticky decisions expire when the run reaches any terminal status. Caps: 32 pending decisions per run (hard 128), 64 sticky decisions (hard 256), 2 KB decision reasons, 16 KB elicitation payloads. Frontend adapters (such as AG-UI with `capabilities.humanInTheLoop.approveWithEdits`) and the server resume endpoint (`POST .../resume` with `modifiedArguments`) map human edits directly to `RunDecision` entries with `modifiedArguments` under single atomic CAS, revalidating tool parameter schemas and invalidating stale draft approvals.

**Runtime input validation (0.2.0, plan 020 Task 2).** Every public resume entrypoint (`resumeAgentRun`, `resumeAgentRunStream`, `AgentRunLifecycle.resume()`/`resumeStream()`) validates the complete resume input in core before any checkpoint read/write, agent resolution, subscription, or tool execution: a non-null object, positive safe-integer `expectedVersion`, exactly one of `decision`/`decisions`, legacy `decision` exactly `approve`/`deny`/`continue`, and a non-empty batch ≤ 128 entries whose entries are objects with a bounded non-empty `approvalId`, a whitelisted outcome, an optional string `reason` within the 2 KB limit, and JSON-object `modifiedArguments`/`elicitation` within the 16 KB limit. Unknown legacy decisions (e.g. `"sideways"`) and malformed untyped batches fail closed with `AgentDecisionError` (`ERR_PRISM_DECISION_INVALID`/`..._LIMIT`/`..._DUPLICATE`) under a **no-side-effect guarantee**: zero checkpoint writes/CAS changes, zero tool calls, zero resumed events. This holds for plain-JavaScript and `as any` callers; the server's transport parser is defense in depth, not the security boundary. State-dependent checks (foreign/stale approval ids, scope, schema, policy) still run in the atomic batch resolver.

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

Resume requires exact checkpoint ownership, version, agent fingerprint, and revision. A checkpoint load or delete under a non-matching ownership scope reads as absent (`null`), and a save against a foreign-owned record fails as a generic `ERR_PRISM_CHECKPOINT_CONFLICT` (plan 080 Task 3) — a tenant cannot distinguish “another tenant owns this key” from “missing”, and callers that relied on the old `Checkpoint ownership mismatch` throw now see the same miss they would for an unknown key. The fingerprint hashes the agent id/name, `definitionRevision`, model, instructions, system-prompt contributions, skills (name/instructions/tool names), tool definitions (name/parameters/exclusive), guardrail definitions (name/stage/revision), and loop strategy — changing any of them without bumping `definitionRevision` fails resume closed instead of silently continuing with different agent semantics. Prism CAS-claims approval before work, rechecks normal guardrail/permission/validation/limit paths, and marks a pending tool dispatched before its side effect. `createAgentRunLifecycle()` wraps the same core path for server/MCP hosts: adapters pass only authorized ownership, status returns only `{ state, version }`, and `resolveAgent()` supplies current agent/revision. `resumeStream()` uses that same claim path and bounded subscriber, so adapters do not poll or duplicate resume logic. Remote restart requires both checkpoint and session stores to be durable. A crash after that mark is ambiguous and is never replayed automatically; use host tool idempotency keyed by `runId`/`toolCallId` or resolve it manually. Checkpoints contain bounded redacted state plus session/leaf references, never provider objects, callbacks, signals, credentials, or raw secrets. State is bounded at save by `runState.maxStateBytes` (default 256 KB, at most the 1 MB hard cap); load bounds against the 1 MB hard cap only, so state saved with a raised limit stays resumable while oversized records are still rejected. Since 0.1.3 (plan 015 Task 4), durable runs may opt in to session-state persistence with `persistSessionState: true` on both the run and resume options: the loaded-skill **name catalog** (≤64 names, ≤256 chars each) rides the checkpoint and is restored into the resumed session's `LoadedSkillSet`; skill **bodies are never persisted** and re-resolve from the live registry via `load_skill`. Since 0.1.6 (plan 018 closeout `checkpoint-bodies`), `includeSkillBodies: true` on BOTH the run and resume options additionally persists the exact loaded-skill **instructions** (`{name, instructions}` pairs, redacted at the checkpoint boundary like all state, ≤64 bodies / ≤256-char names / ≤262144-byte bodies / ≤1 MiB total) so resume re-renders them registry-independently — no `load_skill` round-trip and no dependence on the registry still serving the same text; `maxStateBytes` (default 256 KB) refuses oversize bodies with a recorded error, never silently truncates. Default off keeps the checkpoint shape byte-identical to 0.1.3. Since 0.7.0 (plan 074 P3), `persistSessionState: true` also carries the opt-in [attention compiler](attention-compiler.md)'s sticky frontier (`sessionState.attentionSticky`: 32-hex thinking keys plus tool-call ids, newest 256 of each, redacted like all state) so a resumed run keeps its thinking strips and tool stubs instead of re-deciding its first turn from the ratio; a malformed frontier is dropped entry by entry and never blocks a resume. Since 0.9.0 (plan 104 Task 2/3), `persistSessionState: true` also carries the session's guardrail pack refs (`sessionState.guardrailPacks`: `id`, `version`, bounded host `options` — or, for an inline pack, its pattern `rules`, which Task 3 allows to ride the checkpoint while a `deny` predicate or `RegExp` pattern refuses the save) plus each pack's own state-codec snapshot, so a resumed run recompiles and reinstates exactly the packs the suspended run enforced — including the `ask` rules that gate its later calls. The key's presence is the opt-in on resume (the run that wrote it had already opted in), and an unresolvable block — unknown pack id, version mismatch against the installed definition, a pack with persisted state but no codec, more than 8 packs, or malformed/oversized state — fails closed with `AgentRunStateError` before any provider or tool turn rather than resuming unenforced; `session.guardrailPackRefs` then feeds `snapshotRunBundle({ packs })` so recorded identity matches enforcement. Since 0.7.0, `onSession` hands the reconstructed session to a caller-supplied observer before the resumed run starts, so an observer (the supervisor's child-event pump) can subscribe while the run is still live; it is called for every resume outcome, a throw fails closed before any event or tool work, and the session is valid only for the duration of that resume. Built-in loop options are durable; custom `AgentLoopStrategy` instances are durable when they declare `snapshot`/`restore` hooks (see [Agent loops § Durable runs](agent-loops.md#durable-runs)) and reject before provider work otherwise. For mid-run crash recovery (`checkpointPolicy: "every-turn"` plus `decision: "continue"`), see [Durable runs](durable-runs.md).

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
- [Obscura browser engine](obscura.md): optional binary-backed tool array that composes into `createAgent({ tools })` with no host branch.
- [Middleware hooks](middleware-hooks.md): hooks that configured assembly/runtime can run.
- [CLI/RPC](cli-rpc.md): terminal and JSONL adapters over this runtime.
- [Workflows](workflows.md): optional DAG orchestration that calls `AgentSession.run()` for agent nodes.
- [A2A interoperability](a2a.md): direct text exposure calls `AgentSession.run()`; durable/rich/reconnect behavior uses host `A2ATaskLifecycle` over existing checkpoints/persistence, never an in-memory runtime cache.
- [Frontend interoperability (AG-UI and ACP)](ag-ui.md): optional adapters use `session.stream()` and `resumeAgentRunStream()` / `AgentRunLifecycle.resumeStream()`; protocol/UI state remains outside core.

`AgentConfig.loop` and `RunOptions.loop` select a replaceable per-run control loop (`singleShotLoop` default, or `generate-validate-revise` with host callbacks); see [Agent loops](agent-loops.md). `RunOptions.loop` wins over `AgentConfig.loop`. Built-in loops emit the same normal turn/message envelope around provider turns, and both add the first run input to live history once after the first provider turn so later turns see the same transcript shape.

`AgentConfig.redactor` and `RunOptions.redactor` redact exact known secret strings from provider requests, emitted events, and stored session entries. Redaction is opt-in and exact-match only.
