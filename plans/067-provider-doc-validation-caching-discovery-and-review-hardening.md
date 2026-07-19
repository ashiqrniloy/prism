# Provider Doc Validation, Caching, Model Discovery, Thinking, and Use-Case Model Selection

## Objectives

- Re-verify and close every 2026-07-14 P0–P2 finding still open or at risk of regression, including revision/redaction, multi-round tool ordering, bounded transport, ledger backpressure, OAuth polling, JSONL/ENOENT safety, coding-agent image limits, and release provenance gates.
- Validate each first-party provider package against **official provider documentation first** (via web search / docs fetch), then against the Pi coding-agent (`badlogic/pi-mono`) implementation as a secondary reference when official docs are silent or ambiguous.
- For every provider package, prove prompt-caching behavior matches the provider’s documented API and Prism’s `ModelCacheCapabilities` / `ProviderRequestOptions.cache*` surface.
- Ensure latest models are available through **caller-gated dynamic discovery helpers** (`list*Models()` / equivalent), not only hardcoded static catalogs; keep package setup network-free.
- For every provider/model that supports reasoning or thinking, expose the **applicable** controls as model defaults (`ModelConfig.compat` / capabilities) and allow hosts to override them **per turn** via `ProviderRequestOptions.compat` (and a shared Prism thinking-level helper where useful).
- Make **use-case model selection** first-class: subsystems that call models for their own jobs (observational memory, LLM compaction, declarative agents, supervisor children, evals/server run overrides, embedders) can bind provider + model + thinking separately from the session chat model, with an explicit fallback to the session model when no use-case default is configured.
- Align provider docs and package READMEs with the real implementation (including known Z.AI compat-field drift).

## Expected Outcome

- All P0–P2 review items from `code-reviews/2026-07-14.md` either remain green with regression tests or are fixed with matching docs/tests.
- Each of `@arnilo/prism-provider-openai`, `provider-kimi`, `provider-zai`, `provider-openrouter`, `provider-opencode-go`, `provider-neuralwatt`, and `provider-ai-sdk` has an evidence-backed validation record: official docs cited, Pi comparison noted, cache mapping verified, thinking/reasoning mapping verified, and model-discovery policy implemented or explicitly justified.
- Hosts can fetch current model catalogs on demand without setup-time network I/O; static catalogs (if retained) are documented as offline bootstrap / featured aliases only.
- Per-turn thinking/reasoning works for every applicable provider (official field names), and use-case workers can select `{ provider, model, thinking }` independently of `AgentConfig.model` with session-model fallback.
- Provider pages under `docs/providers/`, `docs/provider-caching.md`, and a use-case model-selection doc match code; `docs/index.md` navigation reflects discovery + cache + thinking + use-case model guarantees.
- Focused package tests and `npm run sdk:ready` pass network-free.

## Tasks

- [x] 0. Build review + provider validation matrix and freeze evidence sources
  - Acceptance Criteria:
    - Functional: Checked-in matrix maps every 2026-07-14 P0–P2 finding and every first-party provider package to an owning task, current status (fixed / gap / verify), official-doc URLs, Pi source paths, cache kind, model-discovery endpoint (or justified absence), and **thinking/reasoning request fields** (official name + Prism compat path + per-turn override).
    - Performance: Inventory is offline and completes in under 2 minutes; no live provider calls in this task.
    - Code Quality: Matrix distinguishes official-doc priority vs Pi secondary reference; records known doc/code mismatches (e.g. Z.AI `thinkingFormat` docs vs `thinking`/`reasoning_effort`/`tool_stream` code); records use-case model binding sites discovered in Task 5.
    - Security: Matrix notes credential surfaces, OAuth secrets, and redaction canaries per package; no secrets committed.
  - Approach:
    - Documentation Reviewed:
      - `code-reviews/2026-07-14.md`; `docs/review-coverage-2026-07-14.md`; plans `053`, `054`, `058`.
      - `docs/provider-caching.md`, `docs/provider-packages.md`, `docs/providers/*.md`.
      - Official docs (web search / fetch at execution): OpenAI Models + Prompt Caching + Responses; Kimi List Models + Model List; Z.AI Thinking / Tool Streaming / Chat Completion; OpenRouter Models API; OpenCode Go; NeuralWatt `/v1/models`; AI SDK LanguageModelV4 usage.
      - Pi secondary: `badlogic/pi-mono` `packages/ai/src/providers/*`, `packages/ai/src/api/openai-responses.ts`, `anthropic-messages.ts`, `openai-completions.ts`.
    - Options Considered:
      - Treat prior plans 053/054 as complete and skip P0–P2: rejected; this plan must re-verify and close residual gaps.
      - Copy Pi’s generated static JSON catalogs into Prism: rejected as sole strategy; user requires dynamic latest-model fetch with official docs priority.
      - One matrix + per-provider validation tasks + shared discovery pattern: chosen.
    - Chosen Approach:
      - Create/update `docs/review-coverage-2026-07-17-provider-validation.md` as the working evidence page; link from `docs/index.md`.
    - API Notes and Examples:
      ```md
      | Package | Official cache | Thinking/reasoning | Discovery endpoint | Pi ref | Status |
      | provider-openai | prompt_cache_key / retention | reasoning.effort (gap: raw compat only) | GET /models | openai*.ts | gap: no listOpenAIModels + no first-class reasoning |
      ```
    - Files to Create/Edit:
      - `docs/review-coverage-2026-07-17-provider-validation.md`: matrix.
      - `docs/index.md`: maintenance entry.
      - `plans/067-provider-doc-validation-caching-discovery-and-review-hardening.md`: record inventory notes during execution.
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - Observation inventory: hardcoded catalogs in openai/kimi/zai/opencode-go; NeuralWatt has `listNeuralWattModels()`; OpenRouter app-supplied models; ai-sdk host-owned.
  - Test Cases to Write:
    - Docs test or smoke assertion that the matrix page exists and lists all seven provider packages plus every P0–P2 id.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; evidence page only.
    - Docs pages to create/edit: `docs/review-coverage-2026-07-17-provider-validation.md`.
    - `docs/index.md` update: yes — add provider validation / review coverage entry under maintenance/release.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Execution notes (2026-07-17):**
    - Wrote `docs/review-coverage-2026-07-17-provider-validation.md` with P0–P2 → Task 1/2 owners (all `verify`), seven-provider matrix (Tasks 6–12), frozen official URLs, Pi secondary paths, discovery/thinking contracts, use-case binding inventory, credential canaries, and known mismatches.
    - Linked from `docs/index.md` Release and install; added `docs.test.ts` smoke covering all seven packages + R-001–R-012.
    - Inventory snapshot: only NeuralWatt has `list*Models()`; OpenAI/Kimi/ZAI/OpenCode Go hardcoded; OpenRouter app-supplied; AI SDK host-owned. Gaps frozen: OpenAI discovery + `reasoning.effort`, Kimi Moonshot non-callable + discovery, Z.AI docs `thinkingFormat` drift + stale GLM-4.x catalog, OpenRouter optional list helper, OpenCode Go stale aliases vs official Go list, OM/LLM `extra.thinkingLevel` no-op.

