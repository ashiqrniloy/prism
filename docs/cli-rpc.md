# CLI/RPC

## What it does

The `prism` bin is a thin adapter over `AgentSession`:

- `prism -p "prompt"`: print assistant text deltas.
- `prism --mode json -p "prompt"`: write one normalized event envelope per line.
- `prism --mode rpc`: read LF-delimited JSON requests from stdin and write correlated JSON responses/events to stdout.

It does not add a TUI, app tools, provider globals, extension discovery, resource discovery, or credential storage.

## When to use it

Use the CLI for terminal smoke tests, scriptable JSON event streams, and simple non-Node clients that can speak newline-delimited JSON.

Use the SDK directly when an app needs custom providers, tools, resources, credentials, trust prompts, or UI behavior.

## Inputs / request

CLI flags:

| Flag | Purpose |
| --- | --- |
| `-p`, `--prompt <text>` | Prompt for print/json modes. |
| `--mode print\|json\|rpc` | Select output/protocol mode. Defaults to `print`. |
| `--provider <name>` | Explicit provider id. The built-in `mock` id is only a smoke-test provider. |
| `--model <name>` | Explicit model name. |
| `--session <id>` | Session id. |
| `--config <path>` | Explicit config path recorded by the adapter; not auto-loaded. |
| `--resource <uri>` | Explicit resource URI recorded by the adapter; not auto-loaded. |
| `--extension <name>` | Explicit extension name recorded by the adapter; not auto-loaded/imported. |
| `--tool <name>` | Explicit tool name recorded by the adapter; not auto-enabled. |
| `--system <text>` | System instructions. |
| `--context <text>` | Context text reserved for host adapters. |
| `--compact <entries>` | Auto-compaction threshold for the run. |
| `--max-tool-rounds <n>` | Maximum runtime tool rounds. |
| `--discover` | Opt-in workspace contribution discovery (`SKILL.md`/`AGENT.md`/`manifest.json`). Never auto-activates or imports. |
| `--discover-kinds <csv>` | Kinds to scan; defaults to `skill`. Accepts `skill,tool,context,instructions,agent`. |
| `--discover-global` | Also scan `~/.prism/agent/` (global root). |
| `--no-discovery` | Hard-disable discovery even if `--discover` is set. |
| `--instruction <name>` | Select a registered/discovered instruction injector (repeatable). `--instruction false` disables injectors for the run. Names resolve fail-closed. |
| `--injector-file <path>` | Load a markdown file as a static `every_turn` injector (repeatable). |
| `--help` | Print usage. |

RPC request envelope:

```ts
{ id: string | number; command: string; params?: Record<string, unknown> }
```

Supported command names: `prompt`, `steer`, `followUp`, `abort`, `state`, `messages`, `setModel`, `compact`, `switchSession`, `forkSession`, `cloneSession`, and `command`.

The `prompt` and `followUp` params accept an optional `instructionInjectors?: readonly string[]` field (Phase 30). Names resolve against the `instructionInjectors` registry passed to `runRpcServer({ instructionInjectors })`; an unknown name fails closed (error response correlated to the request `id`, no provider call).

## Outputs / response / events

Print mode writes only assistant text deltas to stdout. Errors write a short line to stderr and return non-zero.

JSON mode writes newline-delimited event envelopes:

```ts
{ type: "event"; sessionId?: string; runId?: string; event: AgentEvent }
```

RPC writes responses and async events:

```ts
{ id: string | number | null; ok: true; result?: unknown }
{ id: string | number | null; ok: false; error: ErrorInfo }
{ type: "event"; id: string | number; sessionId?: string; runId?: string; event: AgentEvent }
```

Invalid CLI flags return exit code `2`. Invalid JSON, missing ids, unknown RPC commands, unsupported `steer`, unknown command contributions, and runtime failures return `ok: false` response envelopes without executing unknown tools or commands.

## Request/response example

```json
{"id":"1","command":"prompt","params":{"input":"Hi"}}
{"type":"event","id":"1","sessionId":"s1","runId":"run_1","event":{"type":"message_delta"}}
{"id":"1","ok":true,"result":{"sessionId":"s1"}}
```

## Active run behavior

`prompt` and `followUp` start an asynchronous run and write their final response only when the run finishes. While a run is active, the RPC loop continues to read and respond to other requests:

- `abort` cancels the active run for the current session and responds immediately.
- `state`, `messages`, `setModel`, `switchSession`, `forkSession`, `cloneSession`, and registered `command` requests are processed immediately.
- `compact` is fail-closed: if the current session has an active run, it returns `ok: false` because the session rejects compaction during a run.
- A second `prompt` or `followUp` for the same session while it already has an active run returns `ok: false` immediately instead of blocking the input loop.

Events streamed during a run keep the original prompt request id, even when an `abort` with a different request id cancels the run. The completion or error response for the prompt also uses the original prompt request id.

```json
{"id":"run-1","command":"prompt","params":{"input":"Hi"}}
{"id":"abort-1","command":"abort","params":{"reason":"stop"}}
{"type":"event","id":"run-1","sessionId":"s1","runId":"run_1","event":{"type":"error","error":{"message":"Agent run aborted"}}}
{"id":"abort-1","ok":true,"result":{"sessionId":"s1"}}
{"id":"run-1","ok":false,"error":{"message":"Agent run aborted"}}
```

## Implementation example

```sh
prism --provider mock --model demo -p "Hi"
prism --provider mock --mode json -p "Hi"
printf '{"id":"1","command":"prompt","params":{"input":"Hi"}}\n' | prism --provider mock --mode rpc
```

Programmatic hosts should use the public runtime directly:

```ts
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";

const agent = createAgent({
  model: { provider: "mock", model: "demo" },
  provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
});
await agent.createSession({ id: "s1" }).run("Hi");
```

## Extension and configuration notes

CLI/RPC are adapters over `AgentSession`. They do not scan packages, import extensions, read config files, fetch resources, resolve credentials, or register tools unless a host adapter explicitly wires those primitives in.

RPC `command` executes only explicitly registered `CommandDefinition` values. `setModel` stores a model override for later prompt/follow-up calls. `compact`, `switchSession`, `forkSession`, and `cloneSession` call the existing session APIs.

## Security and performance notes

- No built-in app tools ship in core.
- No hidden provider, credential, extension, resource, config, settings, or tool globals are created.
- No full TUI or sandbox is provided or implied.
- JSONL is processed line by line with Node stdlib; no parser dependency, worker, watcher, or queue is added.
- Unknown or malformed CLI/RPC input fails closed.
- Do not put resolved credential values, tokens, headers, or secrets in prompts, CLI flags, config, events, or docs examples.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): runtime API used by CLI/RPC.
- [Contribution registries](contribution-registries.md): command contributions are inert until explicitly wired.
- [Configuration and manifests](configuration-and-manifests.md): config data stays separate from CLI/RPC execution.
- [Contribution discovery (workspace & global)](contribution-discovery.md): the `--discover` / `--discover-kinds` / `--discover-global` / `--no-discovery` flags fill host registries; no `import()`, no auto-activate.
- [Node filesystem config loader](node-filesystem-config.md): optional explicit config file loading for Node hosts.
- [Resource loading](resource-loading.md): explicit resource loading primitives.
- [Credentials and redaction](credentials-and-redaction.md): secret redaction helpers and credential boundaries.
- [Observational memory compaction package](compaction-observational-memory.md): optional `om:status` and `om:view` command factories for explicitly wired hosts.

The CLI records flags but does not auto-load project-local resources, extensions, tools, or config. Hosts must make explicit trust and permission decisions before wiring any future local loading.
