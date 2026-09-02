# Phase 55 — Primitive review: shared serializers for the hyper and commandcode adapters

Primitive review for `plans/055-First-Class-Hyper-And-Command-Code-Providers.md` Task 1:
confirm reuse of shared serializers and extract one shared Anthropic Messages
body/events helper so neither new adapter copies a package-local variant.

## Inventory

| Module | Location | Verdict |
| --- | --- | --- |
| `buildOpenAIChatBody` / `openAIChatEvents` | core subpath `@arnilo/prism/providers/openai-compatible` | **Reuse** — already the shared chat-route serializer (opencode-go imports it; hyper + commandcode do the same). |
| `applyOpenAIChatStructuredOutput` | core subpath `@arnilo/prism/providers/openai` | **Reuse** — structured-output enforcement on chat routes. |
| Anthropic Messages serializer | `packages/prism-providers/src/opencode-go/anthropic-messages.ts` (254 lines, extractor source) | **Copy #1** — complete body + SSE events serializer. |
| Anthropic route serialization | `packages/prism-providers/src/kimi/provider.ts` (inline) | **Copy #2** — inline in the kimi provider, not importable. |
| Anthropic Messages serialization | `packages/prism-providers/src/anthropic/` (native package) | **Keep** — native package's own serializer with richer native features (stream control, token counting); not a route-compat serializer, out of scope. |
| Shared Anthropic Messages serializer | core (`src/`) | **Missing** — no core subpath exists; extraction needed. |
| Cache-control application | per-provider `cache.ts` (opencode-go, kimi, …) | **Hook** — provider-specific cache markers stay per-provider. |
| Thinking / owned-compat handling | per-provider `thinking.ts` | **Hook** — provider-specific preserve/strip logic stays per-provider. |
| Media helpers (`bytesToBase64`, `isPdfMediaType`, `rejectProviderMediaBlock`, `resolveProviderMediaMessages`, `serializePdfDocumentWireBlock`) | core subpath `@arnilo/prism/providers/media` | **Reuse** (as opencode-go does). |
| SSE reader `readSseData` | core subpath `@arnilo/prism/providers/transport` | **Reuse**. |
| Event constructors (`provider*Delta`, `providerToolCall`, `providerUsage`, `providerDone`, `providerError`, `systemCacheControlField`, `toolCallFromArgumentsText`, `canonicalizeJsonSchema`) | `@arnilo/prism` core | **Reuse**. |

## Decision

Extract the opencode-go Anthropic Messages serializer into a shared internal module

- `packages/prism-providers/src/shared/anthropic-messages.ts`

with provider-specific behavior injected as hooks (no provider-name branching in
shared code):

```ts
export interface AnthropicMessagesRouteHooks {
  readonly applyCacheControl: (request: ProviderRequest) => readonly CacheControlledMessage[];
  readonly preserveThinking: (request: ProviderRequest) => boolean;
  readonly stripOwnedCompat: (compat: JsonObject | undefined) => JsonObject | undefined;
}
export async function anthropicMessagesBody(request: ProviderRequest, hooks: AnthropicMessagesRouteHooks): Promise<JsonObject>
export async function* anthropicMessagesEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<ProviderEvent>
```

- **hyper** (Task 2) and **commandcode** (Task 4) import this module and bind their
  own `cache.ts` / `thinking.ts` hooks — no third/fourth package-local copy.
- opencode-go, kimi, and the native anthropic package are **not refactored**
  (independent publication ranges; identical behavior, no churn). Unification at
  the next release cut that already touches those packages is a recorded follow-up.
- The stream-truncation error wording changed
  from "OpenCode Go messages stream…" to the provider-agnostic
  "Anthropic messages stream ended without completion evidence" — opencode-go's
  tests only regex-match `/completion evidence/` and `/message_stop/`, so its suite
  stays green against either wording; the shared module's own test asserts the same
  regexes.

## API shape notes

- Hook contract mirrors exactly what the opencode-go serializer called:
  `applyOpencodeAnthropicCacheControl(request)` → `hooks.applyCacheControl(request)`;
  `openCodeGoPreserveThinking(request)` → `hooks.preserveThinking(request)`;
  `stripOpenCodeGoOwnedCompat(request.options?.compat)` → `hooks.stripOwnedCompat(request.options?.compat)`.
- `anthropicMessagesBody` keeps the opencode-go wire behavior: system block with
  `systemCacheControlField`, maximal `max_tokens` default, `stream: true`,
  caller `extra` fields last, owned compat removed.
- `anthropicMessagesEvents` keeps truncation hardening (error on missing
  `message_stop` or dangling tool blocks, never a false `done`) and the
  `cache_read_input_tokens` / `cache_creation_input_tokens` → `Usage` mapping.

## Test coverage

- `packages/prism-providers/src/shared/__tests__/anthropic-messages.test.ts`
  (offline, `node:test`): body serialization (roles, system, thinking blocks with
  signature, cache marker placement, owned-compat stripping, tool schema
  canonicalization), events stream (deltas, tool reconstruction, usage incl.
  cache read/write, `done`), and truncated-stream failure (`error`, no `done`).
- The hyper and commandcode conformance suites (Tasks 2 and 4) exercise the same
  module through real adapters.

## Follow-up

- Unify opencode-go / kimi package-local serializer copies onto the shared module
  when a changed-package release cut next touches either package.