- [x] 1. Re-verify and close core P0/P1 runtime findings (revision, tool order, redaction, ledger)
  - Acceptance Criteria:
    - Functional: Repair messages appear exactly once in provider requests; multi-round tool transcripts alternate assistant→tool chronologically; graph redaction keeps shared refs structured and redacts object/Map string keys; ledger appends are serialized (concurrency 1) with ordered drain and failure propagation.
    - Performance: No deep-clone dedup workarounds; ledger never fans out unbounded concurrent appends; regression fixtures stay network-free and finish under existing suite budgets.
    - Code Quality: Prefer existing Plan 053 implementations; only patch regressions or missing assertions. Behavioral tests over source-text checks.
    - Security: Secret canaries absent from requests, events, stores, ledgers, errors, and redacted object/Map keys.
  - Approach:
    - Documentation Reviewed:
      - `code-reviews/2026-07-14.md` P0 + tool-order P1 + key-redaction P1 + ledger P1.
      - `docs/agent-loops.md`, `docs/credentials-and-redaction.md`, `docs/runs-and-usage.md`, `docs/review-coverage-2026-07-14.md`.
    - Options Considered:
      - Rewrite agent-loop input ownership again: rejected unless regression found.
      - Strengthen regression coverage and fix any drift: chosen.
    - Chosen Approach:
      - Run focused suites; if green, extend assertions for key-collision redaction and 3-turn/2-round tool order; if red, restore Plan 053 semantics.
    - API Notes and Examples:
      ```ts
      assert.deepEqual(roles, ["user", "assistant", "tool", "assistant", "tool"]);
      assert.equal(JSON.stringify(redactSecrets({ [secret]: true }, [secret])).includes(secret), false);
      ```
    - Files to Create/Edit:
      - `src/agent-loops.ts`, `src/redaction.ts`, `src/agents.ts` only if regressions.
      - `src/__tests__/agent-loops.test.ts`, `src/__tests__/runtime-redaction.test.ts`, `src/__tests__/run-ledger.test.ts`.
      - `docs/agent-loops.md`, `docs/credentials-and-redaction.md`, `docs/runs-and-usage.md` if behavior text drifted.
    - References:
      - Plans `053-core-runtime-correctness-security-and-storage-hardening.md` tasks 1–3.
  - Test Cases to Write:
    - Revision with redactor: second request has one repair message; no `[Circular]` corruption of distinct shared objects.
    - Two tool rounds with multiple calls: exact chronological order in history and assembled request.
    - High-delta mock stream: ledger append concurrency stays 1; order preserved; failure rejects run completion.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes if semantics change; otherwise verify-only.
    - Docs pages to create/edit: `docs/agent-loops.md`, `docs/credentials-and-redaction.md`, `docs/runs-and-usage.md` as needed; update matrix page statuses.
    - `docs/index.md` update: only if entry descriptions become stale.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Execution notes (2026-07-17):**
    - Re-verified Plan 053 semantics in place: `generateValidateReviseLoop` uses `pendingHistory` so repair is `nextInput` once before live-history push; `redactSecrets` uses active-path `WeakSet` + key redaction with deterministic collision suffixes; `RuntimeAgentSession` serializes ledger event appends on `ledgerChain` and rethrows via `drainLedger()`.
    - No runtime code changes required. Strengthened regressions: multi-round tool order now covers 2 rounds × 2 calls; revision+redactor asserts exact single repair text; key-collision object/Map assertions; high-delta ledger order + append-failure run rejection.
    - Docs drift closed in `docs/agent-loops.md`, `docs/credentials-and-redaction.md`, `docs/runs-and-usage.md`. Matrix R-001–R-004 marked `fixed`.
    - Focused suites green: `agent-loops`, `runtime-redaction`, `run-ledger` (45 pass).

- [x] 2. Re-verify and close transport, OAuth, JSONL, ENOENT, coding-agent image, and release P1/P2 findings
  - Acceptance Criteria:
    - Functional: Bounded SSE/error-body helpers remain the only readers across OpenAI-style providers; multiline `data:` events parse; OpenAI device-code OAuth polls with interval/slow-down/expiry/abort and redacts device/user/access/refresh codes; JSONL append fails closed on corrupt lines; missing optional files use typed `ENOENT`; coding-agent image reads enforce `maxImageBytes` and treat `autoResizeImages` as deprecated without silent no-op claims; release workflow gates tag/version consistency and requests provenance.
    - Performance: SSE/error caps prevent unbounded memory; JSONL remains documented non-production; no new network in default tests.
    - Code Quality: No reintroduction of per-package unbounded `safeText`/SSE clones; shared transport primitives stay authoritative.
    - Security: OAuth/token errors redact secrets; tarball/publish paths keep provenance and collision preflight.
  - Approach:
    - Documentation Reviewed:
      - Review findings for unbounded streams, OAuth, JSONL, ENOENT, coding-agent image, release workflow.
      - `docs/providers/openai-compatible.md`, OpenAI device-code / OAuth docs, `docs/node-jsonl-session-store.md`, `docs/coding-agent-tools.md`, `docs/release-and-install.md`.
      - Plans `054`, `058`.
    - Options Considered:
      - Re-extract transport primitives: only if drift found.
      - Verify + close residual gaps (docs/tests/workflow assertions): chosen.
    - Chosen Approach:
      - Confirm `src/providers/transport` (or current shared path) is used by all first-party providers; patch any outlier; strengthen OAuth/image/release assertions where thin.
    - API Notes and Examples:
      ```ts
      // OAuth device poll must respect interval / slow_down / expires_in / AbortSignal
      await provider.login({ onDeviceCode, signal });
      ```
    - Files to Create/Edit (tentative; confirm during verify):
      - `src/providers/**`, `packages/provider-*/src/**` only if transport drift.
      - `packages/provider-openai/src/oauth.ts` + OAuth tests if polling gaps.
      - `src/node/session-store-jsonl.ts`, `src/node/config.ts`, `packages/coding-agent/src/read.ts`.
      - `.github/workflows/release.yml`, `scripts/release.mjs` if gates missing.
      - Matching docs pages listed above.
    - References:
      - `code-reviews/2026-07-14.md` P1 streams/OAuth; P2 JSONL/image/ENOENT/release.
  - Test Cases to Write:
    - Oversized SSE frame / error body aborts with attributable protocol error.
    - Device-code pending → slow_down → success; abort mid-poll; secrets redacted.
    - Corrupt JSONL line blocks append; typed ENOENT missing-file path; oversized image rejected; release dry-run asserts provenance/tag match.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes for OAuth/image/release semantics if changed.
    - Docs pages to create/edit: `docs/providers/openai.md` (OAuth), `docs/coding-agent-tools.md`, `docs/node-jsonl-session-store.md`, `docs/release-and-install.md`.
    - `docs/index.md` update: yes if descriptions omit bounds/provenance.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Execution notes (2026-07-17):**
    - Re-verified Plans 054/058 semantics in place: all first-party providers import `@arnilo/prism/providers/transport` (`readSseData`/`readSseEvents`/`readBoundedResponseText`); no package-local `safeText`/SSE readers remain; multiline `data:` + overflow codes covered.
    - OAuth device-code polls with interval / `authorization_pending` / `slow_down` / expiry / abort; device/user/access/refresh redacted from failures. Coding-agent `maxImageBytes` + deprecated `autoResizeImages` already honest. Release CLI/workflow keep tag/version gate, collision preflight, `--provenance`, resume.
    - No runtime code changes required. Docs drift closed in `docs/node-jsonl-session-store.md` (append fail-closed + O(file) re-read + restart idempotency) and `docs/node-filesystem-config.md` (typed `ENOENT` via `isNodeErrorCode`). Strengthened regressions: OAuth refresh redacts access+refresh; JSONL shape-invalid append block; transport architectural guard against local SSE/`safeText` clones; release workflow provenance/tag assertion.
    - Matrix R-005–R-006, R-008–R-012 marked `fixed`.
    - Focused suites green: provider-transport, release, node-session-store-jsonl, node-config, openai codex-oauth, coding-agent read (45 core + workspace suites pass).

