# Changelog

## [Unreleased]

### Added

- `@arnilo/prism-tools-browser` (plan 155 Task 3): the browser automation code moved out of
  `@arnilo/prism-web-tools` (`./browser`) into a source-exported package on the lockstep line. The
  default export is a `definePackage` definition whose `setup` imports `playwright-core`
  dynamically, launches the run-owned browser, and registers `browser_open`, `browser_snapshot`,
  `browser_act`, `browser_close`, `browser_evaluate`, and `browser_observe`, each declaring
  `effects`. `onDispose` closes the manager and the browser it launched. A missing peer or a failed
  launch writes a `warn` status note and registers nothing instead of throwing.
- Config `{ headless?, executablePath?, channel?, allowOrigins?, containedProxy?, allowLoopback?,
  allowPrivateHosts?, uploadRoots?, quarantine?, cdp? }`. `allowOrigins` is a hard origin allowlist;
  `containedProxy` is the fail-closed egress attestation; `uploadRoots` confines uploads.
- The moved module surface keeps its names as named exports behind the single entry point: the six
  tools, `createBrowserManager`, the limits/policy/network/upload/download/screenshot helpers, and
  the structural Playwright types.

### Changed

- The in-tool `ExecutionPolicy` option is removed from `createBrowserTools`. Approval now runs over
  the declared `effects` through the host `tool.call` gate; blocked schemes, loopback/private hosts,
  the origin allowlist, and upload-root containment stay as internal hard denies. The
  `buildBrowserExecutionAction` helper and the kernel `ExecutionPolicy` import are gone.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

The browser tools shipped inside `@arnilo/prism-web-tools` before this package existed; see that
package's changelog for the pre-split history.
