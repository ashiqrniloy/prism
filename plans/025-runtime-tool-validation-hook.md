# Phase 25 — Runtime tool validation hook

## Objectives
- Expose the existing `dispatchToolCall({ validate })` seam through the agent runtime so an app can supply app-level argument validation without taking ownership of dispatch.
- Add `AgentConfig.validator?: ToolValidator` and `RunOptions.validate?: ToolValidator` (named to match `DispatchToolCallOptions.validate`; `RunOptions` wins over `AgentConfig`).
- Have `RuntimeAgentSession.run()` thread `validate: options.validate ?? this.agent.config.validator` into `dispatchToolCall`.
- Reuse the existing `tool_execution_blocked` event with reason `validation_failed` (already emitted by `dispatchToolCall`), including redaction. No new event, no new validator concept.
- Update `docs/tools.md` to show the validator on `AgentConfig`/`RunOptions` (the `validate` field is already documented on `DispatchToolCallOptions`).

## Expected Outcome
- `createAgent({ model, validator })` causes tool calls blocked by the validator to emit `tool_execution_blocked` with `reason: "validation_failed"` and a redacted error, with the tool not executed.
- `session.run(input, { validate })` overrides the agent-level validator for that run only.
- A validator returning `void` lets the tool execute normally; a validator returning a string or `ErrorInfo` blocks dispatch.
- Existing tool dispatch tests still pass; new runtime-level test covers validator supplied via `AgentConfig` and via `RunOptions`.
- `npm test` stays network-free and under budget; no new dependencies; `src/` imports no `synapta*` package.

## Tasks

