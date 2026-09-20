# Cache-Stability Follow-Ups: Tail-Aware Scoring and Fold/Invalidation Conformance

Release: 0.9.x follow-up to plan 088, recorded from that plan's Further Actions. Not part of plan 099's 0.9.0 cut unless a host pulls it forward first: plan 088 already ships correct, documented behavior, and these tasks turn its diagnostics and its documented invalidation rules into executable truth.

## Objectives
- Split the one number plan 088's runner reports into the two a host actually cares about: the provider-visible prefix (what the prompt cache pays for) and the same measurement with plan-088 tail segments excluded, so an eager or body-heavy host can tell a real prefix regression from the tail re-send it deliberately accepted.
- Stop treating the attention-compiler fold as an unasserted exception: allow exactly the fold the fixture is configured to produce, report where it happened, and keep every other gap append-only.
- Turn plan 088 Task 1's invalidation inventory into executable expectations for the rows that are **not** tail segments (instruction-injector text, injector context blocks, observational-memory blocks, summaries, context-budget eviction, tool-schema selection), pinning the boundary each documented invalidation starts at.

## Expected Outcome
- `runPrefixStabilityConformance` reports both fractions and can assert either; the existing call shape and default stay byte-compatible (`providerPrefix`, `0.95`).
- A host that runs the runner with `attentionCompiler` enabled gets a passing run naming the single fold request; a second fold, a post-fold rewrite, or a fold that never happened still fails.
- Each non-tail inventory row has a fixture asserting its documented outcome, so a later change to the assembly order fails a test instead of moving the invalidation boundary silently.
- `docs/prefix-stability-conformance.md` states both metrics, the expected-reset option, and the pinned boundary table.

## Tasks

