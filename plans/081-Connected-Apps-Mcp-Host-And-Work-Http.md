# Connected Apps MCP Host, Work HTTP Adapters (0.8.0)

Status: complete. Tasks 1–8 completed **2026-09-16** against the 0.7.0 working tree: the primitive/threat-model review with executable evidence in [docs/history/081-connected-apps-primitive-review.md](../docs/history/081-connected-apps-primitive-review.md); the identity-bound connected-app session ([docs/connected-apps.md](../docs/connected-apps.md)) with host `select`, exact tool allowlists and the MCP mutation default; `inspectHostComposition().connectedApps` identifiers; additive Google Workspace and Microsoft 365 HTTP adapters beside the CLI adapters ([docs/work-connectors.md](../docs/work-connectors.md)); the network-free Slack MCP wrap and Open Connector sidecar examples; and the consistency/budget verification pass (root packed baseline 1,247,731 bytes per 079 Task 1, `@arnilo/prism-mcp` 139 and `@arnilo/prism-core` 1,479 export ceilings, root `npm test` 5/5). No version bump: the lockstep 0.8.0 cut remains **080 Task 10**, now unblocked.

Research updated: 2026-09-16.

Prism stays the governed host. MCP is the long-tail connection plane. Work tools stay the high-trust draft/approve surface. Channels stay inbound chat (079/080). This plan does **not** vendor Klavis, Open Connector, Nango, or any 1000-API catalog into `packages/`. It does **not** add a 12th publishable package. It does **not** add Slack/Teams inbound channel adapters (demand-gated; 079/080 already ship Telegram + experimental Signal).

## Objectives

- Let a host bind a small, identity-scoped set of MCP servers (“connected apps”) and register their tools on an agent without writing a per-SaaS adapter in core.
- Keep fail-closed governance: host `select` of transports, required `effect` policy, tool-name allowlists, per-identity credentials resolved only at the connect edge, default `external_mutation` / `idempotency: unsupported` for unclassified remotes.
- Add HTTP work adapters for Google Workspace and Microsoft 365 that implement the existing `GoogleWorkspaceAdapter` / `Microsoft365Adapter` contracts (same ops, drafts, idempotency, normalizers) so hosts are not forced to pin CLI binaries.
- Show the Obscura-shaped wrap as a Slack MCP example, and an optional Open Connector sidecar recipe that stays out of core.
- Leave 0.8.0 publication to 080 Task 10.

## Expected Outcome

A Node host on the 0.8.0 line can:

1. Call `createConnectedAppSession({ identity, select, effect, … })`, `bind` host-approved MCP servers, and spread `session.tools()` into `createToolRegistry` / `createSecureAgent`.
2. Inspect those bindings through `inspectHostComposition` with zero network and no secret leakage.
3. Construct `createWorkTools` with `createGoogleWorkspaceHttpAdapter` / `createMicrosoft365HttpAdapter` (CLI adapters remain).
4. Copy `examples/connected-slack-mcp.ts` to wrap a third-party Slack MCP server with a read/write effect split.
5. Optionally run the Open Connector sidecar example; Prism never depends on `@oomol-lab/open-connector`.

After 080 Task 10 the tree is publish-ready at 0.8.0; registry/tag writes still need a human.

## Tasks