- [x] 3. Define shared caller-gated model-discovery pattern (primitive review before package work)
  - Acceptance Criteria:
    - Functional: Inventory existing discovery primitives (`listNeuralWattModels`, injectable `fetch`, abort, baseUrl, auth-optional mapping to `ModelConfig`); document a shared pattern for other packages without forcing setup-time network; OpenRouter remains app-registration based but may gain an optional list helper.
    - Performance: Discovery is never invoked by `create*ProviderPackage()`; helpers are O(response size) with bounded error-body reads.
    - Code Quality: Prefer thin package-local helpers over a heavy core registry; extract only proven shared pieces (HTTP list + map) if ≥2 packages need identical parsing. Reject provider-specific logic in core.
    - Security: Helpers do not log API keys; error text uses bounded redaction; no credentials embedded in returned `ModelConfig`.
  - Approach:
    - Documentation Reviewed:
      - Official list-models endpoints for OpenAI, Kimi, OpenRouter, NeuralWatt; OpenCode Go model listing docs; Z.AI model pages.
      - `packages/provider-neuralwatt/src/models.ts` (`listNeuralWattModels`).
      - Pi `generate-models` / static JSON approach (secondary; do not copy as sole strategy).
      - `plans/015-real-provider-packages.md` historical “no setup catalog fetch” rule — retain setup network-free, add on-demand helpers.
    - Options Considered:
      - Hardcoded catalogs only (status quo): rejected by user requirement for latest models.
      - Setup-time auto-fetch into package registration: rejected (hidden latency/network).
      - Caller-gated `list*Models({ fetch, apiKey, baseUrl, signal })` returning `ModelConfig[]`, with optional curated featured aliases for offline bootstrap: chosen.
    - Chosen Approach:
      - Document the NeuralWatt-shaped pattern as the package template; implement shared transport/error helpers only if duplication is proven in later tasks.
    - API Notes and Examples:
      ```ts
      export async function listExampleModels(options: {
        apiKey?: CredentialValueSource | string;
        fetch?: typeof fetch;
        baseUrl?: string;
        signal?: AbortSignal;
      }): Promise<ModelConfig[]> {
        // GET {baseUrl}/models — never called from create*ProviderPackage()
      }
      ```
    - Files to Create/Edit:
      - `docs/provider-packages.md`: discovery contract (caller-gated, setup-free).
      - `docs/provider-caching.md`: note that discovery may populate `ModelConfig.cache` / `cost` from live metadata when documented.
      - `docs/review-coverage-2026-07-17-provider-validation.md`: pattern decision.
      - Possibly `src/providers/` shared helper only if Task 3 proves reuse; otherwise package-local.
    - References:
      - NeuralWatt Phase 46/47 plans; OpenAI `GET /models`; OpenRouter `GET /api/v1/models`; Kimi list-models docs.
  - Test Cases to Write:
    - Pattern contract tests deferred to per-provider tasks; this task adds a docs/conformance checklist item that each package setup performs zero fetches.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documents a new cross-package discovery contract.
    - Docs pages to create/edit: `docs/provider-packages.md`, `docs/provider-caching.md`.
    - `docs/index.md` update: yes — mention on-demand model discovery in provider packages entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Execution notes (2026-07-17):**
    - Inventoried discovery primitives: only NeuralWatt ships `listNeuralWattModels` (+ `mapNeuralWattModel`, featured aliases). Shared reuse already available: `readBoundedResponseText`, `resolveCredentialValue`, `redactSecrets`. Factories for Kimi/Z.AI/OpenRouter/OpenCode Go/NeuralWatt accept `models?`; OpenAI factory still lacks `models?` (Task 6).
    - Decision: **no new core list-models helper** in Task 3 — package-local NeuralWatt-shaped `list*Models({ apiKey?, fetch?, baseUrl?, signal?, headers? }) → ModelConfig[]`; extract shared HTTP/list only if ≥2 packages later share identical parsing. OpenRouter remains app-registration-first with optional list helper; AI SDK no discovery; OpenCode Go/Z.AI may use curated official refresh when no list API.
    - Docs: `docs/provider-packages.md` caller-gated contract + per-package policy table; `docs/provider-caching.md` discovery→`cache`/`cost` note; `docs/provider-conformance.md` setup zero-fetch checklist; matrix Shared discovery section expanded; `docs/index.md` provider-packages blurb mentions on-demand discovery.
    - Tests: `docs.test.ts` `caller_gated_model_discovery_contract_is_documented` (+ matrix phrases). Per-provider `list_*` / setup-does-not-fetch suites remain owned by Tasks 6–11.

- [x] 4. Define shared per-turn thinking/reasoning configuration surface (primitive review)
  - Acceptance Criteria:
    - Functional: Inventory each provider’s official thinking/reasoning request fields and current Prism mapping; define a reusable helper (or thin conventions) so hosts can set a thinking level per turn that maps into the correct provider `compat`/`body` fields; model-level defaults remain on `ModelConfig.compat` / `capabilities.reasoning`, and per-turn overrides win via `ProviderRequestOptions.compat` (merged by existing `mergeProviderRequestOptions`).
    - Performance: Helper is pure/O(1); no network; no deep clones beyond existing option merges.
    - Code Quality: Prefer documenting + small mapper helpers over a heavy abstraction; do not invent a second options tree when `compat` already works; reject provider-specific logic in core unless ≥2 packages share identical mapping.
    - Security: Thinking controls never embed secrets; redaction unchanged.
  - Approach:
    - Documentation Reviewed:
      - Official: OpenAI `reasoning.effort` (Responses); Z.AI `thinking`/`reasoning_effort`/`tool_stream`; NeuralWatt `reasoning_effort`/`thinking_token_budget`/`chat_template_kwargs`/`preserve_thinking`/`clear_thinking`; OpenRouter `reasoning`; Kimi/Anthropic thinking blocks; OpenCode Go dual-route thinking.
      - Local: `ProviderRequestOptions.compat`, `mergeProviderRequestOptions`, package `thinking.ts` helpers, OM/LLM `thinkingLevel` → `extra.thinkingLevel` (currently does **not** map to provider fields).
      - Pi secondary only when official docs silent.
    - Options Considered:
      - Leave thinking as undocumented raw `compat` only: rejected; user requires applicable per-model settings and per-turn configureability.
      - New first-class `RunOptions.thinkingLevel` that core remaps for every provider: optional later; risk of core knowing every vendor.
      - Shared helper `applyThinkingLevel(options, level)` / `thinkingCompatFor(provider, level)` used by session runs and use-case workers, with providers continuing to read official fields from `compat`: chosen.
    - Chosen Approach:
      - Document the contract: model default in `ModelConfig.compat`, per-turn override in `providerOptions.compat`, merge order already established; implement/adjust package helpers so official fields are set; fix OM/LLM compaction so `thinkingLevel` flows into `compat` (not only inert `extra.thinkingLevel`).
    - API Notes and Examples:
      ```ts
      // Per-turn override on a session run
      await session.run(input, {
        providerOptions: { compat: { reasoning: { effort: "low" } } }, // OpenAI via helper
      });
      // Use-case worker
      await runObserver({ ..., providerOptions: applyThinkingLevel(base, "low") });
      ```
    - Files to Create/Edit:
      - Possibly `src/thinking.ts` or package-local mappers + `src/provider-request-policy.ts` only if merge gaps.
      - `docs/provider-packages.md` / new `docs/thinking-and-reasoning.md`.
      - Matrix page thinking column.
      - `packages/compaction-*/src/**` thinkingLevel wiring when Task 5 lands (coordinate; avoid double-fix).
    - References:
      - OpenAI https://developers.openai.com/api/docs/guides/reasoning ; Z.AI thinking guide; NeuralWatt docs; existing NeuralWatt/ZAI `thinking.ts`.
  - Test Cases to Write:
    - Merge: model compat medium + run compat high → request uses high.
    - Helper maps a shared level into OpenAI `reasoning.effort`, Z.AI `reasoning_effort`, NeuralWatt `reasoning_effort`, OpenRouter `reasoning` fixtures.
    - Non-reasoning model: helper no-ops or omits fields without corrupting body.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — thinking helper / docs contract.
    - Docs pages to create/edit: `docs/thinking-and-reasoning.md` (new), provider pages link to it.
    - `docs/index.md` update: yes — thinking/reasoning entry under provider/model connection.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Execution notes (2026-07-17):**
    - Inventoried mappings: OpenAI/OpenRouter share `reasoning.effort`; Z.AI/NeuralWatt(+Kimi K3) share `reasoning_effort`; Z.AI/Kimi K2 share `thinking.type`; AI SDK host-owned; unique knobs stay package-local. Confirmed OM/LLM wrote only inert `extra.thinkingLevel`.
    - Decision: core `src/thinking.ts` exports `THINKING_LEVELS`, `ThinkingLevel`, `ThinkingCompatFamily` (`openai_reasoning` | `reasoning_effort` | `thinking_type` | `noop`), `thinkingCompatFor`, `applyThinkingLevel`, `thinkingFamilyForModel`, `isThinkingLevel`, `normalizeThinkingLevel`. No second options tree; no forbidden provider literals in core (phase-11). Inference uses compat shape + `openai*`/`neuralwatt` heuristics + `capabilities.reasoning`.
    - Wired LLM compaction + OM `worker-loop` to `applyThinkingLevel` → `compat` (explicit level falls back to `reasoning_effort` when family would be `noop`). Session-model fallback completed in Task 5.
    - Docs: new `docs/thinking-and-reasoning.md`; sections in `provider-packages.md` + conformance checklist; matrix Shared thinking frozen; `docs/index.md` + `compaction-llm.md` updated.
    - Tests: `thinking.test.ts` (families/merge/heuristics); docs contract `per_turn_thinking_reasoning_contract_is_documented`; compaction strategy asserts `compat.reasoning_effort`; export freeze updated. Focused suites green.

