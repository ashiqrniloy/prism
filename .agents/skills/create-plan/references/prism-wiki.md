# Prism docs requirements

Apply these to every Prism plan task.

## Where docs go

The `docs/next/` staging tree was promoted into `/docs` before the 0.13.0 publish, and `src/__tests__/docs.test.ts` (`docs_next_is_promoted`) fails if it comes back. `/docs` now describes the 0.13.0 contract; the 0.12 pages live in `docs/history/` as archives. There are two homes. Pick by what the task changes.

| Task changes… | Document in | Rules |
| --- | --- | --- |
| A kernel contract (`@arnilo/prism`: agent, session, loop, hooks, slots, packages, manifest, models, provider-kit, tools and skills, host port, events, testing) | the matching `/docs/<page>.md` (`docs/index.md` "Kernel" section lists them), using the API page structure | Edited in the same task that ships the change. A new page gets one `docs/index.md` link and an entry in the `kernelPages` or `apiPages` list in `src/__tests__/docs.test.ts`. |
| A native package or host library | that package's `README.md`, using the package page structure | Written in the task that creates or changes the package. It is the package's published page and is linked once from `docs/index.md` (`docs.test.ts` checks every package README has a link). |

The reference host walkthrough (`apps/prism-agent/README.md`) is linked from `docs/index.md`. It is a host walkthrough, not a package README.

Never edit a page under `docs/history/`: it is a frozen 0.12 archive.

Record every task's user-visible change under `## [Unreleased]` in `CHANGELOG.md` as it lands, not at publish.

## Documentation decision per task

Every task includes a `Documentation/Wiki Assessment` with:

- `Public API or behavior impacted`: yes/no and why.
- `Docs pages to create/edit`: concrete paths in whichever home the table above selects, or `none` with a reason.
- `docs/index.md update`: yes/no and the entry. It is `yes` for a new `/docs` page or a new package README, and when an existing page's scope sentence changes. It is `no` for edits inside an already-indexed page, and whenever the answer above is `no`.
- `Documentation structure reference`: this file.

Documentation is required when a task adds or changes any of the following:
- a public API or export
- a hook, slot, or event
- a `PackageAPI` member
- a config or manifest field
- a CLI command
- provider, tool, or session behavior
- a default or replaceable implementation
- a package subpath

## Current-contract rules

- A page documents the current contract of what its home describes. `/docs` describes the kernel on `main`, and a README its package. Release narrative is history. A kernel page carries no phase or plan narrative (`docs.test.ts` rejects `Phase N` and `plan NNN` in kernel pages).
- A `docs/index.md` entry is one sentence describing what the page covers. No plan numbers, version narrative ("0.2.6 adds"), changed-package cuts, or line counts.
- Historical content (migration cuts, publish handoffs, readiness records, reviews) goes to `docs/history/` or `CHANGELOG.md`, never into a page body or index entry.
- An opt-in feature that adds model calls, writes, or latency states that cost and the default that avoids it on its page.

## API page structure (`/docs`)

````markdown
# <API name>

## What it does
<Current contract, no release narrative.>

## When to use it
<When a host or package author uses this API.>

## Inputs / request
<Field table or typed shape.>

## Outputs / response / events
<Return type, events, hook results, side effects.>

## Request/response example
```json
<minimal config or payload>
```

## Implementation example
```ts
<minimal working TypeScript example>
```

## Extension and configuration notes
<Which hooks, slots, or package config can replace or contribute behavior.>

## Security and performance notes
<Secrets, capabilities, trust boundaries, what fails closed, load cost, limits.>

## Related APIs
- `<API or page>`: <relationship>
````

A page covering several small APIs repeats the sections per API, or gives a table plus an example per export.

## Package page structure (package `README.md`)

````markdown
# <package name>

<One sentence: what installing this package changes about an agent.>

## Install
```bash
prism add <package name>
```
```jsonc
// manifest entry, with every config field that has no default
```

## Configuration
<Table: field, type, default, description. Secret fields say "ref only (env:/keyring:)".>

## What it changes
<Tools, skills, commands, providers registered; hooks by name and kind; slot claimed; events emitted; session state kept; services provided or required.>

## Capabilities
<Declared capabilities and why each is needed.>

## Cost, security, and failure behavior
<Extra model calls or writes and their default; what fails closed; status notes emitted when the package cannot operate.>

## Example
```ts
<createAgent with this package, on the mock provider where possible>
```
````
