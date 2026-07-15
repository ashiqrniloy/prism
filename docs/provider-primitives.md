# Provider primitives

## What it does

This page freezes the reusable provider transport, OpenAI-style serialization, structured-output capability, and observability designs for Plan 054. It inventories duplicated helpers across `@arnilo/prism` and first-party provider packages, documents trust boundaries, and selects the generic APIs that Tasks 1–6 will implement and migrate to.

Implementation is **shipped** for transport and OpenAI serialization primitives (Plan 054 Task 1). **All first-party providers are migrated** to those primitives (Plan 054 Task 2); package-local `sse.ts`, `safeText`, `parseArgs`, and duplicate OpenAI serializers are removed. **Native structured output** (`StructuredOutputOptions`, provider mappers, capability gating) shipped in Task 4. Observability contracts remain design-only until Task 5.

## When to use it

- **Provider package authors** implementing or migrating a first-party adapter should import shared primitives from `@arnilo/prism/providers/transport` and `@arnilo/prism/providers/openai` instead of copying `sse.ts`, `safeText`, `parseArgs`, or serializers.
- **Host apps** choose native structured output via `ProviderRequestOptions.structuredOutput` when the model declares support; otherwise they keep the artifact generate→validate→revise loop ([Structured output](structured-output.md)).
- **Operators** enable observability through extended agent events and the optional OpenTelemetry adapter package ([Observability](observability.md)).

## Inventory (2026-07-14 baseline)

Static scan of root `src/providers/` and `packages/provider-*/src/` before Plan 054 implementation.

### Duplicated protocol helpers (baseline → Task 2)

| Helper | Baseline copies | Task 2 status |
| --- | ---: | --- |
| `readSseData` / SSE reader | 7 (6× `sse.ts` + inline openai-compatible) | **Migrated** — `@arnilo/prism/providers/transport`; local `sse.ts` deleted |
| `readNeuralWattSseFrames` | 1 | **Migrated** — thin adapter over `readSseEvents` `comments` in `provider-neuralwatt` |
| `safeText` | 9 | **Migrated** — `readBoundedResponseText` with optional `secrets` |
| `parseArgs` | 8 | **Migrated** — `parseJsonObjectArguments` (typed error on malformed JSON) |
| `toTool` | 7 OpenAI-style | **Migrated** — `serializeOpenAITool` where wire shape matches |
| `toUsage` / usage mapper | 6 | **Local** — provider-specific wire field names remain per package |
| Message serializer | 7 local | **Mixed** — `serializeOpenAIChatMessage` / `assertOpenAIChatMessage` where OpenAI Chat Completions; Anthropic, OpenRouter cache, OpenAI Responses, NeuralWatt `reasoning_content` stay local |

### Retry / rate-limit metadata paths

| Surface | Owner | Behavior today |
| --- | --- | --- |
| Runtime retry | `@arnilo/prism` `AgentConfig.retry` / `RunOptions.retry` | Classifies `ErrorInfo.code`; provider packages set numeric HTTP `code` on errors |
| `ProviderRequestOptions.maxRetries` / `timeoutMs` | Contracts | **Deprecated / inert** in first-party providers |
| NeuralWatt `classifyNeuralWattError` | `packages/provider-neuralwatt` | Parses `Retry-After`, `error.retry_after`, `retry_strategy`; no extra network calls |
| Quota endpoint throttling | `packages/provider-neuralwatt/quota.ts` | Documents 1 rps limit; caller-owned cache |

No generic core helper extracts `Retry-After` / `x-request-id` for all providers yet.

### Structured output

| Surface | Status |
| --- | --- |
| `ProviderRequestOptions` | `structuredOutput?: StructuredOutputOptions` |
| `ModelCapabilities` | `structuredOutput?: boolean \| "json_schema"` |
| Provider wire mapping | None — artifact loop is the only structured-output path |
| Schema validation | Host-owned via artifact `validator`; no provider-native request |

### Telemetry / observability events

| Event / hook | Owner | Payload classification |
| --- | --- | --- |
| `ProviderEvent` union | Core | Text/thinking/tool/usage/done/error — no request metadata |
| `AgentEvent` stream | Core | Turn/message/tool/retry — content redacted when `redactor` configured |
| `neuralwatt:telemetry` | `provider-neuralwatt` | Numeric energy/cost only — **safe metadata** |
| Middleware `provider_request` | Core | Full `ProviderRequest` — host must redact |
| OpenTelemetry adapter | **Not shipped** | Planned optional package |

## Chosen generic APIs (frozen for Task 1+)

Primitives are **stdlib-only**, exposed as peer-importable subpaths on `@arnilo/prism`. Provider-specific request fields, event mapping, cache/reasoning knobs, and NeuralWatt comment telemetry stay local.

### Decision table

