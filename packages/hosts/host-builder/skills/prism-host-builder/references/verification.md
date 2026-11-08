# Verification

Prove a change without a live model, a network or a real credential. Run these in order and stop at the first failure.
Report what ran and what you could not run.

## 1. Typecheck

Run the project's own check (`bun run typecheck`, or `bunx tsc --noEmit -p .`). Prism ships TypeScript source and the
workspace typechecks against it, so an import of a name that is not in `data/api.json` fails here. A new `as unknown
as` cast is a signal that you used the wrong type.

## 2. Load the agent on the mock provider and read `inspect()`

Build the agent exactly as the host does, with the real package list, and replace only the provider with
`mockProvider` from `@arnilo/prism/testing`. Then read `agent.inspect()`: it lists loaded packages, tools, skills,
commands, hooks in execution order, slot owners, disabled ids and status notes, with no I/O. Check that every package you
meant to list is `loaded`, that each slot has the owner you expect, and that no secret value appears (refs only).
Page: `node_modules/@arnilo/prism/docs/packages.md` ("Inspecting an agent").

## 3. Conformance helpers

Page: `node_modules/@arnilo/prism/docs/testing.md`. The first three come from `@arnilo/prism/testing`; check
`data/api.json` for the subpath before you import any other.

- `packageConformance(input, { config?, mockProvider? })` for a package you wrote. It checks setup and dispose
  idempotence, no leaks after dispose, a valid config schema, capabilities that cover usage, no secret in `inspect()`,
  and that an unavailable host fails closed.
- `loopConformance(strategy)` for a custom loop.
- `storeConformance(factory, { reopen })` for a custom session store; the `reopen` leg proves a restart.
- `assertGateIntegrity` (subpath `@arnilo/prism/testing/tool-conformance`) for a gate that must not be bypassed by a loop.

```ts
import { definePackage } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";

const audit = definePackage({
  name: "@acme/audit",
  version: "1.0.0",
  requires: { api: 1 },
  setup(prism) {
    prism.hooks.on("tool.result", () => {});
  },
});

const report = await packageConformance(audit);
if (!report.ok) {
  throw new Error(report.checks.filter((check) => !check.ok).map((check) => check.message).join("\n"));
}
```

## 4. Run the host's own tests

The typecheck proves types, not behavior. Drive the host with scripted mock turns that call its tools and read the
tool results: a missing principal, a gate that never fires or a package that never loads shows up there, not in `tsc`.

Answer approvals with `createScriptedHostUi` instead of a person; a test that answers `yes` to everything proves
nothing, so also test a `no`. Use the mock provider's scripted turns to drive a tool call and assert the result.
Look at `examples/approval.ts` and `examples/tools.ts`.

## 5. Examples as the oracle

The shipped examples run offline in CI. When a recipe says to copy an example, run your adaptation the same way the
example runs. If it needs credentials, `data/examples.json` says so; skip it and say so.

## 6. Verify installed packages

For a manifest host, `prism verify` re-hashes the installed packages and imports enabled ones. It imports project code
only with `--trust-project`; do not pass that flag on a project you have not reviewed. The MCP tool
`prism_check_manifest` runs the same check and imports project code only when the server was started with
`--trust-project`; it never takes that choice from a tool call.

## 7. The MCP tools

If the `prism-host-builder` MCP server is connected (`prism-host-builder mcp`), use its read-only tools to confirm a
name, a signature or an error code before you rely on it. They read the same `data/` files, so a file read gives the
same answer.

- `prism_api` with `symbol` (exact export name) or `query` (words), optionally `package`: signature, package, import
  specifier, docs and examples.
- `prism_errors` with `code`: meaning, owner, declaring file and line, docs, and the fix `pitfalls.md` lists.
- `prism_examples` with `query` or `package`, or `path` to read one example's source.
- `prism_docs` with `query`: heading-anchored excerpts from the docs installed in this project.

Each call checks the installed `@arnilo/prism` against the version the indexes describe. A mismatch is an
`ERR_PRISM_HOST_BUILDER_VERSION` tool error naming both versions and the fix; do not work around it, install the
matching `@arnilo/prism-host-builder`. An unknown name returns the nearest names, not an error. The server also serves
the installed docs as `prism-docs://` resources and three prompts: `build-host`, `add-capability` and `upgrade-host`.

Three more tools check the host's own code. They are not read-only: each runs that code in a child process, and only
for targets the user named when the server was started (`--entry <file>#<export>`, `--package <file>#<export>`). Ask the
user to restart the server with the flag when a tool says none is configured; never try to pass a path.

- `prism_inspect_host` with `entry`: builds the agent with the configured factory, returns `agent.inspect()` (packages,
  tools, skills with `requiresTools`, hooks, slot owners, status notes) and disposes it. The factory must build the agent
  on `mockProvider` from `@arnilo/prism/testing` and run nothing: a factory that runs a session or makes an outbound
  request fails with `ERR_PRISM_HOST_BUILDER_CHECK_MODEL_CALL`. The child sees only `PATH`, `HOME`, `TMPDIR`,
  `PRISM_HOME` and the `--pass-env` names, plus `PRISM_HOST_BUILDER_CHECK=1`, so a missing credential fails closed.
- `prism_check_manifest`: what `prism verify` does, honouring `--trust-project`.
- `prism_check_package` with `package`: `packageConformance` on the configured package, one result per check.

A result is `{ ok, result | error, timedOut, truncated }`. `ok: true` means the check ran; a package that fails
conformance is `ok: true` with `result.ok: false` and the failing checks listed.

## What not to do

- Do not call a live provider "to see if it works". Use the mock provider and fake refs.
- Do not mark a check passed that you did not run. Name it as unchecked.
- Do not delete or loosen a failing test, approval mode or validator. Fix the cause.
