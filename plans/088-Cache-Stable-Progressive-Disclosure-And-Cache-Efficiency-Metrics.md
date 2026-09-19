# Cache-Stable Progressive Disclosure and Cache Efficiency Metrics

Release: 0.9.0 (P0). Closes the clay skill-body cache-invalidation workaround (`persistedLoadedSkillBodies`) and makes prompt-cache efficiency a measured, evaluable number.

## Objectives
- All late-expanding context (skill bodies, deferred tool schemas, loaded references) lands at cache-stable positions: append-only tail or explicit documented invalidation.
- `cache_read` / `cache_write` tokens and per-turn cache hit rate are recorded in usage records and the execution timeline.
- A golden prefix-stability test hosts can run against their own assembly ships in the conformance suite.

## Expected Outcome
- A session that lazy-loads skill N at turn 20 does not invalidate the cached prefix built over turns 1–19; the cache hit rate stays above the pre-change fixture baseline.
- Hosts can read cache hit rate per turn and per run from standard events/records — the metric that proves attention-compiler and assembly changes pay.

## Tasks

- [x] Task 1: Primitive review — assembly ordering and invalidation inventory
  - Acceptance Criteria:
    - Functional: Inventory of every assembly segment that can change between provider requests within one run (system prompt, constitution, skills, tool schemas, references, OM blocks, folding artifacts) with current position and invalidation trigger.
    - Performance: Analysis only.
    - Code Quality: Inventory table lands in this plan's Further Actions and drives Task 2 scope.
    - Security: No change.
  - Approach:
    - Documentation Reviewed:
      - `docs/input-and-prompt-assembly.md`, `docs/provider-caching.md`, `docs/context-and-skills.md`
      - `src/agent-session/session/assemble.ts`; skill body expansion site; `src/tool-search.ts` / `createToolSearchIndex` (deferred tool schemas).
    - Options Considered: n/a (review task).
    - Chosen Approach: Position map + invalidation matrix; classify each as already-stable / needs-append-only / needs-explicit-invalidation.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: none.
    - References: ReCache (schema recomposition breaks prefix reuse), TokenPilot (sparsity vs cache-continuity tradeoff), arXiv:2601.06007 (agentic caching savings unmanaged).
  - Test Cases to Write: n/a.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

