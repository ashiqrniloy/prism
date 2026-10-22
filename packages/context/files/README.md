# @arnilo/prism-context-files

`AGENTS.md` and `SYSTEM.md` layering as one `context.build` handler, trust-gated and cached per
session. The kernel names no package and reads no prompt files: this package is the whole
instruction-file plane.

## Install

```bash
prism add @arnilo/prism-context-files
```

```ts
import contextFiles from "@arnilo/prism-context-files";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model,
  packages: [contextFiles({ root: process.cwd() })],
});
// AGENTS.md lands after the base instructions; SYSTEM.md before it (source rank order).
```

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `root` | — (required) | Workspace root. `AGENTS.md` is searched from here up to the enclosing trusted root; `SYSTEM.md` is read here. A missing `root` fails the load naming the field. |
| `agentsMd` | `true` | Load the `AGENTS.md` layers. |
| `systemMd` | `true` | Load the `SYSTEM.md` layer under `root` (and under `globalRoot` when set). |
| `globalRoot` | none | Reads `<globalRoot>/.prism/agent/SYSTEM.md`. **No home-directory scan without it.** |
| `trustedRoots` | `[root]` | Extra trusted roots for the file trust gate. |
| `files` | `[]` | Extra explicit instruction files, treated as project (`source: "app"`) layers and trusted by being named. |

## Layers and order

One `context.build` transform, registered as `@arnilo/prism-context-files:context.build`, sets the
draft's system prompt to the kernel's `composeSystemPrompt` result over the current leading system
text plus the loaded layers. Rank order is the kernel's: `SYSTEM.md` (`source: "user"`, rank 0)
before `AGENTS.md` and `files` (`source: "app"`, rank 2). Nothing is ever written to the store — the
draft is the provider view only.

`disable: { hooks: ["@arnilo/prism-context-files:context.build"] }` removes every layer.

## Trust

A candidate file is loaded only when its realpath is inside a trusted root; a symlinked `AGENTS.md`
that escapes the roots is skipped with `status.note("warn", …)` naming the path, never read. A
missing file is silent. A file outside `workspaceRoot` (the global `SYSTEM.md`) is user-owned and
loaded without a project trust check.

## Caching

Files are read once per session and cached in agent state keyed by path and mtime. A new run
re-checks the mtimes (one `stat` per candidate path, no read); a changed file re-reads, an unchanged
one keeps the cached layers. There is no filesystem read per turn after the first.

## Libraries

For a host that composes the prompt itself (an SDK plane, a CLI runner), the same reader is exported
directly:

```ts
import { readContextFileLayers, resolveInstructionSources } from "@arnilo/prism-context-files";

const layers = await readContextFileLayers({ workspaceRoot, globalRoot });
const sources = await resolveInstructionSources(discoveredContributions, { resourceTrust });
```

`resolveInstructionSources` realizes discovered `kind: "instructions"` contributions as
`ContextSource`s. Markdown-only contributions read their resource (contained to the contribution
directory unless `resourceTrust` allows otherwise); module-referenced ones load only through a
host-supplied `moduleLoader` — this package never `import()`s discovered code.

## Capabilities

None. The package uses hooks, `status.note`, and agent state only.
