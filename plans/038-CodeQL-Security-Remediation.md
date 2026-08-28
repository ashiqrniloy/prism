# CodeQL Security Remediation

## Objectives
- Fetch and normalize every open GitHub CodeQL alert for `ashiqrniloy/prism` at the audited commit.
- Fix all true positives at shared trust-boundary roots, with regression tests mapped to alert numbers/rules.
- Harden CodeQL coverage and prove zero remaining open alerts on the remediated head without broad ignores or unsupported dismissals.

## Expected Outcome
- A reviewed alert ledger accounts for every GitHub alert by number, rule, severity, path, root cause, fix, and test.
- All true positives are fixed; any false positive has narrow evidence and maintainer-reviewed disposition.
- Known local path-containment, wiki-content injection/resource-bound, regex-injection, and predictable-temp findings are closed.
- Security workflow runs default plus `security-extended` JavaScript/TypeScript queries within a bounded CI budget.

## Tasks

- [x] Authenticate, fetch, deduplicate, and freeze the CodeQL alert ledger
  - Acceptance Criteria:
    - Functional: Fetch every open alert with pagination and record alert number, rule/query, CWE, severity, path/region, branch/ref, state, URL, and most recent instance SHA; group alerts by shared dataflow/root cause without losing individual numbers.
    - Performance: One paginated API pass plus bounded local normalization; no per-alert API loop.
    - Code Quality: Use `gh api`/GitHub REST and a temporary JSON snapshot; do not add a permanent client/library unless repeated remediation proves necessary.
    - Security: Token comes only from authenticated `gh` or `GH_TOKEN`, never command arguments, files, logs, plans, evidence, or commits; raw alert payload remains outside git.
  - Approach:
    - Documentation Reviewed:
      - GitHub REST Code Scanning alerts: https://docs.github.com/en/rest/code-scanning/code-scanning#get-code-scanning-alerts-for-a-repository.
      - GitHub CLI `gh api --paginate --slurp`: https://cli.github.com/manual/gh_api.
      - `.github/workflows/security.yml` and `.github/codeql/codeql-config.yml`.
    - Options Considered:
      - Unauthenticated API: confirmed HTTP 401 `Requires authentication`.
      - Browser/CDP: unavailable in current environment and unnecessary once CLI auth exists.
      - Authenticated REST pagination: chosen.
    - Chosen Approach:
      - Require `gh auth login` or a least-privilege token able to read code-scanning alerts, snapshot to `/tmp`, then commit only a sanitized Markdown ledger.
    - API Notes and Examples:
      ```bash
      gh auth status
      gh api --paginate --slurp \
        -H 'Accept: application/vnd.github+json' \
        '/repos/ashiqrniloy/prism/code-scanning/alerts?state=open&per_page=100' \
        > /tmp/prism-codeql-pages.json
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase38-codeql-alert-ledger.md`: sanitized full accounting and root-cause groups.
      - No raw JSON committed.
    - References:
      - Current audited SHA: `c600eaa18f65b56764ec2fb408ec813536eff6f7`.
      - Security workflow run 169/job `98473229464` succeeded, but successful upload does not imply zero alerts.
      - Authenticated fetch completed on 2026-08-27: 59 open, 7 fixed, 0 dismissed; every open instance matches local HEAD `c600eaa18f65b56764ec2fb408ec813536eff6f7`.
  - Test Cases to Write:
    - Ledger count equals flattened API open-alert count.
    - Every alert number appears exactly once and every group names a test/fix owner.
    - Snapshot SHA/ref matches audited head or ledger records drift explicitly.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; evidence only.
    - Docs pages to create/edit:
      - `docs/_evidence/phase38-codeql-alert-ledger.md`: alert inventory.
    - `docs/index.md` update: no; security evidence is internal.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Fix path containment, symlink escape, and wiki write injection/bounds
  - Acceptance Criteria:
    - Functional: Wiki page reads cannot escape by sibling-prefix (`.wiki-evil`), `..`, absolute path, alternate separator, or symlink; recorded insights reject empty/oversize titles/content and prevent title newlines/control text from injecting headings/index/log entries.
    - Performance: Path validation performs bounded `resolve`/`relative` plus at most necessary `realpath` calls; writes remain one page/index/log operation.
    - Code Quality: Use Node `path.relative`/`realpath` and small local validation; reuse existing containment helper only if package dependency direction remains valid.
    - Security: Fail closed before read/write; distinguish not-found from denied paths; no catch-all converts access denial into benign not-found.
  - Approach:
    - Documentation Reviewed:
      - Node `path.relative`, `path.isAbsolute`, and `fs.realpath` APIs: https://nodejs.org/api/path.html and https://nodejs.org/api/fs.html#fspromisesrealpathpath-options.
      - `docs/wiki.md`/Prism Wiki package docs (exact page confirmed during execution).
      - CodeQL `js/path-injection`/path traversal guidance from alert help links captured in Task 1.
    - Options Considered:
      - `startsWith(absRoot)`: rejected; sibling prefixes pass and symlinks escape.
      - Lexical `relative` only: blocks `..` but not symlinks.
      - Realpath root and candidate, then separator-aware relative containment: chosen for reads.
    - Chosen Approach:
      - Validate lexical containment, resolve real paths for existing reads, and add bounded/single-line title handling before Markdown/index/log writes.
    - API Notes and Examples:
      ```ts
      const rel = relative(realRoot, realCandidate);
      if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) {
        // contained
      }
      ```
    - Files to Create/Edit:
      - `packages/prism-wiki/src/tools/read-page.ts`: real containment and error separation.
      - `packages/prism-wiki/src/tools/record-insight.ts`: byte bounds, single-line display title, safe slug/index/log rendering.
      - `packages/prism-wiki/src/__tests__/tools.test.ts` (or adjacent existing tests): hostile paths/symlinks/content.
      - Prism Wiki public docs and security notes.
      - `docs/_evidence/phase38-codeql-alert-ledger.md`: mapped alert closures.
    - References:
      - `packages/prism-wiki/src/tools/read-page.ts:26-35` confirmed prefix bypass.
      - `packages/prism-wiki/src/tools/record-insight.ts:28-83` unbounded/raw title/content writes.
      - `packages/coding-security/src/path-containment.ts` as behavior precedent, not automatic dependency.
  - Test Cases to Write:
    - `.wiki/../.wiki-evil/page.md` and sibling-prefix denial.
    - Symlink inside wiki pointing outside is denied.
    - Missing contained page returns not-found; denied page returns/throws access-denied.
    - Newline/control/Markdown title cannot add index/log entries; oversize title/content rejected before write.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; wiki tools reject previously unsafe inputs and report denial distinctly.
    - Docs pages to create/edit:
      - Prism Wiki tool page identified by `docs/index.md`: input limits and containment.
      - `docs/host-security.md`: first-party wiki filesystem boundary if not already covered.
    - `docs/index.md` update: yes only if no Prism Wiki tool page currently exists; add under “Tools”.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Remove dynamic regex denial-of-service and predictable temporary paths
  - Acceptance Criteria:
    - Functional: Ponytail subagent matching retains documented common forms without evaluating arbitrary hostile regex; temporary test directories are atomically unique and always cleaned in `finally`.
    - Performance: Matching is linear in bounded pattern/agent-type length; no catastrophic backtracking or worker process.
    - Code Quality: Prefer literal/exact/alternation matching and Node `mkdtemp`; add no regex-safety dependency.
    - Security: Environment values are bounded and fail safely; test temp creation cannot collide or overwrite an attacker-precreated path.
  - Approach:
    - Documentation Reviewed:
      - CodeQL `js/regex-injection` help from Task 1 alert.
      - Node `fs.mkdtemp` API.
      - Upstream Ponytail fixture comments/examples in `ponytail-subagent.js`.
    - Options Considered:
      - Keep arbitrary `RegExp` with length cap: still permits exponential patterns.
      - Add RE2/safe-regex dependency: rejected for one hook.
      - Support bounded literal alternatives and exact anchors with string comparison: chosen minimal safe behavior.
    - Chosen Approach:
      - Parse `a|b` and `^a$` forms into escaped/literal comparisons; invalid forms fall back to documented inject behavior; use `mkdtemp` for tests.
    - API Notes and Examples:
      ```js
      // "explore|general" => bounded case-insensitive literal contains match
      // "^general$" => bounded case-insensitive exact match
      ```
    - Files to Create/Edit:
      - `packages/prism-ponytail/fixtures/upstream-full/hooks/ponytail-subagent.js`.
      - Matching upstream/package fixture tests and docs/changelog as required by package carbonization policy.
      - `scripts/phase23-build-race.test.mjs`: `mkdtemp` + `try/finally` cleanup.
      - Additional files only when Task 1 maps same root cause (tentative).
      - `docs/_evidence/phase38-codeql-alert-ledger.md`.
    - References:
      - `packages/prism-ponytail/fixtures/upstream-full/hooks/ponytail-subagent.js:32-39`.
      - `scripts/phase23-build-race.test.mjs:77-91`.
  - Test Cases to Write:
    - Literal alternatives, exact form, mixed case, invalid pattern, oversize pattern.
    - Former catastrophic nested-quantifier input completes within strict bound and is never compiled.
    - Concurrent temp tests create distinct directories and cleanup on assertion failure.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; matcher syntax narrows from arbitrary regex to safe documented subset.
    - Docs pages to create/edit:
      - `docs/ponytail.md`: matcher syntax/migration.
      - Package README/changelog fixture provenance if shipped.
    - `docs/index.md` update: no; Ponytail page already indexed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Remediate all remaining alert groups at shared trust-boundary roots
  - Acceptance Criteria:
    - Functional: Every alert not closed by Tasks 2-3 has a code fix and regression test, or a narrowly evidenced false-positive disposition; alert ledger reaches 100% accounting.
    - Performance: Fixes preserve streaming/bounded behavior and add no unbounded scans, buffering, retries, DNS calls, or subprocesses.
    - Code Quality: Fix one shared source/sink root for duplicate alerts; avoid one-off sanitizers at every caller; expected files/rules are updated in ledger before implementation.
    - Security: Cover at minimum command/code injection, SSRF/open redirect, path/archive/temp handling, prototype pollution, ReDoS, unsafe deserialization, weak randomness/crypto, log/Markdown injection, and secret exposure as present in fetched alerts.
  - Approach:
    - Documentation Reviewed:
      - Exact CodeQL alert help URLs/rule metadata from Task 1.
      - `docs/host-security.md`, `docs/coding-security.md`, `docs/settings-auth-trust-security.md`.
      - Existing threat suites `scripts/phase20-security.test.mjs` through `phase23-security.test.mjs`.
    - Options Considered:
      - Fix alert files independently: rejected when dataflow shares a source/sink.
      - Group by root cause and update all callers: chosen.
      - Dismiss broad classes or ignore directories: rejected.
    - Chosen Approach:
      - Execute severity-first groups; after each group run focused tests and local CodeQL where available, then refresh GitHub alerts after push.
    - API Notes and Examples:
      ```bash
      # Group alerts by rule/path after Task 1 snapshot; exact implementation files become ledger rows.
      node -e '/* flatten and group /tmp/prism-codeql-pages.json */'
      npm run security:threat-suites
      ```
    - Files to Create/Edit:
      - Tentative until Task 1: exact source/test files named by every remaining alert.
      - Likely reviewed roots: `src/pinned-fetch.ts`, `src/content.ts`, `src/node/*`, `packages/coding-security/src/*`, `packages/coding-agent/src/*`, `packages/browser/src/network.ts`, provider transports, Prism Wiki/Graft/behavior package hooks, scripts.
      - `docs/_evidence/phase38-codeql-alert-ledger.md`: exact per-alert fix/test rows.
      - Relevant public security/API docs for changed behavior.
    - References:
      - Current local review found existing SSRF, sandbox, prototype-key, and typed-spawn defenses; do not duplicate them unless an alert demonstrates a bypass.
      - `src/testing/state-concurrency-conformance.ts` and security phase suites.
  - Test Cases to Write:
    - One exploit-shaped positive and one valid-input negative test per root-cause group.
    - Shared-fix regression covers every alert sink/caller in its group.
    - Fuzz/property fixtures only where existing dependencies already provide them; otherwise bounded table tests.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes where validation, URLs, commands, files, hooks, or defaults change.
    - Docs pages to create/edit:
      - Exact relevant `/docs` pages listed in each alert-ledger group before implementation.
      - `docs/host-security.md` for cross-cutting trust-boundary changes.
    - `docs/index.md` update: yes only for newly created public security pages; prefer existing pages.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Enable security-extended CodeQL coverage without hiding first-party fixtures
  - Acceptance Criteria:
    - Functional: CodeQL runs `security-extended` for JavaScript/TypeScript on push/PR/schedule and uploads results successfully.
    - Performance: Security job remains within an evidence-backed timeout (target existing 10 minutes; raise narrowly only if measured).
    - Code Quality: Keep one config file; no blanket `paths-ignore` for first-party packages, fixtures that ship/execute, or vulnerable test helpers.
    - Security: New alerts enter the same ledger/remediation loop; only generated `dist`, dependencies, and build artifacts remain ignored.
  - Approach:
    - Documentation Reviewed:
      - CodeQL query suites: https://docs.github.com/en/code-security/code-scanning/managing-your-code-scanning-configuration/codeql-query-suites.
      - Existing `.github/codeql/codeql-config.yml` and security workflow.
    - Options Considered:
      - Default suite only: misses lower-confidence but relevant security queries.
      - `security-extended`: chosen.
      - `security-and-quality`: defer unless runtime stays acceptable and signal is useful.
    - Chosen Approach:
      - Add `queries: [{ uses: security-extended }]`, run on branch/PR, triage incremental alerts with the same no-broad-ignore rule.
    - API Notes and Examples:
      ```yaml
      queries:
        - uses: security-extended
      ```
    - Files to Create/Edit:
      - `.github/codeql/codeql-config.yml`: query suite.
      - `.github/workflows/security.yml`: timeout only if measured necessary.
      - `docs/host-security.md`: CI coverage statement.
      - `docs/_evidence/phase38-codeql-alert-ledger.md`: extended-suite delta.
    - References:
      - Latest security run completed CodeQL in ~3m22s on audited SHA.
  - Test Cases to Write:
    - Workflow/config syntax validation.
    - GitHub run completes and alert count is reconciled after enabling suite.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no runtime API; security process changes.
    - Docs pages to create/edit:
      - `docs/host-security.md`: automated query suite.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Prove local security gates and zero remaining GitHub alerts
  - Acceptance Criteria:
    - Functional: Typecheck, lint, format, all tests, coverage, pack, threat suites, npm audit, secret scan, SBOM verification, and GitHub security workflow pass on remediated head.
    - Performance: Security workflow and threat suites remain within bounded time/memory; no fix regresses Plan 035/036/037 performance ceilings.
    - Code Quality: Ledger maps every original/new alert to fixed SHA/test; no unexplained skips, stale rows, or broad suppressions.
    - Security: GitHub `state=open` alert fetch returns zero after analysis, or only explicitly maintainer-reviewed false positives with narrow CodeQL dismissal reasons and evidence; target is zero open true positives.
  - Approach:
    - Documentation Reviewed:
      - `package.json#scripts.security:threat-suites` and `sdk:ready`.
      - `.github/workflows/security.yml` supply-chain steps.
      - GitHub alert state/dismissal REST docs.
    - Options Considered:
      - Trust local tests alone: insufficient; CodeQL is remote source of truth.
      - Push/analyze/refetch and reconcile by alert number: chosen.
    - Chosen Approach:
      - Run local gates, push through normal review, wait for security workflow, refetch alerts, and finalize evidence only after reconciliation.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm run security:threat-suites
      npm audit --audit-level=moderate
      gh run watch --exit-status
      gh api --paginate --slurp '/repos/ashiqrniloy/prism/code-scanning/alerts?state=open&per_page=100'
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase38-codeql-alert-ledger.md`: final status, commands, run URL/SHA.
      - `docs/host-security.md`: final automation/limitations.
    - References:
      - `.github/workflows/security.yml`.
      - `scripts/scan-secrets.mjs`, `scripts/verify-sbom.mjs`.
  - Test Cases to Write:
    - Full local/release/security command matrix.
    - Remote open-alert count reconciliation on exact head SHA.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no additional behavior beyond prior tasks.
    - Docs pages to create/edit:
      - `docs/_evidence/phase38-codeql-alert-ledger.md`.
      - `docs/host-security.md`.
    - `docs/index.md` update: no; host security already indexed.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- To be filled after tasks are completed and tests pass.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
