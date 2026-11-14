# Phase 19 Part B — tool dispatch: argument validation by default, interruptible tools, timeouts, and parallel rounds

## Objectives

- Validate tool arguments against the tool's own `parameters` schema before the tool runs. Today validation is an optional host callback (`src/tools.ts:293`, `AgentConfig.validator`), and probe `p3-validate` ran a tool with `{ path: 123, bogus: true }` against a schema that requires a string and forbids extra keys. `PRODUCT.md` says the registry validates.
- Make a tool call end when the run is aborted or a time limit passes. `tool.execute` is awaited with no race (`src/tools.ts:326`); probe `p4-hang` returned after 4,014 ms under `maxWallTimeMs: 300`.
- Run the independent tool calls of one model turn at the same time. The default loop passes no concurrency, and the controller defaults to `1` (`src/loop/run-controller.ts:282`), so several `delegate` or `read` calls in one turn run back to back.

## Expected Outcome

- A call whose arguments do not satisfy `parameters` is blocked with `reason: "invalid_arguments"` and a result naming each failing path; the tool never runs. A host `validator` still runs after the built-in check.
- An aborted run, a passed wall limit, or a passed per-tool timeout settles the running call within one event-loop turn: `tool.completed { status: "error" }` with `error.code` `tool_aborted` or `tool_timeout`. The tool's promise is detached and its late outcome dropped.
- `AgentConfig.tools.concurrency` (default `4`, `1` restores serial) bounds how many calls of one round run at once. A round with an `exclusive` tool, or with a tool that declares no `effects`, stays serial. Results are appended in call order.

This plan implements roadmap **Phase 19 Part B** (written by plan 225 Task 2). It changes kernel contracts (dispatch behavior, a `ToolDefinition` field, a run limit, an `AgentConfig` field, two error codes), so **Task 1 is the phase review**. It runs after plan 225 and the 0.14.0 publish. No version bump or publish.

Cost knobs: validation is one in-memory pass per call with no model call; parallel rounds add no requests. Both are on by default; `tools.validation: "off"` and `tools.concurrency: 1` restore the 0.14.0 behavior and are documented in `docs/tools.md`.

## Tasks