- [x] 5. Design and implement use-case model selection separate from the session model
  - Acceptance Criteria:
    - Functional: Prism documents and implements a reusable binding pattern `{ model?, provider?, providerOptions?, thinkingLevel? }` for non-session LLM jobs; when the use-case binding omits `model`, it falls back to the active session/agent model (`AgentConfig.model` / current run model); observational memory currently skips with `missing_model` — change to session fallback unless explicitly disabled; LLM compaction already has `summaryModel ?? model` and must accept session fallback when wired from a session; hosts can configure distinct models for at least: observational-memory workers, LLM compaction summarizer, declarative `AgentDefinition`s / supervisor children, and per-run `RunOptions.model`.
    - Performance: Resolution is O(1) local merge; workers do not open hidden network; no duplicate session history mutation when workers use a different model.
    - Code Quality: Prefer one small resolver primitive (e.g. `resolveUseCaseModel({ configured, sessionModel })`) reused by OM + compaction + docs examples; do not force every package into core; keep embedder selection (memory/RAG) documented as a related but separate non-chat binding.
    - Security: Use-case providers resolve credentials for the **selected** model’s provider id; secrets from worker calls stay redacted; workers must not inherit ambient credentials for a different provider without explicit config.
  - Approach:
    - Documentation Reviewed:
      - Code inventory (this analysis):
        - Session default: `AgentConfig.model`.
        - Per-run override: `RunOptions.model` (+ `providerSource`, `providerOptions`) writes `model_change` session entries (`src/agents.ts`).
        - Declarative agents: `AgentDefinition.model` / `resolveModel` (`src/agent-definitions.ts`).
        - Observational memory: `workerModel` + settings `workerModel`/`thinkingLevel` — **no session fallback today** (`packages/compaction-observational-memory/src/runtime.ts` returns `skipped: "missing_model"`).
        - LLM compaction: `summaryModel ?? model` + `thinkingLevel` → currently `extra.thinkingLevel` (`packages/compaction-llm/src/strategy.ts`).
        - Evals/server: host `runOptions` can override model per invocation.
        - Supervisor (plan 065): children own models via `createSession` factories.
        - Memory/RAG: `Embedder` binding (not chat `ModelConfig`) — document as adjacent pattern.
        - RPC/CLI: explicit model params / state model.
      - Plans `017`, `016`, `033`, `065`; `docs/agent-session-runtime.md`, compaction docs.
    - Options Considered:
      - Keep ad-hoc per-package options forever: rejected; user wants systematic configureability with session fallback.
      - Force all workers onto `RunOptions` of the live session: rejected; workers must not mutate chat transcript/`model_change` for background jobs.
      - Shared `UseCaseModelBinding` + `resolveUseCaseModel(binding, sessionModel)` with package options accepting the binding; session fallback when `model` omitted; optional `requireExplicitModel: true` to preserve today’s OM fail-skip: chosen.
    - Chosen Approach:
      - Add a tiny core (or shared package) resolver + docs page listing every binding site; update OM to fall back to session model; update compaction extension wiring examples; ensure thinkingLevel uses Task 4 helper into `providerOptions.compat`; leave supervisor/agent-definition models as already-separate (document only); record embedder as non-LLM use-case.
    - API Notes and Examples:
      ```ts
      // Observational memory uses a cheap worker unless unset → session model
      createObservationalMemoryRuntime({
        session,
        appendEntry,
        workerProvider,
        workerModel: { provider: "neuralwatt", model: "glm-5.2-fast" }, // optional
        // thinkingLevel mapped into compat for the worker provider
        overrides: { thinkingLevel: "low" },
      });

      const model = resolveUseCaseModel({ configured: settings.workerModel, sessionModel: session.agent.config.model });
      ```
    - Files to Create/Edit:
      - `src/use-case-model.ts` (or equivalent) + exports in `src/index.ts`.
      - `packages/compaction-observational-memory/src/{runtime,settings}.ts` (+ tests): session fallback.
      - `packages/compaction-llm/src/strategy.ts` (+ tests): thinkingLevel → compat; document session fallback when hosted from session.
      - `docs/use-case-model-selection.md` (new); link from compaction/OM/agent docs.
      - Matrix / index updates.
    - References:
      - OM settings `workerModel`/`thinkingLevel`; LLM `summaryModel`; `RunOptions.model`; AgentDefinition model resolution.
  - Test Cases to Write:
    - OM: no workerModel → uses session model and runs observer; explicit workerModel wins; `requireExplicitModel` (if kept) still skips.
    - Compaction: thinkingLevel appears in provider-mapped compat fields, not only `extra`.
    - Resolver: configured wins; undefined configured → session; both undefined → throws/returns undefined per documented policy.
    - Credential request provider id matches resolved model.provider.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new resolver + OM fallback behavior change.
    - Docs pages to create/edit: `docs/use-case-model-selection.md`; update `docs/observational-memory.md` / compaction docs; provider thinking page cross-links.
    - `docs/index.md` update: yes — use-case model selection entry under compaction/session memory or agent runtime.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - **Execution notes (2026-07-17):**
    - Added core `src/use-case-model.ts`: `UseCaseModelBinding`, `resolveUseCaseModel`, `resolveUseCaseModelBinding`, `useCaseCredentialProviderId` (exported from `@arnilo/prism`; export freeze updated).
    - OM runtime: optional `sessionModel` + `requireExplicitModel`; resolves via `resolveUseCaseModel`; default credential request uses resolved `model.provider`; session fallback when worker model omitted and `sessionModel` supplied.
    - LLM compaction: `summaryModel`/`model` resolution goes through `resolveUseCaseModel` (same precedence as before).
    - Docs: new `docs/use-case-model-selection.md`; linked from `docs/index.md`, OM/LLM/thinking pages; matrix Task 5 inventory marked done.
    - Tests: `use-case-model.test.ts`; OM runtime session-fallback / requireExplicit / credential-provider regressions; docs contract `use_case_model_selection_contract_is_documented`.

- [x] 6. Validate and harden `@arnilo/prism-provider-openai` (official docs > Pi)
  - Acceptance Criteria:
    - Functional: Implementation matches OpenAI official Responses/prompt-caching/`GET /models` docs; `prompt_cache_key` / `prompt_cache_retention: "24h"` / usage `cached_tokens` mapping correct; add `listOpenAIModels()` (and Codex-aware variant if documented) so latest models are fetched on demand; static `openAIModels`/`openAICodexModels` become bootstrap/featured only or are derived from discovery fixtures in tests; **first-class per-turn reasoning** via official `reasoning: { effort }` (and summary if documented) from model defaults + `providerOptions.compat`, not only opaque passthrough; **close Responses protocol P0s**: assistant history uses `output_text` (not `input_text`); `function_call` items are top-level input items with `call_id` (not nested content with `id`); SSE tool argument deltas accept raw string `delta` on `response.function_call_arguments.delta` (not only object `arguments`/`arguments_delta`); factory accepts optional `models?: readonly ModelConfig[]` override like other packages.
    - Performance: Setup remains network-free; discovery is a single GET with bounded error body; request mapping unchanged in cost.
    - Code Quality: Prefer official field names/semantics over Pi when they differ; cite URLs in docs/tests comments/matrix.
    - Security: OAuth + API-key paths redact tokens; discovery errors never echo secrets.
  - Approach:
    - Documentation Reviewed:
      - Official: https://developers.openai.com/api/reference/resources/models/methods/list ; https://developers.openai.com/api/docs/guides/prompt-caching ; Responses `prompt_cache_key` / `prompt_cache_retention`; https://developers.openai.com/api/docs/guides/reasoning (`reasoning.effort`: `none`|`minimal`|`low`|`medium`|`high`|`xhigh`|`max` as model-dependent).
      - Pi secondary: `packages/ai/src/api/openai-responses.ts`, `openai-codex-responses.ts`, `providers/openai.models.ts` (generated).
      - Local: `packages/provider-openai/src/{responses,cache,models,oauth,codex}.ts`, `docs/providers/openai.md`.
    - Options Considered:
      - Keep only hardcoded `gpt-5.1` / `gpt-5.1-codex`: rejected.
      - Bundle Pi’s full generated OpenAI JSON: rejected as sole source (stale between releases; not official).
      - Official `GET /models` helper + keep small featured aliases for offline demos; add explicit reasoning mapping helper: chosen.
    - Chosen Approach:
      - Implement `listOpenAIModels`; map ids to `ModelConfig` with `cache: { kind: "openai_key", longRetention, maxKeyLength }`; map thinking level / compat into `body.reasoning`; update docs/tests; compare cache body fields to Pi only after official docs.
    - API Notes and Examples:
      ```ts
      const models = await listOpenAIModels({ apiKey, fetch });
      await kernel.load([createOpenAIProviderPackage({ apiKey, models })]);
      // body.prompt_cache_key, body.prompt_cache_retention === "24h" when longRetention + cacheRetention long
      // body.reasoning.effort from model.compat / options.compat per turn
      ```
    - Files to Create/Edit:
      - `packages/provider-openai/src/models.ts`, `index.ts`, tests, README.
      - `docs/providers/openai.md`, matrix page, `docs/provider-caching.md` OpenAI section if needed.
    - References:
      - Task 3 discovery pattern; existing `promptCacheKey` / `promptCacheRetention` helpers.
  - Test Cases to Write:
    - `list_openai_models_maps_fixture_and_forwards_auth_abort_baseurl`.
    - `openai_provider_setup_does_not_call_models`.
    - `openai_responses_prompt_cache_key_and_24h_retention_match_docs`.
    - `openai_responses_reasoning_effort_from_compat_and_per_turn_override`.
    - `openai_responses_serializes_assistant_output_text_and_top_level_function_call_with_call_id`.
    - `openai_responses_parses_string_function_call_arguments_delta`.
    - `openai_provider_package_accepts_models_override`.
    - Usage maps `input_tokens_details.cached_tokens` → `cacheReadTokens`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new discovery export; cache docs may change.
    - Docs pages to create/edit: `docs/providers/openai.md`; package README; matrix.
    - `docs/index.md` update: yes if OpenAI entry omits discovery/caching.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.


  - Execution notes (2026-07-17):
    - Official docs prioritized over Pi: Responses function-calling, streaming events, prompt caching, reasoning, GET /models.
    - Closed Responses P0s in `responses.ts`: assistant replay uses `output_text`; `function_call`/`function_call_output` are top-level with `call_id`; SSE accepts string `delta` on `response.function_call_arguments.delta` (+ `output_item.added`).
    - First-class `reasoning` merge via `resolveOpenAIReasoning(model, options)` (model defaults + per-turn compat; request wins).
    - Added caller-gated `listOpenAIModels`/`mapOpenAIModel`/`defineOpenAIModel`; factory accepts `models?`/`codexModels?`; setup remains zero-fetch. Codex stays featured/override-only (not on api.openai.com list).
    - GPT-5.6+ tracked: discovery sets `longRetention:false`; `prompt_cache_options`/breakpoints documented as host compat/extra passthrough (not a new helper).
    - Docs: `docs/providers/openai.md`, provider-packages/caching/thinking matrix + README/CHANGELOG updated.
    - Tests: all Task 6 named cases green in package suite (35 pass / 4 live skipped).


