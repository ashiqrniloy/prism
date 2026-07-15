# Persistence, credentials, and multimodality primitives

## What it does

This page freezes the Plan 056 Task 0 inventory for production persistence, credential storage, and multimodal content. It maps existing `@arnilo/prism` contracts and conformance helpers, documents JSONL/security boundaries, records capability gaps **C-005**, **C-010**, and **C-011**, and pins package dependency choices for Tasks 1–7.

Implementation is **shipped and phase-verified** (Tasks 0–7). Optional packages cover SQLite/PostgreSQL persistence and Node credential storage; core remains dependency-free.

## When to use it

- **Adapter authors** implementing SQLite/PostgreSQL `SessionStore` + `RunLedger` should start here, then follow [Database persistence](database-persistence.md) and [Session store conformance](session-store-conformance.md).
- **Host apps** wiring CLI/desktop credential persistence should use the credential seams and package matrix here before choosing `@arnilo/prism-credentials-node` backends.
- **Provider and core authors** extending multimodal input should use the content/resource/capability designs here instead of embedding provider upload IDs in core contracts.
- **Security reviewers** use the threat model and conformance matrix on this page as the acceptance baseline for Plan 056 Tasks 1–7.

## Inventory (2026-07-14 baseline)

Static review of `src/contracts.ts`, `src/session-stores.ts`, `src/credentials.ts`, `src/input.ts`, `src/agents.ts`, `src/redaction.ts`, `src/node/session-store-jsonl.ts`, `src/testing/session-store-conformance.ts`, `examples/external-app-db-backed.ts`, and docs under `docs/session-stores*.md`, `docs/database-persistence.md`, `docs/runs-and-usage.md`, `docs/credentials-and-redaction.md`, `docs/settings-auth-trust-security.md`, `docs/input-and-prompt-assembly.md`, `docs/resource-loading.md`, `docs/model-registry.md`, `docs/provider-conformance.md`.

### Session store and branch invariants (shipped)

| Surface | Location | Behavior today |
| --- | --- | --- |
| `SessionStore` | `src/contracts.ts` | `append`, `list`, optional `get`, optional `readBranchPath` |
| `SessionAppendOptions` | `src/contracts.ts` | `expectedParentId` existence validation; opaque `idempotencyKey` for same-position retry dedup |
| `SessionAppendConflictError` | `src/contracts.ts` | Stable `code: "session_append_conflict"`; `isSessionAppendConflict()` |
| Branch helpers | `src/session-stores.ts` | `getSessionBranchEntries`, `listSessionBranches`, `rebuildSessionContext`; reader overload follows `nextCursor` (max 64 pages) |
| In-memory store | `src/session-stores.ts` | `createMemorySessionStore()` — O(1) dup/idempotency/parent maps; not durable |
| JSONL store | `src/node/session-store-jsonl.ts` | Single-process dev adapter; per-line quarantine; in-memory idempotency only |
| Conformance | `src/testing/session-store-conformance.ts` | `assertSessionStoreConforms(store, { exerciseReadBranchPath? })` |
| Reference adapter | `examples/external-app-db-backed.ts` | In-memory tables implementing `SessionStore` + `RunLedger` + `ProductionPersistenceStore` |

**Frozen branch semantics:** `expectedParentId` is parent **existence** validation, not tip-CAS. Two children of the same parent are allowed (fork/branch). Production adapters may add stricter tip compare-and-swap and populate `currentLeafId` in conflicts.

**Frozen idempotency semantics:** Dedup key is `(session_id, expected_parent_id, idempotency_key)`. A run-level key may appear on multiple linear appends as the leaf advances; only exact same-position retries collapse.

### Run ledger (shipped)

| Surface | Location | Behavior today |
| --- | --- | --- |
| `RunLedger` | `src/contracts.ts` | `appendRun`, `appendEvent`, `appendToolCall`, `appendUsage` |
| Runtime wiring | `src/agents.ts` | Active ledger from `RunOptions.runLedger ?? AgentConfig.runLedger`; ownership/idempotency from run options |
| Serialization | `src/agents.ts` | `ledgerChain` serializes event ledger appends (R-004 backpressure fix) |
| Redaction | `src/redaction.ts` | `redactRunLedgerRecord()` before every ledger write when `SecretRedactor` active |
| Conformance helper | `src/testing/session-store-conformance.ts` | `assertSessionStoreConforms`, `runSessionStoreConformance` |
| Run ledger conformance | `src/testing/run-ledger-conformance.ts` | `assertRunLedgerConforms`, `runRunLedgerConformance` |
| Shared schema model | `src/testing/persistence-schema.ts` | `createPersistenceSchemaModel`, `createPersistenceMigrationContract`, pagination/tenant fixtures |

