# @arnilo/prism-extensions/context-files

`AGENTS.md` / `CLAUDE.md` and `SYSTEM.md` layering as one `context.build` handler, nested
instructions loaded just in time after a tool touches their subtree, plus `SKILL.md` discovery for
the standard coding-agent roots — trust-gated and cached per session. The kernel names no package
and reads no prompt files: this package is the whole instruction-file plane.

## Install

```bash
prism add @arnilo/prism-extensions/context-files
```

```ts
import contextFiles from "@arnilo/prism-extensions/context-files";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model,
  packages: [contextFiles({ root: process.cwd() })],
});
// AGENTS.md (or CLAUDE.md) lands after the base instructions; SYSTEM.md before it.
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
| `nested` | `true` | Load a subtree's `AGENTS.md` / `CLAUDE.md` after a tool result first touches it. `false` restores root-only behavior; an object accepts `maxFileBytes` (default 16,384, hard cap 65,536) and `maxFiles` (default and hard cap 16). |
| `skills.enabled` | `true` | Discover and register `SKILL.md` files at setup. |
| `skills.roots` | standard roots | Skill roots, relative to `root` unless absolute. **Replaces** the default roots. |

## Layers and order

One `context.build` transform, registered as `@arnilo/prism-extensions/context-files:context.build`, sets the
draft's system prompt to the kernel's `composeSystemPrompt` result over the current leading system
text plus the loaded layers. Rank order is the kernel's: `SYSTEM.md` (`source: "user"`, rank 0)
before `AGENTS.md` and `files` (`source: "app"`, rank 2). The draft is the provider view only:
nothing is written to the transcript. Nested instructions keep their frozen bytes in package
session state, never in a stored message.

`AGENTS.md` wins when a directory holds both; otherwise the same directory contributes its
`CLAUDE.md`. Never both. The rule applies at every candidate directory from the enclosing trusted
root down to `root`.

`disable: { hooks: ["@arnilo/prism-extensions/context-files:context.build"] }` removes every layer.

## Skills

At setup, the package scans each skill root one level deep for `<name>/SKILL.md`, parses it with the
kernel's `parseSkillFile`, and registers it through `prism.skills.register`. Default roots, in
precedence order:

1. `<root>/.agents/skills`
2. `<root>/.claude/skills`
3. `<globalRoot>/.agents/skills` (only when `globalRoot` is set)
4. `<globalRoot>/.claude/skills` (only when `globalRoot` is set)
5. `<globalRoot>/.codex/skills` (only when `globalRoot` is set)

`skills.roots` replaces this list. Roots are de-duplicated by realpath, so a `.claude/skills`
symlink to `.agents/skills` is scanned once. The first root wins a duplicate name; later duplicates
are skipped with `status.note("info", …)` naming the path. Custom roots are project roots: a root
outside `root` must be listed in `trustedRoots` to be read.

A missing root is silent. A malformed or oversized `SKILL.md`, a project file whose realpath escapes
the trusted roots, and a `skill_conflict` with the host or another package each produce one
`status.note("warn", …)` naming the path; setup skips that skill and never throws for it. These
skills are instructions only: nothing under a skill directory is imported or executed, and
frontmatter such as `allowed-tools` is metadata that grants no tool.

Cost: one `readdir` per root and one read per `SKILL.md`, at setup only. Nothing skill-related runs
per turn.

## Nested instruction files

A directory deeper than `root` can hold its own `AGENTS.md` (or `CLAUDE.md` when `AGENTS.md` is
absent). Its instructions are not loaded at session start: they appear after the first coding tool
result that touches that subtree, appended as one extra text part on that same tool result. The
part is:

```text
[context-files] Instructions for packages/api/ (from packages/api/AGENTS.md):
Run `bun test --cwd packages/api` after changing routes.
```

The tool result, not a new message, is the anchor: role alternation stays valid on every provider
route. `read`, `edit`, `write`, and `diagnostics` use their file `path`; `grep` and `glob` use their
optional directory `path`; `move` uses `from` and `to`; a path outside `root` is ignored. The
message metadata gains `contextFiles: ["packages/api/AGENTS.md"]` and
`source: "context-files-nested"`; the text is project instructions (`source: "app"` rank), never
tool output. The root's own and parent layers still come from the system prompt; only deeper files
use this path.

The first insertion's exact text part is frozen in package session state, keyed by the tool call
and file, so later requests reproduce byte-identical messages after the file changes. Compaction
that removes the anchoring tool result also removes the insertion; the next tool result that touches
the directory inserts the then-current file again. Each directory is inserted at most once in one
provider view; a second read under it adds nothing. Over `maxFileBytes` or `maxFiles`, the file is
skipped (not truncated) and one `status.note("info", …)` names it. A nested file whose realpath
escapes the trusted roots is skipped with `status.note("warn", …)`.

Cost: on a request with a new tool result, one `stat` for the directory's `AGENTS.md` (and for
`CLAUDE.md` only when the primary is absent) and one read per file, cached by path and mtime for the
session. Re-applying a frozen insertion on later requests touches no filesystem. `nested: false`
restores root-only behavior.

## Trust

A candidate file is loaded only when its realpath is inside a trusted root; a symlinked `AGENTS.md`
or `SKILL.md` that escapes the roots is skipped with `status.note("warn", …)` naming the path, never
read. A missing file is silent. A file outside `workspaceRoot` (the global `SYSTEM.md`) is
user-owned and loaded without a project trust check; global skill roots follow the same rule and are
read only when `globalRoot` names them — there is no home-directory scan by default.

## Caching

Prompt files are read once per session and cached in agent state keyed by path and mtime. A new run
re-checks the mtimes (one `stat` per candidate path, no read); a changed file re-reads, an unchanged
one keeps the cached layers. The `AGENTS.md` / `CLAUDE.md` pair also re-checks both mtimes, so a new
`AGENTS.md` takes over from a `CLAUDE.md` on the next run. Nested files use the same path+mtime
cache per session, but only when a new tool result first touches their directory; a frozen insertion
is re-applied without reading. Skills are discovered once at setup and do not participate in the
per-run cache check. There is no filesystem read per turn after the first.

## Libraries

For a host that composes the prompt itself (an SDK plane, a CLI runner), the same reader is exported
directly:

```ts
import { readContextFileLayers, resolveInstructionSources } from "@arnilo/prism-extensions/context-files";

const layers = await readContextFileLayers({ workspaceRoot, globalRoot });
const sources = await resolveInstructionSources(discoveredContributions, { resourceTrust });
```

`resolveInstructionSources` realizes discovered `kind: "instructions"` contributions as
`ContextSource`s. Markdown-only contributions read their resource (contained to the contribution
directory unless `resourceTrust` allows otherwise); module-referenced ones load only through a
host-supplied `moduleLoader` — this package never `import()`s discovered code.

## Capabilities

`session-state` — nested insertions are frozen in the package's session log so a resumed or later
request reproduces the exact bytes. The package otherwise uses hooks, `status.note`, and agent
state only.
