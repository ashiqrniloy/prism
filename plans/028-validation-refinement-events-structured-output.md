# Phase 28 — Validation/refinement events and structured-output contracts

## Objectives
- Make `generateValidateReviseLoop` observable through the existing `AgentEvent` stream by adding five `artifact_*` event variants (zero emitted when `singleShotLoop` runs).
- Keep validation-failure-triggering-a-revision out of the `error` channel (recoverable, like `tool_execution_blocked`); only terminal budget exhaustion emits `artifact_failed`; real failures stay on `error`.
- Confirm `redactAgentEvent` walks `ArtifactValidation` payloads (including nested/cyclic `metadata`) without crashing, with a runnable check.
- Lock the structured-output boundary: `ArtifactParser<T>` is the only way to get typed output from a loop; Prism never instantiates `T`; no `WorkflowStep`/`NodeSchema`/`synapta*` vocabulary in `src/`.
- Document the artifact events and the parser/validator/repairer seam with a Synapta-style schema→`ArtifactValidation` mapping example.

## Expected Outcome
- Five `artifact_*` variants added to the `AgentEvent` union in `src/contracts.ts`, re-exported automatically via the existing `export type * from "./contracts.js"`.
- `src/agent-loops.ts` emits the events at the marked Phase-28 stub points; `singleShotLoop` emits zero artifact events.
- Ordering observable: `artifact_validation_started` → `artifact_validation_finished` → (`artifact_revision_started`)* → `artifact_finished` | `artifact_failed`, correlated by `runId`/`turn`/`attempt`.
- New `docs/agent-events.md` page (does not exist yet — roadmap says "updated"; this phase creates it) and new `docs/structured-output.md` page, both linked from `docs/index.md`, with `docs.test.ts` guards.
- `npm run build:core` clean; full suite green; Phase 28 boundary tests pass.

## Tasks

