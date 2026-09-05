# Dead-export verification — plan 058 task 1 (2026-09-03)

Verifies and classifies all **87 dead-export candidates** from `scripts/unused-report.json`
(generated 2026-09-03 by `npm run sweep:unused` → `scripts/dead-exports.mjs`, a naive
regex scan). Supersedes the per-candidate part of
[`phase25-dead-exports-triage.md`](./phase25-dead-exports-triage.md) (62 candidates, 2026-08-15);
same method, refreshed against the 0.4.0 package-consolidation tree.

## Method

Per candidate, four evidence checks (script: `scripts/dead-export-verify.mjs`, 0.9 s runtime):

1. **Repo uses** — word-boundary grep across all repo `.ts`/`.mts`/`.cts` sources,
   **including `__tests__`, `examples`, `scripts`, `templates`** (the naive scan excludes
   `__tests__`, so test-only usage reads as "dead" — the dominant false-positive class).
2. **Compat** — symbol present in `scripts/compat-baseline/<pkg>.txt`. The baseline captures
   `export declare` locals (functions/classes/consts) plus named re-exports, but **not** local
   `export type`/`export interface` declarations (`extractDeclaredSurface` regex) — so
   compat=no does not mean "not shipped". 79/87 candidates are compat-tracked.
3. **Docs** — mention in real docs pages (`docs/` excluding the `_evidence` archive),
   `README.md`, `CHANGELOG.md`, or code examples. 41/87 have real-docs mentions;
   most of the rest appear only in archived phase evidence.
