# @arnilo/prism-hosts/driver-process

A generic process driver for host-written external-agent adapters. It claims `slot:loop` and runs without a Prism model. No adapter or external binary is bundled.

## Install

```sh
bun add @arnilo/prism @arnilo/prism-hosts
```

## Configuration

Create the profile first through `createProfiles({ driver: adapterDriver(adapter) })` from `@arnilo/prism/driver-kit`. Profile sign-in and deployment policy follow the descriptor's auth modes. The driver uses the agent's effective tools and skills registries.

| Configuration | Default | Meaning |
| --- | --- | --- |
| `name`, `profile` | required | Agent name and existing profile |
| `binary` | adapter command | Executable path override; command prefix arguments remain |
| `args` | `[]` | Arguments before the adapter's configured arguments |
| `cwd` | current directory | Working directory when no workspace is bound |
| `capture` | `mapped` | Mapped accounting or raw frame events |
| `graceMs` | `5000` | Cleanup signal grace budget |
| `vendor` | `{}` | Adapter-specific JSON Schema options; unknown keys fail closed |
| `isolation` | `strict` | Workspace-file adapters require a bound worktree |
| `prismTools`, `skills` | none | Selected tool and skill names (`skills` also accepts `all`) |
| `deployment` | `local` | Auth deployment policy |
| `profilesRoot`, `principal`, `acknowledgements`, `requires` | driver-kit defaults | Profile, identity, terms, and capability checks |

The remaining `ExternalAgentSpec` fields (system prompt, model, effort, built-in tools, subagents, limits) are passed to `configure`. Adapters own their mapping into flags and files.

## What it changes

Installing this package claims `slot:loop` with a loop that has `usesModel: false`, so `createAgent` needs no model. It provides a `driver-process:<adapter name>` service whose `inspect()` reports the adapter identity, binary, transport, capture, deployment, isolation, and auth policy. It registers no tools, skills, providers, or events of its own; the vendor agent's activity reaches the shared event stream as `agent.*` events. The adapter owns the mapping from the agent definition to the binary.

## The adapter contract

Export a plain `AgentAdapter` object with:

- `name`, `revision`, `descriptor`, optional `vendor` schema.
- `binary: { command, versionArgs?, version(stdout) }` and `profile: { parseStatus }`.
- `configure(spec, ctx)` returning `LaunchPlan { args?, env?, files?, overlays? }`. Context includes the private `runDir`, profile `home`, `cwd`, selected materialized `skills`, optional MCP `endpoint`, and `hook: { argv, command }`. The command is POSIX quoted. Wrap the neutral skill layout by returning additional files or overlays.
- `open?(ctx)` for initialization frames, and `encode.prompt(input, ctx)`, optional `encode.steer` and `encode.continue`. Encoding contexts carry optional session and turn IDs; opening also receives selected tool definitions and resume entries.
- `decode(frame)` returning `Decoded { activity, turnEnd?, sessionId?, turnId?, stop?, unmapped? }`. Activities are observed sequentially. A session-ID signal is recorded in external state.
- Optional `hooks: { codec, failClosed, timeoutMs? }` for relay callbacks, optional `permissionTool` for MCP permission prompts, and optional JSON-RPC `requests` handlers.
- `session: { strategy, archive?, restore? }`, `abort` steps (RPC, stdin close, signals), and optional `notices(activity)` limit classification.

`adapterDriver(adapter)` exposes the driver-kit definition. `processDriver(adapter)` builds its native package and adds a `driver-process:<adapter.name>` service with `inspect()`. Setup status notes include adapter revision, binary version, transport, capture, deployment, isolation, and auth policy.

The driver supports both `jsonl-stream` and `json-rpc`.

## Process lifetime and resume

One process is probed at package setup and one process is spawned for each run. Each run also starts a local callback broker. MCP is loaded dynamically only when tools or a permission tool are selected. Skill files are copied each run. This startup and filesystem cost applies even to short turns. Persistent processes are outside this package's current scope. The adapter selects one resume strategy:

- `store` requires `archive` and `restore`. The driver archives once per completed turn, including continuations; the final archive runs after graceful process shutdown so transcript writes can flush. Entries use bounded, redacted `vendor-session` external state. A new run restores them into its private run directory. Restore plans accept only `files` and `args`; the driver appends those arguments automatically, and also exposes them as `configure`'s `ctx.resume.args`.
- `vendor` records decoded session IDs and passes the latest as `ctx.resume.sessionId` and the encoding context's `sessionId`.
- `none` starts fresh and writes no resume state. Adapters choose this strategy to avoid per-turn archive writes; there is no implicit strategy default.

`archive` and `restore` receive `{ runDir, home, cwd, sessionId? }`. Non-empty resume state requires matching binary major and adapter revision; a mismatch fails with `driver_revision_mismatch`. Provenance is stored separately under `driver-revision` before launch, including for runs interrupted after receiving a vendor ID.

