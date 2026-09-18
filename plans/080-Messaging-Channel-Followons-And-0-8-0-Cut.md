# Prism Messaging Channel Follow-ons and 0.8.0 Cut

Status: complete (Tasks 1–9 2026-09-16; Task 10 superseded by [085](085-Honesty-Gates-Runtime-Split-And-0-8-0-Cut.md) Tasks 7–8). Depends on [079](079-Prism-Messaging-Channels-Telegram-Signal.md) Tasks 1–9 (complete 2026-09-16). Closes every item in 079 **Further Actions**: group/topic ownership; Telegram draft streaming; bounded image/document attachments; voice transcription/synthesis; proactive opt-in notifications; optional ERP outbox composition; OS SIGTERM injection; 72-hour soak runner; the still-open Task 1 discoveries (nested test globs, `resume()` dropped `signal`, checkpoint foreign-scope existence leak). The **0.8.0 cut** lives in 085.

Research updated: 2026-09-16.

This plan does **not** re-open 079 items later tasks already closed (in-process dedup, durable approvals, `maxRoutes`, SIGKILL reconcile). OFFSET-paginated `listCheckpoints` stays a generic store limit, not a channel follow-on.

## Objectives

- Let authorized Telegram group/topic traffic use the existing binding key (`connectionId` + conversation + `threadId` + actor) under deny-by-default grants.
- Stream ephemeral Telegram drafts during a run without journaling them as replies; persist only the current operation's terminal `succeeded` text.
- Admit bounded image/document/voice payloads through host-injected modality APIs; never store media bytes in the channel journal.
- Let a host push an opt-in completion/notice to an already-bound destination; destination is never model-selected.
- Show how a PostgreSQL ERP outbox composes with `deliver` without a new SQL schema or a `pg` peer on `@arnilo/prism-channels`.
- Prove SIGTERM cancel and ship a gated soak runner (CI smoke + 72h operator recipe).
- Close the three leftover 079 primitive gaps that still affect channels and shared stores.
- Cut **0.8.0** (lockstep, current-contract docs, protected verification, operator handoff) **after** 081 implementation tasks complete. Publication stays operator-authorized.

## Expected Outcome

A Node host can, still via `@arnilo/prism-channels` plus the `@arnilo/prism` peer:

1. Grant a Telegram group or forum topic per `(chat, topic, sender)` and keep everyone else denied.
2. Show `sendMessageDraft` previews in private chats while a turn runs, then `sendMessage` the final text.
3. Accept a size-capped image/document/voice DM (and granted group message), transcribe voice with `TranscriptionProvider`, optionally speak the final reply with `SpeechProvider`.
4. Call `runtime.notify(...)` for an opt-in bound destination.
5. Optionally append an ERP outbox row in the same host transaction style as `createPostgresErpMessaging`.
6. SIGTERM a hanging worker and observe cancel, not a stuck `executing` row; run a soak script for 30s in CI or 72h as an operator.

Signal stays experimental, DM-only, no groups/media/drafts/bulk notify. After Task 10 (which includes 079 + this plan + 081 in the changelog/migration) the tree is publish-ready at 0.8.0; registry/tag writes still need a human.

## Tasks

- [x] **Task 1 — Primitive, compatibility and threat-model review**
  - Acceptance Criteria:
    - Functional: written evidence (`docs/history/080-messaging-followon-primitive-review.md`) inventories 079 contracts (`ChannelInboundEvent.threadId`, `ChannelAuthorization`, `deliver`/`admit`, journal namespaces), Telegram Bot API 9.3 `sendMessageDraft` + `message_thread_id`, Bot API `getFile`/`sendVoice`/`sendDocument`, Prism `TranscriptionProvider`/`SpeechProvider`, `createPostgresErpMessaging`, `resumeAgentRun` vs `resumeAgentRunStream`, memory/SQLite/PostgreSQL checkpoint ownership, and workspace `test` glob expansion. Each 079 Further Action maps to a later task or an explicit out-of-scope row.
    - Performance: review is docs + existing probes only; no new runtime cost. Record current packed/export ceilings for `@arnilo/prism-channels` and `@arnilo/prism-core` as the Task 9 baseline.
    - Code Quality: no new public symbols in this task. Evidence cites file:line and current Bot API / Prism docs, not training memory.
    - Security: threat rows for group impersonation, anonymous admins, forwarded messages, model-selected destinations, journal media, Signal bulk/terms, draft-vs-final confusion, foreign-scope checkpoint existence. Deny-by-default remains the recommended default for groups and notify.
  - Approach:
    - Documentation Reviewed:
      - [079](079-Prism-Messaging-Channels-Telegram-Signal.md) Further Actions and Compromises; [docs/history/079-messaging-primitive-review.md](../docs/history/079-messaging-primitive-review.md)
      - [docs/messaging-channels.md](../docs/messaging-channels.md), [docs/telegram-channel.md](../docs/telegram-channel.md), [docs/signal-channel.md](../docs/signal-channel.md), [docs/messaging-channel-operations.md](../docs/messaging-channel-operations.md)
      - [docs/speech.md](../docs/speech.md), [docs/enterprise-postgres-state.md](../docs/enterprise-postgres-state.md), [docs/agent-session-runtime.md](../docs/agent-session-runtime.md), [docs/sqlite-persistence.md](../docs/sqlite-persistence.md)
      - Telegram Bot API: https://core.telegram.org/bots/api (`sendMessage`, `sendMessageDraft`, `getFile`, `sendVoice`, `sendDocument`, `message_thread_id`, forum topics). Changelog 9.3 (private-chat topics + drafts). Context7 `/websites/core_telegram_bots_api`
      - `packages/prism-channels/src/types.ts:55–71` (`threadId` already reserved); `telegram.ts:235–254` (private+text only); `src/contracts-run-state.ts:229–252`; `src/checkpoints.ts:82–89`; `packages/prism-core/src/sessions/sqlite/checkpoints.ts:106–112`; `packages/prism-core/src/enterprise/postgres/erp-messaging.ts:44–69`; `src/contracts-core/{speech,transcription}.ts`
    - Options Considered:
      - One mega-task that implements everything after a paragraph of research (no executable evidence; rejected).
      - Same 079 Task 1 shape: evidence doc + probes + freeze the additive vocabulary before code (chosen).
    - Chosen Approach: freeze additive fields (`ChannelAction` `"notify"`, optional inbound attachment refs, `ChannelAuthorization.notifications`, adapter `allowGroups` default false, draft out-of-band from the journal) in the evidence doc. Implementation tasks may not rename 079 symbols.
    - API Notes and Examples:
      ```ts
      // Frozen 079 event already carries topic identity; groups only need adapter+grant policy.
      event.threadId; // Telegram message_thread_id
      event.claims;   // untrusted chatType / isForum / isForward — never authority
      ```
    - Files to Create/Edit:
      - `docs/history/080-messaging-followon-primitive-review.md`: evidence (written 2026-09-16)
      - `packages/prism-core/src/__tests__/messaging-primitives.test.ts`: foreign `loadCheckpoint` throw + live non-stream resume abort gap
      - `packages/prism-channels/src/__tests__/runtime.test.ts`: `threadId` session derivation + no `draft` kind
      - `docs/history/README.md`: index the 079/080 review pages
      - this plan (task checkbox)
    - References: 079 Task 1 gate resolutions; Bot API 9.3 `sendMessageDraft` is private-chat + 30s ephemeral + requires a later `sendMessage`.
  - Test Cases to Write:
    - Probe: `threadId` participates in the default session-id derivation (already true — assert it).
    - Probe: `resumeAgentRun(...)` still drops abort (documents the Task 3 fix).
    - Probe: memory/SQLite load of a foreign-owned key throws `Checkpoint ownership mismatch` (documents the Task 3 fix).
    - Probe: Telegram `sendMessageDraft` is not a journaled `ChannelReply.kind`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — review only.
    - Docs pages to create/edit: `docs/history/080-messaging-followon-primitive-review.md` only.
    - `docs/index.md` update: no
    - Documentation structure reference: not applicable (history page).

