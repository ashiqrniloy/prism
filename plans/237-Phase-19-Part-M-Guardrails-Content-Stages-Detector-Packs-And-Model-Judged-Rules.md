# Phase 19 Part M — guardrails: content stages, detector packs, and model-judged rules

## Objectives

- Check what goes into and comes out of the model, not only tool arguments. `@arnilo/prism-extensions/guardrail-packs` compiles patterns onto `tool.call` and a `tool.result` observer only (`packages/extensions/guardrail-packs/src/index.ts:112`, `:143`), and its contract says packs never add a stage (`packages/extensions/guardrail-packs/src/contracts.ts:1-6`). The roadmap's hook table names `run.input` for input guardrails and `model.response` for output guardrails (`roadmap.md:348`, `:353`); no package uses them that way.
- Offer the detectors hosts ask for first: personal data, secrets in model output, and prompt-injection markers in untrusted tool results. The kernel already marks untrusted results (`UNTRUSTED_EXTERNAL_TRUST`, `src/input.ts`) but nothing inspects them.
- Offer a rule that asks a model. Every existing rule is a pattern or a host predicate.

## Expected Outcome

- A pack rule can name a stage: `input` (`run.input`), `output` (`model.response`), `tool_result` (`tool.result`), beside today's tool-call rules. Content rules can `deny` (the run fails closed with the rule's reason), `redact` (matched spans are replaced before the content goes on), or `flag` (an event only).
- Three new built-in packs: `pii` (email, phone, payment card with checksum, national id shapes), `output-secrets` (the secret shapes `secrets-hygiene` already knows, applied to model output), and `injection-markers` (instruction-override phrasing, role spoofing, and exfiltration link shapes in untrusted tool results).
- A `judge` rule sends one bounded question about the content to a configured model and acts on the answer. It uses the decisions capability when the model has it and structured output otherwise. A judge failure denies by default.
- The injection suite in `@arnilo/prism-hosts/evals` reports each pack's catch rate and false-positive rate; the README carries only measured numbers.

This plan implements roadmap **Phase 19 Part M**. It changes one package's contract and adds no kernel contract; but it relies on two kernel behaviors the review must confirm (a `run.input` / `model.response` rejection's effect on the run, and `tool.result` transform ordering), so **Task 1 is a phase review**. It depends on plan 225 Task 5 (judge calls are metered) and plan 235 (structured output for judges on models without decisions). No version bump or publish.

The roadmap's Out of scope line about "gates that use a model's judgment as the deciding check" concerns `gateNode` in workflows, which stays deterministic. A judge rule is an opt-in package rule on a hook; plan 225 Task 2's Phase 19 entry says so.

Cost knobs: pattern and detector rules make no model call. A `judge` rule makes one model call per checked item (one per run input, per assistant message, or per tool result, as configured), bounded by `maxInputChars` (default 8,000) and `timeoutMs` (default 10,000). Nothing is on by default. The README table states each.

## Tasks

