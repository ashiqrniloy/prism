# Provider-Neutral Modality Contracts

Source: `docs/_evidence/implementation-review-2026-09-03.md` §7 P0 gaps and §8 step 5
(modalities last, after surface shrinks). Prism covers text/tool agents, structured
output, multimodal **input**, reasoning, caching, Realtime, memory/RAG — but lacks
provider-neutral contracts for embeddings **output**, image generation, speech
synthesis/transcription, video, moderation, and async provider batch jobs.

Gate: start this plan only after plans 056–058 close (security, gates, surface) so new
contracts land on a shrinking, hardened surface. Status at Task 1 (2026-09-03): 057
done, 056/058 open — Task 1 is analysis-only (no surface added); tasks 2–7 stayed gated
by the analysis-only exception. Status 2026-09-03: **complete** — Tasks 1–8 done;
evidence in `docs/_evidence/modality-contracts-2026-09-03.md` (live-probe ledger all
"probe pending").

## Objectives

- One stable, provider-neutral contract per missing modality, shaped like existing `AIProvider` seams (capability-declaring, usage-reporting, cancelable).
- At least two adapters per contract (OpenAI-compatible route + one independent provider) plus conformance helpers.
- Every contract offline-testable; live verification operator-gated (plan 055 ledger precedent).

## Expected Outcome

- `@arnilo/prism` (or `@arnilo/prism-providers` subpaths) exports: `EmbeddingsProvider`, `ImageGenerationProvider`, `SpeechProvider`, `TranscriptionProvider`, `ModerationProvider`, `BatchJobsProvider` + typed events/usage.
- Capability metadata (`model.capabilities`) gains the matching flags so `assertXSupported` guards work uniformly.
- Conformance suites (phase8–11 pattern) cover each contract with a fake provider; no network in default gates.
- Docs page per API following the prism-wiki API structure.

## Tasks