- [ ] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line`:
      - (a) **Schema coverage.** Every keyword used in a `parameters` schema of a first-party tool (`packages/tools/*`, `packages/extensions/*`, the kernel's `load_skill`), checked against the kernel subset (`JsonSchema`, `src/packages/schema.ts:9-33`; `assertJsonSchemaSupported`, `:137`). Which first-party tools would fail today's subset, and which keywords an MCP server's tools use in the recorded fixtures (`packages/extensions/mcp/src/__tests__`).
      - (b) **Existing argument checks.** `call.argumentsError` and the object check (`checkCall`, `src/tools.ts`), the `validate` seam (`:293`), `createToolParameterValidator` (`:60`), and every host or package that sets `AgentConfig.validator` or `RunOptions.validate`.
      - (c) **Abort and the effect store.** What `dispatchToolCall` does when `execute` rejects after `markDispatched` (`finishUnknownEffect`, `src/tools.ts`), so a timed-out call with a dispatched effect is reported as unknown, not failed.
      - (d) **Which tools ignore their signal.** A grep of first-party `execute` bodies for `context.signal`, to size the detached-promise case.
      - (e) **Concurrency today.** `dispatchToolCallsInOrder` (`src/loop/dispatch.ts:26-90`), `isToolCallExclusive` (`src/agent-session/session/assemble.ts`), every `exclusive:` declaration, and every first-party tool with no `effects`. Whether `tool.call` gating, `ask` collection and suspension stay per round (`src/loop/run-controller.ts:253-300`).
      - (f) **Shared mutable run state touched by a tool call**: `ctx.toolResults`, `activeRecentToolCalls`, `tailSegments`, `loadedSkills`, package state appends (`serialAppend`).
    - Performance: n/a — read-only.
    - Code Quality: Findings that change Tasks 2–4 are written against the task they change.
    - Security: Records whether any first-party tool relies on kernel validation never rejecting (a tool that repairs malformed arguments itself, such as `edit`'s `prepareEditArguments`).
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.5 (`executeTools`), §2.6 (tools); `docs/tools.md`, `docs/loop.md`
      - `src/tools.ts`, `src/loop/dispatch.ts`, `src/packages/schema.ts`
    - Options Considered:
      - Skip — rejected: (a) decides whether the kernel subset is enough or must grow, and (c) decides the timeout result.
    - Chosen Approach:
      - Inventory, then confirm or re-cut Tasks 2–4.
    - API Notes and Examples:
      ```bash
      graft grep "parameters:" --in packages/tools/
      graft callers dispatchToolCall --depth all
      ```
    - Files to Create/Edit:
      - `plans/226-…md`: the task note
    - References:
      - Evaluation probes `p3-validate`, `p4-hang`
  - Test Cases to Write:
    - none — read-only
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Tool arguments are validated against `parameters` by default
  - Acceptance Criteria:
    - Functional:
      - Before `beforeExecute`, the kernel validates `call.arguments` against `tool.parameters` with the kernel schema validator. A failure returns the existing blocked shape with `reason: "invalid_arguments"` and one message per failing path, capped at 8 paths and 1 KiB.
      - A tool with no `parameters` accepts any JSON object, as today.
      - A schema keyword outside the kernel subset is ignored for that subschema and the rest is still checked; registration adds one `info` status note naming the tool and the keyword. This is the tool-argument mode only: package config validation stays fail-closed on unknown keywords.
      - `additionalProperties` follows the schema as written: absent means allowed here (JSON Schema's default), unlike package config.
      - `AgentConfig.tools.validation`: `"schema"` (default) or `"off"`. `AgentConfig.validator` and `RunOptions.validate` run after the built-in check and can still reject.
      - A tool can opt out with `ToolDefinition.validateArguments: false` when it repairs its own arguments (Task 1's Security finding lists the first-party ones, and they set it in this task).
      - `PRODUCT.md`'s "schema validation" sentence is now true and stays as written.
    - Performance: One pass over the arguments per call; schemas are compiled once per registry build, not per call. A 256 KiB argument object validates in under 5 ms on the repo's benchmark machine class (`scripts/benchmark-session-turn.test.mjs` budget style).
    - Code Quality: The tolerant mode is one option on the existing validator (`validateJsonSchema`), not a second validator.
    - Security: The failure message carries paths and expected types, never argument values.
  - Approach:
    - Documentation Reviewed:
      - `src/packages/schema.ts:137`, `:372`; `src/tools.ts:60-76`, `:252-300`
      - `src/agent-session/session/assemble.ts:371` (where `validate` is resolved)
      - `docs/tools.md`, `PRODUCT.md` ("Tools and skills")
    - Options Considered:
      - Add a full JSON Schema validator dependency — rejected: the kernel has no runtime dependencies (roadmap §1.4).
      - Reject a tool whose schema uses an unsupported keyword — rejected: MCP servers' schemas are not ours to change.
      - Leave validation to hosts and fix the sentence in `PRODUCT.md` — rejected: the owner asked for the defect fixed.
    - Chosen Approach:
      - Kernel subset validator in a tolerant mode, on by default, with a per-agent and per-tool switch.
    - API Notes and Examples:
      ```ts
      createAgent({ model, tools: { add: [tool], validation: "schema" } });
      // blocked result
      { toolCallId, name, error: { code: "invalid_arguments", message: "path: expected string; bogus: not allowed" } }
      ```
    - Files to Create/Edit:
      - `src/packages/schema.ts`: tolerant mode and a compiled form
      - `src/tools.ts`: built-in check in `dispatchToolCall`; `ToolDefinition.validateArguments`
      - `src/contracts-protocol.ts`, `src/contracts-core/agent.ts`: the two fields
      - `src/agent-session/session/assemble.ts`: resolve the mode
      - `packages/tools/coding/src/agent/edit.ts` and the other tools Task 1 names: `validateArguments: false`
      - `src/testing/tool-conformance.ts`: a schema-violation case
      - `scripts/compat-baseline/*.txt`: regenerated (`bun scripts/release.mjs gate --update-baseline`), additive diff in the task note
    - References:
      - Probe `p3-validate`
  - Test Cases to Write:
    - `schema_invalid_arguments_block_the_call`: the probe's arguments; `execute` is never called.
    - `validation_reports_paths_not_values`: a secret-shaped argument value does not appear in the result or event.
    - `tool_without_parameters_accepts_any_object`.
    - `unsupported_keyword_is_ignored_and_noted`: a `$ref` schema still checks `required`.
    - `validation_off_restores_previous_behavior`.
    - `host_validator_runs_after_the_builtin_check`.
    - `tool_can_opt_out`: `edit` still accepts `edits` as a JSON string.
    - `custom_loop_gets_the_same_validation`: through `executeTools` on a `slot:loop` loop.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a default behavior and two fields
    - Docs pages to create/edit:
      - `docs/tools.md`: "Argument validation" (subset, tolerant mode, switches)
      - `docs/agent.md`: `tools.validation`
      - `CHANGELOG.md`: `## [Unreleased]`, Changed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: A tool call ends on abort, wall limit, or its own timeout
  - Acceptance Criteria:
    - Functional:
      - `tool.execute` is raced against the run signal. On abort the call settles at once with `error.code: "tool_aborted"`; a wall-limit abort still produces the run's single `run.failed { limit: "maxWallTimeMs" }`.
      - `ToolDefinition.timeoutMs` and `RunLimits.maxToolTimeMs` (default `null`, narrowing like every policy axis) bound one call. The smaller applies. On expiry: `error.code: "tool_timeout"`, and the tool's `context.signal` is aborted so a cooperative tool stops its work.
      - The tool's promise is detached: a late resolution is dropped, a late rejection is swallowed, and neither emits an event.
      - A call with a claimed durable effect that had been marked dispatched settles through the existing unknown-effect path (`ERR_PRISM_TOOL_EFFECT_UNKNOWN`), never as a clean failure.
      - A timed-out or aborted call still gets exactly one tool result (plan 225 Task 4's guarantee).
    - Performance: No timer is armed for a call with no timeout; one `setTimeout` per call otherwise, cleared on settle.
    - Code Quality: The per-call signal is a child of the run signal; tools keep reading `context.signal`.
    - Security: A tool cannot extend its own deadline; `timeoutMs` above `maxToolTimeMs` is clamped.
  - Approach:
    - Documentation Reviewed:
      - `src/tools.ts:300-370` (execute and the effect paths), `src/run-limits.ts` (`RunLimits`, `charge`), `src/contracts-core/run-limits.ts`
      - `docs/tools.md`, `docs/agent.md` (limits)
    - Options Considered:
      - Rely on tools honoring `signal` — rejected: the probe shows a tool that does not.
      - A default timeout for every tool — rejected: a synchronous `delegate` call legitimately runs for minutes; the wall limit already bounds the run once the race exists.
    - Chosen Approach:
      - Always race the abort; add opt-in timeouts at the tool and run level.
    - API Notes and Examples:
      ```ts
      const tool: ToolDefinition = { name: "probe", timeoutMs: 30_000, /* … */ };
      createAgent({ model, limits: { maxToolTimeMs: 120_000 } });
      ```
    - Files to Create/Edit:
      - `src/tools.ts`: the race, the per-call signal, the two results
      - `src/contracts-protocol.ts` (`ToolDefinition.timeoutMs`), `src/contracts-core/run-limits.ts`, `src/run-limits.ts` (`maxToolTimeMs`, not a counter axis)
      - `src/__tests__/tool-interruption.test.ts`: new
      - `scripts/compat-baseline/*.txt`: regenerated, additive diff in the task note
    - References:
      - Probe `p4-hang`
  - Test Cases to Write:
    - `wall_limit_ends_a_tool_that_ignores_its_signal`: the probe; the run returns within 100 ms of the limit.
    - `session_abort_settles_the_running_call`.
    - `tool_timeout_settles_and_aborts_the_tool_signal`.
    - `run_limit_clamps_tool_timeout`.
    - `late_tool_outcome_is_dropped`: no event after settlement, no unhandled rejection.
    - `dispatched_effect_timeout_is_unknown_not_failed`.
    - `aborted_call_has_exactly_one_result`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — two codes, a tool field, a limit
    - Docs pages to create/edit:
      - `docs/tools.md`: "Interruption and timeouts", including the detached-promise caveat for tool authors
      - `docs/agent.md`: `limits.maxToolTimeMs`
      - `CHANGELOG.md`: `## [Unreleased]`, Fixed and Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Independent tool calls of one round run in parallel
  - Acceptance Criteria:
    - Functional:
      - `AgentConfig.tools.concurrency` (integer 1–16, default `4`) and `RunOptions.tools.concurrency` (narrowing only) set the round's concurrency. The default loop passes it to `executeTools`; a custom loop's explicit `options.concurrency` still wins.
      - A round is serial when any call's tool is `exclusive`, or declares no `effects` (unknown effects fail closed to serial).
      - `tool.call` gating, `ask` collection, and suspension are unchanged: the whole round is gated before any call starts.
      - Results are appended in call order; `tool.started` / `tool.completed` events may interleave across calls and each carries its `toolCallId`.
      - A failure in one call does not cancel its siblings, except a run-control error (limit breach, suspension, abort), which stops the round and settles the rest (plan 225 Task 4).
      - The shared run state Task 1(f) lists is safe under interleaving; each item is either made order-independent or guarded, and the task note says which.
    - Performance: Four 200 ms tool calls in one round finish in under 300 ms (was 800 ms). The task note records the before and after of `scripts/benchmark-multi-agent.test.mjs`.
    - Code Quality: No second dispatcher; the existing concurrent path of `dispatchToolCallsInOrder` is the one used.
    - Security: Concurrency never widens what runs: a denied or pending call is not dispatched in either mode.
  - Approach:
    - Documentation Reviewed:
      - `src/loop/dispatch.ts:26-90`, `src/loop/default-loop.ts`, `src/loop/run-controller.ts:253-300`
      - `packages/tools/coding/src/agent/file-mutation-queue.ts` (per-path serialization), every `exclusive:` site from Task 1(e)
      - `docs/loop.md`, `docs/tools.md`
    - Options Considered:
      - Parallel only for `effects: ["read"]` — rejected: `delegate` and `web_fetch` are the calls that gain most, and tools already declare `exclusive` where order matters.
      - Unbounded concurrency — rejected: a 30-call round would open 30 processes or requests.
    - Chosen Approach:
      - A bounded default with the existing `exclusive` rule and a fail-closed rule for undeclared effects.
    - API Notes and Examples:
      ```ts
      createAgent({ model, tools: { concurrency: 4 } });
      await session.run(input, { tools: { concurrency: 1 } });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts`, `src/contracts-run-state.ts` (or where `RunOptions.tools` lives): the field
      - `src/loop/default-loop.ts`, `src/loop/types.ts`, `src/loop/run-controller.ts`: the default concurrency reaches `executeTools`
      - `src/agent-session/session/assemble.ts`: resolve the value; the undeclared-effects rule in `isToolCallExclusive`
      - `src/agent-session/session/tool-round.ts`: guards from Task 1(f)
      - `apps/prism-agent/src/host/*.ts`: no change expected; the host suite must stay green
      - `examples/parallel-tools.ts`: new, on the mock provider; `examples/README.md`, `scripts/e2e-coverage.json`
      - `scripts/compat-baseline/*.txt`: regenerated, additive diff in the task note
    - References:
      - Evaluation finding K2; `packages/extensions/delegate/src/tools.ts:102`
  - Test Cases to Write:
    - `round_runs_non_exclusive_calls_concurrently`: overlap observed by start and finish timestamps.
    - `exclusive_tool_makes_the_round_serial`.
    - `undeclared_effects_make_the_round_serial`.
    - `results_append_in_call_order_under_concurrency`.
    - `one_failing_call_does_not_cancel_siblings`.
    - `limit_breach_mid_round_settles_remaining_calls`.
    - `concurrency_one_restores_serial_order_of_events`.
    - `two_sync_delegate_calls_overlap`: in `packages/extensions/delegate`.
    - `examples_demos_run_to_completion_and_emit_no_secret` covers `examples/parallel-tools.ts`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a default and a config field
    - Docs pages to create/edit:
      - `docs/tools.md`: "Parallel rounds" (rules, event interleaving, how a tool author opts out with `exclusive`)
      - `docs/loop.md`: the default loop's concurrency
      - `docs/agent.md`: `tools.concurrency`
      - `packages/extensions/delegate/README.md`: sync calls now overlap
      - `CHANGELOG.md`: `## [Unreleased]`, Changed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/tool-interruption.test.ts src/__tests__/tools.test.ts`
- `bun run --filter @arnilo/prism-tools test`
- `bun run --filter @arnilo/prism-extensions test`
- `bun run --filter @arnilo/prism-agent test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
