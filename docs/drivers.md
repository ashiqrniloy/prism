# Driver kit

## What it does

`@arnilo/prism/driver-kit` is the vendor-neutral contract for a driver package: a package that fills the `loop` slot
with a `LoopStrategy` that runs a custom agent on a vendor coding-agent binary instead of calling a model. It carries
`ExternalAgentSpec` (the agent definition every driver accepts), `DriverDescriptor` (what the binary can enforce and
capture, and which auth modes it permits), `defineDriver`, `driverPackage`, and the `requires` check. It has no runtime
dependency, imports only Node built-ins and the kernel, and is not loaded by the root entry. It names no vendor: an
adapter for a specific binary is host code.

## When to use it

- You write an adapter that runs one vendor binary as a loop and want the config, probe, capability check, and slot
  claim done for you.
- A host needs to refuse a driver that cannot enforce a control it depends on (`requires`).

## Spec

`ExternalAgentSpec` is the package config of a driver. Tools (`prismTools`) and skills (`skills`) select by name from the
driver agent's own registries; the spec never carries definitions. `profile` is required. `isolation` defaults to
`"strict"`. `vendor` holds vendor-specific options and is validated by the driver's own schema; a driver that declares
none accepts none. `externalAgentSpecSchema(vendorSchema?)` returns the JSON Schema the package validates against.
Unknown keys fail closed. `systemPrompt`, when set, holds exactly one string under `replace` or `append`; the schema's `oneOf` over the two object shapes rejects an unknown key, both keys, or neither.

## Descriptor

`DriverDescriptor` states `usesModel: false`, `models` (`"passthrough"` exposes `RunOptions.model` as `run.model`,
`"none"` rejects it), the `controls` the vendor can enforce, the `capture` it can report, and
`auth: { modes: AuthMode[] }`. An `AuthMode` is data: `name`, `kind` (`"account"` or `"api-key"`), `deployments`
(`"local"`, `"hosted"`), `hostedAcknowledgements`, `protected` credential `paths` and `env` the kit must never open or
accept as a ref, and the vendor's `login` and `status` commands. The sections below, profiles and the policy guard,
describe how the kit enforces it.

## `defineDriver` and `driverPackage`

```ts
const driver = defineDriver({
  name: "example-driver",
  vendor: "example",
  revision: "1",
  descriptor,
  config: { type: "object", properties: { binary: { type: "string" } } },
  start: {
    probe: async (config) => ({ path: config.binary ?? "example-cli", version: "1.2.0" }),
    run: async ({ run, spec, binary }) => { /* spawn, map activity with run.observe, gate with run.ask */ },
  },
});
const agent = await createAgent({
  packages: [driverPackage(driver)],
  packageConfig: { "example-driver": { name: "planner", profile: "me" } },
});
```

`driver.config` lists extra top-level keys; its `properties.vendor` validates `ExternalAgentSpec.vendor`. It may not
redefine a spec key or `requires`. `driverPackage` declares `slot:loop` and provides a loop with `usesModel: false` and
`runModel` from the descriptor, so `createAgent` needs no model.

At `setup` the package probes the binary (`start.probe`, bounded by `probeTimeoutMs`, default 5 s). A missing binary, a
rejected probe, or a timeout is a `warn` status note; the loop is still registered, and a run on it fails with
`driver_unavailable`. The loop's `snapshot` records the binary's major version, and `restore` fails a resume under a
different major with `driver_revision_mismatch`. The loop `revision` stays the driver's own: the kernel compares it for
exact equality on resume, which would reject every minor upgrade and preempt the typed error.

## `requires`

The package config accepts `requires`, checked against the descriptor at `setup`:

| Key | Met when the descriptor has |
| --- | --- |
| `systemPrompt: "replace" \| "append"` | that mode in `controls.systemPrompt` |
| `builtinTools: "per-tool" \| "partial"` | `controls.builtinTools` at least that strong |
| `gated: ToolCapabilityKind[]` | `controls.permissionCallback` |
| `steer: "mid-turn" \| "next-turn"` | `controls.steer` at least that strong |
| `resume: "store" \| "vendor"` | `controls.resume` (`"store"` satisfies `"vendor"`) |
| `thinking` | `capture.thinking` at least that detailed (`deltas` > `final` > `summary` > `tokens-only`) |
| `skillActivation: true` | `controls.skills` and a `capture.skillActivation` other than `"none"` |
| `subagents: true` | `controls.subagents` |
| `accountSignIn: true` | some auth mode with `kind: "account"` |

