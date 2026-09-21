# @arnilo/prism-hooks

Run a Claude Code / Codex-compatible `hooks.json` against Prism. The package parses
the declarative config, validates it loudly, and compiles each event onto a public
Prism seam — no Prism internals, no new runtime dependency, `@arnilo/prism` as the
only peer.

```bash
npm install @arnilo/prism @arnilo/prism-hooks
```

```ts
import { activateKernel, createAgent, createExtensionKernel } from "@arnilo/prism";
import { createHooksExtension, hookCommandHash, parseHooksConfig } from "@arnilo/prism-hooks";

const config = parseHooksConfig(await readFile("hooks.json", "utf8"));
const handler = { type: "command", command: "node audit-tool.js" } as const;
const hooks = createHooksExtension(config, {
  trusted: { [handler.command]: hookCommandHash(handler) },
});

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

## Event → seam map

| `hooks.json` event | Prism seam |
| --- | --- |
| `SessionStart` | `session_start` middleware → instruction-injector context queue |
| `UserPromptSubmit` | `input` guardrail (block) → instruction-injector context queue |
| `PreToolUse` | `tool_call` middleware (`updatedInput`) + `tool_input` guardrail (`deny`) |
| `PostToolUse` | `tool_result` middleware (context) + `tool_output` guardrail (`deny`) |
| `Stop` | registered stop hook, bounded by `RunLimits.maxStopContinuations` |

Guardrails and stop hooks are returned/registered as inert contributions: the host
activates them through `AgentConfig` (or `RunOptions`), exactly like every other
kernel contribution.

## Semantics

- `command` handlers spawn with an argv array — the command string is tokenized
  locally (quotes/escapes only) and **never** run through a shell; `"shell": true`
  is rejected at parse time.
- Exit codes follow Claude/Codex: `0` success (JSON stdout parsed), `2` block with
  stderr as the reason, anything else a non-blocking error reported as
  `hooks:warning`. There is no exit code `64` in either reference.
- `timeout` is in **seconds** (default 600); expiry warns and never blocks.
- Matchers: literal tokens (with `|`/`,` alternatives) select exactly; anything with
  metacharacters is an unanchored regex. No `$1` capture substitution.
- `additionalContextLimit` is a token threshold (default 2500, `0` = unlimited);
  oversized context spills to `<tmpdir>/hook_outputs/` and a pointer is injected.
- `async: true` handlers run detached; their context lands at the next assembly.
- Trust: `options.trusted` maps a command string to a digest from
  `hookCommandHash()` (SHA-256 over the effective argv). Unlisted or mismatched
  handlers are skipped with a warning; `trusted: "all"` is the logged escape hatch.

Full documentation: [`docs/hooks.md`](https://github.com/ashiqrniloy/prism/blob/main/docs/hooks.md)
and [`docs/middleware-hooks.md`](https://github.com/ashiqrniloy/prism/blob/main/docs/middleware-hooks.md).
