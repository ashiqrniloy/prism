# Changelog

## [Unreleased]

### Added

- `@arnilo/prism-tools-web` (plan 155 Task 2): the web search and fetch code moved out of
  `@arnilo/prism-web-tools` (root, `./brave`, `./exa`, `./firecrawl`, `./obscura`) into a
  source-exported package on the lockstep line. The default export is a `definePackage` definition
  whose `setup` registers `web_search` and `web_fetch` (plus the native Obscura tools when
  `backend: "obscura"`), each declaring `effects: ["network"]`. Config selects the backend:
  `{ backend, apiKey?, fetch?, obscura?, limits? }`. `apiKey` and `fetch.apiKey` are ref-only
  (`env:`/`keyring:`) and resolve once through `prism.credentials.resolve`; a literal fails
  validation. A missing key ref or a missing Obscura binary writes a `warn` status note and registers
  nothing instead of throwing.
- The `web.fetch` service, provided when a Firecrawl fetch backend is configured:
  `fetch(url, { signal?, maxBytes? }) → Promise<WebDocument>`.
- The moved module surface keeps its names as named exports behind the single entry point: the
  Brave/Exa/Firecrawl adapters, `createWebTools`, the limits/normalize/transport helpers, and the
  full Obscura surface (`createObscuraWebTools`, `connectObscuraCdp`, `createObscuraMcpTools`,
  `resolveObscuraCommand`, `validateObscuraCommand`, `spawnObscuraProcess`).
- `resolveObscuraCommand(name)`: resolves a configured Obscura command to an absolute executable
  path against absolute `PATH` entries only.

### Changed

- The `@arnilo/prism-mcp` import in the Obscura MCP bridge is now dynamic, so importing the package
  loads neither `playwright-core` nor `@arnilo/prism-mcp`. The Obscura CDP composition uses a local
  structural Playwright type instead of the browser package's types.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

The web search and fetch tools shipped inside `@arnilo/prism-web-tools` before this package existed;
see that package's changelog for the pre-split history.
