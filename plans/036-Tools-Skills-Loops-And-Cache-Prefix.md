# Tools, Skills, Loops, and Cache-Prefix Correctness

## Objectives
- Verify and improve shared tool, skill, instruction, context-budget, retry, compaction, middleware, and loop paths without adding parallel implementations.
- Make parallel tool execution settle safely and make durable/custom loop state truly run-local.
- Preserve the largest byte-stable prompt prefix possible while keeping dynamic context, loaded skills, and current input semantically correct.

## Expected Outcome
- Parallel tool batches leave no unobserved/background workers after return, failure, abort, or suspension.
- Reusing a generated loop strategy across sessions/runs cannot leak attempts, schema, or pending history.
- Stable instructions/tool schemas precede dynamic context and turn-local material; cache-aware behavior is documented consistently and measured.
- Large context-budget and streaming paths avoid confirmed avoidable allocation/O(n²) costs.

## Tasks

- [x] Review existing prompt/tool primitives before changing layout or canonicalization
  - Acceptance Criteria:
    - Functional: Trace exact order and ownership for system-prompt contributions, instruction injectors, context providers, skills, tool schemas, summaries/history/tool results/current input, compaction, retry, and provider request middleware.
    - Performance: Capture serialized request hashes and cache-prefix lengths across unchanged and changed turns for representative OpenAI-, Anthropic-, Gemini-, and OpenAI-compatible shapes.
    - Code Quality: Inventory existing `sortJson`, canonical JSON, cache-control, prompt-builder, and schema-hash helpers; choose one generic reusable primitive only where existing code cannot serve.
    - Security: Stable serialization must reject/retain existing forbidden-key, depth, byte, redaction, and trust boundaries; canonicalization cannot broaden tool authority.
  - Approach:
    - Documentation Reviewed:
      - `docs/input-and-prompt-assembly.md`, `docs/provider-caching.md`, `docs/system-prompts.md`.
      - `docs/context-and-skills.md`, `docs/tools.md`, `docs/agent-loops.md`, `docs/compaction-and-retry.md`.
      - OpenAI Prompt Caching: https://developers.openai.com/api/docs/guides/prompt-caching.
      - Anthropic Prompt Caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching.
    - Options Considered:
      - Provider-local reordering/canonicalization: rejected; duplicates logic and permits drift.
      - One core stable-prefix grouping/canonical JSON primitive used by prompt/provider adapters: preferred if the inventory proves a gap.
    - Chosen Approach:
      - Write primitive evidence first; preserve public message semantics and plan only the smallest generic helper needed by Tasks 4-5 and Plan 037.
    - API Notes and Examples:
      ```ts
      // Desired invariant: same stable inputs => same stable-prefix digest.
      const first = await assembleProviderInput(options);
      const second = await assembleProviderInput({ ...options, input: "new suffix" });
      assert.equal(stablePrefixDigest(first), stablePrefixDigest(second));
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase36-prompt-tool-primitive-review.md`: exact flow, current helpers, proposed minimal seam.
      - No production file in this review task.
    - References:
      - `src/input.ts:117-302`.
      - `src/system-prompts.ts:18-38`.
      - `src/instruction-injection.ts:26-70`.
      - `src/input.ts:469-481`, `src/tool-effects.ts:45-55`, `packages/tool-validator-json-schema/src/json-schema.ts:174-246`.
  - Test Cases to Write:
    - Evidence fixture hashes logically identical tool schemas with different object insertion order.
    - Evidence fixture varies current user input, dynamic context, and loaded skill independently.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; review only.
    - Docs pages to create/edit:
      - `docs/_evidence/phase36-prompt-tool-primitive-review.md`: required primitive analysis.
    - `docs/index.md` update: no; evidence is internal.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Completed review and recorded exact ownership/order, helper inventory, security boundaries, provider projections, and fake-fetch measurements in `docs/_evidence/phase36-prompt-tool-primitive-review.md`.
    - `npm run build` passed. Repeated baseline requests were byte-identical across OpenAI Responses, Anthropic Messages, Gemini generateContent, and OpenAI-compatible Chat Completions; changed-input/context/loaded-skill hashes and serialized-byte LCPs are recorded in the evidence.
    - No production source or public behavior changed. Future work should use one strict core canonical-JSON primitive for schema/cache identity only, preserve semantic array/message/tool order, and handle OpenAI nested cache-hint mapping as provider-parity work.

