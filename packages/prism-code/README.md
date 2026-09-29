# @arnilo/prism-code

Terminal coding agent app built on [`@arnilo/prism-agent-sdk`](../../docs/agent-sdk.md) — one assembled definition, three surfaces:

- **Interactive TUI** — streaming messages, tool cards, approval prompts, provider/model/effort pickers, and a status footer, rendered with OpenTUI on Bun native FFI.
- **Headless** — `print` streams assistant text; `json` emits one event envelope per line for scripting and CI.
- **ACP server** — `prism-code acp` serves the Agent Client Protocol over stdio for editor clients.

```bash
bun add -g @arnilo/prism-code
# or without Bun/npm (installs to ~/.prism/bin):
curl -fsSL https://raw.githubusercontent.com/ashiqrniloy/prism/main/install.sh | sh
```

> **0.4.0+ is the terminal app.** Versions `0.3.x` and earlier of `@arnilo/prism-code` were the coding-agent profile library. That library surface moved to [`@arnilo/prism-coding-tools`](../prism-coding-tools/README.md) (tools, security, coding agent helpers) and [`@arnilo/prism-agent-sdk`](../agent-sdk/README.md) (`defineAgent`, `codingPreset`). Pin `@arnilo/prism-code@0.3` only if you still need the old library.

## Quick start

```bash
# Launch the interactive TUI in the current repository
prism-code

# One-shot prompt (print mode; one event per line with --mode json)
prism-code -p "summarize the repository architecture"

# Resume a durable session
prism-code --session session_1757950000000_ab12cd34

# Serve ACP for an editor integration
prism-code acp
```

Run the offline mock-provider demo without credentials:

```bash
bun examples/prism-code-headless.ts
```

## Configuration (`prism-code.json`)

The config file is the trust boundary: unknown keys are rejected, values are shape-validated, and relative paths resolve against the config file's directory. With no config file the CLI starts from `{ cwd }` — but the TUI and headless modes refuse to run without a usable provider.

```json
{
  "userId": "local",
  "model": { "provider": "anthropic", "model": "claude-sonnet-4-5" },
  "credentialRef": "ANTHROPIC_API_KEY",
  "tools": {
    "planes": { "coding": true, "git": true },
    "exclude": ["shell"],
    "add": ["./my-tools.mjs#lintTool"]
  },
  "skills": { "dirs": [".agents/skills"] },
  "instructions": { "agentsMd": true },
  "mcp": {
    "servers": [{ "serverId": "web", "command": "bunx", "args": ["@mcp/web"], "allow": "stdio" }],
    "allow": ["stdio"]
  },
  "web": { "mode": "obscura" },
  "wiki": { "enabled": false },
  "observationalMemory": { "enabled": false },
  "store": { "type": "sqlite" }
}
```

Key surfaces:

- **Sessions** — one durable SQLite database at `~/.prism/sessions/sessions.db` by default (scoped by canonical git root); `/new`, `/resume`, `/rename`, `--session`, `--continue`, and `--resume` resume with titled, faithfully replayed history. `store.path` overrides the location; the in-memory store disables resumption.
- **Tools** — 9 core coding tools default on; 7 git tools, `ask_user_decision`, and `coding_check` are opt-in; `replace`/`exclude`/`add` customize the set. See the [tool inventory](../../docs/prism-code.md#tool-inventory).
- **Provider/model/effort** — `/provider` runs API-key, OAuth, ambient, or host-setup onboarding; `/model` does live discovery with static fallback; **Shift+Tab** cycles the model's declared reasoning levels.
- **Compaction** — `/compact` runs the coding LLM summarization strategy (one provider call by default).
- **Observational memory** — `/om` toggles per session (default off), `/om-model` selects the independent worker model, `/om:status` and `/om:view` inspect it.
- **Web** — `obscura` (default, host-installed binary), `brave` (search + optional Firecrawl fetch), or `off`; missing backends omit tools and report a setup note instead of failing silently.
- **Wiki** — four slash commands (`/wiki-init`, `/wiki-refresh`, `/wiki-lint`, `/wiki-ingest`) plus search/read/insight tools; skill auto-deploy is opt-in.

CLI flags: `-p/--prompt`, `-m/--mode tui|print|json|acp`, `-c/--config`, `--session`, `--model`, `--provider`, `--no-agents-md`, `--no-system-md`.

## Security notes

- Credentials resolve at the provider edge from `credentialRef`/environment or the private credential store; secret prompts are masked and never echo into stream history.
- MCP servers register only when trusted and when their destination matches the `mcp.allow` allow-list (origin plus path-segment subtree for HTTP/SSE, explicit `stdio` marker); the unstable `acp` transport is never bridged. Project-declared servers require a one-time per-repo trust approval (recorded in `~/.prism/trust.json`) unless `--trust-project-mcp` is passed; header values resolve `${env:…}`/`${credential:…}` references at connect time and literal secret headers are global-config only.
- The TUI approval prompt denies by default when unavailable or timed out; web and wiki content stays untrusted data.
- Wiki URL ingest runs an SSRF check and fails closed when no web fetch backend exists; wiki skill deploy requires the explicit `wiki.autoDeploySkills` opt-in.

Full reference: [`docs/prism-code.md`](../../docs/prism-code.md).

## Requirements

- Bun `>=1.4.2` (OpenTUI native package).
- Self-contained install: as an app, Prism Code declares `@arnilo/prism`, `@arnilo/prism-providers`, and every other runtime package as regular dependencies. The optional `@ai-sdk/provider` peer of `@arnilo/prism-providers` is only for the `/ai-sdk` adapter, which Prism Code does not load.
