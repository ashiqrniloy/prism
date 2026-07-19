# Agent loops

## What it does

Agent loops make the agent's per-run turn-control flow a replaceable strategy without forking the runtime. The runtime owns provider calls, retry, abort, store appends, redaction, and event emission; a loop only orchestrates those shared primitives through a `LoopContext`. The default `singleShotLoop` is the former inline turn loop extracted verbatim — assemble → generate → append assistant message → optional tool dispatch → next turn. `generateValidateReviseLoop` is the first alternative loop: generate → parse → validate → revise up to a budget.

Loops are opt-in. When no `loop` is configured, the runtime runs `singleShotLoop` and behavior is bit-for-bit with the pre-loop runtime.

- `singleShotLoop` — default; one-or-more provider turns with bounded tool rounds.
- `generateValidateReviseLoop(opts)` — factory returning a generate→validate→revise loop parameterized by host callbacks (`validator`, optional `parser`/`repairer`, `maxRevisions`).
- `resolveLoop(options, config)` — resolves `RunOptions.loop` (wins) over `AgentConfig.loop`, mapping `AgentLoopOptions` to a built-in strategy and passing through a custom `AgentLoopStrategy` instance.

The `Artifact*` contracts (`ArtifactValidation`, `ArtifactContext`, `ArtifactParseResult<T>`, `ArtifactParser<T>`, `ArtifactValidator<T>`, `ArtifactRepairer<T>`) are generic over a host-defined type `T`. Prism threads `T` through parser→validator→repairer; it never instantiates `T`. No domain control-flow vocabulary (`workflow`/`node`/`step`) appears in these contracts — the seam stays generic.

## When to use it

Use the default `singleShotLoop` implicitly whenever you call `session.run()` — no configuration needed. Opt into `generateValidateReviseLoop` when a run should produce an artifact that must satisfy a host-supplied schema before it is considered complete (e.g. structured output, a validated JSON document, a generated file passing lint) and the host wants Prism to drive the revision turns.

Do not use a loop to re-implement provider calls, retry, abort, store, or event emission — those stay runtime-owned and are exposed to the loop only through `LoopContext`. Artifact-loop tools stay disabled by default; opt into bounded calls only for host-registered, least-privilege lookup tools that must inform an artifact candidate.

## Inputs / request

```ts
import {
  createAgent,
  generateValidateReviseLoop,
  singleShotLoop,
  resolveLoop,
  type AgentLoopStrategy,
  type AgentLoopOptions,
  type LoopContext,
  type ArtifactValidator,
  type ArtifactParser,
  type ArtifactRepairer,
  type ArtifactValidation,
  type ArtifactContext,
  type ArtifactParseResult,
} from "@arnilo/prism";
```

Per-run and per-agent loop selection (RunOptions wins):

```ts
// AgentConfig.loop pins a loop for the agent/session.
const agent = createAgent({
  model,
  provider,
  // optional default loop for this agent:
  loop: { strategy: "single-shot", toolConcurrency: 4 },
});

// RunOptions.loop overrides per request.
await session.run(input, {
  loop: {
    strategy: "generate-validate-revise",
    validator: hostValidator,
    parser: hostParser,       // optional; default treats assistant text as the value
    repairer: hostRepairer,  // optional; default stringifies validation.errors[].message
    maxRevisions: 3,         // optional; default 3
    toolCalls: "bounded",    // optional; default "disabled"; uses limits.maxToolRounds
  },
});

// Custom loop escape hatch (a host-provided AgentLoopStrategy instance):
await session.run(input, { loop: myCustomLoop });
```

`AgentLoopOptions` is the discriminated union:

```ts
type AgentLoopOptions =
  | {
      readonly strategy: "single-shot";
      /** Independent tool calls per turn run concurrently up to this limit. Default `1`. */
      readonly toolConcurrency?: number;
    }
  | {
      readonly strategy: "generate-validate-revise";
      readonly validator: ArtifactValidator<unknown>;
      readonly parser?: ArtifactParser<unknown>;
      readonly repairer?: ArtifactRepairer<unknown>;
      readonly maxRevisions?: number;
      /** Default "disabled". "bounded" dispatches sequentially up to limits.maxToolRounds. */
      readonly toolCalls?: "disabled" | "bounded";
    };
```

Host callback contracts (all generic over host `T`):

| Contract | Shape |
| --- | --- |
| `ArtifactParser<T>` | `(text: string, ctx: ArtifactContext) => ArtifactParseResult<T> \| Promise<...>` — parse assistant text to a typed value. |
| `ArtifactValidator<T>` | `(value: T, ctx: ArtifactContext) => ArtifactValidation \| Promise<...>` — return `{ ok: true }` or `{ ok: false, errors }`. |
| `ArtifactRepairer<T>` | `(value: T \| undefined, failure: ArtifactValidation, ctx: ArtifactContext) => AgentInput \| Promise<...>` — build the revision follow-up input. |
| `ArtifactValidation` | `{ ok: boolean; errors?: readonly { path?: string; message: string }[]; metadata?: ... }`. |
| `ArtifactContext` | `{ sessionId, runId, turn, signal, metadata }` — passed to every callback. |
| `ArtifactParseResult<T>` | `{ ok: boolean; value?: T; error?: string }`. |

`LoopContext` (what the runtime builds for the loop each run):

| Field | Purpose |
| --- | --- |
| `sessionId`, `runId`, `metadata`, `signal` | Run identity and abort. |
| `history: Message[]` | Live mutable history — the loop pushes assistant and repair messages directly. |
| `input`, `inputMessages`, `maxToolRounds`, `toolConcurrency` | First-turn input, redacted input messages, tool-round budget, and per-turn parallel dispatch limit (`toolConcurrency` default `1`). |
| `assemble(nextInput, toolResults?)` | Wraps `assembleProviderInput()` with resolved skills/tools/context/system prompt/provider options. |
| `generate(request)` | Wraps provider request policies + `provider_request` middleware + `generateWithRetry()`; returns `ProviderTurnResult`. |
| `dispatchToolCall(call)` | Wraps `dispatchToolCall()` with resolved registry/middleware/permission/redactor/validate. |
| `appendMessage(message)` | Appends to the store under the run (redacted). |
| `emit(event)` | Emits a redacted `AgentEvent`. |

## Durable runs

`RunOptions.runState` supports only built-in loop options (`single-shot` and `generate-validate-revise`). A custom `AgentLoopStrategy` has arbitrary in-memory cursor state, so durable configuration rejects it before provider work. Built-in suspension occurs only before an input provider call or immediately before a tool side effect; completed provider turns remain in `SessionStore` history and are not repeated after `resumeAgentRun()`.

## Outputs / response / events

`AgentLoopStrategy.run(ctx)` returns `Promise<Usage | undefined>` as a fallback for custom loops. Core runtime independently accumulates every usage-bearing provider turn in O(turns), persists scoped turn/run rows, and emits `agent_finished` with the aggregate.

Events during a loop run are the existing `AgentEvent`s (`turn_started`, `message_started`, `message_delta`, `message_finished`, `turn_finished`, tool-execution events when the loop dispatches tools, `error` on real failures). Both built-in loops emit `turn_started` before each provider turn, `message_finished` for every assistant draft, and `turn_finished` after the assistant draft is appended. First-turn input is appended to live history once, matching the already-persisted user message.