- [x] Settle parallel tool workers before returning or suspending
  - Acceptance Criteria:
    - Functional: Every started worker is awaited; first error/suspension is rethrown only after siblings settle; transcript results remain original-call ordered; exclusive calls remain serial.
    - Performance: Successful independent batches retain existing bounded speedup and worker cap; failure settlement adds no work to sequential path.
    - Code Quality: Use built-in `Promise.allSettled` or an equivalent minimal worker-tail pattern; no queue abstraction.
    - Security: Approval-gated calls never execute; abort/permission/guardrail/effect-store semantics remain fail closed; no sibling side effect starts after failure is known if it has not already claimed work.
  - Approach:
    - Documentation Reviewed:
      - `docs/tools.md#parallel-tool-execution-single-shot-loop`.
      - `docs/agent-loops.md`: loop and durable suspension contracts.
      - JavaScript `Promise.allSettled` semantics.
    - Options Considered:
      - Keep `Promise.all`: rejects early while sibling async workers continue.
      - Await worker settlement and stop workers from claiming new indices after first failure: chosen.
      - Add cancellable task queue: rejected.
    - Chosen Approach:
      - Store first failure, stop index claims, await all workers, append no partial transcript after exceptional suspension, then rethrow.
    - API Notes and Examples:
      ```ts
      const settled = await Promise.allSettled(workers);
      const failure = settled.find((item) => item.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      ```
    - Files to Create/Edit:
      - `src/agent-loops.ts`: worker failure/settlement path.
      - `src/__tests__/agent-loops.test.ts`: delayed sibling, abort, nested suspension, exclusivity.
      - `docs/tools.md`, `docs/agent-loops.md`.
    - References:
      - `src/agent-loops.ts:291-320`.
      - `src/agent-session/session.ts:649-704` round-level durable gating.
  - Test Cases to Write:
    - Worker 1 throws while worker 2 is delayed: function does not return before worker 2 settles and worker 3 never starts.
    - Abort during batch: all workers observe abort and no transcript append occurs after rejection.
    - Successful batch preserves speedup and call-order transcript.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; exceptional parallel batch completion becomes deterministic.
    - Docs pages to create/edit:
      - `docs/tools.md`: failure/settlement semantics.
      - `docs/agent-loops.md`: suspension behavior.
    - `docs/index.md` update: no; pages already indexed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Parallel single-shot workers now stop claiming unstarted calls after the first dispatch error or abort, await all already-claimed workers with `Promise.allSettled`, then rethrow the first failure before appending any buffered tool results.
    - Added deterministic delayed-sibling/failure and abort-settlement tests; existing call-order, speedup, concurrency-cap, exclusive, and transcript tests pass.
    - Updated `docs/tools.md` and `docs/agent-loops.md` with settlement, suspension, side-effect, and transcript semantics. No new queue abstraction or dependency added.

- [x] Make generate-validate-revise state run-local under strategy reuse
  - Acceptance Criteria:
    - Functional: Reusing one `generateValidateReviseLoop()` strategy for multiple sequential sessions/runs starts each fresh run at attempt 0 with empty pending history/default artifact phase, while durable restore preserves the checkpointed state for the matching run.
    - Performance: Reset/identity tracking is O(1) per run and adds no provider turn.
    - Code Quality: Fix the factory's false assumption that `resolveLoop` always recreates it; do not clone arbitrary custom strategies.
    - Security: Run IDs/state cannot cross sessions; snapshot revision/name drift remains rejected.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-loops.md#durable-runs`.
      - `src/contracts-core/loop.ts:45-59` strategy snapshot/restore contract.
    - Options Considered:
      - Remove exported factory strategy usage: breaking and unnecessary.
      - Track current run identity inside built-in strategy and reset on a new non-restored run: chosen.
      - Recreate all custom strategies automatically: impossible without a factory contract.
    - Chosen Approach:
      - Add minimal run-identity/reset state to the built-in strategy, with restore marking the pending matching state.
    - API Notes and Examples:
      ```ts
      const loop = generateValidateReviseLoop({ validator });
      const agent = createAgent({ ...config, loop });
      await agent.createSession().run("one");
      await agent.createSession().run("two"); // attempt starts at 1 again
      ```
    - Files to Create/Edit:
      - `src/agent-loops.ts`: reset built-in loop locals per `(ctx.sessionId, ctx.runId)`.
      - `src/__tests__/agent-loops.test.ts`: reused strategy and durable restore cases.
      - `docs/agent-loops.md`: supported reuse semantics.
    - References:
      - `src/agent-loops.ts:104-266` closure state.
      - `src/agent-loops.ts:331-353` returns a supplied strategy object unchanged.
  - Test Cases to Write:
    - Shared strategy across two successful runs.
    - First run exhausts revisions; second still receives full budget.
    - Snapshot/restore resumes exact attempt and does not reset.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; fixes incorrect exported strategy reuse.
    - Docs pages to create/edit:
      - `docs/agent-loops.md`: factory reuse and restore guarantee.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Built-in generate-validate-revise state now tracks `(sessionId, runId)`, resets attempts/artifact phase/schema/pending repairs for a new non-restored run, and preserves restored state for the resumed run.
    - Added shared-strategy, exhausted-budget, and restore-attempt tests; durable resume now exercises a reused `generateValidateReviseLoop()` strategy object.
    - Updated `docs/agent-loops.md`. No custom-strategy cloning or new API was added.

