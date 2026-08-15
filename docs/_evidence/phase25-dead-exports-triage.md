# Phase 25 — Task 4 dead-export triage

Generated 2026-08-15. Tarball-excluded (`docs/_evidence` is outside `package.json` `files`).

## Method

1. `node scripts/dead-exports.mjs > scripts/phase25-dead-exports-raw.txt` — the plan-015 naive scan: parses `export`ed symbol names from non-test `src`/`packages` `.ts`, counts word-boundary references across the same non-test `.ts` set, and reports symbols with `<=1` reference (definition-only). Two known blind spots (per its `ponytail:` note): it **excludes `__tests__`** (so a symbol used only in tests reads as definition-only) and **cannot see `export *` star re-exports** (the star does not name the symbol).
2. Deeper per-candidate grep across the full repo (incl. `__tests__`, `dist`, `scripts`) to classify each candidate as **used** (false positive of the naive scan) or **truly dead** (definition-only even with `__tests__`).
3. Compat-baseline check: is the candidate in `scripts/compat-baseline/*.txt`? The release gate (`scripts/release-gates.mjs extractDeclaredSurface`) captures every `export declare` local in `dist/**/*.d.ts` (functions/classes/consts) but **does not capture `export type`/`export interface` aliases** (they survive only via named re-exports). So a tracked candidate's removal is a gate `REMOVED` (breaking); an untracked type-alias's removal is gate-invisible but may still be consumer-reachable.
4. Exports-map check: is the candidate reachable via a package `exports` subpath or re-exported from the package/root index? If yes → public (removal breaks the 0.2.5 additive-only contract, silently for type aliases the gate cannot see).
5. Security check: no candidate that is a validation/guard at a trust boundary is removed; each such candidate is allow-listed "security guard/helper, retained."

## Result

**62 candidates → 2 removed, 60 allow-listed.**

- **Removed (2):** internal dead type-alias interfaces — not compat-tracked, not exports-map-reachable, zero references (incl. `__tests__`). Pure deletion; `compat-diff` reports zero breaking deltas for both adapters; adapter tests unchanged.
- **Deferred — public type alias not gate-tracked (3):** dead or test-used but public (reachable via an `exports` subpath or the root contract re-export); removal would silently break the 0.2.5 additive-only contract (the gate cannot see `export type`/`interface` removal). Deferred to a future breaking cut.
- **Allow-listed — test-used false positive (37):** used in `__tests__` (adapter conformance, supervisor, persistence-contracts type tests, etc.) — the naive scan's `__tests__` blind spot. Not dead.
- **Allow-listed — dead but compat-tracked (20):** truly dead (zero references incl. `__tests__`) but present in a compat baseline as an `export declare` local; removal is a gate `REMOVED` (breaking); 0.2.5 is additive-only, so deferred to a future breaking cut with `--allow-break` + a `docs/migration.md` note. Several are security guards/helpers (see Security).

Post-removal scan: `node scripts/dead-exports.mjs` reports **60 candidates** (the 2 removed interfaces are gone); all 60 are on the reviewed allow-list below.

## Removed (2)

| symbol | defined in | reason |
|---|---|---|
| `PostgresPersistenceCloseOptions` | `packages/session-store-postgres/src/types.ts` | internal dead `export interface` (`{ readonly pool?: Pool }`); not re-exported from the package index (only `PostgresPersistenceOptions` is); package `exports` map exposes only `.` (no `./types` subpath) so not consumer-reachable; `close(): Promise<void>` takes no args so never wired; zero references incl. `__tests__`; not compat-tracked (type alias). Removed. |
| `SqlitePersistenceCloseOptions` | `packages/session-store-sqlite/src/types.ts` | internal dead `export interface` (`{ readonly database?: Database.Database }`); same shape as the Postgres case (only `.` exposed, not re-exported, `close(): void` takes no args, zero references); not compat-tracked. Removed. |

