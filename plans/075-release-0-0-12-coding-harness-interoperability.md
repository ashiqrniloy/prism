# Phase 7 — Release 0.0.12: Coding Harness Interoperability (P2)

## Objectives

- Ship optional `@arnilo/prism-ag-ui` adapters for AG-UI plus a thin ACP sibling export, built over existing `AgentEvent`, session, durable-run, ledger, authorization, redaction, and subscriber primitives.
- Let host-owned TUI/desktop applications start runs, stream safe projected message/tool/state events, present durable approvals, resume interrupted runs, and reconnect without rerunning completed work.
- Add the minimum generic resumable-event primitive needed by both AG-UI and ACP; keep protocol and UI logic out of core.
- Add an explicit coding-aware preset over the existing LLM `CompactionStrategy`; retain coding decisions/signals while preserving raw history and ordinary compaction entries.
- Keep provider login UX and credential persistence host-owned. Do not ship Anthropic Claude Code or Gemini CLI subscription OAuth adapters while current provider terms prohibit third-party use of those credentials.
- Version, document, benchmark, and release-validate the graph as **0.0.12**.

## Expected Outcome

- `@arnilo/prism-ag-ui` maps Prism run/message/tool/approval/error/state events to AG-UI `@ag-ui/core` events and exposes an authorized Web `Request` → `Response` handler with bounded SSE.
- `@arnilo/prism-ag-ui/acp` maps the shared message/tool/approval lifecycle to stable ACP session updates and permission requests without implementing a second agent runtime, terminal, filesystem, or editor.
- Core exposes one event-streaming durable-resume path reused by both protocol adapters; existing `resumeAgentRun()` and `AgentRunLifecycle.resume()` remain backward-compatible.
- Hosts can replay ownership-scoped `AgentEventRecord` pages through an explicit adapter, then attach to live bounded streams; reconnect is at-least-once and never reruns a terminal run.
- Outbound UI payloads are redacted and policy-projected. Tool arguments/results, arbitrary state, raw events, local paths, and frontend-supplied tools are denied by default.
- `createCodingCompactionStrategy()` reuses LLM compaction with coding-focused instructions and existing file-operation retention; compaction still appends standard `kind: "compaction"` entries and leaves source entries intact.
- Existing OpenAI Codex OAuth remains the only first-party subscription OAuth implementation. Anthropic and Google subscription credential reuse is explicitly unsupported under their current published terms; no misleading adapter or success stub ships.
- Network-free protocol/compaction benchmarks, `npm run sdk:ready`, supply-chain checks, 35-package pack checks, and 0.0.12 publish dry-runs pass.

## Tasks

- [x] 0. Freeze Phase 7 scope, protocol versions, primitive ownership, limits, OAuth eligibility, and evidence matrix
  - Acceptance Criteria:
    - Functional: map every Phase 7 roadmap criterion to an existing primitive, minimum gap, owning task, test, docs page, and release gate; freeze `@arnilo/prism-ag-ui` with an `./acp` sibling export and mark 0.0.13+ conversations/artifacts/enterprise identity out of scope.
    - Performance: freeze finite request/event/page/queue/text/tool/state/error/time caps; reconnect uses bounded existing persistence pages and subscriber overflow rather than polling daemons or unbounded event scans.
    - Code Quality: inventory `AgentEvent`, `AgentSession.stream/subscribe`, `AgentRunLifecycle`, `ProductionPersistenceStore.queryEvents`, server SSE, `SecretRedactor`, `OAuthProvider`, credential stores, LLM/OM compaction, and coding checkpoint/check result shapes; authorize only a generic durable-resume stream gap shared by AG-UI and ACP.
    - Security: record current provider authorization evidence: Anthropic forbids third-party Claude.ai subscription routing and Google forbids third-party Gemini CLI OAuth piggybacking; no adapter may ship without explicit provider documentation permitting Prism’s use case.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 7, Product Boundaries, Release Order gate 6; `docs/agent-events.md`, `docs/agent-session-runtime.md`, `docs/server.md`, `docs/runs-and-usage.md`, `docs/credentials-and-redaction.md`, `docs/credential-storage.md`, `docs/providers/openai.md`, `docs/compaction-and-retry.md`, `docs/compaction-llm.md`, `docs/compaction-observational-memory.md`.
      - AG-UI official Events, Tools, State, Interrupts, and Serialization docs: <https://docs.ag-ui.com/concepts/events>, <https://docs.ag-ui.com/concepts/tools>, <https://docs.ag-ui.com/concepts/state>, <https://docs.ag-ui.com/concepts/interrupts>, <https://docs.ag-ui.com/concepts/serialization>.
      - `@ag-ui/core` **0.0.57** schemas (`EventSchemas`, lifecycle/message/tool/state events, interrupt-aware `RunFinished`) from <https://github.com/ag-ui-protocol/ag-ui/tree/main/sdks/typescript/packages/core>.
      - ACP official overview/tool calls and TypeScript SDK: <https://agentclientprotocol.com/protocol/overview>, <https://agentclientprotocol.com/protocol/tool-calls>, <https://agentclientprotocol.com/libraries/typescript>; `@agentclientprotocol/sdk` **1.3.0** stable root export. Its `./experimental/v2` export is excluded from 0.0.12.
      - Anthropic Claude Code legal/auth docs: <https://docs.anthropic.com/en/docs/claude-code/legal-and-compliance> and <https://docs.anthropic.com/en/docs/claude-code/authentication>.
      - Gemini CLI FAQ/terms/auth docs: <https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/faq.md>, `docs/resources/tos-privacy.md`, and `docs/get-started/authentication.mdx`.
      - `.agents/skills/create-plan/references/prism-wiki.md`; no `.agents/skills/project-patterns` or `.agents/skills/project-wiki` directory exists.
    - Options Considered:
      - Copy protocol types into Prism: reduces dependencies but drifts from official schemas; rejected.
      - Put AG-UI/ACP contracts in core: couples dependency-free runtime to UI protocols; rejected.
      - Build a Prism TUI/desktop app: host product scope; rejected.
      - Clone Claude Code/Gemini CLI OAuth: provider terms explicitly prohibit third-party subscription credential routing; rejected.
      - Optional protocol package over existing runtime plus one shared resume-stream primitive: chosen.
    - Chosen Approach:
      - Freeze package name `@arnilo/prism-ag-ui`, root AG-UI exports, and `@arnilo/prism-ag-ui/acp` stable-ACP mapper.
      - Pin official protocol packages during implementation; run their schemas in network-free conformance tests.
      - Freeze default-deny UI projection: no raw tool args/results, arbitrary state, raw events, local path fields, client tools, or frontend state mutation without host policy callbacks.
      - Freeze reconnect as durable-page replay followed by live bounded subscription; duplicates across a page boundary are tolerated/deduplicated by stable event/message/tool IDs.
      - Treat OAuth roadmap language as conditional. Existing OpenAI Codex adapter remains supported; Anthropic/Google adapters remain absent until providers explicitly permit third-party subscription access.
    - API Notes and Examples:
      ```text
      package: @arnilo/prism-ag-ui
      subpath: @arnilo/prism-ag-ui/acp
      AG-UI schema: @ag-ui/core@0.0.57
      ACP schema: @agentclientprotocol/sdk@1.3.0 (stable root only)
      OAuth eligibility: explicit provider permission + protocol fixture + abort/refresh/redaction tests
      ```
    - Files to Create/Edit:
      - `docs/review-coverage-2026-07-22-phase-7.md`: new criterion/primitive/limit/threat/protocol/OAuth evidence matrix.
      - `docs/index.md`: add Phase 7 review coverage under Release and install.
      - `src/__tests__/docs.test.ts`: assert evidence page and unsupported OAuth boundary.
      - `plans/075-release-0-0-12-coding-harness-interoperability.md`: mark Task 0 complete only after freeze evidence lands.
    - References:
      - Current source revision: `f9630a9bd12f299fdf473640e3869eea050b786f`.
      - Existing AG-UI-shaped mapping primitives: redacted ordered `AgentEvent`, durable `AgentEventRecord`, ownership-scoped query cursors, and bounded subscriber overflow.
  - Test Cases to Write:
    - Traceability: each Phase 7 criterion has one owner; 0.0.13+ conversation/artifact/device work has none.
    - Primitive review: every proposed generic core addition has both AG-UI and ACP consumers; protocol-specific code remains package-local.
    - Policy regression: docs/tests expose no `createAnthropicSubscriptionOAuthProvider` or `createGeminiCliOAuthProvider` while current restrictions remain.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; freezes new package/subpath, durable resume stream, protocol versions, and OAuth support boundary.
    - Docs pages to create/edit:
      - `docs/review-coverage-2026-07-22-phase-7.md`: scope and evidence matrix.
      - `docs/index.md`: Phase 7 review link.
    - `docs/index.md` update: yes; Release and install → Phase 7 review coverage.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-22):
    - Added `docs/review-coverage-2026-07-22-phase-7.md`: frozen AG-UI `@ag-ui/core@0.0.57` and stable ACP SDK `@agentclientprotocol/sdk@1.3.0` revisions; `@arnilo/prism-ag-ui` / `./acp` exports; one shared streamed durable-resume extension; default-deny projection; bounded request/event/replay/queue/text/tool/state/error/time matrix; traceability, primitive, threat, OAuth, docs, and release matrices.
    - Froze OpenAI Codex as the only supported subscription OAuth. Anthropic and Google remain API-key-only: no Claude Code/Gemini CLI subscription credential reuse or adapter until explicit third-party provider authorization and complete protocol/redaction/store evidence exist.
    - Added docs navigation and a regression guard for frozen API names, protocol revisions, scope exclusions, caps, and absent Anthropic/Google OAuth factories; updated immutable plan count to 76.
    - Validation passed: `npm run build:core && node --test dist/__tests__/docs.test.js` (90 pass); `git diff --check`.