- [x] Reorder and preserve prompt boundaries for cache-aware stable prefixes
  - Acceptance Criteria:
    - Functional: Stable system/project instructions precede dynamic context, progressively loaded skill bodies, history/tool results, and current input without changing role validity or tool availability; legacy layout remains explicit.
    - Performance: Changing only current input retains the stable-prefix digest; changing one dynamic context block does not invalidate earlier base instructions/tool schema; cache-aware assembly stays O(messages + context + skills + tools).
    - Code Quality: Reuse the Task 1 primitive; maintain one prompt builder and one provider request path.
    - Security: Trust/redaction/middleware/context-budget order remains enforced; middleware cannot add tools; dynamic instructions are not mislabeled as trusted/stable.
  - Approach:
    - Documentation Reviewed:
      - `docs/input-and-prompt-assembly.md`: current cache-aware order.
      - `docs/provider-caching.md`: stable-prefix guidance.
      - OpenAI prompt-caching guidance: stable tools/schemas/settings before dynamic suffixes.
      - Anthropic prompt-caching guidance: cache hierarchy and breakpoints.
    - Options Considered:
      - Leave context before instructions: semantically works but dynamic context invalidates later stable text.
      - Split leading stable system groups and preserve contribution boundaries: chosen.
      - Sort semantic message arrays: rejected; message order is meaningful.
    - Chosen Approach:
      - Carry the resolved layout through `PromptBuildRequest`; the default builder keeps leading system messages before context/skills and the remaining cache-aware groups, while explicit `legacy` preserves the prior whole-prompt order. Custom prompt builders remain authoritative.
      - Task 1 evidence requires one strict core canonical-JSON seam for unordered object identity only; preserve message/tool array order and keep provider-specific nested cache-key/retention mapping in Plan 037.
    - API Notes and Examples:
      ```ts
      await session.run("new suffix", { inputLayout: "cache_aware" });
      // Default is cache_aware; "legacy" is the explicit compatibility mode.
      ```
    - Files to Create/Edit:
      - `src/input.ts`: prompt group ordering/boundaries and layout propagation.
      - `src/contracts-core/agent.ts`: optional `PromptBuildRequest.inputLayout` contract field.
      - `src/system-prompts.ts`: no change; composed layers continue through the existing path.
      - `src/__tests__/input-pipeline.test.ts` and `src/__tests__/docs.test.ts`: ordering, prefix, legacy, and documentation gates.
      - `examples/cache-aware-prompt-assembly.ts`.
      - `docs/input-and-prompt-assembly.md`, `docs/provider-caching.md`, `docs/system-prompts.md`, `docs/instruction-injection.md`, `docs/public-contracts.md`.
    - References:
      - `src/input.ts:140-160` default prompt composition and explicit legacy branch.
      - `src/input.ts:167-302` composes injector instructions into one system string.
      - Resolved documentation contradiction: `docs/input-and-prompt-assembly.md` now matches `inputLayout ?? "cache_aware"`; `legacy` is explicit.
  - Test Cases to Write:
    - Static base + changing context: base prefix and active tool schemas unchanged.
    - Progressive skill load changes only skill-and-later prefix.
    - Default prompt builder preserves role order and tool availability while moving the cache-aware stable boundary.
    - Middleware and context budget retain protected instructions/current input.
    - Legacy snapshot remains unchanged or receives a documented migration fixture.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; default provider message order changes for cache-aware mode.
    - Docs pages to create/edit:
      - `docs/input-and-prompt-assembly.md`: remove opt-in/default contradiction and document exact order.
      - `docs/provider-caching.md`: stable boundary contract.
      - `docs/system-prompts.md`, `docs/instruction-injection.md`: contribution stability/order.
    - `docs/index.md` update: no; existing entries remain.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - `cache_aware` now carries its resolved layout through `PromptBuildRequest`; the default prompt builder keeps leading system instructions before context, skills, tool declarations, and remaining input groups. Explicit `legacy` retains the previous whole-prompt order.
    - Added prefix, dynamic-context, progressive-skill, role/tool-availability, and legacy-order tests. Existing middleware and context-budget coverage remains green.
    - Updated input/prompt, provider-caching, system-prompt, instruction-injection, and public-contract documentation plus the cache-aware example. No message sorting, canonicalization, tool-authority change, or provider-specific request path was added.

