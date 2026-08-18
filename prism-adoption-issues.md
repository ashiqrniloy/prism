# Prism Adoption Issues — Bug Reports and Feature Requests

Upstream feedback for [ashiqrniloy/prism](https://github.com/ashiqrniloy/prism), prepared during a coding-agent/ACP adoption evaluation. Each item is written so it can be filed directly as a GitHub issue.

- **Evaluated versions**: `@arnilo/prism` and all first-party packages at **0.2.6** (npm latest; repo `main` is 0.2.7-dev), `@agentclientprotocol/sdk@1.3.0` (pinned regular dependency of `@arnilo/prism-ag-ui`), official Rust crate `agent-client-protocol@2.0.0` on the client side.
- **Scope**: `@arnilo/prism` core, `@arnilo/prism-coding-agent`, `@arnilo/prism-coding-security`, `@arnilo/prism-ag-ui` (especially the `/acp` subpath), `@arnilo/prism-mcp`, `@arnilo/prism-session-store-sqlite`.
- **Context**: The client is an editor that will run Prism as an external ACP agent over stdio JSON-RPC, using the official ACP client crates. Nothing below blocks the Phase 0 spike; B1–B4 and F1–F3 shape the client's UI contracts and should land before editor integration.

## Bugs

### B1 — `usage_update.size` is fabricated instead of the context window size

- **Package**: `@arnilo/prism-ag-ui/acp`
- **File**: `packages/ag-ui/src/acp/mapper.ts`, `usage()` (near the bottom of the file)
- **Behavior**: `size: Math.max(1, used)` where `used` is derived from the Prism `Usage` event. Per `@agentclientprotocol/sdk@1.3.0` (`dist/schema/types.gen.d.ts`, `UsageUpdate`): `used` = "Tokens currently in context", `size` = "Total context window size in tokens". Prism reports a "window size" equal to current usage, which renders as a nonsense always-~100% context bar in ACP clients (Zed etc.).
- **Requested fix**: Add a host seam for the context window (e.g. `capabilities.usage.contextWindow({ model })`, or resolve from `ModelConfig` metadata when providers know it). If the window is unknown, omit `usage_update` (or omit `size`) rather than fabricating a value. Document the seam in `docs/acp.md`.

### B2 — Agent errors surface as fake assistant text instead of a prompt-request error

- **Package**: `@arnilo/prism-ag-ui/acp`
- **File**: `packages/ag-ui/src/acp/mapper.ts`, `error()`
- **Behavior**: Prism `ErrorInfo` maps to `agent_message_chunk` with `messageId: "prism:error"` and text `"Agent error: …"`, injecting a synthetic message into the user-visible transcript. ACP v1 has no `error` session-update kind; the correct channels are (a) failing the `session/prompt` **request** with a typed JSON-RPC error, and (b) `tool_call_update` with `status: "failed"` for tool-level failures (already implemented elsewhere in the mapper).
- **Also**: `docs/acp.md`'s event table claims errors map to an `error` update — docs/implementation mismatch.
- **Requested fix**: Fail the prompt request on run-level errors; keep `tool_call_update`/`failed` for tool errors; stop emitting `"Agent error:"` assistant chunks; fix the `docs/acp.md` table.

### B3 — `session/set_config_option` capability gate is wrong for non-boolean options

- **Package**: `@arnilo/prism-ag-ui/acp`
- **File**: `packages/ag-ui/src/acp/agent/core.ts` (~line 413)
- **Behavior**: Every `session/set_config_option` call requires `clientCapabilities.configOptionBoolean`, but `AcpConfigOption` also supports `type: "select"`. SDK 1.3.0's `SessionConfigOptionsCapabilities` only defines a `boolean` capability, so a spec-conformant client can never set a `select` option through the adapter.
- **Requested fix**: Gate per option type. Either (a) restrict Prism's advertised options to `boolean` until the ACP spec/SDK defines a `select` capability, or (b) track the upstream spec and gate `select` options on the corresponding future client capability. Never accept a `select` set under the `boolean` advertisement.

### B4 — Tool `kind` classification is a substring heuristic on tool names

- **Package**: `@arnilo/prism-ag-ui/acp`
- **File**: `packages/ag-ui/src/acp/mapper.ts`, `kind()`
- **Behavior**: ACP `ToolKind` (`read`/`edit`/`delete`/`search`/`execute`/`fetch`/`other`) is derived by substring-matching the tool **name**. First-party tools misclassify: `glob` → `other`, `repo_list` → `search`, `move` → `other`; any host-renamed tool classifies arbitrarily.
- **Requested fix**: Let `ToolDefinition` (core) carry an optional explicit `kind`/metadata field consumed by the ACP mapper; keep the substring heuristic only as a fallback. Set correct kinds for all `@arnilo/prism-coding-agent` tools.

### B5 — Docs/wire drift on permission outcome naming

- **Package**: `@arnilo/prism-ag-ui` docs
- **Files**: `docs/acp.md` (outcome table) vs `packages/ag-ui/src/acp/agent/decision.ts` / `permission-elicit.ts` vs `packages/ag-ui/README.md`
- **Behavior**: Three different namings are used for the four permission outcomes: `allow_for_run` (docs table), `allow_always`/`reject_always` (README), and wire truth `optionId: "allow-for-run"` with `kind: "allow_always"` (implementation; matches SDK `PermissionOptionKind`). Functional but confusing — clients key "always" decisions on optionId strings.
- **Requested fix**: State optionIds and option kinds explicitly in `docs/acp.md` and the README, using the SDK's wire values as the single source of truth.

## Feature requests

Ordered by value to the ACP-client editor.

### F1 — Map thinking/reasoning content to `agent_thought_chunk`

- **Package**: `@arnilo/prism-ag-ui/acp`
- **Files**: `packages/ag-ui/src/acp/mapper.ts` (`map()` drops every non-text `message_delta`)
- **Request**: Prism core has thinking content and the AG-UI mapper already projects it (`packages/ag-ui/src/ag-ui-mapper.ts:152`). The ACP mapper should map thinking deltas/blocks to `agent_thought_chunk` session updates, through the existing projection/redaction pipeline. Editors display reasoning inline; today it silently disappears over ACP.

### F2 — Emit `user_message_chunk` and transcript replay on `session/load`/`session/resume`

- **Package**: `@arnilo/prism-ag-ui/acp`
- **Request**: The agent streams only live turns; after a client restart, `session/load`/`resume` give no transcript and every host must implement its own history source against the Prism session store. Emit bounded, redacted `user_message_chunk` (+ assistant text) updates on load/resume — or provide a documented transcript projection seam so hosts can feed one from `session.entries()` without protocol re-invention.

### F3 — Ship a spawnable ACP agent entrypoint (bin or documented template)

- **Package**: `@arnilo/prism-ag-ui` (or new `@arnilo/prism-acp-agent`)
- **Request**: Today every host hand-writes a Node entry wiring `authorize`/`sessionFactory`/`lifecycle`/`sessions`/`mcp`/`modes`/`configOptions`/`coding` seams plus a stdio transport; no `bin` exposes ACP (the `prism` CLI's `--mode rpc` is Prism-proprietary JSONL, not ACP). Provide a reference spawnable agent (e.g. `prism-acp-agent` bin) with a config-file mapping of the common seams (single-local-user `authorize`, filesystem `sessionFactory` with coding tools, JSONL/SQLite session store, MCP allow-list, modes), so editors can spawn Prism per the ACP distribution model instead of maintaining TypeScript glue per host.

### F4 — `stopReason` fidelity on `session/prompt` responses

- **Package**: `@arnilo/prism-ag-ui/acp`
- **File**: `packages/ag-ui/src/acp/agent/core.ts:278` (`end_turn` / `cancelled` only)
- **Request**: Map run termination causes to the full ACP `StopReason` set: tool-round limit exhaustion → `max_turn_requests`, provider token/finish limits → `max_tokens`, refusals → `refusal`. Clients use `stopReason` for "continue" affordances; collapsing everything to `end_turn` loses them.

### F5 — Plan session updates (`plan` / `plan_update` / `plan_removed`)

- **Package**: `@arnilo/prism-ag-ui/acp` + `@arnilo/prism-coding-agent`
- **Request**: `@arnilo/prism-coding-agent` already ships plan/checkpoint helpers. Map them to the ACP plan updates behind the client `plan` capability (UNSTABLE in SDK 1.3.0, so gate on client advertisement and no-op otherwise). Editors can then render a native plan/progress view instead of plan state appearing as ad-hoc assistant text.

### F6 — `session_info_update` and richer `session/list` entries

- **Package**: `@arnilo/prism-ag-ui/acp`
- **Request**: `session/list` returns `{sessionId, cwd}` only; SDK `SessionInfo` supports `title`, `lastModified`, and ACP defines `session_info_update` for dynamic titles. Emit a session title (host seam, e.g. first-prompt summary) and `session_info_update`, and populate `title`/`lastModified` in list entries. Needed for usable session-picker UIs.

### F7 — Built-in redacted diff/locations projection for first-party coding tools

- **Package**: `@arnilo/prism-ag-ui/acp` (+ `@arnilo/prism-coding-agent`)
- **Request**: Locations/diffs leave the host only through `AgUiProjection.toolDiff`/`toolLocations` allow-lists — correct by default, but every editor then re-implements a redacted projector for `edit`/`write` tool results. Ship an opt-in built-in projector (path + unified/oldText-newText diff, byte-capped, redacted) for the first-party coding tools so the adapter is turnkey for editor diff review.

### F8 — Image blocks in tool-call content

- **Package**: `@arnilo/prism-ag-ui/acp`
- **Request**: `ToolCallContent` supports `image` blocks; the mapper emits only text and one diff. Project `read`-tool image results (bounded, base64-capped, opt-in through the projection allow-list) as image blocks so multimodal edit review works over ACP.

### F9 — `available_commands_update`

- **Package**: `@arnilo/prism-ag-ui/acp`
- **Request**: Expose a bounded set of host-registered commands (slash commands) through `available_commands_update`, sourced from a host seam. Clients render these as prompt affordances; without them every command has to be documented in prose.

### F10 — Windows sandbox backend (tracking)

- **Package**: `@arnilo/prism-coding-security`
- **Request**: `createNativeSandbox` fails closed outside Linux. Tracking request only: the client targets Windows long-term; a Windows sandbox backend (Job objects / AppContainer) or a documented Docker fallback policy would let Windows agent hosts keep `shell` enabled instead of deny-by-default.

## Verified non-issues (no report needed)

- Stdio MCP servers **are** supported by the ACP adapter (untagged in the SDK schema; routed through the host `mcp.select` gate — `packages/ag-ui/src/acp/mcp-config.ts`).
- Prompt block coverage is complete: text/image/audio/`resource_link`/`resource`/embeddedContext with live policy re-check at prompt time.
- Permission wire format is spec-compliant (optionIds `allow-once`/`allow-for-run`/…, kinds `allow_once`/`allow_always`/…).
- `session/list` cursor paging is implemented against the SDK's `nextCursor` field.
- Elicitation is handled (advertised-client-gated, form mode, mapped onto the shared decision model).
- Durable resume, `AcpSessionStore`, and the 0.2.6 active-run recovery + fenced cancellation are implemented and documented.