## Deferred — public type alias not gate-tracked (3)

| symbol | defined in | reason |
|---|---|---|
| `OidcIdentityVerifierResult` | `packages/credentials-node/src/oidc.ts` | public via the `./oidc` `exports` subpath (`dist/oidc.d.ts`); a `Result` type alias (not a gate local). Dead (zero references) but removal breaks the additive-only contract silently (gate-invisible). Defer to breaking cut. |
| `SessionBranchHandle` | `src/contracts-core/session.ts` | public contract type — re-exported through the root `contracts` barrel and asserted in `src/__tests__/persistence-contracts.types.test.ts`. A `type` alias (not a gate local). Defer to breaking cut. |
| `ProviderSecretLeakConformanceOptions` | `src/testing/provider-conformance.ts` | public testing surface via the `./testing/provider-conformance` `exports` subpath. An `interface` (not a gate local). Dead (zero references) but public. Defer to breaking cut. |

## Allow-listed — test-used false positive (37)

Used in `__tests__` (the naive scan excludes `__tests__`); not dead.

`expandPath`, `resolveReadPath`, `truncateHead` (coding-agent path/truncate helpers), `assertRestrictiveFileMode` (credentials-node file-mode guard, security), `writeCavemanConfig` (prism-caveman), `createNeuralWattProviderPackage` (provider-neuralwatt), `createS3ArtifactBodyStore` (server artifact bodies), `canonicalizeA2AAgentCard`, `signA2AAgentCard`, `verifyA2AAgentCard`, `createA2AClient`, `createA2AAgentEventSource`, `deliverA2APushEvent`, `createSupervisor` (supervisor a2a + factory), `defaultUserConfigPath`, `loadConfigFiles`, `createJsonlSessionStore`, `loadSettingsFiles` (node config/settings/session-store), `parseJsonObjectArguments` (providers/transport), `assertCompactionStrategyConforms`, `assertExtensionConforms`, `runFeedbackConformance`, `assertAdapterSchemaMatchesModel`, `assertParameterizedQuery`, `assertPersistenceQueryPaginationConforms`, `assertTenantScopedQueryIsolation`, `PARAMETERIZED_QUERY_GUIDANCE`, `tenantScopedUniqueKey` (testing/persistence-schema SQL-injection/pagination guards), `assertAbortIsObserved`, `assertNoSecretLeak`, `assertProviderOwnedHeadersWin`, `assertProviderStreamConforms`, `assertSerializedRequestCoversContent`, `assertToolCallDeltasReconstruct` (testing/provider-conformance), `runSessionStoreConformance` (testing/session-store-conformance, consumed by both adapter conformance suites), `assertStateConcurrencyConforms` (testing/state-concurrency-conformance), `assertToolDispatchConforms` (testing/tool-conformance).

## Allow-listed — dead but compat-tracked (20)

Truly dead (zero references incl. `__tests__`) but present in a compat baseline as an `export declare` local; removal is a gate `REMOVED` (breaking). 0.2.5 is additive-only → deferred to a future breaking cut.

