# Phase 19 Part K — structured output: a validated result, a prompted fallback, and repair

## Objectives

- Finish structured output. Today a host can pass `providerOptions.structuredOutput` and the request reaches a model that declares the capability (`assertStructuredOutputRequestSupported`, `src/provider-kit/structured-output.ts:59-68`), but:
  - the reply comes back as text: `RunResult` has no parsed or validated value (`src/contracts-run-state.ts:250`)
  - nothing checks the reply against the schema, and nothing asks the model to fix an invalid one
  - a model without the capability fails with an error that tells the host to "set loop.structuredOutputMode to "artifact-loop"" (`structured-output.ts:65`), an option that exists nowhere in the tree
  - two exported helpers for that never-built mode are unused (`withoutStructuredOutput`, `artifactStructuredOutputRequest`, `structured-output.ts:78-93`)

## Expected Outcome

- A run that asked for structured output returns `RunResult.output` (the parsed value) when the final reply parses and satisfies the schema, and `RunResult.outputError` (paths and messages) when it does not. `RunResult.text` is unchanged.
- `structuredOutput.mode`: `"native"` sends the schema to a capable model; `"prompted"` sends an instruction carrying the schema to any model; `"auto"` (default) picks native when the model declares it and prompted otherwise. An explicit `"native"` on an incapable model still fails closed, with a message that names `mode`.
- `structuredOutput.repair` (default 1, max 3): when the final reply is invalid, the run continues with one user message listing the violations, up to that many times.
- The stale error text and the two unused helpers are gone.