- [x] **Task 2 — Nested workspace test globs**
  - Acceptance Criteria:
    - Functional: `npm test -w @arnilo/prism-core` and `npm test -w @arnilo/prism-coding-tools` execute nested `__tests__` trees (today unquoted `dist/**/__tests__/*.test.js` collapses to one directory). Every previously skipped suite either passes or is quarantined with a named skip and a bug. `messaging-primitives.test.js` stays in the core script.
    - Performance: workspace test time may rise because nested suites actually run; no new sleeps. Record duration in the task outcome.
    - Code Quality: one quoting/expansion rule reused; no per-package file lists that rot. Root `scripts/run-all-tests.mjs` `expandGlob` stays the model if quoting is not enough on this npm.
    - Security: newly executed suites must not disable network-free or secret-scan guards to go green.
  - Approach:
    - Documentation Reviewed: 079 Further Actions “Nested prism-core suites”; `packages/prism-core/package.json` `test` script; `scripts/run-all-tests.mjs` `expandGlob`.
    - Options Considered:
      - Hand-maintained file lists (rots; rejected).
      - Quote the glob so npm does not expand `**` (`node --test "dist/**/__tests__/*.test.js"`) (chosen if Node 22 `--test` accepts it).
      - Reuse `expandGlob` in `with-build-lock.mjs` (fallback).
    - Chosen Approach: quote first; if the shell/npm still expands, pass the glob through the existing lock wrapper's expander. Fix or skip real failures the glob uncovers — that is the point of the 079 note.
    - API Notes and Examples:
      ```json
      "test": "node ../../scripts/with-build-lock.mjs node --test \"dist/**/__tests__/*.test.js\""
      ```
    - Files to Create/Edit:
      - `packages/prism-core/package.json`, `packages/prism-coding-tools/package.json` (and any other workspace script with unquoted `**`)
      - failing nested tests only as required to go green
      - `src/__tests__/packaging.test.ts` only if a script-integrity assertion already exists and needs the new shape
    - References: Node 22 `node --test` glob; npm script quoting.
  - Test Cases to Write:
    - A nested file such as `packages/prism-core/src/runtime/server/__tests__/conversations.test.ts` is in the `npm test -w @arnilo/prism-core` TAP output.
    - Positive control: a temporary nested `*.test.js` is picked up (or a static assertion over the resolved file list).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — test topology.
    - Docs pages to create/edit: none
    - `docs/index.md` update: no
    - Documentation structure reference: not applicable
  - Task 2 Outcome (2026-09-16): all acceptance criteria met. Quoted the glob in both affected scripts (`node --test "dist/**/__tests__/*.test.js"`) — npm's `sh` now passes it through and Node 24 resolves it. `npm test -w @arnilo/prism-core`: 1 file / 10 tests before → **83 files / 687 tests** (678 pass, 9 skipped, 0 fail, 4.6 s); `npm test -w @arnilo/prism-coding-tools`: 709 → **714 tests** (+`dist/__tests__/coding-tools-conformance.test.js`, 0 fail, 5.1 s). Every newly executed suite already passed; the 9 prism-core skips are the pre-existing env-gated PostgreSQL/NATS suites (`PRISM_TEST_POSTGRES_URL` unset) and the coding-tools skip is the protected Docker matrix — named skips, no quarantine, no guard weakened. `messaging-primitives.test.js` stays explicitly listed and Node dedupes it (687 either way, no double run). Root `scripts/run-all-tests.test.mjs` gained a durable regression gate: every workspace `test` script containing `**` must quote it, its reported glob must match files, and quoting must be load-bearing (globstar match count > shell-collapsed `*` match count) — that gate fails if either script is unquoted again. Full workspace-suites stage passes (46.3 s wall). No per-package file lists added.

- [x] **Task 3 — Resume abort signal and checkpoint foreign-scope miss**
  - Acceptance Criteria:
    - Functional: `AgentRunResumeOptions.signal` exists and `resumeAgentRun` threads it through `prepareAgentRunResume` / execute the same way `resumeAgentRunStream` already does. `loadCheckpoint` on memory, SQLite and PostgreSQL returns `null` for an existing key with a non-matching ownership scope (no `Checkpoint ownership mismatch` throw). `saveCheckpoint` against a foreign-owned key fails closed with a generic conflict, not an ownership-existence leak.
    - Performance: one extra ownership compare on load/save; no extra round-trip.
    - Code Quality: one shared helper if sqlite/postgres already share `assertOwnershipScope`; do not fork store semantics. Existing tests that expect the throw are updated to expect miss/conflict.
    - Security: a tenant cannot distinguish “other tenant has this key” from “missing” via load. Channel keys that already embed tenant/user keep working. Do not log the foreign owner.
  - Approach:
    - Documentation Reviewed: `src/contracts-run-state.ts:229–252`; `src/agent-run-lifecycle.ts:111–118,174–363`; `src/checkpoints.ts:82–89`; `packages/prism-core/src/sessions/sqlite/checkpoints.ts:106–112`; `packages/prism-core/src/sessions/postgres/checkpoints.ts:97–103`; `docs/agent-session-runtime.md`; `docs/sqlite-persistence.md`
    - Options Considered:
      - Leave `resumeAgentRun` abort-deaf (079 already documented the hole; channels work around it with `resumeStream`) — rejected because Further Actions asked to close it.
      - Throw a distinct `not_found` error for foreign keys (still distinguishable; rejected).
      - Load returns `null`; save generic CAS conflict (chosen).
    - Chosen Approach: add optional `signal` to the base resume options (stream options already declare it; keep the field, do not duplicate). On load, treat ownership mismatch as miss. On save, if a record exists and ownership differs, throw `CheckpointConflictError` with the same wording as a CAS miss.
    - API Notes and Examples:
      ```ts
      await resumeAgentRun(agent, ref, { expectedVersion, decision: "deny" }, {
        checkpoints, definitionRevision, ownership, signal: abort.signal,
      });
      await checkpoints.loadCheckpoint({ namespace, key, tenantId: "other" }); // null, not throw
      ```
    - Files to Create/Edit:
      - `src/contracts-run-state.ts`, `src/agent-run-lifecycle.ts`, `src/checkpoints.ts`
      - `packages/prism-core/src/sessions/codecs/ownership.ts` (added the boolean `ownershipScopeMatches`; `assertOwnershipScope` now delegates — one shared comparison, lease/lifecycle stores unchanged)
      - `packages/prism-core/src/sessions/sqlite/checkpoints.ts`, `packages/prism-core/src/sessions/postgres/checkpoints.ts`
      - matching `__tests__` (core messaging primitives + store tests)
      - callers whose tests encoded the throw: `src/testing/state-concurrency-conformance.ts`, `src/__tests__/checkpoint-event-primitives.test.ts`, `scripts/phase27-ha.test.mjs`, `packages/prism-core/src/runtime/workflows/__tests__/{active-runs,run,checkpoint-conformance,schedule-capabilities,schedules}`, `packages/prism-core/src/sessions/sqlite/__tests__/sqlite-persistence.test.ts`, `packages/prism-channels/src/__tests__/state.test.ts`, `packages/prism-coding-tools/src/agent/__tests__/{workspace-lifecycle,read-path-set-persistence}.test.ts`
      - `docs/agent-session-runtime.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`, `docs/operations.md` (current-contract miss semantics)
      - `scripts/budgets.json` + `scripts/compat-baseline/arnilo__prism-core.txt` (+1 export) and the regenerated `docs/_evidence/phase54-package-map.md`
    - References: 079 Task 1 discoveries 2 and 3.
  - Test Cases to Write:
    - Aborting `resumeAgentRun` mid-provider-turn rejects/aborts without dispatching remaining tools (same fixture style as stream cancel).
    - Memory + SQLite (+ Postgres when `PRISM_TEST_POSTGRES_URL` is set): foreign load → `null`; foreign save → conflict; matching owner still loads.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — resume options and checkpoint load/save.
    - Docs pages to create/edit: `docs/agent-session-runtime.md`, `docs/sqlite-persistence.md`, `docs/postgres-persistence.md`
    - `docs/index.md` update: no — existing pages, no new surface name
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Task 3 Outcome (2026-09-16): all acceptance criteria met.
    - Resume signal: `AgentRunResumeOptions.signal` added (base type; `AgentRunResumeStreamOptions` now inherits it instead of redeclaring). `resumeAgentRun` pre-checks it, passes it to `prepareAgentRunResume`, and threads it into `executePreparedAgentRunResume` → `session.resumeDurable`, so a mid-turn abort reaches the provider and persists an `aborted` run exactly like `resumeAgentRunStream`; `createAgentRunLifecycle().resume` now forwards `request.signal`. Evidence: `messaging-primitives.test.ts` “cancels resumed work through the resume stream and the non-stream resume signal” (stream + non-stream legs both observe the abort; `AgentRunError.result.status === "aborted"`; partial delta is not promoted to text; the already-approved dispatch is not rolled back, matching cancellation-is-a-request) and the pre-aborted leg still leaves the run `suspended` with zero tool calls.
    - Checkpoint scope miss: load and delete on memory/SQLite/Postgres now treat a non-matching ownership scope as absent (`null` / `false`) and a foreign-owned save fails with the generic `Checkpoint compare-and-swap failed (expected X, current Y)` `ERR_PRISM_CHECKPOINT_CONFLICT` — no ownership-shaped existence oracle, no foreign owner in the message, and the owner's record is untouched. Implemented with one shared `ownershipScopeMatches` predicate in `sessions/codecs/ownership.ts`; `assertOwnershipScope` (still used by lease/lifecycle stores, which keep failing closed with their own errors) delegates to it, so the trust-boundary comparison has a single audited copy. SQL stores add one in-memory compare on the already-loaded row: no extra query/round-trip.
    - Callers updated to the miss contract (all still fail closed on mutation): workflow conformance helper + `run`/`active-runs`/`schedule-capabilities`/`schedules` tests (foreign cancel/read is a non-enumerating “not owned/active”, absent, or `null`; foreign saves still reject), SQLite persistence test, channel state test (raw foreign key now misses), coding-tools workspace-lifecycle (foreign `get` → `null`, `cleanup` → `ERR_PRISM_WORKSPACE_UNKNOWN`, foreign `create` → `ERR_PRISM_WORKSPACE_OWNERSHIP`, owner record intact) and read-path-set persistence (foreign restore restores nothing).
    - Test evidence: `npm test` all 5 stages pass; root suites 1843/1843; `@arnilo/prism-core` 686 tests (677 pass, 9 env-gated PostgreSQL/NATS skips); `@arnilo/prism-coding-tools` 714 (1 protected Docker skip); `@arnilo/prism-channels` 61. `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test:coverage` (per-package coverage gates + skip manifest) and `node --test scripts/budget-gate.test.mjs` pass. PostgreSQL was not available here (`PRISM_TEST_POSTGRES_URL` unset): the shared `state-concurrency-conformance` probe now asserts miss + foreign-save conflict and runs in the gated `test:postgres` leg.
    - Budgets/contracts: `@arnilo/prism-core` export ceiling rebaselined 1473 → 1474 (+1 `ownershipScopeMatches`, reason recorded in `scripts/budgets.json`); `scripts/compat-baseline/arnilo__prism-core.txt` regenerated (+1 line); `docs/_evidence/phase54-package-map.md` regenerated. Noted drift: `@arnilo/prism-acp-agent` dist has one unrebaselined addition (`resolveProviderAdapter`) that predates this task and remains for the 0.8.0 cut (Task 10). No new table, dependency, listener, or store semantics fork.

