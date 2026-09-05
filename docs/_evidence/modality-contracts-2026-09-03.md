# Provider-Neutral Modality Contracts — Verification Evidence

Plan 061 (plan of record: `plans/061-Provider-Neutral-Modality-Contracts.md`).
Offline verification run 2026-09-03 after Tasks 1–8. This file records the gate
results, the contract/adapter inventory, the export-count budget deltas with
reason strings, and the per-adapter live-probe ledger (plan 055 format) — every
row marked **probe pending** until an operator-gated credentialed run fills it.

## 1. Gate results

| Gate | Command | Result | Notes |
| --- | --- | --- | --- |
| Core suite | `node --test dist/__tests__/*.test.js` | 1623 tests, 0 failures | includes contract tests for all six modality contracts |
| Providers suite | `npm run test --workspace @arnilo/prism-providers` | 573 tests, 0 failures (511 pass + 62 skipped protected classes) | adapter tests for embeddings, speech, transcription, images, video, moderation, batch |
| Budgets | `node --test scripts/budget-gate.test.mjs` | 13 tests, 0 failures | export-count baselines rebaselined per task with reason strings |
| Coverage | `npm run test:coverage` | suite green (1621/1621); coverage-summary + phase23-coverage gates green | see §4 for the one pre-existing failure in the skip-manifest leg |
| Docs | docs structure tests (in core suite) | green | exactly one navigation link per page in `docs/index.md` |

No secrets in tests: every adapter suite uses fake transports and fake keys; each
error path carries an assertion that the resolved credential is redacted
(`sk-openai-secret` / `sk-secret` never appears in thrown messages).

## 2. Contract and adapter inventory

| Modality | Contract | Capability flag | Conformance runner | Adapters |
| --- | --- | --- | --- | --- |
| Embeddings | `src/contracts-core/embeddings.ts` | `capabilities.embeddings` | `runEmbeddingsConformance` | OpenAI (`/v1/embeddings`), Alibaba DashScope |
| Speech | `src/contracts-core/speech.ts` | `capabilities.speech` | `runSpeechConformance` | OpenAI (`/v1/audio/speech`) |
| Transcription | `src/contracts-core/transcription.ts` | `capabilities.transcription` | `runTranscriptionConformance` | OpenAI (`/v1/audio/transcriptions`) |
| Image generation/editing | `src/contracts-core/images.ts` | `capabilities.imageGeneration` | `runImageGenerationConformance` | OpenAI (`/v1/images/*`), Alibaba DashScope wanx |
| Video (input + generation) | `src/contracts-core/video.ts` + typed `VideoContent` part | `capabilities.videoGeneration` / `"video"` input tag | `runVideoGenerationConformance` | Alibaba DashScope wanx (submit/status) |
| Moderation | `src/contracts-core/moderation.ts` | `capabilities.moderation` | `runModerationConformance` | OpenAI (`/v1/moderations`) |
| Batch jobs | `src/contracts-core/batch.ts` | `capabilities.batchJobs` | `runBatchJobsConformance` + `pollBatch` utility | OpenAI (Files API + `/v1/batches`) |

Shared seams reused, not reinvented: `CredentialValueSource` (per-call
resolution), `redactSecrets` on every error path, bounded response readers
(`readBoundedResponseJson`/`Text`), `pinnedFetch` for URL resolution, typed
error-code unions per contract, guard pairs (`assert*Supported` /
`modelSupports*`), frozen-export + budget gates.

## 3. Export-count budget deltas (reason strings)