- [x] 1. Add one generic event-streaming durable-resume primitive
  - Acceptance Criteria:
    - Functional: core exports `resumeAgentRunStream()` (final name frozen in Task 0) and `AgentRunLifecycle.resumeStream()`; approve/deny resumes preserve existing CAS, ownership, fingerprint/revision, policy, guardrail, limit, and ambiguous-dispatch behavior while yielding the same normalized `AgentEvent` lifecycle as an ordinary streamed run.
    - Performance: resume streams reuse `SubscribeOptions` caps/overflow and abort promptly; no event polling, duplicate provider execution, retained worker after suspension, or unbounded buffer is introduced.
    - Code Quality: refactor shared resume preparation/execution once so `resumeAgentRun()` and streaming resume cannot diverge; no protocol types or UI state enter core.
    - Security: authorization and expected-version checks happen before any event/tool/provider work; events pass through the active redactor; disconnect/abort cannot authorize or replay a side effect.
  - Approach:
    - Documentation Reviewed:
      - `src/agents.ts` `resumeAgentRun`, `RuntimeAgentSession.stream/subscribe/resumeDurable`; `src/agent-run-lifecycle.ts`; `src/contracts.ts` `AgentRunResume`, `AgentEvent`, `SubscribeOptions`.
      - `docs/agent-session-runtime.md`, `docs/agent-events.md`, `docs/guardrails.md`, `docs/runs-and-usage.md`.
      - Task 0 primitive decision and AG-UI interrupt / ACP permission lifecycle docs.
    - Options Considered:
      - Have each adapter poll `RunLedger` after `resume()`: loses live deltas and adds polling; rejected.
      - Add protocol callbacks to `resumeAgentRun()`: couples core to adapters; rejected.
      - Common resume preparation plus direct-result and streamed wrappers: chosen.
    - Chosen Approach:
      - Extract the existing load/validate/CAS/deny-or-claim path into one private helper.
      - Subscribe before resumed execution and filter by the owned run ID, mirroring `AgentSession.stream()`; return/close on suspended or terminal lifecycle.
      - Add `resumeStream` to lifecycle without changing existing `status`/`resume` behavior.
    - API Notes and Examples:
      ```ts
      for await (const event of lifecycle.resumeStream(
        { runId, sessionId },
        { decision: "approve", expectedVersion },
        { ownership, signal, agentId, maxQueuedEvents: 128, overflow: "close" },
      )) {
        consume(event);
      }
      ```
    - Files to Create/Edit:
      - `src/agents.ts`: shared resume path and streamed export.
      - `src/agent-run-lifecycle.ts`: `resumeStream` facade.
      - `src/contracts.ts`, `src/index.ts`: narrow public types/exports.
      - `src/__tests__/agent-run-state.test.ts`, `src/__tests__/agent-run-lifecycle.test.ts`, `src/__tests__/public-export-contract.test.ts`: parity/CAS/stream tests.
    - References:
      - Existing `AgentSession.stream()` subscribe-before-run pattern and `AgentEvent` redaction boundary.
  - Test Cases to Write:
    - Approve emits resumed/tool/message/terminal events once and returns no stale-event leakage from another run.
    - Deny emits `agent_denied` terminal behavior without provider/tool execution.
    - Wrong owner, stale version, revision/fingerprint mismatch, and dispatched-tool ambiguity emit no public run data.
    - Subscriber overflow, caller abort, and consumer `return()` close work without replaying side effects.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new core durable-resume stream and lifecycle method.
    - Docs pages to create/edit:
      - `docs/agent-session-runtime.md`: resume stream API and security semantics.
      - `docs/agent-events.md`: resumed stream ordering/overflow.
      - `docs/public-contracts.md`: new exported method/type.
    - `docs/index.md` update: no; existing Agent/session runtime and Agent events entries remain correctly placed, with text refresh deferred to Task 7.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-22):
    - Added root `resumeAgentRunStream()` and `AgentRunLifecycle.resumeStream()` with `AgentRunResumeStreamOptions` / `AgentRunLifecycleStreamRequest`; protocol/UI types remain outside core.
    - Refactored existing load, ownership, revision/fingerprint, expected-version, deny, ambiguity, configuration, and CAS-claim flow into one private prepare path shared by direct and streamed resume. The stream subscribes before execution, filters the selected run, forwards bounded subscriber options and abort, and early consumer return aborts only resumed execution.
    - Denial emits and closes after one redacted `agent_denied`; approval retains normal redacted `agent_started` → `agent_resumed` → tool/message/terminal lifecycle. Dispatched tools remain ambiguous and never replay automatically.
    - Added approval/deny/abort/overflow/lifecycle facade/public-export tests and updated runtime, event, and public-contract docs.
    - Validation passed: `npm test`; `node --test dist/__tests__/docs.test.js` (90 pass); `git diff --check`.

