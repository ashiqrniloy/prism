# Phase 36 — Atomic append, branch handles, and scalable session queries

## Objectives
- Make append-only sessions safe under multi-process/multi-writer apps with an atomic, optimistic-concurrency append contract: expected parent/leaf, duplicate/idempotency-key handling, and a stable conflict shape.
- Make the branch handle `(sessionId, leafId)` an explicit, storable model so external UIs can keep many branch handles per session and checkout existing leaves.
- Fix the RPC `forkSession` same-id overwrite bug and add an RPC/API checkout command for existing leaf ids.
- Add DB-friendly branch query primitives so adapters read one branch path/page instead of `store.list(sessionId)` + in-memory rebuild for every read.
- Document the JSONL cross-process limitation explicitly; keep any advisory lock host-owned unless cheap.
- Update `/docs` so an external app can implement a multi-writer DB adapter and a branch-aware UI from docs alone.

## Expected Outcome
- `SessionStore.append` accepts optional `SessionAppendOptions { expectedParentId?, idempotencyKey? }`; the memory and JSONL stores enforce expected-parent and duplicate/idempotency guards; a stable `SessionAppendConflictError` (or equivalent failure shape) is thrown when the expectation mismatches.
- Branch handles are representable as durable `(sessionId, leafId)` pointers; `BranchRecord.leafEntryId` is the persistence-side leaf and the runtime exposes checkout/leaf listing.
- `forkSession` no longer overwrites the in-memory RPC session map entry for the parent branch; the RPC map supports multiple branch handles per `sessionId`.
- A new RPC/`AgentSession` checkout command switches a session to an existing leaf id.
- A `readBranchPath`/branch-reader contract lets DB adapters fetch one branch path/page; the pure helpers fall back to the existing in-memory walk over `list()`.
- `/docs/session-stores.md`, `/docs/session-stores-and-branching.md`, `/docs/cli-rpc.md`, `/docs/database-persistence.md`, `/docs/node-jsonl-session-store.md`, and `/docs/index.md` cover the new behavior.

## Tasks

