# Testing

> `@arnilo/prism/testing` is the package and loop conformance
> subpath. A package test needs only `@arnilo/prism` and this subpath.

## What it does

`packageConformance(definition, options?)` loads a `definePackage` definition through the real
loader twice, runs one mock session, and returns named check results instead of throwing. One run
lists every violation.

`loopConformance(strategy)` drives a `LoopStrategy` through one scripted mock scenario and reports
which catalog hooks fired.

`assertGateIntegrity({ createAgent })` runs the safety-gate invariants a loop must preserve against
the agent your factory builds: a rewritten call is re-gated, an `ask` keeps a sanitizing rewrite, a
resumed call is re-gated, and `dispose()` stops an in-flight tool. A loop that skips the tool
pipeline fails, named by probe. The tool-dispatch helpers
(`assertToolDispatchConforms`, `assertToolBlocked`, `dispatchAndCollect`) cover the blocked-reason
matrix of one `ToolRegistry`.

`storeConformance(factory, { reopen?, capabilities? })` drives a `SessionStore` through the adapter
contract as named legs: `append-and-read`, `branch-and-fork`, `package-state`, `suspended-run`,
`search`, `title`, `list-and-delete` and `restart` (`STORE_CONFORMANCE_STEPS`). A failure names its leg.

```ts
import { createMemorySessionStore } from "@arnilo/prism";
import { storeConformance } from "@arnilo/prism/testing";

await storeConformance(createMemorySessionStore);
```

`reopen` is a second factory over the same backing data: the `restart` leg re-reads every earlier leg's
writes through one fresh instance. `capabilities` defaults to the optional methods the store implements
(`listSessions`, `deleteSession`, `searchSessions`); a store that lacks one answers `agent.sessions` with
`UnsupportedStoreCapabilityError`, which the leg asserts instead of skipping.

`mockProvider(script, { id? })` is a package that registers a scripted provider (default id `mock`). Each
`generate` call plays the next step of `script`, an array of event arrays, and the last step repeats once
the script is exhausted, so a one-step script answers every turn alike:

```ts
import { createAgent } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";

const agent = await createAgent({ model: "mock/demo", packages: [mockProvider([turnA, turnB])] });
```

