# Structured output

## What it does

Structured output in Prism is the `Artifact*` contract seam: a host-defined type `T` threaded through host-supplied `parser` → `validator` → `repairer` callbacks inside the `generateValidateReviseLoop` agent loop. Prism never instantiates `T`. The only way to get typed output from a loop is `ArtifactParser<T>`; Prism has no `WorkflowStep`/`NodeSchema`/`synapta*` types and no domain control-flow vocabulary — the seam is generic over an opaque host `T`.

An artifact loop generates provider text, parses it to `T`, validates `T` against a host schema, and on validation failure runs a repairer to build a follow-up input that asks the model to fix the artifact — repeating up to `maxRevisions` times. The result of every validation and the terminal `artifact_finished`/`artifact_failed` outcomes are observable through `AgentEvent` artifact variants.

## When to use it

Use `generateValidateReviseLoop` (with host `parser`/`validator`/`repairer`) when a run should produce an artifact that must satisfy a host-owned schema before it is considered complete: structured JSON output, a generated file passing lint, a typed response conforming to a Synapta-defined model. Wrap your existing schema/validation library behind the `Artifact*` callbacks.

Do not use it to re-implement provider calls, retry, abort, store, or event emission — those stay runtime-owned and are exposed to the loop only through `LoopContext`. Do not use it for runs that need tool calls during revision turns — use `singleShotLoop` or a custom `AgentLoopStrategy` instead. Do not put Synapta domain types into Prism; map them to `ArtifactValidation` in your callbacks.

## Inputs / request

```ts
import {
  createAgent,
  type ArtifactParser,
  type ArtifactValidator,
  type ArtifactRepairer,
  type ArtifactValidation,
  type ArtifactContext,
  type ArtifactParseResult,
} from "@arnilo/prism";
```

Host callback contracts (all generic over host `T`; Prism never instantiates `T`):

| Contract | Shape |
| --- | --- |
| `ArtifactParser<T>` | `(text: string, ctx: ArtifactContext) => ArtifactParseResult<T> \| Promise<...>` — parse assistant text to a typed value. |
| `ArtifactValidator<T>` | `(value: T, ctx: ArtifactContext) => ArtifactValidation \| Promise<...>` — return `{ ok: true }` or `{ ok: false, errors }`. |
| `ArtifactRepairer<T>` | `(value: T \| undefined, failure: ArtifactValidation, ctx: ArtifactContext) => AgentInput \| Promise<...>` — build the revision follow-up input. |
| `ArtifactValidation` | `{ ok: boolean; errors?: readonly { path?: string; message: string }[]; metadata?: Readonly<Record<string, unknown>> }`. |
| `ArtifactContext` | `{ sessionId, runId, turn, signal, metadata }` — passed to every callback. |
| `ArtifactParseResult<T>` | `{ ok: boolean; value?: T; error?: string }`. |

Loop selection (RunOptions wins over AgentConfig):

```ts
await session.run(input, {
  loop: {
    strategy: "generate-validate-revise",
    validator,         // required
    parser,            // optional; default treats assistant text as the value
    repairer,          // optional; default stringifies validation.errors[].message
    maxRevisions: 3,   // optional; default 3
  },
});
```

## Outputs / response / events

`generateValidateReviseLoop.run(ctx)` returns `Promise<Usage | undefined>`. Observable behavior is emitted through `AgentEvent` artifact variants (zero emitted by `singleShotLoop`):

```
artifact_validation_started
  → artifact_validation_finished
    → (artifact_revision_started)*
      → artifact_finished | artifact_failed
```

