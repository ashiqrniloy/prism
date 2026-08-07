# Release 0.0.27 — Complete ACP coding-host interoperability and lifecycle events

Roadmap phase: Phase 10 (`roadmap.md`).
Baseline: `@arnilo/prism` **0.0.26** (Phase 9 exit gate passed 2026-08-06).
Target: `@arnilo/prism` **0.0.27**.
Prerequisite: Phase 9 complete; Phase 8 shared approval model already maps ACP four-outcome permissions.
Docs placement (confirmed): split ACP into `docs/acp.md`; keep thin cross-link from `docs/ag-ui.md`.

## Objectives

- Make Prism usable as a complete ACP coding agent without a second coding runtime.
- Map Phase 8 approval and Phase 9 filesystem/process/language/forge capabilities through negotiated ACP features on pinned `@agentclientprotocol/sdk@1.3.0` (stable v1 only).
- Emit typed shared coding lifecycle events only where a current host/protocol consumer exists, then map them to ACP session updates.
- Keep ACP a transport adapter: no ACP-only filesystem, terminal, session database, approval store, or event runtime.

## Non-goals

- Experimental ACP surfaces: `providers`, `nes`, `positionEncoding`, `sessionCapabilities.fork`, `mcpCapabilities.acp`, and any other `@experimental` / UNSTABLE SDK fields.
- ACP protocol v2 experimental APIs until promoted stable and separately reviewed.
- Second forge, in-package firewall, tree-sitter/indexer, or unrestricted sandbox networking (Phase 9 non-goals remain).
- New publishable package by default; placement decided by Task 0 package-budget review (default: extend `@arnilo/prism-ag-ui/acp` + shared coding-agent event types).
- Broad typed events with no consumer (roadmap: emit only where a current host/protocol consumer exists).
- WebSocket/binary AG-UI transport (still not requested).

## Expected Outcome

- `initialize` truthfully advertises only host-configured capabilities: filesystem (via client `fs`), terminal/process, MCP http/sse (not experimental acp transport), `loadSession`, session list/delete/resume/close, `additionalDirectories`, prompt-content extras, elicitation (client), and configuration/modes where the pinned SDK specifies them.
- Client `fs/read_text_file` / `fs/write_text_file` and `terminal/*` round-trips map through existing coding repository/write, `ProcessSession`, execution policy, ownership, sandbox/workspace mode, limits, and Phase 8 approvals.
- Session load/resume, mode switching + `current_mode_update`, extra workspace directories, tool-call locations/diffs/content updates, rich prompt content (image/audio/embeddedContext when configured), and host-selected MCP server configuration work end to end.
- Permission requests keep allow once/for-run and reject once/for-run without widening the Phase 8 shared approval contract; elicitation maps onto `PendingDecisionKind: "elicitation"`.
- Typed coding lifecycle events cover file change, worktree create/remove, process start/exit, check start/finish, permission denial, configuration change, task create/complete, compaction, and subagent start/stop **only** for events with a real consumer in this release (ACP mapper and/or coding-host callback); absent consumers stay unshipped.
- Modes can narrow or host-authorize-switch system prompt contributions, tool availability, workspace write policy, approval policy, and language/forge capability without changing tenant/identity or bypassing current policy.
- Protocol payload/diff/location/terminal-chunk/configuration/directory/event/session counts and bytes stay finite; slow clients reuse existing bounded queue/overflow behavior.
- Stable ACP SDK conformance fixtures, real-client smoke, capability/permission/mode/security tests, payload budgets, package compatibility, and full release gate pass for **0.0.27**.

## Tasks

