---
name: prism-host-builder
description: Use when building, changing, upgrading, or debugging a host or package on the Prism agent SDK (@arnilo/prism): choosing packages, wiring createAgent, serving it, and verifying it.
---

# Building a Prism host

Prism 0.13 is a small kernel plus native packages. A host is code that calls `await createAgent({ model, packages })`
and serves the agent. Your memory of Prism 0.12 is wrong for this version: read the installed docs, never recall.

## Where the facts are

All paths are relative to the project root and describe the installed version.

- Docs index: `node_modules/@arnilo/prism/docs/index.md`. Kernel pages sit beside it. Each package has
  `node_modules/@arnilo/<package>/README.md`.
- Version-exact indexes: `node_modules/@arnilo/prism-host-builder/data/api.json` (every public name, its signature,
  the docs that mention it), `errors.json` (every error code and what it means) and `examples.json`.
- Tested example sources: `node_modules/@arnilo/prism-host-builder/data/examples/<name>.ts`. Copy one; do not retype it.
- If an MCP server named `prism-host-builder` is connected, its lookup tools read the same indexes. They are an
  accelerator. Every step below also works with a file read.

An export that is not in `api.json` does not exist in this version. Check before you import. Every interface and
class lists its fields under `members`: read a field or method name there (for example the payload a hook handler
receives), never guess it.

## Workflow

1. **Orient.** Read the project's `package.json`, its `createAgent` call and its lockfile. Note the Prism version,
   which packages are listed, which slots have an owner, and whether the host uses a manifest. Read
   `docs/migrate-to-0.13.md` if any code looks like 0.12 (see `references/upgrading.md`).
2. **Choose.** Decide with `references/choosing.md`: host library, store, compaction owner, approval, provider.
   Place each new thing with `references/layout.md`: kernel, package, or host. A capability any host could want is
   a package; an opinion about one product stays in the host.
3. **Build.** Read `references/recipes.md` before you write code: find the recipe, open the example it names and
   the docs page it links, and change the smallest thing. List a package to turn it on; nothing is active unless
   it is listed.
4. **Verify.** Run `references/verification.md`: typecheck, `agent.inspect()`, and the conformance helpers.
   Read `references/pitfalls.md` when a load or run fails: match the error code before you guess.
5. **Report.** Say what changed, which checks ran and what you could not check.

## Rules that do not bend

- Secrets are named references the credentials slot resolves, never literals, in config, the manifest, logs and
  tests. A literal fails closed. Read `references/security.md` before you touch credentials, approval, trust or a
  server.
- Fail closed. Do not weaken a validator, approval mode, trust check or limit to make something pass. Fix the cause.
- Installed means listed means active. Do not edit the kernel to add a capability. Write a package with
  `definePackage` and list it.
- No default model or provider exists. A host names one and lists the provider package.
- Do not run `bun install` to repair a workspace without being asked; it can rewrite the lockfile.
- Memory packages other than `memory-compaction` are experimental. Opt in on purpose (`references/choosing.md`).
- Do not copy a code sample from memory, a blog or a 0.12 page. Copy from `data/examples/` or the installed docs.

## Mistakes the compiler cannot catch

- **A host that runs tools needs a principal.** Tools with durable effects (`shell`, `write`, `edit`, git commits in
  `@arnilo/prism-tools-coding`) fail closed at run time unless `createAgent` gets `principal: { kind, id }` (and the
  `ownership` scope the host serves). A type check passes without it. A host that runs as a local user sets both.
- **Deleting a retired field is not an upgrade.** `identity` is gone: it became `principal`. Look every removed field
  up in `references/upgrading.md` and move what it did; do not just delete it.
- **Types are not behavior.** After the typecheck, drive the host once with scripted mock turns that call its tools
  (`references/verification.md`) and read the tool results.
- **Two packages for one slot.** Before you list a package that provides `compaction`, `store`, `loop` or `credentials`,
  check what already provides it (`agent.inspect().slots`) and assign the owner in `slots`.
- **Leave no scratch files.** Delete the files you made only to try something; the whole project must typecheck.

## References

Read `recipes.md` before you build; read the others when their row applies. Each is short.

| File | Read it when |
| --- | --- |
| `references/choosing.md` | picking a host library, store, compaction owner, approval, governance or provider |
| `references/layout.md` | deciding whether code belongs in the kernel, a package or the host; what is public |
| `references/recipes.md` | doing a common change: add a tool, a skill, a store, serve over ACP, add approval |
| `references/pitfalls.md` | a load or run failed, or before you list two packages that touch one slot |
| `references/security.md` | secrets, approval, trust, multi-user hosts, a network listener |
| `references/verification.md` | proving a change works without a live model |
| `references/upgrading.md` | the code or the lockfile is from 0.12, or a name does not exist |

## When you are unsure

Prefer the smaller change and say what you assumed. If a docs page and the `api.json` entry disagree, the index
wins, because it is generated from the installed code. If neither answers, say so; do not invent an option.