A miss fails `createAgent` with a message that starts `driver_capability_missing` and names the key.

## Auth policy

Auth is data on the descriptor: `auth.modes` lists `AuthMode`s (`name`, `kind: "account" | "api-key"`, `deployments`,
`hostedAcknowledgements`, `protected: { paths, env }`, `login`, `status`, `homeEnv`). `defineDriver` rejects an account
mode with no `protected` paths or env, and an account mode that allows `hosted` without listing acknowledgements.
`protected` entries are only ever compared as strings: the kit never opens them. The driver supplies
`parseStatus({ exitCode, stdout }) => { signedIn, method? }`; the kit keeps `signedIn`, `method`, and a timestamp, and
discards stdout. A throwing `parseStatus` gives `auth_required` with no output in the message.

## Profiles and sign-in

`createProfiles({ root, driver, host })` stores one directory per profile at `<root>/<driver>/<name>/` (default root
`~/.prism/profiles`) with a `profile.json` record that holds no secret, and a `home/` directory the vendor is pointed at
through the mode's `homeEnv`. Methods: `create(name, { mode, principal, maxConcurrentRuns })`, `ensure(name)` (create if
missing, check status, sign in if signed out), `login(name)`, `status(name)`, `bind(name, principal)`, `remove(name)`.
`login` sends a `terminal` request to `host.ui`; with `unavailable` it sends a `notify` naming the exact command and
fails with `auth_required`. All file access goes through one join that rejects `..`, absolute paths, and any path inside
a protected entry.

## Policy guard

`driverPackage` creates a guard from the package config (`profilesRoot`, `deployment` default `"local"`,
`acknowledgements`, `principal`) and runs `guard.acquire({ profile, config })` before every `start.run`; the lease reaches
the driver as `context.lease` and is released when the run settles. It fails closed with:

- `credential_required`: a config value is an `env:` or `keyring:` ref naming a protected variable, or a path inside a
  protected location. API keys stay ordinary refs.
- `profile_principal_mismatch`: the profile is bound to another principal (or the run has none).
- `plan_login_not_permitted`: the mode does not list the deployment, or a hosted run lacks its acknowledgements.
- `profile_busy`: more than `maxConcurrentRuns` (default 2) active runs on one profile. The counter is process-wide and keyed by the profile's home, so every agent and guard in the process shares one cap. `DriverError.profile` names the profile, so callers (such as a workflow `fanOut`, which waits and retries) never parse the message.
- `auth_required`: the profile is missing or signed out; the message names the login command. `status` runs only when
  no signed-in result is cached.

The driver reports vendor limits with `guard.noteLimit(profile, { code, deferUntil? })`; it returns `stop` or `defer` and
the kit never retries. The guard and the profile store are the `driver-kit:<package name>` service;
`guard.inspect()` lists the binary path and version, the auth method, the bound principal, deployment,
acknowledgements, and `maxConcurrentRuns`, with no secret. A driver's author owns the vendor's terms: the kit enforces
what the descriptor declares and nothing more.

## Isolation and materialization

`createRunDirectory(profileHome, runId)` makes a private (`0700`) directory at `<profileHome>/runs/<runId>`. `writeFile(rel, content)` writes `0600` files and throws `profile_invalid` for absolute or `..` paths. `overlay(worktree, files)` writes files into a worktree and lists each in the worktree's `info/exclude` once, so `git status` stays clean. `resolveGitExclude(worktree)` returns that file: `<worktree>/.git/info/exclude` for a main worktree, or the git **common** directory's `info/exclude` for a linked worktree (its `.git` is a file naming a per-worktree git directory whose `commondir` points at the common directory, so the exclude lives outside the worktree). `overlay` writes its lines as one marked block per run directory (`# prism-overlay <id> begin` … `end`) through `writeExcludeBlock(worktree, id, paths)`, the one writer it shares with the coding `workspace` service; lines inside another owner's block and unmarked user lines are never touched. Because the common exclude file is shared, an overlay in a linked worktree also excludes the path in the main worktree — harmless for tracked files. `dispose()` removes the overlay files, its own block, and the directory; it is idempotent and should run on run end, abort, and agent dispose. A `.git` file whose `gitdir`/`commondir` does not resolve to a git directory fails with `worktree_not_git` before anything is written.

