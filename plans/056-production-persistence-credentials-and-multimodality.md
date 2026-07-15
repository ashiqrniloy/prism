# Production Persistence, Credentials, and Multimodality

## Objectives

- Ship reference SQLite and PostgreSQL session/run-ledger adapters with atomic idempotent semantics.
- Ship persistent encrypted credential and system-keychain adapters while preserving host ownership.
- Extend content/provider capabilities for audio, file, and document inputs/outputs.

## Expected Outcome

- Production hosts can choose tested indexed persistence instead of JSONL.
- CLI/desktop hosts can persist OAuth/API credentials securely without core globals.
- Capability-aware providers accept bounded audio/file/document content and reject unsupported combinations clearly.

## Tasks

- [x] 0. Review persistence, credential, content, and package primitives
  - Acceptance Criteria:
    - Functional: Inventory maps session store/run ledger conformance, transaction/idempotency/branch invariants, credential resolver/OAuth store seams, content blocks, resource loader, provider capabilities, and upload lifecycle.
    - Performance: Design states query indexes, transaction boundaries, pool/concurrency expectations, encryption KDF limits, and media byte/time ceilings.
    - Code Quality: New packages implement existing interfaces; only genuinely shared content/key-provider primitives enter core.
    - Security: Threat model covers SQL injection/tenant isolation, file permissions, key derivation/rotation, keychain trust, SSRF/path reads, media bombs, MIME spoofing, retention, and redaction.
  - Approach:
    - Documentation Reviewed:
      - `docs/session-stores*.md`, `docs/database-persistence.md`, `docs/runs-and-usage.md`, conformance helpers.
      - `docs/credentials-and-redaction.md`, `docs/settings-auth-trust-security.md`, OAuth contracts.
      - `docs/input-and-prompt-assembly.md`, `docs/resource-loading.md`, provider/model docs.
      - Current selected database driver/keychain/provider media API docs must be pinned during execution before dependency choice.
    - Options Considered:
      - Put database/encryption/media implementations in core: rejected.
      - Optional packages over existing contracts plus minimal generic core additions: chosen.
    - Chosen Approach:
      - Produce ADR-style primitive inventory and package dependency/version/support matrix first.
    - API Notes and Examples:
      ```ts
      const store: SessionStore = createPostgresSessionStore({ pool, schema: "prism" });
      ```
    - Files to Create/Edit:
      - `docs/persistence-credentials-multimodality-primitives.md`, `docs/review-coverage-2026-07-14.md`, `docs/index.md`.
    - References:
      - Review capability gaps #5, #10, #11 and JSONL/security boundaries.
  - Test Cases to Write:
    - Conformance matrix covers restart idempotency, concurrent append, tenant isolation, wrong key, key rotation, media bounds, unsupported provider.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no implementation yet.
    - Docs pages to create/edit: `docs/persistence-credentials-multimodality-primitives.md`, review matrix.
    - `docs/index.md` update: yes — persistence/security/provider primitive design entries.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** `docs/persistence-credentials-multimodality-primitives.md` inventories shipped contracts, pins `better-sqlite3@^12.11.1`, `pg@^8.22.0`, `@napi-rs/keyring@^1.3.0`, documents 18-row conformance matrix and threat model; `docs/review-coverage-2026-07-14.md` and `docs/index.md` updated.

