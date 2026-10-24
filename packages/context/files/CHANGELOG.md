# Changelog

## [Unreleased]

### Added

- Nested instruction files (plan 190 Task 7): a directory deeper than `root` contributes its
  `AGENTS.md` (or `CLAUDE.md` when absent) just in time, as one extra text part on the first coding
  tool result that touches its subtree — not a system-prompt change and not a new message. `read`,
  `edit`, `write`, and `diagnostics` use `path`; `grep`/`glob` use their directory `path`; `move`
  uses `from`/`to`; paths outside `root` are ignored. The first insertion's bytes are frozen in
  package session state, so a later file edit cannot rewrite an earlier message; compaction removes
  the anchor and the next touch reinserts the current file. Config `nested` defaults to `true`;
  `false` restores root-only behavior, and `{ maxFileBytes, maxFiles }` lowers the defaults
  (16 KiB / 16 files; hard caps 64 KiB / 16). Over a limit the file is skipped with one
  `status.note("info", …)`; a realpath escaping the trusted roots is skipped with a warning. The
  shared tool-result serializer now appends trailing text parts so both the OpenAI Chat and
  Anthropic Messages codecs carry the insertion. The package now declares `session-state`.

 `contextFiles({ root })` scans the standard project roots
  `<root>/.agents/skills` and `<root>/.claude/skills`, plus `<globalRoot>/.agents/skills`,
  `<globalRoot>/.claude/skills` and `<globalRoot>/.codex/skills` when `globalRoot` is set. Each
  `<name>/SKILL.md` is parsed with `parseSkillFile` and registered through `prism.skills.register`;
  roots are de-duplicated by realpath, the project root wins a global duplicate, and custom
  `skills.roots` replace the defaults. A malformed, oversized, untrusted or conflicting skill is
  skipped with one `status.note` naming its path, never a failed setup. Config also accepts
  `CLAUDE.md` as the per-directory fallback when `AGENTS.md` is absent.
- `@arnilo/prism-context-files` (plan 154 Task 7): the instruction-file plane as a source-exported
  package on the lockstep line, built from the retired kernel `node/instruction-sources` and
  `node/system-prompts` adapters and the agent-SDK instructions plane. One `context.build` transform
  (`@arnilo/prism-context-files:context.build`) composes `SYSTEM.md` (`source: "user"`) and
  `AGENTS.md` / explicit `files` (`source: "app"`) over the agent's base instructions through the
  kernel's `composeSystemPrompt`, so the 0.12 rank order is preserved with no copy of the composer.
- Config is `{ root (required), agentsMd?, systemMd?, globalRoot?, trustedRoots?, files?, skills? }`. There is
  no home-directory scan unless `globalRoot` is set, and a missing `root` fails the load naming the
  field instead of a schema `required`.
- Trust: a candidate file is loaded only when its realpath is inside a trusted root; a symlinked
  `AGENTS.md` / `SKILL.md` escaping the roots is skipped with a `status.note("warn", …)` naming the path. A global
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
