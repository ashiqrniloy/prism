# @arnilo/prism-hosts/host-builder

Version-exact reference data for coding agents that build or change a [Prism](../../../README.md) host. It ships
indexes generated from the `@arnilo/prism` version it is released with, so what an agent reads is what the
installed kernel and packages export, and never a remembered 0.12 contract.

## Install

```bash
bun add -d @arnilo/prism-hosts
```

It is a development dependency: it adds nothing to an agent at run time and registers no package, hook, slot,
tool or skill. Its peer is `@arnilo/prism` (`>=0.13.0 <1.0.0`).

## What it ships

| File | Holds |
| --- | --- |
| `data/api.json` | Every public name of `@arnilo/prism`, its subpaths and every published package: kind, signature, one-line summary, the docs pages and READMEs that mention it, the examples that import it. |
| `data/errors.json` | Every `ERR_PRISM_*` code from the source scan and the short codes of the `*ErrorCode` unions: owning package, declaring file and line, error class, meaning from the doc comment, a sample message from the first throw site, and the docs that mention it. |
| `data/examples.json` | The CI-tested examples: path, title, imported packages, whether they need credentials. |
| `data/examples/**` | The example sources, verbatim. |

Each file records `prismVersion` and a `contentHash`. The files are generated, never edited by hand:

```bash
bun scripts/host-builder-index.mjs           # regenerate packages/hosts/host-builder/data
bun scripts/host-builder-index.mjs --check   # fail if the committed data is stale
```

The generator reuses the release gate's declaration model (`scripts/release-gates.mjs`) and reads only `src/`,
`packages/*/src`, `docs/`, the package READMEs and `examples/`. It leaves out `docs/history/**` and the
`migrate-to-0.5` … `0.11` pages, which describe retired contracts, and it fails when a copied example holds a
secret-shaped literal.

## Use

```ts
import { loadHostBuilderIndex, readExampleSource } from "@arnilo/prism-hosts/host-builder";

const api = await loadHostBuilderIndex("api");
const kernel = api.packages.find((pkg) => pkg.name === "@arnilo/prism");
const source = await readExampleSource("examples/define-package.ts");
```

An index loads on the first call that needs it, not at import. `readExampleSource` serves only paths that
`examples.json` lists.

```bash
prism-host-builder info     # Prism version and the size of each index
prism-host-builder install --target claude --mcp   # copy the skill and add the MCP server to a coding agent
prism-host-builder mcp      # serve the lookup tools, docs resources and prompts over stdio
prism-host-builder --help   # usage
```

An unknown command exits 2.

## The skill

`skills/prism-host-builder/` is an Agent Skills package skill for a coding agent that builds, changes, upgrades or
debugs a Prism host. `SKILL.md` (at most 8 KiB) holds the workflow (orient, choose, build, verify, report) and a map of
seven references: `choosing`, `layout`, `recipes`, `pitfalls`, `security`, `verification` and `upgrading`. It holds
judgment and pointers. Signatures, options and code live in the installed docs, the indexes above and the CI-tested
examples, and the skill links to them with project-relative paths (`node_modules/@arnilo/prism/docs/<page>.md`,
`node_modules/@arnilo/<package>/README.md`) so a copied skill reads version-exact pages. The MCP tools are an optional
accelerator; every procedure also works with a file read.

The package does not register the skill into an agent (it has no `setup`). The installer copies it into the project
(see "Installing into your coding agent").
A package-skill gate still checks it as one (`scripts/package-skills-conformance.mjs`), and
`src/__tests__/host-builder-kit.test.ts` (`host_builder_kit_matches_surface`, in `release:gate`) keeps it from drifting:

1. every fenced `ts` block is typechecked with the `examples/tsconfig.json` settings. A block that cannot be gets
   `<!-- no-check: <reason> -->` on the line before it;
2. every `node_modules/@arnilo/<package>/<path>` is in that package's packed file list;
3. every `examples/<file>` is in `data/examples.json`;
4. every `ERR_PRISM_*` token, and every code in the `Code` column of a table, is in `data/errors.json` and has a meaning;
5. no retired name (`scripts/retired-tool-names.json`, or the left column of a table in `docs/migrate-to-0.13.md`) appears
   outside the left column of a table in `references/upgrading.md`;