| Package | Baseline move | Reason |
| --- | --- | --- |
| `@arnilo/prism` | 1170 → 1179 | Task 2: embeddings contract (+9: request/result/provider/error types, `EmbeddingsError`/`modelSupportsEmbeddings`/`assertEmbeddingsSupported` values, `runEmbeddingsConformance` helpers) |
| `@arnilo/prism-providers` | 415 → 420 | Task 2: OpenAI embeddings adapter (+5) |
| `@arnilo/prism` | 1179 → 1201 | Task 3: speech + transcription contracts (+22: types, `SpeechError`/`TranscriptionError` + guards, `runSpeechConformance`/`runTranscriptionConformance` helpers) |
| `@arnilo/prism-providers` | 420 → 427 | Task 3: OpenAI speech + transcription adapters (+7) |
| `@arnilo/prism` | 1201 → 1212 | Task 4: image generation contract (+11: generate/edit types, `ImageGenerationError` + guards, `runImageGenerationConformance` helpers) |
| `@arnilo/prism-providers` | 427 → 436 | Task 4: OpenAI + Alibaba image adapters (+9) |
| `@arnilo/prism` | 1212 → 1225 | Task 5: video contract (+13: typed `VideoContent` part, `VideoGenerationError` + guards, `runVideoGenerationConformance` helpers) |
| `@arnilo/prism-providers` | 436 → 440 | Task 5: Alibaba video adapter (+4) |
| `@arnilo/prism` | 1225 → 1237 | Task 6: moderation contract (+12: neutral category vocabulary, `ModerationError` + guards, `runModerationConformance` helpers) |
| `@arnilo/prism-providers` | 440 → 447 | Task 6: OpenAI moderation adapter (+7) |
| `@arnilo/prism` | 1237 → 1255 | Task 7: batch-jobs contract (+18: state union, `BatchJobsError`, submit/job/result types, `pollBatch` utility, `runBatchJobsConformance` helpers) |
| `@arnilo/prism-providers` | 447 → 454 | Task 7: OpenAI batch adapter (+7) |

Artifact-diet size baselines were rebaselined once (Task 5) to the measured
packed/unpacked/file counts after the video modality additions.

## 4. Pre-existing issues surfaced (not plan 061)

- `scripts/phase23-skip-manifest.test.mjs` ("protected-named" test) fails
  identically at clean HEAD `8c292b05` (verified in a throwaway worktree): the
  stale `coverage-thresholds.json` entries for the pre-consolidation
  `prism-session-store-postgres`/`prism-enterprise-postgres` packages no longer
  produce suite rows, so no protected-class row carries
  `PRISM_TEST_POSTGRES_URL`. Belongs to plan 056 follow-up (its working-tree
  remediation edits are in flight); plan 061 contracts neither touch nor depend
  on the release-evidence emitter.

## 5. Live-probe ledger (plan 055 format)

Offline conformance proves Prism mapping, typed caps, and state handling against
fake transports. Vendor-account behavior (model availability, entitlements,
real audio/video artifacts, batch completion windows) is unknown until a
credentialed probe runs. Every row stays **probe pending**; run under the
plan 060 operator-gated canary matrix and update the row in place.

| Adapter | Offline evidence | Live probe status | Unknowns (live probe) |
| --- | --- | --- | --- |
| OpenAI embeddings (`text-embedding-3-*`) | fake-transport conformance: caps, ordering, usage | **probe pending** | actual dimensions/usage fields per model; embedding-array response shape on newer models |
| Alibaba embeddings (DashScope) | fake-transport conformance; dimension truthfulness fix | **probe pending** | per-model vector dimensions; batch cap on paid tiers |
| OpenAI speech (`gpt-4o-mini-tts`) | caps, streaming first-chunk conformance | **probe pending** | real audio bytes/mime per voice+format; `instructions` field acceptance |
| OpenAI transcription (`gpt-4o-transcribe`) | caps, SSE partials conformance | **probe pending** | SSE event vocabulary vs documented sample; language/translate route behavior |
| OpenAI images (`gpt-image-1`) | caps, b64 provenance, edit route | **probe pending** | b64 vs URL response selection per size/quality; partial-upload error envelopes |
| Alibaba image generation (wanx) | async task lifecycle fake | **probe pending** | task latency distribution; per-model size limits |
| Alibaba video generation (wanx) | lifecycle + timeout fakes | **probe pending** | real duration/resolution knobs; I2V image constraints; result URL TTL |
| OpenAI moderation (`omni-moderation-latest`) | neutral category mapping + passthrough | **probe pending** | full raw category list (documented set may lag); score calibration per input type |
| OpenAI batch jobs (Files API + `/v1/batches`) | lifecycle + paging conformance | **probe pending** | JSONL result envelope drift; `failed` vs per-item error split; 24h window behavior; output/error file id edge cases |

## 6. Docs surface

Six pages per the prism-wiki API structure: `docs/embeddings.md`,
`docs/speech.md`, `docs/image-generation.md`, `docs/multimodal-content.md`
(video input part + video generation contract), `docs/moderation.md`,
`docs/batch-jobs.md`; plus the modality conformance matrix in
`docs/provider-conformance.md` and one navigation entry each in
`docs/index.md`.
