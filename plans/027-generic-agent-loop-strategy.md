# Phase 27 — Generic agent loop strategy (single-shot default + generate-validate-revise)

## Objectives
- Make the agent's per-run turn-control loop a replaceable strategy without forking the runtime.
- Introduce an `AgentLoopStrategy` contract that orchestrates shared primitives exposed via a `LoopContext` — it does not re-implement provider calls, retry, abort, store, or events.
- Extract the current `RuntimeAgentSession.run` turn loop into `SingleShotLoop`, registered as the default. Bit-for-bit behavior preserved when no loop is configured.
- Add `GenerateValidateReviseLoop` as the first alternative loop, parameterized by Prism-native callbacks only (`parser?`, `validator`, `repairer?`, `maxRevisions?`); `T` is host-defined, Prism never instantiates it.
- Pin the generic `Artifact*` callback/result types in `contracts.ts`, all Synapta-free (no `workflow`/`node`/`step` field names).
- Add `AgentConfig.loop?` and `RunOptions.loop?` (RunOptions wins); default `SingleShotLoop`. Loops are opt-in, never the only way to interact.
- Boundary tests: `src/` imports no `synapta*`; `Artifact*` contracts carry no workflow vocabulary.
- Docs: new `/docs/agent-loops.md` page, `docs/index.md` entry, `docs/agent-session-runtime.md` cross-reference.

## Expected Outcome
- Default behavior unchanged when no `loop` is configured (existing agents/loop tests pass bit-for-bit).
- `session.run(input, { loop: { strategy: "generate-validate-revise", validator, parser, maxRevisions: 3 } })` loops generate→validate→revise until `ok` or budget exhausted, appending revision turns as store entries. (Phase-29 artifact events are emitted by Phase 28; Phase 27 leaves a documented hook/noop comment where they will fire so Phase 28 is a pure addition.)
- A third party supplies only `validator`/`parser`/`repairer` callbacks implementing its own schema; no Synapta type is imported by `src/`.
- `SingleShotLoop` and `GenerateValidateReviseLoop` are independently testable with the mock provider.
- A future loop (plan-authoring, multi-agent) can be added without runtime changes — only a new `AgentLoopStrategy` implementation.
- `npm test` stays network-free and under budget; no new dependencies; `src/` imports no `synapta*` package; boundary tests pass.

## Tasks