| Concern | Option A | Option B | **Chosen** | Rationale |
| --- | --- | --- | --- | --- |
| SSE parsing | External npm SSE library | Incremental stdlib parser | **B** | Small surface; avoids dependency |
| Transport packaging | New `@arnilo/prism-provider-transport` package | Core subpath `@arnilo/prism/providers/transport` | **Core subpath** | Matches existing `providers/openai-compatible` pattern; one peer dep |
| OpenAI serializers | Duplicate per package | `@arnilo/prism/providers/openai` | **Core subpath** | Proven by ≥6 providers |
| NeuralWatt comments | Force into generic reader | `readSseEvents` yields optional `comments[]`; NeuralWatt maps locally | **Optional comments** | Keeps generic reader used by ≥2 providers without NeuralWatt-only branches in core |
| Structured output wire shape | Vendor fields in core contracts | Provider-neutral option + local mapper | **Neutral option** | Avoids leaking `response_format` into contracts |
| Observability | Hard OTel in core | Extended events + optional adapter package | **Events + optional pkg** | No mandatory heavyweight dep |

### `@arnilo/prism/providers/transport` — **shipped**

Import:

```ts
import {
  readSseEvents,
  readSseData,
  readBoundedResponseText,
  parseJsonObjectArguments,
  ProviderTransportError,
  DEFAULT_MAX_EVENT_BYTES,
  DEFAULT_MAX_BUFFER_BYTES,
  DEFAULT_MAX_RESPONSE_BODY_BYTES,
} from "@arnilo/prism/providers/transport";
```

```ts
export interface BoundedStreamLimits {
  /** Max bytes per completed SSE event (all data: lines + field names). Default: 262_144 (256 KiB). */
  readonly maxEventBytes?: number;
  /** Max bytes retained for an incomplete event/buffer. Default: 524_288 (512 KiB). */
  readonly maxBufferBytes?: number;
  /** Max bytes read from non-streaming HTTP bodies (errors). Default: 65_536 (64 KiB). */
  readonly maxResponseBodyBytes?: number;
}

export interface SseEvent {
  readonly id?: string;
  readonly event?: string;
  /** Joined multiline `data:` payload for one SSE event. */
  readonly data: string;
  /** Raw `:` comment lines (without leading colon), when present. */
  readonly comments?: readonly string[];
}

export class ProviderTransportError extends Error {
  readonly code: "sse_buffer_overflow" | "sse_event_overflow" | "response_body_overflow" | "aborted";
  readonly limitBytes?: number;
}

/** Incremental O(bytes) SSE parser. Supports LF/CRLF, comment lines, multiline data:, final partial flush, abort. */
export async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
  options?: BoundedStreamLimits & { signal?: AbortSignal },
): AsyncGenerator<SseEvent>;

/** Read response body text with a hard byte ceiling; releases the reader. */
export async function readBoundedResponseText(
  response: Response,
  options?: BoundedStreamLimits & { secrets?: readonly (string | undefined)[] },
): Promise<string>;

/** Parse tool-call arguments JSON to a plain object; throws typed error on invalid/non-object input. */
export function parseJsonObjectArguments(
  text: string,
  options?: { toolName?: string; maxBytes?: number },
): JsonObject;
```

**Performance:** Single pass over chunks; retained memory is `O(min(buffer, maxBufferBytes))`, not `O(stream)`. No full-stream accumulation.

### `@arnilo/prism/providers/openai` — **shipped**

Import:

```ts
import {
  serializeOpenAITool,
  serializeOpenAIChatMessage,
  mapOpenAIChatUsage,
  assertOpenAIChatMessage,
} from "@arnilo/prism/providers/openai";
```

```ts
/** OpenAI Chat Completions tool schema. */
export function serializeOpenAITool(tool: ToolDefinition): JsonObject;

/** OpenAI Chat Completions message wire shape with capability guards. */
export function serializeOpenAIChatMessage(
  message: Message,
  capabilities?: ModelCapabilities,
): JsonObject;

/** Map OpenAI `usage` object to Prism `Usage` (incl. cache fields). */
export function mapOpenAIChatUsage(usage: unknown): Usage | undefined;

/** Fail fast with indexed, content-free diagnostics (no payload stringify). */
export function assertOpenAIChatMessage(message: unknown, path: string): asserts message is Message;
```

`src/providers/openai-compatible.ts` becomes a thin adapter over these helpers in Task 2.

### Structured output capability (Task 4 — **shipped**)

```ts
// Added to src/contracts.ts — provider-neutral host option
export interface StructuredOutputOptions {
  readonly name: string;
  readonly schema: JsonObject;
  readonly strict?: boolean;
}

// ProviderRequestOptions
readonly structuredOutput?: StructuredOutputOptions;

// ModelCapabilities
readonly structuredOutput?: boolean | "json_schema";
```

| Provider family | Native support (planned) | Wire mapping owner |
| --- | --- | --- |
| OpenAI / OpenAI-compatible / OpenRouter / OpenCode Go (OpenAI chat) | `response_format: { type: "json_schema", json_schema: { name, schema, strict } }` | Respective provider package |
| OpenAI Responses API | `text.format` / JSON schema fields per API version | `provider-openai` |
| Anthropic (OpenCode Go) | Documented fallback only unless API gains parity | `provider-opencode-go` |
| Z.AI / Kimi / NeuralWatt | Capability-gated per package docs | Local mapper or clear unsupported error |
| Unsupported | — | Host selects artifact loop explicitly |

