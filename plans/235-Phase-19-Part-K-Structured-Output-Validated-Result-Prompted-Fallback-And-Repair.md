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

- [x] Task 1: Phase review (read-only)
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
  - Notes (executed 2026-11-17):
    - **(a) Current path.**
      - Contracts: `StructuredOutputOptions { name, schema, strict? }` (`src/contracts-core/provider.ts:48-52`); `ProviderRequestOptions.structuredOutput` (`provider.ts:74-75`); `ModelCapabilities.structuredOutput?: boolean | "json_schema"` (`src/contracts-core/content.ts:166-167`). `modelSupportsStructuredOutput` (`src/provider-kit/structured-output.ts:26-29`) accepts `true` or `"json_schema"`.
      - Run start: `resolveRunProviderOptions` (`structured-output.ts:70-75`) merges agent and run `providerOptions` at `src/agent-session/session/assemble.ts:385`. `assertStructuredOutputRequestSupported(runModel, providerOptions)` runs at `assemble.ts:387`, once per run, before the loop or any hook. The same `providerOptions` goes into every turn's request (`assemble.ts:482` → `src/input.ts:282`, `options: options.providerOptions`).
      - Codecs (each one checks the request again):
        - OpenAI Chat: `openAIChatBody` asserts (`src/provider-kit/codecs/openai-chat.ts:171`), then `applyOpenAIChatStructuredOutput` sets `response_format: { type: "json_schema", json_schema }` (`openai-chat.ts:277`, `src/provider-kit/openai-primitives.ts:19-33`).
        - Responses: asserts (`codecs/openai-responses.ts:108`); `resolveResponsesStructuredOutput` builds `text.format = { type: "json_schema", name, strict, schema }` (`openai-responses.ts:222-232`).
        - Anthropic Messages: asserts (`codecs/anthropic-messages.ts:92`) but **never serializes the schema**. See finding F1.
        - Ollama Cloud native: asserts (`packages/providers/ollama-cloud/src/native.ts:49`) and sends `format = schema` (`native.ts:64`). It buffers text when structured (`native.ts:164`).
        - System One: `requireStructuredOutput` (`src/provider-kit/systemone-provider.ts:162-172`) requires the option and compiles the schema to questions (`systemone-provider.ts:84`). Decision models only, reached through `generate()`.
      - Capability values in use: static `"json_schema"` on featured models (Command Code, Kilo, Ollama Cloud, OpenAI Codex, Laya, Liquid, Typesafe). Discovery-derived values:
        - OpenRouter: `structured_outputs` param (`packages/providers/openrouter/src/models.ts:53`)
        - Kilo: `structured_outputs` or `response_format` param, **any route** (`packages/providers/kilo/src/models.ts:107`)
        - LiteLLM: `supports_response_schema` (`packages/providers/litellm/src/models.ts:111`)
        - OpenCode Go: a verified allow-list of `openai`-route models only (`packages/providers/opencode-go/src/models.ts:189-197`)
    - **(b) Callers.**
      - `withoutStructuredOutput` and `artifactStructuredOutputRequest`: no production caller (`graft callers --depth all`).
        - Live references: `src/__tests__/structured-output.test.ts:4,10,49-72`; the export lists in `src/__tests__/provider-kit.test.ts:126,246` and `src/__tests__/public-export-contract.test.ts:654,774`; the compat baseline `scripts/compat-baseline/arnilo__prism.txt:1006,1126`; and the host-builder API index `packages/hosts/host-builder/data/api.json:859,979`, generated by `scripts/host-builder-index.mjs`.
        - Nothing in `apps/` or `examples/` uses them.
      - Stale "artifact-loop" text: `structured-output.ts:65` and the doc comment at `packages/providers/opencode-go/src/models.ts:193`.
      - `StructuredOutputError` is thrown only in `structured-output.ts` (`:33-65`), is asserted in `structured-output.test.ts:19-35`, is listed in both export tests and baseline line 956, and is documented at `docs/provider-kit.md:456`. Its `code` union (`invalid_schema | unsupported_model | schema_too_large | invalid_name`) is in the baseline. It stays.
    - **(c) Placement proof (holds; Task 3 stays kernel).**
      - The support check throws at `assemble.ts:387`. That is before `RunController.turn` runs any `model.request` transform (`src/hooks/types.ts:187`; the transforms run in the controller, as `assemble.ts:533` notes). No hook can change run options before that line, so a package cannot change mode or downgrade an incapable model. Mode resolution must be kernel, beside the check.
      - `RunResult` is built by `session.buildRunResult` (`src/agent-session/session.ts:896-930`), and `run.completed` is emitted inside `persistSucceeded` (`src/agent-session/session/persist.ts:259-267`). No hook adds fields to either, so validation must be kernel.
      - Repair can be partly expressed as a `run.end` hook, but only with problems:
        - it would consume `maxContinuations` (default 3, `src/run-limits.ts:46`)
        - it would race other `run.end` hooks ("the first continue wins", `src/hooks/types.ts:155-159`)
        - it could not run "after the hook declined"
        The separate counter and that ordering both need the `end` primitive, so repair is kernel. The prompted instruction block also depends on kernel mode resolution and the stable-prefix boundary in the request draft.
    - **(d) Tool-calling runs.**
      - The schema is sent on **every** turn, tool rounds included: `providerOptions` goes into every assembled request (`input.ts:282`). Chat sends `response_format` next to `tools`, Responses sends `text.format` next to `tools`, and Ollama native sends `format` next to `tools`.
      - No codec drops the schema on turns that may call tools. No test or live scenario covers tools combined with structured output.
      - `liveScenarioStructuredOutput` (`src/testing/provider-live-scenarios.ts:418-481`) makes one toolless provider request. It asserts that the reply text `JSON.parse`s to an object, and it accepts an `error` terminal as a "documented rejection". It does no schema validation.
      - Consequence for Task 2: validate only the final assistant message, the one `buildRunResult` already selects (`finalAssistantMessage`), after the loop ends with no pending tool calls. Consequence for Task 3: the prompted instruction must say the JSON object is the **final** answer, so tool calls stay allowed.
    - **(e) `run.end` mechanics.**
      - `RunController.end` (`src/loop/run-controller.ts:478-499`) works in this order:
        1. It calls `decide("run.end", { history, turn, continuations, finishReason, usage })`.
        2. If no `continue` has a non-empty `reason`, it returns `{ continue: false }`.
        3. At the cap (`maxContinuations`, `run-controller.ts:81`, resolved at `assemble.ts:622`; `null` = uncapped), it sets `finishReason "hook_limit"`, which makes the result status `stopped`, and returns false.
        4. Otherwise it increments the local `continuations` counter (`run-controller.ts:143`), calls `internals.queueContinuation(asked)`, and clears `nextInput`.
      - `queueContinuation` (`assemble.ts:630-644`) builds `{ role: "user", text: reason }`, plus an optional `steer` message, and calls `session.steer(messages)`. That is the host steer path: redaction, 8 messages, 64 KiB. A failure throws `HookError("run.end continuation could not be queued")`.
      - The default loop calls `run.end()` once its inner turn loop ends with no tool calls and no steer, and re-enters while `continue` is true (`src/loop/default-loop.ts:12-27`).
      - Both counters live in `createRunController`, so a durable resume resets them. Task 3's repair counter will behave the same way.
    - **(f) Existing users** (all unaffected by Task 2's result fields; only the memory benchmark judge reaches repair):
      - **Advisor**: one raw `client.generate` with no `structuredOutput` (`packages/extensions/advisor/src/consult.ts:14-29`). The verdict is parsed from text (`advisor/src/verdict.ts:16`). It never runs a session loop, so repair cannot apply. **No `repair: 0` needed.**
      - **Evals rubric judge**: a toolless session with no `providerOptions`. JSON is requested in the prompt and checked by its own `validateJsonSchema` (`packages/hosts/evals/src/rubric-judge.ts:147-164`). **No `repair: 0` needed.**
      - **System One decisions**: `generate()` through `ModelClient`/`decisions()`, not `session.run`, so neither Task 2 nor Task 3 applies. The same holds for `createOllamaCloudProvider.generate` (`packages/providers/ollama-cloud/src/provider.ts:84`) and the host-builder `decision-models.ts` example.
      - **The only session-run user is `scripts/memory-bench/run.mjs:611`**, which passes `judgeProviderOptions(labels)` (`scripts/memory-bench/judge.mjs:119-132`) to capable judges; text-mode judges skip it. With the default `repair: 1`, an invalid verdict would add a judge turn and change cost and verdicts, so `judgeProviderOptions` must set `repair: 0`. Task 3 is amended.
    - **Security.** The tolerant compiler from plan 226 Task 2 is `compileToolSchema` (`src/packages/schema.ts:474-500`). Its `validate()` returns at most 8 `SchemaError`s with path and message and "never carries an argument value" (`schema.ts:477`). Built on it, `outputError` and the repair message list paths and expected types only, never reply content.
    - **Findings against later tasks:**
      - **T2-1:** `buildRunResult` has four call sites: `assemble.ts:841`, `assemble.ts:887`, `persist.ts:268`, and the `session/types.ts:126` declaration. Compute `output`/`outputError` only on the succeeded path (`persistSucceeded`), where `run.completed` is also emitted, and pass the result through `buildRunResult`'s input. Failed, aborted, and suspended results carry neither field. Use `compileToolSchema(schema).validate(value)` for the tolerant check.
      - **T2-2:** The removal touches more files than Task 2 listed: `src/__tests__/provider-kit.test.ts`, the two helper tests in `structured-output.test.ts`, `packages/hosts/host-builder/data/api.json` (regenerate with `scripts/host-builder-index.mjs`), and the stale "artifact-loop" comment at `packages/providers/opencode-go/src/models.ts:193`. Task 2 is amended.
      - **F1 (Task 3):** the Anthropic Messages codec passes the support check but drops the schema (`anthropic-messages.ts:91-144`). Kilo discovery stamps `structuredOutput` on any route, including `messages` (`kilo/src/models.ts:107`). A `messages`-route model can therefore declare the capability, get native mode, and silently receive no schema. Task 3 fixes this: Kilo declares the capability on `chat`/`responses` routes only, and the Anthropic codec fails closed on `structuredOutput` (`unsupported_model`) so `auto` never picks native for it. Task 3 is amended.
      - **T3-1:** Repair needs a new `RunControllerInternals` member (for example `structuredOutputRepair(): string | undefined`, which returns the violation message or nothing). `end` calls it after the hook declines and before returning `{ continue: false }`, and queues the message with `queueContinuation({ reason })` without touching `continuations`.

- [x] Task 2: `RunResult.output` — parsed and validated; stale surface removed
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
      - `src/__tests__/structured-output.test.ts` (drop the two helper tests), `src/__tests__/provider-kit.test.ts` (export list)
      - `packages/hosts/host-builder/data/api.json` (regenerate via `scripts/host-builder-index.mjs`); `packages/providers/opencode-go/src/models.ts:193` (stale "artifact-loop" comment) — Task 1 finding T2-2
      - Compute on the succeeded path only (`persistSucceeded`), validating with `compileToolSchema` — Task 1 finding T2-1
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
  - Notes (executed 2026-11-17):
    - **What changed.**
      - Contracts:
        - `RunResult.output?: unknown` and `RunResult.outputError?: RunOutputError` (`src/contracts-run-state.ts`).
        - `RunOutputError { code: "invalid_json" | "schema_mismatch", errors: { path, message }[] }` and `MAX_RUN_OUTPUT_ERRORS = 8`, in the same file.
        - `run.completed` carries the same two fields (`src/contracts-protocol.ts`).
      - `parseStructuredOutput(text, options)` (`src/provider-kit/structured-output.ts`) is the single parse-and-validate step:
        - It trims the reply, strips one surrounding ```` ```lang ```` fence, and calls `JSON.parse`. Validation uses `compileToolSchema(schema).validate`, the tolerant mode.
        - An unparsable reply gives one fixed entry, `{ path: "", message: "reply is not valid JSON" }`. The engine's parse message is dropped because it can quote the reply.
        - Paths are JSON pointers (`/title`), the `SchemaError` format.
      - `buildRunResult` takes an optional `structuredOutput` input (`src/agent-session/session.ts`, declared in `session/types.ts`). It parses `finalAssistantMessage(history).text`, which is the stored, redacted text, so `output` is redacted the same way `text` is.
      - Only `persistSucceeded` (`session/persist.ts`) passes `ctx.providerOptions.structuredOutput`. It now builds the result before it emits `run.completed`, so the event and the result carry the same fields. Failed, aborted and suspended results never carry them.
      - The `unsupported_model` message now reads "does not declare the structuredOutput capability; choose a capable model".
      - Removed `withoutStructuredOutput` and `artifactStructuredOutputRequest`, together with their two tests and their entries in `provider-kit.test.ts` and `public-export-contract.test.ts`. Added `parseStructuredOutput` to both export lists.
      - Reworded the stale "artifact-loop" comment at `packages/providers/opencode-go/src/models.ts:193`.
      - Regenerated `packages/hosts/host-builder/data/api.json` with `scripts/host-builder-index.mjs`.
      - Docs:
        - `docs/agent.md`: a RunResult table row and the type index
        - `docs/events.md`: `run.completed`
        - `docs/provider-kit.md`: the structured-output helper row, with a note on the removal
        - `CHANGELOG.md`: Unreleased
    - **Tests.**
      - `src/__tests__/structured-output.test.ts` holds 10 tests: the 3 kept ones plus `unsupported_model_message_names_no_missing_option` and the six `RunResult.output` cases. These run real sessions on `mockProvider` with a `json_schema`-capable model. `schema_mismatch_sets_output_error_with_paths` also checks the 8-entry cap.
      - `provider-kit.test.ts`, `public-export-contract.test.ts`, `scripts/retired-names.test.mjs`, the agent-surface, run-checkpoint and event-source suites, and host-builder `lookup.test.ts` all pass.
      - `bun run typecheck` passes.
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`; lines attributed to this plan):
      ```
      -./provider-kit artifactStructuredOutputRequest  function artifactStructuredOutputRequest(request: ProviderRequest, schema?: StructuredOutputOptions): ProviderRequest   (removed, this plan)
      -./provider-kit withoutStructuredOutput          function withoutStructuredOutput(request: ProviderRequest): ProviderRequest                                          (removed, this plan)
      +./provider-kit parseStructuredOutput            function parseStructuredOutput(text: string, options: StructuredOutputOptions): { readonly output: unknown; } | { readonly outputError: RunOutputError; }
      +. RunOutputError                                interface RunOutputError { readonly code: "invalid_json" | "schema_mismatch"; readonly errors: readonly { readonly path: string; readonly message: string; }[]; }
      +. MAX_RUN_OUTPUT_ERRORS                         const MAX_RUN_OUTPUT_ERRORS = 8
      ~. RunResult                                     + output?: unknown; + outputError?: RunOutputError
      ~. AgentEventPayload                             run.completed + output?, outputError?
      ```
      There are three additions, not two: `MAX_RUN_OUTPUT_ERRORS` also reaches the root through `export type *`.
      The same regeneration also picked up export changes that other uncommitted plans had left in the working tree (compaction `maxChunks`, delegate constants, `Session.continue`, and others). They are not attributed here.
    - **Sweep.**
      - `bun scripts/retired-names.mjs --generate` added `withoutStructuredOutput` and `artifactStructuredOutputRequest` to `scripts/retired-names.json`.
      - `bun scripts/retired-names.mjs` reports 0 hits.
    - **Open items in the current tree** (not caused by this task, recorded for the whole-plan verification):
      - `release.mjs gate` reports that `@arnilo/prism-ai` needs a version bump, and that the kernel packed size, unpacked size and `sourceLines` exceed `budgets.json` (+169 lines, about 50 of them from this task). This plan does no bump. The budgets need a rebaseline, with a reason, when the uncommitted plans land.
      - `docs.test.ts` `examples_demos_run_to_completion_and_emit_no_secret` hit its 60 s test timeout (the tsc emit plus 25 sequential demos). Every listed demo exits 0 when run alone.
      - Three timing tests in the host-builder suite (`answers in under 50 ms`, `remote_conformance_*`) failed under the parallel workspace run and pass alone.
    - **Findings for Task 3:** repair can call `parseStructuredOutput(finalText, structuredOutput)` directly. It returns the same `{ path, message }` list the repair message needs, and that list carries no reply content.