- [x] Task 1 — Primitive review: inventory append, leaf, branch, RPC, and query seams
  - Acceptance Criteria:
    - Functional: Inventory `SessionStore.append/list/get`, `SessionAppendOptions` (if any), `BranchRecord`/`BranchQuery`/`SessionEntryQuery`, `ProductionPersistenceStore`, `RunLedger`, runtime `currentLeafId`/`appendEntry`/`checkout`/`fork`/`clone`, `getSessionBranchEntries`/`rebuildSessionContext`/`listSessionBranches`, the JSONL append chain, the RPC `sessions` map + `forkSession`/`switchSession`, and existing docs. Identify what is reused unchanged and where new generic primitives are required.
    - Performance: Review confirms no production DB adapter will be forced to call `store.list(sessionId)` for a single branch read, and that append guards are O(1) per append (hash/pointer check), not a full-session scan.
    - Code Quality: Review records exact source/docs paths and rejects app-specific persistence logic in core.
    - Security: Review confirms append/branch contracts never require provider credentials, credential resolvers, provider instances, or unredacted secrets, and that idempotency keys are opaque host values.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 36 (deliverables and acceptance).
      - `.agents/skills/create-plan/references/prism-wiki.md`.
      - `plans/035-production-persistence-contract-and-schema.md` (Phase 34 records/schema, JSONL local-only note, idempotency-key reservation).
      - `plans/036-durable-run-event-tool-usage-ledger.md` (Phase 35 `RunLedger`, `idempotencyKey` on `AgentConfig`/`RunOptions`, `RunRecord.idempotencyKey`).
      - `src/contracts.ts` `SessionStore` (line 671), `SessionEntry`, `BranchRecord`, `BranchQuery`, `SessionEntryQuery`, `ProductionPersistenceStore`, `RunLedger`.
      - `src/session-stores.ts` `getSessionBranchEntries`, `rebuildSessionContext`, `listSessionBranches`, `createMemorySessionStore`.
      - `src/agents.ts` `currentLeafId` (line 67), constructor leaf init (line 82), `checkout` (line 276), `fork` (line 281), `clone` (line 285), `appendEntry` (line 475).
      - `src/node/session-store-jsonl.ts` in-process `appendChain` and duplicate-id guard.
      - `src/rpc.ts` `RpcState.sessions` map, `forkSession`/`switchSession`/`cloneSession` (lines 138-165), `RpcCommandName` union.
      - `docs/session-stores.md`, `docs/session-stores-and-branching.md`, `docs/cli-rpc.md`, `docs/database-persistence.md`, `docs/node-jsonl-session-store.md`, `docs/index.md`.
    - Options Considered:
      - Add a SQL adapter to core: rejected — Phase 36 asks for contracts/primitives, not a database dependency.
      - Track the per-session current leaf only in the runtime (`currentLeafId`): rejected — that pointer is in-memory and lost across processes, so it cannot make append safe for multi-writer apps.
      - Reuse `RunLedger` for entry append: rejected — the ledger holds runs/events/tool-calls/usage, not conversation entries; message entries already belong to `SessionStore` (Phase 35 compromise).
    - Chosen Approach:
      - Reuse the Phase 34 `BranchRecord`/`BranchQuery` shapes and the Phase 35 `idempotencyKey` plumbing; add only the missing generic primitives (expected-parent append guard, branch-path reader, durable leaf pointer) and wire them through existing seams.
    - API Notes and Examples:
      ```ts
      // Existing primitives to preserve: host-owned SessionStore, no hidden global.
      await store.append(createSessionEntry({ sessionId, parentId: leafId, runId, kind: "message", message }));
      ```
    - Files to Create/Edit:
      - `plans/037-atomic-append-branch-handles-and-scalable-session-queries.md`: append review outcome before implementation.
    - References:
      - `roadmap.md` Phase 36 acceptance.
      - `src/contracts.ts:671` `SessionStore`; `BranchRecord`/`BranchQuery`; `ProductionPersistenceStore`.
      - `src/agents.ts:67,82,276,281,285,475` leaf/fork/clone/append.
      - `src/rpc.ts:138-165` RPC session map and fork/switch.
    - Test Cases to Write:
      - none (review task).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — review gates the append/branch/RPC API changes and docs work.
    - Docs pages to create/edit:
      - `plans/037-atomic-append-branch-handles-and-scalable-session-queries.md`: review notes only.
    - `docs/index.md` update: no; handled in Task 6.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Reviewed exact sources and confirmed the current append/leaf/branch/RPC/query seams. No code was changed in Task 1; the review informs Tasks 2–7.
    - **Existing reusable primitives (no changes needed):**
      - `src/contracts.ts:671` `SessionStore` — minimal `append(entry): Promise<void>` / `list(sessionId): Promise<readonly SessionEntry[]>` / optional `get?(id)`. Database-neutral; the runtime uses it for conversation state only. Today `append` takes no options, has no expected-parent guard, and no idempotency hook.
      - `src/contracts.ts` `SessionEntry` — branch-aware entry with `id`, `parentId?`, `sessionId`, `timestamp`, `kind: SessionEntryKind`, optional `schemaVersion?: 1`, `runId?`, and per-kind payloads. Already stores messages, events, model changes, summaries, labels, custom data, compaction data, and metadata. **No `idempotencyKey` field** — Phase 35 reserved `idempotencyKey` only on `RunRecord`/`AgentConfig`/`RunOptions`, never on entries or append options.
      - `src/session-stores.ts` pure helpers:
        - `createSessionEntry()` — id/timestamp stamping with optional `createId`/`now`.
        - `getSessionBranchEntries(entries, { leafId? })` — walks `parentId` from leaf to root over an **already-listed** `entries[]`, returns deep-copied root-to-leaf branch. Linear in branch length; throws on unknown leaf / missing parent.
        - `rebuildSessionContext(entries, options)` — same walk, then derives `{ leafId, entries, messages, summaries }`, honoring the latest `kind: "compaction"` boundary. `messages`/`summaries` are the provider context; raw `entries` stay intact.
        - `listSessionBranches(entries)` — returns `{ leafId, entries }[]`, one per leaf.
        - `createMemorySessionStore()` — `byId`/`bySession` maps; `add()` rejects duplicate ids (O(1)); `list()`/`get()` return `structuredClone` deep copies. Per-session append order preserved. **No current-leaf pointer, no expected-parent check, no idempotency.**
      - `src/node/session-store-jsonl.ts` — explicit Node JSONL adapter. `append` serializes via an in-process `appendChain` promise and rejects duplicate ids by scanning the file (`findEntry`). `list(sessionId)` filters a full file read by sessionId; `get(id)` scans the file. **Single-process only; no cross-process lock** (already documented).
      - `src/contracts.ts` `AgentSession` interface already exposes `checkout(leafId?: string): Promise<void>`, `fork(options?): AgentSession`, `clone(options?): Promise<AgentSession>`, and `entries()`. So a new RPC `checkout` command maps directly onto the existing `AgentSession.checkout` — no new runtime method required.
      - `src/agents.ts` `RuntimeAgentSession`:
        - `currentLeafId?: string` (line 67) — in-memory leaf pointer, initialized from `config.leafId` (line 82).
        - `appendEntry(entry)` (line 475) — redacts via `redactSessionEntry`, calls `store.append(redacted)`, then sets `this.currentLeafId = redacted.id`. **No expected-parent or idempotency passed to `store.append`.**
        - `checkout(leafId?)` (line 276) — sets `this.currentLeafId`.
        - `fork({ leafId? })` (line 281) — returns a new `RuntimeAgentSession` with the **same** `id` (sessionId) and a different `leafId`. Same-sessionId identity is the root cause of the RPC map overwrite.
        - `clone({ id?, leafId? })` (line 285) — rebuilds the branch via `getSessionBranchEntries(store.list(...))` and remaps ids into a **new** sessionId.
        - Phase 35 already threads `activeIdempotencyKey`/`activeLedger`/`activeOwnership` per run (lines ~96), so `appendEntry` can read `this.activeIdempotencyKey` and pass it to `store.append` without new plumbing.
      - `src/contracts.ts` Phase 34 persistence shapes that Phase 36 extends rather than duplicates:
        - `BranchRecord` — `{ id, sessionId, name?, rootEntryId?, parentBranchId?, leafEntryId?, createdAt, metadata? }`. `leafEntryId` is already the durable leaf pointer a branch handle needs.
        - `BranchQuery`, `SessionEntryQuery` (with `leafId` filter), `PersistencePage<T>`, `PersistenceQuery` (`cursor`/`limit`/`order`).
        - `ProductionPersistenceStore` — **query-only** (12 `query*` methods: sessions, branches, entries, runs, events, toolCalls, usage, agentDefinitions, retentionPolicies, migrations). No write/append method exists; `RunLedger` is the only write-side adapter and it covers runs/events/tool-calls/usage, **not** session entries.
      - `src/redaction.ts` `redactSessionEntry` — already applied to every entry before `store.append`, so the new append options path inherits redaction for free.
      - Existing docs: `docs/session-stores.md` (canonical), `docs/session-stores-and-branching.md` (compat), `docs/cli-rpc.md` (RPC command list — no `checkout`), `docs/database-persistence.md` (schema/indexes/idempotency-key reservation on `prism_runs` only), `docs/node-jsonl-session-store.md` (single-process/no-lock warning already present).
    - **Gaps that require new generic primitives (Phase 36 Tasks 2–5):**
      - No `SessionAppendOptions` and no expected-parent / idempotency guard on `SessionStore.append`. Two workers appending to the same branch from different processes can interleave parents and silently corrupt branch order. Need `SessionAppendOptions { expectedParentId?; idempotencyKey? }` (Task 2) + enforcement in memory/JSONL stores and runtime wiring (Task 3).
      - No stable conflict shape. Need `SessionAppendConflict`/`SessionAppendConflictError` with `code: "session_append_conflict"`, `expectedParentId?`, `currentLeafId?`, `idempotencyDuplicate?`, plus an `isSessionAppendConflict()` guard (Task 2).
      - No durable `(sessionId, leafId)` branch-handle primitive distinct from `BranchRecord` for the in-process runtime/RPC. `BranchRecord.leafEntryId` is the persistence-side leaf; add a lightweight `SessionBranchHandle { sessionId; leafId }` for API/RPC (Task 2).
      - RPC `forkSession` (rpc.ts:155–159) calls `state.sessions.set(session.id, …)` but `AgentSession.fork` returns the **same sessionId** with a different leaf, so the map key (`sessionId`) collides and the parent handle is overwritten. No `checkout` RPC command exists. Need branch-handle-keyed RPC map + `checkout` command (Task 4).
      - Branch reads force a full-session load: `getSessionBranchEntries`/`rebuildSessionContext` operate on an already-`list(sessionId)` array; `clone` calls `store.list(sessionId)`; runtime `snapshot()`/`entries()` (agents.ts:273,485) call `store.list(this.id)`. No branch-path query primitive exists on `SessionStore`/`ProductionPersistenceStore`. Need an optional `readBranchPath(query)` so a DB adapter fetches one ancestor chain instead of the whole session (Task 5).
      - `SessionEntry` has no `idempotencyKey`. Phase 36 does **not** need to add one to the entry payload: entry-level idempotency can be carried in `SessionAppendOptions.idempotencyKey` and enforced at the store (dedup by key per session) without persisting it on every entry, mirroring how Phase 35 reserved `idempotency_key` guidance at the schema level. (If a host needs durable entry idempotency, it stores it in the DB row/index; the contract only needs the append-time option.)
    - **Security boundary confirmed:**
      - `SessionEntry` payload fields hold only messages/events/labels/summaries/custom data/compaction data/metadata; provider credentials, credential resolvers, provider instances, and settings objects are never stored (verified against the `SessionEntry` interface and Phase 35 review).
      - Runtime already redacts entries via `redactSessionEntry` before `store.append`; the new `SessionAppendOptions` path inherits this — guards run on the redacted entry, and the redacted entry is what reaches the store.
      - `idempotencyKey` is already an opaque host string on `RunRecord`/`AgentConfig`/`RunOptions`; the same opaque-string treatment applies to entry append. Conflict records (`expectedParentId`/`currentLeafId`/`idempotencyDuplicate`) carry only ids and a boolean — no secrets.
      - `ProductionPersistenceStore` query/branch contracts require no credentials; `readBranchPath` will follow the same rule (returns redacted `SessionEntry` values only).
    - **Performance boundary confirmed:**
      - Today's append guards are O(1) (memory `byId.has` map check; JSONL `findEntry` scan is linear-in-file but serialized by `appendChain` within one process). The Phase 36 expected-parent/idempotency guards stay O(1) (per-session current-leaf pointer + idempotency-key map), so no regression; the JSONL `findEntry` scan is pre-existing and out of scope.
      - Branch rebuild is the scaling problem: `getSessionBranchEntries`/`rebuildSessionContext` are linear in branch length **over a full-session `list()` result**, and runtime `snapshot()`/`entries()`/`clone` all call `store.list(sessionId)`. For large DB-backed sessions this is a full-session scan per provider turn. `readBranchPath` (Task 5) lets a DB adapter issue one ancestor-chain query (recursive CTE / graph lookup) bounded by `limit`/`cursor`, so common branch reads no longer require a full-session load.
      - JSONL remains single-process; no background worker, buffer, or cross-process lock is added in core (cross-process advisory locking stays host-owned per the roadmap).
    - **Exact insertion/fix points identified:**
      - `src/contracts.ts` ~`SessionStore` (line 671): widen `append` to `append(entry, options?: SessionAppendOptions)`; add `SessionAppendOptions`, `SessionAppendConflict`, `SessionAppendConflictError`, `SessionBranchHandle`, `SessionBranchRead`; add optional `readBranchPath` on `SessionStore` and `ProductionPersistenceStore`; document `BranchRecord.leafEntryId` as the durable leaf.
      - `src/session-stores.ts`: add per-session current-leaf pointer + expected-parent/idempotency guards to `createMemorySessionStore`; add `BranchReader` overload to `getSessionBranchEntries`/`rebuildSessionContext`; add `isSessionAppendConflict`.
      - `src/node/session-store-jsonl.ts`: same guards under `appendChain`; `ponytail:` comment marking the single-process ceiling and the DB-transaction upgrade path.
      - `src/agents.ts:475` `appendEntry`: pass `expectedParentId: this.currentLeafId` and `idempotencyKey: this.activeIdempotencyKey` into `store.append`; `currentLeafId` advances only on success.
      - `src/rpc.ts:155–165,245`: change the `sessions` map keying to branch-handle id; fix `forkSession`/`switchSession`/`cloneSession` so a fork does not remove the parent handle; add `checkout` to `RpcCommandName` and the dispatcher, delegating to `AgentSession.checkout`.
      - Docs: `docs/session-stores.md`, `docs/session-stores-and-branching.md`, `docs/cli-rpc.md`, `docs/database-persistence.md`, `docs/node-jsonl-session-store.md`, `docs/index.md` (Task 7).
    - **Docs state:** `docs/session-stores.md` documents `append(entry)`/`list`/`get` with no options and the JSONL single-process/multi-writer caveat; `docs/session-stores-and-branching.md` documents the in-memory branch helpers and notes rebuild is linear over listed entries; `docs/cli-rpc.md` lists the RPC commands without `checkout` and does not mention the fork overwrite; `docs/database-persistence.md` documents the `(session_id, parent_id)` index for branch reconstruction and reserves `idempotency_key`/unique-index guidance **on `prism_runs` only** — no entry-level idempotency and no `readBranchPath`; `docs/node-jsonl-session-store.md` already states no cross-process lock and not-for-multi-writer.

