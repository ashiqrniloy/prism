# 067 — Run Limits: HARD (process safety) vs host policy

Request: `prism-run-limits-hard-vs-host-policy.md` (Clay / `@arnilo/prism` 0.5.3).
Target: **0.5.4** lockstep-compatible core change (no new package).
Baseline: `src/run-limits.ts`, `src/contracts-core/run-limits.ts`, `docs/runs-and-usage.md`.

## Objectives

- Keep `DEFAULT_RUN_LIMITS` as the unconfigured `createAgent()` fence (OWASP LLM10). Do **not** raise defaults to coding-session size.
- Shrink true `HARD_RUN_LIMITS` to **request/response bytes only** (JSON.parse OOM). Delete product HARD on turns, attempts, tool rounds/calls, wall, cumulative tokens, and `HARD_MAX_RUN_COST`.
- Host policy: omitted key → DEFAULT; `null` → no cap on that axis; number → that number (positive safe integer). Byte axes reject `null` and stay ≤ 64 MiB.
- Stop `maxProviderAttempts` from undercutting a raised/disabled `maxTurns` at resolve time (lift, not a retry-budget rewrite).
- Document cumulative token counters vs `contextBudget` (window) vs `maxCost` (recommended production envelope).
- Do **not** ship repeated-tool fingerprint / no-progress (request D) in this plan.

## Expected Outcome

- Coding host can legally set overnight envelopes (`maxWallTimeMs: 4 * 60 * 60_000`, `maxTurns: 200`, `maxInputTokens: 5_000_000`) without `TypeError`.
- `maxTurns: null` (and friends) runs past DEFAULT/old HARD without `RunLimitError` on that axis; wall `null` does not arm `setTimeout`.
- Unconfigured `createAgent()` still stops at 16 turns / 120s / 50k tokens / 8 MiB.
- `RunOptions.limits` still **cannot widen** `AgentConfig.limits` (`null` = +Infinity in `min`).
- Public docs, CHANGELOG, `docs/migrate-to-0.5.md`, and `HARD_*` export contract match the new split.
- `graft build` refreshed for `src/run-limits.ts` and `src/contracts-core/run-limits.ts`.

## Design decisions (vs request)

Industry check (2026-09-08):