- [x] Task 3: Prompted fallback and repair
  - Acceptance Criteria:
    - Functional:
      - `StructuredOutputOptions.mode?: "auto" | "native" | "prompted"` (default `"auto"`).
        - `native` on a model without the capability throws `StructuredOutputError("unsupported_model")` before any provider call, naming `mode: "prompted"` as the alternative.
        - `prompted` removes `structuredOutput` from the provider request and adds one instruction block, at the stable-prefix boundary, that carries the schema name and canonical JSON and asks for a single JSON object with no prose. The block is byte-identical across turns of a run.
        - `auto` resolves per run from the run's model.
      - `StructuredOutputOptions.repair?: number` (0–3, default 1). At `RunController.end`, after the `run.end` hook has declined to continue, an invalid final reply (Task 2's check) queues one user message listing the violations and re-enters the loop, at most `repair` times per run. Repairs are counted separately from `maxContinuations`.
      - A run whose reply is still invalid after the repairs ends normally with `outputError`.
      - Repair fires from the `end` primitive, so it applies to the default loop and to any custom loop that calls `run.end()`.
      - Existing callers Task 1(f) lists keep their behavior. Only `scripts/memory-bench/judge.mjs` (`judgeProviderOptions`) reaches repair; it passes `repair: 0`. Advisor and evals never send `structuredOutput` through a session run and are not touched.
      - The Anthropic Messages codec fails closed on `structuredOutput` (`unsupported_model`) instead of silently dropping it, and Kilo discovery declares `structuredOutput` only on `chat`/`responses` routes (Task 1 finding F1). `auto` therefore picks prompted mode for those models.
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
      - `scripts/memory-bench/judge.mjs`: `repair: 0` (Task 1(f)); `scripts/memory-bench/run.test.mjs` assertion
      - `src/provider-kit/codecs/anthropic-messages.ts`, `packages/providers/kilo/src/models.ts` + its test (Task 1 finding F1)
      - `src/loop/run-controller.ts` `RunControllerInternals`: a repair callback (Task 1 finding T3-1)
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
    - `anthropic_messages_codec_rejects_structured_output` and `kilo_messages_route_does_not_declare_structured_output` (F1).
    - `examples_demos_run_to_completion_and_emit_no_secret` covers the example.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — two option fields and run-end behavior
    - Docs pages to create/edit:
      - `docs/models.md`: "Structured output" (modes, repair, cost)
      - `docs/loop.md`: what `run.end()` does after the hook
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Notes (executed 2026-11-17):
    - **What changed.**
      - Contracts (`src/contracts-core/provider.ts`): `StructuredOutputMode = "auto" | "native" | "prompted"`, plus `StructuredOutputOptions.mode?` and `repair?`.
      - `src/provider-kit/structured-output.ts`:
        - `validateStructuredOutputOptions` rejects an unknown `mode` and a `repair` outside the integers 0–3 with a new code, `StructuredOutputError("invalid_option")`.
        - `resolveStructuredOutputRun(model, providerOptions)` resolves the mode once per run. `auto` picks native when the model declares the capability, prompted otherwise. An explicit `native` on an incapable model throws `unsupported_model`, and the message names `mode` and `"prompted"`. Prompted mode returns request options without `structuredOutput` plus the instruction text.
        - `structuredOutputInstruction(options)` is the single template: the schema name, then `JSON.stringify(canonicalizeJsonSchema(schema))`. It says the JSON object is the **final** answer, so tool calls stay allowed (Task 1(d)).
        - `structuredOutputRepairMessage(options, outputError)` lists each `path: message` and never includes reply content.
        - `assertStructuredOutputRequestSupported` (the codec check) now rejects `mode: "prompted"` with `invalid_option`, because a direct provider request supports native only. Its `unsupported_model` text now points at `mode: "prompted"`.
        - New constants: `DEFAULT_STRUCTURED_OUTPUT_REPAIRS = 1` and `MAX_STRUCTURED_OUTPUT_REPAIRS = 3`.
      - `src/agent-session/session/assemble.ts`:
        - `resolveStructuredOutputRun` replaces the run-start `assertStructuredOutputRequestSupported` call. It still runs before any provider call or hook.
        - Every turn's request gets `requestProviderOptions`. In prompted mode it also gets the block as `instructions: { label: "Output format", text }`. That is a system message right after the system and developer instructions, in the stable prefix and ahead of the context, skills and transcript, so it is byte-identical on every turn.
        - `ctx.providerOptions` keeps `structuredOutput`, so `persistSucceeded` validates the result in both modes.
      - Repair:
        - `RunControllerInternals.structuredOutputRepair?()` is a new member (finding T3-1). `RunController.end` calls it only after the `run.end` hook declined. A returned message is queued with `queueContinuation({ reason })`, which takes the same steer path, and `end` returns `{ continue: true }` without touching `continuations` or `maxContinuations`.
        - The session's implementation counts repairs in a run-local `structuredRepairs`. It parses `finalAssistantMessage(session.history).text` with `parseStructuredOutput`, and it returns nothing when a stop or limit has set `loopFinishReason`, so a stopped run is never repaired.
      - F1 fix:
        - `anthropicMessagesBody` throws `unsupported_model` on any `structuredOutput` instead of silently dropping it.
        - Kilo `mapKiloModel` declares `structuredOutput` only on non-`messages` routes. The existing catalog test's Claude-on-`messages` assertion now expects `false`.
        - No other provider declares the capability on a Messages route. Command Code's two featured `json_schema` models are on `openai` and `responses`.
      - `scripts/memory-bench/judge.mjs`: `judgeProviderOptions` passes `repair: 0`, and `run.test.mjs` asserts it.
      - `src/testing/loop-conformance.ts`: added `assertStructuredOutputRepair(strategy)`, exported from `@arnilo/prism/testing`.
      - `examples/structured-output.ts`: a mock model without the capability; the first reply misses `celsius`, one repair follows, and the second (fenced) reply lands in `output`. It is registered in `examples/README.md`, in the `docs.test.ts` demo list with an output assertion, and in `scripts/e2e-coverage.json`.
      - Docs:
        - `docs/models.md`: a new "Structured output" section covering the modes table, the F1 note, repair, and cost.
        - `docs/loop.md`: `end()`.
        - `docs/provider-kit.md`: the helper row.
        - `CHANGELOG.md`: Unreleased.
      - Regenerated `packages/hosts/host-builder/data/api.json` with `scripts/host-builder-index.mjs`.
      - **Task 2 leftover fixed here:** `src/__tests__/agent-surface-freeze.test.ts` `FROZEN_MEMBERS.RunResult` lacked `output` and `outputError`. `docs/agent.md` already listed them, so `agent_surface_is_frozen_for_phase_4` failed. Both members are added.
    - **Tests.**
      - `src/__tests__/structured-output.test.ts` now holds 19 tests, all passing: the 10 from Task 2 and the 9 listed for this task.
        - `prompted_block_is_byte_identical_across_turns` checks three tool-calling turns and runs `runPrefixStabilityConformance` with `mode: "prompted", repair: 0` (no resets).
        - `repair_fires_on_a_custom_loop_through_run_end` uses `assertStructuredOutputRepair` on a turn-then-end loop.
      - `anthropic_messages_codec_rejects_structured_output` is in `anthropic-messages.test.ts`; `kilo_messages_route_does_not_declare_structured_output` is in the kilo `package.test.ts`.
      - Task 2's invalid-reply cases still pass under the default `repair: 1`, because the mock provider repeats its last step.
      - Passing: `bun run typecheck`; `--filter @arnilo/prism-ai test` (301 pass); `--filter @arnilo/prism-hosts test`; `docs.test.ts` (69 pass, including the example); `provider-kit.test.ts` and `public-export-contract.test.ts`; `e2e-coverage.test.mjs`; `bun scripts/retired-names.mjs` (0 hits).
      - `scripts/memory-bench/run.test.mjs`: 125 of 126 passed. `markdown_store_write_amplification_within_budget` failed under load and passes alone.
      - `--filter @arnilo/prism-agent test`: `schedule.test.ts` timed out at 120 s under the parallel run and passes alone (4 pass). It does not use structured output.
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`; additive, all this plan):
      ```
      +. StructuredOutputMode                         type StructuredOutputMode = "auto" | "native" | "prompted"
      ~. StructuredOutputOptions                      + mode?: StructuredOutputMode; + repair?: number
      +./provider-kit DEFAULT_STRUCTURED_OUTPUT_REPAIRS  const DEFAULT_STRUCTURED_OUTPUT_REPAIRS = 1
      +./provider-kit MAX_STRUCTURED_OUTPUT_REPAIRS      const MAX_STRUCTURED_OUTPUT_REPAIRS = 3
      ~./provider-kit StructuredOutputError            code + "invalid_option"
      +./provider-kit StructuredOutputRunPlan          interface StructuredOutputRunPlan { instruction?; mode?: "native" | "prompted"; requestOptions }
      +./provider-kit resolveStructuredOutputRun       function resolveStructuredOutputRun(model: ModelConfig | undefined, options: ProviderRequestOptions | undefined): StructuredOutputRunPlan
      +./provider-kit structuredOutputInstruction      function structuredOutputInstruction(options: StructuredOutputOptions): string
      +./provider-kit structuredOutputRepairMessage    function structuredOutputRepairMessage(options: StructuredOutputOptions, error: RunOutputError): string
      +./testing assertStructuredOutputRepair          function assertStructuredOutputRepair(strategy: LoopStrategy): Promise<void>
      ```
    - **Sweep.** There are no removals in this task. `bun scripts/retired-names.mjs` reports 0 hits.

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/structured-output.test.ts`
- `bun run --filter @arnilo/prism-ai test`
- `bun run --filter @arnilo/prism-hosts test` (host-builder `api.json` regeneration)
- `bun test --timeout=0 scripts/memory-bench/run.test.mjs`
- `bun run --filter @arnilo/prism-agent test`
- `bun scripts/retired-names.mjs`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`

## Verification results (2026-11-17)

- Passing:
  - `bun run build:core` and `bun run typecheck`
  - `structured-output.test.ts`: 19 pass
  - `--filter @arnilo/prism-ai test`
  - `--filter @arnilo/prism-hosts test`
  - `docs.test.ts`
  - `bun scripts/retired-names.mjs`: 0 hits
- Flaky under load, pass alone:
  - `memory-bench/run.test.mjs`: one timing test
  - `--filter @arnilo/prism-agent test`: the `schedule.test.ts` timeout
- `bun run test` fails on tree-wide gates that also cover export, size and lint changes from the other uncommitted plans in the working tree. None of them points at this plan's code; the files this plan changed lint clean.
  - `budget-gate`: export counts across four packages, non-null counts in `memory/system`, `mcp` and `src`
  - `dead-export-verify --deprecations`: `applyNestedRun`/`suspendNested`
  - `phase54-package-map` and `truth-current` generated docs
  - `biome lint .`
  - host-builder eval suites
  - remote-conformance and envelope timing
  - the headless-host coding-tools test, the supervisor saturation test, and release-tooling npm usage
  This plan's own regression there, the `RunResult` freeze list, is fixed.
- `bun scripts/release.mjs gate` reports the same items Task 2 recorded:
  - the `@arnilo/prism-ai` version bump (this plan does no bump)
  - kernel packed and unpacked bytes, `rootExports` (+8; this plan adds `StructuredOutputMode` and Task 2 its root types), and `sourceLines` over `budgets.json`
  These need a rebaseline, with a reason, when the uncommitted plans land.

## Compromises Made

- **Repair count is per process run.** The repair counter lives in the session's run assembly, like `continuations`, so a durable resume restarts it. A run suspended between a reply and its repair can therefore spend up to `repair` more turns after the resume.
- **Repair only after a natural end.** Repair never fires after a stop or limit (`loopFinishReason` set). A run cut short by `turn_limit` or `hook_limit` ends with `outputError` even when repairs remain.
- **Prompted mode is session-only.** A direct provider request (`generate()`, System One, advisor) supports native mode only. A `mode: "prompted"` there fails closed with `invalid_option` rather than injecting the block into a raw request.
- **Prompted output is not constrained.** Prompted mode relies on model compliance plus repair. There is no constrained decoding, which was rejected in Options Considered.
- **Gates left red.** The budgets, version bump and generated docs above are left red for the release owner, as Task 2 recorded.

## Further Actions

- **P2: live tool-calling coverage for structured output.** Extend `liveScenarioStructuredOutput` (`src/testing/provider-live-scenarios.ts`) to validate the reply with `parseStructuredOutput` and to cover a tool-calling run with structured output (Task 1(d) found no such coverage). Native schemas sent next to `tools` on every turn are not proven on live routes.
  - **Done (2026-11-17), scenario code; a credentialed live pass is still owed.**
    - `liveScenarioStructuredOutput` now validates the reply with `parseStructuredOutput(text, { name: "probe", schema })`, replacing the bare `JSON.parse`. A failure lists `code` and `path message` entries, never the reply.
    - `LiveRouteConfig.structuredSchema` (new) pairs a custom schema with `structuredPrompt`. The Hyper replay fixture answers `{ name, country }`, so the hermetic multi-runner passes the fixture's schema and lists its six scenarios explicitly.
    - New `structured-tool-loop` scenario, `liveScenarioStructuredToolLoop`, registered as `live_structured_output_with_tool_calls` and run by default when `scenarios` is absent:
      - It is a real session run (`createAgent` + `providerPackage` around the live provider, with requests recorded) using `get_weather` and `LIVE_STRUCTURED_WEATHER_SCHEMA` (`location`, `temperature`, `additionalProperties: false`), with `mode: "auto"`.
      - A route with `structuredOutput: "json_schema"` (or a model declaring it) runs native mode with `repair: 0`. It asserts that every request carries both `tools` and `options.structuredOutput`, so the schema must be honoured next to tools without a repair.
      - Other routes, including `"reject"`, run prompted mode with the default repair. It asserts that no request carries a native schema.
      - Both modes assert `status: "completed"`, at least one executed tool call, at least 2 requests, a defined `RunResult.output`, and that no secret appears in the result.
    - Hermetic tests in `src/__tests__/provider-live-scenarios.test.ts` (8 pass):
      - `live_structured_output_validates_the_reply_against_the_schema`
      - `live_structured_tool_loop_sends_the_native_schema_next_to_tools_on_every_turn`
      - `live_structured_tool_loop_uses_prompted_mode_without_the_capability`
      - `live_structured_tool_loop_fails_on_an_invalid_native_reply_without_quoting_it`
    - Docs: `docs/testing.md` (the scenario list and `structuredSchema`) and `CHANGELOG.md` Unreleased. `packages/hosts/host-builder/data/api.json` was regenerated.
    - Baseline (`--update-baseline`), additive: `~./testing LiveRouteConfig + structuredSchema?: JsonObject`; `~./testing ProviderLiveScenariosOptions scenarios + "structured-tool-loop"`. The new function stays a deep-module export, like the other `liveScenario*` executors.
    - Cost: each provider live suite sends 2–3 more requests per route.
    - Not run: no credentialed live pass was made. That needs `PRISM_LIVE_PROVIDER_TESTS=1` and provider keys, and it spends money. Until it runs, gateway acceptance of a native schema next to tools stays unproven.
- **P2: rebaseline the release gates.** Rebaseline `scripts/budgets.json` (packed and unpacked bytes, root and package export counts, sourceLines, non-null counts) with reasons, and regenerate the phase54 and package-truth docs, once the uncommitted plans in the tree land.
- **P3: persist the repair count.** Persist the repair count in loop state if durable runs with structured output need an exact repair bound across resume.
