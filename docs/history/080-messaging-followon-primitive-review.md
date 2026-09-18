# Plan 080 Task 1 — Messaging Channel Follow-ons: Primitive, Compatibility, and Threat-Model Review

Plan: [080-Messaging-Channel-Followons-And-0-8-0-Cut.md](../../plans/080-Messaging-Channel-Followons-And-0-8-0-Cut.md) Task 1
Depends on: [079](../../plans/079-Prism-Messaging-Channels-Telegram-Signal.md) Tasks 1–9 (complete 2026-09-16) and [docs/history/079-messaging-primitive-review.md](079-messaging-primitive-review.md)
Baseline reviewed: working tree after 079 (version still `0.7.0`; 0.8.0 cut is Task 10).
Date: 2026-09-16

Executable evidence:

- [`packages/prism-core/src/__tests__/messaging-primitives.test.ts`](../../packages/prism-core/src/__tests__/messaging-primitives.test.ts) — 079 probes plus two 080 gap probes (foreign checkpoint load; live abort dropped by non-stream `resume`).
- [`packages/prism-channels/src/__tests__/runtime.test.ts`](../../packages/prism-channels/src/__tests__/runtime.test.ts) — `threadId` participates in session derivation; `ChannelReply.kind` has no `draft`.

This is a frozen review record (history). Current-contract docs stay in `docs/` from Task 2 onward. **No new public symbols in this task.**

---

## 1. Executive summary

079 already shipped the transport-neutral runtime, durable journal, Telegram adapter, experimental Signal adapter, approvals, and host examples. Every 079 **Further Action** is either a later 080 task or an explicit out-of-scope row. No second agent engine, no new SQL schema, no `pg` peer on `@arnilo/prism-channels`, no Signal groups/media/drafts/bulk.

What already holds (do not rebuild):

| Primitive | Span | Follow-on use |
| --- | --- | --- |
| `ChannelInboundEvent.threadId` | `packages/prism-channels/src/types.ts:67` | Topic identity is already on the event and in `deriveSessionId` / `actorKey`. Groups/topics are adapter+grant policy, not a new key type. |
| `ChannelAuthorization` | `types.ts:91-99` | Deny-by-default host grant. Add optional `notifications?: boolean` (missing = false). |
| `admit` / `deliver` | `runtime.ts:1403-1480`; `MessagingRuntimeOptions.deliver` `types.ts:344` | Unicast to the bound destination. Notify reuses `deliver`; drafts must **not**. |
| Journal namespaces | `state.ts:11-16` | `prism.channels.v1.{binding,operation,cursor,reply,control}`. Media bytes never become values. |
| `TranscriptionProvider` / `SpeechProvider` | `src/contracts-core/transcription.ts:42-47`; `speech.ts:32-36` | Host injects `transcribe`/`synthesize` wrappers. Channels does not depend on `@arnilo/prism-providers`. |
| `createPostgresErpMessaging` | `packages/prism-core/src/enterprise/postgres/erp-messaging.ts:44-69` | Host `BEGIN` + `outbox.append(client, …)` + `COMMIT` then `adapter.send`. Caller-owned `PoolClient`. |
| `resumeAgentRun` vs `resumeAgentRunStream` | `src/agent-run-lifecycle.ts:73-86,111-118` vs `88-105,121-146` | Stream threads `signal`; non-stream pre-checks then drops it. **Task 3.** |
| Checkpoint ownership | memory `src/checkpoints.ts:82-89,151-155`; SQLite `sessions/sqlite/checkpoints.ts:106-112`; Postgres `sessions/postgres/checkpoints.ts:97-103` | Foreign load **throws** `"Checkpoint ownership mismatch"` (existence leak). **Task 3** → miss + generic CAS conflict. |
| Workspace test globs | `packages/prism-core/package.json` `test`; `packages/prism-coding-tools/package.json` `test` | Unquoted `dist/**/__tests__/*.test.js` collapses under the shell. **Task 2.** |

---

## 2. 079 Further Action → 080 task map