- [x] 7. Validate and harden `@arnilo/prism-provider-kimi` (official docs > Pi)
  - Acceptance Criteria:
    - Functional: Matches Kimi/Moonshot official model list + Anthropic-compatible `/messages` behavior where documented; prompt caching uses Anthropic-style `cache_control` only when official/endpoint support and Prism `cache.kind` allow it; add `listKimiModels()` / Moonshot list helper against official list-models API so catalogs are not solely hardcoded (`kimi-k2.7-code` etc.); **thinking/reasoning**: preserve thinking blocks on replay when applicable; document and implement any official thinking/budget/effort controls (or explicitly record "block preservation only; no effort API") so per-turn `providerOptions.compat` has a defined effect.
    - Performance: No setup fetch; discovery single request; cache markers applied only to selected breakpoints.
    - Code Quality: Resolve any Pi alias drift (`k2p7` vs official ids) in favor of official model ids; document Moonshot vs Kimi For Coding route differences.
    - Security: API keys redacted from errors; no cache keys carrying secrets.
  - Approach:
    - Documentation Reviewed:
      - Official: https://platform.kimi.ai/docs/api/list-models ; https://platform.kimi.ai/docs/models ; model parameter reference.
      - Pi secondary: `kimi-coding.models.ts`, `moonshotai*.ts`, `api/anthropic-messages.ts` cache_control.
      - Local: `packages/provider-kimi/src/{provider,cache,models}.ts`, `docs/providers/kimi.md`.
    - Options Considered:
      - Stay on hardcoded coding aliases only: rejected.
      - Official list-models helper + retain featured coding aliases: chosen.
    - Chosen Approach:
      - Web-search/fetch official caching guidance; if explicit `cache_control` unsupported on a route, keep opt-in/`implicit` semantics and document; implement discovery for both coding and Open Platform bases if docs differ.
    - API Notes and Examples:
      ```ts
      const models = await listKimiModels({ apiKey, fetch, baseUrl });
      // Anthropic route: last selected breakpoint may receive { type: "ephemeral", ttl?: "1h" }
      ```
    - Files to Create/Edit:
      - `packages/provider-kimi/src/models.ts`, `cache.ts`, `provider.ts`, tests, README.
      - `docs/providers/kimi.md`, matrix, caching docs if route policy changes.
    - References:
      - Task 3; existing `kimiShouldEmitCacheControl` opt-in behavior.
  - Test Cases to Write:
    - Discovery fixture mapping + setup-does-not-fetch.
    - Default model emits no `cache_control`; opted-in breakpoints only.
    - Usage maps `cache_read_input_tokens` / `cache_creation_input_tokens`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — discovery export; possible cache policy clarification.
    - Docs pages to create/edit: `docs/providers/kimi.md`.
    - `docs/index.md` update: yes if entry omits discovery/caching.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - **Execution notes (2026-07-17):**
    - Official docs validated: Moonshot `GET /v1/models` (id/context_length/capability flags); Thinking Mode + Thinking Effort + Model Parameter Reference; Kimi Code model ids (`kimi-for-coding`, `kimi-for-coding-highspeed`, `k3`). Pi secondary confirmed `k2p7` alias — Prism prefers official Coding ids.
    - Added caller-gated `listKimiModels`/`mapKimiModel` (Moonshot Open Platform only; Coding has no public list API). Setup remains zero-fetch.
    - Added callable `createMoonshotProvider` (Chat Completions) registered when `includeMoonshotModels: true` with separate `moonshotApiKey`/`moonshotBaseUrl`.
    - Thinking: `kimiThinking`/`kimiReasoningEffort`/`kimiPreserveThinking` (request wins); Coding Anthropic body + Moonshot body; Moonshot replays `reasoning_content`.
    - Featured catalogs refreshed to official ids; cache policy unchanged (Coding opt-in `cache_control`; Moonshot never emits it).
    - Docs: `docs/providers/kimi.md`, README, matrix, provider-packages discovery row. Package tests: 20 pass / 4 live skipped.

