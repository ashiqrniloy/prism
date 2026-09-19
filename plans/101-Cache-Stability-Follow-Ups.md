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

- [ ] Task 1: Tail-aware continuity metric (cacheable-prefix score)
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new option and result field on the exported conformance runner.
    - Docs pages to create/edit:
      - `docs/prefix-stability-conformance.md`: inputs/result tables, both-metric explanation, no-tail-segment behavior, and a note that `minContinuity` keeps its frozen provider-visible meaning.
    - `docs/index.md` update: no — existing page, no navigation delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 2: Fold-boundary conformance (one allowed reset, reported)
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new option and result field on the exported conformance runner.
    - Docs pages to create/edit:
      - `docs/prefix-stability-conformance.md`: `allowedResets`/`resets` contract plus the expected-reset guidance that replaces the current "or expect the fold to reset the measured prefix" sentence.
    - `docs/index.md` update: no — existing page, no navigation delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 3: Invalidation-inventory conformance for the non-tail rows
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
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — test-only fixtures over existing assembly behavior (`contextBudget`, injectors, context providers, tool schemas), with one docs table for discoverability.
    - Docs pages to create/edit:
      - `docs/prefix-stability-conformance.md`: documented-invalidation-boundary table; the owning pages (`docs/input-and-prompt-assembly.md`, `docs/context-and-skills.md`, `docs/provider-caching.md`) keep their current text unless a fixture contradicts it, in which case the page is corrected in this task.
    - `docs/index.md` update: no — no new API page and no navigation delta.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- To be filled after tasks are completed and tests pass.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