- [x] 1. Add shared database adapter schema/migration and conformance primitives
  - Acceptance Criteria:
    - Functional: Reusable SQL schema model covers sessions, entries, parent chain, idempotency keys, run events, usage, tenant scope, and schema version migrations without imposing one SQL dialect.
    - Performance: Required indexes and query plans are documented/testable; pagination avoids full scans.
    - Code Quality: Shared test/conformance fixtures and migration contracts are generic; SQL remains package/dialect local.
    - Security: Tenant ID participates in unique/foreign-key boundaries; parameterized statements required; migrations use least-privilege guidance.
  - Approach:
    - Documentation Reviewed:
      - Existing `SessionStore`/`RunLedger` contracts and conformance suites; Task 0 design.
    - Options Considered:
      - ORM dependency: unnecessary across two adapters.
      - Small dialect-local SQL using shared fixture/model: chosen.
    - Chosen Approach:
      - Extend testing/conformance exports and define versioned migration expectations before adapter packages.
    - API Notes and Examples:
      ```ts
      await runSessionStoreConformance(() => createStore(testDatabase));
      ```
    - Files to Create/Edit:
      - `src/testing/session-store-conformance.ts`, run-ledger conformance modules/exports/tests.
      - `docs/database-persistence.md`, `docs/session-store-conformance.md`, `docs/index.md`.
    - References:
      - Existing in-memory/JSONL behavior; Plan 053 JSONL boundary.
  - Test Cases to Write:
    - Concurrent parent conflict, restart duplicate, branch isolation, paginated query, migration up/reopen, tenant collision.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — reusable conformance/migration expectations.
    - Docs pages to create/edit: `docs/database-persistence.md`, `docs/session-store-conformance.md`.
    - `docs/index.md` update: yes — production adapter conformance.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** `src/testing/persistence-schema.ts` ships `PersistenceSchemaModel`, migration contract, pagination/tenant fixtures, and parameterized-query guidance; `src/testing/run-ledger-conformance.ts` ships `assertRunLedgerConforms` / `runRunLedgerConformance`; `src/testing/session-store-conformance.ts` extended with `runSessionStoreConformance`, branch isolation, concurrent fork, and reopen probes; package exports `./testing/persistence-schema` and `./testing/run-ledger-conformance`; docs updated (`database-persistence.md`, `session-store-conformance.md`, `run-ledger-conformance.md`, `index.md`, `release-and-install.md`); tests in `persistence-schema.test.ts` and `conformance-helpers.test.ts`.

- [x] 2. Ship SQLite session-store and run-ledger package
  - Acceptance Criteria:
    - Functional: Adapter passes full session/branch/idempotency/run-ledger conformance across process reopen and migrations; supports explicit database path/connection and close.
    - Performance: Indexed append/query meets documented local workload target; transactions use appropriate busy timeout/WAL policy; no whole-database scans in normal operations.
    - Code Quality: Driver is optional-package-local and supports project Node >=20; SQL parameterized and migrations versioned/idempotent.
    - Security: File mode/path ownership documented, tenant isolation tested, unsafe pragmas/path interpolation prohibited, event payloads remain redacted upstream.
  - Approach:
    - Documentation Reviewed:
      - Task 0 selected maintained SQLite driver docs/version; SQLite transactions, WAL, busy timeout, foreign keys.
    - Options Considered:
      - Node `node:sqlite`: incompatible with Node 20 baseline unless baseline changes.
      - Maintained Node 20-compatible driver in optional package: chosen unless release plan deliberately raises engine after compatibility review.
    - Chosen Approach:
      - Implement `@arnilo/prism-session-store-sqlite` over selected driver and Task 1 schema/conformance.
    - API Notes and Examples:
      ```ts
      const persistence = createSqlitePersistence({ filename: "./prism.db" });
      await persistence.close();
      ```
    - Files to Create/Edit:
      - New `packages/session-store-sqlite/**`; root workspace/lock/build/pack/install files.
      - `docs/database-persistence.md`, new `docs/sqlite-persistence.md`, `docs/index.md`.
    - References:
      - Review capability gap #5.
  - Test Cases to Write:
    - Fresh/migrated/reopened DB, concurrent append conflict, restart idempotency, tenant isolation, lock timeout, close/reopen, injection strings.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new persistence package.
    - Docs pages to create/edit: `docs/sqlite-persistence.md`, `docs/database-persistence.md`.
    - `docs/index.md` update: yes — Compaction/session memory → SQLite persistence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** `@arnilo/prism-session-store-sqlite` ships `createSqlitePersistence` implementing `SessionStore` + `RunLedger` + `ProductionPersistenceStore` over `better-sqlite3@^12.11.1` with WAL, 5s busy timeout, `001_init` migrations matching `@arnilo/prism/testing/persistence-schema`, parameterized append transaction (parent check + idempotency dedup), recursive `readBranchPath`, cursor pagination, and `close()`; package tests pass full `runSessionStoreConformance` (reopen, branch read, concurrent fork) and `runRunLedgerConformance` (reopen, tenant isolation) plus pagination/tenant/injection probes; docs: `docs/sqlite-persistence.md`, `docs/database-persistence.md`, `docs/index.md`; packaging/install guards updated.