- [x] Task 1 — Primitive review: confirm `ToolValidator` / `DispatchToolCallOptions.validate` already expose the reusable validation primitive
  - Inventory result: confirmed in `src/tools.ts`.
    - `ToolValidator` (line 13): `(tool: ToolDefinition, args: JsonObject, context: ToolExecutionContext) => void | string | ErrorInfo | Promise<...>` — generic, Synapta-free.
    - `DispatchToolCallOptions.validate?: ToolValidator` (line 21).
    - Dispatch ordering: permission assertion at line 90 (`assertPermission`) → validator at line 93 (`options.validate?.(tool!, mediatedCall.arguments, context)`) → execute. Validator runs post-permission, pre-execute, as Task 1 required.
    - Block + redaction (line 94): non-`void` returns route to `blocked(mediatedCall, context, "validation_failed", toErrorInfo(validation, secrets), options.emit)`. `toErrorInfo` → `errorToErrorInfo`/`redactSecrets`, so validator output is redacted unconditionally. `void` falls through to `tool_execution_started` + execute (current behavior).
    - Conclusion: the primitive already exposes everything Phase 25 needs. `src/tools.ts` unchanged. Task 2 only adds config fields + one-line runtime plumbing.
  - Acceptance Criteria:
    - Functional: Inventory confirms `ToolValidator = (tool, args, context) => void | string | ErrorInfo | Promise<...>` is generic, Synapta-free, and `dispatchToolCall` already calls `options.validate?.(tool, mediatedCall.arguments, context)` and routes non-`void` returns to `blocked(..., "validation_failed", toErrorInfo(validation, secrets), emit)`. No mode/runtime-specific logic lands in `src/tools.ts`.
    - Performance: No change to dispatch hot path; validator is optional and only invoked after permission check, before the tool executes (existing position preserved).
    - Code Quality: No new primitive introduced. The runtime only threads an already-existing option; `src/tools.ts` is not edited.
    - Security: Validator runs after permission assertion and emits the redacted `tool_execution_blocked` event that already exists; no new error path or secret surface.
  - Approach:
    - Documentation Reviewed:
      - `src/tools.ts` lines 13–23: `ToolValidator` type and `DispatchToolCallOptions.validate` field already present and exported.
      - `src/tools.ts` lines 93–94: `options.validate?.(...)` → `blocked(mediatedCall, context, "validation_failed", toErrorInfo(validation, secrets), options.emit)`. Redaction via `toErrorInfo` → `errorToErrorInfo`/`redactSecrets`.
      - `src/contracts.ts` lines 150–162 (`RunOptions`) and 171–196 (`AgentConfig`): neither carries a validator/wrapper today; this is the gap Phase 25 closes at the config/runtime layer only.
      - `docs/tools.md` lines 12, 25, 46–55, 106: `validate` already documented on `DispatchToolCallOptions`; this task reuses it, does not introduce it.
    - Options Considered:
      - Reuse `DispatchToolCallOptions.validate` + add `AgentConfig.validator` / `RunOptions.validate` (runtime threads through): minimal, matches the existing seam name, road-mapped. Chosen.
      - Introduce a new `ToolValidationPolicy` object with compose/test hooks: rejected — YAGNI, roadmap explicitly says "compose-later; for now, RunOptions override only".
      - Let hosts wrap `tools` registry to inject validation: rejected — duplicates the seam and bypasses lifecycle ordering.
    - Chosen Approach:
      - Treat `validate` as the existing primitive. Task 2 only adds config fields + one-line plumbing in `RuntimeAgentSession.run`. `src/tools.ts` unchanged.
    - API Notes and Examples:
      ```ts
      // already exists in src/tools.ts — no edit
      export type ToolValidator = (
        tool: ToolDefinition,
        args: JsonObject,
        context: ToolExecutionContext,
      ) => void | string | ErrorInfo | Promise<void | string | ErrorInfo>;
      ```
    - Files to Create/Edit:
      - `plans/025-runtime-tool-validation-hook.md`: record the inventory result in this task (no code files touched here).
    - References:
      - `src/tools.ts` (validator seam, `blocked`, `toErrorInfo`), `src/contracts.ts` (`RunOptions`, `AgentConfig`), roadmap Phase 25.
  - Test Cases to Write:
    - No code test; this task is an inventory. Acceptance verified by reading `src/tools.ts` and confirming `validation_failed` emission + redaction are unconditional in `dispatchToolCall`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No — reuses already-documented `validate` field; no API surface added by this task.
    - Docs pages to create/edit:
      - `docs/tools.md`: no change in this task (Task 4 owns the `AgentConfig`/`RunOptions` additions).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Add `AgentConfig.validator` and `RunOptions.validate`, thread into `RuntimeAgentSession.run()`
  - Acceptance Criteria:
    - Functional: `AgentConfig.validator?: ToolValidator` and `RunOptions.validate?: ToolValidator` exist. `RunOptions.validate` overrides `AgentConfig.validator` when set; otherwise the agent-level validator is used; when neither is set, `validate` is `undefined` and `dispatchToolCall` runs unmodified (current behavior). The validator is passed as `validate: options.validate ?? this.agent.config.validator` to `dispatchToolCall`. A blocking validator produces a `tool_execution_blocked` event with `reason: "validation_failed"` and a redacted error, with the tool not executed; a `void` return executes normally.
    - Performance: No extra allocations per dispatch; the override expression is evaluated once per `dispatchToolCall` call, identical to how `redactor`/`permission` are threaded today.
    - Code Quality: Field names match `DispatchToolCallOptions.validate`. No re-implementation, no array composition (roadmap: "compose-later; for now, RunOptions override only" — marked with a `ponytail:` comment). Validator type imported as a type-only import; no runtime coupling to `synapta*`.
    - Security: Validator output is routed through the existing `toErrorInfo` → `errorToErrorInfo`/`redactSecrets` path inside `dispatchToolCall`; no raw validator string reaches an event unredacted. Validator runs after the permission assertion.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `RunOptions` (150–162) and `AgentConfig` (171–196): pattern for optional primitives (`redactor?: SecretRedactor`, `permission?: PermissionPolicy`) — mirror it for the validator.
      - `src/agents.ts` `dispatchToolCall({ call, registry, context, middleware, emit, permission, redactor })` call site near line 153: add `validate: options.validate ?? this.agent.config.validator`.
      - `src/agents.ts` imports already include `ToolRegistry`/`ToolResult` from contracts and `dispatchToolCall`/`createToolRegistry` from `./tools.js`; add a type-only import of `ToolValidator` from `./tools.js` (or re-export it on the public barrel in Task 4 so hosts can reference the type).
      - `src/tools.ts` `ToolValidator` and `DispatchToolCallOptions.validate`: the seam already redacts and emits — runtime must not duplicate.
    - Options Considered:
      - `validate` on both `AgentConfig` and `RunOptions`, RunOptions wins: matches `DispatchToolCallOptions.validate` name, mirror of `redactor`/`permission` precedence. Chosen.
      - `validator` on `AgentConfig` + `validate` on `RunOptions` (mixed names): rejected — diverges from existing field name, confusing.
      - Accept arrays on either and compose left-to-right: rejected — roadmap explicitly defers (YAGNI); `// ponytail:` comment notes the upgrade path.
    - Chosen Approach:
      - Add `validator?: ToolValidator` to `AgentConfig` and `validate?: ToolValidator` to `RunOptions`. Thread `validate: options.validate ?? this.agent.config.validator` into the existing `dispatchToolCall` call. One-line wiring, mirrors `redactor` precedence.
    - API Notes and Examples:
      ```ts
      // src/contracts.ts
      export interface RunOptions {
        // ...existing fields...
        readonly validate?: ToolValidator;
      }
      export interface AgentConfig {
        // ...existing fields...
        readonly validator?: ToolValidator;
      }
      ```
      ```ts
      // src/agents.ts — inside the tool loop, near existing dispatchToolCall call
      const result = await dispatchToolCall({
        call,
        registry,
        context: { sessionId: this.id, runId, toolCallId: call.id, signal: controller.signal, metadata },
        middleware: this.agent.config.middleware,
        emit: (event) => this.emit(event),
        permission: this.agent.config.permission,
        redactor: this.activeRedactor,
        // ponytail: RunOptions wins; array-compose deferred (roadmap: compose-later).
        validate: options.validate ?? this.agent.config.validator,
      });
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: add `validator?: ToolValidator` to `AgentConfig`, `validate?: ToolValidator` to `RunOptions` (type-import `ToolValidator`).
      - `src/agents.ts`: type-import `ToolValidator`; thread `validate` into the existing `dispatchToolCall` call site.
    - References:
      - `src/tools.ts` (`ToolValidator`, `DispatchToolCallOptions.validate`, `blocked`, `toErrorInfo`), `src/contracts.ts`, `src/agents.ts` runtime call site, roadmap Phase 25.
  - Test Cases to Write:
    - `validator` on `AgentConfig` returns a string → tool not executed, `tool_execution_blocked` event with `reason: "validation_failed"` and redacted error.
    - `validator` on `AgentConfig` returns `void` → tool executes normally, `tool_execution_finished` event emitted.
    - `RunOptions.validate` overrides `AgentConfig.validator` for that run (run-supplied blocks where agent-level would allow, and vice-versa).
    - No validator set → existing dispatch behavior unchanged (no `validation_failed` event; existing tests pass).
    - Validator returning `ErrorInfo` is redacted through the existing redactor (secrets scrubbed).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes — adds `AgentConfig.validator` and `RunOptions.validate` to the public config/run surface.
    - Docs pages to create/edit:
      - `docs/tools.md`: document the two new fields; show an example on `createAgent({ validator })` and `session.run(input, { validate })`. Owned by Task 4.
    - `docs/index.md` update: no new page; `tools.md` already indexed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Runtime validator tests (mock provider, network-free)
  - Acceptance Criteria:
    - Functional: New `src/__tests__/agents.test.ts` (or a focused `*-validator.test.ts`) cases: (a) `AgentConfig.validator` blocks with `validation_failed` + redacted error and does not execute the tool; (b) `void` return executes; (c) `RunOptions.validate` overrides `AgentConfig.validator`; (d) no validator → existing behavior, existing tool dispatch tests pass unchanged; (e) validator returning `ErrorInfo` is redacted when secrets are configured.
    - Performance: Tests run in-process against the mock provider; no network; fit within existing test time budget.
    - Code Quality: No fixtures beyond a no-op tool and a mock provider already used by `agents.test.ts`. Tests assert on emitted `AgentEvent`s, not internal state.
    - Security: A test asserts a validator that echoes a secret-like token returns a redacted error in the `tool_execution_blocked` event payload.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/agents.test.ts` and `src/__tests__/tools.test.ts`: existing patterns for constructing a mock provider + registry and asserting on `AgentEvent` stream; mirror for the validator cases.
      - `src/tools.ts` `blocked(...)` payload shape: `tool_execution_blocked { sessionId, runId, toolCallId, name, reason, error }`.
    - Options Considered:
      - Add cases to existing `agents.test.ts`: minimal, colocated with runtime behavior. Chosen.
      - New `runtime-validator.test.ts`: isolated but adds a file; only warranted if it grows. Rejected.
    - Chosen Approach:
      - Extend the existing agents test module with validator cases; reuse the mock provider + a registered no-op tool that records executions so a blocked call leaves the recorder untouched.
    - API Notes and Examples:
      ```ts
      const executed: unknown[] = [];
      const tool: ToolDefinition = {
        name: "echo",
        description: "d",
        parameters: { type: "object" },
        execute: async (args) => { executed.push(args); return { ok: true }; },
      };
      const events: AgentEvent[] = [];
      const agent = createAgent({
        model, provider: mockProvider, tools: [tool],
        validator: (_t, args) => (args.forbidden ? "no" : undefined),
      });
      await eachEvent(agent, (e) => events.push(e)).run("block me", { metadata: { forbidden: true } });
      // assert: events contains tool_execution_blocked with reason "validation_failed";
      //        executed stays empty.
      ```
    - Files to Create/Edit:
      - `src/__tests__/agents.test.ts`: add validator cases.
    - References:
      - Existing test patterns in `src/__tests__/agents.test.ts`, `src/__tests__/tools.test.ts`; `blocked`/`toErrorInfo` in `src/tools.ts`.
  - Test Cases to Write:
    - Covered by the acceptance criteria above.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No — tests only; behavior covered by Task 2 docs.
    - Docs pages to create/edit:
      - `none`: no docs change for test code.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 4 — Docs: `docs/tools.md` validator on `AgentConfig`/`RunOptions`; public barrel re-export of `ToolValidator`
  - Acceptance Criteria:
    - Functional: `docs/tools.md` gains a section showing `validator` on `AgentConfig` and `validate` on `RunOptions` (RunOptions wins), with a runnable TypeScript example producing a `validation_failed` block. The page cross-references the already-documented `DispatchToolCallOptions.validate` and the `tool_execution_blocked` event. `ToolValidator` is exported from `src/index.ts` so hosts can type the validator.
    - Performance: N/A (docs + type export).
    - Code Quality: Example compiles against the current public API; mirror existing `tools.md` example style. Re-export is a type-only re-export; no runtime surface added.
    - Security: Docs explicitly state validator output is redacted through the existing redactor and runs after the permission assertion.
  - Approach:
    - Documentation Reviewed:
      - `docs/tools.md` (existing `DispatchToolCallOptions.validate` documentation, lines 12/25/46–55/106): extend with an `AgentConfig`/`RunOptions` subsection rather than duplicating the field table.
      - `.agents/skills/create-plan/references/prism-wiki.md`: API page structure for the extended section (What it does / When to use it / Implementation example / Security notes).
      - `src/index.ts`: confirm `ToolValidator` is re-exported (re-export alongside `dispatchToolCall`/`createToolRegistry`).
    - Options Considered:
      - Extend `tools.md` with a validator subsection + example: keeps everything on the existing tools page that already documents `validate`. Chosen.
      - New `docs/tool-validation.md` page: rejected — too small to warrant its own page; `validate` is already a `tools.md` concept.
    - Chosen Approach:
      - Add a "Runtime-supplied validators" subsection to `tools.md` with `createAgent({ validator })` and `session.run(input, { validate })` examples; cross-link to `DispatchToolCallOptions.validate` and the `tool_execution_blocked` event. Re-export `ToolValidator` from the public barrel.
    - API Notes and Examples:
      ```ts
      // docs/tools.md example
      const agent = createAgent({
        model, provider, tools,
        validator: (_tool, args) =>
          typeof args.query === "string" && args.query.length <= 1000
            ? undefined
            : "query too long",
      });
      // override per run
      await session.run(input, { validate: (_t, args) => args.dry ? "dry-run" : undefined });
      ```
    - Files to Create/Edit:
      - `docs/tools.md`: add "Runtime-supplied validators" subsection + example + security note (redaction, post-permission ordering).
      - `src/index.ts`: re-export `ToolValidator` (type-only) if not already exported.
      - `src/__tests__/docs.test.ts`: extend docs compile-check to cover the new example, mirroring existing docs tests.
    - References:
      - `docs/tools.md`, `src/index.ts`, `src/__tests__/docs.test.ts`, `prism-wiki.md` API page structure.
  - Test Cases to Write:
    - `docs.test.ts` extracts the new example block and type-checks/compiles it against the public API (mirror existing docs test pattern).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes — re-export of `ToolValidator` and documentation of the two new config fields.
    - Docs pages to create/edit:
      - `docs/tools.md`: validator subsection + example + security note.
    - `docs/index.md` update: no — `tools.md` already indexed; no new page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Validator composition (multiple validators merged left-to-right) deferred per roadmap's "compose-later; for now, RunOptions override only". Hosts needing to combine validators wrap them in a single host-supplied function. Marked inline with a `// ponytail:` comment at the runtime call site. Upgrade path: accept `ToolValidator | readonly ToolValidator[]` on both surfaces and fold left-to-right in `dispatchToolCall` if real demand appears.