`materializeSkills(dir, registry, "all" | names, layout?)` copies the selected skills (resources included, never symlinks) to the neutral `skills/<name>/SKILL.md` layout and returns `{ root, pathToSkill, extra }`. An unknown name fails with `unknown_skill`. The optional `layout` callback receives `{ root, pathToSkill }` and returns extra files, for example a plugin manifest.

`assertIsolation(descriptor, { isolation, worktree })` fails with `worktree_required` when `isolation` is `"strict"` (the default), the descriptor's `controls.isolation` is `"workspace-files"`, and there is no worktree. `"inherit"` is allowed and reported.

## Process and protocol helpers

Small, bounded, vendor-neutral helpers for driving a child process. None holds driver state.

- `readJsonl(stream, { maxLineBytes, maxLines?, redact? })` is an async iterator of `{ kind: "value", value }` or
  `{ kind: "invalid", raw }` items. A malformed line is reported (redacted, truncated to 256 characters), never thrown. A line over
  `maxLineBytes` fails with `jsonl_line_too_long`. Memory is one line plus the current chunk.
- `createJsonRpcPeer({ readable, writable, onRequest, onNotification, onUnhandled })` speaks JSON-RPC 2.0 over JSONL:
  `request` and `notify` go out, server requests are answered through `onRequest`. With no `onRequest`, a server request is
  answered with a `-32601` error and `onUnhandled(method)` fires so the driver can fail the run.
- `createStdinWriter(writable)` serializes writes and waits for `drain` on backpressure; `close()` ends stdin.
- `signalLadder(child, { graceMs })` sends SIGINT, then SIGTERM after `graceMs`, then SIGKILL after `2 * graceMs`, and resolves with the exit.
- `redactedStderr(stream, redactor, { maxBytes })` keeps a bounded tail, redacted before it is stored.
- `buildChildEnv({ base?, allow?, paths?, apiKeys?, modes? })` builds an environment from an allow-list
  (`DEFAULT_ENV_ALLOWLIST`), non-secret paths, and resolved API-key refs. A name in any mode's `protected.env` is dropped from every source.
- `probeBinary(binary, args?, { timeoutMs?, env? })` runs a version probe with that environment and returns the first stdout line.

## Normalization

- `effectsTable(entries)` returns `(name) => effects`; an unknown tool gets every effect (`ALL_TOOL_EFFECTS`), so it is gated as the riskiest.
- `mapDiff(unifiedDiff)` returns one `file` activity per file section (`source: "diff"`).
- `mapUsage({ input, output, total, cacheRead, cacheWrite, cost, currency, estimated })` returns a `Usage`, dropping invalid numbers.
- `mapPlan(entries)` returns a `plan` activity.
- `subagentScopes()` builds `subagent` started/completed activities and tracks the open ids; the run controller turns them into nested event origins.

## `agent.*` events

`EXTERNAL_ACTIVITY_EVENTS` (`agent.skill`, `agent.file`, `agent.plan`, `agent.subagent`, `agent.compaction`, `agent.notice`,
`agent.raw`) is re-exported from the kernel, not redefined. `isAgentEventName(name)` and `agentEventGuards.isSkillEvent(name)`
(one guard per kind) narrow a `package.event` name.

## The run context

`start.run` receives a `DriverRunContext`:

| Member | Notes |
| --- | --- |
| `run`, `spec`, `config`, `binary`, `descriptor` | The run's controller, the selected `ExternalAgentSpec`, the validated package config, the probed binary, and the descriptor. |
| `lease` | The profile lease (home, record, auth mode), released when the run settles. |
| `tools` | The agent's effective tool definitions (`PackageAPI.tools.list`), the list `bridgeTools` and `serveTools` resolve against. |
| `skills` | The agent's effective skills as `Pick<SkillRegistry, "get" \| "list">`, the shape `materializeSkills` takes. |
| `host` | The package's `HostPort`, so a request handler can route questions and elicitation to `host.ui`. |
| `services.consume(name)` | Other packages' services, for example the `workspace` service's `worktree.bound(sessionId)`. |

`tools`, `skills`, `host`, and `services` come from the driver package's own `PackageAPI` and are read per run, so a package loaded later is visible.

`relayCommand()` returns `[process.execPath, <the kernel's cli.js>]`, resolved from the module's own URL rather than `PATH` or `cwd`. Append `relay hook --run <dir>` or `relay mcp --run <dir>` to get the command a vendor's hook or MCP configuration runs. In the source layout, where only `cli.ts` exists, it falls back to that file and throws `driver_unavailable` unless the process is Bun.

## Callback broker and relay

`createCallbackBroker(run, { runDir, hookCodec, failClosed, timeoutMs, askSupport?, maxBodyBytes? })` starts one broker per run. It listens on a per-run Unix socket (`relay.sock`, mode `0600`) and on loopback HTTP (`127.0.0.1`, a random per-run bearer token), and writes `relay.json` (socket path, timeout, fail-closed answer) into the run directory before it returns. The token is never written to `relay.json`, events, `inspect()`, or errors; give it to the vendor through the driver's own config.

The broker routes three kinds of hook event through the codec. `hookCodec.decode(stdin)` returns `{ kind: "pre-tool", request }` (sent to `run.ask`), `{ kind: "stop" }` (sent to `run.end`), or `{ kind: "observe", activity }` (sent to `run.observe`). `hookCodec.encode(answer)` returns `{ exitCode, stdout }`, which the relay prints verbatim. An `approval_pending` deny reaches `encode` with a `message` that says approval is pending; a `non_interactive` deny says no interactive approver is available. Each callback is bounded by `timeoutMs`. Any failure (a throw from decode or encode, a timeout, a malformed answer, or a closed broker) answers the descriptor's `failClosed`. Callbacks run concurrently, with no lock.

`broker.route("mcp", handler)` registers a web handler `(Request) => Promise<Response>` for MCP; `broker.route("mcp", undefined)` removes it, which is how `serveTools.close()` unregisters. Requests arrive over HTTP at `POST /mcp` and over the socket as relayed stdio frames. With no handler, an MCP request is refused with a JSON-RPC error. The kit does not import an MCP server; `serveTools` in `@arnilo/prism-mcp-server` supplies the handler. A notification gets no reply, whatever the handler returns.

`broker.close()` stops both listeners, drops open connections, removes the socket, and refuses later callbacks. It is idempotent. The broker also closes when `run.signal` aborts. After an `approval_pending` deny, the broker refuses further callbacks because the run is suspended; call `close()` when the run settles.

`prism relay hook --run <run-dir>` reads stdin, sends it to the socket, and prints the broker's answer with its exit code. If the descriptor is missing or unreadable, the exit code is `2` with empty stdout. If the socket is unreachable, the answer is late, or the answer is malformed, the relay prints the descriptor's `failClosed` stdout and exits with its `exitCode`. `prism relay mcp --run <run-dir>` bridges stdio JSON-RPC to the broker's MCP route, one response line per reply. The relay knows no vendor dialect and loads only its own module.

## Tool bridge

`bridgeTools(run, names, { origin, tools })` exposes the named tools to a vendor. `tools` is the list of `ToolDefinition`s to resolve against; a driver passes `context.tools`. A name that is not in `tools` fails with `unknown_tool` before anything is exposed. The result carries `tools` (name, description, input schema, and effects, with unknown effects reported as every effect) and `invoke(call)`. `invoke` refuses a call whose name was not bridged, then runs `run.executeTools([call], { origin })`, so `tool.call` and `tool.execute` fire as for any tool.

