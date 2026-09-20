# Hook Lifecycle Completion (R1–R5)

Implements the hook-system proposal from the 2026-09-19 analysis: close the run-end/stop
control gap, make the declared lifecycle events real, add the pre-compaction seam, ship an
out-of-process hooks adapter package, and unify hook documentation. Everything lands with
the 0.10.0 cut. This plan owns the 0.10.0 bump, compat baseline, and publish (Tasks 8–10,
moved from plan 105 after scoped memory shipped).

Precondition: plan 105 Tasks 1–9 complete (`@arnilo/prism-memory/scoped` shipped). Plan 107
(removals) must complete before Tasks 8–10. Tasks 1–7 may run in parallel with 107.

## Objectives

- R1: Stop/run-end decision hooks — extensions and hosts can observe natural loop end and
  force bounded continuation with an injected reason/steer (the Reflexion / Claude Code
  Stop-hook primitive).
- R2: Make lifecycle events real — one public helper bridges AgentEvents to the extension
  bus, and `session_start` / `session_shutdown` middleware hooks get actual call sites
  (today they are declared names with zero runtime emitters).
- R3: Pre-compaction hook — a `compaction_request` middleware seam runs before the
  compaction strategy so hooks can rewrite the message set the strategy sees.
- R4: `@arnilo/prism-hooks` opt-in package — a Claude/Codex-compatible `hooks.json`
  adapter (matchers, command and MCP-tool handlers, timeouts, byte caps, hash-pinned
  trust, async delivery) compiled onto the primitives above. Core stays in-process.
- R5: `docs/hooks.md` — one page mapping every Claude Code / Codex hook event to its
  Prism surface, plus the new stop-hook API.
- Cut and publish 0.10.0 (Tasks 8–10), covering plan 105 scoped memory, this plan's hooks,
  and plan 107 removals.

## Expected Outcome

- A host can: inject prompts/skills anywhere in a session (already possible — documented),
  run code at run end and force continuation (new), observe the run from inside an
  extension without host forwarding (new), rewrite compaction input (new), and consume a
  `hooks.json` file with zero Prism-specific schema (new package).
- Deliberate non-goals (documented, not silently missing): no `PermissionRequest` hook
  (permission stays host policy — a hook that can *allow* is a privilege-escalation
  vector), no `provider_response` middleware (subscribers already observe streams), no
  subprocess sandboxing in core (trust lives in the R4 adapter).
- All hook changes additive except `MiddlewareHookName` gaining two names and `stopReason`
  gaining one value. Removals are plan 107. Cut-time baseline regen is Task 9.
- All packages at 0.10.0; `release:gate` green; CHANGELOG and published artifacts verified.

## Tasks

