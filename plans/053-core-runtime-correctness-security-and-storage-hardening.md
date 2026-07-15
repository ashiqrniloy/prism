# Core Runtime Correctness, Security, and Storage Hardening

## Objectives

- Resolve review P0 and core-runtime P1/P2 findings, including bug-report fixes A-D.
- Establish correct transcript, redaction, persistence, and bounded-ledger foundations required by later capability plans.
- Reduce touched core hotspots and replace brittle structural checks with behavioral tests where practical.

## Expected Outcome

- Revision and multi-tool-round requests are valid, chronological, duplicate-free, and redacted safely.
- Redaction handles cycles, shared references, values, and keys without leaks.
- Ledger writes have bounded concurrency; JSONL/config behavior fails safely with documented limits.
- Core docs/tests describe and enforce corrected behavior before provider/tool/package expansion.

## Tasks

- [x] 0. Build review traceability matrix and lock failing regressions
  - Acceptance Criteria:
    - Functional: A checked-in test/matrix maps bug-report A-D and every core finding to an owning task/test; regressions reproduce revision crash/duplication, malformed-message failure, multi-round ordering, ledger fan-out, JSONL corruption, and typed `ENOENT` handling.
    - Performance: New fixtures are network-free and complete in under 3 seconds.
    - Code Quality: Tests assert full transcript/state behavior, not source text or incidental native errors.
    - Security: Secret canaries are asserted absent from requests, events, stores, ledgers, and errors.
  - Approach:
    - Documentation Reviewed:
      - `prism-bug-report.md`; `code-reviews/2026-07-14.md` P0/P1/P2 findings.
      - `docs/agent-loops.md`, `docs/credentials-and-redaction.md`, `docs/session-stores.md`, `docs/node-jsonl-session-store.md`.
    - Options Considered:
      - Helper-only unit tests: miss cross-component identity/order defects.
      - One runtime regression plus focused boundary tests: chosen.
    - Chosen Approach:
      - Extend existing suites and add `docs/review-coverage-2026-07-14.md` as temporary-to-release traceability page retained as maintenance record.
    - API Notes and Examples:
      ```ts
      assert.deepEqual(requests[1]!.messages.map(({ role }) => role), ["user", "assistant", "user"]);
      assert.equal(JSON.stringify(requests).includes(secret), false);
      ```
    - Files to Create/Edit:
      - `src/__tests__/agent-loops.test.ts`, `src/__tests__/runtime-redaction.test.ts`, `src/__tests__/openai-compatible.test.ts`.
      - `src/__tests__/run-ledger.test.ts`, `src/__tests__/node-session-store-jsonl.test.ts`, `src/__tests__/node-config.test.ts` (exact existing filenames to confirm).
      - `docs/review-coverage-2026-07-14.md`: issue→plan→test mapping.
      - `docs/index.md`: add maintenance/release-quality entry.
    - References:
      - `src/agent-loops.ts`, `src/input.ts`, `src/redaction.ts`, `src/agents.ts`, `src/node/session-store-jsonl.ts`.
  - Test Cases to Write:
    - Redacted failed validation reaches second provider request with one valid repair message.
    - Two tool rounds produce alternating assistant/tool transcript.
    - 10,000 ledger events never exceed intended append concurrency.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; task pins intended behavior.
    - Docs pages to create/edit: `docs/review-coverage-2026-07-14.md` for complete traceability.
    - `docs/index.md` update: yes — add review coverage under maintenance/release.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 1. Fix revision ownership, graph redaction, and provider message diagnostics
  - Acceptance Criteria:
    - Functional: Repair input is persisted and sent exactly once, then promoted to history; shared graph references stay structured; only ancestor cycles become `[Circular]`; object/Map string keys are redacted; malformed OpenAI-compatible messages fail with indexed diagnostics.
    - Performance: No deep-clone workaround or history dedup scan; traversal is O(visited occurrences), provider validation O(messages + blocks).
    - Code Quality: One first-turn/revision input-ownership rule resolves fixes A+B; active-path redaction resolves C; explicit boundary validation resolves D.
    - Security: Known secrets cannot survive in string values or keys, and diagnostics never stringify message payloads.
  - Approach:
    - Documentation Reviewed:
      - Bug report fixes A-D; `docs/input-and-prompt-assembly.md`, `docs/structured-output.md`, `docs/credentials-and-redaction.md`, `docs/providers/openai-compatible.md`.
    - Options Considered:
      - Clone repair input: prevents identity collision but preserves duplicate prompts; rejected.
      - Generic request deduplication: hides transcript errors and complicates custom builders; rejected.
      - Correct history timing + active-ancestor set + serializer guard: chosen.
    - Chosen Approach:
      - Keep pending repair messages outside history until their generation turn completes; use `WeakSet` as recursion stack with `finally` removal; validate message/role/content before serialization.
    - API Notes and Examples:
      ```ts
      active.add(value);
      try { return redactChildren(value, active); }
      finally { active.delete(value); }
      ```
    - Files to Create/Edit:
      - `src/agent-loops.ts`, `src/redaction.ts`, `src/providers/openai-compatible.ts`.
      - Relevant tests from Task 0.
      - `docs/agent-loops.md`, `docs/structured-output.md`, `docs/credentials-and-redaction.md`, `docs/providers/openai-compatible.md`.
    - References:
      - `src/agent-loops.ts:103-160`; `src/redaction.ts:32-56`; `src/providers/openai-compatible.ts:119-174`.
  - Test Cases to Write:
    - One/multiple revisions preserve exact store/request order without duplicates.
    - Diamond, self-cycle, mutual cycle, object-key, Map-key, and redacted-key collision cases.
    - Invalid message at first/later index gives stable, content-free error.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — loop transcript, redaction semantics, provider errors.
    - Docs pages to create/edit: `docs/agent-loops.md`, `docs/structured-output.md`, `docs/credentials-and-redaction.md`, `docs/providers/openai-compatible.md`.
    - `docs/index.md` update: yes — update descriptions to mention graph-safe key redaction and revision guarantees.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 2. Correct arbitrary multi-round tool transcript ordering
  - Acceptance Criteria:
    - Functional: Each tool result follows its assistant call before another assistant turn in request and persisted history, including multiple calls per turn and configured rounds >1.
    - Performance: Remove cumulative tool-result replay; assembly remains linear in transcript length.
    - Code Quality: Build one `toolResultMessage`, then use it for history and store; no parallel shadow state.
    - Security: Existing validation, permissions, and redaction still apply before tool data crosses boundaries.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-loops.md`, `docs/agent-session-runtime.md`, `docs/tools.md`.
    - Options Considered:
      - Reorder separate results during assembly: duplicate matching state; rejected.
      - Append result directly to live history and persistence: chosen.
    - Chosen Approach:
      - Eliminate accumulated `toolResults`; push each persisted result message to history immediately.
    - API Notes and Examples:
      ```ts
      const message = toolResultMessage(result);
      ctx.history.push(message);
      await ctx.appendMessage(message);
      ```
    - Files to Create/Edit:
      - `src/agent-loops.ts`, `src/__tests__/agent-loops.test.ts`, `src/__tests__/agents.test.ts`.
      - `docs/agent-loops.md`, `docs/agent-session-runtime.md`, `docs/tools.md`.
    - References:
      - `src/agent-loops.ts:30-69`; review multi-round P1 finding.
  - Test Cases to Write:
    - Zero, one, two, and maximum tool rounds have exact alternating transcript.
    - Multiple calls/results preserve deterministic order and call IDs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — provider-visible tool transcript.
    - Docs pages to create/edit: `docs/agent-loops.md`, `docs/agent-session-runtime.md`, `docs/tools.md`.
    - `docs/index.md` update: yes — update tool/runtime descriptions with ordering guarantee.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 3. Serialize event-ledger appends with bounded memory
  - Acceptance Criteria:
    - Functional: Ledger events append in emission order; completion drains all writes; first append failure is surfaced without hangs.
    - Performance: Maximum active append count is one and retained bookkeeping is O(1), including 10,000 deltas.
    - Code Quality: Replace promise array with one chain; no queue abstraction or bulk API.
    - Security: Records are redacted before entering chain and rejected payloads are not logged.
  - Approach:
    - Documentation Reviewed:
      - `docs/runs-and-usage.md`, `docs/performance.md`, `src/agents.ts:344-375`.
    - Options Considered:
      - Batch API: expands public ledger contract; rejected.
      - Sequential promise chain: chosen.
    - Chosen Approach:
      - Chain append operations, retain first failure, await/reset at existing drains.
    - API Notes and Examples:
      ```ts
      this.ledgerChain = this.ledgerChain.then(() => ledger.appendEvent(record));
      ```
    - Files to Create/Edit:
      - `src/agents.ts`, `src/__tests__/run-ledger.test.ts`, `docs/runs-and-usage.md`, `docs/performance.md`.
    - References:
      - Review event-ledger P1 finding.
  - Test Cases to Write:
    - Deferred ledger proves concurrency 1, order, drain, failure, and redaction.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — runtime scheduling guarantee.
    - Docs pages to create/edit: `docs/runs-and-usage.md`, `docs/performance.md`.
    - `docs/index.md` update: yes — note ordered bounded ledger persistence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 4. Fail JSONL append safely and state its production boundary
  - Acceptance Criteria:
    - Functional: Existing malformed/truncated JSONL prevents append with line diagnostics; valid reads/branches remain compatible; restart idempotency limitation is explicit.
    - Performance: No attempt to turn JSONL into indexed storage; benchmarks document O(file-size) append and recommended ceiling.
    - Code Quality: Reuse parser diagnostics; no index/cache that can diverge from file.
    - Security: Corrupt persistence is not silently extended; errors omit entry content and secrets.
  - Approach:
    - Documentation Reviewed:
      - `docs/node-jsonl-session-store.md`, `docs/session-store-conformance.md`, `docs/database-persistence.md`.
    - Options Considered:
      - Persistent side index/locking: recreates database poorly; rejected.
      - Fail closed and direct production users to Plan 056 adapters: chosen.
    - Chosen Approach:
      - Validate parser errors before append, document single-process/development ceiling, and retain diagnostic reader access.
    - API Notes and Examples:
      ```ts
      if (parsed.errors.length) throw new Error(`Invalid JSONL at line ${parsed.errors[0]!.line}`);
      ```
    - Files to Create/Edit:
      - `src/node/session-store-jsonl.ts`, related tests.
      - `docs/node-jsonl-session-store.md`, `docs/database-persistence.md`, `docs/performance.md`.
    - References:
      - Review JSONL P2 finding; Plan 056 database adapters.
  - Test Cases to Write:
    - Corrupt middle/final line blocks append; valid file still branches and deduplicates within process.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — JSONL append failure and documented support boundary.
    - Docs pages to create/edit: `docs/node-jsonl-session-store.md`, `docs/database-persistence.md`, `docs/performance.md`.
    - `docs/index.md` update: yes — distinguish development JSONL from production adapters.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 5. Use typed filesystem errors and split touched core hotspots by cohesive domain
  - Acceptance Criteria:
    - Functional: Optional config/settings skip only typed `ENOENT`; permission, directory, malformed JSON, and deceptive error-message cases surface.
    - Performance: No additional filesystem calls.
    - Code Quality: One local typed-error predicate replaces message matching; touched sections of `contracts.ts`/`agents.ts` move only when a cohesive module reduces conflicts; source-text architecture tests are replaced by behavior/type/export assertions when touched.
    - Security: Permission errors cannot be mistaken for missing optional configuration.
  - Approach:
    - Documentation Reviewed:
      - `docs/node-filesystem-config.md`, `docs/configuration-and-manifests.md`, review maintainability findings.
    - Options Considered:
      - Preserve wrapped message checks: brittle; rejected.
      - Check Node error `code` before wrapping: chosen.
      - Broad file split: churn without benefit; rejected.
    - Chosen Approach:
      - Add minimal `isNodeErrorCode` at existing shared node boundary or inline if only two callers; extract only domains already changed by Tasks 1-4.
    - API Notes and Examples:
      ```ts
      const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
      ```
    - Files to Create/Edit:
      - `src/node/config.ts`, `src/node/settings.ts`, related tests.
      - `src/contracts.ts`, `src/agents.ts`, architecture tests only if task changes justify extraction (tentative).
      - `docs/node-filesystem-config.md`, `docs/configuration-and-manifests.md`.
    - References:
      - `src/node/config.ts:39-54`; `src/node/settings.ts:24`; review hotspot/source-test notes.
  - Test Cases to Write:
    - Real `ENOENT` skips; synthetic message containing ENOENT with non-missing code does not.
    - Existing export/type tests pass after any cohesive extraction.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — optional-file error classification.
    - Docs pages to create/edit: `docs/node-filesystem-config.md`, `docs/configuration-and-manifests.md`.
    - `docs/index.md` update: yes — mention typed optional-file semantics.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 6. Verify core phase and close coverage matrix
  - Acceptance Criteria:
    - Functional: Every 053 matrix row links to passing tests and updated docs; core build/test/install smoke passes.
    - Performance: Record test/runtime/redaction/ledger/JSONL benchmark results with no unexplained regression.
    - Code Quality: `git diff --check`, typecheck, export contracts, and docs links pass; no stale duplicate helper/state remains.
    - Security: Secret canary and dependency audit checks pass; no high/critical issue introduced.
  - Approach:
    - Documentation Reviewed:
      - `docs/review-coverage-2026-07-14.md`, `docs/release-and-install.md` verification commands.
    - Options Considered:
      - Defer all validation to final release: poor fault isolation; rejected.
      - Phase-local gate plus final Plan 058 gate: chosen.
    - Chosen Approach:
      - Run focused suites, `npm test`, build/typecheck, docs/link checks, audit, and update matrix evidence.
    - API Notes and Examples:
      ```bash
      npm run typecheck && npm test && npm run build
      git diff --check
      ```
    - Files to Create/Edit:
      - `docs/review-coverage-2026-07-14.md`: record completed 053 evidence.
      - `plans/053-core-runtime-correctness-security-and-storage-hardening.md`: check tasks and record actual deviations after execution.
    - References:
      - Plan 058 final release gate.
  - Test Cases to Write:
    - No new test; execute all Task 0-5 regressions and existing core gates.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only.
    - Docs pages to create/edit: `docs/review-coverage-2026-07-14.md` evidence update.
    - `docs/index.md` update: no additional entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- No cohesive extraction from `contracts.ts` / `agents.ts` in this phase; hotspots unchanged because Tasks 1–4 did not justify a split.
- OpenAI-compatible malformed-message failures surface as provider error events (existing generate try/catch), not thrown host exceptions.

## Further Actions

- Resolved by Plan 058 Task 2: ledger serialization and JSONL append ceilings are recorded in `docs/performance.md`.
- Resolved by Plan 058 Task 4: all remaining `isMissingFile` duplicates use strict shared `isNodeErrorCode`.
- No post-0.0.4 action remains from Plan 053.