| 079 Further Action | 080 task | Notes |
| --- | --- | --- |
| Group/topic ownership | 4 | Telegram `allowGroups` default `false`. Signal stays DM-only. |
| Telegram draft streaming | 5 | Bot API `sendMessageDraft`; not a journaled `ChannelReply.kind`. |
| Bounded image/document | 6 | Refs on the event; `getFile` + download cap; no bytes in the journal. |
| Voice transcription/synthesis | 6 | Host `TranscriptionProvider` / `SpeechProvider`. |
| Opt-in completion notifications | 7 | `runtime.notify` + `ChannelAction` `"notify"` + `notifications: true`. |
| ERP outbox composition | 8 | Example + docs. No new table. No `pg` on channels. |
| OS SIGTERM injection | 9 | Restart worker `stop()` on `SIGTERM`. |
| 72-hour soak runner | 9 | Same script; CI ≤30s; operator 72h. |
| Nested `**` test globs | 2 | Quote or expand; fix newly executed failures. |
| `resume()` dropped `signal` | 3 | Add `AgentRunResumeOptions.signal`; thread like stream. |
| Checkpoint foreign-scope leak | 3 | Load → `null`; save generic conflict. |
| 0.8.0 cut | 10 | Lockstep + handoff; no registry write. |
| OFFSET `listCheckpoints` pagination | **out of 080** | Generic store limit; not a channel follow-on. |
| 079 items later tasks already closed (in-process dedup, durable approvals, `maxRoutes`, SIGKILL reconcile) | **closed** | Do not re-open. |

---

## 3. Frozen additive vocabulary

Implementation tasks may grow **fields**. They must not rename 079 symbols (`admit`, `deliver`, `ChannelInboundEvent`, `ChannelReply`, `ChannelAuthorization`, journal namespace strings, `createTelegramAdapter`, `createSignalAdapter`).

```ts
type ChannelAction = "message" | "command" | "approval" | "notify";

interface ChannelAuthorization {
  // existing: identity, agentAliases, defaultAgentAlias?, grantRevision
  readonly notifications?: boolean; // missing === false
}

interface ChannelAttachmentRef {
  readonly kind: "image" | "document" | "voice";
  readonly transportFileId: string; // Telegram file_id; never model-selected
  readonly mimeType?: string;
  readonly byteLength?: number;
  readonly fileName?: string;
}

interface ChannelInboundEvent {
  // existing fields unchanged
  readonly attachments?: readonly ChannelAttachmentRef[]; // ids only — never bytes
}

interface ChannelLimits {
  // existing fields unchanged
  readonly maxAttachmentBytes?: number; // default 1 MiB, hard 4 MiB
}

interface MessagingRuntime {
  // existing: admit, drain, diagnostics, stop, reconcile, listUnresolved, prune
  notify(input: {
    readonly identity: AgentIdentity;
    readonly connectionId: string;
    readonly externalConversationId: string;
    readonly threadId?: string;
    readonly notifyId: string;
    readonly text: string;
  }): Promise<ChannelAdmission>;
}

interface MessagingRuntimeOptions {
  // existing authorize/resolveAgent/deliver/…
  readonly onAssistantDelta?: (delta: {
    readonly connectionId: string;
    readonly externalConversationId: string;
    readonly threadId?: string;
    readonly text: string;
  }) => void;
}

interface TelegramAdapterOptions {
  readonly allowGroups?: boolean;   // default false
  readonly sendDrafts?: boolean;    // default false; private chats only
  readonly maxAttachmentBytes?: number;
  readonly transcribe?: (audio: Uint8Array, format: string | undefined, signal?: AbortSignal) => Promise<string>;
  readonly synthesize?: (text: string, signal?: AbortSignal) => Promise<{ audio: Uint8Array; format: string }>;
  readonly extractDocumentText?: (bytes: Uint8Array, mimeType: string | undefined, signal?: AbortSignal) => Promise<string>;
}
```

**Explicitly not added:**

- `ChannelReply.kind` `"draft"` — drafts are ephemeral Bot API previews; journal stays `final` \| `notice`.
- Broadcast/fan-out API.
- Signal groups, attachments, drafts, or bulk notify.
- `pg` / ERP types inside `@arnilo/prism-channels`.
- New checkpoint SQL schema.

---

## 4. Platform facts (re-verified 2026-09-16)

Telegram Bot API (`https://core.telegram.org/bots/api`, fetched 2026-09-16):