- [x] Task 2 — Atomic append contract, branch-handle types, and conflict shape
  - Acceptance Criteria:
    - Functional: Add `SessionAppendOptions { expectedParentId?: string; idempotencyKey?: string }` and a stable failure shape `SessionAppendConflict`/`SessionAppendConflictError` carrying `{ code: "session_append_conflict"; expectedParentId?; currentLeafId?; idempotencyDuplicate?: boolean }`. Widen `SessionStore.append` to `append(entry, options?: SessionAppendOptions): Promise<void>` so existing single-arg implementations remain structurally assignable. Add a `SessionBranchHandle` type `{ sessionId; leafId }` and reuse/extend `BranchRecord.leafEntryId` as the durable leaf pointer.
    - Performance: Guards are O(1) per append (current-leaf pointer comparison + duplicate-id/idempotency-key lookup); no full-session scan in the append path.
    - Code Quality: Single source of truth for append options and conflict shape in `src/contracts.ts`; exports added to `src/index.ts`; `SessionAppendConflictError` is recognizable via a stable `code` so callers catch by code, not message text.
    - Security: Append options and conflict records never carry credentials, credential resolvers, provider instances, or unredacted secrets; `idempotencyKey` is treated as an opaque host string and redacted like metadata when persisted.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `SessionStore` (line 671), `SessionEntry`, `BranchRecord`, `OwnershipScope`.
      - `src/session-stores.ts` `createMemorySessionStore` duplicate-id guard in `add()`.
      - `plans/036-...` Phase 35 `idempotencyKey` reuse on `AgentConfig`/`RunOptions`/`RunRecord`.
      - `docs/database-persistence.md` reserved idempotency-key index note.
    - Options Considered:
      - Separate optional `appendAtomic(entry, options)` method + runtime feature detection: rejected — widens the contract surface and forces feature-detection at every call site.
      - Return a `{ ok, conflict? }` result instead of throwing: rejected — `append` is `Promise<void>` today; a typed thrown error with a stable `code` is the smallest backward-compatible change and mirrors how `dispatchToolCall` surfaces recoverable reasons.
      - Widen `append(entry, options?)` with an optional second argument: chosen — TS structural typing keeps existing single-arg `append(entry)` implementations assignable; stores that ignore `options` keep today's (single-process) behavior and are documented as such.
    - Chosen Approach:
      - Widen `SessionStore.append` with optional `SessionAppendOptions`; define `SessionAppendConflictError` (extends `Error`, carries `code` and conflict details); add `SessionBranchHandle` and document `BranchRecord.leafEntryId` as the persistence-side leaf.
    - API Notes and Examples:
      ```ts
      import { isSessionAppendConflict, type SessionAppendOptions } from "@arnilo/prism";

      try {
        await store.append(entry, { expectedParentId: currentLeafId, idempotencyKey: "req-42" });
      } catch (error) {
        if (isSessionAppendConflict(error)) {
          // currentLeafId advanced under us: reload branch and retry, or surface to caller.
        }
        throw error;
      }
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: add `SessionAppendOptions`, `SessionAppendConflict`, `SessionAppendConflictError`, `SessionBranchHandle`; widen `SessionStore.append`; document `BranchRecord.leafEntryId`.
      - `src/session-stores.ts` or a new small helper module: add `isSessionAppendConflict(error)` guard and the error class if it lives outside `contracts.ts`.
      - `src/index.ts`: export the new types/helper.
      - `src/__tests__/persistence-contracts.types.test.ts`: compile-only use of the new types and the widened `append` signature against a legacy single-arg implementation.
    - References:
      - `src/contracts.ts:671` `SessionStore`.
      - `plans/035-...` Phase 34 `BranchRecord.leafEntryId` and idempotency-key reservation.
    - Test Cases to Write:
      - Type test: a legacy `append(entry): Promise<void>` implementation still satisfies the widened `SessionStore`.
      - Type test: `SessionAppendOptions` and `SessionAppendConflictError` fields are assignable as documented.
      - `isSessionAppendConflict()` returns true only for errors carrying `code: "session_append_conflict"`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public append options, conflict shape, and branch-handle types.
    - Docs pages to create/edit:
      - `docs/session-stores.md`: document `SessionAppendOptions`, the conflict shape, and the `(sessionId, leafId)` branch handle (Task 6).
      - `docs/database-persistence.md`: document the conditional-append SQL/transaction pattern and the unique idempotency-key index (Task 6).
    - `docs/index.md` update: yes; handled in Task 6.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Implemented the Phase 36 contract layer only (no store/runtime behavior — that is Task 3). `npm run build:core` (tsc) clean; full suite 689/689 pass.
    - **Added in `src/contracts.ts` (single source of truth):**
      - `SessionAppendOptions { expectedParentId?: string; idempotencyKey?: string }` — opaque-host-string `idempotencyKey`, JSDoc states stores redact it like metadata and that it carries no credentials/provider instances/secrets.
      - `SessionBranchHandle { sessionId: string; leafId: string }` — durable branch-tip pointer; JSDoc cross-references `BranchRecord.leafEntryId` as the persistence-side equivalent.
      - `SESSION_APPEND_CONFLICT_CODE = "session_append_conflict" as const` — the stable code literal.
      - `SessionAppendConflict { code: typeof SESSION_APPEND_CONFLICT_CODE; expectedParentId?; currentLeafId?; idempotencyDuplicate? }` — carries only ids and a boolean, no secrets.
      - `SessionAppendConflictError extends Error` with `readonly code = SESSION_APPEND_CONFLICT_CODE` and `readonly conflict: SessionAppendConflict`; mirrors the existing `TrustDeniedError` style (`this.name`, descriptive message). Recognizable by `code`, not message text.
      - `isSessionAppendConflict(error): error is SessionAppendConflictError` — keys off the stable `code` AND requires `error instanceof Error` so the type predicate is truthful and survives cross-bundle throws (where `instanceof SessionAppendConflictError` would fail).
      - Widened `SessionStore.append` to `append(entry: SessionEntry, options?: SessionAppendOptions): Promise<void>`.
      - Documented `BranchRecord.leafEntryId` as the durable persistence-side branch tip.
    - **Exports:** runtime values (`SESSION_APPEND_CONFLICT_CODE`, `SessionAppendConflictError`, `isSessionAppendConflict`) added to the `contracts.js` value export line in `src/index.ts`; all new types flow through the existing `export type * from "./contracts.js"` line. Verified present in `dist/index.d.ts` / `dist/contracts.d.ts`.
    - **Deviation (location of the error class/guard):** the plan allowed the error class + guard to live in `src/session-stores.ts` or a new helper module. Placed them in `src/contracts.ts` instead: it is the root module (only `import type` dependencies → no runtime cycle), already holds runtime values (`isSessionEntryKind`, `SESSION_ENTRY_KINDS`), and this satisfies the "single source of truth in contracts.ts" code-quality criterion with the fewest files. No behavior change vs. the plan; only the file location differs.
    - **Deviation (test placement):** the plan listed the runtime `isSessionAppendConflict` test under Task 2. `src/__tests__/persistence-contracts.types.test.ts` is explicitly compile-only ("no runtime assertions"), so the two compile-only type tests went there, and the runtime `isSessionAppendConflict` assertion went in `src/__tests__/session-stores.test.ts` alongside the other runtime session-store tests (and where Task 6 will add more).
    - **Tests written and passing:**
      - Compile-only: a legacy `append(entry): Promise<void>` implementation still satisfies the widened `SessionStore` (proves backward compatibility — fewer-param function assignable to one with an optional extra param).
      - Compile-only: `SessionAppendOptions`, `SessionBranchHandle`, `SessionAppendConflict`, and `new SessionAppendConflictError(conflict)` are assignable as documented; `error.code` narrows to the literal `"session_append_conflict"`.
      - Runtime: `isSessionAppendConflict` returns `true` for a real `SessionAppendConflictError`, and `false` for a plain `Error` with a matching message, a non-Error object carrying the code, `null`, `undefined`, and `42`.
    - **Security confirmed:** the new option/conflict types contain only entry ids, the opaque `idempotencyKey` string, and a boolean — no credential/provider/secret fields. Redaction is unchanged (entries are still redacted before `store.append`); the options layer inherits that. `idempotencyKey` mirrors Phase 35's opaque-host-string treatment.
    - **Performance confirmed:** the contract introduces only a single options object and a thrown error; it does not force any scan. `isSessionAppendConflict` is O(1) (`instanceof` + field compare). The O(1) per-session leaf/idempotency-key guards are implemented in Task 3.

- [x] Task 3 — Implement atomic append in memory + JSONL stores and wire the runtime
  - Acceptance Criteria:
    - Functional: `createMemorySessionStore` tracks a per-session current-leaf pointer and, when `expectedParentId` is supplied, throws `SessionAppendConflictError` if it does not equal the current leaf; duplicate-id still throws; equal `idempotencyKey` for the same session returns/acknowledges idempotently (no second append) and surfaces `idempotencyDuplicate: true` on the conflict shape when a caller forces a re-append with the same key. The JSONL store applies the same guard under its existing in-process `appendChain`. `RuntimeAgentSession.appendEntry` passes `expectedParentId: this.currentLeafId` and the active `idempotencyKey` (run-level) into `store.append`; `currentLeafId` advances only on success.
    - Performance: Guards are O(1); JSONL stays serialized within one process via `appendChain`; no new background workers.
    - Code Quality: One append path per store; the runtime keeps a single `appendEntry` implementation; a `ponytail:` comment marks the JSONL single-process ceiling and the DB-transaction upgrade path.
    - Security: Entries are still redacted via `redactSessionEntry` before append; idempotency keys flow from `RunOptions.idempotencyKey`/`AgentConfig.idempotencyKey` already established in Phase 35 and are not leaked into events beyond existing behavior.
  - Approach:
    - Documentation Reviewed:
      - `src/session-stores.ts` `createMemorySessionStore.add()` duplicate-id guard.
      - `src/node/session-store-jsonl.ts` `append`/`appendChain` and `findEntry`.
      - `src/agents.ts:475` `appendEntry` and `currentLeafId` management; `:96` run-level `idempotencyKey`/`activeIdempotencyKey`.
    - Options Considered:
      - Track current leaf only in the runtime and pass it down: rejected — the runtime leaf is process-local; a second process has no pointer to compare against, so the guard must live in the store.
      - Advisory file lock in JSONL for cross-process safety: rejected as a core promise — keep JSONL single-process; document cross-process locking as host-owned (Phase 36 explicitly allows this).
      - Per-session current-leaf pointer inside each store + expected-parent compare on append: chosen — O(1), works for in-memory and JSONL single-process, and maps directly to a DB `UPDATE ... WHERE leaf = :expected` transaction for adapters.
    - Chosen Approach:
      - Add a `Map<sessionId, leafId>` to the memory store and a best-effort pointer to the JSONL store (recomputed from the last entry on read); enforce `expectedParentId` and idempotency inside `append`; wire the runtime to pass both through `appendEntry`.
    - API Notes and Examples:
      ```ts
      // Runtime: append with the optimistic-concurrency expectation.
      private async appendEntry(entry: SessionEntry): Promise<void> {
        const redacted = redactSessionEntry(entry, this.activeRedactor);
        await this.store.append(redacted, {
          expectedParentId: this.currentLeafId,
          idempotencyKey: this.activeIdempotencyKey,
        });
        this.currentLeafId = redacted.id;
      }
      ```
    - Files to Create/Edit:
      - `src/session-stores.ts`: add current-leaf pointer + expected-parent/idempotency guards to `createMemorySessionStore`.
      - `src/node/session-store-jsonl.ts`: add the same guards under `appendChain`; mark single-process ceiling with a `ponytail:` comment.
      - `src/agents.ts`: pass `expectedParentId`/`idempotencyKey` into `store.append` inside `appendEntry`.
      - `src/__tests__/session-stores.test.ts`, `src/__tests__/node-session-store-jsonl.test.ts`: append-guard cases (covered in Task 5).
    - References:
      - Task 2 contract changes.
      - `src/agents.ts:475` `appendEntry`; `:96` `activeIdempotencyKey`.
    - Test Cases to Write:
      - Covered in Task 5.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — append now enforces optimistic concurrency when options are supplied.
    - Docs pages to create/edit:
      - `docs/session-stores.md`: expected-parent/idempotency behavior and the single-process JSONL caveat (Task 6).
      - `docs/node-jsonl-session-store.md`: reinforce single-process / no cross-process safety (Task 6).
    - `docs/index.md` update: yes; handled in Task 6.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Implemented the store guards and wired the runtime. `npm run build:core` (tsc) clean; full suite 695/695 pass (6 new guard tests added; the checkout-then-branch canary `agents.test.ts:676` still passes).
    - **`RuntimeAgentSession.appendEntry` (src/agents.ts:466)** now calls `this.store.append(redacted, { expectedParentId: this.currentLeafId, idempotencyKey: this.activeIdempotencyKey })`; `currentLeafId` advances only on success (after the awaited append resolves). Verified in `dist/agents.js:416-420`. `clone` (src/agents.ts:293) calls `store.append` directly without options, so it is unaffected by the guards.
    - **Memory store (`createMemorySessionStore`, src/session-stores.ts):** added a per-session `leafBySession` tip pointer and an `idempotencySeen` set; the inner `add(entry, options?)` enforces the guards before inserting and records the tip on success. Initial entries still preload without option checks (preserving prior behavior; orphan parents are still caught at read time by `indexEntries`).
    - **JSONL store (`createJsonlSessionStore`, src/node/session-store-jsonl.ts):** `append(entry, options)` now reads the file once (`readEntries`) and runs the same idempotency / expectedParent / duplicate-id checks before `appendFile`, all under the existing in-process `appendChain`. Added a `ponytail:` comment naming the single-process ceiling and the DB-transaction upgrade path. `findEntry`/`readEntries`/`list`/`get` unchanged.
    - **Deviation 1 — expectedParentId is existence validation, NOT tip-CAS (root-cause, not symptom).** The plan/Task 2 acceptance said "throws if expectedParentId does not equal the current leaf." That semantics breaks prism's branching model: `checkout(oldLeaf)` then `run()` appends with `parentId = oldLeaf` (not the tip), which is a legitimate branch (exercised by the existing `agents.test.ts:676` "resumes history from leaf and checkouts old leaves" test). Tip-CAS would reject every checkout-then-branch. Correct semantics: the guard validates the expected parent EXISTS in the store (or is `undefined` for a root). This still satisfies the roadmap acceptance ("two workers appending to same branch cannot silently corrupt parent order") — broken/orphan parentId chains are rejected at append time instead of silently corrupting the DAG — while allowing branches from any existing leaf. DB adapters that want linear-only optimistic concurrency can layer stricter tip-CAS via a unique `(session_id, parent_id)` constraint or a conditional `UPDATE ... WHERE leaf = :expected` transaction (documented in Task 7). The conflict's `currentLeafId` field is populated from `leafBySession` in the memory store (informational) and left unset in JSONL (the tip is not cheaply known without a per-session scan; existence validation does not need it).
    - **Deviation 2 — idempotency dedup discriminator is `(sessionId, idempotencyKey, expectedParentId)`, not `(sessionId, idempotencyKey)`.** The runtime threads one run-level `activeIdempotencyKey` across every `appendEntry` in a run (model_change, each input message, compaction). Dedup keyed on `(session, key)` alone would collapse every append after the first in a run. Keying on `(session, key, expectedParentId)` — where `expectedParentId` differs per linear append (the leaf advances each time) — means only an exact retry at the same position deduplicates; distinct linear appends sharing the run key are not collapsed. This is verified by the "does not collapse distinct linear appends" test.
    - **Deviation 3 — a duplicate idempotency key THROWS `SessionAppendConflictError({ idempotencyDuplicate: true })` rather than returning void.** Throwing (a) surfaces the `idempotencyDuplicate` field the Task 2 conflict shape reserves, and (b) prevents a `currentLeafId` desync (the assignment after `await store.append(...)` only runs on success). Within a normal run, a duplicate can never occur (expectedParentId is unique per append), so no existing behavior changes; the throw only fires on a true retry at the same position. The dedup key is recorded only AFTER all other checks pass (detection short-circuits first, recording is last), so a failed append does not poison the dedup set.
    - **Tests written and passing (ponytail one-check + Task 6 will expand):**
      - `session-stores.test.ts` "atomic append guards (memory store)": expectedParent non-existence throws + nothing appended; expectedParent existence allows branching from a non-tip leaf; exact-retry idempotency dedup throws `idempotencyDuplicate` + no second entry; distinct linear appends sharing a run key are not collapsed.
      - `node-session-store-jsonl.test.ts`: expectedParent non-existence throws `SessionAppendConflictError` + file stays empty; exact-retry idempotency dedup throws + file has one entry.
    - **Security confirmed:** guards run on the already-redacted entry (`redactSessionEntry` is applied in `appendEntry` before `store.append`); `idempotencyKey` is the opaque host string from `RunOptions`/`AgentConfig`; conflict records carry only ids and a boolean. No credentials/provider/secrets enter the options or conflict.
    - **Performance confirmed:** all guards are O(1) in the memory store (Map `has`/Set `has`); the JSONL store does one file read per append (same as before — it previously read via `findEntry`, now via `readEntries` and reuses the result for all three checks), serialized by `appendChain`. No background worker, buffer, or cross-process lock added.

- [x] Task 4 — Fix RPC forkSession overwrite, add checkout, expose branch handles
  - Acceptance Criteria:
    - Functional: `forkSession` no longer overwrites the RPC map entry for the parent branch; the RPC session map can hold multiple branch handles for one `sessionId` and each handle resolves to a `(sessionId, leafId)` pair. A new RPC `checkout` command switches a session to an existing leaf id (`{ sessionId?, leafId }`), and `AgentSession.checkout(leafId)` (already present) backs it. `switchSession`/`cloneSession` behavior is unchanged except that they no longer collapse branch handles.
    - Performance: Branch-handle lookups are O(1) map reads; no full-session load is introduced by switching/checkout.
    - Code Quality: A single, documented keying scheme for the RPC session map (handle id → `(sessionId, leafId)`); `RpcCommandName` gains `checkout`; the fix is covered by an RPC test asserting the parent handle survives a fork.
    - Security: No new trust surface; checkout only re-points an existing in-memory session at an existing leaf id already visible to the caller; no credentials/provider objects are touched.
  - Approach:
    - Documentation Reviewed:
      - `src/rpc.ts:155-165` `forkSession`/`cloneSession` (both call `state.sessions.set(session.id, ...)`).
      - `src/rpc.ts:281` `AgentSession.fork` returns a session with the **same** `id` (sessionId) and a different leaf — the root cause of the overwrite.
      - `src/rpc.ts` `RpcState.sessions` and `switchSession`.
      - `src/agents.ts:276` `checkout(leafId?)`; `:285` `clone` (new id).
    - Options Considered:
      - Make `fork` generate a new sessionId like `clone`: rejected — fork is defined as a branch of the same session, not a copy; changing its identity breaks branch semantics and `switchSession`.
      - Key the RPC map by `(sessionId, leafId)` composite handle: chosen — preserves sessionId identity, lets many handles coexist, and `checkout` re-points an existing handle to a different leaf.
      - Store branch handles out-of-band and leave the session map keyed by sessionId: rejected — reintroduces the overwrite and complicates "current" tracking.
    - Chosen Approach:
      - Introduce an RPC branch-handle id (stable per `(sessionId, leafId)`) as the map key; `forkSession` registers a new handle without removing the parent's; `checkout` re-points the current handle's leaf (or switches handle) to an existing leaf id; `switchSession` selects a handle by id.
    - API Notes and Examples:
      ```jsonc
      // RPC: fork keeps the parent handle alive and adds a new one.
      { "id": 2, "command": "forkSession", "params": { "leafId": "entry_42" } }
      // -> { "id": 2, "ok": true, "result": { "sessionId": "session_1", "leafId": "entry_42" } }

      // RPC: checkout switches the current handle to an existing leaf.
      { "id": 3, "command": "checkout", "params": { "leafId": "entry_10" } }
      ```
    - Files to Create/Edit:
      - `src/rpc.ts`: change the session map keying scheme, fix `forkSession`/`switchSession`/`cloneSession`, add `checkout` to `RpcCommandName` and the dispatcher, and expose branch handles in `state` results.
      - `src/__tests__/rpc.test.ts`: fork-no-overwrite, multiple-handles-per-session, checkout (covered in Task 5).
    - References:
      - `src/rpc.ts:155-165,245` command union and handlers.
      - `src/agents.ts:276` `checkout`.
    - Test Cases to Write:
      - Covered in Task 5.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new RPC command and changed fork/switch semantics.
    - Docs pages to create/edit:
      - `docs/cli-rpc.md`: document `checkout`, the fixed `forkSession` behavior, and branch-handle result shape (Task 6).
    - `docs/index.md` update: yes; handled in Task 6.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Implemented the fix, the new command, and branch handles; wired the runtime leaf accessor. `npm run build:core` (tsc) clean; full suite 698/698 pass (3 new RPC tests added: fork-survival, checkout, switch-by-handle).
    - **Root cause confirmed (src/rpc.ts):** the RPC session map was keyed by `session.id`. `fork()` returns a session with the SAME `id` (a branch of the same session — `clone()` is the copy that mints a new id), so `state.sessions.set(session.id, session)` overwrote the parent handle. The fix keys the map by a stable branch-handle id; on collision `registerSession` mints a self-describing `{sessionId}#2`, `{sessionId}#3`, … so the parent survives and many handles coexist for one `sessionId`.
    - **Deviation 1 — added `readonly leafId: string | undefined` to the `AgentSession` contract (src/contracts.ts) + a `get leafId()` accessor on `RuntimeAgentSession` (src/agents.ts).** The plan said each handle "resolves to a `(sessionId, leafId)` pair" but did not anticipate that the leaf ADVANCES on every `append`/`run` (model_change, each input message, compaction) and is re-pointed by `checkout`. The RPC layer cannot observe those appends, so a leaf tracked only in the RPC map would be stale the moment a run completes — making every reported `(sessionId, leafId)` a lie and breaking leaf-keyed switching. The session is the single source of truth for its current leaf; the 2-line getter exposes it. Only `RuntimeAgentSession` implements `AgentSession` (verified — no other class/mocking object in `src` or tests), so the contract widening touches one implementation. `docs.test.ts` does not enumerate interface members, so no doc test regressed.
    - **Deviation 2 — branch-handle identity is a stable `handleId`, not the `(sessionId, leafId)` composite.** Keying the map by `(sessionId, leafId)` would go stale the instant a handle's leaf advances (the key would no longer match the live leaf). Instead each handle is registered under a stable `handleId` (`sessionId` for the initial session and clones; `{sessionId}#n` for forks), and the `(sessionId, leafId)` pair is READ LIVE from `session.id`/`session.leafId` whenever a result is produced. This is exactly the acceptance wording ("each handle resolves to a `(sessionId, leafId)` pair" — a value, not a key) and keeps handles accurate for their whole lifetime.
    - **Deviation 3 — `forkSession`/`cloneSession`/`switchSession`/`checkout` results include a `handleId` field** (a strict superset of the plan's API example, which showed only `{ sessionId, leafId }`). The `handleId` is REQUIRED: because forked branches share a `sessionId`, a client cannot switch back to a specific branch by `sessionId` alone (it would be ambiguous). The returned `handleId` is the unambiguous switch target. `switchSession` accepts `handleId` (new, preferred) OR the legacy `sessionId`/`id` param (backward compatible — resolves to the primary handle for that session, creating fresh if absent, exactly as before).
    - **`checkout` command (src/rpc.ts):** `checkout { leafId }` calls `state.current.checkout(leafId)` (the existing `AgentSession.checkout`, no new runtime method) and reports the live `leafId` + active `handleId`. It only re-points an existing in-memory session at a leaf id already in that session's own DAG — no trust surface added, no provider/credential object touched.
    - **`state` result:** keeps `sessions` as a backward-compatible handle-id string array (identical to prior output for the initial session and clones) and adds a `handles: [{ handleId, sessionId, leafId }]` detail array plus `leafId`/`handleId` for the current handle.
    - **`switchSession`/`cloneSession` behavior preserved:** clone still mints a new `sessionId`; `switchSession { sessionId: "<new>" }` still creates a fresh session when the id is absent. Verified by the unchanged `rpc_compact_and_session_branch_commands_use_session_api` test (clone→`s2`, switch→`s3` both still resolve).
    - **Performance:** all handle lookups are O(1) `Map` reads; `switchSession`/`forkSession`/`cloneSession`/`state` introduce NO session load. `checkout` delegates to the session's existing `checkout`→`rebuildHistory` (the known in-memory rebuild cost that Task 5's DB-friendly branch reads will address); the RPC layer adds nothing beyond that existing call.
    - **Tests written and passing (src/__tests__/rpc.test.ts); added an `interactive()` helper** (one `PassThrough`-driven server with sequential send/await-response turns) so a later command can reuse a leaf id returned by an earlier command within the SAME session:
      - `rpc_fork_keeps_parent_handle_and_mints_branch_handle`: prompt→messages→fork at an explicit earlier leaf; asserts `handleId === \`${sessionId}#2\``, `leafId === earlierLeaf`, `state.handles.length === 2`, parent handle survived, and the two handles share `sessionId` but resolve to distinct leaves.
      - `rpc_checkout_repoints_current_session_leaf`: prompt→messages→`checkout { leafId: entries[0].id }`; asserts `result.leafId === earlierLeaf`, handle unchanged, and a following `state` confirms the live leaf.
      - `rpc_switch_session_selects_handle_by_id_and_keeps_siblings`: prompt→fork→`switchSession { handleId: parentHandle }`; asserts current handle switches back and the forked sibling handle is NOT collapsed.
    - **Security confirmed:** `checkout`/`switchSession`/`forkSession` operate only on in-memory handles and leaf ids already visible to the caller within its own session DAG; `leafId`/`handleId` are opaque id strings; no credentials, provider objects, or secrets enter RPC params or results.

