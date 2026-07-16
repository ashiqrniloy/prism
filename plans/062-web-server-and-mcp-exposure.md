# Web-standard server and MCP exposure

## Objectives
- Add one optional framework-free Web `Request -> Response` package for explicitly selected agents and workflows.
- Extend the existing MCP package with explicit, authorized Prism tool/command exposure using the installed MCP SDK v1 APIs.
- Keep authentication, authorization, route selection, ownership identity, listeners, and deployment adapters host-owned.

## Expected Outcome
- `@arnilo/prism-server` serves bounded direct/SSE agent runs and durable workflow run/status/cancel/resume routes without framework dependencies or default exposure.
- `@arnilo/prism-mcp` can register selected tools and workflow/agent command definitions on `McpServer`, plus provide a bounded web-standard Streamable HTTP handler.
- Package graph, docs, examples, migration notes, and roadmap reflect Phase 10 completion; all network-free release gates pass.

## Tasks

- [x] Inventory existing HTTP, event, workflow, authorization, and MCP SDK primitives
  - Acceptance Criteria:
    - Functional: identify reusable agent result/stream, workflow run/checkpoint/resume, tool dispatch, redaction, and MCP server/transport seams.
    - Performance: identify existing subscriber and workflow limits before adding server-specific bounds.
    - Code Quality: add no core route/server abstraction when package-local composition holds.
    - Security: identify explicit ownership/auth boundaries and SDK body/transport behavior before exposing capabilities.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 10; `docs/agent-session-runtime.md`, `docs/workflows.md`, `docs/mcp-tools.md`, `docs/host-security.md`, `docs/cli-rpc.md`.
      - Context7 `/modelcontextprotocol/typescript-sdk/v1.29.0`: `McpServer.registerTool`, linked `InMemoryTransport`, and Streamable HTTP connection examples.
      - Installed `@modelcontextprotocol/sdk@1.29.0` declarations: `McpServer`, `RequestHandlerExtra`, and `WebStandardStreamableHTTPServerTransport`.
    - Options Considered:
      - Framework adapters or core-owned listener: rejected; deployment policy and dependencies multiply.
      - New durable run engine: rejected; workflows already own checkpoint/status/resume and agents already own sessions/events.
      - Package-local handler plus explicit MCP registration: chosen.
    - Chosen Approach:
      - Reuse `AgentSession.run/stream`, workflow checkpoint APIs/event bus, core `dispatchToolCall`, and SDK server/transport directly.
    - API Notes and Examples:
      ```ts
      session.stream(input, { maxQueuedEvents: 128, signal });
      await mcp.connect(InMemoryTransport.createLinkedPair()[1]);
      ```
    - Files to Create/Edit:
      - `plans/062-web-server-and-mcp-exposure.md`: primitive decision record and execution checklist.
    - References:
      - `src/contracts.ts`, `src/agents.ts`, `src/tools.ts`, `packages/workflows/src/`, `packages/mcp/src/`.
  - Test Cases to Write:
    - none; inventory is verified by cited source/API compatibility and subsequent implementation tests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; inventory only.
    - Docs pages to create/edit: none; implementation tasks own public documentation.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add bounded web-standard agent/workflow handler package
  - Acceptance Criteria:
    - Functional: direct and SSE agent runs plus workflow run/stream/status/cancel/resume routes work for explicitly registered IDs.
    - Performance: body, result, SSE event/count/total, timeout, subscriber queue, retained active work, and concurrent runs are bounded; cancellation releases slots.
    - Code Quality: strict TypeScript; Web APIs only; no framework/listener/database/auth implementation and no core changes.
    - Security: unknown routes/capabilities deny; every operation calls host authorization; ownership comes only from authorization; JSON content type, route IDs, host/origin policy, errors, and secret redaction fail closed.
  - Approach:
    - Documentation Reviewed:
      - Prism agent/session and workflow API pages plus Web `Request`, `Response`, `ReadableStream`, `AbortSignal` APIs available on Node 20.
    - Options Considered:
      - Background agent result registry: deferred; no durable agent-run primitive exists and workflows already cover reconnect/status.
      - One generic callback router: rejected; typed agent/workflow maps keep selected surfaces inspectable.
    - Chosen Approach:
      - Add `@arnilo/prism-server` with package-local limits/router/body/SSE helpers. Require `authorize()` and non-empty returned ownership on every matched operation. Expose no IDs by default.
    - API Notes and Examples:
      ```ts
      const handler = createPrismHandler({
        agents: { support: agent },
        authorize: async () => ({ ownership: { tenantId: "tenant-1" } }),
      });
      const response = await handler(new Request("https://app.test/prism/agents/support/runs", { method: "POST", body: JSON.stringify({ input: "Hi" }), headers: { "content-type": "application/json" } }));
      ```
    - Files to Create/Edit:
      - `packages/server/`: package metadata, types, limits, handler/helpers, tests, README, changelog.
  - Test Cases to Write:
    - direct/SSE result, workflow status/resume/cancel, disconnect abort, malformed/overflow body, auth deny, unknown capability, ownership mismatch, route/origin/host rejection, response/event/concurrency/timeout bounds, redacted errors.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new optional server package.
    - Docs pages to create/edit: `docs/server.md`, `docs/host-security.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; add Server/API section.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Add explicit Prism MCP server registration and bounded web transport
  - Acceptance Criteria:
    - Functional: selected Prism tools and commands list/call through SDK `McpServer`; a bounded web-standard Streamable HTTP handler is available; existing client APIs remain unchanged.
    - Performance: request/result/concurrency/timeout limits apply and abort reaches tool/command execution.
    - Code Quality: use SDK v1.29 `McpServer.registerTool` and WebStandard transport; no custom JSON-RPC implementation.
    - Security: zero default registrations; required authorize callback; core dispatch permission/validator/redactor gates remain available; command names collide fail closed; errors/results are bounded and redacted.
  - Approach:
    - Documentation Reviewed:
      - Context7 and installed SDK declarations cited in Task 1; `docs/mcp-tools.md`; core `dispatchToolCall`; workflow `createWorkflowCommands()`.
    - Options Considered:
      - Reimplement SDK list/call handlers to preserve JSON Schema verbatim: rejected.
      - Convert Prism JSON Schema with installed Zod v4 `fromJSONSchema()` and use `registerTool`: chosen; unsupported schemas fail during server creation.
    - Chosen Approach:
      - Register only passed `ToolDefinition[]`/`CommandDefinition[]`; authorize each call from SDK auth/session metadata; map results to bounded MCP text/image responses. Parse bounded HTTP JSON before passing `parsedBody` to SDK transport.
    - API Notes and Examples:
      ```ts
      const server = createPrismMcpServer({ tools: [approvedTool], authorize: async () => ({ allowed: true }) });
      const handler = await createPrismMcpWebHandler(server, { resolveAuthInfo });
      ```
    - Files to Create/Edit:
      - `packages/mcp/src/server.ts`, `packages/mcp/src/index.ts`, `packages/mcp/src/types.ts`, server tests, package metadata/README/changelog.
  - Test Cases to Write:
    - in-memory list/call tool and command; unknown/unregistered capability; auth deny; validation/permission/tool error; abort/timeout/concurrency/result bounds; list-changed registration behavior; bounded web handler import/request.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; MCP server APIs and package dependency metadata.
    - Docs pages to create/edit: `docs/mcp-tools.md`, `docs/server.md`, `docs/host-security.md`.
    - `docs/index.md` update: yes; update MCP entry to client/server distinction.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Register package, document examples, and pass release validation
  - Acceptance Criteria:
    - Functional: server package packs/installs/imports and both examples run network-free.
    - Performance: package/tarball and suite metrics are recorded without regressing frozen gates.
    - Code Quality: package graph/count/release order/path mappings/docs tests are reconciled and roadmap/plan checked only after validation.
    - Security: audit remains clean, packed artifacts contain no tests/source maps/secrets, and server remains profile-excluded pending review.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`, package/install/docs boundary tests, `.github/workflows/release.yml`, and prior Phase 4/6/7/9 package enrollment.
    - Options Considered:
      - Add server to profiles immediately: rejected; opt-in remote listener boundary requires adoption/size review.
    - Chosen Approach:
      - Enroll the 29th publishable package in existing hardcoded checks, add native Web/MCP examples, update all API/cross-reference pages, then run focused tests and `npm run sdk:ready`.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      ```
    - Files to Create/Edit:
      - `package.json`, `package-lock.json`, package/install/docs tests, `examples/`, `docs/`, `README.md`, `CHANGELOG.md`, `roadmap.md`, this plan.
  - Test Cases to Write:
    - package dry-run/import smoke, docs headings/links/example execution, complete build/typecheck/test/pack/audit gate.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; package installation/navigation and Phase 10 status.
    - Docs pages to create/edit: `docs/server.md`, `docs/mcp-tools.md`, `docs/host-security.md`, `docs/release-and-install.md`, `docs/performance.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; server/API navigation and MCP description.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Durable reconnect/status is workflow-only. No in-memory agent result cache or second durable agent-run engine was added; direct agent callers receive a result and SSE callers own the live stream.
