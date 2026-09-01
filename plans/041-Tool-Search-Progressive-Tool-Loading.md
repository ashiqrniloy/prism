# 041 — Tool Search / Progressive Tool Loading

Adoption-list item #2 (parity with Mastra tool search processor; OpenAI/Anthropic hosted tool search).
Roadmap phase: **0.3.x** (demand-gated: MCP/OpenAPI hosts mounting 100+ tools hit context bloat and worse model tool choice today).
Baseline: `@arnilo/prism` **0.3.0**+.
Target: core optional tool-search middleware (bounded lexical, zero dependencies) — extends the progressive-disclosure discipline skills already have (`src/skill-disclosure.ts`) to tools.

## Objectives

- Add an opt-in, bounded tool-search middleware: index registered tool names/descriptions, surface a relevant top-k subset per turn, keep explicit allow/deny lists as hard bounds, and activate the remainder on demand.
- Keep default behavior byte-identical when the middleware is not installed (full tool set per turn).
- Reuse the existing skill progressive-disclosure mechanics (`load_skill`-style on-demand activation) as the interaction model — one mechanism, applied to tools.
- Zero new dependencies; lexical scoring only (marked with a `ponytail:` ceiling naming the embed-based upgrade path).

## Expected Outcome

- A host with 200 MCP-bridged tools runs a prompt with only the top-k (default 16, hard cap 64) most relevant tool definitions in the provider request; the model can request more via a generated `search_tools` tool; hard allow/deny filtering still applies and is visible in blocked-reason records.
- Context-token usage per provider request drops measurably for large tool registries (benchmark scenario added).
- Tool-choice accuracy fixtures (pick-the-right-tool among distractors) do not regress versus full exposure on the same mock provider.

## Tasks

