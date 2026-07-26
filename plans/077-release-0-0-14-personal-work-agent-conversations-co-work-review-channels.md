# Phase 9 — Release 0.0.14: Personal/Work-Agent Conversations, Co-Work Review, and Channel/Device Expansion

## Objectives

- Ship a durable user-scoped conversation service (create/list/continue/branch/archive/export/delete) over existing session/branch/checkpoint/event/server primitives, with reconnectable bounded ordered replay that never reruns completed work.
- Add memory consent and lifecycle controls (consent, source, visibility, correction, retention, deletion, per-user/profile/thread scopes); proactive schedules/events require explicit user enablement and revocable capabilities.
- Ship a durable artifact service recording authorized source/output files, MIME/hash/version, producer run, citations, preview metadata, approval state, and delivery; users compare revisions, request changes, approve/reject, and recover the last validated artifact via authorized expiring links.
- Extend the shipped 0.0.12 `@arnilo/prism-ag-ui` adapter (not reimplement) to map browser snapshots, connector drafts, approvals, progress, and authorized artifact download links into reconnectable co-work events without exposing local filesystem paths.
- Add OAuth connector flows establishing scoped Microsoft 365 / Google Workspace credentials for Outlook/Gmail and related workloads over existing credential seams; Slack/Teams channels stay deferred until web/AG-UI demand is measured.
- Keep realtime voice and desktop OS/computer-control adapters optional, isolated, approval-aware, observable, and disabled by default behind device-adapter contracts/conformance; compose delivered Playwright browser tools with conversations only through existing sandbox, egress, secret-injection, approval, and run-limit policies.
- Add two optional first-party provider packages — `@arnilo/prism-provider-alibaba` (Alibaba Cloud Model Studio / DashScope, including the Coding Plan) and `@arnilo/prism-provider-ollama` (Ollama Cloud) — over the existing OpenAI-compatible transport, with dynamically fetched model catalogs (no hard-coded model list) and correct request/usage handling including cache hits (Alibaba explicit `cache_control` + implicit prefix cache; Ollama implicit KV cache).
- Version, document, benchmark, and release-validate the graph as **0.0.14** without broadening user consent, memory, network, file, browser, connector, or tool permissions (roadmap gate 8).

## Expected Outcome

- Server/session/persistence expose user-owned conversation threads with idempotent create/continue, branch/archive/export/delete, and event-gap-safe reconnect/replay bounded by frozen page/window caps.
- `@arnilo/prism-memory` exposes consent/source/visibility metadata, correction, retention/deletion, and per-user/profile/thread controls; schedule/event proactivity is opt-in with revocable capability tokens.
- Server/session/persistence expose artifact metadata, revisions, approvals, and authorized expiring delivery; previews/edits stay host-owned; Prism persists only bounded authorized metadata and references.
- `@arnilo/prism-ag-ui` gains co-work event extensions (artifact progress/draft/snapshot/approval/download-link mapping) over the existing durable-resume stream; local paths and raw secrets never appear in events or telemetry.
- `@arnilo/prism-credentials-node` + `@arnilo/prism-work-tools` support scoped OAuth connector establishment/refresh/revocation for M365/GWS workloads with per-identity token isolation.
- Device-adapter contracts (voice/desktop-control) fail closed by default with denial/approval/stream-bound/sandbox/network/redaction conformance; no vendor voice/desktop package ships unless Task 0 review records measured demand.
- Browser workflow checkpoints persist verified URLs/domain state and host data (never serialized browser internals); interrupted browser work reloads and verifies before any side effect.
- Network-free conversation/memory/artifact/co-work/connector/device benchmarks, `npm run sdk:ready`, supply-chain checks, exact pack graph, and 0.0.14 publish dry-runs pass.

## Tasks

- [x] 0. Freeze Phase 9 scope, package ownership, primitive inventory, limits, and evidence matrix
  - Acceptance Criteria:
    - Functional: map every Phase 9 roadmap criterion to an existing primitive, minimum gap, owning task, test, docs page, and release gate; freeze package/subpath ownership (extend `@arnilo/prism-server`, core session/persistence, `@arnilo/prism-memory`, `@arnilo/prism-ag-ui`, `@arnilo/prism-credentials-node`, `@arnilo/prism-work-tools`, `@arnilo/prism-browser` in place; new packages only if this review records measured need); mark Studio/chat UI, Slack/Teams channels, voice/desktop vendor packages, local Office runtime, and 0.1.x control-plane out of scope.
    - Performance: freeze finite caps for thread/event pages, replay windows, memory injection, connector payloads, artifact revisions/previews/links, browser snapshots/actions, audio/screenshot/device streams, and reconnect backpressure; confirm review/browser loops consume shared turn/tool/token/cost `RunLimits`.
    - Code Quality: inventory session branch/history, `SessionIndex`, checkpoints/leases, event multiplexer + 0.0.12 durable-resume stream, server `authorize`/health/drain/replay seams, `AgentIdentity`/`IdentityVerifier`, policy ledger, `CredentialResolver` + OAuth stores, memory scopes/working-memory, workflow schedules/suspend/approve, resource loaders, redactor, AG-UI mapper/handler/projection/replay, browser egress/approval policy, work-tools idempotency; authorize only generic reusable gaps; no `WorkAgent`, second memory runtime, second event system, or mandatory UI/connector framework.
    - Security: record roadmap gate 8 — no permission broadening; authenticated identity owns every thread/memory/artifact/connector/browser/device action; consent/permission rechecked on resume; artifact links authorized+expiring; OAuth tokens, local paths, injected browser secrets, document-private data never enter model context, events, telemetry, or unauthorized exports.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 9, Product Boundaries, Release Order gates 8/11, Persona Outcomes (personal/work agent), Package Coverage Ledger rows for memory/server/ag-ui/workflows/browser/work-tools.
      - `docs/agent-session-runtime.md`, `docs/server.md`, `docs/session-stores.md`, `docs/session-stores-and-branching.md`, `docs/working-and-semantic-memory.md`, `docs/credential-storage.md`, `docs/credentials-and-redaction.md`, `docs/workflows.md`, `docs/host-security.md`, `docs/ag-ui.md`, `docs/agent-identity.md`, `docs/policy-and-audit.md`, `docs/work-tools.md`, `docs/work-connectors.md`, `docs/browser-automation.md`, `docs/resource-loading.md`, `docs/runs-and-usage.md`, `docs/review-coverage-2026-07-22-phase-7.md`.
      - AG-UI overview/specification: <https://docs.ag-ui.com/introduction> (verify current event catalog at implementation time).
      - `.agents/skills/create-plan/references/prism-wiki.md`; no `.agents/skills/project-patterns` or `.agents/skills/project-wiki`.
    - Options Considered:
      - Build Prism Studio/chat UI first: product scope before stable protocol; rejected.
      - Add many chat channels independently: duplicated auth/events/state; rejected (demand-gated 0.1.x).
      - New `@arnilo/prism-conversations` / `@arnilo/prism-artifacts` packages: rejected unless Task 0 size/cohesion evidence requires a split; extend server/session/persistence in place first.
      - Separate work-agent runtime: duplicates sessions/approvals/workflows/tools; rejected.
      - Durable conversation/artifact/memory-consent primitives on the shipped AG-UI adapter, then measured connectors: chosen.
    - Chosen Approach:
      - Produce a frozen evidence matrix (criterion → primitive → gap → task → test → docs → gate) in this plan; record publishable manifest count (baseline 41 from 0.0.13) and any justified delta.
      - Freeze capability/consent token shapes and replay cursor semantics so Tasks 1–6 cannot widen permissions.
    - API Notes and Examples:
      ```ts
      // Freeze shapes (finalized in implementation):
      type ConversationThread = { id: string; ownerId: string; title?: string; state: "active" | "archived"; ... };
      type ArtifactRecord = { id: string; threadId: string; mime: string; hash: string; version: number; producerRunId?: string; approval: "pending" | "approved" | "rejected"; ... };
      type MemoryConsent = { scope: "user" | "profile" | "thread"; source: string; visible: boolean; retention?: ... };
      ```
    - Files to Create/Edit:
      - This plan (evidence matrix, frozen caps, manifest count).
      - `docs/review-coverage-2026-07-25-phase-9.md`: frozen scope, primitive, limit, threat, and revision evidence.
    - References:
      - Plan 075 Tasks 0–3 (durable-resume stream, AG-UI), Plan 076 Tasks 0–8 (identity, policy, work-tools, persistence lifecycle), roadmap Phase 9.
  - Test Cases to Write:
    - Matrix completeness assertion: every roadmap Phase 9 acceptance bullet has task + test + docs owner.
    - Scope guard: no Studio/Slack/Teams/Office/voice-vendor artifact appears in package graph or docs index.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (planning artifact); freeze document constrains later tasks.
    - Docs pages to create/edit:
      - `docs/review-coverage-2026-07-25-phase-9.md`: frozen scope/primitive/limit/threat matrix.
    - `docs/index.md` update: no until Tasks 1–6 land public surfaces; review doc linked from Phase 9 evidence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-25):
    - `docs/review-coverage-2026-07-25-phase-9.md` frozen at Prism `56692ad8`: capability traceability (every Phase 9 roadmap criterion → Task 1–8 owner), 21-row primitive/caller inventory, 7 authorized generic extensions (each ≥2 consumers or conformance pair), frozen finite limits for conversations/memory/artifacts/co-work/OAuth/browser/device, channel/device capability freeze (Slack/Teams deferred; voice/desktop contracts + conformance only), threat/authority matrix, and Task 0 validation matrix.
    - Frozen decisions: **41 → 41 manifests** (no new packages; extend server/memory/ag-ui(+acp)/credentials-node/work-tools/browser/workflows/core types/sqlite+postgres stores) — **revised in Task 8 to 41 → 43** to authorize exactly two new provider packages (`@arnilo/prism-provider-alibaba`, `@arnilo/prism-provider-ollama`) per user request; thread = ownership-scoped session branch; replay = page→live at-least-once over `queryEvents` + subscriber with CAS resume via `resumeAgentRunStream` (no completed-work rerun); MemoryConsent/ScheduleCapability/DeliveryLink token shapes frozen, all expiring + ownership-bound; artifact records store metadata/hashes/refs only (no file bodies); browser checkpoints store verified URL/domain-state/host-data refs only (no serialized internals); device adapters disabled by default; gate 8 non-broadening is release-gated in Task 12.
    - Regression guard: `src/__tests__/docs.test.ts` Phase 9 evidence test (headings, Task 1–8 owners, frozen tokens, out-of-scope items, roadmap criteria, scope guard rejecting `packages/{conversations,artifacts,voice,desktop,slack,teams}`, seam-existence checks, index link); `docs/index.md` navigation entry added; `plans/README.md` index + plan count bumped to 78. Full `dist/__tests__/docs.test.js`: 95/95 pass.