- [x] 3. Ship PostgreSQL session-store and run-ledger package
  - Acceptance Criteria:
    - Functional: Adapter passes conformance across pooled connections/restarts/migrations and supports transactions, tenant scope, close ownership, and configurable schema.
    - Performance: Uses indexed parameterized queries, bounded pool, server-side pagination, and one transaction per atomic append; benchmark target documented.
    - Code Quality: Maintained driver dependency remains package-local; migration locking/versioning prevents concurrent setup races.
    - Security: Identifier configuration is validated/quoted, values parameterized, TLS/credential ownership documented, tenant-crossing queries impossible in tests.
  - Approach:
    - Documentation Reviewed:
      - Current selected PostgreSQL driver docs/version; PostgreSQL transaction isolation, advisory locks/migrations, pools, TLS.
    - Options Considered:
      - Generic SQL adapter shared with SQLite: dialect/driver abstraction adds complexity.
      - Separate package sharing only contracts/conformance: chosen.
    - Chosen Approach:
      - Implement `@arnilo/prism-session-store-postgres` with explicit pool ownership and versioned migrations.
    - API Notes and Examples:
      ```ts
      const persistence = await createPostgresPersistence({ pool, schema: "prism" });
      ```
    - Files to Create/Edit:
      - New `packages/session-store-postgres/**`; root workspace/lock/build/pack/install files.
      - `docs/postgres-persistence.md`, `docs/database-persistence.md`, `docs/index.md`.
    - References:
      - Review capability gap #5.
  - Test Cases to Write:
    - Container-backed integration (explicit opt-in), fake/unit SQL tests offline, migration race, pool exhaustion/abort, TLS config, injection/tenant isolation.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new persistence package.
    - Docs pages to create/edit: `docs/postgres-persistence.md`, `docs/database-persistence.md`.
    - `docs/index.md` update: yes — Compaction/session memory → PostgreSQL persistence.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** `@arnilo/prism-session-store-postgres` ships `createPostgresPersistence` implementing `SessionStore` + `RunLedger` + `ProductionPersistenceStore` over `pg@^8.22.0` with validated/quoted configurable schema (default `prism`), bounded adapter-owned pools (`poolMax` default 10), `pg_advisory_xact_lock` migration setup, `001_init` DDL matching `@arnilo/prism/testing/persistence-schema`, parameterized append transaction, recursive `readBranchPath`, cursor pagination, and `close()`; offline tests cover identifier validation and DDL/schema-model alignment; opt-in `PRISM_TEST_POSTGRES_URL` integration suite passes full `runSessionStoreConformance` (reopen, branch read, concurrent fork) and `runRunLedgerConformance` (reopen, tenant isolation) plus pagination/tenant/injection/migration-race probes; docs: `docs/postgres-persistence.md`, `docs/database-persistence.md`, `docs/index.md`; packaging/install guards updated.