- `RunOptions.validate` overrides `AgentConfig.validator` wholesale; there is no merge of agent-level + run-level. Same YAGNI call as composition — override-only is the documented precedent (`redactor`, `permission`, `providerSource`).
- Field naming diverges slightly between the two surfaces by design to match the existing `DispatchToolCallOptions.validate` seam (`AgentConfig.validator` vs `RunOptions.validate`). A uniform `validate` name on both would shadow the established dispatch option; the split mirrors how the seam is already named.
- No new `tool-validation.md` docs page — `validate` is already a `docs/tools.md` concept; a subsection reuses it rather than fragmenting the tool surface. Trivial to split out if the section grows.
- Validator placement (post-permission, pre-execute) is the existing `dispatchToolCall` ordering and was left untouched rather than made configurable. Hosts wanting pre-permission validation must wrap `assertPermission` via their own `PermissionPolicy`, not the validator seam.

## Further Actions
- **Low**: If multiple validators genuinely need composition, extend `AgentConfig.validator` / `RunOptions.validate` to accept `readonly ToolValidator[]` and fold in `dispatchToolCall`. Defer until a real app asks; the host-wrap workaround covers it. (Roadmap explicitly defers this.)
- **Low**: Consider whether `RunOptions.validate` should merge with (rather than override) `AgentConfig.validator` once a second host reports the need. No change unless a use case appears.
- **Low**: Phase 26 (`activeSkills`, `Skill.context`, `toolNames` enforcement) builds directly on this runtime threading pattern; mirror the `options.X ?? this.agent.config.X` precedence when adding `RunOptions.activeSkills`.
- **Low**: If a host wants validator output visible unredacted for debugging, expose a debug-mode redactor passthrough — not the validator itself. Do not weaken the default redaction path.
- **None**: No new dependencies, no new events, no new primitives. Phase 25 closes exactly the seam the roadmap named.
