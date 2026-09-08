# Migration archive — 0.2.x releases

## 0.2.9 → 0.3.0 lockstep cut and independent package versions (additive)


Release **0.3.0** is the final lockstep cut on the 0.3.x line: all 57 publishable manifests move from `0.2.9` to `0.3.0`, then internal first-party `dependencies`, `optionalDependencies`, and `peerDependencies` use `^0.3.0`. The package graph is now **Decision B**: changed packages may patch/minor independently inside `>=0.3.0 <0.4.0`; unchanged packages keep their version.

- **Release commands:** default `release.mjs check`, `publish`, and `gate` are independent. Use `--lockstep --version 0.3.0` only for the final cut or the one emergency lockstep train. Later publication tags are `@arnilo/<package>@<version>`; a generic `v*` tag does not publish the monorepo.
- **Consumer installs:** keep first-party peers inside `^0.3.0`. A package at `0.3.1` can be installed with other unchanged `0.3.0` packages; a `0.4.0` package requires the next coordinated peer-range cut.
- **New optional packages:**
  - `@arnilo/prism-antigravity-agent` delegates autonomous coding sessions to the official `agy` CLI with per-run loopback MCP capability exposure, AG-UI timeline projection, and `--conversation` continuation; host owns binary and `agy login` authentication state; omitted from umbrellas.
  - `@arnilo/prism-computer-use-linux` wraps a host-owned Linux `computer-use-linux` MCP binary. It is Linux-only, deny-by-default through `DeviceAdapter`, outside umbrella profiles, and never auto-connects on import.
- **Coding/ACP closeouts:** `read.findText`, visible fuzzy edit matches/miss context, ACP editor-buffer filesystem operations, spawnable per-session coding registries, and delete/move result locations are additive and require no store migration. Client filesystem mode remains text-only: image/document reads fail closed and never fall back to host disk.

No persisted store migration. Before publication, rollback by restoring the 0.2.9 manifests/tag. After publication, roll forward with an additive 0.3.x package patch; npm unpublish is not a rollback strategy.

## 0.2.8 → 0.2.9 provider adoption and behavior packages (additive)


Release **0.2.9** (plan 029) adds three provider packages, SuperGrok device-code OAuth, `@arnilo/prism-impeccable`, Ponytail 4.9.0 empty-args status, and Caveman v2.1 extra skills. **Additive-only: no exported declaration removed, no persisted 0.2.8 shape repurposed.**

- Install `@arnilo/prism-provider-deepseek`, `@arnilo/prism-provider-xai`, or `@arnilo/prism-provider-clinepass` (or `@arnilo/prism-providers`) for the new adapters. SuperGrok login is host-invoked RFC 8628 at `auth.x.ai`; no `XAI_API_KEY` required when OAuth credentials are stored.
- Bare `/ponytail` now reports current+default mode and does not change mode. Use `/ponytail lite|full|ultra|off` to set mode.
- Caveman still requires the original seven skills; extra `skills/*/SKILL.md` register. Caveman 2 engine is not a Prism runtime.
- `@arnilo/prism-impeccable` needs `upstreamPath` to a compiled `SKILL.md`. Not in `prism-all`.

No store migration. Rollback = restore the 0.2.8 manifests/tag.

## 0.2.7 → 0.2.8 ACP adoption fixes (additive)


Release **0.2.8** (plan 028) tightens ACP coding-host interop and adds the spawnable `@arnilo/prism-acp-agent` entrypoint. **Additive-only: no exported declaration removed or changed, no persisted 0.2.7 shape repurposed.**

Hosts that already speak ACP should re-check these wire behaviors (deny-by-default unchanged unless a new seam is wired):