- [x] Task 1 — Primitive Review: Progressive Disclosure Generalization
  - **Result (review complete):** Seam decision confirmed: config option, not middleware.
    - Inventory: `src/skill-disclosure.ts` — `SkillsDisclosure` union, `DEFAULT_MAX_*`/`HARD_MAX_*` frozen caps, `resolveSkillsDisclosure(run, agent)` (run wins), `LoadedSkillSet`, `SkillRenderContext` (disclosure/loaded/demotedBodies), catalog-only default with byte-truncated descriptions, `SkillDisclosureError` fail-closed. `src/tools.ts` — `createToolRegistry`, `filterTools` (allow ∩, additive), `checkCall` blocked-reason matrix (`unknown_tool` → `tool_denied` → `invalid_arguments`, then permission/validator/beforeExecute downstream); **dispatch re-checks registry membership + allow/deny on every call regardless of disclosure** — disclosure is not an authorization boundary. `src/context-budget.ts` — `applyContextBudget` already accepts/evicts `tools`; demotion-report precedent (`demotedSkillBodies`). `src/middleware.ts` — `input_assembly`/`prompt_build` hooks.
    - Middleware seam rejected with evidence: in `assembleProviderInput` (src/input.ts:225-305), the final `request.tools` and the `promptBuilder.build(...)` call both use the **local** `tools` variable; a `prompt_build` middleware's mutated `request.tools` is overwritten. Tool search as middleware would require changing the middleware contract (new behavior, not reuse).
    - Config seam chosen: mirrors `skillsDisclosure` exactly (`AgentConfig` option + `RunOptions` override + `resolve...(run, agent)`), applied inside `assembleProviderInput` after budget eviction, before `prompt_build`. Search can only narrow the disclosed list; activation dispatch (Task 2) rides the existing `checkCall` re-check.
    - No second mechanism: reuse the skill-disclosure *pattern* (union type, DEFAULT/HARD caps, resolve(run, agent), render context, fail-closed error) but as a separate small module `src/tool-search.ts` — skills render message text; tools are a request array. Different data, same discipline.
    - Correction vs. original plan: disclosure integration point is `src/input.ts` (+ `src/contracts-core/agent.ts` for config), **not** `src/tools.ts`; `src/tools.ts` needs no disclosure changes.
    - Pre-existing gap noted (not Task 1 scope): the runtime dispatch path passes no `filter` (session.ts:707); in all disclosure modes the provider-visible list is the active set, not allow/deny-filtered. Tool search inherits selection from that list (intersection structural — search selects from it, never widens). Hosts doing direct dispatch with `filter` narrow their own lists; documented in docs/tools.md (Task 2).
  - Acceptance Criteria:
    - Functional: inventory `src/skill-disclosure.ts` (catalog-only default, `load_skill`, budget demotion), `src/tools.ts` (registry, allow/deny, dispatch blocked-reason matrix), `src/context-budget.ts` (eviction/omission reports), `src/middleware.ts` (ordered hook boundaries). Determine the minimal seam: either a dedicated `toolsDisclosure` option on agent config or a middleware; document choice with the tool-dispatch blocked-reason matrix in mind.
    - Performance: index build is O(n·d) lexical over descriptions with frozen caps (tools ≤ 1024, description bytes ≤ existing tool caps); scoring per turn bounded, no allocations per token.
    - Code Quality: no second disclosure mechanism — parameterize the existing skill-disclosure shapes where feasible; otherwise document why tools need a parallel seam.
    - Security: tool search never bypasses allow/deny, permission, or validator checks — searched set is intersected with the allowed set before any provider turn (fail-closed: search failure surfaces all allowed tools, never zero).
  - Approach:
    - Documentation Reviewed:
      - `docs/context-and-skills.md` (skillsDisclosure, priority budget demotion, `toolNames` fail-closed check).
      - `docs/tools.md`, `docs/tool-conformance.md` (blocked-reason matrix: unknown/denied/invalid/permission/validator).
      - `docs/tool-execution-primitives.ts` → `docs/tool-execution-primitives.md` (parallel dispatch, JSON Schema LRU).
      - `src/skill-disclosure.ts`, `src/tools.ts`, `src/context-budget.ts`.
    - Options Considered:
      - New package `@arnilo/prism-tool-search`: rejected — skills disclosure is core and dependency-free; a parallel package would split one discipline across two homes.
      - Core opt-in middleware/config mirroring `skillsDisclosure`: chosen — consistent mental model, zero deps.
    - Chosen Approach:
      - Core `toolsDisclosure: "all" | "search"` (default `"all"`) with `search_tools` on-demand activation tool generated only in search mode; lexical BM25-lite scoring (term frequency over name+description, IDF from registry) with `ponytail:` comment: lexical-only ceiling, upgrade to embedder-backed scoring via `@arnilo/prism-rag` embedder seam if measured short.
    - API Notes and Examples:
      ```ts
      const agent = createAgent({
        ...,
        limits: { ... },
        toolsDisclosure: "search",        // default "all"
        toolsSearch: { topK: 16 },       // optional tuning, hard cap 64
      });
      ```
    - Files to Create/Edit:
      - ~~`src/tools.ts`~~ → `src/input.ts`: disclosure integration point (narrow disclosed `tools` inside `assembleProviderInput`; dispatch path unchanged).
      - `src/tool-search.ts` (new): bounded lexical scorer + index.
      - `src/contracts-core/agent.ts` (or wherever `AgentConfig` lives per inventory): additive options.
  - Test Cases to Write:
    - Primitive test: with `toolsDisclosure: "search"`, provider request contains ≤ topK tool definitions; with default, identical to today (byte-compare of assembled input).
    - Fail-closed test: search error/index missing → all allowed tools surfaced (never zero, never unfiltered).
    - Allow/deny intersection test: searched set ∩ allowed set only; denied tool never described to the provider.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new agent config option + generated tool.
    - Docs pages to create/edit: `docs/tools.md` (disclosure section), `docs/context-and-skills.md` (cross-link, contrast with skills disclosure).
    - `docs/index.md` update: yes — Tools entry description gains tool-search mention.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Lexical Index, Scoring, and On-Demand Activation Tool
  - **Result (implemented):**
    - Files: `src/tool-search.ts` (new, ~230 lines: `ToolsDisclosure`, frozen `DEFAULT_/HARD_MAX_*` caps, `resolveToolsDisclosure`, `createActiveToolSet`, `createToolSearchIndex`, `scoreTools`, `selectDisclosedTools`, `createSearchToolsTool`), `src/input.ts` (narrowing seam inside `assembleProviderInput` after budget eviction, before `prompt_build` — per Task 1 correction), `src/contracts-core/agent.ts` + `src/contracts-protocol.ts` (`toolsDisclosure`/`toolsSearch` on `AgentConfig`, `PromptBuildRequest`, `RunOptions` mirroring `skillsDisclosure`), `src/agent-session/session.ts` (per-run search state + run-local registry copy with generated `search_tools`; host registry never mutated), `src/agent-run-state.ts` + `src/agent-run-lifecycle.ts` (names-only `activatedToolNames` persistence, cap 128, restore path), `src/index.ts` (public exports), `scripts/benchmark-scenarios/tool-search.mjs` (standalone-runnable; Task 3 wires the runner), `src/__tests__/tool-search.test.ts` (17 tests), docs (`docs/tools.md` disclosure section + limits table, `docs/context-and-skills.md` cross-link, `docs/index.md` Tools bullet).
    - Behavior decisions beyond the plan sketch:
      - Zero lexical match on a turn discloses a **bounded deterministic prefix** (never zero tools); the session-wired `search_tools` tool is always kept so it is never silently dropped. Fail-closed (exceptions, index over the 1024 cap) still discloses the full input list — never wider than that list.
      - Activation is session-scoped (mirrors the `loadedSkills` precedent exactly: session field, names-only persistence, `restoreActivatedTools` on durable resume, `clearActivatedTools()` host reset) rather than strictly per-run; cross-branch isolation holds because the set is per-session-instance and durable restore is names-only (absent tools inert until re-searched).
      - `AgentInput` type kept structural in `tool-search.ts` to avoid an import cycle with `input.ts`.
      - `search_tools` handler sets `toolCallId` from context (dispatcher passes execute results through verbatim).
    - Preservation policy: `src/agent-run-state.ts` was phase-20 frozen byte-immutable; evolved deliberately and re-hashed `scripts/phase20-baseline.json` per the plan-037 precedent ("freeze baselines re-hashed for intentionally evolved preserved files").
    - Benchmark: 128-tool fixture, topK 16 → **86.4% provider-request tool-byte reduction** (floor 60%); index+score ≈ 5ms; disclosed ≤ topK+1+activations. Checks gate exit code 1 on breach.
    - Verification: 17 new tests pass; full `npm test` green after re-hash (field-policy perf ratio is a pre-existing suite-load flake, reproduced on a stashed baseline; cli.test.js runner-IPC deserialize error was a one-off, green in two reruns).
  - Acceptance Criteria:
    - Functional: `search_tools({ query, k? })` returns bounded results (name, description, matched terms) and marks returned tools as active for subsequent turns (or the current turn boundary per skill-disclosure precedent); activation is per-run scoped, host-resettable, and included in run persistence only as names (mirroring `persistSessionState` names-only skill bodies).
    - Performance: scoring per query ≤ O(tools × avg-terms) with term maps; index rebuilt on registry change, not per turn; benchmark scenario in `scripts/benchmark-scenarios/` shows token reduction (provider-request bytes) ≥ 60% at 128 tools, topK 16 (fixture-based).
    - Code Quality: pure functions (index, score) exported for testing; no `any`; frozen limits (`DEFAULT_MAX_*`/`HARD_MAX_*` pattern from `src/skill-disclosure.ts`).
    - Security: `search_tools` results are inert descriptions (no tool bodies/schemas executed); activation re-checks allow/deny at dispatch time (blocked-reason unchanged); untrusted query strings bounded (length caps, no regex).
  - Approach:
    - Documentation Reviewed:
      - `src/skill-disclosure.ts` constants pattern; `src/skill-load.ts` (on-demand body load lifecycle).
      - `packages/rag/src/fusion.ts` (RRF precedent — confirm lexical scorer stays local to core; RAG stays optional).
    - Options Considered:
      - Import RAG lexical scorer into core: rejected — core is dependency-free and RAG is optional; core keeps a tiny bounded scorer.
      - Duplicated small scorer in core: chosen — ~60 lines, consistent with hand-rolled minimalism precedent (literal repository search).
    - Chosen Approach:
      - Core-local bounded scorer; RAG reuse noted as ceiling comment only.
    - API Notes and Examples:
      ```ts
      // model-visible tool, generated only when toolsDisclosure === "search"
      { name: "search_tools", description: "Search available tools by relevance...",
        parameters: { type: "object", properties: { query: { type: "string" }, k: { type: "integer" } }, required: ["query"] } }
      ```
    - Files to Create/Edit:
      - `src/tool-search.ts` (implementation), `src/agent-tool-dispatch.ts` (activation bookkeeping, tentative).
  - Test Cases to Write:
    - Scorer unit tests: exact-match name ranks first; multi-term IDF ordering stable; empty/oversized query rejected.
    - Activation lifecycle: `search_tools` → tool described next turn; run persist/restore keeps activated names only; cross-branch isolation (activated names don't leak across branches).
    - Bounded fuzz: 1024-tool registry index+score within performance envelope.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — generated tool name/payload is model-facing behavior.
    - Docs pages to create/edit: `docs/tools.md` disclosure section gains `search_tools` semantics + limits table.
    - `docs/index.md` update: no (Task 1 entry suffices).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Conformance, Benchmarks, and Migration Notes
  - **Result (complete):**
    - **Conformance leg** (`src/testing/tool-conformance.ts` → `assertToolDisclosureConforms(options)`, dependency-free, network-free): search-mode set operations (disclosed ⊆ allow/deny-filtered eligible list, never wider, never zero, deterministic order), deny-listed tool never described, generated `search_tools` always kept, fail-closed full disclosure past the 1024 index cap, inert `search_tools` output (names + 512-char-truncated descriptions, no JSON structure, oversized descriptions truncated not executed), secret-scan clean even when a host description carries a secret, activation bounded ≤ topK and only from the eligible set, activated tools stay disclosed next turn. Tests in `src/__tests__/conformance-helpers.test.ts` (positive leg + secret-leak negative proving the throw path fires). Two fixes during bring-up: inert-output regex narrowed to braces (the legitimate `[matched: …]` suffix uses brackets), and the oversized-description probe is an appended synthetic tool so the secret probe queries untouched descriptions.
    - **Accuracy fixtures** (`src/__tests__/tool-search.test.ts`): mock provider scripted to scan only the disclosed tool list and pick by token-overlap; batch runs at 64 and 128 tools (16 subjects each) in both modes against the same fixture. Conformance floor `search ≥ full-exposure` holds (both perfect on fixture — retrieval never drops a tool the scanner would pick); each tool-call turn also proves the disclosed-visible pick dispatches through the real session.
    - **Benchmark runner**: `tool-search` registered in `scripts/benchmark.mjs` SCENARIOS (phase 41, unprotected); frozen caps recorded in `scripts/budgets.json#toolSearch` (reduction floor 0.6, index+score ceiling 50 ms, disclosed-count ceiling 33; recorded evidence: 86.4% reduction, index+score 1.9–2.5 ms over three runs, disclosed 17/128+1). New gate `scripts/benchmark-tool-search.test.mjs` runs the scenario through the parameterized runner in `npm test` (registration, schema, network/credential-free, secret-scan blob regex, all scenario checks pass, caps enforced) — wired into the package.json test chain after `benchmark-multi-agent.test.mjs`.
    - **No regression on existing medians**: default `toolsDisclosure: "all"` stays byte-identical (test-asserted on messages + tools arrays); the assembler's default path adds one resolve call; budget-gate and multi-agent scenario tests green in the full suite (medians are explicitly machine-dependent sanity bounds, not portable SLOs).
    - **Compat baseline**: `scripts/phase25-compat-diff.mjs` — plan 041 deltas are all ADDED (26 public symbols: disclosure/search exports + `MAX_PERSISTED_ACTIVATED_TOOL_NAMES`); the one CHANGED entry (`usage` CLI string, `prism dev`) pre-dates plan 041 and reproduces on the pre-change tree (documented 0.3.2 deviation, deviation-gated per the 0.2.1+ compat promise). No baseline change needed for 041.
    - **Docs**: `docs/tool-conformance.md` (disclosure leg: invariant list + example), `docs/performance.md` (tool-search scenario section: recorded numbers, caps location, evidence links), `docs/migration.md` (top section: additive, default unchanged, `activatedToolNames` optional — stores ignoring it resume unchanged).
    - **Ponytail ceiling comment**: present on the scorer (`src/tool-search.ts` createToolSearchIndex) and the per-run index (createToolSearchState) — embedder-backed upgrade via `@arnilo/prism-rag` seam if accuracy falls short; accuracy fixtures came back clean, so lexical scoring stands.
    - Verification: full `npm test` green (only the known pre-existing field-policy wall-clock load flake, reproduced on a clean baseline in Task 2); scenario 3× deterministic within caps.
  - Acceptance Criteria:
    - Functional: `@arnilo/prism/testing/tool-conformance` extended with a disclosure leg (search mode set operations, fail-closed, allow/deny intersection); tool-accuracy fixture suite (pick correct tool among 64/128 distractors, mock provider) shows search mode ≥ full-exposure accuracy.
    - Performance: new benchmark scenario `tool-search` added to the parameterized runner; frozen caps recorded; no regression on existing scenario medians.
    - Code Quality: additive-only option (default unchanged) verified by compat baseline; `ponytail:` ceiling comment on the lexical scorer.
    - Security: threat-suite leg: oversized descriptions truncated not executed; search index contains no tool schemas beyond name/description (secret-scan clean).
  - Approach:
    - Documentation Reviewed: `src/testing/tool-conformance.ts`, `scripts/benchmark-0.1.0.mjs` parameterized runner, `docs/migration.md` additive-only precedent.
    - Options Considered: separate conformance package — rejected; existing tool-conformance home is correct.
    - Chosen Approach: extend existing conformance + benchmark runner.
    - API Notes and Examples: n/a.
    - Files to Create/Edit:
      - `src/testing/tool-conformance.ts`, `scripts/benchmark-scenarios/tool-search.mjs`, `docs/migration.md` (additive note only, no breaking).
  - Test Cases to Write:
    - Conformance leg runs in `npm test` network-free.
    - Accuracy fixture: mock provider scripted to pick by name; assert correct pick rate ≥ full-exposure baseline.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — conformance surface.
    - Docs pages to create/edit: `docs/tool-conformance.md`, `docs/performance.md` (new scenario evidence).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Lexical-only scoring (`ponytail: lexical-only` on the scorer + index): BM25-lite over name (×3) and description, zero dependencies. Accuracy fixtures (Task 3, mock provider, 64/128 distractors) came back at full-exposure accuracy, so no embedder is needed today; upgrade path is the `@arnilo/prism-rag` embedder seam if a future fixture regresses.
- Activation is session-scoped, not strictly per-run — mirrors the `loadedSkills` precedent (names-only persistence, host resettable); cross-branch isolation holds because the set is per-session-instance.
- Zero-match turns disclose a bounded deterministic prefix (never zero tools) instead of nothing — a model with zero tools cannot recover via `search_tools`; the session-wired search tool keeps the loop alive.
- `src/agent-run-state.ts` (phase-20 byte-frozen) evolved for `activatedToolNames`; baseline re-hashed per the plan-037 preserved-file precedent.
- The compat diff carries one pre-existing CHANGED entry (`usage` CLI string) from an earlier plan's documented tightening; plan 041's deltas are additive-only.
- The disclosure seam reads the turn input once per assembly and rebuilds a run-local registry copy in search mode (host registry never mutated); no async invalidation — registry changes apply on the next run.

## Further Actions

- Runner registration makes `tool-search` eligible for the next release-capacity contract if a 0.3.x cut wants it in the frozen envelope (today it gates via `scripts/benchmark-tool-search.test.mjs` only).
- If MCP/OpenAPI hosts report poor tool choice beyond 64 disclosed tools, revisit `topK` defaults upward (hard cap 64) before considering an embedder seam.
- The pre-existing runtime gap (session dispatch passes no `filter`, so provider-visible = active set in all modes — noted in Task 1) remains intentionally unchanged; host narrow-your-own-list behavior is documented in `docs/tools.md`.