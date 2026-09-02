# Security and Hardening Remediation (CodeQL P0/P1)

Source: `docs/_evidence/codeql-current-2026-09-03.md` (28 open alerts) and
`docs/_evidence/implementation-review-2026-09-03.md` §3/§4. Executes step 1 of the
review's recommended order.

## Objectives

- Fix every production CodeQL true positive: prototype-polluting assignment, polynomial regexes, filesystem races, stack/error exposure (already fixed locally, keep verified).
- Fix CI/tooling-path alerts: insecure temporary files, script races, clear-text logging, vendored executable fixture.
- Dismiss documented false positives with location-specific rationale instead of code changes.
- Land review P1 hardening: subprocess env allow-list, egress policy coverage, tenant scope enforcement in production store factories.
- Re-run CodeQL on the pushed branch and reduce open alerts to zero unexplained.

## Expected Outcome

- `docs/_evidence/codeql-current-2026-09-03.md` (or successor ledger) shows every alert either fixed-and-closed or dismissed-with-rationale.
- `npm audit` stays at 0 vulnerabilities; full offline `npm test` green.
- No production path writes predictable temp files, does check-then-use on attacker-influenced paths, or reflects internal errors externally.

## Tasks

- [x] Prototype-pollution guards in document patch application (alerts 91–92)
  - Acceptance Criteria:
    - Functional: `applySetPatch` and sibling dynamic assignments in `packages/office/src/documents/patch.ts` reject any operation whose path resolves through `__proto__`, `prototype`, or `constructor` (including `metadata: "__proto__"` per review finding), failing closed with a typed error before any mutation.
    - Performance: rejection adds no measurable latency to normal patches (guard is a set lookup per segment).
    - Code Quality: single shared `assertSafePathSegments`-style helper reused by all dynamic assignment sites in the file; no duplicated key lists.
    - Security: post-patch schema validation no longer relied on as the only defense; mutation never happens before the guard.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/codeql-current-2026-09-03.md` §Prioritized disposition P0-1 (exact lines 149, 171).
      - `docs/_evidence/implementation-review-2026-09-03.md` §3 open security defects.
    - Options Considered:
      - Validate after assignment via existing schema pass (rejected: mutation already occurred; root cause is the assignment).
      - `Object.create(null)` targets / `Map` (rejected here: larger semantic change to Document Model internals; guard is the minimal root-cause fix at the trust boundary).
    - Chosen Approach: reject unsafe segments before every dynamic assignment in the patch engine; keep result identical for all safe patches.
    - API Notes and Examples:
      ```ts
      // packages/office/src/documents/patch.ts
      const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
      function assertSafeSegment(segment: string): void {
        if (UNSAFE_KEYS.has(segment)) throw new PatchError("ERR_PRISM_DOC_UNSAFE_PATH", segment);
      }
      ```
    - Files to Create/Edit:
      - `packages/office/src/documents/patch.ts`: guard + typed error.
      - `packages/office/src/documents/__tests__/patch.test.ts`: attack cases.
    - References: CodeQL `js/prototype-polluting-assignment` alerts 91–92; prior session finding that `target.metadata` can be `__proto__`.
  - Test Cases to Write:
    - Patch with `metadata` op on `__proto__`/`constructor`/`prototype` keys → typed error, document unchanged (deep-equal snapshot).
    - Nested array/object op embedding unsafe segment mid-path → rejected.
    - All existing patch tests still pass unchanged (safe-path behavior identical).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new typed error `ERR_PRISM_DOC_UNSAFE_PATH` on previously-mutating (buggy) input; safe behavior unchanged.
    - Docs pages to create/edit:
      - `docs/documents.md`: note rejected path segments in patch contract error table.
    - `docs/index.md` update: no (existing page).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Replace polynomial decimal/currency regexes with bounded scans (alerts 84–86)
  - Acceptance Criteria:
    - Functional: `packages/office/src/sheets/decimal.ts` lines 36/90/92 parsing accepts exactly the same grammar (decimal, currency, exponent forms) implemented as index-based scans or anchored linear regexes over input already capped by `resolveSheetsCaps`.
    - Performance: pathological inputs (long digit runs, alternating separators) complete in <50 ms for cap-sized inputs; no `js/polynomial-redos` finding on re-scan.
    - Code Quality: parser shares one tokenizer; no per-format duplicated scanners.
    - Security: caps enforced before parse; oversized inputs rejected with typed error, never parsed.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/codeql-current-2026-09-03.md` P0-2 (lines 36, 90, 92).
      - Session finding: byte caps flow from `resolveSheetsCaps`.
    - Options Considered:
      - Keep regexes, add anchors + length cap (partially works; still flagged shapes risk).
      - Full linear scan tokenizer (chosen: provably linear, testable per character class).
    - Chosen Approach: linear scan honoring the same caps; regex only for a short fixed token if provably safe.
    - API Notes and Examples:
      ```ts
      // same public parse entry points; internals switch to scans
      parseDecimalNumber(raw: string, caps: SheetsCaps): DecimalValue
      ```
    - Files to Create/Edit:
      - `packages/office/src/sheets/decimal.ts`: scanner rewrite.
      - `packages/office/src/sheets/__tests__/decimal.test.ts`: pathological + golden cases.
    - References: CodeQL `js/polynomial-redos` alerts 84–86; existing decimal golden tests.
  - Test Cases to Write:
    - Pathological: `9`.repeat(caps.maxInputBytes), `1`+`,`+`0`.repeat(...) currency strings — completes fast, correct reject/accept.
    - Golden equivalence: existing decimal test corpus passes byte-identically.
    - Cap enforcement: input one byte over cap → typed error before parse.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal parser, same accepted language + caps).
    - Docs pages to create/edit: `none` — limits already documented in `docs/sheets.md` caps section.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Close filesystem TOCTOU in coding effects and browser uploads (alerts 95–96)
  - Acceptance Criteria:
    - Functional: `packages/prism-coding-tools/src/agent/effects.ts:57` and `packages/web-tools/src/browser/uploads.ts:121` no longer `stat`/`access` then re-open by path for security decisions; they open once and verify identity via descriptor (`fstat`), or create exclusively where the race is on creation.
    - Performance: no extra syscall round-trips on the happy path beyond the single open.
    - Code Quality: shared `openVerifiedPath` helper in the owning package; call sites read identity from the handle.
    - Security: symlink/substitution between check and use no longer bypasses containment; errors typed and redacted.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/codeql-current-2026-09-03.md` P0-3.
      - `docs/host-security.md` (trust boundaries for host-provided paths).
    - Options Considered:
      - `realpath` before use (still racy).
      - Descriptor-based open + `fstat` verification (chosen; the standard race-free pattern).
    - Chosen Approach: open-first, verify-on-descriptor; keep existing containment predicates but evaluate them against `fstat` results.
    - API Notes and Examples:
      ```ts
      const handle = await open(target, "r"); // O_NOFOLLOW where available
      const st = await handle.stat();          // identity of what we opened
      ```
    - Files to Create/Edit:
      - `packages/prism-coding-tools/src/agent/effects.ts`: upload/effect path verification.
      - `packages/web-tools/src/browser/uploads.ts`: same pattern.
      - Tests in each package's `__tests__/`.
    - References: CodeQL `js/file-system-race` alerts 95–96; node:fs/promises `FileHandle.stat`.
  - Test Cases to Write:
    - Symlink swap between existence check and use → rejected by descriptor identity.
    - File replaced mid-operation → operation targets originally-opened inode or fails typed.
    - Happy-path behavior unchanged vs existing suites.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal verification; error surface already typed).
    - Docs pages to create/edit: `none` — behavior contract unchanged.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Fix script/tooling temp files, races, and clear-text logging (alerts 81–83, 67, 72–75)
  - Acceptance Criteria:
    - Functional: `scripts/fixtures/phase26-coding-journey.mjs` (236, 903), `scripts/phase27-dr.test.mjs` (116, 838), `scripts/phase12-restart-recovery.test.mjs` (258), `scripts/scan-secrets.mjs` (37), `scripts/with-build-lock.mjs` (70), `src/__tests__/provider-transport.test.ts` (191) use `mkdtemp`/exclusive-create, atomic rename for locks, and never log secret-bearing values.
    - Performance: build-lock acquisition stays non-blocking-fail-fast; suite time unchanged (±5%).
    - Code Quality: one shared `mkdtemp`/cleanup helper in scripts where ≥3 usages repeat; `try/finally` cleanup everywhere.
    - Security: no predictable temp paths, no clear-text secrets in DR diagnostics; CodeQL closes these alert classes on the touched files.
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/codeql-current-2026-09-03.md` P1 list and complete-alert table rows 67, 72–75, 81–83.
    - Options Considered:
      - Per-script ad-hoc fixes (works; duplicates cleanup logic).
      - Shared `scripts/lib/tmpdir.mjs` helper + sweep (chosen where repetition justifies it).
    - Chosen Approach: `mkdtemp` + `try/finally` via shared helper; `with-build-lock.mjs` switches to exclusive-create lock file with stale-lock detection; DR script logs fixed redacted summaries.
    - API Notes and Examples:
      ```js
      const dir = await mkdtemp(join(tmpdir(), "prism-ci-"));
      try { /* ... */ } finally { await rm(dir, { recursive: true, force: true }); }
      ```
    - Files to Create/Edit:
      - `scripts/fixtures/phase26-coding-journey.mjs`, `scripts/phase27-dr.test.mjs`, `scripts/phase12-restart-recovery.test.mjs`, `scripts/scan-secrets.mjs`, `scripts/with-build-lock.mjs`, `src/__tests__/provider-transport.test.ts`.
      - `scripts/lib/tmpdir.mjs` (tentative — create only if ≥3 repeated usages).
    - References: node:fs `mkdtemp`, `O_EXCL`; CodeQL `js/insecure-temporary-file`, `js/clear-text-logging`.
  - Test Cases to Write:
    - Lock: second concurrent holder fails fast; stale lock (older than ceiling) is reclaimed safely.
    - Temp hygiene: every script run leaves no residue in os.tmpdir() (scan before/after in test).
    - DR diagnostics: output contains no configured test secret value (assert absence).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (scripts/tests only).
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Update or retire vendored executable fixture race (alert 94)
  - Acceptance Criteria:
    - Functional: `packages/prism-coding-tools/fixtures/ponytail/upstream-full/hooks/ponytail-activate.js` patched race-free (single read-or-catch for `settings.json`; exclusive-create `flag: "wx"` for the nudge flag). Upstream 4.9.0 still contains the race — re-vendor was checked and does not fix it.
    - Performance: fixture-driven tests unchanged in runtime.
    - Code Quality: fixture provenance recorded (upstream repo + commit) wherever vendored.
    - Security: no executed fixture performs check-then-use path ops on shared paths.
  - Approach:
    - Documentation Reviewed: `docs/_evidence/codeql-current-2026-09-03.md` alert 94 note (vendored upstream fixture).
    - Options Considered: patch vendored copy (drift risk) vs re-vendor from fixed upstream vs stop shipping (chosen order: re-vendor → patch → stop shipping).
    - Chosen Approach: check upstream `@dietrichgebert/ponytail` for fixed hook; re-vendor with recorded commit; otherwise apply minimal race fix locally with upstream note.
    - API Notes and Examples: n/a (fixture content).
    - Files to Create/Edit:
      - `packages/prism-coding-tools/fixtures/ponytail/upstream-full/hooks/ponytail-activate.js`.
      - `packages/prism-coding-tools/fixtures/ponytail/PROVENANCE.md` (new — upstream 4.9.0, local patch note).
    - References: alert 94; ponytail upstream package (current 4.9.0).
  - Test Cases to Write:
    - Fixture activation test (existing) still passes; targeted check that hook temp/state file uses exclusive create.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Harden or dismiss test-only alerts (97–101)
  - Acceptance Criteria:
    - Functional: all five hardened — `missing-regexp-anchor` in `packages/web-tools/src/obscura/__tests__/web.test.ts:86` now `$`-anchored; `remote-property-injection` in `packages/prism-core/src/runtime/server/__tests__/artifact-bodies.test.ts:48,61` now uses null-prototype `query`/`headers` objects in the fake-S3 signer; `insecure-temporary-file` in `delete-move.test.ts:98,157` (+ the third instance at 258) now uses the existing `mkdtemp` helper.
    - Performance: no measurable test-suite slowdown.
    - Code Quality: no dismissals needed — all five hardened; dispo notes added to the evidence ledger.
    - Security: production code unaffected; fixtures never weaken patterns production code must follow.
  - Approach:
    - Documentation Reviewed: evidence ledger §P2 test-only list.
    - Options Considered: harden all (cheap for these five) vs dismiss narrowly.
    - Chosen Approach: harden where mechanical (anchor, mkdtemp, controlled object shapes); dismiss only what hardening would distort.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: the three listed test files; `docs/_evidence/codeql-current-2026-09-03.md` (disposition column updates).
    - References: alerts 97–101.
  - Test Cases to Write:
    - Existing tests still pass after hardening; anchored regex still matches intended corpus.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: evidence ledger disposition updates only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Dismiss documented false positives (alerts 93, 89–90, 62)
  - Acceptance Criteria:
    - Functional: all four dismissed in the GitHub CodeQL UI (2026-09-03) via `gh api PATCH` — 93 (false positive, RFC 7636 PKCE S256 rationale), 89–90 (false positive, Visio-format rejection rationale), 62 (used in tests, negative docs assertion rationale). Code semantics unchanged; no optional hardening needed.
    - Performance: n/a.
    - Code Quality: rationale mirrored in the evidence ledger (open-alert table strikethroughs + §P2 notes) so future audits skip re-triage.
    - Security: optional hardening only if trivial — parsed-XML namespace check replacing substring test in `diagrams/xml.ts` if it stays a one-liner.
  - Approach:
    - Documentation Reviewed: evidence ledger §P2; RFC 7636 §4.2.
    - Options Considered: restructure code to silence (risks breaking PKCE/Visio rejection semantics for a false positive) vs dismiss narrowly (chosen).
    - Chosen Approach: dismiss with rationale; keep code semantics.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: `docs/_evidence/codeql-current-2026-09-03.md` disposition updates.
    - References: alerts 62, 89–90, 93.
  - Test Cases to Write: n/a (no code change).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: evidence ledger only.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] P1 hardening: subprocess env allow-list, egress coverage, tenant scope
  - Acceptance Criteria:
    - Functional: allow-list env done — new `buildChildEnv`/`DEFAULT_CHILD_ENV_INHERIT` (`src/agent/env.ts`); all `process.env` spread-through spawns removed (shell default, LSP client, process sessions, computer-use-linux MCP transport); native-sandbox unshare probe now minimal env. Egress + tenant scope verified already-satisfied (below) with test evidence.
    - Performance: spawn overhead unchanged.
    - Code Quality: one `buildChildEnv` helper reused across all fixed spawn sites.
    - Security: leaked-env canary tests fail if any unlisted var reaches child env (unit + shell + process-sessions integration).
  - Approach:
    - Documentation Reviewed:
      - `docs/_evidence/implementation-review-2026-09-03.md` §4 P1.
      - `docs/host-security.md` (host-owned egress/policy responsibilities).
      - `docs/public-contracts.md` store/policy seams.
    - Options Considered:
      - Deny-list env scrubbing (rejected: fail-open on new vars).
      - Allow-list construction (chosen: fail-closed).
    - Chosen Approach: allow-list env builder + per-surface egress policy assertions + explicit tenant requirement in store factory signatures (breaking change documented).
    - API Notes and Examples:
      ```ts
      const env = buildChildEnv({ inherit: ["PATH", "LANG"], set: { PRISM_RUN_ID } });
      spawn(cmd, args, { env });
      ```
    - Files to Create/Edit:
      - `packages/prism-coding-tools/src/agent/env.ts` (new helper) + spawn sites: `agent/shell.ts`, `agent/language/client.ts`, `agent/process/sessions.ts`, `security/native-sandbox.ts`, `computer-use-linux/create.ts`.
      - Egress: no code change — audited, coverage pre-existing (browser `policy.test.ts` denyDirectEgress/proxy-attestation; OAuth `oauth.test.ts` pinned-config fetch; OIDC/JWKS `oidc.test.ts:481` private-host SSRF denied before fetch; webhooks `webhooks.test.ts:106` https+loopback opt-in; MCP stdio-only no outbound transport; OpenAPI/provider-discovery have no egress surface).
      - Tenant scope: no code change — audited, enforcement pre-existing (approvals `tenantId` on create/decide/get/query; persistence writes require `ownership`; enterprise stores require `requireStoreOwner`/`requireOwnership`/principal identity on every operation).
    - References: review §4 P1 bullets 1–4.
  - Test Cases to Write:
    - Child env contains exactly allow-listed keys (deep equal).
    - Default-deny egress: each surface blocked without explicit policy grant.
    - Store factory without tenant scope → typed error at construction.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — store factory signatures gain required tenant scope; behavior packs/subprocess envs restricted.
    - Docs pages to create/edit:
      - `docs/host-security.md`: updated responsibilities table.
      - `docs/public-contracts.md`: new factory signatures.
      - `CHANGELOG.md`: breaking-change note.
    - `docs/index.md` update: no new page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Verify: push, CodeQL re-analysis, ledger closure
  - Acceptance Criteria:
    - Functional: branch pushed; CodeQL re-run completes; every alert from the 2026-09-03 snapshot is closed or dismissed with recorded rationale; alert 68 (deleted antigravity file) auto-closes.
    - Performance: n/a.
    - Code Quality: `docs/_evidence/codeql-current-*.md` successor file records post-fix snapshot (expected: 0 unexplained).
    - Security: no new alert classes introduced by the fixes themselves.
  - Approach:
    - Documentation Reviewed: evidence ledger snapshot procedure.
    - Options Considered: n/a (verification task).
    - Chosen Approach: push → re-scan → reconcile ledger → update README status.
    - API Notes and Examples: `gh api /repos/ashiqrniloy/prism/code-scanning/alerts` for reconciliation.
    - Files to Create/Edit: `docs/_evidence/codeql-current-2026-09-XX.md` (successor snapshot); this plan's checkboxes.
    - References: `docs/release-and-install.md` security evidence gates.
  - Test Cases to Write: n/a (runs full suites from prior tasks + `npm audit`).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: successor evidence ledger.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