- [x] **Task 4 — Group and topic ownership (Telegram)**
  - Acceptance Criteria:
    - Functional: Telegram adapter still defaults to private DMs. With `allowGroups: true`, `group`/`supergroup` text (and forum `message_thread_id`) become `ChannelInboundEvent`s whose `externalConversationId` is chat id, `externalActorId` is `from.id`, `threadId` is the topic id when present. Host `authorize` remains deny-by-default; a grant for chat A sender X does not admit sender Y or chat B. Bots, service messages, anonymous-admin `from` without a user id, and forwards flagged in `claims` do not run a model unless the host grant explicitly allows that claim. Signal continues to drop groups.
    - Performance: parsing stays O(updates); no extra Bot API calls. Binding cardinality still bounded by `maxRoutes`.
    - Code Quality: reuse `threadId` on the frozen event; do not add a parallel topic type. Group policy lives in the adapter filter + host `authorize`, not a new runtime.
    - Security: chat title, username, and display name are never actor ids. Model cannot select a chat/thread. Group grants are exact `(connectionId, chat, thread?, actor)` as observed. Privacy-mode “only commands” Telegram behavior is documented, not bypassed.
  - Approach:
    - Documentation Reviewed: Bot API `Message.chat`, `message_thread_id`, `ForumTopic`; `telegram.ts:235–254`; `types.ts:55–71`; `docs/telegram-channel.md`; Signal terms (keep DM-only).
    - Options Considered:
      - Implicit “anyone in this group” grant (impersonation; rejected).
      - Per-sender grants in groups, topics as `threadId` (chosen; already in the binding key).
    - Chosen Approach: `TelegramAdapterOptions.allowGroups` default `false`. When true, `parseMessageUpdate` accepts `group`/`supergroup` with a real `from.id`, copies `message_thread_id` to `threadId`, and puts `chatType`/`isForum`/`forwardDate` in `claims` only. Runtime unchanged aside from tests.
    - API Notes and Examples:
      ```ts
      const adapter = createTelegramAdapter({
        connectionId: "tg", botToken, checkpoints, leases, cursorOwnership,
        allowGroups: true, // still deny-by-default at authorize()
      });
      authorize: ({ externalConversationId, externalActorId, threadId }) =>
        grants.get(externalConversationId, threadId, externalActorId) ?? false
      ```
    - Files to Create/Edit:
      - `packages/prism-channels/src/telegram.ts`, `packages/prism-channels/src/types.ts` (options only)
      - `packages/prism-channels/src/__tests__/telegram.test.ts`, `runtime.test.ts`
      - `docs/telegram-channel.md`, `docs/messaging-channels.md`, `docs/signal-channel.md` (Signal still DM-only)
      - `examples/telegram-agent.ts` comment or flag
    - References: Bot API forum topics; 079 “groups/topics are follow-on”.
  - Test Cases to Write:
    - Default adapter drops a group text update (204/skip).
    - `allowGroups: true` + matching grant admits and binds `threadId`.
    - Same chat, different sender → denied.
    - Same chat, different topic → different session id.
    - Signal group envelope still dropped.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — Telegram option and admitted chat types.
    - Docs pages to create/edit: `docs/telegram-channel.md`, `docs/messaging-channels.md`, `docs/signal-channel.md`
    - `docs/index.md` update: yes — one-sentence Telegram blurb mentions optional granted groups/topics
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Task 4 Outcome (2026-09-16): all acceptance criteria met.
    - Adapter: `TelegramAdapterOptions.allowGroups` and `TelegramWebhookHandlerOptions.allowGroups` (both default `false`, parsed identically in polling and webhook modes) opt `group`/`supergroup` text in. `externalConversationId` is the chat id, `externalActorId` is `from.id`, `message_thread_id` becomes `threadId` for messages and for approval callbacks, and replies carry the bound `threadId` back as `message_thread_id` (the runtime fixes it from the binding, never from model output). Bot/`sender_chat`/non-text/service/media updates are still dropped before admission; forwards are admitted but flagged `claims.forwarded`.
    - Discovery fixed during the task: `chat.id` for groups/supergroups is a **negative** int64, while the existing `asId` helper required `value >= 0`, so every group update silently parsed as unsupported. `asChatId` now accepts signed safe integers for chat ids only (actor/user ids keep the non-negative rule); the new test uses a real `-100…` chat id and fails without the fix.
    - Host authority unchanged: `authorize` receives `(connectionId, chat, threadId?, actorId, claims)` and still deny-by-default; a grant for `(chat A, topic 77, user X)` rejects user Y, chat B, the topic-less group root, unlisted topics, and forwarded claims. Model output cannot choose a chat or thread. No runtime change was needed — `threadId` was already in the session/binding/reply keys, so topics are isolated sessions by construction.
    - Signal: unchanged and still DM-only (group envelopes dropped); the existing `filters groups, attachments, …` test covers the requirement.
    - Docs: `docs/telegram-channel.md` (opt-in flag, parsed keys/claims, exact-tuple grants, reply threading, `allowGroups` parity in the limits table, privacy-mode note, `sender_chat`/forward rules), `docs/messaging-channels.md`, `docs/signal-channel.md`, `docs/index.md`, `packages/prism-channels/README.md` + `CHANGELOG.md`, `examples/telegram-agent.ts` composition comment, and the generated inventory/evidence (`scripts/package-truth.mjs` note, `scripts/phase54-package-map.mjs` `/telegram` boundary, `docs/_evidence/phase54-package-map.md`).
    - Tests: `@arnilo/prism-channels` 63/63 (new: default drop vs `allowGroups` topic end-to-end incl. callback threading and outbound `message_thread_id`; runtime exact-tuple/deny test). No new exports, so budgets and compat baselines are unchanged.