- [x] 1. Ship durable user-scoped conversation service with reconnectable replay
  - Acceptance Criteria:
    - Functional: authenticated users create, list, continue, branch, archive, export, and delete threads; each thread maps onto existing session/branch primitives (no second session engine); continue is idempotent per client request ID; export is bounded and identity-checked.
    - Functional: clients reconnect with a replay cursor and receive bounded ordered events without rerunning completed tool/work work; event gaps are detected and recoverable via existing durable-resume stream (Plan 075 Task 1).
    - Performance: thread lists, event pages, replay windows, and export have frozen page/byte/time caps; reconnect backpressure uses existing subscriber overflow policy; no unbounded history scan per reconnect.
    - Code Quality: conversation APIs are thin seams over `SessionStore` branches, checkpoints, event multiplexer, server `authorize`, and `AgentIdentity`; memory store may provide linear fallback or explicit unsupported error for search-dependent listings.
    - Security: wrong-user create/list/continue/branch/archive/export/delete fails closed (not-found/forbidden); replay never includes credentials or raw secrets; deletion cascades to thread events/memory links per Task 2 retention; export payloads are redacted with the active redactor.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-session-runtime.md`, `docs/session-stores.md`, `docs/session-stores-and-branching.md`, `docs/server.md`, `docs/ag-ui.md`, `docs/agent-identity.md`; existing `packages/server/src/{handler,replay,drain,health,limits}.ts`, session-store branch/checkout APIs, Plan 075 Task 1 durable-resume stream.
    - Options Considered:
      - New conversation database/runtime: duplicates sessions/branches/checkpoints; rejected.
      - Thread = session branch + ownership metadata + replay cursor over existing seams: chosen.
      - Always-on push channel: product daemon scope; rejected — host transports (SSE/WS) consume the replay stream.
    - Chosen Approach:
      - Add conversation contracts (thread state, request-id idempotency, replay cursor) to core/server; implement in server handler + session stores (SQLite/Postgres; memory fallback explicit).
      - Reuse checkpoint/CAS resume so "continue" cannot rerun completed tool calls.
    - API Notes and Examples:
      ```ts
      const thread = await conversations.create({ identity, title: "Quarterly review" });
      const page = await conversations.events(thread.id, { after: cursor, limit: 100 });
      await conversations.branch(thread.id, { atEventId, identity });
      await conversations.archive(thread.id, { identity });
      ```
    - Files to Create/Edit:
      - Core conversation contracts/types; `packages/server/src/` conversation handler/replay extensions + limits.
      - `packages/session-store-sqlite`, `packages/session-store-postgres` thread metadata/migrations/conformance; memory store fallback.
      - Tests per store.
    - References:
      - Existing session branch/history, workflow suspend/resume, event multiplexer, 0.0.12 durable-resume stream, `AgentIdentity` propagation (Plan 076 Task 1).
  - Test Cases to Write:
    - Create/continue/branch/archive/export/delete happy paths; duplicate request-ID idempotency.
    - Reconnect replay: cursor resume, event-gap recovery, no completed-work rerun (tool-call count invariant).
    - Wrong-user access on every operation; deleted thread cascades; export redaction.
    - Page/window cap enforcement; backpressure/overflow behavior.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new conversation server/session/persistence surface.
    - Docs pages to create/edit:
      - `docs/conversations.md` (new, wiki API-page structure), `docs/server.md`, `docs/session-stores.md`, `docs/agent-session-runtime.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; add Conversations entry under Agent/session runtime (or new group per wiki map).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-25):
    - Core (`src/conversations.ts`): types + pure helpers only — `ConversationThread`/`ConversationThreadState`/`ConversationBranchRef`, `CONVERSATION_METADATA_KEY` (`prismConversation`), thread-bound replay cursor codec (`encode/decodeConversationReplayCursor`, 4/16 KiB, cross-thread reuse rejected), `conversationThreadFromRecord`/`conversationMarkerMetadata`, `ConversationError`. Contract seams: `SessionQuery.id` + `SessionQuery.metadataKey` (validated by `assertSessionMetadataKey`) and optional `ProductionPersistenceStore.appendSession` (upsert: ownership set on create only, metadata/updatedAt on update).
    - Stores: sqlite + postgres implement `appendSession` and `querySessions` id/metadataKey filters (sqlite `json_extract`, postgres `jsonb ?`) under existing ownership filtering; seam tests in `sqlite-persistence.test.ts` (16/16) and gated `postgres-integration.test.ts` mirror (upsert ownership immutability, marker filtering, cross-user isolation, injection-shaped key rejection).
    - Server (`packages/server/src/conversations.ts`): `createConversationService` (create/list/get/continue/branch/archive/export/delete/replay) + `createConversationHandler` (framework-free routes under `/prism/conversations`). Frozen caps enforced: thread page 50/200, replay page 100/500, cursor 4/16 KiB, title 256 B/2 KiB, request id 256 B/2 KiB, branches 16/64, export 8/32 MiB + 100/500 pages, body 64 KiB/1 MiB. Replay/export serve `redacted: true` ledger rows only (non-redacted rows skipped fail-closed); `continue` runs with the required service redactor and flows `requestId` into session-append idempotency; replay never invokes provider/tools.
    - Root-cause lifecycle fix (both stores): `applyRetention` candidate purge now deletes the whole session ledger in FK order (idempotency, events, tool calls, usage, runs→feedback cascade, branches, search rows, entries, session) — previously FK-violated on any session with ledger rows; legal holds still win.
    - Tests: `packages/server/src/__tests__/conversations.test.ts` (10/10, real sqlite): ownership-scoped CRUD + wrong-user not-found, idempotent explicit-id create, durable two-turn history + run idempotencyKey, reconnectable replay with terminal detection + tool-call count invariant (1) + cross-thread cursor rejection, branch recording/cap/unknown-leaf rejection, archive + archived-continue refusal, byte-capped resumable export with exact id coverage, lifecycle delete + legal-hold `held: true`, handler routes + 403/404 fail-closed + redacted responses.
    - Docs: `docs/conversations.md` (new, template-shaped), `docs/index.md` nav entry, `docs/server.md` deployment-seam row + related link, `docs/database-persistence.md` appendSession/metadataKey seam + lifecycle cascade note. Frozen-surface snapshots updated (`public-export-contract.test.ts`). Full `npm test`: core 1245/1245 + all workspace suites pass.
    - ponytail ceilings recorded in code/docs: branch-ref read-modify-write cap is approximate (entry tree is truth); a single export page larger than `exportBytes` is not exportable (raise cap or page via replay); deletion routes through lifecycle candidates (explicit-candidate policy constant).

