# Changelog

## [Unreleased]

### Added

- `@arnilo/prism-context-files` (plan 154 Task 7): the instruction-file plane as a source-exported
  package on the lockstep line, built from the retired kernel `node/instruction-sources` and
  `node/system-prompts` adapters and the agent-SDK instructions plane. One `context.build` transform
  (`@arnilo/prism-context-files:context.build`) composes `SYSTEM.md` (`source: "user"`) and
  `AGENTS.md` / explicit `files` (`source: "app"`) over the agent's base instructions through the
  kernel's `composeSystemPrompt`, so the 0.12 rank order is preserved with no copy of the composer.
- Config is `{ root (required), agentsMd?, systemMd?, globalRoot?, trustedRoots?, files? }`. There is
  no home-directory scan unless `globalRoot` is set, and a missing `root` fails the load naming the
  field instead of a schema `required`.
- Trust: a candidate file is loaded only when its realpath is inside a trusted root; a symlinked
  `AGENTS.md` escaping the roots is skipped with a `status.note("warn", …)` naming the path. A global
  `SYSTEM.md` outside `workspaceRoot` stays user-owned and ungated. A missing file is silent.
- Caching: files are read once per session into agent state keyed by path and mtime; a new run
  re-checks mtimes (one `stat` per candidate path) and re-reads only what changed.
- Library exports for hosts that compose the prompt themselves: `readContextFileLayers` /
  `resolveContextFileLayers` and `resolveInstructionSources` / `resolveInstructionSource`.

## [0.1.0] - 2026-08-09

### Added

- Initial package scaffold on the lockstep release line.

## [0.0.28] - 2026-08-08

### Added

- Package created in the pre-release manifest sweep.