6. no secret-shaped literal appears.

Editing the skill, a docs page or an example changes the indexes: run `bun scripts/host-builder-index.mjs`.

## Installing into your coding agent

```bash
bunx --package @arnilo/prism-hosts prism-host-builder install --target claude --mcp
bunx --package @arnilo/prism-hosts prism-host-builder install --target codex --mcp --dry-run   # prints the TOML snippet; writes nothing
```

`install --target <name> [--mcp] [--root <dir>] [--force] [--dry-run]` works on the project in `--root` (default: the
current directory) and nothing else.

| Target | Skill copied to | `--mcp` |
| --- | --- | --- |
| `claude` | `.claude/skills/prism-host-builder` | Merged into `.mcp.json` under `mcpServers`. |
| `cursor` | `.agents/skills/prism-host-builder` (Cursor also reads `.claude/skills`) | Merged into `.cursor/mcp.json` under `mcpServers`. |
| `codex` | `.agents/skills/prism-host-builder` | Prints the `[mcp_servers.prism]` table for `.codex/config.toml` and writes nothing: the package takes no TOML dependency. Codex loads project configuration only for a trusted project. |
| `agents` | `.agents/skills/prism-host-builder` (Codex, Cursor and Prism's `contextFiles` read it) | None. |
| `prism` | `.agents/skills/prism-host-builder` | Always prints the `contextFiles` and `@arnilo/prism-extensions/mcp` packages a Prism builder agent lists. |

The server entry is `prism: { command: "bunx", args: ["--package", "@arnilo/prism-hosts", "prism-host-builder", "mcp"] }`: no env, no token. A JSON config
is parsed, given that one key and written back with its own indent, line ending and trailing newline; every other key
keeps its value and order. A file that is not plain JSON (invalid, empty, or with comments) or whose `mcpServers` is not
an object is refused with `ERR_PRISM_HOST_BUILDER_INSTALL_CONFIG` and left as it was. Add start flags such as
`--entry` by hand afterwards.

- **Stamp.** The copy carries `.prism-host-builder.json` (package, version, content hash, file list). Installing the
  same version again is a no-op, even over a locally edited copy. A different version replaces the copy and removes
  files the new skill dropped only while the files still match the stamp's hash; otherwise the install fails with
  `ERR_PRISM_HOST_BUILDER_INSTALL_CONFLICT`. So does a directory with no stamp, and a `prism` server entry that
  differs. `--force` overwrites; it never deletes files the stamp does not list.
- **All or nothing.** Every conflict is found before the first write, so a refused install changes nothing.
  `--dry-run` runs the same checks and prints the result.
- **One copy.** A `.claude/skills` symlink to `.agents/skills` resolves to one directory, so both targets share a copy.
  When the two are distinct directories, the second install warns that Cursor reads both and will list the skill twice.
- **Boundaries.** Every destination is resolved through symlinks and must stay inside `--root`
  (`ERR_PRISM_HOST_BUILDER_INSTALL_ROOT`); user-global directories (`~/.claude`, `~/.codex`) are never written because
  the kit is version-exact per project. The installer runs no package manager and no network.

## MCP server

`prism-host-builder mcp [--root <dir>] [--allow-version-mismatch] [--entry <file>#<export>] [--package <file>#<export>]
[--trust-project] [--check-timeout <seconds>] [--pass-env <NAME>]` serves over stdio through `servePrismMcpStdio`
(`@arnilo/prism-hosts/mcp-server`). It is local: no listener, no network, no model, no embeddings, and it never writes. The
four lookup tools read only files. The three check tools (see "Checking your host") run the host's own code, and only
when the server was started with a target for them. `--root` is the host project (default: the current directory).

| Tool | Input | Returns |
| --- | --- | --- |
| `prism_api` | `symbol?`, `query?`, `package?` | Signature, package, import specifier, docs pages and examples for an exact export name, or a ranked lexical search over names, signatures and summaries. |
| `prism_errors` | `code` | Meaning, owning package, declaring `file:line`, class, sample message, docs, and the fix `references/pitfalls.md` lists. |
| `prism_examples` | `query?`, `package?`, `path?` | Ranked examples, or the verbatim source of one indexed example. |
| `prism_docs` | `query` | Heading-anchored excerpts from the docs installed in the project, with a `prism-docs://` URI. Every query word must appear in a section. |

- **Resources.** `prism-docs://<package>/<path>` for each page installed under `<root>/node_modules/@arnilo/`: every
  package's `README.md` and the kernel's current `docs/*.md` (not `docs/history/**` or the retired migration pages). A
  page whose real path leaves `node_modules`, or the package it belongs to, is neither searched nor read.
- **Prompts.** `build-host` (goal), `add-capability` (capability) and `upgrade-host`. Each points at the skill, the
  matching reference and the tools.
- **Version rule.** Every tool call compares the `@arnilo/prism` installed under `--root` with the version the
  indexes describe. A mismatch, or no install, is a tool error `ERR_PRISM_HOST_BUILDER_VERSION` naming both versions
  and the fix (`bun add -d @arnilo/prism-hosts@<installed>`). `--allow-version-mismatch` turns it into a
  `warning` field on every result.
- **Bounds.** Every result and resource read is at most 64 KiB; a cut is marked `[truncated: N bytes omitted]`. An
  unknown symbol, code or path is `found: false` with the nearest matches, never an exception.
- **Examples.** `path` resolves only to a path `examples.json` lists; anything else is not found.

```json
{ "mcpServers": { "prism-host-builder": { "command": "bunx", "args": ["--package", "@arnilo/prism-hosts", "prism-host-builder", "mcp"] } } }
```

The lookups are plain functions in `src/lookup/` and `src/server.ts` only registers them.

## Checking your host

Three more tools check code the user owns. **They execute it**, so they are not read-only, and they run only for targets
the user named when the server started. A tool argument can pick among those targets and can never add one.

| Start flag | Tool | Does |
| --- | --- | --- |
| `--entry <file>#<export>` (repeatable) | `prism_inspect_host({ entry })` | Runs the exported async function, which returns an `Agent`; returns `agent.inspect()` (packages, tools, skills with `requiresTools`, hooks, slot owners, status notes) and calls `dispose()`. |
| none (`--trust-project` optional) | `prism_check_manifest()` | What `prism verify` does: re-hashes every install and re-checks config. Project-scope packages are imported only with `--trust-project`. |
| `--package <file>#<export>` (repeatable) | `prism_check_package({ package })` | `packageConformance` from the project's installed `@arnilo/prism/testing` on a package definition or factory; one result per check. |

```bash
bunx --package @arnilo/prism-hosts prism-host-builder mcp --entry src/agent.ts#createInspectionAgent --package src/my-package.ts#default
```

**The factory convention.** An inspection factory builds the agent on the mock provider and runs nothing:

```ts
// src/agent.ts
import { createAgent } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";

export async function createInspectionAgent() {
  return createAgent({ model: "mock/demo", packages: [mockProvider(), ...hostPackages()] });
}
```

The child sets `PRISM_HOST_BUILDER_CHECK=1`, so a factory can also branch on it. A factory that runs a session, or makes
an outbound `fetch`, fails with `ERR_PRISM_HOST_BUILDER_CHECK_MODEL_CALL` (the request is refused and its URL is
reported without the query).

- **Where a path may point.** Every target is `realpath`ed at start and must sit inside `--root`; a path outside it, or
  a symlink that leaves it, refuses the start with `ERR_PRISM_HOST_BUILDER_ENTRY` (exit 1).
- **One child per call, with limits.** Each check is one `bun` child process in its own process group, with the project
  root as working directory. `--check-timeout <seconds>` (default 30, at most 120) kills the group on expiry and the
  result says `timedOut: true`. The group is also killed after a normal exit, so nothing the host code started outlives
  the call. The result and each output stream are capped at 1 MiB (`truncated: true`), and the MCP layer bounds the
  text it returns at 64 KiB.
- **Environment allowlist.** The child sees `PATH`, `HOME`, `TMPDIR` and `PRISM_HOME` when set, the names given with
  `--pass-env NAME` (repeatable), and `PRISM_HOST_BUILDER_CHECK=1`. Provider keys are absent unless named, so an
  `env:` ref resolves to nothing and the check fails closed on a missing credential. The values of `--pass-env`
  variables are masked in every returned string with `redactSecrets`. Secret config fields already show their ref in
  `inspect()`.
- **What it cannot stop.** The allowlist, timeout and caps bound the child; they do not sandbox it. Host code that
  spawns a process or opens a socket still can, until the check ends. Point `--entry` at a factory you have read.
- **Cost.** A check builds the host's agent once per call, at whatever cost its `setup` has (an MCP client connection, a
  database open). Nothing is cached between calls.
