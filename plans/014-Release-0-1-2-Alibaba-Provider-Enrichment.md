# Release 0.1.2 — Alibaba Cloud provider enrichment

Roadmap phase: 0.1.x line, milestone **0.1.2 — Alibaba Cloud provider enrichment** (`roadmap.md`, "0.1.2 — Alibaba Cloud provider enrichment"; 2026-08-10 resequencing moved this milestone from 0.1.4 to 0.1.2).
Baseline: `@arnilo/prism` **0.1.1** (plan 013 exit gate green; `scripts/phase13-baseline.json` `exitGate`; 49 publishable manifests; `npm audit --audit-level=moderate` 0).
Target: `@arnilo/prism` **0.1.2** (additive/non-breaking patch; provider enrichment inside the existing `@arnilo/prism-provider-alibaba` package; no new packages, no new runtime dependencies, no core changes).
Prerequisite: 0.1.1 exit gate passed; `docs/public-contracts.md` 0.1.x contract surface frozen; compat baseline green.

0.1.2 is **provider enrichment, not a new module** (roadmap: "enrich, do not reimplement"; versioning policy: provider enrichment is 0.1.x). Every change lands in `packages/provider-alibaba` behind the existing `createOpenAICompatibleProvider` base. Roadmap priority rule 2 applies: reuse the existing base, ship conformance + budget gates, no bespoke runtime.

## Objectives

- Extend `@arnilo/prism-provider-alibaba` with Bailian (Model Studio) endpoints **where OpenAI-compatible**: embeddings via `POST {base}/embeddings`, and rerank/text-to-SQL only where a documented OpenAI-compatible route exists.
- Add video input to the chat serialization path where compatible-mode chat supports it (`video_url` content part), gated by declared model capabilities; document input is verified as Files-API-only (no compatible-mode content part) and recorded as a demand-gated deferral.
- Record every native-only DashScope surface (async task polling via `X-DashScope-Async`, native rerank, file-extract uploads outside the OpenAI shape) as a **documented deferral**, not new runtime.
- Expand conformance coverage for the new surfaces; keep the cache-control + `enable_thinking` regressions green; keep the package dependency-free (peer `@arnilo/prism` only).

## Non-goals

- Alibaba Cloud **platform adapters** (Bailian rerank/embeddings wired into `@arnilo/prism-rag`, OSS as an `ArtifactBodyStore`) — demand-gated 0.2.0 packages per the roadmap.
- Native DashScope async task submission/polling (`X-DashScope-Async: enable`, `GET /api/v1/tasks/{id}`) — not OpenAI-compatible; documented deferral only.
- Native rerank/text-embeddings service endpoints (`/api/v1/services/...`) — not OpenAI-compatible; out of scope unless a task verifies a compatible-mode route.
- New provider packages, new core exports, breaking changes to the 0.1.x contract surface, or any new runtime dependency.
- Setup-time network fetches, credential discovery, or implicit activation — the package stays side-effect-free.

## Expected Outcome

- `createAlibabaEmbedder()` (or the Task 1-verified equivalent) implements the structural `{ dimensions, embed(texts, { signal }) }` shape assignable to `@arnilo/prism-memory`'s `Embedder` **without** a dependency on `prism-memory`, over `POST {base}/embeddings`, caller-gated, with bounded responses and redacted errors.
- Chat message serialization accepts video input (`file` blocks with `mediaType: "video/*"` → `video_url` parts) per the Task 1-verified compatible-mode wire format, gated by `ModelCapabilities.input`; document blocks keep failing before fetch (no compatible-mode document part — deferral recorded).
- `mapAlibabaModel()` capability inference covers video-capable models so discovered models advertise what the serializer accepts.
- Rerank is **deferred**: Task 1 verified the only OpenAI-compatible rerank route is workspace-dedicated `compatible-api/v1/reranks` (not on the public presets); the deferral is recorded in the freeze-manifest deviation log and `docs/providers/alibaba.md` with the verified route as the demand-gated future option.
- `docs/providers/alibaba.md` documents the new surfaces and every deferral; `@arnilo/prism/testing/provider-conformance` assertions cover the new paths; package-size budget stays green; `npm run sdk:ready` green at 0.1.2 with the compat baseline additive-only.

## Tasks

