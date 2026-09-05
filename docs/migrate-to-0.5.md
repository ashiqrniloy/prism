# Migrate Prism 0.4 to 0.5 (dead-export removal)

> **Status: 0.5 release draft.** Follow this guide only after the 0.5 packages are published.

## What changes

Prism 0.5 deletes 27 unused public exports. Every removed symbol was verified unused in the
plan 058 sweep ([verification evidence](../docs/_evidence/dead-export-verification-2026-09-03.md)):
zero in-repo references, no third-party import evidence, and `@deprecated` JSDoc naming "no
replacement" earlier in the same cycle. This is a **symbol-surface migration**: package names,
subpaths, persisted shapes, and behavior are unchanged. If your code compiled against 0.4 without
importing any symbol below, it compiles against 0.5 unchanged.

- All 10 publishable manifests bump `0.4.x` → `0.5.0` lockstep; internal first-party ranges
  move `^0.4.0` → `^0.5.0`.
- Compat baselines regenerated at the cut; intentional breaks recorded in
  [`docs/migration.md`](migration.md).
- No security surface changed: the keeper list (ownership/checkpoint guards, `secureCompare`,
  `zeroBuffer`, `resolveUnderRoot`, `assertScope`, `assertMcpContentWithinLimit`,
  `assertNoSecretLeak`) is intact.

## Removed symbols and what to do

Every row: **no replacement** — the symbol had no caller anywhere in the repo, docs, examples,
or observable third-party usage. If you were importing one, inline the (trivial) logic locally
or keep a 0.4 pin.

| package | removed export | kind |
|---|---|---|
| `@arnilo/prism` | `statusFromState` | function |
| `@arnilo/prism` | `isInitProvider` | type-guard function |
| `@arnilo/prism` | `isInitTemplate` | function |
| `@arnilo/prism` | `parseContextFile` | function |
| `@arnilo/prism` | `parseToolFile` | function |
| `@arnilo/prism` | `defaultUserSettingsPath` | function |
| `@arnilo/prism` | `resolveProviderMediaBlock` | async function |
| `@arnilo/prism` | `ProviderSecretLeakConformanceOptions` | interface |
| `@arnilo/prism` | `runToolEffectStoreConformance` | async function |
| `@arnilo/prism-core` | `OidcIdentityVerifierResult` | type alias |
| `@arnilo/prism-core` | `assertDiffLines` | function |
| `@arnilo/prism-core` | `ResolvedPromptLimits` | type alias |
| `@arnilo/prism-core` | `encodeMetadata` | function |
| `@arnilo/prism-core` | `parseListOffsetCursor` | function |
| `@arnilo/prism-core` | `nodeKindOf` | function |
| `@arnilo/prism-memory` | `DEFAULT_MAX_PROMPT_CHARS` | const |
| `@arnilo/prism-memory` | `GRAFT_RESOLVE_ERROR_CODE` | const |
| `@arnilo/prism-memory` | `LinterOptions` | interface |
| `@arnilo/prism-memory` | `ResolvedGraftExtension` | interface |
| `@arnilo/prism-memory` | `WikiCategory` | type alias |
| `@arnilo/prism-coding-tools` | `codingSha256Hex` | function |
| `@arnilo/prism-coding-tools` | `DEFAULT_MAX_REVIEW_DELTA_ENTRIES` | const |
| `@arnilo/prism-coding-tools` | `HARD_MAX_REVIEW_DELTA_ENTRIES` | const |
| `@arnilo/prism-coding-tools` | `indexErrorCode` | function |
| `@arnilo/prism-coding-tools` | `PONYTAIL_PEER_RANGE` | const |
| `@arnilo/prism-coding-tools` | `CavemanSkillName` | type alias |
| `@arnilo/prism-providers` | `withOpenRouterCacheMarker` | function |

Per-symbol local replacements for the two cases where 0.4 docs showed a usage pattern:

- `defaultUserSettingsPath(appName)` → build the path with stdlib:
  `join(homedir(), ".config", appName, "settings.json")` (see
  [`docs/settings-auth-trust-security.md`](settings-auth-trust-security.md)).
- `parseContextFile` / `parseToolFile` → colocated `CONTEXT.md` / tool-descriptor parsing is
  host-owned; parse frontmatter with `parseAgentFile` (kept) plus your own file reading
  (see [`docs/agent-definitions.md`](agent-definitions.md)).

## Upgrade steps

1. Bump every `@arnilo/*` dependency/peer to `^0.5.0`.
2. Build; if the compiler flags one of the symbols above, apply the replacement from the table.
3. Run your suite. No data or config migration exists or is needed.

## Rollback

Pin the previous version: `@arnilo/prism@0.4.x` (exact pins per package). Nothing persisted
changed, so a rollback is a dependency downgrade.