- [x] **Task 1 — Primitive, compatibility and threat-model review**
  - Acceptance Criteria:
    - Functional: written evidence (`docs/history/081-connected-apps-primitive-review.md`) inventories current contracts with file:line: `connectMcpTools` / `McpToolEffectPolicy` / `unsupportedRemoteEffect` (`packages/mcp/src/bridge.ts`, `packages/mcp/src/types.ts`), MCP OAuth + `pinnedFetch` transports (`packages/mcp/src/transport.ts`, `src/pinned-fetch.ts`), ACP `validateMcpServers` / `selectMcpServers` (`packages/ag-ui/src/acp/mcp-config.ts`, `packages/acp-agent/src/index.ts`), work CLI adapters + `WorkTokenProvider` + drafts (`packages/prism-core/src/integrations/work/{types,tools,google-workspace,microsoft365,drafts}.ts`), `createOAuthWorkTokenProvider` (`packages/prism-core/src/credentials/node/work-token.ts`), `inspectHostComposition` zero-network rule (`src/host-composition.ts`), Obscura wrap (`packages/web-tools/src/obscura/mcp.ts`), computer-use-linux wrap (`packages/prism-coding-tools/src/computer-use-linux/create.ts`), and channel vs tool vs work-tool planes (`packages/prism-channels`, `docs/messaging-channels.md`). Each later task maps to a frozen symbol or an explicit out-of-scope row.
    - Performance: review is docs + existing probes only; no new runtime cost. Record current packed/export ceilings for `@arnilo/prism-mcp`, `@arnilo/prism-core`, and `@arnilo/prism` as the Task 8 baseline.
    - Code Quality: no new public symbols in this task. Evidence cites current docs and code, not training memory. No `.agents/skills/project-patterns/` or `.agents/skills/project-wiki/` exists — no extra code-wiki task; graft refresh lives in Task 8 / 080 Task 10.
    - Security: threat rows for auto-discovery of MCP servers, trusting remote MCP annotations for effects (already excluded from `McpToolEffectPolicyInput`), stdio command injection, HTTP SSRF, cross-identity token reuse, `execute_action` as a model-facing write without allowlist, catalog sidecars in-process, Slack/Teams inbound confused with tools. Deny-by-default remains the recommended default for bind and HTTP origin.
  - Approach:
    - Documentation Reviewed:
      - [docs/mcp-tools.md](../docs/mcp-tools.md), [docs/tool-effects.md](../docs/tool-effects.md), [docs/work-tools.md](../docs/work-tools.md), [docs/work-connectors.md](../docs/work-connectors.md), [docs/host-compositions.md](../docs/host-compositions.md), [docs/credential-storage.md](../docs/credential-storage.md), [docs/credentials-and-redaction.md](../docs/credentials-and-redaction.md), [docs/host-security.md](../docs/host-security.md), [docs/obscura.md](../docs/obscura.md), [docs/computer-use-linux.md](../docs/computer-use-linux.md), [docs/messaging-channels.md](../docs/messaging-channels.md), [docs/acp.md](../docs/acp.md)
      - MCP Streamable HTTP / tools/list: https://modelcontextprotocol.io and pinned SDK `@modelcontextprotocol/client` `2.0.0` (already in `packages/mcp`)
      - Gmail REST `users.messages.list|get|send`: https://developers.google.com/gmail/api/reference/rest/v1/users.messages
      - Calendar events `list|insert`: https://developers.google.com/calendar/api/v3/reference/events
      - Drive files `list|create` + permissions: https://developers.google.com/drive/api/reference/rest/v3/files
      - Microsoft Graph `me/messages`, `me/sendMail`, `me/events`, `me/drive`: https://learn.microsoft.com/en-us/graph/api/overview
      - Open Connector MCP (`list_apps` / `search_actions` / `get_action_guide` / `execute_action`, HTTP `Idempotency-Key`): https://github.com/oomol-lab/open-connector (example-only; not a dependency)
    - Options Considered:
      - New `@arnilo/prism-connectors` package (12th publishable; rejected — MCP + work subpath already exist).
      - Vendor Open Connector or Klavis into core (rejected — iPaaS identity/policy fork; Klavis OSS stale since ~2026-06-01).
      - Replace work CLI adapters in place (breaking for hosts that pin `m365`/`gws`; rejected — HTTP is additive).
      - Same 079/080 Task 1 shape: evidence doc + freeze vocabulary before code (chosen).
    - Chosen Approach: freeze names in the evidence doc. Implementation tasks may not rename 079/080 symbols or MCP bridge defaults. Frozen vocabulary:
      - `ConnectedAppBinding`, `ConnectedAppSession`, `createConnectedAppSession`, `bind` / `unbind` / `list` / `tools` / `refresh` / `close`
      - `ConnectedAppSelect` (host transport admission; same fail-closed idea as ACP `mcp.select`)
      - `createGoogleWorkspaceHttpAdapter`, `createMicrosoft365HttpAdapter`
      - Planes stay split: MCP tools ≠ work tools ≠ channels
    - API Notes and Examples:
      ```ts
      // Existing fail-closed default — do not change.
      // unclassified remote → { kind: "external_mutation", idempotency: "unsupported" }
      const bridge = await connectMcpTools({
        serverId: "slack",
        transport,
        effect: ({ remoteName }) =>
          remoteName.startsWith("get_") || remoteName.startsWith("list_")
            ? { kind: "none", idempotency: "none" }
            : undefined,
      });
      ```
    - Files to Create/Edit:
      - `docs/history/081-connected-apps-primitive-review.md`: evidence
      - `docs/history/README.md`: index the 081 review page
      - this plan (task checkbox)
    - References: `packages/mcp/src/bridge.ts` `resolveRemoteToolEffect` / `unsupportedRemoteEffect`; `McpToolEffectPolicyInput` excludes remote descriptions; Obscura `createObscuraMcpTools` is the wrap template.
  - Test Cases to Write:
    - Probe: unclassified MCP tool effect is `external_mutation` + `unsupported` (existing bridge tests; cite them).
    - Probe: `inspectHostComposition` performs zero network when `liveChecks` is omitted.
    - Probe: `createOAuthWorkTokenProvider` returns undefined on cross-account or wrong-tenant credentials.
    - Probe: work `createWorkTools` already classifies mutating names vs observation (existing `MUTATING_TOOL_NAMES`).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — review only.
    - Docs pages to create/edit: `docs/history/081-connected-apps-primitive-review.md` only.
    - `docs/index.md` update: no
    - Documentation structure reference: not applicable (history page).

