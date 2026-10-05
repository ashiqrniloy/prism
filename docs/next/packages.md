# Packages

> Staged for the next release. This page covers the whole package contract: the definition, the
> loader and lifecycle, `requires`, capabilities, configuration, contributions (tools, skills,
> providers, commands, services), models and credentials, session state and background work,
> `disable`, and `agent.inspect()`. A runnable story is in `examples/define-package.ts`.

## Definition and lifecycle

### What it does

A package is a unit of capability: hooks, slot implementations, and services, registered from
`setup`. `definePackage` returns a **callable definition**: `coding({ root })` returns a
`PackageInstance`, and listing the bare definition uses the schema defaults. A listed package is an
active package; the host wires nothing else.

```ts
export default definePackage({
  name: "@acme/plan-execute-verify",
  version: "1.0.0",
  requires: { prism: "^0.12.1 || ^0.13.0-0" },
  capabilities: ["slot:loop"],
  setup(prism) {
    prism.slots.loop.provide(planExecuteVerify);
  },
});

const agent = await createAgent({ model, packages: [pev, audit({ level: "warn" })] });
```

The definition is validated when `definePackage` runs: `name` must be an npm name (`host` and
`kernel` are reserved for the kernel's own owners), `version` must be semver, `requires` ranges must
parse, every capability must be known, and `config` must use the supported schema subset. A failure
throws `PackageLoadError` `definition_invalid` (or `config_schema_unsupported`).

### Inputs / request

`AgentConfig` gains two fields:

| Field | Type | Description |
| --- | --- | --- |
| `packages` | `readonly PackageInput[]` | Definitions or instances, in load order. |
| `packageConfig` | `Record<string, object>` | Config per package name, layered over instance config and defaults. A name that is not listed fails `config_unknown_key`. |

`def(config, { optional: true })` marks an instance optional: a `setup` failure skips it with a
status note instead of failing the load. `requires` is:

| Field | Meaning |
| --- | --- |
| `prism` | Semver range the kernel version must satisfy. Required. |
| `packages` | `{ name: range }`. Those packages must be loaded and are set up first. |
| `services` | Service names some loaded package must `provide` during its `setup`. |

Ranges support `^`, `~`, exact, `>=`, `>`, `<=`, `<`, space-joined comparators (AND), `||`, and
`*`, with the node-semver prerelease rule (`^0.13.0-0` admits `0.13.0-rc.1`; `^0.12.1` does not).
Hyphen ranges, `x`-ranges, bare partials (`1.2`), and dist-tags are rejected. The kernel is `0.12.1`
until the 0.13.0 release, so an in-tree package declares a range that admits it, for example
`^0.12.1 || ^0.13.0-0`.

### Instance provenance

`PackageInstance.source` is set only by `loadManifest`: `{ kind: "manifest", scope, assigns? }`. `assigns`
lists the slots the manifest gives this package. They merge under `AgentConfig.slots`, which wins per slot,
so `agent.config.slots` and `inspect().slots` show the merged assignments. `PackageInstanceOptions` has no
`source`, so a package cannot claim to come from a manifest.

### Lifecycle

`createAgent` loads packages in this order, and fails closed at any step:

1. Resolve inputs. A name listed twice is `duplicate_package`.
2. Merge and validate config (see Configuration).
3. Order packages topologically by `requires.packages`, keeping input order otherwise. A cycle is
   `dependency_cycle`, and the message names it.
4. Check `requires`: the kernel range (`kernel_range`) and required packages and their versions
   (`missing_package`).
5. Run each `setup`, in order. A throw is `setup_failed`, naming the package.
6. Run `AgentConfig.hooks` as the inline package `host`, after every listed package.
7. Check required services (`missing_service`). Services are provided during `setup`, so this runs
   after every `setup`.
8. Resolve slots, so two claimants without an assignment fail the load with `SlotConflictError`.

A failure after any `setup` has begun **unwinds**: every package already started is disposed in
reverse order, its `onDispose` callbacks run, and its hook, slot, and service registrations are
removed. No partial contribution survives. An `optional` instance that throws in `setup` is unwound
alone and recorded as the status note `skipped: <message>`. `optional` covers a `setup` throw only: a
failed `requires` check stays fatal.

`agent.dispose()` disposes packages in reverse load order (the `host` hooks first). A throwing
`onDispose` callback is reported as a `hook.error` and does not stop the rest. A second call is a
no-op. Every `createAgent` call loads its packages again, and a `PackageInstance` is reusable across
agents, so an agent re-created from `{ ...agent.config }` reloads independently.

### `PackageAPI`

| Member | Notes |
| --- | --- |
| `name`, `config` | `config` is validated, deeply frozen, and private to the package. |
| `hooks` | A `HookRegistrar` bound to the package name. Ids are `<package>:<hook>[#id]`. |
| `slots.<slot>.provide(impl)` | Claims `loop`, `compaction`, `store`, or `credentials`. Needs `slot:<slot>`. `.default` is the kernel default. |
| `tools.register(tool, { when? })` | Adds a tool. A name taken by another package, `AgentConfig.tools`, or the kernel names `load_skill` / `search_tools` is `tool_conflict`. |
| `skills.register(skill)` / `skills.addDir(path)` | Adds a skill (`skill_conflict` on a taken name). `addDir` records the path and the loader reads `<dir>/<name>/SKILL.md` after `setup` returns, so a read failure fails that package's setup. |
| `providers.register(provider)` | Adds a `ModelProvider`, selected by `AgentConfig.model.provider`. This is the only way to give an agent a provider. A duplicate id is `provider_conflict`. |
| `commands.register(command)` | Adds a `PackageCommand`. A duplicate name is `command_conflict`. |
| `models.client(ref?)` | Needs `models`. A thin client over the agent's provider resolution: `generate(request)` streams one provider turn. `ref` defaults to `AgentConfig.model`. |
| `credentials.resolve(ref)` | Needs `credentials`. Resolves `env:`/`keyring:` refs through the `credentials` slot and returns a `Secret`. The value is added to the agent's secret set. |
| `state.session(key, initial)` / `state.agent(key, initial)` | Session state persisted as `package_state` entries (needs `session-state`), and process memory. See "Session state and background work". |
| `services.provide / consume / require` | A duplicate is `service_conflict`. `consume` returns `undefined` when absent, and a later package's service is visible at call time. `require` throws `missing_service`. |
| `host.ui.request(...)` | Needs `host-ui`. Answers `unavailable` with no UI attached. `package` is stamped by the kernel. |
| `events.emit(name, data)` | Emits a `package.event` with `package` set by the kernel. `data` must be JSON and is redacted. |
| `status.note(level, message)` | Recorded for `inspect()`, redacted. A package that cannot operate registers nothing and notes why. |
| `log` | The host's `HostPort.log`, with every call redacted and stamped with the package name. A no-op without one. |
| `onDispose(fn)` | Runs on dispose or unwind, in reverse order of registration. |

### Session context

Hook handlers receive `context.session`, a `SessionContext`: `{ id, metadata?, model, background(name, task) }`.
The kernel binds one view **per owner**, so `background` is checked against the calling package's
capabilities: a package without `"background"` gets `capability_missing`, while a package that
declares it does not. The `host` and `kernel` owners are unrestricted. Tool contexts (`context.session`),
`when` predicates, and command contexts carry the same view, bound to the owning package.

### Session state and background work

**Session state.** `prism.state.session(key, initial)` returns a `SessionState<T>` for one package
and key. It needs the `session-state` capability. `get(session)` is synchronous and returns the latest
value on the session's branch, or `initial`; `set(session, value)` is async, appends one
`package_state` entry on that branch, and then makes the value current.

```ts
const om = prism.state.session("om", { enabled: false });
prism.commands.register({
  name: "om",
  description: "Toggle observational memory",
  run: async (_args, { session }) => om.set(session!, { enabled: !om.get(session!).enabled }),
});
```

- **Restore.** A session reads its branch once (before its first run, command, or `close()`) and
  keeps the latest value per `(package, key)`. A reopened session therefore sees what the session had
  when it stopped, a `fork()` carries the value on its branch, and `clone()` copies the entries. After
  `checkout(leafId)` the session re-reads the new branch. Each branch sees its own value.
- **Before the branch is read** a synchronous `get` throws `state_not_ready` instead of returning
  `initial`, so a package never acts on a silently wrong value. Read state from a hook, tool, or
  command: the session has read its branch by then.
- **JSON only, bounded.** A value that is not JSON (a function, class instance, cycle, or non-finite
  number) throws `state_not_json`, and a value over 64 KiB throws `state_too_large`. Values are
  frozen: replace one with `set`, do not mutate it.
- **Redaction.** The agent's redactor and every resolved secret are applied *before* the value is
  persisted, including a `set` between runs, so the stored value is the redacted one. Keep secrets as
  refs; do not put them in state.
- **Cost.** Each `set` is one store append, and every entry counts toward compaction thresholds, so
  heavy state writes pull compaction earlier. Write on change, not per event. `package_state` entries
  never enter the model's message view. A package that never calls `set` adds no writes, and a
  session no package or `session.opened` hook cares about reads nothing extra.
- **Ordering.** The session serializes its appends, so a `set` from a hook or background task that
  overlaps a run's own append is placed after it and nothing is orphaned.

`prism.state.agent(key, initial)` is process memory for the agent's lifetime (`get()` / `set(value)`),
and it resets to `initial` when the package is disposed. Declaring a key twice in one package throws.

**Background tasks.** `session.background(name, task)` (needs the `background` capability) runs
`task(signal)` and reports it as `background.started`, then `background.completed` or
`background.failed`. `session.close()` waits for tracked tasks up to `limits.backgroundSettleMs`
(default 5,000 ms; `0` aborts at once), then aborts the rest through their `signal`, reports each
`background.failed` with reason `aborted`, and returns. A task that ignores its signal cannot hold
`close()`. A closing session takes no new tasks. Task errors are redacted. `backgroundSettleMs` is
agent-wide: a per-run value is ignored.

When a session closes, the hooks it registered on the shared bus (its guardrail packs) are removed.

### Tools, skills, providers, and commands

Packages never receive a registry, only the owner-bound registrars above. The agent merges what they
register with the host's own `AgentConfig.tools` and `skills` and reads that merged view everywhere
(dispatch, approval, the run bundle, and the durable fingerprint), so `agent.config` stays exactly
what the host passed. A host-supplied registry is never mutated. Every `createAgent` call loads its
packages again, so a `PackageInstance` is reusable across agents and a config cloned from
`agent.config` does not collide with itself.

- **Tool visibility.** `when(session)` runs once per turn for each tool that has one, at the same
  point `RunOptions.tools` narrows the turn, so the default loop and a custom loop behave alike. A
  hidden tool is not advertised and is not callable unless `allowHiddenToolCalls` is set. A throwing
  or falsy predicate hides the tool. Predicates must be synchronous and cheap. A package tool's
  `context.session` is the view for its own package, so `background` is capability-checked there too.
- **Skills.** A host that passes an array of skills keeps an array: package skills activate with
  them. A host that passes a `SkillRegistry` keeps a registry, and skills activate on demand as before.
- **Commands.** `agent.commands.list()` returns `{ name, description, package }`.
  `agent.commands.run(name, args, { session })` validates `args` against the command's `args` schema
  (no schema means no arguments), then calls `run(args, { session, host, agent })`. `session` is the
  `SessionContext` for the command's own package, and `host` has the same `host-ui` check as
  `PackageAPI.host`, with `package` and `sessionId` stamped by the kernel. `PackageCommand` is a
  new type: the 0.12 `CommandDefinition` is unchanged until its users move onto packages.
- **Credentials.** `credentials.resolve` returns the value to the package and adds it to the agent's
  secret set, so events, status notes, logs, hook errors, and load errors redact it from then on.

### `disable`

`createAgent({ disable: { tools, hooks, commands, skills } })` removes contributions by id after every
package has run `setup`, so no package can re-add one. Tool and skill ids are names (the host's own
count as well as packages'), command ids are names, and hook ids are registration ids
(`@acme/audit:tool.completed`, or `@acme/audit:tool.call#gate`). A disabled hook is not registered, a
disabled tool is neither advertised nor callable, and an id that nothing carries fails the load with
`unknown_disable_id`, so a typo cannot leave a contribution active.

### Inspecting an agent

`agent.inspect()` returns a snapshot of what loaded, built from the loader's records with no I/O.

```ts
const view = agent.inspect();
view.hooks["tool.call"]; // [{ id: "@acme/audit:tool.call", owner: "@acme/audit", priority: 0 }, { id: "host:tool.call", … }]
view.slots.loop;         // "kernel" | a package name | "host"
```

| Field | Holds |
| --- | --- |
| `packages` | `{ name, version, capabilities, optional, status, source, configSources, config }` in load order. `source` is `code` (the host listed it), `manifest:user`, or `manifest:project` (`loadManifest` built it). `status` is `loaded`, or `skipped` for an `optional` instance whose `setup` threw (it holds no contribution). `configSources` maps each key to `default`, `manifest`, `code`, or `host`. |
| `tools`, `skills`, `commands` | `{ name, package }`, where `package` is `host` for the host's own. A disabled host tool or skill is not listed. |
| `hooks` | Per hook name, registrations in execution order (`{ id, owner, priority }`). A session's own guardrail-pack hooks are not listed. |
| `slots` | Per slot, its owner: `kernel` (the default), a package name, or `host`. |
| `disabled` | The ids named in `AgentConfig.disable`. Every one took effect, or the load would have failed. |
| `statusNotes` | `{ package, level, message, at }`, including `skipped: …` notes. |

The result is a deep-frozen plain JSON object: it round-trips through `JSON.stringify`, and a later
change does not alter an earlier snapshot. A secret config field shows its `env:` / `keyring:` ref,
never a resolved value, and the agent's redactor (plus every value `credentials.resolve` returned)
masks anything else, such as a secret that sits in a non-secret field or a status note.

### Capabilities

Declared capabilities are enforced on the SDK-mediated members; they document intent and gate SDK
access. They are not a process sandbox. A call without the capability throws `PackageLoadError`
`capability_missing`, naming the member and the capability.

| Capability | Gates |
| --- | --- |
| `slot:loop`, `slot:compaction`, `slot:store`, `slot:credentials` | `slots.<slot>.provide` |
| `host-ui` | `host.ui.request` |
| `background` | `SessionContext.background` |
| `models` | `models.client` |
| `credentials` | `credentials.resolve` |
| `session-state` | `state.session` |

### Errors

Besides the configuration codes below, `PackageLoadError.code` is one of `definition_invalid`,
`kernel_range`, `missing_package`, `missing_service`, `service_conflict`, `dependency_cycle`,
`duplicate_package`, `capability_missing`, `setup_failed`, `tool_conflict`, `skill_conflict`,
`provider_conflict`, `command_conflict`, `unknown_command`, `command_args_invalid`,
`unknown_disable_id`, `state_not_json`, `state_too_large`, and `state_not_ready`. A slot conflict stays
`SlotConflictError`, and a slot assigned to a package that did not provide it is `UnknownSlotOwnerError`. `setup_failed` carries a redacted message and does not keep the raw
third-party `cause`.

## Configuration

### What it does

A package declares a `config` JSON Schema. Before `setup` runs, the kernel resolves that package's
config from three layers, validates the result against the schema, and applies schema defaults. The
package gets one validated, JSON-only object. It never sees another package's config.

Layers, lowest precedence first:

1. schema `default` values
2. the manifest layer: the config of an instance `@arnilo/prism/manifest`'s `loadManifest` built
3. the code layer: the config a listed instance carries (`coding({ root })`)
4. `AgentConfig.packageConfig[<package name>]`

An instance has either the manifest layer or the code layer, never both. See [manifest.md](manifest.md).

Objects deep-merge and arrays and scalars replace. For each top-level key the kernel records where
the winning value came from (`default`, `manifest`, `code`, or `host`), so `agent.inspect()` can show config
sources without showing values.

A package with no `config` schema accepts no config: any supplied key fails closed.

### Inputs / request

The schema is a small, explicit subset of JSON Schema. The kernel has no runtime dependency and
rejects every keyword it does not implement, so a schema can never pass a check it did not get.

| Keyword | Notes |
| --- | --- |
| `type` | One of `string`, `number`, `integer`, `boolean`, `object`, `array`, `null`. A single value, not an array. |
| `properties`, `required` | Declared keys. `required` is checked after defaults. |
| `additionalProperties` | `false` (the default), `true`, or a schema for undeclared keys. |
| `items` | A single schema, applied to every element. `minItems` and `maxItems` bound the length. |
| `enum`, `const` | Compared by JSON equality. |
| `default` | Applied when the key is absent. It must itself satisfy the schema. |
| `minimum`, `maximum` | Inclusive, for numbers. |
| `minLength`, `maxLength` | For strings. |
| `pattern` | At most 256 characters, matched with the `u` flag. A string over 4,096 characters is refused without running the pattern, so a schema cannot become a ReDoS vector. |
| `oneOf`, `anyOf` | Exactly one, or at least one, branch must match. |
| `title`, `description` | Annotations. |
| `x-prism-secret` | `true` marks a string field that holds a credential ref (below). |

Not supported, and rejected with `config_schema_unsupported`: `$ref` and `$defs`,
`patternProperties`, `allOf`, `not`, `if`/`then`/`else`, `format`, `uniqueItems`, `multipleOf`,
`exclusiveMinimum`/`exclusiveMaximum`, `minProperties`/`maxProperties`, `dependencies`, an
array-valued `type`, tuple-form `items`, and any other `x-*` key. A malformed supported keyword
(for example `"minLength": -1`) gets the same code.

Config is JSON only. A function, class instance, symbol, bigint, non-finite number, or cyclic value
is `config_invalid`, and so is a `__proto__`, `constructor`, or `prototype` key. An `undefined`
object property counts as absent, as it does for `JSON.stringify`. Options that cannot be JSON (a
fetcher, a callback, a credential function) are bound by the package's own factory closure, for
example `wiki({ fetch })`, not passed through config.

### Outputs / response / errors

`createAgent` fails closed with a `PackageLoadError`. Its `code` is stable, `package` names the
package, and `path` is a JSON pointer into the config.

| `code` | When |
| --- | --- |
| `config_unknown_key` | A key the schema does not declare, at any depth where `additionalProperties` is `false`. |
| `config_invalid` | A type, enum, const, range, length, pattern, `required`, or shape violation, or a non-JSON value. |
| `secret_literal` | A value in an `x-prism-secret` field that is not an `env:` or `keyring:` ref. |
| `config_schema_unsupported` | The package's schema uses a keyword outside the subset. |

Messages name the path and the rule, never the value. A literal secret is not in the message, the
`path`, or `JSON.stringify(error)`.

### Request/response example

```ts
const config = {
  type: "object",
  properties: {
    backend: { type: "string", enum: ["brave", "exa"], default: "brave" },
    apiKey: { type: "string", "x-prism-secret": true },
  },
  required: ["apiKey"],
} satisfies JsonSchema;

// packageConfig: { "@acme/web": { apiKey: "env:SEARCH_KEY" } }
//   → { backend: "brave", apiKey: "env:SEARCH_KEY" }, sources { backend: "default", apiKey: "host" }
// packageConfig: { "@acme/web": { apiKey: "sk-live-…" } }
//   → PackageLoadError { code: "secret_literal", path: "/apiKey" }
// packageConfig: { "@acme/web": { apiKey: "env:SEARCH_KEY", bakend: "exa" } }
//   → PackageLoadError { code: "config_unknown_key" }
```

### Extension and configuration notes

- A field that holds a credential sets `"x-prism-secret": true` and has type `string`. Accepted
  refs match `^(env|keyring):[A-Za-z0-9_.\-/]+$`. The package resolves the ref at use time through
  the credentials slot; the value never enters config.
- A `default` for a secret field must be a ref too.
- Config is validated once per `createAgent`, in time linear in its size. A schema object is
  checked and compiled once and cached, so reusing one definition across agents costs nothing.

### Security and performance notes

- Config, the source map, and errors carry paths and rules, never values.
- A literal secret is rejected before any package code runs.
- Validation bounds the schema depth (32), the value depth (64), the pattern length, and the
  length of a string tested against a pattern.

### Related APIs

- `PackageLoadError`, `PackageLoadErrorCode`, and `JsonSchema`, exported from `@arnilo/prism`.
- [Slots](slots.md): the `credentials` slot resolves the refs that secret fields hold.
- [Hooks](hooks.md): the hook catalog, registration ids, and the session, status, and background events.
- `agent.inspect()`, `agent.commands`, and `agent.dispose()` on the `Agent` returned by `createAgent`.
- `examples/define-package.ts`: two packages, state across a fork and a reopen, a background task, and `inspect()`.

## Frozen for Phase 3

Phase 3 builds on this surface. A rename, addition, or removal fails `src/__tests__/package-api-freeze.test.ts`, and the failure names this page.

`PackageAPI` members: `name`, `config`, `hooks`, `slots`, `tools`, `skills`, `providers`, `commands`, `models`, `credentials`, `state`, `services`, `host`, `events`, `status`, `log`, `onDispose`.

`Capability`: `models`, `host-ui`, `session-state`, `background`, `credentials`, `slot:loop`, `slot:compaction`, `slot:store`, `slot:credentials`.

`AgentConfig` package fields: `packages`, `packageConfig`, `disable`.

`PackageLoadError` codes: `config_unknown_key`, `config_invalid`, `secret_literal`, `config_schema_unsupported`, `definition_invalid`, `kernel_range`, `missing_package`, `missing_service`, `service_conflict`, `dependency_cycle`, `duplicate_package`, `capability_missing`, `setup_failed`, `tool_conflict`, `skill_conflict`, `provider_conflict`, `command_conflict`, `unknown_command`, `command_args_invalid`, `unknown_disable_id`, `state_not_json`, `state_too_large`, `state_not_ready`.
