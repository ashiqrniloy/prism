# Shared Work-Scope Observational Memory

Release: 0.9.0 (P2). Extends R16 per-session work scopes with an explicitly granted shared scope so recall spans a whole build, not one session (clay E5).

## Objectives
- Explicitly granted shared work scope: OM observations from multiple sessions fold into one scope under host-granted ACL.
- Session-private scopes remain the default and unchanged; sharing is opt-in per scope, auditable.

## Expected Outcome
- A long build (session 1 planning → session 15 finishing) keeps phase-1 constraints alive in OM recall without dumping logs; every cross-session read is ACL-checked and audited.

## Tasks

- [x] Task 1: Primitive review — OM scope and ACL surfaces
  - Acceptance Criteria:
    - Functional: Inventory `packages/memory/src/memory.ts` (`createObservationalMemoryRuntime`, `projectWorkMemory`, `foldWorkScopeMap`, `foldObservationalMemoryLedger`) and the ACL model; identify the minimal change for multi-session scope identity + grants.
    - Performance / Code Quality / Security: analysis only.
  - Approach:
    - Documentation Reviewed (list corrected by review — `memory.ts`/`acl.ts` are not on the OM path):
      - `docs/compaction-observational-memory.md`, `docs/data-classification.md`, `docs/memory-fabric.md`; `packages/memory/src/compaction/observational-memory/` (`runtime.ts`, `compose.ts`, `scopes.ts`, `scopes-project.ts`, `ledger.ts`, `projection.ts`, `coverage-helpers.ts`, `recall.ts`, `tool.ts`, `commands.ts`, `strategy.ts`, `recent-messages.ts`, `ids.ts`, `types.ts`, `memory-bounds.ts`, `workers/observer.ts`, `workers/reflector.ts`); `packages/memory/src/acl.ts`, `types.ts`, `vector-memory.ts`, `lineage.ts`, `postgres.ts`, `rag/access-recheck.ts`, `schema.ts`; `src/contracts-core/session.ts`, `src/contracts-core/persistence.ts`, `src/field-policy.ts`, `src/redaction.ts`.
    - Options Considered: n/a.
    - Chosen Approach (reviewed): shared scope declared at attach with a host-supplied cross-session entries callback + append-only grant records; folding stays per branch and is merged at the ledger level for read paths; flush unchanged.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: none.
    - References: clay E5 ("if per-session composition proves insufficient"); synapta authoring cross-session memory want.
    - Findings (review outcome, 2026-09-19, tree `21bd2348` + 207 dirty, root 0.8.0):
      - **Primitive locations — plan paths are wrong.** `createObservationalMemoryRuntime` is `packages/memory/src/compaction/observational-memory/runtime.ts:89` (not `memory.ts`); `projectWorkMemory` is `scopes-project.ts:26`; `foldWorkScopeMap` is `scopes.ts:128`; `foldObservationalMemoryLedger` is `ledger.ts:22`. `packages/memory/src/memory.ts:60` is the semantic/vector memory facade (`createMemory`) and `packages/memory/src/acl.ts` is the vector-store RAG source ACL — neither is on the OM path. `packages/memory/src/schema.ts:1-19` is a JSON-Schema validator for working memory, not a persistence schema.
      - **Scope identity today.** One implicit `session` root per ledger (`scopes.ts:6`); host-named child scopes via append-only `om.scope.opened/closed/entered/left/bound/unbound` custom entries (`scopes.ts:7-12`), caps 256 scopes / depth 8 / stack 8 / 4,096 binds / 512-char labels (`scopes.ts:14-18`). `foldWorkScopeMap` is a pure fold over one `readonly SessionEntry[]`; `projectWorkMemory` filters a ledger by scope lineage + `om:<id>`/`reflection:<id>` binds (`scopes-project.ts:26-57`). Every entry carries `sessionId`, and OM appends are ownership-checked against the attached session branch — append, `session.checkout`, then throw if the entry is not at the owning leaf (`append-custom.ts:13-25`).
      - **The pipeline is single-branch by construction; coverage is positional.** All reads are `session.entries()`: flush folding (`runtime.ts:142`), post-observation fold (`runtime.ts:200`), context provider (`compose.ts:174`), compaction trigger (`compose.ts:190`), proxied session (`compose.ts:259`), compaction strategy summary (`strategy.ts:36-43`, `:98-108`), recall (`recall.ts:48-56`, `:133+`), recall tool (`tool.ts:63-67`, `:77-79`), commands (`commands.ts:87-89`). Coverage is one scalar `coversUpToId` per branch (`types.ts:28-32`) resolved positionally in that same list (`coverage-helpers.ts:16-19`), and `observationsUncoveredByReflection` is positional too (`coverage-helpers.ts:27-49`). Consequence for Task 2: **never concatenate raw entry lists across branches** — fold each branch with the existing pure functions, then union ledgers (observations/reflections/dropped by id) and scope maps/binds. Entry ids are store-global-unique and observation/reflection ids are content-addressed on `(content, sourceEntryIds)` (`workers/observer.ts:42`, `workers/reflector.ts:37`), so merged exact-id recall stays unambiguous.
      - **The runtime has no store by design.** `createObservationalMemoryRuntime` rejects a `store` option (`runtime.ts:102-103`, "requires appendEntry bound to the owning session store"); `attach(session, { appendEntry })` binds one session (`compose.ts:135-152`). Task 2's sketch `createObservationalMemoryRuntime(store, { scopes: … })` contradicts that guard and must be restated as attach-level scope config plus a host-supplied entries callback, mirroring the existing cross-session read seam `GetMemoryEntries = (sessionId) => entries` (`tool.ts:6`, `commands.ts:87-89`).
      - **ACL model inventory — nothing on the OM path.** RAG source ACL: `RagAccessConstraint` (`types.ts:83`) and replace-set `SourceAccessGrant` with `principalIds`/`groupIds`/`accessVersion`, duplicate sourceIds fail closed (`acl.ts:54-72`), `grantAllows` version-pinned principal/group match (`acl.ts:74-82`), caps 32 groups / 1,024 grants (`acl.ts:6-9`), keyed by `(tenantId, resourceId, threadId, sourceId)` in memory (`vector-memory.ts:128-142`, `:317-333`) and in SQL (`postgres.ts:317+`), with per-query deny-by-default recheck and an `onDenied` audit sink (`rag/access-recheck.ts:1-27`). Thread share grants: `MemoryShareGrant` parent→child thread, TTL, vector memory only (`types.ts:125-131`, `lineage.ts:212-243`, `memory.ts:370-393`). Session reads have no ACL beyond store construction and optional `OwnershipScope` on search (`contracts-core/session.ts:87`, `contracts-core/persistence.ts:25-29`); the wiki has no ACL at all. So `acl.ts`/store tables are not reusable for OM: reuse the grant *shape* (principal/group/version, replace-set revoke, recheck per build, denial audit), not the mechanism.
      - **Grants, minimally.** Append-only grant records beside the existing scope entries — a shared-scope declaration plus grant/revoke entries carrying the `SourceAccessGrant` vocabulary (principal ids, optional group ids, access version, optional expiry), folded with the scope entries (owner branch is grant authority). Revocation takes effect at the next build because folding re-reads entries; absent/unknown grant state denies the read. No new store method, no new table, no `schema.ts` change.
      - **Data classification has no scope-level primitive.** `docs/data-classification.md` is field-level only: `applyFieldPolicy` (`src/field-policy.ts:165`), `createProtectedFieldPolicy` (`:455`), `FIELD_POLICY_LIMITS` (`:79`), session-entry egress via `redactSessionEntry(entry, redactor, fieldPolicy, destination, labelFor)` (`src/redaction.ts:64-72`). No session/scope class field exists anywhere, so Task 2's "scope data-classification inherits the strictest contributing session's class" would be a new classification axis with no vocabulary or consumer — restate it (field policy at each host boundary still governs) or defer to a named host demand.
      - **Minimal change shape + audit gap.** Attach-level `sharedScopes` (scope id → owner session id, plus the host's bounded `getEntries(sessionId)`), grant fold from the owner branch, per-branch fold + ledger union for context render, compaction summary, and exact-id recall; flush stays local, so no cross-session source ingestion and no second writer on one branch (avoids the concurrent-append hazard `docs/compaction-observational-memory.md:262` names for the host funnel). Cross-branch reads stay inside one store/ownership scope — the host callback is the tenant boundary, since the package cannot verify another branch's tenant. Audit: `access-recheck.ts` `onDenied` is the pattern; `runtime.ts` today has only `debug` (`runtime.ts:63`), so a small denial/access sink is new. Perf honesty: Task 2's "one ACL lookup per OM build" is really one branch read + grant fold per granted branch per build — state that N and keep it out of the per-observation path.
      - **Plan/doc corrections Task 2 must carry.** `docs/compaction-observational-memory.md:224` ("There is no package primitive for a shared workspace scope") becomes false; `:226-266` (host funnel, "never concatenate parent + child lists", "do not copy `om.*` entries") stays true for the host pattern and gains a cross-reference to the primitive; `:106-112` ("one observational-memory ledger") needs the shared-scope paragraph. `assertKnownWorkBindRefs` validates binds against the local ledger only (`scopes.ts:366-373`), so binding another branch's observation to a shared scope needs the merged-ledger check. Task 3 precedent: `examples/work-scopes-coding-loop.ts` (+ `examples/README.md` bullet, required by the docs test).
      - **Host evidence.** clay `roadmap.md` §Post-Roadmap E5 ("Cross-session shared memory scopes (E5) if per-session composition proves insufficient") and `decision-logs/2026-08-30-2158-observational-memory-defaults-worker-models-80k-per-session.md` ("Revisit if: per-session proves insufficient (post-roadmap E5 path)"). The concrete case is the delegation tree (clay `st` orchestrator + durable child sessions), not two unrelated tenants.
  - Outcome: review recorded above; no code, no tests, no docs (analysis-only task). Task 2's call shape, ACL reuse claim, file paths, and classification clause corrected in place below.
  - Test Cases to Write: n/a.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

- [x] Task 2: Shared scope identity, grants, folding
  - Acceptance Criteria:
    - Functional: shared scope declared at attach (Task 1 corrected `createObservationalMemoryRuntime(store, …)`: the runtime rejects a `store` option, `runtime.ts:102`) — granted sessions bind their observations/reflections into the scope and read its per-branch folded ledger; grants are explicit append-only records (grant/revoke), revocation takes effect at next OM build (fail-closed); per-session default behavior byte-identical when no shared scopes configured.
    - Performance: Shared scope adds one grant fold + one branch read per granted branch per OM build (not per observation); fold of a shared scope is the same cost class as today's per-session fold and merge is O(observations).
    - Code Quality: Grant records are append-only OM custom entries (redacted like other scope text); no store/schema change; grant *shape* (principal/group/version, replace-set revoke, recheck per build) mirrors the RAG source ACL. Task 1 finding: the wiki has no ACL layer and OM has none today, so "same ACL layer" is a shape reuse, not code reuse.
    - Security: Fail-closed on unknown grant state (no read); cross-session reads audited through a denial sink mirroring `rag/access-recheck.ts` `onDenied`; cross-branch reads stay inside one store/ownership scope — the host `getEntries` callback is the tenant boundary because the package cannot verify another branch's tenant. Scope data-classification inheritance is restated away (Task 1: no session/scope class exists; `docs/data-classification.md` is field-level only) — field policy at each host boundary still governs.
  - Approach:
    - Documentation Reviewed: Task 1; `docs/data-classification.md` reviewed and found field-level only — no scope-class inheritance rule exists to reuse.
    - Options Considered:
      - Cross-session search instead of shared scope: rejected — recall quality needs folding, not search; and clay wants continuity, not querying.
    - Chosen Approach: Shareable scope id + explicit append-only grants; folding pipeline reused per branch and merged at the ledger level for reads.
    - API Notes and Examples (shape corrected by Task 1 findings; Task 2 fixes exact names):
      ```ts
      const memory = createObservationalMemory({ observation: { provider } });
      const attached = memory.attach(session, {
        appendEntry: (entry, options) => store.append(entry, options),
        // Shared scope: owner branch carries the grants; read callback is host-bounded (store/tenant scope).
        sharedScopes: { "build-42": { ownerSessionId: "build-42", entries: (sessionId) => store.list(sessionId) } },
      });
      await attached.grant("build-42", "session:clay-9"); // append-only grant entry, audit-logged
      // sessions 1..15 fold into build-42; recall in session 15 sees phase-1 constraints
      ```
    - Files to Create/Edit (paths corrected by Task 1 — `memory.ts`/`acl.ts`/`schema.ts` are not on the OM path):
      - `packages/memory/src/compaction/observational-memory/scopes.ts`: shared-scope declaration + grant/revoke entries, grant fold, merged-ledger bind/ref validation.
      - `packages/memory/src/compaction/observational-memory/runtime.ts`: grant check + per-branch fold/ledger union for read paths, access/denial sink; flush stays local.
      - `packages/memory/src/compaction/observational-memory/compose.ts`: attach-level `sharedScopes` (owner session id + host `getEntries`).
      - `packages/memory/src/compaction/observational-memory/index.ts`: exports. `docs/compaction-observational-memory.md`: shared-scope section + `:224`/`:106-112`/`:226-266` corrections.
    - References: clay E5; OM literature (update/connect/filter ops fragile — keep one folding path).
  - Test Cases to Write:
    - Two sessions share scope: observation from session 1 recalled in session 15's OM build.
    - No shared scope configured: identical outputs to 0.8 fixtures.
    - Revoke mid-build: next build excludes; unknown grant: fail-closed + audit.
    - Data-classification: no scope-level class axis is introduced — field policy at host boundaries is unchanged.
  - Outcome (complete 2026-09-19): shipped as attach-level `sharedScopes` + append-only grant records; per-branch fold, ledger-level union. Tests: `packages/memory/src/compaction/observational-memory/__tests__/shared-scopes.test.ts` (7 cases), `index.test.ts` docs needles. Evidence: `npm run build` + package suite 482 pass / 4 skipped, root `docs.test.js` 155 pass, biome clean on touched files.
    - Files changed:
      - `scopes.ts`: `WORK_SCOPE_GRANTED`/`WORK_SCOPE_REVOKED`, `WorkScopeGrantedData`/`WorkScopeRevokedData`, `foldWorkScopeGrants`, `isWorkPrincipalId`, `MAX_WORK_SCOPE_PRINCIPALS`/`MAX_WORK_PRINCIPAL_ID_CHARS`, controller `grant`/`revoke` (owner session only; reserved/closed/unknown scope and malformed principal fail closed).
      - `shared-scopes.ts` (new): `resolveSharedScopes` (owner branch = grant authority, owner branch always contributes, granted principals read+write, per-branch fold then id-keyed union, only refs bound to the exact scope id shared), `mergeSharedScopes`, `onAccess` audit events for granted and denied decisions.
      - `ledger.ts`: `mergeObservationalMemoryLedgers` (id-keyed union; per-branch coverage cursors deliberately not merged).
      - `recent-messages.ts`: context blocks accept resolved `shared` memory, merge binds into the scope map, apply invalidation/drop filters before `projectWorkMemory`.
      - `recall.ts`: `RecallMemoryOptions.shared` — merged ledger + foreign entries for source evidence; branch paging untouched.
      - `tool.ts` / `commands.ts`: `recall` and `om:view` accept `sharedScopes`/`onScopeAccess` (status stays session-local).
      - `compose.ts`: attach-level `sharedScopes` + `onScopeAccess`, resolved per context build.
      - `index.ts`: exports; `docs/compaction-observational-memory.md`: new "Shared work scopes (opt-in)" section + corrections at the old "no package primitive" line, the funnel cross-reference, and the ownership rule.
    - Deviations recorded for Task 1 findings:
      - The read-path merge lives in the pure consumers (`recent-messages`/`recall`/`tool`/`commands`), not in `runtime.ts`; `runtime.flush` stays fully local.
      - Compaction strategy + folded payload stay local by design: writing foreign observations into `data.memory` would make revocation unenforceable (the folded payload is re-read locally). Shared memory re-enters context from the provider after compaction; add a summary integration only if a host needs shared memory to survive with the context provider disabled.
      - `assertKnownWorkBindRefs` unchanged: under the union-of-binds model each branch binds its own ids, so no merged-ledger check is needed (contradicts the Task 1 "merged-ledger bind validation" guess).
      - Rendering requires the shared scope in the reader's leaf lineage (`enter`); recall by exact id does not. Documented rather than special-cased.
      - Grants are symmetric read+write with no `readOnly` flag; no cache — one branch read + fold per granted branch per resolve (ponytail comment in `compose.ts`).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — OM runtime options, grant API.
    - Docs pages to create/edit: `docs/compaction-observational-memory.md` (shared scopes + grant semantics + honest sizing line: one grant fold + branch read per granted branch per build; correct the "no package primitive" line at `:224` and the host-funnel section at `:226-266`).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Cross-session recall example
  - Acceptance Criteria:
    - Functional: `examples/shared-work-scope.ts` demonstrates grant → two sessions contributing → recall in a third; prints recalled observations.
    - Performance: Example CI budget.
    - Code Quality: Fake provider; asserts recall via stdout summary.
    - Security: No secrets; grants shown explicit.
  - Approach:
    - Documentation Reviewed: existing OM examples.
    - Options Considered: none simpler.
    - Chosen Approach: Scenario example; third session opens + enters the shared scope so the context render shows it (recall does not need the leaf), owner grants both contributors and the reader.
    - API Notes and Examples:
      ```bash
      node examples/shared-work-scope.ts
      ```
    - Files to Create/Edit: `examples/shared-work-scope.ts`; `examples/README.md` bullet (docs test requires every `examples/*.ts` to be listed); model on existing `examples/work-scopes-coding-loop.ts`.
    - References: clay build-loop phases.
  - Test Cases to Write:
    - Example doubles as integration test via existing example-runner conventions.
  - Outcome (complete 2026-09-19): shipped and wired into the docs-test demo runner (`src/__tests__/docs.test.ts` demos list, next to `observational-memory-lifecycle.ts`), so CI executes it instead of only typechecking it.
    - `examples/shared-work-scope.ts`: mock providers only; owner opens `release:0.9`, grants `builder` + `reviewer`, contributes one scope-bound observation plus one bound to a private child scope; builder opens the scope locally and contributes via `withWorkScope`; reviewer enters the scope and reads through the attached `contextProvider` (asserts both shared facts render, private aside absent), then recalls the builder's observation by exact id through `createRecallMemoryTool` with `sharedScopes` (asserts found + foreign source evidence), then the owner revokes `builder` and a re-resolve drops that branch.
    - Printed summary: `{ scope, branches: [builder, owner], sharedObservationIds, branchesAfterRevoke: [owner], recalled: { id, content }, audits: [[scope, true]] }`.
    - `examples/README.md`: bullet; `docs/compaction-observational-memory.md`: example pointer in the shared-scopes section.
    - Evidence: `node examples/shared-work-scope.ts` exit 0; `npx tsc -p examples --noEmit` clean; biome clean; `npm run build` + root `docs.test.js` 155 pass (example included in the emit + run loop).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — example.
    - Docs pages to create/edit: `examples/README.md` bullet (required: the docs test asserts every `examples/*.ts` is listed) + `docs/compaction-observational-memory.md` example pointer; `src/__tests__/docs.test.ts` demos list so CI runs it.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

## Compromises Made
- Shared (foreign) observations never enter the local folded payload, so they do not survive as text inside a local compaction summary; they re-enter context from the provider after compaction. Chosen because a copied payload outlives the grant and makes revocation unenforceable.
- Grants are symmetric read+write per scope and never expire — no read-only capability and no TTL; a host that needs asymmetric visibility uses two scopes.
- No resolve cache: each context build / recall tool call reads and folds every granted branch. Cost is O(participating branches), not O(observations), but it is per-call store I/O.
- Rendering still requires the shared scope in the reader's leaf lineage (`enter`); exact-id recall does not. Fail-closed rather than special-cased.
- The owner branch is read on every resolve (it is the grant authority), including denied ones; the reader cannot distinguish "no grant" from "owner unreachable" except through `onScopeAccess.reason`.

## Further Actions
- P2: revocation-safe shared summary — if a host runs shared OM without a context provider, re-resolve grants at compaction time and store shared observation *ids* (not content) so the summary can be invalidated instead of carrying foreign text.
- P3: resolve cache keyed by owner branch tip + grant version + granted branch tips (perf only; not needed at current branch counts).
- P3: per-principal capability (`read` vs `read+write`) if a host needs asymmetric grants without splitting scopes.
- P3: shared counts in `om:status` (currently session-local by design) if operators ask for cross-session visibility totals.