- [x] Task 1 — Primitive review: inventory artifact/event/redaction primitives
  - Acceptance Criteria:
    - Functional: confirm `Artifact*` contracts (Phase 27) are pinned in `src/contracts.ts` and re-exported; confirm the five event names do not yet exist; confirm `redactAgentEvent`→`redactSecrets` has a `WeakSet` cycle guard and leaf passthrough; confirm `singleShotLoop`/`generateValidateReviseLoop`/`resolveLoop`/`isAgentLoopOptions` are exported; confirm the Phase-28 emit stubs in `src/agent-loops.ts` are the only wiring points.
    - Performance: no new module, no new dependency, no per-turn allocation beyond the event objects emitted.
    - Code Quality: the only NEW primitives are five additive `AgentEvent` union members (no new interface, no new runtime module). Document any gap.
    - Security: no secret/credential/provider object reaches the loop or the new events.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 28 (lines 670–695): deliverables and acceptance.
      - `src/contracts.ts:242` `AgentEvent` union; `src/contracts.ts:732` `ArtifactValidation`/`ArtifactContext`; `Artifact*` callback block.
      - `src/agent-loops.ts:130–155` Phase-28 emit stubs in `generateValidateReviseLoop`.
      - `src/redaction.ts:17` `redactAgentEvent` → `redactSecrets` (WeakSet cycle guard at the `redact` inner function).
      - `src/index.ts:48` `redactAgentEvent` re-export; `export type * from "./contracts.js"`.
      - `src/__tests__/phase27-boundaries.test.ts` existing boundary pattern.
    - Options Considered:
      - Introduce a dedicated `ArtifactEvent` type alias vs inline union members. Inline keeps the single `AgentEvent` discriminant surface flat and matches `retry_scheduled`/`tool_execution_*`; chosen. Alias is YAGNI unless reused outside the union.
      - Emit events from inside the validator/repairer callbacks vs from the loop. Loop owns emission so callbacks stay pure and the ordering guarantee is in one place; chosen.
    - Chosen Approach:
      - No new runtime module, no new contract interface. The five events are additive union members. `redactAgentEvent` already delegates to the cycle-safe `redactSecrets`, so no redaction code change is expected (verified by a new test in Task 4). Record any deviation in Compromises.
    - API Notes and Examples:
      ```ts
      // Additive union members (illustrative shape — finalized in Task 2):
      | { readonly type: "artifact_validation_started"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly attempt: number }
      | { readonly type: "artifact_validation_finished"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly attempt: number; readonly result: ArtifactValidation }
      | { readonly type: "artifact_revision_started"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly attempt: number; readonly failure: ArtifactValidation }
      | { readonly type: "artifact_finished"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly attempt: number; readonly result: ArtifactValidation }
      | { readonly type: "artifact_failed"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly attempt: number; readonly result: ArtifactValidation }
      ```
      ```ts
      // redactAgentEvent already routes through the cycle-safe redactSecrets:
      // src/redaction.ts
      export function redactAgentEvent(event: AgentEvent, redactor?: SecretRedactor): AgentEvent {
        return redactor?.redact(event) ?? event; // createSecretRedactor -> redactSecrets (WeakSet cycle guard)
      }
      ```
    - Files to Create/Edit:
      - none (review-only; `src/` unchanged). Update this task's checkbox and record findings in the Outcome section.
    - References:
      - `roadmap.md` Phase 28; `plans/027-generic-agent-loop-strategy.md`; `src/contracts.ts`, `src/agent-loops.ts`, `src/redaction.ts`, `src/index.ts`, `src/__tests__/phase27-boundaries.test.ts`.
  - Outcome (Task 1):
    - `Artifact*` contracts pinned in `src/contracts.ts`: `ArtifactValidation` (line 732), `ArtifactContext` (738), `ArtifactParseResult<T>` (746), `ArtifactParser<T>` (752), `ArtifactValidator<T>`/`ArtifactRepairer<T>` (referenced at 726–728). All generic over host `T`; no `synapta*`.
    - The five `artifact_*` event names do NOT yet exist in `src/contracts.ts` (grep returned 0) — Task 2 is the only place they are introduced.
    - `redactAgentEvent` (`src/redaction.ts:17`) delegates to `createSecretRedactor`→`redactSecrets`, whose inner `redact()` uses a `WeakSet` cycle guard (`seen.has(input)` → `"[Circular]"`), passes through `Date`/`RegExp`/`ArrayBuffer`/typed arrays, and normalizes `Map`/`Set` to JSON shapes. Generic walker already covers arbitrary `ArtifactValidation` nesting + cyclic `metadata`; Task 4 is expected to be a guard-test-only change unless a gap surfaces.
    - `src/index.ts` already re-exports `redactAgentEvent` (line 48), `singleShotLoop`/`generateValidateReviseLoop`/`resolveLoop`/`isAgentLoopOptions` (line 56), and transitively all `contracts.ts` types via `export type * from "./contracts.js"` (line 1) — so the five new union members in Task 2 need NO barrel edit.
    - The only emit wiring points are the four `// Phase 28: emit …` stubs in `src/agent-loops.ts` (lines 133, 136, 138, 154); `singleShotLoop` has no artifact stubs and will emit zero `artifact_*` events.
    - No new runtime module, no new contract interface needed: the only NEW primitive is five additive `AgentEvent` union members (Task 2). All other Phase 28 behavior reuses `ctx.emit` (`agents.ts:246` → `redactAgentEvent`) and the existing `Artifact*`/loop primitives.
    - Verified: no code changes; inventory only.
  - Test Cases to Write:
    - (none — review task; tests are added in Tasks 4–5.)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — five new `AgentEvent` variants (documentation planned in Task 6).
    - Docs pages to create/edit: `docs/agent-events.md` (create, Task 6), `docs/structured-output.md` (create, Task 6).
    - `docs/index.md` update: yes — add both pages under a new "Agent events / structured output" navigation line (Task 6).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Contracts: add five `artifact_*` variants to the `AgentEvent` union
  - Acceptance Criteria:
    - Functional: `AgentEvent` union in `src/contracts.ts` gains exactly five members with the roadmap field shapes: `artifact_validation_started{sessionId,runId,turn,attempt}`, `artifact_validation_finished{…,result:ArtifactValidation}`, `artifact_revision_started{…,failure:ArtifactValidation}`, `artifact_finished{…,result:ArtifactValidation}` (loop ended successfully), `artifact_failed{…,result:ArtifactValidation}` (budget exhausted). `attempt` is 1-indexed per validation attempt (mirrors `retry_scheduled.attempt`), `turn` is the provider turn.
    - Performance: type-only change; no runtime code in this task.
    - Code Quality: fields reuse the existing `ArtifactValidation` type; `ArtifactValidation` already optional-`metadata`; no `workflow`/`node`/`step`/`synapta` field names.
    - Security: no credential/secret fields; `result`/`failure` carry only `ArtifactValidation` (host-supplied `errors[].message` may echo model text — redacted in Task 4).
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 28 acceptance (ordering + `attempt` mirrors `retry_scheduled.attempt`).
      - `src/contracts.ts:242–258` existing union members (e.g. `retry_scheduled {…; attempt; delayMs; error }`).
      - `src/contracts.ts:732` `ArtifactValidation` shape.
    - Options Considered:
      - Shared base interface `ArtifactEventBase {sessionId,runId,turn,attempt}` vs repeating fields per member. Repeating keeps the union structural and JSON-serializable without an extra alias; chosen for parity with `tool_execution_*` members.
      - `failure: ArtifactValidation` vs `result: ArtifactValidation` on `artifact_revision_started`. Roadmap says `failure`; honored literally.
    - Chosen Approach:
      - Append the five members to the `AgentEvent` union after the existing `error` member, using `ArtifactValidation` (already in scope at the bottom of `contracts.ts`). No `ArtifactEvent` alias introduced.
    - API Notes and Examples:
      ```ts
      // appended to the AgentEvent union in src/contracts.ts
      | { readonly type: "artifact_validation_started";  readonly sessionId: string; readonly runId: string; readonly turn: number; readonly attempt: number }
      | { readonly type: "artifact_validation_finished"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly attempt: number; readonly result: ArtifactValidation }
      | { readonly type: "artifact_revision_started"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly attempt: number; readonly failure: ArtifactValidation }
      | { readonly type: "artifact_finished"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly attempt: number; readonly result: ArtifactValidation }
      | { readonly type: "artifact_failed"; readonly sessionId: string; readonly runId: string; readonly turn: number; readonly attempt: number; readonly result: ArtifactValidation };
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: append five members to `AgentEvent` union (after the `error` member near line 258). `ArtifactValidation` is already declared later in the file (TS hoists types), so ordering is fine.
    - References:
      - `src/contracts.ts:242`, `src/contracts.ts:732`; `roadmap.md` Phase 28.
  - Outcome (Task 2):
    - Appended 5 members to `AgentEvent` union in `src/contracts.ts` after the `error` member: `artifact_validation_started{sessionId,runId,turn,attempt}`, `artifact_validation_finished{…,result:ArtifactValidation}`, `artifact_revision_started{…,failure:ArtifactValidation}`, `artifact_finished{…,result:ArtifactValidation}`, `artifact_failed{…,result:ArtifactValidation}`. `turn`/`attempt` are `number`; `result`/`failure` reuse the in-scope `ArtifactValidation` type (TS hoists, declared later at line 732).
    - No `ArtifactEvent` alias introduced (inline members, parity with `retry_scheduled`/`tool_execution_*`). No field names matching `workflow`/`node`/`step`.
    - No barrel edit needed: `src/index.ts` line 1 `export type * from "./contracts.js"` transitively re-exports the new members.
    - Verified: `npm run build:core` clean; full suite 498/498 pass 0 fail.
  - Test Cases to Write:
    - (type-only; compile + existing tests prove no regression. Event-emission tests in Task 4, boundary tests in Task 5.)
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new `AgentEvent` variants (documented Task 6).
    - Docs pages to create/edit: `docs/agent-events.md` (Task 6).
    - `docs/index.md` update: yes (Task 6).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Runtime: emit `artifact_*` events from `generateValidateReviseLoop` at the Phase-28 stub points
  - Acceptance Criteria:
    - Functional: replace each `// Phase 28: emit …` stub in `src/agent-loops.ts` with `ctx.emit(…)` calls producing exactly the ordering `artifact_validation_started` → `artifact_validation_finished` → (`artifact_revision_started`)* → `artifact_finished` (on success) | `artifact_failed` (on budget exhaustion). `attempt` increments 1 per validation attempt and equals the current `turn` in GVR. `singleShotLoop` emits zero `artifact_*` events (no changes to it).
    - Performance: at most 2 events per non-terminal validation turn (`_started`+`_finished`) plus one terminal event; bounded by `maxRevisions+1`. No extra allocation beyond the event objects.
    - Code Quality: emit calls go through the existing `ctx.emit` (already redacted via `redactAgentEvent`); no direct `this.emit`/`broadcaster` access from the loop. Remove the `// Phase 28:` stub comments once wired.
    - Security: `result`/`failure` payloads pass through `redactAgentEvent` (active `SecretRedactor`) before subscribers see them; validation error messages that echo model text are redacted like other payloads.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-loops.ts:100–155` GVR turn loop and the four Phase-28 stub comments.
      - `src/agents.ts:246` `emit()` → `redactAgentEvent(event, this.activeRedactor)` (loop's `ctx.emit` is the bound arrow).
      - `roadmap.md` Phase 28 ordering acceptance.
    - Options Considered:
      - Emit `artifact_revision_finished` after the repair message push. Roadmap lists only `artifact_revision_started`; honoring the spec literally avoids inventing events. Not chosen.
      - Emit `artifact_failed` on parse failure. Roadmap reserves `artifact_failed` for budget exhaustion and the `error` channel for real failures; parse failure (Phase 27 behavior) ends the loop silently. Keep Phase 27 behavior; note in Compromises.
    - Chosen Approach:
      - Per GVR turn, after `message_finished`: emit `artifact_validation_started{attempt=turn}`; run `validator`; emit `artifact_validation_finished{attempt, result}`. If `result.ok` → emit `artifact_finished{attempt, result}` and return. If `!result.ok` and `turn <= max` → emit `artifact_revision_started{attempt, failure=result}`, push repair messages, continue. If `!result.ok` and `turn > max` (budget exhausted) → emit `artifact_failed{attempt, result}` and return. Leave parse-failure path unchanged (silent return).
    - API Notes and Examples:
      ```ts
      // inside generateValidateReviseLoop, after assembling artifactCtx:
      const attempt = turn;
      ctx.emit({ type: "artifact_validation_started", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt });
      const result = await opts.validator(parsed.value, artifactCtx);
      ctx.emit({ type: "artifact_validation_finished", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt, result });
      if (result.ok) {
        ctx.emit({ type: "artifact_finished", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt, result });
        return usage;
      }
      if (turn > max) {
        ctx.emit({ type: "artifact_failed", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt, result });
        return usage;
      }
      ctx.emit({ type: "artifact_revision_started", sessionId: ctx.sessionId, runId: ctx.runId, turn, attempt, failure: result });
      // …push repair messages, continue…
      ```
    - Files to Create/Edit:
      - `src/agent-loops.ts`: replace the four `// Phase 28: emit …` stubs (lines ~133, ~136, ~138, ~154) with the emit calls above; remove stub comments.
    - References:
      - `src/agent-loops.ts`; `src/agents.ts:246`; `roadmap.md` Phase 28.
  - Outcome (Task 3):
    - Replaced the four Phase-28 stub comments in `generateValidateReviseLoop` with `ctx.emit(…)` calls. New flow after `message_finished`/parse built the `artifactCtx`: emit `artifact_validation_started{attempt=turn}` → run `validator` → emit `artifact_validation_finished{attempt,result}`. If `result.ok` → emit `artifact_finished` and return. If `!result.ok && turn>max` → emit `artifact_failed` and return. Else → emit `artifact_revision_started{attempt,failure=result}`, then push repair messages and continue. Removed the parse-failure `if (parsed.ok && parsed.value! == undefined) { … } else return` block; replaced with an early `if (!parsed.ok || parsed.value === undefined) return usage;` guard before the validation events (parse failure ends the loop silently — Phase 27 behavior preserved, no artifact events emitted on parse failure, terminal parse errors stay on `error`).
    - Removed all four `// Phase 28: emit …` stub comments; only two descriptive header comments mentioning "Phase 28" remain (lines 32, 87) in `// ponytail:`/doc context, not stubs.
    - Ordering matches roadmap: `validation_started → validation_finished → (revision_started)* → artifact_finished | artifact_failed`, correlated by `runId`/`turn`/`attempt` (attempt = per-validation-turn, 1-indexed). `singleShotLoop` unchanged — emits zero `artifact_*` events.
    - All emits go through the existing `ctx.emit` arrow (bound to `RuntimeAgentSession.emit` → `redactAgentEvent(event, this.activeRedactor)` at `agents.ts:247`), so `result`/`failure` payloads are redacted before subscribers observe them; no direct broadcaster access from the loop.
    - Verified: `npm run build:core` clean; full suite 498/498 pass 0 fail (13/13 agent-loops tests still green, confirming the budget-exhaustion, message_finished parity, and end-to-end GVR behaviors hold with the new emits).
  - Test Cases to Write:
    - Successful GVR run emits exactly `validation_started → validation_finished → artifact_finished` (no `revision_started`, no `artifact_failed`).
    - One-revision-then-success run emits `validation_started → validation_finished → revision_started → validation_started → validation_finished → artifact_finished`.
    - Budget-exhausted run (always-failing validator, `maxRevisions=2`) emits `artifact_failed` once as the last event; total `validation_started` count = `maxRevisions+1`.
    - `singleShotLoop` end-to-end run emits zero `artifact_*` events.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new observable events (documented Task 6).
    - Docs pages to create/edit: `docs/agent-events.md` (Task 6), `docs/agent-loops.md` (update: replace "Phase 28 will add" wording with "emits"; Task 6).
    - `docs/index.md` update: yes (Task 6).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — Redaction: verify `redactAgentEvent` handles `ArtifactValidation` payloads (nested/cyclic metadata) without crashing
  - Acceptance Criteria:
    - Functional: a `redactAgentEvent` call over each of the five `artifact_*` events redacts known secret strings inside `result`/`failure` (including `errors[].message` and nested `metadata`) and does not crash on cyclic `metadata`. The existing `createSecretRedactor` WeakSet cycle guard is the mechanism; this task adds a runnable check, not new redaction code, unless a gap is found.
    - Performance: single pass; cycle guard prevents infinite recursion; no new dependency.
    - Code Quality: if a gap is found (e.g. a non-JSON-shaped value type not handled by `redactSecrets`), fix it in `src/redaction.ts` with a `ponytail:` comment naming the upgrade path; otherwise change nothing.
    - Security: secrets in `errors[].message`/`metadata` MUST be redacted before subscribers observe them.
  - Approach:
    - Documentation Reviewed:
      - `src/redaction.ts` (full file): `redactSecrets` cycles via `WeakSet`, passes through `Date`/`RegExp`/`ArrayBuffer`/typed arrays, normalizes `Map`/`Set` to plain JSON shapes, returns `"[Circular]"` on recursion.
      - `src/agents.ts:247` `redactAgentEvent(event, this.activeRedactor)`.
    - Options Considered:
      - Special-case redaction for `ArtifactValidation` vs rely on the generic walker. Generic walker already covers arbitrary nesting and cycles; chosen. A special case would duplicate logic.
    - Chosen Approach:
      - Add a `redactArtifactEventPayloads` self-check (assert-based `demo()`/`test_*`) in `src/__tests__/agent-loops.test.ts` (or a dedicated `redaction-artifacts.test.ts`): construct each of the five events with a `result`/`failure` whose `errors[].message` and `metadata` (including nested objects/arrays and a cyclic reference) contain a known secret; assert the secret becomes `[REDACTED]`, the cyclic field becomes `"[Circular]"`, and no throw. No `src/` change unless the test fails.
    - API Notes and Examples:
      ```ts
      const secret = "SUPERSECRET-api-key";
      const redactor = createSecretRedactor([secret]);
      const cyclic: Record<string, unknown> = { leak: secret };
      cyclic.self = cyclic;
      const event = { type: "artifact_failed", sessionId: "s", runId: "r", turn: 1, attempt: 1,
        result: { ok: false, errors: [{ message: `echo ${secret}` }], metadata: { nested: { leak: secret }, cyclic } } } as const;
      const out = redactAgentEvent(event, redactor);
      assert.equal(JSON.stringify(out).includes(secret), false);
      assert.equal(JSON.stringify(out).includes("[Circular]"), true);
      ```
    - Files to Create/Edit:
      - `src/__tests__/agent-loops.test.ts`: add the redaction self-check (or create `src/__tests__/redaction-artifacts.test.ts` if cleaner — pick the file with fewer unrelated imports).
      - `src/redaction.ts`: only if a gap is found.
    - References:
      - `src/redaction.ts`; `src/agents.ts:246–247`; `roadmap.md` Phase 28 redaction acceptance.
  - Outcome (Task 4):
    - No `src/` redaction change needed — the generic `redactSecrets` walker (`src/redaction.ts`) already handles arbitrary nesting via the `WeakSet` cycle guard (`seen.has(input)` → `"[Circular]"`), leaf passthrough for `Date`/`RegExp`/`ArrayBuffer`/typed arrays, and `Map`/`Set` normalization. `redactAgentEvent(event, redactor)` delegates to `createSecretRedactor`→`redactSecrets`.
    - Added `redactAgentEvent redacts ArtifactValidation payloads (nested/cyclic metadata) without crashing` guard test to `src/__tests__/agent-loops.test.ts` (chose this file since it already imports `AgentEvent`; avoided a new file). Test constructs all five `artifact_*` event variants with a `result`/`failure: ArtifactValidation` whose `errors[].message` is `echo ${secret}`, `metadata` holds nested objects/arrays of the secret, and a cyclic `metadata.self → metadata` reference; asserts `JSON.stringify(out).includes(secret) === false` for every variant and that the cyclic field becomes `"[Circular]"` with no throw.
    - Added imports `createSecretRedactor`, `redactAgentEvent`, and `type ArtifactValidation` to the test file.
    - Verified: `npm run build:core` clean; full suite 499/499 pass 0 fail (was 498, +1 redaction guard).
  - Test Cases to Write:
    - Each of the five event types redacts a secret in `result`/`failure.errors[].message` and nested `metadata`.
    - Cyclic `metadata` is replaced with `"[Circular]"` and does not throw.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — redaction behavior is already public; this adds a guard test. Docs note `ArtifactValidation` redaction in Task 6.
    - Docs pages to create/edit: `docs/agent-events.md` (Task 6) will note redaction of `errors[].message`/`metadata`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — Boundary tests: phase28 source/contract/domain-vocabulary guards + event ordering tests
  - Acceptance Criteria:
    - Functional: new `src/__tests__/phase28-boundaries.test.ts` asserts (a) `src/` (excluding `__tests__`) imports no `synapta*` and contains no `synapta` token; (b) the `AgentEvent` union block + `Artifact*` contract block in `src/contracts.ts` contains none of `workflow`/`node`/`step` (word-boundary, case-insensitive); (c) `src/index.ts` re-exports all five event type names transitively (via `export type * from "./contracts.js"`) and the barrel still exports `redactAgentEvent`. Mirror the Phase 24/27 boundary test structure.
    - Performance: pure file-scan tests; <100ms each.
    - Code Quality: test extracts the `AgentEvent` union block and the artifact contract block by anchor strings (not whole-file) so unrelated comments cannot trip the scan; document the anchors with `// ponytail:` comments.
    - Security: boundary lock prevents domain types leaking into the structured-output seam.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/phase27-boundaries.test.ts` (file-scan + contract-block extraction pattern).
      - `src/__tests__/phase24-boundaries.test.ts` (synapta import scan + vocabulary scan).
      - `roadmap.md` Phase 28 acceptance ("`src/` imports no `synapta*`; artifact contract field names contain no domain vocabulary").
    - Options Considered:
      - Reuse the Phase 27 boundary file vs a new Phase 28 file. New file keeps per-phase guards grep-able and mirrors the Phase 24/27 convention; chosen.
    - Chosen Approach:
      - Create `src/__tests__/phase28-boundaries.test.ts` with three `it()` cases mirroring Phase 27: `phase28_source_imports_no_synapta_packages`, `phase28_event_and_artifact_contracts_have_no_domain_vocabulary` (scan the `AgentEvent` union block from `export type AgentEvent =` to the next blank-line `export` and the Artifact* block from `// ponytail: AgentLoopStrategy` or `export type AgentLoopOptions` to EOF), and `phase28_public_barrel_re_exports_artifact_events_and_redactor`.
    - API Notes and Examples:
      ```ts
      // anchored union-block extraction
      const unionStart = contractsText.indexOf("export type AgentEvent =");
      const unionBlock = contractsText.slice(unionStart, contractsText.indexOf("export interface ToolDefinition", unionStart));
      for (const term of ["workflow", "node", "step"]) {
        assert.equal(new RegExp(`\\b${term}\\b`, "i").test(unionBlock), false, `AgentEvent union mentions ${term}`);
      }
      ```
    - Files to Create/Edit:
      - `src/__tests__/phase28-boundaries.test.ts` (new).
    - References:
      - `src/__tests__/phase27-boundaries.test.ts`; `src/__tests__/phase24-boundaries.test.ts`; `src/contracts.ts`; `src/index.ts`.
  - Outcome (Task 5):
    - Created `src/__tests__/phase28-boundaries.test.ts` mirroring the Phase 24/27 boundary test structure (file-scan + anchored contract-block extraction).
    - `phase28_source_imports_no_synapta_packages`: scans `src/` (excluding `__tests__`) — asserts no `from "synapta…"` import and no `\bsynapta\b` token.
    - `phase28_event_and_artifact_contracts_have_no_domain_vocabulary`: anchored extraction of the `AgentEvent` union block (from `export type AgentEvent =` to the next `export interface ToolDefinition`) AND the Artifact*/AgentLoop*/LoopContext block (from the `// ponytail: AgentLoopStrategy` anchor to EOF), asserting neither contains `workflow`/`node`/`step` (word-boundary, case-insensitive).
    - `phase28_public_barrel_re_exports_artifact_events_and_artifact_contracts`: asserts `src/index.ts` still exports `singleShotLoop`/`generateValidateReviseLoop`/`resolveLoop`/`isAgentLoopOptions`/`redactAgentEvent`, still has `export type * from "./contracts.js"`, and `src/contracts.ts` declares each of the five `artifact_*` event type literals plus the `Artifact*` contract names.
    - Verified: `npm run build:core` clean; 3/3 boundary tests pass; full suite 502/502 pass 0 fail (was 499, +3 boundary tests).
  - Test Cases to Write:
    - `phase28_source_imports_no_synapta_packages`.
    - `phase28_event_and_artifact_contracts_have_no_domain_vocabulary`.
    - `phase28_public_barrel_re_exports_artifact_events_and_artifact_contracts` (assert barrel still exports `redactAgentEvent`, `singleShotLoop`, `generateValidateReviseLoop`, and that `contracts.ts` declares each `artifact_*` type literal).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — test-only.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 6 — Docs: new `docs/agent-events.md` and `docs/structured-output.md`, index entries, `docs/agent-loops.md` update, `docs.test.ts` guards
  - Acceptance Criteria:
    - Functional: `docs/agent-events.md` (new) documents the full `AgentEvent` stream including the five `artifact_*` variants, ordering, `attempt`/`turn` semantics, the recoverable-vs-`error` convention, and redaction of `ArtifactValidation.errors[].message`/`metadata`; `docs/structured-output.md` (new) documents `ArtifactParser<T>`/`ArtifactValidator<T>`/`ArtifactRepairer<T>`/`ArtifactValidation`/`ArtifactContext`/`ArtifactParseResult<T>` with a Synapta-style schema→`ArtifactValidation` mapping example; `docs/agent-loops.md` updated to replace "Phase 28 will add"/"noop stubs" wording with the actual emitted events and ordering; `docs/index.md` adds navigations entries for both new pages; `docs.test.ts` `apiPages` includes both pages and gains a guard asserting the five event names and key phrases appear.
    - Performance: n/a.
    - Code Quality: both new pages follow the prism-wiki API page structure (What it does / When to use it / Inputs / Outputs / Request-response example / Implementation example / Extension notes / Security notes / Related APIs).
    - Security: structured-output example maps a host schema to `ArtifactValidation` without importing any Synapta type; examples use `createSecretRedactor` where model text may be echoed.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` (API page structure + index grouping).
      - `docs/agent-loops.md` (Phase 27 wording to update).
      - `docs/public-contracts.md` (`AgentEvent` / `Artifact*` contract table rows already added in Phase 27).
      - `src/__tests__/docs.test.ts` (`apiPages`, `requiredHeadings`, phrase-guard pattern).
      - `roadmap.md` Phase 28 docs deliverable.
    - Options Considered:
      - Fold structured-output into `docs/agent-loops.md` as a section vs a dedicated page. Roadmap explicitly requests `/docs/structured-output.md`; dedicated page also keeps `agent-loops.md` focused on the loop seam; chosen.
      - Put artifact events inside `docs/agent-loops.md` vs a dedicated `agent-events.md`. Roadmap requests `/docs/agent-events.md`; a dedicated events page also serves the non-loop events (`message_*`, `tool_execution_*`, `retry_scheduled`, `compaction_*`) as the canonical event reference; chosen.
    - Chosen Approach:
      - Create `docs/agent-events.md` covering the whole `AgentEvent` union (grouped: agent/turn/message, tool-execution, queue/compaction/retry, error, artifact) with a per-variant table, the artifact ordering sequence, the recoverable-vs-`error` rule, and redaction notes.
      - Create `docs/structured-output.md` covering the `Artifact*` seam: `T` is host-defined and Prism never instantiates it; `ArtifactParser<T>` is the only typed-output path; callback table; a Synapta-style usage example mapping a host schema (e.g. a JSON-schema-validated `ReleaseNote`) to `ArtifactValidation` via host callbacks; boundary statement (no `WorkflowStep`/`NodeSchema`).
      - Update `docs/agent-loops.md`: replace "Phase 28 will add `artifact_*` events" and "noop stubs" with the actual emitted events + ordering; cross-link `docs/agent-events.md` and `docs/structured-output.md`.
      - Update `docs/index.md`: add `docs/agent-events.md` and `docs/structured-output.md` under a new "Agent events and structured output" line in the "Agent/session runtime" group (or a new group, matching prism-wiki grouping guidance).
      - Update `docs/public-contracts.md` Related APIs / contract table to reference the new docs pages.
      - Update `src/__tests__/docs.test.ts`: add both pages to `apiPages`; add `agent_events_docs_cover_artifact_variants` and `structured_output_docs_cover_parser_validator_repairer` guard tests asserting key phrases.
    - API Notes and Examples:
      ```ts
      // docs/structured-output.md Synapta-style example (host owns the schema):
      import type { ArtifactParser, ArtifactValidator, ArtifactRepairer, ArtifactValidation } from "@arnilo/prism";
      interface ReleaseNote { readonly title: string; readonly body: string } // host schema (Synapta's own type)
      const parser: ArtifactParser<ReleaseNote> = (text) => {
        try { return { ok: true, value: JSON.parse(text) as ReleaseNote }; }
        catch (e) { return { ok: false, error: e instanceof Error ? e.message : "parse failed" }; }
      };
      const validator: ArtifactValidator<ReleaseNote> = (v) =>
        v.title && v.body ? { ok: true } : { ok: false, errors: [{ path: !v.title ? "title" : "body", message: "missing field" }] };
      ```
    - Files to Create/Edit:
      - `docs/agent-events.md` (new).
      - `docs/structured-output.md` (new).
      - `docs/agent-loops.md`: replace Phase-28-stub/noop wording with the emitted events and ordering; add cross-links.
      - `docs/index.md`: add navigation entries.
      - `docs/public-contracts.md`: add Related APIs cross-links (optional small edit).
      - `src/__tests__/docs.test.ts`: add `apiPages` entries + two guard tests.
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`; `docs/agent-loops.md`; `docs/public-contracts.md`; `src/__tests__/docs.test.ts`; `roadmap.md` Phase 28.
  - Outcome (Task 6):
    - `docs/agent-events.md` (new): full API-page-structure doc — What it does (single `AgentEvent` stream, in-memory/live, redacted), When to use it, Inputs/request (`session.subscribe()` + grouped variant table), Outputs/response/events (per-variant field tables for agent/turn/message/tool/queue/compaction/retry/artifact groups, artifact ordering sequence, recoverable-vs-`error` rule, `attempt` mirrors `retry_scheduled.attempt`), Request/response example (`artifact_revision_started`/`artifact_failed` JSON), Implementation example (GVR run with validator + subscriber), Extension notes (redaction via `redactAgentEvent`, single-shot emits zero artifacts, additive union), Security notes (in-memory broadcaster, exact-match redaction, WeakSet cycle guard, bounded attempts), Related APIs.
    - `docs/structured-output.md` (new): full API-page-structure doc — What it does (`Artifact*` seam, host `T`, Prism never instantiates `T`, no `WorkflowStep`/`NodeSchema`/`synapta*`), When to use it, Inputs/request (imports, callback table, loop selection), Outputs/response/events (artifact ordering + redaction), Request/response example (`ArtifactValidation` JSON), Implementation example (Synapta-style host `ReleaseNote` schema mapped to `ArtifactValidation` via parser/validator/repairer, with `createSecretRedactor`), Extension notes (default parser/repairer, `maxRevisions`, no tools in revision turns), Security notes (never-instantiates lock, boundary lock, redaction of `errors[].message`, bounded turns), Related APIs.
    - `docs/agent-loops.md`: replaced the "Phase 28 will add … noop hook points" paragraph with the actual emitted artifact event sequence + ordering + cross-link to [Agent events](agent-events.md#artifact-event-ordering); replaced the "when Phase 28 emits" redaction note with a live statement; added [Agent events] and [Structured output] to Related APIs.
    - `docs/public-contracts.md`: added [Agent events] and [Structured output] to Related APIs.
    - `docs/index.md`: added `[Agent events]` and `[Structured output]` navigation entries under the Agent/session runtime group.
    - `src/__tests__/docs.test.ts`: added `docs/agent-events.md` and `docs/structured-output.md` to `apiPages` (required-headings check runs); added `agent_events_docs_cover_artifact_variants` (asserts all five `artifact_*` names, `attempt`, `retry_scheduled`, `tool_execution_blocked`, `redactAgentEvent`, `recoverable`, `budget exhausted`, `singleShotLoop`, `generateValidateReviseLoop`, index link) and `structured_output_docs_cover_parser_validator_repairer` (asserts `ArtifactParser`/`ArtifactValidator`/`ArtifactRepairer`/`ArtifactValidation`/`ArtifactContext`/`ArtifactParseResult`, `never instantiates`, `generate-validate-revise`, `maxRevisions`, `redactAgentEvent`, `createSecretRedactor`, and the never-instantiates + domain-vocabulary lock statements, plus index link).
    - Verified: `npm run build:core` clean; docs tests 36/36 pass; full suite 504/504 pass 0 fail (was 502, +2 docs guards).
  - Test Cases to Write:
    - `agent_events_docs_cover_artifact_variants`: assert `docs/agent-events.md` contains all five `artifact_*` event names, the ordering sequence, `attempt`, `redactAgentEvent`, and the recoverable-not-`error` rule.
    - `structured_output_docs_cover_parser_validator_repairer`: assert `docs/structured-output.md` contains `ArtifactParser`, `ArtifactValidator`, `ArtifactRepairer`, `ArtifactValidation`, `ArtifactContext`, "never instantiates", and no `synapta`/`WorkflowStep`/`NodeSchema` token leakage (boundary).
    - `apiPages` includes both new pages (so the required-headings check runs).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new events and the structured-output seam contract.
    - Docs pages to create/edit: `docs/agent-events.md` (create), `docs/structured-output.md` (create), `docs/agent-loops.md` (edit), `docs/index.md` (edit), `docs/public-contracts.md` (edit cross-refs).
    - `docs/index.md` update: yes — new "Agent events and structured output" navigation line.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Parse failure in `generateValidateReviseLoop` ends the loop silently (no `artifact_*` events emitted, no `artifact_failed`). Roadmap reserves `artifact_failed` for budget exhaustion and the `error` channel for real failures; parse failure is a malformed-artifact outcome the host can detect from the absence of `artifact_finished`/`artifact_failed` and the emitted `message_finished`. Documented in `docs/agent-loops.md` and `docs/structured-output.md`. If a future host needs an explicit `artifact_parse_failed` event, add it as a sixth additive variant.
- No `artifact_revision_finished` event is emitted after the repair message push — roadmap lists only `artifact_revision_started`. The next turn's `artifact_validation_started` marks the revision's effect. Inventing `_finished` was YAGNI; documented in `docs/agent-events.md`.
- `attempt` in `generateValidateReviseLoop` equals the provider `turn` (1-indexed per validation attempt). This mirrors `retry_scheduled.attempt` semantics but ties `attempt` to turns within the GVR loop only; a future loop with a different attempt accounting would need its own numbering. `singleShotLoop` emits zero artifact events so this is GVR-scoped.
- No `src/` redaction change was needed — the generic `redactSecrets` walker already handles arbitrary nesting + cycles (WeakSet guard → `"[Circular]"`). A dedicated `ArtifactValidation` redaction path would have duplicated logic; deferred unless a measurable gap appears.
- The Phase 28 boundary test scans `src/` (excluding `__tests__`) and the anchored `AgentEvent` + Artifact contract blocks for domain vocabulary. Docs prose legitimately references "Synapta" as the consuming-app name and the words "WorkflowStep"/"NodeSchema" only inside the boundary-lock statements ("Prism has no …"); the docs guard asserts the presence of the never-instantiates + domain-vocabulary lock statements rather than word-absence in prose, so the consuming-app reference stays valid.
- `docs/structured-output.md` is a new page rather than a section in `docs/agent-loops.md` — roadmap explicitly requests `/docs/structured-output.md` and the seam (callback contracts + Synapta-style mapping example + boundary lock) justifies a dedicated page; `docs/agent-loops.md` cross-links it.
- `docs/agent-events.md` is a new canonical event reference covering the whole `AgentEvent` union (not just artifact variants) — roadmap said "updated" but no prior `agent-events.md` existed; creating it as the canonical event page avoids scattering event docs across `agent-session-runtime.md`/`tools.md`/`compaction-and-retry.md`.

## Further Actions
- **Low**: If a host needs an explicit terminal event for parse failure (malformed artifact, not budget exhaustion), add a sixth additive `artifact_parse_failed` variant and emit it on the early-return path. Defer until real demand; today hosts infer parse failure from absent `artifact_finished`/`artifact_failed`.
- **Low**: If revision observability needs a closing marker, add `artifact_revision_finished` emitted after the repair messages are pushed. Defer; `validation_started` of the next turn already marks the revision's effect.
- **Low**: If a second loop implementation needs a different `attempt` accounting (not turn-aligned), generalize the `attempt` semantics or add an `attempt` field to `AgentLoopOptions`. Today `attempt = turn` in GVR and `singleShotLoop` emits no artifact events.
- **Low**: If `ArtifactValidation.metadata` starts carrying non-JSON-shaped values the generic walker mishandles, special-case redaction for `ArtifactValidation`. Today the WeakSet/leaf-passthrough walker covers all observed shapes; a guard test locks the behavior.
- **Low**: Phase 29 (workspace/global package discovery) and later phases that supply skills/tools/context through the same `LoopContext.assemble` seam should keep artifact events opt-in (only GVR emits them); do not add artifact emits to `singleShotLoop`.
- **None**: No new dependencies, no new runtime module, no new contract interface. Phase 28 only added five additive `AgentEvent` union members and the emits at the pre-marked stubs; everything else reused `ctx.emit`→`redactAgentEvent`, the existing `Artifact*` contracts, and the existing `redactSecrets` walker.
