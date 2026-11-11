# Manifest

> `@arnilo/prism/manifest` is the package manifest: the record of which
> packages load. This page covers the format, the scopes, the merge, install, remove, integrity,
> loading, and project trust.

## What it does

Prism maintains a manifest in each of two scopes. Hosts choose whether to read it.

| Scope | File | Managed directory |
| --- | --- | --- |
| user | `~/.prism/packages.json` (`$PRISM_HOME/packages.json`) | `~/.prism/packages/` |
| project | `.prism/packages.json` | `.prism/packages/` |

`parseManifest(json, { scope, path })` validates one file. `mergeManifestScopes({ user, project })`
produces the merged view. Neither reads the disk or imports a package.

The JSON Schema ships at `@arnilo/prism/manifest/schema.json` (draft-07). It is built from the same
object the validator uses (`MANIFEST_V1_SCHEMA`), so the two cannot drift.

## When to use it

Use the manifest when a host should load packages from configuration instead of assembling them in
code, or when `prism add` should be able to install, enable, and configure a package.

## Inputs / request

```jsonc
{
  "version": 1,
  "packages": [
    { "name": "@arnilo/prism-extensions/approval", "version": "^0.13.0", "integrity": "sha512-…", "capabilities": ["host-ui"],
      "config": { "mode": "ask" } },
    { "name": "@arnilo/prism-tools/web", "version": "^0.13.0", "integrity": "sha512-…", "capabilities": [],
      "optional": true, "config": { "apiKey": "env:BRAVE_API_KEY" } }
  ],
  "slots": { "store": "@arnilo/prism-extensions/store-jsonl" }
}
```

| Field | Type | Description |
| --- | --- | --- |
| `version` | `1` | Format version. Any other value fails as `manifest_version`. |
| `packages[].name` | string | Module specifier: npm root plus an optional exported subpath. Unique within a scope. |
| `packages[].version` | semver range | The range `install` resolved. |
| `packages[].integrity` | `sha512-<base64>` | SRI hash of the installed package and its runtime dependency closure. |
| `packages[].capabilities` | string[] | What the definition declared at install. A later load fails if the definition's capabilities differ. |
| `packages[].config` | object | Package config. A secret field holds an `env:NAME` or `keyring:name` ref. |
| `packages[].enabled` | boolean | Default `true`. |
| `packages[].optional` | boolean | Default `false`. |
| `slots` | `{ [slot]: packageName }` | Which package owns a slot. Same as `AgentConfig.slots` with a string. |

`version`, `integrity`, and `capabilities` come together: all three or none. A user entry needs all
three. A project entry may omit all three to override only `config`, `enabled`, or `optional` of a
package installed in the user scope.

`capabilities` is an addition to the roadmap §2.7 sample: the trust prompt for a project manifest must
show what a package may do before any project code is imported.

## Outputs / response / events

`parseManifest` returns the validated manifest or throws a `ManifestError`.
`mergeManifestScopes` returns `{ packages, slots }`:

- **Order.** User entries first, in file order, then project-only entries. Order is load order.
- **Override.** A project entry replaces the user entry's `version`, `integrity`, and `capabilities`
  together when it carries them, deep-merges `config` (objects merge, arrays and scalars replace), and
  replaces `enabled` and `optional` when set. `scope` on the result is the scope whose directory holds
  the install.
- **Slots.** Project `slots` override user `slots` per slot. Every owner must be a listed, enabled entry
  in the merged view, so disabling an owner in project scope breaks its slot assignment.

| `ManifestError.code` | Meaning |
| --- | --- |
| `manifest_unknown_field` | A top-level, entry, or slot field the format does not declare. |
| `manifest_version` | `version` is missing or is not `1`. |
| `manifest_duplicate` | The same name is listed twice in one scope. |
| `manifest_slot_owner` | A `slots` owner is not a listed, enabled entry. |
| `manifest_invalid` | Anything else: shape, name, range, integrity, capability, a partial entry, or an override of a package no scope installs. |
| `integrity_mismatch` | The installed tree differs from the recorded hash, holds a symlink, or is over the size bound. |
| `package_missing` | A package is named but not listed (`remove`) or not installed (`verifyInstalled`). |
| `not_a_package` | The default export is not a valid package definition. The install is rolled back. |
| `import_failed` | The installed package threw while importing. |
| `install_failed` | `bun` is missing or failed, or the spec is not acceptable. |
| `capabilities_drift` | The imported definition's capabilities differ from the recorded ones. |
| `trust_failed` | The `trustProject` callback threw. |
| `bun_required` | A CLI manifest command ran under a host that is not Bun. |
| `config_unknown_key`, `config_invalid`, `secret_literal`, `config_schema_unsupported` | `configure` or `verify` found the config breaking the package's schema. The codes are the loader's `PackageLoadError` codes, reused. |

