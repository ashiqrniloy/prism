# Prism docs requirements

Apply these to every Prism plan task.

## Where docs go during the 1.0 train

Three homes exist until the publish phase (roadmap Phase 11). Pick by what the task changes.

| Task changes… | Document in | Rules |
| --- | --- | --- |
| Released 0.12.1 behavior that still ships (a fix to the current line) | `/docs/<page>.md` plus its `docs/index.md` entry | Current-contract rules below. |
| A kernel contract (`@arnilo/prism` 1.0: agent, session, loop, hooks, slots, packages, manifest, models, tools and skills, host port, events) | `docs/next/<page>.md`, using the API page structure | Written in the same task that ships the API, never deferred to publish. Not linked from `docs/index.md`. The publish phase promotes each page into `/docs` and writes the index entries. |
| A native package or host library | that package's `README.md`, using the package page structure | Written in the task that creates the package. It becomes the package's published page. |

Never describe the target (`createAgent` with `packages`, `definePackage`, `loadManifest`, hooks, slots, `host.ui`) in released `/docs` pages before 1.0 ships. `src/__tests__/docs.test.ts` pins this.

The first plan that creates `docs/next/` excludes it in the same task from:
- the "one index link per docs page" test
- the root `files` tarball list (as `!docs/next`)
- any docs-tree scan that forbids target tokens

Record every task's user-visible change under `## [Unreleased]` in `CHANGELOG.md` as it lands, not at publish.

## Documentation decision per task

Every task includes a `Documentation/Wiki Assessment` with:

- `Public API or behavior impacted`: yes/no and why.
- `Docs pages to create/edit`: concrete paths in whichever home the table above selects, or `none` with a reason.
- `docs/index.md update`: yes/no and the entry. This is always `no` for `docs/next/` pages and package READMEs during the train. It is also `no` whenever the answer above is `no`.
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

- A page documents the current contract of what its home describes. `/docs` describes the latest release, `docs/next/` the unreleased kernel, and a README its package. Release narrative is history.
- A `docs/index.md` entry is one sentence describing what the page covers. No plan numbers, version narrative ("0.2.6 adds"), changed-package cuts, or line counts.
- Historical content (migration cuts, publish handoffs, readiness records, reviews) goes to `docs/history/` or `CHANGELOG.md`, never into a page body or index entry.
- An opt-in feature that adds model calls, writes, or latency states that cost and the default that avoids it on its page.

## API page structure (`/docs` and `docs/next/`)

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
