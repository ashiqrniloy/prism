# Pitfalls

Match the error code first. `node_modules/@arnilo/prism-host-builder/data/errors.json` gives each code's owning package,
file and meaning. A package load error carries a short code; a `createAgent` that fails to load rejects before any run.

In the tables below the **Code** column holds only codes that exist in `errors.json`.

## Load failures

| Code | What happened | Fix |
| --- | --- | --- |
| `model_required` | `createAgent` got no `model` and the loop needs one. There is no default provider. | Pass `model: "provider/model"` or a `ModelSpec`, and list the provider package. A model-less loop is the only exception. |
| `ERR_PRISM_SLOT_CONFLICT` | Two packages provide one slot (usually `compaction`) and `slots` does not choose. | Add `slots: { compaction: "<package name>" }` to the `createAgent` config. This is the SDK's resolution, not a workaround. |
| `ERR_PRISM_UNKNOWN_SLOT_OWNER` | A `slots` assignment names a package that did not provide that slot. | Check the exact package name and that the package is listed and provides the slot. |
| `manifest_slot_owner` | A manifest `slots` owner is not a listed, enabled entry. | Enable or add the entry, or change the owner. |
| `missing_service` | A package needs a service no loaded package provides (for example `work.sandbox` for `work_exec`). | List the package that provides it, or provide it from the host. Do not stub the service to silence the error. |
| `missing_package` | A required package is not listed, or its version is outside the required range. | List it with a version that satisfies the range in its `requires`. |
| `service_conflict` | Two packages provide one service name. | Drop one, or disable the duplicate with `disable`. |
| `duplicate_package` | The same package name is listed twice. | List it once. Change per-package options through `packageConfig`. |
| `tool_conflict` | A tool name is taken by another package, the host's tools or a reserved kernel name. | Rename the tool in your package. Never rely on a later registration shadowing an earlier one. |
| `skill_conflict` | A skill name is taken by another package or the host's skills. | Rename the skill; names are `domain-job` and unique across packages. |
| `skill_too_large` | A skill body is over the hard instruction cap. | Move detail into `references/` next to the `SKILL.md`. |
| `config_unknown_key` | Config has a key the package's schema does not declare. | Read the package README for its keys. Unknown config fails closed; do not add the key to the schema to pass. |
| `config_invalid` | A config value breaks the schema (type, range, shape). | Fix the value. |
| `secret_literal` | A literal was put in a secret field. | Use an `env:NAME` or `keyring:name` ref. |
| `kernel_range` | The kernel version does not satisfy the package's `requires.prism`. | Align versions; all `@arnilo/*` packages are lockstep with the kernel. |
| `kernel_api` | `requires.api` is not an API level this kernel supports. | Write the package against `api: 1` for 0.13. |
| `capability_missing` | The package used a capability it did not declare. | Add it to `capabilities`, only if the package really needs it. |
| `setup_failed` | `setup` threw, or a listed package failed to load. | Read the error cause; fix the package. Do not wrap `setup` in a try/catch that hides it. |
| `registration_closed` | A tool or contribution was registered after `setup` finished. | Register during `setup`. |
| `unknown_disable_id` | `disable` names an id no tool, hook, command or skill carries. | Copy the id from `agent.inspect()`. |
| `state_not_ready` | Session state was read before the session loaded its branch. | Read state inside a hook or tool, not at package setup. |

## Failures that carry no code

- **`bun install` rewrites the lockfile.** In a workspace it has produced duplicate lock keys. Do not run it to repair
  a project unless asked; edit `package.json` and tell the person to install.
- **Copying a 0.12 sample.** A `store: "memory"` field, a `loop:` option or a model-invoked workflow no longer exists.
  Read `references/upgrading.md` and copy from `data/examples/`.
- **Two memory packages and no `slots`.** Listing `@arnilo/prism-memory-compaction` with
  `@arnilo/prism-memory-observational` is valid only with a `compaction` owner assigned.
- **A tool in `requiresTools` that is off.** The skill disappears from the catalog; it is not an error. Check
  `agent.inspect().skills` before you debug the prompt.
- **A host answering nothing.** With no `host.ui`, every ask answers `unavailable`. Approval asks then suspend the run
  and resume only when an answer arrives. A run that stops "for no reason" often waits for one.
- **Importing a package path.** `@arnilo/prism-tools-coding/src/x` is not public and is not in the tarball layout you
  expect. Import the entry or a documented subpath listed in `api.json`.
- **Experimental memory shape.** A `^0.13.0` range cannot install an experimental package. Install it by tag and
  expect the API to move.