## Request/response example

```json
{ "version": 1, "packages": [{ "name": "a", "version": "^1.0.0", "integrity": "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==", "capabilities": [] }] }
```

## Implementation example

From `examples/manifest.ts` (a real `bun add` of a `file:` spec into a temp root, about a second):

```ts
import { createAgent } from "@arnilo/prism";
import { configure, install, loadManifest, setEnabled } from "@arnilo/prism/manifest";

const entry = await install(`file:${fixture}`, { scope: "project", root, home });
const trusted = { root, home, trustProject: () => true };
const agent = await createAgent({ id: "demo", model, provider, packages: await loadManifest(trusted) });

await setEnabled(entry.name, false, { scope: "project", root, home }); // reload: the tool is gone
await loadManifest({ root, home }); // no trustProject: the project manifest is skipped, nothing is imported
await configure(entry.name, { apiKey: "a-literal" }, { scope: "project", root, home }); // secret_literal, file unchanged
// change one installed byte, then loadManifest(trusted) rejects with integrity_mismatch before any import
```

The example prints one JSON line (install, one turn that calls the package tool, disable and reload, the skipped project manifest, `secret_literal`, `integrity_mismatch`).

## Install and integrity

`install(spec, { scope, root?, home?, version?, cwd? })` and `remove(name, { scope, root?, home? })`
manage one scope's **managed directory**: a private Bun project (`package.json`, `bun.lock`,
`node_modules/`) at `<root>/.prism/packages/` or `<home>/.prism/packages/`. Packages import from there,
never through the host's own `node_modules`, so a host dependency cannot shadow a managed package. The
user `home` is `$PRISM_HOME` (an absolute path) or `~/.prism`, the same rule Prism Agent uses.

```ts
import { install, remove } from "@arnilo/prism/manifest";
const entry = await install("file:./fixtures/hello-package", { scope: "project", root: cwd });
// Tests can install a bundle subpath from a local directory or tarball:
// await install("@acme/tools/coding", { scope: "project", root: cwd, packFrom: "./tools.tgz" });
await remove("@acme/hello", { scope: "project", root: cwd });
```

`install` does this, in order:

1. Checks the spec. Only registry specifiers (`name`, `name/subpath`, `name/subpath@range`) and `file:` paths are accepted; URLs, git,
   aliases, an empty spec, and a spec starting with `-` fail as `install_failed` before any process starts.
2. For a `file:` **directory**, runs `bun pm pack` and installs the tarball. Bun installs a `file:`
   directory as symlinks back to the source, and a symlinked tree cannot be hashed.
3. Splits the specifier into its npm root and optional subpath, then runs `bun add --ignore-scripts <root>[@range]` once in the managed directory. Package lifecycle scripts never run.
4. Hashes the npm root and its dependency closure, imports the listed specifier through its exports map, and writes the entry (`name`, the range,
   `integrity`, `capabilities`). **Installing is the trust decision**: `install` imports the package, at
   the user's request. Reinstalling keeps the entry's `config`, `enabled`, and `optional`.
5. Writes the manifest atomically: a private temp file in the same directory, then a rename. A crash
   leaves the old file.

A default export that is not a package definition, or a bundle with no root export, fails as
`not_a_package`. The message lists explicit exported subpaths as candidates; it does not import
siblings to determine which are package definitions. An unexported subpath fails as `import_failed`
before its code runs. Failed installs restore the previous dependencies and lockfile, including an
upgraded root, and leave the manifest unchanged. A failed import is `import_failed`. `bun` missing or exiting non-zero is
`install_failed`; its stderr is truncated and redacted (token-looking environment values, `_authToken`,
`Bearer`).

The definition is read field by field and defined again with this kernel's `definePackage`. A package
may carry its own copy of `@arnilo/prism` (a peer dependency installed beside it), whose definitions
this kernel's loader would not otherwise recognise.

Entries with the same npm root share a version range and integrity hash. Installing another subpath
refreshes both fields on every installed sibling in that scope. A manifest with conflicting sibling
version ranges is rejected as `manifest_invalid`. Capabilities remain per specifier and are checked
again at load. Each `loadManifest` or `verify` pass hashes a root once per managed directory.