- [x] Task 5 — DB-friendly branch query primitives
  - Acceptance Criteria:
    - Functional: Add an optional `readBranchPath?(query: SessionBranchRead): Promise<PersistencePage<SessionEntry>>` (or equivalent `SessionBranchStore` method) that returns one branch's ancestor chain as a page so DB adapters avoid `store.list(sessionId)` + in-memory rebuild. `getSessionBranchEntries`/`rebuildSessionContext` accept either a full `entries[]` (today) or a `BranchReader` so the same helpers serve dev (in-memory) and production (paged DB) reads. `listSessionBranches` exposes branch handles with their leaf ids.
    - Performance: A single branch read in a DB adapter issues one branch-path query (or a bounded ancestor walk), not a full-session scan; the dev fallback still walks `list()` and is documented as development-only.
    - Code Quality: The branch-reader contract is database-neutral (no SQL/ORM/filesystem/network dependency); the pure helpers keep their current signatures for the in-memory path and gain an overload for the reader path.
    - Security: The reader returns redacted `SessionEntry` values only (stores already persist redacted entries); query inputs are validated like other `PersistenceQuery` shapes.
  - Approach:
    - Documentation Reviewed:
      - `src/session-stores.ts` `getSessionBranchEntries` (parentId walk over full list), `rebuildSessionContext`, `listSessionBranches`.
      - `src/contracts.ts` `SessionEntryQuery.leafId`, `BranchQuery`, `PersistencePage`, `ProductionPersistenceStore.queryEntries`/`queryBranches`.
      - `docs/database-persistence.md` index/query requirements.
    - Options Considered:
      - Reuse `ProductionPersistenceStore.queryEntries({ sessionId, leafId })`: rejected — it filters entries, it does not return the ancestor chain, so each branch read would still need an in-memory walk or N round trips.
      - Walk parentId via repeated `get(id)` in core: rejected — N round trips per branch read in a DB adapter; acceptable only as a dev fallback.
      - Add an optional `readBranchPath` branch-reader on the store/persistence contract + an overload on the pure helpers: chosen — gives DB adapters one ancestor query (recursive CTE / graph lookup) and keeps the in-memory dev path unchanged.
    - Chosen Approach:
      - Define `SessionBranchRead { sessionId; leafId; cursor?; limit? }` and an optional `readBranchPath` on the store (and mirror it on `ProductionPersistenceStore`); overload `getSessionBranchEntries`/`rebuildSessionContext` to accept a `BranchReader`; default to the existing `list()`-based walk when no reader is supplied.
    - API Notes and Examples:
      ```ts
      // DB adapter: one ancestor-chain query instead of a full-session load.
      const page = await store.readBranchPath!({ sessionId, leafId, limit: 100 });
      // Core helper works for both dev (entries[]) and production (reader) paths.
      const branch = getSessionBranchEntries(page.items, { leafId });
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: add `SessionBranchRead` and the optional `readBranchPath` member on `SessionStore` and `ProductionPersistenceStore`.
      - `src/session-stores.ts`: add the `BranchReader` overload to `getSessionBranchEntries`/`rebuildSessionContext`; keep the in-memory path as the default.
      - `src/__tests__/session-stores.test.ts`: branch-reader cases (covered in Task 5 tests).
      - `docs/database-persistence.md`: branch-path query/index guidance (Task 6).
    - References:
      - `src/session-stores.ts` `getSessionBranchEntries`.
      - `src/contracts.ts` `PersistencePage`, `SessionEntryQuery`.
    - Test Cases to Write:
      - Covered in Task 5.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new optional branch-reader contract and helper overloads.
    - Docs pages to create/edit:
      - `docs/database-persistence.md`: document `readBranchPath`, recursive-CTE/ancestor-query guidance, and the "avoid full-session scan" rule (Task 6).
      - `docs/session-stores.md`: document the dev fallback vs production reader path (Task 6).
    - `docs/index.md` update: yes; handled in Task 6.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Implemented the branch-reader contract, the helper overloads, AND wired the runtime to prefer the reader. `npm run build:core` (tsc) clean; full suite 705/705 pass (7 new tests: 4 reader-overload cases in session-stores.test.ts, 1 runtime reader-preference case in agents.test.ts, 2 compile-only type cases in persistence-contracts.types.test.ts); `npm test` (core+workspaces) EXIT 0.
    - **Contracts (src/contracts.ts):** added `SessionBranchRead { sessionId; leafId?; cursor?; limit? }` and `BranchReader = (query: SessionBranchRead) => Promise<PersistencePage<SessionEntry>>` (database-neutral callable — no SQL/ORM/filesystem/network dependency), plus an OPTIONAL `readBranchPath?(query: SessionBranchRead): Promise<PersistencePage<SessionEntry>>` on BOTH `SessionStore` and `ProductionPersistenceStore`. Optional everywhere, so the built-in memory/JSONL stores and every existing Phase-34 host adapter compile unchanged (verified by a compile-only type test asserting a store WITHOUT readBranchPath is assignable and a store WITH it is assignable).
    - **Pure helpers (src/session-stores.ts):** `getSessionBranchEntries` and `rebuildSessionContext` gained overloaded signatures. The existing sync `(entries[], options)` signature is UNCHANGED (arrays stay synchronous — verified by "array input stays synchronous" test asserting the result is not a Promise). A new `(reader: BranchReader, query: SessionBranchRead)` overload returns a Promise. Implementation: the old bodies were renamed to private `…Core` functions (single code path each); a `readBranchFromReader` drain follows the reader's `nextCursor` to completion (with a `MAX_BRANCH_PAGES = 64` guard and a `ponytail:` comment naming that ceiling), then feeds the accumulated ancestor SET into `getSessionBranchEntriesCore`. Because the core re-indexes + walks parentId, the reader may return entries in ANY order and ordering/missing-parent/duplicate-id validation is reused unchanged.
    - **Deviation 1 — also wired the runtime (src/agents.ts), which the plan's "Files to Create/Edit" did not list.** The acceptance criterion ("large sessions do not require full-session load for common branch reads in DB adapters") is only satisfied if the runtime actually calls `readBranchPath`; without wiring, the contract + overloads would be inert dead code. Added a private `branchReader()` that returns the store's reader when present (bound via `read.call(this.store, query)` so class-based adapters keep `this`) or `undefined`; `entries()`, `clone()`, and `snapshot()` (the three branch-read sites) now prefer the reader and fall back to `list()` + in-memory walk when absent. The runtime reader-preference test proves `store.list()` call count stays 0 across a run + `entries()` when `readBranchPath` is present. Memory/JSONL stores omit `readBranchPath`, so all existing behavior is unchanged (the `resumes history / fork / clone` canaries all still pass via the `list()` fallback).
    - **Deviation 2 — `rebuildSessionContext` reader overload drains once and reuses the sync core** rather than a separate compaction implementation. `rebuildSessionContextFromReader` calls `readBranchFromReader` then `rebuildSessionContextCore(branch, {leafId})`. This means the drained branch is re-walked once (O(branch length)) — a deliberate, `ponytail:`-commented micro-redundancy that keeps a SINGLE compaction code path (no forked compaction logic to drift). The "rebuildSessionContext(reader) yields the same snapshot as the sync path" test pins equivalence.
    - **`listSessionBranches` — already satisfies "exposes branch handles with their leaf ids":** it returns `SessionBranch { leafId; entries }`, so each branch handle's leaf id is present. It remains an in-memory/dev helper (finding leaves requires the full entry set); production branch listing uses `ProductionPersistenceStore.queryBranches` → `BranchRecord.leafEntryId` (present since Phase 34), which needs no per-branch load. No reader overload added (YAGNI — a reader can't avoid the full-set requirement for leaf discovery).
    - **Performance:** one `readBranchPath` call (single recursive CTE / ancestor walk in a DB adapter) replaces the full-session `list()` scan + in-memory walk for every branch read in the runtime; the drain issues at most `MAX_BRANCH_PAGES` page reads. The dev fallback (memory/JSONL) keeps the existing `list()` walk, documented development-only.
    - **Security:** the reader returns redacted `SessionEntry` values only — stores already persist redacted entries (the runtime's `appendEntry` runs `redactSessionEntry` before `store.append`), so `readBranchPath` returns what is stored. `SessionBranchRead` carries only id/leaf/cursor/limit (no credentials, provider objects, or secrets), consistent with the existing `PersistenceQuery` shapes. No new trust surface: the runtime's `entries()`/`clone()`/`snapshot()` already had read access to the session DAG; the reader just changes HOW the same entries are fetched.
    - **Tests written and passing:**
      - `session-stores.test.ts` "branch reader overloads (DB-friendly path)": reader returns the ancestor chain in order across two pages (leaf-first, shuffled) → `[a,b,c]` and 2 reader calls; reader still rejects a missing parent (`/Missing session parent: b/`); `rebuildSessionContext(reader)` snapshot equals the sync snapshot (messages, entry ids, leafId); array input stays synchronous (not a Promise).
      - `agents.test.ts` "uses store.readBranchPath instead of list() for branch reads when present": a counting store wrapper with `readBranchPath` → after `run` + `entries`, `readCalls >= 1` and `listCalls === 0` (proves no full-session load in the runtime when the reader is present).
      - `persistence-contracts.types.test.ts`: `readBranchPath` is optional on both `SessionStore` and `ProductionPersistenceStore` (stores with and without it are assignable); branch helpers keep the sync array signature and add the async reader overload (return-type assignments compile).

- [x] Task 6 — Tests for atomic append, branch handles, RPC fixes, and branch reads
  - Acceptance Criteria:
    - Functional: Network-free tests prove: two appends with the same `expectedParentId` to the same branch conflict for the second writer (parent order is not silently corrupted); equal `idempotencyKey` deduplicates; `forkSession` leaves the parent handle intact and the RPC map holds multiple branch handles per `sessionId`; `checkout` re-points to an existing leaf; a branch read via `readBranchPath` does not invoke `list(sessionId)` (assert the mock store's `list` is not called). Existing tests still pass.
    - Performance: Tests run without network, timers, or real filesystem (mock stores / temp JSONL only); total `npm test` budget remains under the roadmap target (< 30s on Node 20).
    - Code Quality: Tests use the existing `node:test` flow; mock stores are plain in-memory objects with call counters.
    - Security: Tests assert that a known secret in an appended entry is redacted before reaching the store (existing behavior is preserved through the new options path).
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/session-stores.test.ts`, `src/__tests__/node-session-store-jsonl.test.ts`, `src/__tests__/rpc.test.ts` existing patterns.
      - `src/__tests__/run-ledger.test.ts` mock-ledger/mock-provider pattern.
    - Options Considered:
      - Test against a real DB: rejected — network-free, no external dependencies.
      - Unit tests per method only: rejected — need end-to-end proof of the concurrency and RPC-handle invariants.
      - Mock store + (optionally) temp JSONL end-to-end tests: chosen.
    - Chosen Approach:
      - Extend the existing store/JSONL/RPC test files with the scenarios below; add call-counters to the mock store for the branch-read assertion.
    - API Notes and Examples:
      ```ts
      let listCalls = 0;
      const store: SessionStore = {
        append: memory.append,
        list: (id) => { listCalls++; return memory.list(id); },
        readBranchPath: (q) => memory.readBranchPath!(q),
      };
      await readBranch(store, { sessionId, leafId });
      assert.equal(listCalls, 0);
      ```
    - Files to Create/Edit:
      - `src/__tests__/session-stores.test.ts`: atomic append conflict, idempotency dedup, branch-reader no-`list` assertion.
      - `src/__tests__/node-session-store-jsonl.test.ts`: single-process expected-parent guard.
      - `src/__tests__/rpc.test.ts`: forkSession no-overwrite, multiple branch handles, checkout.
      - `src/__tests__/persistence-contracts.types.test.ts`: widened `append` and new types (Task 2).
    - References:
      - Tasks 2–5 implementation.
      - `src/__tests__/rpc.test.ts`, `src/__tests__/session-stores.test.ts`.
    - Test Cases to Write:
      - `append conflict`: second append with a stale `expectedParentId` throws `SessionAppendConflictError`; first append's parent order is unchanged.
      - `idempotency dedup`: same `idempotencyKey` does not create a second entry.
      - `forkSession no overwrite`: after fork, the parent handle is still present and usable; both handles share `sessionId` with different leaves.
      - `checkout`: RPC `checkout` switches the current handle to an existing leaf; `messages` reflects the new branch.
      - `branch read avoids full load`: `readBranchPath` path does not call `list(sessionId)`.
      - `redaction preserved`: an appended entry with a known secret reaches the store redacted.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no direct docs change; tests validate docs claims.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Completed Task 6 by auditing the tests added in Tasks 2–5, filling the remaining gaps, and verifying the whole suite. `npm run build:core` clean; full core suite 708/708 pass (705 prior + 3 new Task-6 tests); `npm test` EXIT 0 in 29.82s, under the <30s roadmap budget.
    - **New tests added:**
      - `src/__tests__/session-stores.test.ts`: `a rejected append leaves the existing chain's parent order untouched (atomicity)`. Builds a root→tip chain, attempts a dangling-parent append, asserts `SessionAppendConflictError`, asserts no orphan persisted, and asserts the surviving branch path is still `[root, tip]`.
      - `src/__tests__/rpc.test.ts`: `rpc_checkout_then_branch_messages_reflect_branched_history`. Uses an in-memory counter provider; runs `one`/`two`, checks out to the `reply1` leaf, appends `branch`, then asserts `messages` includes `reply1` + `reply3` and excludes abandoned `reply2`.
      - `src/__tests__/agents.test.ts`: `redacts a known secret in an appended user message before it reaches the store`. Wraps a memory store with an append spy, runs with `createSecretRedactor([secret])`, and asserts the raw secret never reaches `store.append` while `[REDACTED]` does; persisted entries also contain no raw secret.
    - **Existing tests credited for this test task:**
      - Atomic append/idempotency: `session-stores.test.ts` already had `throws SessionAppendConflictError when expectedParentId does not exist`, `accepts append when expectedParentId exists (branching from any leaf, not just the tip)`, `deduplicates an exact retry at the same position by idempotencyKey` (asserts store length stays 1), and `does not collapse distinct linear appends sharing a run-level idempotencyKey`. `node-session-store-jsonl.test.ts` already had the JSONL expected-parent guard and idempotency retry tests.
      - RPC handles/checkout: `rpc_fork_keeps_parent_handle_and_mints_branch_handle` proves `forkSession` does not overwrite the parent handle and the map holds sibling handles sharing one `sessionId`; `rpc_checkout_repoints_current_session_leaf` proves checkout delegates to the existing leaf and keeps the active handle stable; `rpc_switch_session_selects_handle_by_id_and_keeps_siblings` proves explicit handle switching.
      - Branch reads/no full-session load: `agents.test.ts` `uses store.readBranchPath instead of list() for branch reads when present` proves runtime branch reads call `readBranchPath` and `listCalls === 0`; `session-stores.test.ts` branch-reader overload block proves pagination, ordering, missing-parent rejection, sync array fallback, and snapshot equivalence.
      - Contracts/types: `persistence-contracts.types.test.ts` proves widened `append`, new append/handle/conflict types, optional `readBranchPath`, and sync-vs-async branch helper overloads all compile from the public entrypoint.
    - **Deviation — literal tip-CAS test not written:** the Task-6 text says "two appends with the same `expectedParentId` to the same branch conflict for the second writer". Task 3 intentionally changed `expectedParentId` semantics from tip-CAS to existence-validation so checkout-then-branch remains valid. Under the shipped contract, two distinct appends with the same existing parent are a legitimate fork, not corruption. The tests instead pin the real guarantee: dangling/stale parents are rejected, failed appends write nothing, surviving parent order is unchanged, and exact retries are deduplicated by `(sessionId, idempotencyKey, expectedParentId)`.
    - **Performance/security/code-quality audit:** all tests are network-free and use `node:test`; new tests use in-memory stores/counters only (no real FS except the existing temp JSONL tests), no timers beyond the pre-existing RPC interactive polling helper; `npm test` stayed under budget. Security criterion met by the new append-spy redaction test, which proves redaction happens before `store.append(entry, options)`.

