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

- [x] Split `src/agent-session/session.ts` (`runInternal` phases)
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
    - Chosen Approach: cut `runInternal` at existing phase boundaries; `RuntimeAgentSession.runInternal` delegates to `executeRun`. Phases live under `src/agent-session/session/`. Host fields/methods used by phases dropped `private` (biome unused-private; still unpublished via `agents.ts` barrel).
    - API Notes and Examples:
      ```ts
      // src/agent-session/session.ts
      private async runInternal(...) {
        return executeRun(asSessionHost(this), input, options, runId, resumed);
      }
      ```
    - Files to Create/Edit:
      - `src/agent-session/session.ts` (shrink to 573 lines)
      - `src/agent-session/session/types.ts` (`SessionHost`, `RoundContext`)
      - `src/agent-session/session/assemble.ts` (context assembly + orchestrator)
      - `src/agent-session/session/provider-round.ts`
      - `src/agent-session/session/tool-round.ts`
      - `src/agent-session/session/persist.ts`
    - References: review §2.3 item 3; `src/__tests__/agents.test.ts` + `agent-loops.test.ts` (safety net; 182 pass).
  - Test Cases to Write:
    - None new — existing suites must pass without modification (the acceptance is zero behavior change).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal split).
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Split `packages/prism-coding-tools/src/agent/process/sessions.ts` (giant closure)
  - Acceptance Criteria:
    - Functional: the ~1,200-line closure becomes named phase functions (spawn, monitor, recovery, teardown) with explicit state object; all exported API unchanged.
    - Performance: identical process lifecycle behavior; coding-journey e2e suite green and non-regressed.
    - Code Quality: file <800 lines; each phase independently unit-testable.
    - Security: approval/egress gates stay attached to the same operations.
  - Approach:
    - Documentation Reviewed: file structure via graft skeleton; `packages/prism-coding-tools` process tests.
    - Options Considered: class-based session object (rejected: unnecessary stateful abstraction) vs phase functions + shared state record (chosen).
    - Chosen Approach: lift closure variables into `SessionsHost` (`ProcessSessionState` already names the lifecycle union). `createProcessSessions` builds the host and delegates. Phases: spawn, monitor, recovery, teardown.
    - API Notes and Examples:
      ```ts
      export function createProcessSessions(options: CreateProcessSessionsOptions): ProcessSessions {
        const host = createSessionsHost(options);
        return { start: (request) => startSession(host, request), /* get/cancel/recover/dispose */ };
      }
      ```
    - Files to Create/Edit:
      - `packages/prism-coding-tools/src/agent/process/sessions.ts` (30 lines, factory)
      - `packages/prism-coding-tools/src/agent/process/sessions-host.ts` (`SessionsHost` + helpers)
      - `packages/prism-coding-tools/src/agent/process/sessions-spawn.ts`
      - `packages/prism-coding-tools/src/agent/process/sessions-monitor.ts`
      - `packages/prism-coding-tools/src/agent/process/sessions-recovery.ts`
      - `packages/prism-coding-tools/src/agent/process/sessions-teardown.ts`
      - `packages/prism-coding-tools/src/agent/__tests__/process-session-phases.test.ts` (failure injection)
    - References: review §2.3 item 3; `process-sessions`/`process-recovery`/`process-pty` + new phase tests (46 pass).
  - Test Cases to Write:
    - Unit tests for extracted recovery/teardown phases exercising failure injection (previously untestable inside closure).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Split `packages/prism-core/src/runtime/workflows/saga.ts`
  - Acceptance Criteria:
    - Functional: forward/compensation orchestration, saga persistence, and recovery split into same-package modules; exports of `@arnilo/prism-core/runtime/workflows` unchanged.
    - Performance: workflow-loop benchmark non-regressed (±5%).
    - Code Quality: file <800 lines; compensation table data-driven, not inline-branchy.
    - Security: ledger/effect ordering guarantees unchanged (existing durability tests prove it).
  - Approach:
    - Documentation Reviewed: saga structure; `scripts/benchmark-workflow-loop.test.mjs` (perf guard); durability tests in prism-core.
    - Options Considered: generic saga framework types (rejected: interface-with-one-implementation smell) vs structural split (chosen).
    - Chosen Approach: split at persist/drive seams. `driveSaga` dispatches via `FORWARD` / `COMPENSATION` status tables (not inline if-chains). `saga.ts` keeps `defineSaga` / `runSaga` / `resumeSaga`.
    - API Notes and Examples:
      ```ts
      const COMPENSATION: Record<SagaCompensationStatus, StepAction> = {
        succeeded: /* cursor-- */,
        running: /* mark unknown */,
        unknown: reconcileCompensation,
        pending: attemptCompensation,
      };
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/runtime/workflows/saga.ts` (271 lines, public API)
      - `packages/prism-core/src/runtime/workflows/saga-types.ts`
      - `packages/prism-core/src/runtime/workflows/saga-persist.ts`
      - `packages/prism-core/src/runtime/workflows/saga-drive.ts`
    - References: review §2.3 item 3; `saga.test.ts` 10 pass; `benchmark-workflow-loop.test.mjs` 3 pass.
  - Test Cases to Write: none new; existing durability + benchmark suites are the guard.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Split `packages/web-tools/src/browser/manager.ts` (`performAction`)
  - Acceptance Criteria:
    - Functional: `performAction` (~329 lines) decomposed into per-action-kind handlers selected from a map; exports unchanged; every supported action kind still passes conformance.
    - Performance: action dispatch via map lookup (constant); browser suite non-regressed.
    - Code Quality: file <800 lines; adding an action kind = one handler file + map entry.
    - Security: per-action approval/credential scoping unchanged; default-deny for unknown kinds preserved (map-miss → typed error).
  - Approach:
    - Documentation Reviewed: manager structure; obscura/browser conformance tests.
    - Options Considered: strategy interface (rejected — one consumer) vs handler map of existing functions (chosen).
    - Chosen Approach: `performAction` looks up `ACTION_HANDLERS[kind]`. Distinct actions get their own file; locator family (click/fill/type/select/check/uncheck) and CDP family (block_urls/unblock_urls/throttle/emulate) share preamble helpers in `locator.ts` / `cdp.ts`. Unknown kind → `ERR_PRISM_BROWSER_INPUT`.
    - API Notes and Examples:
      ```ts
      const ACTION_HANDLERS: Record<BrowserActionName, ActionHandler> = {
        click, type: typeAction, scroll, /* … */
      };
      if (!isActionName(action)) throw new BrowserError("ERR_PRISM_BROWSER_INPUT", `Unsupported action: ${String(action)}`);
      return ACTION_HANDLERS[action](ctx, session, request, signal);
      ```
    - Files to Create/Edit:
      - `packages/web-tools/src/browser/manager.ts` (714 lines; dispatch + session lifecycle)
      - `packages/web-tools/src/browser/actions/{types,index,select_page,dialog,download_release,screenshot,upload,wait,navigate,scroll,locator,cdp}.ts`
      - `packages/web-tools/src/browser/__tests__/browser.test.ts` (unknown-kind regression)
    - References: review §2.3 item 3; browser suite 79 pass (browser/cdp/policy/eval/observe/checkpoint).
  - Test Cases to Write:
    - Unknown action kind → same typed error as before (explicit regression test).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Dedupe proven-identical persistence codecs (SQLite/PostgreSQL)
  - Acceptance Criteria:
    - Functional: only pure encode/decode/validation helpers proven byte-identical between `sessions` sqlite/postgres paths are shared; transaction/dialect code stays separate.
    - Performance: no per-row allocation regressions (persistence benchmarks non-regressed).
    - Code Quality: shared code lives in one `codec` module with property tests proving round-trip parity on both paths.
    - Security: no SQL constructed differently than before (dialect boundaries untouched).
  - Approach:
    - Documentation Reviewed:
      - Review §2.6: files ~1,035/1,050 lines, dialects differ legitimately.
      - Existing `sessions/codecs/` from plan 025 (row mappers already shared).
    - Options Considered:
      - Generic DB abstraction layer (rejected — review explicitly warns).
      - Extract only provably identical pure helpers (chosen).
    - Chosen Approach: row mappers already live in `sessions/codecs/` via `createSessionRowMappers` (sqlite `0|1` vs postgres `boolean` redacted). Remaining identical validation (`assertLeaseInput`, `assertCheckpointInput`, `assertLifecycleOwnership`) moved there. Left dialect-divergent: `rowToHold` (jsonb object vs TEXT JSON), lease/checkpoint `toRecord` (Date vs string), SQL/`queryTable`.
    - API Notes and Examples:
      ```ts
      const sqlite = createSessionRowMappers<number>({ encode: (r) => (r ? 1 : 0), decode: (r) => r === 1 });
      const postgres = createSessionRowMappers<boolean>({ encode: (r) => r, decode: (r) => r });
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/sessions/codecs/{lease,checkpoint,lifecycle,index}.ts`
      - `packages/prism-core/src/sessions/{sqlite,postgres}/{leases,checkpoints,lifecycle}.ts`
      - `packages/prism-core/src/sessions/codecs/__tests__/parity.test.ts`
    - References: review §2.6; sqlite persistence + lifecycle + parity 36 pass.
  - Test Cases to Write:
    - Round-trip property test: same fixture corpus through both codecs → identical results.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Verify structure budgets and record evidence
  - Acceptance Criteria:
    - Functional: offline `npm test` + coverage green; no production file >800 lines (checked by a small gate script or recorded `wc -l` evidence); benchmarks non-regressed.
    - Performance: before/after line counts and benchmark numbers recorded.
    - Code Quality: `docs/_evidence/module-decomposition-<date>.md` records each split, line deltas, and the no-new-assertion-edits proof.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed: budget-gate conventions; `scripts/budgets.json` exportCounts (plan 058); review §2.3/§2.6.
    - Options Considered: permanent line-count gate (tempting; defer to plan 058 budgets if wanted) vs one-time evidence (chosen).
    - Chosen Approach: `wc -l` + graft skeleton spans recorded in evidence; `graft build` refresh; plan 058 export ceilings rebaselined for internal split-module `export`s (public barrels unchanged). Regenerated stale phase54 package-map so the script stage matches the generator.
    - API Notes and Examples:
      ```sh
      # production files over 800 (exclude tests/dist)
      python3 -c '...'  # see evidence §4
      graft build
      ```
    - Files to Create/Edit:
      - `docs/_evidence/module-decomposition-2026-09-03.md`
      - `scripts/budgets.json` exportCounts for prism / coding-tools / prism-core / web-tools
      - `docs/_evidence/phase54-package-map.md` (generator refresh)
    - References: review §2.3; evidence file.
  - Test Cases to Write: n/a (verification).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (barrels unchanged; export-count is src-walk).
    - Docs pages to create/edit: evidence file.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Whole-repo "no production file >800" not met: 13 files remain (largest postgres persistence 1050). Plan targets all <800. Persistence dialects left split per review §2.6.
- `startSession` is 254 lines (4 over the 250-line expected outcome). `createBrowserManager` is still a 547-line factory; nested functions are all ≤88.
- Plan 058 export-count gate counts every src `export`, so splits grew ceilings (+23/+28/+71/+24). Rebaselined with reasons; public barrels unchanged.
- No permanent line-count CI gate (one-time evidence, as planned).
- Dist coverage attributes `tool-round.js` at 55.39% lines; overall core 91.69 still well above the 60/70/75 gate.

## Further Actions

- Split remaining >800-line files only when a later review names them; persistence sqlite/postgres stay dialect-local. Priority: low.
- Trim `startSession` under 250 if another process-session change lands there. Priority: low.
- Optionally count plan 058 export budget against package.json public graph instead of every src `export`, so internal splits stop forcing rebaselines. Priority: medium, plan 058 follow-up.
