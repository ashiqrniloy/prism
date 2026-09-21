# Hooks

## What it does

Hooks are the seams where host- or package-owned code reacts to a run. Prism splits them by what the
code is allowed to do, so a hook never gains authority it was not granted:

| Family | Seam | May decide | Owning page |
| --- | --- | --- | --- |
| Middleware hooks | Transform a payload at a named boundary: `session_start`, `session_shutdown`, `beforeProviderTurn`, `provider_request`, `input_assembly`, `prompt_build`, `context`, `tool_call`, `tool_result`, `retry`, `compaction_request`, `compaction` | Returns the payload; cannot end the run | [Middleware hooks](middleware-hooks.md) |
| Guardrails | `input`, `output`, `tool_input`, `tool_output` stages | `allow` / `block` / `tripwire` / `interrupt` — the only seams that can reject | [Guardrails](guardrails.md) |
| Instruction injectors | Prompt and context injection on the first turn, every turn, or on matching input | Returns `instructions` and `contextBlocks`; cannot mutate the provider request | [Instruction injection](instruction-injection.md) |
| Stop hooks | A natural loop end, after the model produced an answer | `continue` (bounded) or `stop` | This page |
| Extension bus | Every emitted `AgentEvent`, optionally bridged read-only | Observes only | [Extensions](extensions.md), [Agent events](agent-events.md) |

This page owns stop hooks and the map from Claude Code / Codex hook events onto Prism seams.

APIs:

- `AgentConfig.stopHooks` / `RunOptions.stopHooks`
- `StopHook`, `StopHookContext`, `StopHookDecision`
- `RunLimits.maxStopContinuations`
- `ExtensionAPI.registerStopHook()` and `activateKernel().stopHooks`
- `session_start` / `session_shutdown` middleware and `session.close()`
- `compaction_request` / `compaction` middleware
- `forwardAgentEvents()` for hosts that already listen on the extension bus
- `@arnilo/prism-hooks`: `parseHooksConfig()` / `createHooksExtension()` for a declarative `hooks.json`

## When to use it

Use stop hooks for end-of-run policy: nudge the model to address deferred items, verify a checklist
before finishing, or ask for a final answer shape. Stop hooks run *after* the loop finished naturally,
when the model produced its answer.

Do not use them as middleware (payload transformation), as guardrails (policy denials), or as turn
control. `RunOptions.turnPolicy.stop` and the loop ceilings end a run *before* the next provider
request — see [Agent loops](agent-loops.md).

## Inputs / request

```ts
interface StopHookContext {
  readonly sessionId: string;
  readonly runId: string;
  /** Provider turns assembled in this run (resumption continues the run's counter). */
  readonly turn: number;
  /** Read-only live transcript at loop end. */
  readonly history: readonly Message[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  /** True on every invocation after the first continuation in this run. */
  readonly stopHookActive: boolean;
}

type StopHookDecision =
  | { readonly action: "stop" }
  | { readonly action: "continue"; readonly reason: string; readonly steer?: string | Message };

interface StopHook {
  readonly name: string;
  decide(context: StopHookContext): StopHookDecision | Promise<StopHookDecision>;
}
```

Configuration: `AgentConfig.stopHooks` is the agent default; `RunOptions.stopHooks` appends to it for
one run (agent hooks first). Hooks run serially in order, the first `continue` wins, and every hook
is consulted before the run settles. `RunLimits.maxStopContinuations` caps continuations — default
3, `0` observes hooks but never continues, `null` disables the cap — and a run overlay may only
narrow the agent value (resolution takes the minimum across layers).

## Outputs / response / events

- `continue` queues `reason` (and `steer` after it) as steered input. The next turn sees them in
  history; input guardrails re-check them exactly like `session.steer()`, so a `block`/`tripwire`
  decision drops the message (emitting `steer_rejected`) while the continuation still runs, and an
  `interrupt` decision fails the run.
- The continuation turn is a normal provider turn: it charges `maxTurns`/token limits, emits
  `turn_started`/`turn_finished`, and its output joins the transcript.
