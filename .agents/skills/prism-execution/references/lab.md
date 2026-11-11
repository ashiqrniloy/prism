# Lab — Prism Code

Prism Code (`@arnilo/prism-code`) is the reference host: a coding-agent TUI. In the target it builds its agent with `createAgent` and the manifest, implements `HostUi`, renders events and commands, and assembles nothing.

## Target

- [roadmap.md](../../../../roadmap.md) §2.11 (the Prism Code example), Phase 12. The code moves to `apps/prism-code/`, and version 0.5.0 imports only `@arnilo/prism` and `@arnilo/prism/manifest`.
- **The TUI answers `host.ui`:** approval prompt, `ask_user` picker, secret input, OAuth URL, project package and MCP trust.
- **It renders generically:**
  - `AgentEvent`s, including `package.event` (for example `om.status`)
  - `agent.commands` as slash commands (`/om` comes from the OM package, not TUI code)
  - `agent.inspect()` as `doctor`
- **Lab config** maps onto the manifest and `packageConfig`.
- **Earlier adoption:** the lab may adopt `next` builds from Phase 4 onward. Each earlier phase deletes the lab module its replacement fully covers (create-plan probe 12).

## Today (0.12.1 assembly, due for deletion)

`packages/prism-code/src/`:

| Module | Replaced by |
| --- | --- |
| `headless.ts` (`assembleAppAgent`, the `(definition as any)` host bag, the `session.run` wrapper) | `createAgent` plus the manifest |
| `providers.ts`, `oauth.ts`, `credentials.ts` | provider packages, the credentials slot, `credentials-keyring` |
| `sessions.ts` | the store slot plus `store-jsonl` |
| `compaction.ts`, `observational-memory.ts`, `wiki.ts` | `memory-*` and `context-engineering` |
| `approval.ts` | `@arnilo/prism-extensions/approval` plus `HostUi` |
| `mcp.ts` | `mcp` package, trust via `host.ui` |
| `web.ts`, `tools.ts`, `tool-modules.ts`, `skills.ts`, `prompt.ts` | tool packages, kernel skills, `context-files` |
| `acp.ts` | `@arnilo/prism-hosts/acp` |
| `limits.ts` (maxCost `turnPolicy` wrap) | a `turn.before` hook |
| `config.ts`, `doctor.ts` | config → manifest mapping; `doctor` renders `inspect()` |

Keep `tui/` (OpenTUI, `reducer.ts`, keybindings, widgets, `history-store.ts`), `bin/`, `home.ts`, `version.ts`, and the binary and distribution scripts (`scripts/build-prism-code-binaries.mjs`, `install.sh`).

Current docs: [prism-code.md](../../../../docs/prism-code.md). See also the "Prism Code standalone binaries" section of [release-and-install.md](../../../../docs/release-and-install.md).

## Graft queries

- `graft ask "assembleAppAgent headless defineAgent session wrapper" --source`
- `graft ask "tui command om toggle coordinator" --source`
- `graft callers assembleAppAgent --depth all`

## Tests

- `packages/prism-code/src/__tests__/` (run from the workspace: `bun run build && bun run test`), including the PTY TUI journeys.
- `scripts/install-sh.test.mjs` for distribution.

## Rules

- **Never add agent assembly to the lab.** When the TUI needs a behavior, it belongs in a package or the kernel; the lab only renders and answers.
- **Before deleting a lab module,** port its behavior assertions into the replacing package's tests. The lab tests are the acceptance spec.
- **`assembleAppAgent` is a public export** (it appears in `scripts/compat-baseline/arnilo__prism-code.txt`). Changing its signature means regenerating the baseline.
- **The lab stays independently versioned** (`scripts/independent-packages.json`) and ships no version bump before roadmap Phase 12.
- **A coding session that edits a file under approval** is the regression that matters. Keep a journey test for it green in every lab task.