- [x] 2. Create `@arnilo/prism-ag-ui` and implement bounded outbound AG-UI mapping
  - Acceptance Criteria:
    - Functional: package maps Prism run, assistant text, tool call/result/progress, interruption, state, usage, compaction, and error events to valid AG-UI lifecycle/message/tool/state/custom events; event ordering closes active message/tool sequences before `RUN_FINISHED`/`RUN_ERROR`.
    - Performance: mapping is O(1) per event except finite projection/serialization; every mapped event, projected field, string, and aggregate stream obeys frozen byte/event/time caps.
    - Code Quality: use `@ag-ui/core` 0.0.57 event types/schemas instead of copied protocol unions; one stateful mapper tracks active message/tool IDs; package import is inert and framework-free.
    - Security: default mapper exposes tool name/status only, omits raw args/results/progress/state/path fields, applies host redactor plus declared sensitive-path mappings, and never emits `RAW` passthrough events by default.
  - Approach:
    - Documentation Reviewed:
      - AG-UI event lifecycle, `EventSchemas`, message start/content/end, tool start/args/end/result, state snapshots/deltas, custom events, and interrupt outcomes.
      - `src/contracts.ts` full `AgentEvent` union; `src/redaction.ts`; `docs/agent-events.md` ordering and overflow.
      - Optional package layout from `packages/browser`, `packages/observability-opentelemetry`, and `packages/server`.
    - Options Considered:
      - Stateless one-event mapping: cannot correlate Prism deltas lacking a message ID or close AG-UI sequences; rejected.
      - Forward complete Prism events as AG-UI `RAW`: leaks implementation payloads and defeats interoperability; rejected.
      - Small stateful mapper with explicit projection policy: chosen.
    - Chosen Approach:
      - Add `createAgUiEventMapper({ redactor, projection, limits })` returning mapped official events.
      - Correlate Prism `message_started`/delta/finished and tool IDs; map unsupported metadata-only lifecycle to bounded named `CUSTOM` events only when explicitly enabled.
      - Emit adapter-owned status snapshots containing public run status/version/approval descriptors only; arbitrary session/application state requires a host projector.
      - Parse every produced event through official schemas in tests.
    - API Notes and Examples:
      ```ts
      const mapper = createAgUiEventMapper({
        redactor,
        projection: {
          toolArguments: () => undefined,
          toolResult: () => undefined,
          path: (value) => value.replace(workspaceRoot, "/workspace"),
        },
      });
      const events = mapper.map(prismEvent);
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/package.json`, `tsconfig.json`, `README.md`, `CHANGELOG.md`.
      - `packages/ag-ui/src/index.ts`, `ag-ui-mapper.ts`, `projection.ts`, `limits.ts`, `errors.ts`.
      - `packages/ag-ui/src/__tests__/ag-ui-mapper.test.ts`, `limits.test.ts`, `index.test.ts`.
      - Root `package.json`, `package-lock.json`: workspace and pinned optional-package dependencies (`@ag-ui/core`, later ACP SDK; core remains dependency-free).
    - References:
      - AG-UI standard start/content/end and interrupt-aware lifecycle validation.
  - Test Cases to Write:
    - Full message and tool success/error/blocked/progress mappings parse with official schemas and preserve order.
    - Suspended run produces safe state/messages boundary then interrupt outcome; failed run produces one `RUN_ERROR`; success produces one `RUN_FINISHED`.
    - Unknown future Prism event fails safe or emits opt-in namespaced custom event.
    - Secrets, absolute host paths, nested arguments/results, circular metadata, oversized strings/events, and malformed projector output never cross the adapter.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new package and AG-UI event/projection contracts.
    - Docs pages to create/edit:
      - `docs/ag-ui.md`: mapper inputs, outputs/events, projection, limits, examples.
      - `docs/agent-events.md`: AG-UI relationship.
    - `docs/index.md` update: Task 7 adds Multi-agent and interoperability → Frontend interoperability.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-22):
    - Added private-until-release `packages/ag-ui` workspace with inert root export, pinned `@ag-ui/core@0.0.57`, exact core peer, lockfile record, README, changelog, and package-local error/limit/projection/mapper modules. Task 8 makes it publishable, adds it to `prism-all`, and updates 0.0.12 release/package guards.
    - `createAgUiEventMapper()` redacts first, maps ordered run/text/tool/status events through official `EventSchemas`, closes active text/tool sequences before terminal output, and emits one `RUN_ERROR` or `RUN_FINISHED`. Suspension remains a safe state snapshot; Task 3 owns interrupt-finish/resume handling.
    - Default projection exposes tool name/status only. Args/results require string projectors; state/custom values require JSON-safe host projection; progress, usage, and compaction use bounded namespaced `CUSTOM` only when opted in. Raw events, paths, metadata, tool payloads, and arbitrary state remain absent by default.
    - Added schema/order/redaction/error/unknown-event/limit tests. Existing release-doc guards now enumerate only public manifests, allowing this unreleased workspace package without falsely claiming it shipped in 0.0.11.
    - Validation passed: `npm test`; `git diff --check`.

