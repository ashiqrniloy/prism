# Agent/session runtime

## What it does

The agent/session runtime adds the minimal shared SDK surface for running provider turns, dispatching complete host-owned tool calls, and subscribing to session events:

- `createAgent(config)`
- `createAgentSession(config)`
- `agent.createSession(config)`
- `session.run(input, options)`
- `session.prompt(input, options)`
- `session.compact(options?)`
- `session.subscribe()`
- `session.abort()`
- `session.entries()`
- `session.checkout(leafId?)`
- `session.fork(options?)`
- `session.clone(options?)`

The runtime streams provider text/tool-call content into `AgentEvent` values. Complete `tool_call` events are dispatched through the active host `ToolRegistry`, then returned as tool-result messages on the next provider turn. When a store is supplied, user, assistant, tool-result, and model-change entries are appended under the current branch leaf. Abort propagation and run exclusivity use native `AbortController`.

## When to use it

Use this runtime when a host already has an explicit `AIProvider` and wants to run a prompt through Prism's default input/prompt assembly, optionally execute selected host tools, and observe normalized session events.

Do not use it as a CLI/RPC adapter, whole-run retry framework, vector memory engine, provider registry, credential resolver, or app-tool pack.

## Inputs / request

```ts
createAgent(config: AgentConfig): Agent
createAgentSession(config: AgentSessionConfig & { agent: Agent }): AgentSession
```

`AgentConfig.provider` must contain the host-selected provider. Prism does not resolve providers from hidden globals.

`session.run(input, options)` accepts the existing Prism input shape:

```ts
string | Message | readonly Message[]
```

`AgentSessionConfig.store` overrides `AgentConfig.store`; otherwise the session gets a private memory store. `AgentSessionConfig.leafId` selects the branch leaf to resume from.

`RunOptions.model` can override the request model for a run. Model overrides append a `model_change` entry. `AgentConfig.providerOptions`/`RunOptions.providerOptions` supply generic provider request options. `AgentConfig.providerRequestPolicies`/`RunOptions.providerRequestPolicies` run before `AIProvider.generate()` and before `provider_request` middleware. `AgentConfig.systemPrompt` and `RunOptions.systemPrompt` add explicit layered system prompt contributions; `RunOptions.systemPrompt: false` disables configured prompt layers for that run while keeping `AgentConfig.instructions` as the base path. `RunOptions.compaction` can enable auto-compaction for that run or use `false` to disable configured auto-compaction. `RunOptions.retry` can enable provider-turn retry for that run or use `false` to disable configured retry. `RunOptions.metadata` is merged with agent/session metadata for assembly, provider requests, and tool contexts. `RunOptions.maxToolRounds` bounds repeated tool turns and defaults to `1`. `RunOptions.signal` is bridged into the per-run abort signal passed to assembly, providers, tools, auto-compaction, and retry backoff.

## Outputs / response / events

`session.subscribe()` returns a live `AsyncIterable<AgentEvent>`. Subscribe before `run()` to observe that run's events.

For a text-only provider turn, the runtime emits:

1. `agent_started`
2. `turn_started`
3. `message_started`
4. `message_delta`
5. `message_finished`
6. `turn_finished`
7. `agent_finished`

For complete tool calls, the runtime emits the assistant `tool_call` as `message_delta`, dispatches sequentially through `dispatchToolCall()`, emits tool execution events, appends a tool-result session entry, adds returned `ToolResult` values to the next provider turn, and stops when the provider returns no tool calls or `maxToolRounds` is reached.

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
import { createAgent, createMemorySessionStore, createMockProvider, providerDone, providerTextDelta, type ToolDefinition } from "prism";

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
const reader = (async () => {
  for await (const event of session.subscribe()) console.log(event.type);
})();

await session.run("Hi", { maxToolRounds: 1, compaction: { thresholdEntries: 20, keepRecentEntries: 6 }, retry: { maxAttempts: 3, baseDelayMs: 50 } });
await session.compact({ keepRecentEntries: 4 });
const branch = await session.entries();
await session.checkout(branch.at(-1)?.id);
const clone = await session.clone({ id: "s2" });
await reader;
```

## Extension and configuration notes

The runtime calls `assembleProviderInput()` on every turn and uses only values supplied on `AgentConfig`: `instructions`, `systemPrompt`, `inputBuilder`, `promptBuilder`, `context`, selected `skills`, active `tools`, `middleware`, `resourceLoader`, metadata, `compaction`, `retry`, and `RunOptions.model`/`systemPrompt`/`compaction`/`retry`. Contributions remain inert until a host passes selected values into the agent config.

The runtime calls `middleware.run("compaction", { context, result })` after a compaction strategy returns and before appending the standard compaction entry. Middleware can adjust the result summary/data, but the runtime still owns store append ordering and branch parent ids.

Provider request policy application is one ordered in-memory pass per provider turn. Policies can patch `ProviderRequest.options` and return exact secret values for provider-error redaction. The runtime then calls `middleware.run("provider_request", request)` once before provider generation.

The runtime calls `middleware.run("retry", { context, decision })` after the retry policy decision and before emitting `retry_scheduled`. Middleware can stop retrying or adjust the delay. Retry wraps only the current provider turn, reuses the same assembled request, and never retries after assistant output has been emitted.

`createAgent()` is a thin wrapper over explicit config. It does not load `AgentConfig.extensions`, scan packages, resolve credentials, read settings, or consult hidden registries. External `AgentDefinition` implementations can call it from their own `create()` method:

```ts
import { createAgent, createContributionRegistries } from "prism";

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
- The event broadcaster is in-memory and live-only. It adds no dependency, timer, filesystem/network discovery, worker, or durable queue.

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

`AgentConfig.redactor` and `RunOptions.redactor` redact exact known secret strings from provider requests, emitted events, and stored session entries. Redaction is opt-in and exact-match only.