Archived strings and object keys are checked against all declared protected credential paths, and restored files pass run-directory containment. Adapters are trusted host code: opaque transcript content carries no source provenance, so adapters must select conversation data without reading credential files. Configured secrets are redacted before persistence, and the kernel's external-state byte cap still applies.

## Abort

A run abort executes the adapter's declared steps in order. RPC steps send JSON-RPC notifications, stdin steps close the input, and signal steps signal the child. Each step receives a slice of `graceMs`, with two slices reserved for the fallback signal ladder; a hard SIGKILL deadline covers the whole abort budget. Failed interrupt writes do not prevent escalation. RPC steps require `json-rpc`.

Normal completion closes stdin and waits up to `graceMs` for flushing before using the fallback signal ladder. It can therefore take roughly twice the grace budget if escalation is needed. An abort during this final flush still executes the abort steps. Classified vendor limits also use the abort ladder, without retry.

## Capabilities

The package claims `slot:loop` with `usesModel: false`, and declares `host-ui` when the adapter has JSON-RPC request handlers that route to `host.ui`. It depends on the kernel and on `@arnilo/prism-hosts/mcp-server`, which is imported dynamically only when the spec selects tools or a permission tool.

## Cost, security, and failure behavior

One process is probed at package setup and one is spawned per run, even for a short turn. `capture: "all"` emits one `agent.raw` event per unmapped frame; the default `capture: "mapped"` counts them and emits one notice. A `store` adapter writes an archive per completed turn; `none` avoids that write.

The kit checks profiles, deployment policy, and required controls before spawn. Child environments use the kit's allow list and strip protected variables. The broker token reaches the child only in the MCP endpoint's named environment variable; neither the endpoint nor inspection contains it. Activity and errors mask the token and configured environment values.

Files must be relative to the private run directory. Overlays go through `RunDirectory.overlay`, including Git exclude blocks, and must target disposable workspace paths. All handles close in reverse order. Process cleanup closes stdin and applies the kit's signal ladder before removing materialized files.

Malformed adapters throw `ProcessDriverError` `adapter_invalid`, naming the member. Missing or unparsable binaries produce a status note and `driver_unavailable` on run. An exit before the decoded `turnEnd` fails with `vendor_process_exited` and a bounded redacted stderr tail. Stdout JSONL lines are capped at 1 MiB. Invalid JSON is treated as unmapped.

## Gating and fail-closed responses

`configure` receives the relay hook command. Its codec maps callbacks to `pre-tool`, `stop`, or `observe`. Only `pre-tool` calls `run.ask`; observed activity never grants permission. Rewrites require `descriptor.controls.rewrite`. Empty effect lists receive all tool effects; adapters should use `effectsTable` for vendor tool names. Response substitution remains unsupported because the current descriptor has no `respond` control. Codec failures and an unreachable broker use the adapter's declared `failClosed`, including protocols that print a deny with exit code zero.

Stop callbacks and decoded `stop` signals call `run.end`. Continuations require `continueOnStop`, and decoded stops also require `encode.continue`. The kernel caps them with `limits.maxContinuations`.

## Steering

`mid-turn` delivers messages using `encode.steer`; `next-turn` collects messages and sends them as the next prompt after `turnEnd`. `none` emits `steer_unsupported`. Frames, relay callbacks, and steering share an ordered queue. JSON-RPC request handlers run concurrently within the bound described below.

## Capture and unmapped frames

The default `capture: "mapped"` counts unmapped frames and emits one `unmapped_frames` notice per run. `capture: "all"` emits one `agent.raw` event per unmapped frame, increasing event and storage costs. Invalid JSON uses the kit's redacted, 256-character preview. Valid raw frames and mapped activity are redacted before observation.

## Rate limits and quotas

`notices` classifies decoded notice activity. Rate-limit, quota, billing, and auth signals reach the profile guard and fail with `vendor_limit`; `ProcessDriverError.deferUntil` carries a deferral date when supplied. The process is stopped without retry. The declared abort steps precede the fallback signal ladder within the abort deadline. A throwing classifier also fails the run and reaps the process.


## Transports

`jsonl-stream` writes encoded JSON to stdin and decodes stdout lines. `json-rpc` uses a JSON-RPC 2.0 peer over the same stdio pipes. Its encoders return `{ method, params?, notify?, onResult? }`. `notify: true` sends a notification; otherwise the driver sends a request. Results go through `onResult(result)` when supplied, or directly through `decode(result)` otherwise. An `onResult` returning `undefined` ignores an acknowledgement. Notification envelopes reach `decode` in wire order, including their `method` and `params`.

`open(ctx)` frames run sequentially before the first prompt. Each request waits for its reply and applies decoded session/turn IDs before the next opening frame or prompt. Prompt, steer, and continuation requests keep the reader running while replies are outstanding, so approval callbacks and turn-completion notifications cannot deadlock a pending request. A decoded result can also end a turn without a completion notification.

Both transports share capture, steering, stop/continue, redaction, and process cleanup. JSON-RPC lines retain the 1 MiB cap. At most 256 notification/result frames may wait for consumption; exceeding this bound fails the run rather than dropping frames.

## Server-to-client requests

