# Plan 054 Task 9 — 0.4.0 lockstep verification

Captured: 2026-09-01. Root `@arnilo/prism@0.4.0`. 11 active packages, `^0.4.0` peers.

## Active graph

| name | packed | unpacked | files |
|---|---:|---:|---:|
| `@arnilo/prism` | 1,015,437 | 3,430,339 | 407 |
| `@arnilo/prism-core` | 351,155 | 1,718,582 | 388 |
| `@arnilo/prism-coding-tools` | 269,387 | 1,170,008 | 245 |
| `@arnilo/prism-memory` | 145,697 | 586,889 | 214 |
| `@arnilo/prism-ag-ui` | 100,483 | 421,256 | 86 |
| `@arnilo/prism-providers` | 93,637 | 464,259 | 174 |
| `@arnilo/prism-web-tools` | 66,437 | 284,706 | 80 |
| `@arnilo/prism-office` | 50,096 | 222,017 | 72 |
| `@arnilo/prism-mcp` | 36,611 | 153,487 | 30 |
| `@arnilo/prism-antigravity-agent` | 26,996 | 124,819 | 38 |
| `@arnilo/prism-acp-agent` | 7,845 | 24,314 | 10 |

Packed sum 2,163,781 bytes. Default `prism init` still depends only on root; 27.5 MB scaffold budget unchanged. Providers and office have no activating `.` export.

Machine-readable sizes: `docs/_evidence/phase54-0.4-pack-sizes.json`.

## Gates

- `npm test` — 0 failures
- `npx biome check .` — 0 diagnostics
- `npm pack --dry-run` — 11 tarballs
- `node scripts/release.mjs check --lockstep --version 0.4.0` — all 11 `available` (not yet on registry)
- `node scripts/release.mjs publish --lockstep --version 0.4.0 --dry-run` — all 11 `dry-run`
- `PRISM_TEST_POSTGRES_URL=… node scripts/release.mjs gate --lockstep --version 0.4.0` — green; compat delta is the `version` export `0.3.3` → `0.4.0` (documented in `docs/migration.md`); baseline updated
- `node scripts/phase54-legacy-registry.mjs --generate && --dry-run` — 54 entries, 52 published / 2 unpublished (`@arnilo/prism-prompts`, `@arnilo/prism-dev`), 0 problems, 0 mutations
- Live Postgres/browser remain separately gated (dummy URL only attests evidence presence)

## No shims

Retired 0.3 names are absent from workspaces. Nothing publishes a compatibility shim.

## Operator cutover (blocked on clean tagged git)

`scripts/release.mjs` refuses real publish with `--allow-dirty` / `--allow-untagged`. After this tree is committed and `v0.4.0` is tagged, and after `docs/migrate-to-0.4.md` is on `main`:

```bash
npm run release:publish -- --lockstep --version 0.4.0 --resume --report release-artifacts/publish-report.json
node scripts/phase54-legacy-registry.mjs --apply --confirm
```