| Fact | Implication |
| --- | --- |
| `sendMessageDraft`: `chat_id` Integer **Yes** — “Unique identifier for the target **private** chat”; `draft_id` Integer **Yes**, non-zero; `text` Optional 0–4096 (empty → “Thinking…”); `message_thread_id` Optional; ephemeral **30-second** preview; **must** follow with `sendMessage` to persist. | Task 5: private chats only. Groups/Signal: no drafts. Not journaled. Coalesce in-flight drafts. |
| `sendRichMessageDraft` exists | Out of 080 (YAGNI; text drafts only). |
| `getFile`: bots download ≤ **20 MB**; URL `https://api.telegram.org/file/bot<token>/<file_path>` valid ≥ 1 hour. Token is in the path. | Task 6 channel hard cap **4 MiB** (default 1 MiB) — below getFile. Redact token URLs. Bounded reader; fail closed on oversize. |
| `sendVoice`: OGG/OPUS, MP3, or M4A; voice notes. `sendDocument`: general files up to 50 MB upload. Sending by URL: photos 5 MB, other 20 MB; `sendVoice` by URL ≤ 1 MB else sent as files. | Outbound speech uses `sendVoice` to the **bound** chat/thread. Never model-selected `file_id` or URL. |
| `Message.message_thread_id` / forum topics; Bot API 9.3 private-chat topics | Copy into `event.threadId` when present (private and, if `allowGroups`, group/supergroup). Already in `deriveSessionId` (`runtime.ts:359-376`). |
| `parseMessageUpdate` today (`telegram.ts:235-254`) | Private + non-bot `from` + string `text` only. Drops groups, media, `message_thread_id`. Tasks 4–6 widen this filter. |
| Group privacy mode | Bots see commands only unless privacy disabled. Document; do not bypass. |
| Anonymous admins / missing `from.id` / `sender_chat` | No actor id → drop (fail closed). Never use chat title or username as `externalActorId`. |
| Forwards (`forward_date` / `forward_origin`) | `claims` only; host grant must opt in. Default: do not run a model. |

Signal (`signal.ts:225-267` `notificationEvent`): drop when `groupInfo` is set or `attachments` is a non-empty array. DM text only. Terms (079 §8): no bulk/auto-messaging. **Notify is unicast to an existing DM binding**, not a fan-out.

Speech/transcription (`docs/speech.md`; contracts above): `transcribe({ model, audio: Uint8Array, format?, signal? })`; `synthesize({ model, input, signal? })`. OpenAI adapter caps (25 MiB transcribe / 4096 chars speech) sit **above** the channel attachment cap. Host wraps providers; channels never imports them.

ERP (`erp-messaging.ts:44-69`, `docs/enterprise-postgres-state.md`): `outbox.append` requires a caller-owned `PoolClient` in the host transaction. Payload cap 64 KiB. Dispatcher never invokes business callbacks. Channel `deliver` may append **correlation ids** (`operationId`, `connectionId`), not inbound chat text.

---

## 5. Compatibility gates still open

### Gate A — Nested workspace test globs (Task 2)

`packages/prism-core` and `packages/prism-coding-tools` `test` scripts pass unquoted `dist/**/__tests__/*.test.js` through the shell. `**` collapses to one directory, so nested suites (`runtime/server`, `sessions/*`, `governance/*`, coding-tools nested trees) are omitted. `messaging-primitives.test.js` is listed explicitly on prism-core and **must stay**. Quote the glob or reuse `scripts/run-all-tests.mjs` `expandGlob`. Newly executed suites must pass or be named-skipped — not silenced by turning off network-free/secret-scan guards.

### Gate B — `resumeAgentRun` drops live abort (Task 3)

`createAgentRunLifecycle.resume` (`agent-run-lifecycle.ts:73-86`) pre-checks `request.signal` then calls `resumeAgentRun` **without** `signal`. `AgentRunResumeOptions` (`src/contracts-run-state.ts:229-247`) has no `signal` field; only `AgentRunResumeStreamOptions` (`250-252`) does. `resumeAgentRun` (`111-118`) calls `prepareAgentRunResume(..., options)` with no fifth argument, so `executePreparedAgentRunResume` never sees the host abort.

079 probe already covers pre-abort (run stays `suspended`) and stream abort (provider sees `signal`). 080 probe: abort **during** a hanging non-stream resume — provider `request.signal` stays live and the run **succeeds**. Channels still resume via `resumeStream` until Task 3.

### Gate C — Checkpoint foreign-scope existence leak (Task 3)

`recordKey` is `namespace\0key` (`src/checkpoints.ts:123-125`). `loadCheckpoint` after a hit calls `assertOwnership` / `assertOwnershipScope` and throws `CheckpointConflictError("Checkpoint ownership mismatch")` on memory, SQLite, and Postgres. A tenant can distinguish “other tenant has this key” from “missing”.