- [x] 4. Ship encrypted-file and system-keychain credential adapters
  - Acceptance Criteria:
    - Functional: Package implements OAuth credential store/resolver integration, encrypted file persistence, system keychain get/set/delete, namespacing by app/provider/account, migration/rotation, and explicit locked/unavailable states.
    - Performance: KDF parameters are calibrated/configurable with safe minimum; writes atomic; keychain calls timeout/abort where backend supports it.
    - Code Quality: Core remains storage-agnostic; backend dependencies are optional/dynamically isolated; credential format is versioned.
    - Security: Authenticated encryption uses Node crypto (AEAD), random salt/nonce, restrictive permissions, no plaintext temp/log/error, wrong key fails closed, memory buffers cleared where practical; keychain fallback is never silently plaintext.
  - Approach:
    - Documentation Reviewed:
      - `docs/credentials-and-redaction.md`, OAuth credential contracts, Node crypto/file APIs; current maintained cross-platform keychain backend docs selected in Task 0.
    - Options Considered:
      - Core global credential store: violates host ownership.
      - Optional Node package with encrypted file + keychain backends: chosen.
    - Chosen Approach:
      - Add `@arnilo/prism-credentials-node`, versioned AES-GCM envelope with scrypt/selected KDF, atomic rename, and explicit keychain adapter.
    - API Notes and Examples:
      ```ts
      const store = createEncryptedCredentialStore({ path, getPassphrase });
      const resolver = createStoredCredentialResolver(store);
      ```
    - Files to Create/Edit:
      - New `packages/credentials-node/**`; root package/build/install files.
      - `docs/credential-storage.md`, `docs/credentials-and-redaction.md`, `docs/settings-auth-trust-security.md`, `docs/index.md`.
    - References:
      - Review capability gap #11.
  - Test Cases to Write:
    - Round trip/restart, wrong key, tamper, rotation, crash-safe write, permissions, keychain unavailable/timeout, namespace isolation, no plaintext scan.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — credential storage package/backends.
    - Docs pages to create/edit: `docs/credential-storage.md`, `docs/credentials-and-redaction.md`, `docs/settings-auth-trust-security.md`.
    - `docs/index.md` update: yes — Security/auth/trust → Credential storage.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** `@arnilo/prism-credentials-node` ships `openEncryptedCredentialStore` / `createEncryptedCredentialStore` (AES-256-GCM + scrypt envelope, atomic rename, `0600` file mode, `rotateEncryptedCredentialStorePassphrase`), `createKeychainCredentialStore` (`@napi-rs/keyring@^1.3.0`, namespaced service/account keys, explicit locked/unavailable/timeout errors, no plaintext fallback), `createStoredCredentialResolver`, and `createOAuthCredentialStoreAdapter` for `refreshOAuthCredential`; package tests cover round-trip/reopen, wrong key, tamper, rotation, namespace isolation, permissions, plaintext scan, and opt-in keychain (`PRISM_TEST_KEYCHAIN=1`); docs: `docs/credential-storage.md`, cross-refs in `credentials-and-redaction.md`, `settings-auth-trust-security.md`, `docs/index.md`; packaging/install guards updated.

- [x] 5. Add bounded audio, file, and document content contracts and resource loading
  - Acceptance Criteria:
    - Functional: Content contracts represent audio and file/document references with MIME, name, bytes/URL/resource reference, optional transcript/metadata; loaders resolve allowed sources; unsupported providers reject by capability before network call.
    - Performance: Global/per-item bytes, count, duration, and fetch timeout limits are configurable and finite; streaming/file handles close promptly.
    - Code Quality: Generic content blocks do not embed one provider's upload IDs; provider capability metadata declares modalities and limits.
    - Security: URL loading applies SSRF policy, local paths use resource trust policy, MIME/magic validation and decompression limits apply, secrets/bytes excluded from diagnostics.
  - Approach:
    - Documentation Reviewed:
      - `docs/input-and-prompt-assembly.md`, `docs/resource-loading.md`, `docs/model-registry.md`, current supported provider media APIs at implementation.
    - Options Considered:
      - Provider-specific options only: prevents portable input.
      - Generic references plus provider mapping/upload lifecycle: chosen.
    - Chosen Approach:
      - Extend `ContentBlock` and resource loader with bounded sources; add model capabilities before provider mapping.
    - API Notes and Examples:
      ```ts
      { type: "file", mediaType: "application/pdf", name: "report.pdf", data: bytes }
      { type: "audio", mediaType: "audio/wav", data: bytes }
      ```
    - Files to Create/Edit:
      - Core content/resource/model contracts and tests (extract from `contracts.ts` cohesively).
      - `docs/input-and-prompt-assembly.md`, `docs/resource-loading.md`, `docs/model-registry.md`, `docs/index.md`.
    - References:
      - Review capability gap #10.
  - Test Cases to Write:
    - Bytes/URL/resource variants, bounds, abort, MIME spoof, SSRF/path denial, unsupported capability, serialization safety.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new content blocks/loader/capabilities.
    - Docs pages to create/edit: `docs/input-and-prompt-assembly.md`, `docs/resource-loading.md`, `docs/model-registry.md`.
    - `docs/index.md` update: yes — Input and prompt assembly → Multimodal content.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** `src/content.ts` ships `AudioContent`/`FileContent`/`DocumentContent`, `resolveMediaContentBlock`, `assertSsrfAllowedUrl`, `assertMediaBlocksWithinBounds`, `UnsupportedModalityError`, and `MODEL_INPUT_CAPABILITIES`; `src/resources.ts` adds `loadBinaryResource`; `assembleProviderInput()` enforces `assertMessagesSupportModelCapabilities()`; tests in `src/__tests__/content.test.ts`; docs: `docs/multimodal-content.md`, cross-refs in `input-and-prompt-assembly.md`, `resource-loading.md`, `model-registry.md`, `docs/index.md`; `packages/compaction-llm/src/tokens.ts` updated for new block types.