- [x] **Task 5 — Telegram draft streaming**
  - Acceptance Criteria:
    - Functional: while a private-chat turn is running, the Telegram adapter may call Bot API `sendMessageDraft` (`draft_id` non-zero, `text` ≤ 4096, optional `message_thread_id`). Drafts are not `ChannelReply` records and never go through `deliver`/the reply journal. Cancel/`stop` stops further drafts. The terminal `sendMessage` is still the only persisted chat message. Groups/Signal: no drafts (API is private-chat; Signal has no equivalent).
    - Performance: draft sends are coalesced (one in-flight; last partial wins) so a token stream cannot flood Bot API. Default off.
    - Code Quality: new adapter method or option, not a new `ChannelReply.kind`. Runtime exposes an optional `onAssistantDelta` host callback; Telegram maps it to drafts; other adapters no-op.
    - Security: draft text is redacted with the same `SecretRedactor` as finals. Drafts cannot carry controls or attachments. Chat/thread come from the bound event, never from model output.
  - Approach:
    - Documentation Reviewed: Bot API `sendMessageDraft` (ephemeral ~30s preview; must follow with `sendMessage`); changelog 9.3; `runtime.ts` `sendReply` journal rules; `docs/telegram-channel.md`
    - Options Considered:
      - Journal `kind: "draft"` (lies about durability; rejected).
      - Host callback out of band + Telegram `sendMessageDraft` (chosen).
    - Chosen Approach: `MessagingRuntimeOptions.onAssistantDelta?: (delta) => void`. Telegram adapter option `sendDrafts?: boolean` (default false) implements the callback via `sendMessageDraft`. Failures are ignored (preview only).
    - API Notes and Examples:
      ```ts
      // Bot API
      sendMessageDraft({ chat_id, draft_id, text, message_thread_id? })
      // then later
      sendMessage({ chat_id, text: final, message_thread_id? })
      ```
    - Files to Create/Edit:
      - `packages/prism-channels/src/runtime.ts`, `telegram.ts`, `types.ts`
      - `packages/prism-channels/src/__tests__/telegram.test.ts`, `runtime.test.ts`
      - `docs/telegram-channel.md`, `docs/messaging-channels.md`
    - References: Context7 `/websites/core_telegram_bots_api` `sendMessageDraft`.
  - Test Cases to Write:
    - Fake Bot API records `sendMessageDraft` then `sendMessage`; journal has one `final` reply, zero draft rows.
    - Abort mid-run: no further drafts; no final if the run did not succeed.
    - `sendDrafts` unset: zero draft calls.
    - Group event: no draft calls even if `sendDrafts` is true.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — optional delta callback and Telegram draft option.
    - Docs pages to create/edit: `docs/telegram-channel.md`, `docs/messaging-channels.md`
    - `docs/index.md` update: no — same pages, not a new product
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Task 5 Outcome (2026-09-16): all acceptance criteria met.
    - Runtime: `MessagingRuntimeOptions.onAssistantDelta?: (delta: ChannelAssistantDelta) => void` (new `ChannelAssistantDelta` type: `connectionId`, `externalConversationId`, optional `threadId`, cumulative redacted `text`). The default path is still `session.run`; when the callback is present the turn runs through the same `session.run` behind a bounded `session.subscribe()` (`runWithPreview`), so previews can only be dropped — the returned `AgentRunResult` always comes from the run. The accumulator resets on each `message_started` and forwards only `message_delta` text content, redacted with the runtime's reply `redactor`, and it stops forwarding once the controller is aborted or the turn is cancelled. The approved-resume path (`resumeStream`) uses the same accumulator, so a suspended-then-approved answer previews too; a throwing host callback is swallowed (preview-only) and `signal.throwIfAborted` still governs the underlying execution.
    - Telegram: `TelegramAdapterOptions.sendDrafts` (default `false`) plus `TelegramAdapter.sendDraft(delta)`; the adapter posts Bot API `sendMessageDraft` with `draft_id` fixed at 1 (one preview slot per chat — a new id would create a second draft), the bound `chat_id`/`message_thread_id`, and the newest ≤3,500 UTF-16 code units (surrogate-pair safe tail). Requests are coalesced by a single-flight loop that always re-checks the latest pending text (one in flight, last partial wins), failures are swallowed, a foreign `connectionId` is rejected, group/supergroup chats (negative chat ids) are never previewed, and `stop()` ends previews. No draft ever becomes a `ChannelReply`; `ChannelReply.kind` stays `final | notice`.
    - Docs: `docs/telegram-channel.md` (opt-in flag, wiring line, `### Streaming previews (drafts)` semantics, limits-table row, security notes), `docs/messaging-channels.md` (preview seam contract), package README/CHANGELOG. Exports: +1 (`ChannelAssistantDelta`); `TelegramAdapter` widened to an interface with `sendDraft` (type-only for the count) → measured 81, `scripts/budgets.json` rebaselined 80 → 81 with a reason, compat baseline `scripts/compat-baseline/arnilo__prism-channels.txt` regenerated (72 → 73).
    - Tests: `@arnilo/prism-channels` 69/69. New: runtime cumulative/redacted preview with exactly one journaled `final` row and nothing journaled for previews; `/cancel` stops previews and delivers no final; resumed approval previews its answer; adapter coalescing (4 deltas → 2 requests, both `draft_id` 1), no preview for groups (with `allowGroups` on and the final reply still threaded), zero drafts when the option is off, tail-cap + `threadId` passthrough + foreign-connection/after-`stop()` drops.

