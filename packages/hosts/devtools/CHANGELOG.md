# Changelog

All notable changes to `@arnilo/prism-devtools` will be documented in this file.

## [Unreleased]

- **Host library `@arnilo/prism-devtools`** (plan 162 Task 4): the developer inspector moved out of `@arnilo/prism-coding-tools/dev` into `packages/hosts/devtools`. `serveDevtools(agent, { port, hostname, token })` serves the page and its JSON routes on `Bun.serve` over the public `Agent` API.
- **`prism-devtools` bin**: serves a manifest-built agent (`--root`, `--model provider/model`, `--trust-project`, `--port`) on loopback.
- **Security**: loopback by default; a non-loopback `hostname` requires a `token` ref (`env:NAME`); a literal token is refused; a bearer token guards every route when set; every JSON body and SSE event passes the agent's redactor.
- **Removed from the 0.12 inspector**: the `prism dev` subcommand, `createPrismDevInspector`, `createDevRouter`, `runDevCli`, the `PrismRequestHandler` dependency, the prompt and decision panels, and the timeline panel (the projector stays in `@arnilo/prism-core` until Phase 16). No alias is kept.

## [0.1.0] - 2026-08-09

### Added

- Lockstep package scaffold.

## [0.0.28] - 2026-08-08

### Added

- Lockstep package scaffold.