- [x] 6. Implement supported provider audio/file/document mappings and conformance
  - Acceptance Criteria:
    - Functional: Every first-party provider either maps each declared modality correctly or advertises unsupported; upload-backed APIs manage create/use/delete lifecycle; text/image behavior remains compatible.
    - Performance: Reusable upload handles/cache avoid duplicate uploads within configured scope; cleanup and retention are bounded/documented.
    - Code Quality: Mapping remains provider-local over generic blocks; conformance enforces capabilities match behavior.
    - Security: Auth headers own uploads, remote IDs are tenant/run-scoped, temporary resources clean up, content/errors are redacted, unsupported content never silently drops.
  - Approach:
    - Documentation Reviewed:
      - Current provider API docs for audio/files/documents and retention; Task 5 contracts; provider conformance.
    - Options Considered:
      - Claim universal support: incorrect.
      - Capability-accurate support matrix and explicit rejection: chosen.
    - Chosen Approach:
      - Implement at least providers with documented native support; mark/test others unsupported rather than lossy conversion.
    - API Notes and Examples:
      ```ts
      if (!model.capabilities.input?.includes(block.type)) throw new UnsupportedModalityError(block.type);
      ```
    - Files to Create/Edit:
      - Supporting provider source/tests/READMEs and model metadata.
      - `docs/providers/*.md`, `docs/provider-conformance.md`, `docs/multimodal-content.md`, `docs/index.md`.
    - References:
      - Review capability gap #10; Plan 054 shared provider primitives.
  - Test Cases to Write:
    - Provider request snapshots, upload lifecycle/cleanup, abort/retry, unsupported path, byte leak/error redaction.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — provider modalities.
    - Docs pages to create/edit: `docs/multimodal-content.md`, supporting provider pages, `docs/provider-conformance.md`.
    - `docs/index.md` update: yes — provider support matrix.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** `@arnilo/prism/providers/media` ships shared wire helpers (`serializeOpenAIResponsesInputFile`, `serializeOpenAIResponsesInputAudio`, `serializePdfDocumentWireBlock`, `createBoundedUploadCache`, `rejectProviderMediaBlock`); `@arnilo/prism-provider-openai` maps `audio`/`file`/`document` on Responses API with `createOpenAIFileUploadManager` (inline `file_data` under 4 MiB, cached `POST /v1/files` + best-effort `DELETE` cleanup); OpenCode Go Anthropic route + Kimi map PDF `document`/`file`; OpenRouter/NeuralWatt/Z.ai/OpenCode OpenAI route reject undeclared media; model capabilities updated (`gpt-5.1`, `claude-sonnet-4.5-go`, `kimi-k2.7-code`); tests: `src/__tests__/provider-media.test.ts`, `packages/provider-openai/src/__tests__/openai-media.test.ts`, `packages/provider-opencode-go/src/__tests__/opencode-go.test.ts`; docs: `multimodal-content.md` support matrix, `provider-conformance.md`, `release-and-install.md`, `review-coverage-2026-07-14.md`.