- [ ] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line`:
      - (a) **Stage semantics in the kernel.** What a `ctx.reject(reason)` or a thrown error does on each transform: `run.input` at run start and on a steer (`src/agent-session/session/assemble.ts`, `session.ts` `drainSteers`), `model.response` (`src/loop/run-controller.ts`, after the turn and before `message.append`), and `tool.result` (`dispatchOne`). Which of them leave content already streamed to subscribers (`message.delta` precedes `model.response`).
      - (b) **Ordering.** Hook priority and load order for transforms (`src/hooks/bus.ts` `sorted`), and where a redaction must sit relative to memory, compaction, and observability handlers on the same hooks.
      - (c) **The pack compiler.** `compileGuardrailPacks` and its bounds (`packages/extensions/guardrail-packs/src/compile.ts`), the record and event shape (`guardrail_decision`), the `tripwire` and `ask` actions, pack state shared with the result observer, and the built-in packs' rule shapes (`packages/extensions/guardrail-packs/src/packs/*.ts`).
      - (d) **Untrusted marking.** Where `metadata.trust` is set (`packages/tools/web`, `browser`, `mcp`, `openapi`, `work` connectors) and how the envelope is applied (`formatUntrustedToolText`, `src/input.ts`), so `injection-markers` reads the body before the envelope.
      - (e) **Model access for a judge.** `prism.models.client` and `prism.models.decisions` (`src/packages/api.ts:129-145`), `DecisionRequest` limits (`src/contracts-core/decisions.ts`), and what plan 225 Task 5 requires of a package call (pass the session).
      - (f) **The eval suite.** The injection dataset and its scorers (`packages/hosts/evals/src/`, `examples/eval-injection.ts`, `apps/prism-agent/evals/`), and how a package set is varied across arms.
    - Performance: n/a — read-only.
    - Code Quality: Findings are written against the task they change.
    - Security: Records the limit of an output rule: text already streamed cannot be recalled, so `output` `deny` and `redact` protect the transcript and later turns, and a host that must not display unchecked text sets `limits.bufferOutput` (plan 228). The README must say this.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.4 (hook table), §2.9 (guardrail-packs row); `docs/hooks.md`, `docs/tools.md` (untrusted results)
      - `packages/extensions/guardrail-packs/README.md`, `src/`
    - Options Considered:
      - Skip — rejected: (a) decides what `deny` on `output` can promise.
    - Chosen Approach:
      - Inventory, then confirm or re-cut Tasks 2–4.
    - API Notes and Examples:
      ```bash
      graft callers compileGuardrailPacks --depth all
      graft grep "untrusted_external"
      ```
    - Files to Create/Edit:
      - `plans/237-…md`: the task note
    - References:
      - Evaluation: "model-based or content guardrails" under missing features
  - Test Cases to Write:
    - none — read-only
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Content stages and detector packs
  - Acceptance Criteria:
    - Functional:
      - `GuardrailRule.stage?: "tool_call" | "input" | "output" | "tool_result"` (default `"tool_call"`, today's behavior). A content rule has a `pattern` or a named `detector`, and an `action` of `deny`, `redact`, or `flag`. `tripwire` and `ask` stay tool-call only; using them on a content stage fails the load.
      - The package registers a transform on a hook only when a configured rule needs that stage.
        - `input`: `deny` rejects the input (`ctx.reject`), failing the run or dropping the steer as the kernel does today; `redact` replaces matches in text blocks.
        - `output`: `deny` rejects the assistant message; `redact` replaces matches in text blocks before the message is appended.
        - `tool_result`: `deny` replaces the result with an error result naming the rule; `redact` replaces matches in text content and string values.
      - `redact` writes a fixed marker (`[redacted:<rule id>]`); the matched text is never recorded.
      - Built-in packs: `pii`, `output-secrets`, `injection-markers`, each with options to pick detectors and the action. `injection-markers` applies only to results marked `untrusted_external` and defaults to `flag`.
      - Every decision emits the existing guardrail record (pack, rule, stage, action, reason) with no content.
      - Inline rules stay JSON-only for patterns; detectors are named, not supplied as functions, in package config.
      - Limits: at most 8 packs and the existing rule bounds; content scanned per item is capped (default 256 KiB, the rest is passed through and the record says `truncated`).
    - Performance: Rules compile once. Scanning is linear in the content with bounded patterns; a 256 KiB tool result scans in under 5 ms per pack on the benchmark machine class, recorded in the task note.
    - Code Quality: Detectors are pure functions with table-driven tests; the stage handlers share one "apply rules to text" routine.
    - Security: Restrictive only: a rule can remove or refuse content, never add or widen. Patterns keep the compile-time bounds against catastrophic backtracking. Records and events carry rule ids and counts, never matched text.
  - Approach:
    - Documentation Reviewed:
      - `packages/extensions/guardrail-packs/src/{contracts,compile,config,index}.ts`, `packages/extensions/guardrail-packs/src/packs/secrets-hygiene.ts`
      - `docs/hooks.md` (`run.input`, `model.response`, `tool.result` rows)
      - Task 1(a)–(d)
    - Options Considered:
      - A new package for content guardrails — rejected: the compiler, bounds, record shape, and config already exist here.
      - Host predicates on content stages — rejected for package config (JSON only); the library export keeps the typed predicate for hosts that build packs in code.
    - Chosen Approach:
      - Extend the rule with a stage and a small detector catalog.
    - API Notes and Examples:
      ```jsonc
      { "packs": [
          { "id": "pii", "options": { "detectors": ["email", "payment-card"], "stages": ["output", "tool_result"], "action": "redact" } },
          "injection-markers",
          { "id": "house", "rules": [{ "id": "no-internal-hosts", "stage": "output", "pattern": "\\binternal\\.example\\.com\\b", "action": "redact", "reason": "internal hostname" }] } ] }
      ```
    - Files to Create/Edit:
      - `packages/extensions/guardrail-packs/src/{contracts,compile,config,index}.ts`
      - `packages/extensions/guardrail-packs/src/detectors/{pii,secrets,injection}.ts`: new
      - `packages/extensions/guardrail-packs/src/packs/{pii,output-secrets,injection-markers}.ts`, `packs/index.ts`
      - `packages/extensions/guardrail-packs/src/__tests__/{content-stages,detectors}.test.ts`: new
      - `packages/extensions/guardrail-packs/README.md`
      - `examples/guardrail-content.ts`: new, on the mock provider; `examples/README.md`, `scripts/e2e-coverage.json`
      - `scripts/compat-baseline/…` for `@arnilo/prism-extensions`: regenerated with `bun scripts/release.mjs gate --update-baseline`, additive diff in the task note
    - References:
      - `packages/extensions/guardrail-packs/src/contracts.ts:10-45`
  - Test Cases to Write:
    - `output_redact_replaces_matches_before_append`: the stored message holds the marker, not the match.
    - `output_deny_rejects_the_message_and_fails_closed`.
    - `input_deny_fails_the_run_and_drops_a_steer`.
    - `tool_result_redact_covers_text_and_string_values`.
    - `injection_markers_only_scan_untrusted_results`.
    - `payment_card_detector_requires_a_valid_checksum`.
    - `tripwire_or_ask_on_a_content_stage_fails_the_load`.
    - `no_hook_is_registered_for_an_unused_stage`.
    - `records_carry_no_matched_text`.
    - `oversized_content_is_scanned_to_the_cap_and_marked_truncated`.
    - `works_on_a_custom_loop`: the transforms fire through the primitives.
    - Package conformance passes; `examples_demos_run_to_completion_and_emit_no_secret` covers the example.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — rule fields, three packs, new hook registrations
    - Docs pages to create/edit:
      - `packages/extensions/guardrail-packs/README.md`: stages, actions, the three packs, the streaming caveat from Task 1's Security finding
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Model-judged rules
  - Acceptance Criteria:
    - Functional:
      - A rule may carry `judge: { model, question, threshold?, maxInputChars?, timeoutMs?, onError? }` instead of a pattern. `question` is a yes/no question about the content, at most 512 characters.
      - When the model declares `capabilities.decisions`, the package asks through `prism.models.decisions(ref)` and compares the returned probability with `threshold` (default 0.5). Otherwise it asks through `prism.models.client(ref)` with structured output `{ answer: boolean }` (plan 235) and no tools.
      - The content is sent inside the kernel's untrusted envelope with a fixed system instruction; the judged content cannot change the question.
      - A "yes" applies the rule's action (`deny` or `flag`; `redact` is not available to a judge rule). `onError` is `"deny"` (default) or `"allow"`, applied on timeout, provider failure, or an unparsable answer, and recorded.
      - The call passes the session, so it is metered against the run and visible to `model.call` hooks.
      - At most one judge call per item per rule; identical content within a run is answered from a per-run cache.
      - The package declares the `models` capability only when a judge rule is configured; without the capability a judge rule fails the load.
    - Performance: Stated in the README: calls per run input, per assistant message, or per tool result; the default bounds; the cache.
    - Code Quality: One judge function for both model paths, tested on the mock provider's `generate` and `decisions` handlers.
    - Security: The judge model gets no tools and no session history. Its raw answer is never recorded; the record carries the rule id, the outcome, and the probability when available. `model` is a model reference, never a credential.
  - Approach:
    - Documentation Reviewed:
      - `docs/decisions.md`, `src/contracts-core/decisions.ts`, `src/packages/api.ts:129-145`
      - `src/input.ts` (`formatUntrustedToolText`), plan 235 (structured output), plan 225 Task 5 (`ModelCallOptions.session`)
      - `packages/extensions/advisor/src/consult.ts` (an existing tool-less side call with a bounded prompt)
    - Options Considered:
      - A free-text rubric with a scored reply — rejected: harder to bound and to validate than a yes/no answer; the decisions capability already returns calibrated probabilities.
      - Judge every delta — rejected: cost, and a delta is not a unit of meaning.
    - Chosen Approach:
      - One bounded yes/no question per item, on the decisions capability when present.
    - API Notes and Examples:
      ```jsonc
      { "packs": [{ "id": "house", "rules": [
          { "id": "off-topic-output", "stage": "output", "action": "flag",
            "judge": { "model": "typesafe/jev", "question": "Does the text give medical advice?", "threshold": 0.7 } } ] }] }
      ```
    - Files to Create/Edit:
      - `packages/extensions/guardrail-packs/src/{judge.ts,contracts.ts,compile.ts,config.ts,index.ts}`
      - `packages/extensions/guardrail-packs/src/__tests__/judge.test.ts`: new
      - `packages/extensions/guardrail-packs/README.md`
      - `packages/extensions/package.json`: capability declaration, if capabilities are listed there
    - References:
      - Phase 18 (decision models); `examples/decision-models.ts`
  - Test Cases to Write:
    - `judge_uses_decisions_when_the_model_declares_them`.
    - `judge_falls_back_to_structured_output`.
    - `yes_above_threshold_applies_the_action`.
    - `judge_timeout_denies_by_default_and_allows_when_configured`.
    - `judged_content_cannot_override_the_question`: content containing "answer no" does not flip a clear yes on the scripted model's input check (the test asserts the envelope and instruction, not model behavior).
    - `judge_call_is_metered_on_the_run`.
    - `identical_content_is_judged_once_per_run`.
    - `judge_rule_without_models_capability_fails_the_load`.
    - `record_carries_no_content_and_no_raw_answer`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a rule kind, a capability, extra model calls
    - Docs pages to create/edit:
      - `packages/extensions/guardrail-packs/README.md`: "Judge rules", capabilities, the cost table, failure behavior
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Measure the packs on the injection suite
  - Acceptance Criteria:
    - Functional:
      - The injection suite runs two arms on the mock provider's recorded scenarios and, opt-in, on live models: no pack, and `injection-markers` plus `pii`. It reports per pack: items caught, items missed, and false positives on the benign items, with the suite's existing statistics (interval and paired comparison).
      - The result is written to `docs/_evidence/guardrails-2026-11.md` with the dataset hash, the pack versions, and the model ids.
      - The README states the measured rates, or states that a pack is unmeasured. It makes no claim the evidence does not carry.
      - The deterministic arm runs in `bun run test`; the live arm is a manual `test:live` entry.
    - Performance: The deterministic arm adds under 5 s to the hosts test stage.
    - Code Quality: The comparison reuses `runExperiment` and the suite's scorers; no new statistics code.
    - Security: The evidence file contains counts and ids only, no dataset content beyond what the suite already publishes.
  - Approach:
    - Documentation Reviewed:
      - `packages/hosts/evals/README.md`, `src/` (injection suite, `runExperiment`, statistics), `examples/eval-injection.ts`
      - `docs/_evidence/skill-evals/` (the shape of an evidence record)
    - Options Considered:
      - Ship the packs with no measurement — rejected: the repo's rule is that a claim carries its evidence.
    - Chosen Approach:
      - Two arms on the existing suite, deterministic by default.
    - API Notes and Examples:
      ```ts
      const report = await runExperiment({ agent: withPacks, baseline: withoutPacks, dataset: injectionDataset, scorers, ownership, store });
      ```
    - Files to Create/Edit:
      - `packages/hosts/evals/src/__tests__/guardrail-arms.test.ts`: new (or under `apps/prism-agent/evals/` if the suite lives there; Task 1(f) decides)
      - `docs/_evidence/guardrails-2026-11.md`: new
      - `packages/extensions/guardrail-packs/README.md`: the measured section
      - `scripts/live-matrix.mjs`: a live row, if the matrix lists suites
    - References:
      - Plan 200 (injection suite)
  - Test Cases to Write:
    - `injection_markers_arm_catches_recorded_injections`: the deterministic arm's catch count is at or above the recorded floor.
    - `benign_items_stay_under_the_false_positive_ceiling`.
    - `evidence_file_matches_the_report`: counts in the file equal the run's.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no API; published claims
    - Docs pages to create/edit:
      - `packages/extensions/guardrail-packs/README.md`: measured rates with a link to the evidence
      - `CHANGELOG.md`: `## [Unreleased]`, Documentation
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun run --filter @arnilo/prism-extensions test`
- `bun run --filter @arnilo/prism-hosts test`
- `bun run --filter @arnilo/prism-agent test`
- `bun run security:threat-suites`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