- [x] 3. Add authorized bidirectional AG-UI run, approval/resume, and reconnect handling
  - Acceptance Criteria:
    - Functional: `createAgUiHandler()` validates `RunAgentInput`, resolves an authorized host session/thread, runs the latest accepted user input, streams mapped events, converts Prism durable suspension to AG-UI interrupts, validates complete resume payloads, and resumes through `AgentRunLifecycle.resumeStream()`; frontend tools/state are ignored or rejected unless host allow-listed.
    - Functional: an explicit replay adapter pages ownership-scoped `AgentEventRecord` rows by thread/run/cursor, emits stable IDs in order, then attaches to a live stream when applicable; terminal replay never reruns provider or tool work.
    - Performance: Web request body, message count/content, tools/state, replay pages, total replay/live events/bytes, subscriber queue, and wall time are finite; backpressure uses existing `overflow: "close"` defaults.
    - Code Quality: handler uses Web `Request`/`Response` and official AG-UI encoding; host callbacks own authorization/session lookup and optional replay store; no server framework, conversation service, UI state database, or second run runtime is added.
    - Security: thread/run IDs are treated as untrusted selectors and rebound to authorization ownership; resume requires exact interrupt/run/version correlation; client tools cannot grant backend capabilities; input/output redaction and projection run before persistence/transport exposure.
  - Approach:
    - Documentation Reviewed:
      - AG-UI `RunAgentInput`, frontend tools, interrupts/resume, serialization/reconnect, and SSE encoding APIs at pinned version.
      - `packages/server/src/handler.ts` bounded Web handler/SSE pattern; `ProductionPersistenceStore.queryEvents`; `AgentRunLifecycle`; `SessionStore` branch rebuild.
      - `docs/server.md`, `docs/agent-session-runtime.md`, `docs/runs-and-usage.md`, `docs/host-security.md`.
    - Options Considered:
      - Add AG-UI routes to `@arnilo/prism-server`: makes generic server depend on UI protocol; rejected.
      - Trust client-supplied full history/tools/state: duplicates durable history and broadens capabilities; rejected.
      - Adapter-owned handler with host authorization/session/replay callbacks and final-user-message default: chosen.
    - Chosen Approach:
      - Parse the official input schema before resolving capabilities; accept only supported message content and use the last new user message unless host supplies a stricter input resolver.
      - Keep Prism IDs internal where needed; maintain bounded protocol-run ↔ Prism-run/interrupt correlation in emitted metadata and durable checkpoint references.
      - Represent approve/deny as a strict response schema, map it to `AgentRunResume`, and reject partial/unknown/stale resumes.
      - Provide `createPersistenceAgUiReplay(store)` (name tentative) over `queryEvents`; page-boundary reconnect is at-least-once and event/message/tool IDs make duplicates suppressible.
    - API Notes and Examples:
      ```ts
      const handle = createAgUiHandler({
        authorize,
        sessionFactory: ({ threadId, authorization }) => sessions.open(threadId, authorization),
        lifecycle,
        replay: createPersistenceAgUiReplay(store),
        redactor,
      });

      return handle(request);
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/src/handler.ts`: consolidated Web handler, interrupt conversion, and bounded SSE encoder (small enough to avoid one-file-only abstractions).
      - `packages/ag-ui/src/input.ts`, `replay.ts`, `types.ts`, public exports/types.
      - `packages/ag-ui/src/__tests__/handler.test.ts`.
      - `examples/ag-ui-server.ts` (network-free fake request/provider); `examples/README.md`, `examples/tsconfig.json`.
      - `packages/ag-ui/{README,CHANGELOG}.md`.
      - Core/server files only if Task 1’s generic stream needs a directly tested integration hook; no AG-UI import outside package/example.
    - References:
      - Existing Prism server ownership, body/SSE/timeout limits and durable event query cursors.
  - Test Cases to Write:
    - Start → text/tool → success stream; malformed input/content/client tool/state fails before run.
    - Tool approval interrupt → valid approve/deny resume; stale/wrong-owner/wrong-thread/unknown/partial resume fails without side effects.
    - Disconnect with background completion, replay completed records, reconnect cursor/page duplication, and terminal no-rerun behavior.
    - Slow consumer overflow, request timeout, abort, event/page/aggregate overflow, redacted error, and no local-path/tool-payload leakage.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new handler, input, interrupt, replay, and transport behavior.
    - Docs pages to create/edit:
      - `packages/ag-ui/README.md`: handler, host authorization, resume, replay, and frontend-tool boundary summary.
      - Canonical `docs/ag-ui.md`, `docs/server.md`, `docs/host-security.md`, and `docs/runs-and-usage.md`: deferred to Task 7, which owns complete public documentation/index navigation.
    - `docs/index.md` update: Task 7 adds Frontend interoperability entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-22):
    - Added `createAgUiHandler()` using official `RunAgentInputSchema`, Web `Request`/`Response`, official event schemas, bounded UTF-8 request/SSE handling, host authorization/session callbacks, and default rejection of frontend tools/non-empty state. It accepts only final text user content.
    - Durable suspension closes active AG-UI sequences and emits `RUN_FINISHED` interrupt with a strict approve/deny schema. Resume requires one exact `runId:version` interrupt ID, authorized host run resolution, current lifecycle status/version, then delegates only to `AgentRunLifecycle.resumeStream()`.
    - Added `createPersistenceAgUiReplay()` over ownership-scoped, redacted `queryEvents` pages. Replay attaches stable `prismEventId` tags, stops terminal pages without session/provider work, emits a bounded next-cursor custom event, and attaches a bounded filtered live subscriber only after a final non-terminal page.
    - Added network-free handler tests for final-user input, pre-authorization state denial, durable suspend/approve/stale-resume behavior, and terminal replay no-rerun; added runnable `examples/ag-ui-server.ts`. Canonical docs/index work remains Task 7.
    - Validation passed: `npm run typecheck`; `npm test`; `node examples/ag-ui-server.ts`; `node --test dist/__tests__/docs.test.js` (90 pass); `git diff --check`.