### Production persistence contracts (shipped)

| Surface | Location | Behavior today |
| --- | --- | --- |
| `ProductionPersistenceStore` | `src/contracts.ts` | Cursor `query*` methods for sessions, branches, entries, runs, events, tool calls, usage, agent definitions, retention, migrations; optional `readBranchPath` |
| `OwnershipScope` | `src/contracts.ts` | `tenantId`, `accountId`, `userId` on records and queries — enforcement host-owned |
| Reference schema | `docs/database-persistence.md` | Relational table/index reference, conditional append transaction pattern, NoSQL mapping notes |
| Type compile test | `src/__tests__/persistence-contracts.types.test.ts` | Host adapter shapes compile without DB deps |

**Core boundary:** No ORM, SQL driver, connection pool, migration runner, or filesystem persistence in `@arnilo/prism`.

### Credential and OAuth seams (shipped — storage gap)

| Surface | Location | Behavior today |
| --- | --- | --- |
| `CredentialResolver` / `CredentialRequest` | `src/contracts.ts` | Host-implemented resolve at request edge |
| `resolveCredentialValue` | `src/credentials.ts` | String, callback, or resolver |
| `createExplicitCredentialResolver` | `src/credentials.ts` | Named source order (runtime → stored → env → fallback) |
| `createEnvCredentialResolver` | `src/credentials.ts` | Caller-supplied env object only; never reads `process.env` |
| `createMemoryCredentialStore` | `src/credentials.ts` | In-memory resolver + `set`/`delete`; not durable |
| `createChainedCredentialResolver` | `src/credentials.ts` | First match wins |
| `refreshOAuthCredential` | `src/credentials.ts` | Calls `OAuthProvider.refresh`; optional `OAuthCredentialStore.set` |
| `OAuthCredentialStore` | `src/contracts.ts` | `set(provider, credentials)` only — no `get`/`delete` in core contract |
| `OAuthProvider` / `OAuthCredentials` | `src/contracts.ts` | `login`, optional `refresh`, optional `getCredential` |
| Device-code OAuth | `packages/provider-openai` | Bounded polling; abort via `OAuthLoginCallbacks.signal` |
| Redaction | `src/redaction.ts` | Exact known-secret replacement; not secret detection |

**Gaps (C-011):** No encrypted file store, no system keychain adapter, no versioned credential envelope, no `OAuthCredentialStore` `get`/`delete`/`list` in core (Task 4 package may extend store interface locally while integrating `refreshOAuthCredential`).

### Content, resources, and model capabilities (shipped — modality gap)

| Surface | Location | Behavior today |
| --- | --- | --- |
| `ContentBlock` union | `src/contracts.ts` | `text`, `image`, `audio`, `file`, `document`, `thinking`, `tool_call_delta`, `tool_call`, `tool_result` |
| `AudioContent` / `FileContent` / `DocumentContent` | `src/content.ts` | MIME, name, `data`/`url`/`resourceUri`, optional transcript/metadata |
| `ImageContent` | `src/contracts.ts` | `mimeType?`, `data?`, `url?`, `resourceUri?`, `name?` |
| `InputAttachment` | `src/input.ts` | `text`, inline `content` blocks, or `uri` + `ResourceLoader` → text user message |
| `ResourceLoader` / `Resource` | `src/contracts.ts` | Host-owned `load(uri)`; optional `list`; `data`/`text`/`mediaType` |
| Resource helpers | `src/resources.ts` | `loadTextResource`, `loadJsonResource`, `loadManifestResource`, `loadBinaryResource` — decode/bounds only |
| Media helpers | `src/content.ts` | `resolveMediaContentBlock`, `assertSsrfAllowedUrl`, `assertMediaBlocksWithinBounds`, `UnsupportedModalityError` |
| `ModelCapabilities.input` | `src/contracts.ts` | Known tags: `text`, `image`, `audio`, `file`, `document`; `MODEL_INPUT_CAPABILITIES` export |
| Provider image mapping | first-party packages | OpenAI Responses, OpenRouter, OpenCode Go (Anthropic route), Kimi, NeuralWatt map `image` when capability allows |
| Provider audio/file/document mapping | first-party packages | OpenAI Responses maps `audio`/`file`/`document`; Anthropic routes map PDF `document`/`file`; others reject undeclared media |
| Provider conformance | `src/testing/provider-conformance.ts` | `assertSerializedRequestCoversContent` with per-provider `unsupported` list |