- **Result shape.** `{ ok, result | error, timedOut, truncated }`. `ok: true` means the check ran: a package that fails
  conformance is `ok: true` with `result.ok: false` and each failing check listed. `error` is `{ code?, message }`.
- **No targets.** Without `--entry` or `--package` the tools still list; they return a `guidance` field naming the flag.
  An unknown `entry` returns the configured names. The server never guesses.

## What it changes

**No measured claim yet.** This package publishes a claim only when `compareExperiments` shows a significant
improvement at alpha .05, with multiple-comparison correction, on a pre-registered evaluation
(`scripts/host-builder-evals/`, 7 build tasks x 3 arms x 3 trials, graded by hidden tests and checks the builder never
sees). None passed, so the skill and the MCP server are not claimed to improve anything.

What the evidence does show, with `gemma4:31b` as the builder, is a direction and not a result:

| Run | `none` | `skill` | `skill+mcp` | Verdict |
| --- | --- | --- | --- | --- |
| Acceptance tests pass, kit-v1, natural loading | 0.19 | 0.57 | 0.52 | no claims |
| Acceptance tests pass, kit-v1, skill preloaded | 0.43 | 0.52 | 0.43 | no claims |
| Acceptance tests pass, kit-v2, natural loading | 0.24 | 0.67 | 0.62 | no claims (skill over `none` +0.43, q 0.125) |
| Acceptance tests pass, kit-v2, skill preloaded | 0.29 | 0.57 | 0.67 | inconclusive (2 of 63 runs lost to network errors) |

