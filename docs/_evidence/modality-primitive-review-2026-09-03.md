# Modality primitive review — provider-neutral contracts (plan 061 Task 1)

Evidence file for plan 061 Task 1. Reviewed 2026-09-03. Source demand: implementation
review §7 P0 gaps (embeddings output, image generation, speech/transcription, video,
moderation, async batch) and §8 step 5 (modalities last, after surface shrinks).

Gate status at review time: plan 057 complete (2026-09-03); plans 056 and 058 still
planned. This task adds zero public surface (analysis only); all contract/adapters
tasks below remain gated on 056–058 closing.

## Primitive inventory (what already exists)

| Primitive | Location | What it gives the modality contracts |
| --- | --- | --- |
| `AIProvider` seam (`id` + `generate(request): AsyncIterable<ProviderEvent>`) | `src/contracts-core/provider.ts:74-77` | Shape precedent for every new contract: capability-declaring via model metadata, streaming or one-shot, `AbortSignal` on every entry point. New modalities copy this discipline, not necessarily this shape (see gap analysis). |
| `ProviderEvent` taxonomy + builder helpers (`providerUsage`, `providerDone`, `providerError`) | `src/contracts-protocol.ts:31-43`, `src/provider-events.ts` | Usage reporting and typed-error events already exist. One-shot contracts (embeddings, moderation, batch) return `{ result, usage }` style results instead of streams; the `Usage` type is reused verbatim. |
| `ModelCapabilities` (`input` modality array, `output`, `reasoning`, `tools`, `streaming`, `structuredOutput`) | `src/contracts-core/content.ts:108`, `MODEL_INPUT_CAPABILITIES` at `src/content.ts:8` | Capability metadata is model-owned, not provider-owned. Adding `embeddings`/`speech`/`transcription`/`imageGeneration`/`videoInput`/`batchJobs` flags extends this one interface — no per-provider capability plumbing. |
| Capability guard precedents | `modelSupportsStructuredOutput` + `StructuredOutputError` (`src/structured-output.ts`), `assertProviderMediaCapability` + `UnsupportedModalityError` (`src/providers/media.ts`) | `assertXSupported` guard pattern with typed error + stable `code` union is established twice; every new flag gets the same-shaped guard. |
| `RealtimeSession` seam (`sendAudio`/`events`/`interrupt`/`close`, `RealtimeCaps` finite caps) | `src/contracts-core/provider.ts:84-111`, OpenAI impl `packages/prism-providers/src/openai/realtime.ts` | Precedent for a seam that is deliberately NOT `AIProvider`: bidirectional/session-shaped modalities get their own interface. Credentials bound at handshake only; fake-WebSocket offline tests prove caps. |
| `RealtimeEvent.transcript_delta` (`{ text, role }`) | `src/contracts-protocol.ts:49-57` | Naming/type anchor for the transcription streaming contract — `TranscriptDelta` aligns with this, no new event vocabulary. |
| Memory host `Embedder` (`id`, `dimensions`, `embed(texts, {signal})`) + `embedBatched` + `createHashEmbedder` fake | `packages/memory/src/types.ts:48`, `packages/memory/src/embedder.ts` | Host-side embedding consumption already works dependency-free via structural typing. The new `EmbeddingsProvider` contract must be a strict superset (adds `usage`, per-item errors, dimensions negotiation); a structural adapter bridges it into `Embedder` — the memory package should NOT import the contract. |
| Alibaba embeddings adapter (batch cap 10, per-call credential resolve, redaction, bounded reads, index-ordered mapping, empty-input short-circuit) | `packages/prism-providers/src/alibaba/embeddings.ts` | Full offline-testable adapter precedent. Gaps to fix when adopted to the contract: no usage reporting, untyped `Error` (no code union), batch cap silent (no typed oversized-batch error). |
| Credential seams (`CredentialValueSource`, `resolveCredentialValue`) | `src/credentials.ts:11` | All adapters resolve keys per call through this seam — no new secret paths. |
| Redaction (`redactSecrets`, `errorToErrorInfo(error, secrets)`) | `src/redaction.ts:86` | Every adapter error path threads secrets through this; conformance `assertNoSecretLeak` asserts it offline. |
| Bounded transport (`readBoundedResponseText/Json`, `readSseEvents`, `ProviderTransportError`, `httpStatusError`) | `src/providers/transport.ts` | Wire I/O for all new adapters: bounded reads, SSE parsing, status classification — none of it re-implemented per modality. |
| Outbound media egress (`pinnedFetch` with `SsrfPolicy`, redirect rejection, byte-bounded streams) | `src/pinned-fetch.ts` | Egress policy for any URL-fetching adapter (image generation URL passthrough, video part URL resolution). Audio/image content never logged. |
| Multimodal input content parts (`image`/`audio`/`file`/`document` base64-or-URL blocks) + 10 MB per-item media ceiling | `src/content.ts`, `DEFAULT_MAX_MEDIA_ITEM_BYTES` | Image-edit and video input reuse these part types; size caps extend the existing constant, not a new cap system. |
| `ProviderRequestPolicy` chain | `src/provider-request-policy.ts` | Host-side request mutation/redaction applies to new contracts' request objects uniformly. |
| Conformance pattern (offline assertion helpers, per-package matrix, operator-gated live probes) | `docs/provider-conformance.md`, `@arnilo/prism/testing/provider-conformance` | `runEmbeddingsConformance`-style helpers follow the phase8–11 pattern: fake provider, no network in default gates, live verification via `PRISM_LIVE_PROVIDER_TESTS=1`-style env gates (plan 055 ledger precedent). |
| Alibaba video-through-`file` mapping (video as `file` part → `video_url`, gated on `file` capability) | `packages/prism-providers/src/alibaba/provider.ts:134-143` | Today's workaround proves demand but is capability-dishonest (video ≠ `file`). Task 4 migrates it to a typed `video` part + `videoInput` capability. |