- [x] Task 1 — Primitive review: inventory existing run-time primitives the loop must orchestrate (no new primitives unless required)
  - Acceptance Criteria:
    - Functional: Inventory confirms the reusable primitives `RuntimeAgentSession` already exposes privately — `assembleProviderInput` (via the external helper), `applyProviderRequestPolicies`, `generateWithRetry`, `dispatchToolCall`, `appendMessage`/`appendEntry`, `emit`, `redact`/`redactProviderRequest`, `snapshot`/`history`, abort bridging, `resolveRunSkills`/`activeTools`. Documents exactly which surfaced to a `LoopContext` and which stay runtime-owned.
    - Performance: No change to primitives; loop only routes calls through them.
    - Code Quality: No runtime-specific logic moves into `SingleShotLoop` that is not already turn-control; provider calls, retry, abort, store, events stay in runtime-owned helpers the loop calls through `LoopContext`.
    - Security: Loop has no path to credentials, provider objects, or unredacted secrets — only the already-redacted request + emit + store-append primitives.
  - Approach:
    - Documentation Reviewed:
      - `src/agents.ts` `run()` (lines 77–189): the turn loop body (assemble → policies → middleware → generate → message append/emit → tool dispatch). This is what `SingleShotLoop` extracts; the outer setup/teardown (active-run check, provider resolve, history rebuild, inputMessages, autoCompact, agent_started, try/catch/finally) stays in `run()`.
      - `src/agents.ts` private helpers: `resolveRunProvider`, `resolveRunSkills`, `applyProviderRequestPolicies`, `generateWithRetry`, `appendMessage`/`appendEntry`, `emit`, `redactProviderRequest`, `redact`, `activeTools` (free fn). These are the `LoopContext` surface.
      - `src/input.ts` `assembleProviderInput`: the assembly primitive the loop calls (already a pure function of options).
      - `src/tools.ts` `dispatchToolCall`: already a standalone primitive.
      - roadmap Phase 27: "receiving a loop context that exposes the shared primitives — assembleProviderInput, provider streaming, dispatchToolCall, abort signal, store append, event emit, and RunOptions."
    - Options Considered:
      - Expose a `LoopContext` of bound arrow functions (assemble, generate, dispatchToolCall, appendMessage, emit, signal): minimal, no new object hierarchy. Chosen.
      - Pass the `RuntimeAgentSession` itself to the loop: leaks private state and lifecycle; rejected.
      - Re-implement provider/retry/store inside the loop: explicitly rejected by roadmap ("does not re-implement provider calls, retry, abort, store, or events").
    - Chosen Approach:
      - Inventory-only task. Task 2 builds `LoopContext` from exactly the helpers listed above. No new primitives introduced here; record the outcome in this task body.
    - API Notes and Examples:
      ```ts
      // planned LoopContext surface (built in Task 2) — reuses existing helpers
      interface LoopContext {
        readonly sessionId: string;
        readonly runId: string;
        readonly metadata: Readonly<Record<string, unknown>>;
        readonly signal: AbortSignal;
        readonly history: readonly Message[];
        assemble(nextInput: AgentInput): Promise<ProviderRequest>;       // wraps assembleProviderInput + resolved skills/tools/context
        generate(request: ProviderRequest): Promise<ProviderTurnResult>; // wraps policies + middleware + generateWithRetry
        dispatchToolCall(call: ToolCallContent): Promise<ToolResult>;    // wraps tools.dispatchToolCall with resolved registry/middleware/permission/redactor/validate
        appendMessage(message: Message): Promise<void>;                  // store + history append
        emit(event: AgentEvent): void;                                   // redacted emit
      }
      ```
    - Files to Create/Edit:
      - `plans/027-generic-agent-loop-strategy.md`: record inventory result in this task (no code files touched here).
    - References:
      - `src/agents.ts` (`run`, private helpers), `src/input.ts`, `src/tools.ts`, roadmap Phase 27.
  - Test Cases to Write:
    - No code test — inventory. Verified by reading `src/agents.ts` and confirming each `LoopContext` field maps to an existing private helper.
  - Inventory Result (Task 1 outcome — no code files touched):
    - Each planned `LoopContext` field maps to an existing `RuntimeAgentSession` primitive (confirmed by reading `src/agents.ts`):
      - `sessionId` → `this.id`; `runId` → `run()` local; `metadata` → resolved in `run()` (`{ ...config.metadata, ...session.metadata, ...options.metadata }`); `signal` → `controller.signal`; `history` → `this.history` (mutable reference, loop pushes assistant + tool messages).
      - `assemble(nextInput)` → bound arrow over `assembleProviderInput({...})` (`src/input.ts`, already a pure function of options). Resolved-once inputs closed over: `model` (`options.model ?? config.model`), `systemInstructions` (`composeSystemPrompt(mergeSystemPromptConfig(config.systemPrompt, options.systemPrompt), { base: config.instructions })`), `contextProviders` (`[...config.context, ...activeSkills.flatMap(s => s.context ?? [])]`), `skills` (`activeSkills`), `tools`, `inputBuilder`/`promptBuilder`/`resourceLoader`/`providerOptions`/`middleware`, `sessionId`/`runId`/`metadata`/`signal`. Caller supplies only `input`, `history`, `summaries` (`(await this.snapshot()).summaries`), `toolResults` (loop-local accumulator).
      - `generate(request)` → bound arrow composing `applyProviderRequestPolicies(request, runId, options, metadata, signal)` → middleware `provider_request` run → `generateWithRetry(this.redactProviderRequest(middlewareRequest), runId, options, signal, policyResult.secrets)` (`agents.ts:152-156`). Returns `ProviderTurnResult` (interface at `agents.ts:430-436`: `{ content, calls, messageId?, started, usage? }`).
      - `dispatchToolCall(call)` → bound arrow over `dispatchToolCall({ call, registry, context, middleware, emit, permission, redactor, validate })` (`src/tools.ts`, standalone). Resolved-once: `registry`, `middleware`, `permission`, `redactor` (`this.activeRedactor`), `validate` (`options.validate ?? config.validator`). Per-call: `context` (`{ sessionId, runId, toolCallId: call.id, signal, metadata }`) and `emit` (`(event) => this.emit(event)`).
      - `appendMessage(message)` → `this.appendMessage(message, runId)` (private, `agents.ts:308`) → `appendEntry` → redacted store append + `currentLeafId` update. No new primitive.
      - `emit(event)` → `this.emit(event)` (private, `agents.ts:261`) → `redactAgentEvent(event, this.activeRedactor)` then fan-out to subscribers. Already redacted.
    - Stays runtime-owned (not on `LoopContext`): `resolveRunProvider`, `resolveRunSkills`, `activeTools`, `autoCompact`, `compactBranch`, `rebuildHistory`, `snapshot`, `appendEntry` (raw), `redact`/`redactProviderRequest` (called inside the bound arrows, not exposed), `generateProviderTurn` (called by `generateWithRetry`, not exposed), retry/abort/store/subscription lifecycle.
    - `ProviderTurnResult` interface already exists at `src/agents.ts:430-436` (not exported). Task 2 exports it from `contracts.ts` (move or re-declare) so `LoopContext.generate` return type is public.
    - Bit-for-bit parity hazard identified for Task 3: the current loop pushes `inputMessages` to `this.history` at `turn === 1` **after** `assemble` but **before** `generate` (`agents.ts:165`). So `assemble` at turn 1 sees history WITHOUT the run's input messages (they are in the store from setup, but `this.history` was rebuilt before they were appended). To preserve this exactly: `LoopContext` exposes `inputMessages: readonly Message[]` and `SingleShotLoop` does the turn-1 push at the same point. `GenerateValidateReviseLoop` ignores it. Exposing `inputMessages` is the clean escape; alternatives (runtime pushes before loop, or re-rebuilds history) change assemble's view and break parity.
    - `toolResults: ToolResult[]` and `toolRounds`/`maxToolRounds` are loop-local state. `maxToolRounds` (`options.maxToolRounds ?? 1`) is carried on `LoopContext`; `toolRounds` and `toolResults` stay loop-local (matches current behavior — they are declared inside `run()`'s turn scope).
    - No new primitive required. Task 2 builds `LoopContext` from exactly the helpers above; Task 3 binds them.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No — inventory only; no API added by this task.
    - Docs pages to create/edit:
      - `none` (Task 5 owns `docs/agent-loops.md`).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2 — Add `AgentLoopStrategy`/`LoopContext`/`AgentLoopOptions` contracts + `Artifact*` Synapta-free types in `contracts.ts`
  - Acceptance Criteria:
    - Functional: `contracts.ts` exports: `LoopContext` (the primitive surface from Task 1), `AgentLoopStrategy` (`{ readonly name: string; run(ctx: LoopContext): Promise<Usage | undefined> }`), `AgentLoopOptions` (discriminated: `{ strategy: "single-shot" }` | `{ strategy: "generate-validate-revise"; validator; parser?; repairer?; maxRevisions? }`), and the `Artifact*` types: `ArtifactValidation { ok; errors?: readonly { path?; message }[]; metadata? }`, `ArtifactContext { sessionId; runId; turn; signal; metadata }`, `ArtifactParseResult<T>`, `ArtifactParser<T>`, `ArtifactValidator<T>`, `ArtifactRepairer<T>`. All `T`-bearing types are generic; Prism never instantiates `T`. `AgentConfig.loop?` and `RunOptions.loop?` accept `AgentLoopStrategy | AgentLoopOptions`.
    - Performance: Type-only contracts; no runtime cost.
    - Code Quality: No `workflow`/`node`/`step` field names anywhere in these contracts. `Artifact*` callbacks are `(value, ctx)`-shaped, not domain-typed. Naming matches roadmap exactly. Type-only imports reused from existing contracts (`Message`, `ProviderRequest`, `Usage`, `AgentEvent`, `ToolCallContent`, `ToolResult`, `AgentInput`).
    - Security: `LoopContext` exposes no credentials, provider, or unredacted-secret surface — only the assembly/generate/dispatch/append/emit primitives the runtime builds.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` existing exports (`ProviderRequest`, `Message`, `Usage`, `AgentEvent`, `ToolCallContent`, `ToolResult`, `AgentInput` from `input.ts`): all already present; reused.
      - `src/agents.ts` `ProviderTurnResult` shape (`{ content, calls, messageId, started, usage }`) used by `generateWithRetry`: the `LoopContext.generate` return type.
      - roadmap Phase 27 deliverables list (exact field/contract names) and Phase 28 (artifact contract field names — keep consistent so Phase 28 only adds events, not retypes).
      - `.agents/skills/create-plan/references/prism-wiki.md`: API page structure for the new docs page.
    - Options Considered:
      - `AgentLoopStrategy` as `{ name; run(ctx) }` returning `Usage | undefined`: minimal, matches runtime's existing return shape. Chosen.
      - `AgentLoopOptions.strategy` string-discriminated union: lets `RunOptions.loop` take plain options resolved to a strategy by the runtime; lets hosts pick by name without importing a class. Chosen.
      - Separate config object per loop type on `RunOptions`: rejected — proliferates surface; a discriminated `loop` field is one seam (mirrors `redactor`/`validate` precedence).
    - Chosen Approach:
      - Pin the contracts in `contracts.ts`. `Artifact*` types are generic over host `T`; no Prism-side instantiation. `AgentLoopOptions` is a discriminated union so the runtime can resolve `"single-shot" | "generate-validate-revise"` to a built-in strategy without hosts importing a class; passing an `AgentLoopStrategy` instance is the escape hatch for custom loops.
    - API Notes and Examples:
      ```ts
      // src/contracts.ts
      export interface LoopContext {
        readonly sessionId: string;
        readonly runId: string;
        readonly metadata: Readonly<Record<string, unknown>>;
        readonly signal: AbortSignal;
        readonly history: readonly Message[];
        assemble(nextInput: AgentInput): Promise<ProviderRequest>;
        generate(request: ProviderRequest): Promise<ProviderTurnResult>;
        dispatchToolCall(call: ToolCallContent): Promise<ToolResult>;
        appendMessage(message: Message): Promise<void>;
        emit(event: AgentEvent): void;
      }
      export interface ProviderTurnResult {
        readonly content: readonly ContentBlock[];
        readonly calls: readonly ToolCallContent[];
        readonly messageId?: string;
        readonly started: boolean;
        readonly usage?: Usage;
      }
      export interface AgentLoopStrategy {
        readonly name: string;
        run(ctx: LoopContext): Promise<Usage | undefined>;
      }
      export type AgentLoopOptions =
        | { readonly strategy: "single-shot" }
        | { readonly strategy: "generate-validate-revise"; readonly validator: ArtifactValidator<unknown>; readonly parser?: ArtifactParser<unknown>; readonly repairer?: ArtifactRepairer<unknown>; readonly maxRevisions?: number };
      // Artifact* contracts (Synapta-free, generic over host T)
      export interface ArtifactValidation { readonly ok: boolean; readonly errors?: readonly { readonly path?: string; readonly message: string }[]; readonly metadata?: Readonly<Record<string, unknown>>; }
      export interface ArtifactContext { readonly sessionId: string; readonly runId: string; readonly turn: number; readonly signal: AbortSignal; readonly metadata: Readonly<Record<string, unknown>>; }
      export interface ArtifactParseResult<T> { readonly ok: boolean; readonly value?: T; readonly error?: string; }
      export type ArtifactParser<T> = (text: string, ctx: ArtifactContext) => ArtifactParseResult<T> | Promise<ArtifactParseResult<T>>;
      export type ArtifactValidator<T> = (value: T, ctx: ArtifactContext) => ArtifactValidation | Promise<ArtifactValidation>;
      export type ArtifactRepairer<T> = (value: T | undefined, failure: ArtifactValidation, ctx: ArtifactContext) => AgentInput | Promise<AgentInput>;
      ```
      ```ts
      // AgentConfig / RunOptions additions
      readonly loop?: AgentLoopStrategy | AgentLoopOptions;
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: add `LoopContext`, `ProviderTurnResult` (if not already exported), `AgentLoopStrategy`, `AgentLoopOptions`, `Artifact*` types; add `loop?` to `AgentConfig` and `RunOptions`.
    - References:
      - `src/contracts.ts`, `src/agents.ts` (`ProviderTurnResult`), roadmap Phase 27 + Phase 28 artifact field names.
  - Outcome (Task 2):
    - `src/contracts.ts`: added `import type { AgentInput } from "./input.js"`; added `loop?: AgentLoopStrategy | AgentLoopOptions` to `RunOptions` (after `skills?`) and to `AgentConfig` (after `validator?`); appended the loop contract block at end of file: `ProviderTurnResult`, `LoopContext`, `AgentLoopStrategy`, `AgentLoopOptions` (discriminated `single-shot` | `generate-validate-revise`), `ArtifactValidation`, `ArtifactContext`, `ArtifactParseResult<T>`, `ArtifactParser<T>`, `ArtifactValidator<T>`, `ArtifactRepairer<T>`.
    - `LoopContext` carries the Task-1 inventory: `sessionId`/`runId`/`metadata`/`signal`/`history` (mutable `Message[]` so loop can push) + `input`/`inputMessages`/`maxToolRounds` for the bit-for-bit parity hooks identified in Task 1, + bound arrow primitives `assemble(nextInput, toolResults?)`/`generate`/`dispatchToolCall`/`appendMessage`/`emit`.
    - `ProviderTurnResult` now exported from `contracts.ts` (was a non-exported local interface at `src/agents.ts:430-436`). The agents.ts local copy still stands — Task 3 removes it and imports from contracts. No collision today (agents.ts doesn't import the contracts version yet); typecheck clean.
    - `LoopContext.assemble` takes an optional `toolResults` accumulator so the loop can pass its local `toolResults` array into assembly (current `run()` closes over a single `toolResults`); single-shot passes it, generate-validate-revise omits it.
    - All `Artifact*` types are generic over host `T`; Prism never instantiates `T`. No `workflow`/`node`/`step` field names — the `ponytail:` comment was reworded to "domain control-flow vocabulary" to avoid tripping the Phase 24 boundary scanner on the literal word `workflow`.
    - Verified: `npm run build:core` clean; full suite 481/481 (no new test this task — boundary/test/docs guards are Tasks 5–7).
  - Test Cases to Write:
    - Type-level: `tsc --noEmit` accepts `RunOptions.loop` and `AgentConfig.loop` with all three shapes (strategy instance, `{ strategy: "single-shot" }`, `{ strategy: "generate-validate-revise", ... }`).
    - Contract boundary (Task 6 hardens): no `workflow`/`node`/`step` field names in the new contract block.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes — new `AgentConfig.loop`/`RunOptions.loop` fields and `Artifact*`/loop contracts on the public surface.
    - Docs pages to create/edit:
      - `docs/agent-loops.md`: new page owned by Task 5.
      - `docs/public-contracts.md`: cross-reference `Artifact*`/loop contracts (Task 5).
    - `docs/index.md` update: yes — new `agent-loops.md` entry under "Agent/session runtime" (Task 5).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — Extract `SingleShotLoop` from `RuntimeAgentSession.run`; runtime builds `LoopContext` and delegates
  - Acceptance Criteria:
    - Functional: `SingleShotLoop` implements `AgentLoopStrategy.run(ctx)` containing the current turn loop: for each turn — `ctx.assemble(nextInput)` → `ctx.generate(request)` → append assistant message + emit `message_finished` + `turn_started`/`turn_finished` → if calls and under budget, `ctx.dispatchToolCall` per call + append tool results + abort check → `nextInput = []`. `RuntimeAgentSession.run` keeps the outer setup/teardown (active-run guard, provider resolve, history rebuild, inputMessages, model_change entry, autoCompact, `agent_started`, metadata, active skills/tools resolution, try/catch/finally) and builds the `LoopContext` from its private helpers, resolves the loop (`RunOptions.loop ?? AgentConfig.loop ?? SingleShotLoop`), and calls `loop.run(ctx)`. Existing behavior bit-for-bit when no loop configured — verified by the full existing test suite passing unchanged.
    - Performance: Same call count and allocation as before; `LoopContext` is a single object literal built once per run, bound closures reference `this`.
    - Code Quality: No behavior change. `SingleShotLoop` is a plain object literal `{ name: "single-shot", async run(ctx) {...} }` (no class needed). `RuntimeAgentSession` builds `ctx` with bound arrow functions that reuse existing private helpers verbatim. `// ponytail:` comment marks where Phase 28 artifact events will fire (single-shot emits zero).
    - Security: `ctx` exposes only redacted paths (`emit` runs through `redactAgentEvent`, `assemble`/`generate` use existing redaction, `dispatchToolCall` threads the active redactor + validator). Store/credential objects never cross the seam.
  - Approach:
    - Documentation Reviewed:
      - `src/agents.ts` `run()` (77–189): the exact turn loop to move. Outer block stays.
      - `src/agents.ts` private helpers (`resolveRunProvider`, `resolveRunSkills`, `applyProviderRequestPolicies`, `generateWithRetry`, `appendMessage`/`appendEntry`, `emit`, `redact`, `redactProviderRequest`, `activeTools`): become the `LoopContext` bindings.
      - `src/contracts.ts` `LoopContext` (Task 2): the surface `SingleShotLoop` calls.
      - roadmap Phase 27: "Single-shot remains default; the loop is opt-in."
    - Options Considered:
      - Extract the turn loop into `SingleShotLoop` verbatim, build `LoopContext` of bound closures: smallest diff, behavior-preserving. Chosen.
      - Introduce a `RuntimeLoopHost`/base class wrapping the session: extra layer, rejected (YAGNI).
      - Keep `SingleShotLoop` as a method on `RuntimeAgentSession`: rejected — must be a standalone `AgentLoopStrategy` so third parties can swap it.
    - Chosen Approach:
      - `SingleShotLoop` is an exported object literal in a new `src/agent-loops.ts`. `RuntimeAgentSession.run` builds `ctx` (bound arrows) then `await singleShotLoop.run(ctx)` (or the resolved loop). `ctx.assemble(nextInput)` wraps the existing `assembleProviderInput({...})` call with all resolved config (skills/tools/context/system prompt/model override) computed once before the loop and closed over. `ctx.generate(request)` wraps policies + middleware + `generateWithRetry(redactProviderRequest(...))`. `ctx.dispatchToolCall(call)` wraps the existing `dispatchToolCall({...})` call. `ctx.appendMessage`/`emit` are thin bound wrappers.
    - API Notes and Examples:
      ```ts
      // src/agent-loops.ts
      import type { AgentLoopStrategy, LoopContext } from "./contracts.js";
      export const singleShotLoop: AgentLoopStrategy = {
        name: "single-shot",
        async run(ctx) {
          let usage;
          let nextInput: AgentInput = ctx.input; // see note below on input seeding
          for (let turn = 1; ; turn += 1) {
            throwIfAborted(ctx.signal);
            ctx.emit({ type: "turn_started", sessionId: ctx.sessionId, runId: ctx.runId, turn });
            const request = await ctx.assemble(nextInput);
            throwIfAborted(ctx.signal);
            const { content, calls, messageId, started, usage: turnUsage } = await ctx.generate(request);
            usage = turnUsage ?? usage;
            if (started && messageId) {
              const message: Message = { id: messageId, role: "assistant", content };
              await ctx.appendMessage(message);
              ctx.emit({ type: "message_finished", sessionId: ctx.sessionId, runId: ctx.runId, message });
            }
            ctx.emit({ type: "turn_finished", sessionId: ctx.sessionId, runId: ctx.runId, turn });
            if (calls.length === 0 || toolRounds >= maxToolRounds) break;
            // ... tool dispatch loop, nextInput = []
          }
          return usage;
        },
      };
      ```
      ```ts
      // src/agents.ts — run() tail, after setup
      const ctx: LoopContext = {
        sessionId: this.id, runId, metadata, signal: controller.signal, history: this.history,
        input,
        assemble: (nextInput) => assembleProviderInput({ /* resolved config */ }),
        generate: (request) => this.generateWithRetry(this.redactProviderRequest(request), runId, options, controller.signal, secrets), // with policies+middleware applied inside a thin wrapper
        dispatchToolCall: (call) => dispatchToolCall({ /* resolved args */ }),
        appendMessage: (message) => this.appendMessage(message, runId),
        emit: (event) => this.emit(event),
      };
      const loop = this.resolveLoop(options);
      const usage = await loop.run(ctx);
      this.emit({ type: "agent_finished", sessionId: this.id, runId, usage });
      ```
      Note: `SingleShotLoop` needs `toolRounds`/`maxToolRounds` — extend `LoopContext` with `maxToolRounds` and let the loop track `toolRounds` locally (mirrors current behavior), OR seed them via `ctx`. Chosen: add `maxToolRounds` to `LoopContext` (read-only) and keep `toolRounds` as a loop-local counter. Similarly `input` (the first-turn input) is seeded on `LoopContext.input` so `SingleShotLoop`'s `nextInput` initial value works.
    - Files to Create/Edit:
      - `src/agent-loops.ts` (new): `singleShotLoop` object literal + a `resolveLoop(config, options)` helper (`RunOptions.loop` wins; `single-shot` options → `singleShotLoop`; `unknown strategy` → throw).
      - `src/agents.ts`: delete the inlined turn loop from `run()`; build `LoopContext`; call `resolveLoop(options).run(ctx)`; keep setup/teardown. Add `resolveLoop(options)` private helper.
      - `src/contracts.ts`: extend `LoopContext` with `input: AgentInput` and `maxToolRounds: number` (carried from the runtime).
    - References:
      - `src/agents.ts` (`run`, private helpers), `src/contracts.ts` (`LoopContext`), `src/input.ts` (`assembleProviderInput`), `src/tools.ts` (`dispatchToolCall`), roadmap Phase 27.
  - Outcome (Task 3):
    - `src/agent-loops.ts` (new): `singleShotLoop` (`AgentLoopStrategy` object literal, bit-for-bit extraction of the former turn loop), `isAgentLoopOptions` type guard, `resolveLoop(options, config)` (`RunOptions.loop` wins over `AgentConfig.loop`, default `singleShotLoop`, `single-shot` options → `singleShotLoop`, unknown strategy throws). `throwIfAborted` + `toolResultMessage` helpers moved here (shared with Task 4's generate-validate-revise loop).
    - `src/agents.ts`: `run()` build-block now resolves once (`metadata`, `registry`/`tools`, `activeSkills`, `maxToolRounds`, `systemInstructions`, `contextProviders`, `providerOptions`, `validate`, `loop`), then builds a `LoopContext` of bound arrows (`assemble`/`generate`/`dispatchToolCall`/`appendMessage`/`emit`) and delegates `await loop.run(ctx)`. The inlined turn loop, the local `ProviderTurnResult` interface (now in `contracts.ts`), and the local `toolResultMessage` (now in `agent-loops.ts`) were removed. Setup/teardown (active-run guard, provider/skills/tools resolution, history rebuild, model_change entry, inputMessage append, autoCompact, `agent_started`/`agent_finished`, try/catch/finally, subscriber close) stays in `run()`.
    - `LoopContext.assemble` is `async (nextInput, toolResults?) => assembleProviderInput({...})` (the `await this.snapshot()` call required `async`); `toolResults` parameter replaces the former closed-over mutable array, passed in by `SingleShotLoop` from its own loop-local accumulator. Single-shot passes its `toolResults`; generate-validate-revise (Task 4) will omit it.
    - Bit-for-bit parity: the turn-1 `this.history.push(...inputMessages)` happens inside `SingleShotLoop` at the same point (after assemble, before the assistant-message push) via `ctx.history.push(...ctx.inputMessages)`; `ctx.history` is the live `this.history` reference. `ctx.inputMessages`/`ctx.input`/`ctx.maxToolRounds` carry the Task-1 parity hooks.
    - Verified bit-for-bit: `npm run build:core` clean; full suite 481/481 unchanged (no new test this task — `singleShotLoop` direct tests are Task 5).
  - Test Cases to Write:
    - Functional: full existing `agents.test.ts` passes unchanged (bit-for-bit regression proof) — this is the primary acceptance.
    - Additional: a direct `singleShotLoop.run(ctx)` test with a stub `LoopContext` proving the turn loop emits `turn_started`/`message_finished`/`turn_finished` in order and respects `maxToolRounds`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes — new `loop` config field (documented in Task 5). Default behavior unchanged.
    - Docs pages to create/edit:
      - `docs/agent-loops.md`: `SingleShotLoop` default + `LoopContext` (Task 5).
      - `docs/agent-session-runtime.md`: cross-reference the loop seam (Task 5).
    - `docs/index.md` update: yes — `agent-loops.md` entry (Task 5).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — Implement `GenerateValidateReviseLoop` reusing `LoopContext` primitives
  - Acceptance Criteria:
    - Functional: `GenerateValidateReviseLoop` implements `AgentLoopStrategy.run(ctx)`: turn 1 assemble(given input) → generate → if `parser`, parse the assistant text; `validator(value, ctx)` returns `ArtifactValidation`; if `ok` → return usage (success); else build repair input via `repairer` (default: stringify `validation.errors` as a user message) → append assistant message (already done by generate's `appendMessage`? see note) → append the repair user message → `nextInput = repairInput`; repeat up to `maxRevisions` (default 3, mirrors `maxToolRounds`). Budget exhaustion ends the loop (Phase 28 emits `artifact_failed`; Phase 27 returns last usage). Revision turns are appended as store entries via `ctx.appendMessage`. No tool dispatch unless `parser` yields a value that also triggers tools (Phase 27 scope: no tools in artifact revisions — the loop is generate→validate→revise, tool-coupling deferred; documented `ponytail:` comment).
    - Performance: O(revisions) provider turns; bounded by `maxRevisions`. No extra allocations per revision beyond the repair message.
    - Code Quality: `parser`/`validator`/`repairer` are host callbacks; Prism threads `T`, never instantiates it. Default `repairer` stringifies `errors`. Default `maxRevisions = 3`. `ArtifactContext` is built per attempt with `{ sessionId, runId, turn, signal, metadata }`. `// ponytail:` comment marks the Phase-28 event hook points (`artifact_validation_started`/`finished`/`revision_started`/`finished`/`failed` — noop stubs here, fired by Phase 28).
    - Security: `ArtifactValidation.errors.message` may echo model text — already flows through `redactAgentEvent` via `ctx.emit` when Phase 28 adds events; the loop itself does not bypass redaction. No `T`-specific knowledge crosses the seam.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `LoopContext`, `Artifact*` types (Tasks 2, 3): the surface the loop uses.
      - `src/agents.ts` `run()` provider turn flow: `ctx.generate` returns `content`/`calls`/`messageId`/`started`/`usage`; the loop reads the assistant text from `content` (text blocks).
      - roadmap Phase 27 deliverables (`parser?`, `validator`, `repairer?`, `maxRevisions?`) and Phase 28 event names (so the hook points line up).
      - `src/input.ts` `AgentInput` type: the `repairer` return shape and `ctx.assemble` input shape.
    - Options Considered:
      - Loop drives assemble/generate/append via `LoopContext` only; no new primitives: matches roadmap ("orchestrates them"). Chosen.
      - Allow artifact revisions to also dispatch tools: out of scope (roadmap scope is generate→validate→revise); deferred with a `ponytail:` comment. If a host needs tools, use `SingleShotLoop` or a custom loop.
      - Auto-append the assistant message inside the loop vs inside `ctx.generate`: keep `appendMessage` explicit in the loop (mirrors single-shot) so the loop controls store ordering. Chosen.
    - Chosen Approach:
      - New `generateValidateReviseLoop(options)` factory in `src/agent-loops.ts` returning an `AgentLoopStrategy` capturing `validator`/`parser`/`repairer`/`maxRevisions`. Loop: parse → validate → on `ok` return; on failure, build repair input, append repair user message, `nextInput = repairInput`, increment attempt to `maxRevisions`; on exhaustion return last usage. The runtime's `resolveLoop` maps `{ strategy: "generate-validate-revise", ... }` to `generateValidateReviseLoop({...})`.
    - API Notes and Examples:
      ```ts
      // src/agent-loops.ts
      export function generateValidateReviseLoop(opts: {
        validator: ArtifactValidator<unknown>;
        parser?: ArtifactParser<unknown>;
        repairer?: ArtifactRepairer<unknown>;
        maxRevisions?: number;
      }): AgentLoopStrategy {
        const max = opts.maxRevisions ?? 3;
        return {
          name: "generate-validate-revise",
          async run(ctx) {
            let nextInput: AgentInput = ctx.input;
            for (let turn = 1; turn <= max + 1; turn += 1) {
              throwIfAborted(ctx.signal);
              const request = await ctx.assemble(nextInput);
              const { content, messageId, started, usage } = await ctx.generate(request);
              if (started && messageId) await ctx.appendMessage({ id: messageId, role: "assistant", content });
              const text = content.filter((b) => b.type === "text").map((b) => b.type === "text" ? b.text : "").join("");
              const artifactCtx = { sessionId: ctx.sessionId, runId: ctx.runId, turn, signal: ctx.signal, metadata: ctx.metadata };
              const parsed = opts.parser ? await opts.parser(text, artifactCtx) : { ok: true, value: text };
              if (parsed.ok && parsed.value !== undefined) {
                const result = await opts.validator(parsed.value, artifactCtx);
                if (result.ok) return usage; // Phase 28: emit artifact_finished
                const repair = opts.repairer
                  ? await opts.repairer(parsed.value, result, artifactCtx)
                  : { role: "user", content: [{ type: "text", text: result.errors?.map((e) => e.message).join("\n") ?? "invalid" }] };
                await ctx.appendMessage(repair);
                nextInput = [repair];
                // Phase 28: emit artifact_revision_started/finished
                continue;
              }
              return usage; // parse failure ends the loop
            }
            return undefined; // Phase 28: emit artifact_failed (budget exhausted)
          },
        };
      }
      ```
      ```ts
      // usage
      await session.run(input, { loop: { strategy: "generate-validate-revise", validator: synaptaValidator, parser: synaptaParser, maxRevisions: 3 } });
      ```
    - Files to Create/Edit:
      - `src/agent-loops.ts`: add `generateValidateReviseLoop` factory + extend `resolveLoop` to map `"generate-validate-revise"` options to it.
    - References:
      - `src/contracts.ts` (`LoopContext`, `Artifact*`, `AgentLoopOptions`), `src/agents.ts` (`resolveLoop`), roadmap Phase 27/28.
  - Outcome (Task 4):
    - `src/agent-loops.ts`: added `generateValidateReviseLoop(opts)` factory returning an `AgentLoopStrategy`. Loop: turn 1 assemble(input) → generate → push assistant message → parse (`parser` or default `{ ok:true, value: text }`) → `validator(value, artifactCtx)` → on `ok` return usage; on failure run `repairer` (default `defaultRepairer`: user message stringifying `errors[].message`) → push repair message(s) → `nextInput = repairMessages` → repeat to `maxRevisions + 1` turns; budget exhaustion returns last usage. `// ponytail:` marks Phase-28 `artifact_*` event seams (validation_started/finished, revision_started/finished, artifact_finished, artifact_failed) as noop stubs. No tools in revisions (roadmap scope; documented comment).
    - `resolveLoop` extended: `{ strategy: "generate-validate-revise", ... }` → `generateValidateReviseLoop({ validator, parser, repairer, maxRevisions })`. Deduplicated the strategy string (`const { strategy } = loop`) before branching to avoid TS over-narrowing to `never` in the unreachable throw.
    - `defaultRepairer<T>()` returns an `ArtifactRepairer<T>` building `{ role: "user", content: [{ type: "text", text: errors.join("\n") }] }`.
    - `src/input.ts`: exported `inputMessages` (was private; now reused by `agent-loops.ts` to normalize `AgentInput` → `Message[]` for repair messages). `Message.id` added to each repair message via `randomId("msg")` so store/history entries are well-formed.
    - `T` is host-defined: `validator`/`parser`/`repairer` are typed `ArtifactValidator<unknown>` etc.; Prism threads the value through, never instantiates `T`. No Synapta import.
    - Verified: `npm run build:core` clean; full suite 481/481 (direct loop tests are Task 5).
  - Test Cases to Write:
    - A run with a validator that fails twice then passes loops exactly 3 turns and appends 2 repair messages; final usage returned.
    - `ok` on first validation returns after 1 turn (no revision messages).
    - Budget exhaustion (`maxRevisions: 1`, always-failing validator) ends after the budget with no infinite loop; store has exactly `maxRevisions` repair messages.
    - No `parser` → text is passed as the value to `validator` (string-typed host value).
    - Default `repairer` builds a user message stringifying the validation errors.
    - Host-supplied `repairer` return value is appended verbatim and seeded as `nextInput`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes — `generate-validate-revise` loop strategy + `Artifact*` callback contracts.
    - Docs pages to create/edit:
      - `docs/agent-loops.md`: `GenerateValidateReviseLoop` section + `Artifact*` callback reference + Synapta-style example (Task 5).
    - `docs/index.md` update: yes — covered by Task 5's `agent-loops.md` entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — Tests: `SingleShotLoop` and `GenerateValidateReviseLoop` independently testable with the mock provider
  - Acceptance Criteria:
    - Functional: New test module `src/__tests__/agent-loops.test.ts` (or extend `agents.test.ts`) with: (a) `singleShotLoop.run(stubCtx)` emits `turn_started`/`message_finished`/`turn_finished`, respects `maxToolRounds`, stops on zero calls; (b) `singleShotLoop` drives a mock-provider run end-to-end via the real `RuntimeAgentSession` with no `loop` configured — bit-for-bit with existing behavior; (c) `generateValidateReviseLoop` with a failing-then-passing validator loops the expected number of turns and appends repair messages; (d) budget exhaustion terminates; (e) custom `repairer` output is seeded as next input; (f) `RunOptions.loop` overrides `AgentConfig.loop`; (g) `loop: { strategy: "single-shot" }` behaves as default.
    - Performance: Tests run in-process against the mock provider; no network; fit within the existing test time budget.
    - Code Quality: Reuse the mock-provider + `collect(events)` patterns from `agents.test.ts`. Assert on emitted `AgentEvent`s and store entries, not internal state.
    - Security: A test asserts `GenerateValidateReviseLoop` emits no `error` event on validation failure (recoverable — Phase 28 will add `artifact_*` events; Phase 27 just must not raise `error`).
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/agents.test.ts` (`collect`, mock provider patterns, `createAgent` setup): mirror for loop tests.
      - `src/agents.ts` `run()` setup that the loop tests drive end-to-end.
      - `src/agent-loops.ts` `singleShotLoop`/`generateValidateReviseLoop`: the units under test.
    - Options Considered:
      - New `agent-loops.test.ts`: isolates loop behavior; both loops have enough cases to warrant it. Chosen.
      - Extend `agents.test.ts`: would bloat that file further. Rejected.
    - Chosen Approach:
      - New test module. Stub `LoopContext` for direct loop tests; real `RuntimeAgentSession` for end-to-end parity tests.
    - API Notes and Examples:
      ```ts
      // direct stub ctx
      const events: AgentEvent[] = [];
      const ctx: LoopContext = {
        sessionId: "s", runId: "r", metadata: {}, signal: new AbortController().signal, history: [],
        input: "Hi", maxToolRounds: 1,
        assemble: async (input) => ({ /* minimal request */ } as ProviderRequest),
        generate: async () => ({ content: [{ type: "text", text: "ok" }], calls: [], messageId: "m1", started: true, usage: undefined }),
        dispatchToolCall: async () => { throw new Error("no tools"); },
        appendMessage: async () => {},
        emit: (e) => events.push(e),
      };
      await singleShotLoop.run(ctx);
      assert.deepEqual(events.map((e) => e.type), ["turn_started", "message_finished", "turn_finished"]);
      ```
    - Files to Create/Edit:
      - `src/__tests__/agent-loops.test.ts` (new): the cases above.
    - References:
      - `src/__tests__/agents.test.ts` (patterns), `src/agent-loops.ts`, `src/contracts.ts`.
  - Outcome (Task 5):
    - `src/__tests__/agent-loops.test.ts` (new): 13 leaf tests across 4 suites:
      - `singleShotLoop` (direct, stub `LoopContext`): emits `turn_started`/`message_finished`/`turn_finished` in order and stops on zero calls; respects `maxToolRounds` (dispatches tool, continues, stops on 2nd zero-call turn).
      - `singleShotLoop` end-to-end via `RuntimeAgentSession`: default loop bit-for-bit (event sequence matches the legacy assertion); `RunOptions.loop` overrides `AgentConfig.loop`; `{ strategy: "single-shot" }` behaves as default.
      - `generateValidateReviseLoop` (direct): fails twice then passes (3 turns, 2 repair messages, 3 assistant drafts); ok-first (1 turn, 0 repairs); budget exhaustion (`maxRevisions: 1`, always-failing → 2 generates, 1 repair, no infinite loop); no-parser (text passed as value to validator); default repairer stringifies `errors[].message` (joined with `\n`); host-supplied repairer output appended and seeded as `nextInput` (verified via `assemble` capture); validation failure emits no `error` event.
      - `generateValidateReviseLoop` end-to-end via `RuntimeAgentSession`: 3 alternating provider drafts (`draft1`/`draft2`/`draftFINAL`), validator passes only on `draftFINAL`, asserts 3 provider turns, 3 `message_finished` events, `agent_finished` emitted, no `error`.
    - Imports `singleShotLoop`/`generateValidateReviseLoop` directly from `../agent-loops.js` and `LoopContext`/`ProviderTurnResult`/`Message`/`Usage` from `../index.js` (barrel export of these is Task 6; types are already re-exported from contracts).
    - Two real bugs found by tests and fixed in `src/agent-loops.ts`:
      1. **Budget exhaustion**: the loop was pushing a repair *before* checking the budget, so `maxRevisions: 1` produced 2 repairs. Fix: `if (turn > max) return usage;` placed *after* a failed validation and *before* pushing the repair. Now `maxRevisions=N` → exactly N repair messages and N+1 generates. Phase-28 `artifact_failed` hook marked at the exhaustion return.
      2. **`message_finished` parity**: `generateValidateReviseLoop` was pushing the assistant draft to the store but not emitting `message_finished` (single-shot does). Added the emit so both loops present the same observable assistant-message contract — required by the end-to-end test (3 `message_finished` events).
    - Verified: `npm run build:core` clean; full suite 494/494 (481 prior + 13 new).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: No — tests only; behavior covered by Task 5 docs.
    - Docs pages to create/edit:
      - `none`: no docs change for test code.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable.

- [x] Task 6 — Boundary tests: `src/` imports no `synapta*`; `Artifact*` contracts carry no workflow vocabulary; public barrel exports
  - Acceptance Criteria:
    - Functional: New `src/__tests__/phase27-boundaries.test.ts` mirrors `phase24-boundaries.test.ts`: asserts `src/**/*.ts` (excl. `__tests__`) imports no `synapta*` package and contains no `workflow`/`node`/`step` field names in the `Artifact*`/`AgentLoop*`/`LoopContext` contract blocks. Asserts `src/index.ts` exports `singleShotLoop`, `generateValidateReviseLoop`, and the `Artifact*`/loop contract types (`AgentLoopStrategy`, `AgentLoopOptions`, `LoopContext`, `ArtifactValidation`, `ArtifactContext`, `ArtifactParseResult`, `ArtifactParser`, `ArtifactValidator`, `ArtifactRepairer`).
    - Performance: Static-file scan; trivial.
    - Code Quality: Reuses the `phase24-boundaries.test.ts` scan helper. Boundary scope matches Phase 24's pattern so future phases extend the same guard.
    - Security: Locks the Synapta-free boundary: no domain types or imports leak into `src/`.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/phase24-boundaries.test.ts`: the scan + assertion pattern to mirror.
      - `src/contracts.ts` `Artifact*`/loop contract blocks (Tasks 2–4): the text scanned for vocabulary.
      - `src/index.ts`: the public barrel to assert exports from.
    - Options Considered:
      - New `phase27-boundaries.test.ts` mirroring Phase 24: consistent with the established per-phase boundary guard convention. Chosen.
      - Extend `public-contracts.test.ts`: mixes boundary sweep with contract-shape tests; rejected (separation of concerns).
    - Chosen Approach:
      - New boundary test module. Scan `src/` (excl. `__tests__`) for `synapta` imports/mentions and scan the contract block for `workflow`/`node`/`step`. Assert barrel exports.
    - API Notes and Examples:
      ```ts
      // src/__tests__/phase27-boundaries.test.ts (sketch)
      describe("phase 27 loop strategy boundaries", () => {
        it("phase27_source_imports_no_synapta_and_no_workflow_vocabulary", () => { /* scan src/ */ });
        it("phase27_artifact_contracts_carry_no_workflow_vocabulary", () => { /* scan contracts.ts Artifact* block */ });
        it("phase27_public_barrel_exports_loop_and_artifact_contracts", () => { /* read src/index.ts */ });
      });
      ```
    - Files to Create/Edit:
      - `src/__tests__/phase27-boundaries.test.ts` (new): the three cases above.
      - `src/index.ts`: re-export `singleShotLoop`, `generateValidateReviseLoop`, and the loop/`Artifact*` types.
    - References:
      - `src/__tests__/phase24-boundaries.test.ts`, `src/contracts.ts`, `src/index.ts`, `src/agent-loops.ts`.
  - Outcome (Task 6):
    - `src/index.ts`: added `export { generateValidateReviseLoop, isAgentLoopOptions, resolveLoop, singleShotLoop } from "./agent-loops.js"`. `Artifact*`/loop contract types (`ArtifactValidation`, `ArtifactContext`, `ArtifactParseResult`, `ArtifactParser`, `ArtifactValidator`, `ArtifactRepairer`, `AgentLoopStrategy`, `AgentLoopOptions`, `LoopContext`, `ProviderTurnResult`) are exported via the existing `export type * from "./contracts.js"`.
    - `src/__tests__/phase27-boundaries.test.ts` (new): mirrors `phase24-boundaries.test.ts` — (1) `phase27_source_imports_no_synapta_packages` scans `src/**/*.ts` (excl. `__tests__`) for `synapta` import/mention; (2) `phase27_loop_and_artifact_contracts_have_no_domain_vocabulary` slices the loop contract block (from the `ponytail:` marker to end of file) and asserts none of `workflow`/`node`/`step` (case-insensitive word-boundary) appear; (3) `phase27_public_barrel_exports_loops_and_artifact_contracts` asserts `src/index.ts` exports the four loop functions/objects, has `export type *`, and `contracts.ts` declares each named type.
    - Verified: `npm run build:core` clean; full suite 497/497 (494 prior + 3 boundary tests).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes — barrel exports are part of the public surface (asserted here, documented in Task 7).
    - Docs pages to create/edit:
      - `docs/public-contracts.md`: list the new exports (Task 7).
    - `docs/index.md` update: covered by Task 7's `agent-loops.md` entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7 — Docs: new `/docs/agent-loops.md` page, `docs/index.md` entry, `docs/agent-session-runtime.md` cross-reference, `docs/public-contracts.md` exports
  - Acceptance Criteria:
    - Functional: New `docs/agent-loops.md` follows the `prism-wiki.md` API page structure — What it does, When to use it, Inputs/request, Outputs/response/events, Request/response example, Implementation example (`SingleShotLoop` default + `GenerateValidateReviseLoop` with a Synapta-style schema mapped to `ArtifactValidation`), Extension and configuration notes, Security and performance notes, Related APIs. `docs/index.md` gains an entry under "Agent/session runtime" linking `agent-loops.md`. `docs/agent-session-runtime.md` cross-references the loop seam. `docs/public-contracts.md` lists the new exports. `src/__tests__/docs.test.ts` extended to assert `agent-loops.md` exists, has the required headings, and is linked from the index.
    - Performance: N/A (docs).
    - Code Quality: Example compiles against the public API; Synapta-style example imports no Synapta type (uses `ArtifactValidator<unknown>` with a host schema). Mirror existing docs example style.
    - Security: Docs state the loop has no path to credentials/provider/unredacted secrets; `ArtifactValidation.errors` may echo model text and is redacted through the active redactor (Phase 28 carries the events; Phase 27 notes the redaction path).
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md`: the page to cross-reference from.
      - `docs/public-contracts.md`: the export inventory page.
      - `.agents/skills/create-plan/references/prism-wiki.md`: API page structure for the new page.
      - `docs/index.md`: navigation group layout ("Agent/session runtime").
    - Options Considered:
      - New `docs/agent-loops.md` page: warranted — a new strategy contract + `Artifact*` seam + two loop implementations are a distinct topic. Chosen.
      - Fold loop docs into `agent-session-runtime.md`: would overload that page; rejected.
    - Chosen Approach:
      - New page with full API structure. Synapta-style example shows a third-party schema validator mapped to `ArtifactValidator<unknown>` — proving no Synapta type is imported by the host's loop usage. Extend `docs.test.ts` to guard the new page, headings, and index link.
    - API Notes and Examples:
      ```ts
      // docs/agent-loops.md implementation example (Synapta-style, no Synapta import)
      import { createAgent, type ArtifactValidator } from "@arnilo/prism";
      const validator: ArtifactValidator<unknown> = (value, _ctx) =>
        typeof value === "string" && value.length > 0
          ? { ok: true }
          : { ok: false, errors: [{ message: "empty artifact" }] };
      await session.run(input, { loop: { strategy: "generate-validate-revise", validator, maxRevisions: 3 } });
      ```
    - Files to Create/Edit:
      - `docs/agent-loops.md` (new): full API page.
      - `docs/index.md`: add entry under "Agent/session runtime".
      - `docs/agent-session-runtime.md`: cross-reference the loop seam.
      - `docs/public-contracts.md`: list loop + `Artifact*` exports.
      - `src/__tests__/docs.test.ts`: assert `agent-loops.md` in `apiPages`, required headings present, index links it, and `docs.test.ts` `phase 2 and 3 docs reference existing root exports`-style entry for the new exports.
    - References:
      - `docs/agent-session-runtime.md`, `docs/public-contracts.md`, `docs/index.md`, `prism-wiki.md`, `src/index.ts`.
  - Outcome (Task 7):
    - `docs/agent-loops.md` (new): full API-page-structure doc — What it does (default `singleShotLoop` + `generateValidateReviseLoop`, runtime-owned primitives, opt-in), When to use it, Inputs/request (imports, `AgentConfig.loop`/`RunOptions.loop` selection, `AgentLoopOptions` discriminated union, host callback table, `LoopContext` field table), Outputs/response/events (`Usage` return, existing events, `message_finished` parity, Phase-28 `artifact_*` noop seams, validation failure not an `error`), Request/response example, Implementation example (JSON-doc parser/validator/repairer with host `T`; custom `AgentLoopStrategy` escape hatch), Extension and configuration notes (resolution precedence, `maxToolRounds`/`maxRevisions`, store ordering of revisions), Security and performance notes (no credential/provider/unredacted path, redaction of `errors.message`, bounded turns, Synapta-free boundary), Related APIs.
    - `docs/index.md`: added `[Agent loops](agent-loops.md)` entry under "Agent/session runtime".
    - `docs/agent-session-runtime.md`: added cross-reference paragraph after Related APIs noting `AgentConfig.loop`/`RunOptions.loop` and linking `agent-loops.md`.
    - `docs/public-contracts.md`: added `AgentLoopOptions`/`AgentLoopStrategy`/`Artifact*`/`ProviderTurnResult` to the import-list example; added a loop/artifact contract block to the request-shapes table (`RunOptions` updated, `AgentConfig.loop`/`RunOptions.loop`, `AgentLoopStrategy`, `LoopContext`, `ProviderTurnResult`, `ArtifactValidation`, `ArtifactContext`, `ArtifactParser<T>`/`ArtifactValidator<T>`/`ArtifactRepairer<T>`); added `[Agent loops]` to Related APIs.
    - `src/__tests__/docs.test.ts`: added `docs/agent-loops.md` to `apiPages` (so required-headings check runs) and a new `agent_loops_docs_cover_loop_strategies_and_artifact_contracts` guard asserting index link, runtime cross-ref, barrel exports (`singleShotLoop`/`generateValidateReviseLoop`/`resolveLoop`/`isAgentLoopOptions`), and the key contract names + phrases (`generate-validate-revise`, `maxRevisions`, "never instantiates") in `docs/agent-loops.md`.
    - Verified: `npm run build:core` clean; full suite 498/498 (497 prior + 1 docs guard).
  - Test Cases to Write:
    - `docs.test.ts` asserts `agent-loops.md` exists, has all required headings, is linked from `docs/index.md`, and documents `singleShotLoop`/`generateValidateReviseLoop`/`Artifact*` exports.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: Yes — new public page + exports.
    - Docs pages to create/edit:
      - `docs/agent-loops.md` (new), `docs/index.md`, `docs/agent-session-runtime.md`, `docs/public-contracts.md`.
    - `docs/index.md` update: yes — new "Agent/session runtime" entry for `agent-loops.md`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- `generateValidateReviseLoop` does not dispatch tools in revision turns. Roadmap scope is generate→validate→revise; tool coupling in artifact revisions is deferred with a `// ponytail:` comment. Hosts needing tools use `singleShotLoop` or a custom `AgentLoopStrategy`. Documented in `docs/agent-loops.md`.
- `artifact_*` events (Phase 28) are not emitted yet — Phase 27 leaves documented noop hook points in `generateValidateReviseLoop` (validation_started/finished, revision_started/finished, artifact_finished, artifact_failed). Phase 28 is a pure addition at those seams; no retyping needed (contracts already match Phase 28 field names).
- Validation failure is recoverable and emits no `error` event; only terminal budget exhaustion / real failures surface as errors. This matches the `tool_execution_blocked` convention; Phase 28's `artifact_failed` will cover budget exhaustion.
- `LoopContext` is built once per run as a single object literal of bound arrows referencing `this`. No `LoopHost` base class, no per-turn allocation beyond the loop's own locals. A class hierarchy was YAGNI.
- `LoopContext.assemble(nextInput, toolResults?)` takes an optional tool-result accumulator so `singleShotLoop` passes its loop-local array. This is a minor arity compromise (one optional param) to avoid a second `assembleWithTools` method; `generateValidateReviseLoop` omits it.
- `ProviderTurnResult` moved from a non-exported `agents.ts` interface to `contracts.ts`. The former local copy is removed; the imported contract type is the single source.
- The `ponytail:` comment in `contracts.ts` was reworded to "domain control-flow vocabulary" instead of the literal word `workflow` so the Phase 24 / Phase 27 boundary scanners (word-boundary scan of `contracts.ts`) do not false-positive on the comment.
- `docs/agent-loops.md` is a new page rather than a section in `agent-session-runtime.md` — a strategy contract + `Artifact*` seam + two loop implementations justify a dedicated page; `agent-session-runtime.md` cross-references it.
- Custom loops receive a `LoopContext` but not `inputMessages` semantics for generate-validate-revise (that field exists for single-shot's turn-1 history-push parity). Custom loops that need it can read `ctx.inputMessages`; documented in the `LoopContext` table.

## Further Actions
- **Low**: Phase 28 emits `artifact_*` events at the marked hook points in `generateValidateReviseLoop`. No retyping; `ArtifactValidation` field names already match Phase 28. Add `artifact_*` variants to `AgentEvent`, wire emits, extend the Phase-27 boundary test to cover the new event payloads.
- **Low**: If real demand appears for tools in revision turns, generalize `generateValidateReviseLoop` to interleave `dispatchToolCall` between generate and validate, or document a custom loop that composes single-shot tool rounds with validation. Defer until a host asks.
- **Low**: Consider a per-loop `describe`/metadata field on `AgentLoopStrategy` (beyond `name`) if observability/debugging needs loop-attributed events. YAGNI today; `name` is enough for `resolveLoop` error messages.
- **Low**: `maxToolRounds` is carried on `LoopContext` for `singleShotLoop`; if a future loop also needs `maxToolRounds`-style budgets it should add its own budget field to its options rather than reusing `LoopContext.maxToolRounds`. Keep `LoopContext` loop-agnostic.
- **Low**: `inputMessages` on `LoopContext` exists solely for single-shot's bit-for-bit turn-1 history push. If a future refactor makes that push unnecessary, drop `inputMessages` from `LoopContext`.
- **None**: No new dependencies, no new primitives (loops reuse `assembleProviderInput`/`generateWithRetry`/`dispatchToolCall`/`appendMessage`/`emit`), no new `AgentEvent` variants in Phase 27. Phase 27 closes the loop-strategy seam named in the roadmap by extracting the default and adding one alternative loop, both reusing existing runtime primitives.
