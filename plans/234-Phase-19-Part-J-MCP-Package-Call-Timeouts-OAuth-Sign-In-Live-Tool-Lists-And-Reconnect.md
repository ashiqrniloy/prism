# Phase 19 Part J — MCP package: call timeouts, OAuth sign-in, live tool lists, and reconnect

## Objectives

- Give MCP tool calls their own time limit. The package passes the connect timeout as the call timeout (`callTimeoutMs: timeoutMs`, `packages/extensions/mcp/src/package.ts:187`), so every tool call and list is cut at `connectTimeoutMs` (default 15 s) instead of the library default of 60 s (`packages/extensions/mcp/src/constants.ts`), and no config field changes it.
- Run the OAuth flow from the package. The library implements it (`createMcpClientAuth`, `packages/extensions/mcp/src/auth.ts:449`), but the package only notes "this package does not run the OAuth flow" (`package.ts:219`), so a server that requires OAuth cannot be used without a host-built bridge.
- Make a server's current tools callable without recreating the agent. Tools are registered once in `setup`; after a reconnect that finds new tools the package says "recreate the agent to register them" (`package.ts:204`), because the kernel closes tool registration when setup ends (`registration_closed`, `src/packages/loader.ts:539`).
- Reconnect a dropped server without a person running `mcp:reconnect`.

## Expected Outcome

- `callTimeoutMs` (plane and per server, default 60,000) bounds one tool call; `connectTimeoutMs` bounds connect only. A server's progress notifications extend a call up to `maxCallTimeMs` (default 300,000).
- A server configured with `auth: { kind: "oauth", … }` signs in through `host.ui` (`open-url`, then a loopback callback or a pasted code), stores its tokens through the credentials slot, and refreshes them. With no UI the server is `failed` with reason `auth_required`.
- The model sees a server's current tools at the start of each run: tools added by `tools/list_changed` or a reconnect appear, removed tools disappear, and a run in progress keeps the set it started with.
- A dropped connection is retried with backoff (5 attempts by default); status events report each state.

This plan implements roadmap **Phase 19 Part J**. Live tool lists need a kernel addition (a per-run tool source), so **Task 1 is the phase review**, and it must hold the written proof that no existing mechanism can add a tool after setup. It runs after plan 233. No version bump or publish.

Cost knobs: reconnect attempts and token refreshes make requests only on failure or expiry. A live tool list costs one in-memory read per run start; the server is asked again only after a `list_changed` notification. Stated in the package README.

## Tasks

