# Execution Guardrail Packs

Release: 0.9.0 (P1). Config-declared, eval-gated deterministic execution guardrails over existing interception seams — Claude-Code-hook parity in prism style.

## Objectives
- Canned guardrail packs as declarative config: no-unrelated-file-edits, no-test-rewrites, respect-failed-validation, no-destructive-commands.
- Packs execute on existing deterministic seams (`interruptBeforeTool`, extension kernel, `enforceExecutionPolicy`) — no new interception machinery.
- Each pack ships a trajectory scorer in the eval framework so hosts can verify enforcement.

## Expected Outcome
- A host enables `guardrailPacks: ["coding-standard"]` and gets deterministic enforcement (tool call blocked + reason) without writing code; the pack's eval scenario proves a violation is blocked.
- Clay's "loop, not hope" autonomy gets its enforcement layer; synapta gets auditable policy instead of prompt prose.

## Tasks

- [x] Task 1: Primitive review — interception and policy seams
  - Acceptance Criteria:
    - Functional: Inventory `src/guardrails.ts`, `interruptBeforeTool` extension seam, `packages/prism-coding-tools` `enforceExecutionPolicy`, and eval trajectory scorers; determine which pack rules map to which seam without new hooks.
    - Performance / Code Quality / Security: analysis only.
  - Approach:
    - Documentation Reviewed:
      - `docs/guardrails.md`, `docs/extensions.md`, `docs/middleware-hooks.md`, `docs/coding-security.md`, `docs/evaluations.md`, `docs/execution-timeline.md`, `docs/policy-and-audit.md`.
    - Options Considered: n/a.
    - Chosen Approach: Pack rules compile to existing seam predicates; packs are configuration, not code.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: none.
    - References: AgentGuard (task success ≠ reliable execution), SkillGuard (skills as security principal), StepGuard; 11-harness study: policy migrating from prompt prose to configuration.
  - Findings (Task 1 deliverable):

    Seam inventory (tool-scoped, deterministic):

    | Seam | Span | Can express | Emits |
    | --- | --- | --- | --- |
    | Guardrails `toolInput` | `src/guardrails.ts:48-87` (runner), `:93-101` (stage list), types `src/contracts-core/run-limits.ts:85-119`; call site `src/tools.ts:210-228` | predicate over raw `ToolCallContent` (`name` + `arguments`); `allow`/`block`/`tripwire`/`interrupt` | refusal-shaped `ToolResult` + `tool_execution_blocked` + ledger (`src/tools.ts:575-598`), `guardrail_decision` per rule, optional policy ledger (`packages/prism-core/src/governance/policy/record.ts:25-47`) |
    | Guardrails `toolOutput` | `src/tools.ts:313-333` | predicate over raw unredacted `ToolResult` before redaction/events/ledger/transcript | same; `block` returns blocked result, cannot veto later calls alone |
    | Middleware `tool_call`/`tool_result` | `src/middleware.ts:4-14`, `:51-84` | transform payload only; no deny shape. Throwing degrades to `extension_error` under default `errorPolicy: "event"` → unusable for enforcement | — |
    | `ExecutionPolicy` / `enforceExecutionPolicy` | `src/execution-policy.ts:20-47`; `packages/prism-coding-tools/src/agent/execution-policy.ts:4-34` | structured `ExecutionAction` (`kind`/`operation`/`paths`/`command`/`risk`), `ExecutionDecision.modified`, `exclusive` | `ToolResult` + `permission_denied` via `onDenied` |
    | `interruptBeforeTool` durable gate | `src/agent-run-state.ts:57` (option), `src/agent-session/session/tool-round.ts:284-300` and `:389-400` (consumers) | boolean all-tools suspension for approval on durable runs; `allow_for_run` sticky skip | `agent_suspended` pending decision, resumable |
    | Eval trajectory | `defineScorer` `scorer.ts:5-15`, `scoreOne` `score.ts:9-77`, `runScenario` `scenarios.ts:124-183`, scorers `trajectory.ts:14-505` | deny/spec matching over `ExecutionTimeline` (`createToolCallMatchScorer.deny` + `invariant`, stepBudget, noLoop, schema, errorClass, approvalBeforeEffect) | `EvaluationRecord` |

    Rule → seam map (no new interception machinery):

    | Pack rule | Seam | Notes |
    | --- | --- | --- |
    | Unrelated file edits / test rewrites | `toolInput` guardrail blocking on `arguments.path` (+ `paths` for move) | `createCodingApprovalPolicy` (`packages/prism-coding-tools/src/security/approval.ts:77`, roots/read-only/`commandRules`) already covers this for coded tools only; guardrail covers MCP/contributed tools too |
    | Respect failed validation | `toolOutput` recorder + `toolInput` deny pair sharing one compile-time session state object | raw results are visible at `tool_output`; stateless guardrails cannot express it, paired state can — still zero new hooks |
    | Destructive commands | `toolInput` on `shell` args `command` | Real tool names are `shell`, `read`, `write`, `edit`, `delete`, `move` (`packages/prism-coding-tools/src/agent/shell.ts:326`, `write.ts:76`, `edit.ts:172`, `delete.ts:64`, `move.ts:47`) — plan examples `"bash"`/`"writeFiles"` match nothing |
    | Secrets in tool args | `toolInput` with patterns shipped by the pack | Existing redaction is exact-known-value only (`src/redaction.ts:26`); the sole prefix heuristic is private (`src/host-composition.ts:121`) → pack ships its own versioned patterns |

    Pack identity/audit: `guardrail_decision.record.guardrail` already carries a rule id (encode as `pack:rule`, ≤128 chars) and `recordGuardrailDecision` maps `block`→`deny` with `guardrail:<stage>` target — no new event or audit fields needed.

    Required additions (small, additive — no new interception machinery):

    1. Session config: `AgentSessionConfig` (`src/contracts-core/agent.ts:165-178`) has no guardrails field; guardrails merge only from `AgentConfig.guardrails` + `RunOptions.guardrails` (`src/agent-session/session/assemble.ts:583`). `createSession({ guardrailPacks })` = one config field + merge + `run-bundle.ts:176-191` identity rows (pack name/version as `name`/`revision`).
    2. Rule identity in scorers: guardrail timeline steps drop rule identity — `observability/timeline.ts:419-437` projects `name = record.stage` and metadata `{ action, toolName?, toolCallId? }`. Task 3's "score names the pack rule" needs that projection to carry bounded pack/rule id plus one small scorer in `trajectory.ts`; keep free-text reason out (`metadata` is low-cardinality operational only).
    3. `ask` action has no selective seam: `tool_input` `interrupt` fails closed (`ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE`, `src/guardrails.ts:19-22`) and the durable gate is boolean-all-tools. Task 2 either widens `interruptBeforeTool` to accept a rule predicate (default stays fail-closed) or ships deny-only actions in the first cut.
    4. Refusal text: blocked results use generic messages (`src/tools.ts:227`, `:331`); thread the bounded/redacted `record.reason` there if the model must see which rule fired (otherwise reason stays in `guardrail_decision` only).
    5. Eval runner surface: no `prism eval` CLI exists (`src/cli-runner.ts` exposes `dev`, `init`, `provider-add`); scenarios are API-level `runScenario` + scorers under `packages/prism-core/src/governance/evals/__tests__/`, so Task 3's `npx prism eval run --scenario …` was rewritten to the fixture/test form.

    Verdict: all four packs compile to guardrail entries (plus optional `createCodingApprovalPolicy` config); no new interception hooks. `interruptBeforeTool` is a durable HITL gate, not an extension seam — the extension seam is `ExtensionAPI.use()`/`MiddlewareRegistry`, which cannot deny and is therefore excluded.
  - Test Cases to Write: n/a.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