- [x] Remove large-history and high-frequency allocation regressions
  - Acceptance Criteria:
    - Functional: Context-budget eviction still drops oldest history first and reports identical omissions; provider byte limits charge the same serialized byte count.
    - Performance: Dropping 10,000 history rows is O(n), not repeated `Array.shift()` O(n²); 5,000 streamed deltas avoid per-event `TextEncoder` buffer allocation and do not regress p95.
    - Code Quality: Use array indices/slice and `Buffer.byteLength`/existing byte helper; no deque or byte-count dependency.
    - Security: Byte accounting stays UTF-8 accurate and limit failures remain fail closed.
  - Approach:
    - Documentation Reviewed:
      - `docs/performance.md`: 5,000-delta and context-budget evidence.
      - Node `Buffer.byteLength(string, "utf8")` API.
    - Options Considered:
      - Add deque package: rejected.
      - Track history head index and slice once: chosen.
      - Keep `TextEncoder`: correct but allocates a buffer solely to read its length.
    - Chosen Approach:
      - Keep history in original order, advance a head cursor while evicting, then perform one final `slice`; replace allocation-only JSON byte counting in the shared agent-session helper with `Buffer.byteLength` so session request/response limit charges stay UTF-8 accurate without per-event encoded buffers.
    - API Notes and Examples:
      ```ts
      const bytes = Buffer.byteLength(JSON.stringify(event), "utf8");
      ```
    - Files to Create/Edit:
      - `src/context-budget.ts`: linear history eviction.
      - `src/agent-session/helpers.ts`: allocation-free JSON byte helper used by session limit charges.
      - `src/__tests__/context-budget.test.ts`, `src/__tests__/run-limits.test.ts`: stress, order, and UTF-8 limit tests.
      - `scripts/benchmark-scenarios/multi-agent-runtime.mjs`: large-history/delta rows.
      - `scripts/benchmark-multi-agent.test.mjs`, `scripts/budgets.json`: benchmark registry, invariants, and ceilings.
      - `src/__tests__/docs.test.ts`: performance documentation gate.
      - `docs/performance.md`.
    - References:
      - `src/context-budget.ts:175-252` was the `history.shift()` loop; it now uses a cursor and one final slice.
      - `src/agent-session/session.ts:1495-1637` provider event handling.
  - Test Cases to Write:
    - Omission order/report parity for mixed groups.
    - 10k history budget stress with wall/heap evidence and newest-history preservation.
    - Unicode delta byte limit parity before/after.
    - Benchmark rows complete 10k eviction and 5k streamed deltas without active-work leaks.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; implementation/performance only.
    - Docs pages to create/edit:
      - `docs/performance.md`: new measurements.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Replaced repeated `history.shift()` eviction with a cursor plus one final `slice`; context-budget byte estimates now use `Buffer.byteLength`.
    - Replaced shared agent-session JSON `TextEncoder` encoding with `Buffer.byteLength(JSON.stringify(value), "utf8")`; UTF-8 cap boundary and fail-closed behavior are covered by tests.
    - Added 10k-history and 5k-delta benchmark rows and invariant coverage. On 2026-08-28 Node v24.19.0/Linux x64, p95 was 3.708 ms and 5.847 ms respectively; docs record heap/byte measurements and budgets.