See [Agent events § Artifact event ordering](agent-events.md#artifact-event-ordering). Validation-failure-triggering-a-revision is recoverable and never an `error`; only terminal budget exhaustion emits `artifact_failed`; real failures stay on `error`.

`ArtifactValidation.errors[].message` may echo model text — every `artifact_*` payload is redacted through `redactAgentEvent` / the active `SecretRedactor` before subscribers observe it.

## Request/response example

```json
{
  "ok": false,
  "errors": [{ "path": "title", "message": "missing required field" }],
  "metadata": { "schema": "release-note/v1" }
}
```

## Implementation example

A Synapta-style host maps its own schema to `ArtifactValidation` via the callbacks — no Synapta type is imported by Prism:

```ts
import {
  createAgent,
  createMockProvider,
  providerTextDelta,
  providerDone,
  createSecretRedactor,
  type ArtifactParser,
  type ArtifactValidator,
  type ArtifactRepairer,
} from "@arnilo/prism";

// Host owns this schema (Synapta's own type). Prism never imports it.
interface ReleaseNote { readonly title: string; readonly body: string }

const parser: ArtifactParser<ReleaseNote> = (text) => {
  try {
    const value = JSON.parse(text) as ReleaseNote;
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "parse failed" };
  }
};

const validator: ArtifactValidator<ReleaseNote> = (value) =>
  value.title && value.body
    ? { ok: true }
    : { ok: false, errors: [{ path: value.title ? "body" : "title", message: "missing field" }] };

const repairer: ArtifactRepairer<ReleaseNote> = (_value, failure) => ({
  role: "user",
  content: [{ type: "text", text: `Fix these: ${failure.errors?.map((e) => e.path ? `${e.path}: ${e.message}` : e.message).join("; ")}` }],
});

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([
    providerTextDelta(JSON.stringify({ title: "ok", body: "v1" })),
    providerDone(),
  ]),
  // Redact any leaked secrets from model text echoed in errors[].message/metadata.
  redactor: createSecretRedactor([process.env.APP_KEY]),
});

await agent.createSession().run("Produce the JSON release note.", {
  loop: { strategy: "generate-validate-revise", validator, parser, repairer, maxRevisions: 3 },
});
```

## Extension and configuration notes

- `generate-validate-revise` is selected via `AgentConfig.loop` / `RunOptions.loop` (`RunOptions.loop` wins). See [Agent loops](agent-loops.md). `resolveLoop()` maps the options form to the factory; an unknown `strategy` throws before the first turn; a custom `AgentLoopStrategy` instance bypasses the options form.
- The default parser treats assistant text as the value (`{ ok: true, value: text }`); supply a host parser whenever `T` is not `string`.
- The default repairer builds a user message from `validation.errors[].message`; supply a host repairer for schema-specific guidance.
- `maxRevisions` (default 3) bounds revision turns; budget exhaustion ends the loop and emits `artifact_failed` (it does not throw).
- Tools are not dispatched in revision turns. Hosts needing tools in artifact turns use `singleShotLoop` or a custom loop.

## Security and performance notes

- Prism never instantiates `T`; it only threads the host-supplied value through parser→validator→repairer. No Synapta type is imported by `src/`.
- Boundary lock: `src/` imports no `synapta*` package, and the `Artifact*` / `AgentLoop*` / `LoopContext` contract field names contain no `workflow`/`node`/`step` domain vocabulary. Hosts map their own schema names to `ArtifactValidation.errors[].path`.
- `ArtifactValidation.errors[].message` and `metadata` may echo model text; every `artifact_*` event payload is redacted through `redactAgentEvent` / the active `SecretRedactor`. The generic walker handles nested objects/arrays and replaces cyclic references with `"[Circular]"` without throwing.
- A run makes at most `maxRevisions + 1` provider turns; it cannot loop forever on an always-failing validator. Each revision costs one provider turn plus one store append.
- No new dependency is required to use structured output — host callbacks wrap whatever schema/validation library the host already uses.

## Related APIs
- [Agent loops](agent-loops.md): `generateValidateReviseLoop` factory and `LoopContext`.
- [Agent events](agent-events.md): `artifact_validation_started` / `artifact_validation_finished` / `artifact_revision_started` / `artifact_finished` / `artifact_failed` variants.
- [Public contracts](public-contracts.md): `ArtifactValidation`, `ArtifactContext`, `ArtifactParseResult<T>`, `ArtifactParser<T>`, `ArtifactValidator<T>`, `ArtifactRepairer<T>`.
- [Credentials and redaction](credentials-and-redaction.md): `createSecretRedactor` and `redactAgentEvent`.
- [Agent/session runtime](agent-session-runtime.md): `session.run(input, options)` and `RunOptions.loop`.
