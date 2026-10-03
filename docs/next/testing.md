# Testing

> Staged for the next release. `@arnilo/prism/testing` is the package and loop conformance
> subpath. A package test needs only `@arnilo/prism` and this subpath.

## What it does

`packageConformance(definition, options?)` loads a `definePackage` definition through the real
loader twice, runs one mock session, and returns named check results instead of throwing. One run
lists every violation.

`loopConformance(strategy)` drives a `LoopStrategy` through one scripted mock scenario and reports
which catalog hooks fired.

The subpath also re-exports `createMockProvider`, `twoTurnProvider`, `textProvider`, `echoTool`,
`createScriptedHostUi`, and the `provider*` event helpers (`providerTextDelta`, `providerToolCall`,
`providerToolCallDelta`, `providerUsage`, `providerDone`, `toolCallContent`).

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
| `options.mockProvider` | `AIProvider` | Drives the mock session. Default: one text turn on the built-in mock provider. |

`loopConformance(strategy | options)`. A bare `LoopStrategy` (`{ name, run }`) is `{ loop: strategy }`.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `loop` | `LoopStrategy` | `defaultLoop` | The strategy under test. |
| `hooks` | `(hooks) => void` | none | Extra host hooks, registered after the firing probes. |
| `tools` | `readonly ToolDefinition[]` | one echo tool | Tools the scenario can call. |
| `provider` | `AIProvider` | `twoTurnProvider` (one tool call, then text) | Scripted model. `textProvider` is one text turn. |
| `input` | `string` | `"go"` | The run input. |
| `probe` | `boolean` | `true` | `false` skips the auto-registered catalog probes. |
| `emitEvents` | `readonly AgentEventType[]` | none | Extra observe events emitted through a hook during the run. |
| `store`, `limits`, `compaction`, `host`, `runOptions`, `runState`, `sessionId` | | kernel defaults | Passed through to `createAgent` / `session.run`. |

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
without that surface does.

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
  requires: { prism: "^0.12.1 || ^0.13.0-0" },
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

Per-suite subpaths (`@arnilo/prism/testing/provider-conformance` and the other conformance helpers)
stay until their owning phases consolidate them. This subpath does not replace them.

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

## Related APIs

- [Packages](packages.md): `definePackage`, `PackageAPI`, capabilities, `inspect()`.
- [Hooks](hooks.md): catalog names `loopConformance` reports in `fired`.
- [Loop](loop.md): `LoopStrategy` the harness drives.