**Fallback rule:** Unsupported providers **do not** silently repair. Runtime returns a clear error unless the host configured the artifact loop ([Structured output](structured-output.md)).

### Observability capability (Task 5 contract)

Core extends existing seams — no second event bus.

```ts
export interface ProviderTurnMetadata {
  readonly providerId: string;
  readonly model: ModelConfig;
  readonly requestId?: string;
  readonly latencyMs?: number;
  readonly attempt?: number;
  readonly httpStatus?: number;
  readonly rateLimitRemaining?: number;
  readonly rateLimitResetMs?: number;
}

// New AgentEvent variants (metadata only — no prompts, tool args, or credentials):
// - provider_turn_started { sessionId, runId, turn, metadata }
// - provider_turn_finished { sessionId, runId, turn, metadata, usage?, error? }
```

Optional package `@arnilo/prism-observability-opentelemetry` subscribes via middleware + agent events. **Default:** content redacted/absent; high-cardinality IDs are span attributes, not metric labels. NeuralWatt `neuralwatt:telemetry` events remain package-local; the adapter may forward numeric energy/cost fields.

## Migration conformance fixtures

Every migrated provider must pass this shared matrix (implemented in Task 1 tests, run per provider in Task 2/6):

| # | Fixture | Assert |
| ---: | --- | --- |
| 1 | UTF-8 chunk split mid-codepoint | Event data reconstructs valid Unicode |
| 2 | CRLF and LF event delimiters | Same logical events |
| 3 | Multiline `data:` field | Joined payload parses as one JSON value |
| 4 | SSE comment lines (`:`) | Ignored by default reader; NeuralWatt reader surfaces comments |
| 5 | Partial final buffer without trailing blank line | Flushed on stream end |
| 6 | `AbortSignal` during read | `ProviderTransportError` code `aborted`; reader released |
| 7 | Event exceeds `maxEventBytes` | `sse_event_overflow`; stream terminated |
| 8 | Incomplete buffer exceeds `maxBufferBytes` | `sse_buffer_overflow` |
| 9 | Error body exceeds `maxResponseBodyBytes` | `response_body_overflow`; no unbounded growth |
| 10 | Malformed tool arguments | Typed parse error with `toolName` context |
| 11 | Malformed message at index *n* | `assertOpenAIChatMessage` path in error; no content echo |
| 12 | Secret in error body | Redacted when `secrets` passed to `readBoundedResponseText` |
| 13 | Caller `authorization` header | Provider-owned header wins (existing conformance) |
| 14 | Stream order / tool-call reconstruction | Unchanged provider conformance suite |

## Security and performance notes

### Trust boundaries

| Boundary | Rule |
| --- | --- |
| Credentials | Resolved in provider package; provider-owned `authorization` overrides caller headers |
| Redaction order | Secrets redacted **before** error strings, ledger rows, events, and observability metadata |
| Transport errors | Include limit kind and byte ceiling — never full bodies, tokens, or prompts |
| Structured-output schemas | JSON-safe objects only; reject `__proto__` / `prototype` / `constructor` keys; size cap enforced |
| OAuth (Task 3) | Device/authorization/access/refresh tokens redacted from all token-endpoint failures |
| Observability | Metadata-only by default; prompt/content/tool payloads opt-in and redacted |

### Performance defaults

| Limit | Default | Override |
| --- | ---: | --- |
| `maxEventBytes` | 256 KiB | Per-request `BoundedStreamLimits` |
| `maxBufferBytes` | 512 KiB | Per-request |
| `maxResponseBodyBytes` | 64 KiB | Per-request |
| Observability overhead (Task 5 target) | <5% vs disabled | Excludes exporter I/O |

## Related APIs

- [Provider layer](provider-layer.md): registry, mock provider, event helpers
- [Provider conformance](provider-conformance.md): stream order, abort, header ownership
- [OpenAI-compatible provider](providers/openai-compatible.md): reference adapter subpath
- [Structured output](structured-output.md): artifact loop fallback
- [Provider request policies](provider-request-policies.md): cache and request hooks
- [Review coverage (2026-07-14)](review-coverage-2026-07-14.md): finding → plan traceability

## Task ownership map

| Finding / capability | Plan 054 task | Primitive / doc |
| --- | --- | --- |
| R-008 Unbounded SSE/error bodies | 1, 2 | `readSseEvents`, `readBoundedResponseText` |
| R-009 OAuth device polling | 3 | `packages/provider-openai/src/oauth.ts` |
| R-010 Duplicated helpers | 1, 2 | This page + subpaths |
| C-002 Native structured output | 4 | `StructuredOutputOptions` |
| C-004 Shared resilient transport | 1, 2 | `providers/transport` |
| C-008 Observability hooks | 5 | `ProviderTurnMetadata`, optional OTel package |
