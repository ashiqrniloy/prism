# Phase 6 — Release 0.0.11: Coding Harness Fundamentals (P1)

## Objectives

- Ship a bounded `SessionIndex` / search seam so hosts can list/filter prior sessions and resume via `sessionId` + optional `leafId`.
- Add token/context budgeting to prompt/context assembly with deterministic priority eviction and structured omission reports (raw session history untouched).
- Ship native `@arnilo/prism-provider-anthropic` then `@arnilo/prism-provider-google` behind existing provider-package contracts (AI SDK remains escape hatch).
- Export a thin goal→verify coding helper from `@arnilo/prism-coding-agent` plus a network-free example composing plan Markdown, checks, workflow suspend/approve, and PR handoff — no second runtime or Goal database.
- Extend opt-in `ask_user_decision` with multi-select, free-text answers, and durable workflow/agent suspend glue; ship real mid-run session steering (turn-boundary default + optional soft-interrupt).
- Version, document, and release-validate the graph as **0.0.11**.

## Expected Outcome

- Core exports `SessionIndex` query/hit types and an optional store search seam; SQLite/PostgreSQL implement metadata + optional FTS with finite pages; memory provides a capped linear fallback by default and an explicit unsupported opt-out.
- `assembleProviderInput` (and related builders) accept `contextBudget` with priority order system/AGENTS → skills → context → history/tool results and return omission metadata without deleting durable entries.
- Anthropic Messages and Google Gemini packages pass shared offline conformance + gated live canaries; credentials stay host-owned and late-bound.
- `runCodingGoalVerify` (name freeze in Task 0) + `examples/coding-goal-verify.ts` wire existing coding-checkpoint/checks/`git_pr_handoff`/`suspend`/`resumeWorkflow`.
- `session.steer` / RPC `steer` enqueue user text into an active run (default: inject before next provider turn; opt-in soft-interrupt aborts in-flight provider stream then continues). Opt-in `ask_user_decision` supports multi-select + free-text and durable suspend/resume (agent `runState` and/or workflow `suspend`).
- Network-free benchmarks cover search + budget paths; `npm run sdk:ready` and 0.0.11 dry-run gates pass; 0.0.12+ items (subscription OAuth, AG-UI, coding compaction preset) stay out of scope.

## Tasks