- [x] 8. Validate and harden `@arnilo/prism-provider-zai` (official docs > Pi)
  - Acceptance Criteria:
    - Functional: Request body fields match Z.AI official docs (`thinking`, `reasoning_effort`, `tool_stream`) — **not** obsolete `thinkingFormat` / `developerRoleFallback` docs text; catalog updated via official model list / docs (GLM-5.x etc.) through `listZaiModels()` or documented equivalent; implicit prompt caching remains (no spurious `cache_control` / `prompt_cache_key`); usage cache fields mapped if Z.AI documents them; **per-turn overrides** of `thinking`/`reasoning_effort`/`tool_stream` via `providerOptions.compat` win over model defaults and integrate with Task 4 thinking helper.
    - Performance: Setup network-free; discovery caller-gated.
    - Code Quality: Fix `docs/providers/zai.md` and README drift in the same task as code validation; Pi `zai.models.ts` used only as secondary id cross-check.
    - Security: API key redaction unchanged; no secrets in model metadata.
  - Approach:
    - Documentation Reviewed:
      - Official: https://docs.z.ai/guides/capabilities/thinking ; https://docs.z.ai/guides/capabilities/stream-tool ; https://docs.z.ai/api-reference/llm/chat-completion ; migrate-to-glm-5.2 guide; models pages / list if published.
      - Pi secondary: `zai.models.ts`, `zai.ts`.
      - Local: `packages/provider-zai/src/{thinking,provider,models}.ts`, `docs/providers/zai.md` (known mismatch).
    - Options Considered:
      - Restore `thinkingFormat: "zai"` abstraction: rejected; official body uses `thinking` object.
      - Align code+docs to official `thinking` / `reasoning_effort` / `tool_stream` and add discovery: chosen.
    - Chosen Approach:
      - Correct docs first to match code/official API; implement `listZaiModels` from official list endpoint or curated+verified latest ids if list API absent; keep `cache: { kind: "implicit" }`.
    - API Notes and Examples:
      ```ts
      // Official deep thinking
      { thinking: { type: "enabled" }, reasoning_effort: "high", tool_stream: true }
      ```
    - Files to Create/Edit:
      - `packages/provider-zai/src/**`, tests, README.
      - `docs/providers/zai.md` (remove `thinkingFormat` / `developerRoleFallback` claims).
      - Matrix page.
    - References:
      - Observation `2b90103d7b7a` docs/code mismatch.
  - Test Cases to Write:
    - Docs/export test: public docs do not mention removed compat fields.
    - Body contains `thinking`/`tool_stream`/`reasoning_effort` per fixtures.
    - Discovery setup-does-not-fetch; implicit cache fields absent from body.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — docs correction; discovery export; model catalog refresh.
    - Docs pages to create/edit: `docs/providers/zai.md` (required).
    - `docs/index.md` update: yes — Z.AI blurb should mention thinking/tool_stream/discovery.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.


  - **Execution notes (2026-07-17):**
    - Official docs prioritized over Pi: Deep Thinking, Thinking Mode (`clear_thinking` / Preserved Thinking), Tool Streaming, Context Caching (`prompt_tokens_details.cached_tokens`), Chat Completion model enum, Migrate to GLM-5.2, Models overview. Pi secondary (`zai.ts` / `zai.models.ts`) used only for id cross-check (glm-5.2/5.1/5-turbo/4.7/4.5-air/5v-turbo).
    - Closed docs drift: removed obsolete `thinkingFormat` / `developerRoleFallback` from `docs/providers/zai.md` + README; docs now document official `thinking` / `reasoning_effort` / `tool_stream` / `clear_thinking`.
    - Thinking harden: resolved fields win over raw compat spreads; boolean `thinking` maps to `{type}`; `clear_thinking` nests into thinking object; Preserved Thinking replays prior blocks as `reasoning_content` (never flattens into text); `cacheRetention: "none"` disables thinking.
    - Catalog: featured `zaiModels` refreshed to official ids (`glm-5.2`, `glm-5.1`, `glm-5`, `glm-5-turbo`, `glm-4.7`, `glm-4.6`, `glm-4.5`) with docs-verified context/output limits; default base URL → `https://api.z.ai/api/paas/v4`.
    - Discovery: caller-gated `listZaiModels` / `mapZaiModel` via OpenAI-compatible `GET /models` (no first-class docs.z.ai list page — curated featured set remains offline bootstrap). Setup remains zero-fetch. Implicit cache unchanged (no `cache_control` / `prompt_cache_*`).
    - Docs: providers/zai.md, README/CHANGELOG, provider-packages discovery row, thinking-and-reasoning.md, index Phase 12 blurb, validation matrix.
    - Tests: 24 pass / 4 live skipped (setup zero-fetch, per-turn override, clear_thinking, preserve/drop thinking, discovery map/redact, docs omit obsolete fields, implicit cache).

- [x] 9. Validate and harden `@arnilo/prism-provider-openrouter` (official docs > Pi)
  - Acceptance Criteria:
    - Functional: Remains app-controlled registration by default; add optional `listOpenRouterModels()` using official `GET https://openrouter.ai/api/v1/models` so hosts can fetch latest models instead of hardcoding; cache_control / session header / usage mapping match OpenRouter docs; no bundled mega-catalog committed; **reasoning** object remains model-default + per-turn `options.compat.reasoning` override and is covered by Task 4 helper mapping.
    - Performance: Setup does not fetch; discovery optional and bounded.
    - Code Quality: Keep routing/reasoning passthrough; Pi’s large `openrouter.models.ts` is reference-only, not vendored.
    - Security: Keys redacted; cache session id sanitized/length-capped.
  - Approach:
    - Documentation Reviewed:
      - Official: https://openrouter.ai/docs/api/api-reference/models/get-models ; OpenRouter caching/prompt-caching docs (fetch at execution); models guide.
      - Pi secondary: `openrouter.models.ts`, `api/openai-completions.ts` cache_control + openrouter session headers.
      - Local: `packages/provider-openrouter/src/{provider,cache,model}.ts`, `docs/providers/openrouter.md`.
    - Options Considered:
      - Vendor Pi’s 400+ model JSON: rejected (roadmap + size + staleness).
      - Optional official list helper returning `ModelConfig[]` for host registration: chosen.
    - Chosen Approach:
      - Implement mapper from OpenRouter model objects to Prism `ModelConfig` (capabilities/pricing/cache kind best-effort from documented fields); hosts pass result to `models:`.
    - API Notes and Examples:
      ```ts
      const models = await listOpenRouterModels({ apiKey, fetch });
      createOpenRouterProviderPackage({ apiKey, models: models.filter(...) });
      ```
    - Files to Create/Edit:
      - `packages/provider-openrouter/src/models.ts` (new) or extend `model.ts`, `index.ts`, tests, README.
      - `docs/providers/openrouter.md`, matrix, `docs/provider-packages.md`.
    - References:
      - Plan 015 OpenRouter app-controlled catalog decision (preserve; add opt-in fetch helper).
  - Test Cases to Write:
    - Fixture list maps id/pricing/context; auth optional per docs; setup-does-not-fetch.
    - Cache markers only when opted in; `cached_tokens` / `cache_write_tokens` usage mapping.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new optional discovery helper.
    - Docs pages to create/edit: `docs/providers/openrouter.md`.
    - `docs/index.md` update: yes — mention optional model list helper.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.


  - **Execution notes (2026-07-17):**
    - Official docs prioritized over Pi: Prompt Caching (sticky `session_id`, automatic top-level + explicit breakpoints, `cached_tokens`/`cache_write_tokens`), Reasoning Tokens (`reasoning.effort`/`max_tokens`/`exclude`, preserve via `message.reasoning`), Models API (`GET /api/v1/models` with pricing/modalities/`reasoning` metadata). Pi `openrouter.models.ts` not vendored.
    - Discovery: caller-gated `listOpenRouterModels` / `mapOpenRouterModel` — auth optional; maps pricing→`ModelCost` (per-million), cache kind heuristic, default `reasoning.effort`. Setup remains zero-fetch; app-controlled `models:` registration preserved (Plan 015).
    - Reasoning harden: `resolveOpenRouterReasoning` deep-merges model + per-turn compat (request wins); owned compat keys stripped before opaque spreads; `preserveThinking` replays assistant thinking as body `reasoning` (not folded into text) for tool-call continuity.
    - Cache harden: with no breakpoints, explicit cache models emit top-level automatic `cache_control`; with breakpoints, per-block markers only; `session_id`/`X-Session-Id` still sanitized to 256 chars; usage mapping unchanged.
    - Docs: providers/openrouter.md, README/CHANGELOG, provider-packages discovery row, provider-caching.md, thinking-and-reasoning.md, index Phase 12 blurb, validation matrix.
    - Tests: 18 pass / 4 live skipped (setup zero-fetch, per-turn reasoning merge, preserve reasoning replay, automatic top-level cache_control, discovery map/redact/auth-optional).

