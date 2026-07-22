# CLI/RPC

## What it does

The `prism` bin is a thin adapter over `AgentSession` plus a tiny project scaffold:

- `prism -p "prompt"`: print assistant text deltas.
- `prism --mode json -p "prompt"`: write one normalized event envelope per line.
- `prism --mode rpc`: read LF-delimited JSON requests from stdin and write correlated JSON responses/events to stdout.
- `prism init <dir>`: create a minimal TypeScript project with one selected provider, `.env.example`, and one offline mock test.

It does not add a TUI, app tools, provider globals, extension discovery, resource discovery, or credential storage. `init` uses Node standard-library filesystem APIs and checked-in templates only — no interactive prompts or template-engine dependency.

## When to use it

Use the CLI for terminal smoke tests, scriptable JSON event streams, simple non-Node clients that can speak newline-delimited JSON, and bootstrapping a tiny host project with `prism init`.

Use the SDK directly when an app needs custom providers, tools, resources, credentials, trust prompts, or UI behavior.

## Inputs / request

### `prism init`

```bash
prism init <dir> [--provider <name>] [--with-workflows] [--with-evals] [--force]
```

| Flag / arg | Purpose |
| --- | --- |
| `<dir>` | Destination directory (created if missing). |
| `--provider <name>` | `mock` (default), `openai`, `openrouter`, `kimi`, `zai`, `opencode-go`, or `neuralwatt`. |
| `--with-workflows` | Add `@arnilo/prism-workflows` and `src/workflows-example.ts`. |
| `--with-evals` | Add `@arnilo/prism-evals` and `src/evals-example.ts`. |
| `--force` | Overwrite generated files when the destination already exists. |
| `-h`, `--help` | Print init usage. |

Default generation installs only `@arnilo/prism` (mock provider). Selecting a real provider adds exactly one `@arnilo/prism-provider-*` package. Storage, telemetry, memory, and server packages are never added unless a later phase introduces an explicit flag for them. Rerunning without `--force` refuses non-empty destinations and existing generated files. `.env.example` contains placeholders only; `.gitignore` excludes `.env` and local stores.

### Run/RPC CLI flags

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
| `--discover` | Opt-in workspace contribution discovery (`SKILL.md`/`manifest.json`). Never auto-activates or imports. |
| `--discover-kinds <csv>` | Kinds to scan; defaults to `skill`. Accepts `skill,tool,context,instructions`. |
| `--no-discovery` | Hard-disable discovery even if `--discover` is set. |
| `--agents-config <path>` | App config root holding `agents/<name>/AGENT.md` bundles (opt-in). Envelopes only; the host resolves them via `resolveAgentBundle`. The CLI never defaults to the user's home directory. |
| `--instruction <name>` | Select a registered/discovered instruction injector (repeatable). `--instruction false` disables injectors for the run. Names resolve fail-closed. |
| `--injector-file <path>` | Load a markdown file as a static `every_turn` injector (repeatable). |
| `--no-agents-md` | Skip auto-loading `<workspaceRoot>/AGENTS.md` (Phase 31). |
| `--no-system-md` | Skip auto-loading the global `SYSTEM.md` layer (Phase 31). The CLI does not default to the user's home directory; pass `globalRoot` from a host adapter or use `--system-md-file` to opt in. |
| `--agents-md-file <path>` | Read AGENTS.md from `<path>` instead — still `source: "app"`, still trust-gated (Phase 31). |
| `--system-md-file <path>` | Read SYSTEM.md from `<path>` instead — user-owned, `source: "user"` (Phase 31). |
| `--help` | Print usage. |

RPC request envelope:

```ts
{ id: string | number; command: string; params?: Record<string, unknown> }
```

Supported command names: `prompt`, `steer`, `followUp`, `abort`, `state`, `messages`, `setModel`, `compact`, `switchSession`, `forkSession`, `cloneSession`, `checkout`, and `command`.

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

Branch-aware session commands return live handle details:

```ts
{
  sessionId: string;
  leafId?: string;
  handleId: string;
  handles?: readonly { handleId: string; sessionId: string; leafId?: string }[]; // state only
}
```

`sessionId` identifies the durable session. `leafId` is the selected branch tip. `handleId` is the RPC map key used by `switchSession`; forks that share the same `sessionId` get stable ids like `session-1#2` so the parent handle is not overwritten.

Invalid CLI flags return exit code `2`. Invalid JSON, missing ids, unknown RPC commands, unknown command contributions, and runtime failures return `ok: false` response envelopes without executing unknown tools or commands. `steer` with no active run (or overflow) returns `ok: false`.

## Request/response example

```json
{"id":"1","command":"prompt","params":{"input":"Hi"}}
{"type":"event","id":"1","sessionId":"s1","runId":"run_1","event":{"type":"message_delta"}}
{"id":"1","ok":true,"result":{"sessionId":"s1"}}
{"id":"2","command":"forkSession","params":{"leafId":"entry_1"}}
{"id":"2","ok":true,"result":{"sessionId":"s1","leafId":"entry_1","handleId":"s1#2"}}
{"id":"3","command":"checkout","params":{"leafId":"entry_5"}}
{"id":"3","ok":true,"result":{"sessionId":"s1","leafId":"entry_5","handleId":"s1#2"}}
```

## Active run behavior

`prompt` and `followUp` start an asynchronous run and write their final response only when the run finishes. While a run is active, the RPC loop continues to read and respond to other requests:

- `abort` cancels the active run for the current session and responds immediately.
- `state`, `messages`, `setModel`, `switchSession`, `forkSession`, `cloneSession`, `checkout`, and registered `command` requests are processed immediately.
- `compact` is fail-closed: if the current session has an active run, it returns `ok: false` because the session rejects compaction during a run.
- A second `prompt` or `followUp` for the same session while it already has an active run returns `ok: false` immediately instead of blocking the input loop.
- `steer` enqueues mid-run user text for the active session (`params.input`, optional `params.softInterrupt`). Fails closed when no active run or when the pending steer queue overflows (8 messages / 64 KiB). Soft interrupt aborts the current provider stream only; the run continues.

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

prism init my-agent
prism init my-agent --provider openai
prism init my-agent --provider openrouter --with-workflows --with-evals
cd my-agent && npm install && npm test
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

RPC `command` executes only explicitly registered `CommandDefinition` values. `setModel` stores a model override for later prompt/follow-up calls. `compact`, `switchSession`, `forkSession`, `cloneSession`, and `checkout` call the existing session APIs.

Optional workflow control (from `@arnilo/prism-workflows`) registers `workflow.start`, `workflow.enqueue`, `workflow.replay`, `workflow.status`, `workflow.list`, `workflow.cancel`, and `workflow.resume` via `createWorkflowCommands({ workflows, checkpoints, runOptions? })`. Supplying an ownership-scoped `schedules` service additionally registers `schedule.create`, `schedule.list`, `schedule.pause`, `schedule.resume`, `schedule.trigger`, and `schedule.delete`. Pass the returned `CommandDefinition[]` into `runRpcServer({ commands })` the same way as observational-memory commands. Cancel aborts in-process runs through the package active-run registry; orphaned durable checkpoints still marked `running` are fail-closed to `aborted`.

Suspended workflow resume parameters are `{ workflowId, runId, decision: "approve" | "deny", input?, expectedVersion, ownership? }`. Read `expectedVersion` from `workflow.status`/`workflow.list`; stale or duplicate decisions fail checkpoint CAS before node execution. Ordinary recovery resume for failed/aborted runs remains backward-compatible without decision fields.

`forkSession` creates another handle for the same `sessionId` and selected `leafId`; it no longer overwrites the parent handle in the RPC map. Keep the returned `handleId` when a UI needs to switch among sibling branches. `switchSession` accepts `handleId` (preferred), `sessionId`, or `id`; with multiple branch handles, use `handleId` to avoid ambiguity. `checkout` requires `params.leafId`, calls `AgentSession.checkout(leafId)`, and keeps the active handle id unchanged while moving that handle to the existing leaf. `messages` returns entries for the active branch path.

## Security and performance notes

- No built-in app tools ship in core.
- No hidden provider, credential, extension, resource, config, settings, or tool globals are created.
- No full TUI or sandbox is provided or implied.
- JSONL is processed line by line with Node stdlib; no parser dependency, worker, watcher, or queue is added.
- Unknown or malformed CLI/RPC input fails closed. Workflow resume validates decision and positive `expectedVersion`; ownership remains host-selected and checkpoint-enforced.
- `prism init` refuses non-empty destinations without `--force`, keeps writes inside the destination root, and never executes downloaded code beyond the user's later `npm install`.
- Generated `.env.example` values are placeholders only; `.gitignore` excludes `.env` and local store files.
- Default generated install stays small (~27 MB with TypeScript tooling in a clean consumer install versus Mastra's measured 439 MB scaffold); unselected storage/telemetry/eval/workflow packages are omitted.
- Branch handles (`handleId`, `sessionId`, `leafId`) are identifiers only; do not encode credentials, tokens, provider objects, or secrets into them.
- Do not put resolved credential values, tokens, headers, or secrets in prompts, CLI flags, config, events, or docs examples.

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): runtime API used by CLI/RPC.
- [Contribution registries](contribution-registries.md): command contributions are inert until explicitly wired.
- [Configuration and manifests](configuration-and-manifests.md): config data stays separate from CLI/RPC execution.
- [Contribution discovery (workspace)](contribution-discovery.md): the `--discover` / `--discover-kinds` / `--no-discovery` flags fill host registries; no `import()`, no auto-activate.
- [Node filesystem config loader](node-filesystem-config.md): optional explicit config file loading for Node hosts.
- [Resource loading](resource-loading.md): explicit resource loading primitives.
- [Credentials and redaction](credentials-and-redaction.md): secret redaction helpers and credential boundaries.
- [Observational memory compaction package](compaction-observational-memory.md): optional `om:status` and `om:view` command factories for explicitly wired hosts.
- [Workflows](workflows.md): optional `createWorkflowCommands()` for direct/background/replay/status/cancel/resume and selected schedule control over the same RPC `command` seam.

The CLI records flags but does not auto-load project-local resources, extensions, tools, or config. The two system/project prompt files are the exception: in print/json modes the CLI auto-loads `<workspaceRoot>/AGENTS.md` (trust-gated) and an app-supplied `SYSTEM.md` layer as `AgentConfig.systemPrompt` layers composed with `--system` (base); `--no-agents-md` / `--no-system-md` skip them and `--agents-md-file` / `--system-md-file` override the paths. The CLI does not default `globalRoot` to the user's home directory — pass it from a host adapter or use `--agents-config <path>` for the app-config bundle layout. RPC mode does not auto-read these files (the host owns the session factory). Hosts must make explicit trust and permission decisions before wiring any other local loading.

For app-controlled agent bundles under `<configRoot>/agents/<name>/AGENT.md` (including the three-layer `SYSTEM.md` → `AGENT.md` body → repo `AGENTS.md` prompt append and the union skill/tool scopes), see [Agent definitions](agent-definitions.md).
