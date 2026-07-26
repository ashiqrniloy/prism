# Conversations

## What it does

`@arnilo/prism-server` ships a durable, user-scoped conversation service: create/list/get/continue/branch/archive/export/delete conversation threads on top of the existing session and event-ledger seams. A thread **is** an ownership-scoped session branch plus a `prismConversation` marker in `SessionRecord.metadata`; content stays in session entries and the redacted event ledger. Reconnectable replay pages durable redacted events without ever rerunning a provider or tool.

Core (`@arnilo/prism`) exports only conversation **types and pure helpers** (`ConversationThread`, `ConversationError`, `CONVERSATION_METADATA_KEY`, thread-bound replay cursor codec, `conversationThreadFromRecord`, `conversationMarkerMetadata`). The service and optional HTTP handler live in `@arnilo/prism-server`.

## When to use it

Use it when a host needs persistent personal/work-agent conversations with reconnect, branch, archive, export, and deletion semantics without building a second session/event system. Hosts own authentication, agent selection, UI, transport chrome, and blob storage.

Do not use it as a chat UI, a push/always-on daemon, or a file store. Slack/Teams channels, realtime voice, and desktop-control vendors are deferred (0.1.x); device adapters are contract + deny-by-default conformance only in 0.0.14.

## Inputs / request

```ts
import { createConversationService, createConversationHandler } from "@arnilo/prism-server";
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";

const persistence = createSqlitePersistence({ filename }); // implements ConversationServiceStore
const service = createConversationService(persistence, {
  redactor,                    // required: replay/export serve redacted rows only; continue runs with it
  sessionFactory: ({ thread, leafId, ownership, signal }) =>
    agent.createSession({ id: thread.id, ...(leafId ? { leafId } : {}) }), // host binds agent/store/leaf
  runOptions?,                 // narrowable RunOptions minus ownership/identity/signal/redactor/idempotencyKey
  limits?: ConversationLimits, // frozen defaults/caps below
});

await service.create({ ownership, title?, id?, requestId?, metadata? });
await service.list({ ownership, cursor?, limit? });
await service.get({ ownership, threadId });
await service.continue({ ownership, threadId, message, requestId?, leafId? });
await service.branch({ ownership, threadId, leafId });
await service.archive({ ownership, threadId });
await service.export({ ownership, threadId, cursor? });
await service.delete({ ownership, threadId });
await service.replay({ ownership, threadId, cursor?, limit? });

const handler = createConversationHandler({ service, authorize, basePath?: "/prism/conversations", redactor?, limits? });
```

`ConversationServiceStore` is a narrow `Pick` of `ProductionPersistenceStore`: `querySessions`, `queryEvents`, optional `appendSession` (required at factory time; sqlite/postgres implement it), and optional `lifecycle.applyRetention` (required for delete). Stores without `appendSession` fail closed at construction.

## Outputs / response / events

- `create`/`get`/`branch`/`archive` → `ConversationThread` (`id`, `title?`, `state: "active" | "archived"`, `branches`, timestamps, ownership projection, host metadata).
- `list` → ownership-scoped `PersistencePage<ConversationThread>` (newest first), marker-filtered; non-conversation sessions never appear.
- `continue` → `AgentRunResult` from one agent turn on the thread session; history rebuilds from durable entries, so the agent sees prior turns.
- `replay` → `{ records: AgentEventRecord[], nextCursor?, terminal }`; records are durable redacted ledger rows ordered by `(timestamp, id)`; `terminal` marks `agent_finished`/`agent_denied`/`error`.
- `export` → `{ thread, events, nextCursor?, truncated }`; redacted, byte/page-capped, cursor-resumable.
- `delete` → `{ deleted, held }` via persistence lifecycle; legal holds always win.
- HTTP handler routes: `POST {base}` create · `GET {base}` list · `GET {base}/{id}` · `DELETE {base}/{id}` · `POST {base}/{id}/continue|branch|archive|export` · `GET {base}/{id}/events?cursor=&limit=` replay.

## Request/response example

```http
POST /prism/conversations HTTP/1.1
content-type: application/json

{ "title": "Q3 planning" }
```

```json
{ "id": "conv_9b0f…", "title": "Q3 planning", "state": "active", "branches": [], "createdAt": "…", "updatedAt": "…", "tenantId": "t1", "userId": "u1" }
```