- [x] Task 2: Append-only tail for late-expanded context segments
  - Acceptance Criteria:
    - Functional: Session-loaded skill bodies and URI resources expand into a stable tail after the turn transcript/current-input prefix; first insertion fixes `skill:<name>` / `resource:<uri>` order and re-derivation reuses that position. Attention/tool-result folds remain explicit cache-invalidation boundaries: moving their summary to a tail while retaining a useful compaction would also retain the raw payload.
    - Performance: Prefix-byte continuity is covered here; provider cache-token threshold remains Task 4's golden fixture after Task 3 supplies normalized cache usage.
    - Code Quality: Segment insertion goes through one `appendTailSegment` seam in assembly; native `Map#set` preserves first insertion order and replaces only that segment's bytes.
    - Security: Skill/reference content unchanged; position change only.
  - Approach:
    - Documentation Reviewed: Task 1 matrix; clay `persistedLoadedSkillBodies` workaround analysis (host repo `~/Projects/clay`).
    - Options Considered:
      - Pre-load everything (eager): rejected — defeats progressive disclosure and token savings.
      - Tail-region append with immutable segments: chosen; matches TokenPilot's global sparsity-with-continuity finding.
    - Chosen Approach: `RuntimeAgentSession` owns a per-run `Map<string, Message>` and passes it to assembly. `appendTailSegment` keys loaded bodies and URI resources; default prompting leaves catalogs in their old slot and emits body/resource messages at the final tail. Source-byte changes replace the same id (explicit invalidation) without reordering later segments.
    - API Notes and Examples:
      ```ts
      // assembly pseudo-shape
      [stable prefix: system+constitution+tools][transcript turns][tail: skills/, refs/, fold-ledger — append-only]
      ```
    - Files to Create/Edit:
      - `src/input.ts`: `appendTailSegment`, tail emission, catalog/body split, URI-resource tail routing.
      - `src/agent-session/session.ts`, `src/agent-session/session/types.ts`, `src/agent-session/session/assemble.ts`: per-run tail map and assembler wiring.
      - `src/contracts-core/agent.ts`: prompt-builder tail-body signal.
      - `src/__tests__/input-pipeline.test.ts`, `src/__tests__/skill-load.test.ts`: segment order/replacement, URI-resource, and session load coverage.
      - `docs/input-and-prompt-assembly.md`, `docs/provider-caching.md`: layout and invalidation contract.
    - References: ReCache composition-invariant blocks; clay cache analysis.
  - Test Cases to Write:
    - Prefix-byte continuity: late skill load appends after the existing request prefix.
    - Segment id reuse: re-loading/re-deriving a skill reuses its position (no duplicate tail growth).
    - Source-byte update: changed skill/resource content replaces exactly that segment.
  - Test Status: **written and passing** — `src/__tests__/input-pipeline.test.ts` covers late `beta` then `alpha` loading, duplicate-free re-derivation, same-position body replacement, and URI-resource replacement; `src/__tests__/skill-load.test.ts` proves the real session loop keeps the catalog prefix and emits a loaded body as its last provider-request message. `npm run build:core && node --test dist/__tests__/input-pipeline.test.js dist/__tests__/skill-load.test.js` passes (45 tests).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — assembly layout contract.
    - Docs pages to create/edit: `docs/input-and-prompt-assembly.md` (tail-region layout, invalidation rules); `docs/provider-caching.md` (stability guarantees). **Done** — includes the folding limitation and custom/budget invalidation boundary.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Cache-usage metrics in records and timeline
  - Acceptance Criteria:
    - Functional: Usage records carry `cacheReadTokens` / `cacheWriteTokens` per provider turn when the provider reports them (Anthropic, OpenAI, DeepSeek, OpenRouter adapters already parse these — normalize through one function); derived `cacheHitRate` per turn and per run on `provider_turn_finished` metadata and in `ExecutionTimeline`; providers without cache fields report absent (never zero).
    - Functional (per-turn budgets, plan 087 Further Action P3): `TimelineTurn` also carries the per-turn budget snapshot from `provider_turn_finished.metadata.budgets` (`inputTokens`, `inputCap`, `runInputBudget`, `runInputUsed`, `turns`, `maxTurns`), so a cockpit can plot a budget series without re-folding events; absent — never zero-filled — on traces whose events predate the field.
    - Performance: Derivation O(1) per turn; stored in existing usage record shape (additive fields); the budget snapshot is copied from event metadata, not recomputed.
    - Code Quality: Single normalization helper shared by adapters (`cacheUsageReport` in `src/index.ts` extended, not forked per adapter); the turn projection reads both metrics from the already-folded provider step in the same pass.
    - Security: Counts only; no content.
  - Approach:
    - Documentation Reviewed: `docs/runs-and-usage.md`; `packages/prism-providers` usage adapters (`openRouterUsage` et al.); `cacheUsageReport`; plan 087 Task 1 (`TurnBudgets` contract) and Task 3 (`projectTurns`).
    - Options Considered: Host-side parsing of provider payloads — rejected; prism already owns normalization. Recomputing per-turn budgets from run counters — rejected; `provider_turn_finished.metadata.budgets` is the recorded snapshot and recomputation would drift from it.
    - Chosen Approach: Existing adapters already preserve provider cache fields in normalized `Usage` and `UsageRecord`; extend the shared `cacheUsageReport` normalizer to return `undefined` when both fields are unknown rather than fabricate zeros. The runtime attaches that report to terminal provider metadata; the timeline uses folded provider usage for input-token-weighted per-turn/run rates and copies the recorded budget snapshot verbatim.
    - API Notes and Examples:
      ```ts
      usage.turns[14].cacheReadTokens; // 182_400
      timeline.turns[14].cacheHitRate; // 0.91
      timeline.turns[14].budgets; // { inputTokens: 41_200, inputCap: 128_000, runInputBudget: 200_000, runInputUsed: 96_400, turns: 15, maxTurns: 40 }
      ```
    - Files to Create/Edit:
      - `src/cache-helpers.ts`, `src/contracts-protocol.ts`, `src/agent-session/session/provider-round.ts`: absent-safe `CacheUsageReport`, terminal provider metadata, and no new adapter-specific parser.
      - `packages/prism-core/src/governance/observability/timeline.ts`, `packages/prism-core/src/governance/observability/timeline-types.ts`: weighted `ExecutionTimeline`/`TimelineTurn` cache rates and verbatim `TimelineTurn.budgets`.
      - `src/__tests__/cache-helpers.test.ts`, `src/__tests__/agents.test.ts`, `src/__tests__/run-ledger.test.ts`, `packages/prism-core/src/governance/observability/__tests__/timeline.test.ts`: absent-field, event, ledger, weighted aggregate, and budget projection coverage.
      - `docs/runs-and-usage.md`, `docs/execution-timeline.md`, `docs/agent-events.md`, `docs/observability.md`, `docs/provider-caching.md`: public metric semantics and shapes.
    - References: arXiv:2601.06007 (quantify agentic cache savings); clay cache analysis; plan 087 Task 3 (per-turn projection seam and `TurnBudgets`).
  - Test Cases to Write:
    - Cache-reporting adapter fixtures preserve read/write counters; non-reporting fixtures keep them absent.
    - Non-reporting provider: report and hit rate are absent — never zero.
    - Run-level hit rate aggregates turns weighted by input tokens.
    - Per-turn budgets project verbatim from `provider_turn_finished.metadata.budgets`; a trace without them yields `turns[n].budgets === undefined` (no zero-filled object).
  - Test Status: **written and passing** — root cache/runtime/ledger/public-contract tests (146), core timeline tests (18), provider fixture suite (577 passed; 93 credential-gated live tests skipped), and docs tests (155). Verified with `npm run build:core`, `npm --prefix packages/prism-core run build`, `npm --prefix packages/prism-providers run build && npm --prefix packages/prism-providers test`, targeted `node --test`, `npx biome lint`, and `node --test dist/__tests__/docs.test.js`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — usage record fields and two new `TimelineTurn` fields.
    - Docs pages to create/edit: `docs/runs-and-usage.md` (fields + hit-rate definition); `docs/execution-timeline.md` (`ExecutionTimeline.cacheHitRate`, `TimelineTurn.cacheHitRate`, and `TimelineTurn.budgets`); `docs/agent-events.md`, `docs/observability.md`, and `docs/provider-caching.md` (terminal metadata and absent-versus-zero contract). **Done**.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Golden prefix-stability conformance check
  - Acceptance Criteria:
    - Functional: Conformance scenario "progressive disclosure keeps prefix" runnable by hosts against their own assembly config: loads two skills at staggered turns, asserts cached-prefix continuity ≥ 95%.
    - Performance: Runs in conformance suite budget.
    - Code Quality: Assert-based, fixture-driven; uses mock provider capturing request prefixes.
    - Security: No network.
  - Approach:
    - Documentation Reviewed: `docs/provider-conformance.md` / conformance suite conventions.
    - Options Considered: Unit-only — rejected; hosts need it against their configs.
    - Chosen Approach: Exported conformance runner. It owns the fixture provider and fixture skill registry (dependency-free, network-free) and drives two real runs through a host-supplied agent config; each consecutive pair of captured provider requests must share at least `minContinuity` (default `0.95`) of the previous request's serialized bytes, where the serialization is one JSON fragment per tool schema and per message so an appended list stays an exact prefix. A body that never reaches a provider request fails the run, so a builder that drops the tail cannot pass vacuously.
    - API Notes and Examples:
      ```ts
      const { minContinuity } = await runPrefixStabilityConformance({
        host: { model, systemPrompt, context, promptBuilder, ... }, // agent config minus provider/providerSource/skills
        skills: [alphaSkill, betaSkill],                            // loaded on turn 1 and turn 2
      });
      ```
    - Files to Create/Edit:
      - `src/testing/prefix-stability-conformance.ts`: runner + fixture provider (the plan's `packages/prism-core/src/governance/evals/` option was rejected — that package owns governance/observability, not session assembly; every host-runnable conformance helper already lives in the root `src/testing/` family).
      - `src/__tests__/prefix-stability-conformance.test.ts`: default-assembly happy path, two negative controls, subpath export.
      - `package.json`, `docs/release-and-install.md`, `scripts/e2e-coverage.json`, `scripts/e2e-coverage.test.mjs`, `scripts/budgets.json`: new `./testing/prefix-stability-conformance` subpath, its e2e-coverage annotation and surface count, and the root export ceiling (+3, reason recorded).
      - `docs/prefix-stability-conformance.md`, `docs/index.md`, `src/__tests__/docs.test.ts`: the page, its index entry, and the required-heading/table coverage.
      - `src/input.ts`, `src/__tests__/input-pipeline.test.ts`, `src/__tests__/skill-load.test.ts`: replaced the ten non-null assertions Task 2 had added with narrowed locals and guarded lookups, keeping the plan-071 non-null allowance at its recorded count instead of raising it.
    - References: clay's manual analysis becomes a one-liner; `scripts/benchmark-scenarios/attention-compiler.mjs` longest-common-prefix measurement.
  - Test Cases to Write:
    - Runner green on prism default assembly; red when a segment is deliberately mutated mid-run (negative control).
    - Two negative controls prove the assertion can fail: a context provider recomposed every request, and a prompt builder that never renders loaded bodies (vacuity guard).
  - Test Status: **written and passing** — `dist/__tests__/prefix-stability-conformance.test.js` (4 tests: 100%/95.7%/95.8% shared prefix on the padded default fixture, both negative controls red, subpath exported). Full root suites 1892 pass; gate suites 246 pass; `scripts/budget-gate.test.mjs` 19 pass (export surface rebaselined +3 with a recorded reason; non-null budget unchanged after the ten-site cleanup). Verified with `npm run build:core`, `node --test dist/__tests__/*.test.js`, the full `GATE_FILES` list from `scripts/run-all-tests.mjs`, and `node scripts/package-truth.mjs --emit-docs`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new conformance export.
    - Docs pages to create/edit: `docs/prefix-stability-conformance.md` (api-page shape: what it measures, options, threshold semantics, negative control); `docs/index.md` entry; `docs/release-and-install.md` subpath row; `src/__tests__/docs.test.ts` api-page list + adapter-conformance table. **Done**.
    - `docs/index.md` update: yes — one navigation bullet (required by the index and doc-page gates).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Task 2: attention/tool-result folding cannot be append-only without sending both raw and compacted payloads, defeating compaction. Their first fold remains an explicit cache-invalidation boundary; durable/sticky folding keeps later requests byte-stable from that new boundary. Task 4 measures the cache-token outcome once Task 3 records it.
- Task 3: no provider adapter code changed because all first-party cache adapters already normalize reported counters into `Usage`. `cacheUsageReport` now refuses to invent a zero for an absent provider field; cache telemetry that deliberately aggregates unknown values may still use its own zero-initialized buckets.
- Task 4: the metric is a raw shared-byte-prefix fraction of the previous request, not a tail-aware score. Loaded bodies are re-sent after new transcript content by design, so a body larger than `1 - minContinuity` of the whole prompt lowers the number without a prefix regression; the page documents this and `minContinuity` is configurable. The runner deliberately replaces `host.skills`, `host.provider`, and `host.providerSource` to keep the scenario deterministic.
- Task 4: Task 2 had added ten `!` assertions (`src/input.ts` tail wiring and its tests). They were rewritten to narrowed locals rather than rebaselining the plan-071 non-null allowance; only the export-surface ceiling was rebaselined (+3, with a reason).
- Overall: fill remaining items after all implementation and verification tasks pass.

## Further Actions

### Task 1 review — assembly ordering and invalidation inventory

`constitution` is not a separate assembly primitive: it is a `systemPrompt` contribution. The default cache-aware path is role-sensitive: it hoists every leading `system` message, then emits context, skills, fallback text tool declarations, and the remaining flattened groups. The default group order before that hoist is instructions → attachments/resources → summaries → history → pending tool results → current input. Therefore a summary with no earlier user attachment is also hoisted ahead of context; adding an attachment changes that boundary.

| Segment | Current position / change trigger within one run | Classification and Task 2 treatment |
| --- | --- | --- |
| Base system prompt / constitution, developer, and custom instructions | Leading `system` prefix. Run config is composed once before the loop; only a new run/config changes it. | **Already stable.** Keep fixed; version/invalidate explicitly only for a deliberate config change. |
| Per-turn instruction-injector text | Merged into that same leading system prompt on every assembly. `when`/predicate, turn, input, history, or metadata can change it. | **Needs explicit invalidation.** Do not move safety instructions behind the transcript; give changed injector output a documented prefix version/invalidation rule. |
| Attachments, explicit resources, and loaded references | Default non-system group after the prompt-builder insertion point (normally after context/skills/declarations, before summaries/history). Source arrays or resource-loader output can change. | **Needs append-only tail** for late loads; immutable segment id reuses position, source/version change replaces only that segment. |
| Session compaction summaries | Default group before history; role hoisting places it in the leading prefix when no earlier attachment exists. Auto-compaction runs before first provider request; manual/concurrent compaction can replace it. | **Needs explicit invalidation** on summary replacement; tail allocation must not depend on accidental role hoisting. |
| Prior transcript | After summaries in default group. Normal loop growth is append-only; compaction, branch change, or folding can rewrite it. | **Already stable for ordinary appends.** Preserve exact bytes/order; named rewrite events invalidate from their boundary. |
| Pending tool results and current turn input | Final suffix: tool results immediately precede current input; each new turn appends new material. | **Already tail-stable** absent folding; keep as suffix. |
| Host and skill context providers (including retrieved/reference blocks) | System context immediately after hoisted leading system messages and before skills. Providers resolve on every request from messages, metadata, and host state. | **Late immutable references need append-only tail; recomposed context needs explicit invalidation/versioning.** |
| Injector context blocks | After host + skill context-provider blocks, before skills; varies with injector eligibility/output. | **Needs explicit invalidation.** |
| Observational-memory blocks | A context-provider subset at the same early position; observations/reflections/drops, recent-window movement, or invalidation change rendered `observational-memory` / `recent-messages` blocks. | **Needs explicit invalidation** until represented as immutable tail segments; never silently rewrite an earlier cached prefix. |
| Skill catalog and progressive bodies | System messages after context. Active set is run-fixed, but `load_skill` replaces that skill's catalog text with its body in place; restored bodies and budget demotion also alter it. | **Needs append-only tail.** Segment by skill id + body version; re-load reuses position, body-version change explicitly replaces that segment. |
| Tool schemas and text-only fallback declarations | Schemas live in separate `ProviderRequest.tools`; fallback text is after skills. Search disclosure changes selected schemas from current input and `search_tools` activation. | **Needs explicit invalidation / cache anchor after schema selection.** Schemas cannot be moved into message tail without breaking provider API shape. |
| `toolResultFold` artifacts | Projection rewrites aged historical or pending tool-result content when age/size threshold is crossed and may re-summarize it each assembly. | **Needs explicit invalidation now; tail-stable persisted artifact is preferred.** |
| Attention-compiler artifacts | Strips historic thinking and stubs historic tool results in place when a trigger fires. Sticky frontier and fold ledger prevent later reversal, but first fold still rewrites history. | **Needs append-only tail.** Task 2 must emit/reuse immutable fold artifacts instead of changing an earlier transcript row. |
| Context-budget eviction / skill-body demotion | Can drop or demote context, skills, attachments, summaries, history, tool results, or schemas at an input-cap transition. | **Needs explicit invalidation.** Golden cache-stability baseline must run without eviction transitions. |
| Custom builders, prompt/context/input middleware, provider-request middleware/policies | Host code can reorder or mutate final messages, tools, options, cache key, or breakpoints every request. | **Host-owned explicit invalidation.** No global stability claim beyond final serialized request; conformance must inspect captured requests. |

Evidence reviewed: `src/agent-session/session/assemble.ts:250-423`; `src/input.ts:151-386,393-551`; `src/skill-disclosure.ts:72-115`; `src/skill-load.ts:114-224`; `src/tool-search.ts:162-268`; `src/tool-result-fold.ts:63-176`; `src/attention-compiler.ts:487-589`; `packages/memory/src/compaction/observational-memory/recent-messages.ts:54-85`; `docs/input-and-prompt-assembly.md`; `docs/provider-caching.md`; and `docs/context-and-skills.md`.

**Task 2 result:** session-loaded skill bodies and URI resources now append through one `Map`-backed `appendTailSegment` seam. Catalog rows stay in place; first segment insertion fixes tail order; re-derivation replaces only that segment. Base safety instructions and provider tool schemas remain in their required positions.

**Deferred boundary:** attention/tool-result folds still rewrite their historic row at the first fold. A tail summary cannot replace that row without retaining its raw bytes, so this is documented explicit invalidation rather than fake cache stability. **Task 4 satisfied the call-out:** the conformance runner compares final captured messages **and** tool schemas, isolates host mutation (the recomposed-context negative control) and reports the ≥95% fixture on the post-Task-3 assembly.

**Task 3 result:** normalized `Usage` and durable provider-turn rows retain only provider-reported cache counts. `cacheUsageReport` and `provider_turn_finished.metadata.cache` omit unknown cache metrics instead of zero-filling them. `ExecutionTimeline.cacheHitRate` and `TimelineTurn.cacheHitRate` use input-token-weighted aggregate usage; `TimelineTurn.budgets` copies the last attempt's recorded `provider_turn_finished.metadata.budgets` snapshot without recomputation.

**Task 4 result:** `@arnilo/prism/testing/prefix-stability-conformance` exports `runPrefixStabilityConformance`, which drives two staggered skill loads through the caller's own agent config (system prompt, context providers, builders, middleware) against a fixture provider and asserts the shared serialized prefix between consecutive requests is ≥ `minContinuity` (default 0.95) over messages **and** tool schemas. Measured on the padded fixture: 100% / 95.7% / 95.8%; the recomposed-context and dropped-body negative controls both fail with actionable messages. Ten non-null assertions from Task 2 were removed so the ratchet budget stayed unchanged.

**Deferred (Task 4 follow-ups) — recorded as plan [101](101-Cache-Stability-Follow-Ups.md):**
- (101 Task 1) The runner measures the accepted tail re-send as continuity slack, so it reports only the provider-visible fraction. Plan 101 adds a second, tail-aware `cacheableContinuity` read off the session's own `tailSegments` map (identity first, serialized-value fallback — no wire marker), with `assertOn` selecting which fraction gates a run.
- (101 Task 2) Attention/tool-result folding and context-budget eviction still reset the measured prefix at their transition; the page says so. Plan 101 turns that into a reported `resets` list plus `allowedResets`, so a fixture proves the fold boundary is the *only* reset and that the requests before and after it stay append-only.
- (101 Task 3) Every non-tail row of the Task 1 inventory above (injector text, injector context blocks, OM blocks, summaries, budget eviction, tool-schema selection) gets a fixture pinning the documented invalidation boundary index, so a later layout change cannot silently relocate it.