Every JSON-RPC request needs an own entry in `adapter.requests`. Each handler receives `{ params, run, host, bridge, ask, tools, sessionId?, turnId? }`; it receives neither the peer nor the broker token. These types are exported as `RequestContext` and `RequestHandler`.

Use `ask(request)` for approvals: it calls `run.ask` with the adapter's rewrite support, preserving `tool.call` hooks and external origin. Without a UI, the kernel denies or suspends according to whether the loop is resumable. Use `host.ui.request` for questions and elicitation; the process package declares `host-ui` when request handlers are present. Use `bridge.invoke(call)` for client tools; only `spec.prismTools` are bridged, and execution goes through `run.executeTools`.

Up to 8 handlers run concurrently. Excess concurrent requests receive a JSON-RPC error and fail the run. Unknown methods receive `-32601` before the run fails with `vendor_request_unhandled`, naming the method. A throwing handler receives `-32603` before the run fails with `vendor_request_failed`; error text is redacted. These failures are never retried. Adapters that use `adapterDriver` inside their own package must declare that package's `host-ui` capability before calling `host.ui`.

## Extending an adapter

`extendAdapter(base, overrides)` creates a new adapter at definition time without changing the base. Every extension requires its own `name` and `revision`.

```ts
import { extendAdapter } from "@arnilo/prism-hosts/driver-process";

const custom = extendAdapter(adapter, {
  name: "my-extended-adapter",
  revision: "1",
  configure: (baseConfigure) => async (spec, ctx) => {
    const plan = await baseConfigure(spec, ctx);
    return { ...plan, args: [...(plan.args ?? []), "--quiet"] };
  },
  decode: { replace: (frame) => decodeCustomFrame(frame) },
  descriptor: {
    auth: {
      modes: adapter.descriptor.auth.modes.map((mode) => ({ ...mode, deployments: ["local"] })),
    },
  },
});
```

For `configure`, `decode`, `open`, and `notices`, a bare function is a `(baseFunction) => newFunction` factory, called once. Use `{ replace: fn }` to replace a function directly or introduce an absent optional function. Wrapping an absent function fails with `adapter_invalid`; a wrapper must return a function. The explicit replacement form avoids guessing from function arity or executing a decoder during definition.

Object members (`binary`, `profile`, `encode`, `hooks`, `session`, `requests`) merge one level; functions inside those objects replace directly. The descriptor merges its `controls`, `capture`, and `auth` fields one level. Arrays, including `abort` and auth `modes`, replace as a whole; they never concatenate or merge by index. Other members replace directly.

Auth overrides may remove modes or deployments, add hosted acknowledgements, or add protected paths and variables. They cannot introduce modes, change a mode's kind or home variable, remove acknowledgements or protections, or enable another deployment (`adapter_invalid: policy_widened`). The merged adapter is validated, and setup checks `requires` against its descriptor. Adapters remain trusted host code: keep their policy data unchanged after definition.

The result records `extends: { name, revision, extends? }`. Inspection status notes and the `driver-process:<name>` service include the full chain beside the extension's identity.

## Testing your adapter

Import the offline suite separately so production imports do not load testing code:

```ts
import { adapterConformance } from "@arnilo/prism-hosts/driver-process/testing";

const result = await adapterConformance(myAdapter, {
  dialect: myDialect,
  fixtures: {
    config: (cli) => ({ binary: cli.command[0], args: cli.command.slice(1) }),
    recorded: "fixtures/my-agent.json",
  },
});
```

Run this in the host's CI against fixtures from `recordFixtures.finish` in
`@arnilo/prism/testing`. The result lists the kernel driver legs plus fixture
replay, unmapped capture, declared fail-closed response, unknown RPC request,
abort, resume, hosted acknowledgements, and rate-limit checks. Failures throw
`AdapterConformanceError` with the failing `leg`; unavailable legs include a
skip reason. The credential canary retains the kernel suite's filesystem atime
limitation.

The dialect describes the binary's wire. `fixtures.scriptFor(activity)` can
return raw steps when the dialect's `frames` cannot map a neutral activity.
`fixtures.home` supplies the actual hook, skill, and MCP paths planted by the
strict isolation check. Command-hook dialects that print deny with exit zero
must supply `hook.allowed({ exitCode, stdout })` so the fake binary honors that
response. Without it, the binary uses the exit code.

## Example

```ts
import { createAgent } from "@arnilo/prism";
import { processDriver } from "@arnilo/prism-hosts/driver-process";
import { adapter } from "./my-adapter.ts";

const agent = await createAgent({
  packages: [processDriver(adapter)({ name: "worker", profile: "me" })],
});
```

## Related

- Writing an adapter: the contract, the mappings, and the dated worked mappings for the three researched binaries.
- drivers: the kernel driver kit this package builds on.
- Reference adapters: `stream-cli.ts` (shape A), `rpc-server.ts` (shape B), `workspace-config.ts` (shape C).
- Extending an adapter: a host derives a new adapter from the rpc-server reference with `extendAdapter` and runs it through `processDriver`.