- [x] Task 1: Tail-aware continuity metric (cacheable-prefix score)
  - Acceptance Criteria:
    - Functional: `PrefixStabilityConformanceOptions` gains `assertOn?: "providerPrefix" | "cacheablePrefix"` (default `"providerPrefix"`, today's behavior) and `PrefixStabilityConformanceResult` gains `cacheableContinuity: number` — the lowest shared-prefix fraction computed after removing plan-088 tail segments from both requests of each pair. `minContinuity` keeps its frozen meaning (provider-visible prefix) and its `95%` default.
    - Functional: tail segments are read from the session's own `tailSegments` map (the exact `Message` objects `appendTailSegment` allocated) and matched against the captured request first by object identity, then by serialized-value equality for builders that clone messages. No string heuristic over host-authored content, and no marker added to the provider payload. When the captured requests contain no tail segment (a builder that renders bodies elsewhere), `cacheableContinuity` equals `minContinuity`; the page says so instead of printing a misleading `1`.
    - Functional: `assertOn: "cacheablePrefix"` asserts that fraction instead of the provider-visible one; a host whose provider-visible fraction dips below `minContinuity` only because of tail bodies passes, while a volatile context provider still fails both.
    - Performance: one extra serialization pass per captured message inside the fixture; production assembly bytes, `ProviderRequest` shape, and runtime cost are unchanged.
    - Code Quality: classification and metric helpers stay local to `src/testing/prefix-stability-conformance.ts`; no new export symbol and no new subpath (option and result fields only, so no budget rebaseline); `Buffer` byte comparison is reused; both classification paths (identity and cloned value) are covered.
    - Security: still no network, credentials, or real skills; error messages keep naming only the request pair index and the measured percentage.
  - Approach:
    - Documentation Reviewed:
      - `docs/prefix-stability-conformance.md` (current options/result contract and the "tail is append-only, not immutable" note).
      - `docs/input-and-prompt-assembly.md` (tail section: `moveResourceMessagesToTail`, `appendSkillTailSegments`, `tailMessages`) and `docs/provider-caching.md` (what the cache actually pays for).
      - Plan 088 Further Actions, "Deferred (Task 4 follow-ups)" bullet 1; plan 088 Task 2 result (the `Map`-backed `appendTailSegment` seam).
    - Options Considered:
      - Mark tail messages in production with a field the runner can read (plan 088's literal suggestion) — rejected: an extra wire field changes the request bytes every provider must accept, and an out-of-band index means holding a second copy of the prompt, so the marker is the wrong shape for a host-facing *measurement*. It stays the demand-gated upgrade if hosts need the number for their own traffic rather than for the fixture.
      - Detect the tail by matching loaded body strings in the serialized request — rejected: false positives on host transcript content, and it cannot see a resource tail whose id the runner never learned.
      - Read the session's `tailSegments` map from the runner — chosen: exact, allocation-light, no production change, and it measures the same objects assembly used.
    - Chosen Approach: classify captured messages against the session tail map (identity, then serialized equality), compute the cacheable fraction on the filtered pair, report both, and let `assertOn` choose which one gates the run.
    - API Notes and Examples:
      ```ts
      const result = await runPrefixStabilityConformance({
        host: myAgentAssembly,
        skills: [alphaSkill, betaSkill],
        assertOn: "cacheablePrefix",
      });
      result.minContinuity;       // provider-visible prefix — what the cache pays for
      result.cacheableContinuity; // same ratio with tail segments removed
      ```
      ```ts
      // runner-side classification (sketch, no production change)
      const tailValues = new Set([...session.tailSegments.values()].map((message) => JSON.stringify(message)));
      const isTail = (message: Message) => session.tailSegments.has(...) || tailValues.has(JSON.stringify(message));
      ```
    - Files to Create/Edit:
      - `src/testing/prefix-stability-conformance.ts`: `assertOn` option, `cacheableContinuity` result field, tail classification and filtered measurement.
      - `src/__tests__/prefix-stability-conformance.test.ts`: metric split, clone path, and the volatile-context negative control for both metrics.
      - `docs/prefix-stability-conformance.md`: options/result tables, the "both numbers" explanation, and the no-tail-segment rule.
    - References:
      - `src/agent-session/session.ts` (`readonly tailSegments = new Map<string, Message>()`), `src/agent-session/session/assemble.ts` (clear-on-run, pass-through to `assembleProviderInput`).
      - `src/input.ts` tail block and `src/testing/compaction-conformance.ts` for the conformance-helper shape.
  - Test Cases to Write:
    - Split metric (default fixture): `cacheableContinuity === 1` while `minContinuity` sits at the padded-prefix fraction below `1` — both reported by one run.
    - Assertion selection: an eager-tail host asserts `cacheablePrefix` and passes while the same host with the default `assertOn` fails with the existing continuity error.
    - Negative control: a context provider recomposed every request lowers **both** fractions (context is not a tail segment), proving the cacheable metric cannot mask a real prefix regression.
    - Clone path: a `promptBuilder` that returns freshly built message objects still classifies the tail (serialized-equality fallback), and classification reports no tail for an unloaded skill.
    - Vacuity guard unchanged: a builder that never emits a loaded body still throws the "body never reached the provider request" error.
  - Test Status: **written and passing** (2026-09-19) at HEAD `f6b1da81`. `src/__tests__/prefix-stability-conformance.test.ts` now runs 9 tests: the padded default fixture reports `cacheableContinuity === 1` against `minContinuity < 1`; an eager body-heavy host (two ~1.6 KiB bodies, bare system prompt) passes with `assertOn: "cacheablePrefix"` and still fails the default run with the original `request 1 → 2 kept …% of the previous provider prefix` error; a volatile context provider lowers **both** fractions and still rejects under `assertOn: "cacheablePrefix"`; a clone-on-build `promptBuilder` reads `1` (value-equality fallback, identity lost); a merging builder that never passes the tail objects through reports `cacheableContinuity === minContinuity`; the vacuity guard is unchanged. Verification: `npm run build:core`, `node --test dist/__tests__/prefix-stability-conformance.test.js` (9 pass), `node --test dist/__tests__/docs.test.js` (164 pass with both suites), `node --test dist/__tests__/input-pipeline.test.js` (35 pass), `npm run format:check` clean, `npx biome check` clean on both edited sources, and the full `npm test` chain — all 6 stages pass (build, performance budget, root suites, gate suites, build race, workspace suites).
  - Deltas from plan: (1) `tailSegments` is not on the public `AgentSession` contract, so the runner narrows its own `agent.createSession()` result to `AgentSession & { readonly tailSegments: ReadonlyMap<string, Message> }` locally — no production change, no contract export; (2) `src/__tests__/docs.test.ts` gained `cacheableContinuity` and `assertOn` in the prefix-stability phrase pin; (3) the cacheable-path error reads `…of the previous cacheable prefix (tail segments excluded) (minimum …%)`, while the default `providerPrefix` message stays byte-identical to plan 088; (4) no new export, no subpath, no budget rebaseline (measured values unchanged).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new option and result field on the exported conformance runner.
    - Docs pages to create/edit:
      - `docs/prefix-stability-conformance.md`: inputs/result tables, both-metric explanation, no-tail-segment behavior, and a note that `minContinuity` keeps its frozen provider-visible meaning.
    - `docs/index.md` update: no — existing page, no navigation delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: Fold-boundary conformance (one allowed reset, reported)
  - Acceptance Criteria:
    - Functional: `PrefixStabilityConformanceOptions` gains `allowedResets?: number` (default `0`, today's behavior) and the result gains `resets: readonly number[]` — the 1-based request indexes whose prefix broke below `minContinuity`. The runner collects every gap instead of failing inside the loop, then fails when a sub-threshold gap is not one of the allowed resets **and** when fewer resets occurred than `allowedResets` (vacuity: the fixture was supposed to fold, so a run that never folded cannot pass).
    - Functional: with `host.attentionCompiler` configured and a deterministic fold trigger (`{ kind: "predicate", shouldFold: (state) => state.turn === 2 }`), the run reports exactly one reset, every other gap keeps ≥ `minContinuity`, and the gap after the fold is append-only (`cacheableContinuity === 1` for the post-fold pair).
    - Functional: the reset report distinguishes the fold from a host rewrite only by index, matching the documented rule that attention folding is explicit invalidation at its boundary; the error message for a disallowed reset still names the pair and percentage and adds the observed reset list.
    - Performance: one fraction per captured request pair, in-memory only; the fold fixture adds one provider turn per run and stays inside the existing conformance test budget.
    - Code Quality: collect-then-assert replaces the in-loop `assert.ok`, so both metrics come from one pass; no new export symbol; the fixture drives the public `attentionCompiler` option rather than reaching into `AttentionFoldLedger`.
    - Security: fixtures use a stub provider and an in-memory session; no credentials, no network, no real fold payloads beyond the fixture text.
  - Approach:
    - Documentation Reviewed:
      - `docs/attention-compiler.md` (ratio/trigger axes, `thinkingKeepTurns`, `keepLast`, sticky frontier) and `src/contracts-core/attention.ts` (`AttentionCompilerOptions.trigger`, `AttentionTriggerState.turn`).
      - `docs/prefix-stability-conformance.md` "Extension and configuration notes" bullet 3 (folding is an explicit invalidation boundary) — this task is what makes that sentence checkable.
      - `src/__tests__/attention-compiler-stages.test.ts` for deterministic fold fixtures.
    - Options Considered:
      - A second exported runner (`runFoldBoundaryConformance`) — rejected: same fixture provider, same measurement, one extra public symbol for a relaxation of the existing assertion.
      - Keep asserting in the loop and pass a flag to skip the first failure — rejected: it cannot report the reset list, and `allowedResets: 0` would still need the collect path for the vacuity check.
      - `allowedResets` plus a reported `resets` list on the existing runner — chosen: one code path, additive option, default unchanged.
    - Chosen Approach: collect per-gap fractions and tail-aware fractions, classify sub-threshold gaps as resets, assert `resets.length === allowedResets`, and return the indexes.
    - API Notes and Examples:
      ```ts
      const result = await runPrefixStabilityConformance({
        host: { ...myAssembly, attentionCompiler: { trigger: { kind: "predicate", shouldFold: (state) => state.turn === 2 } } },
        skills: [alphaSkill, betaSkill],
        allowedResets: 1,
      });
      result.resets; // [3] — the request after the fold; append-only before and after it
      ```
    - Files to Create/Edit:
      - `src/testing/prefix-stability-conformance.ts`: `allowedResets` option, `resets` result field, collect-then-assert loop, vacuity check.
      - `src/__tests__/prefix-stability-conformance.test.ts`: one-fold happy path, `allowedResets: 0` negative control, never-folded vacuity case, post-fold append-only assertion.
      - `docs/prefix-stability-conformance.md`: `allowedResets` in the inputs table, `resets` in the outputs section, and a short "when a reset is expected" note replacing the current blanket warning.
    - References:
      - Plan 088 Further Actions, "Deferred (Task 4 follow-ups)" bullet 2 and the "Deferred boundary" paragraph (folding cannot be tail-stable without retaining raw bytes).
      - Plan 086 (trigger axes) and plan 074 (sticky frontier) contracts in `src/contracts-core/attention.ts`.
  - Test Cases to Write:
    - One fold at turn 2: `resets.length === 1`, reported index, every other gap ≥ `0.95`, post-fold `cacheableContinuity === 1`.
    - Negative control: the same folding host with default `allowedResets: 0` fails with the continuity error naming the fold gap — proves the option is what permits the run.
    - Vacuity: a non-folding host with `allowedResets: 1` fails saying one reset was expected and none observed.
    - Two mutating turns (trigger fires twice with a growing transcript) report two resets and still fail when `allowedResets: 1`.
    - Tool stubbing (not thinking stripping) is the fold under test when `keepLast: 0` — the reset index is unchanged and the pre-fold tool rows stay byte-identical.
  - Test Status: **written and passing** (2026-09-19) at HEAD `f6b1da81`. `src/__tests__/prefix-stability-conformance.test.ts` now runs 14 tests. The fold fixture is `attentionCompiler: { maxInputTokens: 4_000, thinkingKeepTurns: 0, keepLast: 0, trigger: { kind: "predicate", shouldFold: (state) => state.turn === 1 && state.estimatedInputTokens >= 1_350 } }`: with `allowedResets: 1` the run passes with `resets [3]`, `minContinuity` 53.3% and `cacheableContinuity` 54.0% (one real invalidation, not a tail re-send); the same host with `allowedResets: 0` rejects with `request 2 → 3 kept 53.3% of the previous provider prefix … (resets [3] of 3 request pairs, allowedResets 0)`; a non-folding host with `allowedResets: 1` rejects with `allowedResets is 1 but only 0 pair(s) broke below the minimum … resets [] of 3 request pairs`; a compiler-configured host whose gate never opens reports `resets []`, `cacheableContinuity === 1` and `minContinuity ≥ 0.95`; and a fold plus a post-fold context rewrite reports `resets [3, 4]` — passing at `allowedResets: 2`, rejecting at `1` with the reset list in the message. Verification: `npm run build:core`; `node --test dist/__tests__/prefix-stability-conformance.test.js dist/__tests__/docs.test.js dist/__tests__/input-pipeline.test.js` (204 pass); `npm run format:check` clean; `npx biome check` clean on the three edited sources; full `npm test` — all 6 stages pass.
  - Deltas from plan: (1) the plan's trigger cannot work — `shouldFold: (state) => state.turn === 2` fails closed. `state.turn` is the round index *within a run* (run 1 assemblies report turns 1 and 2; run 2 reports 1 and 2 again), so `turn === 2` is every post-tool round, and a predicate axis is `failsClosed`, so one that still fires after the stages throws `AttentionBudgetError` — observed: `attention budget exceeded: estimated 1343 tokens >= predicate (predicate gate of inputCap 4000 …) after dropping 0 thinking turns and stubbing 0 tool results`. The fixture predicate opens on a *run's opening round* once the carried request is over a floor, which the fold itself settles back under (measured states 933 / 1775 / 1782 / 2623 tokens; floors 1000–1700 pass, 900 fires on run 1's empty opening, 1800+ never fires). (2) Tool stubbing cannot be the fold here: the fixture's only tool rows are `load_skill` confirmations (~36 bytes) and `compileAttention` skips a row whose stub would cost more than the payload — with `keepLast: 0` and no thinking stage the observed error was `… after dropping 0 thinking turns and stubbing 0 tool results`, i.e. the gate opens, mutates nothing, and fails closed. The fold under test is therefore the compiler's **thinking stage** (`thinkingKeepTurns: 0`), which has real content because the fixture provider now emits a deterministic reasoning block per skill-load round when the host runs a compiler (`keepLast: 0` stays, so tool stubbing is enabled but a no-op). (3) That fixture capability is conditional: reasoning is emitted only for a truthy `host.attentionCompiler` (`true` or an options/handle object), so `false`/`undefined` keep plan 088's fixture bytes and Task 1's measurements untouched; no provider turn is added — the run still captures 4 requests. (4) Resets are counted on the metric `assertOn` selects (the plan's "whose prefix broke below `minContinuity`" was ambiguous); the docs state it. (5) "Two mutating turns (trigger fires twice with a growing transcript)" is pinned as fold + post-fold rewrite: in this two-turn fixture a second fold can only strip rows *appended* after the fold's pair boundary, which cannot break a shared prefix, so the run reports two resets only when the second mutation rewrites the shared prefix. (6) "Post-fold `cacheableContinuity === 1` for the post-fold pair" is not observable: the result exposes per-run minima, and a transcript-level fold lowers the fold pair's cacheable fraction too (54.0%). The append-only property is pinned as `resets === [3]` — any second sub-threshold pair would be a second reset — which also proves every pre-fold row (including the tool rows after the stripped reasoning) stayed byte-identical in the next request.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new option and result field on the exported conformance runner.
    - Docs pages to create/edit:
      - `docs/prefix-stability-conformance.md`: `allowedResets`/`resets` contract plus the expected-reset guidance that replaces the current "or expect the fold to reset the measured prefix" sentence.
    - `docs/index.md` update: no — existing page, no navigation delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Invalidation-inventory conformance for the non-tail rows
  - Acceptance Criteria:
    - Functional: one fixture per non-tail row of plan 088 Task 1's inventory table asserts the documented outcome **at the documented boundary**, not merely "the prefix changed":
      - instruction-injector `instructions` text changing between turns resets at the leading system prompt (`when: "on_input"` with a turn-dependent predicate);
      - injector `contextBlocks` appearing/vanishing resets at the injector context position, after the hoisted leading system messages and before skills;
      - a context provider returning new observational-memory-shaped blocks (`observational-memory` / `recent-messages` titles) resets at the same early context position, and re-rendering the identical blocks keeps the prefix byte-identical;
      - a replaced summary (`summaries` input group) resets at the summary position, while an appended user message keeps the earlier bytes intact;
      - `contextBudget` eviction at an input-cap transition resets exactly at the first evicted group and leaves every byte before it identical;
      - tool-schema selection changing (`request.tools` losing/gaining a schema) leaves the message prefix byte-identical while the serialized tool list differs.
    - Functional: the stable rows stay pinned too — base system prompt plus ordinary transcript growth measures `1` for the provider-visible prefix, so the table's "already stable" rows are asserted, not assumed.
    - Functional: each fixture reports the longest-common-prefix *boundary index* (message index and, for the schema row, a `tools` marker), so a later reordering of the default cache-aware layout fails an assertion instead of silently relocating an invalidation boundary.
    - Performance: fixtures call `assembleProviderInput` directly (no session, no provider) except the injector rows that need a turn; each is a single assembly pair and stays inside the existing input-pipeline test budget.
    - Code Quality: fixtures live in one new root test file with a shared `assembleTwice` helper (serialize → LCP → boundary); no production code change, no new export, no new subpath; the helper is named after the documented segment groups so the test reads like the inventory table.
    - Security: stub providers/loaders only; no network, credentials, or real memory packages; fixtures assert bytes and indexes, never host secrets.
  - Approach:
    - Documentation Reviewed:
      - Plan 088 Task 1 inventory table (the authoritative classification this task pins) and its `Evidence reviewed` line.
      - `docs/input-and-prompt-assembly.md` (cache-aware group order, tail section), `docs/context-and-skills.md` (context blocks and progressive disclosure), `docs/attention-compiler.md` (compiler vs `contextBudget` — mutually exclusive), `docs/provider-caching.md` (cache-anchor rules).
      - `src/input.ts` (`resolveContextProviders`, `runInstructionInjectors`, budget branch), `src/context-budget.ts` (`applyContextBudget` eviction order), `src/tool-search.ts` (`createToolSearchState` schema selection).
    - Options Considered:
      - Export an `invalidationInventoryConformance` helper so hosts can run the table themselves — rejected for now: no host has asked to assert prism's internal invalidation boundaries, and the runner added in plan 088 already covers the host-owned mutation case; revisit if a host ships its own segment groups.
      - Extend `runPrefixStabilityConformance` with per-row options — rejected: those fixtures are about assembly internals (injectors, summaries, eviction, schema selection), not about a host's session assembly, and they would bloat the exported option bag.
      - Root test fixtures beside the existing input-pipeline stability tests — chosen: test-only, no public surface, and it keeps the inventory table honest where it is read.
    - Chosen Approach: a new `src/__tests__/invalidation-inventory.test.ts` with a small shared helper (`assembleTwice` → serialized pair, LCP boundary, `tools` diff) and one `it()` per inventory row, named after that row.
    - API Notes and Examples:
      ```ts
      // one row, sketched: injector context blocks appear on turn 2
      const first = await assembleTwice(injectorHost({ blocks: [] }), injectorHost({ blocks: [{ title: "Now", content: "t2" }] }));
      assert.equal(first.boundary.messageIndex, contextIndex); // documented invalidation position
      assert.equal(first.messages[0], second.messages[0]);      // base system prompt untouched
      ```
      ```ts
      // the schema row asserts the opposite region
      assert.equal(serialized(messages), serialized(messagesAfterNarrowing));
      assert.notDeepEqual(toolsBefore.map((tool) => tool.name), toolsAfter.map((tool) => tool.name));
      ```
    - Files to Create/Edit:
      - `src/__tests__/invalidation-inventory.test.ts`: the six row fixtures plus the stable-row case and the shared helper.
      - `docs/prefix-stability-conformance.md`: a short "Documented invalidation boundaries" table linking each row to the page that owns the group order, so the pinned expectations are discoverable.
      - `scripts/phase16-baseline.json`: regenerated `distJsCount`/`distDtsCount` for the new compiled test file (`node scripts/phase16-tree-shake.mjs` writes it; confirm the gate is green afterwards).
    - References:
      - Plan 088 Task 1 table rows "Per-turn instruction-injector text", "Injector context blocks", "Observational-memory blocks", "Session compaction summaries", "Context-budget eviction / skill-body demotion", "Tool schemas and text-only fallback declarations".
      - `src/__tests__/input-pipeline.test.ts` cache-aware stability tests (plan 088 Task 2) as the sibling suite.
  - Test Cases to Write:
    - Six row fixtures above, each asserting both the reset boundary index and the bytes before it.
    - Stable-row pin: default assembly with an appended transcript message keeps `1` for the provider-visible prefix.
    - Identical-rerender control: the OM-shaped provider returning the same blocks twice keeps the prefix byte-identical (the documented difference between recompose-equal and recompose-changed).
    - Schema row negative control: changing a tool's *description* also changes the serialized tool list while messages stay identical — the assertion covers schema fields, not just names.
  - Test Status: **written and passing** (2026-09-19) at HEAD `f6b1da81`: one new root suite, `src/__tests__/invalidation-inventory.test.ts` (7 tests), no production change, no new export, no new subpath. The shared `assembleTwice` helper serializes one JSON fragment per message and per tool schema, reports `boundary.messageIndex` / `boundary.toolIndex` (leading byte-identical fragments — equally the index of the first fragment that differs) and the byte-shared `continuity` under the runner's definition. Pinned boundaries in the default `cache_aware` layout: injector `on_input` text → message 0, with the base prompt bytes surviving as a prefix inside that message and `continuity < 1`; injector context blocks appearing *and* vanishing → message 2 (`[system, host context, injector block, skill, input]`); OM blocks (host context block first) → message 2 with both `observational-memory` and `recent-messages` rewritten, and an identical re-render at `continuity 1` with `boundary.messageIndex === before.messages.length`; replaced summary → message 1 (hoisted while nothing user-role precedes it), an appended turn → `continuity 1`, an added leading attachment → message 1 with the summary moving to message 2; `contextBudget` eviction → message 4 for the single `tool_results` drop and message 2 for the `tool_results` + oldest `history` pair, with the omission kinds/ids read back from `getContextBudgetReport`; tool schemas → messages byte-identical while the selected list gains (`toolIndex === before.tools.length`: the new schema appends, cache anchor holds), loses, or changes a description in place (`toolIndex 1`, names unchanged). The stable row pins ordinary transcript growth at `continuity 1` and the pending-tool-result round gap (a result inserts immediately before the current input). Verification: `npm run build:core`; `node --test dist/__tests__/invalidation-inventory.test.js dist/__tests__/docs.test.js` (162 pass); `npm run format:check` clean; `npx biome check` clean on both edited sources; full `npm test` — all 6 stages pass (root suites 1959 tests). Cross-layout control: switching the same fixture host to `inputLayout: "legacy"` moves the context slot to message 0 and the summary behind it, so every boundary assertion fails instead of relocating silently.
  - Deltas from plan: (1) the listed `scripts/phase16-baseline.json` refresh is not a Task-3 artifact — the new test file compiles into `dist/__tests__/`, and `scripts/phase16-tree-shake.mjs` counts only top-level `dist/*.js` / `dist/*.d.ts`, so a test file cannot move those counts. The block was still regenerated (86/86/26 → 87/87/27) because the committed values were stale since 2026-09-02 (top-level module drift from later plans), recorded as a drift refresh rather than a delta of this task. (2) The eviction fixture needs one calibration assembly (`maxInputBytes: 1_000_000`, `reportOmissions: true`) to read `keptBytes`; the caps are then derived — `keptBytes - 1` is the smallest cap that evicts, so exactly one group drops, and `keptBytes - firstOmission.byteLength - 1` forces the next group in order — instead of hardcoding a cap. That fixture is 3 assembly pairs rather than the single pair the performance line assumed; the suite still runs in ~13 ms, and dropping the calibration would have meant a magic cap tied to the ÷4 estimator. (3) The stable row does not claim byte-prefix purity for a pending tool result: it lands immediately before the current input, so that input is the round's boundary (the ~95.7% gap the runner reports). Ordinary transcript growth — the previous input preserved in history at the same index — is the case that measures exactly `1`. (4) The summary row pinned the role-sensitive hoist the inventory prose mentions: a leading user attachment moves the summary behind the context/skill slots and is itself the boundary. `docs/input-and-prompt-assembly.md` already documents both the group order and that hoist, so no owner page needed correcting. (5) The docs table landed in `docs/prefix-stability-conformance.md` under “Extension and configuration notes” instead of a new `##` section, because the API-page structure in `.agents/skills/create-plan/references/prism-wiki.md` fixes the section set. It covers every inventory row — including the attention-compiler fold and the plan-088 tail row — with an owning page link per row, and `docs.test.ts` now pins the `Documented invalidation boundaries` table and the `invalidation-inventory.test.ts` fixture path. (6) The first draft used 3 non-null assertions; they were rewritten to `?? ""` locals so the plan-071 ratchet stays at its recorded 551 (the `performance budget` stage fails on the 554 a 3-assertion rise measures).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — test-only fixtures over existing assembly behavior (`contextBudget`, injectors, context providers, tool schemas), with one docs table for discoverability.
    - Docs pages to create/edit:
      - `docs/prefix-stability-conformance.md`: documented-invalidation-boundary table; the owning pages (`docs/input-and-prompt-assembly.md`, `docs/context-and-skills.md`, `docs/provider-caching.md`) keep their current text unless a fixture contradicts it, in which case the page is corrected in this task. **Done** — table added (nine rows: injector text, context blocks, OM blocks, summaries, tool results/input, budget eviction, schema selection, attention fold, tail segments) plus the docs-test phrases; no fixture contradicted an owner page, so no other page was edited.
    - `docs/index.md` update: no — no new API page and no navigation delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Tail detection reads the session's own `tailSegments` map (identity first, serialized equality second) rather than adding a wire marker: exact for the default builder and for cloning prompt builders, but a host that re-renders tail bytes into a different shape reads `cacheableContinuity === minContinuity` instead of a tail-aware number. Upgrade only if a host needs the number for its own live traffic (marker field on the wire, or an adapter-level segment index).
- `resets` reports request-pair indexes only. There is no per-pair fraction list, so “the pair after the fold was append-only” rests on `resets` plus the run minima rather than on reading that pair's own fraction.
- The Task 2 fold fixture proves the **thinking-stage** fold (`thinkingKeepTurns: 0`). Tool-result stubbing stays configured (`keepLast: 0`) but cannot be the visible reset with the fixture's ~36-byte `load_skill` rows, so a regression confined to the tool-result stage would not fail that fixture; `src/__tests__/attention-compiler-stages.test.ts` keeps covering the stage ledger.
- Task 3 fixtures pin the default `cache_aware` layout and the documented hoist. `legacy` layout and custom builders stay out of scope: a host-owned reorder is a documented explicit invalidation, not a layout claim.
- No `invalidationInventoryConformance` export was added (the plan's rejected Option A). The boundaries are prism-internal and the fixtures live beside the sibling input-pipeline suite; a host with its own segment groups would need a new runner.
- The `scripts/phase16-baseline.json` treeShake refresh absorbed drift unrelated to this plan (86 → 87 top-level modules, reachability 26 → 27). The block carries no per-refresh comment, so that provenance lives in this plan rather than in the file.

## Further Actions
- **(P2) Tail-aware number for host traffic.** `cacheableContinuity` is a fixture measurement today. If a host wants per-turn cacheable-prefix scoring in production, the demand-gated upgrade is a marker field the runner can read (changes wire bytes) or an adapter-level segment index — decide only when a host asks.
- **(P2) Per-pair reset detail.** `resets` names the request index only. A `resetDetails` field carrying the measured fraction (and the cacheable fraction) per reset would let a host cockpit plot the boundaries instead of re-deriving the measurement. Add when a host needs the series rather than the minimum.
- **(P3) Tool-result-stage fold fixture.** A fixture whose provider returns a large tool result (instead of a 36-byte `load_skill` confirmation) would pin the `tool_results` stage of `compileAttention` end to end the way the thinking stage is pinned now.
- **(P3) Remaining eviction boundaries.** Task 3 pins the first two groups in the drop order (tool results, history). `context`, `skills` (body demotion), and `attachments` evictions are covered behaviourally by `src/__tests__/context-budget.test.ts` but not pinned to an LCP boundary index; add rows there if the drop order changes.
- **(P3) `legacy`-layout parity.** The inventory fixtures assert `cache_aware` only. If `legacy` keeps shipping, a small parity pair would catch a change that keeps `cache_aware` correct while moving legacy positions.