- [x] 0. Freeze Phase 6 scope, primitive ownership, limits, and evidence matrix
  - Acceptance Criteria:
    - Functional: map every Phase 6 roadmap criterion to current primitive, minimum gap, owning task, test, docs page, and release gate; mark 0.0.12+ coding-harness items (subscription OAuth adapters, AG-UI/ACP adapter, coding-aware compaction preset) out of scope.
    - Performance: freeze finite page/byte/time caps for session search and budget estimation; forbid always-on indexer/watcher daemons and unbounded full-store scans in default paths.
    - Code Quality: inventory `SessionStore` / `ProductionPersistenceStore.querySessions`, `assembleProviderInput` / input groups / cache-aware layout, provider package setup (`create*ProviderPackage`, conformance helpers, OpenCode Go/Kimi Anthropic-route serializers), coding-checkpoint + checks + `git_pr_handoff` + workflow `suspend`/`resumeWorkflow`; authorize only minimal new core seams; reject Goal DB / second runtime.
    - Security: freeze ownership/tenant filter rules for search hits; omission reports and search snippets never include credentials; provider credentials remain late-bound/redacted.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 6, Product Boundaries, Release Order gate 6, package ledger (anthropic/google/session-store/coding-agent/workflows).
      - `docs/session-stores.md`, `docs/input-and-prompt-assembly.md`, `docs/provider-packages.md`, `docs/provider-conformance.md`, `docs/agent-loops.md`, `docs/coding-agent-tools.md`, `docs/workflows.md`, Plan 073 further actions (0.0.11 deferrals).
      - Current: `SessionStore` / `SessionQuery` / `SessionRecord` / `OwnershipScope`; `packages/session-store-{sqlite,postgres}` DDL (`prism_sessions.metadata`, entry `label`/`summary`); `src/input.ts` groups + layouts; `packages/provider-opencode-go/src/anthropic-messages.ts` / Kimi Anthropic route as pattern only; `packages/coding-agent/src/{coding-checkpoint,checks,git-tools}.ts`; `examples/durable-coding-workflow.ts`.
      - Anthropic Messages (ctx7 `/anthropics/anthropic-sdk-typescript`): streaming SSE, tools, `cache_control` ephemeral/ttl, thinking blocks, usage.
      - Google Gemini (ctx7 `/websites/ai_google_dev_gemini-api`): `generateContent` / stream, function calling, multimodal parts, usage metadata.
      - Phase 5 freeze template: `docs/review-coverage-2026-07-21-phase-5.md`.
    - Options Considered:
      - Host-only session search outside Prism: duplicates every TUI/desktop; rejected for index seam.
      - Always-on indexer/watcher: product daemon; rejected.
      - Extend only `ProductionPersistenceStore.querySessions`: lacks FTS/message search + SessionStore-only hosts; rejected as sole surface.
      - Bounded `SessionIndex` API + DB implementations + memory linear/unsupported modes: chosen.
      - Depend only on AI SDK for Anthropic/Google: hides cache/thinking/tool semantics; rejected.
      - New Goal runtime/table: duplicates workflows/plans; rejected.
      - Extract shared Anthropic Messages serializer into core now: OpenCode Go/Kimi routes are vendor-shaped; prefer package-local Anthropic package first; extract later only if serializers are byte-identical (≥2 consumers rule).
    - Chosen Approach:
      - Wrote `docs/review-coverage-2026-07-22-phase-6.md` with criterion→task ownership, primitive inventory, limit table, threat owners, non-goals.
      - Frozen API names: `SessionIndex` / `SessionSearchQuery` / `SessionSearchHit`; `contextBudget` + `getContextBudgetReport`; `createAnthropicProviderPackage` / `createGoogleProviderPackage`; `runCodingGoalVerify`; memory `sessionSearchMode: "linear" | "unsupported"` (default `"linear"`); workspace filter `metadata.workspaceRoot`.
      - Eviction order frozen: system/AGENTS → skills → context → history/tool results.
      - Non-goals: AG-UI, subscription OAuth, coding compaction preset, Vertex/Bedrock enterprise identity, always-on FTS reindex workers, Goal database, shared Anthropic core extract.
    - API Notes and Examples:
      ```text
      roadmap criterion -> current seam -> gap -> owner task -> test -> docs -> release gate
      memory search: linear (default) | unsupported (opt-out)
      goal/verify: coding-agent export + examples/coding-goal-verify.ts
      search page: default 20 / hard 100; query 4KiB/16KiB; snippet 512/4KiB
      ```
    - Files to Create/Edit:
      - `docs/review-coverage-2026-07-22-phase-6.md` (new): scope, primitive inventory, limits, threats, gates.
      - `docs/index.md`: link Phase 6 review coverage under Release/maintenance.
      - `src/__tests__/docs.test.ts`: Phase 6 evidence assertions.
      - `plans/074-release-0-0-11-coding-harness-fundamentals.md`: Task 0 checked.
    - References:
      - Existing `querySessions` is metadata-only (tenant/time/agent); no text/FTS/workspace filters today.
      - No `SessionIndex` / `contextBudget` / `runCodingGoalVerify` symbols exist yet.
      - Freeze source: `a677113a409b1b60a3361a76c980e7411013916a`.
  - Test Cases to Write:
    - Traceability: every Phase 6 criterion has exactly one owner; 0.0.12+ items absent from implementation tasks.
    - Primitive: proposed shared helpers have ≥2 concrete consumers or stay package-local.
    - Limit/threat: every search/budget path reuses finite caps with abort/ownership owners.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; freezes release scope before code changes.
    - Docs pages to create/edit:
      - `docs/review-coverage-2026-07-22-phase-6.md`: evidence matrix.
    - `docs/index.md` update: yes; add Phase 6 review coverage.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 1. Add `SessionIndex` contracts and optional store search seam
  - Acceptance Criteria:
    - Functional: core exports bounded query types filtering by workspace (metadata key or explicit field), time range, model/provider, label/summary text, and optional full-text over message/summary content; hits return `sessionId` + optional `leafId` (plus safe display fields); pagination uses finite `limit`/`cursor`.
    - Functional: seam is optional on `SessionStore` and/or a narrow `SessionIndex` interface adapters can implement; hosts with only memory/JSONL are not forced to implement FTS.
    - Performance: hard caps on page size, query string bytes, and result snippet bytes; O(1) validation before any scan/query.
    - Code Quality: types live next to existing session/persistence contracts; no second persistence subsystem; no credential fields on hits.
    - Security: queries accept `OwnershipScope`; adapters must filter by tenant/account/user when present; hits never embed secrets/credentials.
  - Approach:
    - Documentation Reviewed:
      - `docs/session-stores.md`, `docs/database-persistence.md`, `docs/session-store-conformance.md`.
      - Current `SessionQuery` / `SessionRecord` / `PersistencePage` / `OwnershipScope`.
      - Task 0 freeze page (`docs/review-coverage-2026-07-22-phase-6.md`).
    - Options Considered:
      - Only extend `SessionQuery` on `ProductionPersistenceStore`: insufficient for SessionStore-only + FTS; rejected as sole API.
      - Separate `SessionIndex` with `search(query)` returning `PersistencePage<SessionSearchHit>`: chosen.
      - Required method on every `SessionStore`: breaks memory/JSONL; rejected — keep optional + helpers.
    - Chosen Approach:
      - Added `SessionSearchQuery`, `SessionSearchHit`, `SessionIndex`, `ResolvedSessionSearchQuery`, caps, and `resolveSessionSearchQuery` in `src/contracts.ts`.
      - Optional `SessionStore.searchSessions?`; workspace filter key `SESSION_SEARCH_WORKSPACE_METADATA_KEY` (`metadata.workspaceRoot`).
      - Conformance gated via `exerciseSearchSessions` (empty/limit/invalid/ownership-widen checks).
    - API Notes and Examples:
      ```ts
      const hits = await index.search({
        workspaceRoot: "/repo",
        query: "flaky auth test",
        provider: "anthropic",
        fromUpdatedAt: "2026-01-01T00:00:00Z",
        limit: 20,
        tenantId: "t1",
      });
      await session.checkout(hits.items[0]?.leafId);
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: types + hard-cap constants + `resolveSessionSearchQuery` + optional `searchSessions?`.
      - `src/index.ts`: value exports for caps/resolver.
      - `src/testing/session-store-conformance.ts`: `exerciseSearchSessions`.
      - `src/__tests__/session-index.test.ts`, `src/__tests__/public-export-contract.test.ts`.
      - `docs/public-contracts.md`: inventory row (detail docs in Task 8).
    - References:
      - Roadmap API sketch; existing `querySessions` remains for admin metadata listing.
  - Test Cases to Write:
    - Type/export smoke; invalid limit/NaN/oversized query rejected.
    - Conformance helper: empty index, pagination, ownership mismatch returns empty/forbidden per freeze.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new search contracts.
    - Docs pages to create/edit: freeze shape here; full pages in Task 8 (`docs/session-stores.md`).
    - `docs/index.md` update: no in this task (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 2. Implement SQLite and PostgreSQL session search
  - Acceptance Criteria:
    - Functional: both adapters implement `SessionIndex.search` (or equivalent) with metadata filters (workspace/time/model/provider/label/summary) and optional full-text over message/summary content; results include `sessionId` + optional `leafId` for resume/checkout.
    - Functional: migrations add any FTS/index objects with name/version/checksum drift protection consistent with existing migration gates.
    - Performance: finite page sizes; FTS/query plans stay bounded; no full unconstrained table dump for default search; publishable network-free microbench later in Task 9.
    - Code Quality: shared query shaping where identical; dialect-specific FTS (SQLite FTS5 / Postgres `tsvector` or equivalent) stays adapter-local.
    - Security: ownership predicates applied before text match; snippets redaction-safe (no raw credential-looking payloads in hit text).
  - Approach:
    - Documentation Reviewed:
      - `packages/session-store-sqlite/src/{ddl,migrations,persistence}.ts`, postgres twins.
      - SQLite FTS5 and PostgreSQL full-text search docs at implementation time.
    - Options Considered:
      - Application-level scan of all entries: simplest, unbounded; rejected for DB adapters.
      - Metadata indexes only (no FTS): misses roadmap message FTS; rejected as sole path.
      - Metadata filters + optional FTS tables maintained on append: chosen.
    - Chosen Approach:
      - Add migration(s) for search indexes / FTS virtual tables or generated tsvector columns.
      - Maintain index on append/update paths already owned by adapters; keep dual-write bounded.
      - Reuse `OwnershipScope` filters already used by `querySessions`.
    - API Notes and Examples:
      ```ts
      const { sessionStore, /* or */ index } = await createSqlitePersistence(...);
      await index.search({ query: "auth flake", limit: 10, tenantId });
      ```
    - Files to Create/Edit:
      - `packages/session-store-sqlite/src/{ddl,migrations,persistence,types}.ts` + tests.
      - `packages/session-store-postgres/src/{ddl,migrations,persistence,types}.ts` + tests.
      - Package CHANGELOGs (Unreleased; version bump Task 9).
    - References:
      - Existing `label`/`summary` columns on `prism_session_entries`; `prism_sessions.metadata` JSON.
  - Test Cases to Write:
    - Pagination, empty index, label/summary hit, message FTS hit, ownership isolation, resume via returned `leafId`.
    - Migration drift/checksum still fails closed.
    - Oversized query/limit rejected.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; adapter search behavior + migrations.
    - Docs pages to create/edit: Task 8 (`docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/session-stores.md`).
    - `docs/index.md` update: Task 8.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 3. Memory session search: linear fallback + unsupported opt-out
  - Acceptance Criteria:
    - Functional: `createMemorySessionStore` (or companion helper) supports `sessionSearchMode: "linear"` (default): capped linear scan implementing `SessionIndex` semantics for tests/dev.
    - Functional: `sessionSearchMode: "unsupported"` makes `search` throw a typed clear error (not silent empty).
    - Performance: linear mode enforces max sessions/entries/bytes scanned per call; aborts on signal.
    - Code Quality: one helper path; JSONL may document unsupported or thin linear scan — prefer explicit unsupported unless freeze requires otherwise.
    - Security: same ownership filters; no credential fields in hits.
  - Approach:
    - Documentation Reviewed:
      - `src/session-stores.ts` memory store; user choice: both modes documented.
    - Options Considered:
      - Linear only / unsupported only: rejected; user selected both.
      - Default linear + opt-out unsupported: chosen.
    - Chosen Approach:
      - Add options to memory store factory; document in session-stores docs (Task 8).
      - Keep default linear so unit tests can exercise search without SQLite.
    - API Notes and Examples:
      ```ts
      const store = createMemorySessionStore(undefined, { sessionSearchMode: "linear" });
      const strict = createMemorySessionStore(undefined, { sessionSearchMode: "unsupported" });
      ```
    - Files to Create/Edit:
      - `src/session-stores.ts`, exports/tests.
      - Possibly `src/node/session-store-jsonl.ts` docs-only unsupported note.
    - References:
      - Roadmap: “memory store may provide a linear fallback or explicit unsupported error.”
  - Test Cases to Write:
    - Linear: hit/miss/pagination/ownership/cap exceeded.
    - Unsupported: throws typed error; does not return empty success.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; memory store options.
    - Docs pages to create/edit: Task 8.
    - `docs/index.md` update: Task 8 if Sessions blurb changes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 4. Token/context budget with deterministic eviction and omission report
  - Acceptance Criteria:
    - Functional: `assembleProviderInput` / default builders accept `contextBudget` (`maxInputTokens` and/or byte proxy) with deterministic priority eviction: keep system/AGENTS first, then skills, context, then history/tool results (exact order frozen in Task 0; must match roadmap intent).
    - Functional: when `reportOmissions: true`, return structured omission report (what dropped: skills, context blocks, history, tool results) without deleting raw session history / store entries.
    - Functional: zero/insufficient budget fails closed with typed error when even mandatory prefix cannot fit; cache-aware stable prefix preserved when budget allows.
    - Performance: estimation is finite (cheap heuristic OK if documented); no provider round-trip required for budgeting.
    - Code Quality: budget lives in input assembly seam only; no parallel assembler; reuse message groups from `createDefaultInputBuilder`.
    - Security: omission report contains ids/kinds/sizes, not secret values; redactor still applies before provider request.
  - Approach:
    - Documentation Reviewed:
      - `docs/input-and-prompt-assembly.md`, `src/input.ts` groups + `legacy`/`cache_aware` layouts.
      - `docs/provider-caching.md` stable-prefix rules.
    - Options Considered:
      - Host-only trimming: duplicates every host; rejected for shared seam.
      - Compaction strategy as budget: mutates/summarizes history; out of scope (0.0.12 preset); rejected for this task.
      - Assembler-time eviction + omission report: chosen.
    - Chosen Approach:
      - Add `estimateAssemblyTokens` (heuristic chars/4 or existing content byte helpers) + `applyContextBudget` over assembled groups before final flatten.
      - Attach omission report on `ProviderRequest.metadata` or companion return — freeze one shape in Task 0 (prefer non-breaking: metadata key + optional typed helper `getContextBudgetReport(request)`).
      - Do not call session store delete/compact.
    - API Notes and Examples:
      ```ts
      const request = await assembleProviderInput({
        model,
        input,
        contextBudget: { maxInputTokens: 32_000, reportOmissions: true },
      });
      // request.metadata.contextBudgetReport → { omitted: [{ kind: "history", ... }], keptTokens, ... }
      ```
    - Files to Create/Edit:
      - `src/input.ts` (and/or `src/context-budget.ts`), `src/index.ts`, tests under `src/__tests__/`.
      - Agent runtime wiring only if `AgentConfig`/`RunOptions` must forward budget (minimal plumbing).
    - References:
      - Roadmap priority order; cache-aware layout must not be silently destroyed when budget permits full stable prefix.
  - Test Cases to Write:
    - Eviction order fixtures; omission completeness; zero-budget failure; stable cache-prefix retained when under budget; oversized single block fails closed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; assembly options/metadata.
    - Docs pages to create/edit: Task 8 (`docs/input-and-prompt-assembly.md`).
    - `docs/index.md` update: Task 8 (Input/context entry).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 5. Ship `@arnilo/prism-provider-anthropic` (native Messages)
  - Acceptance Criteria:
    - Functional: package exports `createAnthropicProviderPackage` / `createAnthropicMessagesProvider` (names per freeze) covering tools, `cache_control` breakpoints, thinking/reasoning, media, usage, errors, abort, and caller-gated `listAnthropicModels` discovery; setup performs zero network.
    - Functional: credentials host-owned via `CredentialValueSource`; provider-owned headers win; secrets redacted in errors.
    - Performance: streaming uses existing bounded SSE/transport helpers; respects `ProviderRequest.signal` and run limits.
    - Code Quality: optional package; no vendor SDK dependency; follow OpenAI/Kimi package layout; may pattern-match OpenCode Go Anthropic route without forcing a shared extractor this release.
    - Security: no env/keychain scan at import/setup; live tests gated (`PRISM_LIVE_PROVIDER_TESTS=1` + `ANTHROPIC_API_KEY`).
  - Approach:
    - Documentation Reviewed:
      - `docs/provider-packages.md`, `docs/provider-conformance.md`, `docs/provider-caching.md`, `docs/thinking-and-reasoning.md`, `docs/providers/openai.md` template.
      - Anthropic Messages API (ctx7 `/anthropics/anthropic-sdk-typescript`): stream events, tools, `cache_control` ephemeral `5m`/`1h`, thinking.
      - `packages/provider-opencode-go/src/anthropic-messages.ts` as wire-shape reference only.
    - Options Considered:
      - AI SDK only: rejected by roadmap.
      - Depend on official Anthropic SDK: adds runtime dependency; rejected (first-party HTTP + core transport).
      - Native fetch Messages adapter package: chosen.
    - Chosen Approach:
      - New workspace `packages/provider-anthropic` mirroring openai/kimi structure.
      - Register featured static models; `listAnthropicModels` caller-gated.
      - Wire into `@arnilo/prism-providers` umbrella in Task 9.
      - Offline conformance via `@arnilo/prism/testing/provider-conformance`.
    - API Notes and Examples:
      ```ts
      import { createAnthropicProviderPackage, listAnthropicModels } from "@arnilo/prism-provider-anthropic";
      const models = await listAnthropicModels({ apiKey });
      await kernel.load([createAnthropicProviderPackage({ apiKey, models })]);
      ```
    - Files to Create/Edit:
      - `packages/provider-anthropic/**` (package.json, src, tests, README, CHANGELOG).
      - Root workspace already matches `packages/provider-*`.
      - `docs/providers/anthropic.md` (Task 8 may finalize).
    - References:
      - Roadmap package ledger row; Product Boundaries “direct Anthropic/Google exception.”
  - Test Cases to Write:
    - Offline: text/tool/reasoning/cache/media/usage/error/abort/discovery + header ownership + no-secret-leak.
    - Live smoke: gated skip by default.
    - Setup zero-fetch checklist.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new provider package.
    - Docs pages to create/edit: `docs/providers/anthropic.md`, `docs/provider-packages.md` matrix row (Task 8).
    - `docs/index.md` update: yes (Providers) in Task 8.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 6. Ship `@arnilo/prism-provider-google` (native Gemini coding-host semantics)
  - Acceptance Criteria:
    - Functional: package exports `createGoogleProviderPackage` / Gemini provider covering tools/function calling, media, usage, errors, abort, discovery needed for coding hosts; same conformance bar as Anthropic; AI SDK remains documented escape hatch not primary path.
    - Functional: credentials host-owned; setup zero network; live gated (`GOOGLE_API_KEY` or freeze-equivalent).
    - Performance: stream within existing transport bounds and run limits.
    - Code Quality: optional package; no `@google/genai` runtime dependency unless freeze proves wire cannot be represented with `fetch` (prefer fetch).
    - Security: same late-bound/redaction/header rules as other first-party providers.
  - Approach:
    - Documentation Reviewed:
      - Gemini API (ctx7 `/websites/ai_google_dev_gemini-api`): `generateContent` / stream, function calling, multimodal `inlineData`.
      - Existing provider package + media SSRF helpers.
    - Options Considered:
      - Defer Google to 0.0.15: rejected; roadmap requires both in 0.0.11.
      - AI SDK Google adapter as primary: rejected.
      - Native Gemini HTTP package after Anthropic: chosen.
    - Chosen Approach:
      - Implement after Anthropic so shared packaging/test harness lessons reuse.
      - Featured model catalog + `listGoogleModels` caller-gated.
      - Explicitly document Vertex enterprise identity as 0.0.13 — out of scope here.
    - API Notes and Examples:
      ```ts
      import { createGoogleProviderPackage } from "@arnilo/prism-provider-google";
      await kernel.load([createGoogleProviderPackage({ apiKey })]);
      ```
    - Files to Create/Edit:
      - `packages/provider-google/**`.
      - `docs/providers/google.md` (Task 12).
    - References:
      - Roadmap: Anthropic then Google; enterprise Vertex separate.
  - Test Cases to Write:
    - Same offline conformance matrix as Anthropic (tool/media/usage/error/abort/discovery).
    - Restricted live smoke skip-by-default.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new provider package.
    - Docs pages to create/edit: `docs/providers/google.md`, provider matrix (Task 12).
    - `docs/index.md` update: Task 12.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 7. Goal→verify helper in coding-agent + example
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-coding-agent` exports a thin `runCodingGoalVerify` (name per freeze) composing existing plan Markdown, coding tools, named checks, workflow suspend/approve, and bounded PR-handoff — no Goal table, no second agent/workflow engine.
    - Functional: failing check suspends for approval; approve resumes; handoff artifact bounded; plan state holds no credentials.
    - Performance: helper adds no unbounded loops beyond host-supplied run/workflow limits.
    - Code Quality: helper is composition glue; reuses `createCodingPlanMarkdown` / checks / `git_pr_handoff` / `@arnilo/prism-workflows` `suspend`/`resumeWorkflow`; example is network-free.
    - Security: fail closed on missing approval policy; secrets redacted from checkpoint/plan metadata.
  - Approach:
    - Documentation Reviewed:
      - `examples/durable-coding-workflow.ts`, `docs/workflows.md`, `docs/coding-agent-tools.md`.
      - User choice: coding-agent export + example.
    - Options Considered:
      - Example-only: weaker host reuse; rejected by user.
      - Workflows-package home: coding-agent already owns plan/checks/handoff; rejected.
      - coding-agent export + example: chosen.
    - Chosen Approach:
      - Add `src/goal-verify.ts` (tentative) exporting helper + types.
      - Add `examples/coding-goal-verify.ts` mirroring durable-coding style with memory checkpoint/lease stores.
      - Optionally re-export from workflows docs as consumer pattern only.
    - API Notes and Examples:
      ```ts
      await runCodingGoalVerify({
        goal: "Fix flaky auth",
        cwd,
        checks: ["test"],
        approval,
      });
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/goal-verify.ts`, `index.ts`, tests.
      - `examples/coding-goal-verify.ts`, `examples/README.md` link.
      - Package README/CHANGELOG Unreleased.
    - References:
      - Roadmap rejects Goal runtime/table; Plan 072 durable coding composition.
  - Test Cases to Write:
    - Failing check → suspend; approve → resume success path (fake runners).
    - Handoff artifact bounded; no credentials in plan/checkpoint state.
    - Example typechecks / runs network-free.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new coding-agent export + example.
    - Docs pages to create/edit: Task 12 (`docs/coding-agent-tools.md`, `docs/agent-loops.md`, examples README).
    - `docs/index.md` update: Task 12 (Coding tools).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 8. Mid-run session steering (`steer`)
  - Acceptance Criteria:
    - Functional: active session accepts host/RPC `steer({ input })` while a run is in progress; default injects steered user text **before the next provider turn** (after current tool batch completes). Optional `softInterrupt: true` aborts the in-flight provider stream, then continues the same run with steered text as the next user message.
    - Functional: RPC `steer` stops throwing “unsupported”; second `prompt`/`followUp` while busy still rejects (no silent queue of full runs). `steer` while no active run fails closed.
    - Performance: pending steer queue finite (freeze default ≤8 messages / ≤64 KiB total UTF-8; hard caps documented); overflow fails closed (no unbounded backlog).
    - Code Quality: reuse existing `AbortSignal` / run exclusivity; no second agent loop; steered text goes through normal redaction + session append rules.
    - Security: steered content treated as user input (redacted, guardrail input checks); no credential fields; abort reasons remain non-secret.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md` (one active run; abort); `docs/cli-rpc.md` (`steer` currently unsupported); `src/rpc.ts` steer throw; `src/agents.ts` run exclusivity.
      - User choice (2026-07-22): turn-boundary default + optional soft-interrupt flag.
    - Options Considered:
      - Abort + new `run` only: loses “same run continues”; rejected as sole path.
      - Soft-interrupt-only: harsher default; rejected.
      - Turn-boundary default + opt-in soft-interrupt: chosen.
      - Queue concurrent `prompt`s: changes exclusivity contract; rejected.
    - Chosen Approach:
      - Add `AgentSession.steer(input, options?)` + pending-steer buffer on active run.
      - Loop checks buffer between tool rounds / before next `assembleProviderInput` provider turn; append steered user message(s) then continue.
      - `softInterrupt: true` aborts provider generate with a distinguished reason, drains tools already dispatched for that turn per existing abort rules, then injects steer before next turn.
      - Wire RPC `steer` → session.steer; keep `followUp`/`prompt` exclusivity reject.
    - API Notes and Examples:
      ```ts
      // during session.run(...)
      session.steer("Prefer SQLite for this milestone", { softInterrupt: false });
      // RPC
      {"id":"s1","command":"steer","params":{"input":"Stop editing auth; fix tests first","softInterrupt":true}}
      ```
    - Files to Create/Edit:
      - `src/agents.ts`, `src/contracts.ts` (types/limits if needed), `src/rpc.ts`, `src/__tests__/agents.test.ts`, `src/__tests__/rpc.test.ts`.
      - Docs deferred to Task 12 (`docs/agent-session-runtime.md`, `docs/cli-rpc.md`, `docs/migration.md`).
      - Evidence matrix note in Task 12 / optional touch `docs/review-coverage-2026-07-22-phase-6.md`.
    - References:
      - Existing abort + one-run exclusivity; RPC command name already reserved.
  - Test Cases to Write:
    - Steer between tool rounds appears as user message before next provider turn.
    - Soft-interrupt aborts provider stream then continues same `runId`.
    - Steer with no active run → error; overflow caps → error.
    - RPC steer ok during prompt; concurrent followUp still rejects.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new session/RPC steer semantics.
    - Docs pages to create/edit: Task 12 — `docs/agent-session-runtime.md`, `docs/cli-rpc.md`, `docs/migration.md`, `docs/public-contracts.md` if contract tables list session methods.
    - `docs/index.md` update: Task 12 (Agent/session runtime + CLI/RPC blurbs if needed).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Execution evidence (2026-07-22):
    - `AgentSession.steer(input, { softInterrupt? })` + pending queue (default ≤8 / 64KiB); RPC `steer` wired.
    - Turn-boundary drain in `singleShotLoop` / GVR; soft-interrupt via nested provider AbortController + `pendingSoftInterrupt` race flag.
    - Tests: agents (no-run / tool-round / softInterrupt / overflow) + rpc (soft steer + followUp reject + no-run) pass; agent-loops + public-export clean.

- [x] 9. `ask_user_decision` multi-select
  - Acceptance Criteria:
    - Functional: opt-in tool accepts `selectionMode: "single" | "multiple"` (default `"single"`). Multiple mode returns `selectedIds` (non-empty subset of option ids); single keeps `selectedId`.
    - Functional: host `ask()` may return `{ selectedId }` or `{ selectedIds }`; tool validates against declared mode and option set.
    - Performance: selection count ≤ option count ≤ existing `maxOptions` caps; no extra network.
    - Code Quality: extend `ask-user-decision.ts` only; stay out of `createCodingTools`.
    - Security: reject unknown ids; reject empty multi selection; still enforce exactly 3 pros/3 cons per option.
  - Approach:
    - Documentation Reviewed:
      - `packages/coding-agent/src/ask-user-decision.ts`, `docs/coding-agent-tools.md` Ask-user section.
    - Options Considered:
      - Separate `ask_user_multi_decision` tool: duplicates schema; rejected.
      - Mode flag on existing tool: chosen.
    - Chosen Approach:
      - Add `selectionMode` to tool parameters + `AskUserDecisionAnswer` union.
      - Result metadata includes `selectedIds` (length 1 when single).
    - API Notes and Examples:
      ```ts
      // model args
      { question, selectionMode: "multiple", options: [...] }
      // ask() return
      { selectedIds: ["sqlite", "fts"] }
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/ask-user-decision.ts`, `__tests__/ask-user-decision.test.ts`, `index.ts` types if exported.
      - README/CHANGELOG Unreleased; full docs polish Task 12.
    - References:
      - Existing parse/validate helpers.
  - Test Cases to Write:
    - Multiple select happy path; empty/unknown ids fail; single mode rejects `selectedIds`-only answers (or accepts only if length 1 — pick one and document).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; tool parameter/result shape.
    - Docs pages to create/edit: Task 12 `docs/coding-agent-tools.md`; interim README/CHANGELOG ok.
    - `docs/index.md` update: Task 12 if Coding tools blurb changes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Execution evidence (2026-07-22):
    - `selectionMode: "single"|"multiple"` (default single); `AskUserDecisionAnswer` accepts `selectedId` and/or `selectedIds`.
    - Single accepts `selectedIds` only when length==1; multiple requires non-empty known subset; always emits `metadata.selectedIds` (+ `selectedId` = first).
    - Tests: multi happy path, empty/unknown reject, single length-1 accept / length>1 reject; aggregators still omit tool.

- [x] 10. `ask_user_decision` free-text answers
  - Acceptance Criteria:
    - Functional: optional `allowCustom: boolean` (default `false`). When true, host/user may return `{ customText }` (or custom alongside selection per frozen rules); when false, custom rejected.
    - Functional: custom text byte-capped (reuse/extend ask-user bullet/question limits; freeze default/hard in task).
    - Performance: validation O(options); no retention of unbounded free text beyond cap.
    - Code Quality: same tool file; schema documents mutual exclusivity rules clearly.
    - Security: strip control chars; redaction applies if host passes redactor at higher layer; tool itself stores no secrets.
  - Approach:
    - Documentation Reviewed:
      - Current ask-user tool; pi `allowCustom` precedent (host UX only).
    - Options Considered:
      - Always-on free-text: weakens forced structured choice; rejected as default.
      - Opt-in `allowCustom`: chosen.
    - Chosen Approach:
      - Extend answer union: `{ selectedId } | { selectedIds } | { customText }` with mode/`allowCustom` gates.
      - Freeze: custom cannot combine with multi-select in v1 unless trivially allowed — prefer custom XOR selection for clarity.
    - API Notes and Examples:
      ```ts
      { question, allowCustom: true, options: [...] }
      // ask() → { customText: "Ship FTS later; SQLite metadata-only now" }
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/ask-user-decision.ts`, tests, exports, CHANGELOG/README.
    - References:
      - Task 9 selectionMode must compose: `allowCustom` + `multiple` interaction frozen in this task.
  - Test Cases to Write:
    - allowCustom false rejects customText; true accepts capped text; oversize fails; XOR with selection enforced.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit: Task 12 `docs/coding-agent-tools.md`.
    - `docs/index.md` update: Task 12 as needed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Execution evidence (2026-07-22):
    - `allowCustom` (default false); answer `{ customText }` XOR selection; caps `DEFAULT/HARD_MAX_ASK_USER_DECISION_CUSTOM_BYTES` (= question 2KiB/8KiB).
    - Works with single or multiple mode; combining custom+ids rejected; `allowCustom=false` rejects customText.
    - Tests: deny/accept/oversize/XOR; 193 coding-agent tests pass.

- [x] 11. `ask_user_decision` durable workflow/agent suspend glue
  - Acceptance Criteria:
    - Functional: host can run decisions without a blocking in-process `ask()`:
      - **Workflow path:** helper/factory produces `suspend({ reason, data: decisionRequest, resumeSchema })` payload; `resumeWorkflow` validates selection/custom against original options + modes.
      - **Agent durable path:** when `runState` + interrupt-style seam is used, pending ask can persist as redacted interruption and resume via `resumeAgentRun` with selected/custom answer (fail closed if fingerprint/version mismatch).
    - Functional: blocking `ask()` callback mode remains default; suspend mode is opt-in and documented.
    - Performance: suspension payloads bounded by existing checkpoint/ask-user byte caps; no worker retained while suspended.
    - Code Quality: reuse `@arnilo/prism-workflows` `suspend`/`resumeWorkflow` and existing agent `runState` interrupt/resume — no Goal DB, no second approval store.
    - Security: resume requires `expectedVersion` / ownership; decision data redacted; deny path terminal where applicable.
  - Approach:
    - Documentation Reviewed:
      - `docs/workflows.md` suspend/resume; `docs/agent-session-runtime.md` `interruptBeforeTool` / `resumeAgentRun`; `packages/coding-agent/src/ask-user-decision.ts`; `examples/durable-coding-workflow.ts`.
    - Options Considered:
      - Host-only `ask()` that wraps suspend: possible today but not reusable export; rejected as sole answer.
      - Export `suspendAskUserDecision` / resume validator + optional agent interruption kind: chosen.
      - Make every ask auto-suspend: breaks simple TUI hosts; rejected.
    - Chosen Approach:
      - Add coding-agent helpers: build suspend data + `resumeSchema` from parsed decision request; `validateAskUserDecisionResume(input)` shared by workflow `validateResume` and tests.
      - Wire minimal agent durable interruption shape only if existing `AgentRunInterruption` can carry tool-ask pending without new store (extend pending status); else document workflow-first and keep agent path as thin adapter over same validator.
      - Example snippet (network-free) showing suspend → resume with `selectedId` / `selectedIds` / `customText`.
    - API Notes and Examples:
      ```ts
      import { createAskUserDecisionTool, suspendAskUserDecision, validateAskUserDecisionResume } from "@arnilo/prism-coding-agent";
      // workflow node
      return suspendAskUserDecision(parsedRequest);
      // resume
      validateResume: ({ input }) => validateAskUserDecisionResume(parsedRequest, input)
      ```
    - Files to Create/Edit:
      - `packages/coding-agent/src/ask-user-decision.ts` (or small `ask-user-decision-suspend.ts`), tests, `index.ts`.
      - Possibly `src/agent-run-state.ts` / contracts if agent interruption kind needed.
      - `examples/` small demo or extend `coding-goal-verify` notes; docs Task 12.
    - References:
      - Workflow exact-once CAS; agent ambiguous-dispatch fail-closed rules.
  - Test Cases to Write:
    - Suspend payload round-trip; approve with valid selection; deny/stale version fails; custom/multi validated.
    - Callback mode unchanged when `ask` provided.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new helpers + possibly agent interruption shape.
    - Docs pages to create/edit: Task 12 — `docs/coding-agent-tools.md`, `docs/workflows.md`, `docs/agent-session-runtime.md` / migration if agent shape changes.
    - `docs/index.md` update: Task 12.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Execution evidence (2026-07-22):
    - Workflow-first: `suspendAskUserDecision` + `createAskUserDecisionResumeValidator` / `validateAskUserDecisionResume`; agent path = `validateAskUserDecisionAgentResume` (no `AgentRunInterruption` change).
    - Blocking `ask()` unchanged; network-free workflow suspend→approve resume test passes.
    - 199 coding-agent tests pass.

- [x] 12. Docs, migration notes, package READMEs/changelogs, and index summaries
  - Acceptance Criteria:
    - Functional: docs cover SessionIndex, memory linear/unsupported modes, contextBudget/omissions, Anthropic/Google packages, goal/verify helper, **steer**, and **ask_user_decision** (single/multi/free-text/suspend glue); migration notes for 0.0.10 → 0.0.11.
    - Performance: document finite search/budget/steer/ask caps and link network-free benchmarks when present.
    - Code Quality: examples match exports; no second-runtime language; AI SDK documented as escape hatch only.
    - Security: ownership/redaction/credential guidance consistent across session/provider/steer/ask pages.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` API page structure.
      - Existing provider/session/input pages as templates.
    - Options Considered:
      - New mega “coding harness” page: prefer updating existing functional pages; add provider pages only.
      - Update existing + two provider pages: chosen.
    - Chosen Approach:
      - Update session/input/coding/workflows/migration/provider-packages/cli-rpc pages; add `docs/providers/anthropic.md` + `google.md`.
      - Sync READMEs/CHANGELOGs; root changelog Unreleased → Task 13 version.
      - Refresh Phase 6 evidence matrix rows for steer + ask-user extensions.
    - API Notes and Examples:
      ```ts
      // search + budget + providers + goal/verify + steer + ask_user_decision snippets matching Tasks 1–11
      ```
    - Files to Create/Edit:
      - `docs/session-stores.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/session-store-conformance.md`
      - `docs/input-and-prompt-assembly.md`, `docs/provider-packages.md`, `docs/providers/anthropic.md`, `docs/providers/google.md`
      - `docs/coding-agent-tools.md`, `docs/agent-loops.md`, `docs/agent-session-runtime.md`, `docs/cli-rpc.md`, `docs/workflows.md`, `docs/migration.md`, `docs/performance.md`
      - `docs/review-coverage-2026-07-22-phase-6.md`, `docs/index.md`, package READMEs/CHANGELOGs, `examples/README.md`
    - References:
      - prism-wiki.md required sections for each new/changed public API page.
  - Test Cases to Write:
    - Docs tests assert SessionIndex, contextBudget, provider package names, goal/verify helper, memory search modes, steer, ask_user_decision modes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; documentation of new surfaces.
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes — Providers, Sessions, Input/context, Coding tools, Agent/session, CLI/RPC entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Execution evidence (2026-07-22):
    - Expanded `docs/providers/anthropic.md` + `google.md`; updated session/input/agent/cli/coding/workflows/migration/performance/sqlite/postgres/conformance/public-contracts/index + Phase 6 evidence Tasks 8–11 rows.
    - Root + package CHANGELOG Unreleased notes; session-store READMEs schema-v4; coding-agent README already covered ask/goal/verify.
    - Docs test: phase 6 surfaces assertion added (package-count 32→34 + version bump remain Task 13).

- [x] 13. Version graph to 0.0.11, benchmarks, and release validation
  - Acceptance Criteria:
    - Functional: all publishable manifests, internal ranges, lockfile, profiles, and release/install guards target exact `0.0.11`; Anthropic/Google added to umbrella/profiles as appropriate; roadmap Phase 6 completion evidence recorded only after checks pass.
    - Functional: `npm run sdk:ready` passes; search/budget benchmarks network-free; provider live gates remain documented operator prerequisites.
    - Performance: package-size/benchmark deltas measured and justified; search + budget benches published (`scripts/benchmark-0.0.11.mjs` or equivalent).
    - Code Quality: changelogs/migration/release-and-install match behavior; no 0.0.12 scope sneaks in.
    - Security: `npm audit`, secret scan, SBOM/tarball review, `git diff --check` pass; search hits/omission reports credential-free in fixtures.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`, roadmap Release Validation Checklist, Plan 073 Task 7 command matrix.
    - Options Considered:
      - Docs-only without version bump: rejected; release is 0.0.11.
      - Full graph bump + dry-run publish: chosen.
    - Chosen Approach:
      - Bump versions/ranges; wire new packages into workspaces/umbrellas; run sdk:ready + supply-chain + `release:check` / `release:publish --dry-run` for `0.0.11`.
      - Update `roadmap.md` Phase 6 checkbox/evidence only after gates pass (execution time).
      - Stop before signed tag/publish without operator authorization.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      node scripts/benchmark-0.0.11.mjs
      npm run release:check -- --version 0.0.11 --allow-dirty --allow-untagged
      npm run release:publish -- --version 0.0.11 --dry-run --allow-dirty --allow-untagged
      ```
    - Files to Create/Edit:
      - All publishable `package.json` / lockfile / profile manifests as required.
      - `packages/prism-providers/package.json` (+ possibly `prism-all` / `prism-sdk` if freeze includes them).
      - `scripts/benchmark-0.0.11.mjs` (+ schema test).
      - `docs/release-and-install.md`, `roadmap.md` (completion evidence).
    - References:
      - Roadmap package ledger; 32→34 package count expected when anthropic+google land (confirm at freeze).
  - Test Cases to Write:
    - Version-guard tests expect `0.0.11`.
    - Full sdk:ready + dry-run matrix.
    - Docs regression for Phase 6 surfaces.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; released version semantics.
    - Docs pages to create/edit: `docs/release-and-install.md`, `roadmap.md` evidence.
    - `docs/index.md` update: only if release nav needs Phase 6 link (usually covered by review-coverage from Task 0).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Execution evidence (2026-07-22):
    - Exact `0.0.11` graph across 34 manifests + lockfile + `src/index.ts` version + MCP client/server version strings; Anthropic/Google wired into `@arnilo/prism-providers` (nine providers); guards/tests retargeted; `scripts/benchmark-0.0.11.mjs` + schema test green.
    - `npm run sdk:ready`: 2,047 tests (2,014 pass, 33 skips, 0 fail). Audit 0 high; SBOM 188/8; secrets 0/921 (tracked); `git diff --check` clean. Pack: 1,041,760 / 4,041,551 / 889 files (core 549,565 / 1,938,287 / 253). `release:check` all 34 available; `release:publish --dry-run` 34/34. No commit/tag/publish.
    - `roadmap.md` Phase 6 marked complete with evidence. Stopped before signed tag.

## Compromises Made

- Memory search ships both linear (default) and unsupported opt-out; JSONL remains unsupported (no FTS).
- Goal→verify lives in `@arnilo/prism-coding-agent` + example (not a Goal DB / second runtime).
- No shared Anthropic Messages serializer extraction — package-local first (OpenCode Go / Kimi remain independent routes).
- Steer: turn-boundary default + optional soft-interrupt; does not queue concurrent `prompt`/`followUp`.
- `ask_user_decision` remains opt-in (not in `createCodingTools`); durable path is workflow-first suspend helpers without new `AgentRunInterruption` kinds.
- Secret scanner openai-key pattern tightened with identifier boundary so `ask-user-decision` filenames/imports are not false positives; still matches standalone `sk-…` tokens.
- MCP/`@hono/node-server` moderate advisories remain (fix requires MCP SDK downgrade); high `fast-uri` cleared via non-breaking `npm audit fix`.
- No `.agents/skills/project-wiki` — docs live under `/docs` only.

## Further Actions

- P0 operator: signed commit/tag `v0.0.11`, protected CI, OIDC provenance, actual `release:publish` when authorized.
- P0 operator: protected Anthropic/Google live canaries (`PRISM_LIVE_PROVIDER_TESTS=1` + host keys), PostgreSQL/keychain, Docker/Playwright gates.
- P1: revisit MCP SDK / `@hono/node-server` moderate when upstream ships non-breaking fix.
- P2 (0.0.12+): Vertex enterprise identity, always-on FTS reindex workers, shared Anthropic serializer extraction, coding-aware compaction preset — explicitly out of Phase 6.