The subpath also re-exports `createMockProvider` (the raw `ModelProvider`, for provider unit tests), `twoTurnProvider`, `textProvider`, `echoTool`,
`createScriptedHostUi`, `assertPersistenceSearchQueryParity` (the SQL stores' filter-only search parity check,
against a `SessionStore & ProductionPersistenceStore`), and the `provider*` event helpers (`providerTextDelta`,
`providerToolCall`, `providerToolCallDelta`, `providerUsage`, `providerDone`, `toolCallContent`). For full provider
stream verification, multi-turn wire recording replay, and safety contract assertions, use `providerConformance` from
`@arnilo/prism/provider-kit` (see [Provider kit](provider-kit.md#wire-replay-and-stream-conformance)).

`runProviderLiveScenarios({ provider, routes, secretEnv?, secrets?, scenarios? })` defines the shared tier-1 live test suite for routed providers (OpenAI Chat and Anthropic Messages routes). Optional `scenarios` selects `text`, `tool-loop`, `structured-output`, `abort`, `error`, or `cache` (also supported by `executeProviderLiveScenarios`); absent runs all. This keeps separately budgeted paid cache probes from sending unrelated calls. Chat cache probes reuse one session id and place explicit cache boundaries on the stable first-user prefix when the model declares `cache_control`. Route configs also carry two hooks for services whose wire differs from the shared assumptions: `structuredPrompt` replaces the shared schema-less prompt for the structured-output scenario, and `errorModel` names an unknown model so the error scenario provokes a real 404 instead of sending an empty `messages` array. Use them instead of skipping a scenario. Scenarios cover text streaming, two-turn tool loop with thinking replay (the second request must be accepted, verifying `reasoning_content` or signature replay), structured output (or documented rejection), abort before the first request, error response leaking no secret, and warm-prefix cache probe (second identical-prefix request reports `cacheReadTokens > 0`, with `inputTokens >= cacheReadTokens`).

`runSystemOneLiveScenarios({ provider, model, secretEnv?, baseUrl?, reachabilityCheck? })` defines the shared tier-1 live test suite for System One decision models, verifying schema-valid JSON decisions, rejection of tool calls before fetch, abort observation, and error responses leaking no secret.

Both live runners automatically skip with a clean reason when credentials or opt-in flags are absent, satisfying the live-testing contract in [Live testing](live-testing.md).

### Prefix stability (`@arnilo/prism/testing/prefix-stability-conformance`)

`runPrefixStabilityConformance({ host, skills, ... })` drives a real session through staggered skill loads against a fixture provider and asserts that each provider request keeps a byte-identical leading prefix with its predecessor. `turns` (default `2`, two requests each) lengthens the tool loop: `turns: 5` is ten requests, the turns after the two skill loads calling a runner-owned no-op tool.

**Wire mode.** Pass `encode: (request) => Promise<JsonObject>` to also check what the upstream cache actually keys on. Every captured request goes through your encoder (a routed provider's `encode` method; swap the real `ModelConfig` into `request.model`, since the fixture's is a stand-in), and each consecutive pair must keep:

- `tools` equal;
- `system` equal;
- every message below the earlier request's last index byte-equal, where only `cache_control` markers may move.

Comparing the whole body as a byte prefix is not used: `tools` follows `messages` in an OpenAI Chat body, so a growing message list always shifts later bytes. A failure names the segment, the message index and the first differing byte offset. `segments: (body) => { tools?, system?, messages }` replaces the default splitter (`defaultWireSegments`: an Anthropic Messages body when it has a top-level `system`, otherwise OpenAI Chat with the leading `system` / `developer` messages as the system segment); `anthropicSegments`, `openAIChatSegments` and `assertWireSegmentsStable(previous, next)` are exported for custom bodies such as OpenAI Responses. The result's `wirePairs` counts the pairs that passed (`0` without `encode`).

```ts
const provider = createHyperProvider({ apiKey: async () => "unused" });
await runPrefixStabilityConformance({
  host, skills: [alpha, beta], reasoningFixture: true, turns: 5,
  encode: (request) => provider.encode({ ...request, model: hyperModel }),
});
```

## When to use it

Use `packageConformance` as the Done check for a package. Use `loopConformance` when a custom loop
must prove catalog hooks still fire, or when a test needs the scripted mock scenario the old
in-repo harness drove.

## Inputs / request

`packageConformance(input, options?)`:

| Field | Type | Description |
| --- | --- | --- |
| `input` | `PackageInput` | A definition or an instance. A definition is called with `options.config`. |
| `options.config` | object | Instance config, passed as the factory argument. |
| `options.mockProvider` | `ModelProvider` | Drives the mock session. Default: one text turn on the built-in mock provider. |

`loopConformance(strategy | options)`. A bare `LoopStrategy` (`{ name, run }`) is `{ loop: strategy }`.
| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `loop` | `LoopStrategy` | `defaultLoop` | The strategy under test. |
| `hooks` | `(hooks) => void` | none | Extra host hooks, registered after the firing probes. |
| `tools` | `readonly ToolDefinition[]` | one echo tool | Tools the scenario can call. |
| `provider` | `ModelProvider` | `twoTurnProvider` (one tool call, then text) | Scripted model. `textProvider` is one text turn. |
| `input` | `string` | `"go"` | The run input. |
| `probe` | `boolean` | `true` | `false` skips the auto-registered catalog probes. |
| `emitEvents` | `readonly AgentEventType[]` | none | Extra observe events emitted through a hook during the run. |
| `store`, `limits`, `compaction`, `host`, `runOptions`, `sessionId` | | kernel defaults | Passed through to `createAgent` / `session.run`. |

`storeConformance(factory, options?)`:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `factory` | `() => SessionStore \| Promise<SessionStore>` | — | Builds the store under test. |
| `options.reopen` | the same factory shape | none | A second instance over the same backing data; the `restart` leg re-reads every earlier write through it. |
| `options.capabilities` | `readonly SessionStoreCapability[]` | the methods the store implements | Which optional `agent.sessions` legs the store claims. A claimed capability the store does not implement fails; an unclaimed one must answer `UnsupportedStoreCapabilityError`. |
| `options.sessionId`, `options.otherSessionId` | `string` | `"conformance"`, `"<sessionId>-other"` | Fixture session ids. |
| `options.exerciseConcurrentParentAppend` | `boolean` | `false` | Appends concurrent children of one parent (fork allowed rather than a tip CAS). |

## Outputs / response / events

`PackageConformanceResult` is `{ ok, checks }`. `ok` is true only when every check passed. Each
check is `{ name, ok, message? }`. `message` names the rule and never includes a secret value.

| Check | Fails when |
| --- | --- |
| `setup_dispose_idempotent` | Load or dispose throws, or the two `inspect()` snapshots differ. Status-note timestamps are ignored. |
| `no_leaks_after_dispose` | After dispose, `inspect()` still lists a tool, skill, command, hook, or slot owned by the package. |
| `config_schema_valid` | The schema uses an unsupported keyword, or the declared defaults do not validate. A `required` field needs a default, including an `env:` ref on a secret field. |
| `capabilities_cover_usage` | A gated member was called without that capability, or the kernel threw `capability_missing` during load or the mock session. |
| `no_secret_in_inspect` | An env value behind an `x-prism-secret` `env:` ref appears in `JSON.stringify(inspect())`. |
| `unavailable_fails_closed` | Setup, the mock session, or a registered command threw an untyped error against a host that answers `unavailable` to everything. A named error (`code` present) is a package failing closed and passes. |

### `createScriptedHostUi`

`createScriptedHostUi(script?)` returns `{ ui, requests, requestsOf(kind) }`. `ui` is a real
`HostUi` to hand `AgentConfig.host`. `script` is an answer per request kind (or a function of the
request); anything it does not name answers `{ status: "unavailable" }`, which is what a host
without that surface does. A `terminal` script is `{ exitCode: 0 }`, `{ status: "dismissed" }`, or a
function of the request; the request is recorded in `requestsOf("terminal")`.

```ts
const scripted = createScriptedHostUi({ confirm: true, secret: "sk-…" });
const agent = await createAgent({ host: { ui: scripted.ui } });
// …run…
assert.deepEqual(scripted.requestsOf("confirm")[0]?.title, "Approve tool \"write\"");
```

See [host](host.md) for the request kinds and the secret rules.

`LoopConformanceResult` is `{ result?, error?, events, fired, agent, session }`. `fired` is the set
of catalog hook names whose handlers ran. `result` is absent when the run threw (a limit death
rejects). The session is closed but readable.

### `createScriptedCli`

`createScriptedCli({ dialect, script })` writes a Bun script into a temp directory and returns `{ command, env, record(), dispose() }`. `command` starts the binary (`[bun, script]`); a driver appends its own flags. `record()` returns what the binary wrote about itself: its argv, env names (never values), each input it read, each gate result, and its exit or signal. `dispose()` removes the directory.

`script` is a list of steps, one per turn: `{ out: frame }` writes a frame, `{ hook: { tool, id, breakBroker? } }` makes a gate call, `{ mcp: { method, params? } }` makes an MCP client call, and `{ wait: ms }` pauses. The binary appends the end-of-turn marker itself. A gate call on `jsonl-stream` runs the hook command the driver passes as `--hook-command <json argv>`, with the call as JSON on stdin, and honors its exit code: `0` lets the call run, anything else blocks it. On `json-rpc`, the binary sends `approval.request` and waits for the client's answer; a JSON-RPC error answer is a deny. `breakBroker` removes the run's relay socket before the hook, so the relay fails closed.

An `mcp` step makes the binary an MCP client. Pass `--mcp-endpoint <json McpEndpoint>` (see [drivers](drivers.md#tool-bridge)): over `http` the binary POSTs JSON-RPC 2.0 to `url` with `Authorization: Bearer $<headerEnv>` and the streamable-HTTP accept header, unwrapping an SSE reply; over `stdio` it spawns `command args` once per run and exchanges JSONL frames. It performs the `initialize` exchange (and the `notifications/initialized` notice) once, before the first `mcp` step, and records `{ event: "mcp", method, result }` or `{ event: "mcp", method, error }`. With no `--mcp-endpoint` while the script has an `mcp` step, the binary records `{ event: "mcp", method, error: "no endpoint" }` and exits non-zero. The record never holds the token or the environment.

The two reference dialects are `"jsonl-stream"` and `"json-rpc"`. `defineScriptedDialect({ name, encodeInput, decodeInput, frames, parseFrame, hook })` describes another binary's frames. Its functions are serialized into the binary, so each must be a self-contained function expression with no closure over module state; method shorthand throws a `TypeError` at definition time.

```ts
const cli = createScriptedCli({
  dialect: "jsonl-stream",
  script: [{ out: { kind: "message.delta", content: { type: "text", text: "hi" } } }, { hook: { tool: "write_file", id: "w1" } }],
});
// Pass cli.command to the driver, then read cli.record() after the run.
```

### `driverConformance`

`driverConformance(driver, { dialect, fixtures })` runs a driver package through the conformance legs listed in [drivers](drivers.md#conformance). It throws `DriverConformanceError` on the first failing leg, and returns `{ legs }` otherwise, with each leg marked `passed` or `skipped`.

### `assertGateIntegrity`

`assertGateIntegrity({ createAgent })` asserts the four safety-gate invariants on the agent
`createAgent` returns, so a custom loop or host proves it keeps them instead of re-deriving the proof.
It imports the subpath, not the `@arnilo/prism/testing` barrel:

```ts
import { createAgent } from "@arnilo/prism";
import { assertGateIntegrity } from "@arnilo/prism/testing/tool-conformance";

await assertGateIntegrity({
  createAgent: (config) => createAgent({ ...config, slots: { ...config.slots, loop: myLoop } }),
});
```

| Probe | What it asserts |
| --- | --- |
| `rewrite_is_regated` | A handler rewrites the arguments and a second handler denies the rewritten form: nothing executes and the denial reaches the transcript. |
| `ask_keeps_rewrite` | An `ask` and a sanitizing rewrite in the same round: the sanitized arguments are what executes. |
| `resume_is_regated` | An asked call resumed with `modifiedArguments` the gate denies never executes. A loop that cannot suspend denies the ask instead, which is the same outcome. |
| `dispose_is_fail_closed` | `dispose()` from inside `tool.call`: no tool runs and the run does not report success. |

Each probe asserts the outcome the gate must produce as well as the absence of an un-gated execution,
so a loop that skips `executeTools` fails rather than passing vacuously. It throws `Error` on the
first violation with the probe name (`gate integrity: <probe>: <detail>`), and returns normally when
all four hold. The mock provider is the only dependency: no network, no test runner, and the whole
check finishes in tens of milliseconds.

An external-agent driver loop (`usesModel: false`, tool calls relayed through `run.ask`) is not a
fit for these probes; its gate integrity is what `driverConformance`'s `gating`, `fail_closed`, and
`resume` legs assert.

## Request/response example

```json
{
  "ok": false,
  "checks": [
    {
      "name": "capabilities_cover_usage",
      "ok": false,
      "message": "used slot:loop without declaring the capability"
    }
  ]
}
```

## Implementation example

```ts
import { definePackage } from "@arnilo/prism";
import { loopConformance, packageConformance } from "@arnilo/prism/testing";

const audit = definePackage({
  name: "@acme/audit",
  version: "1.0.0",
  requires: { api: 1 },
  setup(prism) {
    prism.hooks.on("tool.result", () => {});
  },
});

const report = await packageConformance(audit);
if (!report.ok) {
  throw new Error(report.checks.filter((check) => !check.ok).map((check) => check.message).join("\n"));
}

const { fired } = await loopConformance({
  name: "once",
  async run(controller) {
    await controller.turn();
    await controller.end();
  },
});
```

## Extension and configuration notes

The capability check wraps the real `PackageAPI` in a recording proxy and forwards every call, so
the kernel's own `capability_missing` still fires. It does not trust the declared list. Gated
members it records:

| Member | Capability |
| --- | --- |
| `models.client` | `models` |
| `credentials.resolve` | `credentials` |
| `state.session` | `session-state` |
| `host.ui` | `host-ui` |
| `slots.<slot>.provide` | `slot:<slot>` |

Per-suite subpaths (the conformance helpers other than `@arnilo/prism/provider-kit`, which holds provider conformance)
stay until their owning phases consolidate them. This subpath does not replace them, and the store conformance
moved here from the retired `./testing/session-store-conformance` subpath.

Checkpoint and lease conformance moved to `@arnilo/prism-extensions/workflows/testing` with the contracts themselves
`checkpointConformance(factory)` covers create/CAS/create-only/concurrent-writer/
fencing/ownership/list/delete, and `leaseConformance(factory, { ttlMs? })` covers acquire, exclusive hold,
renew, release, foreign-owner rejection, and a fence that survives release and expiry. The kernel
`assertStateConcurrencyConforms` keeps the session, event, idempotency, and router-budget probes.

## Security and performance notes

For `no_secret_in_inspect`, each `x-prism-secret` field whose merged config is an `env:` ref gets a
sentinel env value when that variable is unset. The sentinel must not appear in `inspect()`.
`keyring:` refs are not set. A package that copies `process.env` into a status note fails. A
credential resolved through `credentials.resolve` is already in the agent's redactor, so that path
is masked and is not the leak this check is looking for.

`no_leaks_after_dispose` waits one macrotask after dispose, so a `setTimeout` registration
scheduled from `onDispose` is visible. A registration made inside `onDispose` itself is still
removed: teardown runs disposers, then drops the owner's hooks, slots, and contributions. Services
have no `inspect()` field. The loader deletes them on dispose, and this suite cannot see a service
leak.

A package with no I/O finishes a conformance run in under 1 second on the mock provider. The suite
imports no package.

## Coverage gate

`bun run test:coverage` measures the kernel suite once and every workspace suite once, then enforces a
per-package line floor. The workspace list comes from the root `package.json` `workspaces` globs
expanded by `scripts/package-truth.mjs` `expandWorkspaceDirs`, so grouped packages
(`packages/<group>/<name>`) and `apps/*` are measured; a workspace with tests but no row in
`scripts/coverage-thresholds.json` fails the gate. Each gated workspace carries a package-local
`bunfig.toml` (`coveragePathIgnorePatterns = ["../**"]`) so its row counts only its own sources, and
the root `bunfig.toml` scopes the kernel row the same way (no `packages/**`, `apps/**`, `scripts/**`,
or `examples/**` source counts toward it — the `apps/` exclusion keeps the private reference host out
of the kernel denominator, since its own tests run in the workspace stage).
Floors are evidence-based: `min(two back-to-back runs) - 3pp` on lines. Packages whose durable legs
need `PRISM_TEST_POSTGRES_URL` or whose OS-capability legs need a network namespace carry a
`protectedException` and are reported separately instead of gated. `scripts/coverage-summary.json`
holds the machine-readable result.

## Related APIs

- [Packages](packages.md): `definePackage`, `PackageAPI`, capabilities, `inspect()`.
- [Slots](slots.md): `inspect().store`, the derived store capabilities, and what `agent.sessions` lights up.
- [Hooks](hooks.md): catalog names `loopConformance` reports in `fired`.
- [Loop](loop.md): `LoopStrategy` the harness drives, and the safety-gate rule from
  [When to use it](loop.md#when-to-use-it) that `assertGateIntegrity` enforces.
- [Hooks](hooks.md#hook-catalog): `tool.call` precedence the probes rely on.

## Scripted binaries and fixture recording

`createScriptedCli({ dialect, script, home? })` writes an offline binary without starting it.
Pass its `command` and `env` through your driver fixture. `home` sets `cli.env.HOME`; the
caller owns that directory and its cleanup. `dispose()` removes the generated binary and
record, so read `cli.record()` first. A `{ raw: string }` script step writes that line without
calling the dialect's `frames` encoder; use it to replay recorded output.

A custom `ScriptedDialect` can supply a self-contained function expression:

```ts
locate: ({ argv, env, cwd, readFile }) => {
  const path = argv[argv.indexOf("--settings") + 1];
  const text = path ? readFile(path) : undefined;
  const settings = text ? JSON.parse(text) : {};
  return { hookCommand: settings.hookCommand, endpoint: settings.endpoint, loaded: text ? [path] : [] };
}
```

`locate` is serialized into the binary and runs once at startup. It replaces both reference
flags (`--hook-command`, `--mcp-endpoint`); without it, those flags keep their existing behavior.
`readFile` returns UTF-8 text or `undefined` on a read failure. `loaded` contains paths of files
actually loaded, recorded as `{ event: "loaded", items }`. Report paths rather than file contents.
Functions run outside the test's scope and cannot depend on its imports or closures.

When `locate` exists, `driverConformance` also runs strict isolation against a fake host home
containing `.scripted/hook.json`, `.scripted/skills/planted/SKILL.md`, and `.scripted/mcp.json`.
The binary must report none of those files as loaded. For another layout, provide
`fixtures.home: { hook: { path, content }, skill: { path, content }, mcp: { path, content } }`;
paths must stay inside the fake home and `loaded` must report them as relative or absolute paths.
The harness removes the planted home after the leg. Workspace-file drivers receive an isolated
Git workspace through the `workspace` service. Existing `assertIsolation` checks still run.

```ts
import { recordFixtures } from "@arnilo/prism/testing";

const command = recordFixtures.command(["my-agent", "--stream"], "/tmp/session.jsonl");
// Use command as the adapter's binary for one run, then stop it before finishing:
await recordFixtures.finish("/tmp/session.jsonl", "fixtures/pinned.json", {
  secrets: [apiKey],
  redact: line => line.replaceAll("private-project", "example-project"),
});
const fixture = recordFixtures.load("fixtures/pinned.json");
```

The tee forwards stdin/stdout bytes, stderr, and exit codes, and appends line records with
`dir: "in" | "out"`. It never records the environment or stderr. **The raw log is sensitive**;
store it privately and delete it after finishing. New logs and fixtures use mode `0600`.
`finish` applies the redactor, masks bearer-token shapes and supplied secrets with `[redacted]`,
and refuses to write if a supplied secret survives (`fixture_secret`). It writes
`{ version: 1, turns: [{ input: string[], output: string[] }] }`, starting a new turn for each
input line. Startup output is preserved in a leading turn with empty input. This is wire-line
segmentation: RPC replies and notifications on stdin also start turns. `load` validates the
shape and rejects unknown versions. Redaction cannot identify every private value automatically;
supply all known secrets and review fixtures before committing them.

### Process adapter conformance

`adapterConformance` lives in `@arnilo/prism-hosts/driver-process/testing`; see the
[process driver package](../packages/hosts/driver-process/README.md#testing-your-adapter).
The kernel's `driverConformance` accepts `fixtures.scriptFor(activity)` to map
neutral output activities to raw scripted steps. Command-hook dialects may
provide a self-contained `hook.allowed({ exitCode, stdout })` function when the
binary honors a printed deny response with exit zero. The default remains
`exitCode === 0`.
