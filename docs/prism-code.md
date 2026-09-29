# Prism Code (`@arnilo/prism-code`)

## What it does

Prism Code is a terminal coding agent app built on [`@arnilo/prism-agent-sdk`](agent-sdk.md). One assembled definition powers three surfaces:

- **Interactive TUI** — OpenTUI renderables in the terminal: streaming messages, tool cards, approval prompts, provider/model pickers, and a status footer.
- **Headless** — `print` streams assistant text; `json` emits one event envelope per line for scripting and CI.
- **ACP server** — `prism-code acp` serves the Agent Client Protocol over stdio for editor clients.

The `prism-code` binary layers a global `~/.prism/config.json` with a project `prism-code.json` (or `--config`), assembles the coding toolset (plus optional web and wiki planes), resolves credentials at the provider edge, and owns the session store. It also exports the assembly building blocks (`assembleAppAgent`, `runHeadless`, `createPrismCodeTui`, `createPrismCodeAcpAgent`) so hosts can embed a surface directly.

## When to use it

- Run a coding agent against a repository without writing harness wiring: TUI for interactive work, `print`/`json` for scripts and CI, ACP for editor integration.
- Embed a ready-made coding agent runtime and override one seam (provider, store, tools, approval policy) instead of assembling every plane yourself.
- Use the config schema, provider inventory, and tool catalog as a reference implementation of app assembly over the Agent SDK.

## Inputs / request

### Install

Two channels. The curl installer needs no Bun or npm:

```sh
curl -fsSL https://raw.githubusercontent.com/ashiqrniloy/prism/main/install.sh | sh
curl -fsSL .../install.sh | sh -s -- --version 0.4.0    # pin a version (or PRISM_CODE_VERSION)
curl -fsSL .../install.sh | sh -s -- --modify-path      # append ~/.prism/bin to your shell rc
curl -fsSL .../install.sh | sh -s -- --uninstall        # remove the binary, keep ~/.prism
```

With Bun `>=1.4.2`:

```sh
bun add -g @arnilo/prism-code     # puts prism-code in $BUN_INSTALL/bin (default ~/.bun/bin)
prism-code --version
prism-code doctor                 # runtime, OpenTUI native package, home, providers, storage

bunx @arnilo/prism-code --version # one-off run, no global install
```