- [x] Primitive review: inventory existing seams before any new contract
  - Acceptance Criteria:
    - Functional: inventory of `src/contracts-core/provider.ts`, `src/provider-events.ts`, capability metadata, Realtime path, memory embeddings host contract, and Alibaba embeddings adapter — documented with what each missing modality can reuse vs genuinely needs.
    - Performance: n/a (analysis).
    - Code Quality: evidence file concludes "generic primitives to add" (the six contracts) and rejects any modality-specific core logic.
    - Security: contract sketch includes auth/egress reuse (existing provider credential seams) — no new secret paths.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts-core/provider.ts`, `src/contracts.ts` (graft skeleton).
      - `packages/prism-providers/src/alibaba/embeddings.ts` (existing concrete embeddings adapter).
      - `packages/memory` embeddings host contract; `docs/provider-conformance.md`; `docs/public-contracts.md`.
    - Options Considered:
      - Per-provider ad-hoc exports (rejected: no portability — the review's point).
      - Contracts first, adapters on top (chosen; matches how Realtime/structured output were added).
    - Chosen Approach: one evidence-driven contract design doc, then build in dependency order (embeddings → speech → image → video → moderation → batch).
    - API Notes and Examples:
      ```ts
      // shape sketch (finalized in evidence doc):
      interface EmbeddingsProvider {
        readonly id: string;
        embedMany(request: EmbeddingsRequest, context?: RequestContext): Promise<EmbeddingsResult>;
      }
      interface EmbeddingsResult {
        readonly vectors: readonly (readonly number[])[];
        readonly usage: Usage;
        readonly dimensions: number;
      }
      ```
    - Files to Create/Edit:
      - `docs/_evidence/modality-primitive-review-<date>.md` (create).
    - References: skill primitive-review rule; review §7; plan 055 primitive-review precedent.
  - Test Cases to Write: n/a (analysis).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (design only).
    - Docs pages to create/edit: evidence doc.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Embeddings contract + adapters
  - Acceptance Criteria:
    - Functional: provider-neutral `embedMany` (batch, dimensions, usage, per-item error mapping) exported; adapters: OpenAI-compatible `/v1/embeddings` and Alibaba (existing response types reused); memory package consumes contract instead of host-only seam where compatible.
    - Performance: batch size honored; no per-vector allocations beyond response mapping.
    - Code Quality: conformance helper `runEmbeddingsConformance(provider)` + fake-provider tests; capability flag `capabilities.embeddings`.
    - Security: input size caps (tokens/batches) with typed errors; keys via existing credential seams; no content logged.
  - Approach:
    - Documentation Reviewed:
      - Alibaba embeddings adapter (response shapes); OpenAI embeddings API (batch limits, `dimensions` param, usage object).
      - `docs/provider-conformance.md` conformance-table format.
    - Options Considered:
      - Streaming embeddings (no mainstream provider streams embeddings; rejected).
      - One-shot batch contract (chosen).
    - Chosen Approach: `embedMany` contract; per-adapters cap enforcement; conformance suite.
    - API Notes and Examples:
      ```ts
      const result = await provider.embedMany({
        model: "text-embedding-3-small",
        inputs: ["hello", "world"],
      });
      // result.vectors.length === 2; result.usage.inputTokens reported
      ```
    - Files to Create/Edit:
      - `src/contracts-core/embeddings.ts` (create) or providers-family module (per evidence doc); `packages/prism-providers/src/openai/embeddings.ts` (create); `packages/prism-providers/src/alibaba/embeddings.ts` (extend to contract); conformance + tests.
    - References: review §7 P0-1.
  - Test Cases to Write:
    - Conformance fake: batch/dimensions/usage mapping, empty-input error, oversized-batch typed error.
    - Adapter offline tests with recorded payloads (no network).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public contract.
    - Docs pages to create/edit:
      - `docs/embeddings.md` (create, prism-wiki API structure).
    - `docs/index.md` update: yes — "Provider and model connection" group entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Speech synthesis + transcription contract + adapters
  - Acceptance Criteria:
    - Functional: `SpeechProvider.synthesize` (text→audio bytes/stream with voice/format options) and `TranscriptionProvider.transcribe` (audio→text, streaming partial events where the provider supports); adapters: OpenAI audio routes; capability flags `speech`/`transcription`.
    - Performance: streaming synthesis emits first byte < provider RTT + 200 ms (fake test asserts event order, not wall clock).
    - Code Quality: audio bytes as `Uint8Array`/`ReadableStream` (Web streams, matching repo conventions); conformance helpers for both.
    - Security: audio size caps; no audio content logged; egress through existing policy seam.
  - Approach:
    - Documentation Reviewed:
      - OpenAI speech (`/v1/audio/speech`, voices/formats) and transcription (`/v1/audio/transcriptions`, streaming `verbose_json`) API docs.
      - Existing Realtime transcription path in root provider (event shapes to align with).
    - Options Considered:
      - Fold transcription into Realtime only (rejected: no portable one-shot API).
      - Separate one-shot + streaming contracts sharing event types (chosen).
    - Chosen Approach: two small contracts, shared `TranscriptDelta` event type aligned with Realtime naming.
    - API Notes and Examples:
      ```ts
      const audio = await speech.synthesize({ model: "tts-1", input: "hi", voice: "alloy" });
      for await (const partial of transcription.transcribeStream(audioStream)) { /* partial.text */ }
      ```
    - Files to Create/Edit:
      - contracts modules (per evidence layout); `packages/prism-providers/src/openai/{speech,transcription}.ts` (create); tests + conformance.
    - References: review §7 P0-3; root Realtime implementation.
  - Test Cases to Write:
    - Fake-provider event ordering (synth byte stream, transcript deltas then done+usage).
    - Cap enforcement on oversized audio input.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new contracts.
    - Docs pages to create/edit: `docs/speech.md` (create, both APIs).
    - `docs/index.md` update: yes — entry under provider group.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Image generation/editing contract + adapters
  - Acceptance Criteria:
    - Functional: `ImageGenerationProvider` with generate (prompt→image[s], size/format/quality options) and edit (image+mask+prompt input reusing existing image **input** content parts); adapters: OpenAI-compatible images routes + one independent (Alibaba or Google, per evidence doc); capability flag `imageGeneration`.
    - Performance: response mapping allocates only per-image; no base64 re-encode loops.
    - Code Quality: image parts expressed as existing binary content types; conformance helper.
    - Security: prompt/content caps; generated-content provenance field (`provider`, `model`) preserved; no local disk writes.
  - Approach:
    - Documentation Reviewed: OpenAI images API (generate/edits, b64 vs URL); existing multimodal input content-part types in contracts.
    - Options Considered: URL-returning vs bytes-returning contract (chosen: bytes + optional provider URL passthrough — hosts own persistence).
    - Chosen Approach: contract returns `Uint8Array` + metadata; host decides storage.
    - API Notes and Examples:
      ```ts
      const { images } = await images.generate({ model: "gpt-image-1", prompt: "a red cube", size: "1024x1024" });
      // images[0] = { bytes: Uint8Array, mimeType: "image/png", provider: "openai" }
      ```
    - Files to Create/Edit: contracts module; `packages/prism-providers/src/openai/images.ts` (create); second adapter per evidence; tests.
    - References: review §7 P0-2.
  - Test Cases to Write:
    - Fake round-trip options mapping; b64 decode failure typed error; cap enforcement.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: `docs/image-generation.md` (create).
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Video modality contract (input + output capability)
  - Acceptance Criteria:
    - Functional: video accepted as first-class multimodal **input** content part (typed `video` part with duration/size caps) on providers declaring `capabilities.videoInput`; minimal `VideoGenerationProvider` submit/status/poll contract for providers that generate video; Alibaba `file`-mapped video path migrated to the typed part.
    - Performance: no eager buffer loads — streaming upload where adapter supports it.
    - Code Quality: capability flags checked via the same `assertXSupported` guard pattern as structured output.
    - Security: size/duration caps; content never logged; egress policy applies.
  - Approach:
    - Documentation Reviewed: current Alibaba video-through-`file` mapping; provider capability metadata structure.
    - Options Considered: wait for stable upstream video APIs (deferred output contract) vs minimal submit/status now (chosen for input, gated minimal output).
    - Chosen Approach: typed input part now; output contract minimal (submit/status/result) with conformance via fake.
    - API Notes and Examples:
      ```ts
      content: [{ type: "video", data: videoBytes, mimeType: "video/mp4" }]
      ```
    - Files to Create/Edit: contracts content-part module; alibaba adapter update; conformance fake; tests.
    - References: review §7 P0-4.
  - Test Cases to Write:
    - Capability-missing model + video part → typed unsupported error (mirror structured-output guard test).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new content part type.
    - Docs pages to create/edit: `docs/multimodal.md` (create or extend existing multimodal docs page).
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Moderation classification contract + adapter
  - Acceptance Criteria:
    - Functional: `ModerationProvider.moderate` (text → per-category scores + flagged booleans, provider-neutral category map with raw passthrough); OpenAI-compatible moderation adapter; guardrail seam can consume it.
    - Performance: single request per call; batch input supported where provider allows.
    - Code Quality: conformance helper; category mapping table data-driven per provider.
    - Security: scores are provider output — no local policy decisions baked into core; host policy decides thresholds.
  - Approach:
    - Documentation Reviewed: OpenAI moderation API (categories, scores); existing guardrail seams in agent loop.
    - Options Considered: bake moderation into agent loop default (rejected — policy is host-owned per review §1) vs contract + opt-in (chosen).
    - Chosen Approach: standalone contract; host/guardrail wires it.
    - API Notes and Examples:
      ```ts
      const { flagged, categories } = await moderation.moderate({ input: text });
      // categories.violence.flagged, categories.violence.score …
      ```
    - Files to Create/Edit: contracts module; `packages/prism-providers/src/openai/moderation.ts` (create); tests.
    - References: review §7 P0-5; `docs/host-security.md` policy ownership.
  - Test Cases to Write:
    - Fake category mapping; unknown-category passthrough preserved; no network.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: `docs/moderation.md` (create).
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Async provider batch jobs contract
  - Acceptance Criteria:
    - Functional: `BatchJobsProvider` with `submit` (requests+metadata → job id), `status`, `cancel`, `results` (paged); OpenAI-compatible batch adapter; capability flag `batchJobs`.
    - Performance: polling helper with backoff exported as utility, not loop-integrated.
    - Code Quality: job states typed union; conformance fake covers state transitions incl. failure/cancel.
    - Security: request payloads inherit provider caps; job ids are opaque; credentials via existing seams.
  - Approach:
    - Documentation Reviewed: OpenAI batch API (file upload + job lifecycle); review §7 P0-6 ("existing batch means local batching").
    - Options Considered: integrate with workflows saga (rejected for v1 — coupling); standalone contract + poll utility (chosen).
    - Chosen Approach: standalone contract; workflow integration listed in Further Actions.
    - API Notes and Examples:
      ```ts
      const job = await batch.submit({ model, requests });
      const done = await pollBatch(batch, job.id, { intervalMs: 30_000 });
      const page1 = await batch.results(done.id, { cursor: null });
      ```
    - Files to Create/Edit: contracts module; `packages/prism-providers/src/openai/batch.ts` (create); poll utility; tests.
    - References: review §7 P0-6.
  - Test Cases to Write:
    - Fake lifecycle: submitted→in_progress→completed with paged results; cancel mid-run; failure state surfaces typed error.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: `docs/batch-jobs.md` (create).
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Docs, budgets, and verification
  - Acceptance Criteria:
    - Functional: all six docs pages exist per prism-wiki API structure; `docs/provider-conformance.md` gains modality conformance table rows; offline suite + coverage green; budgets updated with any export-count additions (reason strings).
    - Performance: suite budget within release norms.
    - Code Quality: `docs/_evidence/modality-contracts-<date>.md` evidence page; per-adapter live-probe ledger rows (plan 055 format) marked "probe pending".
    - Security: no secrets in tests; redaction assertions per adapter error path.
  - Approach:
    - Documentation Reviewed: prism-wiki API page structure; plan 055 evidence format.
    - Options Considered: n/a (verification).
    - Chosen Approach: write docs, run gates, record evidence, update `plans/README.md`.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: docs pages; evidence file; `scripts/budgets.json` (if ceilings added); this plan's checkboxes.
    - References: review §7, §8 step 5.
  - Test Cases to Write: n/a (runs suites).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (docs for new contracts).
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes — six new entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Task 1 (2026-09-03): evidence at `docs/_evidence/modality-primitive-review-2026-09-03.md`.
  Inventory found auth/redaction/bounded-transport/egress/capability/guard/conformance
  primitives all present; exactly six contracts + capability flags + guards are the
  generic primitives to add; modality-specific core logic rejected. Memory keeps its
  dependency-free `Embedder`; contract adapters bridge structurally. Gate note: 056/058
  still open — contract tasks not started.
- Task 2 (2026-09-03): contract at `src/contracts-core/embeddings.ts` (`EmbeddingsRequest`
  carries the `AbortSignal` — no `RequestContext` parameter; the type does not exist).
  Strict batch semantics: adapters reject over-cap batches and empty inputs with typed
  `EmbeddingsError` codes instead of auto-chunking — callers own batching
  (`embedBatched`); per-item token caps stay server-enforced (local cap = batch count).
  `result.dimensions` reports the actual response vector length, not the request value.
  Adapters: `createOpenAIEmbeddingsProvider` (cap 2048) and
  `createAlibabaEmbeddingsProvider` (cap 10, shared request fn with the embedder, whose
  single-resolve-per-`embed()` credential behavior is preserved). `createAlibabaEmbedder`
  now delegates to the shared call — same wire shape/messages, plus typed error codes and
  usage mapping. `runEmbeddingsConformance` in `@arnilo/prism/testing/provider-conformance`
  probes empty-input, oversized-batch, and vector mapping offline. Memory package
  unchanged: consumption stays structural (no new dependency), per the Task 1 evidence
  conclusion. Budgets rebaselined: @arnilo/prism 1170→1179, @arnilo/prism-providers
  415→420 (reason strings in `scripts/budgets.json`); frozen-export snapshot updated in
  `src/__tests__/public-export-contract.test.ts`. Offline evidence: root suite 1585 green,
  providers 526 green, memory 293 green, docs 149 green; live probe ledger deferred to
  Task 8.
- Task 3 (2026-09-03): contracts at `src/contracts-core/speech.ts` +
  `src/contracts-core/transcription.ts` (separate modules, one modality each, per the
  Task 1 evidence layout); `TranscriptDelta` names the Realtime `transcript_delta` event
  shape without `role` (one-shot transcription has no speaker turn). One-shot speech
  synthesis returns full bytes; `synthesizeStream` returns a Web `ReadableStream<Uint8Array>`
  under a response byte ceiling (`DEFAULT_SPEECH_MAX_AUDIO_BYTES` 25 MiB, `maxAudioBytes`
  override) — first-chunk ordering asserted by conformance, not wall clock. Transcription
  one-shot posts multipart (stdlib `FormData`/`Blob`, runtime sets the boundary) and the
  streaming variant uses `stream: true` + `stream_include_usage: true` SSE
  (`transcript.text.delta`/`transcript.text.done`) via the existing `readSseData`; usage
  maps snake_case → `Usage`. Caps reject typed (`input_too_large` 4,096 chars speech,
  `audio_too_large` 25 MiB transcription) before any network I/O; responses never
  truncated silently. Adapters: `createOpenAISpeechProvider` and
  `createOpenAITranscriptionProvider` (OpenAI only — Task 1 evidence: Alibaba has no
  first-party speech endpoint). `runSpeechConformance`/`runTranscriptionConformance`
  probe typed caps, byte/first-chunk ordering, and delta-then-one-done event order
  offline. Streaming is one-directional (audio out / text in): interactive bidirectional
  voice stays on the Realtime session contract. Budgets rebaselined: @arnilo/prism
  1179→1201, @arnilo/prism-providers 420→427; frozen-export snapshot updated. Offline
  evidence: root suite 1595 green, providers 539 green, docs 149 green; live probe ledger
  deferred to Task 8.
- Task 4 (2026-09-03): contract at `src/contracts-core/images.ts` — `generate` + `edit`
  returning `Uint8Array` bytes with `provider`/`model` provenance per `GeneratedImage`
  (hosts own persistence; no disk writes, no URL-only contract); edit inputs reuse the
  existing `ImageContent` parts (base64 `data` decodes inline, `url` parts resolve via
  `pinnedFetch`). Adapters: `createOpenAIImageGenerationProvider` (`b64_json` always,
  canonical round-trip base64 validation — Node's decoder is lenient, multipart edits)
  and `createAlibabaImageGenerationProvider` (DashScope wanx async task API: submit with
  `X-DashScope-Async: enable`, poll to terminal status with `pollIntervalMs`/`timeoutMs`,
  download result URLs). Alibaba `edit` rejects typed `unsupported_operation` — DashScope
  has no first-party image-edit route; a lying adapter was rejected. URL fetching got an
  injectable `fetchUrl` option (default `pinnedFetch`) because `pinnedFetch` is DNS-pinned
  by design and cannot be intercepted by fetch stubs in offline tests. Caps reject typed
  before network I/O (prompt 32,000 chars OpenAI / 800 wanx, count 10/4, `maxImageBytes`
  25 MiB). `runImageGenerationConformance` probes typed caps, image count, byte shape,
  `image/*` mime, and provenance preservation offline. Budgets rebaselined:
  @arnilo/prism 1201→1212, @arnilo/prism-providers 427→436; frozen-export snapshot
  updated. Offline evidence: root suite 1601 green, providers 552 green, docs 149 green;
  live probe ledger deferred to Task 8.
- Task 5 (2026-09-03): input half — typed `VideoContent` part in
  `src/contracts-core/content.ts` (mediaType/name/data/url/resourceUri/durationMs/fps),
  `"video"` added to `MODEL_INPUT_CAPABILITIES`, `contentBlockInputModality` maps it, so
  the existing media-capability guard chain checks it for free. Alibaba `video_url`
  mapping migrated off the `file`-part workaround: typed `video` parts gate on
  `input.includes("video")`, qwen-vl model inference now declares `["text","image",
  "file","video"]`, and video-through-`file` throws like other unsupported file forms
  (capability-honest; existing tests migrated). Output half — minimal
  `VideoGenerationProvider` at `src/contracts-core/video.ts`: `submit(request)` →
  `{ jobId }` and point-in-time `status(jobId)` → `VideoGenerationJob`
  (`queued/running/succeeded/failed`), video results carry `provider`/`model`
  provenance plus `bytes` or `url`; hosts own polling; `capabilities.videoGeneration`
  flag + guard pair. Adapter: `createAlibabaVideoGenerationProvider` (DashScope wanx
  t2v + i2v routes, `waitFor()` convenience poller) — the contract's status responses
  don't echo the model, so the adapter remembers submitted job→model in memory
  (`ponytail:` ceiling: provenance model degrades to the adapter id after restart;
  persist host-side if that matters). `runVideoGenerationConformance` probes typed
  caps, terminal-state reachability, and provenance offline. Artifact-diet + export
  budgets rebaselined: root pack 1026702/3464819/409 → 1046502/3529890/432,
  @arnilo/prism 1212→1225, @arnilo/prism-providers 436→440; frozen-export snapshot
  updated. Offline evidence: root suite 1608 green, providers 558 green, budgets 13
  green; live probe ledger deferred to Task 8.
- Task 6 (2026-09-03): contract at `src/contracts-core/moderation.ts` —
  `moderate({ input: string | readonly string[] })` → per-category
  `{ score, flagged }` verdicts under the provider-neutral `MODERATION_CATEGORIES`
  vocabulary (13 canonical keys), with the provider's raw response preserved on
  `result.raw` for audits; batch results match input arity/order. Scores and
  flagged booleans are provider output verbatim — no local thresholds anywhere in
  core (host-owned policy per review §1); conformance asserts scores stay in
  [0,1] and unknown vendor categories pass through untouched.
  `capabilities.moderation` flag + guard pair. Adapter:
  `createOpenAIModerationProvider` (`POST /v1/moderations`, default
  `omni-moderation-latest`) — data-driven category mapping table (plan criterion),
  one provider request per input, bounded JSON reads (8 MiB), typed caps before
  network I/O (100k chars, conservative — no provider-documented limit), secret
  redaction on every error path. `runModerationConformance` probes typed caps,
  verdict shape, passthrough, and score range offline. Budgets rebaselined:
  @arnilo/prism 1225→1237, @arnilo/prism-providers 440→447; frozen-export snapshot
  updated; docs/moderation.md + index entry added. Offline evidence: root suite
  1615 green, providers 564 green, budgets 13 green; live probe ledger deferred
  to Task 8.
- Task 7 (2026-09-03): contract at `src/contracts-core/batch.ts` — standalone
  `BatchJobsProvider` (`submit`/`status`/`cancel`/paged `results`, opaque job
  ids, provider-native `JsonObject` bodies riding the provider's request caps),
  typed seven-state job union (`queued`/`running`/`cancelling` +
  `completed`/`failed`/`cancelled`/`expired`) with `isBatchJobTerminal`, and
  `pollBatch` exported as a plain backoff utility — never loop-integrated
  (plan decision: no workflow-saga coupling in v1, listed in Further Actions).
  `capabilities.batchJobs` flag + guard pair. Adapter:
  `createOpenAIBatchJobsProvider` — Files API JSONL upload + `/v1/batches`
  lifecycle, neutral state mapping, client-side paging over the output/error
  JSONL with line-offset cursors (opaque continuation tokens), bounded reads
  (256 MiB for JSONL downloads), typed caps before network (50k lines/job,
  OpenAI's documented limit), per-call credential resolution + redaction on
  every error path. `runBatchJobsConformance` probes typed empty/oversized
  submits, opaque ids, state-union membership, `pollBatch` terminal resolution,
  and paged-results walk to exhaustion with cursor continuity; failure/cancel
  transitions covered by fakes (fake lifecycle: queued→running→completed with
  paged results, cancel mid-run → typed `job_cancelled`, failure → typed
  `job_failed` with provider message). Budgets rebaselined:
  @arnilo/prism 1237→1255, @arnilo/prism-providers 447→454; frozen-export
  snapshot updated; docs/batch-jobs.md + index entry added. Offline evidence:
  root suite 1623 green, providers 573 green, budgets 13 green; live probe
  ledger deferred to Task 8.
- Task 8 (2026-09-03): verification evidence at
  `docs/_evidence/modality-contracts-2026-09-03.md` — gate results (core 1623
  green, providers 573 green, budgets 13 green), contract/adapter inventory,
  per-task export-count budget deltas with reason strings, and the per-adapter
  live-probe ledger (plan 055 format; all nine rows **probe pending** with
  explicit unknowns). `docs/provider-conformance.md` gained the modality
  conformance matrix (seven contracts, offline evidence, live-probe column).
  Six docs pages exist per the prism-wiki API structure with one index entry
  each. Pre-existing failure surfaced and documented in the evidence file:
  `scripts/phase23-skip-manifest.test.mjs` fails identically at clean HEAD
  (stale post-consolidation thresholds leave `PRISM_TEST_POSTGRES_URL` uncovered
  among protected classes) — belongs to plan 056 follow-up, not this plan.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