- `usage_update` is omitted when the host cannot report a context window (never `size = used`).
- A terminal run `error` rejects `session/prompt` with `ERR_PRISM_ACP_RUN` instead of an `Agent error:` transcript chunk.
- Only boolean config options are advertised; `set_config_option` on a select option fails `ERR_PRISM_ACP_CAPABILITY`.
- Permission option kinds on the wire are `allow_once` / `allow_always` / `reject_once` / `reject_always`.
- New optional seams (`sessions.transcript`, `sessions.title`, `commands.list`, `capabilities.usage.contextWindow`, `createCodingToolProjection`, image `toolResult`) emit nothing when unwired.

No store migration. Rollback = restore the 0.2.7 manifests/tag. The added exports and `@arnilo/prism-acp-agent` simply disappear.

## 0.2.6 → 0.2.7 enterprise ERP production readiness (additive)


Release **0.2.7** (plan 027) adds the enterprise ERP production-readiness primitives behind optional host-activated seams: the transactional outbox/inbox + bounded dispatcher, the durable saga compensation/reconciliation engine, multi-party separation-of-duties approvals, signed hash-chained audit export with WORM/SIEM sinks, field-level classification + fail-closed redaction, and the deterministic ERP invariant evals. **Additive-only: no exported declaration removed or changed, no persisted 0.2.6 shape repurposed.**

New ERP tables use **separate forward-only migrations** (no down migrations exist; production rollback is roll-forward repair only):