## Reuse vs. genuinely-needed, per modality

| Modality | Reuses as-is | Genuinely needs |
| --- | --- | --- |
| Embeddings | credential/redaction/bounded-transport pattern (Alibaba adapter is a working draft); `Usage`; `Embedder` structural bridge; conformance pattern | New `EmbeddingsProvider` one-shot contract (`embedMany` → vectors + usage + dimensions + per-item errors); `capabilities.embeddings` flag; typed oversized-batch/empty-input errors; OpenAI-compatible adapter; memory consumes via structural adapter only |
| Speech synthesis | `Uint8Array`/`ReadableStream` byte convention (Realtime `audio_delta` already carries `Uint8Array`); `RealtimeCaps`-style finite caps; credential seams | New `SpeechProvider.synthesize` contract (text→audio bytes/stream, voice/format options); `capabilities.speech` flag; OpenAI `/v1/audio/speech` adapter |
| Transcription | `transcript_delta` event type alignment; audio byte caps; conformance pattern | `TranscriptionProvider` one-shot + streaming contracts sharing the delta type; `capabilities.transcription` flag; OpenAI `/v1/audio/transcriptions` adapter |
| Image generation | `ImageContent` part types as edit input; `metadata` provenance field pattern; `pinnedFetch` for URL passthrough | `ImageGenerationProvider` generate/edit contract returning `Uint8Array` + metadata (hosts own persistence); `capabilities.imageGeneration` flag; two adapters (OpenAI + independent) |
| Video | `MODEL_INPUT_CAPABILITIES` union + `assertProviderMediaCapability` guard + media ceiling (adding `"video"` is the single core change) | Typed `video` content part; `videoInput` capability flag; Alibaba migration off `file`-mapping; minimal submit/status `VideoGenerationProvider` for output |
| Moderation | typed error taxonomy; bounded reads; credential seams | `ModerationProvider.moderate` contract with data-driven provider-neutral category map + raw passthrough; NO core policy logic — thresholds stay host-owned |
| Batch jobs | `Usage`; typed state-union precedent (error `code` unions); poll as plain exported utility | `BatchJobsProvider` submit/status/cancel/results contract with opaque job ids and paged results; `capabilities.batchJobs` flag; no workflow-saga coupling in v1 |

## Gap analysis

**What is already achievable with existing primitives:** auth, redaction, bounded
transport, egress policy, capability metadata, guard pattern, usage reporting, and
the offline-conformance harness all exist and are provider-neutral. Every adapter
in tasks 2–7 is transport + mapping glue over these primitives; none introduces a
new security surface.

**Generic primitives to add (exactly six contracts, in dependency order
embeddings → speech → transcription → image → video → moderation → batch):**
1. `EmbeddingsProvider` + result/usage types and `capabilities.embeddings`.
2. `SpeechProvider` + `capabilities.speech`.
3. `TranscriptionProvider` (+ shared `TranscriptDelta` aligned with Realtime) + `capabilities.transcription`.
4. `ImageGenerationProvider` + `capabilities.imageGeneration`.
5. Typed `video` content part + `capabilities.videoInput`; minimal `VideoGenerationProvider` (submit/status/result).
6. `ModerationProvider`; `BatchJobsProvider` + `capabilities.batchJobs` + `pollBatch` utility.

Plus per-contract conformance helpers (phase8–11 pattern) and the matching
`ModelCapabilities` flags — capability metadata is the one existing interface all
six extend.

**Rejected — modality-specific core logic:** no provider branches, no
modality-shaped event bus, no media-handling code in `contracts-core` beyond the
typed part + capability flag, no moderation thresholds in core, no batch loop
integration in core. Core hosts interfaces, guards, and conformance only; hosts
own storage, thresholds, persistence, and scheduling (same ownership split as
`RealtimeSession` and `Embedder` today). Per-provider ad-hoc exports stay
rejected: the review's entire point is portability.

**Contract sketch (auth/egress reuse marked):**

```ts
// Reuses: CredentialValueSource (keys), redactSecrets (errors), readBoundedResponse*
// (wire caps), pinnedFetch/SsrfPolicy (URL egress), Usage (accounting), AbortSignal
// (cancellation). No new secret paths, no new transport layer.
interface EmbeddingsProvider {
  readonly id: string;
  embedMany(request: EmbeddingsRequest, context?: RequestContext): Promise<EmbeddingsResult>;
}
interface EmbeddingsResult {
  readonly vectors: readonly (readonly number[])[];
  readonly usage: Usage;          // existing Usage type, reused verbatim
  readonly dimensions: number;
}
```

## Conclusion

Build order and scope for tasks 2–7 confirmed against the inventory: contracts
first, adapters on top, conformance per contract, offline-only by default. No
primitive outside the six contracts (+ flags + guards) is needed; everything
downstream of the adapter boundary already exists and is reused unchanged.