- The `skill` arm scored higher than `none` in every complete run, but 21 records per arm cannot separate that from noise at the
  pre-registered bar. The MCP server added nothing over the skill alone (skill+mcp over skill: no significant
  difference in any run).
- The kit-v1 to kit-v2 change came from diagnosing the first run: interfaces had no member lists in `data/api.json`,
  the skill never mentioned that tools with durable effects need a `principal`, and the upgrade page called the retired
  `identity` field valid. After the fix, the 0.12 upgrade task went from 0 of 3 to 3 of 3 with the skill.
- `beam` wrote no files in most runs and `gpt-oss:120b` lost many runs to server errors, so neither gave a usable
  comparison. Only `gemma4:31b` was run on kit-v2.

Evidence: [`docs/_evidence/host-builder/212/`](../../../docs/_evidence/host-builder/212/) holds the kit-v2 runs
(`ollama-gemma4.md`, `ollama-gemma4.preload.md`), the earlier kit-v1 runs (`kit-v1/`) and the inconclusive attempt
(`attempts/`). The criteria, claim rules and registered input hashes are `scripts/host-builder-evals/criteria.json` and
`criteria.lock.json`.

## Cost

No model calls and no network from the lookup tools. Everything they return is read from files inside this package. A
check tool costs one child process per call (see "Checking your host").

## Security

- The indexes and the skill come from this package's own `data/` and `skills/`. The lookup tools also read markdown pages under `<root>/node_modules/@arnilo/` (real paths only, see above) and each package's `package.json` version, and nothing else from the project. The server writes nothing.
- The check tools execute project code: only the targets named at server start, each `realpath`ed inside `--root`, in a child with an allowlisted environment, a time limit and output caps (see "Checking your host"). Targets never come from a tool argument or from model output.
- The generator copies example sources into `data/`. It scans them for key-shaped literals and for values found in
  the environment or `scripts/live.env`, and a hit fails generation. No `_evidence` content enters `data/`.
- `readExampleSource` rejects absolute paths, `..` segments and any path the examples index does not list.

Protocol dependencies are optional peers of `@arnilo/prism-hosts`. Install `@modelcontextprotocol/server@^2.3.0` and `zod@^4.6.2` for the MCP command. Protocol entrypoints require these peers; see the [bundle dependency table](../README.md).