- [x] 10. Validate and harden `@arnilo/prism-provider-opencode-go` (official docs > Pi)
  - Acceptance Criteria:
    - Functional: Dual Anthropic/OpenAI routes match OpenCode Go official docs and current model list; replace/extend hardcoded `gpt-5.1-go` / `claude-sonnet-4.5-go` with discovery or docs-verified latest Go models (Pi currently lists glm/kimi/deepseek/grok/etc.); Anthropic-route `cache_control` correct; OpenAI route never leaks Anthropic cache fields; **thinking**: Anthropic-route thinking deltas/blocks and OpenAI-route `reasoning_content` map correctly; document any effort/budget fields per route or justify absence.
    - Performance: Setup network-free; discovery caller-gated if an official list endpoint exists, otherwise document curated refresh procedure sourced from official Go model list page.
    - Code Quality: Official OpenCode Go docs win over Pi `opencode-go.models.ts` when ids diverge; route selection via `compat.route` remains explicit.
    - Security: API key redaction; no cache secrets.
  - Approach:
    - Documentation Reviewed:
      - Official: https://opencode.ai/docs/go/ (and current model list linked there); any OpenCode models API if published.
      - Pi secondary: `opencode-go.models.ts`, `opencode-go.ts`.
      - Local: `packages/provider-opencode-go/src/{provider,anthropic-messages,openai-chat,cache,models}.ts`, `docs/providers/opencode-go.md`.
    - Options Considered:
      - Keep two stale aliases only: rejected.
      - If no public list API: curated catalog refreshed from official docs in this task + helper stub/document for future API: allowed compromise, recorded in Compromises.
      - If list API exists: `listOpenCodeGoModels()`: preferred.
    - Chosen Approach:
      - Web-search/fetch official Go model list at execution; implement discovery when possible; update static featured set to latest official ids; verify cache per route.
    - API Notes and Examples:
      ```ts
      // anthropic route may emit cache_control; openai route must not
      model: { compat: { route: "anthropic" }, cache: { kind: "cache_control" } }
      ```
    - Files to Create/Edit:
      - `packages/provider-opencode-go/src/**`, tests, README, `docs/providers/opencode-go.md`, matrix.
    - References:
      - Dual-route observation `d9540a2e88db`.
  - Test Cases to Write:
    - Latest featured models registered; route split; cache control anthropic-only; discovery/setup guarantees.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — catalog/discovery refresh.
    - Docs pages to create/edit: `docs/providers/opencode-go.md`.
    - `docs/index.md` update: yes if model/caching blurb stale.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - **Execution notes (2026-07-18):**
    - Official docs prioritized over Pi: https://opencode.ai/docs/go/ (model list, dual endpoints, pricing/usage, `GET /zen/go/v1/models`). Pi `opencode-go.models.ts` used only as secondary id/limits cross-check.
    - Catalog: removed stale Zen-style `gpt-5.1-go` / `claude-sonnet-4.5-go`; featured set refreshed to official Go open models (Grok 4.5, GLM-5.2/5.1, Kimi K3/K2.7 Code/K2.6, MiMo V2.5/Pro, MiniMax M3/M2.7/M2.5, Qwen3.7 Max/Plus, Qwen3.6 Plus, DeepSeek V4 Pro/Flash) with docs pricing + Pi secondary limits.
    - Routes: official endpoint table wins — MiniMax + Qwen → Anthropic `/messages` + `cache_control`; all others → OpenAI `/chat/completions` + implicit cache (Pi had diverged on `minimax-m2.7` / `qwen3.6-plus`).
    - Base URL: default → `https://opencode.ai/zen/go/v1` (was `https://api.opencode.ai/v1`).
    - Discovery: caller-gated `listOpenCodeGoModels` / `mapOpenCodeGoModel` / `routeForOpenCodeGoModel` against official sparse `GET /models`; setup remains zero-fetch.
    - Thinking: OpenAI route preserves `reasoning_content` (never folds into text); Anthropic preserves thinking blocks via shared helper; upstream `thinking`/`reasoning_effort`/`reasoning` passthrough with owned-compat strip; stream maps `reasoning_content` + `thinking_delta`.
    - Docs: providers/opencode-go.md, README/CHANGELOG, provider-packages discovery row, thinking-and-reasoning.md, index Phase 12 blurb, validation matrix.
    - Tests: 24 pass / 4 live skipped (setup zero-fetch, official ids, base URL, preserve/drop thinking, discovery map/redact, anthropic-only cache_control).

- [x] 11. Validate and harden `@arnilo/prism-provider-neuralwatt` (official docs > Pi)
  - Acceptance Criteria:
    - Functional: `listNeuralWattModels()` remains the authoritative live catalog against https://portal.neuralwatt.com/docs/api/models ; featured `neuralWattModels` aliases stay bootstrap-only without guessed pricing; implicit cache (no client cache_control) and `cached_tokens` → `cacheReadTokens` match docs; retry/telemetry/quota helpers still align with official semantics; **thinking controls** (`reasoning_effort`, `thinking_token_budget`, `chat_template_kwargs`, `preserve_thinking`, `clear_thinking`, `tool_choice`) remain model-default + per-turn override and integrate with Task 4 helper.
    - Performance: Setup does not call `/v1/models`; discovery uses bounded reads.
    - Code Quality: Prefer NeuralWatt official docs over any Pi absence (Pi has no NeuralWatt provider); fix drift in featured alias set vs live docs.
    - Security: Optional auth on discovery; secrets redacted from error bodies.
  - Approach:
    - Documentation Reviewed:
      - Official: https://portal.neuralwatt.com/docs/api/models ; overview; quickstart; caching/pricing notes in portal docs.
      - Local: `packages/provider-neuralwatt/src/{models,provider,thinking,retry,telemetry,quota}.ts`, `docs/providers/neuralwatt.md`.
      - Pi: N/A — record “no Pi provider; official docs only”.
    - Options Considered:
      - Remove static featured aliases entirely: optional; keep for offline demos if clearly labeled.
      - Keep dual static+discovery design; refresh aliases from official featured list: chosen.
    - Chosen Approach:
      - Re-fetch official `/v1/models` field schema; assert mapper coverage; update aliases/docs; confirm cache tests still encode implicit policy.
    - API Notes and Examples:
      ```ts
      const priced = await listNeuralWattModels({ apiKey, fetch });
      // cost.cacheRead from cached_input_per_million; no cache_control in chat body
      ```
    - Files to Create/Edit:
      - `packages/provider-neuralwatt/src/models.ts` (+ others only if drift), tests, `docs/providers/neuralwatt.md`, matrix.
    - References:
      - Plans 046–048; existing discovery tests.
  - Test Cases to Write:
    - Extend fixtures if official schema added fields; setup-does-not-fetch; implicit cache + 25% cache-read pricing relationship where documented.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: maybe (alias/metadata refresh).
    - Docs pages to create/edit: `docs/providers/neuralwatt.md` as needed.
    - `docs/index.md` update: only if blurb stale.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - **Execution notes (2026-07-18):**
    - Official docs prioritized over Pi: https://portal.neuralwatt.com/docs/api/models , chat-completions, overview, error-handling. **No Pi NeuralWatt provider** — official docs only.
    - Catalog: refreshed featured aliases to official list — added `gemma-4-31b`, removed legacy `kimi-k2`; GLM reasoning default `reasoning_effort: "max"` per official GLM-5.2 docs; static catalog still has no guessed pricing.
    - Thinking: `preserve_thinking` / `clear_thinking` compat flags route into `chat_template_kwargs` (not top-level body fields) per official gateway docs; `stripNeuralWattOwnedCompat` + resolved-field-after-spread ordering; `applyThinkingLevel(..., "reasoning_effort")` integration test.
    - Cache: implicit vLLM prefix caching unchanged — no client `cache_control`; `cached_tokens` → `cacheReadTokens`; 25% cache-read pricing relationship asserted in discovery tests.
    - Retry/telemetry/quota: re-verified against official error-handling + quota semantics (429/503 `retry_strategy`, SSE `: energy`/`: cost` comments, `GET /v1/quota` 1 rps).
    - Docs: providers/neuralwatt.md, README, examples/neuralwatt-agent-run.ts, validation matrix.
    - Tests: neuralwatt package tests pass (setup zero-fetch, kwargs routing, owned-compat strip, applyThinkingLevel, discovery map/redact, implicit cache).