- [x] Task 0 — Freeze record, scope gate, and baseline evidence
  - Acceptance Criteria:
    - Functional: a `scripts/phase14-freeze-manifest.json` (or an extension of the existing freeze pattern) declares 0.1.2 as provider enrichment: allowed changes (edits inside `packages/provider-alibaba/**`, its docs page, conformance/evidence scripts), forbidden changes (new packages/subpaths, core `src/**` public-surface edits, runtime dependencies, native-only DashScope endpoints, 0.1.3+ items), and an empty-at-freeze deviation log (schema-enforced; any later deviation carries task + change + rationale).
    - Functional: baseline evidence recorded before any task in `scripts/phase14-baseline.json`: `npm test` pass count, provider-alibaba suite pass count, package tarball size vs `scripts/budgets.json`, `npm audit` result, compat-baseline status at 0.1.1.
    - Performance: freeze reuses the plan 013 manifest + test pattern; no new long-running work.
    - Code Quality: one machine-checked manifest + schema test (`scripts/phase14-freeze.test.mjs`) wired into the `npm test` script list after the phase13 freeze tests; no new test framework.
    - Security: freeze restates the 0.1.x audit policy (`--audit-level=moderate` = 0), the additive-only compat promise, and signed-tag + npm OIDC publication as operator steps.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` 0.1.2 milestone + Versioning Policy + Release Validation Checklist; `scripts/phase13-freeze-manifest.json` + `scripts/phase13-freeze.test.mjs` (established pattern); `docs/public-contracts.md`; `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Extend `phase13-freeze-manifest.json` with a 0.1.2 block: rejected — separate `phase14` files keep the 0.1.1 hardening contract frozen independently (plan 013 precedent).
      - Prose-only scope gate: rejected — not machine-checkable.
    - Chosen Approach:
      - New `phase14-freeze-manifest.json` + `phase14-freeze.test.mjs` + `phase14-baseline.json`, following plan 013 Task 0 verbatim in structure.
    - API Notes and Examples:
      ```jsonc
      // scripts/phase14-freeze-manifest.json (shape; finalized in Task 0)
      { "release": "0.1.2", "line": "0.1.x", "type": "provider-enrichment",
        "allowed": ["packages/provider-alibaba/**", "docs/providers/alibaba.md",
                    "conformance-and-evidence-scripts", "docs"],
        "forbidden": ["new-packages", "core-public-surface", "runtime-dependencies",
                      "native-dashscope-endpoints", "async-task-polling"],
        "deviations": [] }
      ```
    - Files to Create/Edit:
      - `scripts/phase14-freeze-manifest.json`: create (scope contract).
      - `scripts/phase14-freeze.test.mjs`: create (schema + scope assertions).
      - `scripts/phase14-baseline.json`: create (baseline evidence).
      - `package.json`: add the freeze test to the `npm test` script list.
    - References:
      - `plans/013-Release-0-1-1-Post-Release-Hardening.md` Task 0; `scripts/phase13-freeze-manifest.json`.
  - Test Cases to Write:
    - freeze manifest schema validation: required keys present, `deviations` array schema enforced.
    - forbidden-scope tripwire: manifest lists the forbidden categories; test greps the diff surface at exit gate.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (release-process evidence only).
    - Docs pages to create/edit:
      - `none`: freeze manifests are repo evidence, not public docs (plan 013 precedent).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (docs-not-required path).
  - **Shipped (plan 014 Task 0).** `scripts/phase14-freeze-manifest.json` (release 0.1.2, line 0.1.x, type provider-enrichment; 6 allowed surfaces incl. rerank-only-if-verified; 12 forbidden categories incl. native DashScope endpoints, async task polling, 0.1.3–0.1.7 and 0.2.0 items; empty deviation log) + `scripts/phase14-freeze.test.mjs` (16/16 green, wired into `npm test` after phase13) + `scripts/phase14-baseline.json` (0.1.1 evidence: core 1418/1418, script gates 95/95, coverage 91.67/83.72/91.23 vs 60/70/75 thresholds, audit 0 moderate, release:gate 49 packages 0 breaking deltas, provider-alibaba suite 14/14, tarball 7992 packed / 28702 unpacked / 12 files, dirty-tree release:check blocked per plan 013 precedent). Full `npm test` green at 0.1.1 with the new gate wired in.