Validation-failure-triggering-a-revision is **not** an `error` event — it is recoverable, like `tool_execution_blocked`. In bounded artifact mode, a tool-calling provider response emits normal assistant/tool lifecycle events, skips artifact parsing/validation, then the next turn sees its persisted result. `generateValidateReviseLoop` emits artifact events only for call-free candidates: `artifact_validation_started` → `artifact_validation_finished` → (`artifact_revision_started`)* → `artifact_finished` | `artifact_failed`. A request beyond `maxToolRounds` executes nothing and emits terminal `artifact_failed` with `result.metadata.reason === "tool_round_limit"`; see [Agent events § Artifact event ordering](agent-events.md#artifact-event-ordering). `singleShotLoop` emits zero artifact events. Real failures stay on the `error` channel.

A loop has no path to credentials, provider objects, or unredacted secrets. `LoopContext.generate` receives the already-policy-applied, middleware-run, redacted request; `LoopContext.emit` runs through `redactAgentEvent` with the active `SecretRedactor`.

## Request/response example

```ts
// Default single-shot run (no loop configured).
await session.run("Summarize the schema.");
```

```ts
// Generate-validate-revise with a host schema validator.
import { createAgent, type ArtifactValidator } from "@arnilo/prism";

const validator: ArtifactValidator<unknown> = (value, _ctx) =>
  typeof value === "string" && value.length > 0
    ? { ok: true }
    : { ok: false, errors: [{ message: "empty artifact" }] };

await session.run("Write a one-line release note.", {
  loop: { strategy: "generate-validate-revise", validator, maxRevisions: 3 },
});
```

## Implementation example

```ts
import { createAgent, createMockProvider, providerTextDelta, providerDone, type ArtifactValidator, type ArtifactParser, type ArtifactRepairer } from "@arnilo/prism";

// Host owns the schema shape T. Prism never instantiates it.
interface JsonDoc { readonly title: string; readonly body: string }

const parser: ArtifactParser<JsonDoc> = (text) => {
  try {
    const value = JSON.parse(text) as JsonDoc;
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "parse failed" };
  }
};

const validator: ArtifactValidator<JsonDoc> = (value) =>
  value.title && value.body
    ? { ok: true }
    : { ok: false, errors: [{ path: value.title ? "body" : "title", message: "missing field" }] };

const repairer: ArtifactRepairer<JsonDoc> = (_value, failure) => ({
  role: "user",
  content: [{ type: "text", text: `Fix these: ${failure.errors?.map((e) => e.message).join("; ")}` }],
});

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([
    providerTextDelta(JSON.stringify({ title: "ok", body: "rev1" })),
    providerDone(),
  ]),
});

await agent.createSession().run("Produce the JSON doc.", {
  loop: { strategy: "generate-validate-revise", validator, parser, repairer, maxRevisions: 3 },
});
```

A custom loop is a plain object; pass it directly as `AgentLoopStrategy`:

```ts
import { type AgentLoopStrategy } from "@arnilo/prism";

const twoShotLoop: AgentLoopStrategy = {
  name: "two-shot",
  async run(ctx) {
    await ctx.generate(await ctx.assemble(ctx.input));
    // ...orchestrate further turns via ctx primitives only...
    return undefined;
  },
};
await session.run(input, { loop: twoShotLoop });
```

## Extension and configuration notes

- `RunOptions.loop` wins over `AgentConfig.loop`; when neither is set the runtime uses `singleShotLoop`. This mirrors the other `RunOptions` overrides (`redactor`, `validate`, `activeSkills`).
- `{ strategy: "single-shot" }` resolves to the exported `singleShotLoop`; `{ strategy: "generate-validate-revise", ... }` is mapped by `resolveLoop()` to `generateValidateReviseLoop(opts)`. An unknown `strategy` throws before the first turn. Passing an `AgentLoopStrategy` instance bypasses the options form entirely (custom-loop escape hatch).
- The loop is resolved once per run inside `RuntimeAgentSession.run()`, after the usual setup (provider/skills/tools resolution, history rebuild, model-change entry, input append, auto-compaction). The runtime's outer try/catch/finally, run-exclusivity, abort bridging, and subscriber close remain in place around `loop.run(ctx)`.
- `LoopContext.assemble(nextInput, toolResults?)` accepts an optional tool-result accumulator so `singleShotLoop` can pass its loop-local results. Bounded artifact tools append results directly to shared history, then assemble the next turn with empty new input; no second transcript path exists.
- `limits.maxToolRounds` bounds both `singleShotLoop` and opt-in bounded artifact tool rounds across the whole run. Artifact mode always dispatches sequentially, regardless of `toolConcurrency`; all dispatches still use existing registry/filter/permission/validator/middleware/redactor/ledger guards. Deprecated `maxToolRounds` only narrows this limit.
- `maxRevisions` (default 3) counts only failed call-free artifact candidates. Bounded artifact runs make at most `1 + maxRevisions + maxToolRounds` provider turns. A tool-round limit is terminal and returns last usage after `artifact_failed`; it does not throw.
- A revision cycle appends one assistant draft and one repair user message per revision to the session store, so store entries reflect every attempted draft. The original user input is stored once by the runtime and pushed into loop history once on the first turn. Repair messages are assembled as the next provider `nextInput` and only pushed into live history after that revision request has been generated, so the model never receives a duplicated repair instruction.

## Security and performance notes

- Loops have no path to credentials, provider objects, or unredacted secrets. `LoopContext.generate` consumes an already-redacted request; `LoopContext.emit` runs through `redactAgentEvent` with the active `SecretRedactor`; `LoopContext.appendMessage` appends a redacted entry.
- `ArtifactValidation.errors[].message` may echo model text — `artifact_*` event payloads flow through the same `redactAgentEvent` path as other `AgentEvent`s (see [Agent events](agent-events.md)).
- `generateValidateReviseLoop` makes at most `1 + maxRevisions + maxToolRounds` provider turns when bounded tools are enabled (otherwise `maxRevisions + 1`); it cannot loop forever. Each revision costs one provider turn plus one store append.
- Bounded artifact tool calls run sequentially through `dispatchToolCall` (permission + validation + execute); their assistant call and result are persisted before the next provider request. `singleShotLoop` retains its bounded parallel worker pool and original call-order transcript behavior.
- The loop is a plain object/factory; no class hierarchy, no background work, no extra dependencies. `LoopContext` is a single object literal of bound arrows built once per run.
- The Synapta-free boundary is guarded by tests: `src/` imports no `synapta*` package, and the `Artifact*`/`AgentLoop*`/`LoopContext` contracts contain no `workflow`/`node`/`step` field names. Hosts supply their own schema; no host domain type is imported by `src/`.

## Guardrails

Built-in loops and custom loops that use `LoopContext.generate()` / `LoopContext.dispatchToolCall()` inherit runtime guardrails. Provider output is checked before a loop appends assistant content; tool stages remain in shared dispatch. Do not call providers or `ToolDefinition.execute()` directly if guardrail enforcement is required; see [Guardrails](guardrails.md).

## Related APIs
- [Agent/session runtime](agent-session-runtime.md): `RuntimeAgentSession.run()` builds the `LoopContext` and delegates to the resolved loop.
- [Agent events](agent-events.md): the `artifact_*` event variants and ordering emitted by `generateValidateReviseLoop`.
- [Structured output](structured-output.md): the `ArtifactParser<T>`/`ArtifactValidator<T>`/`ArtifactRepairer<T>` seam (host-defined `T`, Prism never instantiates it) and a Synapta-style schema→`ArtifactValidation` mapping example.
- [Public contracts](public-contracts.md): `AgentLoopStrategy`, `AgentLoopOptions`, `LoopContext`, `ProviderTurnResult`, and the `Artifact*` contracts.
- [Input and prompt assembly](input-and-prompt-assembly.md): `assembleProviderInput()`, the primitive behind `LoopContext.assemble`.
- [Tools](tools.md): `dispatchToolCall()`, the primitive behind `LoopContext.dispatchToolCall`.
- [Compaction and retry policies](compaction-and-retry.md): `generateWithRetry()` and retry/compaction primitives the loop never re-implements.
- [Context and skills](context-and-skills.md): per-run skill/tool resolution feeding `LoopContext.assemble`.