- [x] 12. Validate `@arnilo/prism-provider-ai-sdk` (official AI SDK docs > Pi)
  - Acceptance Criteria:
    - Functional: Adapter remains host-owned `LanguageModelV4` bridge with no Prism-side model catalog (document explicitly); maps `usage.inputTokens.cacheRead/cacheWrite` to Prism `Usage`; does not invent prompt-cache request fields the host model does not support; specificationVersion validated; **thinking/reasoning** stream parts continue to map to Prism thinking deltas; document that reasoning effort is host-model-owned (pass via provider options / model settings the host already supports).
    - Performance: No network in adapter; streaming mapping is incremental.
    - Code Quality: Compare to official AI SDK V4 stream/usage types; Pi is not a primary reference here.
    - Security: No credential handling inside adapter beyond what host model already has; errors redacted per Prism norms if wrapped.
  - Approach:
    - Documentation Reviewed:
      - Official AI SDK Language Model V4 specification / usage token fields (web search at execution).
      - Local: `packages/provider-ai-sdk/src/{provider,stream,prompt,types}.ts`, package README / docs if present.
      - Pi: N/A or only conceptual streaming parallels.
    - Options Considered:
      - Add model discovery to ai-sdk package: rejected (host owns models).
      - Validate cache usage mapping + document “no catalog by design”: chosen.
    - Chosen Approach:
      - Strengthen tests for cacheRead/cacheWrite; document caching passthrough limits; ensure docs/index mentions host-owned catalog.
    - API Notes and Examples:
      ```ts
      createAiSdkProviderPackage({ model: hostLanguageModelV4 });
      // Usage.cacheReadTokens === part.usage.inputTokens.cacheRead
      ```
    - Files to Create/Edit:
      - `packages/provider-ai-sdk/src/**` only if mapping gaps; tests; docs page if missing (`docs/providers/ai-sdk.md` create if absent); matrix.
    - References:
      - Observation `a8c002562312`.
  - Test Cases to Write:
    - Stream usage with cacheRead/cacheWrite mapped; reject wrong specificationVersion; no fetch/catalog exports.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: docs clarity; possible mapping fix.
    - Docs pages to create/edit: `docs/providers/ai-sdk.md` (create if missing) or relevant provider-packages section.
    - `docs/index.md` update: yes — AI SDK adapter entry must say host-owned models, cache usage mapping.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - **Execution notes (2026-07-18):**
    - Official docs prioritized over Pi: [Custom providers / LanguageModelV4](https://ai-sdk.dev/providers/community-providers/custom-providers); [Language Model Specification V4](https://github.com/vercel/ai/tree/main/packages/provider/src/language-model/v4); `@ai-sdk/provider@4.0.3` `LanguageModelV4Usage` (`inputTokens.cacheRead`/`cacheWrite`, `outputTokens.reasoning`). Pi not used (no Pi AI SDK adapter).
    - Re-verified adapter: `specificationVersion: "v4"` gate; incremental `doStream` mapping; no Prism cache request fields; `options.compat`/`extra` → `providerOptions.prism`; assistant `thinking` ↔ AI SDK `reasoning` prompt parts; `reasoning-delta` → thinking deltas; `providerExecuted` tool calls ignored.
    - Usage mapping confirmed: `mapUsage` maps `inputTokens.cacheRead`/`cacheWrite` → `Usage.cacheReadTokens`/`cacheWriteTokens` (no fabrication when absent).
    - Docs: `docs/providers/ai-sdk.md` (catalog/cache/reasoning sections), `docs/provider-caching.md` matrix row, `docs/provider-conformance.md` AI SDK checklist, README/CHANGELOG, validation matrix status **fixed**.
    - Tests: 10 pass in package suite (usage mapping, no `list*Models` export, no cache payload, compat passthrough, thinking replay, provider-executed tool ignore, specification gate); docs contract `ai_sdk_adapter_contract_is_documented`.

- [x] 13. Cross-provider conformance, caching/thinking docs, use-case model docs, and final verification
  - Acceptance Criteria:
    - Functional: Every provider package task marked complete in the matrix with official-doc citations; `docs/provider-caching.md` summarizes per-provider cache kind (openai_key / cache_control / implicit / host-owned); `docs/thinking-and-reasoning.md` + matrix summarize per-provider thinking fields and per-turn override; `docs/use-case-model-selection.md` lists every binding site with session-fallback rules; no provider setup fetches catalogs; P0–P2 statuses closed or explicitly compromised; OM session-model fallback covered by tests.
    - Performance: `npm run sdk:ready` within existing CI backstop; no live-network default tests.
    - Code Quality: Export maps include new `list*Models` helpers, thinking helper, and use-case model resolver; frozen export tests updated; no duplicate unbounded SSE readers reintroduced.
    - Security: Secret canaries pass across provider/OAuth/redaction/use-case worker suites; publish dry-run still provenance-ready if touched.
  - Approach:
    - Documentation Reviewed:
      - All `docs/providers/*.md`, `docs/provider-caching.md`, `docs/thinking-and-reasoning.md`, `docs/use-case-model-selection.md`, `docs/provider-conformance.md`, `docs/provider-packages.md`, matrix page.
    - Options Considered:
      - Live integration smoke against real APIs: optional further action only (needs secrets).
      - Offline fixtures + sdk:ready gate: chosen for this plan.
    - Chosen Approach:
      - Update conformance helpers/docs; run focused package tests then full `sdk:ready`; fill Compromises/Further Actions.
    - API Notes and Examples:
      ```bash
      npm test --workspaces -- --grep 'list_.*models|cache|oauth|agent-loops|thinking|use.case|observational-memory'
      npm run sdk:ready
      ```
    - Files to Create/Edit:
      - `docs/provider-caching.md`, `docs/thinking-and-reasoning.md`, `docs/use-case-model-selection.md`, `docs/provider-conformance.md`, `docs/provider-packages.md`, `docs/index.md`, matrix page.
      - `plans/067-...md`: checkboxes, Compromises, Further Actions.
      - `plans/README.md`: refresh 067 entry description.
    - References:
      - All prior tasks; `.agents/skills/create-plan/references/prism-wiki.md`.
  - Test Cases to Write:
    - Docs navigation includes all provider pages + thinking + use-case model + matrix.
    - Workspace export tests include new discovery/thinking/use-case exports.
    - Regression: setup functions invoke zero `fetch` calls in unit tests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — consolidated public discovery/caching/thinking/use-case documentation.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes — caching + discovery + thinking + use-case model + validation coverage entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - **Execution notes (2026-07-18):**
    - Audited all seven provider pages plus caching, thinking, use-case selection, package/conformance, index, and evidence matrix docs. All provider rows are `fixed`; official evidence URLs remain frozen in the matrix; cache kinds cover `openai_key`, `cache_control`, `implicit`, route-specific, and host-owned behavior.
    - Strengthened final gates: `phase12-boundaries.test.ts` now covers all six HTTP packages, verifies every caller-gated `list*Models` export, and proves every package setup performs zero fetches. `docs.test.ts` now verifies all seven provider pages/matrix rows plus cache kinds, thinking rows, use-case binding sites, and index navigation.
    - Focused verification passed: 300 core tests; OpenAI 35 pass/4 live skipped; Kimi 20/4; Z.AI 24/4; OpenRouter 18/4; OpenCode Go 24/4; NeuralWatt 73/4; AI SDK 10; LLM compaction 25/1; observational memory 41.
    - First `sdk:ready` exposed one core boundary drift: a comment in `src/use-case-model.ts` named the optional observational-memory package. Reworded it generically; no runtime behavior changed.
    - Final `npm run sdk:ready` passed network-free: typecheck/build, 1,089 core tests, all workspace tests, export/package guards, provenance release checks, and `npm pack --dry-run` for the publish graph.

## Compromises Made

- Historical Plan 015 rejected setup-time catalog fetch; this plan keeps that constraint while adding caller-gated discovery. OpenCode Go's sparse `GET /zen/go/v1/models` response still requires route/cache/limit inference from official endpoint tables and featured metadata.
- Known upfront constraint: providers differ in thinking APIs (OpenAI `reasoning.effort` vs Z.AI/NeuralWatt `reasoning_effort` vs Anthropic thinking blocks); the shared helper maps levels best-effort and documents unmappable cases rather than forcing one wire shape.
- Known behavior change completed in Task 5: observational memory falls back to the host-supplied `sessionModel` when `workerModel` is unset; hosts that relied on skip opt into `requireExplicitModel: true` (retained escape hatch).
- Task 8: Z.AI has no first-class docs.z.ai `GET /models` page; `listZaiModels` follows the OpenAI-compatible `{baseUrl}/models` convention as best-effort, with featured `zaiModels` curated from the official Chat Completions model enum + overview as the offline source of truth.
- Task 10: Official OpenCode Go docs win over Pi when routes diverge (`minimax-m2.7` / `qwen3.6-plus` are Anthropic per docs; Pi marked some as OpenAI Completions). Default base URL corrected to `https://opencode.ai/zen/go/v1`.
- Task 12: AI SDK adapter intentionally has no Prism catalog or cache request mapping; hosts configure caching/reasoning on the supplied `LanguageModelV4`. Official community-provider docs show a simplified legacy usage shape — Prism follows `@ai-sdk/provider` v4 nested `LanguageModelV4Usage` (`inputTokens.cacheRead`/`cacheWrite`).

## Further Actions

- **P1 — optional live-provider smoke jobs:** run credential-gated conformance against real APIs on a schedule; keep PR/default CI network-free.
- **P2 — catalog drift reporting:** compare caller-gated official list endpoints in scheduled CI and report changes without mutating catalogs or package setup.
- **P2 — Z.AI discovery:** replace best-effort OpenAI-compatible `GET /models` with a first-class documented endpoint if Z.AI publishes one.
- **P3 — featured aliases:** reconsider removal only after discovery is practical for offline examples and every host integration.
- **P3 — first-class `RunOptions.thinkingLevel`:** add only if hosts repeatedly need it; current `applyThinkingLevel` + `providerOptions.compat` covers the requirement.