- [x] **Task 6 — Bounded attachments and voice**
  - Acceptance Criteria:
    - Functional: Telegram inbound `photo` / `document` / `voice` (private always; groups only if Task 4 allowed) parse to attachment *refs* on the event (file id, mime, size, kind) — never bytes. After a grant, the adapter fetches via `getFile` + file download, capped by `maxAttachmentBytes` (default 1 MiB, hard 4 MiB). Voice → host `transcribe` (`TranscriptionProvider.transcribe`) → ordinary text turn. Images become model input only when the resolved agent model declares image input; otherwise bounded unsupported notice. Documents: no silent dump; unsupported unless the host supplies `extractDocumentText`. Outbound: optional host `synthesize` → `sendVoice` in addition to text, same bound destination. Signal still drops attachments. Journal stores text only.
    - Performance: one getFile + one download per admitted media event; oversize fails closed before download completes (Content-Length / bounded reader). Do not raise `maxJournalRecordBytes` for media.
    - Code Quality: inject `transcribe`/`synthesize`/`extractDocumentText` as host functions (they wrap plan 061 providers). `@arnilo/prism-channels` does not depend on `@arnilo/prism-providers`.
    - Security: only the current event's file id is fetched; model output cannot name a file_id or URL. Tokens stay in `CredentialValueSource`. Downloaded bytes never logged. Voice/docs are not retained on disk.
  - Approach:
    - Documentation Reviewed: Bot API `getFile`, `sendVoice`, `sendDocument`, `sendPhoto` (getFile ≤ 20 MB); [docs/speech.md](../docs/speech.md); `src/contracts-core/transcription.ts`, `speech.ts`; `docs/multimodal-content.md`
    - Options Considered:
      - Put bytes on `ChannelInboundEvent` (DoS/journal leak; rejected).
      - New package for media (YAGNI; rejected).
      - Refs on the event + host-injected modality functions in the Telegram adapter (chosen).
    - Chosen Approach: additive optional `attachments?: readonly ChannelAttachmentRef[]` on the inbound event (ids only). Telegram adapter options: `maxAttachmentBytes`, `transcribe?`, `synthesize?`, `extractDocumentText?`. Runtime still runs a text turn; the adapter fills `text` from caption/transcript/extract before `admit` when it can, otherwise `admit` sees empty text and the runtime returns `unsupported`.
    - API Notes and Examples:
      ```ts
      import { createOpenAITranscriptionProvider, createOpenAISpeechProvider } from "@arnilo/prism-providers/openai";
      const transcription = createOpenAITranscriptionProvider({ apiKey });
      createTelegramAdapter({
        transcribe: (audio, format, signal) => transcription.transcribe({ model: "whisper-1", audio, format, signal }).then((r) => r.text),
      });
      ```
    - Files to Create/Edit:
      - `packages/prism-channels/src/types.ts`, `telegram.ts`, `limits.ts`
      - `packages/prism-channels/src/__tests__/telegram.test.ts`
      - `docs/telegram-channel.md`, `docs/messaging-channels.md`, `docs/speech.md` (related: channels may call these providers)
      - `docs/options-index.md` if new `*Options`/`*Limits` fields need a named type
    - References: plan 061 modality contracts; OpenAI 25 MiB transcribe cap is *above* the channel hard cap.
  - Test Cases to Write:
    - Injected fetch: photo under cap admitted; over cap denied `oversized`; getFile not called with a model-supplied id.
    - Voice + fake transcribe → `admit` text is the transcript; journal has no audio.
    - Document without `extractDocumentText` → unsupported, no model call.
    - Signal attachment still dropped.
    - `synthesize` on send: fake Bot API sees `sendVoice` then/with `sendMessage`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — attachment refs, limits, adapter hooks.
    - Docs pages to create/edit: `docs/telegram-channel.md`, `docs/messaging-channels.md`, `docs/speech.md`, `docs/options-index.md` if new option types
    - `docs/index.md` update: yes — messaging/Telegram sentences mention bounded media/voice
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Task 6 Outcome (2026-09-16): all acceptance criteria met; one documented deviation from the Task 1 review vocabulary.
    - Contracts: `ChannelAttachmentRef` / `ChannelAttachmentKind` (`image` | `document` | `voice`, transport file id, optional mime/size/name), `ChannelAttachmentBytes`, `ChannelInboundEvent.attachments?` (ids only — no bytes, no URLs) and `ChannelLimits.maxAttachmentBytes` (default 1 MiB, hard 4 MiB). Runtime: `MessagingRuntimeOptions.fetchAttachment?` (host media seam, normally `TelegramAdapter.fetchAttachment`), `ChannelUnsupportedReason` gains `unsupported_media`, and `ChannelAdapter`/`ChannelReply` are unchanged. **Deviation:** the frozen vocabulary listed only the adapter hooks, but an image can only reach the model from code that has both the bytes and the resolved agent — so the runtime gained the one optional `fetchAttachment` seam (and the Telegram adapter the method that implements it). No new `ChannelReply.kind`, no bytes on the event, no second authorizer.
    - Telegram ingress: `photo` collapses to its largest size, `voice` and `document` keep mime/size/file name, caps at 8 refs per event; `text` or `caption` is accepted, and an event with neither text nor media is still dropped. A shared `createInboundMedia` pipeline serves both the poller and the mounted webhook: voice → host `transcribe(bytes, format, signal)` and document → host `extractDocumentText(bytes, mimeType, signal)` before `admit`, with the caption in front of the produced text. `fetchAttachment` is `getFile` + one bounded download (`Content-Length` check, bounded streamed reader, redirects forbidden, token never logged, `file_path` allowlist, `code: credential/network/api` failures all yield no bytes).
    - Runtime: attachments are validated (count, ids, metadata, safe-integer sizes) and malformed refs are denied `malformed`; declared sizes above the cap are denied `oversized` before any fetch or record claim. Voice/document text runs as an ordinary text turn. An `image` becomes one model content block only when `agent.config.model.capabilities.input` declares `image` **and** `fetchAttachment` is wired; every other combination (no declared image input, no seam, failed/oversize fetch, unknown modality with empty text) settles `failed` with `errorCode: unsupported_media` and one bounded notice — never a silent text-only run and never a model call. Journal stays text-only: bytes exist only for the fetch call.
    - Outbound: `TelegramAdapterOptions.synthesize(text, signal)` adds a Bot API `sendVoice` (multipart, bound chat/thread, OGG/OPUS/MP3/M4A allowlist) next to a `final` text reply and never instead of it; synthesis or upload failures are swallowed so a delivered text reply is never reported as failed, and notices stay text-only.
    - Docs: `docs/telegram-channel.md` (`### Attachments and voice`, Options paragraph, intake, limits rows, security notes), `docs/messaging-channels.md` (attachment refs + `fetchAttachment` contract, `unsupported_media`, `maxAttachmentBytes` row, media boundary bullet), `docs/speech.md` (channels wrap these providers), `docs/messaging-channel-operations.md` (step 5 outcome), `docs/index.md`, package README/CHANGELOG, `examples/telegram-agent.ts` (auto-wires `fetchAttachment`) and `examples/README.md`.
    - Exports/budgets: +3 (`ChannelAttachmentKind`, `ChannelAttachmentRef`, `ChannelAttachmentBytes`) → measured 84, `scripts/budgets.json` rebaselined 81 → 84 with a reason; compat baseline regenerated (73 → 76) and `docs/_evidence/phase54-package-map.md` refreshed.
    - Tests: `@arnilo/prism-channels` 83/83 (was 69), coverage 90.01% lines (gate 86.13%). New adapter cases: photo→largest-size ref with caption, voice transcription before `admit` with **no** audio in the operation/reply journal, oversize declared size failing closed before the body download, document inert without an extractor vs extracted with it, webhook voice path, `fetchAttachment` ref validation + post-`stop()` no-op, synthesized `sendVoice` next to `sendMessage` (and voice-error / `wav` / notice skips). New runtime cases: image passed to an image-declaring model as one content block fetched only from the event ref (a model-printed file id changes nothing), bounded `unsupported_media` notice with zero fetches/calls for a non-vision model and for a failed fetch, `oversized` denial before any fetch, transcribed text running as a plain text turn, malformed refs denied. Signal attachment dropping was already covered and is unchanged.