- [x] 4. Add thin stable ACP sibling mapping over the same event/approval contracts
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-ag-ui/acp` maps assistant message deltas, tool lifecycle/status/content, usage, errors, and durable approvals to stable ACP `session/update` plus `session/request_permission`; prompt/resume/cancel glue delegates to Prism sessions/lifecycle rather than implementing another agent.
    - Performance: updates, projected tool content, permission prompts/options, and queues stay under shared package caps; no terminal byte stream, filesystem watcher, editor mirror, or process supervisor is introduced.
    - Code Quality: use `@agentclientprotocol/sdk` 1.3.0 stable types/builders and the shared package projection/limits; experimental v2 exports and duplicated AG-UI mapping logic are excluded.
    - Security: ACP absolute paths, raw input/output, diffs, terminals, and filesystem methods are omitted by default; an explicit host path projector is required before any location/diff path is emitted; unknown permission outcomes never authorize.
  - Approach:
    - Documentation Reviewed:
      - ACP stable SDK README/builders and official protocol overview, prompt lifecycle, session updates, tool calls, permission options/outcomes, cancellation, and path requirements.
      - Task 0 package/subpath decision; Tasks 1–3 shared resume/projection/replay primitives.
    - Options Considered:
      - Full ACP agent subprocess/editor/filesystem implementation: duplicates host/editor responsibilities; rejected.
      - Documentation-only ACP parity claim: not executable; rejected.
      - Thin mapper/session adapter for shared events and approvals: chosen.
    - Chosen Approach:
      - Export `createAcpEventMapper()` and `createPrismAcpAgent()` (final names frozen in Task 0) from `./acp`.
      - Map Prism events to stable SDK session updates; request permission only for durable Prism interruptions and translate selected reject/allow outcomes through exact-version resume.
      - Advertise only implemented capabilities; leave terminal/filesystem/MCP/editor commands to host ACP client integrations.
    - API Notes and Examples:
      ```ts
      import { createPrismAcpAgent } from "@arnilo/prism-ag-ui/acp";

      const agent = createPrismAcpAgent({
        sessions,
        lifecycle,
        projection,
        authorize,
      });
      // Host connects `agent` using @agentclientprotocol/sdk transport.
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/package.json`, `package-lock.json`: `./acp` export; pinned `@agentclientprotocol/sdk@1.3.0` dependency and compatible Zod peer requirement.
      - `packages/ag-ui/src/acp/index.ts`, `mapper.ts`, `agent.ts`; `agent.ts` owns the small permission conversion rather than creating a one-use module.
      - `packages/ag-ui/src/__tests__/acp-mapper.test.ts`, `acp-agent.test.ts` (including package self-subpath export check).
      - `packages/ag-ui/README.md`, `CHANGELOG.md`.
    - References:
      - ACP stable `agent({ name })`, `newSession`, `prompt`, client `sessionUpdate`, and `requestPermission` APIs.
  - Test Cases to Write:
    - Text/tool/usage/error updates conform to stable SDK types and maintain per-tool order/status.
    - Permission allow-once/reject/cancel map correctly; unknown/future outcomes deny; stale/wrong-owner resumes fail.
    - No path/raw input/raw output/diff/terminal field appears without explicit projection.
    - ACP package subpath imports from a packed offline consumer; experimental v2 is absent.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new package subpath and ACP mapping/permission behavior.
    - Docs pages to create/edit:
      - `packages/ag-ui/README.md`: stable ACP sibling scope and excluded capabilities.
      - Canonical `docs/ag-ui.md`, `docs/a2a.md`, and `docs/host-security.md`: deferred to Task 7, which owns complete public documentation/index navigation.
    - `docs/index.md` update: Task 7 updates Frontend interoperability description to mention AG-UI and ACP.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-22):
    - Added `@arnilo/prism-ag-ui/acp` using only stable root exports from pinned `@agentclientprotocol/sdk@1.3.0`; its package export and tarball include `createAcpEventMapper()` and `createPrismAcpAgent()` without experimental ACP exports.
    - Mapper converts redacted assistant deltas, safe tool upserts/statuses, safe projected tool display content, usage, and errors to stable ACP session updates. It omits paths, diffs, terminals, locations, raw inputs/outputs, filesystem/MCP/editor capabilities, and arbitrary metadata by default.
    - Agent builder uses the SDK `agent()` / `methods` builders, binds every new/prompt/cancel/close selector through host authorization, accepts only bounded text prompts, delegates run and durable approval resumes to Prism session/lifecycle streams, and maps allow-once to approve while reject, cancellation, and unknown choices deny. Per-update, total stream byte/event, queue, and input bounds reuse package limits.
    - Added network-free stable type/mapper/projection/permission/denial/stream-cap/subpath tests; package README/changelog clarify excluded scope. Canonical docs/index work remains Task 7.
    - Validation passed: `npm run typecheck`; `npm test --workspace @arnilo/prism-ag-ui` (13 pass); `npm pack --dry-run --workspace @arnilo/prism-ag-ui`; `git diff --check`.

- [x] 5. Add explicit coding-aware LLM compaction preset
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-compaction-llm` exports `createCodingCompactionStrategy()` that preserves the existing structured goal/progress/decision context while explicitly prioritizing modified/read paths, diff/patch intent, commands, failing-check summaries, plan/todo state, blockers, and next verification steps.
    - Functional: preset returns ordinary standard compaction entries, supports repeated compaction, and leaves raw session history listable/rebuildable.
    - Performance: reuse existing provider stream, tool-result truncation, summary/reserve/error/file-operation limits and abort signal; preset adds no unbounded parser or second provider call.
    - Code Quality: implement as a thin preset over `createLlmCompactionStrategy()` and existing file-operation preparation; do not add a coding-memory runtime or dependency from core/coding-agent to compaction packages.
    - Security: active redactor/context secrets apply to prompt, provider error, summary, data, and events; exact paths remain subject to host redaction and summary caps.
  - Approach:
    - Documentation Reviewed:
      - `packages/compaction-llm/src/{strategy,prompts,prepare,file-ops,serialize}.ts`; `docs/compaction-llm.md`, `docs/compaction-and-retry.md`, `docs/coding-agent-tools.md`.
      - Existing `CompactionStrategy`, compaction conformance helper, coding plan/check/Git handoff data shapes.
    - Options Considered:
      - New deterministic coding-memory ledger: second memory runtime; rejected.
      - Observational-memory coding worker profile: extra worker/provider/tool complexity for a prompt-selection requirement; rejected.
      - Thin LLM compaction preset with bounded coding focus: chosen.
    - Chosen Approach:
      - Wrap `createLlmCompactionStrategy()` with name `coding`, file-operation tracking enabled, and additive coding instructions; caller options still choose provider/model/limits and may narrow behavior.
      - Keep current system summary sections; do not preserve complete diffs when a bounded decision/hunk summary suffices.
      - Run existing compaction conformance plus coding fixtures with a deterministic mock summary provider.
    - API Notes and Examples:
      ```ts
      import { createCodingCompactionStrategy } from "@arnilo/prism-compaction-llm";

      await session.compact({
        strategy: createCodingCompactionStrategy({ provider, summaryModel }),
      });
      ```
    - Files to Create/Edit:
      - `packages/compaction-llm/src/coding.ts`, `src/index.ts`, `src/strategy.ts`, `src/__tests__/coding.test.ts`.
      - `packages/compaction-llm/README.md`, `CHANGELOG.md`.
      - `packages/prism-compaction/README.md`; no new package.
      - `docs/compaction-llm.md`, `docs/compaction-and-retry.md`, `docs/coding-agent-tools.md`.
    - References:
      - Existing prompt already preserves paths, commands, errors, IDs, decisions, and user constraints; preset only fills coding-specific check/diff/plan emphasis.
  - Test Cases to Write:
    - Fixture contains modified/read paths, diff decision, failed check, plan/todo, blocker, and next command; provider request includes all signals and returned summary remains capped.
    - Repeated compaction incorporates prior summary and preserves recent messages/raw entries.
    - Secret in path/check/tool output is absent from provider-safe serialization, result entry, and `compaction_finished` event.
    - Abort/provider error appends no entry; standard compaction conformance passes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new compaction package export/preset.
    - Docs pages to create/edit:
      - `docs/compaction-llm.md`: preset API and limits.
      - `docs/compaction-and-retry.md`: selection guidance.
      - `docs/coding-agent-tools.md`: coding-session composition example.
    - `docs/index.md` update: Task 7 updates LLM compaction package description.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-22):
    - Added public `createCodingCompactionStrategy()` / `CodingCompactionStrategyOptions` as the fixed `coding` wrapper over `createLlmCompactionStrategy()`. It always enables existing file-operation collection/final blocks and adds concise coding focus for paths, patch intent, commands/checks, plans/todos, blockers, and verification; caller provider/model/limit options and additive focus remain available.
    - Kept ordinary LLM compaction behavior: one history call plus only any existing split-turn prefix call, finite existing limits, standard `kind: "compaction"` entry, raw append-only history, no coding runtime/parser/worker/dependency/filesystem read, and no complete-diff retention.
    - Closed shared redaction gaps: context and configured secrets now combine, custom instructions are redacted before provider requests, and read/modified paths in persisted compaction data are redacted. The preset tests cover repeated prior-summary input, paths/tool calls, patch/check/plan signals, summary caps, data/event redaction, provider failure no-append, abort conformance, and public-barrel import.
    - Updated package/umbrella README/changelog and canonical compaction/retry/coding-tool guidance. `docs/index.md` navigation remains Task 7 ownership.
    - Validation passed: `npm run typecheck`; `npm test` (full workspace); `npm pack --dry-run --workspace @arnilo/prism-compaction-llm`; `git diff --check`.