- [x] 2. Add memory consent, lifecycle, and revocable proactive capabilities
  - Acceptance Criteria:
    - Functional: memory entries carry consent, source, and visibility metadata with per-user/profile/thread controls; users can correct, revoke consent, delete, and apply retention; injection into prompts honors visibility/consent at assembly time.
    - Functional: proactive schedules/events (workflow schedules) require explicit user enablement and a revocable capability token; revocation stops scheduled runs fail-closed.
    - Performance: consent checks and memory injection stay within frozen byte/time caps; retention sweeps are bounded batches; no full-corpus scan per run.
    - Code Quality: extends `@arnilo/prism-memory` scopes/working-memory and workflow schedules; no second memory runtime; conformance suite covers SQLite/Postgres adapters.
    - Security: revoked/invisible/non-consented memories never enter prompts, events, exports, or telemetry; capability tokens are scoped, expiring, and auditable via policy ledger; deletion is real (not tombstone-only) per retention policy.
  - Approach:
    - Documentation Reviewed:
      - `docs/working-and-semantic-memory.md`, `docs/compaction-observational-memory.md`, `docs/workflows.md` (schedules), `docs/policy-and-audit.md`, `docs/host-security.md`; `packages/memory/src/{memory,working-memory,conformance,limits,schema,postgres}.ts`, workflow schedule primitives (Plan 063).
    - Options Considered:
      - Consent as host-only metadata outside Prism: rejected — injection must enforce it or it is decorative.
      - Global always-on proactive agent: product scope + permission broadening; rejected (gate 8).
      - Consent/visibility enforced at injection + revocable schedule capability tokens: chosen.
    - Chosen Approach:
      - Add consent/source/visibility fields to memory schema + injection filter; correction/delete/retention APIs; conformance tests per adapter.
      - Wrap workflow schedules in capability tokens verified against identity + consent at fire time.
    - API Notes and Examples:
      ```ts
      await memory.remember({ ..., consent: { source: "user", scope: "thread", visible: true } });
      await memory.setConsent({ memoryId, identity, visible: false });
      await memory.delete({ memoryId, identity });
      const cap = await schedules.enable({ threadId, identity, cron: hostSelected });
      await schedules.revoke(cap.tokenId, { identity });
      ```
    - Files to Create/Edit:
      - `packages/memory/src/` consent/lifecycle types, injection filter, schema/migration, conformance, limits, tests.
      - Workflow schedule capability-token seam + tests; policy-ledger audit hooks.
    - References:
      - Memory scopes/working-memory (Plan 059), workflow schedules (Plan 063), identity/policy (Plan 076), 0.0.15 memory production-conformance deferral boundary.
  - Test Cases to Write:
    - Consent grant/revoke/correct/delete/retention per user/profile/thread scope.
    - Injection exclusion: revoked/invisible/non-consented memories absent from assembled requests, events, exports.
    - Schedule enable/revoke: revoked token fails closed at fire time; audit record emitted.
    - Cross-user memory access denial; retention sweep bounds.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; memory consent/lifecycle + schedule capability surface.
    - Docs pages to create/edit:
      - `docs/working-and-semantic-memory.md`, `docs/workflows.md`, `docs/policy-and-audit.md`, `docs/host-security.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; refresh Memory and Workflow entries with consent/lifecycle/capability notes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-25):
    - Memory consent/lifecycle (`packages/memory`): `MemoryConsent { source: user|agent|system, scope: thread|profile|user, visible, grantedAt?, revokedAt? }` carried on every `MemoryVectorRecord` (default-stamped on `remember`). Single enforcement gate in `recall()` filters hits+adjacent by `isInjectable` (O(1)/record) — covers both direct recall and `createContextProvider()` injection, so revoked/invisible entries never reach prompts/events/exports/telemetry. `requireConsent` strict mode (per-memory or per-recall) also drops consent-less legacy entries. Lifecycle APIs: `setConsent` (grant/revoke, stamps times, no re-embed), `correct` (re-embeds, preserves id/sequence/metadata/consent), `forget` (real delete), `applyRetention({ maxAgeDays?, maxEntries?, batchSize? })` (bounded real-delete sweep, per-thread scan, batch default 500 / hard 5000). No second memory runtime — extends existing vector/working stores.
    - PostgreSQL adapter persists consent in a `consent JSONB` column added by `buildMemoryDdl` (`ADD COLUMN IF NOT EXISTS`), hydrated/dehydrated in upsert + `mapVectorRow`; in-memory adapter stores it inline. `runMemoryConformance` extended with grant/revoke/correct/forget/retention assertions, so both in-memory and gated PostgreSQL/pgvector adapters are covered.
    - Proactive capability tokens (`packages/workflows/schedule-capabilities.ts`): `createProactiveScheduleCapabilities({ schedules, store, ownership, ownerId, defaultTtlMs?, maxTtlMs?, onCapability? })` wraps `WorkflowSchedules`. `enable` creates the schedule + a scoped, expiring `ScheduleCapabilityToken` (TTL default 24h / hard 31d, record ≤ 16 KiB enforced via `assertWithinBytes`) stamped with redacted actor refs. `revoke(tokenId, actor)` marks the token revoked and pauses the underlying schedule so `pollOnce` never fires it (fail-closed); `assertActive` throws on missing/revoked/expired for manual trigger paths. Tokens are ownership-scoped checkpoint records (foreign access fails closed via checkpoint ownership mismatch). `onCapability` emits `capability_enabled`/`capability_revoked`/`capability_denied` (redacted refs) for host bridge to `@arnilo/prism-policy`. No schedule runs without an explicit grant; no cron/secret persisted.
    - Tests: memory 13/13 (incl. extended conformance + injection-exclusion/strict-mode unit tests); workflows 65/65 (incl. 5 new `schedule-capabilities.test.ts`: enable fires while active, revoke pauses + pollOnce fires 0 + assertActive rejects, expired fails closed, missing actor/token rejected, ownership-scoped foreign access rejects). Full `npm test`: exit 0, 0 fail across all suites.
    - Docs: `docs/working-and-semantic-memory.md` (consent/lifecycle inputs/outputs/extension/security), `docs/workflows.md` (capability table row + paragraph + security note), `docs/index.md` (Memory/Workflow entries refreshed), `docs/host-security.md` (memory consent bullet), `docs/policy-and-audit.md` (capability bridge cross-ref). Freeze doc `docs/review-coverage-2026-07-25-phase-9.md` reconciled to the implemented token/consent shapes and limits (TTL 24h/31d, retention batch 500/5000, token ≤ 16 KiB, revocation = per-token boolean not a growing list). Docs tests 95/95.
    - ponytail ceilings recorded: consent source/scope are closed enums (stricter than the freeze's byte caps); retention scans one thread (shard by resource/thread if a single thread grows unbounded); capability revocation is a token boolean + schedule pause (no revocation-list compaction needed); `migration.md` 0.0.14 entry deferred to the release task (consistent with Task 1).

- [x] 3. Ship durable artifact service with revisions, review approvals, and authorized delivery
  - Acceptance Criteria:
    - Functional: authorized attach records source/output files with MIME/hash/version, producer run, citations/data sources, preview metadata, approval state, and final delivery; users compare revisions, request changes, approve/reject proposed outputs, and recover the last validated artifact.
    - Functional: downloads use authorized, expiring links; previews/edits remain host-owned — Prism persists only bounded metadata, revisions, approvals, and delivery references (no file-content store beyond bounded hashes/refs).
    - Performance: revision/preview/download paths honor frozen byte/time/version caps; compare is hash+metadata-bounded (host renders content); review loops consume shared `RunLimits`.
    - Code Quality: artifact records live in server/session/persistence over existing ownership, checkpoints, workflow approvals, and resource loaders; reuses Plan 076 idempotency patterns; no SaaS connector or Office runtime implied.
    - Security: attach/compare/download require authenticated identity + thread ownership; links expire and reauthorize; concurrent reviewer conflict resolves via CAS/version (no lost approvals); failed updates roll back; local filesystem paths and document-private data never enter events/telemetry/export.
  - Approach:
    - Documentation Reviewed:
      - `docs/work-tools.md`, `docs/work-connectors.md`, `docs/resource-loading.md`, `docs/workflows.md` (suspend/approve), `docs/database-persistence.md` (v5 lifecycle), `docs/host-security.md`; `packages/work-tools/src/idempotency.ts`, workflow approval seams, resource loader contracts.
    - Options Considered:
      - Store artifact file bodies in Prism DB: storage-product scope; rejected — persist hashes/refs, host owns blobs.
      - Local Office execution for previews: outside Prism product scope; rejected.
      - Metadata/revision/approval/delivery records over existing persistence + approvals + expiring link seam: chosen.
    - Chosen Approach:
      - Add artifact schema (record, revision, approval, delivery link) to persistence; workflow-approval-backed review state machine; signed expiring link verifier in server.
    - API Notes and Examples:
      ```ts
      const artifact = await artifacts.attach({ threadId: thread.id, uri, mime, hash, identity });
      const rev = await artifacts.revise(artifact.id, { uri, hash, identity, changeNote });
      const diff = await artifacts.compare(artifact.id, { from: 1, to: 2, identity });
      await artifacts.approve(artifact.id, { version: 2, identity });
      const link = await artifacts.deliveryLink(artifact.id, { identity, ttlSeconds: 300 });
      ```
    - Files to Create/Edit:
      - Core artifact contracts; server artifact handler + delivery-link signer/verifier + limits.
      - SQLite/Postgres artifact schema/migrations/conformance; workflow approval wiring.
      - Tests.
    - References:
      - Plan 076 draft-then-approve + idempotency patterns, workflow suspend/approve (Plans 060/072), persistence lifecycle v5 (Plan 076 Task 6).
  - Test Cases to Write:
    - Authorized attach/revise/compare/download; hash/version integrity; wrong-user denial.
    - Approve/reject/request-change state machine; concurrent reviewer CAS conflict; failed update rollback.
    - Delivery link expiry, replay, and reauthorization; last-validated recovery after rejection.
    - Local-path/secret redaction in records, events, exports; revision/version cap enforcement.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new artifact/review/delivery surface.
    - Docs pages to create/edit:
      - `docs/work-artifacts-and-review.md` (new, wiki API-page structure), `docs/server.md`, `docs/workflows.md`, `docs/database-persistence.md` / `docs/postgres-persistence.md` / `docs/sqlite-persistence.md`, `docs/host-security.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; add Work artifacts/review entry; refresh Server and Persistence entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-25):
    - Core types only (`src/artifacts.ts`, exported from `src/index.ts`): `ArtifactRecord`, `ArtifactRevision`, `ArtifactCitation`, `ArtifactApproval`, approval state `pending|approved|rejected`, `ArtifactDeliveryToken`, `ArtifactError`, `ARTIFACT_CHECKPOINT_NAMESPACE`, `artifactCheckpointKey`, `artifactApprovalState`. No service/logic in core — root frozen-surface contract updated (150/150).
    - Service + HTTP + delivery links (`packages/server/src/artifacts.ts`): `createArtifactService(store: CheckpointStore, { redactor, linkSecret, limits, onDecision })` with attach/revise/compare/approve/reject/lastValidated/deliveryLink/list/get, and `createArtifactHandler` (default base `/prism/artifacts`) mounting attach/list/get/revise/compare/approve/reject/last-validated/delivery-link plus `GET /prism/artifacts/download?link=…`. `signArtifactDeliveryLink`/`verifyArtifactDeliveryLink` = `base64url(payload).base64url(HMAC-SHA256)` over `{ artifactId, threadId, version, ownership, issuedAt, expiresAt }` (node crypto, timing-safe), reauthorized per download.
    - **Reused the existing versioned `CheckpointStore` instead of a new artifact schema** (lazy root-cause reuse per Code-Quality criteria "over existing … checkpoints"): each artifact is a checkpoint value (namespace `prism.artifact`, key `threadId:artifactId`, category `artifact`); the checkpoint `version` is the CAS counter for concurrent reviewers, revision numbers/approvals/`lastValidatedVersion` live in the JSON value. sqlite/postgres already persist checkpoints durably (`persistence.checkpoints`), so there is no new table/migration — durability proven by a sqlite reopen test.
    - Review state machine: approve advances `lastValidatedVersion`; reject (request-changes) records a decision but never clears last-validated, so the last validated revision stays recoverable. Concurrent reviewers race on `expectedVersion`; the loser surfaces a retryable `conflict` (no lost/duplicated approvals) — verified with a deterministic gated-store test. A throw before commit persists nothing (failed updates roll back). Cross-ownership access fails closed as `not_found` (never leaks existence).
    - Security: local filesystem paths rejected in `uri`/citations (`file:`, absolute, drive); records redacted before persist and on response (secrets/paths never enter records/events/exports); compare is hash+metadata-bounded (exactly 2 revisions); download reauthorizes against the token's ownership (mismatch → 403, expired → 410, tampered → 401). Frozen caps enforced (artifacts/thread 64/256, revisions 32/128, record 8/64 KiB, preview 16/64 KiB, citations 32/128 & 2/8 KiB, MIME 128/512 B, hash 256/1 KiB, delivery TTL 5 min/24 h, token 4/16 KiB).
    - Tests: `packages/server/src/__tests__/artifacts.test.ts` 25/25 (attach/idempotency, revise mime-inherit, compare flags + arity, approve/reject state machine, last-validated recovery + fail-closed, deterministic CAS conflict, failed-update rollback, per-thread cap, cross-ownership denial, local-path rejection, secret redaction at rest, audit events, delivery round-trip/default-version/tamper/expiry/TTL-cap, HTTP round-trip + download reauthorization/expiry/deny/404, sqlite durability across reopen). Full `npm test`: exit 0, 0 fail.
    - Docs: new `docs/work-artifacts-and-review.md` (full wiki API-page structure, registered in `docs.test.ts` apiPages so headings are enforced); `docs/server.md` (seam row + Related), `docs/database-persistence.md` (checkpoint-reuse note), `docs/host-security.md` (artifact boundary bullet), `docs/index.md` (nav entry). Freeze doc reconciled to the shipped `(store, options)` signature + checkpoint reuse (no new schema). Docs tests 95/95.
    - ponytail ceilings recorded: no dedicated artifact table (reuse checkpoints; add a table only if independent artifact retention/querying is needed); reviewer attribution requires identity or explicit reviewer (no anonymous approvals); `recordBytes` is an aggregate backstop (hosts raising the revision cap may raise it); review loops consume shared `RunLimits` at the host agent layer, not in this passive record store; `migration.md` 0.0.14 entry deferred to the release task (consistent with Tasks 1–2); workflow `tool_approval` gating of revisions left to hosts (state machine + `onDecision` audit cover the functional criteria).

- [x] 4. Extend AG-UI adapter with reconnectable co-work events
  - Acceptance Criteria:
    - Functional: `@arnilo/prism-ag-ui` maps browser snapshots, connector drafts, review approvals, artifact progress, and authorized artifact download links into bidirectional co-work events over the existing durable-resume stream; disconnect/resume replays from cursor without duplicate side effects.
    - Functional: thread/artifact context flows through `agui.handle` (threadId/artifactId/identity) so host TUI/desktop apps can render co-work review without a Prism-owned UI.
    - Performance: co-work event mapping stays within existing mapper limits + frozen snapshot/draft payload caps; overflow/backpressure uses existing subscriber policy.
    - Code Quality: extends `packages/ag-ui/src/{ag-ui-mapper,handler,projection,replay,limits,types}.ts` (and `./acp` sibling where contracts share); no second event system, no UI framework coupling.
    - Security: events never expose local filesystem paths, raw credentials, injected browser secrets, or unrestricted tool-argument dumps; download links are authorized+expiring; malformed client events fail closed; telemetry stays metadata-safe.
  - Approach:
    - Documentation Reviewed:
      - `docs/ag-ui.md`, Plan 075 Tasks 1–4 (durable-resume stream, mapper, bidirectional handler, ACP sibling), `docs/browser-automation.md`, `docs/work-tools.md`; AG-UI spec: <https://docs.ag-ui.com/introduction>; `packages/ag-ui/src/*`.
    - Options Considered:
      - New co-work event package: duplicates mapper/replay; rejected — extend in place (roadmap mandate).
      - Stream raw tool payloads to clients: path/secret leakage; rejected.
      - Typed co-work event extensions + redacted projection + link-token delivery: chosen.
    - Chosen Approach:
      - Add co-work event types/projections for artifact/draft/snapshot/approval/progress/download-link; handler accepts thread/artifact-scoped requests; replay projection rebuilds co-work state from cursor.
    - API Notes and Examples:
      ```ts
      return agui.handle(request, { threadId: thread.id, artifactId: artifact.id, identity });
      // events: artifact.progress, artifact.approval.requested, draft.connector.pending,
      //         browser.snapshot (redacted), artifact.download.link (expiring token)
      ```
    - Files to Create/Edit:
      - `packages/ag-ui/src/types.ts`, `ag-ui-mapper.ts`, `projection.ts`, `handler.ts`, `replay.ts`, `limits.ts`, `acp/*` parity, tests.
    - References:
      - Plan 075 AG-UI evidence, Tasks 1/3 of this plan (conversation replay, artifact service).
  - Test Cases to Write:
    - Artifact/draft/snapshot/approval/progress/download-link mapping round-trips; ACP parity where shared.
    - Disconnect/resume replay from cursor; overflow/backpressure; malformed client event rejection.
    - Redaction: no local paths/secrets/tool-arg dumps in events or telemetry.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; AG-UI/ACP co-work event catalog expands.
    - Docs pages to create/edit:
      - `docs/ag-ui.md` (co-work event tables + examples), `docs/work-artifacts-and-review.md` cross-links, `docs/migration.md`.
    - `docs/index.md` update: yes; refresh Frontend interoperability entry with co-work events.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-25):
    - Co-work event model (`packages/ag-ui/src/types.ts`): `CoWorkKind` + `CoWorkEvent` discriminated union (`artifact.progress`, `artifact.approval.requested`, `draft.connector.pending`, `browser.snapshot`, `artifact.download.link`) and `CoWorkContext { threadId, artifactId?, identity? }`. Types only — no second event system.
    - One shared projection path (`projection.ts`): `projectCoWorkEvent(event, { redactor, projection, maxBytes })` validates the shape (fail-closed on unknown kind / missing / non-finite fields), applies the host `AgUiProjection.coWork` allow-list hook, redacts, and byte-caps to a safe JSON payload (oversized → dropped, never truncated into a leak). Both mappers reuse it (DRY).
    - AG-UI mapper (`ag-ui-mapper.ts`): `mapCoWork(event)` emits one schema-valid named `CUSTOM` event `prism.cowork.<kind>`; malformed input yields none. ACP parity (`acp/mapper.ts`): `mapCoWork(event)` emits a redacted `agent_message_chunk` (schema-valid), malformed yields none.
    - Reconnectable replay (`replay.ts`): `createCoWorkReplay({ source, limits })` bounds one durable co-work page behind the frozen cursor/event caps (oversized cursor / over-limit page fail closed). Pure read + map, so disconnect/resume from a cursor replays state with no duplicate side effects (verified idempotent in tests).
    - Handler context flow (`handler.ts`): `createAgUiHandler` gained optional `coWorkContext` (derives thread/artifact/identity from the authorized request, never client JSON) and `coWork` (a `CoWorkReplay`); `withCoWork` appends one bounded, redacted co-work page after the run stream on start/resume/replay. No UI-framework coupling; existing durable-resume stream reused.
    - Security: redactor strips secrets and local filesystem paths from co-work payloads; download-link events carry an authorized expiring token only (no file bodies); malformed client-supplied co-work events fail closed; telemetry stays metadata-safe. Frozen mapper limits reused (`maxTextBytes` cap per event).
    - Tests: new `packages/ag-ui/src/__tests__/cowork.test.ts` 10/10 (all-kind AG-UI round-trip + schema validity, secret/path redaction, malformed fail-closed, oversized drop, host projection hook, ACP parity, co-work replay caps + idempotency, handler context threading + post-run ordering + malformed-drop). Full ag-ui suite 23/23; full `npm test` exit 0, 0 fail.
    - Docs: `docs/ag-ui.md` (co-work event catalog + projection/replay notes + Related cross-link), `docs/work-artifacts-and-review.md` (AG-UI cross-link), `docs/index.md` (Frontend interoperability entry refreshed). Freeze doc line reconciled to the shipped `mapCoWork`/`projectCoWorkEvent`/`coWorkContext` surface and `draft.connector.pending` kind. Docs tests 95/95.
    - ponytail ceilings recorded: handler projects one bounded co-work page after the run (mount a dedicated cursor-paged co-work endpoint via `createCoWorkReplay` for full pagination); co-work approval responses flow through the artifact service (Task 3) rather than a second AG-UI interrupt/resume system; ACP agent streaming of co-work left to hosts (mapper parity is the shared contract); `migration.md` 0.0.14 entry deferred to the release task (consistent with Tasks 1–3).