- Exceeding the cap ends the run cleanly with `AgentRunResult.stopReason: "hook_limit"`, riding
  `agent_finished.finishReason` and the finish `RunRecord`; no `error` is set. With
  `runState: { checkpointPolicy: "every-turn" }` the checkpoint keeps its frontier and
  `resumeAgentRun(..., { decision: "continue" })` resumes it.
- A throwing or malformed hook fails the run closed with `ERR_PRISM_STOP_HOOK`. Hooks never run
  after a loop ceiling (`turn_limit`/`token_limit`/`refusal`), a `turnPolicy` stop (`host_policy`),
  or a `generate-validate-revise` artifact failure.

## Request/response example

```text
turn 1: provider answers "draft"
stop hook: { action: "continue", reason: "address the deferred items" }
turn 2: provider sees "address the deferred items" in history and answers again
stop hook: ctx.stopHookActive === true → { action: "stop" }
result: natural end (no stopReason)
```

## Implementation example

```ts
import { createAgent } from "@arnilo/prism";

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider,
  stopHooks: [
    {
      name: "checklist",
      decide: (ctx) =>
        ctx.stopHookActive
          ? { action: "stop" }
          : { action: "continue", reason: "Verify the checklist before finishing." },
    },
  ],
  limits: { maxStopContinuations: 3 },
});

const result = await agent.createSession().run("Write the report");
```

## Session lifecycle and boundary hooks

The session and compaction boundaries are middleware, dispatched once each by the agent/session
runtime (never per turn):

| Hook | Fires | Payload |
| --- | --- | --- |
| `session_start` | First run start of a session — after `agent_started`/`agent_resumed`, before the first provider turn. A session rebuilt from a durable checkpoint is a new runtime session, so it opens again. | `{ sessionId, runId }` |
| `session_shutdown` | `await session.close()`, before every subscriber is closed. Idempotent. | `{ sessionId }` |
| `compaction_request` | Before a compaction strategy runs — `session.compact()` and auto-compaction both route through it, ordinary turns do not. The payload is the strategy's input, and the return value is what it compacts. | `CompactionContext` (`sessionId`, `entries`, `keepRecentEntries`, `trigger`, `secrets`, `metadata`, `signal`) |
| `compaction` | After the strategy returns, with the final compacted result. | `{ context, result }` |

They are middleware, not stop hooks: they observe a boundary and must return the payload. A throw
follows the registry's `errorPolicy` — an `extension_error` event with the run continuing (default),
or a rejection from `run()`/`close()` with `errorPolicy: "throw"`. Hosts register them through
`api.use("session_start", ...)`, `api.use("session_shutdown", ...)`, `api.use("compaction_request", ...)`,
or `api.use("compaction", ...)` and pass the registry as `AgentConfig.middleware`; without it none of
them fire. `compaction_request` cannot skip compaction (an empty entry set is the strategy's own
error) and the post-strategy `compaction` hook still sees the result — see
[Middleware hooks](middleware-hooks.md). Use [Agent events](agent-events.md) or
`forwardAgentEvents(source, kernel.events)` for finer-grained per-turn observation — the bridge maps
`agent_started` → `before_agent_start`, `turn_started`/`turn_finished` → `turn`, and
`tool_execution_started`/`tool_execution_finished` → `tool_call`/`tool_result` as read-only
notifications.

## Claude Code and Codex event map

Every Claude Code / Codex hook event maps onto one of the seams above — or is a documented non-goal:

| Claude Code / Codex event | Prism surface | `hooks.json` adapter | Notes |
| --- | --- | --- | --- |
| `SessionStart` | `session_start` middleware (+ instruction-injector queue) | compiled | `additionalContext` lands in the next assembly. Claude/Codex `source` values `startup` and `resume` both select — the seam cannot tell a fresh session from a resumed one — while `clear` and `compact` do not: compaction never reopens the session here (use the `compaction_request`/`compaction` seams). |
| `SessionEnd` | `session_shutdown` middleware | not compiled | Teardown cannot inject context or block a run, so cleanup belongs in the middleware or `LoadedExtension.dispose()`. A `hooks.json` file that needs it uses `api.use("session_shutdown", ...)` alongside the adapter. |
| `UserPromptSubmit` | `input` guardrail (deny) + injector queue | compiled | Exit `2`, `decision: "block"`, or `continue: false` rejects the run with `GuardrailError`; `additionalContext` is injected. |
| `PreToolUse` | `tool_call` middleware (`updatedInput`, `additionalContext`) + `tool_input` guardrail (deny) | compiled | `permissionDecision: "deny"` and exit `2` return a blocked `ToolResult`; `updatedInput` rewrites the arguments before dispatch; `additionalContext` is queued for the next assembly and dropped when the call is denied. Approvals are host policy — see `PermissionRequest`. |
| `PermissionRequest` | non-goal — host permission policy | not compiled | A hook that can grant a permission is a privilege-escalation vector: config-authored or third-party code would gain approval authority over the host's tools. Prism keeps grants in host-owned policy — `ExecutionPolicy`, `requiresApproval`, `interruptBeforeTool` — and guardrail packs' [`ask` rules](guardrails.md#asking-for-approval-ask-rules), which suspend a durable run for an explicit host decision. Hook seams (and `@arnilo/prism-hooks`) only ever deny. |
| `PostToolUse` | `tool_result` middleware (`additionalContext`, rewrite) + `tool_output` guardrail (deny) | compiled | `decision: "block"` and exit `2` replace the result with a refusal-shaped `ToolResult`; `additionalContext` is queued for the next assembly. |
| `Stop` | stop hooks (`AgentConfig.stopHooks` / `RunOptions.stopHooks`) | compiled | Both harnesses continue with `decision: "block"` + `reason`, or with `additionalContext` (exit `2` also continues, using stderr as the reason): that becomes `{ action: "continue" }`, with the reason as the continuation prompt and `ctx.stopHookActive` true on re-entry. The common-field `continue: false` is the *stop* signal and wins over continuation decisions in the same event. `RunLimits.maxStopContinuations` (default 3) caps how often the loop re-enters before a clean `hook_limit` stop. |
| `PreCompact` | `compaction_request` middleware | not compiled | Claude/Codex `PreCompact` is decision-only (block the compaction, no replaceable input). Prism's seam adds input rewrite: the returned `CompactionContext` is exactly what the strategy compacts. |
| `PostCompact` | `compaction` middleware + `compaction_finished` event | not compiled | Observes or rewrites the compacted result after the strategy returned. |
| `Interrupt` (Codex) | non-goal — hooks run at boundaries | not compiled | Hooks run before and after a turn, not inside one, so they cannot interrupt an in-flight turn. Interruption is the host's abort path: the run's `AbortSignal`, `session.close()`, or a guardrail `interrupt` at the input stage of a durable run (which suspends for approval). |
| `SubagentStart` / `SubagentStop` | non-goal — no subagent primitive | not compiled | Prism has no implicit child-agent lifecycle: delegation is a host-authored tool or a separate agent/run, so the parent loop is unaffected. Observe child runs with `agent_started`/`agent_finished` and `forwardAgentEvents()`. |

Claude Code's remaining harness-specific events (`Setup`, `Notification`, `StopFailure`,
`PostToolUseFailure`, `PostToolBatch`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`,
`Elicitation`, `ElicitationResult`, `PreToolBatch`) have no Prism surface: they belong to a
terminal/CI harness (init, notifications, multi-teammate gating, MCP elicitation) rather than to the
agent loop. `StopFailure` and `PostToolUseFailure` are covered as outcomes — `agent_finished.error`
and a failed `ToolResult` — and the rest are observed through `AgentEvent`s.

## `hooks.json` adapter (`@arnilo/prism-hooks`)

Hosts that already keep a Claude Code or Codex hooks file do not have to rewrite it as SDK
callbacks. The opt-in capability package `@arnilo/prism-hooks` parses the file and compiles each
event onto the seams above — no Prism internals, `@arnilo/prism` as its only peer, and no new
runtime dependency. It compiles the five events marked *compiled* in the map.

```bash
npm install @arnilo/prism @arnilo/prism-hooks
```

```ts
import { activateKernel, createAgent, createExtensionKernel } from "@arnilo/prism";
import { createHooksExtension, hookCommandHash, parseHooksConfig } from "@arnilo/prism-hooks";

const config = parseHooksConfig(await readFile("hooks.json", "utf8"));
const audit = { type: "command", command: "node audit-tool.js" } as const;
const hooks = createHooksExtension(config, { trusted: { [audit.command]: hookCommandHash(audit) } });

const kernel = createExtensionKernel();
await kernel.load([hooks]);
const activated = activateKernel(kernel);
const agent = createAgent({
  model,
  provider,
  guardrails: hooks.guardrails, // required for UserPromptSubmit / PreToolUse / PostToolUse
  instructionInjectors: activated.instructionInjectors,
  stopHooks: activated.stopHooks,
  middleware: activated.middleware,
});
```

Schema and semantics:

- Both authoring shapes parse: the flat Claude map (`{ "PreToolUse": [{ "matcher": "Bash", "hooks": [...] }] }`) and Codex's nested `{ "hooks": { "PreToolUse": [...] } }` with bare handler objects. An unknown event name, unknown handler `type`, empty command, non-positive `timeout`, or `"shell": true` throws `ERR_PRISM_HOOKS_CONFIG` — never a silent no-op.
- Handlers are `{ type: "command", command, args?, timeout?, async?, asyncRewake?, statusMessage? }` or `{ type: "mcp_tool", server, tool, input? }`. HTTP hooks are not implemented.
- Matchers follow Claude's hybrid rule: letters/digits/`_`/`-`/space/`,`/`|` select literally (with `|`/`,` alternatives), anything else is an unanchored regex, and no `$1` capture substitution exists. `UserPromptSubmit` and `Stop` have no matcher subject, so a matcher there warns and is ignored; `SessionStart` cannot distinguish a fresh session from a checkpoint resume at that seam, so `startup` and `resume` both select.
- Exit codes are Claude/Codex's: `0` success (JSON stdout parsed), `2` block with stderr as the reason, any other code a non-blocking error reported as a `hooks:warning` extension event. There is no exit code `64`.
- The common-field `continue: false` is read as the stop signal: on `Stop` it returns `{ action: "stop" }` and wins over continuation decisions from the same event (Codex precedence); on a tool or prompt event it reads as a refusal, the conservative reading, since Claude halts processing there and Codex marks the field unsupported.
- `timeout` is in **seconds** (default 600). Expiry warns and never blocks: pre-events allow with a warning, additive events simply drop their context.
- `additionalContextLimit` is a token threshold measured at ~4 code units per token — Codex's unit (default 2500, `0` = unlimited). It is read per handler, and a handler without the field falls back to the config-level value beside `hooks`. Claude's fixed 10,000-character `persistHookOutput` is the same spill behavior at a different unit. Over the limit that handler's text is written to `<temp_dir>/hook_outputs/` and a pointer line is injected instead — the only filesystem write this package performs.
- `async: true` handlers run detached (`asyncRewake` is accepted for config parity). Their context lands at the next assembly, never on the event path.
- Trust is a hash allowlist: `options.trusted` maps a command string to a digest from `hookCommandHash()` (default SHA-256 over the tokenized argv, so appending an argument invalidates the entry). A missing or mismatched entry skips the handler with a `hooks:warning`. `trusted: "all"` is the documented escape hatch and logs loudly. `mcp_tool` handlers use the host-supplied client and are trusted by construction.
- Commands are tokenized locally (quotes and escapes only — no expansion, pipes, or substitutions) and spawned with an argv array; there is no shell. Guardrails and stop hooks stay inert until the host activates them, like every other kernel contribution.

## Migrating from Claude Code or Codex configs

1. Keep the file where it is and parse it: `parseHooksConfig(text)` accepts both the flat
   `.claude/settings.json` map and Codex's `{ "hooks": { ... } }` shape, including Claude's extra
   settings keys next to `hooks`.
2. Drop the events the adapter does not compile — an unknown event name is a loud error, not a
   silent skip, so filter them explicitly instead of stripping the file by hand:

   ```ts
   // SessionEnd, PermissionRequest, Interrupt, PreCompact/PostCompact, SubagentStart/Stop are not compiled.
   const { SessionEnd, PermissionRequest, Interrupt, PreCompact, PostCompact, SubagentStart, SubagentStop, ...compiled } = raw;
   const config = parseHooksConfig(compiled);
   ```

   For the non-goals, use the Prism surface named in the map (host permission policy, the
   `session_shutdown` / `compaction_request` / `compaction` middleware) rather than a handler file.
3. Decide trust before the first run: `trusted: { [command]: hookCommandHash(handler) }` for each
   command you have reviewed, or `"all"` only for a config you own end to end. Handlers run
   out-of-process but with your privileges, so the allowlist is the boundary.
4. Activate the two halves together: `guardrails: hooks.guardrails` on the agent, plus
   `middleware` / `instructionInjectors` / `stopHooks` from `activateKernel()` — activating one
   without the other logs a `hooks:warning` and the blocking decisions do not apply.
5. Re-check the differences: `timeout` is seconds (default 600), only exit code `2` blocks,
   `decision: "block"` is what continues a `Stop` (never `continue: false`, which stops), no `$1`
   capture substitution in matchers, `additionalContext` over `additionalContextLimit` spills to a
   file pointer, and matchers on `UserPromptSubmit`/`Stop` are ignored with a warning.

## Extension and configuration notes

- `api.registerStopHook({ name, decide })` contributes an inert hook to `kernel.registries.stopHooks`;
  pass `activateKernel(kernel).stopHooks` into `createAgent({ stopHooks })`. Disposing the loaded
  extension unwinds the registration.
- Registrations are keyed by `name` (last write wins, like other contribution registries).
- `RunOptions.stopHooks` cannot replace agent hooks; it appends. `maxStopContinuations` narrows only.
- No dedicated `AgentEvent` is added: observe decisions through your own callback and the run outcome.

## Security and performance notes

- In-process seams — middleware, guardrails, injectors, and stop hooks — are host code with the
  host's full privileges. Registering one is trusting it; Prism validates payload shapes, bounds
  what reaches the provider, and redacts what reaches events, but it cannot sandbox a callback.
- Hooks never receive credentials and cannot mutate history: stop hooks get metadata plus the
  read-only transcript, and continuation text enters through the steer queue, so the 8-message /
  64 KiB caps bound it and the host redactor applies before it reaches the provider.
- No hook seam grants authority, by design. Permission and approval decisions stay with host policy
  (`ExecutionPolicy`, `requiresApproval`, `interruptBeforeTool`, guardrail-pack `ask` rules), so a
  hook can only deny or add context — the `PermissionRequest` non-goal above.
- Out-of-process hooks (`@arnilo/prism-hooks`) are the opposite trade: they run in a separate
  process, but with your user's privileges and an inherited environment, so the hash allowlist plus
  the per-handler `timeout` are the trust boundary. `mcp_tool` handlers add the MCP client's own
  transport and auth.
- Hooks run serially, awaited, once per natural loop end. Each continuation costs full provider
  turns until the model stops naturally; size `maxStopContinuations` accordingly (`0` = observe
  only). With no stop hooks configured, the wrapper is skipped entirely. `session_start` /
  `session_shutdown` fire once per session, `compaction_request` / `compaction` once per compaction,
  and tool seams once per tool call in their stage.

## Related APIs

- [Agent loops](agent-loops.md): loop strategies, turn policy, and `finishReason` ceilings.
- [Guardrails](guardrails.md): input/output/tool decisions, steer re-checking, and the `ask` rules that own approvals.
- [Middleware hooks](middleware-hooks.md): payload transforms at named boundaries, including the session and compaction seams.
- [Instruction injection](instruction-injection.md): where `additionalContext` from session and prompt hooks lands.
- [Extensions](extensions.md): `ExtensionAPI.registerStopHook()`, the contribution registries, and the `forwardAgentEvents()` bridge.
- [Runs and usage ledger](runs-and-usage.md): `maxStopContinuations` and clean stop reasons.
- [Agent/session runtime](agent-session-runtime.md): `session.close()`, steer queue semantics, and durable resume.
- [Agent events](agent-events.md): the events the extension bus observes, including `hook_limit`.
- [Public contracts](public-contracts.md): `RunOptions`, `RunLimits`, and `AgentConfig` surfaces.