`remove` deletes the entry and drops any `slots` assignment that pointed at it. It runs
`bun remove --ignore-scripts <root>` only after the last sibling in that scope is removed. It
does not touch the other scope. A name that is not listed fails as `package_missing`.

### Integrity

`integrity` is an SRI `sha512-<base64>` computed over the installed package **and every package in
its runtime dependency closure** (dependencies and non-optional `peerDependencies`). Each package in the
closure is resolved within the managed project via Node resolution, hashed using the canonical tree
hash (every file's relative path, size, and bytes in byte-sorted order), and the package hashes are
combined in sorted package name order into the single recorded `integrity` hash.

`verifyInstalled(entry, packagesDir, scope)` recomputes the full closure hash **before any `import()`**
and fails closed:
- as `integrity_mismatch`, naming the package and the scope or dependency, on a changed byte in any
  package of the closure, an added or removed file, or **any symlink** anywhere in the closure;
- as `package_missing`, naming the package and the missing dependency, if any dependency in the
  runtime closure is not installed in the managed project;
- as `integrity_mismatch` if the dependency closure exceeds 512 packages.

Limits to know:

- **Scope of hash.** The hash covers the package and its full runtime dependency closure. Transitive
  dependencies installed beside the package in `node_modules` are walked and hashed.
- **Bounds.** Each package tree is bounded by 20,000 files and 256 MiB. The closure is bounded by 512
  packages (`MAX_CLOSURE_PACKAGES`).
- **Performance.** Hashing reads each file once. On `@arnilo/prism-tools/coding` with its `diff`
  runtime dependency (~70 files total), closure hashing takes about 4–5 ms per load (compared to ~2.5 ms
  for the package tree alone).
- `install` and `remove` for the same scope are not serialised; run one at a time.

## Load and trust

`loadManifest({ root?, home?, scopes?, trustProject? })` returns the enabled entries as package
instances. It does one thing per step, in this order:

1. Reads each scope's file once and parses it (nothing is imported).
2. Asks the host about the project scope, if there is one (below).
3. Merges the scopes, and drops `enabled: false` entries. A disabled entry costs nothing beyond parsing.
4. For each remaining entry, in load order: `verifyInstalled` (one tree hash), then one `import()`.
5. Checks the imported definition's `capabilities` against the recorded ones, and binds the entry's
   `config` and `optional` flag.

```ts
import { createAgent } from "@arnilo/prism";
import { loadManifest } from "@arnilo/prism/manifest";

const agent = await createAgent({
  model,
  packages: await loadManifest({ root: process.cwd(), trustProject: async (request) => ui.confirm(request) }),
});
```

**Project trust.** The project manifest loads only if `trustProject` resolves `true`. The callback
receives `{ path, packages: [{ name, version, capabilities }] }` and nothing else: no config values.
Nothing in the project scope is imported before it answers. With no callback, or any answer but
`true`, the project scope is skipped: a project-only package is not loaded, and a user package keeps its
user values. A callback that throws fails the load as `trust_failed` (its message is not forwarded), and
the project scope is not loaded. The user scope is the user's own and needs no approval.

**Order of checks.** Integrity is verified before the import, so a tampered tree never runs. Capabilities
are compared after the import, because only the definition knows them; a difference fails as
`capabilities_drift` (reinstall to accept it).

**A missing package** fails as `package_missing`, unless the entry is `optional: true`: then it is skipped.
The agent lists it in `inspect().packages` with `status: "skipped"`, `source: "manifest:<scope>"`, and a
status note. Any other failure (integrity, drift, not a package, import) fails closed even for an optional
entry, because a changed tree is not the same as an absent one.

**Slots.** A manifest `slots` entry reaches the loader as a slot assignment for the owning package.
`AgentConfig.slots` overrides it per slot, and a direct implementation always wins. A skipped optional
package assigns nothing.

**Provenance.** Each instance carries `source: { kind: "manifest", scope, assigns? }`. `agent.inspect()`
reports `manifest:user` or `manifest:project` per package, and `configSources` reports `user` or `project` for the
keys the manifest set (reflecting the winning scope). Secret fields show their `env:` / `keyring:` ref, never a value.

`loadManifest` does not import the installer, so a host that only loads never loads spawn code.

## Maintain: configure, enable, slots, list, verify

These edit one scope's `packages.json` (`{ scope, root?, home? }`) and write atomically. Each edit is
validated against the merged view first, so a rejected call leaves the file unchanged.

| Call | Does |
| --- | --- |
| `configure(name, patch, { scope })` | Deep-merges `patch` into the entry's `config`. Imports the package (its module runs, `setup` does not), checks the merged result against its `config` schema, then writes. Unknown key, schema violation, or a literal in an `x-prism-secret` field is refused before any write (`config_unknown_key`, `config_invalid`, `secret_literal`). In project scope a user-only package gets an override entry holding just the patch. |
| `setEnabled(name, enabled, { scope })` | Sets `enabled`. Project scope on a user-only package writes `{ name, enabled }`. Disabling a slot owner fails as `manifest_slot_owner`. |
| `assignSlot(slot, owner \| null, { scope })` | Sets or clears (`null`) this scope's slot assignment. `slot` must be a `SlotName`; `owner` must be a listed, enabled entry of the merged view. Clearing in project scope does not remove a user assignment. |
| `list({ root?, home? })` | The merged view: name, version, scope of origin, enabled, optional, capabilities, config **keys**, owned slots. Imports nothing; values never appear. |
| `verify({ root?, home?, trustProject? })` | For every entry: integrity, then for enabled entries the capabilities and config against the schema. Returns `{ name, scope, enabled, ok, issues, configChecked }[]` and does not stop at the first failure. Disabled entries and untrusted project entries get the integrity check only. |

`configure` and `verify` run the package's module after the integrity check, like `loadManifest`. Run
`configure` in project scope only for a project you trust.

## The `prism` CLI

Thin wrappers over the calls above. Scope defaults to `--project`; `--user` selects `~/.prism`
(`$PRISM_HOME`). Exit codes: `0` ok, `1` a `ManifestError` (its code is printed), `2` usage.

| Command | Calls |
| --- | --- |
| `prism add <spec> [--user\|--project] [--version <range>]` | `install`. Prints `<name> <range> trusts npm root <root>; declares capabilities: …` after the package is imported and before the manifest entry is written. |
| `prism remove <name> [--user\|--project]` | `remove` |
| `prism list [--json]` | `list` (merged view) |
| `prism enable <name>` / `prism disable <name>` | `setEnabled` |
| `prism config <name> <key>=<value>…` | `configure`. A value is JSON when it parses (`n=5`, `flag=true`, `o={"a":1}`), else text. A literal for an `x-prism-secret` field is refused with the field and the accepted `env:` / `keyring:` forms; the value is never printed. |
| `prism slot <slot> <owner>` / `prism slot <slot> --clear` | `assignSlot` |
| `prism verify [--json] [--trust-project]` | `verify`. Exits `1` if any entry fails. Project code is imported only with `--trust-project`. |
| `prism relay hook\|mcp --run <run-dir>` | Not a manifest command. Bridges a vendor's hook or MCP stdio to the run's callback broker (see [driver kit](drivers.md#callback-broker-and-relay)). Exit codes come from the broker's answer, or from the descriptor's fail-closed answer. |
| `prism new package <name> [--dir <path>]` | Scaffolds `package.json`, `src/index.ts` (`definePackage`, `requires.api`, empty config, no capabilities), `src/__tests__/package.test.ts` (`packageConformance`), and `README.md`. Refuses a non-empty directory. |

Only `add` and `remove` spawn `bun`; `list` and `verify` do not. The manifest commands need the Bun
runtime (`bun_required` otherwise); `src/cli.ts` starts with `#!/usr/bin/env bun`.

`prism init` and `prism providers add` are gone, with their templates. Use `prism new package` for a
package and `createAgent` in a host's own code for an agent. The `--provider` flag of the print/json/rpc
modes keeps working through a small built-in provider table.

Two commands that write the same scope at once race on the file (the last rename wins); there is no lock.

## Extension and configuration notes

The format is closed: an unknown field fails rather than being ignored, so a typo cannot silently
disable a setting. A future format change bumps `version`.

## Security and performance notes

- A `ManifestError` message names the scope, the file, and the field. It never contains a `config`
  value, so a literal secret in a rejected file is not echoed.
- Parsing reads nothing but the JSON you pass, and imports no package. A project manifest is parsed
  before the host's trust callback runs; trust gates the import, not the parse.
- Whether a `config` secret field holds a ref is checked against the package's own schema at
  `configure` and at load, because only the package knows which fields are secret.

## Related APIs

- [packages.md](packages.md): the definition, config schema, and `x-prism-secret`.
- [slots.md](slots.md): the slots a manifest `slots` entry assigns.