- [x] 5. Add scoped OAuth connector establishment for Microsoft 365 / Google Workspace workloads
  - Acceptance Criteria:
    - Functional: hosts establish, refresh, and revoke scoped OAuth credentials for Outlook/Gmail and related M365/GWS workloads through existing `OAuthProvider`/credential-store seams (Codex OAuth pattern from 0.0.12); work-tools connectors consume per-identity tokens without credentials in argv/model context.
    - Functional: scopes are least-privilege per tool bundle (read vs mutation); token refresh is late-bound; revocation stops connector calls fail-closed; Slack/Teams chat channels are explicitly not shipped (demand-gated).
    - Performance: refresh/revocation and connector payloads honor frozen byte/time/rate caps from Task 0; no token refresh storm under reconnect.
    - Code Quality: extends `@arnilo/prism-credentials-node` OAuth adapters + `@arnilo/prism-work-tools` identity wiring; login UX stays host-owned; no new channel catalog abstraction.
    - Security: codes/tokens redacted in logs/events/telemetry/errors; per-identity token isolation (no cross-identity fallback); expired/revoked/wrong-tenant tokens rejected; audit records via policy ledger.
  - Approach:
    - Documentation Reviewed:
      - `docs/credential-storage.md`, `docs/credentials-and-redaction.md`, `docs/work-tools.md`, `docs/work-connectors.md`; Plan 075 Task 6 (provider-authorized OAuth policy), Plan 076 Tasks 7–8 (work-tools identity/scope/idempotency); current Microsoft Graph / Google Workspace OAuth scope docs at implementation time.
    - Options Considered:
      - Ship Slack/Teams adapters now: rejected — demand-gated until web/AG-UI usage measured (roadmap).
      - Generic OAuth mega-flow: coarse scopes; rejected.
      - Per-workload least-privilege OAuth adapters over existing seams: chosen.
    - Chosen Approach:
      - Add M365/GWS OAuth provider adapters (PKCE/device-code as protocol-supported), scope maps per read/mutation bundle, refresh/revocation APIs; wire into work-tools identity context.
    - API Notes and Examples:
      ```ts
      const oauth = createMicrosoft365OAuthProvider({ scopes: ["Mail.Read"], ... });
      await refreshOAuthCredential({ provider: oauth, credentials, store });
      await revokeOAuthCredential({ provider: oauth, credentials, store, identity });
      const workTools = createWorkTools({ microsoft365: createMicrosoft365CliAdapter({ binary, identity }), approval, idempotencyStore });
      ```
    - Files to Create/Edit:
      - `packages/credentials-node/src/` M365/GWS OAuth adapters, scope maps, tests.
      - `packages/work-tools/src/` identity/token wiring, revocation checks, tests.
    - References:
      - OpenAI Codex OAuth pattern (Plan 075 Task 6), Plan 076 work-tools CLI isolation/idempotency.
  - Test Cases to Write:
    - Establish/refresh/revoke round-trips; login abort; token redaction everywhere.
    - Cross-identity isolation; expired/revoked/wrong-tenant denial; least-scope enforcement per bundle.
    - Scope assertion: no Slack/Teams package/export/docs entry.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new OAuth adapters + connector credential behavior.
    - Docs pages to create/edit:
      - `docs/credential-storage.md`, `docs/credentials-and-redaction.md`, `docs/work-connectors.md`, `docs/work-tools.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; refresh Credentials and Work connectors entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-25):
    - Shared OAuth2 seam (`packages/credentials-node/src/oauth2.ts`): `createOAuth2Provider(config)` implements PKCE auth-code + device-code + refresh + revoke with redacted errors (one flow implementation, mirroring the 0.0.12 Codex pattern; PKCE helpers `createOAuth2PkceVerifier`/`computeOAuth2S256Challenge`). Refresh preserves the account binding so per-identity isolation survives token rotation.
    - Workload adapters: `createMicrosoft365OAuthProvider()` (login.microsoftonline.com endpoints; no public RFC 7009 endpoint, so revoke is a no-op upstream and the local store delete is the fail-closed boundary) and `createGoogleWorkspaceOAuthProvider()` (Google endpoints + RFC 7009 revocation). Both take least-privilege `capabilities` + `access` (read/mutation).
    - Least-privilege scope bundles (`scopes.ts`): `resolveWorkloadScopes()` + `resolveMicrosoft365Scopes`/`resolveGoogleWorkspaceScopes` (Graph delegated `Mail.Read`/`Mail.Send`/`Calendars.*`/`Files.*`/`Tasks.*`; GWS `gmail.readonly`/`gmail.send`, calendar/drive/docs/sheets/slides readonly vs write). Read bundles omit mutation scopes; unknown capability fails closed (never silently broadens consent).
    - Core seam extension (`src/contracts.ts` + `src/credentials.ts`): optional `OAuthProvider.revoke?` + `revokeOAuthCredential({ provider, credentials, store })` (best-effort upstream revoke, then mandatory local delete) and `RevocableOAuthCredentialStore`. Root frozen surface updated (150/150).
    - Per-identity token bridge (`work-token.ts`): `createOAuthWorkTokenProvider({ provider, store, envVar })` resolves a stored credential to an env var — late-bound single-flight refresh (no refresh storm under reconnect), and missing/expired-without-refresh/revoked/cross-account/wrong-tenant all fail closed (undefined).
    - Work-tools wiring (`packages/work-tools`): adapters accept an optional `tokenProvider` (`WorkTokenProvider`); each `ensureReady`/`runOp` resolves the token and injects it via per-exec env (cli.ts merges per-exec env over base) — never argv, never model context. A configured provider returning undefined fails the call closed (`ERR_PRISM_WORK_CREDENTIAL`) before any exec. No provider = host uses another auth seam (unchanged).
    - Tests: `packages/credentials-node/src/__tests__/oauth.test.ts` 17/17 (scope least-privilege + unknown-capability fail-closed, PKCE/device/refresh/abort/redaction, GWS upstream revoke + M365 local-delete fail-closed, work-token valid/revoked/late-refresh/no-refresh/cross-identity/wrong-tenant/single-flight). `packages/work-tools` token-wiring 3/3 (env-not-argv injection, revoked fail-closed before exec, no-provider path); work-tools 13/13. Scope guard in `docs.test.ts`: no Slack/Teams channel packages/exports/docs pages (barrels clean; the M365 `teams` capability op is distinct). Full `npm test` exit 0, 0 fail.
    - Docs: `docs/credential-storage.md` (workload OAuth providers + revocation example; 0.0.12-only note extended to 0.0.14), `docs/credentials-and-redaction.md` (`revokeOAuthCredential`), `docs/work-tools.md` (tokenProvider + security note), `docs/work-connectors.md` (scoped OAuth establishment + Slack/Teams-not-shipped out-of-scope), `docs/index.md` (Credentials + Work entries refreshed). Freeze doc connector line reconciled to the shipped `createOAuth2Provider`/scope-bundle/`createOAuthWorkTokenProvider`/`revokeOAuthCredential` surface. Docs tests 96/96.
    - ponytail ceilings recorded: reused one generic OAuth2 flow (Codex left as-is, not refactored — out of scope); M365 has no public revocation endpoint so local delete is the trust boundary; token env var name is host-configurable (no CLI-specific default assumed); Slack/Teams chat channels demand-gated (not shipped); `migration.md` 0.0.14 entry deferred to the release task (consistent with Tasks 1–4).

- [x] 6. Gate browser conversation composition + optional voice/desktop device adapters
  - Acceptance Criteria:
    - Functional: delivered `@arnilo/prism-browser` tools compose with conversation threads only through existing sandbox, egress, secret-injection, approval, and run-limit policies; browser workflow checkpoints persist verified URLs/domain state + host data (never serialized browser internals); after interruption, reload and verify before any side effect.
    - Functional: realtime voice and desktop OS/computer-control adapters ship only as disabled-by-default contracts + conformance (denial, approval, stream bounds, sandbox/network policy, redacted telemetry); vendor packages ship only if Task 0 records measured demand, otherwise deferred to 0.1.x with explicit docs note.
    - Performance: browser snapshots/actions and any device audio/screenshot/stream paths honor frozen byte/time/rate caps; review/browser loops consume shared `RunLimits` (turn/tool/token/cost).
    - Code Quality: no second browser runtime, no device framework; device contracts extend existing tool/approval/sandbox/telemetry seams; conversation composition reuses Tasks 1/3/4.
    - Security: device adapters fail closed without explicit consent+sandbox+approval; side effects never replay after reconnect; secrets isolated from snapshots/streams; telemetry metadata-safe.
  - Approach:
    - Documentation Reviewed:
      - `docs/browser-automation.md`, Plan 072 browser evidence (egress/side-effect/upload/download policy), `docs/coding-security.md`, `docs/host-security.md`, `docs/workflows.md` (checkpoints), `packages/browser/src/*`; current Playwright docs at implementation time.
    - Options Considered:
      - Ship vendor voice/desktop packages speculatively: rejected — demand-gated (roadmap + gate 8).
      - Serialize browser context into checkpoints: fragile + secret-bearing; rejected.
      - Verified-state browser checkpoints + device contracts/conformance only: chosen.
    - Chosen Approach:
      - Add browser checkpoint schema (URL, domain state hash, host data refs) + reload/verify-before-side-effect guard; conversation-scoped browser examples.
      - Add `DeviceAdapter` contract (voice/desktop-control) with deny-by-default, approval, stream bounds, redaction conformance fixtures; no vendor implementation unless Task 0 demand evidence.
    - API Notes and Examples:
      ```ts
      // Browser checkpoint = verified state, not internals:
      await browserWorkflow.checkpoint({ url, domainStateHash, hostDataRef, identity });
      await browserWorkflow.resume({ checkpoint, verifyBeforeSideEffect: true });
      // Device adapters (contracts only):
      const device: DeviceAdapter = { kind: "voice", enabled: false, requireApproval: true, limits: {...} };
      ```
    - Files to Create/Edit:
      - `packages/browser/src/` checkpoint/resume-verify seam + conversation composition examples/tests.
      - Core/server device-adapter contracts + conformance fixtures (tentative location: core tool seams or small optional module per Task 0 freeze).
      - `docs/browser-automation.md`, optional device page only if contract ships.
    - References:
      - Plan 072 browser policy, Plan 073 unified workspace, Tasks 1/3/4 of this plan.
  - Test Cases to Write:
    - Browser checkpoint reload/verify; side-effect non-replay after disconnect/resume; secret isolation in snapshots; sandbox/network policy; approval + stream bounds; redacted telemetry.
    - Device adapter denial-by-default, approval gate, stream-bound, sandbox/network policy, redaction conformance.
    - Conversation-scoped browser run consumes shared `RunLimits`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; browser checkpoint/resume semantics + device-adapter contract (if shipped).
    - Docs pages to create/edit:
      - `docs/browser-automation.md`, `docs/conversations.md` cross-links, `docs/host-security.md`, optional `docs/device-adapters.md` (only if contract ships; otherwise deferral note in `docs/migration.md`).
    - `docs/index.md` update: yes; refresh Browser automation entry; add Device adapters entry only if shipped.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-25):
    - Browser verified-state checkpoints (`packages/browser/src/checkpoint.ts`): `createBrowserCheckpointLedger()` records `{ url, domainStateHash, hostDataRef }` only — never cookies/localStorage/serialized context (frozen caps URL 8 KiB/16 KiB, hash 256 B/1 KiB, ref 2 KiB/8 KiB refs-not-bodies, 16/64 checkpoints per run with oldest-evicted bounded retention). Reload/verify-before-side-effect state machine: `markResumed(runId)` marks state stale after resume/interruption, `assertVerifiedBeforeSideEffect(runId)` fails closed until the host reloads + `verify()`s, so side effects never replay on stale state; resuming an unknown run fails closed until verify. Checkpoints are run-scoped, so a conversation thread composes through the run it owns (per-thread isolation verified), reusing the manager's existing sandbox/egress/secret-injection/approval/limit policy — no second browser runtime.
    - Device adapter contract (`src/devices.ts`, core): `DeviceAdapter` + deny-by-default `resolveDevicePolicy()` / `assertDeviceAdmit()` composed over `PermissionPolicy`/`RunLimits`/redactor. Admission fails closed without explicit `enabled`, an explicit sandbox, approval (when required), an under-budget session count (1/4), and shared `RunLimits` accounting. `acceptDeviceChunk()` drops oversize audio/screenshot/stream chunks (1 MiB/8 MiB) with a `dropped_oversize` marker (never forwarded); `redactDeviceTelemetry()` applies the host redactor before emit/persist. `runDevicePolicyConformance()` is the reusable conformance pair (denial-by-default, approval-gate, session-budget, run-accounting, stream-bounds, redaction) for future voice/desktop-control vendor adapters — tested now via fixtures only. No vendor voice/desktop package ships (demand-gated 0.1.x); no device framework, no second approval runtime.
    - Tests: `src/__tests__/devices.test.ts` 14/14 (resolve defaults/caps/kind rejection, deny-by-default, sandbox/approval/session-budget/run-limits fail-closed, stream bounds, redaction, conformance for voice + desktop-control). `packages/browser/src/__tests__/checkpoint.test.ts` 11/11 (verified state, no-internals shape, byte caps, bounded eviction, verify-before-side-effect fresh/stale/resume/unknown-run, per-conversation-run isolation). Scope guard in `docs.test.ts`: `src/devices.ts` + `packages/browser/src/checkpoint.ts` ship, deny-by-default; `packages/voice`/`packages/desktop`/`packages/device` do not exist. Root frozen surface updated (150/150). Full `npm test` exit 0, 0 fail.
    - Docs: created `docs/device-adapters.md` (wiki-structured, registered in apiPages, one index nav link); `docs/browser-automation.md` (checkpoint/verify extension note + Related links); `docs/conversations.md` + `docs/host-security.md` cross-links/boundary clauses; `docs/index.md` Browser entry refreshed + Device adapters entry added. Freeze doc browser/device lines reconciled to the shipped `createBrowserCheckpointLedger`/`assertVerifiedBeforeSideEffect` and `resolveDevicePolicy`/`assertDeviceAdmit`/`acceptDeviceChunk`/`redactDeviceTelemetry`/`runDevicePolicyConformance` surface. Docs tests 97/97.
    - ponytail ceilings recorded: checkpoint ledger is in-memory per process (host persistence is the durable seam — reuse the conversation/session store for cross-process durability); `verify()` trusts the host's reload+verify signal (no independent DOM verification — browser internals are deliberately not serialized); device contract ships policy+conformance only, vendor adapters deferred to 0.1.x pending measured demand; `migration.md` 0.0.14 entry deferred to the release task (consistent with Tasks 1–5).

- [x] 7. Complete docs, examples, migration notes, package metadata, and index navigation
  - Acceptance Criteria:
    - Functional: docs cover conversations, memory consent/lifecycle, artifacts/review, AG-UI co-work events, OAuth connectors, browser composition, and device gating; examples compile and run network-free with fakes.
    - Performance: all frozen Task 0 caps documented with benchmark command placeholders.
    - Code Quality: API pages follow Prism wiki structure; package READMEs match packed exports; 0.0.15/0.1.x deferrals explicit (Slack/Teams, voice/desktop vendors, memory production conformance).
    - Security: docs require authenticated identity ownership, consent recheck, expiring links, token/path/secret redaction, fail-closed revocation.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md`; Tasks 1–6 APIs; existing `docs/ag-ui.md`, `docs/server.md`, `docs/working-and-semantic-memory.md`, `docs/work-tools.md`, `docs/browser-automation.md`.
    - Options Considered:
      - Scatter co-work guidance into host-security: poor discoverability; rejected.
      - Canonical conversations + artifacts pages plus cross-links: chosen.
    - Chosen Approach:
      - Finish wiki-structured pages from roadmap Phase 9 Documentation/Wiki Assessment; add network-free fake examples (conversation + artifact review + connector draft).
      - Document 0.0.13 → 0.0.14 migration (additive seams; identity verifier required at new conversation/artifact/memory/device surfaces; no permission broadening).
    - API Notes and Examples:
      ```ts
      // Canonical docs include:
      conversations.create(...) / conversations.events(...)
      memory.setConsent(...) / schedules.enable(...) / schedules.revoke(...)
      artifacts.attach(...) / artifacts.approve(...) / artifacts.deliveryLink(...)
      agui.handle(request, { threadId, artifactId, identity })
      ```
    - Files to Create/Edit:
      - `docs/conversations.md`, `docs/work-artifacts-and-review.md`, `docs/ag-ui.md`, `docs/working-and-semantic-memory.md`, `docs/work-tools.md`, `docs/work-connectors.md`, `docs/browser-automation.md`, `docs/credential-storage.md`, `docs/server.md`, `docs/workflows.md`, `docs/host-security.md`, `docs/migration.md`, `docs/performance.md`, `docs/release-and-install.md`, `docs/index.md`.
      - Package READMEs/CHANGELOGs; `examples/*` network-free demos; `src/__tests__/docs.test.ts`.
    - References:
      - Roadmap Phase 9 Documentation/Wiki Assessment list.
  - Test Cases to Write:
    - Docs tests assert package/subpath names, caps, security invariants, migration version, deferral scope (no Slack/Teams/Office/voice-vendor entries).
    - Examples typecheck and fake runs succeed offline.
    - Link/export/package README assertions pass.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; publishes complete usage/security/migration guidance.
    - Docs pages to create/edit: all paths listed above.
    - `docs/index.md` update: yes; add Conversations and Work artifacts/review; refresh Tools, Memory, Credentials, Server, Security, Frontend interoperability.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-25):
    - Migration: `docs/migration.md` gained a `0.0.13 → 0.0.14` section (newest-first) — additive surface table (conversations, memory consent/lifecycle, artifacts/review, AG-UI co-work, OAuth connectors, browser checkpoints, device contracts), the identity-verifier requirement on every new surface, explicit no-permission-broadening (gate 8), explicit 0.0.15/0.1.x deferrals (Slack/Teams channels, voice/desktop-control vendor packages, Studio, local Office, second memory/event runtime, memory production conformance), and the `scripts/benchmark-0.0.14.mjs` placeholder.
    - Performance: `docs/performance.md` documents every frozen 0.0.14 cap (conversation/artifact/memory-retention/capability-TTL/browser-checkpoint/device) with charging points + the `benchmark-0.0.14.mjs` placeholder reporting conversation replay, memory injection/consent, artifact revision/delivery, AG-UI co-work mapping, and connector refresh overhead.
    - Examples (network-free, compile-checked, run offline): added `examples/conversation-durable-replay.ts` (sqlite `:memory:` + mock agent → create/continue/reconnectable redacted replay; verified `allRedacted: true`) and `examples/artifact-review-delivery.ts` (in-memory checkpoint store → attach/revise/approve + expiring authorized delivery link). Connector-draft demo already existed (`enterprise-work-connectors.ts`). Both run via Node 24 type-stripping and print one JSON line; listed in `examples/README.md` + `docs/index.md`.
    - Package metadata: refreshed the API/usage sections of the six extended package READMEs (server: conversation/artifact handlers; memory: consent/lifecycle + security; ag-ui: co-work events; credentials-node: workload OAuth providers + work-token bridge; work-tools: tokenProvider; browser: verified-state checkpoints) and the core `README.md` co-work-contracts bullet — READMEs match packed exports; docs pages remain canonical.
    - Index navigation: `docs/index.md` refreshed across Browser/Device/Credentials/Work entries; `docs/device-adapters.md` (Task 6) and conversation/artifact pages linked; exactly one nav link per page invariant holds.
    - Tests: new `docs.test.ts` case "phase 9 task 7 docs cover migration, performance placeholder, examples, and explicit deferrals" (migration tokens + deferrals, `benchmark-0.0.14.mjs`, example existence + index links). Docs tests 98/98; examples `tsc -p examples --noEmit` clean; full `npm test` exit 0, 0 fail.
    - ponytail ceilings recorded: README updates are concise pointers to canonical docs pages (not duplicated API references); 0.0.14 CHANGELOG sections + version graph bump deferred to Task 12 (release), consistent with the 0.0.13 pattern where the release task owns changelogs/versions; `release-and-install.md` peer-version strings (`@arnilo/prism@0.0.13`) intentionally left for the Task 12 graph bump.

- [x] 8. Provider primitive review + scaffold Alibaba Cloud and Ollama Cloud packages + atomic graph wiring (41 → 43)
  - Acceptance Criteria:
    - Functional: existing provider primitives are inventoried and reused (no second transport/SSE/cache/credential/event system); `packages/provider-alibaba` and `packages/provider-ollama` exist as compiling, packable `0.0.13` packages with peer `@arnilo/prism@0.0.13`; both enroll in the `@arnilo/prism-providers` umbrella; publishable graph is consistently `43` across every guard and doc.
    - Performance: scaffolds add no runtime cost (empty barrels, `sideEffects: false`); no new external dependency is introduced (both providers are OpenAI-compatible and reuse core transport).
    - Code Quality: primitive-review evidence recorded in this plan; package layout mirrors `packages/provider-kimi` (package.json/tsconfig/src/index.ts/README/CHANGELOG); no provider-specific logic lands in core.
    - Security: scaffolds ship no credentials, no network calls, no local paths; the Phase 9 freeze is revised explicitly to authorize exactly two new provider packages (no other scope enters).
  - Approach:
    - Documentation Reviewed:
      - Existing primitives: `packages/provider-kimi/src/{models,provider,cache}.ts` (dynamic `GET /v1/models` discovery + `mapModel` + OpenAI/Anthropic routes), `@arnilo/prism/providers/transport` (`readSseData`, `readBoundedResponseText`), `@arnilo/prism/providers/media`, core `applyCacheControl` / `resolveCredentialValue` / `redactSecrets` / `providerTextDelta|providerUsage|providerDone|providerError|providerToolCall`, `ModelConfig` / `AIProvider` / `ProviderRequest` / `Usage` (`cacheReadTokens` / `cacheWriteTokens`).
      - Umbrella/guard wiring: `packages/prism-providers/package.json`, `src/__tests__/packaging.test.ts` (exact `@arnilo/prism-providers` dep set + provider array), `src/__tests__/docs.test.ts` (publishable count + freeze token), `docs/release-and-install.md`, `docs/review-coverage-2026-07-25-phase-9.md`.
    - Options Considered:
      - New core transport per provider: rejected — both are OpenAI-compatible; reuse `readSseData`/chat-completions body shape.
      - Enroll in `prism-providers` (general umbrella) vs directly in `prism-all` (the azure/bedrock/vertex enterprise pattern): choose `prism-providers` so both flow into `prism-all` transitively with one edit surface; revisit only if a provider must be excluded from the general family.
      - Scaffold both packages in this task vs per-provider: scaffold both here so the `41 → 43` count/freeze wiring happens exactly once and stays green; Tasks 9–10 fill implementations.
    - Chosen Approach:
      - Inventory primitives (above), conclude no new core primitive is required, create two minimal compiling packages, enroll in `prism-providers`, and bump every `41`→`43` guard/doc atomically.
    - API Notes and Examples:
      ```ts
      // packages/provider-alibaba/src/index.ts (scaffold; replaced in Task 9)
      export const alibabaProviderId = "alibaba";
      // packages/provider-ollama/src/index.ts (scaffold; replaced in Task 10)
      export const ollamaProviderId = "ollama";
      ```
    - Files to Create/Edit:
      - `packages/provider-alibaba/{package.json,tsconfig.json,README.md,CHANGELOG.md,src/index.ts}`: new compiling `0.0.13` package (peer `@arnilo/prism@0.0.13`, `sideEffects: false`, ships dist/README/CHANGELOG).
      - `packages/provider-ollama/{package.json,tsconfig.json,README.md,CHANGELOG.md,src/index.ts}`: same.
      - `packages/prism-providers/package.json`: add both deps pinned `0.0.13`.
      - `src/__tests__/packaging.test.ts`: add both to the provider array and to `expected["@arnilo/prism-providers"]`.
      - `src/__tests__/docs.test.ts`: publishable count `41`→`43` (dirs.length and frozen-manifest assertions), release `includes("41")`→`includes("43")`, Phase 9 freeze token `"41 → 41"`→`"41 → 43"`, `"All 41 manifests (35 code packages + 6 family/profile packages)"`→`"All 43 manifests (37 code packages + 6 family/profile packages)"`.
      - `docs/release-and-install.md`: header count `thirty-four … (41)`→`thirty-six … (43)`, `Package set (41):`→`(43)` + two entries, `All 41 manifests (35 code …)`→`43 (37 code …)` (leave dated 0.0.13/Phase-8 historical snapshots unchanged).
      - `docs/review-coverage-2026-07-25-phase-9.md`: revise `41 → 41`/`no new packages` lines (5, 39, 51, 76, 116, 236) to `41 → 43` and authorize exactly `@arnilo/prism-provider-alibaba` + `@arnilo/prism-provider-ollama` as a requested 0.0.14 addition.
    - References:
      - `packages/provider-kimi` (closest existing OpenAI-compatible + dynamic-discovery package); Plan 015/067 provider-package patterns.
  - Test Cases to Write:
    - Packaging guard: both packages present, packable, pinned `0.0.13`, exact `prism-providers` family includes both.
    - Publishable count guards now assert `43` and pass with the two scaffolds present.
    - Scaffolds compile (`tsc`) and export only placeholder ids (no network/secret surface).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; two new package names + revised publishable graph.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: count + package-set edits above.
      - `docs/review-coverage-2026-07-25-phase-9.md`: freeze revision above.
    - `docs/index.md` update: deferred to Task 11 (navigation added with the finished provider pages).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-25):
    - Primitive review: inventoried `packages/provider-kimi` (dynamic `GET /v1/models` + `mapModel` + OpenAI/Anthropic routes), core transport (`readSseData`/`readBoundedResponseText`), `applyCacheControl`/`resolveCredentialValue`/`redactSecrets`, provider event helpers, and `Usage.cacheReadTokens/cacheWriteTokens`. Conclusion: both Alibaba (DashScope/Model Studio + Coding Plan) and Ollama Cloud are OpenAI-compatible, so **no new core primitive is required** — Tasks 9–10 reuse the kimi pattern and core transport; no second SSE/cache/credential/event system.
    - Scaffolds: created `packages/provider-alibaba` and `packages/provider-ollama` mirroring `provider-kimi` (package.json `0.0.13`, peer `@arnilo/prism@0.0.13`, `sideEffects: false`, tsconfig, README, CHANGELOG, LICENSE, `src/index.ts` exporting only a placeholder id, and a scaffold `__tests__/index.test.ts` asserting placeholder-only export + zero runtime deps). Both compile (`tsc`) and pack; scaffold tests 2+2 pass.
    - Umbrella enrollment: added both deps (pinned `0.0.13`) to `packages/prism-providers`; `prism-all` reaches them transitively (no direct `prism-all` edit; its exact dep set is unchanged and the `prism-all transitively includes every published first-party package` guard passes).
    - Atomic 41 → 43 wiring: `src/__tests__/packaging.test.ts` (provider array + exact `prism-providers` family), `src/__tests__/install-smoke.test.ts` (offline tarball array), `src/__tests__/docs.test.ts` (publishable count `41`→`43` in `dirs.length` + frozen-manifest assertions, release `includes("43")`, Phase 9 freeze token `"41 → 43"`, `"All 43 manifests (37 code packages + 6 family/profile packages)"`, `thirty-six first-party capability packages`, `all eleven provider-* packages`).
    - Docs: `docs/release-and-install.md` live descriptions updated (intro `thirty-six … (**43**)`, `all eleven provider-* packages: ten HTTP adapters plus AI SDK`, `All 43 manifests (37 code …)`, and the current `Package set (43):` enumeration gained both names). `docs/review-coverage-2026-07-25-phase-9.md` freeze revised `41 → 41`→`41 → 43` across all six sites, authorizing exactly the two provider packages.
    - Execution refinements (found via guards, applied): (a) each packable package needs a `LICENSE` (copied MIT license); (b) CHANGELOG `0.0.13` section must use the finalized date `2026-07-24`; (c) the latest (0.0.13) publish-handoff `Package set` list is the canonical current enumeration the docs guard checks against, so it was bumped to 43 — while the pinned historical phrases (the GO-decision `**41 manifests**` and the dated 0.0.12/0.0.11/0.0.10 handoff package lists) were deliberately left unchanged.
    - Tests: packaging 219/219, docs 98/98, install-smoke 6/6, scaffold 2+2; full `npm test` exit 0, 0 fail (core 1272/1272).
    - ponytail ceilings recorded: scaffolds export only placeholder ids (no network/secret/filesystem surface); `docs/index.md` navigation + `apiPages` enrollment for `docs/providers/{alibaba,ollama}.md` deferred to Tasks 9–11; per-provider `CHANGELOG` 0.0.14 sections + version graph bump deferred to Task 12.

- [x] 9. Implement Alibaba Cloud provider (Model Studio / DashScope + Coding Plan) with dynamic models and context-cache usage
  - Acceptance Criteria:
    - Functional: `createAlibabaProvider()` speaks OpenAI-compatible `POST {base}/chat/completions` (streaming SSE, tools, `stream_options.include_usage`) against Model Studio/DashScope and Coding Plan base URLs; `listAlibabaModels()` discovers models dynamically via `GET {base}/models` (no hard-coded model list); Qwen thinking toggles via `enable_thinking` passthrough.
    - Functional: usage maps `prompt_tokens`/`completion_tokens`/`total_tokens` and context-cache `usage.prompt_tokens_details.cached_tokens` → `cacheReadTokens`, `cache_creation_input_tokens` → `cacheWriteTokens`; explicit cache emits Anthropic-style `cache_control: {"type":"ephemeral"}` markers (≤4) via shared `applyCacheControl`; implicit prefix cache documented as automatic.
    - Performance: reuses core bounded transport (`readSseData`/`readBoundedResponseText`); model discovery is caller-gated (never invoked inside the provider hot path).
    - Code Quality: layout mirrors `provider-kimi` (`models.ts`/`provider.ts`/`cache.ts`/`index.ts`); `defineAlibabaModel`/`mapAlibabaModel`/`listAlibabaModels` exported; base-URL resolver covers Singapore intl, Beijing, US, workspace-dedicated, and Coding Plan.
    - Security: API key resolved via `resolveCredentialValue` and sent only as `Authorization: Bearer`; keys/auth codes redacted from all thrown errors; no local filesystem paths; OpenAI-style `{error:{message,type,code}}` mapped to `providerError`.
  - Approach:
    - Documentation Reviewed:
      - Alibaba base URLs: https://www.alibabacloud.com/help/en/model-studio/base-url (OpenAI-compatible `…/compatible-mode/v1`; Coding Plan `https://coding-intl.dashscope.aliyuncs.com/v1`; Anthropic-compatible `…/apps/anthropic`).
      - Request/response: https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope (chat/completions body, `stream_options.include_usage`, tools, `enable_thinking`, error/status codes).
      - Context cache: https://www.alibabacloud.com/help/en/model-studio/context-cache (explicit `cache_control:{type:ephemeral}` ≤4 markers, 1024-token min, 5-min TTL; implicit prefix cache; `prompt_tokens_details.cached_tokens` + `cache_creation_input_tokens`).
    - Options Considered:
      - Anthropic-compatible route (`…/apps/anthropic`) as primary: rejected — OpenAI-compatible is the documented migration path and matches existing Prism OpenAI tooling; note Anthropic route as an alternate `compat.route`.
      - Hard-coded featured model list (kimi-style bootstrap): rejected per requirement — dynamic `GET {base}/models` is primary; a tiny offline bootstrap is allowed only as an opt-in fallback and must not replace discovery.
    - Chosen Approach:
      - OpenAI-compatible chat-completions provider over core transport; dynamic model discovery; explicit+implicit cache usage mapping.
    - API Notes and Examples:
      ```bash
      curl 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions' \
        -H "Authorization: Bearer $DASHSCOPE_API_KEY" -H 'Content-Type: application/json' \
        -d '{"model":"qwen-plus","messages":[{"role":"user","content":"hi"}],"stream":true,"stream_options":{"include_usage":true}}'
      # cache usage: usage.prompt_tokens_details.cached_tokens / .cache_creation_input_tokens
      ```
    - Files to Create/Edit:
      - `packages/provider-alibaba/src/{models.ts,provider.ts,cache.ts,index.ts}`: replace scaffold with full implementation.
      - `packages/provider-alibaba/src/__tests__/alibaba.test.ts`: network-free fakes.
      - `packages/provider-alibaba/README.md`: usage + base URLs + cache notes.
      - `docs/providers/alibaba.md`: new API page (9-heading structure).
      - `src/__tests__/docs.test.ts`: enroll `docs/providers/alibaba.md` in `apiPages`.
    - References:
      - `packages/provider-kimi/src/{models,provider,cache}.ts`; core `applyCacheControl`.
  - Test Cases to Write:
    - Request shape: chat/completions body, Bearer header, `stream_options.include_usage`, tools, `enable_thinking` passthrough.
    - Streaming SSE → text deltas + final usage; tool-call assembly.
    - Cache usage mapping: `cached_tokens`→`cacheReadTokens`, `cache_creation_input_tokens`→`cacheWriteTokens`.
    - Explicit cache: `cache_control` markers emitted only when enabled, capped at 4; implicit cache documented (no marker).
    - Dynamic discovery: `listAlibabaModels` maps `GET /models` entries → `ModelConfig` (no hard-coded ids); error redaction keeps API key out of messages.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new provider package exports + docs page.
    - Docs pages to create/edit:
      - `docs/providers/alibaba.md`: create (9-heading API page).
    - `docs/index.md` update: deferred to Task 11.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-25):
    - Implementation (mirrors `provider-kimi`/`moonshot` OpenAI-route layout): `models.ts` (`defineAlibabaModel`/`mapAlibabaModel`/`listAlibabaModels` + `alibabaBaseUrl` presets `singapore`/`beijing`/`us`/`coding-plan` + explicit/workspace `baseUrl` override); `provider.ts` (`createAlibabaProvider` OpenAI-compatible `POST {base}/chat/completions` with SSE, tools, `stream_options.include_usage`, `enable_thinking` passthrough, cache-marker-preserving `serializeAlibabaMessage`, completion-evidence `done`/`error`); `cache.ts` (`alibabaCacheEnabled`/`applyAlibabaCacheControl` capped at `ALIBABA_MAX_CACHE_BREAKPOINTS` = 4, `withAlibabaCacheMarker`); `index.ts` (`createAlibabaProviderPackage` registers provider + `api_key` auth + host-supplied models, **no discovery during setup**).
    - Dynamic models (no hard-coded catalog): `listAlibabaModels()` calls OpenAI-compatible `GET {base}/models` and maps entries → `ModelConfig` (reasoning/vision inferred from id). Catalogs vary by region/workspace/plan, so discovery is the source of truth; the package ships no featured model list.
    - Context cache: DashScope implicit prefix caching is automatic (no marker); explicit opt-in `cache_control: {"type":"ephemeral"}` markers land on breakpoint-selected messages, hard-capped at 4. Usage accounting maps `usage.prompt_tokens_details.cached_tokens` → `cacheReadTokens` and `cache_creation_input_tokens` → `cacheWriteTokens`.
    - Core primitive extension (additive, root-cause): `mapOpenAIChatUsage` (`src/providers/openai-primitives.ts`) now accepts `cache_creation_input_tokens` as a fallback for `cacheWriteTokens` (after `cache_write_tokens`), so the shared mapper handles the vendor variant without a second usage system. Comment kept provider-literal-free to satisfy the `phase12` core boundary guard.
    - Security: API key resolved via `resolveCredentialValue`, sent only as `Authorization: Bearer`; error bodies read through bounded `readBoundedResponseText` (redacts secrets); OpenAI-style `{error:{...}}` → `providerError`; no local filesystem paths in payloads; provider-owned compat keys stripped before the opaque spread.
    - Docs: created `docs/providers/alibaba.md` (9 prism-wiki headings; base-URL table, cache behavior, security), registered in `providerPackagePages` (docs.test.ts), and added the `docs/index.md` nav link — the “exactly one navigation link per page” guard forced the link now rather than at Task 11 (recorded deviation; Task 11 still owns `provider-packages.md`/`provider-caching.md` matrix + init templates). README updated to a concise pointer; CHANGELOG 0.0.13 entry describes the real implementation.
    - Tests: `packages/provider-alibaba` 14/14 (request shape + Bearer + `stream_options`/tools/`enable_thinking`; streaming text/reasoning/tool-call assembly + usage; cache usage mapping; explicit markers ≤4 cap; implicit emits none; truncated stream fails loudly; HTTP error → redacted `providerError`; dynamic discovery + discovery-error redaction; base-URL presets/override; package setup without discovery). Core `openai-primitives` + `phase11/phase12` boundary guards green; docs 98/98; workspace + examples typecheck clean; full `npm test` exit 0, 0 fail (core 1272/1272).
    - ponytail ceilings recorded: no offline model bootstrap (pure discovery; add an opt-in featured list only if offline setup demand appears); Anthropic-compatible `…/apps/anthropic` route documented as alternate but not implemented (OpenAI-compatible is primary); live network tests remain opt-in.

- [x] 10. Implement Ollama Cloud provider with dynamic models and implicit-cache usage
  - Acceptance Criteria:
    - Functional: `createOllamaProvider()` speaks OpenAI-compatible `POST {base}/v1/chat/completions` (streaming SSE, tools, `reasoning_effort`, `stream_options.include_usage`) against Ollama Cloud (`https://ollama.com`) and local (`http://localhost:11434`); `listOllamaModels()` discovers models dynamically via `GET {base}/v1/models` (with native `GET {base}/api/tags` documented as alternate); no hard-coded model list.
    - Functional: usage maps OpenAI-route `prompt_tokens`/`completion_tokens` (native `prompt_eval_count`/`eval_count` documented as equivalent); implicit KV/prefix cache is automatic with no request knob — `cacheReadTokens` is not populated (Ollama exposes no cached-token count), recorded as a documented ceiling.
    - Performance: reuses core bounded transport; discovery caller-gated.
    - Code Quality: layout mirrors `provider-kimi`; `defineOllamaModel`/`mapOllamaModel`/`listOllamaModels` exported; cloud vs local base-URL resolution.
    - Security: cloud API key (ollama.com) sent only as `Authorization: Bearer`; optional auth for local; keys redacted from errors; no local filesystem paths in payloads.
  - Approach:
    - Documentation Reviewed:
      - https://docs.ollama.com/api/introduction + /authentication (cloud base `https://ollama.com/api`, Bearer API key) and https://docs.ollama.com/api/openai-compatibility (`/v1/chat/completions` supported fields incl. `reasoning_effort`, `stream_options.include_usage`; `/v1/models` notes `created`=last modified, `owned_by`=username/`library`).
      - https://docs.ollama.com/api/tags (native `GET /api/tags`: `models[]` with name/model/modified_at/size/digest/details) and https://docs.ollama.com/api/usage (`prompt_eval_count`/`eval_count`, durations in ns; streaming usage in final `done` chunk).
    - Options Considered:
      - Native `/api/chat` route as primary: rejected — OpenAI-compatible route gives standard usage/tools/streaming and matches Prism tooling; native route documented as alternate.
      - Emit `cache_control` for Ollama: rejected — Ollama has no explicit cache API; implicit KV reuse only, no wire marker.
    - Chosen Approach:
      - OpenAI-compatible chat-completions provider; dynamic `/v1/models` discovery; input/output usage mapping with implicit-cache ceiling noted.
    - API Notes and Examples:
      ```bash
      curl 'https://ollama.com/v1/chat/completions' \
        -H "Authorization: Bearer $OLLAMA_API_KEY" -H 'Content-Type: application/json' \
        -d '{"model":"gpt-oss:20b","messages":[{"role":"user","content":"hi"}],"stream":true,"stream_options":{"include_usage":true}}'
      curl 'https://ollama.com/v1/models' -H "Authorization: Bearer $OLLAMA_API_KEY"   # dynamic discovery
      ```
    - Files to Create/Edit:
      - `packages/provider-ollama/src/{models.ts,provider.ts,index.ts}`: replace scaffold (no `cache.ts` needed — implicit only; a small helper may document the ceiling).
      - `packages/provider-ollama/src/__tests__/ollama.test.ts`: network-free fakes.
      - `packages/provider-ollama/README.md`: usage + cloud/local base URLs + implicit-cache note.
      - `docs/providers/ollama.md`: new API page (9-heading structure).
      - `src/__tests__/docs.test.ts`: enroll `docs/providers/ollama.md` in `apiPages`.
    - References:
      - `packages/provider-kimi/src/{models,provider}.ts`; Ollama OpenAI-compatibility docs.
  - Test Cases to Write:
    - Request shape: chat/completions body, Bearer (cloud) / optional (local), tools, `reasoning_effort`, `stream_options.include_usage`.
    - Streaming SSE → deltas + final usage; tool-call assembly.
    - Usage mapping: `prompt_tokens`/`completion_tokens`; `cacheReadTokens` remains undefined (documented ceiling).
    - Dynamic discovery: `listOllamaModels` maps `/v1/models` (and/or `/api/tags`) → `ModelConfig`; error redaction.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; new provider package exports + docs page.
    - Docs pages to create/edit:
      - `docs/providers/ollama.md`: create (9-heading API page).
    - `docs/index.md` update: deferred to Task 11.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-25):
    - Implementation (mirrors `provider-kimi`/`moonshot` + Task 9 alibaba layout): `models.ts` (`defineOllamaModel`/`mapOllamaModel`/`listOllamaModels` + `ollamaBaseUrl` presets `cloud` (`https://ollama.com/v1`) / `local` (`http://localhost:11434/v1`) + explicit `baseUrl` override); `provider.ts` (`createOllamaProvider` OpenAI-compatible `POST {base}/chat/completions` with SSE, tools, `stream_options.include_usage`, `reasoning_effort` passthrough, completion-evidence `done`/`error`); `index.ts` (`createOllamaProviderPackage` registers provider + `api_key` auth + host-supplied models, **no discovery during setup**).
    - Dynamic models (no hard-coded catalog): `listOllamaModels()` calls OpenAI-compatible `GET {base}/models` and maps entries → `ModelConfig` (reasoning/vision inferred from id). Native `GET {base}/api/tags` documented as an alternate catalog source but not implemented (OpenAI route gives a uniform shape).
    - Implicit cache only: **no `cache.ts`** (YAGNI) — Ollama reuses its KV/prompt cache automatically with no request knob and no wire marker; Prism never emits `cache_control`. `Usage.cacheReadTokens` is intentionally left `undefined` (not `0`) since Ollama exposes no cached-token count — recorded as a documented ceiling in the provider docstring, README, and docs page.
    - Lazy reuse: because Ollama has no cache markers, `provider.ts` reuses the core `serializeOpenAIChatMessage` directly (no custom serializer), unlike alibaba which needs marker preservation.
    - Security: cloud API key resolved via `resolveCredentialValue`, sent only as `Authorization: Bearer`; local preset omits the auth header when no key is configured; error bodies read through bounded `readBoundedResponseText` (redacts secrets); no local filesystem paths in payloads; provider-owned compat keys (`route`/`reasoning_effort`/`ollama`) stripped before the opaque spread.
    - Docs: created `docs/providers/ollama.md` (9 prism-wiki headings; base-URL table, implicit-cache ceiling, security), registered in `providerPackagePages` (docs.test.ts), and added the `docs/index.md` nav link — the “exactly one navigation link per page” guard forced the link now rather than at Task 11 (same recorded deviation as Task 9; Task 11 still owns `provider-packages.md`/`provider-caching.md` matrix + init templates). README updated to a concise pointer; CHANGELOG 0.0.13 entry describes the real implementation.
    - Tests: `packages/provider-ollama` 12/12 (base-URL presets/override; request shape + Bearer + `stream_options`/tools/`reasoning_effort`; local omits authorization; `reasoning_effort` request-over-model override + compat stripping; streaming text/reasoning/tool-call assembly + usage; `cacheReadTokens` stays undefined; truncated stream fails loudly; HTTP error → redacted `providerError`; capability inference; dynamic discovery + discovery-error redaction; package setup without discovery). Docs 98/98; workspace + examples typecheck clean; full `npm test` exit 0, 0 fail (core 1272/1272).
    - ponytail ceilings recorded: implicit-cache only (add explicit mapping only if Ollama reports cached tokens); native `/api/tags` discovery documented but not implemented; no offline model bootstrap (pure discovery); live network tests remain opt-in.

- [x] 11. Provider integration: navigation, cache matrix, init templates, and full verification
  - Acceptance Criteria:
    - Functional: both providers are navigable from `docs/index.md`, listed in `docs/provider-packages.md`, and present in the `docs/provider-caching.md` per-provider matrix (Alibaba = explicit `cache_control` + implicit; Ollama = implicit only); `templates/init/providers.json` has working `prism init` entries for both; root `README.md` provider enumeration is consistent.
    - Performance: no runtime change (docs/templates/metadata only).
    - Code Quality: provider-family counts/phrases reconciled across README and docs; pinned `docs.test.ts` phrases kept consistent with any count edits.
    - Security: init-template entries reference env keys (`DASHSCOPE_API_KEY`, `OLLAMA_API_KEY`) only — no literal secrets; docs secret-scan stays clean.
  - Approach:
    - Documentation Reviewed:
      - `docs/index.md` (provider navigation group), `docs/provider-packages.md` (family list + cache-matrix link), `docs/provider-caching.md` (per-provider explicit/implicit matrix), `templates/init/providers.json` (kimi/openai entry shape), `README.md` provider lines, `docs/migration.md` (0.0.14 section).
    - Options Considered:
      - Add runnable examples for the new providers: deferred (YAGNI) — init templates + docs pages cover onboarding; add examples only on demand.
    - Chosen Approach:
      - Wire navigation, cache matrix, init templates, README/migration notes; then run full build + test as the Phase 9 pre-release gate before the version bump.
    - Files to Create/Edit:
      - `docs/index.md`: add Alibaba + Ollama provider navigation entries.
      - `docs/provider-packages.md`: list both packages; link cache matrix.
      - `docs/provider-caching.md`: add Alibaba (explicit+implicit) and Ollama (implicit-only) matrix rows.
      - `templates/init/providers.json`: add `alibaba` and `ollama` entries (envKey, imports, provider/model expressions).
      - `README.md`: reconcile provider-family enumeration to include both.
      - `docs/migration.md`: note the two new optional providers in the 0.0.14 section.
    - References:
      - Existing kimi/openai init entries; `docs/provider-caching.md` matrix conventions.
  - Test Cases to Write:
    - Docs guards: both provider pages indexed and matrix-listed; init-template entries parse and reference env keys only.
    - Full verification: `npm run build`, `npm test` (all workspaces green at 43 manifests), `tsc -p examples --noEmit`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; onboarding/navigation surface.
    - Docs pages to create/edit:
      - `docs/index.md`, `docs/provider-packages.md`, `docs/provider-caching.md`, `docs/migration.md`.
    - `docs/index.md` update: yes; add Alibaba Cloud and Ollama Cloud provider entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-25):
    - Navigation: `docs/index.md` provider-group links for both packages (added in Tasks 9/10; the “exactly one navigation link per page” guard enforces them).
    - `docs/provider-packages.md`: both packages added to the opt-in/individually-installable list and to the “First-party cache behavior” bullets (Alibaba = implicit-by-default + opt-in `cache_control` capped at 4; Ollama = implicit-only, `cacheReadTokens` stays `undefined`).
    - `docs/provider-caching.md`: per-provider matrix rows + detailed notes for both; the `phase48` matrix guard list extended to enforce both packages are present.
    - `templates/init/providers.json`: `alibaba` (`DASHSCOPE_API_KEY`, `createAlibabaProvider` + `defineAlibabaModel({ model: "qwen-plus" })`) and `ollama` (`OLLAMA_API_KEY`, `createOllamaProvider` + `defineOllamaModel({ model: "gpt-oss:20b" })`) entries; both flow into `prism init --provider` via the dynamic catalog (no code change needed — `listInitProviders()` reads the file).
    - `README.md`: counts reconciled — first-party “six”→“fourteen provider adapters”, family “all 7”→“all 11 provider adapters”; table rows added for both; the pinned `docs.test.ts` phrase updated to “all 11 provider adapters” and both packages added to the README required-mention list.
    - `docs/migration.md`: fixed the stale 0.0.14 line “41 → 41 manifests, no new packages” → “41 → 43” naming the two optional provider packages; added a Providers row to the 0.0.14 table; corrected the benchmark cross-reference “release Task 8” → “release Task 12”.
    - New docs guard (`cli-init.test.ts`): asserts both init entries parse, carry the right `envKey`/`packageName`, read the token via `process.env.<envKey>`, and contain no literal secrets (`sk-…`/`Bearer …` scans). The existing “supports every provider flag” matrix test now generates alibaba + ollama projects (createAgent + provider dep + env assertions).
    - Full verification (Phase 9 pre-release gate): `npm run build` exit 0; `npm test` exit 0 — core 1273/1273 and all workspaces green at 43 manifests; `tsc -p examples --noEmit` exit 0. Secret scans clean (phase12 boundary + new init guard).
    - ponytail ceilings recorded: historical records left untouched (2026-07-17 “seven first-party provider packages”, Phase 12 workspace list) since they describe point-in-time state; no runnable provider examples added (YAGNI — init templates + docs pages cover onboarding; add on demand).

- [x] 12. Version graph to 0.0.14, benchmark conversation/co-work paths, and run release validation
  - Acceptance Criteria:
    - Functional: all publishable manifests, internal ranges, lockfile, profile/package/install/export guards, and changelogs target `0.0.14` (including the two new provider packages from Tasks 8–10); new surfaces enrolled per the Task 0 freeze as revised by Task 8 (`43` manifests; `prism-all` inclusion rules honored; browser/ag-ui/work-tools stay optional; alibaba/ollama enroll via `prism-providers`); roadmap Phase 9 marked complete only after gates pass.
    - Functional: `npm run sdk:ready` passes; packed offline consumer tests pass; restricted live canaries (M365/GWS OAuth, Playwright, PostgreSQL/keychain) remain operator-gated.
    - Performance: `scripts/benchmark-0.0.14.mjs` reports conversation replay, memory injection/consent, artifact revision/delivery, AG-UI co-work mapping, and connector refresh overhead against frozen budgets; package/install deltas recorded.
    - Code Quality: publishable package count matches the revised Task 0 freeze matrix (`43`, including `@arnilo/prism-provider-alibaba` + `@arnilo/prism-provider-ollama`); no Slack/Teams/voice-vendor/desktop-vendor/Office scope enters the graph.
    - Security: audit, SBOM/license, tracked/tarball secret scans, dependency review inputs, exact dependency graph, tarball review, `git diff --check`, connector/artifact hostile-input fixtures, and permission-non-broadening regression pass.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`, roadmap gates 8/11 + Release Validation Checklist, Plan 076 Task 10 command matrix, Task 0 freeze count.
    - Options Considered:
      - Auto-tag/publish: requires operator OIDC; rejected.
      - Exact graph bump + network-free matrix + dry-run publish only: chosen.
    - Chosen Approach:
      - Bump 0.0.14 graph; run sdk:ready, Node 20 compat, packs, benchmark, supply-chain, release check/publish dry-run.
      - Record evidence in this plan and `roadmap.md`; stop before commit/tag/publication unless separately authorized.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      node scripts/benchmark-0.0.14.mjs
      npm audit --audit-level=high
      git diff --check
      npm run release:check -- --version 0.0.14 --allow-dirty --allow-untagged
      npm run release:publish -- --version 0.0.14 --dry-run --allow-dirty --allow-untagged
      ```
    - Files to Create/Edit:
      - Root and workspace `package.json` versions/ranges (including the two new provider packages); lockfile; profile manifests.
      - `scripts/benchmark-0.0.14.mjs` (+ schema test); `docs/performance.md`, `docs/release-and-install.md`.
      - `roadmap.md` Phase 9 completion evidence; this plan Task 12 evidence.
    - References:
      - Prior 0.0.13 release validation pattern (Plan 076 Task 10).
  - Test Cases to Write:
    - Exact package count/export/install guards for 0.0.14 graph.
    - Benchmark schema + budget assertions (network-free).
    - Secret scan clean on packed tarballs; connector/artifact fakes have no real credentials or local paths.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; release graph and install docs.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`, `docs/performance.md`, `docs/migration.md`, `roadmap.md`.
    - `docs/index.md` update: yes; Release entry to 0.0.14 / Phase 9 evidence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-26):
    - Version graph: all **43** publishable manifests + **84** internal `@arnilo/*` ranges + `package-lock.json` bumped 0.0.13 → 0.0.14 (byte-stable JSON round-trip, no reformat noise); `src/index.ts` `version` export updated. `release:check --version 0.0.14` validates the exact graph (versions/ranges/lockfile/topological order) with all 43 packages (incl. alibaba/ollama) `available`.
    - Changelogs: `## [0.0.14] - 2026-07-26` added to all 43 CHANGELOGs (core detailed Phase 9 entry; Added lines for the 9 packages with new surfaces; alibaba/ollama note first publication; generic graph note elsewhere); the pinned `## [0.0.13] - 2026-07-24` sections preserved.
    - Benchmark: `scripts/benchmark-0.0.14.mjs` (+ `benchmark-0.0.14.test.mjs`) reports five network-free scenarios — conversation-replay (sqlite `:memory:`), memory-consent-recall (hash embedder; invisible entry excluded under strict recall), artifact-delivery-link (HMAC-signed expiring link), cowork-map (AG-UI projection), connector-token-refresh (late-bound OAuth refresh via fake token endpoint) — against frozen Phase 9 budgets; every `resourceLimitSignals` is 0 (no consent leak, no unredacted replay, token always resolves). Schema test passes.
    - Release validation (network-free except release:check registry preflight): `npm run sdk:ready` exit 0 (typecheck + full `npm test` + pack:dry-run); `release:publish --dry-run --version 0.0.14` → 43/43 `dry-run`; `npm audit --audit-level=high` exit 0 (2 moderate transitive vulns, below threshold); SBOM (202 packages / 8 licenses) + license-policy verify exit 0; `git diff --check` clean; public-import smoke (21 export targets) OK; secret scans on tracked files (1092) and packed tarballs (43 unpacked, 1088 files) → 0 findings; artifact size 6.5 MiB ≪ 128 MiB cap.
    - Docs: `docs/release-and-install.md` gained a 0.0.14 publish handoff (Package set (43), GO decision, tag/publish commands, rollback limits) and the 0.0.13 section was restored to its historical 41-package state; live peer references updated to `@arnilo/prism@0.0.14`; `docs/migration.md` + `docs/performance.md` 0.0.14 references corrected; `docs/index.md` release/migration/freeze entries updated to 43 manifests; `roadmap.md` Phase 9 marked `[x]` with completion evidence.
    - Test guards: publish-handoff docs test repointed to the 0.0.14 section (“43 manifests”, v0.0.14 tags); version pins bumped to 0.0.14 across packaging/install-smoke/phase13/phase14/index tests and 10 package-local skeleton tests. Full `npm test` (core 1273 + all workspaces) and `npm run sdk:ready` exit 0.
    - Operator prerequisites not performed (by design): signed commit/tag, actual npm publication (OIDC provenance), and restricted live canaries (M365/GWS OAuth, Playwright, PostgreSQL/keychain) — `release.mjs` refuses real publication on a dirty/untagged tree.
    - ponytail ceilings: Node 20 compat enforced by the CI `node20-compat` job (local runtime is Node 24; approximated via the public-import smoke); benchmark timings are evidence fields only (bounds gate release, not latency).

## Compromises Made
- Provider scaffolds (`provider-alibaba`, `provider-ollama`) were created at 0.0.13 during Task 8 with CHANGELOG entries dated 2026-07-24, then bumped to 0.0.14; their 0.0.13 CHANGELOG section is retained (pinned by the docs test) while the 0.0.14 section notes first publication — a cosmetic historical inconsistency, harmless.
- Benchmark “timings” are evidence fields only; release gating is by bounds/fixtures, not latency (consistent with prior releases).
- Node 20 compat not run locally (Node 24 only); relies on the CI `node20-compat` job.
- The 0.0.13 publish-handoff section temporarily listed 43 packages (Task 8 test accommodation); Task 12 restored it to the historical 41 and moved the canonical 43-package list to the new 0.0.14 handoff section.

## Further Actions
- Operator: run the signed-tag + npm publication workflow (`release:publish --version 0.0.14 --resume`) once protected-branch CI is green and npm/OIDC auth is in place; then run the restricted live canaries (M365/GWS OAuth, Playwright, PostgreSQL/pgvector memory, keychain).
- Follow-up (0.0.15 / Phase 10): provider/memory/RAG ecosystem parity per roadmap; consider consolidating the per-release benchmark scripts into one parameterized runner if the count keeps growing (YAGNI for now).
- Consider a small `version:bump` helper to atomically bump manifests + internal ranges + lockfile (done via a one-off script this release).