- [ ] Task 1: Phase review (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, citing `file:line`:
      - (a) **Timeouts.** Every use of `callTimeoutMs` and `maxTotalTimeout` in `packages/extensions/mcp/src/bridge.ts` (`:73-74`, `:135-136`, `:435-447`, `:571-598`) and `capabilities.ts:32`, the SDK options they map to (`timeout`, `maxTotalTimeout`, `resetTimeoutOnProgress`) at the pinned `@modelcontextprotocol/client` version, and `HARD_CALL_TIMEOUT_MS` (`limits.ts`).
      - (b) **OAuth library surface.** `McpClientAuthOptions` (`types.ts:156`), the state seam (`McpClientAuthState`), registration strategies, `onRedirectRequired`, how the authorization code returns to the client, and what the transport does on a 401 (`transport.ts`).
      - (c) **Tool registration.** `registerTool`'s closed check (`src/packages/loader.ts:538-543`), `PackageToolOptions.when` (`src/packages/api.ts:36-42`), how a run snapshots tools (`activeTools`, `selectRunTools`, `src/agent-session/session/assemble.ts:324-340`), and `agent.tools` / `inspect()` views. The written proof: `when` can hide a registered tool but nothing can add one after setup.
      - (d) **Who else needs a late tool set.** `packages/tools/computer-use` (an MCP-backed tool set), `packages/tools/web/src/obscura/mcp.ts`, `packages/tools/openapi`, and `packages/extensions/context-engineering` tool search (which narrows by name), to meet the "generic: needed by at least two packages" rule.
      - (e) **List-change handling today.** The bridge's `listChanged` hook and cache (`bridge.ts:57-60`, `:213-220`, `:292-335`), and the package's use of it.
      - (f) **Close detection.** How the bridge learns a transport closed (`McpBridgeClosedError`, `assertOpen`) for stdio and HTTP.
    - Performance: n/a — read-only.
    - Code Quality: Findings are written against the task they change. If (c)'s proof fails (an existing mechanism can add tools), Task 4 is re-cut onto it and adds no kernel contract.
    - Security: Records the trust rule for late tools: a tool that appears after setup comes from a server the host already allowed and trusted; its `effects` come from the server's `readOnly` setting, not from the server's own claims.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §2.6 (tools registry), §2.9 (mcp row); `docs/packages.md`, `docs/tools.md`
      - `packages/extensions/mcp/README.md`, `packages/extensions/mcp/src/package.ts`, `packages/extensions/mcp/src/bridge.ts`, `packages/extensions/mcp/src/auth.ts`
      - The MCP client SDK's request options and authorization flow, through the find-docs skill
    - Options Considered:
      - Skip — rejected: Task 4 adds a kernel contract.
    - Chosen Approach:
      - Inventory and the proof, then confirm or re-cut.
    - API Notes and Examples:
      ```bash
      npx ctx7@latest library "Model Context Protocol TypeScript SDK" "client request timeout and resetTimeoutOnProgress"
      graft callers registerTool --depth all
      ```
    - Files to Create/Edit:
      - `plans/234-…md`: the task note
    - References:
      - Evaluation findings M1–M4
  - Test Cases to Write:
    - none — read-only
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no
    - Docs pages to create/edit:
      - none
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Call timeouts are separate from the connect timeout
  - Acceptance Criteria:
    - Functional:
      - Config gains `callTimeoutMs` (plane and `servers[]`, integer, default 60,000) and `maxCallTimeMs` (default 300,000, hard cap from `HARD_CALL_TIMEOUT_MS`). `connectTimeoutMs` applies to `connect` and the first `tools/list` only.
      - A tool call times out after `callTimeoutMs` without progress; each progress notification resets that timer, and the call ends at `maxCallTimeMs` regardless.
      - A timed-out call returns a tool error naming the server and the limit, and the request is cancelled on the server (`notifications/cancelled`, as the SDK does on abort).
      - The run's abort still cancels a call at once.
    - Performance: No added request.
    - Code Quality: One mapping from package config to bridge limits; `package.ts` no longer reuses `timeoutMs` for two purposes.
    - Security: Bounds stay finite; a config value above the hard cap fails the load.
  - Approach:
    - Documentation Reviewed:
      - `packages/extensions/mcp/src/package.ts:176-190`, `config.ts`, `limits.ts`, `bridge.ts:425-450`
      - Task 1(a)
    - Options Considered:
      - Raise the connect default — rejected: a slow connect and a slow tool are different failures.
    - Chosen Approach:
      - Two config fields mapped onto the SDK's `timeout` and `maxTotalTimeout` with progress reset.
    - API Notes and Examples:
      ```jsonc
      { "servers": [{ "id": "build", "transport": "stdio", "command": "mcp-build", "allow": "stdio:mcp-build",
                      "callTimeoutMs": 120000 }], "maxCallTimeMs": 600000 }
      ```
    - Files to Create/Edit:
      - `packages/extensions/mcp/src/{package,config,limits,bridge}.ts`, `README.md`
      - `packages/extensions/mcp/src/__tests__/call-timeout.test.ts`: new
    - References:
      - Evaluation finding M3
  - Test Cases to Write:
    - `tool_call_outlives_the_connect_timeout`: a 20 s call with a 15 s connect timeout completes (fake clock).
    - `call_times_out_at_call_timeout_without_progress`.
    - `progress_extends_a_call_up_to_max_call_time`.
    - `timeout_cancels_the_server_request`.
    - `config_above_hard_cap_fails_the_load`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config fields and a default
    - Docs pages to create/edit:
      - `packages/extensions/mcp/README.md`: the config table
      - `CHANGELOG.md`: `## [Unreleased]`, Fixed
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: The package signs in to OAuth-protected servers
  - Acceptance Criteria:
    - Functional:
      - `servers[].auth: { kind: "oauth", tokens: "keyring:<name>", scopes?, clientId?, callback?: "loopback" | "paste" }`. `tokens` is a ref the credentials slot can write; an `env:` ref or a literal fails the load.
      - On a 401 or an explicit `mcp:login { id }` command, the package starts the library flow: discovery, dynamic registration or the configured client, PKCE. It sends the authorization URL through `host.ui` as `open-url`. The code returns through a loopback listener on `127.0.0.1` with a random port and a 5-minute limit, or through a `host.ui` `input` request when `callback: "paste"`.
      - Tokens are stored and refreshed through `prism.credentials.store` and read through `resolve`. They never appear in events, status notes, `inspect()`, or errors.
      - With no `host.ui`, or an `unavailable` or dismissed answer, the server is `failed` with `reason: "auth_required"` and nothing is opened.
      - `mcp:logout { id }` deletes the stored tokens and closes the bridge.
      - The package declares `credentials:write`; without it, an `auth` entry fails the load naming the capability.
    - Performance: One discovery and one token exchange per sign-in; refresh only on expiry.
    - Code Quality: The package wires the existing library; it adds no second OAuth implementation.
    - Security: The loopback listener binds to loopback only, accepts one request, checks `state`, and closes. The redirect and token endpoints pass the existing SSRF checks. A project-scope manifest cannot add an `auth` entry without the trust prompt the package already requires for project servers.
  - Approach:
    - Documentation Reviewed:
      - `packages/extensions/mcp/src/auth.ts` (whole file), `oauth-metadata.ts`, `transport.ts`, `trust.ts`, `commands.ts`
      - `src/host/types.ts` (`open-url`, `input`), `src/packages/api.ts` (`credentials.store`), `packages/extensions/keyring/README.md`
      - `packages/providers/openai-codex/src/oauth.ts` (the existing package-side OAuth pattern with `host.ui` and the credentials slot)
    - Options Considered:
      - Leave OAuth to hosts — rejected: the owner asked for the package completed.
      - Open the system browser from the package — rejected: packages never open a browser; `host.ui` does.
    - Chosen Approach:
      - The library flow, `host.ui` for interaction, the credentials slot for state.
    - API Notes and Examples:
      ```jsonc
      { "servers": [{ "id": "tracker", "transport": "http", "url": "https://mcp.example.com/mcp", "allow": "https://mcp.example.com",
                      "auth": { "kind": "oauth", "tokens": "keyring:mcp-tracker" } }] }
      ```
    - Files to Create/Edit:
      - `packages/extensions/mcp/src/{package,config,commands,status}.ts`; `packages/extensions/mcp/src/oauth-callback.ts`: new
      - `packages/extensions/mcp/src/__tests__/oauth-package.test.ts`: new (a fake authorization server)
      - `packages/extensions/mcp/README.md`
      - `examples/mcp-oauth.ts`: new, offline; `examples/README.md`, `scripts/e2e-coverage.json`
    - References:
      - Evaluation finding M1
  - Test Cases to Write:
    - `oauth_server_signs_in_through_host_ui_and_connects`.
    - `tokens_are_stored_as_refs_and_never_emitted`: scan events, notes, `inspect()`, and errors for the token.
    - `expired_token_is_refreshed_without_a_prompt`.
    - `no_ui_reports_auth_required_and_opens_nothing`.
    - `paste_callback_completes_sign_in`.
    - `callback_rejects_a_wrong_state`.
    - `literal_or_env_token_ref_fails_the_load`.
    - `logout_deletes_tokens_and_closes_the_bridge`.
    - `examples_demos_run_to_completion_and_emit_no_secret` covers the example.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config, two commands, a capability
    - Docs pages to create/edit:
      - `packages/extensions/mcp/README.md`: "OAuth", capabilities, failure behavior
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: Kernel tool sources, and MCP tools that follow the server
  - Acceptance Criteria:
    - Functional:
      - `PackageAPI.tools.source(list)` registers, during `setup`, a function that returns the package's current tools. The kernel calls each source once at the start of a run, when it snapshots the run's tools; the result is validated like `register` (name, `execute`, effects) and checked for conflicts with registered tools, host tools, reserved names, and other sources. A conflicting or invalid tool is dropped with one `warn` status note; it never fails the run.
      - A run keeps its snapshot; a change during a run takes effect at the next run.
      - `agent.tools`, `inspect()`, `prism.tools.list()`, and `AgentConfig.disable.tools` include source tools. `disable` applies by name at each snapshot.
      - A source that throws contributes no tools for that run and adds a `warn` note.
      - The MCP package registers one source per server instead of registering tools in `setup`. `tools/list_changed` and a reconnect update the server's list; the "recreate the agent" note is removed.
      - Each MCP tool's `effects` still come from `readOnly`; a tool whose name collides is dropped as above.
    - Performance: A source is a synchronous in-memory read; the kernel adds no await to run start. With no source registered, run start is unchanged.
    - Code Quality: Sources share the registry's validation and conflict code. The kernel names no package.
    - Security: A source can add tools only under its own package as owner; the `tool.call` gate and approval see them exactly like registered tools. A source cannot shadow an existing tool.
  - Approach:
    - Documentation Reviewed:
      - `src/packages/loader.ts:538-580` (`registerTool`), `src/packages/api.ts`, `src/agent-tool-dispatch.ts` (`activeTools`), `src/agent/views.ts`, `src/agent/inspect.ts`
      - `packages/extensions/mcp/src/package.ts:230-240` (registration with `when`), `bridge.ts` (list cache)
      - Task 1(c), (d)
    - Options Considered:
      - Reopen `tools.register` after setup — rejected: a registry that changes mid-run breaks the run-local snapshot rule.
      - One dispatcher tool (`mcp_call`) that takes a tool name — rejected: the model loses each tool's schema, and gates lose per-tool effects.
      - Recreate the agent on change — rejected: it drops every open session.
    - Chosen Approach:
      - A per-run source, read where the run already snapshots tools.
    - API Notes and Examples:
      ```ts
      setup(prism) {
        prism.tools.source(() => entries.filter((e) => e.state === "connected").flatMap((e) => e.tools));
      }
      ```
    - Files to Create/Edit:
      - `src/packages/api.ts`, `loader.ts`; `src/agent-tool-dispatch.ts`, `src/agent/views.ts`, `src/agent/inspect.ts`
      - `src/testing/package-conformance.ts`: a source case
      - `src/__tests__/tool-sources.test.ts`: new
      - `packages/extensions/mcp/src/package.ts`, `README.md`, tests
      - `packages/tools/computer-use/src/…`: move to a source if Task 1(d) shows it benefits
      - `scripts/compat-baseline/*.txt`: regenerated (`bun scripts/release.mjs gate --update-baseline`), additive diff in the task note; `src/__tests__/public-export-contract.test.ts`
    - References:
      - Evaluation finding M2
  - Test Cases to Write:
    - `source_tools_are_snapshotted_at_run_start`.
    - `change_during_a_run_applies_to_the_next_run`.
    - `source_tool_conflict_is_dropped_with_a_note`.
    - `throwing_source_contributes_nothing_and_notes`.
    - `disable_removes_a_source_tool_by_name`.
    - `source_tools_pass_the_tool_call_gate`: on the default loop and a custom loop.
    - `mcp_tool_added_after_list_changed_is_callable_next_run`.
    - `mcp_tool_removed_by_the_server_disappears_next_run`.
    - `inspect_lists_source_tools_with_their_package`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — a `PackageAPI` member and MCP behavior
    - Docs pages to create/edit:
      - `docs/packages.md`: `tools.source`
      - `docs/tools.md`: when the tool set is fixed for a run
      - `packages/extensions/mcp/README.md`: "What it changes"
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 5: A dropped server reconnects by itself
  - Acceptance Criteria:
    - Functional:
      - `reconnect: { attempts, baseDelayMs, maxDelayMs }` (default 5 attempts, 1 s doubling to 30 s; `attempts: 0` disables). When the bridge reports a closed transport, the package reconnects with that backoff. Each state change emits `mcp.status` (`reconnecting`, `connected`, `failed`).
      - While a server is not connected its tools are absent from new runs (Task 4), and a call in a running run returns a tool error naming the server state.
      - Trust is not asked again for a server already trusted; a server whose fingerprint changed is treated as new and asks.
      - Disposal cancels pending reconnects.
    - Performance: At most `attempts` connects per drop; no polling while connected.
    - Code Quality: One reconnect loop shared with the `mcp:reconnect` command.
    - Security: Credentials are resolved again on each reconnect, so a rotated secret is picked up and a removed one fails closed.
  - Approach:
    - Documentation Reviewed:
      - `packages/extensions/mcp/src/package.ts` (`connectServer`, the reconnect command), `bridge.ts` (close handling), `trust.ts` (`mcpServerFingerprint`), `status.ts`
    - Options Considered:
      - Reconnect lazily on the next call — rejected: the first call after a drop would fail or stall.
    - Chosen Approach:
      - Reconnect on close with bounded backoff.
    - API Notes and Examples:
      ```jsonc
      { "reconnect": { "attempts": 5, "baseDelayMs": 1000, "maxDelayMs": 30000 } }
      ```
    - Files to Create/Edit:
      - `packages/extensions/mcp/src/{package,config,status}.ts`, `README.md`
      - `packages/extensions/mcp/src/__tests__/reconnect.test.ts`: new
    - References:
      - Evaluation finding M4
  - Test Cases to Write:
    - `closed_transport_reconnects_with_backoff`.
    - `reconnect_gives_up_after_attempts_and_reports_failed`.
    - `tools_are_absent_while_disconnected_and_return_after`.
    - `changed_fingerprint_asks_for_trust_again`.
    - `dispose_cancels_pending_reconnects`.
    - `attempts_zero_disables_reconnect`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — config and status states
    - Docs pages to create/edit:
      - `packages/extensions/mcp/README.md`: `reconnect`, the status table
      - `CHANGELOG.md`: `## [Unreleased]`, Added
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/tool-sources.test.ts`
- `bun run --filter @arnilo/prism-extensions test`
- `bun run --filter @arnilo/prism-tools test`
- `bun run --filter @arnilo/prism-agent test`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun run test`
- `bun scripts/release.mjs gate`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
