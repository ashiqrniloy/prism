# Upgrading and retired names

Prism 0.13 replaced mechanisms outright. There are no compatibility aliases: a 0.12 name that is not in
`data/api.json` does not exist, and no shim will appear. When project code uses an unfamiliar name, look it up here,
then in `node_modules/@arnilo/prism/docs/migrate-to-0.13.md`, then in the index.

## How to read the migration pages

- `docs/migrate-to-0.13.md` is the current checklist, 0.12.1 to 0.13.0. Read its tables from the left column: the left
  is the old name, the right is where it went. The retired-name map below is a condensed copy; the page wins.
- `docs/migration.md` is the era index of older notes. `docs/migrate-to-0.5.md` to `0.11.md` describe retired contracts
  and ship in the tarball only as history. Do not follow them for 0.13.
- `node_modules/@arnilo/prism/docs/history/` also ships and describes 0.12. Do not read it for how to build a 0.13
  host, and do not copy a snippet from it. If code matches a 0.12 contract, assume it is wrong.

## Upgrade steps

1. Record the installed version of `@arnilo/prism` and each `@arnilo/*` package. They move in lockstep: align them all.
2. Replace every 0.12 family dependency with its native package (map below), in `package.json` and imports.
3. Rewrite `createAgent` to `await createAgent({ model, packages })`. Construction is async.
4. Move each removed config field to the hook or package that owns it (map below).
5. Typecheck. Each missing export is a retired name; fix it from the map, not with a cast.
6. Run `references/verification.md`. Then search for the left-column names below to confirm none remain.

## Retired-name map

Left column is the retired name. Everything in it is gone.

| Retired | Use instead |
| --- | --- |
| `createAgentSession`, `createExtensionKernel` | `await agent.session()` and a package listed in `packages` |
| `extensions: [...]` | `packages: [...]`; installed is listed is active |
| `provider: "x"`, `model: "y"` (two fields) | `model: { provider: "x", model: "y" }` plus the provider package in `packages` |
| `tools: { use: ["coding"] }` | `packages: [toolsCoding({ root })]`; a package instance, not a name |
| `identity: { profile }` | `principal: { kind, id }`, with `ownership` for the scope the host serves. Tools with durable effects fail closed without a principal |
| `store: "memory"` | the store slot default; list a store package for anything durable |
| `activateKernel` | list the package; installed is listed is active |
| `defineAgent` | `createAgent` |
| `@arnilo/prism-agent-sdk` | `@arnilo/prism` plus the native packages |
| `@arnilo/prism-providers` | one `@arnilo/prism-provider-<vendor>` package per vendor |
| `@arnilo/prism-core` | the kernel `@arnilo/prism` plus native packages |
| `@arnilo/prism-coding-tools` | `@arnilo/prism-tools-coding`, `-tools-openapi`, `-tools-computer-use`, `@arnilo/prism-approval` |
| `@arnilo/prism-web-tools` | `@arnilo/prism-tools-web`, `@arnilo/prism-tools-browser` |
| `@arnilo/prism-work` | `@arnilo/prism-tools-work` |
| `@arnilo/prism-hooks` | `@arnilo/prism-hooks-json` |
| `@arnilo/prism-acp-agent` | `@arnilo/prism-acp` (`serveAcp`) |
| `@arnilo/prism-code` | the private reference host; copy its patterns, never depend on it |
| `@arnilo/prism-all` | list the packages you need |
| `stopHooks` | a `run.end` hook |
| `turnPolicy` | a `turn.before` hook, cost policy |
| `providerRequestPolicies` | a `model.request` hook |
| `instructionInjectors`, `promptBuilder`, `inputBuilder` | a `context.build` hook (`@arnilo/prism-context-files`, `@arnilo/prism-context-engineering`) |
| `toolNarrowing` | `RunOptions.tools.only` |
| `beforeProviderTurn` | the `model.call` around hook |
| `forwardAgentEvents` | an `observe` hook |
| `createSecureAgent` | `createAgent` with `@arnilo/prism-governance` and `@arnilo/prism-approval` listed |
| `wiki_search`, `wiki_read_page`, `wiki_record_insight` | `memory.recall`, `memory.read`, `memory.insert` |

Plain words that are still valid config names (`loop`, `context`, `permission`, `middleware` when used as a
hook concept) are not listed: judge them by whether `api.json` or the docs define them in 0.13. `middleware` and
`guardrails` as config fields moved to the matching hooks (`model.request`, `tool.call`, `tool.result`) and to
`@arnilo/prism-guardrail-packs`.

## Fabric rename

The memory fabric's pinned core is now standing rules (`rules`, per-scope `rules.md`, editable). That package is
experimental and may change again; read its README, not this table.