### JSONL and dev-store security boundaries (shipped)

| Boundary | Rule |
| --- | --- |
| Cross-process writes | JSONL has no lock; two processes on one file can race |
| Durable idempotency | JSONL idempotency is in-process only |
| Corrupt lines | Quarantined per line; do not poison whole file (R-005) |
| Schema/kind | Unknown kinds and future `schemaVersion` fail closed |
| Secrets in file | Host responsibility; runtime redacts before `append` when redactor configured |
| Production use | JSONL documented as dev-only; database adapters required for multi-writer |

## Package dependency and support matrix (pinned Task 0)

Prism `engines.node` is `>=20`. Optional packages stay package-local; core adds no new runtime dependencies.

| Package (planned) | Driver / backend | Pinned version | Node support | Rationale |
| --- | --- | --- | --- | --- |
| `@arnilo/prism-session-store-sqlite` | `better-sqlite3` | `^12.11.1` | 20.x–26.x per upstream engines | Synchronous API, WAL/busy_timeout, mature Node 20 baseline; `node:sqlite` rejected — requires Node ≥22.5 and is still experimental vs declared `>=20` baseline |
| `@arnilo/prism-session-store-postgres` | `pg` | `^8.22.0` | ≥16 (satisfies 20+) | Standard pool + parameterized queries; TLS/credentials host-owned |
| `@arnilo/prism-credentials-node` encrypted file | Node `crypto` (AES-256-GCM + scrypt) | built-in | 20+ | No extra deps for AEAD/KDF; atomic rename writes |
| `@arnilo/prism-credentials-node` keychain | `@napi-rs/keyring` | `^1.3.0` | ≥10 (satisfies 20+) | Cross-platform, actively maintained (2026); `keytar@7.9.0` rejected — last release 2022, heavier native rebuild friction |

**Rejected options:**

| Option | Why rejected |
| --- | --- |
| Database/ORM in core | Violates dependency-light core; hosts choose SQL dialect |
| `node:sqlite` at current baseline | Incompatible with Node 20 floor unless release plan raises engine |
| Generic SQL layer shared by SQLite + Postgres | Dialect/driver differences outweigh shared SQL abstraction |
| Core global credential store | Violates host ownership |
| Keychain silent fallback to plaintext file | Fail closed; explicit backend selection only |
| Provider upload IDs in `ContentBlock` | Provider-local mapping over generic references (Task 5–6) |

## ADR decision table (frozen for Tasks 1–7)

| Concern | Option A | Option B | **Chosen** | Rationale |
| --- | --- | --- | --- | --- |
| Persistence location | Core built-in DB | Optional packages over contracts | **Optional packages** | Matches Plan 053 JSONL boundary and `ProductionPersistenceStore` extension point |
| Schema/migrations | Core DDL generator | Shared fixture model + dialect-local SQL | **Shared fixtures + local SQL** | Two adapters without ORM |
| Run ledger conformance | Per-package tests only | Shared conformance module (Task 1) | **Shared module** | Parity with session-store conformance |
| Credential persistence | Core global store | `@arnilo/prism-credentials-node` | **Optional package** | Host selects file vs keychain |
| KDF | PBKDF2 default | scrypt with documented minimums | **scrypt** (configurable N/r/p) | Node built-in; calibrate in Task 4 tests |
| Multimodal content | Provider-specific options only | Generic `ContentBlock` + capability tags | **Generic blocks + capabilities** | Portable input; provider maps/uploads locally |
| URL/file sources | Loader reads anything | Bounded loader policy + trust integration | **Bounded + trust** | Reuse `createPathTrustPolicy` patterns; SSRF deny-by-default for URLs |
| Unsupported modality | Silent drop | Capability check before network | **Reject before provider call** | `UnsupportedModalityError` or equivalent host-visible error |

## Planned generic APIs (Tasks 1–6)

### Task 1 — Shared schema/conformance primitives

```ts
// Extend @arnilo/prism/testing exports (names illustrative)
export async function assertSessionStoreConforms(store, options?): Promise<void>;
export async function assertRunLedgerConforms(factory, options?): Promise<void>;
export interface PersistenceSchemaModel { /* versioned tables, tenant columns, idempotency side table */ }
```

