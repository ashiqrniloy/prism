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

- [ ] Task 1 — Primitive Review: Progressive Disclosure Generalization
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
      - `src/tools.ts`: disclosure integration point (tentative — final seam per inventory).
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

- [ ] Task 2 — Lexical Index, Scoring, and On-Demand Activation Tool
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

- [ ] Task 3 — Conformance, Benchmarks, and Migration Notes
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

- To be filled after tasks are completed and tests pass. (Known ceiling recorded up front: lexical-only scoring — `ponytail: lexical-only; embedder-backed scoring via @arnilo/prism-rag seam if accuracy fixtures fall short`.)

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.