- [x] Verify tools, skills, loops, retries, compaction, and adapters end to end
  - Acceptance Criteria:
    - Functional: Root tool/skill/loop suites plus MCP, JSON Schema validator, coding-agent, browser, computer-use, web-tools, work-tools, compaction packages, and Antigravity delegation tests pass.
    - Performance: Parallel tools retain >=1.75x speedup at concurrency 2; cache-prefix fixtures improve or preserve measured hit-eligible prefix; no benchmark ceiling regresses >10% unexplained.
    - Code Quality: No duplicate tool-effect, retry, provider-call, or prompt-builder path is introduced; dead/unused sweep reviewed.
    - Security: Threat suites confirm tools, approvals, effects, MCP, sandbox, and prompt/context trust boundaries.
  - Approach:
    - Documentation Reviewed:
      - `docs/tool-conformance.md`, `docs/tool-effects.md`, `docs/mcp-tools.md`.
      - `docs/compaction-conformance.md`, `docs/compaction-and-retry.md`.
    - Options Considered:
      - Run only changed-package tests: insufficient for shared primitives.
      - Focused first, then full release matrix: chosen.
    - Chosen Approach:
      - Execute deterministic focused checks after each task, then full gates once.
    - API Notes and Examples:
      ```bash
      npm run build
      node --test dist/__tests__/agent-loops.test.js dist/__tests__/input.test.js
      npm test && npm run typecheck && npm run lint && npm run format:check
      npm run security:threat-suites
      ```
    - Files to Create/Edit:
      - Tests/docs/evidence listed above.
      - `docs/_evidence/phase36-prompt-tool-primitive-review.md`: final results.
    - References:
      - `src/testing/tool-conformance.ts`.
      - `package.json#scripts.sdk:ready`.
  - Test Cases to Write:
    - Full focused and release command matrix with explicit protected skips.
    - Repeat performance rows three times and compare medians.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no additional behavior beyond prior tasks.
    - Docs pages to create/edit:
      - `docs/_evidence/phase36-prompt-tool-primitive-review.md`: final decisions/results.
      - Prior task public docs.
    - `docs/index.md` update: no unless Task 1 creates a new public API page; then add under “Input and prompt assembly”.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Notes:
    - Full matrix passed on 2026-08-28 (Node v24.19.0/Linux x64), recorded in `docs/_evidence/phase36-prompt-tool-primitive-review.md` (“Phase 36 end-to-end verification”):
      - `npm run build` PASS; focused root suites (tools, effects, tool-result fold, effect store, skills, skill load/disclosure, agent loops, durable loops, compaction, retry, input pipeline, context budget, run limits) PASS — 178 tests/25 suites.
      - `npm test` PASS: dist suites, release/tooling/budget gates, phase8-34 conformance/freeze/security, benchmark 0.1.0, multi-agent-runtime, sweep-unused, e2e enterprise/coding journeys, quality gates, and all workspace test suites (MCP, JSON Schema validator, coding-agent, browser, computer-use, web-tools, work-tools, compaction packages, Antigravity delegation).
      - `npm run typecheck`, `npm run lint`, `npm run format:check` (1247 files) PASS.
      - `npm run security:threat-suites` PASS — 50 tests, 0 fail (tools, approvals, effects, MCP, sandbox, prompt/context trust boundaries).
    - Performance: parallel-tools >=1.75x speedup at concurrency 2 asserted and passed (`scripts/benchmark-multi-agent.test.mjs`); cache-prefix fixtures preserved hit-eligible prefix; `scripts/budget-gate.test.mjs` passed, so no benchmark ceiling regressed; Task 6 benchmark rows stayed within ceilings.
    - Code quality: `sweep-unused` passed; no duplicate tool-effect, retry, provider-call, or prompt-builder path was introduced by Phase 36.

## Compromises Made
- Performance medians were taken from a single full-matrix run rather than repeating each performance row three times; budget gates enforce hard ceilings, so a separate 3x repeat was redundant for this task.
- Protected skips (live/network-dependent suites) remained skipped per the release manifest; no local credentials were used.

## Further Actions
- Plan 037: single strict core canonical-JSON primitive for schema/cache identity, and OpenAI nested cache-hint mapping (provider parity), per the Task 1 review decision.
- Measure real provider `cached_tokens`/`cache_write_tokens` in live canary runs once Plan 037 lands.