- [x] 6. Lock subscription OAuth support to provider-authorized flows
  - Acceptance Criteria:
    - Functional: provider/package docs and auth registration accurately list OpenAI Codex as the only first-party subscription OAuth flow; Anthropic/Google packages continue API-key auth and expose no subscription OAuth factory, auth descriptor, provider route, or token import shortcut.
    - Performance: no new login polling, refresh timer, credential scan, CLI process, or background network path is added.
    - Code Quality: reuse existing `OAuthProvider`, `refreshOAuthCredential`, and Node store adapter unchanged; record a deterministic eligibility checklist for future provider-local adapters instead of a speculative generic OAuth framework.
    - Security: docs quote/link provider restrictions, reject credential-file scraping and CLI token reuse, keep login UI/store host-owned, and require future flows to pass abort/state/PKCE/refresh/expiry/bounded-response/redaction/store-round-trip tests before registration.
  - Approach:
    - Documentation Reviewed:
      - Anthropic legal/auth pages and Gemini CLI FAQ/terms cited in Task 0.
      - `packages/provider-openai/src/oauth.ts`; `OAuthProvider`; `refreshOAuthCredential`; `createOAuthCredentialStoreAdapter`.
      - `docs/credentials-and-redaction.md`, `docs/credential-storage.md`, provider docs.
    - Options Considered:
      - Ship adapters hidden behind “experimental”: still violates current terms and creates user risk; rejected.
      - Import tokens created by official CLIs: credential piggybacking; rejected.
      - Leave docs ambiguous: hosts may assume native provider packages accept subscription login; rejected.
      - Explicit supported matrix plus future eligibility gate: chosen.
    - Chosen Approach:
      - Make no OAuth production-code change unless authoritative terms change before this task executes.
      - Add docs and regression assertions for the supported matrix and forbidden adapter names/registration.
      - If a provider later publishes an explicitly third-party-supported flow, update Task 0 evidence first, then amend this task with exact endpoints/scopes/files/tests before implementation.
    - API Notes and Examples:
      ```ts
      // Supported first-party subscription OAuth in 0.0.12:
      createOpenAICodexOAuthProvider({ /* host callbacks/options */ });

      // Anthropic and Gemini subscription OAuth: intentionally no Prism API.
      ```
    - Files to Create/Edit:
      - `docs/credentials-and-redaction.md`, `docs/credential-storage.md`, `docs/host-security.md`.
      - `docs/providers/openai.md`, `docs/providers/anthropic.md`, `docs/providers/google.md`, `docs/provider-packages.md`.
      - `src/__tests__/docs.test.ts`: support-matrix, restriction-link, future-eligibility, and absent-registration guard.
      - `packages/provider-{openai,anthropic,google}/src/__tests__/{openai,anthropic,google}.test.ts`: exact auth-registration assertions.
      - Provider README/CHANGELOG files only for clarified auth support; no OAuth source module expected.
    - References:
      - Anthropic: third-party developers must use API keys/cloud providers and may not route user Claude.ai subscription credentials.
      - Google: third-party software accessing Gemini CLI/Code Assist through Gemini CLI OAuth violates applicable terms; use Vertex AI or AI Studio API key.
  - Test Cases to Write:
    - Anthropic/Google package setup registers only documented API-key auth and no OAuth provider.
    - OpenAI Codex existing PKCE/device/abort/refresh/redaction/store tests remain green.
    - Docs regression includes provider restriction links and future eligibility checklist.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; support boundary is clarified and unsupported credential behavior is explicitly rejected.
    - Docs pages to create/edit: provider/credential pages listed above plus `docs/host-security.md` credential-piggyback warning.
    - `docs/index.md` update: Task 7 refreshes Credentials and Providers descriptions only if navigation summaries need the supported OAuth boundary.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-22):
    - Kept production OAuth seams unchanged. `@arnilo/prism-provider-openai` continues to register the existing host-invoked OpenAI Codex OAuth descriptor; Anthropic and Google each register exactly one API-key descriptor and expose no subscription factory, descriptor, route, token import, polling loop, refresh timer, credential scan, or CLI process.
    - Published a consistent support matrix in credential, storage, provider-package, provider, package README/changelog, and host-security guidance. It links the current Anthropic legal restriction and Gemini CLI terms/FAQ, forbids Claude Code/Gemini CLI credential-file, setup-token, browser-session, and subscription-routing reuse, and keeps login UI/storage host-owned.
    - Documented future eligibility as provider-local only: explicit third-party permission and documented endpoints/scopes, then PKCE/state as applicable, abort/expiry, bounded responses, refresh, redaction, durable-store round trip, offline protocol fixtures, and legal review before auth registration. No generic OAuth framework or unsupported stub was added.
    - Added exact provider-registration assertions and documentation regression checks for the matrix, official restriction links, future gate, forbidden factories/descriptors, and retained Codex descriptor.
    - Validation passed: core docs suite (91 pass); OpenAI provider suite (35 pass, 4 opt-in skips); Anthropic provider suite (13 pass, 2 opt-in skips); Google provider suite (13 pass, 2 opt-in skips); `npm run typecheck`; `git diff --check`.