- [ ] Task 1: Primitive review — map R1–R4 needs onto shipped seams before writing code
  - Acceptance Criteria:
    - Functional: An inventory table (proposed capability → existing seam → new code required) is recorded in this task's completion notes. Confirms or corrects: stop hooks cannot be built on `TurnPolicyOptions.stop` (it is consulted *before* each provider request, cannot re-enter the loop after natural end, and is a single host callback — not multi-party composition); pre-compaction belongs in middleware (transform semantics) rather than a new `InstructionTiming` (injectors run per provider-turn assembly, compaction workers assemble their own input — wrong seam); out-of-process hooks need a new package because core deliberately ships none of spawn/trust/JSON-decision parsing.
    - Performance: No new runtime dependency packages in `@arnilo/prism`; R4 package has only `@arnilo/prism` as required peer.
    - Code Quality: The review names the exact seam for each R-item: R1 = session run wrapper around `loop.run` (custom loops inherit it for free), R2 = `src/extensions.ts` helper + session run/close, R3 = compaction site before strategy dispatch, R4 = extension composition only.
    - Security: Review confirms stop-hook continuation enters through the steer path (input guardrails re-check steered messages) and that injected context blocks stay byte-bounded by existing injector/guardrail limits.
  - Approach:
    - Documentation Reviewed:
      - `docs/middleware-hooks.md` (hook inventory, error policies, `next()` discipline)
      - `docs/instruction-injection.md` (`InstructionTiming`, predicates, byte caps)
      - `docs/guardrails.md` (stages, actions, steer re-checking)
      - `src/contracts-core/loop.ts` (`TurnPolicyOptions.stop`, `stopReason`), `src/contracts-core/run-limits.ts`, `src/agent-loops.ts` (`singleShotLoop`), `src/agent-session/session.ts` (steer queue, `agent_finished`)
      - `docs/extensions.md` (`createExtensionKernel`, `activateKernel`, `api.use`, `api.emit`)
      - Claude Code hooks docs and Codex `hooks.json` docs (fetched 2026-09-19; matcher groups, exit codes, `additionalContext`, `stop_hook_active`, trust review)
    - Options Considered:
      - Stop logic inside `singleShotLoop` — rejected: custom loop strategies would each re-implement it; the session wrapper covers all strategies.
      - Emit lifecycle events from runtime for every declared name — rejected: duplicates the AgentEvent stream; `await`-all semantics would slow the loop.
      - Fold stop hooks into `TurnPolicyOptions.stop` — rejected (see Functional): different timing, different composition model.
    - Chosen Approach: Session-level run wrapper (R1) + bridge helper (R2) + middleware seam (R3) + adapter package (R4).
    - API Notes and Examples:
      ```ts
      // confirmed surface this task validates
      import { createExtensionKernel, activateKernel } from "@arnilo/prism";
      ```
    - Files to Create/Edit: none (review task; corrections land in Tasks 2–6).
    - References: plan 105 Task 1 (same primitive-review discipline); skill rule 6.
  - Test Cases to Write: none (review).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (review only).
    - Docs pages to create/edit: `none` with reason: review task; findings land in Tasks 2–6.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 2: R1 — stop hooks with bounded continuation
  - Acceptance Criteria:
    - Functional: `AgentConfig.stopHooks` / `RunOptions.stopHooks` (run overlay merges, host may not widen limits) run in order at natural loop end before `agent_finished`. First `{ action: "continue", reason, steer? }` appends the reason (and optional steer message) through the steer path and re-enters the loop; `{ action: "stop" }` (or no hook continuing) ends the run normally. `ctx.stopHookActive` is true on every hook invocation after the first continuation within a run. Exceeding `limits.maxStopContinuations` (default 3 when any stop hook is configured) ends the run cleanly with `stopReason: "hook_limit"` and a resumable checkpoint, mirroring `turn_limit`. A throwing hook fails the run with `ERR_PRISM_STOP_HOOK` (consistent with `ERR_PRISM_TURN_POLICY` for a throwing `TurnPolicyOptions.stop`).
    - Performance: Hooks run serially, awaited, once per natural loop end; each continuation costs full provider turns (sized in docs — see Documentation assessment). Zero overhead when no stop hooks are configured (skip wrapper entirely).
    - Code Quality: Types live in `src/contracts-core/loop.ts` next to `TurnPolicyOptions`; runtime wiring in the session run wrapper around `loop.run` so every `AgentLoopStrategy` inherits it; `api.registerStopHook()` on `ExtensionApi` + `activateKernel` copies registered hooks into config with undo-tracked disposal like every other contribution.
    - Security: Continuation reason/steer enters through the steer queue — input guardrails apply and can reject (`steer_rejected`); context blocks honor existing injector byte caps; hooks see history read-only.
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session.ts` (steer queue, `DEFAULT_MAX_PENDING_STEERS`, mid-run steer drain, `steer_rejected`)
      - `src/contracts-core/loop.ts:34-46` (`TurnPolicyOptions`, `stopReason`, `LoopContext.stopReason` ceiling exits), `src/agent-loops.ts` (how strategies set `stopReason`)
      - `src/contracts-protocol.ts` (`agent_finished` payload, `stopReason` values, `TurnPolicyOptions` import at line 32)
      - `src/extensions.ts:277` (`activateKernel`), `docs/extensions.md` (registration pattern)
    - Options Considered:
      - New AgentEvent `stop_hook` on the protocol — deferred: `agent_finished.stopReason: "hook_limit"` plus a session event may suffice; decide during implementation and if added, update `src/contracts-protocol.ts`, its tests, and `docs/agent-events.md` in this task.
      - Unbounded continuation (Claude Code default) — rejected: loops are the top user complaint there; hard cap with clean exit + resumable checkpoint is the Prism-shaped answer.
    - Chosen Approach: Session run wrapper, steer-path continuation, hard cap, clean `hook_limit` stop.
    - API Notes and Examples:
      ```ts
      interface StopHookContext {
        readonly sessionId: string;
        readonly runId: string;
        readonly turn: number;
        readonly history: readonly Message[]; // read-only
        readonly metadata: Readonly<Record<string, unknown>>;
        readonly signal: AbortSignal;
        readonly stopHookActive: boolean;
      }
      type StopHookDecision =
        | { action: "stop" }
        | { action: "continue"; reason: string; steer?: string | Message; contextBlocks?: readonly ContextBlock[] };

      interface StopHook {
        readonly name: string;
        decide(ctx: StopHookContext): StopHookDecision | Promise<StopHookDecision>;
      }

      // AgentConfig / RunOptions
      readonly stopHooks?: readonly StopHook[];
      // RunLimits
      readonly maxStopContinuations?: number | null; // default 3 when stopHooks present

      // extension
      api.registerStopHook({ name: "debt-nag", decide: async (ctx) =>
        ctx.stopHookActive ? { action: "stop" } : { action: "continue", reason: "Address the deferred items before finishing." } });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/loop.ts`: `StopHook`, `StopHookContext`, `StopHookDecision` types; `stopReason: "hook_limit"` value.
      - `src/contracts-core/agent.ts`: `AgentConfig.stopHooks`, `RunOptions.stopHooks`.
      - `src/contracts-core/run-limits.ts`: `maxStopContinuations` (default 3, `null` = inherit), resolution and overlay narrowing rules.
      - `src/agent-session/session.ts`: run wrapper around `loop.run` (hook execution, steer append, continuation loop, cap → clean stop, `ERR_PRISM_STOP_HOOK`).
      - `src/extensions.ts`: `registerStopHook` on `ExtensionApi` + kernel registry + `activateKernel` wiring.
      - `src/contracts-protocol.ts`: `agent_finished` stopReason union extended (and optional stop-hook event if chosen above).
      - `src/__tests__/` + `src/agent-session/__tests__/`: new tests (below).
    - References: Claude Code Stop hook + `stop_hook_active` (fetched 2026-09-19); Reflexion (arXiv:2303.11366) end-of-episode reflection; `docs/guardrails.md` steer re-checking.
  - Test Cases to Write:
    - `stop-hook continues run once then stops`: continue → steer appended, loop re-entered, `stopHookActive` true on second invocation, run finishes normally.
    - `stop-hook cap ends run cleanly`: always-continue hook → `stopReason: "hook_limit"`, resumable checkpoint, no error.
    - `steered continuation obeys input guardrails`: guardrail rejects the hook's steer → `steer_rejected`, continuation still allowed or stopped per decision contract (assert chosen contract).
    - `throwing stop hook fails run with ERR_PRISM_STOP_HOOK`.
    - `no stop hooks → zero overhead`: wrapper skipped; run behavior byte-identical to before.
    - `run overlay may only narrow maxStopContinuations` (widening throws, mirroring `maxTurns`).
    - `extension-registered stop hook disposed with kernel` (undo rule).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new `AgentConfig`/`RunOptions` field, `RunLimits` knob, `stopReason` value, `ExtensionApi` method.
    - Docs pages to create/edit:
      - `docs/hooks.md`: create in this task as a stub (What/When/Inputs/Outputs/Examples per API-page structure) covering stop hooks; Task 6 expands it to the full mapping page.
      - `docs/middleware-hooks.md`: cross-link only.
      - `docs/extensions.md`: `api.registerStopHook` section with example.
      - `docs/agent-limits.md` (or wherever `RunLimits` is documented — confirm page in Task 1): `maxStopContinuations` row. Per skill rule, the owning docs page states the sizing trade-off in one line: each continuation costs full provider turns until natural stop recurs; default 3; `0` disables continuation while keeping observation.
    - `docs/index.md` update: yes — add `docs/hooks.md` entry under the agent/session runtime group (one sentence, current contract, no version narrative).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 3: R2 — bridge AgentEvents to the extension bus; wire `session_start` / `session_shutdown`
  - Acceptance Criteria:
    - Functional: New public `forwardAgentEvents(subscription, events, options?)` helper maps the AgentEvent stream onto extension-bus lifecycle payloads: `agent_started` → `before_agent_start`, `turn_started`/`turn_finished` → `turn`, `tool_started`/`tool_finished` → `tool_call`/`tool_result` (notification payloads only — no transformation), and returns an unsubscribe. `session_start` middleware runs once per session (first run start) and `session_shutdown` once on `close()`, idempotently; both honor middleware error policy. Bridge errors never fail the run (helper catches, surfaces via its own error callback / `middleware onError`).
    - Performance: Bridge is opt-in host wiring, not runtime default — zero cost when unused. `session_start`/`session_shutdown` add one middleware dispatch per session lifecycle, not per turn.
    - Code Quality: Helper lives in `src/extensions.ts` next to `activateKernel`; mapping table is a plain record; no runtime emission paths added for the remaining declared event names.
    - Security: Bridge carries payloads read-only; extension bus handlers run under the kernel's existing trust model.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts-core/extensions.ts:41` (`ExtensionLifecycleEventName` — currently never emitted by the runtime), `src/extensions.ts` (bus, `emit`, undo)
      - `docs/agent-events.md` (event stream, subscriber semantics), `src/agent-session/session.ts` (`close()`, first-run path)
      - `docs/middleware-hooks.md` (`session_start` / `session_shutdown` documented names with no call sites — the dead-API bug this task fixes)
    - Options Considered:
      - Runtime emits every lifecycle name natively — rejected: duplicates AgentEvents, `await`-all would sit on the hot loop, and hosts already own a subscription.
      - Delete the two session middleware names instead of wiring them — rejected: session-open/close is exactly where hosts want a hook, and the middleware registry is the natural seam.
    - Chosen Approach: Host-invoked bridge helper + two wired session middleware dispatches.
    - API Notes and Examples:
      ```ts
      import { forwardAgentEvents } from "@arnilo/prism";
      const stop = forwardAgentEvents(session.subscribe(), kernel.events, {
        onError: (e) => log.warn("hook bridge", e),
      });
      // later: stop()
      ```
    - Files to Create/Edit:
      - `src/extensions.ts`: `forwardAgentEvents` + mapping table.
      - `src/agent-session/session.ts`: `session_start` dispatch on first run, `session_shutdown` dispatch in `close()` (idempotent).
      - `src/contracts.ts` re-export if that is where public helpers surface (confirm in Task 1).
    - References: LangChain middleware hooks run inside the graph (composition analogy); OpenCode plugin `event.*` subscriptions.
  - Test Cases to Write:
    - `bridge maps agent/turn/tool events to bus payloads in order`.
    - `bridge handler throw → onError called, run unaffected`.
    - `session_start runs once per session even across multiple runs`; `session_shutdown once on close(), close() twice → still once`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public helper; two middleware hooks become live.
    - Docs pages to create/edit:
      - `docs/middleware-hooks.md`: mark `session_start`/`session_shutdown` as emitted (remove the "no call site" caveat if documented), add wiring snippet.
      - `docs/extensions.md`: `forwardAgentEvents` section + example.
      - `docs/hooks.md`: lifecycle table rows (Task 6 owns the table; this task adds the SessionStart/SessionEnd rows).
    - `docs/index.md` update: no (no new page from this task; `docs/hooks.md` entry added by Task 2).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 4: R3 — `compaction_request` middleware (pre-compaction seam)
  - Acceptance Criteria:
    - Functional: New middleware hook `compaction_request` runs before the compaction strategy receives its input. Payload `{ messages, trigger, reason? }`; handlers may return a rewritten message set (same transform discipline as `context`); the strategy sees the rewritten set; the post-strategy `compaction` middleware is unchanged. Hook runs only when compaction triggers — never on ordinary turns.
    - Performance: One dispatch per compaction event; skipped entirely when no handlers registered (registry already skips empty chains).
    - Code Quality: Registered in `MiddlewareHookName`; follows the existing payload/`next` shape; no changes to compaction strategy contracts.
    - Security: Rewritten message sets are re-validated by the strategy's own input expectations; the seam cannot bypass compaction (returning an empty set is a strategy-level error, not a skip).
  - Approach:
    - Documentation Reviewed:
      - `src/agent-session/session.ts` compaction site (~line 669, post-strategy `compaction` middleware), `src/middleware.ts` (hook name union)
      - `docs/compaction-observational-memory.md`, `docs/compaction-llm.md` (strategy input assembly)
      - Claude Code `PreCompact` / Codex `PreCompact` events (fetched 2026-09-19)
    - Options Considered:
      - New `InstructionTiming: "before_compaction"` — rejected (Task 1 confirms): injectors run in provider-turn assembly; compaction workers build their own prompts — wrong seam, would fork injector semantics.
      - Guardrail-style decision (block compaction) — rejected: blocking compaction is a limits concern (`RunLimits` already governs when compaction may trigger); the gap is input rewriting.
    - Chosen Approach: Middleware transform seam, symmetric with the existing post-compaction hook.
    - API Notes and Examples:
      ```ts
      api.use("compaction_request", async (req, next) => {
        const messages = pinCriticalFacts(req.messages);
        return next({ ...req, messages });
      });
      ```
    - Files to Create/Edit:
      - `src/middleware.ts`: add `compaction_request` to `MiddlewareHookName` + payload type.
      - `src/agent-session/session.ts`: dispatch before strategy input handoff.
      - tests under `src/agent-session/__tests__/`.
    - References: `docs/middleware-hooks.md` hook table; LangChain `wrap_model_call` analogy (input rewrite before the model).
  - Test Cases to Write:
    - `rewritten messages reach strategy`; `no handlers → identical strategy input`; `hook throw → middleware error policy (event/throw) honored, compaction proceeds or fails per policy`; `not dispatched on ordinary turns`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new middleware hook name.
    - Docs pages to create/edit:
      - `docs/middleware-hooks.md`: `compaction_request` row + example.
      - `docs/compaction-observational-memory.md` / `docs/compaction-llm.md`: one cross-link line each (pre-strategy seam now exists).
      - `docs/hooks.md`: PreCompact row (Task 6 table).
    - `docs/index.md` update: no (existing pages).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 5: R4 — `@arnilo/prism-hooks` out-of-process adapter package
  - Acceptance Criteria:
    - Functional: New opt-in workspace package `packages/hooks` (`@arnilo/prism-hooks`) exports `parseHooksConfig(text|object)` and `createHooksExtension(config, options)` → Prism `Extension` compiled entirely onto public seams: `UserPromptSubmit`/`SessionStart` `additionalContext` → instruction injector with once-per-event pending queue; `UserPromptSubmit` block → input guardrail; `PreToolUse` `updatedInput` → `tool_call` middleware, deny → `tool_input` guardrail; `PostToolUse` → `tool_result` middleware; `Stop` continue → stop hooks (Task 2); `PostToolUse` deny → `tool_output` guardrail. Supported handler types: `command` (spawn, JSON payload on stdin, decision on stdout, Claude/Codex exit-code semantics: 0 = pass non-JSON stdout → additionalContext, 2 = block stderr-fed, 64 = non-blocking stderr note) and `mcp_tool` (invoke a host-provided MCP client). Matchers are regex with group capture into `$1…`; per-handler `timeoutMs` (default 10_000, kill on expiry = allow-with-warning for pre-events, drop for additive events); `additionalContextLimit` byte cap with spill-to-temp-file path substitution when exceeded; `async: true` handlers run detached and their output is delivered at the next safe point (turn boundary).
    - Performance: Serial awaited handlers on the event path (industry semantics); async handlers never block the loop; package adds nothing to core bundle size.
    - Code Quality: No Prism-internal imports — only `@arnilo/prism` public exports (peer). Schema validated with typed errors (`ERR_PRISM_HOOKS_CONFIG`); unknown events rejected loudly, not silently ignored.
    - Security: Trust model: handlers execute only when their `command` string hashes (SHA-256, host-configurable algorithm) match an allowlist supplied by the host in `options.trusted` (`"all"` escape hatch logged loudly); unmatched → skipped with a warning event. No shell interpolation — spawn with args array. Temp-file spill path is the only filesystem write, under `os.tmpdir()`.
  - Approach:
    - Documentation Reviewed:
      - Claude Code hooks reference + Codex hooks docs (fetched 2026-09-19): matcher syntax, exit-code contract, `additionalContext` limits + disk spill, timeout defaults, async delivery, hash trust review.
      - Gemini CLI `hooks.json` (`pre/post_tool_execution`, command/HTTP) — HTTP handler type deferred (Options).
      - `docs/extensions.md`, `docs/middleware-hooks.md`, `docs/instruction-injection.md`, `docs/guardrails.md` (the seams this compiles onto), Task 2 stop-hook API.
      - `scripts/package-truth.mjs` → `scripts/package-truth.json` (manifest counts must be regenerated).
    - Options Considered:
      - HTTP handler type now — deferred: command + MCP cover the cases in the analysis; add when a host asks.
      - Wiring `hooks.json` auto-load into the `prism` CLI — deferred to a follow-up: the package is host composable (`createHooksExtension`), and CLI config loading is a host policy decision; note in docs.
    - Chosen Approach: Adapter package compiling declarative hooks onto in-process seams; trust/timeout/caps live only here.
    - API Notes and Examples:
      ```json
      // hooks.json — Claude/Codex-compatible subset
      {
        "PreToolUse": [{
          "matcher": "Bash|Write",
          "hooks": [{ "type": "command", "command": "node audit-tool.js", "timeoutMs": 5000 }]
        }],
        "Stop": [{
          "hooks": [{ "type": "command", "command": "node debt-nag.js" }]
        }]
      }
      ```
      ```ts
      import { parseHooksConfig, createHooksExtension } from "@arnilo/prism-hooks";
      const ext = createHooksExtension(parseHooksConfig(await readFile("hooks.json", "utf8")), {
        trusted: { "node audit-tool.js": "sha256-…" },
      });
      await kernel.load([ext]);
      ```
    - Files to Create/Edit:
      - `packages/hooks/package.json`, `tsconfig.json`, `src/index.ts` (public surface), `src/schema.ts` (parse/validate), `src/matchers.ts`, `src/handlers/command.ts`, `src/handlers/mcp.ts`, `src/compile.ts` (event → seam mapping), `src/async-queue.ts`, `src/__tests__/` (unit + spawn fixtures using `node -e`).
      - `examples/hooks-json.ts`: end-to-end host example (fake audit command via fixture script).
      - `scripts/package-truth.json`: regenerate (`node scripts/package-truth.mjs`).
      - `docs/release-and-install.md`: manifest table row + count sentence update.
      - Root workspace config if packages are enumerated anywhere beyond globbing (verify in Task 1).
    - References: Codex trust review (hash-pinned handlers); Claude Code `additionalContext` disk spill; Task 2 stop hooks.
  - Test Cases to Write:
    - `parse: valid config, unknown event → ERR_PRISM_HOOKS_CONFIG, matcher regex groups`.
    - `command handler: stdin payload shape, exit 0 stdout → context injection, exit 2 → block, exit 64 → warning, timeout kill → policy`.
    - `PreToolUse updatedInput maps to tool_call middleware rewrite; deny maps to tool_input guardrail block`.
    - `Stop continue maps to stop hook continuation (bound by maxStopContinuations)`.
    - `additionalContextLimit truncation + spill file path substitution`.
    - `async handler output delivered at next turn boundary, never blocks the event path`.
    - `trust: hash mismatch → skipped + warning event; "all" escape hatch logs`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new package, new public exports, new package-count surface.
    - Docs pages to create/edit:
      - `docs/hooks.md`: full section for `hooks.json` support matrix, schema, trust, timeouts (Task 6 owns final page polish).
      - `docs/release-and-install.md`: package table/count updates (generated from package-truth).
      - `docs/peer-dependencies.md`: `@arnilo/prism` required peer row.
      - `examples/README.md`: hooks-json example row.
    - `docs/index.md` update: yes — version/manifest table row for `@arnilo/prism-hooks` + `docs/hooks.md` entry (if not already added by Task 2 — keep one entry).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 6: R5 — `docs/hooks.md` unified hook map
  - Acceptance Criteria:
    - Functional: `docs/hooks.md` documents, per the API-page structure: the Prism hook model (middleware = transform seams, guardrails = decisions, injectors = prompt/context injection, stop hooks = run-end control, extension bus = observation); a mapping table from every Claude Code / Codex event (SessionStart/End, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Stop, PreCompact/PostCompact, SubagentStart/Stop) to its Prism surface or its documented non-goal with rationale; and the R4 `hooks.json` adapter. Migration guidance for hosts coming from Claude Code/Codex configs.
    - Performance: n/a.
    - Code Quality: Current-contract style only — no version narrative, no plan numbers (plan 068 rule).
    - Security: Non-goals section states the permission-hook refusal rationale (privilege escalation vector) and the in-process trust boundary.
  - Approach:
    - Documentation Reviewed: analysis tables from 2026-09-19 (session records); `docs/index.md` group headings; Tasks 2–5 outputs.
    - Options Considered: split into per-package pages — rejected: one map is the deliverable; splitting recreates the fragmentation R5 exists to fix.
    - Chosen Approach: Single page, per API-page structure, cross-linked from middleware/injection/guardrail/extensions pages.
    - API Notes and Examples:
      ```md
      | Claude Code / Codex event | Prism surface |
      |---|---|
      | PreToolUse (updatedInput) | `tool_call` middleware |
      | PreToolUse (deny)         | `tool_input` guardrail |
      | Stop (continue)           | `stopHooks` (see below) |
      | PermissionRequest         | not a hook — host permission policy (rationale) |
      ```
    - Files to Create/Edit:
      - `docs/hooks.md`: finalize (Task 2 created the stub).
      - `docs/index.md`: navigation entry under agent/session runtime (one sentence).
      - `docs/middleware-hooks.md`, `docs/instruction-injection.md`, `docs/guardrails.md`, `docs/extensions.md`: one cross-link line each.
    - References: `docs/index.md` structure; prism-wiki.md API-page template.
  - Test Cases to Write: `src/__tests__/docs.test.ts`: hooks.md listed in docs coverage; every docs page linked from index resolvable (existing harness).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (documentation task over Tasks 2–5 APIs).
    - Docs pages to create/edit: `docs/hooks.md` (owning page), cross-links above.
    - `docs/index.md` update: yes (single entry, kept current-contract).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 7: 0.10.0 coordination (hooks changelog; precedes this plan's cut)
  - Acceptance Criteria:
    - Functional: `CHANGELOG.md` gains the 0.10.0 entries for stop hooks, lifecycle bridge, pre-compaction seam, `@arnilo/prism-hooks`, and `docs/hooks.md`. Full workspace `npm test` green. No publish in this task — Tasks 8–10 cut.
    - Performance: no runtime changes beyond Tasks 2–5.
    - Code Quality: no stray TODOs; docs tests green.
    - Security: n/a.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md` workflow section.
    - Options Considered: leave the cut on plan 105 — rejected: scoped memory shipped; this plan is the remaining 0.10.0 owner.
    - Chosen Approach: hooks changelog here; bump/gate/publish in Tasks 8–10.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: `CHANGELOG.md`.
    - References: skill rules on baseline regeneration (removals: plan 107 Task 4; cut-time regen: Task 9).
  - Test Cases to Write: none (release plumbing).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (coordination).
    - Docs pages to create/edit: `CHANGELOG.md` only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 8: Release 0.10.0 — version bump + workspace-wide green
  - Acceptance Criteria:
    - Functional: All workspace packages bumped to 0.10.0 per release script conventions; typecheck, lint, and full test suite pass, including scoped suites (`packages/memory/src/scoped/**`), `examples/scoped-memory.ts`, and this plan's hook suites.
    - Performance: CI budget unchanged from 0.9.x.
    - Code Quality: No `skip`/`todo` flags introduced by the cut.
    - Security: `npm audit` clean or explained in release notes.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md`; plan 099 Task 1 pattern; plan 105 Tasks 1–9 completion notes.
    - Options Considered: n/a — standard release plumbing.
    - Chosen Approach: Script bump + full verification after Tasks 1–7 and plan 107.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs bump 0.10.0
      ```
    - Files to Create/Edit: package.json versions via script.
    - References: `docs/release-and-install.md`.
  - Test Cases to Write:
    - Existing suites (cut adds none beyond regression runs).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

- [ ] Task 9: Release 0.10.0 — compatibility baseline regeneration + gate
  - Acceptance Criteria:
    - Functional: `node scripts/release.mjs gate --update-baseline` regenerates `scripts/compat-baseline/` files; `release:gate` green; diff reviewed so **additions** are intentional: `@arnilo/prism-memory/scoped` (`createScopedMemoryPolicy`, read-policy scorer, lifecycle/health, facts/trust, mirror, eval runner) from plan 105, plus this plan's hook exports / `@arnilo/prism-hooks` if Task 5 shipped; **removals** are plan 107's (already regenerated there — absorb leftover drift in the task note). Unexpected signature breaks: none planned — list any that appear before regeneration (plans 083/084 lesson).
    - Performance: Gate runtime within existing budget.
    - Code Quality: Baseline diff committed atomically with the version bump.
    - Security: Baseline contains no secrets (script guarantee, spot-checked).
  - Approach:
    - Documentation Reviewed: plans 083/084 baseline incident notes; `scripts/compat-baseline/` current files; plan 099 Task 2 pattern; plan 107 Task 4.
    - Options Considered: Hand-edit baseline — forbidden; script-only regeneration.
    - Chosen Approach: Regenerate + human-reviewed diff covering 105 scoped + 106 hooks + 107 removals.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs gate --update-baseline && npm run release:gate
      ```
    - Files to Create/Edit: `scripts/compat-baseline/*` (script-written).
    - References: plans 083/084 baseline incident notes.
  - Test Cases to Write:
    - `release:gate` exit 0.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (gate mechanics).
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

- [ ] Task 10: Release 0.10.0 — CHANGELOG, publish, post-publish verification, plan/roadmap bookkeeping
  - Acceptance Criteria:
    - Functional: CHANGELOG 0.10.0 covers scoped memory (plan 105: subpath, opt-in/off, sizing line — one reviewer call per run; ledger I/O per recall) plus this plan's hooks/`@arnilo/prism-hooks` and plan 107 removals. All publishable manifests publish; post-publish verification (install-from-registry smoke) passes; `plans/README.md` rows for 105/106/107 marked complete; `roadmap.md` records 0.10.0 as current release with this plan as cut owner.
    - Performance: Publish pipeline unchanged.
    - Code Quality: Release notes list new subpaths, opt-in defaults, and docs pages.
    - Security: No secrets in artifacts; publish uses existing operator-authorized flow.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md`; plan 099 Task 3/4 pattern; `CHANGELOG.md` current 0.9.0 entry shape; plan 105 Task 9 docs page.
    - Options Considered: n/a — standard cut.
    - Chosen Approach: Follow the established release checklist.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs publish 0.10.0
      ```
    - Files to Create/Edit: `CHANGELOG.md`, `plans/README.md`, `roadmap.md`, `docs/history/` release record if the convention requires one for a minor cut.
    - References: `docs/release-and-install.md`; plan 099 Tasks 3–4; plan 105 Tasks 1–9.
  - Test Cases to Write:
    - Post-publish smoke: fresh install of `@arnilo/prism-memory@0.10.0` imports both `./fabric` and `./scoped`; `@arnilo/prism-hooks@0.10.0` imports if Task 5 shipped.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (release of scoped + hooks surfaces).
    - Docs pages to create/edit: `CHANGELOG.md` (release deltas, per plan 068 rule — not in API page bodies).
    - `docs/index.md` update: no (scoped page in plan 105 Task 9; hooks page in Task 6).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- To be filled after tasks are completed and tests pass.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