`McpEndpoint` is the neutral way to hand a binary an MCP server: `{ transport: "http", url, headerEnv }`, where the binary POSTs JSON-RPC 2.0 and reads the bearer token from the named environment variable, or `{ transport: "stdio", command, args }`, where the binary spawns the command once and exchanges JSONL frames. The token is never part of the endpoint. [`serveTools`](../packages/hosts/mcp-server/README.md#serving-tools-and-permissions-to-an-external-agent) returns one, a driver maps it into its binary's own MCP configuration, and `/testing`'s `createScriptedCli` consumes it (see [testing](testing.md)).

## Conformance

`driverConformance(driver, { dialect, fixtures })`, from `@arnilo/prism/testing`, runs a driver package through the cases every driver must pass. It runs them against a scripted binary of one reference dialect: `jsonl-stream` (one process per conversation; gate calls run the driver's hook command) or `json-rpc` (a JSON-RPC app server; gate calls are `approval.request` on the client channel). See [testing](testing.md) for `createScriptedCli`. `fixtures.config(cli)` returns the driver's own config keys that point at the binary, usually `{ binary: cli.command[0], args: cli.command.slice(1) }`. A driver that gates through the relay passes the relay command to its binary as `--hook-command <JSON argv>`; a binary without that flag cannot be conformance-tested. `fixtures.mode` picks the auth mode to run under, and a key mode needs no sign-in, so conformance can run without an account.

The legs are `materialization`, `observe` (every activity kind produces its event), `gating` (an allowed call and a denied call through the relay), `fail_closed` (the broker is down, so the gate denies; command dialects only), `steer`, `abort` (the binary exits within the grace bound), `resume` (when the descriptor declares `resume`), `profile_principal`, `profile_concurrency`, `deployment`, `strict_isolation`, `credential_canary`, and `no_secret`. A failing leg throws `DriverConformanceError` with the leg's name. A leg the driver cannot run is returned as `skipped` with a reason; a leg that passed with a limit carries that limit as its reason.

The canary plants a token at each declared protected path and in each protected env variable. Where the filesystem records atime, a read of a protected path moves it. Where it does not, the protected paths are mode `0000` and a read fails with `EACCES`, which the run reports. A silent read on a filesystem with no atime is then not seen; the `no_secret` leg still catches a read whose content reaches events, the binary record, or the profile record. Mode `0000` does not stop a read by root, so run conformance as a non-root user.

## Example

`examples/external-agent.ts` is the template an adapter author copies. Its binary is the scripted CLI, so it runs offline,
and its driver names no vendor. One run covers the whole path: an account profile signed in through a `terminal` request
(the scripted host runs the login command), a replaced prompt, two bridged tools called through the broker's MCP route, a
materialized skill, thinking and text deltas, a skill activation, a nested sub-agent, a steer, a write gated through
`prism relay` with a scripted `HostUi`, a write whose relay fails closed once the broker's socket is gone, a suspension
resumed with `allow_once`, a `createSessionIndex` search, and the three policy refusals (`plan_login_not_permitted`,
`profile_principal_mismatch`, `profile_busy`). `bun examples/external-agent.ts` prints the result as JSON; the
`--conformance` flag runs `driverConformance` on the same driver for both reference dialects.

## Writing an adapter instead

`driverConformance` proves a driver package; an adapter author writes the vendor-specific mapping on top. See
[Writing an adapter](agent-adapters.md) for the `AgentAdapter` contract, the transport choice, the spec and activity
mappings, the hook codec and its fail-closed response, resume and abort, the auth policy, `extendAdapter`, and the
dated, non-normative worked mappings for the three researched binaries. The three offline reference adapters live in
`examples/adapters/`.

## Errors

`DriverError` carries `code` (`driver_unavailable`, `driver_revision_mismatch`, `driver_capability_missing`,
`driver_definition_invalid`, `jsonl_line_too_long`, `credential_required`, `plan_login_not_permitted`, `profile_principal_mismatch`, `auth_required`, `profile_busy`, `profile_invalid`, `worktree_required`, `worktree_not_git`, `unknown_skill`, `unknown_tool`, `broker_unavailable`) and the `control` involved. Its message names the rule, never a config value. A failure at
`setup` surfaces through the package loader as `setup_failed` with the driver code in the message.