Channel keys already embed tenant/user (`state.ts:135-157`), so a well-formed foreign lookup **misses** the key. The leak remains for any unscoped or colliding key and for direct store use. Task 3: load mismatch → `null` (same as missing); save mismatch → generic CAS conflict, same wording as a version miss. Do not log the foreign owner.

Callers that caught `"Checkpoint ownership mismatch"` as a signal (e.g. `packages/prism-coding-tools/.../workspace-lifecycle.ts:448-465` maps any throw to `ERR_PRISM_WORKSPACE_OWNERSHIP`) must keep failing closed on save conflict; load miss is already treated as absent.

### Gate D — OFFSET pagination (out of 080)

Checkpoint list cursors are numeric offsets. Concurrent writes make a page walk incomplete. 079 absorbed this (resolve explicit keys; do not trust scan completeness). Not a channel follow-on.

---

## 6. Threat-model resolution (follow-ons)

| Threat | Control | Task |
| --- | --- | --- |
| Group impersonation (display name, username, chat title) | `externalActorId` = numeric `from.id` only; title/username never identity | 4 |
| “Anyone in this group” grant | Deny-by-default; grant is exact `(connectionId, chat, thread?, actor)` | 4 |
| Anonymous admin / missing `from` | Drop the update | 4 |
| Forwarded message as the sender | `claims` only; default no model | 4 |
| Topic bleed (same chat, different `message_thread_id`) | `threadId` in `deriveSessionId` and `actorKey` (`runtime.ts:175-177,359-376`) | 4 (already keyed) |
| Model-selected destination / `file_id` / URL | Destination from the bound event only; fetch only the current event’s ref | 5–7 |
| Draft treated as durable / sent as the final | Drafts out of band; journal `final`\|`notice` only; must `sendMessage` after | 5 |
| Draft leak of secrets | Same `SecretRedactor` as finals; no controls/attachments on drafts | 5 |
| Journal media / disk retention of voice | Refs on the event; bytes live only for the fetch+transcribe/extract call | 6 |
| Oversized getFile (20 MB) | Channel cap 1 MiB / hard 4 MiB; Content-Length + bounded reader | 6 |
| Token in `api.telegram.org/file/bot<token>/…` | Existing URL redaction; credential provider functions, not static strings | 6 |
| Notify as broadcast / Signal bulk | Unicast to an existing binding; `notifications: true` re-checked; no fan-out API | 7 |
| Notify without a binding / revoked identity | Denied | 7 |
| Outbox dumps chat text into ERP | Payload = correlation ids; tenant from identity ownership | 8 |
| Signal terms / GPLv3 | DM-only, experimental, socket client, operator gate unchanged | — |
| Foreign checkpoint existence | Task 3 miss semantics | 3 |

Deny-by-default remains the recommended default for **groups** and **notify**.

---

## 7. Task 9 budget baseline (no runtime cost this task)

Recorded 2026-09-16 from `scripts/budgets.json` (do not bump in Task 1):

| Package | Export ceiling | Notes |
| --- | --- | --- |
| `@arnilo/prism-channels` | **80** | Root + `/telegram` + `/signal` src-export count |
| `@arnilo/prism-core` | **1473** | Unchanged by 079 extraction |
| Root packedBytes / unpackedBytes / fileCount | **1247731** / **4137527** / **489** (5% tolerance) | 079 Task 1 rebaseline |

This history page and two probes are excluded from published tarballs (`dist/**/__tests__` deny; history is docs). Task 9 rebaselines only with a recorded reason if measured exports grow (notify, attachment refs, Telegram options).

---

## 8. Evidence and reproduction

```sh
npm run build --workspace @arnilo/prism-core --workspace @arnilo/prism-channels
node --test "packages/prism-core/dist/__tests__/messaging-primitives.test.js"
node --test "packages/prism-channels/dist/__tests__/runtime.test.js"
```

080 probes (in addition to the seven 079 proofs):

1. `threadId` on two otherwise identical events yields two session ids (`deriveSessionId` already hashes `threadId`).
2. Non-stream `lifecycle.resume` with a live abort during a hanging provider turn does **not** abort the provider; the run succeeds (Task 3 gap).
3. Memory and SQLite `loadCheckpoint` of a foreign-owned existing key throw `/ownership mismatch/` (Task 3 gap).
4. `ChannelReply["kind"]` extracts no `"draft"` variant.

Core changes proposed by later tasks: glob quoting (Task 2); `signal` on `AgentRunResumeOptions` + checkpoint miss (Task 3). Everything else is `@arnilo/prism-channels` fields, Telegram filter widening, examples, and the 0.8.0 cut.