- [x] Task 2: Pack schema + rule compiler
  - Acceptance Criteria:
    - Functional: `guardrailPacks` session option accepts built-in pack ids and inline pack objects (`{ rules: [{ kind: "tool", match: "writeFiles", deny: (args) => outsideScope(args) }] })` — declarative for built-ins, typed predicate escape hatch for custom; compiled once per session, evaluated synchronously at the interception seam; blocked calls emit existing refusal-shaped tool result + audit event with pack id and rule id.
    - Performance: Rule evaluation < 0.5ms per tool call; compiled predicates, no per-call parsing.
    - Code Quality: Pack definitions are data + pure predicates; no pack ships imperative session access.
    - Security: Packs are restrictive-only (deny/ask), cannot grant permissions beyond session policy; inline predicates host-trusted like all host code; built-in packs versioned.
  - Approach:
    - Documentation Reviewed: Task 1; refusal/error contract conventions in `docs/coding-review-and-diagnostics.md`; `docs/guardrails.md`, `docs/middleware-hooks.md`, `docs/agent-events.md`, `docs/options-index.md`, `docs/policy-and-audit.md`.
    - Options Considered:
      - Pure prompt-based rules: rejected — AgentGuard/lit + harness practice show prose is unenforceable.
      - New hook type per pack: rejected — seams exist; packs compile to them.
    - Chosen Approach: Declarative rule records (`pattern` | `deny`) → compiled guardrails on the existing tool seams; built-ins are data + pure factories.
    - API Notes and Examples:
      ```ts
      createSession({
        guardrailPacks: ["coding-standard"],
        // or options / inline:
        guardrailPacks: [
          { id: "coding-standard", options: { cwd: "/repo", roots: ["/repo"] } },
          { id: "my-pack", version: 1, rules: [
            { id: "no-force-push", tool: "shell", pattern: /git\s+push\b[^\n;&|]*--force\b/i, argPath: "command", reason: "force-push" },
            { id: "no-etc", tool: "write", deny: (args) => String(args.path).startsWith("/etc/") },
          ]},
        ],
      });
      ```
    - Files Created/Edited:
      - `src/contracts-core/guardrail-packs.ts` (new): pack + rule types; `src/contracts-core.ts` barrel; `src/contracts-core/agent.ts`: `AgentSessionConfig.guardrailPacks`.
      - `src/guardrails.ts`: `compileGuardrailPacks`, `describeGuardrailPacks`, `GuardrailPackError`, matching/scan helpers, ceilings.
      - `src/guardrail-packs/*.ts` (new): `types`, `errors`, `coding-standard`, `destructive-commands`, `validation-respect`, `secrets-hygiene`, `index` (registry).
      - Seam wiring: `src/agent-session/session.ts` (compile once, fork/clone carry), `src/agent-session/session/types.ts`, `src/agent-session/session/assemble.ts` (merge), `src/run-bundle.ts` (identity rows), `src/index.ts` (exports).
    - References: Claude Code hooks (exit-code enforcement), Codex execpolicy prefix rules.
  - Result (shipped):
    - Schema: `GuardrailRule` = exactly one of `pattern` (string/`RegExp`, compiled once) or `deny(args, context)` predicate, plus optional `tool`, `argPath`, `action` (`deny` default | `tripwire`), `reason`. `GuardrailPackRef` = built-in id string, or `{ id, version?, options?, rules? }` (rules present = inline pack; options present = built-in with options). The plan's `{ kind: "tool", match: { tool, argPattern } }` sketch became this flatter shape (one rule kind, two match modes).
    - Compiler: `compileGuardrailPacks(refs)` in `src/guardrails.ts` — resolves built-ins from `src/guardrail-packs/index.ts`, validates fail-closed (`GuardrailPackError`: unknown id, duplicate pack/rule id, both/neither match, invalid regex, `ask`, oversized id/pattern/reason, > 8 packs / > 64 rules), compiles patterns once, and returns `Guardrails` with one `tool_input` guardrail per rule (`name = pack:<pack>/<rule>`, `revision = <pack>@<version>`) plus one `tool_output` recorder for observing packs. `describeGuardrailPacks(refs)` returns the same identity rows without state.
    - Wiring: `AgentSessionConfig.guardrailPacks` → compiled once in the `RuntimeAgentSession` constructor → merged in `assemble.ts` after `AgentConfig.guardrails` and before `RunOptions.guardrails`; `SessionHost.packGuardrails` exposes it to phases. `run-bundle.ts` adds the pack identity rows to the session's guardrail fingerprint.
    - Deliberate extra (fail-open path found during implementation): `session.fork()`/`clone()` rebuild session config, so `guardrailPackRefs` is carried into both — a branch can no longer silently lose its policy (test covers a forked session still blocking).
    - Built-in packs shipped here as data + pure factories (`src/guardrail-packs/*.ts`): `coding-standard`, `destructive-commands`, `validation-respect`, `secrets-hygiene` — so Task 3 scopes down to trajectory scorers/scenario fixtures and verification.
  - Deviations:
    - `ask` is rejected at compile time instead of being accepted: Task 1 finding — `tool_input` `interrupt` fails closed (`ERR_PRISM_GUARDRAIL_INTERRUPT_UNAVAILABLE`) and the durable gate is boolean-all-tools, so no deterministic approval seam exists at the tool stage. Deny-only rules shipped; `ask` needs the `interruptBeforeTool` predicate widening noted in Task 1.
    - Perf criterion verified structurally (regexes compiled at session creation, bounded argument scan) and measured, not asserted by a timer test (flaky): all 9 built-in rules over a `shell` call = **0.002 ms** per tool call, 0.2 µs per rule.
    - `validation-respect` needs cross-call state, so the pack definition type carries an internal `observe(state, result, context)` recorder; inline packs stay rules-only (predicates may close over host state). Recorders never deny (test asserts), so `observe` cannot widen enforcement.
    - Modified-argument revalidation at decision time (`src/agent-approval.ts`) still checks `AgentConfig.guardrails` only; session pack rules re-block the same call at dispatch, so enforcement holds, but that early rejection does not name pack rules. Deferred (recorded for Compromises Made).
  - Test Cases Written (`src/__tests__/guardrail-packs.test.ts`, 11 cases): inline predicate deny/pass; coding-standard outside-roots + test rewrite + test move; destructive rm/rm -fr/long flags/force push/drop table/mkfs deny and benign allow; secrets `ghp_`/`sk-`/PEM deny and plain-text allow; validation-respect failure→deny→pass→allow, plus non-zero shell `exitCode` with `validationTools: ["shell"]`; cannot widen (no input/output stages, only denial actions, unknown tool stays denied, recorders never deny); fail-closed compile matrix (10 malformed configs); pack identity rows + `snapshotRunBundle` rows; session-level enforcement during a real run; fork carries packs. Public export freeze lists updated in `src/__tests__/public-export-contract.test.ts`.
  - Verification: `npx tsc -p tsconfig.json --noEmit`; `node --test dist/__tests__/guardrail-packs.test.js` (11/11); root suite `node --test dist/__tests__/*.test.js` (1925/1926 — the one failure is an untracked plan-089 file, `packages/memory/src/rag/__tests__/local-reranker.test.ts`, unrelated to this task); `dist/__tests__/docs.test.js`; `scripts/live-doc-check.test.mjs`; `scripts/dead-export-verify.test.mjs`; `scripts/tooling-gate.test.mjs`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `AgentSessionConfig.guardrailPacks`, `compileGuardrailPacks`, `describeGuardrailPacks`, `GuardrailPackError`, `BUILT_IN_GUARDRAIL_PACK_IDS`, pack ceilings; `guardrail_decision` records now carry `pack:<pack>/<rule>` names.
    - Docs pages to create/edit: `docs/guardrails.md` (new “Guardrail packs” section: built-in table, inline schema, audit shape, bounds); `docs/policy-and-audit.md` (pack rule identity in the policy ledger and bundles); `docs/options-index.md` (session config row).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Built-in packs + trajectory scorers
  - Acceptance Criteria:
    - Functional: Four built-ins verified end to end: `coding-standard` (unrelated edits, test rewrites), `validation-respect` (no proceed past failed validation tool result), `destructive-commands` (rm -rf, force-push, drop table patterns), `secrets-hygiene` (no secret material in tool args) — definitions + compiler shipped in Task 2. Each ships an eval trajectory scenario where the violating trajectory scores fail with the pack rule named and the compliant trajectory passes; the guardrail timeline step must carry the bounded rule id (Task 1 finding #2) for the score to name it.
    - Performance: Eval scenarios run in suite budget; rules lazy-registered.
    - Code Quality: One module per pack (done in Task 2); scorers use the existing trajectory scorer framework (`packages/prism-core/src/governance/evals/score.ts`).
    - Security: `secrets-hygiene` patterns ship with the pack, bounded and versioned — existing redaction is exact-known-value only (Task 1 finding: the sole prefix heuristic is private in `src/host-composition.ts:121`).
  - Approach:
    - Documentation Reviewed: `docs/evaluations.md`, `docs/guardrails.md`, `docs/execution-timeline.md`, trajectory scorer framework in governance/evals.
    - Options Considered: Ship schema only, packs later — rejected; packs without scorers are unverified prose-in-config. One scorer per pack — rejected; a single rule-identity scorer covers all four, per-pack scorers would duplicate the same timeline walk.
    - Chosen Approach: One rule-identity scorer + one violating/compliant scenario pair per pack, scripted mocks. Task 2 shipped the four built-ins and the compiler (see Task 2 Result), so this task owned the timeline rule identity, the scorer, the scenario fixtures, and end-to-end verification.
    - API Notes and Examples:
      ```ts
      // No `prism eval` CLI exists (Task 1 finding): scenarios run via the evals API.
      await runScenario({
        agent,
        turns: ["run the tests", "fix the failing test"],
        sessionConfig: { guardrailPacks: [{ id: "validation-respect", options: { validationTools: ["shell"] } }] },
        timeline: "metadata",
        scorers: [createGuardrailPackScorer({ forbidTools: ["write"] })],
      });
      ```
    - Files Created/Edited:
      - `packages/prism-core/src/governance/observability/timeline.ts`: guardrail steps carry `metadata.guardrail` (rule identity).
      - `packages/prism-core/src/governance/evals/trajectory.ts`: `createGuardrailPackScorer` + `DEFAULT_PACK_RULE_PREFIX`; `index.ts` exports both.
      - `packages/prism-core/src/governance/evals/scenarios.ts`: `RunScenarioOptions.sessionConfig`; one subscription per turn (bug fix, see Result).
      - `packages/prism-core/src/governance/evals/__tests__/guardrail-pack-scenarios.test.ts` (new): 9 scenario fixtures.
      - Tests updated: `observability/__tests__/timeline.test.ts` (rule identity assertion).
      - `src/guardrail-packs/*.ts`: unchanged — no pattern or version fix was needed.
    - References: AgentGuard anomalous-trajectory rule classes.
  - Result (shipped):
    - Timeline: the `guardrail_decision` projector now adds `metadata.guardrail` (`pack:<pack>/<rule>`, bounded by the compile-time id limits) so a scorer can name the rule; step `name` stays the stage and `status` stays `denied`/`succeeded`, and the free-text reason is deliberately not projected (Task 1 finding #2: `metadata` stays low-cardinality).
    - Scorer: `createGuardrailPackScorer({ rules?, forbidTools?, id? })` in `trajectory.ts`. Denial of a matching rule (default prefix `pack:`) → `0` with `reason` naming the first rule, `metadata.rules` listing every denial in order; a `forbidTools` call that executed with no denial → `0` naming the tool (enforcement escape); otherwise `1`. Every result carries `metadata.invariant: true`, so thresholds fail closed.
    - Harness: `runScenario` gained `sessionConfig` (packs live on session config, not agent config). Found and fixed a fail-open harness bug while wiring it: `runScenario` subscribed once around *all* turns, but subscribers close when a run settles (`cleanupRun` → `closeSubscribers`, load-bearing for `stream()` termination), so every multi-turn scenario scored a timeline containing only the first turn — the validation-respect violation was enforced but invisible to the scorer. Subscriptions are now per turn; the folder accumulates the whole scenario. Existing scenario suites pass unchanged.
    - Scenarios (`guardrail-pack-scenarios.test.ts`): 8 pack fixtures (violating + compliant for each built-in) plus a pack-absent control, each a scripted mock provider over a real session. Violating runs assert the tool never executed (the pack did the blocking, not the agent's restraint), that the scorer's `metadata.rules` matches the expected rule ids in order, and that the reason names `pack:<pack>/<rule>`; compliant runs assert the benign tool *did* execute and that no pack denial reached the timeline. The control runs the destructive script with no packs and fails as "forbidden tool executed".
  - Deviations:
    - Task 1 finding #2's "free-text reason" note honored: the rule's reason text is not added to timeline metadata (it stays on the `guardrail_decision` record); the scenario score names the rule by identity.
    - The scorer is one rule-identity scorer rather than one per pack (see Options Considered).
    - The `coding-standard` violating scenario spans two turns so both `no-unrelated-file-edits` and `no-test-rewrites` are named; the other violating scenarios use one turn with several calls.
    - `tripwire` remains unexercised by scenarios (pack vocabulary is deny-first); covered at the rule level in Task 2's unit tests.
  - Test Cases Written: 9 scenario tests, one per fixture: `coding-standard/violating` (2 rules named), `coding-standard/compliant`, `destructive-commands/violating` (`rm -rf` + `--force` push + `drop table`, three rules named), `destructive-commands/compliant`, `secrets-hygiene/violating` (`ghp_` token in a write argument), `secrets-hygiene/compliant`, `validation-respect/violating` (non-zero shell exit then a write), `validation-respect/compliant` (passing shell then a write), and `no-pack/control` (pack absent → executed-tool failure).
  - Verification: `packages/prism-core` `npm run typecheck`; `npm run build`; package suite `npm test` (653 passed / 9 skipped / 0 failed, 662 total); scenario file 9/9; `packages/prism-coding-tools` `dist/dev/__tests__/eval-compare.test.js` (11/11, multi-turn `runScenario`); root `dist/__tests__/docs.test.js` (155/155) and `scripts/live-doc-check.test.mjs` (6/6) after the docs edits; root `scripts/dead-export-verify.test.mjs`, `scripts/tooling-gate.test.mjs`, `scripts/packaging-current.test.mjs` (46/46); biome lint + format clean on the touched files.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `createGuardrailPackScorer` and `DEFAULT_PACK_RULE_PREFIX` are new `@arnilo/prism-core/governance/evals` exports; `runScenario` accepts `sessionConfig`; guardrail timeline steps expose `metadata.guardrail`.
    - Docs pages to create/edit: `docs/guardrails.md` (timeline rule identity + how grading works); `docs/evaluations.md` (API table rows for the scorer and `runScenario.sessionConfig`, plus a "Guardrail-pack trajectory scenarios" section); `docs/execution-timeline.md` (guardrail step metadata note).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- `ask` is not a pack action: `tool_input` `interrupt` fails closed and `interruptBeforeTool` is a boolean all-tools durable gate, so packs ship deny/tripwire only. Approvals stay where they already work (approval policy, durable `interruptBeforeTool`, HITL tools). Widening the durable gate to a rule predicate was out of scope for this plan.
- Pack state is session-scoped (compiled once per session) and in-memory: it does not survive a durable resume, and a resumed session re-observes from empty state (`validation-respect` therefore cannot remember a pre-suspension failed validation). Durable pack state would need a checkpoint field.
- Decision-time revalidation of modified arguments (`src/agent-approval.ts`) re-evaluates `AgentConfig.guardrails` only; session pack rules re-block at dispatch, so enforcement holds, but the early rejection does not name pack rules.
- `runScenario` now subscribes per turn instead of once per scenario. The underlying contract mismatch (`session.subscribe()` is documented as long-lived across runs, while `cleanupRun` closes every subscriber at run end) is untouched — `stream()` depends on that close to terminate. A long-lived subscriber that outlives `run()` still needs run-scoped ownership or an opt-in keep-open flag.
- Trajectory scenarios grade enforcement on the timeline; they do not assert the model's prose or that the refusal reason reached the model. Refusal-text threading (Task 1 finding #4) is unimplemented by design (generic blocked-result messages).
- Perf criterion "rules lazy-registered" is structural: built-ins are plain data modules with no eval-suite registration cost; no benchmark asserts it.

## Further Actions
- Widen `interruptBeforeTool` (or add a predicate form) so an `ask` rule can suspend a durable run before a specific tool call; then accept `action: "ask"` in the pack schema and cover it with a scenario. Priority: medium-high — it is the only pack vocabulary gap users hit.
- Persist pack state across durable resume (bounded, redacted `sessionState.packState` keyed by pack id) so `validation-respect` and future stateful packs cannot be reset by suspension. Priority: medium.
- Thread the bounded denial reason into the blocked `ToolResult` (Task 1 finding #4) so the model sees which rule fired instead of a generic message. Priority: medium.
- Give run-scoped subscribers explicit ownership (or an opt-in) so `session.subscribe()` matches its documented multi-run contract; today `runScenario` works around it. Priority: medium.
- Re-evaluate session pack rules in the modified-argument revalidation path so an approved-with-edits call is rejected with the pack reason at decision time. Priority: low.
- Ship an `examples/` guardrail-pack walkthrough (session config + eval scenario) once the docs settle, mirroring `examples/behavior-evaluation.ts`. Priority: low.