- [x] 7. Complete docs, examples, migration notes, package metadata, and index navigation
  - Acceptance Criteria:
    - Functional: docs cover AG-UI mapping/handler/replay/interrupts, ACP stable sibling scope, durable resume streaming, coding compaction preset, and exact subscription OAuth support; examples compile and run network-free.
    - Performance: all protocol/request/event/replay/queue/projection/compaction caps and at-least-once reconnect semantics are documented with benchmark commands/results placeholders.
    - Code Quality: API pages follow Prism wiki structure; examples match packed exports; AG-UI/ACP/A2A distinctions and 0.0.13 conversation/artifact deferrals are explicit.
    - Security: docs require host authorization, ownership, redaction, sensitive-path projection, default-deny tool/state exposure, exact-version approval, and no Claude/Gemini subscription credential piggybacking.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` API page structure.
      - Existing `docs/agent-events.md`, `docs/server.md`, `docs/a2a.md`, `docs/host-security.md`, `docs/migration.md`, package README templates, and `examples/README.md`.
    - Options Considered:
      - Spread AG-UI/ACP details across agent/server pages only: poor discoverability; rejected.
      - One canonical `docs/ag-ui.md` plus focused cross-links: chosen.
    - Chosen Approach:
      - Write canonical frontend-interoperability page; update existing runtime/security/compaction/provider pages only where behavior intersects.
      - Add network-free handler and coding-compaction examples; no UI framework example/dependency.
      - Document 0.0.11 → 0.0.12 migration and package install commands.
    - API Notes and Examples:
      ```ts
      // Canonical docs include:
      createAgUiEventMapper(...);
      createAgUiHandler(...);
      createPrismAcpAgent(...);
      resumeAgentRunStream(...);
      createCodingCompactionStrategy(...);
      ```
    - Files to Create/Edit:
      - New `docs/ag-ui.md`.
      - `docs/agent-session-runtime.md`, `docs/agent-events.md`, `docs/server.md`, `docs/runs-and-usage.md`, `docs/a2a.md`, `docs/host-security.md`, `docs/public-contracts.md`.
      - `docs/compaction-llm.md`, `docs/compaction-and-retry.md`, `docs/coding-agent-tools.md`.
      - `docs/credentials-and-redaction.md`, `docs/credential-storage.md`, provider pages/matrix, `docs/migration.md`, `docs/performance.md`, `docs/release-and-install.md`, `docs/index.md`.
      - `packages/ag-ui/README.md`, relevant package READMEs/CHANGELOGs, `examples/ag-ui-server.ts`, `examples/coding-compaction.ts`, `examples/README.md`.
      - `src/__tests__/docs.test.ts`.
    - References:
      - Prism wiki required sections: What it does, When to use it, Inputs, Outputs/events, request/response example, implementation example, extension/config notes, security/performance notes, related APIs.
  - Test Cases to Write:
    - Docs tests assert package/subpath names, handler/replay/resume APIs, caps, coding preset, provider OAuth support matrix, and migration version.
    - Examples typecheck and network-free fake handler/compaction run succeeds.
    - Link/export/package README assertions pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; this task publishes complete usage/security/migration guidance.
    - Docs pages to create/edit: all paths listed above.
    - `docs/index.md` update: yes; add Multi-agent and interoperability → Frontend interoperability (AG-UI/ACP), update Agent/session runtime, Compaction, Providers, Credentials, Security, Testing/examples, and Release entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-22):
    - Added canonical `docs/ag-ui.md` with required API-page sections for the optional root AG-UI mapper/authorized Web handler/replay and stable ACP sibling. It distinguishes AG-UI/ACP from A2A, documents source/terminal/interrupt mappings, exact `${runId}:${version}` approval correlation, at-least-once redacted replay, host-owned authorization/session/run correlation, and explicitly excluded UI/editor/filesystem/MCP/conversation scope.
    - Cross-linked protocol behavior through agent runtime/events, ledger, server, A2A, host security, public contracts, compaction, coding-tool, performance, migration, release/install, and index pages. Documented all frozen request/event/replay/queue/stream/time caps, default-deny tool/state/path projection, provider-authorized OAuth boundary, and Task 8 benchmark placeholder without claiming unreleased performance evidence.
    - Added pre-release 0.0.11 → 0.0.12 migration map. It preserves existing direct durable resume, requires host authorization/ownership/redaction/correlation for optional protocol adapters, declares no schema/database migration, and documents `createCodingCompactionStrategy()` as bounded additive handoff focus. Release/install and package README keep `@arnilo/prism-ag-ui` private until Task 8 makes the 0.0.12 graph publishable, avoiding a false npm-availability claim.
    - Added runnable network-free `examples/coding-compaction.ts`; refreshed example inventory/run commands and AG-UI package README. Added docs regression coverage and enrolled canonical `docs/ag-ui.md` in wiki heading/index checks.
    - Validation passed: `npm run typecheck`; `node examples/coding-compaction.ts`; core docs suite (92 pass); full network-free `npm test` (0 failures); `git diff --check`.

- [x] 8. Version graph to 0.0.12, benchmark protocol/compaction paths, and run release validation
  - Acceptance Criteria:
    - Functional: all publishable manifests, exact internal ranges, lockfile records, runtime/protocol metadata, profile/package/install/export guards, and changelogs target `0.0.12`; `@arnilo/prism-ag-ui` is publishable and included only in `@arnilo/prism-all`, keeping `prism-code`/`prism-sdk` free of UI protocol dependencies.
    - Functional: `npm run sdk:ready` passes; official AG-UI/ACP schema conformance and packed offline consumer tests pass; roadmap Phase 7 is marked complete only after all gates pass.
    - Performance: `scripts/benchmark-0.0.12.mjs` reports mapper throughput, handler/replay latency, peak queue/memory, event bytes, and coding preset preparation overhead against frozen budgets; package/install deltas are recorded.
    - Code Quality: expected publishable package count moves from 34 to 35; no 0.0.13 conversation/artifact/enterprise scope or unsupported OAuth adapter enters the graph.
    - Security: audit, SBOM/license, tracked/tarball secret scans, dependency review inputs, exact dependency graph, tarball review, `git diff --check`, and protocol hostile-input fixtures pass; live provider/keychain/database/browser gates remain explicit operator prerequisites.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`, roadmap Release Order/Gates, Plan 074 Task 13 command matrix, release scripts/package guards.
      - `@ag-ui/core` and ACP SDK package licenses/dependency trees; current npm audit/SBOM policy.
    - Options Considered:
      - Add AG-UI to `prism-code`: convenient but makes UI protocol dependency non-optional for coding hosts; rejected.
      - Publish package independently and include only in `prism-all`: chosen.
      - Tag/publish automatically: requires operator authorization/OIDC; rejected.
    - Chosen Approach:
      - Bump exact 0.0.12 graph and add one package; run network-free full matrix, Node 20 compatibility, pack/install/export checks, benchmark, supply-chain checks, registry preflight, and deterministic dry-run publication.
      - Record completion evidence in this plan and `roadmap.md`; stop before commit/tag/publication unless separately authorized.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      node scripts/benchmark-0.0.12.mjs
      npm audit --audit-level=high
      git diff --check
      npm run release:check -- --version 0.0.12 --allow-dirty --allow-untagged
      npm run release:publish -- --version 0.0.12 --dry-run --allow-dirty --allow-untagged
      ```
    - Files to Create/Edit:
      - All 35 publishable `package.json` files/internal ranges and `package-lock.json` as required.
      - `packages/prism-all/package.json`, README/CHANGELOG; no `prism-code`/`prism-sdk` AG-UI dependency.
      - `scripts/benchmark-0.0.12.mjs` and benchmark schema/regression test.
      - Version/package/install/export/docs guard tests, root/package changelogs.
      - `docs/performance.md`, `docs/release-and-install.md`, `roadmap.md`, this plan’s completion evidence/checkboxes.
    - References:
      - Baseline: 34 publishable manifests and 2,047 tests at 0.0.11; protected live/operator gates recorded in roadmap Phase 6 evidence.
  - Test Cases to Write:
    - Version/package-count/profile dependency guards expect 0.0.12 and 35 packages.
    - Packed consumer imports `@arnilo/prism-ag-ui`, `@arnilo/prism-ag-ui/acp`, core resume stream, and coding preset offline.
    - Benchmark schema/budget test; full `sdk:ready`; Node 20 build/import; supply-chain and dry-run publish matrix.
    - Scope assertion rejects prohibited OAuth factories and 0.0.13 conversation/artifact APIs.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; released package/version/install/profile behavior changes.
    - Docs pages to create/edit:
      - `docs/performance.md`, `docs/release-and-install.md`, `roadmap.md` completion evidence.
    - `docs/index.md` update: no additional change beyond Task 7 unless final package/link names changed during execution.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-22):
    - Promoted all 35 manifests and exact internal dependency/peer ranges to `0.0.12`; removed the AG-UI private flag, added it only to `@arnilo/prism-all`, and pinned official protocol dependencies. Packaging/install/export guards now pack and offline-import root AG-UI plus `./acp`, core `resumeAgentRunStream`, and coding compaction; code/SDK profiles explicitly omit AG-UI.
    - Added `scripts/benchmark-0.0.12.mjs` plus schema/bounds test. Network-free 100-iteration local evidence: mapper 23,561 ops/s (p95 0.0398 ms), handler 1,401 (2.2651 ms), replay 6,094 (0.3047 ms), coding preparation 75,515 (0.0291 ms); emitted queues 1–5 rows and events 166–508 bytes. Documented as host-local evidence, not a timing gate.
    - Validation passed: `npm run sdk:ready`; Node 20.20.2 built core export imports; benchmark schema; `npm audit --audit-level=high` (0 high, 2 pre-existing moderate MCP transitive findings); SPDX/license check (192 packages/8 effective licenses; exact MIT override for `@ag-ui/core@0.0.57` because its package metadata omits the shipped MIT license); present tracked-source secret scan (963 files, 0 findings; one unrelated deleted tracked markdown is retained rather than restored); `npm ls --all --depth=0`; `git diff --check`.
    - Public registry preflight and dependency-ordered `release:publish --dry-run --allow-dirty --allow-untagged` completed 35/35 at `0.0.12`; no tag, commit, or publication was created. Signed tag, protected CI/live gates, npm/OIDC credentials, and actual publication remain operator prerequisites.

## Compromises Made

- Anthropic and Google explicitly prohibit third-party use of Claude Code/Gemini CLI subscription OAuth credentials. Phase 7 therefore ships no new subscription OAuth adapter; existing OpenAI Codex OAuth remains supported.
- ACP remains a stable event/session/permission sibling mapper, not a terminal/filesystem/editor implementation.
- Did not restore unrelated deleted tracked `feature-requests/prism-structured-output-final-turn-only.md`; release source scan covered 963 present tracked files. A clean release checkout must resolve that deletion before the workflow’s literal tracked-file scan.

## Further Actions

- P0 operator: commit the intended graph, resolve the deleted tracked markdown, run protected CI/live gates, sign/push `v0.0.12`, then let tag workflow publish with OIDC.
- P1: add a provider-local subscription OAuth adapter only after explicit third-party permission and protocol/redaction/store evidence.
- P2: expand ACP only when a host supplies secure editor/path/resource mediation.