4. **External usage heuristics** — npm downloads last month (2026-09-03, api.npmjs.org):
   `@arnilo/prism` 13,372 · `prism-providers` 9,560 · `prism-mcp` 5,037 · `prism-ag-ui` 4,937 ·
   `prism-memory` 4,628 · `prism-web-tools` 4,520 · `prism-acp-agent` 741 · `prism-office` 0 ·
   `prism-coding-tools` 0 · `prism-core` 0. GitHub code search (web) for distinctive symbols
   (`createSupervisor`, `createNeuralWattProviderPackage`, `loadBundledSkills`,
   `assertMcpContentWithinLimit`, `secureCompare`) found **no third-party \`@arnilo/prism*\`
   imports** — hits are this repo's own docs (mirrored at github.com/ashiqrniloy/prism) and
   unrelated same-name symbols. Download traffic is consistent with CI mirrors, not
   symbol-level third-party imports; verdict: no external usage evidence for any candidate.

A fifth check — **entry reachability** — resolves, per symbol, whether it is importable
through a package `exports` subpath (following `export *` and named re-export chains from
entry files). 53/87 are entry-reachable; 34 are **dist-only** (declaration ships in `dist/`
but no `exports` subpath can import them — removal breaks no consumer import path).

## Verdict policy

- **keep** — used in-repo (tests/examples/scripts), documented API exercised in-repo, canonical
  default/seam value, or security guard with an explicit keeper note (never remove a
  trust-boundary seam to slim surface).
- **deprecate** — unused but entry-reachable and/or compat-tracked and/or documented: mark
  `@deprecated` + CHANGELOG in the deprecation wave; delete at the next allowed breaking cut.
- **remove** — unused, not entry-reachable, not compat-tracked, undocumented: no consumer
  import path and no contract obligation; safe to delete (verify with the release gate).

**Totals: 60 keep · 23 deprecate · 4 remove.**

## Decision table

| export | package | repo uses | compat | docs | external | verdict | why |
|---|---|---|---|---|---|---|---|
| `assertMcpContentWithinLimit` | @arnilo/prism-mcp | no | yes | no | none | keep | SECURITY KEEPER: MCP content bounds guard at trust boundary; phase 25 allowed it; keep seam |
| `DEFAULT_MAX_PROMPT_CHARS` | @arnilo/prism-memory | no | yes | no | none | deprecate | compat-tracked limit constant, zero refs, undocumented; remove at breaking cut |
| `ResolvedGraftExtension` | @arnilo/prism-memory | no | no | no | none | remove | type alias: not entry-reachable, not compat-tracked, zero refs, undocumented |
| `GRAFT_RESOLVE_ERROR_CODE` | @arnilo/prism-memory | no | yes | no | none | deprecate | compat-tracked error-code constant, zero refs, undocumented; remove at breaking cut |
| `assertScope` | @arnilo/prism-memory | no | yes | no | none | keep | SECURITY KEEPER: RAG vector-hit tenant/resource/corpus isolation guard (throws RagScopeError) |
| `LinterOptions` | @arnilo/prism-memory | no | no | no | none | deprecate | entry-reachable public type (wiki export *), gate-invisible, zero refs; remove at breaking cut |
| `WikiCategory` | @arnilo/prism-memory | no | no | no | none | remove | type alias: not entry-reachable, not compat-tracked, zero refs, undocumented |
| `ModerationCategory` | @arnilo/prism | no | yes | no | none | keep | canonical vocabulary alias of `MODERATION_CATEGORIES` (docs/moderation.md); documented API surface |
| `createWikiExtension` | @arnilo/prism-memory | yes (4) | yes | yes | none | keep | documented primitive (docs/wiki.md); 4 test suites exercise it |
| `loadBundledSkills` | @arnilo/prism-memory | yes (1) | yes | no | none | keep | entry+compat; skills.test.ts exercises it |
| `generateDocument` | @arnilo/prism-office | yes (5) | yes | yes | none | keep | documented (docs/documents.md); 5 refs incl golden regen script |
| `documentModelSchema` | @arnilo/prism-office | yes (1) | yes | no | none | keep | schema-slice test uses it; documents.md documents the schema seam without naming it |
| `createPatchHistory` | @arnilo/prism-office | yes (1) | yes | yes | none | keep | documented (docs/documents.md); patch-history test uses it |
| `renderPreviewHtml` | @arnilo/prism-office | yes (2) | yes | yes | none | keep | documented (docs/documents.md); preview/telemetry tests use it |
| `renderPreviewBlocks` | @arnilo/prism-office | yes (2) | yes | yes | none | keep | documented (docs/documents.md); preview/telemetry tests use it |
| `noopDocumentsTelemetry` | @arnilo/prism-office | no | yes | no | none | keep | canonical no-op default of the DocumentsTelemetry option seam; entry+compat |
| `codingSha256Hex` | @arnilo/prism-coding-tools | no | yes | no | none | deprecate | compat-tracked helper, zero refs, undocumented; remove at breaking cut |
| `DEFAULT_MAX_REVIEW_DELTA_ENTRIES` | @arnilo/prism-coding-tools | no | yes | no | none | deprecate | compat-tracked limit constant, zero refs; remove at breaking cut |
| `HARD_MAX_REVIEW_DELTA_ENTRIES` | @arnilo/prism-coding-tools | no | yes | no | none | deprecate | compat-tracked limit constant, zero refs; remove at breaking cut |
| `expandPath` | @arnilo/prism-coding-tools | yes (1) | yes | no | none | keep | path-utils.test.ts uses it (naive scan excludes __tests__) |
| `resolveReadPath` | @arnilo/prism-coding-tools | yes (1) | yes | yes | none | keep | path-utils test + documented (docs/tool-execution-primitives.md) |
| `indexErrorCode` | @arnilo/prism-coding-tools | no | yes | no | none | deprecate | compat-tracked error-code helper, zero refs, undocumented; remove at breaking cut |
| `truncateHead` | @arnilo/prism-coding-tools | yes (2) | yes | no | none | keep | read + truncate tests use it |
| `writeCavemanConfig` | @arnilo/prism-coding-tools | yes (1) | yes | no | none | keep | caveman.test.ts uses it |
| `CavemanSkillName` | @arnilo/prism-coding-tools | no | no | no | none | remove | type alias: not entry-reachable, not compat-tracked, zero refs, undocumented |
| `mountInspector` | @arnilo/prism-coding-tools | yes (1) | yes | no | none | keep | dev ui test uses it; dev-inspector is dev-only surface (review §2) |
| `PONYTAIL_PEER_RANGE` | @arnilo/prism-coding-tools | no | yes | no | none | deprecate | compat-tracked constant, zero refs outside _evidence archive; remove at breaking cut |
| `resolveUnderRoot` | @arnilo/prism-coding-tools | no | yes | no | none | keep | SECURITY KEEPER: sandbox path-escape guard (tar trust boundary); phase 25 allowed it |
| `secureCompare` | @arnilo/prism-core | no | yes | no | none | keep | SECURITY KEEPER: constant-time compare helper for credential envelopes |
| `zeroBuffer` | @arnilo/prism-core | no | yes | no | none | keep | SECURITY KEEPER: secret-buffer clear helper |
| `assertRestrictiveFileMode` | @arnilo/prism-core | yes (1) | yes | no | none | keep | SECURITY KEEPER: file-mode guard; credentials-node test asserts it |
| `removeFileIfExists` | @arnilo/prism-core | no | yes | no | none | keep | SECURITY KEEPER: secure-cleanup helper (credential files) |
| `OidcIdentityVerifierResult` | @arnilo/prism-core | no | no | no | none | deprecate | public type via ./credentials/node/oidc subpath, zero refs, undocumented; remove at breaking cut |
| `assertDiffLines` | @arnilo/prism-core | no | yes | no | none | deprecate | compat-tracked prompt-format helper, zero refs; remove at breaking cut |
| `ResolvedPromptLimits` | @arnilo/prism-core | no | no | no | none | remove | type alias: not entry-reachable, not compat-tracked, zero refs, undocumented |
| `encodeMetadata` | @arnilo/prism-core | no | yes | no | none | deprecate | compat-tracked helper, zero refs, undocumented; remove at breaking cut |
| `canonicalizeA2AAgentCard` | @arnilo/prism-core | yes (1) | yes | no | none | keep | a2a test suite exercises it; sibling of the documented verifyA2AAgentCard |
| `signA2AAgentCard` | @arnilo/prism-core | yes (1) | yes | no | none | keep | a2a test suite exercises it; sibling of the documented verifyA2AAgentCard |
| `verifyA2AAgentCard` | @arnilo/prism-core | yes (1) | yes | yes | none | keep | documented (docs/a2a.md); a2a test suite exercises it |
| `createA2AClient` | @arnilo/prism-core | yes (4) | yes | yes | none | keep | documented (docs/a2a.md); example + ag-ui + a2a tests exercise it |
| `createA2AAgentEventSource` | @arnilo/prism-core | yes (1) | yes | yes | none | keep | documented (docs/a2a.md); a2a test suite exercises it |
| `deliverA2APushEvent` | @arnilo/prism-core | yes (1) | yes | yes | none | keep | documented (docs/a2a.md); a2a test suite exercises it |
| `createSupervisor` | @arnilo/prism-core | yes (7) | yes | yes | none | keep | documented (docs/supervisors.md); examples + 5 test suites + install-smoke exercise it |
| `assertOwnershipForLoad` | @arnilo/prism-core | no | yes | no | none | keep | SECURITY KEEPER: checkpoint ownership guard at trust boundary; phase 25 allowed it |
| `assertOwnershipForSave` | @arnilo/prism-core | no | yes | no | none | keep | SECURITY KEEPER: checkpoint ownership guard at trust boundary; phase 25 allowed it |
| `assertVersionAdvance` | @arnilo/prism-core | no | yes | no | none | keep | SECURITY KEEPER: checkpoint version-monotonicity (anti-rollback) guard |
| `parseListOffsetCursor` | @arnilo/prism-core | no | yes | no | none | deprecate | compat-tracked utility, zero refs, undocumented; remove at breaking cut |
| `nodeKindOf` | @arnilo/prism-core | no | yes | no | none | deprecate | compat-tracked utility, zero refs, undocumented; remove at breaking cut |
| `createClinePassProviderPackage` | @arnilo/prism-providers | yes (3) | yes | yes | none | keep | documented (docs/providers/clinepass.md); example + 2 tests exercise it |
| `createNeuralWattProviderPackage` | @arnilo/prism-providers | yes (5) | yes | yes | none | keep | documented (docs/provider-packages.md, docs/providers/neuralwatt.md); 3 tests + docs test exercise it |
| `withOpenRouterCacheMarker` | @arnilo/prism-providers | no | yes | no | none | deprecate | compat-tracked helper, zero refs, undocumented; remove at breaking cut |
| `statusFromState` | @arnilo/prism | no | yes | no | none | deprecate | compat-tracked mapper, zero refs, undocumented; remove at breaking cut |
| `isInitProvider` | @arnilo/prism | no | yes | no | none | deprecate | compat-tracked flag helper, zero refs; remove at breaking cut |
| `isInitTemplate` | @arnilo/prism | no | yes | no | none | deprecate | compat-tracked flag helper, zero refs; remove at breaking cut |
| `SessionBranchHandle` | @arnilo/prism | yes (1) | no | yes | none | keep | documented contract type (docs/session-stores.md); persistence-contracts types test asserts it |
| `parseContextFile` | @arnilo/prism | no | yes | yes | none | deprecate | documented (docs/agent-definitions.md) but zero refs; mark @deprecated, remove at breaking cut |
| `parseToolFile` | @arnilo/prism | no | yes | yes | none | deprecate | documented (docs/agent-definitions.md) but zero refs; mark @deprecated, remove at breaking cut |
| `defaultUserConfigPath` | @arnilo/prism | yes (1) | yes | yes | none | keep | node-config test + docs/node-filesystem-config.md use it |
| `loadConfigFiles` | @arnilo/prism | yes (1) | yes | yes | none | keep | node-config test + docs/node-filesystem-config.md use it |
| `createJsonlSessionStore` | @arnilo/prism | yes (4) | yes | yes | none | keep | 3 test suites + example + docs/node-jsonl-session-store.md use it |
| `defaultUserSettingsPath` | @arnilo/prism | no | yes | yes | none | deprecate | documented (docs/settings-auth-trust-security.md) but zero refs; mark @deprecated, remove at breaking cut |
| `loadSettingsFiles` | @arnilo/prism | yes (1) | yes | yes | none | keep | settings-security test + docs use it |
| `resolveProviderMediaBlock` | @arnilo/prism | no | yes | no | none | deprecate | entry-reachable but zero refs, undocumented; mark @deprecated, remove at breaking cut |
| `parseJsonObjectArguments` | @arnilo/prism | yes (1) | yes | yes | none | keep | provider-transport test + docs/provider-primitives.md use it |
| `assertCompactionStrategyConforms` | @arnilo/prism | yes (3) | yes | yes | none | keep | conformance harness: ./testing subpath + docs/compaction-conformance.md; used by 2 suites |
| `assertExtensionConforms` | @arnilo/prism | yes (2) | yes | yes | none | keep | conformance harness: ./testing subpath + docs/extension-conformance.md; used by 2 suites |
| `runFeedbackConformance` | @arnilo/prism | yes (3) | yes | no | none | keep | conformance harness: ./testing subpath; used by 3 suites incl postgres/sqlite persistence |
| `assertAdapterSchemaMatchesModel` | @arnilo/prism | yes (2) | yes | yes | none | keep | conformance harness: ./testing/persistence-schema; docs/database-persistence.md; 2 suites |
| `assertParameterizedQuery` | @arnilo/prism | yes (1) | yes | no | none | keep | conformance harness: SQL-injection guard; persistence-schema test uses it |
| `assertPersistenceQueryPaginationConforms` | @arnilo/prism | yes (3) | yes | yes | none | keep | conformance harness: pagination guard; 3 suites use it |
| `assertTenantScopedQueryIsolation` | @arnilo/prism | yes (3) | yes | yes | none | keep | conformance harness: tenant-isolation guard; 3 suites use it |
| `PARAMETERIZED_QUERY_GUIDANCE` | @arnilo/prism | yes (1) | yes | yes | none | keep | conformance harness guidance constant; docs/database-persistence.md; docs test asserts it |
| `tenantScopedUniqueKey` | @arnilo/prism | yes (1) | yes | no | none | keep | conformance harness helper; persistence-schema test uses it |
| `assertAbortIsObserved` | @arnilo/prism | yes (19) | yes | yes | none | keep | provider conformance: used by 19 suites across all provider adapters |
| `assertCanonicalToolParameters` | @arnilo/prism | yes (5) | yes | yes | none | keep | provider conformance: used by 5 suites |
| `assertNoFetches` | @arnilo/prism | yes (5) | yes | yes | none | keep | provider conformance: used by 5 adapter suites |
| `assertNoForeignCacheFields` | @arnilo/prism | yes (15) | yes | yes | none | keep | provider conformance: used by 15 suites |
| `assertNoSecretLeak` | @arnilo/prism | yes (20) | yes | yes | none | keep | SECURITY KEEPER: secret-leak conformance assert; used by 20 suites |
| `assertProviderOwnedHeadersWin` | @arnilo/prism | yes (15) | yes | yes | none | keep | provider conformance: used by 15 suites |
| `assertProviderStreamConforms` | @arnilo/prism | yes (31) | yes | yes | none | keep | provider conformance core: used by 31 suites across every adapter |
| `assertSerializedRequestCoversContent` | @arnilo/prism | yes (17) | yes | yes | none | keep | provider conformance: used by 17 suites |
| `assertToolCallDeltasReconstruct` | @arnilo/prism | yes (14) | yes | yes | none | keep | provider conformance: used by 14 suites |
| `ProviderSecretLeakConformanceOptions` | @arnilo/prism | no | no | no | none | deprecate | public type via ./testing/provider-conformance, zero refs, undocumented; remove at breaking cut |
| `runSessionStoreConformance` | @arnilo/prism | yes (4) | yes | yes | none | keep | session-store conformance runner: used by 4 suites incl postgres/sqlite adapters |
| `assertStateConcurrencyConforms` | @arnilo/prism | yes (6) | yes | yes | none | keep | state concurrency conformance: used by 6 suites incl enterprise postgres/nats |
| `assertToolDisclosureConforms` | @arnilo/prism | yes (1) | yes | yes | none | keep | tool conformance: docs/tool-conformance.md; conformance-helpers test |
| `assertToolDispatchConforms` | @arnilo/prism | yes (2) | yes | yes | none | keep | tool conformance: docs/tool-conformance.md; 2 suites |
| `runToolEffectStoreConformance` | @arnilo/prism | no | yes | no | none | deprecate | entry+compat but zero consumers (not even repo suites); mark @deprecated, remove at breaking cut if still unused |

## Security keeper notes (explicit)

Removed-or-kept security-relevant exports, per plan 058 Security criterion:

| export | seam | decision |
|---|---|---|
| `assertMcpContentWithinLimit` | MCP content bounds guard (`@arnilo/prism-mcp`) | **keep** — trust-boundary guard; phase 25 allowed it |
| `assertScope` | RAG vector-hit tenant/resource/corpus isolation guard | **keep** — cross-tenant isolation guard |
| `resolveUnderRoot` | sandbox-tar path-escape guard | **keep** — sandbox trust boundary |
| `secureCompare` | constant-time compare (credential envelopes) | **keep** — timing-attack seam |
| `zeroBuffer` | secret-buffer clear | **keep** — key-hygiene seam |
| `removeFileIfExists` | secure credential-file cleanup | **keep** — secure-cleanup seam |
| `assertRestrictiveFileMode` | credential file-mode guard | **keep** — file-permission guard, test-asserted |
| `assertOwnershipForLoad` / `assertOwnershipForSave` | checkpoint ownership guards | **keep** — ownership trust boundary |
| `assertVersionAdvance` | checkpoint version-monotonicity (anti-rollback) | **keep** — integrity guard |
| `assertNoSecretLeak` (+ `ProviderSecretLeakConformanceOptions`) | secret-leak conformance assert | assert **keep** (20 suites); unused options type **deprecate** |

## Rejected removals (false-positive classes)

1. **Test-only usage (≈40 candidates)** — conformance harness (`./testing/*` subpaths,
   documented in `docs/*-conformance.md`), provider adapters, persistence suites. The naive
   scan excludes `__tests__`; these are the repo's safety net, not dead code.
2. **Documented public API with zero in-repo uses (A2A card signing/verification,
   supervisor factory, config loaders, media block resolver)** — exercised by tests/examples
   or explicitly documented; hosts are the intended callers.
3. **Security guards** — see keeper notes above; removing fail-closed seams to reduce surface
   is a bad trade (review §2 explicitly praises these checks).

## Cross-check

`node scripts/dead-export-verify.mjs --check` (wired into `scripts/dead-export-verify.test.mjs`)
validates: every candidate classified in this table; zero `remove` verdicts on compat-baseline
exports. `scripts/sweep-unused.test.mjs` stays green (no emitter change; the verifier is
read-only over `scripts/unused-report.json`).