- **Channel:** `prism-code --version` prints the version and how it was installed, e.g. `0.4.0 (bun)` or `0.4.0 (binary)`.
- **Upgrade:** re-run the installer, or `bun add -g @arnilo/prism-code@latest`. **Uninstall:** `install.sh --uninstall`, or `bun remove -g @arnilo/prism-code`. Neither touches `~/.prism` (config, sessions, credentials), which you remove yourself if you want a clean slate.
- **PATH:** the installer prints the exact line for bash/zsh/fish when `~/.prism/bin` is missing from `PATH`; re-run with `--modify-path` to append it. Bun installs into `$BUN_INSTALL/bin` (default `~/.bun/bin`); `bun add -g` prints the line if it is missing.
- **Checksum:** the installer fetches the archive and `SHA256SUMS` over HTTPS from the GitHub Release ([prism-code-v0.4.0](https://github.com/ashiqrniloy/prism/releases/tag/prism-code-v0.4.0)) and aborts on a mismatch. See [Prism Code standalone binaries](release-and-install.md#prism-code-standalone-binaries).
- **Before 0.4.0:** `@arnilo/prism-code@<0.4.0` was the coding-agent profile *library* and is deprecated; that surface now lives in `@arnilo/prism-coding-tools` and `@arnilo/prism-agent-sdk`. Pin `0.4.0` or newer for the app.
- **Self-contained graph:** the package declares every runtime package (`@arnilo/prism`, the providers, the Agent SDK, OpenTUI) as a regular dependency, so a global install needs nothing else. It installs exactly one `@arnilo/prism` copy, so class identity (`instanceof`) holds across packages.
- **Standalone binary:** each release also builds self-contained executables for Linux (x64/arm64, glibc and musl) and macOS (x64/arm64) that need no Bun. See [Prism Code standalone binaries](release-and-install.md#prism-code-standalone-binaries) for targets, checksums, provenance, and the few differences from the Bun install.
- **0.3.x:** `@arnilo/prism-code` 0.4.0+ is this terminal app. The former 0.3.x coding-agent profile library moved to [`@arnilo/prism-coding-tools`](coding-agent-tools.md) and [`@arnilo/prism-agent-sdk`](agent-sdk.md).
- **Verified install:** `bun scripts/prism-code-install-smoke.mjs` installs the packed tarballs with `bun add -g` into a throwaway `BUN_INSTALL` and runs the installed bin. It checks `--version` (cold start under 300 ms), a headless `mock/default` prompt, `doctor --json`, a TUI launch/exit over a PTY, and a single `@arnilo/prism`. `--packs <dir>` reuses existing tarballs (the release workflow's pre-publish step), and `--registry [--version x.y.z]` repeats the checks against npm, adding `bunx` (also reachable as `bun scripts/post-publish-smoke.mjs --prism-code`). The release workflow's `post-publish-smoke` job runs that registry mode after publish and then installs the published archive with `install.sh`. `bun test scripts/install-sh.test.mjs` exercises the curl installer against an HTTPS fixture server.

### CLI

```sh
prism-code [options] [prompt]
prism-code acp [options]
prism-code doctor [--json]
```

| Flag | Description |
| --- | --- |
| `-p, --prompt <text>` | Prompt to execute. A positional prompt is accepted too. |
| `-m, --mode <mode>` | `tui` (default), `print`, `json`, or `acp`. The `acp` subcommand is equivalent to `--mode acp`. A prompt without `--mode` defaults to `print`. |
| `-c, --config <path>` | Project config file path. Defaults to `prism-code.json` in the current directory; an explicitly named missing file fails closed. Layered over the global `~/.prism/config.json` (below). |
| `--session <id>` | Resume a durable session by id. An unknown id exits 1; rejected with an in-memory store. |
| `--continue` | Resume the most recent durable session for the current repository (canonical git root). |
| `--resume` | Open the `/resume` session picker at startup (TUI mode only). |
| `--trust-project-mcp` | Trust MCP servers declared by the project config for this run without prompting (headless/ACP default is to skip them). |
| `--model <model>` | Model selection: `provider/model`, `provider:model`, or a model id against the configured provider. |
| `--provider <provider>` | Provider id override. |
| `--max-turns <n>` | Bound the maximum number of turns for this run. |
| `--max-cost <amount>` | Bound the maximum cost in USD for this run; stops cleanly when reached. |
| `--approve <mode>` | Headless approval override: `deny` (default) refuses approval-required calls, `edits` auto-allows in-repo edits but refuses shell, `all` allows everything except execution-security hard denies. |
| `--no-agents-md` | Skip `AGENTS.md` instruction auto-load. |
| `--no-system-md` | Skip global `SYSTEM.md` instructions. |
| `--json` | Machine-readable output for `prism-code doctor`. |
| `-h, --help`, `-v, --version` | Help / version. |

#### Doctor

`prism-code doctor` diagnoses the environment without starting a session and without ever printing a secret,
token, or environment value. It runs the independent checks in parallel and bounds every MCP probe
(5 s per server), so it completes well under 20 s. Output is a plain table; `--json` prints
`{ version, ok, exitCode, checks[] }` where every check is `{ name, status: "ok"|"warn"|"fail", detail, hint? }`.
The process exits `1` when any check is a blocking failure (`fail`); `warn` rows do not fail the run.

| Check | Verifies |
| --- | --- |
| `runtime` | Bun version (>= 1.4.2) and that `@opentui/core` plus its platform native package load. |
| `home` | The `~/.prism` directory exists, is owned by the current user, and is `0700`. |
| `credentials` | The effective credential store (keychain probe / configured / saved choice) is openable. |
| `providers` | Which shipped providers have credentials (`env <VAR>`, `stored key`, `oauth`, `ambient`, `host setup`) — never a value. |
| `model` | The selected model resolves in the shipped catalog (an unknown model reports assumed limits). |
| `skills` | Discovered skill roots and skill counts. |
| `mcp:<id>` | Each configured MCP server connects and lists its tools (bounded timeout). |
| `web` | The selected web backend, including `unavailableReason` when implicit Obscura is absent. |
| `terminal` | `TERM`/`TERM_PROGRAM`, truecolor, and kitty-keyboard support. |
| `session-db` | `PRAGMA quick_check` on the durable session database (in-memory stores report without a database). |

```sh
prism-code doctor
prism-code doctor --json | jq '.checks[] | select(.status != "ok")'
```

### Config reference (`prism-code.json`)

The config file is the trust boundary: unknown keys are rejected, every value is shape-validated, and relative paths resolve against the config file's directory. When no config file exists (and none was named), the CLI proceeds with an empty `{ cwd }` config — the first-run path — but the TUI and headless modes refuse to run until a usable provider exists.

### User home (`~/.prism`)

Prism Code keeps user-level state under a single home, `PRISM_HOME` when set (absolute path required) or `~/.prism` otherwise. Directories are created lazily with mode `0700`; files the app writes are `0600`. A home that resolves to a location not owned by the current user is refused with a clear error.

```text
~/.prism/
  config.json        # global prism-code config (same schema as prism-code.json, cwd rejected)
  state.json         # app-written: last model/effort, saved credential-store choice; never secrets
  permissions.json   # app-written: per-repo always-allow approval rules (0600)
  auth.json          # only when the user chose the file credential store (0600)
  sessions/          # durable session database (sessions.db), shared across repos; scoped by canonical git root
  trust.json         # per-repo MCP server trust decisions (0600)
  bin/               # curl-installer target
  agent/             # global agent content tree (skills, AGENTS.md)
```

`state.json` is app data, not config. It is read at startup when neither config nor flags choose a model, and updated after `/provider`, `/model`, or a Shift+Tab effort change. A corrupt `state.json` is renamed to `state.json.bak`, ignored with a notice, and never fatal.

### Config layering

Layers load in order: built-in defaults → `~/.prism/config.json` → `<repo>/prism-code.json` (or `--config`) → CLI flags. Later layers win per top-level key, and object values merge shallowly one level. Two arrays accumulate across layers instead of replacing:

- `mcp.servers` concatenate; a duplicate `serverId` in the later layer replaces the earlier entry in place.
- `skills.dirs` concatenate and de-duplicate by resolved path.

Every other array (`tools.exclude`, `tools.add`, `mcp.allow`, `skills.exclude`) is replaced by the later layer. Relative paths in the global file resolve against `~/.prism`, in the project file against its own directory. Both files use the same schema and the same fail-closed validation; `cwd` (`workspaceRoot`) is project-only and rejected in the global file. `--model`/`--provider` override both files, and remembered `state.json` selection applies only when neither the config layers nor the flags choose a model.

| Key | Required | Description |
| --- | --- | --- |
| `userId` | no | Session ownership user id. Default `"local"`. |
| `cwd` | no | Workspace root for tools, sessions, and wiki. Relative paths resolve against the config directory; a provided path must be an existing directory. Defaults to the config directory. `workspaceRoot` is accepted as an alias. |
| `model` | no | `{ "provider", "model", "displayName?", "compat?", "parameters?", "metadata?" }`. Required for real runs; the TUI/headless surfaces refuse without a usable provider. |
| `credentialRef` | no | Environment variable name or host secret identifier resolved at the provider edge. Private to the process; never persisted, printed, or sent to the model. |
| `tools` | no | Tool plane and module customization (see below). |
| `skills` | no | `{ "dirs"?: [...], "exclude"?: [...], "disclosure"?: "progressive" \| "eager", "compat"?: boolean }` — layered skill roots, exclusions, progressive disclosure, and legacy layout compatibility. |
| `instructions` | no | `{ "text"?, "agentsMd"?: boolean \| path, "systemMd"?: boolean \| path \| { "globalRoot", "path"? } }`. |
| `hooks` | no | `{ "file": "path" }` — hooks.json adapter loaded onto middleware/guardrail/injector/stop-hook seams. |
| `mcp` | no | `{ "servers": [McpServerSpec...], "allow": [destination...] }`. Servers are registered only when every destination matches the allow-list; a server may set `"readOnly": true` to declare its tools read-only and exempt from approval. See [MCP servers](#mcp-servers) for the full field set, references, and repo trust. |
| `approval` | no | `{ "mode"?: "ask" \| "accept-edits" \| "auto", "timeoutMs"?: number }`. `auto` is rejected in a project config (global config, `--approve`, or `/approval` only). `timeoutMs` unset means approval waits indefinitely. |
| `checks` | no | Named `coding_check` commands: `{ "test": { "command": "bun", "args": ["test"], "cwd"?, "env"?, "timeoutMs"? } }`. The tool is registered only when at least one check is declared. |
| `web` | no | Auto: Obscura if installed, otherwise `off` without a startup warning; explicitly `"obscura"`, `"brave"`, `"off"`, or an object `{ "mode"?, "command"?, "nativeTools"?, "fetchBackend"? }`. |
| `wiki` | no | `false` (default), `true`, `"on"`, `"off"`, or `{ "enabled"?, "workspaceRoot"?, "autoDeploySkills"? }`. |
| `observationalMemory` | no | `false` (default), `true`, `"on"`, `"off"`, or `{ "enabled"?, "model"?, "credentialRef"? }`. |
| `store` | no | `{ "type": "sqlite", "path"? }` or `{ "type": "memory" }`. Default is the shared durable SQLite store at `~/.prism/sessions/sessions.db`; `path` overrides it; `memory` disables resumption. |
| `loop` | no | Named agent loop override. |
| `limits` | no | Host run-limit passthrough object. |
| `compaction` | no | Context management for long runs: `false` or `{ "strategy"?, "trigger"?, "ratio"?, "tokens"?, "entries"?, "keepRecentEntries"?, "keepRecentTokens"?, "maxSummaryChars"? }`. Defaults to LLM coding compaction with `input_ratio: 0.8`. |
| `modes` | no | ACP mode table `{ "modes": [{ "id", "name", "description"? }], "defaultModeId"? }`; ids are unique. |
| `configOptions` | no | ACP config options `{ "options": [{ "type": "boolean" \| "select", ... }] }`; ids are unique. |

### MCP servers

`mcp.servers` declares stdio commands or HTTP/SSE endpoints. Stdio entries need `command` (plus optional `args`, `env`, `cwd`); URL entries need `url`. `allow` defaults to `"stdio"` for commands and to the URL origin for endpoints. Both forms accept `namePrefix`, `readOnly`, `connectTimeoutMs`, and `enabled` (default `true`); URL entries additionally accept `headers` and `auth: "oauth"` (tokens persist in the credential store under `mcp:<serverId>`). A declaration with `enabled: false` stays configured but is reported `disabled`.

Header values resolve at connect time: `"Authorization": "Bearer ${env:GITHUB_TOKEN}"` reads the environment, and `${credential:NAME}` reads the API key stored for provider `NAME`. A reference that does not resolve leaves the server `failed` with a redacted reason instead of aborting startup. Literal secret headers (`Authorization`, `Cookie`, `X-API-Key`, …) are accepted only in the global `~/.prism/config.json`; a project config must use references, so a committed repo config cannot carry a token.

Servers declared in the global config are trusted. Servers declared in the project config (or a file named by `--config`) are not: the TUI asks once per repository and server fingerprint (command + args + env keys, or URL) and records the answer in `~/.prism/trust.json` (0600); a changed fingerprint re-prompts. Headless and ACP skip untrusted project servers — they appear as `disabled` with a reason — unless `--trust-project-mcp` is passed, which trusts them for that run without prompting.

`/mcp` inspects and controls the live plane: bare `/mcp` lists every configured server with its state, tool count, transport, and redacted error/reason; `/mcp tools <id>` lists bridged tool names and descriptions; `/mcp reconnect <id>` re-bridges one server in the background (the prompt stays usable) and updates the footer; `/mcp disable|enable <id>` unregisters or restores that server's tools for the current session only (the next run sees the change); and `/mcp login <id>` completes the OAuth round trip for an `auth: "oauth"` URL server by opening the authorization URL and prompting for the pasted callback URL or code. The footer always shows `MCP: connected/total` with failed servers highlighted.

```json
{
  "mcp": {
    "servers": [
      { "serverId": "github", "url": "https://api.githubcopilot.com/mcp/", "headers": { "Authorization": "Bearer ${env:GITHUB_TOKEN}" } },
      { "serverId": "linear", "url": "https://mcp.linear.app/mcp", "auth": "oauth" },
      { "serverId": "fs", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }
    ]
  }
}
```

### Tool inventory

`@arnilo/prism-code` bundles the coding toolset from `@arnilo/prism-coding-tools/agent`. The tool plane resolves in a fixed order: base tools → opt-in tools → `replace` → `exclude` → `add`.

| Tool | Category | Default | Enable |
| --- | --- | --- | --- |
| `shell`, `read`, `write`, `edit`, `repo_list`, `repo_search`, `glob`, `delete`, `move` | core (9) | on | disable with `tools.planes.coding: false` (bare runtime) or `tools.exclude` |
| `todo_write` | plan | on | `loop.continueOnOpenTodos: false` disables the tool and its continuation stop hook |
| `git_status`, `git_diff`, `git_commit`, `git_apply`, `git_branch`, `git_worktree`, `git_pr_handoff` | git (7) | off | `tools.planes.git: true` or `tools.optIn: ["git"]` |
| `ask_user_decision` | decision | on | host picker in the TUI; headless/ACP return "no interactive user available" guidance; disable with `tools.planes.askUser: false` or `tools.exclude` |
| `coding_check` | check | conditional | registered only when `checks` declares at least one named command; `tools.planes.checks: false` disables it |
| `load_skill` | skills | auto | registered by default (`skills.disclosure !== "eager"`); loads full skill instructions on demand |
| `recall` | memory | auto | present only while observational memory is enabled for the session |
| `web_search`, `web_fetch` | web | depends | selected web backend (below) |
| `obscura_fetch`, `obscura_scrape` | web | off | `web.nativeTools: true` with the obscura backend |
| wiki tools: `wiki_search`, `wiki_read_page`, `wiki_record_insight`, `wiki_ingest` | wiki | off | `wiki` enabled |

`tools` object shape:

| Key | Description |
| --- | --- |
| `planes` | `{ "coding"?, "git"?, "askUser"?, "checks"? }` booleans. `coding: false` assembles a bare runtime. |
| `exclude` | Tool names dropped from the resolved set. |
| `add` | Module specifiers (`./my-tools.mjs#exportName`) appended after exclusion. |
| `replace` | Map of `toolName → module specifier#export`; matching tools are swapped before exclusion. |
| `allowedModules` | Optional allow-list of module specifiers permitted to load. |
| `optIn` | Extra tool ids enabled without touching `planes` (currently `git`). |

### Skills and progressive disclosure

The skills plane is always on by default in Prism Code. Discovered skills are aggregated across 5 layers in increasing precedence (later root wins on collision):

1. `~/.agents/agent/skills` — global user-agent skills (origin: `agents`)
2. `~/.prism/agent/skills` — global Prism skills, honoring `PRISM_HOME` (origin: `prism`)
3. `skills.dirs` entries — workspace/config directories (origin: `config`)
4. `<repo>/.agents/skills` — workspace compatibility root, default on (origin: `project`), disabled with `skills.compat: false`
5. `<repo>/.agents/agent/skills` — workspace canonical root, highest precedence (origin: `project`)

`<repo>` is discovered by walking upward from `cwd` to find `.git`, with fallback to `cwd`.

#### Progressive disclosure

By default (`skills.disclosure: "progressive"`), Prism Code registers the `load_skill` tool and sends only the skill catalog (`Skill <name>: <description>`) in turn 1. When the agent invokes `load_skill({ name })`, the tool returns the skill instructions along with its resolved directory path, and marks the skill loaded in the session. Subsequent turns include the full skill instructions in the session prompt tail.

Setting `"disclosure": "eager"` switches to eager loading, where full skill instructions are included in turn 1 and `load_skill` is omitted. Specific skills can be omitted from discovery with `"exclude": ["skill-name"]`.

#### Slash commands

- `/skills` — Lists all discovered skills across all layers, showing the winning layer origin (`project`, `prism`, `agents`, `config`, or `wiki`), current session loaded state (`[loaded]` or `[not loaded]`), filesystem path, and any shadowed origins when a name collision was resolved.
- `/skill <name>` — Force-loads a skill into the current session loaded set.
- `/approval [ask|accept-edits|auto]` — Shows or sets the approval mode for this session; the footer indicator updates immediately and `auto` stays visible.
- `/permissions [revoke <n>]` — Lists the persisted always-allow rules for this repository, or revokes one by its 1-based index.

### Instructions

Prism Code ships a concise, autonomous base system prompt (`CODING_SYSTEM_PROMPT`) covering agent role, tool-use conventions (read before edit, prefer `edit` over `write`, run verification checks), task autonomy (`todo_write` for multi-step work, `ask_user_decision` only when blocked), repository safety rules, and technical output style.

#### Instruction layers

Instructions are trust-gated through the SDK instructions plane and composed in rank order:

1. **Base system prompt** — `CODING_SYSTEM_PROMPT` (or `instructions.text` from config).
2. **Global user-agent instructions** — `~/.agents/agent/AGENTS.md` (if present and user-owned).
3. **Global Prism instructions** — `~/.prism/agent/AGENTS.md` (if present and user-owned, `PRISM_HOME` honored).
4. **Repository instructions** — `<repo>/AGENTS.md` (discovered at the git root, not `cwd`, trust-gated against untrusted repositories).

#### Base prompt replacement (`SYSTEM.md`)

When present, `~/.prism/agent/SYSTEM.md` (or configured `instructions.systemMd`) replaces the base system prompt (`mode: "replace"`). Repository and global `AGENTS.md` layers continue to append after the replaced base prompt.

#### Flags and overrides

- `--no-agents-md` (`instructions.agentsMd: false`) disables auto-loading all `AGENTS.md` instruction files.
- `--no-system-md` (`instructions.systemMd: false`) disables loading `SYSTEM.md`, ensuring the default base prompt remains active.

#### Environment context block and prefix stability

An environment block is injected dynamically per run via a context provider (`createEnvironmentContextProvider`):
- Working directory (`cwd`)
- Repository root (`repoRoot`)
- Operating system and architecture (`process.platform (process.arch)`)
- Shell (`process.env.SHELL`)
- Current date (`YYYY-MM-DD`)
- Git branch and dirty state
- Active model id

The base prompt and environment block stay within 2 KB. Because the environment block enters via a context provider into the prompt tail rather than the system prefix, the leading prompt cache prefix remains stable and byte-identical across runs, branches, and dates.

### Run limits

Prism Code defaults to unbounded execution across all surfaces (TUI, headless, and ACP). Every policy axis is disabled by default (`null`):
- `maxTurns: null`
- `maxProviderAttempts: null`
- `maxToolRounds: null`
- `maxToolCalls: null`
- `maxWallTimeMs: null`
- `maxInputTokens: null`
- `maxOutputTokens: null`
- `maxTotalTokens: null`
- `maxStopContinuations: null`

Byte envelopes remain strictly bounded to process-safety ceilings (64 MiB request and response) via `HARD_RUN_LIMITS`.

Unbounded runs can spend without a cap; set `limits.maxCost` or `--max-cost` to bound it.

Configured limits narrow per invocation:
- In `prism-code.json`: `limits: { "maxTurns": 10, "maxCost": { "amount": 2.50, "currency": "USD" } }`.
- Via flags: `--max-turns <n>` and `--max-cost <amount>` narrow the configured or default limits for that command invocation.
- A configured `maxCost` stops the run cleanly with a finish reason (`host_policy`), not a crash.
- Independent tool concurrency can be configured under `loop: { "toolConcurrency": 4 }`.

### Approvals and permissions

Every guarded tool action (shell, mutations, destructive git, unclassified MCP tools) passes through one
policy shared by the TUI, headless, and ACP surfaces; hard denies from the execution-security rules
(`evaluateCommandRules` default patterns, path containment) can never be overridden by a mode or a
persisted rule.

| Mode | Behavior |
| --- | --- |
| `ask` (default) | Prompts for shell commands, mutations outside the workspace, and destructive git; in-repo edits prompt too. |
| `accept-edits` | Auto-allows file edits inside the workspace; prompts for shell and destructive git. |
| `auto` | Allows everything except execution-security hard denies. Always visible in the footer as `approvals:AUTO`. |

- The mode comes from the global config (`approval.mode`), a headless `--approve <deny|edits|all>` override,
  or the interactive `/approval <mode>` command. A project `prism-code.json` may set `ask` or
  `accept-edits` but never `auto`; unknown keys and invalid values fail closed.
- There is no approval timeout by default: an autonomous run waits for the operator. Set
  `approval.timeoutMs` to auto-deny after a bounded wait.
- The TUI prompt offers `[a] Allow once`, `[r] Allow for run`, `[w] Always allow`, and `[d] Deny (Esc)`.
  **Always allow** persists to `~/.prism/permissions.json` (mode `0600`), keyed by the canonical
  repository root and scoped by tool name plus, for `shell`, the approved command prefix (first two
  tokens). `/permissions` lists the rules and `/permissions revoke <n>` removes one; rules never apply
  to another repository.
- MCP tools follow the bridge's effect declaration: a server configured with `"readOnly": true` maps to
  an `effect.kind: "none"` policy and bypasses approval; unclassified tools keep the bridge's
  `external_mutation` default and are treated as mutating.
- Headless `--approve deny` (the default) refuses approval-required calls with a model-visible message
  and exits nonzero when any call was refused; `edits` maps to `accept-edits` and `all` to `auto`.
- ACP keeps delegating human approval to the client's permission request (`interruptBeforeTool`); the
  shared policy still enforces hard denies and path containment before any tool runs.
- Durable mutations (`edit`, `write`, `delete`, `move`) run under a verified local identity: the TUI and headless
  surfaces assert `tenantId: local` with `userId` from `config.userId` (default `local`), so a local single-user
  install can edit files while core's durable-effect path stays fail-closed for an unconfigured host. A host that
  embeds the SDK can supply its own `identity`/`ownership` on the agent config instead.

### Autonomy and task completion

Prism Code keeps a multi-step run going after a premature text-only turn while the model's own plan
has open items:

- **`todo_write` (on by default).** The model replaces the full list (`pending | in_progress |
  completed | cancelled`) and gets the rendered list back. The list is stateless: the latest
  successful result in the transcript is the current list, so it survives resume and compaction.
- **Completion stop hook.** At a natural loop end, `createTodoContinuationStopHook()` inspects the
  latest `todo_write` result. Open items queue a continuation steer listing them; an absent list,
  an all-closed list, or a user Esc abort stops the run. After 2 consecutive continuations with no
  new tool call and no list change the run stops and the TUI shows `Stopped: no progress on open
  todos`.
- **TUI panel.** The latest list renders as a live one-line todo card above the input while items
  remain.
- **Disable.** `loop: { "continueOnOpenTodos": false }` removes both the tool and the continuation
  stop hook.

Operator control is maintained at all times:
- In the interactive TUI, **Esc** aborts the current run, and pressing **Ctrl+C** with empty input exits. Uncaught exceptions and unhandled rejections restore the terminal, print an error to stderr (stack with `PRISM_DEBUG=1`), persist the session, and exit `1`; SIGTERM/SIGHUP abort the active run, persist, restore the terminal, and exit `143`/`129`.
- In headless mode, **SIGINT** and **SIGTERM** abort the run in flight, persist durable session state, and cleanly exit with codes `130` and `143` respectively.
- Transient provider errors (429, 5xx, network hiccups) are retried with exponential backoff under unbounded provider attempts, allowing long-running tasks to survive upstream rate limits without interruption.

### Context management and long runs

Prism Code is configured by default for deep, unbounded execution without context window exhaustion:

- **Default LLM coding compaction:** Uses the current provider/model selection to synthesize structured summaries prioritizing modified/read paths, patch intent, test failures, and blocker state. Raw history is preserved in the durable session store.
- **Observational Memory option:** Setting `compaction: { "strategy": "om" }` delegates compaction to observational memory (`@arnilo/prism-memory/compaction/observational-memory`).
- **Configurable triggers:**
  - `input_ratio` (default `0.8`): Evaluates against the model's resolved context window and compacts when estimated context reaches 80% capacity. When the model declares no resolvable input cap, the default falls back to a fixed 20,000-token input budget instead of failing the run (an explicitly configured `input_ratio` still fails closed).
  - `each_turn`: Triggers compaction after each provider turn in multi-turn runs.
  - `threshold_tokens`: Compacts when estimated input exceeds a token threshold.
  - `threshold_entries`: Compacts when session entries exceed a count.
  - `compaction: false`: Explicitly disables auto-compaction.
- **Mid-run between-turn auto-compaction:** In iterative multi-turn runs, auto-compaction evaluates before assembling turns after the first (`turnIndex > 1`). Compaction occurs strictly at turn boundaries after tool results are committed, guaranteeing that an assistant tool call is never split or orphaned from its result. Following compaction, active loop history is synced in place, so post-compaction turns still reach the run result and the stop hooks.
- **Keep budget:** The LLM strategies keep a recent *token* budget rather than an entry count. Prism Code derives it from the window as `min(20,000, window / 2)` tokens, so it always sits below the compact trigger; a keep budget above the trigger would turn every compaction into a no-op that still pays for a summary request. `compaction.keepRecentTokens` sets that budget explicitly — for a cheaper or tighter tail when summaries are expensive — and is capped the same way at half the window. `keepRecentEntries` is the OM/entry-count equivalent.
- **Plan pinned across cuts:** The latest successful `todo_write` turn (assistant call plus the tool results of that turn) is added to the compaction's kept entries, so a plan written once at the start of a long run stays in the transcript no matter how many compactions follow. Without the pin a cut would hide the plan from the model and silently disable the todo continuation hook, which reads the list from history.
- **Resilient fallback:** Compaction errors (such as summarizer 429 rate limits) emit a `compaction_failed` event and continue uncompacted without crashing the run. A configuration error — the trigger cannot resolve the model's input cap — still fails loudly.
- **Tool-result folding:** Older tool outputs (>4KB, min age 2 turns) are folded into compact summaries, keeping the prompt lean.
- **Context budget:** Enforces a 95% input token budget relative to the model's context window, demoting non-essential blocks to avoid hard provider overflows.
- **Autonomy and task completion:** A multi-step run continues past a premature text-only turn while `todo_write` items stay open, and an all-closed list or Esc stops it; see [Autonomy and task completion](#autonomy-and-task-completion).
- **TUI visibility:** Compaction events surface in the chat stream as system notes carrying the summary (`[Compacted history] …`), falling back to `"Compacted 8 entries"` when no summary text is present.

### Sessions

- Default store: one durable SQLite database at `~/.prism/sessions/sessions.db` (WAL, `busy_timeout` 5 s), shared by every repository and scoped by the canonical git root (`git rev-parse --show-toplevel`, falling back to the real `cwd`) recorded in session metadata. `<cwd>/.prism/` is no longer created; a legacy `<cwd>/.prism/sessions.db` is left untouched and reported once at startup. `{ "type": "sqlite", "path": "..." }` overrides the location, `{ "type": "memory" }` disables resumption.
- `/new` creates a fresh durable session for the canonical repository root; `/resume` searches prior sessions for that root (newest first, searchable picker) and resumes the chosen leaf. Options show the session title, relative last-activity time, and message count.
- Titles come from the first prompt (first line, redacted, ≤ 80 chars, stored in session metadata without clobbering other keys) and stay fixed on later runs; `/rename <title>` replaces one explicitly.
- Resumed history replays stored entries through the same reducer as live events: assistant text, collapsed thinking blocks, tool calls with real success/error/denied status and collapsed results, and compaction summaries. The last run's model is restored when its provider is still available. Transcript rendering is bounded by the existing scrollback cap (default 500 entries).
- `--session <id>` resumes that exact session at startup (unknown id exits 1 before creating anything); `--continue` resumes the newest session for the repository; `--resume` opens the picker at startup. `--session`, `--continue`, and `--resume` are mutually exclusive, and the in-memory store rejects all three with a clear error.

### Providers and models

One descriptor table (`SHIPPED_PROVIDERS`) drives the `/provider` picker, startup auto-detection, and provider resolution: id, env vars, auth kinds, catalog default model, and the lazy adapter factory. Nothing else lists providers.

Credential precedence for a configured provider, first hit wins:

1. explicit `credentialRef` from config — env var, then the store under the same name;
2. stored API key (a key saved by `/provider` beats ambient env vars);
3. stored OAuth credentials (OAuth providers; refreshed proactively — see below);
4. provider env vars (`PROVIDER_ENV_VARS`).

OAuth providers (`openai-codex`, `xai`) get a refreshing access-token source, never a frozen string: the adapter reads the stored `OAuthCredentials` per request, refreshes via the provider's `refresh` when expiry is within 60 s, persists the refreshed tokens in the credential store, and shares one in-flight refresh per provider (concurrent requests trigger a single round-trip). `OPENAI_ACCESS_TOKEN` (and stored API keys) still win as static overrides. A refresh that fails while the token is still valid keeps serving it; once hard-expired it fails the run with a redacted `run /provider to log in again` message and keeps the previous credentials stored. Anthropic is API-key only — `@arnilo/prism-providers` ships no Anthropic OAuth adapter.

With no config, no flags, and no remembered model, startup auto-detects the first provider that has a credential, in this order: anthropic, openai, openai-codex, google, xai, openrouter, deepseek, zai, alibaba, kimi-coding, moonshot, commandcode, neuralwatt, opencode-go, typesafe, laya, hyper, clinepass. It selects the descriptor's catalog default (anthropic `claude-sonnet-5`, openai `gpt-5.1`, codex `gpt-5.1-codex`, google `gemini-2.5-pro`, xai `grok-4.6`, openrouter `openrouter/auto`, deepseek `deepseek-v4-pro`, hyper `deepseek-v4-flash`, …). Providers without a shipped catalog (alibaba), local runtimes (ollama, mock), and host-setup providers (azure, bedrock, vertex) are never auto-detected.

| Provider | Env vars | Default model |
| --- | --- | --- |
| anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-5` |
| openai | `OPENAI_API_KEY` | `gpt-5.1` |
| openai-codex | `OPENAI_ACCESS_TOKEN`, `OPENAI_API_KEY` | `gpt-5.1-codex` |
| google | `GEMINI_API_KEY`, `GOOGLE_API_KEY` | `gemini-2.5-pro` |
| xai | `XAI_API_KEY` | `grok-4.6` |
| openrouter | `OPENROUTER_API_KEY` | `openrouter/auto` |
| deepseek | `DEEPSEEK_API_KEY` | `deepseek-v4-pro` |
| zai | `ZAI_API_KEY` | `glm-5.2` |
| kimi-coding | `KIMI_API_KEY`, `MOONSHOT_API_KEY` | `kimi-for-coding` |
| moonshot | `MOONSHOT_API_KEY` | `kimi-k2.7-code` |
| clinepass | `CLINEPASS_API_KEY` | `cline-pass/glm-5.2` |
| commandcode | `COMMANDCODE_API_KEY` | `claude-opus-5` |
| neuralwatt | `NEURALWATT_API_KEY` | `glm-5.2` |
| opencode-go | `OPENCODE_GO_API_KEY` | `grok-4.5` |
| typesafe | `TYPESAFE_API_KEY` | `jev-preview` |
| laya | `LAYA_API_KEY` | `laya` |
| hyper | `HYPER_API_KEY` | `deepseek-v4-flash` |

Enterprise (host-setup) providers fail closed rather than guessing: Azure OpenAI requires `AZURE_OPENAI_ENDPOINT` (absolute https URL) plus `AZURE_OPENAI_API_KEY` and sends the key with `api-key` auth; Bedrock requires `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (optional `AWS_SESSION_TOKEN`, `AWS_REGION`) and uses the native Converse adapter; Vertex requires `GOOGLE_PROJECT_ID` (or `GOOGLE_CLOUD_PROJECT`), location from `GOOGLE_VERTEX_LOCATION`/`GOOGLE_CLOUD_LOCATION` (default `us-central1`), and ADC.

`/provider` never selects the literal model `default`: it applies the provider's catalog default (or, for host-defined catalogs such as Azure deployments or Bedrock profiles, keeps the current model id and says so) and then opens the `/model` picker with the default first. Credentials are handed to adapters as `CredentialValueSource` functions, never copied into config objects; env values are never written to the store implicitly.

The shipped `mock` provider is ambient (no credential) and offline: with no script it streams `Mock response`. `PRISM_CODE_MOCK_SCRIPT` (absolute path, tests only) points at a JSON file of scripted provider turns — an array of `ProviderEvent` arrays, one per `generate` call, e.g.

```json
[[{ "type": "tool_call", "call": { "type": "tool_call", "id": "c1", "name": "read", "arguments": { "path": "a.txt" } } }],
 [{ "type": "content_delta", "content": { "type": "text", "text": "Done." } }, { "type": "done" }]]
```

Each turn is consumed once; once the script is exhausted the provider emits a bare `done`. The PTY end-to-end journeys (`bun test scripts/e2e-prism-code-tui.test.mjs`, after `bun run build`) drive the built binary with this provider under a temporary `PRISM_HOME` and assert on the rendered screen.
### Credentials

One `PrismCodeCredentialManager` per process serves the TUI, headless, ACP, `/compact`, and the observational-memory worker. The store is chosen by `credentials.store` (default `"auto"`):

| `credentials.store` | Store |
| --- | --- |
| `"auto"` (default) | One keychain probe (≤ 1 lookup, skipped when the choice is explicit) at startup. Keychain when available; otherwise the choice recorded in `state.json`; otherwise the TUI asks once — file, encrypted file, or session only. |
| `"keychain"` | OS keychain under the `prism-code` service. |
| `"file"` | `~/.prism/auth.json`, plaintext at rest, `0600`, parent `0700`; a file with group/other bits is refused with a `chmod 600` hint. |
| `"encrypted-file"` | `~/.prism/credentials.enc` (AES-256-GCM + scrypt); passphrase from `PRISM_CREDENTIALS_PASSPHRASE` or the masked TUI prompt. |
| `"memory"` | Session only; nothing is written. |

Headless and ACP never prompt: they use the recorded choice and fail with an actionable message only when a credential is actually needed and absent (environment variables always work). There is no silent fallback from the keychain to a plaintext file. Keys saved by `/provider` are read back by `getApiKey`, the provider resolver, `/compact`, and the observational-memory worker; OAuth tokens are stored through the same store (`setOAuth`/`getOAuth`) and refreshed in place. `PRISM_HOME` relocates the whole home, including the credential files.

### First run

Launching the TUI with no usable provider does not print a notice and exit: it opens onboarding in the running renderer, and the agent is assembled only after a usable selection exists.

1. If no durable store has been chosen yet, the one-time store picker runs first (so a key entered next is saved where the operator wants it).
2. The provider picker lists every shipped adapter with its credential status; selecting one runs the same API-key/OAuth/host-setup flow as `/provider`.
3. API keys and OAuth codes are entered in the masked `SecretInput` component — `•` per character, paste supported (newlines stripped), Enter submits, Esc cancels. The secret never enters an edit buffer, reducer state, stream entries, or history; the buffer is cleared on submit or cancel. A pasted/typed key is verified against the provider's model-list endpoint before it is stored (5 s cap); a failed check shows an explicit `Save anyway` / `Discard` choice and stores nothing unless the operator insists. Providers with no discovery endpoint are stored unchecked and say so.
4. The model picker opens with the provider's catalog default first.

Cancelling credential entry returns to the provider picker instead of dropping out. Esc at the provider picker exits cleanly (status 0). Auth failures and already-set environment credentials never surface a value. Headless and ACP have no onboarding: without a usable provider they exit 1 with `prism-code: no usable credential for "<provider>". Set <ENV>, or run "prism-code" to set it up.` (or the no-provider variant when no model is configured).

### Switching models

The agent is assembled with a `providerSource` resolver, never a fixed provider instance — a fixed agent-level provider would shadow every per-run override in core. One provider cache holds at most one instance per provider id, built lazily on first use and reused by the assembled agent, `/model`, `/provider`, `/compact`, and the observational-memory worker.

A single `ActiveSelection` (`{ model, effort }`) is the only selection state; the status footer mirrors it and every run derives its options from it (`model`, `providerSource`, `thinkingLevel`). Consequently:

- `/model` (catalog or live discovery), `/provider` (catalog default), and Shift+Tab (declared effort levels) take effect on the **next** run — no restart, no re-assembly, no MCP reconnect. Switching models performs at most one provider construction per provider id and no network call beyond the discovery the command itself makes.
- `/compact` and `/om` workers resolve the active selection through the same cache (the OM worker keeps its own configured model when one is set).
- `/logout` and a newly stored API key clear the cache, so a later run cannot keep using an instance built against the deleted or previous credential.
- The selection is written to `~/.prism/state.json` (`lastModel`, `lastEffort`) on every change and restored at the next launch; a restored effort is clamped to the model's declared levels.
- Embedders calling the SDK surfaces directly (`assembleAppAgent`, `createPrismCodeAcpAgent`) get the same behavior: `RunOptions.model` plus `RunOptions.providerSource` override the agent for one run. `AgentSdkConfig` accepts `provider` **or** `providerSource`.

Model limits and capabilities come from the provider's shipped catalog at selection time. A model the catalog does not describe (host-defined Azure/Bedrock/Vertex deployment ids, or a model newer than this build) gets conservative assumed limits — 32,000 context window, 4,096 max output tokens — so compaction triggers early instead of overflowing the real window, and the footer line 2 appends ` | limits assumed (32,000 ctx) — "<model>" is not in the <provider> catalog`. Effort levels are never invented: a model with no declared levels stays `unavailable` until `/model` discovers real capabilities.


| Mode | Search | Fetch | Setup |
| --- | --- | --- | --- |
| `"obscura"` (automatic when installed) | `web_search` | `web_fetch` (Markdown) | Host-installed Obscura binary: resolved from absolute PATH entries, or pinned with `web.command` (absolute path only). Missing implicit default ⇒ `off`, no startup warning; explicit `web.mode: "obscura"` with missing binary ⇒ both tools omitted and setup note shown. Unavailable reason retained for diagnostics (`/tools` and `doctor` in plan 139 Task 6). |
| `"brave"` | `web_search` (Brave) | `web_fetch` (Firecrawl) | Brave credential (`brave` credential, `BRAVE_API_KEY`/`BRAVE_SEARCH_TOKEN`); fetch needs a Firecrawl credential (`FIRECRAWL_API_KEY`). `web.fetchBackend: "off"` registers search only and says so. |
| `"off"` | — | — | No web tools registered. |

Wiki settings: `workspaceRoot` defaults to `cwd`; `autoDeploySkills` (default `false`) must be opted in before wiki skills are written to `<workspace>/.agents/skills`. A `/wiki-ingest url=...` source is fetched only through the selected web plane's `web_fetch` hook after an SSRF check; without a fetch backend the hook is absent and URL ingest fails closed.

## Outputs / response / events

### TUI

- Message stream with bounded scrollback (`maxScrollback`, default 500 entries), tool-call cards, and error entries. Parallel tool cards update by call id, including out-of-order finishes; control sequences in assistant text and tool output render inert. User messages use `You:`, assistant replies render as **markdown** (headings, emphasis, lists, tables, and fenced code highlighted with the bundled tree-sitter grammars for JS/TS, Markdown, and Zig; other languages render unhighlighted), and system notes use dimmed `Note:`. Tool output, diffs, and errors are always plain text — never interpreted as markdown or ANSI.
- Assistant markdown streams in place; fenced code blocks appear as they arrive (an unclosed fence renders as code). Thinking blocks collapse to one dimmed line (`▸ Thinking… (Ctrl+T to expand)`); **Ctrl+T** expands/collapses all of them for the session.
- Tool cards show a status glyph, tool name, a one-line argument summary, elapsed time when reported, a bounded output preview (first 6 lines collapsed), and — for `edit`, `write`, and `git_apply` — the unified diff. Finishing an `edit` replaces the pre-run proposal patch with the patch actually applied. **Ctrl+O** expands the most recent card; expanded previews are capped at 2,000 lines. Stored output is bounded to ~16 KiB (head 100 + tail 50 lines plus an omitted-lines marker) and patches over 64 KiB are dropped rather than truncated.
- Approval prompts for guarded tool actions with `Allow once` / `Allow for run` / `Always allow` / `Deny` and no timeout by default; the prompt fails closed (denied) when no approval UI is available. Mutating tools (`edit`/`write`/`git_apply`) show the proposed unified diff in the prompt before the decision (the proposal is derived from the call arguments, since the file is not read until after approval). Persisted always-allow rules live per repository (see [Approvals and permissions](#approvals-and-permissions)).
- Status footer, two lines:
  - Line 1: `<repo-basename> @ <branch>` (or `(no git)`) on the left, `<model-id> [effort: <level>] [approvals:<mode>]` on the right; `auto` renders as `approvals:AUTO`.
  - Line 2: `MCP: <connected>/<total>` (with ` (n failed)` when any server is failed) plus ` | OM: off` or ` | OM: on (provider/model)` when observational memory has a session state, plus the usage meter, plus ` | limits assumed (…)` when the active model has no catalog entry (see [Switching models](#switching-models)). Counts come from the cached MCP plane status; `/mcp` shows the detail.
  - Usage meter: `ctx <used>/<cap> <pct>%` for the next request (estimated input tokens against the model's input cap, from the session's cached assembly estimate — no extra tokenization; the number is prefixed `~` when it is an estimate rather than provider-reported). The context segment turns amber at 70% and red at 90% of the cap. It is followed by cumulative session tokens `↑<input> ↓<output>` (cache reads count as input) and by `$<cost>` when the provider reported pricing (estimated usage is never priced). The meter refreshes on every provider turn and after manual compaction. On narrow terminals the cost drops first, then the cumulative token totals; the context percentage stays.
  - Below 50 columns the left collapses to the branch (or repo name) and the right to the model id plus the approval mode.
- Input editor: Enter submits (a multi-line prompt submits whole); **Shift+Enter**, **Alt+Enter**, and **Ctrl+J** insert a newline, and a trailing `\` + Enter continues the line (terminals without the kitty keyboard protocol cannot report Shift+Enter, so the fallbacks are the portable ones). Bracketed paste is supported; a paste over 10 lines or 2 KiB collapses to `[pasted N lines]` in the buffer and expands on submit, and multi-line pastes never submit. **Up/Down** walk prompt history from the first/last buffer line; history is persisted per repository in `~/.prism/history.jsonl` (owner-only, capped at 500 entries per repository) and never records masked secret prompts.
- Completion: typing `/` opens a filtered slash-command popup (with descriptions) and `@` opens a repository file popup fed by `git ls-files` (tracked + untracked, bounded walk fallback). **Tab/Enter** accept, **Up/Down** navigate, **Esc** dismisses. An accepted `@path` is attached to the submitted prompt (bounded like the `read` tool, max 64 KiB per file, truncated with a marker); a path that resolves outside the repository root — including through a symlink — is refused with a notice.
- Keybindings: **Shift+Tab** cycles reasoning effort through the model's declared levels (a non-reasoning model shows `off`, a model with no declared levels shows `unavailable`, neither cycles); **Ctrl+T** expands/collapses thinking blocks; **Ctrl+O** expands/collapses the most recent tool card; **Esc** closes a popup or aborts the active run; **Ctrl+C** clears non-empty input, then aborts a running turn, and a second press within 2 s exits (empty input while idle exits immediately); **Ctrl+D** quits; **Enter**/**Shift+Enter** etc. as above. The effort level is forwarded to runs as `thinkingLevel`.
- Slash commands (all handled locally; slash text is never forwarded to the provider):

| Command | Behavior |
| --- | --- |
| `/provider` | Searchable picker over the shipped provider adapters; runs API-key, OAuth, ambient, or host-setup onboarding as the provider requires. Secrets are prompted masked and never echoed; a new API key is verified against the provider's model-list endpoint before it is stored, and a failed check requires an explicit `Save anyway` (anything else stores nothing). Ends by applying the provider's catalog default model (never the literal `default`) and opening `/model` with that default first. Each row shows its status — `env <VAR>`, `stored key`, `oauth (expires …)`, `ambient`, `host setup (env)`, or `not configured` — never a value. |
| `/logout [provider]` | Revokes stored OAuth tokens when the provider supports it, then always deletes the stored OAuth entry and API key locally (an upstream revoke failure still fails closed). Without an argument it signs out the only stored provider, or shows a picker when several exist. Environment variables are never removed, and no token or key value is ever echoed. |
| `/model` | Live model discovery for the active provider (6 s timeout) with static catalog fallback. Options are badged `[live]`, `[offline/cached]`, or `[catalog]`; the effort level is revalidated against the selected model. |
| `/new` | Creates a fresh durable session. Refused while a run is active. |
| `/clear` | Clears the screen and creates a fresh durable session (alias of `/new` with a screen clear). Refused while a run is active. |
| `/exit` | Quits Prism Code cleanly (aborts and persists the active run first, like Ctrl+D). |
| `/tools` | Lists active tools grouped by source — built-in, opt-in, MCP server (state and tool count), web backend, and user modules — with enabled/disabled state. Shows the web `unavailableReason` when implicit Obscura is absent. |
| `/export [path]` | Writes the session transcript as markdown (headings per role, thinking in `<details>`, tool calls as JSON, tool results in fences) to `./prism-session-<id>.md` or the given path. Entries pass through secret redaction and the file is written `0600`; an existing file prompts for confirmation before overwriting. |
| `/resume` | Searchable chooser over sessions for the canonical repository root (title, relative activity, message count) that resumes the selected leaf. Refused while a run is active, and with in-memory stores. |
| `/rename <title>` | Sets or replaces the session title stored in session metadata (first line, ≤ 80 chars, redacted). Display-only; unsupported stores report a notice. |
| `/compact` | Compacts the active branch with the coding LLM summarization strategy (one provider call by default). Refused while a run is active; a failure leaves the session leaf untouched. |
| `/om` | Toggles observational memory for the session (default off). Refused while a run or worker flush is active. |
| `/om-model` | Selects the independent observer/reflector/dropper model; selection survives process restarts for the session. |
| `/om:status`, `/om:view` | Counts/thresholds and the rendered observational-memory ledger. |
| `/approval [mode]` | Shows or sets the approval mode (`ask`, `accept-edits`, `auto`) for this session; `auto` is always visible in the footer. |
| `/permissions [revoke <n>]` | Lists the persisted always-allow rules for this repository, or revokes one by 1-based index. |
| `/mcp [reconnect\|login\|disable\|enable\|tools] [id]` | Renders cached MCP plane status (state, tool count, transport, redacted error/reason) with no network calls. `reconnect <id>` re-bridges in the background so input stays usable; `login <id>` runs the OAuth round trip for an `auth: "oauth"` URL server (opens the authorization URL, then prompts for the pasted callback URL or code); `disable`/`enable <id>` unregister or restore that server's tools for this session only; `tools <id>` lists bridged tool names and descriptions. Output never includes header, env, or token values. |
| `/help` | Lists built-in commands plus every contributed extension command (for example the four wiki commands). |
| `/wiki-init`, `/wiki-refresh`, `/wiki-lint`, `/wiki-ingest` | Registered only when the wiki plane is enabled; executed with the session id and host command drivers, and their output is truncated at 16 KiB. |

### Headless

- `print`: assistant text streamed to stdout, newline terminated. Failures print `prism-code: <message>` to stderr.
- `json`: one JSON object per line — `{ "type": "event", "sessionId", "runId"?, "event" }` for agent events, or `{ "type": "error", "error": { "message" } }` for a failure.
- Exit code `0` on a successful run, `1` on failure (including `agent_denied`, `run_limit_exceeded`, `budget_exhausted`, an unusable provider, or any approval refused under `--approve deny`).

### ACP

`prism-code acp` serves newline-delimited ACP v1 JSON over stdio until the client closes stdin; an `EPIPE` on stdout is a normal shutdown. The same config supplies the session model, `credentialRef`, session store, `mcp.allow` destination allow-list, `modes`, and `configOptions`. Coding tools bind to `config.cwd`; a client-supplied `cwd` never moves them.

## Request/response example

`prism-code.json`:

```json
{
  "userId": "local",
  "cwd": ".",
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
  "web": { "mode": "obscura", "nativeTools": false },
  "wiki": { "enabled": true, "autoDeploySkills": false },
  "observationalMemory": { "enabled": false },
  "store": { "type": "sqlite" }
}
```

One `json` mode line (abridged):

```json
{ "type": "event", "sessionId": "session_1", "runId": "run_1", "event": { "type": "message_delta", "sessionId": "session_1", "runId": "run_1", "content": { "type": "text", "text": "Reading " } } }
```

## Implementation example

Headless run with the offline mock provider (the same shape as [`examples/prism-code-headless.ts`](../examples/prism-code-headless.ts)):

```ts
import { createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { type PrismCodeConfig, runHeadless } from "@arnilo/prism-code";

const config: PrismCodeConfig = {
  cwd: process.cwd(),
  model: { provider: "mock", model: "mock" },
  store: { type: "memory" },
};

const exitCode = await runHeadless({
  config,
  prompt: "Summarize the repository architecture",
  mode: "print",
  provider: createMockProvider([providerTextDelta("Repository summary."), providerDone()]),
});
```

Embedding the TUI or ACP surface reuses the same assembled definition:

```ts
import { assembleAppAgent, createPrismCodeAcpAgent, createPrismCodeTui, type PrismCodeConfig } from "@arnilo/prism-code";

const config: PrismCodeConfig = { cwd: process.cwd(), model: { provider: "mock", model: "mock" } };
const definition = await assembleAppAgent(config);

const tui = createPrismCodeTui({ config, sessionId: "local" });
await tui.start(definition);

// Or serve ACP for an editor client:
const acp = await createPrismCodeAcpAgent({ config });
```

## Extension and configuration notes

- **Custom tools** load through `tools.add` / `tools.replace` with an optional `allowedModules` allow-list; module paths resolve against the config directory, contain no query/fragment tricks, and are loaded dynamically only at assembly time. `resolveCodingToolSet` exposes the same resolution pipeline for hosts. In the standalone binary a module still loads from disk and resolves its own dependencies, so an `@arnilo/prism` it imports is a separate copy (core `instanceof` checks do not match); write such modules against the plain `ToolDefinition` shape (`{ name, description, execute }`). `allowedModules` entries are matched as given (absolute paths or path prefixes); relative entries are not resolved against the config directory.
- **Skills** are discovered across 5 layered roots by default (global `~/.agents` and `~/.prism`, configured `skills.dirs`, and repo roots) with progressive disclosure (`load_skill` tool) and slash commands (`/skills`, `/skill <name>`). Wiki skills integrate as additions.
- **Instructions** layer `instructions.text`, `AGENTS.md` auto-load, and `SYSTEM.md` (global root + optional path). Both file loaders can be disabled per run with CLI flags.
- **Hooks** load from `hooks.file` through the `hooks.json` adapter.
- **MCP** servers register only when trusted and after the `mcp.allow` destination check (WHATWG origin plus path-segment subtree for HTTP/SSE, the explicit `stdio` marker for stdio); the unstable `acp` transport is never bridged.
- **Web and wiki** are ordinary planes: the resolver returns inert `ToolDefinition[]`/`Skill[]`/`CommandDefinition[]` contributions and setup notes; no extension is loaded when wiki is disabled.
- **Public surface**: `loadPrismCodeConfig`/`loadPrismCodeConfigLayer`/`parsePrismCodeConfig`/`parsePrismCodeConfigLayer`/`validatePrismCodeConfig`/`validatePrismCodeConfigLayer`/`validateGlobalPrismCodeConfigLayer`/`mergePrismCodeConfigLayers`, `resolvePrismHome`/`ensureHomeDir`/`readGlobalConfig`/`readState`/`writeState`, `resolvePrismCodeVersion`, `resolveCodingToolSet` + `BUNDLED_CODING_TOOLS`, `resolveSkillRoots`/`findRepoRoot`/`inspectSkills`/`formatSkillsList`/`createSkillCommands`, `resolveWebTools`, `resolveWikiContributions`, `PrismCodeCredentialManager`/`selectCredentialStore`/`MemoryStoredCredentialStore`/`UnavailableStoredCredentialStore`/`describeProviderCredentialStatus`/`formatProviderCredentialStatus`/`logoutProvider`/`createOAuthTokenSource`/`resolveOAuthProvider`, the provider inventory helpers (`createProviderCache`/`ProviderCache`, `enrichModelConfig`/`ModelEnrichment`, `UNKNOWN_MODEL_LIMITS`, `defaultModelForProvider`, `autoDetectProvider`, `validateProviderKey`, …), `ActiveSelection`/`selectionRunOptions`, `assembleAppAgent`, `runHeadless`, `createPrismCodeTui`, `entriesToUiEntries`, `sessionEntryToUiActions`, `deriveSessionTitle`/`formatRelativeTime`/`resolveContinueSessionId`/`sessionRecordExists`/`setSessionTitle`, `createPrismCodeAcpAgent`, `mcpServerOrigins`/`resolveMcpServers`/`parseMcpHeaderReference`/`resolveMcpHeaderValue`/`mcpServerFingerprint`/`readMcpTrust`/`writeMcpTrustDecision`/`isMcpServerTrusted`/`createMcpAuthOptions`/`createMcpAuthState`, and `handleSlashCommand`/`parseCommandArgs`/`executeLogoutCommand`/`executeResumeSessionCommand`/`executeRenameCommand` are exported from the package root.
- **CLI overlay**: `--model`, `--provider`, `--no-agents-md`, and `--no-system-md` override the parsed config without rewriting the file.

## Security and performance notes

- **Config = trust boundary.** Unknown keys are rejected so a typo cannot silently disable a security-relevant option; all path-bearing values resolve against the config directory (the global file resolves against `~/.prism`); `web.command` must be an absolute path to the trusted Obscura binary (a repo-supplied relative binary is refused); `credentialRef` is length- and control-character-checked; the global file cannot set `cwd`, and the home directory is refused when it resolves to a location not owned by the current user. The first-run exception (no config file, no provider) launches TUI onboarding instead of silently defaulting to a model, and headless/ACP fail closed with the env var to set.
- **Skill safety and ownership.** User-global roots (`~/.agents`, `~/.prism`) are checked for ownership by the current process UID (`isUserOwned`) and skipped silently if not owned by the current user. Repo roots follow workspace trust. Skill `scripts/` are never executed automatically without going through standard shell tool approval policies.
- **Credentials stay private.** Values are resolved at the provider edge through the credential manager or environment refs, prompted masked in the TUI (masked `SecretInput`, paste included, nothing written to an edit buffer or history), excluded from stream history, and never written into config, argv, events, or the model context. The provider cache stores resolved adapter instances (whose credential sources re-read the store per request), never raw keys, and is cleared on `/logout`. The store is an explicit choice: `auto` probes the keychain once and otherwise asks in the TUI or fails closed in headless/ACP, the owner-only `auth.json` is refused when group/other bits are set, and an unavailable store never silently falls back to plaintext. OAuth login paths exist only for the providers that ship an authorized OAuth flow; ambient (`ollama`) and host-setup enterprise providers use their own environment/toolchains. OAuth refresh is proactive (60 s skew, one in-flight refresh per provider) and refresh/revoke failures are redacted before they reach the stream; logout always deletes locally even when upstream revocation fails.
- **MCP default-deny.** No allow-list entry, no server. Ambiguous path forms, embedded credentials, query strings, fragments, and the `acp` transport fail the destination check; stdio servers require the `stdio` marker.
- **MCP server trust.** Project-declared servers are untrusted until the user approves the exact command/args/env-keys fingerprint (or URL) once per repository; the decision lives in `~/.prism/trust.json` (0600). Header references resolve only at connect time and resolve failures are reported as redacted `failed` status; literal secret headers in a project config are rejected at parse time, and disabled/untrusted servers are skipped without any process or network activity.
- **Web content is untrusted.** Search/fetch results are data, not instructions; wiki URL ingest runs an SSRF check before the fetch hook and fails closed without a fetch backend. Obscura process cost is paid per tool call — the binary is spawned on demand, never at startup. Brave and Firecrawl requests are paid network calls with their own finite limits.
- **Approvals deny by default.** The TUI approval prompt denies when unavailable or on timeout (`approvalTimeoutMs`, default 60 s), and the coding approval policy caches decisions per run.
- **Wiki workspace trust.** Wiki reads/writes are rooted at the configured workspace; skill auto-deploy writes files only after the explicit `wiki.autoDeploySkills` opt-in.
- **Sizing.** TUI scrollback keeps 500 entries by default (`maxScrollback`); headless `json` streams every event line under the run's byte caps instead of buffering a transcript; MCP servers connect eagerly at assembly; the provider cache holds one instance per provider id (cleared on `/logout` and credential changes); `/model` performs one live discovery request (6 s timeout, static fallback); `/compact` makes one summarization provider call by default; observational-memory worker requests happen only while enabled for the session. Runtime requirement: Bun `>=1.4.2` with the OpenTUI native package.

## Related APIs

- [`@arnilo/prism-agent-sdk`](agent-sdk.md): the tool-plane/skills/instructions/hooks assembly that Prism Code composes.
- [Coding agent tools](coding-agent-tools.md): the bundled shell/read/write/edit/search toolset and its caps.
- [ACP coding-host interop](acp.md) and [Spawnable ACP agent](acp-agent.md): the protocol surface and the sibling spawnable agent.
- [LLM compaction subpath](compaction-llm.md): the coding summarization strategy behind `/compact`.
- [Observational memory compaction subpath](compaction-observational-memory.md): the observation/reflection engine behind `/om`.
- [LLM Wiki](wiki.md): the wiki tools, commands, and OKF bundle behind the four slash commands.
- [Web search, fetch, and extraction](web-tools.md) and [Obscura browser engine](obscura.md): the web backends selected by `web`.
- [Credentials and redaction](credentials-and-redaction.md): the resolver order and secret redaction rules Prism Code follows.
- [CLI/RPC](cli-rpc.md): the core CLI conventions shared with the `prism` binary.