- [x] **Task 2 — Identity-bound connected-app session**
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-mcp` exports `createConnectedAppSession`. A session is constructed with a required `identity`, required `select`, and optional `effect` (omission keeps bridge default). `bind({ appId, serverId, transport, allowTools?, effect? })` calls `select`; on deny throws a typed error and does not connect. On allow, calls injectable `connect` (default `connectMcpTools`), stores the bridge keyed by `appId`, and fails closed on duplicate `appId` or `serverId`. `tools()` returns prefixed `ToolDefinition`s from all bound bridges, filtered by `allowTools` (remote names) when set. `list()` returns `appId`, `serverId`, tool names — never tokens, env, or headers. `unbind` / `close` close bridges. Cross-identity bind (binding identity ≠ session identity) throws. `maxApps` default 8, hard 32.
    - Performance: bind is one MCP connect per app; `tools()` does not re-list unless `refresh()`. No sleep. Session of 8 mock servers lists in the same order of magnitude as 8 standalone `connectMcpTools` calls.
    - Code Quality: no new package. Reuse `connectMcpTools`, `assertValidServerId`, existing limits. Do not fork `McpTransportConfig`. Typed errors, no `any`.
    - Security: `select` is mandatory (no implicit admit). Stdio `env` / HTTP `requestInit.headers` are host-supplied at bind time; `list()` redacts them. Credentials are not stored on the session object beyond what the transport already holds. Default effect policy unchanged. `allowTools` is an allowlist, not a denylist.
  - Approach:
    - Documentation Reviewed: [docs/mcp-tools.md](../docs/mcp-tools.md) `connectMcpTools` / transports / `effect`; [docs/agent-identity.md](../docs/agent-identity.md); ACP MCP select (`packages/ag-ui/src/acp/mcp-config.ts`).
    - Options Considered:
      - Put the session in `@arnilo/prism` root (pulls MCP into core; rejected).
      - Auto-discover servers from a catalog URL (SSRF + trust; rejected).
      - Session in `@arnilo/prism-mcp` composing existing bridge (chosen).
    - Chosen Approach: thin orchestrator over `connectMcpTools`. Host owns OAuth/token injection when building `transport` (stdio `env` from `createOAuthWorkTokenProvider.tokenEnv`, or `createMcpOAuthTransport`). Prism does not grow a second OAuth stack.
    - API Notes and Examples:
      ```ts
      import { createConnectedAppSession } from "@arnilo/prism-mcp";
      import { assertIdentityActive } from "@arnilo/prism";

      const apps = await createConnectedAppSession({
        identity,
        select: async ({ transport }) => transport.type === "stdio" && transport.command === "/usr/bin/slack-mcp",
        effect: ({ serverId, remoteName }) =>
          serverId === "slack" && remoteName.startsWith("list_")
            ? { kind: "none", idempotency: "none" }
            : undefined,
        connect, // test seam
      });
      await apps.bind({
        appId: "slack",
        serverId: "slack",
        transport: { type: "stdio", command: "/usr/bin/slack-mcp", args: ["mcp"], env: tokenEnv },
        allowTools: ["list_channels", "post_message"],
      });
      registry.register(...apps.tools());
      ```
    - Files to Create/Edit:
      - `packages/mcp/src/connected-apps.ts`: session
      - `packages/mcp/src/types.ts`: options/binding types
      - `packages/mcp/src/index.ts`: exports
      - `packages/mcp/src/__tests__/connected-apps.test.ts`
      - `docs/connected-apps.md`: new API page (template in `.agents/skills/create-plan/references/prism-wiki.md`)
      - `docs/mcp-tools.md`: related-API link
      - `docs/index.md`: Tools group entry (one sentence, no plan number)
      - `scripts/budgets.json` + `scripts/compat-baseline/arnilo__prism-mcp.txt` if export count moves (reasoned)
    - References: `connectMcpTools` (`packages/mcp/src/bridge.ts:49-85`); Obscura injectable `connect` seam.
  - Test Cases to Write:
    - bind with `select: false` does not call `connect`.
    - duplicate `appId` throws; second `serverId` throws.
    - `allowTools` drops non-listed remotes from `tools()`.
    - `list()` JSON has no `env`, `headers`, or token-shaped strings from the fixture transport.
    - binding a second identity object with a different `accountId` throws.
    - 33rd bind fails at `maxApps` hard cap.
    - `close()` calls `bridge.close` for each bind (mock).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new MCP export and host composition of MCP servers.
    - Docs pages to create/edit:
      - `docs/connected-apps.md`: new current-contract page
      - `docs/mcp-tools.md`: Related APIs
    - `docs/index.md` update: yes — Tools: “Connected apps: identity-bound MCP server session that admits host-selected transports and registers prefixed tools.”
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 3 — Host composition reports connected apps**
  - Acceptance Criteria:
    - Functional: `HostCompositionOptions` accepts optional `connectedApps: { readonly appIds: readonly string[]; readonly serverIds: readonly string[] }` (identifiers only). `inspectHostComposition` copies them onto `HostCompositionReport.connectedApps` without connecting or fetching. Business profile: if `connectedApps` is present and identity is missing/`verified !== true`, readiness error. Personal profile: identifiers allowed. `liveChecks` still does not connect MCP. `assertHostCompositionReadiness` uses the same rules.
    - Performance: inspection remains O(tools + identifier copy); zero network (existing inert contract).
    - Code Quality: optional field, no required churn for current hosts. No MCP import from `src/host-composition.ts`.
    - Security: report must not accept or echo transport/env/headers. Identifiers bounded (reuse existing string/byte habits; cap array length at 32 to match `maxApps` hard).
  - Approach:
    - Documentation Reviewed: [docs/host-compositions.md](../docs/host-compositions.md); `src/host-composition.ts` (`liveChecks` comment: inert by default).
    - Options Considered:
      - Inspect live bridges (network; rejected).
      - Host passes identifier lists into inspect (chosen).
    - Chosen Approach: composition stays a readiness camera, not a connector.
    - API Notes and Examples:
      ```ts
      inspectHostComposition({
        profile: "business",
        agent,
        store,
        identity,
        connectedApps: { appIds: ["slack"], serverIds: ["slack"] },
      });
      ```
    - Files to Create/Edit:
      - `src/host-composition.ts`, `src/__tests__/host-composition.test.ts` (or existing composition tests)
      - `docs/host-compositions.md`
      - `docs/connected-apps.md`: composition section
      - `scripts/compat-baseline/arnilo__prism.txt` if export types already covered (types-only may not bump)
    - References: `HostCompositionOptions.liveChecks`; business identity rules already in `inspectHostComposition`.
  - Test Cases to Write:
    - report includes `connectedApps` identifiers when passed.
    - business + connectedApps + unverified identity → readiness error.
    - options with a transport-like extra field are not copied onto the report (type + runtime omit).
    - 33 identifiers fail closed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — composition options/report.
    - Docs pages to create/edit: `docs/host-compositions.md`, `docs/connected-apps.md`
    - `docs/index.md` update: no — existing Host compositions page; no new surface name
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 4 — Google Workspace HTTP adapter**
  - Acceptance Criteria:
    - Functional: `createGoogleWorkspaceHttpAdapter` implements `GoogleWorkspaceAdapter` for the existing `GoogleWorkspaceOp` set. `createWorkTools({ googleWorkspace: httpAdapter })` produces the same tool names, effects (`MUTATING_TOOL_NAMES`), draft-then-approve, recipient policy, and `WorkMailMessage` / `WorkCalendarEvent` / `WorkFileItem` / `WorkTaskItem` normalizers as the CLI adapter. `tokenProvider` required; missing/undefined token → `ERR_PRISM_WORK_CREDENTIAL` before any fetch. HTTP via injectable `fetch` defaulting to `pinnedFetch` against allow-listed Google API origins only (`gmail.googleapis.com`, `www.googleapis.com`, `tasks.googleapis.com`). `ensureReady` calls a bounded profile GET (Gmail `users.getProfile` or Drive `about.get`) instead of CLI `--version`. `mail.send` / `calendar.add` / `file.share` still go through drafts + approval when used via `createWorkTools`. `file.add` reads host-local `filePath` (same as CLI); rejects URLs. Anonymous Drive share still denied. CLI adapter and `buildGoogleWorkspaceArgv` unchanged.
    - Performance: one HTTP request per `runOp` (plus pagination only when the existing `pageAll` arg is set, bounded by `WorkLimits`). No extra process spawn. Mocked tests complete in the same class as current work-tools tests.
    - Code Quality: share a tiny `work/http.ts` helper (origin allowlist, bearer, JSON/byte limits, status mapping). Do not duplicate draft store. Do not add Google client SDKs.
    - Security: `pinnedFetch` (DNS pin, no redirects, public addresses). Tokens only in `Authorization`. No argv. Model cannot supply fetch URL. Origin allowlist fail-closed. Byte caps from `resolveWorkLimits`.
  - Approach:
    - Documentation Reviewed: [docs/work-tools.md](../docs/work-tools.md), [docs/work-connectors.md](../docs/work-connectors.md), Gmail/Calendar/Drive REST as in Task 1, `packages/prism-core/src/integrations/work/google-workspace.ts` argv map, `src/pinned-fetch.ts`.
    - Options Considered:
      - Replace CLI adapter (breaking; rejected).
      - `@googleapis` SDK (new dependency; rejected).
      - `runOp` over `pinnedFetch` + existing token env (chosen).
    - Chosen Approach: HTTP adapter is another implementation of the same interface. Map ops:
      - `mail.list|get` → `GET https://gmail.googleapis.com/gmail/v1/users/{userId}/messages` (+ `/{id}`)
      - `mail.send` → RFC822 via `POST .../messages/send` `{ raw }` built from `to`/`subject`/`body`/`cc`/`bcc`/`from` (host-built MIME, not model raw)
      - `calendar.list|add` → Calendar v3 `events` list/insert
      - `file.list|add|share` → Drive v3 files + permissions (`type=anyone` still denied)
      - `task.*` → Tasks API
      - `docs.create` / `sheets.create` / `slides.create` remain capability-gated; implement with Drive `files.create` + MIME types already implied by CLI, or fail `ERR_PRISM_WORK_CAPABILITY` until allowedOps includes them (same as CLI).
    - API Notes and Examples:
      ```ts
      import { createGoogleWorkspaceHttpAdapter, createWorkTools } from "@arnilo/prism-core/integrations/work";
      import { createOAuthWorkTokenProvider } from "@arnilo/prism-core/credentials/node";

      const googleWorkspace = createGoogleWorkspaceHttpAdapter({
        identity,
        tokenProvider: createOAuthWorkTokenProvider({
          provider: gwsOAuth,
          store,
          envVar: "GOOGLE_ACCESS_TOKEN",
        }),
        accessEnvVar: "GOOGLE_ACCESS_TOKEN",
        allowedOps: new Set(["mail.list", "mail.get", "mail.send"]),
      });
      const tools = createWorkTools({ googleWorkspace, approval, idempotencyStore });
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/integrations/work/http.ts`: shared fetch helper
      - `packages/prism-core/src/integrations/work/google-workspace-http.ts`
      - `packages/prism-core/src/integrations/work/index.ts`: exports
      - `packages/prism-core/src/integrations/work/__tests__/google-workspace-http.test.ts` (+ reuse normalizer/draft tests)
      - `docs/work-tools.md`, `docs/work-connectors.md`
      - `examples/enterprise-work-connectors.ts`: HTTP path next to CLI fake runner
      - budgets/compat for `@arnilo/prism-core` if export count grows
    - References: Gmail send `raw` (base64url RFC822); `WorkToolError` codes; `createOAuthWorkTokenProvider`.
  - Test Cases to Write:
    - missing token → `ERR_PRISM_WORK_CREDENTIAL`, zero fetch calls.
    - `mail.list` mock JSON normalizes to `WorkPage<WorkMailMessage>`.
    - `mail.send` without approval via `createWorkTools` is blocked (existing approval gate).
    - fetch to a non-allowlisted origin throws (even if test `fetch` would have succeeded).
    - `file.share` `type=anyone` → `ERR_PRISM_WORK_POLICY`.
    - `file.add` with `filePath: "https://evil.example/x"` rejected.
    - CLI `buildGoogleWorkspaceArgv` tests still pass unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new work subpath factory.
    - Docs pages to create/edit: `docs/work-tools.md`, `docs/work-connectors.md`
    - `docs/index.md` update: no — existing Work tools/connectors pages; blurb stays current-contract (HTTP + CLI)
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 5 — Microsoft 365 HTTP adapter**
  - Acceptance Criteria:
    - Functional: `createMicrosoft365HttpAdapter` implements `Microsoft365Adapter` for existing `Microsoft365Op`s via Microsoft Graph `https://graph.microsoft.com/v1.0` only (pinned). Same `createWorkTools` names/effects/drafts/idempotency/normalizers as CLI. Token fail-closed. `file.share` stays `scope` organization-only (CLI `spo file sharinglink add --scope organization`). Teams workload ops remain capability-gated (`allowedOps`); this is **not** a Teams channel. CLI adapter unchanged.
    - Performance: same as Task 4 (one Graph call per op, bounded pages).
    - Code Quality: reuse `work/http.ts`. No `@microsoft/microsoft-graph-client`, no `@pnp/cli-microsoft365` in the HTTP path.
    - Security: Graph origin allowlist; `pinnedFetch`; tokens in `Authorization` only; no SharePoint arbitrary webUrl fetch beyond the existing `webUrl`/`folderUrl` args validated as HTTPS Graph/SharePoint hosts already required by CLI policy — if current CLI passes `webUrl` through, HTTP adapter must still reject private/loopback hosts.
  - Approach:
    - Documentation Reviewed: [docs/work-tools.md](../docs/work-tools.md) M365 op table; Graph sendMail https://learn.microsoft.com/en-us/graph/api/user-sendmail ; `packages/prism-core/src/integrations/work/microsoft365.ts`.
    - Options Considered:
      - Drive/SharePoint via Graph only vs keep spo CLI for share (chosen: Graph permissions for organization scope; if Graph cannot express an existing CLI flag, fail `ERR_PRISM_WORK_CAPABILITY` rather than shell out).
    - Chosen Approach: Graph REST:
      - `mail.list|get` → `GET /me/messages`
      - `mail.send` → `POST /me/sendMail`
      - `calendar.list|add` → `/me/events`
      - `file.list|add|copy` → fixed Graph Drive-item paths; direct `drives/{drive}/items/{item}` URLs preserve the one-request bound, while arbitrary SharePoint link resolution fails `ERR_PRISM_WORK_CAPABILITY` rather than adding an unpinned second fetch
      - `file.share` → Graph `createLink` with organization scope only
      - `todo.*` / `planner.*` when `allowedOps` includes them
    - API Notes and Examples:
      ```ts
      const microsoft365 = createMicrosoft365HttpAdapter({
        identity,
        tokenProvider,
        accessEnvVar: "M365_ACCESSTOKEN",
      });
      ```
    - Files to Create/Edit:
      - `packages/prism-core/src/integrations/work/microsoft365-http.ts`
      - `packages/prism-core/src/integrations/work/index.ts`
      - `packages/prism-core/src/integrations/work/__tests__/microsoft365-http.test.ts`
      - `docs/work-tools.md`, `docs/work-connectors.md`
      - `examples/enterprise-work-connectors.ts`
      - budgets/compat if needed
    - References: Task 4 helper; existing M365 argv tests as the op contract.
  - Test Cases to Write:
    - missing token → `ERR_PRISM_WORK_CREDENTIAL`.
    - `mail.send` body matches Graph `sendMail` shape (`toRecipients` / `subject` / `body`).
    - organization-only share; anonymous/external share denied.
    - private-host `webUrl` rejected.
    - CLI argv tests unchanged.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new work factory.
    - Docs pages to create/edit: `docs/work-tools.md`, `docs/work-connectors.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 6 — Slack MCP example (Obscura-shaped wrap)**
  - Acceptance Criteria:
    - Functional: `examples/connected-slack-mcp.ts` compiles and exports a `demo()` that binds a mock Slack MCP server through `createConnectedAppSession`, classifies `list_*` / `get_*` / `search_*` as `{ kind: "none", idempotency: "none" }` and `post_*` / `update_*` / `delete_*` as default mutation, allowlists a small tool set, and asserts a read tool is observation and a write tool is `external_mutation`. No Slack npm dependency. No live Slack network.
    - Performance: example is network-free; mock connect returns immediately.
    - Code Quality: copy the Obscura `connect` + `effect` pattern; **do not** add `wrapMcpReadWrite` unless Task 1 evidence shows a third in-repo caller besides Obscura and this example (YAGNI). Do not refactor Obscura in this task.
    - Security: example transport is in-process/mock. Comments state hosts must `select` the real Slack MCP command/origin and inject tokens via stdio `env` or MCP OAuth — never model context.
  - Approach:
    - Documentation Reviewed: [docs/obscura.md](../docs/obscura.md), `packages/web-tools/src/obscura/mcp.ts` `createObscuraMcpTools`, Task 2 API.
    - Options Considered:
      - First-class Slack work-tool provider (drafts for chat; deferred — not needed for the template).
      - Example-only wrap (chosen).
    - Chosen Approach: example is the template. Real Slack MCP servers stay host-chosen.
    - API Notes and Examples:
      ```ts
      await apps.bind({
        appId: "slack",
        serverId: "slack",
        transport: mockTransport,
        allowTools: ["list_channels", "post_message"],
        effect: ({ remoteName }) =>
          /^(list_|get_|search_)/.test(remoteName) ? { kind: "none", idempotency: "none" } : undefined,
      });
      ```
    - Files to Create/Edit:
      - `examples/connected-slack-mcp.ts`
      - `examples/` compile/index if examples are enumerated (existing example test/gate)
      - `docs/connected-apps.md`: Slack wrap section
      - `docs/index.md` Testing and examples list if that page enumerates examples by name (it does)
    - References: `examples/enterprise-work-connectors.ts` `demo()` style; `examples/ag-ui-mcp-apps.ts`.
  - Test Cases to Write:
    - `demo()` returns `{ readEffect: "none", writeEffect: "external_mutation", tools: [...] }`.
    - example is typechecked by the existing examples gate.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new runtime export; yes example + docs how-to.
    - Docs pages to create/edit: `docs/connected-apps.md`; `docs/index.md` examples bullet
    - `docs/index.md` update: yes — add `connected-slack-mcp.ts` to the examples sentence under Testing and examples
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 7 — Open Connector sidecar example (out of core)**
  - Acceptance Criteria:
    - Functional: `examples/open-connector-sidecar/` contains a README + compose/recipe that runs Open Connector **as a sibling process**, and a network-free mock of its five MCP tools (`list_apps`, `list_connections`, `search_actions`, `get_action_guide`, `execute_action`) showing Prism bind + allowlist + `execute_action` left unclassified (mutation, `idempotency: unsupported`). README states: pin a release tag; do not track `main`; MCP `execute_action` has no `Idempotency-Key` (use HTTP `/v1/actions/:id` for writes); Prism identity mapping is host glue; do not put 1511 providers on the model.
    - Performance: mock demo is network-free. Compose is operator-only; not part of `npm test`.
    - Code Quality: no `package.json` dependency on Open Connector in any workspace package. No OC sources vendored.
    - Security: recipe uses loopback + `allowLoopbackHttp` only. Allowlist required. Warn that Slack-style proxy `skipDnsValidation` is incompatible with Prism `pinnedFetch`.
  - Approach:
    - Documentation Reviewed: Open Connector README MCP + HTTP idempotency (Task 1 links); [docs/mcp-tools.md](../docs/mcp-tools.md) loopback escape hatch.
    - Options Considered:
      - Optional peerDep (rejected — peers imply supported integration).
      - Example + mock only (chosen).
    - Chosen Approach: document the sidecar; test the admission policy against a mock five-tool server.
    - API Notes and Examples:
      ```ts
      await apps.bind({
        appId: "open-connector",
        serverId: "oc",
        transport: {
          type: "streamable-http",
          url: "http://127.0.0.1:3000/mcp",
          allowedOrigins: ["http://127.0.0.1:3000"],
          allowLoopbackHttp: true,
        },
        allowTools: ["search_actions", "get_action_guide", "execute_action"],
      });
      ```
    - Files to Create/Edit:
      - `examples/open-connector-sidecar/README.md`
      - `examples/open-connector-sidecar/docker-compose.yml` (operator recipe)
      - `examples/open-connector-sidecar.ts` or `examples/open-connector-sidecar/mock.ts` `demo()`
      - `docs/connected-apps.md`: sidecar section
    - References: MCP default effect; OC HTTP `Idempotency-Key`.
  - Test Cases to Write:
    - mock `execute_action` tool effect is `external_mutation` + `unsupported`.
    - bind without `select` allowing that origin fails (uses Task 2 `select`).
    - workspace package.json files do not mention `open-connector` / `oomol`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no runtime API; yes operator recipe.
    - Docs pages to create/edit: `docs/connected-apps.md`
    - `docs/index.md` update: no — recipe lives on the connected-apps page; do not add a third-party iPaaS index entry
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [x] **Task 8 — Docs consistency, graft, budgets, verification**
  - Acceptance Criteria:
    - Functional: current-contract pages use the prism-wiki API template; `docs/index.md` Tools entry for connected apps is one sentence with no plan number or version narrative. `docs/work-connectors.md` “host-pinned binary” principle becomes “host-pinned binary **or** HTTP adapter with pinned fetch”; out-of-scope still excludes Slack/Teams **channels**. `graft build` refreshed after the code tasks. `@arnilo/prism-mcp` and `@arnilo/prism-core` tests pass; root `npm test` 5/5; typecheck; lint; format; coverage gates hold or are rebaselined with recorded reasons. Export/budget ceilings updated only with reasons. Examples compile. No version bump (080 Task 10).
    - Performance: no new sleeps; no blanket budget bump.
    - Code Quality: `node scripts/package-truth.mjs --emit-docs` if inventory text changes (it should not — still 11 packages). Graft graph in sync.
    - Security: secret scan clean; no new deps; no OC/Klavis in lockfile.
  - Approach:
    - Documentation Reviewed: `.agents/skills/create-plan/references/prism-wiki.md`; [docs/index.md](../docs/index.md); 073/080 verification lists.
    - Options Considered:
      - Fold this into 080 Task 10 (rejected — cut must not mix feature verification with lockstep bump).
      - Dedicated verification task (chosen).
    - Chosen Approach: prove 081 green on 0.7.0 manifests; 080 Task 10 then bumps to 0.8.0 and writes CHANGELOG/migration covering 079+080+081.
    - API Notes and Examples:
      ```bash
      npm test && npm run typecheck && npm run lint && npm run format:check
      graft build
      node scripts/package-truth.mjs --emit-docs
      ```
    - Files to Create/Edit:
      - docs pages from Tasks 2–7 if any heading/index drift remains
      - `graft/` as produced by `graft build`
      - `scripts/budgets.json`, compat baselines, coverage config only with reasons
      - this plan checkboxes
    - References: 080 Task 10; 073 Task 29 gates (minus version bump).
  - Test Cases to Write:
    - none new unless a docs-freeze test needs the new index sentence (update that freeze if it exists).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API in this task — consistency only.
    - Docs pages to create/edit: touch-up only of pages listed above
    - `docs/index.md` update: only if Task 2/6 entries were missed
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Compromises Made

Known constraints at plan creation (not post-implementation):

- No 12th package; no in-repo API catalog; no Klavis/Open Connector/Nango dependency.
- Work HTTP is additive; CLI adapters stay for 0.8.0.
- HTTP adapters cover existing work ops only, not the full Gmail/Graph surface.
- Slack/Teams inbound channels are out of scope (079/080).
- MCP remote annotations remain untrusted for effect classification.
- Open Connector sidecar is an example; CI never pulls it.
- `execute_action` is never a first-class Prism tool; hosts that bind it get mutation + unsupported idempotency.
- 0.8.0 registry/tag remains operator-authorized in 080 Task 10.

## Further Actions

Discovered during implementation (2026-09-16):

- **Open Connector MCP `execute_action` accepts no `Idempotency-Key` (Task 7).** Hosts that need retry-safe connector writes must call HTTP `POST /v1/actions/:actionId` from host code or keep the write in the work draft/approve lifecycle. A bounded OC HTTP write adapter under `integrations/work` (drafts, idempotency, pinned fetch) is the candidate follow-up if demand appears — it must not become a first-class model-facing `execute_action` tool. **Final disposition ([082](082-Package-Evidence-Generation-And-Connected-App-Follow-Up-Review.md#review-disposition)): deferred, P3.** Reopen only for a supported host with retry-safe OC writes, verified identity-to-connection mapping, pinned host-to-OC transport, and a bounded draft/approval design using Runtime HTTP `Idempotency-Key`.
- **Work HTTP adapters accept direct Graph Drive-item URLs only (Task 5).** `file.list`/`add`/`copy`/`share` reject arbitrary SharePoint links so each call stays one bounded request; a host that only holds a sharing link resolves it to a drive item first. A bounded `/shares/{id}/driveItem` resolver could be added later if link-only hosts become common. **Final disposition ([082](082-Package-Evidence-Generation-And-Connected-App-Follow-Up-Review.md#review-disposition)): deferred, P3.** Reopen only when a supported host cannot resolve sharing links before calling Prism and supplies required Graph permission/redeem policy.
- **Task 5's Graph adapter initially added 14 non-null assertions to `packages/prism-core/src` (449 vs the recorded 435) and failed the non-null budget gate (Task 8).** Fixed by removing `!` (typed `graphDriveItem` overloads, destructured path parsing, explicit guards, a `requireTool` test helper) instead of re-baselining the recorded count; the ceilings stay 435/2,162. **Final disposition ([082](082-Package-Evidence-Generation-And-Connected-App-Follow-Up-Review.md#review-disposition)): closed.** Re-baseline only with a reviewed, recorded reason.
- **`scripts/scan-secrets.mjs` aborted its bare-path working-tree walk on the local `graft/` cache (Task 8).** `graft` is now in the scanner's ignored set alongside `.git`, `node_modules`, and `coverage`; the release gate was never affected because it scans `git ls-files`. A bare `.` walk still fails on a developer's gitignored `scripts/live.env` by design — a gitignore-aware walk would remove that local-only false failure. **Final disposition ([082](082-Package-Evidence-Generation-And-Connected-App-Follow-Up-Review.md#review-disposition)): rejected.** Ignored and untracked paths remain in a bare scanner walk; only bounded generated caches may be excluded.
- **`docs/_evidence/phase54-package-map.md` was stale from the 079 package split (Task 8).** It is regenerated by `node scripts/phase54-package-map.mjs`, not by `node scripts/package-truth.mjs --emit-docs`, so a package-adding plan can leave it stale until a gate run fails. **Final disposition ([082](082-Package-Evidence-Generation-And-Connected-App-Follow-Up-Review.md#review-disposition)): implemented.** `node scripts/package-truth.mjs --emit-docs` now regenerates it with every generated inventory/provider block.
