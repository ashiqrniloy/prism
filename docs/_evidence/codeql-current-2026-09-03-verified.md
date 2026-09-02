# CodeQL Current Snapshot — 2026-09-03 (verified, post-fix)

Successor to `codeql-current-2026-09-03.md` (pre-fix snapshot, 59 open alerts).
Reconciliation of the prerelease security evidence gate (plan 056 task 9).

## Status

- **Open alerts on default branch: 0** (was 59 on the 2026-09-03 snapshot at `c600eaa`).
- Security workflow (`security.yml`: dependency-review, codeql, supply-chain): **green**
  on the final commit `4e731be0` (run `33694683599`, codeql job success).
- Release-gate blocker fixed along the way: clean-clone workspace builds previously
  failed (88 TS errors) because `npm run --workspaces` executes in config order, not
  dependency order; workspaces array reordered leaves-first and
  `@arnilo/prism-core` declared as a dependency of `prism-coding-tools`
  (commit `b65bd11e`). `npm run build` from a wiped `dist/` now exits 0.

## Ledger reconciliation (snapshot alert groups A–H)

| Group | Root cause | Resolution |
|---|---|---|
| A (36) | repeated trailing-slash regex | fixed (bounded linear scans, `sheets/decimal.ts`) |
| B (13) | unbounded parsing regex | fixed (8192-byte cap + linear scans) |
| C (2) | incomplete HTML sanitization | fixed (documents patch guards + tests) |
| D (1) | cache-key sanitization regex | fixed (bounded scan) |
| E (4) | insecure random identifiers | fixed (probe/temp-file remediation) |
| F (1) | clear-text logging | fixed (static message) |
| G (1) | PKCE SHA-256 false positive | auto-closed |
| H (1) | documentation assertion false positive | auto-closed |

## Dismissals (recorded on GitHub, 2026-09-03)

| Alert | Rule | Location | Rationale |
|---|---|---|---|
| 91, 92 | js/prototype-polluting-assignment | `packages/office/src/documents/patch.ts` | bounded write — row/column validated against `cells.length` before assignment, throws `DocumentsValidationError` otherwise; no attacker-controlled key reaches the sink |
| 98, 99 | js/remote-property-injection | `packages/prism-core/src/runtime/server/__tests__/artifact-bodies.test.ts` | test-only SigV4 signing helper; sink is `Object.create(null)` (no prototype), so property injection cannot pollute |

All dismissals reason `false positive`, commented with the rationale above.

## Fixed in this push cycle

- Alert 102 `js/insecure-temporary-file` `scripts/phase27-dr.test.mjs`: default
  artifact dir is now `mkdtempSync(join(tmpdir(), "prism-dr-"))` per run;
  `--artifact-dir` still honored (commit `4e731be0`).
- Alert 68 (deleted `packages/antigravity-agent` file): auto-closed by push.

## Remaining / accepted debt

- `scripts/phase27-dr.test.mjs` still requires protected infrastructure
  (PostgreSQL URLs, `--target`, `--confirm-target`) and fails closed without it —
  by design (plan 060 opens protected CI jobs).
- Dependency audit: `npm audit` 0 vulnerabilities (fast-xml-parser 5.11.1,
  fast-uri, qs remediated). `@napi-rs/keyring` 2.0, `pdf-parse` 2.x, and
  `better-sqlite3` 13 majors deferred to plan 062.