- [x] Task 1 — DashScope OpenAI-compatible capability verification and decision record
  - Acceptance Criteria:
    - Functional: a checked-in decision record (inside `docs/providers/alibaba.md` "Compatible-mode surface" subsection) states, with doc URLs and retrieval date, which candidate surfaces are OpenAI-compatible on the public presets: embeddings (`POST {base}/embeddings`), rerank (compatible-mode rerank route, e.g. workspace-dedicated `/compatible-mode/v1/reranks` with `qwen3-rerank`), text-to-SQL, document input, video input (`video_url` content part), async task polling.
    - Functional: every surface marked native-only gets a one-line deferral with its doc URL; Task 4's implement-or-defer branch is decided by this record.
    - Performance: docs-only task; no runtime work.
    - Code Quality: decision record is a single table; no new files beyond the docs edit unless the table outgrows the page.
    - Security: record notes that all verified endpoints keep `Authorization: Bearer`-only auth and region/plan-scoped keys (no new credential kinds).
  - Approach:
    - Documentation Reviewed:
      - Alibaba Cloud Model Studio OpenAI compatibility: <https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope>
      - Base URLs / presets: <https://www.alibabacloud.com/help/en/model-studio/base-url>
      - Text embedding (sync, compatible mode): <https://www.alibabacloud.com/help/en/model-studio/text-embedding-synchronous-api> and <https://docs.qwencloud.com/api-reference/text-embedding/openai-embedding>
      - Qwen-VL video input in compatible mode (`video_url` content part): Model Studio Qwen-VL API docs (verified 2026-08-10: compatible-mode chat accepts `{"type":"video_url"}` content items, public URL or base64 data URL).
      - Rerank: compatible-mode rerank route verified 2026-08-10 on workspace-dedicated endpoints with `qwen3-rerank`; `gte-rerank` is native-only (`/api/v1/services/rerank/text-rerank/text-rerank`).
      - Async tasks: `X-DashScope-Async: enable` + `GET /api/v1/tasks/{task_id}` verified 2026-08-10 as native-only (image/video generation, non-real-time ASR); no compatible-mode chat polling.
    - Options Considered:
      - Implement everything including native endpoints: rejected — violates "where OpenAI-compatible" (roadmap) and the thin-package rule.
      - Verify-as-you-go inside each implementation task: rejected — one decision record keeps Tasks 2–4 unambiguous and gives the exit gate an audit trail.
    - Chosen Approach:
      - Single verification pass up front; decisions recorded in `docs/providers/alibaba.md` and mirrored into the freeze-manifest deviation log when a roadmap-named item defers.
    - API Notes and Examples:
      ```bash
      # Verified compatible-mode surfaces (public presets):
      POST {base}/embeddings            # text-embedding-v3/v4
      POST {base}/chat/completions      # + video_url content parts on qwen-vl models
      # Workspace-dedicated only (verify per Task 4):
      POST https://{workspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1/reranks  # qwen3-rerank
      ```
    - Files to Create/Edit:
      - `docs/providers/alibaba.md`: add "Compatible-mode surface" decision table + deferral notes.
      - `scripts/phase14-freeze-manifest.json`: deviation entries for any roadmap-named surface that defers.
    - References:
      - `roadmap.md` 0.1.2 milestone text; `packages/provider-alibaba/src/models.ts` (`ALIBABA_BASE_URLS`).
  - Test Cases to Write:
    - docs tripwire: decision-table tokens (`/embeddings`, `video_url`, `rerank`, `X-DashScope-Async` deferral) present in `docs/providers/alibaba.md`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documents which provider behaviors exist vs defer.
    - Docs pages to create/edit:
      - `docs/providers/alibaba.md`: "Compatible-mode surface" table (surface, compatible?, endpoint, decision, doc URL).
    - `docs/index.md` update: no (existing provider page edit; navigation entry already present).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Shipped (plan 014 Task 1).** Decision record "Compatible-mode surface (verified 2026-08-10)" added to `docs/providers/alibaba.md` with doc URLs: embeddings `POST {base}/embeddings` compatible on all public presets (text-embedding-v3/v4, dims 64–2048 default 1024, max 10 inputs × 8,192 tokens per request); video input compatible via `video_url` content part on Qwen-VL models (public URL, `fps` 0.1–10 default 2); document input has NO compatible-mode content part — compatible path is the OpenAI Files API (`purpose: file-extract`, ≤150 MB) + `fileid://<id>` system-message reference (qwen-long, ≤100 files) → **deferred** (upload/status lifecycle, demand-gated follow-up; deviation logged in `phase14-freeze-manifest.json`); rerank route exists only on workspace-dedicated `compatible-api/v1/reranks` (`qwen3-rerank`, ≤500 docs, 4,000 tokens/item) — **not on public presets** → Task 4 defers; text-to-SQL has no dedicated endpoint (chat use case, nothing to implement); `X-DashScope-Async` task polling native-only → deferred. Docs tripwire added to `src/__tests__/docs.test.ts` (tokens: `/embeddings`, `video_url`, `compatible-api/v1/reranks`, `X-DashScope-Async`, `file-extract`, `text-to-SQL`). Freeze test updated: deviation log now validates structured task+change+rationale entries.