- [x] **Task 7 — Proactive opt-in notifications**
  - Acceptance Criteria:
    - Functional: `MessagingRuntime.notify(input)` sends a `notice` to an existing binding. Requires a current host grant with `notifications: true` (new optional field on `ChannelAuthorization`, default treated as false). Destination is the stored binding's conversation/thread, never a field the caller copies from model output. No binding → denied. Revoked identity → denied. Does not start an agent run. Signal: allowed only for that DM binding; still no bulk/fan-out API.
    - Performance: same deliver/journal path as a notice; counts against `maxPendingPerProcess`.
    - Code Quality: add `ChannelAction` `"notify"` rather than a second authorizer. Reuse `sendReply`/`deliver`.
    - Security: re-check identity + grant on every notify. No broadcast primitive. Rate: existing pending caps. Text redacted.
  - Approach:
    - Documentation Reviewed: `types.ts` `ChannelAction`, `ChannelAuthorization`, `MessagingRuntime`; in-memory outbound webhook notifier in `docs/server.md` (not durable — do not reuse); Signal acceptable-use (no bulk).
    - Options Considered:
      - Adapter-level send without the runtime (skips journal/authz; rejected).
      - Runtime `notify` with grant flag + existing binding (chosen).
    - Chosen Approach: `authorize` is invoked with `action: "notify"` and empty/notice text. Missing `notifications: true` is denied. Stage a reply with a synthetic operation id derived from notify identity + destination + caller `notifyId` (idempotent).
    - API Notes and Examples:
      ```ts
      await runtime.notify({
        identity, connectionId, externalConversationId, threadId,
        notifyId: "job-123-done",
        text: "The job finished.",
      });
      ```
    - Files to Create/Edit:
      - `packages/prism-channels/src/types.ts`, `runtime.ts`
      - `packages/prism-channels/src/__tests__/runtime.test.ts`
      - `docs/messaging-channels.md`, `docs/messaging-channel-operations.md`, `docs/signal-channel.md`
    - References: 079 “no proactive broadcasts”; this is opt-in unicast to a bound pair.
  - Test Cases to Write:
    - Grant without `notifications` → denied, no deliver.
    - Grant with flag + binding → one journaled notice; duplicate `notifyId` is a duplicate.
    - Foreign identity → denied.
    - Unbound conversation → denied.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `notify` and authorization field.
    - Docs pages to create/edit: `docs/messaging-channels.md`, `docs/messaging-channel-operations.md`, `docs/signal-channel.md`, `docs/options-index.md` if a new options type appears
    - `docs/index.md` update: yes — one sentence that notify is opt-in and bound
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Task 7 Outcome (2026-09-16): all acceptance criteria met; the frozen Task 1 vocabulary was implemented as written (no deviation) and two behaviours it left open were resolved and documented.
    - Contracts: `ChannelAction` gains `"notify"`; `ChannelAuthorization.notifications?` (missing === false) opts an actor in; `MessagingRuntime.notify(input)` takes exactly the frozen `{ identity, connectionId, externalConversationId, threadId?, notifyId, text }` shape and returns `ChannelAdmission`; `ChannelNotifyInput` is the only new export (+1 → measured 85). No second authorizer, no adapter change, no new reason or namespace — Signal needed no code because notify is transport-neutral and its binding is a DM by construction.
    - Pipeline: `stopped` → input validation (`malformed`) → `identityActive` (`revoked`) → ownership derived from the caller identity → **route resolution** (see below) → `authorize` with `action: "notify"` and empty text → grant must set `notifications: true`, must include the bound alias, and must name the same principal and ownership scope the caller claims → existing binding loaded with `create: false` (`missing` → `rejected`, storage failure → `unavailable`) → `maxPendingPerProcess` (`capacity`) → create-only operation record of kind `notify` on the caller `notifyId` (no cursor move, so transport ordering evidence stays transport-only) → redacted notice staged as `pending` via the shared `sendReply` path → `deliver` → settle `succeeded`. No route allocation, no session, no provider call, no queue slot: `notify` is synchronous with `admit` in shape only.
    - Deviation-free but sharper than the plan text: the destination is resolved from the **in-memory route** (`connectionId` + `externalConversationId` + `threadId` + ownership hint, where the thread comes from the binding, not from caller text). The frozen input has no actor id and the durable binding key embeds actor + alias, so a durable-only lookup would need a new index; instead a restart fails closed (`rejected`) until the user talks again — consistent with "no binding → denied" and with no new namespace. When a host has several bindings for one pair (the conversation moved alias via `/agent` or a changed grant), the **current selection** is addressed and any remaining ambiguity fails closed; a shared group thread with several actors resolves per ownership scope, so each actor's notice lands on that actor's binding only (`externalActorId` in the journal proves it).
    - Duplicate handling: durable deployments dedup on the `notifyId` keyed operation record; without `checkpoints` the bounded in-process seen-event set provides the same `duplicate: true` answer. A notice never reruns, and a failed send is recorded (`delivery_failed` / `delivery_unknown`) rather than retried automatically — recovery stays `reconcile`'s job.
    - Docs: `docs/messaging-channels.md` (notify in the request example, the contract paragraph, a host-notices execution bullet), `docs/messaging-channel-operations.md` (notice commit order and failure semantics), `docs/signal-channel.md` (bulk exclusion names `notify`), `docs/index.md`, `examples/messaging-agent.ts` (authorize branch + live `notify` call) and `examples/README.md`, package README/CHANGELOG.
    - Verification: `@arnilo/prism-channels` 89/89 tests, coverage 90.15% lines (gate 86.13%); `examples/messaging-agent.ts` runs offline and reports `notice: "accepted"` with two deliveries and zero unresolved work; budgets 84 → 85 + compat baseline 76 → 77 + `docs/_evidence/phase54-package-map.md` refreshed; docs/live-doc gates, typecheck, lint and format clean.
    - New tests: grant without the flag → `rejected` with no delivery, no run, and `action: "notify"` visible to the authorize callback; flag + binding → one journaled, redacted notice (`kind: "notice"`, `inReplyTo: notify-<notifyId>`, redactor applied), repeated `notifyId` → `duplicate: true` with a single delivery, no run, `queued: 0`, operation record `kind: "notify"` / `state: "succeeded"`; foreign user and foreign tenant → `rejected`; unbound conversation → `rejected` without allocating a binding; revoked identity before and after binding → `revoked`; another actor's binding → `rejected`; alias moved → the notice follows the current selection (journal `agentAlias`); shared thread with two actors → exactly one delivery, to the addressed actor's binding.