| symbol | defined in | security? |
|---|---|---|
| `codingSha256Hex` | `packages/coding-agent/src/coding-checkpoint.ts` | — |
| `resolveUnderRoot` | `packages/coding-security/src/sandbox-tar.ts` | path-escape guard (sandbox trust boundary) — retained |
| `secureCompare` | `packages/credentials-node/src/envelope.ts` | constant-time compare helper — retained (security) |
| `zeroBuffer` | `packages/credentials-node/src/envelope.ts` | secret-buffer clear helper — retained (security) |
| `removeFileIfExists` | `packages/credentials-node/src/file-io.ts` | secure-cleanup helper — retained (security) |
| `assertMcpContentWithinLimit` | `packages/mcp/src/content.ts` | MCP content bounds guard — retained (security) |
| `PONYTAIL_PEER_RANGE` | `packages/prism-ponytail/src/upstream.ts` | documented `ponytail:` peer-range ceiling — retained |
| `withOpenRouterCacheMarker` | `packages/provider-openrouter/src/cache.ts` | — |
| `assertOwnershipForLoad` | `packages/workflows/src/checkpoint-core.ts` | checkpoint ownership guard (trust boundary) — retained |
| `assertOwnershipForSave` | `packages/workflows/src/checkpoint-core.ts` | checkpoint ownership guard (trust boundary) — retained |
| `assertVersionAdvance` | `packages/workflows/src/checkpoint-core.ts` | version-monotonicity guard — retained |
| `parseListOffsetCursor` | `packages/workflows/src/checkpoint-core.ts` | — |
| `nodeKindOf` | `packages/workflows/src/util.ts` | — |
| `statusFromState` | `src/agent-run-state.ts` | — |
| `isInitProvider` | `src/cli-init.ts` | — |
| `parseContextFile` | `src/node/agent-definitions.ts` | — |
| `parseToolFile` | `src/node/agent-definitions.ts` | — |
| `defaultUserSettingsPath` | `src/node/settings.ts` | — |
| `resolveProviderMediaBlock` | `src/providers/media.ts` | — |
| `runToolEffectStoreConformance` | `src/testing/tool-effect-store-conformance.ts` | public testing surface (gate-tracked local); dead but exported — retained |

## Named-internal-cleanup audit (D4a) — no-op

`sweep-unused.mjs` (`tsc --noUnusedLocals --noUnusedParameters` over core + every workspace tsconfig) reports **5 diagnostics**, all `_`-prefixed test placeholders (`_AgentConfigHasNoExtensions`, `_AgentConfigHasNoSettings` in `src/__tests__/agent-config.types.test.ts`; `_mgr` in `packages/browser/src/__tests__/evaluate.test.ts`; `_assignable` in `packages/provider-alibaba/src/__tests__/embeddings.test.ts`) — zero unused locals in `src/agent-session/*` (the Task 1 split files), `src/cache-telemetry.ts`, or `src/skill-load.ts`.

Manual audit of the three roadmap-named modules:
- `src/agent-session/*` (Task 1 split: `create-agent`, `session`, `event-subscriber`, `helpers`): mechanical verbatim move from the monolith (Task 1); `noUnusedLocals` clean; no dead branches or redundant scans introduced.
- `src/skill-load.ts` map/Set builds at lines 62 (`byName`), 81 (`out`), 85 (`known`), 129 (`toolNames`): each result is read (lookups / returns / push / `has`); all load-bearing. No dead map.
- `src/cache-telemetry.ts`: fully public, re-exported from `src/index.ts`; `samples` (101), `samplesAll` (157), `listed` (160) maps/reduces are all read downstream. No partially-read `.map()` result, no constant imported only by a dead branch.

**Recorded no-op: "audit-clean (post Task 1 split); `sweep-unused.mjs` zero diagnostics in `src/agent-session/*` + `cache-telemetry.ts` + `skill-load.ts`; manual audit confirms all map/Set builds load-bearing."**

## Security

No security guard or trust-boundary validation is removed. The 2 removed interfaces are non-security close-options types. Security-relevant candidates among the allow-list are marked "retained" above (`resolveUnderRoot`, `secureCompare`, `zeroBuffer`, `removeFileIfExists`, `assertMcpContentWithinLimit`, `assertOwnershipForLoad`, `assertOwnershipForSave`, `assertVersionAdvance`, `assertRestrictiveFileMode`, plus the `assert*`/`assertNoSecretLeak`/`assertParameterizedQuery` testing guards).

## Migration

No public export removed → no `docs/migration.md` `0.2.4 → 0.2.5` note required. The 2 removals are internal type aliases (not gate-tracked, not exports-map-reachable). The compat baselines are unchanged (zero breaking deltas confirmed via `scripts/phase25-compat-diff.mjs`).