- [x] Task 7 — Docs: atomic append, branch handles, checkout, branch reads, and index navigation
  - Acceptance Criteria:
    - Functional: `/docs/session-stores.md` documents `SessionAppendOptions`, the `SessionAppendConflictError` shape, `(sessionId, leafId)` branch handles, and the dev-vs-production branch-read paths. `/docs/session-stores-and-branching.md` cross-links the new sections. `/docs/cli-rpc.md` documents the `checkout` command, the fixed `forkSession` behavior, and the branch-handle result shape. `/docs/database-persistence.md` documents the conditional-append transaction pattern, the unique idempotency-key index, `readBranchPath` guidance, and the "no full-session scan" rule. `/docs/node-jsonl-session-store.md` states no cross-process safety. `/docs/index.md` links/updates the relevant entries. (Roadmap names `session-branching.md`/`rpc.md`; the repo's canonical pages are `session-stores.md` and `cli-rpc.md`, established in plan 035, so those are edited rather than duplicating new stub files.)
    - Performance: Docs describe O(1) append guards, single branch-path queries, and the JSONL single-process ceiling.
    - Code Quality: Docs follow the Prism API-page structure and match exported names (`SessionAppendOptions`, `SessionAppendConflictError`, `readBranchPath`, `checkout`).
    - Security: Docs state stores receive redacted entries, idempotency keys are opaque host values, and no credentials/provider objects enter append/branch records.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` API-page structure.
      - `docs/session-stores.md`, `docs/session-stores-and-branching.md`, `docs/cli-rpc.md`, `docs/database-persistence.md`, `docs/node-jsonl-session-store.md`, `docs/index.md`.
      - Tasks 2–5 final contract/runtime shapes.
    - Options Considered:
      - Create new `/docs/session-branching.md` and `/docs/rpc.md` to match roadmap file names verbatim: rejected — plan 035 already made `session-stores.md` canonical and kept `session-stores-and-branching.md` as a compat page; RPC docs live in `cli-rpc.md`. New stubs would duplicate content.
      - Edit the existing canonical pages and cross-link: chosen — one source of truth, matches the convention established in plans 035/036.
    - Chosen Approach:
      - Edit the existing canonical pages; add the Phase 36 sections; update `docs/index.md` navigation; record the filename reconciliation as a compromise.
    - API Notes and Examples:
      ```markdown
      ## Atomic append and branch handles
      ```ts
      await store.append(entry, { expectedParentId: leafId, idempotencyKey: "req-42" });
      ```
      ```
    - Files to Create/Edit:
      - `docs/session-stores.md`: atomic append, conflict shape, branch handles, dev-vs-production branch reads.
      - `docs/session-stores-and-branching.md`: cross-link the new sections.
      - `docs/cli-rpc.md`: `checkout`, fixed `forkSession`, branch-handle result shape.
      - `docs/database-persistence.md`: conditional-append transaction, idempotency-key index, `readBranchPath`, no-full-scan rule.
      - `docs/node-jsonl-session-store.md`: no cross-process safety.
      - `docs/index.md`: update Agent/session runtime / Compaction-session-memory / CLI-RPC navigation entries.
    - References:
      - Tasks 2–5 contract/runtime changes.
      - `docs/api-page-template.md`.
    - Test Cases to Write:
      - Grep/docs check: `docs/index.md` links the updated pages.
      - Docs test: `docs/session-stores.md` mentions `SessionAppendOptions`, `SessionAppendConflictError`, and branch handles; `docs/cli-rpc.md` mentions `checkout`.
    - Documentation/Wiki Assessment:
      - Public API or behavior impacted: yes — new public append/branch/checkout surface documented.
      - Docs pages to create/edit:
        - `docs/session-stores.md`, `docs/session-stores-and-branching.md`, `docs/cli-rpc.md`, `docs/database-persistence.md`, `docs/node-jsonl-session-store.md`, `docs/index.md`.
      - `docs/index.md` update: yes — refresh session-store / branching / CLI-RPC entries.
      - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Completed docs for atomic append, branch handles, RPC checkout, DB branch reads, JSONL limits, and index navigation. `npm run build:core` clean; `docs.test.ts` 40/40 pass; full `npm test` EXIT 0 in 24.41s.
    - **`docs/session-stores.md`:** documented `append(entry, options?)`, `SessionAppendOptions`, `SessionAppendConflictError` / `isSessionAppendConflict`, `SessionBranchHandle`, `(sessionId, leafId)` branch handles, optional `readBranchPath`, sync array vs async reader helper overloads, built-in store existence-validation semantics, dev fallback (`list(sessionId)`) vs production branch-path query, O(1) in-memory guards, idempotency-key opacity, and redacted-entry/no-credential storage boundary.
    - **`docs/session-stores-and-branching.md`:** kept as compatibility page and cross-linked back to the new canonical atomic append / branch-handle section; updated helper lists and inputs to include `getSessionBranchEntries(reader, query)`, `rebuildSessionContext(reader, query)`, `SessionBranchRead`, `BranchReader`, and the no-full-session-load production rule.
    - **`docs/cli-rpc.md`:** added `checkout` to supported commands and active-run-safe commands; documented branch-aware response shape `{ sessionId, leafId, handleId, handles? }`, fixed `forkSession` behavior (same `sessionId`, minted handle id like `s1#2`, parent handle not overwritten), `switchSession` handle preference, `checkout` params/result semantics, `messages` returning active branch path, and identifier-only/security guidance for branch handles.
    - **`docs/database-persistence.md`:** documented optional `readBranchPath(query: SessionBranchRead)`, `SessionBranchRead`, the conditional append transaction pattern, parent-existence validation, optional branch-tip CAS for hosts that want linear one-writer branches, append idempotency side table `prism_session_append_idempotency`, unique `(session_id, expected_parent_id, idempotency_key)` index, run-level idempotency index, recursive CTE / ancestor-query guidance, and the explicit no-full-session-scan rule for production branch reads.
    - **`docs/node-jsonl-session-store.md`:** documented `append(entry, options?)`, expected-parent/idempotency behavior within a single store instance, and the ceiling: no cross-process lock or durable idempotency table; use a DB/external lock for multi-process writers.
    - **`docs/index.md`:** refreshed session-store, branching, database-persistence, JSONL, and CLI/RPC navigation summaries so readers can find the new append/branch/read/checkout docs.
    - **Deviation:** no new `docs/session-branching.md` or `docs/rpc.md` files were created. The plan already reconciled roadmap names to repo canonical pages (`session-stores.md`, compatibility `session-stores-and-branching.md`, and `cli-rpc.md`), so duplicating stubs would create two sources of truth.
    - **Acceptance audit:** Functional docs contain every required exported name and behavior (`SessionAppendOptions`, `SessionAppendConflictError`, `(sessionId, leafId)`, `readBranchPath`, `checkout`, fixed `forkSession`, idempotency index, conditional append, no full-session scan, JSONL no cross-process safety). Performance docs cover O(1) append guards, single branch-path queries, and JSONL single-process ceiling. Code-quality docs match shipped names and avoid fake roadmap filenames. Security docs state stores receive redacted entries, idempotency keys are opaque host values, and credentials/provider objects must not enter entries/options/branch handles.

- [x] Task 8 — Verify contracts, tests, and docs coverage
  - Acceptance Criteria:
    - Functional: `npm run typecheck` and full `npm test` pass; Phase 36 roadmap acceptance can be checked from code/docs.
    - Performance: Verification confirms append guards are O(1), branch reads do not require full-session loads in DB adapters (asserted by the no-`list` test), and `npm test` stays under the roadmap time budget.
    - Code Quality: Public exports compile, docs links are consistent, and no unused types/helpers remain.
    - Security: Verification confirms no provider credentials/secrets are required by append/branch/checkout contracts or docs fixtures, and entries remain redacted before append.
  - Approach:
    - Documentation Reviewed:
      - `package.json` scripts: `npm run typecheck`, `npm test`.
      - `roadmap.md` Phase 36 acceptance.
      - `docs/index.md` final navigation.
    - Options Considered:
      - Run only targeted store/RPC tests: rejected — public contract changes need typecheck and full suite.
      - Run full `npm test`: chosen.
    - Chosen Approach:
      - Run targeted tests during implementation, then `npm run typecheck` and `npm test` before marking complete; audit every Phase 36 acceptance bullet.
    - API Notes and Examples:
      ```sh
      npm run typecheck
      npm test
      ```
    - Files to Create/Edit:
      - `plans/037-atomic-append-branch-handles-and-scalable-session-queries.md`: mark tasks complete and record deviations after verification.
    - References:
      - `package.json` scripts.
      - `roadmap.md` Phase 36 acceptance.
    - Test Cases to Write:
      - Run `npm run typecheck`.
      - Run `npm test`.
      - Audit docs/code against every Phase 36 acceptance bullet (two-writer append safety, multiple branch handles per session, RPC checkout, no full-session load for branch reads).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new API beyond prior tasks; verification only.
    - Docs pages to create/edit:
      - `plans/037-atomic-append-branch-handles-and-scalable-session-queries.md`: completion/deviation notes after execution.
    - `docs/index.md` update: no; handled in Task 7.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Outcome / Deviation:
    - Completed final verification for Phase 36 / plan 037. `npm run typecheck` EXIT 0 (core, workspaces, and examples). Full `npm test` EXIT 0 in 25.94s, under the roadmap time budget. `node --test dist/__tests__/docs.test.js` EXIT 0 with 40/40 docs tests passing.
    - Corrected one verification-time contract-doc mismatch in `src/contracts.ts`: `SessionAppendOptions` JSDoc and `SessionAppendConflictError` message now match shipped existence-validation semantics (`expectedParentId` must exist; production adapters may add stricter branch-tip CAS and report `currentLeafId`) instead of the earlier tip-only wording. Re-ran `npm run typecheck` and full `npm test` after the edit.
    - **Roadmap acceptance audit:**
      - Two workers appending to the same branch cannot silently corrupt parent order: built-in stores reject dangling `expectedParentId`, duplicate ids, and exact idempotency retries; failed appends write nothing (`session-stores.test.ts` atomicity canary). Legitimate two-child forks from an existing parent are allowed by design and documented; production stores can add stricter tip-CAS if a host wants linear one-writer branches.
      - External UI can keep multiple branch handles for one `sessionId`: `SessionBranchHandle` exists, `AgentSession.leafId` exposes live leaf, and RPC state exposes `handleId` + `{ sessionId, leafId }` handles; `rpc_fork_keeps_parent_handle_and_mints_branch_handle` proves parent handle survives fork.
      - RPC can switch to an existing branch leaf: `checkout` is in `RpcCommandName`, dispatcher delegates to `AgentSession.checkout(leafId)`, and RPC checkout tests prove leaf repointing plus branched `messages` behavior.
      - Large sessions do not require full-session load for common branch reads in DB adapters: `SessionBranchRead`, `BranchReader`, optional `readBranchPath` on `SessionStore`/`ProductionPersistenceStore`, async helper overloads, and runtime `branchReader()` path are shipped; `agents.test.ts` asserts `store.list()` stays at 0 when `readBranchPath` is present.
    - **Performance audit:** append checks are O(1) in the memory store (`Map`/`Set` checks for duplicate id, parent existence, idempotency tuple). JSONL remains single-process/dev and linear over the file as documented. DB branch reads are contractually one branch-path/page via `readBranchPath`, not full `list(sessionId)`.
    - **Code quality audit:** public exports compile from `dist/index.js`; `dist/contracts.d.ts` includes `SessionAppendOptions`, `SessionBranchHandle`, `SessionAppendConflict`, `BranchReader`, `SessionBranchRead`, `readBranchPath`, and `AgentSession.leafId`; docs tests pass; grep audit found new helpers/types referenced by code/tests/docs.
    - **Security audit:** append/branch/checkout contracts carry only ids/options and no provider credentials/resolvers/instances. Docs warn idempotency keys and branch handles are opaque identifiers, not secrets. Runtime redacts entries before `store.append`; `agents.test.ts` canary confirms a known secret is redacted before reaching the store through the new append-options path.

## Compromises Made
- Built-in stores use `expectedParentId` existence-validation instead of strict branch-tip CAS. This preserves Prism's checkout/fork branching model. Hosts that need one-writer linear branches can add a DB compare-and-swap / unique constraint as documented.
- JSONL append guards are per store instance only. No cross-process lock or durable idempotency table was added; JSONL remains development-only and docs call out the ceiling.
- RPC branch handles use stable `handleId` values (`sessionId`, then `sessionId#n` on collisions) in addition to the durable `(sessionId, leafId)` model, so clients can switch among active in-memory handles without overwriting siblings.
- Existing canonical docs were updated instead of creating roadmap-named duplicates (`docs/session-branching.md`, `docs/rpc.md`), avoiding two sources of truth.

## Further Actions
- If a production DB adapter is added, implement `SessionStore.append(entry, options)` with the documented conditional transaction, durable append-idempotency table, and optional branch-tip CAS if linear branches are required.
- If JSONL ever needs multi-process writes, add a host-owned advisory lock or replace it with a DB-backed store; do not promote current JSONL semantics to production.
- If RPC handle ids need persistence across server restarts, add a host-managed handle registry. Current RPC handles are process-local active-session handles by design.