### Task 2–3 — Database adapters

```ts
const store: SessionStore = createPostgresSessionStore({ pool, schema: "prism" });
const persistence = createSqlitePersistence({ filename: "./prism.db" });
await persistence.close();
```

Transaction boundary: **one transaction per `SessionStore.append`** covering idempotency insert, parent check, entry insert, optional branch leaf update.

### Task 4 — Credential package

```ts
const store = createEncryptedCredentialStore({ path, getPassphrase });
const keychain = createKeychainCredentialStore({ service: "prism" });
const resolver = createStoredCredentialResolver(store);
await refreshOAuthCredential({ provider, credentials, store });
```

Versioned envelope: `{ version, kdf, cipher, salt, nonce, ciphertext }` with authenticated encryption; file mode `0600` on Unix; wrong passphrase fails closed.

### Task 5 — Content contracts

```ts
{ type: "file", mediaType: "application/pdf", name: "report.pdf", data: bytes }
{ type: "audio", mediaType: "audio/wav", data: bytes, durationMs?: number }
```

`ResourceLoader` resolves `bytes`/`url`/`resource:` references under configurable global and per-item limits. `ModelCapabilities.input` gains `audio`, `file`, `document` tags when models support them.

### Task 6 — Provider mapping

```ts
if (!model.capabilities?.input?.includes(block.type)) {
  throw new UnsupportedModalityError(block.type);
}
```

Upload-backed providers manage create/use/delete lifecycle in package-local code; conformance asserts capabilities match behavior.

## Conformance and threat-model matrix

Tasks 1–7 must pass this matrix (unit/integration tests + existing `assertSessionStoreConforms` / provider conformance extensions):

| # | Scenario | Expected behavior |
| ---: | --- | --- |
| 1 | Process restart after successful append | Entry durable; idempotency row survives |
| 2 | Concurrent append same parent | One succeeds; other conflicts or serializes per adapter policy |
| 3 | Exact idempotency retry | `SessionAppendConflictError` with `idempotencyDuplicate: true`; no duplicate row |
| 4 | Distinct linear appends same run key | Both entries persist |
| 5 | Tenant A query with tenant B id | Empty or denied; never cross-tenant rows |
| 6 | SQL injection in session id / idempotency key | Parameterized queries only; no string interpolation of values |
| 7 | Wrong encryption passphrase | Decrypt fails closed; no partial plaintext |
| 8 | Tampered ciphertext / truncated file | AEAD verification fails |
| 9 | Key rotation / rewrap | Old credentials readable during migration window; new writes use new key |
| 10 | Keychain unavailable / timeout | Explicit locked/unavailable error; no silent plaintext fallback |
| 11 | URL fetch to RFC1918 / metadata IP | Denied by SSRF policy before fetch |
| 12 | Local path outside trust root | `createPathTrustPolicy` denies before read |
| 13 | MIME spoof (extension vs magic) | Reject or re-label per policy; no trust extension alone |
| 14 | Media bomb (zip/gzip/pdf) | Byte/time ceilings; streaming handles closed |
| 15 | Unsupported provider modality | Error before provider HTTP; never silent drop |
| 16 | Provider upload lifecycle | Temp remote IDs cleaned up on run end/abort within retention bound |
| 17 | Ledger + store redaction | No raw secrets in durable rows after `redactRunLedgerRecord` / `redactSessionEntry` |
| 18 | PostgreSQL migration race | Advisory lock or equivalent; one winner applies migrations |

### Threat model summary

| Threat | Owner | Mitigation |
| --- | --- | --- |
| SQL injection | Adapter package | Parameterized statements; validated/quoted identifiers for schema names |
| Tenant isolation bypass | Host + adapter | `tenantId` in unique/FK boundaries; integration tests per tenant |
| World-readable credential file | Credential package | `0600` perms, umask guidance, no plaintext temp files |
| Weak KDF parameters | Credential package | Documented minimum scrypt work factor; reject weak config |
| Keychain trust / spoof UI | Host OS | Document service/name namespacing; no auto-trust |
| SSRF via content URL | Host loader policy | Deny private/link-local/metadata ranges; allow-list option |
| Path traversal via file block | Host trust policy | Realpath containment before read |
| Media decompression bomb | Core limits + loader | Byte caps, stat-first reject, timeouts |
| MIME spoofing | Loader validation | Magic-byte sniff + declared type cross-check |
| Secret retention in DB/JSONL | Host + runtime | Redact before append; audit scans in Task 7 |
| JSONL multi-writer corruption | Host deployment | Document dev-only boundary; use DB adapter in production |
| Unsupported modality data loss | Provider layer | Capability-gated reject before network |

