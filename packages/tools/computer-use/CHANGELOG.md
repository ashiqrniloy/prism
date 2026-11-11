# Changelog

## [Unreleased]

### Changed

- Plan 215 Task 7: the `computer-use-linux` skill description opens with when to use it, and its body no longer names the host-only `setup_accessibility` / `setup_window_targeting` tools (it says the host runs setup). Checked by `scripts/package-skills-conformance.mjs`.

### Added

- `@arnilo/prism-tools/computer-use` (plan 155 Task 4): the `computer-use-linux` MCP bridge moved out
  of `@arnilo/prism-coding-tools/./computer-use-linux` into a source-exported package on the lockstep
  line, with the factory names unchanged (`createComputerUseLinuxTools`, `loadComputerUseLinuxSkill`,
  `classifyComputerUseLinuxTool`, the `COMPUTER_USE_LINUX_*` lists). The bundled skill moved with it
  to `skills/computer-use-linux/SKILL.md`.
- `toolsComputerUse({ command?, args?, display?, includeSetupTools?, approved?, device?, runLimits? })`
  `definePackage` entry: resolves the host-owned executable on `PATH`, connects over stdio, registers
  the upstream tools, registers the bundled skill, and closes the bridge in `onDispose`. A missing
  binary, a missing `device.sandbox`, or a refused device admission writes a `warn` status note and
  registers nothing instead of throwing.
- Every tool declares `effects: ["external"]`, so the host approval hook sees it.
- The optional `computer-use.mcp` service lets a host or test supply its own MCP bridge;
  `@arnilo/prism-extensions/mcp` is now imported dynamically only during `setup`, so the package root is inert.
- New `resolveCommand` helper for absolute-path/PATH executable resolution.

### Changed

- The kernel `ExecutionPolicy` import and the `executionPolicy` option are removed. Approval runs over
  the declared `effects` through the host `tool.call` gate; mutating calls still pass in-tool device
  admission (`assertDeviceAdmit`), so a deny holds under `approval` `auto`.

## [0.1.0] - 2026-08-09

Initial published surface for the lockstep line. See the root `CHANGELOG.md`.

## [0.0.28] - 2026-08-08

The Linux desktop bridge shipped inside `@arnilo/prism-coding-tools` before this package existed; see
that package's changelog for the pre-split history.
