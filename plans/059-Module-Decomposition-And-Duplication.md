# Module Decomposition and Duplication Consolidation

Source: `docs/_evidence/implementation-review-2026-09-03.md` §2.3, §2.6 and §8
(quality track). Behavior-preserving splits of the five oversized state machines and
targeted dedupe — no new abstractions, no interfaces with one implementation.

Targets (review-verified):
- `src/agent-session/session.ts` — 1,847 lines; `runInternal` ~841 lines.
- `packages/prism-coding-tools/src/agent/process/sessions.ts` — 1,333 lines; one ~1,200-line closure.
- `packages/prism-core/src/runtime/workflows/saga.ts` — 1,198 lines.
- `packages/web-tools/src/browser/manager.ts` — 1,130 lines; `performAction` ~329 lines.

## Objectives

- Split each god module along its existing cohesive phases (persistence/recovery, dispatch, forward/compensation, provider/tool rounds) into same-package files.
- Extract the single giant closure in coding-tools sessions into named, testable phases.
- Dedupe only duplication proven identical (pure codecs); leave dialect-specific persistence code separate.
- Zero behavior change: public exports, event sequences, and test outcomes identical.

## Expected Outcome

- No production file >800 lines; no function >250 lines (recorded in evidence).
- Existing suites green with no assertion edits (behavior-preserving proof).
- Module map (`graft build`) shows clearer fan-out; review of each split file fits one screen of intent.

## Tasks