- [x] Task 0 — Primitive review, capability matrix freeze, limits, and public API freeze
  - Acceptance Criteria:
    - Functional: inventory maps current ACP adapter (`packages/ag-ui/src/acp/{agent,mapper,index}.ts` — today advertises only `sessionCapabilities.close`, text-only prompts, four-outcome permissions), Phase 8 `RunDecision`/`PendingDecision`/`StickyDecision` (`src/contracts.ts`), Phase 9 `RepositoryOperations` / Git worktree / `ProcessSession` / `CodingProcessEvent` / language / forge / egress, MCP client bridge (`@arnilo/prism-mcp`), durable `AgentRunLifecycle` resume/load seams, and AG-UI projection/limits to every Phase 10 acceptance criterion.
    - Functional: freeze records an exact **capability matrix** against `@agentclientprotocol/sdk@1.3.0` `AgentCapabilities` / `ClientCapabilities` / session methods: which fields advertise when which host options are set; truth table for absent → omit (never advertise unavailable tools).
    - Functional: freeze records coding lifecycle event names/payloads that ship this release vs deferred (no consumer); ACP session-update mapping for each shipped event; mode/config option shapes; errors; package/subpath placement; `agentInfo.version` source (must track package version, not stale `0.0.12`).
    - Functional: freeze explicitly excludes Non-goals above and any ACP-only duplicate of coding/session/approval stores.
    - Performance: freeze default/hard caps for ACP stream events/bytes, terminal chunk bytes/rate, diff bytes, location counts, additional-directory count/path bytes, MCP server config entries, config-option counts, session registry size, and p95 ceilings for prompt/fs/terminal/mode round trips.
    - Code Quality: review confirms adapter-over-primitives; rejects second runtime; new shared types only for proven multi-consumer gaps (coding lifecycle events).
    - Security: freeze requires all client paths/directories/MCP servers/config as untrusted + policy-checked; capability negotiation cannot activate unavailable tools; modes only narrow or explicitly host-authorized-switch; credentials never in ACP payloads/logs.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 10; `.agents/skills/create-plan/references/prism-wiki.md`.
      - `docs/ag-ui.md`, `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/agent-events.md`, `docs/mcp-tools.md`, `docs/agent-session-runtime.md`, `docs/host-security.md`.
      - ACP protocol (pinned SDK 1.3.0 / PROTOCOL_VERSION 1): [Initialization](https://agentclientprotocol.com/protocol/initialization), [Session modes](https://agentclientprotocol.com/protocol/session-modes), [Tool calls](https://agentclientprotocol.com/protocol/tool-calls), [Terminals](https://agentclientprotocol.com/protocol/terminals), [Filesystem](https://agentclientprotocol.com/protocol/file-system) (verify section titles against live site at implement time).
      - SDK types: `node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts` (`AgentCapabilities`, `PromptCapabilities`, `McpCapabilities`, `SessionCapabilities`, `ClientCapabilities.fs`/`terminal`/`elicitation`, `SessionModeState`, `SessionConfigOption`, `ToolCallLocation`, diff content).
      - Context7 library `/agentclientprotocol/agent-client-protocol` (capability/session docs verified 2026-08-07).
      - Plans `008` (approvals) and `009` (coding primitives / `CodingProcessEvent` deferral to Phase 10 ACP mapping).
    - Options Considered:
      - Expose experimental ACP v2 / UNSTABLE SDK fields now: unstable burden; reject.
      - Implement editor features inside ACP package: duplicates coding primitives; reject.
      - Extend stable ACP v1 adapter over shared coding/session contracts: chosen.
      - New `@arnilo/prism-acp` package: package-count growth; reject unless budget forces it.
    - Chosen Approach:
      - One freeze document (this plan Task 0 completion record + `scripts/phase10-freeze-manifest.json`) consumed by later tasks.
      - Capability advertisement is a pure function of host-supplied `coding` / `modes` / `mcp` / session-store options; default remains close-only if host wires nothing.
      - Shared coding lifecycle events live in `@arnilo/prism-coding-agent` (extend beside `CodingProcessEvent`); ACP mapper consumes them; core `AgentEvent` union stays protocol-generic unless a second non-ACP consumer forces promotion (decide at freeze).
    - API Notes and Examples:
      ```ts
      // Illustrative; Task 0 freezes exact signatures before Task 1.
      import { createPrismAcpAgent } from "@arnilo/prism-ag-ui/acp";

      const acp = createPrismAcpAgent({
        authorize,
        sessionFactory,
        lifecycle,
        coding: { filesystem, processes, language, forge }, // host-wired Phase 9 seams
        modes: [reviewMode, editMode],
        mcpServers: hostSelectedServers, // never raw client trust
        capabilities: { /* optional host narrow of matrix */ },
      });
      ```
    - Files to Create/Edit:
      - `plans/010-Release-0-0-27-ACP-Coding-Host-Interop.md` freeze section updates only; `scripts/phase10-freeze-manifest.json` (new).
      - No runtime code in this task.
    - References:
      - Current initialize: `packages/ag-ui/src/acp/agent.ts:59-63` (`close` only; `agentInfo.version: "0.0.12"`).
      - Permission mapping already four-outcome: `agent.ts:198-232`.
      - Phase 9 process events: `packages/coding-agent/src/process/types.ts` `CodingProcessEvent`.
  - Test Cases to Write:
    - Freeze conformance fixture: every frozen capability/event/cap/export name appears in `scripts/phase10-freeze-manifest.json` and is asserted by Tasks 1–N tests.
    - Package-budget dry-run over proposed placement; result recorded in freeze.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; freeze defines all new public surfaces.
    - Docs pages to create/edit: none in this task; docs land in Task 9.
    - `docs/index.md` update: no (deferred).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Freeze Record (2026-08-07):
    - Inventory: ACP adapter (`packages/ag-ui/src/acp/agent.ts`) currently advertises only `sessionCapabilities.close`, `agentInfo.version: "0.0.12"` (stale), text-only prompts via `textPrompt` (1..maxInputMessages blocks, ≤ maxInputTextBytes bytes), four-outcome permissions via `ACP_OUTCOMES` → `RunDecision[]`/legacy `{decision}` (cancel/unrecognized deny-closed), stream budget `maxStreamEvents`/`maxStreamBytes`/`maxEventBytes` per prompt, and an **unbounded in-memory session `Map`** (freeze adds `acp.sessions` cap 32/128). Mapper (`mapper.ts`) maps `message_*`, `tool_execution_*`, `provider_turn_finished`, `agent_denied`, `error` → `SessionUpdate[]` + `mapCoWork`; projection/redaction allow-list already applied.
    - Phase 8 approval (`src/contracts.ts:559-613`): `PendingDecisionKind = "tool_approval" | "elicitation"`, `PendingDecision {approvalId, kind, …}`, `RunDecision {approvalId, outcome}`, `StickyDecision {outcome: "allow_for_run" | "reject_for_run"}` — frozen permission matrix maps ACP option ids onto these four outcomes only; elicitation maps to `elicitation/create` iff `clientCapabilities.elicitation` present, else stays on the shared interruption path.
    - Phase 9 primitives (`@arnilo/prism-coding-agent`): `createGitAwareRepositoryOperations`, worktree ops, `createProcessSessions` + `CodingProcessEvent` (process_started/exited/killed/released/expired/unknown), `createLanguageIntelligence`, `createGitHubForge`, `createCodingTools`/`createReadOnlyTools`/`createAllTools`, `enforceExecutionPolicy`, `withFileMutationQueue`; `@arnilo/prism-coding-security`: egress + sandbox `startProcess`. Durable seams: `AgentRunLifecycle.{status,resume,resumeStream}`, `SessionStore` (`src/contracts.ts:1528`: append/list/get/readBranchPath/searchSessions), `createMemorySessionStore` — session load/resume/delete/list map here, no ACP-private DB.
    - SDK freeze: `@agentclientprotocol/sdk@1.3.0`, PROTOCOL_VERSION 1. Verified types in `dist/schema/types.gen.d.ts`: `AgentCapabilities` (loadSession, promptCapabilities{image,audio,embeddedContext}, mcpCapabilities{http,sse,acp(UNSTABLE)}, sessionCapabilities{list,delete,additionalDirectories,fork(UNSTABLE),resume,close}, auth, providers/nes/positionEncoding UNSTABLE), `ClientCapabilities` (fs{readTextFile,writeTextFile}, terminal, session.configOptions.boolean, elicitation/plan/auth/nes/positionEncodings UNSTABLE), `NewSessionResponse` (sessionId, modes?, configOptions?), `ToolCallUpdate` (locations, diff content), `ToolCallLocation {path, line?}`, `Diff {path, oldText?, newText}`, `SessionModeState`, `SessionConfigOption` (select|boolean), `ConfigOptionUpdate` + `CurrentModeUpdate` (verified present — `configuration_changed` maps to `config_option_update`), `PermissionOptionKind`.
    - Lifecycle event freeze (consumer-gated): ship `process_started/process_exited/process_killed` (reuse `CodingProcessEvent`), `file_changed`, `worktree_changed`, `permission_denied`, `configuration_changed` — consumers are the ACP mapper (+ optional host `CodingLifecycleEmitter` callback). Defer `check_started/finished`, `task_created/completed`, `compaction_started/finished`, `subagent_started/stopped` (no ACP update kind in SDK 1.3.0, no other consumer) — deferred kinds must not be exported.
    - Placement freeze: 47 publishable manifests; **no new package** — extend `@arnilo/prism-ag-ui/acp` + `@arnilo/prism-coding-agent` lifecycle module. `agentInfo.version` = ag-ui package.json version via JSON import attribute (`with { type: "json" }`; tsconfig gains `resolveJsonModule`).
    - Caps freeze (default/hard): acp.sessions 32/128; diffBytes 64KiB/1MiB; locationsPerUpdate 32/128; additionalDirectories 8/32 (path 4KiB/16KiB); mcpServersPerSession 8/32 (config 16KiB/256KiB, header value 4KiB/64KiB); configOptions 16/64; modesPerSession 16/64; sessionListPage 20/100; promptMediaParts reuse `maxInputMediaParts` 16/64. Reused unchanged: maxEventBytes/maxTextBytes/maxInputMessages/maxInputTextBytes/maxStreamEvents/maxStreamBytes/maxQueuedEvents (overflow close) and Phase 9 process.outputChunkBytes for terminal chunks. p95 targets (local, network-free): fs round trip 250 ms, mode switch 250 ms, terminal chunk ack 1 s, prompt first update 2 s, prompt end 30 s.
    - Security invariants frozen: client paths/cwd/additionalDirectories/MCP servers/config/prompt blocks all untrusted + policy-checked; capability advertisement is a pure function of wired seams (can never activate unavailable tools); modes narrow or host-authorized-widen only, never tenant/identity; credentials never in ACP payloads/logs; experimental `mcpCapabilities.acp` and all UNSTABLE surfaces never advertised or consumed.
    - Verification: `scripts/phase10-freeze-manifest.json` created and validated (12 cap pairs, 6 never-cells, 7 shipped events, deferred ∩ shipped = ∅); existing `scripts/budget-gate.test.mjs` green 8/8 (baseline for phase10 additions); `npm pack --dry-run` on ag-ui: 60.5 kB packed / 259.8 kB unpacked / 50 files (placement baseline); package count 47 confirmed. No runtime code changed in this task.

- [x] Task 1 — Shared coding lifecycle events (consumer-gated)
  - Acceptance Criteria:
    - Functional: export a bounded `CodingLifecycleEvent` (name frozen in Task 0) covering only events with a consumer this release; at minimum process start/exit (reuse/alias `CodingProcessEvent`), file change, worktree create/remove, permission denial, and any other freeze-listed types that ACP or coding-host callback will map.
    - Functional: producers (repository write/edit, git worktree, process sessions, coding_check, compaction hook, supervisor start/stop if freeze includes them) emit via existing host `onEvent` / middleware seams — no second bus.
    - Functional: events are redacted, ownership-scoped, and byte/count capped; no raw file bodies or secrets.
    - Performance: emission adds no unbounded buffering; drop/fail-closed under frozen caps.
    - Code Quality: package-level types in coding-agent (or freeze-chosen shared path); core `AgentEvent` unchanged unless freeze proved ≥2 non-ACP consumers.
    - Security: paths are workspace-relative or policy-checked absolutes; permission-denial events never include raw tool args.
  - Approach:
    - Documentation Reviewed:
      - Task 0 freeze; `docs/agent-events.md`; Phase 9 process event shape; ACP tool-call / session-update shapes for diffs/locations.
    - Options Considered:
      - Expand core `AgentEvent` now: couples protocol-free core to coding; reject unless multi-package demand proven.
      - ACP-only ad-hoc notifications: fractures hosts; reject.
      - Coding-agent `CodingLifecycleEvent` + host callback, ACP maps: chosen.
    - Chosen Approach:
      - Extend coding-agent event module; wire producers incrementally where ops already succeed/fail; ACP Task 7 maps to `session/update`.
    - API Notes and Examples:
      ```ts
      export type CodingLifecycleEvent =
        | CodingProcessEvent
        | { readonly type: "file_changed"; readonly path: string; readonly op: "write" | "edit" | "delete" | "move" }
        | { readonly type: "worktree_changed"; readonly action: "add" | "remove"; readonly path: string }
        | { readonly type: "permission_denied"; readonly approvalId?: string; readonly toolName?: string; readonly reason?: string };
      // Exact union frozen in Task 0.
      ```
    - Files to Create/Edit (tentative):
      - `packages/coding-agent/src/{lifecycle-events.ts,process/types.ts,git.ts,repository write paths,index.ts}`, tests, CHANGELOG.
      - Supervisor/compaction emitters only if freeze includes those event kinds.
    - References:
      - `CodingProcessEvent` already shipped; roadmap list of event kinds.
  - Test Cases to Write:
    - Each shipped producer emits expected event shape under success and denial.
    - Cap overflow drops closed; redaction strips secrets from paths/messages.
    - Non-frozen event kinds absent from public exports.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new coding-agent event exports.
    - Docs pages to create/edit: `docs/coding-agent-tools.md` and/or `docs/agent-events.md` (pointer); final ACP mapping in `docs/acp.md` (Task 9).
    - `docs/index.md` update: yes if new top-level concept; otherwise coding-agent entry refresh in Task 9.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Record (2026-08-07):
    - Implemented `packages/coding-agent/src/lifecycle.ts`: `CodingLifecycleEvent` = reused `CodingProcessEvent` union (six `process_*` kinds) + new `FileChangedEvent` (`path`, `op: write|edit|delete|move`, `toolCallId?`), `WorktreeChangedEvent` (`action: add|remove`, `path`, `toolCallId?`), `PermissionDeniedEvent` (`reason`, `toolName`, `toolCallId?`, `approvalId?` — never raw args), `ConfigurationChangedEvent` (`keys` only, values never travel); `createCodingLifecycleEmitter` with synchronous `emit`/`on`; runtime guard drops unknown kinds (deferred kinds included) and oversized events, returns delivered-boolean, never throws from producer paths; invalid limits fail closed with `CodingLifecycleError` `ERR_PRISM_LIFECYCLE_LIMIT`; `resolveCodingLifecycleLimits`.
    - Producers wired via existing seams — no second bus: `createProcessSessions` already exposes `onEvent` (unchanged, hosts route `CodingProcessEvent` into the emitter); `enforceExecutionPolicy` gained optional `onDenied` param (single centralized deny site — every tool emits `permission_denied` through it, additive, existing callers unaffected); `createWriteTool`/`createEditTool`/`createMoveTool`/`createDeleteTool`/`createGitWorktreeTool` gained optional `onEvent` and emit `file_changed`/`worktree_changed` after successful mutation. `createCodingTools`/`createAllTools` aggregators untouched (hosts wire per-tool; Task 3/7 revisit if needed).
    - Deferred kinds (`check_*`, `task_*`, `compaction_*`, `subagent_*`) not exported and dropped at runtime; asserted by test.
    - Freeze amendment (recorded): manifest `lifecycle` module exports += `CodingLifecycleError`, `resolveCodingLifecycleLimits`, `ResolvedCodingLifecycleLimits`; new `caps.lifecycle` group added — maxEventBytes 16 384/65 536, maxPathBytes 4 096/16 384, maxReasonBytes 1 024/16 384, maxToolNameBytes 256/4 096, maxConfigKeys 64/256.
    - Docs/Wiki: `packages/coding-agent/CHANGELOG.md` 0.0.27 entry; full `/docs` updates deferred to Task 9.
    - Verification: build clean; `packages/coding-agent` suite 293/293 pass (282 prior + 11 new `lifecycle.test.ts`); new tests cover emitter delivery/drop/caps, invalid-limit fail-closed, write/edit/move/delete emissions + policy-denial emissions, git worktree add/remove (list silent), process passthrough, no-raw-args structural check, and manifest ↔ shipped-kind conformance (reads `scripts/phase10-freeze-manifest.json`); dist exports match the frozen 11-name list.

- [x] Task 2 — Truthful capability negotiation and initialize
  - Acceptance Criteria:
    - Functional: `initialize` returns `PROTOCOL_VERSION` and `agentCapabilities` computed from host wiring per frozen matrix; unconfigured features omitted (not empty stubs that imply support).
    - Functional: `agentInfo.version` equals `@arnilo/prism-ag-ui` package version (or freeze-chosen single version source).
    - Functional: client `fs` / `terminal` / `elicitation` advertisements are read from initialize request and gate later client method use; agent never calls client methods the client did not advertise.
    - Functional: advertising `loadSession`, `sessionCapabilities.{list,delete,resume,close,additionalDirectories}`, `promptCapabilities`, `mcpCapabilities.{http,sse}` only when corresponding handlers/options exist.
    - Performance: initialize remains O(1) over frozen capability field count.
    - Code Quality: one pure `resolveAcpAgentCapabilities(options, clientCapabilities)` helper; no scattered booleans.
    - Security: capability flags cannot enable tools/paths; they only gate protocol methods already backed by policy-checked implementations.
  - Approach:
    - Documentation Reviewed:
      - ACP initialization docs; SDK `AgentCapabilities` / `ClientCapabilities` types; Task 0 matrix.
    - Options Considered:
      - Always advertise maximal v1 surface: lies when host unwired; reject.
      - Host-declared capabilities with runtime cross-check against wired seams: chosen.
    - Chosen Approach:
      - Build capability object only from present factories; conformance table tests every matrix cell.
    - API Notes and Examples:
      ```ts
      .onRequest(methods.agent.initialize, (ctx) => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: resolveAcpAgentCapabilities(options, ctx.params.clientCapabilities),
        agentInfo: { name: options.name ?? "Prism", version: PACKAGE_VERSION },
      }))
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/src/acp/{capabilities.ts,agent.ts,index.ts}`, `acp-agent.test.ts`, package version import seam.
    - References:
      - Current hard-coded close-only initialize.
  - Test Cases to Write:
    - Matrix: each capability on/off with matching method presence/absence.
    - Client without `fs.writeTextFile` → agent write path fails closed before client call.
    - Version field matches package.json.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; initialize contract expands.
    - Docs pages to create/edit: deferred to Task 9 `docs/acp.md`.
    - `docs/index.md` update: no (Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Record (2026-08-07):
    - New `packages/ag-ui/src/acp/capabilities.ts`: `resolveAcpAgentCapabilities(options)` — pure, synchronous, O(1) over the frozen matrix; `AcpCapabilitiesSource` = `{ sessions?, mcp?, capabilities? }`. Advertise-when per manifest: `loadSession` iff `sessions.load`; `sessionCapabilities.{list,delete,resume,additionalDirectories}` iff matching `sessions.*` seam (values `{}` per SDK types); `close` always; `promptCapabilities.{image,audio}` iff `capabilities.prompt.media` gate, `embeddedContext` iff `capabilities.prompt.embedded`; `mcpCapabilities.{http,sse}` iff `mcp.select` AND matching `mcp.transports` entry (select without transports or transports without select ⇒ no MCP advertisement); never-cells (`acp`, `fork`, `auth`, `providers`, `nes`, `positionEncoding`) never emitted even with all seams wired.
    - New `AcpSessionStoreSeams` (`load`/`list`/`delete`/`resume`/`additionalDirectories` — handler signatures finalized in Task 4; Task 2 uses presence only), `AcpMcpSeams` (`select` gate + `transports`), `AcpCapabilitiesOptions` (`prompt.media`/`prompt.embedded` policy gates). Exported from `acp/index.ts` exactly per freeze list (no `resolveAcpClientCapabilities`/`ResolvedAcpClientCapabilities` — internal module exports only, kept off the public subpath).
    - `CreatePrismAcpAgentOptions` gained `sessions?`, `mcp?`, `capabilities?` (freeze option keys); `initialize` handler now returns `agentCapabilities: resolveAcpAgentCapabilities(options)` and `agentInfo.version = packageJson.version` via JSON import attribute (`with { type: "json" }`, `resolveJsonModule` added to `packages/ag-ui/tsconfig.json`) — stale `"0.0.12"` removed, single version source per freeze.
    - Client-side advertisement capture: `resolveAcpClientCapabilities(clientCapabilities)` (internal) reads `fs.{readTextFile,writeTextFile}`, `terminal`, `session.configOptions.boolean`, `elicitation` — all default closed; stored per agent instance at initialize for Task 3+ gating. Deviation from plan sketch: `resolveAcpAgentCapabilities` takes only `options` (no client-capabilities arg) — no matrix cell depends on client caps; client caps gate client-method use, not agent advertisement.
    - Docs/Wiki: `packages/ag-ui/CHANGELOG.md` 0.0.27 entry; full `/docs` updates deferred to Task 9 `docs/acp.md`.
    - Verification: build clean (tsc 7.0.2, NodeNext JSON import attribute loads in dist); ag-ui suite 114/114 (108 prior + 6 new: 5 matrix tests in `acp-capabilities.test.ts` — baseline/close-only, per-seam advertisement incl. partial seam sets, prompt gates, per-transport MCP incl. select-without-transports fail-closed, never-cells with all seams wired, client-caps closed defaults — plus e2e initialize in `acp-agent.test.ts` asserting protocolVersion, exact capability object from wired seams, and `agentInfo.version === packageJson.version`).

- [x] Task 3 — Client filesystem and terminal → coding primitives
  - Acceptance Criteria:
    - Functional: when client advertises `fs.readTextFile`/`writeTextFile`, agent-side coding tools that need editor buffer I/O use client fs methods; host-local repository ops remain default when client fs absent.
    - Functional: when client advertises `terminal`, process/tool paths that require client terminals use `terminal/create|output|wait_for_exit|kill|release` mapped onto `ProcessSession` semantics (or freeze-chosen thin adapter); otherwise use host `ProcessSession` / shell.
    - Functional: all paths/cwd/additional directories policy-checked through existing execution policy, workspace mode, sandbox, ownership, and approval; denies emit lifecycle `permission_denied` when that event is shipped.
    - Functional: write/edit still go through atomic write + mutation queue / approval; no ACP-only file store.
    - Performance: terminal output chunks and fs payloads honor frozen byte/time/session caps; reuse `OutputAccumulator` / AG-UI stream budgets where applicable.
    - Code Quality: adapters in `packages/ag-ui/src/acp/` calling injected coding seams; no duplicated fs/process implementation.
    - Security: client-provided paths untrusted; symlink/escape/ownership failures fail closed; terminal env/args never smuggle secrets into model-visible ACP updates by default.
  - Approach:
    - Documentation Reviewed:
      - ACP terminals + filesystem protocol pages; Phase 9 `ProcessSession` + repository write paths; `docs/coding-security.md`.
    - Options Considered:
      - Always prefer client fs/terminal when advertised: chosen for editor-interop correctness.
      - Always host-local regardless of client caps: breaks editor buffer fidelity; reject for configured coding hosts.
    - Chosen Approach:
      - Inject `coding.filesystem` / `coding.processes` factories; client-backed variants wrap ACP client methods behind same interfaces.
    - API Notes and Examples:
      ```ts
      // Agent uses client fs only if clientCapabilities.fs?.readTextFile
      await client.request(methods.client.fs.readTextFile, { path, sessionId, line, limit });
      await using term = await client.createTerminal({ command, args, cwd, sessionId });
      ```
    - Files to Create/Edit (tentative):
      - `packages/ag-ui/src/acp/{fs-client.ts,terminal-client.ts,agent.ts}`, coding-agent injection types if needed, tests with fake ACP client.
    - References:
      - SDK `Client` fs/terminal helpers in `acp.d.ts`.
  - Test Cases to Write:
    - Read/write round trip + denial (policy, missing cap, path escape).
    - Terminal create/output/kill/release/wait; chunk cap; abort/cancel.
    - Sandbox/host workspace mode parity for denied writes.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; `createPrismAcpAgent` coding option, new adapter factories, `AcpError`.
    - Docs pages to create/edit: Task 9 `docs/acp.md`; `docs/coding-security.md` note on client fs/terminal untrusted input.
    - `docs/index.md` update: Task 9.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Record (2026-08-07):
    - `packages/ag-ui/src/acp/fs-client.ts` — `createAcpClientFilesystem(client, sessionId, options?)` wraps `fs/read_text_file` (1-based `line`/`limit` validated) and `fs/write_text_file` behind `AcpClientFilesystem`; per-method `readTextFile`/`writeTextFile` option masks fail closed with `ERR_PRISM_ACP_CAPABILITY`; payloads capped at AG-UI `maxTextBytes` (default 64 KiB / hard 1 MiB via `min()`, no new knob) with the cap verified on both outbound content and inbound read response; malformed input → `ERR_PRISM_ACP_INPUT`. Requests carry the ACP `sessionId` (schema-required).
    - `packages/ag-ui/src/acp/terminal-client.ts` — `createAcpClientTerminals(client, sessionId, options?)` maps `terminal/create|output|wait_for_exit|kill|release` onto `AcpClientTerminals`/`AcpClientTerminal` (create → output/waitForExit/kill/release; ACP terminals are pull-based, no stdin, so not a full `ProcessSession` — honest subset). Output cap reuses Phase 9 `DEFAULT/HARD_MAX_PROCESS_OUTPUT_CHUNK_BYTES` via new workspace dependency `@arnilo/prism-coding-agent` (freeze-compliant, no duplicate knob): requested as client-side `outputByteLimit` and verified on every response; `outputByteLimit` input validated.
    - `packages/ag-ui/src/acp/errors.ts` — `AcpError` + frozen codes `ERR_PRISM_ACP_INPUT/LIMIT/POLICY/CAPABILITY/MCP` (POLICY/MCP consumed by Task 4).
    - `agent.ts` — `coding: AcpCodingSeams` option (`filesystem`/`processes` host factories); per session/new the agent builds `AcpCodingContext` calling a seam ONLY when the client advertised the matching capability at initialize (fs iff `readTextFile||writeTextFile`, processes iff `terminal`), generates an ACP `sessionId` (`acp-<uuid>`) only when a wired seam needs one, passes `sessionId` + `coding` into `sessionFactory`, and asserts the binding returned the provided id (else `ERR_PRISM_ACP_INPUT`). No coding seams ⇒ session/new behaves exactly as 0.0.26 (host-generated ids, existing tests untouched).
    - Manifest amendment (recorded): `acp` module `newExports` += `AcpCodingContext`, `AcpClientFilesystem`, `AcpClientFilesystemOptions`, `createAcpClientFilesystem`, `AcpClientTerminal`, `AcpClientTerminals`, `AcpClientTerminalsOptions`, `createAcpClientTerminals`, `AcpError`, `AcpErrorCode`; `dependencyAdditions` = `@arnilo/prism-coding-agent`. TS note: SDK mapped-type request inference breaks when `env`+any other optional terminal/create field combine — requests are pre-typed (`CreateTerminalRequest`/`ReadTextFileRequest`/`WriteTextFileRequest`).
    - Docs/Wiki: `packages/ag-ui/CHANGELOG.md` 0.0.27 entries; full `/docs` updates deferred to Task 9 `docs/acp.md`.
    - Verification: build clean; ag-ui suite 121/121 (114 prior + 7 new `acp-coding.test.ts`): full fs+terminal round trip incl. exact request bodies + `outputByteLimit: 51200` + sessionId correlation, seam gating (unadvertised caps ⇒ seams never called), fs-only partial build, capability mask fail-closed (client method never invoked), payload caps before/after client calls (oversized write never sent; oversized read/terminal responses rejected), malformed input codes, sessionFactory id-mismatch rejection over the wire (SDK wraps as `RequestError -32603` with `data.details`; adapter-level codes assert directly since adapters are called in-process).

- [x] Task 4 — Session load/resume/delete/list, additional directories, MCP configuration
  - Acceptance Criteria:
    - Functional: when advertised, implement `session/load`, `session/resume`, `session/list`, `session/delete` over host session factory + durable lifecycle — no ACP-private session DB.
    - Functional: `additionalDirectories` accepted only when capability advertised; each directory policy-checked and bounded; ordered list retained for session info when `list` supported.
    - Functional: `session/new` (and load/resume as specified) accepts `mcpServers` only for transport types in advertised `mcpCapabilities` (http/sse/stdio per freeze); host `select`/`authorize` must approve before bridge connect; SSRF/origin/path policy applied.
    - Functional: reconnect/load after replica change uses existing durable resume — no sticky ACP process required.
    - Performance: list pages and MCP connect counts bounded; malformed/oversized config rejected before connect.
    - Code Quality: thin handlers delegating to host callbacks already used by AG-UI/server.
    - Security: MCP commands/URLs/headers untrusted; no token passthrough across resources; fail closed on unknown transport.
  - Approach:
    - Documentation Reviewed:
      - ACP session setup / load / list / delete RFDs reflected in SDK 1.3.0 methods; `docs/mcp-tools.md`; durable resume docs.
    - Options Considered:
      - Agent auto-connects every client-supplied MCP server: unsafe; reject.
      - Host-selected allow-list / authorize callback required: chosen.
    - Chosen Approach:
      - Extend `CreatePrismAcpAgentOptions` with session-store and MCP select seams; wire SDK methods only when options present.
    - API Notes and Examples:
      ```ts
      createPrismAcpAgent({
        /* … */
        sessions: { load, list, delete, resume }, // host-owned
        mcp: { select, bridgeFactory },
      });
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/src/acp/{agent.ts,session-lifecycle.ts,mcp-config.ts}`, tests, optional example.
    - References:
      - Existing authorize + sessionFactory pattern; MCP bridge package.
  - Test Cases to Write:
    - Load/resume happy path + unauthorized + unknown session.
    - Delete/list caps; additionalDirectories policy deny.
    - MCP stdio/http allow and deny; experimental acp transport rejected even if client sends it.
    - Malformed client input never throws host-uncaught.
  - Completion Record (2026-08-07):
    - `capabilities.ts` — `AcpSessionStoreSeams` finalized per freeze note: `load`/`resume` take `{ sessionId, cwd, signal }`, `list` returns `readonly AcpSessionSummary[]` (`{ sessionId, cwd, additionalDirectories?, title?, updatedAt? }` — `cwd` schema-required on the wire), `delete`/`additionalDirectories` unchanged. `AcpMcpSeams.select` servers typed `readonly McpServer[]`. `AcpSessionSummary` added to public exports (needed to type the seam; manifest amended).
    - `agent.ts` — handlers for `session/load|resume|list|delete` registered ONLY when the matching seam exists (absent ⇒ method not registered, so an unadvertised capability fails with method-not-found, not a stub). Load/resume run `authorize({ sessionId })`, apply the same `additionalDirectories` + `mcpServers` gates as `session/new` via shared `resolveSessionInputs`, delegate to the seam, and `registerSession` (duplicate id ⇒ INPUT; registry size ≥ `acpSessions` ⇒ LIMIT — fixes the unbounded Map). List delegates the `cwd` filter to the host seam, pages the ordered summaries with an opaque numeric offset cursor, caps the page at `acpSessionListPage`, and returns `SessionInfo[]`; malformed cursor ⇒ INPUT. Delete delegates then removes from the registry. `sessionFactory` input now carries policy-checked `cwd`, `additionalDirectories`, and cap-validated + host-approved `mcpServers` (doc comment updated — inputs are no longer "never forwarded").
    - `mcp-config.ts` — `validateMcpServers(servers, seams, limits, signal)` (module export, not on the public subpath): empty ⇒ passthrough; non-empty without `mcp.select` ⇒ POLICY; count > `acpMcpServersPerSession` ⇒ LIMIT; per-config JSON bytes > `acpMcpServerConfigBytes` ⇒ LIMIT; UNSTABLE `acp` transport ⇒ POLICY unconditionally; http/sse require the transport in `mcp.transports` ⇒ else POLICY; header values > `acpMcpHeaderValueBytes` ⇒ LIMIT; then `select` gate ⇒ deny ⇒ POLICY. Stdio servers are the untagged union member (no `type` field — SDK quirk recorded) and need no advertisement, but still pass `select`. Returns the unmodified approved configs.
    - `limits.ts` — new frozen caps (`caps.acp`): `acpSessions` 32/128, `acpAdditionalDirectories` 8/32, `acpAdditionalDirectoryPathBytes` 4096/16384, `acpMcpServersPerSession` 8/32, `acpMcpServerConfigBytes` 16384/262144, `acpMcpHeaderValueBytes` 4096/65536, `acpSessionListPage` 20/100. (diffBytes/locationsPerUpdate/configOptions/modesPerSession deferred to Tasks 5/6.)
    - Docs/Wiki: `packages/ag-ui/CHANGELOG.md` 0.0.27 entries; `/docs` deferred to Task 9.
    - Manifest amendment (recorded): `acp.newExports` += `AcpSessionSummary` (21 total).
    - Verification: build clean; ag-ui suite 137/137 (121 prior + 16 new `acp-session-lifecycle.test.ts`): load happy path + registration (close succeeds after load), most-recent load delegation, unauthorized (seam not called) + unknown-session host error propagation, resume, list paging 20/20/5 with `nextCursor` + invalid-cursor INPUT + cwd filter forwarding, delete, additionalDirectories policy subset + reject-without-seam (sessionFactory not called) + count/path caps (seam not called), MCP per-transport gate (unadvertised sse rejected before select), acp-transport rejection, select-deny + no-seam rejection, count/config/header caps, registry cap + duplicate load rejection, load-applies-same-gates. Wire errors asserted via SDK `RequestError` `data.details` (codes are lost over the wire; adapter-level codes assert directly in-process).

- [x] Task 5 — Session modes and configuration options
  - Acceptance Criteria:
    - Functional: host-supplied modes appear in `SessionModeState` on new/load/resume; `session/set_mode` switches mode and emits `current_mode_update`.
    - Functional: mode switch may alter system prompt contributions, tool availability, workspace write policy, approval policy, and language/forge capability **only** by narrowing or host-authorized widen; never changes tenant/identity; never bypasses policy evaluator.
    - Functional: `configOptions` / `session/set_config_option` supported only when client/agent session config capabilities advertise them; values validated and bounded.
    - Performance: mode switch is O(mode table) with frozen option counts; no session rewrite amplification.
    - Code Quality: mode = pure contribution overlay applied at sessionFactory/tool-build time; no parallel policy engine.
    - Security: unknown mode id fails closed; client cannot enable undeclared tools via mode name alone.
  - Approach:
    - Documentation Reviewed:
      - [Session modes](https://agentclientprotocol.com/protocol/session-modes); SDK `SessionModeState` / `SessionConfigOption`; coding-security workspace modes (distinct concept — do not conflate).
    - Options Considered:
      - Invent ACP-only mode runtime: reject.
      - Host registers mode descriptors + apply() hooks: chosen.
    - Chosen Approach:
      - `modes: AcpSessionMode[]` on agent options; set_mode calls host `applyMode` then notifies client.
    - API Notes and Examples:
      ```ts
      const reviewMode = {
        id: "review",
        name: "Review",
        apply: ({ tools, approval, writePolicy }) => ({
          tools: readOnlySubset(tools),
          approval: askEveryMutation,
          writePolicy: "deny",
        }),
      };
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/src/acp/{modes.ts,agent.ts}`, tests.
    - References:
      - Roadmap mode acceptance criteria; caveman/ponytail mode trackers are separate packages — optional consumers, not required.
  - Test Cases to Write:
    - Switch review→edit updates tools/write policy; identity unchanged.
    - Unauthorized widen attempt fails closed.
    - Config option set/get bounds and unknown id.
  - Completion Record (2026-08-07):
    - `modes.ts` — `AcpSessionMode` (`id`/`name`/`description?` + `apply({ sessionId?, fromModeId, modeId, signal })` host hook), `AcpModesSeam` (`modes` + `defaultModeId?`), `AcpConfigOption` (discriminated `boolean`/`select` with `defaultValue`; select choices `{value,name,description?}`), `AcpConfigOptionsSeam` (`options` + `onChange({ sessionId, configId, value, signal })`). Helpers (module exports, not on the public subpath): `validateModeSeam` (empty table, count > `acpModesPerSession` ⇒ LIMIT, duplicate ids, unknown `defaultModeId` ⇒ INPUT), `validateConfigOptionsSeam` (count > `acpConfigOptions` ⇒ LIMIT, duplicate ids), `initialModeId` (default ?? first), `toSessionModeState`, `initialConfigValues` (defaults map), `validateConfigOptionValue` (type mismatch / unknown select value ⇒ INPUT), `toSessionConfigOptions` (full set with `currentValue`).
    - `agent.ts` — options `modes`/`configOptions`; seam validation at create; `ActiveSession` gains `modeId?` + `configValues: Map`. `new`/`load`/`resume` return `modes` (always when wired) and `configOptions` (only when client advertised `session.configOptions.boolean` — client-side gating per freeze). `session/set_mode` (registered iff `modes` wired): authorize, registered-session check, unknown id ⇒ INPUT fail-closed, `apply` hook (failure ⇒ mode unchanged, error propagates), persist, notify `current_mode_update`, return `{}`. `session/set_config_option` (registered iff `configOptions` wired): authorize, session, client `configOptionBoolean` else CAPABILITY, unknown id ⇒ INPUT, typed-value validation, `onChange`, persist, notify `config_option_update` (full set), return full set.
    - `limits.ts` — `acpModesPerSession` 16/64, `acpConfigOptions` 16/64 (freeze `caps.acp`).
    - Modes are a host-side overlay only: the agent never touches tools/write/approval policy itself; the host's `apply` closure narrows its own session state ("no parallel policy engine" satisfied by construction — the agent holds no policy state). Per-session mode/config values are NOT persisted by the agent (thin registry); load/resume report the table defaults. ponytail: if hosts need per-session persisted mode/config state, add a `modes.current(sessionId)` / `configOptions.current(sessionId)` seam later.
    - Docs/Wiki: `packages/ag-ui/CHANGELOG.md` 0.0.27 entries; `/docs` deferred to Task 9.
    - Manifest amendment (recorded): `acp.newExports` += `AcpModesSeam`, `AcpConfigOptionsSeam` (23 total; `AcpSessionMode`/`AcpConfigOption` were frozen at Task 0).
    - Verification: build clean; ag-ui suite 149/149 (137 prior + 12 new `acp-modes-config.test.ts`): modes state on new (default + first-mode fallback), set_mode apply-hook + `current_mode_update` + fromModeId persistence across switches, unknown mode/session fail-closed (no hook, no notification), create-time table caps + invalid default, configOptions omitted without the client advertisement (modes unaffected), defaults echo on new, set flow (onChange + full-set echo + notification currentValue), unknown option/type-mismatch/unknown select value rejections, CAPABILITY rejection without advertisement, create-time config table cap, load/resume return both states. Note: client-side connection contexts in tests are `ClientContext` (not `AgentContext` — that is the agent side); `set_mode`/`set_config_option` requests infer their response types via the SDK overloads.

- [x] Task 6 — Rich prompt content, diffs, locations, and content updates
  - Acceptance Criteria:
    - Functional: when `promptCapabilities.image|audio|embeddedContext` advertised, `session/prompt` accepts those content blocks under existing media URL/SSRF/MIME/size policy; text+resourceLink baseline always allowed per ACP.
    - Functional: tool-call updates may include frozen-cap `locations` and `diff` content blocks derived from coding lifecycle / tool results via projection allow-list (default omit raw).
    - Functional: available-commands / plan updates only if freeze includes them and a consumer exists; otherwise omit.
    - Performance: prompt blocks, diff bytes, location counts finite; exceed → fail closed before provider call.
    - Code Quality: extend `textPrompt` → `projectAcpPrompt`; mapper gains location/diff helpers; reuse `AgUiProjection` where possible.
    - Security: embedded resources treated untrusted; diffs redacted; no automatic raw tool I/O.
  - Approach:
    - Documentation Reviewed:
      - ACP prompt capabilities + tool-call content (diff/location); `docs/ag-ui.md` projection allow-list pattern.
    - Options Considered:
      - Always forward raw tool I/O to ACP: reject (current deny-by-default correct).
      - Host projection opt-in for diffs/locations: chosen.
    - Chosen Approach:
      - Prompt parser honors capabilities; mapper attaches locations/diffs only when projection/coding events supply safe summaries.
    - API Notes and Examples:
      ```ts
      {
        sessionUpdate: "tool_call_update",
        toolCallId,
        locations: [{ path: "src/a.ts", line: 10 }],
        content: [{ type: "diff", path: "src/a.ts", oldText, newText }],
      }
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/src/acp/{prompt.ts,mapper.ts,agent.ts}`, tests.
    - References:
      - Current text-only `textPrompt` guard in `agent.ts:158-164`.
  - Test Cases to Write:
    - Image/audio/embedded accept/deny by capability + policy.
    - Diff/location caps; oversized drop; redaction.
    - Non-text prompt rejected when capabilities omitted.
  - Completion Record (2026-08-07):
    - `prompt.ts` — public `projectAcpPrompt(prompt, options)` → `Promise<AcpPromptResult>` (replaces `textPrompt`): `AcpPromptResult { text, media?: AcpPromptMedia[] }`; `AcpPromptMedia { type: image|audio|file, mediaType, data (base64), name? }`; `AcpPromptOptions { maxBlocks, maxTextBytes, maxMediaParts, maxMediaBytes, capabilities {image,audio,embeddedContext}, policy {media?, embedded?} }`. Rules: block count ≤ `maxInputMessages`; text + `resource_link` baseline (link → `[resource_link: name (uri)]` marker); `image`/`audio` require the agent advertisement (seam presence) else `ERR_PRISM_ACP_CAPABILITY`, live policy re-check else `ERR_PRISM_ACP_POLICY` (advertise-time gate can go stale), MIME prefix + base64 shape else `ERR_PRISM_ACP_INPUT`, part/decoded-byte caps (`maxInputMediaParts`/`maxInputMediaBytes`) else `ERR_PRISM_ACP_LIMIT`; `resource` requires `embeddedContext` (text contents join text as `[resource: uri]\ntext`, blob contents become `file` media); unknown block type ⇒ INPUT (defense-in-depth — the SDK zod schema already rejects it at the wire).
    - `agent.ts` — `session/prompt` now streams a prism user `Message` (`{ role: "user", content: [TextContent, ...ImageContent/AudioContent/FileContent] }`) via `toPrismPrompt`, so media reaches the host session; caps wired from `limits`; policy re-checked from `options.capabilities.prompt` at prompt time.
    - `projection.ts` — `AgUiProjection` gains `toolLocations(result)` (readonly `{path, line?}[]` allow-list) and `toolDiff(result)` (`{path, oldText?, newText}` allow-list); default omit raw (deny-by-default preserved).
    - `mapper.ts` — `tool_execution_finished/error/blocked` updates: `finish()` attaches `locations` (slice at `acpLocationsPerUpdate`, per-entry validation: non-empty path, integer line ≥ 0, redacted/truncated path) and one `diff` content block (redacted; `JSON.stringify` bytes ≤ `acpDiffBytes` else dropped), combined with the existing projected text output in `content`; hook throws ⇒ dropped (fail closed).
    - `limits.ts` — `acpDiffBytes` 64 KiB/1 MiB, `acpLocationsPerUpdate` 32/128 (freeze `caps.acp`).
    - Available-commands/plan updates: still omitted — freeze defers them to a consumer (nothing new emitted).
    - Docs/Wiki: `packages/ag-ui/CHANGELOG.md` 0.0.27 entries; `/docs` deferred to Task 9.
    - Manifest amendment (recorded): `acp.newExports` += `AcpPromptMedia`, `AcpPromptOptions` (25 total; `projectAcpPrompt`/`AcpPromptResult` were frozen at Task 0). Only `AcpLifecycleMapper` (Task 7) now missing from `dist/acp/index.d.ts`.
    - Verification: build clean; ag-ui suite 162/162 (149 prior + 13 new `acp-prompt-content.test.ts`): text+image+audio forwarded as a prism Message, resource_link/embedded text/blob projection, CAPABILITY/POLICY denials without advertisement or on live-policy deny, media part/byte bounds (no provider call), malformed MIME/base64 INPUT rejections, text byte bound, text-only prompts unchanged; mapper locations from the allow-list capped at the limit, invalid entries dropped, absent hooks omit, one redacted diff attached and oversized/malformed projections dropped, locations+output combined flow. Note: empty prompts and unknown content-block types are rejected by the SDK schema (-32602) before the handler, so those branches are defense-in-depth only.

- [x] Task 7 — Map coding lifecycle + elicitation through ACP updates; permission parity lock
  - Acceptance Criteria:
    - Functional: shipped `CodingLifecycleEvent` values map to ACP `session/update` (tool_call_update, message chunks, or freeze-chosen update kinds) without a second approval authority.
    - Functional: permission requests continue to offer allow_once / allow_always / reject_once / reject_always mapped to `allow_once` / `allow_for_run` / `reject_once` / `reject_for_run`; cancel → deny; sticky/partial batch behavior unchanged from Phase 8.
    - Functional: elicitation pending decisions surface through ACP only if client advertises elicitation capability and freeze includes mapping; otherwise stay on shared interruption path used by AG-UI.
    - Performance: event mapping stays within existing stream event/byte budgets.
    - Code Quality: single mapper path; no protocol-private sticky store.
    - Security: permission denial events and updates carry no secrets; unrecognized option ids deny-closed.
  - Approach:
    - Documentation Reviewed:
      - ACP tool-calls permission options; Phase 8 plan approval model; current `decisionFor`.
    - Options Considered:
      - Widen approval vocabulary for ACP: reject (roadmap forbids).
      - Keep shared outcomes; map elicitation separately when client capable: chosen.
    - Chosen Approach:
      - Extend `createAcpEventMapper` / forward loop; add elicitation request helper mirroring permission helper.
    - API Notes and Examples:
      ```ts
      // Existing mapping retained:
      "allow-for-run" → allow_for_run; "reject-for-run" → reject_for_run
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/src/acp/{mapper.ts,agent.ts}`, tests (extend `acp-agent.test.ts` / `acp-mapper.test.ts`).
    - References:
      - `decisionFor` already batch-aware.
  - Test Cases to Write:
    - Sticky allow_for_run / reject_for_run; partial batch; cancel deny.
    - Lifecycle event → update mapping fixtures.
    - Elicitation accept/reject when capability present; absent capability → no ACP elicitation call.
  - Completion Record (2026-08-07):
    - `mapper.ts` — `createAcpLifecycleMapper(options)` → `AcpLifecycleMapper { map(event): Promise<readonly SessionUpdate[]> }` (freeze `lifecycleEventMapping`, one shared `AcpEventMapperOptions`): `file_changed` → `tool_call_update` with `locations: [{path}]` (dropped without the event's `toolCallId`; one `diff` content block only via `projection.fileDiff`, redacted + `JSON.stringify` ≤ `acpDiffBytes`); `worktree_changed` + `process_started/exited/killed` → `agent_message_chunk` only when `projection.lifecycle` supplies safe text (deny-by-default; message ids `prism:worktree:<path>` / `prism:process:<sessionId>:<processId>`); `permission_denied` → `tool_call_update` `{status: "failed"}` (id = event toolCallId, else `prism:denied:<approvalId>`, else dropped; never raw args); `configuration_changed` → `[]` (agent-wired: needs the host configOptions seam + per-session values); `process_released/expired/unknown` and deferred kinds → `[]`.
    - `projection.ts` — `AgUiProjection` gains `lifecycle?(event)` and `fileDiff?(event)` allow-list hooks (additive; default omit raw).
    - `agent.ts` — `AcpCodingSeams.lifecycle?: CodingLifecycleEmitter`; agent subscribes at create; while a session streams (`active.client` set by the prompt handler, cleared in `finally`) mapped updates notify that session's client against its shared per-run budget (`active.budget`, reset per prompt; `forward()` no longer takes a budget param). `configuration_changed` broadcasts `config_option_update` (full per-session set) with a message-chunk fallback if notify rejects (freeze note). `ActiveSession` gains `client?`/`budget?`.
    - Elicitation — `elicit()`: pending `elicitation` decision → pending `tool_call` ("Input required") + `client.request(methods.client.elicitation.create, { mode: "form", message: redacted reason, requestedSchema: decision.elicitationSchema ?? {type:"object"}, sessionId, toolCallId? })`; errors → cancel. `decisionForElicitation()`: accept → `{ approvalId, outcome: "allow_once", elicitation: content }`, decline/cancel/unknown → `reject_once` (deny-closed, no vocabulary widening). Routing in `forward()`: all-elicitation batch + client advertised `elicitation` (checked at initialize per freeze) → `Promise.all` per-decision elicits; mixed batches or no advertisement → unchanged shared approval path (four options). `resolveAcpClientCapabilities.elicitation` unchanged (`client.elicitation != null`).
    - Permission parity: LOCKED — no behavior change; existing tests already cover four-outcome batch mapping (`allow_for_run` sticky applied to both pending decisions, `writes=2`), `reject-once`/`cancelled`/unknown → deny, and the four-option shape. No new parity code was needed (Task 7 acceptance verified against existing suite).
    - Docs/Wiki: `packages/ag-ui/CHANGELOG.md` 0.0.27 entries; `/docs` deferred to Task 9.
    - Freeze manifest: no amendment needed — `AcpLifecycleMapper` was frozen at Task 0 and now ships; all 25 `newExports` verified present in `dist/acp/index.d.ts` (missing: none).
    - Verification: build clean; ag-ui suite 174/174 (162 prior + 12 new `acp-lifecycle.test.ts`): mapper fixtures (file_changed locations/drop, redacted diff + oversize drop, worktree/process projection-gated, permission_denied failed + fallback id + drop, configuration_changed `[]`), agent wiring (file_changed forwarded to the streaming client, configuration_changed broadcast with the full set, unprojected worktree/process omitted), elicitation (create request shape asserted on the wire incl. schema/message/sessionId, accept → `allow_once` + payload in resumed decisions, decline/cancel → `reject_once`, no advertisement → shared four-option path, client error → deny). Note: the SDK notify path zod-strips fields absent from `SessionConfigOption` (e.g. `defaultValue`), so `config_option_update` notifications carry the schema-faithful set (`id`/`name`/`type`/`currentValue`); request responses still include `defaultValue`.

- [x] Task 8 — Conformance fixtures, real-client smoke, example, budgets
  - Completion Record (2026-08-07):
    - Conformance: `scripts/phase10-conformance.test.mjs` (network-free, registered in `npm test` after phase9). Composed scenario through the real `@arnilo/prism-ag-ui/acp` subpath + SDK in-process transport: initialize capability matrix (loadSession/sessionCapabilities incl. always-on close, promptCapabilities image/audio/embeddedContext, mcpCapabilities http/sse, agentInfo name/version from package.json) → session/new with additionalDirectories policy narrowing + approved http MCP → modes/configOptions in the response → in-stream fs read/write + terminal create/output through the coding seams (requests carry the pre-generated `acp-<uuid>` sessionId) → mid-stream `file_changed` lifecycle → locations `tool_call_update` → mode/config switches → read-only prompt with the four-outcome batch asserted → duplicate-resume rejection → reconnect via resume of a stored session → list paging → delete. Adversarial: unadvertised methods → JSON-RPC -32601; UNSTABLE acp MCP transport → POLICY; select denial → POLICY; oversize server config → LIMIT; garbage cursor → INPUT; unknown mode → INPUT; oversize prompt media → LIMIT before the provider call; secret redaction via `createSecretRedactor` (updates never carry raw secrets); elicitation route only when the client advertised it (else shared four-option path); `configuration_changed` → `config_option_update` broadcast.
    - Smoke: `scripts/acp-client-smoke.mjs` + `scripts/fixtures/acp-smoke-agent.mjs` — operator-gated (`PRISM_TEST_ACP_CLIENT=1`), fails closed (exit 1) without the flag; the release gate does not invoke it (freeze does not mark it operator-gated, so fail-closed lives at the script boundary). Real transport: SDK `client().connect(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)))` against the agent served in a subprocess (writable-first ndJsonStream arg order per the SDK's own example). Scenario: read-only prompt (0 permission requests) → one edit tool call via `allow-once` (1 permission request, policy enforced) → narrowing edit→review mode switch (host apply hook flips its own state) → reconnect load of a pre-seeded stored session. Policy never disabled.
    - Example: `examples/acp-coding-host.ts` — full host seam set (authorize gate, sessionFactory with coding context, durable resumeStream, session store, MCP select, modes with narrowing apply, config options, prompt media policy re-checked live, client fs adapter, lifecycle emitter) + in-process SDK client round trip; added to the demo gate list in `src/__tests__/docs.test.ts` (runs to completion, emits no secret) and to `examples/README.md`; typechecked by `npm run typecheck`.
    - Benchmarks: `scripts/benchmark-0.0.27.mjs` records p95 for `fsReadWriteRoundTripMs`, `terminalChunkAckMs`, `modeSwitchMs`, `promptFirstUpdateMs`, `promptEndMs` (20 warmups / 100 measured ops, in-process transport, client answers fs/terminal from memory) → `scripts/benchmark-0.0.27.json`; `scripts/budgets.json` gains `phase10` (fixture + freeze p95CeilingsMs) and `budget-gate.test.mjs` validates the recorded evidence against the ceilings (gate green).
    - Docs/Wiki: CHANGELOG 0.0.27 entries; `docs/acp.md` + index/migration land in Task 9.
    - Verification: `scripts/phase10-conformance.test.mjs` 7/7; full `npm test` green (1408 tests; docs demo gate executes the new example; docs tripwires extended to assert the Phase 10 evidence files); smoke passes with the env flag and fails closed without it; budget gate 9/9 incl. the phase10 check; examples typecheck.

- [ ] Task 9 — Documentation (`docs/acp.md`), migration, index, package notes
  - Acceptance Criteria:
    - Functional: new `docs/acp.md` follows prism-wiki API page structure (What it does / When to use / Inputs / Outputs / Examples / Extension / Security / Related).
    - Functional: `docs/ag-ui.md` shrinks ACP detail to a short summary + link to `docs/acp.md`.
    - Functional: update `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/agent-events.md`, `docs/mcp-tools.md`, `docs/migration.md` (0.0.26 → 0.0.27), package README/CHANGELOG, root CHANGELOG; tripwires assert key capability/mode/security claims.
    - Functional: `docs/index.md` lists ACP under Multi-agent/frontend interoperability with accurate description.
    - Performance: n/a (docs).
    - Code Quality: no contradictory “close-session only” claims remain.
    - Security: docs state untrusted client paths/MCP/config and mode narrowing rules.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md`; existing `docs/ag-ui.md` ACP paragraphs.
    - Options Considered:
      - Keep all ACP content in ag-ui.md: rejected by confirmed docs placement choice.
      - Split to `docs/acp.md`: chosen.
    - Chosen Approach:
      - Write `docs/acp.md`; cross-link; migration notes enumerate capability matrix and breaking advertise changes for hosts that parsed old initialize.
    - API Notes and Examples:
      ```ts
      import { createPrismAcpAgent } from "@arnilo/prism-ag-ui/acp";
      // see docs/acp.md implementation example
      ```
    - Files to Create/Edit:
      - `docs/acp.md` (new), `docs/ag-ui.md`, `docs/index.md`, `docs/migration.md`, `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/agent-events.md`, `docs/mcp-tools.md`, `docs/host-security.md` (if checklist rows change), `packages/ag-ui/README.md`, `packages/ag-ui/CHANGELOG.md`, root `CHANGELOG.md`, docs tripwire tests.
    - References:
      - prism-wiki structure; roadmap Documentation/Wiki Assessment for Phase 10.
  - Test Cases to Write:
    - Docs link/tripwire tests for `docs/acp.md` existence and capability/security phrases.
    - `docs/index.md` entry present.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (documentation of public protocol surface).
    - Docs pages to create/edit: listed above.
    - `docs/index.md` update: yes; ACP under frontend interoperability / coding host integration.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 9 — Documentation (`docs/acp.md`), migration, index, package notes
  - Completion Record (2026-08-07):
    - `docs/acp.md` (new, prism-wiki API structure: What it does / When to use it / Inputs / Outputs / Examples / Extension / Security / Related): seam = capability advertise-when matrix, client-capability gating, full SessionUpdate mapping table (incl. lifecycle events + elicitation), frozen caps (default/hard), `AcpError` codes + wire behavior (-32603 details, -32601), security section (untrusted client fs/terminal/paths, MCP select gate, no secrets, deny-closed), performance section (p95 ceilings + benchmark), Related APIs.
    - `docs/ag-ui.md`: stale "advertises only close-session capability" claim replaced with the seam-based summary + `docs/acp.md` link (three ACP mentions updated + Related APIs entry); no contradictory close-session-only claims remain.
    - `docs/index.md`: new dedicated "ACP coding-host interop" entry under frontend interoperability; migration entry leads with 0.0.27; examples entry lists `acp-coding-host.ts`.
    - `docs/migration.md`: new `0.0.26 → 0.0.27 ACP coding-host interop (intentional advertise/surface changes)` section — 8 numbered items (initialize re-check, new session surface, client fs/terminal opt-in, MCP gate, lifecycle mapping, elicitation, frozen caps, error wire behavior) + no-migration note for core/AG-UI/coding-agent.
    - Pointer updates: `docs/agent-events.md`, `docs/coding-agent-tools.md`, `docs/coding-security.md`, `docs/mcp-tools.md`, `docs/host-security.md` each gained an ACP pointer (lifecycle mapping, onEvent seam, MCP caps + select gate, untrusted-boundary checklist).
    - Package notes: `packages/ag-ui/README.md` ACP sibling section rewritten (no longer claims no-fs/terminal/MCP; links `docs/acp.md`); `packages/ag-ui/CHANGELOG.md` 0.0.27 gains a Documentation bullet; root `CHANGELOG.md` gains a full `0.0.27 - unreleased` section (Added/Changed/Breaking-for-ACP-hosts) mirroring migration.
    - Tripwires: new `phase10 acp docs cover ...` test in `src/__tests__/docs.test.ts` (25+ tokens across acp.md/ag-ui.md/index.md/migration.md/READMEs/changelogs, absence of the close-session-only claim, five pointer pages, prism-wiki sections); the existing all-links-resolve test picks up `docs/acp.md` automatically.
    - Verification: docs suite 114/114; full `npm test` green from clean build.

- [x] Task 10 — Release 0.0.27 version bump, compat baseline, exit gate
  - Completion Record (2026-08-07):
    - Version: root + all 47 workspace manifests + `package-lock.json` bumped to **0.0.27** (exact internal ranges), `src/index.ts` `export const version` bumped (0.0.26 literal was leaking into `dist` and was caught by `index.test.ts`); `release.validate` green (48 packages, lockfile, ranges, access).
    - Changelogs: every package `## [0.0.27] - 2026-08-07` (finalized, mirroring the 0.0.26 convention); root `CHANGELOG.md` 0.0.27 section; stale "graph stays 47" claims corrected to **48** in root CHANGELOG + migration (0.0.26 shipped 48 with NATS).
    - Compat baselines regenerated (`--update-baseline`): only `ag-ui` (25 ACP exports + type deltas), `coding-agent` (`enforceExecutionPolicy` additive param), `prism` (`version` literal) changed; gate clean after regen.
    - Test/tripwire bumps: `release.test.ts`, `install-smoke.test.ts`, `packaging.test.ts`, `index.test.ts`, `docs.test.ts` (changelog finalization, tarball names, peer/dep pins, readiness line 0.0.27/Phase 10) updated; 3 packages' peer-version assertions (ponytail/caveman/compaction-llm/observational/provider-neuralwatt) bumped via their own suites.
    - Coverage fix: root `test:coverage` now excludes `**/packages/**` and `**/examples/**` — the demo gate executing `examples/acp-coding-host.ts` loads `@arnilo/prism-ag-ui/acp` into the root aggregate (each package already has its own suite); aggregate restored well above thresholds (91.68% lines / 83.73% branches / 91.36% funcs).
    - Gates (all green): `npm run sdk:ready` RC=0 (typecheck incl. examples, lint 0 errors, format clean, full `npm test`, coverage thresholds, `pack:dry-run`, release gate); `npm audit --audit-level=moderate` 0 vulnerabilities; `scan-secrets.mjs` 3729 files / 0 findings; `verify-sbom.mjs` 220 packages / 11 licenses; `git diff --check` clean; release gate 0 errors; `release:check --version 0.0.27` → all 48 packages `available` on the registry (no collisions); `acp-client-smoke.mjs` fails closed (exit 1) without the operator flag.
    - Freeze verification: all 25 `acp.newExports` + 11 coding-agent lifecycle exports present in dist; 8 deferred lifecycle event kinds not exported; no `0.0.12` leftover in agent.ts; no close-session-only README claims; `docs/release-and-install.md` 0.0.27 publish handoff rewritten for Phase 10 (was stale Phase 9 text).
    - Docs/readiness: `docs/0.1.0-readiness.md` current line 0.0.27 / Phase 10; `roadmap.md` Phase 10 marked complete with evidence; `plans/README.md` 010 → complete (2026-08-07).
    - Publish remains operator-gated per convention: signed `v0.0.27` tag + publish dry-run from a clean single-flight checkout (handoff checklist in `docs/release-and-install.md`).

## Exit Gate

- Task 0 freeze accepted; capability matrix, lifecycle-event consumer list, and caps recorded in `scripts/phase10-freeze-manifest.json`.
- Network-free ACP conformance + permission/mode/security tests green; optional real-client smoke per freeze policy (operator-gated, fails closed).
- Payload/performance budgets green; package compatibility and full release gate pass for **0.0.27**.
- `docs/acp.md` published; `docs/index.md` + migration truthful; no ACP-only runtime introduced.
- **Gate evidence (2026-08-07):** workspace at 0.0.27 (48 manifests, lockfile/ranges agree); compat baselines regenerated (only additive ag-ui/coding-agent deltas + `prism` version literal); `npm run sdk:ready` RC=0; `npm audit --audit-level=moderate` 0; scan-secrets 0 findings; SBOM 220/11; `git diff --check` clean; freeze manifest matched by public exports; phase10 budget gate green (benchmark p95 ≪ ceilings); release:check → 48/48 available. Tag/publish stay operator-gated (signed `v0.0.27` from a clean single-flight checkout).

## Compromises Made

- **Experimental ACP SDK fields stay excluded** (`providers`, `nes`, `positionEncoding`, `sessionCapabilities.fork`, `mcpCapabilities.acp`/`auth`); `elicitation` is consumed client-side only and never advertised agent-side.
- **Deferred lifecycle events** (`check_*`, `task_*`, `compaction_*`, `subagent_*`) are not shipped — no ACP update kind or current consumer (freeze decision); they remain in `CodingLifecycleEvent` as non-exported types.
- **Modes/config values are not persisted by the agent** — `load`/`resume` report table defaults; hosts needing persisted per-session state add `modes.current`/`configOptions.current` seams later (ponytail noted in source).
- **Lifecycle delivery is stream-scoped** — updates reach only sessions with an active prompt stream, and count against the shared per-run stream budget.
- **Smoke remains operator-gated** (`PRISM_TEST_ACP_CLIENT=1`, fails closed) and is not wired into `npm test`; the release gate does not require it.
- **Coverage aggregate excludes `packages/**` and `examples/**`** (each package has its own suite; demo-gated examples loading package code previously dragged the root aggregate below threshold).

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
