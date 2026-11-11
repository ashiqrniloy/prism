# Where things go

Three layers each own a different kind of decision. The reference host's README states the rule:
`node_modules/@arnilo/prism/docs/host.md` covers the host port, and the reference host walkthrough is in the Prism
repository (`apps/prism-agent/README.md`, "Where things go"). The walkthrough is not in an npm tarball, so this file
carries the rule.

| Layer | Holds | Put a thing here when |
| --- | --- | --- |
| Kernel `@arnilo/prism` | the loop, hooks, slots, sessions, store contract, events, host port, driver kit, the package system | the default loop or the package system cannot work without it |
| Native packages and host libraries | tools, memory, stores, providers, approval, governance, workflows, ACP, remote, channels | any harness or host could want it, whatever the product |
| The host | which agents exist, their package lists, prompts, routing, vendor adapters, deployment | it is an opinion about one product |

Nothing sits between the host and the SDK. The host imports `@arnilo/prism`, its public subpaths, and published
packages. It never imports a path inside a package (`@arnilo/prism-tools/coding/src/x`), and it never reaches into
`node_modules`.

## Decide where new code goes

1. Does the kernel fail to work without it? Almost never. Do not edit the kernel to add a capability. If a package
   cannot do the job because a hook or slot is missing, report that as a gap with the hook you needed.
2. Could another host want it? Write a package with `definePackage` (`node_modules/@arnilo/prism/docs/packages.md`),
   declare the capabilities it uses, and list it in `packages`. Example: `examples/define-package.ts`.
3. Is it one product's opinion (a prompt, a workflow graph, a routing table)? Keep it in the host's own files.

The kernel never imports or names a package. A host that needs "if package X is loaded" asks `agent.inspect()`.

## What a package can contribute

Through `PackageAPI` a package registers tools, hooks, skills, commands, providers, services and slot
implementations, and keeps session state. It cannot patch the loop or another package. Gates sit in primitives, not
in the loop: tools always run through the same executor that fires `tool.call`, so a custom loop cannot skip approval.
Read `node_modules/@arnilo/prism/docs/hooks.md` for the hook catalog and ordering.

## The public-surface rule

Public means: exported from the package entry or a documented subpath, and present in `data/api.json`. Everything
else is internal and can change without notice.

- Import from `@arnilo/prism`, `@arnilo/prism/provider-kit`, `@arnilo/prism/driver-kit`, `@arnilo/prism/manifest`
  and `@arnilo/prism/testing`, as `api.json` lists them per subpath.
- A name the docs show but `api.json` does not list is stale or experimental. Prefer the index.
- Types cast with `as unknown as` at a package seam are a smell. Fix the type at the source or import the exported
  type; a cast hides a contract change until runtime.
- A host never relies on an experimental package's shape staying put (`references/choosing.md`).

## Layout of a host repository

A small host is a few files: one `createAgent` call per agent in its own module, a config module that reads `env:`
refs, and the serving entry. Keep each agent's package list in one place so `inspect()` explains the whole agent.
Do not split one agent's wiring across modules that mutate it after creation. Look at `examples/minimal-host-app.ts`
and `examples/headless-host.ts`.
