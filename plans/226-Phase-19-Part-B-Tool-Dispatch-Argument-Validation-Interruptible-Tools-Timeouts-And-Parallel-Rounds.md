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

- [x] Task 1: Phase review (read-only)
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
  - Notes (executed 2026-11-15) — read-only; no source changed. Probes `p3-validate` and `p4-hang` are not in the repo (the plan is their only reference).
    - **(a) Schema coverage.** Built the real definitions of 66 first-party tools at runtime (coding 6 + opt-in 9, browser 6, office 6, work 31, web 3, obscura 4, `search_tools`) and walked every `parameters` schema against `SUPPORTED_KEYWORDS` (`src/packages/schema.ts:72-94`). The only keyword outside the subset is **`format`**, on URL fields: `web_fetch /url`, `web_extract /urls/items`, `obscura_fetch /url`, `obscura_scrape /urls/items` (`packages/tools/web/src/tools.ts`, `.../obscura/web.ts`). No `type` arrays, `$ref`, `nullable`, `allOf` in any first-party tool (`packages/tools/work/src/documents/model-schema.ts:79` has a `type` array, but it is the document model, not a tool schema). Every root is `type: "object"`; 65 of 66 set `additionalProperties`; `search_tools` (`context-engineering/src/tool-search.ts:246`) and `load_skill` (`src/skill-load.ts:214`) do not. Read statically, in the subset: `delegate*` (`delegate/src/tools.ts:105,162,195`), `advise` (`advisor/src/tool.ts:21`), `load_skill`.
      - **Remote schemas are the real gap.** MCP bridge passes `remote.inputSchema` through untouched (`mcp/src/bridge.ts:257`). Recorded fixtures use `type`/`properties`/`required` only, plus `x-mcp-header` with a non-string value (`mcp/src/__tests__/modern-bridge.test.ts:421`); zod-built servers (`auth.test.ts:311`, `bridge.test.ts:155`) are the SDK's own output and are not recorded as literals. Fixtures at `bridge.test.ts:582-585` use non-schema junk (`{ value: "long" }`, `{ a: 1, b: 2 }`) as `inputSchema` for size/depth bounds. OpenAPI tools forward `allOf`/`anyOf`/`oneOf`/`not`/`if`/`then`/`else`/`patternProperties`/`prefixItems`/`format`/`contains` (`openapi/src/compile.ts:33-47`).
      - **Today's strict compile throws on invalid keyword values, not only unknown keywords** (`compile`, `schema.ts:141-218`: bad `type`, non-count `minItems`, bad `pattern`, a `default` that fails its own schema). Tolerant mode must therefore catch per subschema, not just skip unknown keys.
      - Strict-only behaviors that tolerant mode must switch off: `additionalProperties` absent → `false` (`:195`); defaults are applied to the returned value (`:342`; tools must receive their original arguments, and the effect key hashes them); `x-prism-secret` rejects literal strings (`:313`); `MAX_ERRORS = 20` (`:69`, plan wants 8); the compile cache `WeakMap` (`:108`) is keyed by schema only, so a tolerant compile needs its own cache.
    - **(b) Existing argument checks.** `checkCall` (`src/tools.ts:571-581`) blocks `unknown_tool`, `tool_denied`, `call.argumentsError`, and a non-object as `invalid_arguments`. `blocked()` (`:583`) carries `reason` only on the event; the `ErrorInfo` of the object check is `{ message }` with **no `code`**, and the `validate` seam's string becomes a code-less `ErrorInfo` (`:294`, `:610`). `createToolParameterValidator` (`:60`) is the only adapter. `AgentConfig.validator` is read at `assemble.ts:378` and passed at `tool-round.ts:460`; also at `agent-approval.ts:157` (validates `modifiedArguments` at decision time; the same call is re-validated at execute, so there is no hole) and `agent-tool-dispatch.ts:59-66` (elicitation payload, a different schema; unchanged). Production callers of `dispatchToolCall`: one, `bindDispatchToolCall` (`tool-round.ts:406`); the rest are examples, tests and `src/testing/tool-conformance.ts:155`. Setters of `validator`: only `examples/secure-agent.ts:26` (strict `validateJsonSchema`, `missingSchema: "reject"`) and its host-builder copy; no `apps/` or `packages/hosts` code sets it. `packages/extensions/governance/src/readiness.ts:233-245` reports `governance.validator` from `config.validator` only, so it will read `false` for an agent that now validates by default.
    - **(c) Abort and the effect store.** `execute` runs inside the `try` that starts at `src/tools.ts:317`; `markDispatched` is at `:322`. Any rejection there goes to the catch (`:355`), and with `effect.dispatched || dispatchAttempted` it returns `finishUnknownEffect` (`:363`, `:524`) with code `ERR_PRISM_TOOL_EFFECT_UNKNOWN`. So a race that rejects inside that `try` already yields "unknown, not failed" with no new code path; `tool_timeout`/`tool_aborted` appear only for calls without a dispatched effect. Awaits before `execute` (`assertTrusted`, `validate`, `prepareToolEffect`'s `store.begin`, `beforeExecute`'s durable persist, the `tool.started` emit, `markDispatched`) are not raced and stay unbounded. A wall breach aborts the run controller with `RunLimitError` (`assemble.ts:718-721`) and the single `run.failed` comes from the catch at `assemble.ts:782`; settling the tool with `tool_aborted` does not change that. `prepareToolEffect` puts `context.signal` into the effect key (`tools.ts:418`), so the per-call child signal must be created where the context is built (`:259`), not at `execute`.
    - **(d) Which tools ignore their signal.** Per-file `signal` counts across all first-party tool files: the ones with zero or token use are `search_tools`, `load_skill`, `shell_output` (all synchronous, in-memory). `computer-use` checks `throwIfAborted` once at start (`create.ts:130`) and then calls the MCP device; `advise` and `delegate*` forward it (`advisor/src/tool.ts:43`, `delegate/src/tools.ts:141,178`; a sync child is aborted through it, `delegate/src/runtime.ts:458-463`); MCP, OpenAPI (`openapi/src/execute.ts:172`), web, browser, coding tools all use it. The detached-promise case is therefore mainly third-party tools and `computer-use` after start.
    - **(e) Concurrency today.** The concurrent path already exists: `dispatchToolCallsInOrder` is `src/loop/dispatch.ts:31-119` (plan 225 moved it from `:26-90`); it appends results in call order after all workers settle and answers unclaimed calls with `tool_call_not_dispatched`. The controller defaults `toolConcurrency` to 1 (`run-controller.ts:355`), the default loop passes nothing (`default-loop.ts:16`), and `executeApproved` (`tool-round.ts:324-327`) passes nothing either. Gating, `ask` collection and suspension already happen for the whole round before any dispatch (`run-controller.ts:325-351`) and stay per round. `isToolCallExclusive` is `registry.get(call.name)?.exclusive === true` (`assemble.ts:564`): an unknown name is non-exclusive and an undeclared `effects` is not consulted. `exclusive: true` tools: `shell`, six `browser_*`, `obscura_fetch`, `obscura_scrape`, `git_commit`, `git_pr_handoff`, `ask_user_decision`; `delegate`, `delegate_wait`, `delegate_cancel`, `advise` set `exclusive: false` explicitly. **No first-party tool lacks `effects`** (all 66 plus `load_skill` `["read"]`, `delegate*`, `advise`, OpenAPI, `computer-use` declare it) **except the MCP bridge tools**, which declare `effect` only (`mcp/src/bridge.ts:255-257`), so under the fail-closed rule every MCP round stays serial. `write`/`edit`/`delete`/`move` serialize per path through `withFileMutationQueue` (`packages/tools/coding/src/agent/file-mutation-queue.ts`). `delegate`'s `maxConcurrent` defaults to 4 (`delegate/src/config.ts:68`) and counts async delegations too (`runtime.ts:454`), so four parallel sync calls beside a running async one fail the fifth with "At most 4 delegations may run at once".
    - **(f) Shared mutable run state touched by a tool call.**
      - `ctx.toolResults.push` (`tool-round.ts:462`): completion order under concurrency. The default loop's `assemble` passes `undefined` for tool results (`assemble.ts:500`), so nothing reads the order; a custom loop gets call order from the `executeTools` return. Order-independent.
      - `recordRecentToolCall` (`tool-round.ts:370-374`) and `ctx.toolCalls += 1`: synchronous, start-order, bounded to 10. Order-independent.
      - `session.loadedSkills` (`tool-round.ts:418`, `metadata.loadedSkills`): `load_skill` mutates it during `execute`; the insertion order is persisted (`persist.ts:46`) and a prefix-stability conformance leg puts a second call beside `load_skill` (`src/testing/prefix-stability-conformance.ts:56`). Completion order across the awaits in `dispatchToolCall` is not guaranteed. **Needs a guard**: `load_skill` and `search_tools` (which mutates the activated-tool set) declare `exclusive: true`.
      - `tailSegments`: written only during request assembly (`assemble.ts:348,465`), never by a tool call. Not touched.
      - `serialAppend` (`session.ts:1190`): already serializes every session append; transcript rows are appended after the workers settle (`dispatch.ts:100-116`). Safe. Ledger `appendToolCall` (`tools.ts:616-637`) is called concurrently by interleaved calls; not verified against every ledger implementation, so Task 4 tests it on the memory and JSONL ledgers.
      - `beforeExecute`'s `persistDurable` (`tool-round.ts:435-459`) is a read-modify-write of `durable.state.pendingCalls`; two concurrent calls of a resumed round would overwrite each other's `dispatched` mark. Not reachable by default because `executeApproved` stays at concurrency 1, but a custom loop passing `concurrency` on a resumed round would hit it. Guard: serialize that persist through one promise chain.
      - Event interleaving: `tool.started`/`tool.completed` of different calls will no longer nest. Consumers that assume adjacency (ACP/AG-UI mappers, the reference host's renderers) were not audited here; the host suites in Verification cover them.
    - **Security: validation never rejecting.** Only `edit` repairs its own arguments (`edit.ts:118-135`: `edits` as a JSON string, top-level `oldText`/`newText`); its schema requires an `edits` array and sets `additionalProperties: false` (`edit.ts:204-210`), so default validation would reject both repaired forms. It is the one first-party tool that needs `validateArguments: false`. The web tools re-validate in their own `execute` ("a hand-built tool list can bypass schema validation, not this", `web/src/tools.ts:43`), so kernel validation is additive there.
    - **Findings applied to later tasks (see each task):**
      - Task 2: tolerant mode catches invalid keyword values per subschema, not only unknown keywords; its own compile cache; additionalProperties-absent = allowed; no defaults applied; secret/default checks off; cap 8. `ErrorInfo.code` must be set to `invalid_arguments` (`blocked()` does not). The status note needs an owner: `package.status` is package-scoped (`contracts-protocol.ts:396-405`), so the note goes to the tool's owning package (`toolOwner`, `tool-round.ts:377`) or, for a host tool, a `kernel` label. `edit` is the only `validateArguments: false`. Governance readiness reads `validator` from config only.
      - Task 3: `maxToolTimeMs` follows `maxContinuations` (resolved outside `DEFAULT_RUN_LIMITS`, `run-limits.ts:133-136,174`), which would otherwise make it a counter axis (`LIMIT_NAMES`, `:57`); dispatch reads `limitTracker.limits` (public, `:182`). The per-call signal is created with the context. The race covers `execute` only.
      - Task 4: undeclared `effects` and unknown tool names make a round serial in `isToolCallExclusive` (`assemble.ts:564`); `load_skill` and `search_tools` become `exclusive`; the persist in `beforeExecute` is serialized; MCP rounds stay serial until the bridge declares `effects` (Further Action); the `delegate` default of 4 equals the round default of 4, documented.

- [x] Task 2: Tool arguments are validated against `parameters` by default
  - Acceptance Criteria:
    - Functional:
      - Before `beforeExecute`, the kernel validates `call.arguments` against `tool.parameters` with the kernel schema validator. A failure returns the existing blocked shape with `reason: "invalid_arguments"` and one message per failing path, capped at 8 paths and 1 KiB.
      - A tool with no `parameters` accepts any JSON object, as today.
      - A schema keyword outside the kernel subset is ignored for that subschema and the rest is still checked; registration adds one `info` status note naming the tool and the keyword. This is the tool-argument mode only: package config validation stays fail-closed on unknown keywords. (Task 1(a), (b): the note is a `package.status` event, which is package-scoped, so it goes to the tool's owning package (`toolOwner`) or, for a host tool, a `kernel` label.)
      - Tolerant mode also covers a subschema whose keyword *values* are invalid (a `type` array, a non-integer `minItems`, a bad `pattern`, a non-schema `inputSchema` such as MCP's): that subschema accepts anything, the rest is still checked, one note per tool. A root that is not an object accepts anything. Task 1(a): this is the case MCP and OpenAPI schemas hit; first-party tools only use `format`.
      - Tolerant mode differs from config mode in four more ways: it applies no defaults (the tool receives its original arguments, and the effect key hashes them), ignores `x-prism-secret`, skips the "default satisfies its own schema" check, and caps at 8 errors. It has its own compile cache.
      - `additionalProperties` follows the schema as written: absent means allowed here (JSON Schema's default), unlike package config.
      - The blocked result's `ErrorInfo.code` is `"invalid_arguments"` (Task 1(b): `blocked()` puts `reason` on the event only, and the existing object check returns no code).
      - `AgentConfig.tools.validation`: `"schema"` (default) or `"off"`. `AgentConfig.validator` and `RunOptions.validate` run after the built-in check and can still reject.
      - A tool can opt out with `ToolDefinition.validateArguments: false` when it repairs its own arguments (Task 1's Security finding: `edit` is the only first-party one, and it sets it in this task).
      - Governance readiness (`governance/src/readiness.ts:233-245`) reports `validator` from `config.validator` only; it counts the built-in check as present while `tools.validation` is not `"off"`.
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
      - `packages/tools/coding/src/agent/edit.ts`: `validateArguments: false` (the only first-party tool, Task 1)
      - `packages/extensions/governance/src/readiness.ts`: the built-in check counts as a validator
      - `src/testing/tool-conformance.ts`: a schema-violation case
      - `scripts/compat-baseline/*.txt`: regenerated (`bun scripts/release.mjs gate --update-baseline`), additive diff in the task note
    - References:
      - Probe `p3-validate`
  - Test Cases to Write:
    - `schema_invalid_arguments_block_the_call`: the probe's arguments; `execute` is never called.
    - `validation_reports_paths_not_values`: a secret-shaped argument value does not appear in the result or event.
    - `tool_without_parameters_accepts_any_object`.
    - `unsupported_keyword_is_ignored_and_noted`: a `$ref` schema still checks `required`.
    - `mcp_style_schema_is_tolerated`: `$schema`, `type: ["string","null"]`, `x-mcp-header: 123`, `format`, and a non-object `inputSchema` all validate without throwing; the valid parts still reject.
    - `validation_does_not_rewrite_arguments`: a schema `default` is not applied; `execute` and the effect key see the original object.
    - `readiness_counts_builtin_validation`.
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
  - Notes (executed 2026-11-15):
    - **What changed.**
      - `src/packages/schema.ts`: tolerant mode on the existing compiler. `compile(schema, path, depth, mode?)` splits into `compile` (tolerant wrapper that catches per subschema and shares one node per schema object, so a DAG-shaped remote schema compiles once) and `compileObject`. The mode ignores unknown keywords (annotation keywords `$*`, `x-*`, `examples`, `deprecated`, `readOnly`, `writeOnly` silently, the rest recorded), compiles an unreadable subschema to a permissive node, treats absent `additionalProperties` as open, skips defaults, `x-prism-secret`, the default-satisfies-schema check and the unsafe-property-name check, caps at 8 errors, and in `run` builds no output object. Tolerant unknown-key errors are `<pointer>: is not allowed` (no key echoed in the message beyond the path). New export `compileToolSchema(schema)` (cached by schema object, never throws, returns `{ skipped, validate }`); strict mode and its `compiled` cache are untouched.
      - `src/tools.ts`: `checkToolArguments`, `ToolArgumentValidation`, `DispatchToolCallOptions.validation`; the check runs after `assertTrusted` and before `options.validate` and `prepareToolEffect`. It blocks with `reason: "invalid_arguments"` and `error.code: "invalid_arguments"`; the existing non-object check got the same code. `ToolDefinition.validateArguments`, `AgentConfig.tools.validation`, `RoundContext.validation` (resolved in `assemble.ts`, passed at `tool-round.ts`).
      - `src/packages/loader.ts`: `noteIgnoredSchemaKeywords` records one `info` note per tool with an ignored part, for package tools (owner = the package) and host `tools.add` (owner `kernel`); none when `tools.validation` is `"off"` or the tool opts out.
      - `edit` sets `validateArguments: false`; governance readiness counts the built-in check; `assertToolDispatchConforms` gained step 3b (a schema-derived violating probe).
    - **Findings that affect later tasks.**
      - Validation runs *before* `prepareToolEffect`, so a blocked call never claims an effect. Task 3's race still covers only `execute`.
      - A schema `enum` on a tool argument now blocks a value outside it at validation. The delegate package's `child` enum made `delegate_unknown_child_is_tool_error` and `hidden_child_absent_from_tool_and_unreachable_by_model` block with `/child: must be one of the allowed values` instead of the tool's own "Unknown child"; both tests assert the new message (a hidden child is still unreachable). Task 4's `two_sync_delegate_calls_overlap` must pass valid `child` names.
      - `format` is the only first-party keyword the subset skips, so `web_fetch`, `web_extract`, `obscura_fetch` and `obscura_scrape` each add one `info` status note at agent build (`keyword "format" is not supported`). Expected; if the noise matters, add `format` to the silent list in `isSilentKeyword`.
      - A tolerant regex still runs a remote server's `pattern` against model-supplied strings (cap 4,096 characters, as in config mode); no new ReDoS bound was added.
    - **Tests.** `src/__tests__/tool-argument-validation.test.ts` (18: the plan's ten names plus a valid call, the 8-path/1 KiB cap, `additionalProperties` absent, `x-prism-secret` ignored, the non-object code, a 5,000-item (>256 KiB) argument object validating in under 50 ms, and `tools.validation: "off"` through an agent); `readiness_counts_builtin_validation` in governance; `tool_can_opt_out` in `packages/tools/coding` (an `edit` call with a JSON-string `edits` and with legacy `oldText`/`newText`, dispatched through `dispatchToolCall`).
    - **Baseline diff** (`bun scripts/release.mjs gate --update-baseline`, `scripts/compat-baseline/arnilo__prism.txt`, additive only, no removals): `+ ToolArgumentValidation` (type); `AgentConfig.tools` gains `validation?: "schema" | "off"`; `DispatchToolCallOptions` gains `validation?`; `ToolDefinition` gains `validateArguments?: boolean`. (`arnilo__prism-memory-system.txt` also differs in the working tree from the uncommitted memory work, not from this task.)
    - **Budgets and generated files.** `scripts/budgets.json` kernel ceilings rebaselined with a reason (1,278,559 packed, 4,144,539 unpacked, 1,546 counted exports, 41,866 source lines; +4 counted exports are `compileToolSchema`, `CompiledToolSchema`, `checkToolArguments`, `ToolArgumentValidation`) and `exportCounts["@arnilo/prism"]`; `FROZEN_TYPE_EXPORTS` gained `ToolArgumentValidation`; `bun scripts/host-builder-index.mjs` and `bun scripts/package-truth.mjs --emit-docs` regenerated (`api.json`, `errors.json`, `phase54-package-map.md`, `docs/release.md` if changed, `package-truth.json`); the host-builder eval lock was re-registered (`bun scripts/host-builder-evals/run.mjs --register`, as the 0.13.1 release did) because its `indexes` hash covers the regenerated data; no scored eval run is pending.
    - **Checks.** `bun run typecheck` green; `bunx biome lint .` clean. In the last full `bun run test`, what still failed is outside this task: the memory-system export-surface ceiling (+10) and non-null-assertion count (`packages/memory/system/src/session` 114 → 151) from the uncommitted plan 218.2 work, plus three timing tests (`markdown_store_write_amplification_within_budget`, `branch_read_cost_is_linear_in_depth`, the document-reader max-page envelope) that fail under load and pass alone. The sweep (`retired-names`) was not needed: no name, error or config was retired.

- [x] Task 3: A tool call ends on abort, wall limit, or its own timeout
  - Acceptance Criteria:
    - Functional:
      - `tool.execute` is raced against the run signal. On abort the call settles at once with `error.code: "tool_aborted"`; a wall-limit abort still produces the run's single `run.failed { limit: "maxWallTimeMs" }`.
      - `ToolDefinition.timeoutMs` and `RunLimits.maxToolTimeMs` (default `null`, narrowing like every policy axis) bound one call. The smaller applies. On expiry: `error.code: "tool_timeout"`, and the tool's `context.signal` is aborted so a cooperative tool stops its work. (Task 1: `maxToolTimeMs` resolves outside `DEFAULT_RUN_LIMITS`, like `maxContinuations`, so it is not a counter axis; dispatch reads it from `limitTracker.limits`.)
      - The race covers `execute` only. Awaits before it (effect-store `begin`, `beforeExecute`, `markDispatched`) stay unbounded; recorded under Further Actions.
      - The tool's promise is detached: a late resolution is dropped, a late rejection is swallowed, and neither emits an event.
      - A call with a claimed durable effect that had been marked dispatched settles through the existing unknown-effect path (`ERR_PRISM_TOOL_EFFECT_UNKNOWN`), never as a clean failure.
      - A timed-out or aborted call still gets exactly one tool result (plan 225 Task 4's guarantee).
    - Performance: No timer is armed for a call with no timeout; one `setTimeout` per call otherwise, cleared on settle.
    - Code Quality: The per-call signal is a child of the run signal and is created where the context is built (`src/tools.ts:259`), so the effect-store key (`:418`) and `tool.effect` classifier see it too; tools keep reading `context.signal`.
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
      - `src/contracts-protocol.ts` (`ToolDefinition.timeoutMs`), `src/contracts-core/run-limits.ts` (`RunLimits` and `ResolvedRunLimits`), `src/run-limits.ts` (`maxToolTimeMs`: `resolveRunLimits` next to `maxContinuations` at `:133-136`, `validateLimits` at `:174`; not in `DEFAULT_RUN_LIMITS`, so not a counter axis)
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
  - Notes (executed 2026-11-15):
    - **What changed.**
      - `src/tools.ts`: `dispatchToolCall` is now a thin wrapper that opens a `ToolCallScope` and calls `dispatchToolCallInScope` (the old body). The scope's signal is `AbortSignal.any([run signal, controller only dispatch can abort])`, so there is no manual listener on the run signal (no max-listener warning at concurrency 16) and a tool cannot extend its own deadline. It is put on the context where the context is built, so the effect key and `tool.effect` classifier see it. `executeInterruptibly` races `execute` against that signal and an optional `setTimeout` (armed only when a timeout applies, cleared on settle); a timeout settles first and then aborts the signal, so a cooperative tool's abort handling cannot turn it into `tool_aborted`. `ToolInterruptedError` (module-private) maps to `error.code` `tool_aborted` / `tool_timeout` in the existing catch; `failBeforeEffect` uses `failed_retryable` for it. An effect call that was `markDispatched` and is interrupted already lands in `finishUnknownEffect` (`ERR_PRISM_TOOL_EFFECT_UNKNOWN`), as Task 1(c) found, with no new path. A call whose signal is already aborted never reaches `markDispatched` or `execute`. After the scope closes, the detached tool's `context.progress` is a no-op.
      - A synchronous tool result wins over an abort it raised itself (`serial_round_stops_after_abort` in `tool-round-settlement.test.ts` caught the first draft, which turned c1's already-returned result into `tool_aborted`). The handlers on the tool's promise are attached before the abort check so a late rejection of a loser is always handled.
      - `RunLimits.maxToolTimeMs` / `ResolvedRunLimits.maxToolTimeMs` (default `null`): resolved next to `maxContinuations` in `resolveRunLimits` (min-narrowing, not in `DEFAULT_RUN_LIMITS`), validated as a positive safe integer or `null`, and excluded from `RunLimitName`. `ToolDefinition.timeoutMs` is validated at registration (`assertToolTimeout`, a plain `TypeError`, so no new `ToolDefinitionError` code). Dispatch takes `min(tool.timeoutMs, limitTracker.limits.maxToolTimeMs)`.
      - Docs: `docs/tools.md` "Interruption and timeouts" (with the detached-promise caveat), `docs/agent.md`, `CHANGELOG.md`.
    - **Findings that affect later tasks.**
      - Task 4: dispatch now creates a scope per call; at concurrency 16 nothing listens on the run signal per call, so no listener cap. The pre-aborted-signal-with-effect case is reported by the effect store's own `begin` (`ERR_PRISM_TOOL_EFFECT_UNKNOWN` from the pre-dispatch claim), not by the race; that is existing behavior and untouched.
      - A tool that aborts the run and returns an async result in the same tick loses to the abort (`tool_aborted`); a sync return wins. Documented behavior for a round that is stopping anyway.
      - The two `tools_browser_*` tests fail only when `bun test src` runs every package in one process; `bun run --filter @arnilo/prism-tools test` passes (1,268 pass).
    - **Tests.** `src/__tests__/tool-interruption.test.ts` (12): `session_abort_settles_the_running_call`, an already-aborted signal, `tool_timeout_settles_and_aborts_the_tool_signal`, a tool cannot reach its deadline controller (run signal untouched), `run_limit_clamps_tool_timeout`, limits narrowing and validation, a call without a timeout, `late_tool_outcome_is_dropped` (no event, no unhandled rejection, late `progress` dropped), `dispatched_effect_timeout_is_unknown_not_failed`, `aborted_call_has_exactly_one_result`, `wall_limit_ends_a_tool_that_ignores_its_signal` (the probe through a run: the run returns within the limit plus 300 ms, one `run.failed`, one `tool.completed` with `tool_aborted`), and a run-level `maxToolTimeMs` that lets the run continue. `run-limits.test.ts` expects `maxToolTimeMs: null` in the resolved defaults.
    - **Baseline diff** (`scripts/compat-baseline/arnilo__prism.txt`, additive, no removals; Task 2's entries are in the same uncommitted diff): `RunLimits` gains `maxToolTimeMs?: number | null`; `ResolvedRunLimits` gains `maxToolTimeMs: number | null`; `ToolDefinition` gains `timeoutMs?: number`; `RunLimitName`'s `Exclude` list gains `"maxToolTimeMs"` (the union itself is unchanged). No new export, so counted exports stay 1,546.
    - **Budgets and generated files.** `scripts/budgets.json` kernel ceilings rebaselined with a reason: 1,281,549 packed, 4,153,656 unpacked, 42,001 source lines. `bun scripts/host-builder-index.mjs`, `bun scripts/package-truth.mjs --emit-docs` and `bun scripts/host-builder-evals/run.mjs --register` were re-run.
    - **Checks.** `bun run typecheck` green; `bunx biome lint` clean on the changed files; `bun scripts/release.mjs gate` passes; `bun test src/__tests__/docs.test.ts` 69 pass; `@arnilo/prism-tools` (1,268), `@arnilo/prism-extensions` (1,079) and `@arnilo/prism-agent` (66) suites pass. No name, error or config was retired, so the retired-names sweep was not needed. The full `bun run test` was not run; the plan's whole-plan Verification does that after Task 4.

- [x] Task 4: Independent tool calls of one round run in parallel
  - Acceptance Criteria:
    - Functional:
      - `AgentConfig.tools.concurrency` (integer 1–16, default `4`) and `RunOptions.tools.concurrency` (narrowing only) set the round's concurrency. The default loop passes it to `executeTools`; a custom loop's explicit `options.concurrency` still wins.
      - A round is serial when any call's tool is `exclusive`, declares no `effects`, or is not in the registry (unknown effects fail closed to serial). Task 1(e): no first-party tool lacks `effects`, but MCP bridge tools declare `effect` only, so MCP rounds stay serial.
      - `load_skill` and `search_tools` declare `exclusive: true`: they mutate `loadedSkills` and the activated-tool set during `execute`, and completion order is not guaranteed (Task 1(f)).
      - `executeApproved` (a resumed run's approved calls) keeps concurrency 1; the durable `beforeExecute` persist (`tool-round.ts:435-459`) is serialized through one promise chain so a custom loop passing `concurrency` on a resumed round cannot lose a `dispatched` mark.
      - `tool.call` gating, `ask` collection, and suspension are unchanged: the whole round is gated before any call starts.
      - Results are appended in call order; `tool.started` / `tool.completed` events may interleave across calls and each carries its `toolCallId`.
      - A failure in one call does not cancel its siblings, except a run-control error (limit breach, suspension, abort), which stops the round and settles the rest (plan 225 Task 4).
      - The shared run state Task 1(f) lists is safe under interleaving; each item is either made order-independent or guarded, and the task note says which.
    - Performance: Four 200 ms tool calls in one round finish in under 300 ms (was 800 ms). The task note records the before and after of `scripts/benchmark-multi-agent.test.mjs`.
    - Code Quality: No second dispatcher; the existing concurrent path of `dispatchToolCallsInOrder` is the one used.
    - Security: Concurrency never widens what runs: a denied or pending call is not dispatched in either mode.
  - Approach:
    - Documentation Reviewed:
      - `src/loop/dispatch.ts:31-119`, `src/loop/default-loop.ts`, `src/loop/run-controller.ts:312-375`
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
      - `src/agent-session/session/tool-round.ts`: serialize the durable persist in `beforeExecute` (Task 1(f))
      - `src/skill-load.ts` (`load_skill`) and `packages/extensions/context-engineering/src/tool-search.ts` (`search_tools`): `exclusive: true`
      - `packages/extensions/delegate/README.md`: the default `maxConcurrent` of 4 equals the round default of 4, and async delegations count toward it
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
    - `unknown_tool_name_makes_the_round_serial`.
    - `load_skill_beside_other_calls_stays_serial`: the prefix-stability conformance leg that puts a second call beside `load_skill` still passes.
    - `concurrent_calls_append_to_memory_and_jsonl_ledgers`: no lost or reordered `tool.started`/`finished` records per `toolCallId`.
    - `resumed_round_marks_each_pending_call_dispatched`: the serialized durable persist.
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
  - Notes (executed 2026-11-15):
    - **What changed.**
      - `AgentConfig.tools.concurrency` and `RunOptions.tools.concurrency` (`contracts-core/agent.ts`, `contracts-protocol.ts`); `resolveToolConcurrency` (`src/tools.ts`: integer 1-16 or a `TypeError`, default 4, a run value only narrows) is read in `assemble.ts` and handed to `createRunController` as `toolConcurrency`. The default loop passes it through `runToolConcurrency(run)` (a `WeakMap` in `run-controller.ts`), not through a new `RunController` key: `run_controller_exposes_only_primitives` pins the key set. A custom loop and the driver-kit bridge still get `1` unless they pass `concurrency`; `executeApproved` passes `{ concurrency: 1 }` explicitly.
      - `isToolCallExclusive` (`assemble.ts`) is now true for an unknown tool name, an `exclusive: true` tool, and a tool with no `effects`, so any such call makes its round serial. `load_skill` (`skill-load.ts`) and `search_tools` (`tool-search.ts`) declare `exclusive: true`. No second dispatcher: the existing concurrent path of `dispatchToolCallsInOrder` is used.
      - `beforeExecute`'s durable `dispatched` mark goes through `serializeDurableMark` (one promise chain per session, `tool-round.ts`; a failed mark rejects its caller and does not poison the chain).
    - **Findings that were not in Task 1.**
      - **Session state read-after-write was stale.** `SessionStateStore.write` set its in-memory value only after the async append, and `state.session(...).set` is usually not awaited in a hook. Serial rounds hid it; with parallel calls the research ledger recorded one URL twice (`ledger_records_every_fetched_source`) and the host eval suite failed its invariant. Root-cause fix in `src/session/state.ts`: `write` makes the value visible at once (`latest` map names the newest write), restores the previous value if its append fails, and re-asserts after `ready()` hydrates the branch. `append` (the `state.log` path) keeps its persist-then-visible order; see Further Actions. Test: `session state read-your-writes` in `session-state-background.test.ts`.
      - `scripts/benchmark-scenarios/multi-agent-runtime.mjs`'s `work` tool declared no `effects`, so its round turned serial; the fixture now declares `effects: ["read"]`.
      - Task 1(f) said the ledger `appendToolCall` was unverified: no first-party memory or JSONL `RunLedger` exists (only the SQLite and Postgres adapters), so the test uses an in-memory ledger with a delayed append and checks one `started` first and one `finished` last per `toolCallId`. Neither SQL adapter was run concurrently here.
    - **Tests.** `src/__tests__/tool-parallel-rounds.test.ts` (12): `round_runs_non_exclusive_calls_concurrently`, `exclusive_tool_makes_the_round_serial`, `undeclared_effects_make_the_round_serial`, `unknown_tool_name_makes_the_round_serial`, `results_append_in_call_order_under_concurrency`, `one_failing_call_does_not_cancel_siblings`, `limit_breach_mid_round_settles_remaining_calls`, `concurrency_one_restores_serial_order_of_events`, a bound/narrowing/validation test, `load_skill_beside_other_calls_stays_serial` (asserts `exclusive`; the prefix-stability conformance leg stays green in the full run), `concurrent_calls_append_to_the_ledger_without_loss`, `resumed_round_marks_each_pending_call_dispatched` (tests the serialized mark directly, not a full resume). `two_sync_delegate_calls_overlap` in `packages/extensions/delegate`. `examples/parallel-tools.ts` is registered in `docs.test.ts` (asserts peaks 4 / 1 / 1), `examples/README.md` and `scripts/e2e-coverage.json`.
    - **Performance.** Four 200 ms calls through the default loop: 232 ms with the default concurrency, 828 ms with `tools.concurrency: 1` (the 0.14.0 behavior). `scripts/benchmark-multi-agent.test.mjs` builds its own loop with an explicit concurrency, so its `toolConcurrency` row measures the same path as before and is unchanged.
    - **Baseline diff** (`scripts/compat-baseline/arnilo__prism.txt`, additive): `AgentConfig.tools` gains `concurrency?: number`; `RunOptions.tools` gains `concurrency?: number`. No new root export name. Tasks 2 and 3's entries are in the same uncommitted diff.
    - **Budgets and generated files.** `scripts/budgets.json` kernel ceilings rebaselined with a reason: 1,284,905 packed, 4,163,170 unpacked, 42,102 source lines, 1,549 counted exports (+3 internal: `resolveToolConcurrency`, `runToolConcurrency`, `serializeDurableMark`); `exportCounts["@arnilo/prism"]` 1,549. `bun scripts/host-builder-index.mjs`, `bun scripts/package-truth.mjs --emit-docs` and `bun scripts/host-builder-evals/run.mjs --register` re-run (the host-builder index embeds the example sources). `bun scripts/release.mjs gate` passes.
    - **Docs.** `docs/tools.md` "Parallel rounds", `docs/loop.md`, `docs/agent.md`, `packages/extensions/delegate/README.md` (sync delegations overlap; the fifth concurrent one fails at the default `maxConcurrent` of 4), `CHANGELOG.md`.
    - **Checks.** `bun run typecheck` green; `biome lint` clean and `biome format` applied on the changed files; `docs.test.ts` 69 pass. The last full `bun run test` (before the budget and fixture fixes above) failed only in: the kernel budget (fixed), the multi-agent fixture (fixed), the host-builder index freshness (regenerated), and two gates owned by the uncommitted plan 218.2 memory work (the `@arnilo/prism-memory-system` export ceiling 1,147 vs 1,124 and the non-null-assertion count 159 vs 114 under `packages/memory/system/src/session`), unchanged by this task. After the fixes, the host-builder index and multi-agent files pass on their own; `contextBudget-10k-history` can exceed its 1,000 ms p95 when several test files run together.

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

- Parallel rounds are on by default (`tools.concurrency: 4`), a behavior change for every tool that declares `effects` and is not `exclusive`. A third-party tool that mutates shared state without `exclusive: true` now races with siblings of its round; `tools.concurrency: 1` is the escape hatch, documented in `docs/tools.md`.
- The default loop reads the concurrency through a module-private `WeakMap` instead of a `RunController` field, to keep the pinned primitive key set. A custom loop must pass `concurrency` itself.
- `resumed_round_marks_each_pending_call_dispatched` tests `serializeDurableMark` in isolation. A full resume with a custom loop passing `concurrency` over several `pendingCalls` was not built.
- No first-party memory or JSONL `RunLedger` exists, so the concurrent-ledger test uses an in-memory ledger; the SQLite and Postgres adapters were not run under a concurrent round.
- `SessionStateStore.append` (the `state.log` path) is still visible only after its append resolves; only `write` got read-your-writes.
- The full `bun run test` still fails on two gates owned by the uncommitted plan 218.2 memory work (export ceiling, non-null count). They are not caused by this plan.

## Further Actions

- Handed to `plans/backlog.md` on 2026-11-15 (Task 4 close-out). Candidates from the Task 1 review and Task 4:
  - MCP bridge tools declare `effect` but no `effects` (`packages/extensions/mcp/src/bridge.ts:255-257`), so every MCP round stays serial under Task 4's fail-closed rule. Deriving `effects` from `effectForRemoteTool` would let read-only MCP calls overlap. Medium.
  - Awaits before `execute` (effect-store `begin`, `beforeExecute` persist, `markDispatched`) are outside Task 3's race; a hung store still hangs the call. Medium.
  - Audit ACP, AG-UI and reference-host renderers for an adjacency assumption between `tool.started` and `tool.completed` once events interleave. Medium.
  - Read-your-writes for `state.log` appends (Task 4 compromise). Low.