Reconnect after a dropped connection: `GET {base}/{id}/events` (optionally with the last `nextCursor`) pages the same durable events; clients dedupe by stable record `id` (at-least-once across the page boundary). No provider or tool call is re-executed by replay/export.

## Implementation example

```ts
const thread = await service.create({ ownership, title: "draft review" });
await service.continue({ ownership, threadId: thread.id, message: "summarize the attached plan", requestId: "ui-req-1" });

// Branch from a known leaf (e.g. last entry id), then fork a continue from it.
const branched = await service.branch({ ownership, threadId: thread.id, leafId });
await service.continue({ ownership, threadId: thread.id, message: "try a shorter version", leafId });

// Reconnectable replay.
let cursor: string | undefined;
do {
  const page = await service.replay({ ownership, threadId: thread.id, ...(cursor ? { cursor } : {}) });
  render(page.records);
  cursor = page.nextCursor;
} while (cursor);

await service.archive({ ownership, threadId: thread.id });
const result = await service.delete({ ownership, threadId: thread.id }); // { deleted: true, held: false }
```

## Extension and configuration notes

Frozen limits (default / hard cap; hosts may tighten, never raise past hard caps):

| Resource | Default / hard cap |
| --- | ---: |
| Thread list page | 50 / 200 |
| Replay/export page rows | 100 / 500 |
| Replay/export cursor | 4 KiB / 16 KiB |
| Thread title | 256 B / 2 KiB |
| Client request id | 256 B / 2 KiB |
| Active branches per thread | 16 / 64 |
| Export payload per request | 8 MiB / 32 MiB |
| Export pages per request | 100 / 500 |
| Handler request body | 64 KiB / 1 MiB |

Behavior notes:

- `create` with an explicit `id` is idempotent get-or-create; generated ids are `conv_<uuid>`.
- `continue` `requestId` flows into session-append idempotency (`RunRecord.idempotencyKey` + append dedup), so exact retries deduplicate.
- `continue` on an archived thread fails closed (`thread_archived`); `leafId` must be a branch ref recorded by `branch()`.
- Replay cursors are thread-bound: a cursor minted for one thread is rejected on another (`cursor_thread_mismatch`).
- Ledger rows from runs that had no redactor are never served by replay/export (fail-closed skip).
- Export truncates at page granularity when the next page would exceed `exportBytes`; a single page larger than `exportBytes` cannot be exported (raise the cap or page via `replay`).
- Branch refs live in thread metadata (read-modify-write); concurrent `branch()` calls can lose a ref, so the cap is approximate and the entry tree remains the content source of truth.
- Deletion purges the whole session ledger (entries, runs, events, tool calls, usage, branches, search rows) through `lifecycle.applyRetention`; legal holds block deletion and report `held: true`.

## Security and performance notes

- Every operation starts from host-verified ownership (and optional `AgentIdentity`, which must project onto ownership without widening); wrong-user access returns not-found, never leaked existence.
- `appendSession` upserts set ownership columns only on create; metadata/`updatedAt` on update — ownership is immutable after create.
- Replay/export serve `redacted: true` ledger rows only and pass through the service redactor; no local paths, raw tool payloads, or secrets are emitted.
- All loops are bounded by the frozen caps above; review/agent turns consume shared `RunLimits` via the host's `runOptions`.
- No new permission surface: conversations reuse session/event/identity/redaction/lifecycle seams (roadmap gate 8).

## Related APIs

- [Web-standard server handler](server.md): authorized agent/workflow routes; the conversation handler mounts beside it.
- [Session stores](session-stores.md): branch/append/checkout semantics a thread builds on.
- [Database persistence](database-persistence.md): `ProductionPersistenceStore`, `appendSession`, `SessionQuery` id/metadataKey filters, retention/legal-hold lifecycle.
- [Agents and sessions](agent-identity.md): verified identity and ownership projection.
- [Credentials and redaction](credentials-and-redaction.md): `SecretRedactor` used by replay/export/continue.
- [Browser automation](browser-automation.md): verified-state checkpoints scope to the runs a thread owns; reload/verify before side effect.
- [Device adapters](device-adapters.md): deny-by-default voice/desktop sessions bind to a thread's run and consume shared `RunLimits`.