- Claude Agent SDK: `maxTurns` / `maxBudgetUsd` default **No limit**; “Without limits, the loop runs until Claude finishes on its own… Setting a budget is a good default for production.” ([agent-loop](https://code.claude.com/docs/en/agent-sdk/agent-loop))
- OpenAI Agents SDK: `max_turns=None` **disables** the cap. ([running_agents](https://openai.github.io/openai-agents-python/running_agents/))
- Vercel AI SDK: `ToolLoopAgent` default `isStepCount(20)` (not `stepCountIs`); `isLoopFinished()` removes the cap; docs warn unbounded cost. ([loop-control](https://ai-sdk.dev/docs/agents/loop-control))

Chosen alternatives where the request is wrong or underspecified:

| Request | Decision |
|---|---|
| Treat `maxProviderAttempts` as a separate retry-budget counter | **No.** Keep charge-per-generate. Resolve-time lift so attempts cannot undercut turns. |
| Optionally raise byte HARD to 256 MiB | **No.** Keep 64 MiB. Multimodal belongs in media refs, not giant JSON frames. |
| Keep `$10k` as a sanity fence | **No.** Drop `HARD_MAX_RUN_COST`. `maxCost` stays optional; amount is finite ≥ 0. |
| Last-resort 1e6 turns if host disables everything | **No.** `null` is explicit; `AbortSignal` remains. |
| `null` merge vs agent ceiling | Request omitted this. **Keep narrowing-only:** `null` is +Infinity in `Math.min`. Agent `16` + run `null` → `16`. |
| Fail-closed when vendor omits usage | **No for default token caps.** Defaults are always finite; Ollama/local would die every turn. Missing usage still charges **0** on token axes. `maxCost` already fail-closes. Document the hole. |
| Fingerprint / no-progress (D) | Out of scope (agree). |
| Semver | **0.5.4 minor** in 0.x. Shrinking `HARD_RUN_LIMITS` and removing `HARD_MAX_RUN_COST` is a documented export-shape break. |

## Tasks

- [x] Task 1 — Primitive inventory (no new limit system) — **complete (2026-09-08)**
  - Acceptance Criteria:
    - Functional: list every consumer of `resolveRunLimits` / `RunLimitTracker` / `HARD_RUN_LIMITS` / `HARD_MAX_RUN_COST` / `LoopContext.maxToolRounds` / durable `deadlineAt`. Confirm this change is a contract+tracker edit, not a new package or parallel cap system.
    - Performance: inventory-only; no runtime change.
    - Code Quality: no speculative “limit policy engine”; reuse `RunLimitTracker`.
    - Security: bytes remain the only process-integrity cap; LLM10 stays on DEFAULT, not HARD.
  - Approach:
    - Documentation Reviewed:
      - Request `prism-run-limits-hard-vs-host-policy.md`
      - `src/run-limits.ts`, `src/contracts-core/run-limits.ts`, `src/agent-run-state.ts`, `src/agent-loops.ts`, `src/agent-session/session/assemble.ts`, `src/secure-agent.ts`
      - Supervisor map: `packages/prism-core/src/runtime/supervisor/supervisor.ts` (`maxSteps`/`maxTokens`/`timeoutMs` → core limits)
      - `docs/runs-and-usage.md` (Run limits), `docs/agent-session-runtime.md`, `.agents/skills/create-plan/references/prism-wiki.md`
      - Claude / OpenAI / Vercel loop-cap pages (see Design decisions)
    - Options Considered:
      - New `RunLimitPolicy` type + plugin predicates: rejected — YAGNI; request is raise-or-disable.
      - Raise HARD 10× (fallback table): rejected — next host still TypeErrors.
      - Reuse existing tracker + `null`: chosen.
    - Findings (inventory result):
      - **Confirmed: contract + tracker edit, no new package, no parallel cap system.** Everything routes through `resolveRunLimits` → `RunLimitTracker`.
      - `resolveRunLimits` production in-edges (5): `src/secure-agent.ts:26` (host-limit validation), `src/agent-session/session/assemble.ts:147` (maxToolRounds for RoundContext), `assemble.ts:313` (tracker limits), `src/run-limits.ts:212` (`createRunLimitTracker`), `src/index.ts:539` (export).
      - `RunLimitTracker` construction (2): `assemble.ts:369` (session runs, with `onExceeded` → `run_limit_exceeded` + abort), `createRunLimitTracker` → `packages/mcp/src/server.ts:94`. Type-only imports: `session/types.ts`, `session/persist.ts`, `session.ts`, `tools.ts` — no behavior coupling.
      - `HARD_RUN_LIMITS` / `HARD_MAX_RUN_COST`: consumed **only** inside `validateLimits` (`src/run-limits.ts:99-106`) as the cap+message in `TypeError`. Exported at `index.ts:535-536`; asserted in `public-export-contract.test.ts:97-98`. Shrink/removal is therefore local to run-limits.ts + exports + that test.
      - `LoopContext.maxToolRounds` (`number`) is read at exactly 4 sites: `src/agent-loops.ts:61,63` (default loop), `:165,196` (validate-revise loop). Fed from `assemble.ts:147` via `RoundContext.maxToolRounds` (`session/types.ts:124`, currently `number | undefined`). **One** `?? Number.POSITIVE_INFINITY` mapping point (assemble.ts:147) covers all loops.
      - `deadlineAt` chain: tracker `RunLimitTrackerOptions.deadlineAt?` (`run-limits.ts:59`) → tracker field (`:114`, `Date.parse` or `now + maxWallTimeMs`) → checkpoint `persist.ts:79` → restore `assemble.ts:375` → required in `agent-run-state.ts:52,226,251` + parse validation `:269`. Optionalizing touches exactly these 4 files. `prism-coding-tools` `deadlineAt` is an unrelated package-local epoch-ms mechanism — do not touch.
      - Supervisor (`supervisor.ts:249`) and MCP server pass limits through `session.run`/`createRunLimitTracker` → inherit `null` support for free. Workflow `validateWorkflowLimits` (`prism-core/runtime/workflows/limits.ts`) is a separate `WorkflowLimits` type — out of scope, confirmed no coupling.
      - `activeLimitOutputBuffer` (assemble.ts:384-388) checks `!== undefined` on `maxOutputTokens`/`maxTotalTokens`/`maxCost` — must become finite-only check (Task 4).
    - API Notes and Examples:
      ```ts
      // consumers that must keep working after null/HARD shrink
      resolveRunLimits(agent.limits, run.limits);
      new RunLimitTracker(resolved, { snapshot, deadlineAt });
      createSecureAgent({ limits }); // still requires explicit limits object
      ```
    - Files to Create/Edit:
      - none (inventory). Tentative implementation set recorded for Tasks 2–4.
    - References:
      - graft `src/run-limits.ts`, `src/contracts-core/run-limits.ts`
      - `src/__tests__/run-limits.test.ts`, `src/__tests__/public-export-contract.test.ts`
  - Test Cases to Write:
    - none (inventory).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (inventory).
    - Docs pages to create/edit: none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] Task 2 — Types, validateLimits, resolveRunLimits — **complete (2026-09-08)**
  - Acceptance Criteria:
    - Functional:
      - `RunLimits` policy axes accept `number | null`; byte axes stay `number` (no `null`).
      - omitted → DEFAULT; `null` → stored no-cap; number → positive safe integer; `Infinity` / `0` / negative / non-integer TypeError.
      - bytes: `1 ≤ n ≤ 64 MiB` else TypeError; `null` TypeError.
      - `maxCost.amount`: finite ≥ 0, no `$10k` ceiling; currency non-empty.
      - resolve fill DEFAULT then apply agent then run with **narrowing-only**; `null` is +Infinity for `min`.
      - Attempts coupling after resolve (finite caps only): if attempts omitted and turns is `null`, attempts becomes `null`; if attempts omitted and turns is a number, attempts = `max(DEFAULT.maxProviderAttempts, turns)`; if both finite and attempts < turns, lift attempts to turns. Explicit `attempts: 24` + `turns: null` stays 24.
      - `HARD_RUN_LIMITS` object is bytes-only. `HARD_MAX_RUN_COST` removed from public exports.
      - `resolveRunLimits` return type is `ResolvedRunLimits` (policy axes `number | null`).
    - Performance: resolve stays O(axes); no extra allocations beyond one frozen object.
    - Code Quality: one merge helper; no per-axis copy-paste validators beyond a small table.
    - Security: cannot disable byte caps; cannot widen agent ceilings from run options.
  - Approach:
    - Documentation Reviewed:
      - `src/run-limits.ts` `validateLimits` / `resolveRunLimits` / `DEFAULT_RUN_LIMITS` / `HARD_RUN_LIMITS`
      - `src/contracts-core/run-limits.ts` `RunLimits`
      - `docs/runs-and-usage.md` narrowing-only sentence
    - Options Considered:
      - `Infinity` as disable: rejected — JSON-RPC cannot serialize Infinity; request prefers `null`.
      - Keep old HARD keys as non-binding numbers: rejected — lying public object.
      - Rewrite attempts as extra retries: rejected — changes `charge("maxProviderAttempts")` meaning for every loop.
    - Chosen Approach:
      - `null` disable. Bytes-only HARD. Resolve-time attempts lift. Export `ResolvedRunLimits`.
    - API Notes and Examples:
      ```ts
      export interface RunLimits {
        readonly maxTurns?: number | null;
        readonly maxProviderAttempts?: number | null;
        readonly maxToolRounds?: number | null;
        readonly maxToolCalls?: number | null;
        readonly maxWallTimeMs?: number | null;
        readonly maxRequestBytes?: number;
        readonly maxResponseBytes?: number;
        readonly maxInputTokens?: number | null;
        readonly maxOutputTokens?: number | null;
        readonly maxTotalTokens?: number | null;
        readonly maxCost?: { readonly amount: number; readonly currency: string };
      }

      resolveRunLimits(undefined, { maxTurns: 10_000 }).maxTurns; // 10000
      resolveRunLimits(undefined, { maxTurns: null }).maxTurns; // null
      resolveRunLimits({ maxTurns: 16 }, { maxTurns: null }).maxTurns; // 16 (narrow)
      resolveRunLimits(undefined, { maxTurns: 64 }).maxProviderAttempts; // 64 (lift)
      resolveRunLimits(undefined, { maxRequestBytes: 65 * 1024 * 1024 }); // TypeError
      ```
    - Files to Create/Edit:
      - `src/contracts-core/run-limits.ts`: `RunLimits` nullability; add `ResolvedRunLimits` if kept next to the contract
      - `src/run-limits.ts`: HARD shrink, drop `HARD_MAX_RUN_COST`, validate/resolve/merge/coupling, export `ResolvedRunLimits`
      - `src/index.ts`: stop exporting `HARD_MAX_RUN_COST`; keep `HARD_RUN_LIMITS` (bytes-only)
      - `src/__tests__/public-export-contract.test.ts`: drop `HARD_MAX_RUN_COST`
    - References:
      - request sections A–C, E.1
      - existing narrowing test `resolveRunLimits({ maxTurns: 2 }, { maxTurns: 20 }).maxTurns === 2`
  - Test Cases to Write:
    - omitted keys → current DEFAULT (16/24/8/32/120s/8MiB/40k/10k/50k)
    - `maxTurns: 10_000` does not TypeError
    - `maxTurns: null` does not TypeError; resolved `null`
    - `maxInputTokens: 5_000_000` does not TypeError
    - `maxWallTimeMs: 4 * 60 * 60_000` does not TypeError
    - `maxRequestBytes` / `maxResponseBytes` > 64 MiB TypeError; `null` TypeError
    - agent 16 + run `null` → 16; agent omit + run `null` → `null`
    - `maxTurns: 64` omit attempts → attempts 64, not 24
    - `maxTurns: null` omit attempts → attempts `null`
    - explicit `attempts: 24` + `turns: null` → attempts 24
    - `maxCost.amount: 50_000` does not TypeError
    - `Infinity` / `0` / negative TypeError on integer policy axes
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `RunLimits`, `HARD_RUN_LIMITS` shape, `HARD_MAX_RUN_COST` removed, `resolveRunLimits` return type.
    - Docs pages to create/edit: deferred to Task 6 (implementation must land first).
    - `docs/index.md` update: deferred to Task 6.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Completion Notes (2026-09-08):
    - Shipped exactly as specified: `RunLimits` policy axes `number | null`, byte axes `number`; `ResolvedRunLimits` contract in `contracts-core/run-limits.ts` (flows through `export type *` barrels automatically); `HARD_RUN_LIMITS` bytes-only; `HARD_MAX_RUN_COST` deleted from `run-limits.ts` + `index.ts`; validate/resolve rewritten with `minCap` (+ attempts lift).
    - **Bug caught by tests:** first `minCap` returned `null` when either layer was `null`; correct semantics are `null` = +Infinity, so a `null` only survives when it is the only defined layer. Agent `16` + run `null` → `16`.
    - To keep the build green, the null-ripple code from Tasks 3–4 landed with this task (types forced it): tracker null-skip in `charge`/`exceed`, optional wall (no timer, `deadlineAt` undefined when `maxWallTimeMs: null` and no restored deadline; restored durable deadline still wins over disabled wall), `snapshot()` elapsed-only when wall null, `assemble.ts` `maxToolRounds ?? POSITIVE_INFINITY`, finite-only `activeLimitOutputBuffer`, optional `StoredAgentRunState.deadlineAt` (parse accepts missing; old snapshots still parse), export-contract list updated (+`ResolvedRunLimits`, −`HARD_MAX_RUN_COST`).
    - Tests: 7 new cases in `src/__tests__/run-limits.test.ts` (raise/null/large envelopes, byte HARD rejection, null-as-Infinity narrowing, attempts lift ×4, Infinity/0/negative rejection, null-cap charging + finite token cap, missing-usage cost-vs-tokens). 411 tests pass across run-limits/agents/run-state/run-lifecycle/agent-loops/export-contract/cost-catalog/secure-agent; `docs.test.js` 150 pass (docs text lands in Task 6).

- [x] Task 3 — RunLimitTracker: skip null axes, wall timer, usage charging — **complete (2026-09-08)**
  - Acceptance Criteria:
    - Functional:
      - `charge(limit)` increments counters always; `exceed` only when cap is a finite number and `observed > cap`.
      - `recordUsage(undefined)`: if `maxCost` set → fail-closed (unchanged); token axes **not** charged (unchanged — do not fail-close default token caps).
      - `recordUsage` with a number cap still throws `RunLimitError` when cumulative billed tokens exceed **that** cap (e.g. 5_000_000).
      - `maxWallTimeMs: null`: do not arm `setTimeout`; `deadlineAt` is `undefined`.
      - Finite wall: same timer + `deadlineAt` ISO behavior as today, including durable restore.
      - `setTimeout` never called with a non-finite or > 2^31-1 delay.
    - Performance: one timer or none; no polling.
    - Code Quality: `ResolvedRunLimits` on `tracker.limits`; no `as number` casts on null caps.
    - Security: byte charges still HARD-capped via resolved numbers; cost fail-closed when configured.
  - Approach:
    - Documentation Reviewed:
      - `RunLimitTracker` constructor / `charge` / `recordUsage` / `exceed` (`src/run-limits.ts:111-209`)
      - Node `setTimeout` delay overflow (~24.8 days) — reason wall `null` must not arm a huge timer
    - Options Considered:
      - Sentinel far-future deadline: rejected — `setTimeout` overflow.
      - Fail-closed on missing usage when any token cap is finite: rejected — DEFAULT token caps would kill usage-less providers.
    - Chosen Approach:
      - Skip `exceed` when cap is `null`. Wall `null` → no timer, optional `deadlineAt`.
    - API Notes and Examples:
      ```ts
      const t = new RunLimitTracker(resolveRunLimits(undefined, { maxTurns: null, maxWallTimeMs: null }));
      for (let i = 0; i < 100; i++) t.charge("maxTurns"); // no throw
      t.recordUsage({ inputTokens: 5_000_001 }); // no throw if maxInputTokens null/default not exceeded
      t.dispose();
      ```
    - Files to Create/Edit:
      - `src/run-limits.ts`: tracker
      - `src/__tests__/run-limits.test.ts`: skip/null/wall/cumulative cases
    - References:
      - request C, tests list, E.3
  - Test Cases to Write:
    - 100 `charge("maxTurns")` with `maxTurns: null` → no `RunLimitError`
    - `maxInputTokens: 5_000_000` then charge 5_000_001 via `recordUsage` → `RunLimitError`
    - `maxWallTimeMs: null` → `deadlineAt` undefined; fake-timer advance does not exceed
    - existing DEFAULT-sized `RunLimitError` tests still pass
    - missing usage + `maxCost` still fail-closed; missing usage without `maxCost` does not throw
    - mixed-currency cost still fail-closed
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — tracker skip semantics, optional `deadlineAt`.
    - Docs pages to create/edit: deferred to Task 6.
    - `docs/index.md` update: no (same page as Task 6).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Completion Notes (2026-09-08):
    - Tracker skip/optional-wall code landed with Task 2 (types forced it); this task verified it and closed the remaining gap: **restored `deadlineAt` > 24.8 days out** hit Node's `setTimeout` clamp (>2^31-1 → 1ms) and would breach spuriously. Timer now arms capped and re-checks the real clock before exceeding (`src/run-limits.ts` constructor `arm()`).
    - Tests added: finite wall arms `deadlineAt` + breaches via timer without throwing (`onExceeded` once, limit `maxWallTimeMs`); restored past deadline + `maxWallTimeMs: null` breaches immediately (never drop an existing wall); restored future deadline 25 days out keeps `deadlineAt` and does not breach; cumulative `recordUsage` breaches a finite `maxTotalTokens: 5_000_000` on the sum across rounds (with per-axis `null` so only total is capped).
    - Already covered from Task 2: 100 charges on `maxTurns: null` no throw, `maxWallTimeMs: null` → `deadlineAt` undefined, finite 5M token cap enforced, missing usage fail-closed only with `maxCost`, mixed-currency fail-closed, DEFAULT-sized breaches (existing).
    - 414 tests pass across run-limits/agents/run-state/run-lifecycle/agent-loops/export-contract/cost-catalog/secure-agent.

- [x] Task 4 — Call sites: loops, output buffer, durable resume, secure agent — **complete (2026-09-08)**
  - Acceptance Criteria:
    - Functional:
      - `LoopContext.maxToolRounds` stays `number`. Assemble maps resolved `null` → `Number.POSITIVE_INFINITY` so `toolRounds >= cap` never trips on `null` (`n >= null` is `true` in JS because `null` coerces to 0).
      - `charge("maxToolRounds")` still the fail-closed counter; loop finishReason `turn_limit` only when cap is finite.
      - Output buffering (`activeLimitOutputBuffer`) true only when host set a **finite** `maxOutputTokens` / `maxTotalTokens` / `maxCost` — `null` must not buffer.
      - Durable `deadlineAt` optional: omit when wall unbounded; `parseAgentRunState` accepts missing `deadlineAt` (old snapshots with a string still parse). No schemaVersion bump.
      - `createSecureAgent` still requires a non-empty `limits` object; `null` values inside are valid explicit policy.
      - Supervisor mapping (`maxToolRounds`/`maxTotalTokens`/`maxWallTimeMs`) unchanged; supervisor HARD is out of scope.
    - Performance: no extra copies on the generate path.
    - Code Quality: one map helper if needed (`capOrInf`); no `LoopContext` widening unless a test proves Infinity is insufficient.
    - Security: durable resume cannot drop an existing wall deadline; new unbounded runs simply omit it.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-loops.ts` (`toolRounds >= ctx.maxToolRounds`)
      - `src/contracts-core/loop.ts` `LoopContext.maxToolRounds: number`
      - `src/agent-session/session/assemble.ts` (`activeLimitOutputBuffer`, tracker construction)
      - `src/agent-run-state.ts` `parseAgentRunState` requires `deadlineAt`
      - `src/secure-agent.ts`
    - Options Considered:
      - Widen `LoopContext.maxToolRounds` to `number | null`: extra churn in every loop strategy; rejected unless Infinity mapping fails a test.
      - Bump `AGENT_RUN_STATE_SCHEMA_VERSION`: unnecessary for additive optional field.
    - Chosen Approach:
      - Infinity at loop boundary; optional `deadlineAt`; finite-only output buffer.
    - API Notes and Examples:
      ```ts
      const maxToolRounds = resolved.maxToolRounds ?? Number.POSITIVE_INFINITY;
      session.activeLimitOutputBuffer = [agentLimits, runLimits].some(
        (value) =>
          isFiniteCap(value?.maxOutputTokens) ||
          isFiniteCap(value?.maxTotalTokens) ||
          value?.maxCost !== undefined,
      );
      ```
    - Files to Create/Edit:
      - `src/agent-session/session/assemble.ts`
      - `src/agent-session/session/types.ts` (if RoundContext needs Infinity vs null)
      - `src/agent-run-state.ts`, `src/agent-session/session/persist.ts`
      - `src/secure-agent.ts` (only if validation rejects null today)
      - tests: `src/__tests__/agent-loops.test.ts`, `src/__tests__/agent-run-state.test.ts`, `src/__tests__/agent-run-lifecycle.test.ts` as needed
    - References:
      - request C wall timer; durable note in `docs/runs-and-usage.md`
  - Test Cases to Write:
    - `maxToolRounds: null` artifact/default loop does not stop at 8 rounds (mock provider, 9 tool rounds)
    - `maxOutputTokens: null` does not buffer/withhold deltas (contrast existing “withhold configured-token-budget output” test)
    - persist/resume with omitted `deadlineAt` succeeds; old snapshot with `deadlineAt` still parses
    - secure agent with `{ maxTurns: null, maxRequestBytes: 1024 }` constructs
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — durable `deadlineAt` optional; loop ceiling Infinity mapping is internal.
    - Docs pages to create/edit: `docs/runs-and-usage.md` durable paragraph (Task 6).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Completion Notes (2026-09-08):
    - Call-site code landed with Task 2 (build forced it): `assemble.ts` maps resolved `maxToolRounds: null` → `Number.POSITIVE_INFINITY` (one point, covers both loops); `activeLimitOutputBuffer` now finite-only (`null` never buffers); `StoredAgentRunState.deadlineAt` optional without schemaVersion bump; `createSecureAgent` unchanged (empty limits still rejected, `null` values inside valid). Supervisor/MCP flow through `session.run`/tracker — no edits needed.
    - Tests added (4): default loop runs 9 tool rounds with `maxToolRounds: null` (one past the legacy default of 8, 10 provider turns, 9 tool executions); two-turn loop with `maxTurns: null` + `maxOutputTokens: null` succeeds with visible deltas and zero `run_limit_exceeded` (contrast to the withholding test above it); durable suspend/resume with `maxWallTimeMs: null` persists state **without** `deadlineAt` and resumes to `agent_finished`, plus parse accepts `deadlineAt: undefined` while old snapshots still parse; secure agent constructs with `{ maxTurns: null, maxRequestBytes: 1024 }` and runs. One test-side fix: secure runs reject per-run `redactor` (existing fail-closed guard) — run without it.
    - 418 tests pass across the 8 suites; `docs.test.js` 150 pass.

- [x] Task 5 — Conformance tests (DEFAULT, null, raise, bytes, attempts, existing breaches) — **complete (2026-09-08)**
  - Acceptance Criteria:
    - Functional: all bullets in the request Tests section plus Task 2–4 cases live in `src/__tests__/run-limits.test.ts` (and loop/durable files). `src/__tests__/docs.test.ts` still finds the plan in `plans/README.md`.
    - Performance: tests are network-free; no fake 100-turn provider sleep.
    - Code Quality: table-driven validate/resolve cases; no new test framework.
    - Security: byte TypeError and cost fail-closed cases stay.
  - Approach:
    - Documentation Reviewed: request Tests; existing `src/__tests__/run-limits.test.ts`.
    - Options Considered: 100-turn live loop for `maxTurns: null` — too slow; charge 100 times on the tracker instead, plus one loop test with a mock that yields many tool rounds.
    - Chosen Approach:
      - Tracker unit tests for caps; one agent-loop integration for `maxToolRounds: null`.
    - API Notes and Examples:
      ```ts
      assert.doesNotThrow(() => resolveRunLimits(undefined, { maxTurns: 10_000 }));
      assert.equal(resolveRunLimits(undefined, { maxTurns: 64 }).maxProviderAttempts, 64);
      ```
    - Files to Create/Edit:
      - `src/__tests__/run-limits.test.ts` (primary)
      - `src/__tests__/agent-loops.test.ts` / `src/__tests__/agent-run-state.test.ts` as needed
      - `src/__tests__/public-export-contract.test.ts`
    - References:
      - request Tests (minimum)
  - Test Cases to Write:
    - (union of Task 2–4 lists; do not duplicate if already added — this task is the gate that they all pass under `node --test src/__tests__/run-limits.test.ts` plus touched suites)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (tests).
    - Docs pages to create/edit: none
    - `docs/index.md` update: no
    - Documentation structure reference: n/a
  - Completion Notes (2026-09-08):
    - Gate satisfied by the union of Tasks 2–4 tests; two additions closed the last gaps: a DEFAULT-fence conformance test asserting `resolveRunLimits(undefined, undefined)` equals exactly 16/24/8/32/120s/8MiB/8MiB/40k/10k/50k with no `maxCost` and `HARD_RUN_LIMITS` is exactly the two 64 MiB byte caps; and a counter-snapshot assert (100 null-cap charges still accumulate `turns: 100` for durable resume).
    - Full conformance matrix verified network-free: DEFAULT unchanged, `null` disables, raise (10k turns / 5M tokens / 4h wall), bytes HARD (oversized + `null` TypeError), attempts lift (4 cases), narrowing `null`=+Infinity, wall timer arm/breach + restored-deadline semantics (past immediate, 25-day clamp regression), cumulative token breach, missing-usage (cost fail-closed vs token caps not), mixed-currency fail-closed, existing breaches (UTF-8 response bytes, withhold-output) plus loop/durable/secure integration.
    - 630 tests pass, 0 fail across 13 suites (run-limits, agents, agent-run-state, agent-run-lifecycle, agent-loops, agent-definitions, secure-agent, public-export-contract, cost-catalog, docs, install-smoke, run-ledger, skill-load). `docs.test.js` confirms `plans/README.md` lists this plan.

- [x] Task 6 — Docs, changelog, migration, graft — **complete (2026-09-08)**
  - Acceptance Criteria:
    - Functional:
      - `docs/runs-and-usage.md` Run limits section: DEFAULT table, bytes-only HARD, `null` disable, narrowing-only + null=+Infinity, attempts lift, cumulative tokens ≠ context window, `maxCost` recommended for production, missing vendor usage does not charge token counters.
      - `docs/agent-session-runtime.md` one-line pointer stays accurate.
      - `docs/migration.md` / `docs/migrate-to-0.5.md`: 0.5.3 → 0.5.4 note (HARD shrink, `null`, `HARD_MAX_RUN_COST` removed).
      - `docs/index.md` Runs-and-usage blurb mentions host-raisable run limits / `null`.
      - CHANGELOG Unreleased/0.5.4 Changed + Removed.
      - Historical `docs/migration.md` 0.1.5 sentence that cites “hard cap 64” left as historical or footnoted — do not rewrite the past release as if HARD never existed.
      - `graft build` after code+docs.
      - API page sections follow prism-wiki.md (What it does / When / Inputs / example / security).
    - Performance: docs-only.
    - Code Quality: no leftover “16/64” product-HARD language on the live Run limits page.
    - Security: LLM10 / DEFAULT warning explicit; unbounded wall requires AbortSignal.
  - Approach:
    - Documentation Reviewed:
      - `docs/runs-and-usage.md` L56–66
      - `docs/index.md` Agent/session runtime group
      - `docs/migrate-to-0.5.md` status line
      - `.agents/skills/create-plan/references/prism-wiki.md`
    - Options Considered: new `docs/run-limits.md` page — rejected; keep on runs-and-usage (existing home).
    - Chosen Approach:
      - Rewrite the Run limits subsection in place; additive 0.5.4 migration note.
    - API Notes and Examples:
      ```ts
      await session.run(input, {
        limits: {
          maxTurns: 200,
          maxWallTimeMs: 4 * 60 * 60_000,
          maxInputTokens: 5_000_000,
          maxRequestBytes: 8 * 1024 * 1024, // still HARD-capped at 64 MiB
        },
        signal: hostAbort,
      });
      // disable one axis
      await session.run(input, { limits: { maxTurns: null }, signal: hostAbort });
      ```
    - Files to Create/Edit:
      - `docs/runs-and-usage.md`
      - `docs/agent-session-runtime.md`
      - `docs/index.md`
      - `docs/migrate-to-0.5.md`
      - `docs/migration.md` (0.5.4 note only)
      - `CHANGELOG.md`
      - `graft/` via `graft build`
    - References:
      - prism-wiki.md API page structure (extend existing Run limits section rather than a new page)
  - Test Cases to Write:
    - `src/__tests__/docs.test.ts` already requires plan listing; update any frozen phrase asserts that quote “16/64” on the live page if present.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documented contract change.
    - Docs pages to create/edit:
      - `docs/runs-and-usage.md`: Run limits contract rewrite
      - `docs/agent-session-runtime.md`: limits sentence
      - `docs/migrate-to-0.5.md`: 0.5.4 section
      - `docs/migration.md`: pointer
      - `CHANGELOG.md`
    - `docs/index.md` update: yes — Agent/session runtime → Runs and usage ledger blurb: host-raisable `RunLimits` with `null` disable; bytes remain process HARD.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Completion Notes (2026-09-08):
    - Docs: `runs-and-usage.md` Run-limits paragraph rewritten (DEFAULT fence, bytes-only HARD, `null` disable, narrowing-only with `null`=+Infinity, attempts lift, cumulative tokens ≠ context window, `maxCost` recommended envelope, missing-usage hole); `agent-session-runtime.md` limits sentence + `index.md` blurb updated; `migrate-to-0.5.md` gained section 9 + status line; `migration.md` gained the 0.5.3 → 0.5.4 section; historical 0.1.5 "hard cap 64" sentence left untouched (past release).
    - Release surface: `CHANGELOG.md` 0.5.4 (Changed + Removed); lockstep bump `0.5.3` → `0.5.4` across all 10 manifests, internal `^0.5.4` ranges, `package-lock.json` refreshed, `package-truth.json` + generated docs blocks regenerated (`package-truth.mjs --emit-docs`), `src/index.ts` `version` export bumped.
    - Version-literal freeze tests updated to 0.5.4: `docs.test.ts` (5 manifest asserts + index current-line), `packaging.test.ts` (root/peer/provider-family literals), `phase34-freeze.test.mjs`, provider peer tests (clinepass/kimi/opencode-go), coding-tools composition test.
    - `graft build` refreshed (12,896 nodes).
    - Gates green: docs.test 150/150, packaging-current + truth-current 43/43, release-gate + dead-export-verify + import-hygiene 12/12, packaging + install-smoke 75/75, phase34-freeze + provider peers + coding-tools composition 10/10, main 13-suite conformance run green earlier in Task 5 (version-independent).
    - Lesson: the lockstep version lives in ~8 places (manifests, ranges, `src/index.ts` `version`, docs current-line, freeze tests, generated truth). A `scripts/bump-version.mjs` would make the next bump one command — deferred until the next cut demands it (ponytail: fix it when it bites twice).

## Compromises Made

- Attempts coupling is resolve-time lift, not a retry-budget semantic rewrite (smaller, no loop charge() change).
- Byte HARD stays 64 MiB (not 256 MiB).
- `HARD_MAX_RUN_COST` deleted rather than kept as a fake fence.
- No last-resort 1e6 turn cap; `null` is explicit.
- Token counters still blind when the vendor omits usage (DEFAULT caps would otherwise fail-close Ollama). Production hosts should set `maxCost` (already fail-closed) and/or `AbortSignal`.
- `LoopContext.maxToolRounds` stays `number` via `Infinity` mapping.
- Durable `deadlineAt` becomes optional without a schemaVersion bump.
- Supervisor / workflow / CLI-RPC full `limits` object with `null` are out of scope except what already flows through `session.run({ limits })`.

## Further Actions

- Optional repeated-tool fingerprint (request D): host-set N consecutive identical `(toolName, canonicalArgs)` tuples. Priority: later, demand-gated.
- Opt-in fail-closed on missing usage when the host **explicitly** set a token cap (not DEFAULT-filled). Priority: later if Clay hits silent vendors.
- JSON-RPC/CLI: accept `limits: { maxTurns: null }` (today RPC only forwards numeric `maxToolRounds`). Priority: if Clay drives runs over RPC.
- Supervisor `timeoutMs` / `maxTokens` product HARD: separate request if coding delegation hits it.