- `prism_erp_outbox` / `prism_erp_inbox` (migration `004_erp_messaging`, version 4) — transactional outbox/inbox with `FOR UPDATE SKIP LOCKED` claim, `ON CONFLICT DO NOTHING` idempotent append, claim-token CAS, and three partial indexes. Outbox append must run in the caller-owned `PoolClient` transaction with the business mutation (atomicity is the host's responsibility).
- `prism_erp_approvals` (migration `005_erp_approvals`, version 5) — multi-party approval requests with decisions stored as JSONB, `FOR UPDATE` row locking for atomic quorum recomputation, rejection as any-party veto, expiry checked at every protected transition, and atomic grant consumption in the host transaction.

Saga state persists as a surrogate `WorkflowCheckpointRecord` through the existing `WorkflowCheckpointAdapter` (private workflow id `__prism_saga__/<key>`) — no saga-specific SQL or 0.2.6 shape is repurposed. Audit export, field policy, and ERP invariant evals are stateless or in-memory and add no persisted shape. Secret-manager adapters (Vault/AWS/Azure/GCP) stay **deferred** behind the demand gate; no adapter ships and no ambient credential discovery is added.

**Rollback notes.** Rollback = restore the 0.2.6 manifests/tag. The two new ERP migrations are forward-only; before downgrading, stop all 0.2.7 workers (outbox dispatcher, saga engine, audit exporter) and drop or ignore the `prism_erp_outbox`/`prism_erp_inbox`/`prism_erp_approvals` tables (they hold no 0.2.6 data). No 0.2.6 persisted shape changed, so an ordinary downgrade is store-safe; the added exports and ERP tables simply disappear. **"ERP production ready" remains blocked until the 0.3.0 live-service matrix is recorded** — this release adds the primitives and the protected journey evidence, not the live-service matrix.

## 0.2.5 → 0.2.6 durable recovery, workspaces, and coding-agent readiness (additive)


Release **0.2.6** (plan 026) adds the coding-agent readiness capabilities behind optional host-activated seams: host-selected PTY backends, the indexed/semantic repository-search seam, the ownership-scoped multi-repository/worktree lifecycle, durable process/ACP recovery, and the patch-review/diagnostics workflow. **Additive-only: no exported declaration removed or changed, no persisted 0.2.5 shape repurposed.**

New durable records use **separate versioned checkpoint namespaces**, never the 0.2.5 shapes:

- `prism.coding-agent.process.v1` (schemaVersion 1) — managed-process recovery records. Readers reject unknown schema versions and corrupt/foreign records fail closed (dropped, never recovered).
- `prism.coding-agent.workspace.v1` (schemaVersion 1) — coding workspace lifecycle records.
- `prism.coding-agent.cancel.v1` (schemaVersion 1) — durable ACP run-cancel markers.

`CodingCheckpointMetadata` (schemaVersion 1, `prism.coding-agent`) is **never silently repurposed**; 0.2.5 readers reject unknown schema versions as before.

**ACP active-run references (Task 5 decision: additive optional field).** `PersistedAcpSession` gains an optional bounded `activeRun` ref (frozen 512-byte cap) recorded while a durable run is live. The decision recorded here: an additive optional field, not a separate recovery namespace, because the ref is advisory metadata — the authoritative run status is always re-queried from `AgentRunLifecycle.status` at restore time, and 0.2.5 hosts safely ignore the field. `PersistedAcpSession.activeRun` stays optional; 0.2.5 records remain readable and a 0.2.5 host reading a 0.2.6 record does not lose required recovery state (the run state itself lives in the existing `prism.agent-run` records, which are untouched).

**Downgrade to 0.2.5** is safe only after stopping 0.2.6 workers/replicas and marking any live 0.2.6 process/workspace records `unknown` (their leases expire within TTL); durable state never serializes a PTY fd, browser context, process object, controller, pending promise, raw terminal output, env, token, or credential, and no exact-process-survival claim is made (attach-if-attested, otherwise unknown).

## 0.2.4 → 0.2.5 maintainability and bounded performance (no migration)


Release **0.2.5** (plan 025) is the maintainability-and-bounded-performance cut: the six remaining implementation god-modules split into cohesive internal family files behind preserved barrels (compat-preserving, no `exports`-map subpath), 21 pure persistence helpers moved into the dependency-free `session-store-codecs` package (ownership scope/assertion, checkpoint stale/encode/decode, branch cursors, lifecycle quota/reason/page-limit, search metadata/clipping, deepFreeze/string-array/throwIfAborted, feedback row mapping), the quadratic per-push `Buffer.concat` loops in language framing and tar parsing became chunk-array readers (linear; caps and fail-closed overflow byte-identical), two internal dead type aliases removed (`PostgresPersistenceCloseOptions`, `SqlitePersistenceCloseOptions` — never re-exported from their adapter indexes), and 76 behavior-backed coverage regressions closed the low-coverage core areas (core 91.43/84.80/91.60 lines/branches/functions). **No runtime contract change and no migration**: no exported declaration was removed or changed (the plain reviewed compat gate at 0.2.5 shows the version literal plus 105 additive internal-helper exports), no persisted shape/schema/default/behavior changed, no new runtime dependency. Store compatibility with 0.2.4: **compatible in both directions** — no migration step; rollback = restore the 0.2.4 manifests/tag (stores never change; the added exports disappear on downgrade). The 20 dead-but-compat-tracked exports deferred from Task 4 are the 0.3.0 breaking-cut removal list (see `docs/_evidence/phase25-dead-exports-triage.md`).

## 0.2.3 → 0.2.4 package, documentation, and compatibility truth (plan 024)


Release **0.2.4** (plan 024) is the package-documentation-and-compatibility-truth cut: umbrella wording now states the manifest closures (`@arnilo/prism-providers` = 11 of 14 first-party provider adapters, omitting Azure/Bedrock/Vertex; `@arnilo/prism-all` = 20 direct / 43 transitive first-party packages with the named omission set), and `scripts/package-truth.json` (generated by `scripts/package-truth.mjs`) is the manifest-derived single source for counts, provider membership, umbrella closures, and profile closures. **Peer-version policy (Decision A — exact pins):** every code package peers the bare exact `@arnilo/prism@0.2.4` version (no range, no `*`); all `@arnilo/prism-*` packages move at the same version (**atomic-upgrade rule** — a partial upgrade fails clearly at install time with npm `ERESOLVE` naming the conflicting peer); the range widens to `^1.0.0` at the 1.x stable release; third-party `@arnilo/prism-*` adapters peer on the documented exact current version (full policy in the release-and-install Extension notes). **No runtime code path, persisted shape, event schema, default, or exported declaration changed** (the plain reviewed compat gate at 0.2.4 shows the version literal only). Store compatibility with 0.2.3: **compatible in both directions** — no migration step; rollback = restore the 0.2.3 manifests/tag.

## 0.2.2 → 0.2.3 build, coverage, and release evidence integrity (no migration)


Release **0.2.3** (plan 023) is a **tooling-and-evidence-only cut**: build serialization (`scripts/with-build-lock.mjs` — one `O_EXCL` lockfile serializing every emit/test leaf so concurrent compilers never expose a partial live `dist/`), corrected workspace coverage denominators (package-local `--test-coverage-include=dist/**`, evidence-based per-package thresholds with `protectedException` durable-leg rows), the machine-auditable release skip manifest (`scripts/release-skip-manifest.mjs` → `scripts/release-evidence.json` with `pass`/`skip`/`blocked`/`protected` states; required surfaces without evidence record `blocked` and fail the release gate), and stabilized quality gates (Biome 2.x `preset` config migration with zero lint diagnostics, deterministic timing-assertion barriers, machine-readable `lint-report.sarif` + `unused-report.json`). **No runtime code path, persisted shape, event schema, default, or exported declaration changed** (the plain compat gate at 0.2.3 shows the version literal only). Store compatibility with 0.2.2: **compatible in both directions** — no migration step; rollback = restore the 0.2.2 manifests/tag (stores never change; rollback reopens only the partial-`dist` race and the polluted coverage denominator, both CI/tooling defects, never data defects).

## 0.2.1 → 0.2.2 concurrent state and durability integrity (plan 022)


Release **0.2.2** (plan 022) makes four concurrency/durability boundaries atomic or fail-loud. The API surface is **additive-only** (plain reviewed compat gate at 0.2.2: expected deltas are the version literal, `ModelRouterStateStore.reserveBudget`/`commitBudget`/`releaseBudget` plus `ModelRouterReservation`/`ModelRouterBudgets.reservationTtlMs`/`ModelRouterLimits.maxRateKeys`/`maxBudgetKeys` (memory + Postgres), `SessionRecord.version` with `appendSession` `expectedVersion`, `EventMultiplexerError` with code `ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER`, and the `@arnilo/prism/testing/state-concurrency-conformance` subpath; no removal, no `--allow-break`). Three of the four changes tighten behavior where 0.2.1 silently accepted a race — concurrent hosts may now see an explicit conflict where 0.2.1 lost an update or oversubscribed a budget:

1. **Atomic model-budget reservation (`model-router`, `enterprise-postgres`).** Admission is now reserve/commit/release: `reserveBudget` runs at admission and fails the request when `used + reserved + requested` would exceed the window max, returning `{ reservationId, fencingToken, admitted, retryAfterMs? }`; `commitBudget` applies the actual usage delta at the outcome (an expired reservation still charges the reserved amount with `unknownUsage: true` so a late commit can never disappear from accounting); `releaseBudget` frees an uncommitted reservation. `readBudget`-based admission stays for requests with no per-request cap, and the 0.2.1 post-hoc `addUsage` remains as retrospective accounting only — it is no longer admission authority.

   ```js
   // 0.2.1: readBudget then consumeRate then addUsage — concurrent admissions could collectively oversubscribe
   // 0.2.2: admission reserves the full per-request cap, outcome commits/releases actuals
   const reservation = await store.reserveBudget({
     key: { tenantId, principalId, provider, model },
     tokens: request.maxTokens, costUsd: request.maxCostUsd, // per-request caps, when set
     windowMs: 24 * 60 * 60 * 1000, reservationTtlMs: 60_000,
   });
   if (!reservation.admitted) { /* denied; retry after reservation.retryAfterMs */ }
   // ... run the request ...
   await store.commitBudget({
     key, reservationId: reservation.reservationId,
     fencingToken: reservation.fencingToken, tokens: actualTokens, windowMs: 24 * 60 * 60 * 1000,
   });
   ```

   Reservations expire after `reservationTtlMs` (default 60,000 ms, bounded to 31 days) even if a host never commits, so a crashed request cannot hold capacity forever. Rate/budget/circuit key maps are now capped (`maxRateKeys`/`maxBudgetKeys`, default 4,096, hard cap 65,536; circuits stay 1,024/16,384) with LRU eviction on insert; a budget row holding an active reservation is never evicted (the eviction candidates exclude held rows, and if nothing is evictable the insert fails with `ERR_PRISM_MODEL_ROUTER_STATE` `capacity-exhausted`). The durable Postgres store keeps reservations in a new `reservations` JSONB column on `prism_model_router_budgets` (migration 003, forward-only, applied automatically by `applyEnterpriseMigrations`; existing rows are untouched and read as no reservations).

2. **Atomic conversation metadata (`session-store-postgres`, `session-store-sqlite`, core `SessionRecord`).** `SessionRecord` gains `version` (fresh rows start at 1; migration 008 backfills legacy 0-version rows to 1) and `appendSession` accepts `expectedVersion`: `0` = create-only, `N > 0` = exact-version CAS update-only, omitted = the 0.2.1 last-write-wins behavior for untyped/legacy callers. A stale write throws `SessionMetadataConflictError` (`metadata_conflict`) carrying only `{ id, expectedVersion, currentVersion }` — never metadata content — and the HTTP server maps it to 409. Concurrent create/branch/archive are now single-statement: the branch `maxActiveBranches` cap is enforced inside the CAS write (a concurrent branch at cap-1 fails its version guard instead of silently dropping the oldest ref), archive wins over a stale concurrent write, and a retention-deleted session is never resurrected (the update arm requires the row to still exist).

   ```js
   // 0.2.1: create could race to the last metadata write; concurrent branch calls could lose a ref
   // 0.2.2: exactly one concurrent writer wins per version; losers get metadata_conflict
   const { version } = await persistence.appendSession({
     id: sessionId, ...ownership, createdAt, updatedAt, metadata: { state: "active" },
     expectedVersion: 0, // create-only: conflict if the session already exists
   });
   try {
     await persistence.appendSession({ ...record, metadata: { state: "archived" }, expectedVersion: version });
   } catch (error) {
     if (error.code === "metadata_conflict") { /* re-read the winning version and retry */ }
   }
   ```

3. **Single-consumer `EventMultiplexer` (core).** `createEventMultiplexer().subscribe()` now rejects a second concurrent consumer with `EventMultiplexerError` `ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER` instead of parking both consumers on one queue and silently losing events. The slot frees when the active consumer's iterator completes, is `return()`ed at a yield, or the multiplexer closes. Hosts that previously relied on multiple `subscribe()` calls sharing one multiplexer must either serialize consumption or use the event source's own broadcast `subscribe` (agent-events), which still supports multiple subscribers. `createWorkflowEventBus` and the supervisor (the only in-repo consumers) are unaffected — each already uses a single subscriber.

4. **Restart-stable NATS durable consumer identity (`session-store-nats`).** The durable consumer name is now exactly `prism_<hmac16 of tenantId|sessionId|runId>` — the 0.2.1 random suffix is gone, so a crashed durable subscribe is reused at its last-acked position by a restarting process (cursor resume, at-least-once). Clean stops still delete the durable consumer (resume then relies on the HMAC-signed cursor); only a crash leaves the consumer in place. Pre-0.2.2 consumers minted with the random suffix (`prism_<digest>_<random>`) are orphaned and reclaimed by the existing `deleteConsumer`/consumer-enumeration cleanup path on the next clean stop of a same-subject subscribe.

5. **Bounded, non-durable active-run registries (`workflows`).** The in-process workflow active-run registry is documented as non-durable (no timer, no background service): `registerActiveWorkflowRun` sweeps aborted/leaked entries before every insert and fails closed with `WorkflowRuntimeError` `ERR_PRISM_WORKFLOW_RUN_REGISTRY_OVERFLOW` at the 512 cap instead of evicting a live entry (a live eviction could silently allow a duplicate run). A run whose promise never settles is reclaimed only when it is aborted or the cap forces a sweep — there is no durable recovery of active runs in 0.2.2 (see Further Actions: 0.2.6).

**Store compatibility:** 0.2.2 is **not** rollback-compatible with 0.2.1 in the Postgres/SQLite persisted shape: `prism_sessions` gains a `version` column (migration 008) and `prism_model_router_budgets` gains a `reservations` column (enterprise migration 003). Both migrations are forward-only and additive — 0.2.2 code reads 0.2.1 databases correctly after migration (backfill included); a 0.2.1 binary pointed at a 0.2.2 database still works because the new columns are nullable/defaulted, but it will not maintain versions or reservations. The NATS durable-name change touches no persisted data (consumers are runtime state; orphaned 0.2.1 consumers are reclaimed on the next clean stop).

**Rollout:** upgrade core and the session stores together (migration 008 runs automatically via the existing checksummed `prism_migrations`; the version column must exist before any host writes CAS updates). Then `enterprise-postgres` (migration 003) and `model-router` (reservation admission can be enabled per-host; hosts that never call `recordUsage` rely on TTL expiry). Then `workflows`/`server` (conversation CAS is transparent to clients except new 409 responses), then `session-store-nats`. Branch/archive callers that intentionally lost races in 0.2.1 must now handle `metadata_conflict` (re-read + retry) where they previously accepted last-write-wins.

**Rollback risk:** restoring 0.2.1 against a 0.2.2 database is safe for reads and last-write-wins writes (the new columns are ignored) but silently reopens all four race windows: oversubscription, conversation lost updates, silent multi-subscriber event loss, and non-restart-stable NATS resume. Rollback is therefore only a stopgap, not a mitigation — prefer fixing the failing host on 0.2.2.

## 0.2.0 → 0.2.1 provider completion and outbound trust boundaries (plan 021)


Release **0.2.1** (plan 021) tightens the streaming-completion, outbound-fetch, and credential/signing/upload boundaries. The API surface is **additive-only** (plain reviewed compat gate at 0.2.1: the only deltas are the version literal and `@arnilo/prism-mcp` transport helpers `boundResponse`/`defaultResolver`/`isLoopbackAddress`/`isLoopbackHostname`/`normalizeHostname`/`raceAbort`/`requestPinned`/`resolvePinnedAddress` becoming re-exports of the lifted core primitives — same names, same signatures, no removal; no `--allow-break`), with five documented security-motivated behavior tightenings. Untyped/legacy callers may now fail where 0.2.0 silently proceeded:

1. **Strict stream completion is the shared default (all OpenAI-compatible adapters).** `createOpenAICompatibleProvider` now defaults `strictCompletion: true` — a stream that ends without a `[DONE]` marker AND a choice-level `finish_reason` (EOF, network cut, provider truncation) emits a `ProviderTransportError` (`incomplete_delta`) instead of a successful `providerDone`, and a successful done never fabricates usage. This applies to every inheriting adapter: Azure, Bedrock, Vertex, OpenRouter, ZAI, NeuralWatt (Alibaba/Kimi/Ollama/OpenCode-go had already opted in).

   ```js
   // 0.2.1: truncated stream fails closed
   for await (const event of provider.generate(request)) {
     if (event.type === "error") {
       event.error.code; // "incomplete_delta"
     }
   }
   // explicit opt-out stays available where hosts own truncation detection:
   createOpenAICompatibleProvider({ ..., strictCompletion: false });
   ```

2. **Bounded success bodies on non-stream JSON endpoints.** `readBoundedResponseJson` (exported from `@arnilo/prism/providers/transport`) replaces unbounded `response.json()` on all model-discovery `/models` calls, NeuralWatt quota, Alibaba embeddings, OpenAI uploads, and the OAuth success paths. Defaults: 65,536-byte UTF-8 ceiling, max JSON depth 32, max properties 4096, caller-supplied shape gate, abort support, secret-redacted errors. Oversized or malformed bodies abort with `ProviderTransportError` `response_body_overflow`/`response_body_shape` instead of buffering unbounded input.

3. **DNS-pinned OIDC JWKS, OPA, and content fetches; redirects rejected.** The default fetch paths of `credentials-node` JWKS (`@arnilo/prism-credentials-node/oidc`), `policy` OPA decisions, and core content/media fetches now resolve the hostname once (1–32 addresses), validate every candidate against the SSRF policy, and connect only to a pinned address via a lookup-hook socket (no re-resolution). **3xx redirects are rejected outright** (`MediaContentError` code `redirect`) — a redirected fetch is never re-validated or followed. Private/metadata/loopback addresses fail closed (`MediaContentError` `ssrf_denied`). The MCP transport helpers were lifted to the shared core primitive (`pinnedFetch`, `resolvePinnedAddress`, `requestPinned` from `@arnilo/prism`) with byte-identical behavior and are re-exported from `@arnilo/prism-mcp`.

4. **Shared bounded OAuth device/token polling.** Core OpenAI OAuth (`@arnilo/prism-provider-openai`) and `@arnilo/prism-credentials-node` now share `pollDeviceCodeToken` (RFC 8628 poll loop with `authorization_pending` continue, `slow_down` +5 s backoff, expiry deadline, cancellation, bounded success/error reads, fail-closed token-shape gates, `[REDACTED]` secret redaction). No public change — the device/token flows keep their messages and cadence; provider-specific fields stay adapter options.

5. **Credential, signing, upload, and cache edge fixes.** (a) Azure and Vertex resolve a rotating/single-use credential **exactly once per request** — the inner provider signs with the same token the wrapper validated (a `CredentialValueSource` is never consumed twice). (b) Bedrock SigV4 canonicalization lowercases and merges duplicate-case request headers last-wins and sorts query parameters by encoded key then value — duplicate-case or reordered input can no longer produce a malformed signature. (c) OpenAI upload cleanup retains a file id until its `DELETE` succeeds — a failed/skipped cleanup leaves the id registered for a retried cleanup instead of leaking the remote file. (d) The cache-telemetry `__overflow__` bucket never carries cost — it reports requests and token totals only, so one model's cost metadata cannot mix into mixed-model overflow tokens.

**Store compatibility:** 0.2.1 is store-compatible with 0.2.0 in both directions — no persisted-shape change, no migration step. Checkpoint, session-store, approval, and registry payloads are byte-identical; only fetch/stream/credential behavior changed.

**Rollout:** upgrade core first (strict completion and bounded readers apply to all hosts immediately; truncated-stream callers must add `strictCompletion: false` only if they intentionally accept incomplete streams), then `@arnilo/prism-credentials-node` + `@arnilo/prism-policy` (DNS-pinned fetches; ensure JWKS/OPA hosts resolve to public addresses and never redirect), then the provider adapters (Azure/Vertex credential handling, Bedrock signing), then `@arnilo/prism-mcp` (re-export-only change).

**Rollback risk:** restoring 0.2.0 restores all five boundary gaps — rollback is **not** a mitigation. Hosts that must roll back should disable truncated-stream acceptance, unbounded-body endpoints, redirect-following fetches, rotating-credential reuse, and upload cleanup at their own boundary until they can return to 0.2.1.