This plan implements roadmap **Phase 19 Part K**. It changes kernel contracts (`StructuredOutputOptions`, `RunResult`, the `run.end` primitive's behavior, two removed exports), so **Task 1 is the phase review**. It depends on plan 226 Task 2 (the tolerant schema validation mode). No version bump or publish.

Cost knobs: `repair` adds at most that many extra model turns, only when a reply is invalid; `repair: 0` disables it. Prompted mode adds the schema's size in input tokens per turn. Both are stated in `docs/models.md`.

## Tasks

- [ ] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line`:
      - (a) **The current path.** `StructuredOutputOptions` and `ProviderRequestOptions.structuredOutput` (`src/contracts-core/provider.ts:62-63`), `resolveRunProviderOptions` and the support check at run start (`src/agent-session/session/assemble.ts`, where `assertStructuredOutputRequestSupported` is called), how each codec serializes it (`src/provider-kit/codecs/*.ts`, `systemone*.ts`), and `ModelCapabilities.structuredOutput` values.
      - (b) **Callers of the two unused helpers and of `StructuredOutputError`**, in `src/`, `packages/`, `apps/`, `examples/`, and the compat baselines (`graft callers`).
      - (c) **Placement proof.** Whether validation, prompted mode, and repair can be a package: `model.request` can rewrite a request, and `run.end` can continue a run, but the support check throws before any hook runs, and `RunResult` is built by the kernel. The note states which parts must be kernel and why, or re-cuts Task 3 into a package if the proof fails.
      - (d) **How a tool-calling run ends with structured output.** Whether the schema is sent on every turn or only when no tool is called, per codec and provider, and what `provider-live-scenarios` already asserts (`liveScenarioStructuredOutput`, `src/testing/provider-live-scenarios.ts`).
      - (e) **`run.end` mechanics.** `RunController.end` and `queueContinuation` (`src/loop/run-controller.ts`, `src/agent-session/session/assemble.ts`), `maxContinuations`, and how a continuation's message is appended.
      - (f) **Existing users.** Packages and the reference host that request structured output today (advisor verdicts, evals judges, System One decisions), so their behavior does not change unasked.
    - Performance: n/a — read-only.
    - Code Quality: Findings are written against the task they change.
    - Security: Records that validation errors list paths and expected types, never reply content.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.1 (model core), Phase 5, Phase 18 (`generate()` + `structuredOutput` for decision models); `docs/models.md`, `docs/provider-kit.md`
      - `src/provider-kit/structured-output.ts`, `src/__tests__/structured-output.test.ts`
    - Options Considered:
      - Skip — rejected: (c) decides kernel versus package for Task 3.
    - Chosen Approach:
      - Inventory and the placement proof, then confirm or re-cut.
    - API Notes and Examples:
      ```bash
      graft callers withoutStructuredOutput --depth all
      graft callers assertStructuredOutputRequestSupported --depth all
      ```
    - Files to Create/Edit:
      - `plans/235-…md`: the task note
    - References:
      - Evaluation finding SO1
  - Test Cases to Write:
    - none — read-only
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: `RunResult.output` — parsed and validated; stale surface removed
  - Acceptance Criteria:
    - Functional:
      - When a run's resolved options carry `structuredOutput`, the kernel parses the final assistant text as JSON (tolerating one fenced code block around it) and validates it against the schema in the tolerant mode from plan 226.
        - Valid: `RunResult.output` holds the value.
        - Invalid or unparsable: `RunResult.outputError` holds `{ code: "invalid_json" | "schema_mismatch", errors: [{ path, message }] }`, capped at 8 entries. The run's `status` is unchanged.
      - `run.completed` carries `output` or `outputError` the same way.
      - The `unsupported_model` message no longer names `loop.structuredOutputMode`; until Task 3 lands it says the model does not declare the capability.
      - `withoutStructuredOutput` and `artifactStructuredOutputRequest` are deleted from `@arnilo/prism/provider-kit`; the names go into the retirement sweep.
      - A run without `structuredOutput` has neither field.
    - Performance: One parse and one validation per run end, bounded by `maxResponseBytes`.
    - Code Quality: The parse-and-validate step is one function used by the session's result builder; no codec changes.
    - Security: `outputError` carries paths and expected types only. `output` passes the session redactor like `text`.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session.ts` (`buildRunResult`), `session/persist.ts` (`persistSucceeded`), `src/contracts-run-state.ts:250-290`
      - `src/provider-kit/structured-output.ts`, `src/packages/schema.ts` (tolerant mode from plan 226)
      - `docs/agent.md` ("RunResult")
    - Options Considered:
      - Fail the run on an invalid reply — rejected: hosts that only want text would break; `outputError` lets the host decide.
      - Leave parsing to hosts — rejected: every host would write the same fence-stripping and validation.
    - Chosen Approach:
      - Parse and validate once, report both outcomes on the result.
    - API Notes and Examples:
      ```ts
      const result = await session.run(input, { providerOptions: { structuredOutput: { name: "verdict", schema } } });
      if (result.output !== undefined) use(result.output); else log(result.outputError);
      ```
    - Files to Create/Edit:
      - `src/contracts-run-state.ts`, `src/contracts-protocol.ts` (the event), `src/provider-kit/structured-output.ts`
      - `src/agent-session/session.ts`, `session/persist.ts`
      - `src/__tests__/structured-output.test.ts`
      - `bun scripts/release.mjs gate --update-baseline` (two removals attributed to this plan, two additions), `bun scripts/retired-names.mjs --generate`; the diff in the task note; `src/__tests__/public-export-contract.test.ts`
    - References:
      - `src/provider-kit/structured-output.ts:59-93`
  - Test Cases to Write:
    - `valid_reply_sets_output`.
    - `fenced_json_reply_is_parsed`.
    - `schema_mismatch_sets_output_error_with_paths`.
    - `unparsable_reply_sets_invalid_json`.
    - `run_without_structured_output_has_neither_field`.
    - `output_error_contains_no_reply_content`.
    - `unsupported_model_message_names_no_missing_option`.
    - `no_retired_name_in_live_tree` stays green after the two removals.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — two result fields, an event field, two removed exports
    - Docs pages to create/edit:
      - `docs/agent.md`: `RunResult.output`, `outputError`
      - `docs/events.md`: `run.completed`
      - `docs/provider-kit.md`: the removed helpers
      - `CHANGELOG.md`: `## [Unreleased]`, Added and Removed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: Prompted fallback and repair
  - Acceptance Criteria:
    - Functional:
      - `StructuredOutputOptions.mode?: "auto" | "native" | "prompted"` (default `"auto"`).
        - `native` on a model without the capability throws `StructuredOutputError("unsupported_model")` before any provider call, naming `mode: "prompted"` as the alternative.
        - `prompted` removes `structuredOutput` from the provider request and adds one instruction block, at the stable-prefix boundary, that carries the schema name and canonical JSON and asks for a single JSON object with no prose. The block is byte-identical across turns of a run.
        - `auto` resolves per run from the run's model.
      - `StructuredOutputOptions.repair?: number` (0–3, default 1). At `RunController.end`, after the `run.end` hook has declined to continue, an invalid final reply (Task 2's check) queues one user message listing the violations and re-enters the loop, at most `repair` times per run. Repairs are counted separately from `maxContinuations`.
      - A run whose reply is still invalid after the repairs ends normally with `outputError`.
      - Repair fires from the `end` primitive, so it applies to the default loop and to any custom loop that calls `run.end()`.
      - Existing callers Task 1(f) lists keep their behavior: a package that must not get repair turns passes `repair: 0`, set in this task where needed.
    - Performance: Stated above: at most `repair` extra turns, only on an invalid reply; the prompted block costs its size once per request and is cache-stable.
    - Code Quality: Mode resolution lives beside `assertStructuredOutputRequestSupported`; the instruction text is one constant.
    - Security: The schema in the prompted block is host-authored; the repair message contains paths and expected types, not the model's previous reply.
  - Approach:
    - Documentation Reviewed:
      - `src/loop/run-controller.ts` (`end`, `queueContinuation`), `src/loop/request-draft.ts` (`withContextMessages`, the stable-prefix boundary), `src/provider-kit/schema.ts` (`canonicalizeJsonSchema`)
      - `src/testing/prefix-stability-conformance.ts`, `src/testing/loop-conformance.ts`
      - Task 1(c)–(e)
    - Options Considered:
      - A synthetic "submit" tool whose parameters are the schema — rejected: the kernel would generate a second built-in tool, and a model without tool support gains nothing.
      - Constrained decoding in provider packages — rejected: no supported gateway route exposes it uniformly.
      - A separate package — rejected if Task 1(c) holds: the support check and the result are kernel code, and a package could not reach either.
    - Chosen Approach:
      - A prompted mode in the model core and a bounded repair in the `end` primitive.
    - API Notes and Examples:
      ```ts
      await session.run(input, {
        providerOptions: { structuredOutput: { name: "plan", schema, mode: "auto", repair: 1 } },
      });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/provider.ts` (or where `StructuredOutputOptions` is declared), `src/provider-kit/structured-output.ts`
      - `src/agent-session/session/assemble.ts`, `src/loop/run-controller.ts`
      - `src/testing/loop-conformance.ts`: a repair case
      - `src/__tests__/structured-output.test.ts`
      - `packages/extensions/advisor/src/…`, `packages/hosts/evals/src/…`: `repair: 0` where Task 1(f) requires it
      - `examples/structured-output.ts`: new, on the mock provider (invalid first reply, repaired second); `examples/README.md`, `scripts/e2e-coverage.json`
      - `scripts/compat-baseline/*.txt`: regenerated, additive diff in the task note
    - References:
      - Plan 226 Task 2; `src/provider-kit/structured-output.ts:59-68`
  - Test Cases to Write:
    - `auto_uses_native_for_a_capable_model_and_prompted_otherwise`.
    - `explicit_native_on_incapable_model_fails_closed_naming_mode`.
    - `prompted_block_is_byte_identical_across_turns`: `prefix-stability-conformance` passes.
    - `invalid_reply_is_repaired_once_by_default`.
    - `repair_zero_never_continues`.
    - `repair_is_bounded_and_ends_with_output_error`.
    - `repair_message_carries_no_reply_content`.
    - `repair_fires_on_a_custom_loop_through_run_end`.
    - `repairs_do_not_consume_max_continuations`.
    - `examples_demos_run_to_completion_and_emit_no_secret` covers the example.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — two option fields and run-end behavior
    - Docs pages to create/edit:
      - `docs/models.md`: "Structured output" (modes, repair, cost)
      - `docs/loop.md`: what `run.end()` does after the hook
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/structured-output.test.ts`
- `bun run --filter @arnilo/prism-extensions test`
- `bun run --filter @arnilo/prism-hosts test`
- `bun run --filter @arnilo/prism-agent test`
- `bun scripts/retired-names.mjs`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