- [x] **Task 8 — Optional ERP outbox composition**
  - Acceptance Criteria:
    - Functional: a network-free example shows `createPostgresErpMessaging().outbox.append` in the host `BEGIN` and `adapter.send` after commit (or claim/ack via the existing dispatcher). No new SQL table, no `pg` peer on `@arnilo/prism-channels`, no channel dispatcher that stores handlers.
    - Performance: one extra outbox row per delivered reply when the host opts in; default runtime path unchanged.
    - Code Quality: example + docs only unless a ≤20-line `deliver` helper that takes host `append`/`send` callbacks is truly shorter than the example. No import of `prism-core/enterprise` from `prism-channels`.
    - Security: outbox payload is correlation ids (`operationId`, `connectionId`), not inbound chat text. Tenant id from identity ownership, not from the event.
  - Approach:
    - Documentation Reviewed: [docs/enterprise-postgres-state.md](../docs/enterprise-postgres-state.md) (`createPostgresErpMessaging`, `outbox.append` on caller `PoolClient`); `erp-messaging.ts:44–69`; 079 compromise “PostgreSQL outbox composition later”.
    - Options Considered:
      - New channel SQL schema (079 forbade; rejected).
      - Make `pg` a channels optional peer (wrong package; rejected).
      - Host composition example + a mention on both docs pages (chosen).
    - Chosen Approach: `examples/messaging-outbox.ts` uses a fake `PoolClient` in the default run (real `pg` only behind existing `PRISM_TEST_POSTGRES_URL` if we add a test). Docs cross-link operations ↔ enterprise postgres.
    - API Notes and Examples:
      ```ts
      import { createPostgresErpMessaging } from "@arnilo/prism-core/enterprise/postgres";
      const erp = createPostgresErpMessaging({ pool });
      deliver: async (reply) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await erp.outbox.append(client, {
            tenantId: ownership.tenantId!,
            messageId: reply.inReplyTo ?? operationId,
            topic: "prism.channel.reply",
            payload: { connectionId: reply.connectionId, operationId },
          });
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
        return adapter.send(reply);
      };
      ```
    - Files to Create/Edit:
      - `examples/messaging-outbox.ts`, `examples/README.md`, `examples/tsconfig.json` if needed
      - `docs/messaging-channel-operations.md`, `docs/enterprise-postgres-state.md`
    - References: 079 P6; phase 27 ERP messaging.
  - Test Cases to Write:
    - Example typechecks. Optional: fake client asserts `BEGIN` → `append` → `COMMIT` → `send` order and that payload has no chat text.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new package API — composition recipe. Behavior docs yes.
    - Docs pages to create/edit: `docs/messaging-channel-operations.md`, `docs/enterprise-postgres-state.md`, `examples/README.md`
    - `docs/index.md` update: no — existing pages
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Task 8 Outcome (2026-09-16): all acceptance criteria met with zero package changes — no new table, no new API, no `pg` peer, no channel-side dispatcher, so no export/compat/budget rebaseline.
    - Functional: `examples/messaging-outbox.ts` composes the existing enterprise stack with the runtime `deliver` seam: caller-owned `PoolClient` → `BEGIN` → `createPostgresErpMessaging({ pool }).outbox.append(client, …)` → `COMMIT` → `transport.send(reply)` (a real host passes `createTelegramAdapter`/`createSignalAdapter` there). The offline run swaps in a fake `pg` pool whose `query` returns exactly the `INSERT … RETURNING` columns (payload as stored JSON text), so the append still runs the real validators, `encodeBoundedJson` bounds and `ON CONFLICT (tenant_id, message_id) DO NOTHING` idempotency path. The dispatcher `claim`/`acknowledge` alternative is documented as the re-drive path rather than demonstrated: faking the CTE `UPDATE … FOR UPDATE SKIP LOCKED` would add SQL-shaped noise to an example about transaction order.
    - Performance: one outbox row per delivered reply, appended in the host transaction only when the host opts in; the default runtime path is byte-for-byte unchanged (`git status` shows no `packages/prism-channels` or enterprise edits).
    - Code Quality: example + docs + one root test. No `deliver` helper was added to the package (the inline `deliver` is shorter than a callback-taking helper and keeps the transaction visible where the host reads it), and no `prism-core/enterprise` import was added to `prism-channels`. `examples/tsconfig` needed no new path mapping — `@arnilo/prism-core/enterprise/postgres` resolves through the package `exports` map, and `pg` types come from the workspace dev dependency.
    - Security: the outbox payload is `{ connectionId, eventId, kind }` — correlation ids only; no prompt text, no reply text, no attachments. `tenantId` is taken from the resolved identity's ownership scope, never from the transport event. The example's own run asserts both facts and throws otherwise, so a future edit that starts leaking text fails the runnable check.
    - Deviation-free: the plan's `payload: { connectionId, operationId }` sketch was followed in spirit but not literally — `deliver` never receives the operation id (the reply carries `inReplyTo` = answered event id, and the operation id is keyed by `(ownership, connectionId, operationId)` in the reply journal), so the row records what the host actually holds: `connectionId`, `eventId`, `kind`. The docs state this explicitly instead of implying a join that does not exist.
    - Verification: new root test `src/__tests__/messaging-outbox-example.test.ts` spawns the example and asserts `["BEGIN","append","COMMIT","send"]` order, one row per delivered reply, `tenantId: "example-tenant"` from the identity, `messageId: "42"` (correlation, not text), `topic: "prism.channel.reply"`, payload keys exactly `{ connectionId, eventId, kind }`, delivered `["Host example reply."]` and `leakedPromptText: false`. Example runs offline under plain `node` (Node 24 type stripping) and typechecks through `tsc -p examples --noEmit`.
    - Docs: `examples/README.md` lists the new example (docs gate requires it), `docs/messaging-channel-operations.md` gains a "PostgreSQL outbox composition" section (same transaction as business state, row is the record because a send cannot be rolled back, re-drive via `dispatcher.claim`/`acknowledge`, idempotent on `(tenant_id, message_id)`, correlation-only payload, tenant from ownership), and `docs/enterprise-postgres-state.md` gains the reverse pointer ("Composing with messaging channels") stating that `prism-channels` has no `pg` peer and the composition is host code.