- [x] Task 2 — Alibaba embeddings over `POST {base}/embeddings`
  - Acceptance Criteria:
    - Functional: `createAlibabaEmbedder(options)` exported from `@arnilo/prism-provider-alibaba`; `embed(texts, { signal })` returns one float vector per input in order; `dimensions` reflects the configured model; empty input returns `[]` without a fetch; batch size capped per DashScope limits (text-embedding-v3/v4 cap 10 inputs/request — Task 1 confirms; chunking or fail-loud per the verified limit).
    - Functional: options mirror the provider (`apiKey`, `baseUrl`/`preset`, `fetch`, plus `model` and optional `dimensions`/`encoding_format` passthrough); no network on import or construction.
    - Performance: single POST per chunk; bounded response parsing via `readBoundedResponseText` on errors; no retries beyond native fetch (0.1.x inert-retry policy unchanged).
    - Code Quality: structural typing only — the returned object is assignable to `@arnilo/prism-memory`'s `Embedder` (`{ dimensions, embed(texts, { signal }) }`) with **no** `prism-memory` import; reuses `alibabaBaseUrl`, `resolveCredentialValue`, `redactSecrets`.
    - Security: key resolved per call via `resolveCredentialValue`, sent only as `Authorization: Bearer`; error bodies redacted with `redactSecrets`; provider-owned headers win over caller headers; no filesystem/env reads.
  - Approach:
    - Documentation Reviewed:
      - Compatible-mode embeddings: <https://www.alibabacloud.com/help/en/model-studio/text-embedding-synchronous-api> (`POST {base}/embeddings`, OpenAI `{"model","input":[...]}` shape, `data[].embedding`, `usage`).
      - `packages/memory/src/types.ts` (`Embedder`, lines 48–51) — structural target, not imported.
      - `packages/provider-alibaba/src/models.ts` (`alibabaBaseUrl`, `resolveCredentialValue` usage in `listAlibabaModels`).
    - Options Considered:
      - Depend on `@arnilo/prism-memory` for the `Embedder` type: rejected — adds a dependency for one structural interface; TS assignability covers it.
      - Wire embeddings into `@arnilo/prism-rag`: rejected — roadmap defers RAG wiring to demand-gated 0.2.0.
      - Add a core `EmbeddingProvider` seam: rejected — speculative abstraction; one implementor, structural shape suffices (YAGNI).
    - Chosen Approach:
      - Thin `embeddings.ts` in the alibaba package exporting `createAlibabaEmbedder` + types, mirroring `listAlibabaModels`' auth/error pattern.
    - API Notes and Examples:
      ```ts
      const embedder = createAlibabaEmbedder({
        apiKey: process.env.DASHSCOPE_API_KEY,
        model: "text-embedding-v4",
        dimensions: 1024,
      });
      const vectors = await embedder.embed(["hello", "world"]); // number[2][1024]
      // Assignable to `Embedder` from @arnilo/prism-memory without importing it.
      ```
    - Files to Create/Edit:
      - `packages/provider-alibaba/src/embeddings.ts`: create (`createAlibabaEmbedder`, `AlibabaEmbedderOptions`, response types).
      - `packages/provider-alibaba/src/index.ts`: re-export the new symbols (additive).
      - `packages/provider-alibaba/src/__tests__/alibaba.test.ts` (or new `embeddings.test.ts`): coverage below.
    - References:
      - `packages/provider-alibaba/src/models.ts` `listAlibabaModels` (auth + redaction pattern); `packages/rag/src/types.ts` (`Embedder` consumer shape).
  - Test Cases to Write:
    - request shape: captured fetch body has `model` + string-array `input`; base URL/preset resolution reused.
    - response mapping: `data[]` ordered by `index` → vectors; `usage` surfaced or dropped per verified shape (assert decision).
    - empty input: no fetch, returns `[]`.
    - error path: non-OK response throws with status, body redacted of the API key.
    - header ownership: caller `headers` cannot override `authorization`/`content-type`.
    - structural assignability: compile-time assertion that the return type satisfies `{ dimensions: number; embed(...): Promise<readonly (readonly number[])[]> }`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new exported factory on the package entry point.
    - Docs pages to create/edit:
      - `docs/providers/alibaba.md`: embeddings subsection (inputs/outputs/example + security notes) per the wiki API page structure.
      - `packages/provider-alibaba/README.md`: add `createAlibabaEmbedder` to the API list if the README enumerates exports.
    - `docs/index.md` update: no (existing provider page).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Shipped (plan 014 Task 2).** `packages/provider-alibaba/src/embeddings.ts` — `createAlibabaEmbedder` (structural `AlibabaEmbedder` assignable to `@arnilo/prism-memory`'s `Embedder` without importing it), `ALIBABA_EMBEDDING_BATCH_SIZE` (10, DashScope cap), `ALIBABA_EMBEDDING_DEFAULT_DIMENSIONS` (1024); chunked POSTs to `{base}/embeddings`, vectors in input order, empty input returns `[]` without fetch, `dimensions`/`encoding_format` passthrough, key resolved per call, `readBoundedResponseText` + `redactSecrets` on errors, provider-owned headers applied last. Re-exported from `index.ts`. New `embeddings.test.ts` (9 tests: request shape, custom dims/format, index-ordered mapping, empty-input no-fetch, chunking 10+2, 401 redaction, header ownership, abort signal passthrough, missing-index fail-loud) — suite 23/23 green. Docs: `docs/providers/alibaba.md` Embeddings section + import block; README exports list + embeddings snippet.

- [x] Task 3 — Video input in chat serialization + discovery capability inference (document input deferred per Task 1)
  - Acceptance Criteria:
    - Functional: `serializeAlibabaMessage` maps video input (Prism `file` block with `mediaType: "video/*"`) to the Task 1-verified compatible-mode wire format (`video_url` content part with public URL or base64 data URL); `document`/`file` blocks with non-video media types still throw before fetch (no compatible-mode document content part exists — Task 1 record); unsupported placements keep failing before fetch with the current error style.
    - Functional: mapping is gated on `ModelCapabilities.input` (video reuses `"file"` + `metadata.mediaSubtype` or the Task 1-recorded gating rule — no core `MODEL_INPUT_CAPABILITIES` change in 0.1.2).
    - Functional: `mapAlibabaModel()` infers video-capable inputs from model id patterns verified in Task 1 (qwen-vl family) so discovered models advertise what the serializer accepts; `defineAlibabaModel` capability overrides still win.
    - Performance: serialization stays O(blocks); no new fetches (media resolution stays the host/core media-pipeline job per `src/content.ts`).
    - Code Quality: extends the existing serializer branches; cache-control marker handling (`withAlibabaCacheMarker`) applies to the new parts identically.
    - Security: URL-bearing blocks keep the existing "no local filesystem paths in payloads" rule; SSRF/media validation stays in core's media pipeline (the provider does not fetch); error messages carry no key material.
  - Approach:
    - Documentation Reviewed:
      - Qwen-VL compatible-mode video input (`video_url` content part, public URL or base64 data URL): Task 1 record + Model Studio Qwen-VL docs.
      - `src/content.ts` (`FileContent`, `DocumentContent`, `MODEL_INPUT_CAPABILITIES`).
      - `packages/provider-alibaba/src/provider.ts` (`serializeAlibabaMessage` current throws for `audio`/`file`/`document`).
    - Options Considered:
      - Add a `video` content block + `"video"` input capability in core: rejected for 0.1.2 — core public-surface change; map via `FileContent` with `mediaType: "video/*"` instead (provider-side, additive).
      - Base64-encode media in the provider: rejected — provider never fetches; pass-through URLs/data URLs only, matching the current image branch.
      - Implement document input via the OpenAI Files API (`file-extract` + `fileid://`): rejected for 0.1.2 — upload + status-polling lifecycle, not a serialization mapping; recorded as a demand-gated follow-up (Task 1 deviation).
    - Chosen Approach:
      - New serializer branch for video `file` blocks → `video_url`, capability-gated like the image branch; extend `looksLikeVisionModel`-style inference per Task 1's verified id patterns; document blocks keep throwing with the deferral noted in the docs.
    - API Notes and Examples:
      ```ts
      // host side — video as a FileContent with a video media type
      { type: "file", mediaType: "video/mp4", url: "https://…/clip.mp4" }
      // wire shape emitted by serializeAlibabaMessage
      { "type": "video_url", "video_url": { "url": "https://…/clip.mp4" } }
      ```
    - Files to Create/Edit:
      - `packages/provider-alibaba/src/provider.ts`: new serializer branch.
      - `packages/provider-alibaba/src/models.ts`: capability inference for video-capable model ids.
      - `packages/provider-alibaba/src/__tests__/alibaba.test.ts`: coverage below.
    - References:
      - Task 1 decision record; `src/content.ts`; existing image-branch gating (`capabilities.input?.includes("image")`).
  - Test Cases to Write:
    - video block → `video_url` part emitted; missing capability → throw before fetch.
    - document block → still throws before fetch (no compatible-mode document part; deferral documented).
    - base64 data URL pass-through; `resourceUri`-only blocks throw (no fetch).
    - cache marker preserved on the last content block when the new parts are present.
    - `mapAlibabaModel` inference: qwen-vl ids advertise the new inputs; text-only ids unchanged.
    - regression: existing image/tool/thinking/cache serialization tests unchanged and green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — accepted content-block kinds change for this provider.
    - Docs pages to create/edit:
      - `docs/providers/alibaba.md`: multimodal input subsection (block kinds, gating, wire shapes, deferral of document file-extract upload).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Shipped (plan 014 Task 3).** `serializeAlibabaMessage` video branch: `file` blocks with `video/*` mediaType → `video_url` content part (url or base64 `data:` URL pass-through; `resourceUri`-only throws before fetch), gated on the `file` input capability; `document` and non-video `file` blocks keep throwing before fetch (deferral comment references the Task 1 record). `mapAlibabaModel` now advertises `["text", "image", "file"]` for the qwen-vl family (qvq/-vl/qwen-vl/vision ids); `defineAlibabaModel` overrides still win. 5 new tests in `alibaba.test.ts` (video_url emission, capability gate, data-URL pass-through + resourceUri throw, non-video file/document throws, cache marker on last block with video parts) + inference test updated — suite 28/28 green. Docs: `docs/providers/alibaba.md` Multimodal input section.

- [x] Task 4 — Rerank: defer (Task 1 verified no compatible-mode route on the public presets)
  - Acceptance Criteria:
    - Functional (defer branch — active): no code shipped; `docs/providers/alibaba.md` records the deferral + doc URL; freeze-manifest deviation log notes the roadmap-named item deferred.
    - Functional (implement branch — demand-gated future): `createAlibabaReranker(options)` over the verified workspace-dedicated `compatible-api/v1/reranks` route; input `{ query, documents }` → ordered `{ index, score }[]`; caller-gated; workspace-dedicated base URLs supplied via the existing `baseUrl` option; structural shape assignable to `@arnilo/prism-rag`'s `Reranker` only if the shapes align without a dependency (otherwise keep provider-local types).
    - Performance: one POST per rerank call; bounded error bodies; no implicit retries.
    - Code Quality: same auth/redaction/header-ownership pattern as Task 2; no `prism-rag` dependency.
    - Security: query/document text and key redaction on error paths; `Authorization: Bearer` only.
  - Approach:
    - Documentation Reviewed:
      - Task 1 decision record (rerank row): route verified 2026-08-10 as `POST {workspaceId}.{region}.maas.aliyuncs.com/compatible-api/v1/reranks` (`qwen3-rerank`, ≤500 documents, 4,000 tokens/item) — workspace-dedicated only, base path `compatible-api/v1` (not `compatible-mode/v1`); no rerank route on the public presets; `gte-rerank` native-only.
      - `packages/rag/src/types.ts` (`Reranker`, lines 182–184) — structural reference only.
    - Options Considered:
      - Ship against the native `/api/v1/services/rerank/...` endpoint: rejected — not OpenAI-compatible.
      - Ship unconditionally against workspace-only endpoints: rejected — a preset-scoped feature that 404s on the default base is worse than a documented deferral; the plan's implement condition (documented route on the public presets) is not met.
    - Chosen Approach:
      - **Defer branch closes the task.** Decision record + docs deferral + freeze-manifest deviation entry. The workspace-dedicated `compatible-api/v1/reranks` route is recorded as the verified future option for a demand-gated `baseUrl`-supplied reranker.
    - API Notes and Examples:
      ```ts
      // demand-gated future (implement branch, only if a public-preset route appears):
      const reranker = createAlibabaReranker({ apiKey, model: "qwen3-rerank", baseUrl: workspaceDedicatedUrl });
      const ranked = await reranker.rerank({ query, documents }); // → [{ index, score }] ordered
      ```
    - Files to Create/Edit:
      - `docs/providers/alibaba.md`: rerank deferral note (already in the Task 1 decision table; finalize wording).
      - `scripts/phase14-freeze-manifest.json`: deviation entry for the rerank deferral.
    - References:
      - Task 1 record; `packages/provider-alibaba/src/models.ts` auth pattern.
  - Test Cases to Write:
    - defer branch: docs tripwire asserting the deferral sentence + endpoint URL (already covered by the Task 1 tripwire tokens).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a documented absence (no rerank export in 0.1.2).
    - Docs pages to create/edit:
      - `docs/providers/alibaba.md`: rerank deferral (decision table row + note).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Shipped (plan 014 Task 4).** Defer branch closed: no code shipped. `docs/providers/alibaba.md` gained a `## Rerank (deferred)` section (workspace-dedicated `compatible-api/v1/reranks` route, `qwen3-rerank`, ≤500 docs/4,000 tokens per item, base path `compatible-api/v1`; `createAlibabaReranker` demand-gated on a caller-supplied workspace `baseUrl`; `qwen3-vl-rerank` native-only stays out). Freeze manifest: task4 done token + structured deviation entry (task/change/rationale). Task 1 tripwire tokens already cover the deferral sentence + endpoint URL.

- [x] Task 5 — Conformance expansion, opt-in live probe, and regression guards
  - Acceptance Criteria:
    - Functional: new serializer branches covered by `assertSerializedRequestCoversContent`-style assertions; stream/abort/tool-call conformance suites re-run green; cache-control + `enable_thinking` regression tests unchanged and green.
    - Functional: an opt-in live probe (env-gated, e.g. `PRISM_LIVE_DASHSCOPE_KEY`, mirroring live-test precedent of staying out of `npm test`) exercises embeddings + video-serialization against the real endpoint when the env is set; absent env = documented skip, never a failure.
    - Performance: default suite stays network-free and adds < 1s; live probe is opt-in only.
    - Code Quality: assertions reuse `@arnilo/prism/testing/provider-conformance` helpers; no new test framework.
    - Security: live probe reads only the named env var, never logs the key, and is excluded from default CI.
  - Approach:
    - Documentation Reviewed:
      - `src/testing/provider-conformance.ts` exports; existing `packages/provider-alibaba/src/__tests__/alibaba.test.ts` patterns; roadmap 0.1.2 acceptance line.
    - Options Considered:
      - Add a new conformance subpath export: rejected — existing helpers cover the new paths via `assertSerializedRequestCoversContent` and capture-fetch; no core change.
      - Put the live probe in `npm test` behind a skip: rejected — repo rule keeps live tests opt-in scripts (precedent: `test:postgres`).
    - Chosen Approach:
      - Extend the package suite + one `test:live-alibaba`-style script documented in the package README/docs page.
    - API Notes and Examples:
      ```bash
      PRISM_LIVE_DASHSCOPE_KEY=… npm run test:live --workspace @arnilo/prism-provider-alibaba
      ```
    - Files to Create/Edit:
      - `packages/provider-alibaba/src/__tests__/`: new/extended suites.
      - `packages/provider-alibaba/package.json`: opt-in live-test script (not wired into root `npm test`).
    - References:
      - `src/testing/provider-conformance.ts`; plan 009 live-gate precedent (`PRISM_TEST_NATS_URL`).
  - Test Cases to Write:
    - content-coverage assertion including the Task 3 parts.
    - abort observed mid-embed call.
    - secret-leak assertion on embeddings/rerank error paths (key absent from thrown message).
    - live probe: embeddings round-trip returns expected dimension; skip message printed when env absent.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (test/tooling surface; live script documented).
    - Docs pages to create/edit:
      - `docs/providers/alibaba.md`: one-line live-probe instructions in the security/performance notes.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Shipped (plan 014 Task 5).** Conformance: `assertSerializedRequestCoversContent` over a video content block (data-URL canaries: mediaType + bytes reach the wire) in `alibaba.test.ts`; abort-mid-embed rejection test in `embeddings.test.ts` (fetch rejects on signal abort). Live probe: `src/__tests__/live.test.ts` — embeddings round-trip (asserts one vector per input at `embedder.dimensions`) + video→`video_url` serialization; gated on `PRISM_LIVE_DASHSCOPE_KEY` (model override `PRISM_LIVE_DASHSCOPE_MODEL`), `describe.skip` + printed skip message when absent (mirrors `PRISM_TEST_POSTGRES_URL` precedent); `test:live` script added to the package (not wired into root `npm test`). Docs: live-probe instructions in `docs/providers/alibaba.md` security notes + README. Suite 29/29 with 1 skip; secret-leak assertions already covered by the Task 2 401-redaction test.

- [x] Task 6 — Docs finalization, budget gate, and 0.1.2 exit gate
  - Acceptance Criteria:
    - Functional: `docs/providers/alibaba.md` reflects final behavior (decision table, embeddings, multimodal input, rerank implement-or-defer, native deferrals incl. async task polling); package README/CHANGELOG updated; `scripts/budgets.json` provider-alibaba size gate green (baseline re-measured, bump only with a recorded reason).
    - Functional: exit-gate evidence appended to `scripts/phase14-baseline.json` (`exitGate`): `npm test` green, `sdk:ready` rc=0, compat baseline additive-only, audit 0 moderate, publish dry-run deterministic.
    - Performance: tarball size delta measured and within the frozen gate.
    - Code Quality: docs tripwires updated to the new page structure; no dead links.
    - Security: audit + supply-chain gates re-run; operator publication steps (commit, signed tag `v0.1.2`, npm OIDC) restated as handoff, not executed here.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Release Validation Checklist; `docs/release-and-install.md`; plan 013 Task 6 exit-gate pattern.
    - Options Considered:
      - Skip the version bump (fold into a later cut): rejected — the milestone is one 0.1.2 release per the roadmap.
    - Chosen Approach:
      - Scripted bump to 0.1.2 across 49 manifests + lockfile (plan 013 mechanism), compat baseline regenerated (expected: additive exports only), full gate run, evidence recorded.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready && npm run release:check -- --version 0.1.2
      ```
    - Files to Create/Edit:
      - `docs/providers/alibaba.md`, `packages/provider-alibaba/README.md`, `packages/provider-alibaba/CHANGELOG.md`, root `CHANGELOG.md`.
      - `scripts/phase14-baseline.json`: `exitGate` evidence.
      - version literals across manifests + lockfile (scripted).
    - References:
      - `plans/013-Release-0-1-1-Post-Release-Hardening.md` Task 6; `docs/release-and-install.md`.
  - Test Cases to Write:
    - docs tripwire: new sections present, deferral tokens present, counts consistent.
    - exit-gate evidence test: `phase14-baseline.json` `exitGate` fields populated and thresholds met.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — release artifacts and changelogs describe the new provider surface.
    - Docs pages to create/edit:
      - `docs/providers/alibaba.md`: final pass.
      - `CHANGELOG.md` (root + package): 0.1.2 entries.
    - `docs/index.md` update: no (entry for the provider page already exists).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Shipped (plan 014 Task 6).** Docs: root `CHANGELOG.md` + `packages/provider-alibaba/CHANGELOG.md` gained `## [0.1.2] - 2026-08-10` entries; `docs/release-and-install.md` gained `### 0.1.2 publish handoff (plan 014 Task 6)` (operator prerequisites, command sequence, signed `v0.1.2` tag, rollback notes); `docs/index.md` current line → **0.1.2**; `docs/providers/alibaba.md` final pass (decision table, Embeddings, Multimodal input, Rerank (deferred), live probe). **Bump:** `node scripts/release.mjs bump --from 0.1.1 --to 0.1.2` — 49 manifests + lockfile (pure version churn); version-sensitive sources updated (`src/index.ts` version const, `index.test.ts`, `release.test.ts` graph test → 0.1.2 + provider-alibaba changelog + handoff token, `install-smoke.test.ts` tarball/journey names, `docs.test.ts` root-manifest assertion + new plan 014 Task 6 tripwire, `packaging.test.ts` pins, 12 workspace `index.test.ts` pins); the 0.1.1 tripwire's index current-line assertion dropped (superseded by the 0.1.2 tripwire). **Compat:** `release:gate --version 0.1.2 --update-baseline` — 49 packages, 0 breaking deltas, `updated: true` (additive provider-alibaba exports only). **Exit gate:** `npm test` rc=0 (core 1420/1420, script gates 110/110, workspaces green incl. provider-alibaba 30/30 with 1 live-probe skip); docs 125/125; `npm audit --audit-level=moderate` 0; `npm run sdk:ready` rc=0 (one biome format fix on `embeddings.test.ts` before green); publish dry-run 49/49 twice byte-identical; `release:check` blocked on the dirty tree (environmental, plan 013 precedent — green at clean tagged `v0.1.2`); provider-alibaba tarball 10296 packed / 38032 unpacked / 14 files vs 0.1.1 baseline 7992/28702/12 — delta recorded with reason (new embeddings module + tests); root pack gate green (726069/2530464/295 vs baseline 718738/2505460/293, tolerance 5%). All evidence in `scripts/phase14-baseline.json` `exitGate`. Operator publication (commit, signed tag, npm OIDC) is a handoff, not executed.

## Compromises Made

- **Rerank deferred (Task 1/4).** Only workspace-dedicated `compatible-api/v1/reranks` exists (`qwen3-rerank`), not on the public presets; `createAlibabaReranker` over that route is a demand-gated future (caller-supplied workspace `baseUrl`). `qwen3-vl-rerank` multimodal rerank is native-only and stays out.
- **Document input deferred (Task 1/3).** No OpenAI-compatible document content part exists; the compatible path is the OpenAI Files API `file-extract` (≤150 MB) + `fileid://<id>` system-message reference (qwen-long, ≤100 files) — an upload/status lifecycle, not a serialization mapping. Recorded as a demand-gated follow-up; `document` blocks keep failing before fetch.
- **Async task polling deferred (Task 1).** `X-DashScope-Async` + `GET /api/v1/tasks/{id}` is native-only; revisit only if DashScope ships a compatible-mode route.
- **Text-to-SQL: nothing to implement (Task 1).** No dedicated endpoint; SQL generation is a chat-completions use case already covered.
- **No per-package tarball gate in `scripts/budgets.json` (Task 6).** The plan named a provider-alibaba size gate, but no per-package mechanism exists; the root pack gate (green, tolerance 5%) plus the recorded tarball delta in `phase14-baseline.json` cover the regression risk. Add a per-package gate when a second package needs one.
- **Video reuses the `file` capability tag (Task 3).** No core `"video"` capability in 0.1.2; `mapAlibabaModel` advertises `["text", "image", "file"]` for the qwen-vl family, `defineAlibabaModel` overrides win.
- **Embedder is structural (Task 2).** No `@arnilo/prism-memory` dependency; assignability is compile-time checked in tests.

## Further Actions

- Wire verified embeddings into `@arnilo/prism-rag` behind a demand gate (0.2.0); the structural `AlibabaEmbedder` is already assignable to `Embedder`.
- OSS `ArtifactBodyStore` (0.2.0 demand-gated).
- Document input via the OpenAI Files API `file-extract` + `fileid://` reference when a host needs qwen-long document ingestion (demand-gated).
- `createAlibabaReranker` over workspace-dedicated `compatible-api/v1/reranks` when a caller supplies a workspace `baseUrl` and needs rerank (demand-gated).
- Revisit native async task polling only if DashScope ships a compatible-mode route.
- Operator publication of 0.1.2 (commit, signed `v0.1.2` tag, npm OIDC) per the handoff in `docs/release-and-install.md` — not executed here.