- [x] 7. Verify persistence, credentials, and multimodality phase
  - Acceptance Criteria:
    - Functional: All conformance/package/install tests pass; optional PostgreSQL live test passes in CI service; review matrix closes 056 rows.
    - Performance: Query plans/benchmarks, KDF calibration, and media limits meet documented thresholds.
    - Code Quality: New packages have exports, READMEs, changelogs, type/build/pack smoke; core remains dependency-light.
    - Security: SQL isolation/injection, encrypted-store tamper/plaintext scans, keychain failure, SSRF/path/media attacks, and audit pass.
  - Verification result (2026-07-14):
    - `npm run sdk:ready` pass: typecheck + 1,396 tests (1,371 pass / 25 live skips / 0 fail) + all workspace `pack:dry-run`.
    - Live PostgreSQL matrix pass (`PRISM_TEST_POSTGRES_URL`, 7 integration tests) and CI `postgres-integration` job added to `.github/workflows/release.yml`.
    - OpenAI multimodal serialization fix: inline `file_data` now uses `data:<mediaType>;base64,...` so conformance canaries retain MIME identity; audio canaries no longer require wire-omitted name/mediaType tokens.
    - `npm audit --audit-level=high` → 0 vulnerabilities; core stays dependency-free; new optional packages pack/export cleanly.
    - Review matrix rows C-005 / C-010 / C-011 marked **verified** in `docs/review-coverage-2026-07-14.md`.
  - Approach:
    - Documentation Reviewed:
      - Tasks 0-6 docs and conformance/release gates.
    - Options Considered:
      - Network/service tests in default suite: violates network-free default.
      - Offline default plus explicit CI PostgreSQL integration: chosen.
    - Chosen Approach:
      - Run package gates and opt-in service matrix; inspect tarballs and update evidence.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres
      ```
    - Files to Create/Edit:
      - CI verification workflow, `docs/review-coverage-2026-07-14.md`, plan evidence.
    - References:
      - Plan 058 final release gate.
  - Test Cases to Write:
    - No new cases; run all 056 tests including live PostgreSQL matrix.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only.
    - Docs pages to create/edit: review coverage evidence.
    - `docs/index.md` update: no additional entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Evidence (2026-07-14):** Phase gate green — `sdk:ready` (1,396/1,371/25/0), live Postgres 13/13 with service URL, CI `postgres-integration` job, audit clean, C-005/C-010/C-011 verified; OpenAI inline file data-URL fix landed during verification.

## Compromises Made

- Database, credential, and native keychain implementations stay outside dependency-free core and the base/code/sdk profiles. `@arnilo/prism-all` intentionally includes them as the complete profile, accepting native/database dependencies.
- Live PostgreSQL and OS keychain tests remain opt-in (`PRISM_TEST_POSTGRES_URL`, `PRISM_TEST_KEYCHAIN=1`); Postgres is additionally enforced in CI and passed Task 8's fresh-container 15/15 gate, while keychain remains OS-owned so the default suite stays network-free.
- `node:sqlite` was rejected for the Node >=20 baseline; SQLite uses `better-sqlite3@^12.11.1` (native addon / install-script).
- DB run-ledger adapters upsert `appendRun` by run id (terminal snapshot may replace running) while still preserving `startedAt`; memory/JSONL fixtures may keep append-only history — conformance accepts both shapes.
- Same-timestamp session entry ordering relies on SQLite `rowid` / Postgres `ctid` rather than an explicit append-sequence column.
- System keychain `list()` / `listOAuth()` are unavailable (backend cannot enumerate); callers must use known provider/account keys.
- Providers do not receive a `resourceLoader` on `ProviderRequest`; hosts must pre-resolve `resourceUri` media to `data`/`url` before provider calls.
- Capability-accurate modality matrix: OpenAI Responses maps audio/file/document; Kimi + OpenCode Go Anthropic map PDF document/file only; OpenRouter/NeuralWatt/Z.ai/OpenCode OpenAI route reject undeclared media rather than lossy conversion.
- OpenAI inline files under 4 MiB use `data:<mediaType>;base64,...` `file_data`; larger payloads upload via Files API with best-effort DELETE cleanup (remote retention remains provider-owned).

## Further Actions

- Resolved by Plan 058 Tasks 1 and 8: packed persistence/credentials/multimodal composition passes; fresh PostgreSQL 16 passes 15/15 live integration tests.
- Resolved by Plan 058 Task 2: SQLite and scrypt/KDF measurements are published; PostgreSQL correctness remains measured by its environment-owned live matrix.
- Resolved by Plan 058 Task 5: persistence and credentials remain outside smaller profiles and are included by `prism-all`.
- Post-0.0.4 / P3: consider provider-side `resourceUri` resolution/upload preparation only if hosts need provider-owned I/O; current explicit pre-resolution stays safer and complete.
- Post-0.0.4 / P3: add an explicit append-sequence column only if `ctid`/`rowid` ordering fails under measured VACUUM/rewrite workloads.