- [ ] Split `src/agent-session/session.ts` (`runInternal` phases)
  - Acceptance Criteria:
    - Functional: `runInternal` decomposed into named phase functions (context assembly, provider round, tool round, finalize/persist) in same-package files; public exports of `@arnilo/prism` unchanged.
    - Performance: no added per-iteration allocations beyond function-call boundaries; session benchmark suite non-regressed.
    - Code Quality: no new interfaces/classes; pure function extraction with explicit inputs/outputs; file <800 lines.
    - Security: redaction/ownership checks stay on the same code paths (no check relocated past its boundary).
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session.ts` current structure (graft skeleton + read of `runInternal`).
      - `docs/index.md` session runtime section (public behavior contract).
    - Options Considered:
      - Rewrite as explicit state machine (rejected: behavior risk, unrequested abstraction).
      - Mechanical phase extraction (chosen — smallest behavior-preserving diff).
    - Chosen Approach: cut `runInternal` at existing comment/phase boundaries; move each phase to `session/<phase>.ts`; keep shared types in one internal file.
    - API Notes and Examples:
      ```ts
      // src/agent-session/session/persist.ts
      export async function persistRound(ctx: RoundContext): Promise<void> { /* moved body */ }
      ```
    - Files to Create/Edit:
      - `src/agent-session/session.ts` (shrink), `src/agent-session/session/*.ts` (create, tentative names).
    - References: review §2.3 item 3; `src/__tests__/agent-session*.test.ts` (safety net).
  - Test Cases to Write:
    - None new — existing suites must pass without modification (the acceptance is zero behavior change).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal split).
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Split `packages/prism-coding-tools/src/agent/process/sessions.ts` (giant closure)
  - Acceptance Criteria:
    - Functional: the ~1,200-line closure becomes named phase functions (spawn, monitor, recovery, teardown) with explicit state object; all exported API unchanged.
    - Performance: identical process lifecycle behavior; coding-journey e2e suite green and non-regressed.
    - Code Quality: file <800 lines; each phase independently unit-testable.
    - Security: approval/egress gates stay attached to the same operations.
  - Approach:
    - Documentation Reviewed: file structure via graft skeleton; `packages/prism-coding-tools` process tests.
    - Options Considered: class-based session object (rejected: unnecessary stateful abstraction) vs phase functions + shared state record (chosen).
    - Chosen Approach: lift closure variables into one `ProcessSessionState` record passed explicitly.
    - API Notes and Examples: n/a (internal).
    - Files to Create/Edit:
      - `packages/prism-coding-tools/src/agent/process/sessions.ts` (shrink); sibling `process/sessions-*.ts` files (create).
    - References: review §2.3 item 3; e2e coding-journey suite.
  - Test Cases to Write:
    - Unit tests for extracted recovery/teardown phases exercising failure injection (previously untestable inside closure).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Split `packages/prism-core/src/runtime/workflows/saga.ts`
  - Acceptance Criteria:
    - Functional: forward/compensation orchestration, saga persistence, and recovery split into same-package modules; exports of `@arnilo/prism-core/runtime/workflows` unchanged.
    - Performance: workflow-loop benchmark non-regressed (±5%).
    - Code Quality: file <800 lines; compensation table data-driven, not inline-branchy.
    - Security: ledger/effect ordering guarantees unchanged (existing durability tests prove it).
  - Approach:
    - Documentation Reviewed: saga structure; `scripts/benchmark-workflow-loop.test.mjs` (perf guard); durability tests in prism-core.
    - Options Considered: generic saga framework types (rejected: interface-with-one-implementation smell) vs structural split (chosen).
    - Chosen Approach: split at persistence/recovery/dispatch seams already present.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: `saga.ts` (shrink), `workflows/saga-*.ts` (create).
    - References: review §2.3 item 3.
  - Test Cases to Write: none new; existing durability + benchmark suites are the guard.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Split `packages/web-tools/src/browser/manager.ts` (`performAction`)
  - Acceptance Criteria:
    - Functional: `performAction` (~329 lines) decomposed into per-action-kind handlers selected from a map; exports unchanged; every supported action kind still passes conformance.
    - Performance: action dispatch via map lookup (constant); browser suite non-regressed.
    - Code Quality: file <800 lines; adding an action kind = one handler file + map entry.
    - Security: per-action approval/credential scoping unchanged; default-deny for unknown kinds preserved (map-miss → typed error).
  - Approach:
    - Documentation Reviewed: manager structure; obscura/browser conformance tests.
    - Options Considered: strategy interface (rejected — one consumer) vs handler map of existing functions (chosen).
    - Chosen Approach: extract each `case` block into `actions/<kind>.ts`; registry object maps kind → handler.
    - API Notes and Examples:
      ```ts
      const handlers: Record<ActionKind, ActionHandler> = { click, type, scroll, /* … */ };
      ```
    - Files to Create/Edit: `browser/manager.ts` (shrink), `browser/actions/*.ts` (create).
    - References: review §2.3 item 3.
  - Test Cases to Write:
    - Unknown action kind → same typed error as before (explicit regression test).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Dedupe proven-identical persistence codecs (SQLite/PostgreSQL)
  - Acceptance Criteria:
    - Functional: only pure encode/decode/validation helpers proven byte-identical between `sessions` sqlite/postgres paths are shared; transaction/dialect code stays separate.
    - Performance: no per-row allocation regressions (persistence benchmarks non-regressed).
    - Code Quality: shared code lives in one `codec` module with property tests proving round-trip parity on both paths.
    - Security: no SQL constructed differently than before (dialect boundaries untouched).
  - Approach:
    - Documentation Reviewed:
      - Review §2.6: files ~1,035/1,050 lines, dialects differ legitimately.
      - Session AST duplicate analysis (this session's duplicate-function report).
    - Options Considered:
      - Generic DB abstraction layer (rejected — review explicitly warns).
      - Extract only provably identical pure helpers (chosen).
    - Chosen Approach: diff the two codec sets; move identical functions to shared module; leave rest.
    - API Notes and Examples: n/a (internal).
    - Files to Create/Edit:
      - `packages/prism-core/src/sessions/sqlite/*`, `.../postgres/*`, shared `.../codec.ts` (tentative paths from actual layout).
    - References: review §2.6.
  - Test Cases to Write:
    - Round-trip property test: same fixture corpus through both codecs → identical results.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Verify structure budgets and record evidence
  - Acceptance Criteria:
    - Functional: offline `npm test` + coverage green; no production file >800 lines (checked by a small gate script or recorded `wc -l` evidence); benchmarks non-regressed.
    - Performance: before/after line counts and benchmark numbers recorded.
    - Code Quality: `docs/_evidence/module-decomposition-<date>.md` records each split, line deltas, and the no-new-assertion-edits proof.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed: budget-gate conventions.
    - Options Considered: permanent line-count gate (tempting; defer to plan 058 budgets if wanted) vs one-time evidence (chosen).
    - Chosen Approach: one-time evidence + graft build refresh for updated module map.
    - API Notes and Examples: `find src packages -name '*.ts' ! -path '*__tests__*' | xargs wc -l | sort -rn | head`.
    - Files to Create/Edit: evidence file; this plan's checkboxes.
    - References: review §2.3.
  - Test Cases to Write: n/a.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: evidence file.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