- [x] **Task 9 — SIGTERM injection and soak runner**
  - Acceptance Criteria:
    - Functional: E2E (or the existing restart worker) sends OS `SIGTERM` after `executing` is visible; the worker calls `runtime.stop()` and the operation is not left `executing` (cancelled/abandoned/failed — whatever `stop` already guarantees in `runtime.test.ts`). `scripts/fixtures/messaging-soak.mjs` loops admit/reconcile/prune; CI runs it for ≤30s; docs describe a 72h operator invocation. Default `npm test` does not run 72h.
    - Performance: SIGTERM test bounded like the SIGKILL test. Soak CI smoke <30s wall clock.
    - Code Quality: reuse `scripts/fixtures/messaging-restart-worker.mjs`; do not invent a second worker. Soak is a script, not a daemon in the library.
    - Security: soak uses mock provider + sqlite temp dir; no network, no real chat accounts.
  - Approach:
    - Documentation Reviewed: 079 Task 8 compromise; `scripts/fixtures/messaging-restart-worker.mjs`; `packages/prism-channels/src/__tests__/end-to-end.test.ts`; `docs/messaging-channel-operations.md`
    - Options Considered:
      - Keep SIGTERM untested (079 flake; rejected — Further Actions asked for it).
      - Wait for `executing`, SIGTERM, `stop()` in the worker, assert not `executing` (chosen).
    - Chosen Approach: worker already waits for `executing`. Add `process.on("SIGTERM", () => runtime.stop())` before the hang. Test retries once on flake, then fails. Soak: `--durationMs` default 30000, `--durationMs 259200000` in the 72h recipe.
    - API Notes and Examples:
      ```bash
      node scripts/fixtures/messaging-soak.mjs --durationMs 30000
      # operator: --durationMs 259200000
      ```
    - Files to Create/Edit:
      - `scripts/fixtures/messaging-restart-worker.mjs`, `scripts/fixtures/messaging-soak.mjs`
      - `packages/prism-channels/src/__tests__/end-to-end.test.ts`
      - `docs/messaging-channel-operations.md`, `packages/prism-channels/README.md`
    - References: 079 Task 8 SIGKILL path; `runtime.stop()`.
  - Test Cases to Write:
    - SIGTERM: child exits, sqlite operation not `executing`.
    - Soak 1s/a few iterations: zero uncaught, prune runs, process exits 0.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — ops recipe.
    - Docs pages to create/edit: `docs/messaging-channel-operations.md`
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`
  - Task 9 Outcome (2026-09-16): both acceptance criteria met; one flaw in the injected worker had to be fixed to make SIGTERM testable at all, and the soak runner needed an explicit event-loop yield.
    - Functional (SIGTERM): `scripts/fixtures/messaging-restart-worker.mjs` now waits for `executing` (as before), then awaits a promise that its `SIGTERM` handler resolves, then runs `await runtime.stop()` and closes persistence. The test sends OS `SIGTERM` over the pipe only after the worker prints its claimed state, asserts `exitCode === 0` and that the worker printed `STOPPED` (i.e. `stop()` resolved), then reads the record back with `createChannelStateStore.loadOperation` and asserts the state is `cancelled` (observed; the plan allows cancelled/abandoned/failed) and that `listUnresolved` is empty. One retry absorbs scheduler jitter per the plan; three consecutive full-file runs were green.
    - Flaw found and fixed: the worker ended with a bare `await new Promise(() => undefined)`, so as soon as the `STATE` line flushed, the event loop had no pending handles and Node exited 13 (“unsettled top-level await”) — SIGTERM hit a dying process and was indistinguishable from SIGKILL, which is why the 079 attempt could never assert the graceful path. Replacing the bare await with a promise plus a keep-alive interval keeps the process alive until the signal arrives, so the handler always runs and the module's top-level await settles afterwards (no exit-13 warning, no `process.exit` needed).
    - Functional (soak): `scripts/fixtures/messaging-soak.mjs` loops admit → drain → (every `pruneEvery`, default 25) repeated-event dedup check + `listUnresolved`/`reconcile` + `prune`, across `--lanes` (default 4) conversation/actor pairs. Options `--durationMs` (default 30 s, hard cap 7 days), `--iterations`, `--lanes`, `--pruneEvery`; one JSON summary line; exit 0 only when nothing was denied, left unresolved/unsettled, failed, or delivered twice (it cross-checks `delivered === admitted`, `duplicates === repeatAttempts`, `diagnostics.admitted === admitted + repeatAttempts`, `diagnostics.deliveries === delivered`, `diagnostics.failed === 0`). CI runs a 1 s smoke inside the package E2E suite; the docs give the 72 h invocation (`--durationMs 259200000`), which is never part of `npm test`.
    - Flaw found and fixed (soak): sqlite (`node:sqlite` `DatabaseSync`) is synchronous, so every `await` in the loop resolved in the same microtask drain and `SIGINT`/`SIGTERM`/timers starved for the entire run — a child probe ignored `SIGTERM` for 15 s and had to be SIGKILLed. One `setImmediate` every 16 iterations restores a macrotask boundary (cost is irrelevant over 72 h) and `SIGTERM` now ends the run in ~10 ms with `interrupted: true` and a clean summary.
    - Performance: SIGTERM test is bounded like the SIGKILL test (~230 ms, 10 s hard timeout, at most two attempts); the CI soak smoke is ~1.2 s including process startup, well under the 30 s budget; the default runtime path is unchanged (no library code touched — only tests, fixtures and docs).
    - Code Quality: one worker, two signals — `messaging-restart-worker.mjs` is reused unchanged in shape, and the soak is a script under `scripts/fixtures/`, not a library daemon or a second worker. `runWorker` now takes the signal and returns `{ operationId, version, exitCode, stopped }`, so the SIGKILL path keeps its prior assertions.
    - Security: the soak uses a mock provider, a temp-directory sqlite file and `deliver: () => ({ delivered: true })`; it opens no socket, needs no credentials, creates no contacts and never touches a real chat account. The SIGTERM test likewise runs entirely on a temp sqlite file.
    - Docs: `docs/messaging-channel-operations.md` now documents the verified graceful path (SIGTERM → `cancelled`, SIGKILL → `executing` for `reconcile`) and the soak runner with both invocations, the JSON summary contract, the periodic event-loop yield and the aged final prune; `packages/prism-channels/README.md` links the fault-injection worker and the soak command.
    - Verification: `@arnilo/prism-channels` 91/91 tests (was 89), coverage 90.15% lines / 76.81% branches (gate 86.13); `npm test` 5/5 stages; lint and format clean.

- [x] **Task 10 — 0.8.0 lockstep cut** (superseded by 085 Task 7–8)
  - Acceptance Criteria:
    - Functional: 081 implementation tasks (1–8) are complete. Lockstep `0.7.0` → `0.8.0` on all publishable manifests/internal ranges/lockfile/version constant/generated claim surfaces (11 packages, including `@arnilo/prism-channels`). Root changelog + migration cover 079 + this plan + 081 (connected apps, work HTTP adapters, sidecar example). `docs/index.md` current-line is 0.8.0. Compat baseline additive except reviewed security refusals. Then: `npm test` 5/5, typecheck, coverage, pack dry-run, release gate, postgres/security suites as in 073 Task 29. Evidence + handoff docs. No registry write.
    - Performance: budgets rebaselined only with recorded reasons (channel exports/media/docs + 081 MCP/work exports). No blanket ceiling bump.
    - Code Quality: use `scripts/release.mjs bump` and `package-truth.mjs --emit-docs`; graft refresh; wiki headings on any new API page.
    - Security: secret scan, SBOM, audit at current policy. Publish/tag commands in the handoff only. Missing protected infra → BLOCKED, not skipped-as-pass. Lockfile must not gain Open Connector / Klavis / Nango.
  - Approach:
    - Documentation Reviewed: 073 Tasks 28–29 execution notes; `docs/release-and-install.md`; `scripts/release.mjs`; create-plan `references/prism-wiki.md`; current 11-package inventory; [081](081-Connected-Apps-Mcp-Host-And-Work-Http.md).
    - Options Considered:
      - Ship 080 features on 0.7.0 (079 already moved channels to 0.8.0; rejected).
      - Cut before 081 (user asked connected-apps to ship in 0.8.0; rejected).
      - Move the cut to a new 082 (unnecessary; this plan already owns the cut item; chosen to keep Task 10 here and wait on 081).
    - Chosen Approach: same tooling as 0.7.0: bump, truth, compat `--update-baseline`, migration page `docs/migrate-to-0.8.md`, evidence `docs/_evidence/0.8.0-messaging-channels.json` (extend or add `docs/_evidence/0.8.0-connected-apps.json` if 081 needs a separate claim file), handoff `docs/history/release-handoffs.md`. Operator publishes later.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs bump --from 0.7.0 --to 0.8.0 --ranges caret
      node scripts/package-truth.mjs --emit-docs
      node scripts/release.mjs gate --lockstep --version 0.8.0 --update-baseline
      npm test && npm run typecheck && npm run pack:dry-run
      ```
    - Files to Create/Edit:
      - all publishable `package.json`, `package-lock.json`, `src/index.ts` version
      - root `CHANGELOG.md`, `docs/migrate-to-0.8.md`, `docs/index.md`, `docs/release-and-install.md`, `roadmap.md`, `plans/README.md`
      - `scripts/compat-baseline/*`, `scripts/budgets.json` (reasoned)
      - `docs/_evidence/0.8.0-messaging-channels.{json,md}`, optional `docs/_evidence/0.8.0-connected-apps.{json,md}`, `docs/history/release-handoffs.md`
      - this plan checkboxes
    - References: 073 Task 28–29; 079 expected 0.8.0 vehicle; 081.
  - Test Cases to Write:
    - version-literal gate at 0.8.0; half-cut fixture still fails; install-smoke subpaths including channels and work HTTP / connected-apps exports; docs freeze current-line 0.8.0.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — published version and migration.
    - Docs pages to create/edit: `docs/index.md`, `docs/migrate-to-0.8.md`, `docs/release-and-install.md`, `docs/history/release-handoffs.md`, evidence files
    - `docs/index.md` update: yes — 0.8.0 current-line banner; one-sentence functional entries only
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Compromises Made

Known constraints at plan creation (not post-implementation):

- Signal stays experimental, private-DM, no groups/media/drafts/bulk notify (terms + GPLv3 bridge).
- `sendMessageDraft` is private-chat-only in Bot API 9.3; groups get no draft path.
- Media bytes never enter the journal; oversize is fail-closed, not streamed to the model.
- 72h soak is an operator recipe; CI runs a short smoke of the same script.
- Checkpoint foreign load becoming `null` is a behavior change for callers that caught `Checkpoint ownership mismatch` as a signal.
- Nested glob repair may surface previously unrun failing tests; those must be fixed or explicitly skipped, not ignored.
- 0.8.0 registry/tag remains operator-authorized; this plan ends at a verified handoff.
- `CheckpointStore` OFFSET pagination is **out of this plan**.
- Task 10 waits on [081](081-Connected-Apps-Mcp-Host-And-Work-Http.md); the 0.8.0 changelog/migration must name connected apps and work HTTP adapters.

## Further Actions

To be filled after task completion with improvements, rationale, and priority.
