# @arnilo/prism-approval

Approval modes over tool `effects` and roots, as one `tool.call` gate. It does not parse tool names, except a `shell` command prefix on a static rule.

## Install

```bash
prism add @arnilo/prism-approval
```

```ts
import approval from "@arnilo/prism-approval";
import toolsCoding from "@arnilo/prism-tools-coding";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model,
  packages: [toolsCoding({ root }), approval({ mode: "edits", rules: [{ tool: "shell", commandPrefix: "bun test" }] })],
});
```

## Configuration

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `deny` \| `ask` \| `edits` \| `auto` | `ask` | How a non-read call is decided. |
| `roots` | `string[]` | `[]` | Extra roots that count as inside, beyond `coding.targets`. |
| `rules` | `{ tool, commandPrefix? }[]` | `[]` | Static allows. A `commandPrefix` matches a shell command's first two tokens. |
| `timeoutMs` | `integer` | none | Prompt bound. A timeout is a deny. |

## Mode table

| Mode | `read` | `write` inside roots | `write` outside roots | `execute` / `network` / `external` |
| --- | --- | --- | --- | --- |
| `deny` | allow | deny | deny | deny |
| `ask` | allow | ask | ask | ask |
| `edits` | allow | allow | ask | ask |
| `auto` | allow | allow | allow | allow |

Inside roots comes from `coding.targets` plus `roots`. A missing service, or a call it does not report, counts as outside. `deny` denies every non-read call, including one a rule would allow.

Inside roots follows the calling session: the handler passes the `tool.call` payload's `sessionId` to `coding.targets`, so a session bound to a worktree reports that worktree as its root (plan 165 Task 7). A write inside the bound worktree is inside roots; a write to the package root from that session is outside. Sessions with no worktree are unchanged.

## What it changes

Registers one decide handler, id `@arnilo/prism-approval:tool.call`. An `ask` confirms through `host.ui`, then a follow-up `select` of once or always. Always stores a per-session grant in memory and writes `state.session("grants")`. The decision path does not read the store. `dismissed`, a timeout, and a throwing prompt deny. `unavailable` returns `{ ask }`, so the kernel suspends and `session.resume` continues the call.

A matching rule or session grant allows without asking, except in `deny`.

## Failure behavior

Hard denies from a tool package stay in force in every mode, including `auto`, because any deny wins at `tool.call`. This package never returns `allow` in order to override another handler's deny.

`mode: "auto"` in a project-scope manifest cannot be rejected here: `PackageAPI` does not expose the entry's scope. A host that must refuse `auto` from project config checks the manifest scope itself. A code instance may select `auto`.

## Capabilities

`host-ui` and `session-state`.

## Example

`examples/coding-approval.ts` gates a real `edit` call from `@arnilo/prism-tools-coding` in `ask`
mode: the scripted host answers the `confirm` and the `once` follow-up, and the file changes, with
`@arnilo/prism-context-files` loading the same workspace. `examples/durable-approval.ts` covers the
suspension path with no UI.