## Performance notes

| Concern | Target / guidance |
| --- | --- |
| Branch read | `readBranchPath` single ancestor query; avoid `list(sessionId)` for production context |
| Pagination | Cursor on `(timestamp, id)` or `(run_id, sequence)`; no offset scans on long sessions |
| `SessionStore.append` | One entry per transaction; O(1) indexed parent/idempotency checks |
| Connection pool (Postgres) | Host-sized; default max ~10 per process documented in package README |
| SQLite WAL | Enable WAL; busy timeout ≥ 5s documented; single-writer still recommended |
| Ledger writes | Serialized per session run; batching inside adapter allowed if order preserved |
| scrypt KDF | Default N=2^15, r=8, p=1 (adjust in docs after Task 4 calibration); cap passphrase attempts |
| Keychain calls | Timeout/abort where backend supports; do not block run loop unbounded |
| Global media budget | Default 32 MiB total per request assembly (Task 5); per-item default 10 MiB (align with `DEFAULT_MAX_IMAGE_BYTES`) |
| Audio duration ceiling | Default 5 minutes decoded (Task 5) |
| Fetch timeout | Default 30s per URL resource (Task 5) |
| Upload cache | Provider-local; bounded entries per run; cleanup on `done`/`error`/`abort` |

## Implementation example

```ts
import {
  createExplicitCredentialResolver,
  createMemoryCredentialStore,
  createMemorySessionStore,
} from "@arnilo/prism";
import { assertSessionStoreConforms } from "@arnilo/prism/testing/session-store-conformance";

// Today: memory + JSONL dev stores only.
const store = createMemorySessionStore();

// Task 2+:
// const store = createSqliteSessionStore({ filename: "./prism.db" });

await assertSessionStoreConforms(store, { exerciseReadBranchPath: true });

const resolver = createExplicitCredentialResolver([
  { name: "memory", resolver: createMemoryCredentialStore() },
]);
void resolver;
```

## Extension and configuration notes

- Hosts implement `SessionStore` and optional `RunLedger` / `ProductionPersistenceStore`; Prism runtime does not open databases or keychains.
- Credential backends are selected explicitly at app startup; no core singleton.
- Multimodal limits and SSRF/path policy are host-configurable; defaults are finite.
- Provider packages declare truthful `ModelCapabilities.input` and map or reject each block type.
- Live PostgreSQL tests remain opt-in for local runs (`PRISM_TEST_POSTGRES_URL` / `npm run test:postgres`) and are enforced in CI by the `postgres-integration` job; default `npm test` / `sdk:ready` stay network-free.

## Security and performance notes

See **Threat model summary** and **Performance notes** above. Cross-cutting rules:

- Never store `CredentialResolver`, provider instances, API keys, or unredacted secrets in session entries, ledger rows, or idempotency tables.
- Redact with `createSecretRedactor` / `redactRunLedgerRecord` / `redactSessionEntry` before durable writes.
- JSONL remains development-only; production multi-writer requires database adapters from Tasks 2–3.

## Related APIs

- [Database persistence](database-persistence.md): reference schema, indexes, conditional append pattern
- [Session stores](session-stores.md): runtime `SessionStore` contract and branch handles
- [Session store conformance](session-store-conformance.md): `assertSessionStoreConforms`
- [Runs and usage ledger](runs-and-usage.md): `RunLedger` write seam
- [Node JSONL session store](node-jsonl-session-store.md): dev-only file adapter boundaries
- [Credentials and redaction](credentials-and-redaction.md): core resolver/OAuth helpers
- [Security/auth/trust](settings-auth-trust-security.md): trust, permissions, memory credentials
- [Input and prompt assembly](input-and-prompt-assembly.md): attachments and input layout
- [Resource loading](resource-loading.md): `ResourceLoader` decode helpers
- [Model registry](model-registry.md): `ModelCapabilities` metadata
- [Provider conformance](provider-conformance.md): content preservation and secret leak checks
- [Review coverage (2026-07-14)](review-coverage-2026-07-14.md): traceability for C-005, C-010, C-011