- `createPrismMcpWebHandler()` uses the SDK transport's stateless JSON-response mode so HTTP request/response bytes can be enforced simply. Hosts needing stateful MCP sessions, resumable SSE, or stdio call `McpServer.connect()` with an SDK transport directly.
- MCP server output is normalized to bounded text. Prism images and other rich blocks are summarized rather than introducing a second full content-protocol mapper in the server direction.
- MCP JSON Schema advertising uses Zod v4 `fromJSONSchema()` because SDK `McpServer.registerTool` accepts Zod schemas, not raw JSON Schema. `zod` is now a direct MCP package dependency even though SDK already brought the same package transitively.
- Timeout responses are bounded even when host callbacks ignore abort, but stopping their side effects remains cooperative through `AbortSignal`; Prism cannot forcibly terminate arbitrary in-process code.
- Server package remains outside every profile bundle pending Phase 14 size/use review.

## Further Actions
- Priority medium: add a host-owned durable agent-run query adapter only if multiple production hosts need agent reconnect/status without modeling the work as a workflow.
- Priority medium: add an optional stateful MCP web-session factory example if real deployments require resumable SDK SSE; do not add an in-package global session map.
- Priority low: preserve rich MCP image/resource output only after a consumer demonstrates need; reuse one shared bounded content mapper rather than duplicate client/server logic.
- Priority low: review `@arnilo/prism-server` profile inclusion in Phase 14; current tarball is 8.4 kB packed / 34.4 kB unpacked.
