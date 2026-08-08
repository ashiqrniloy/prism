# Release 0.1.0 — Production-readiness candidate and operational proof

Roadmap phase: Phase 12 (`roadmap.md`, "Phase 12 — Release 0.1.0" block).
Baseline: `@arnilo/prism` **0.0.28** (Phase 11 exit gate passed 2026-08-08; 48 publishable manifests).
Target: `@arnilo/prism` **0.1.0**.
Prerequisite: Phases 1–11 complete; `npm run sdk:ready` green on baseline; protected legs exist as workflows (`release.yml`, `security.yml`, `live-canaries.yml`, `sandbox-browser.yml`) and scripts (`scripts/require-postgres-url.mjs`, `scripts/live-canary.mjs`, `scripts/phase*-conformance.test.mjs`).

Phase 12 is a **release-candidate hardening phase, not a feature catch-all** (roadmap priority rule 12). No new packages, exports, tool contracts, or configuration surfaces are planned; fixes land only for blockers/regressions found by the evidence runs.

## Objectives

- Prove the completed Phases 1–11 enterprise and coding harness surface works together under supported production topologies (single-process, multi-replica PostgreSQL, contained coding environment).
- Freeze a truthful compatibility, security, capacity, and operator-support contract for 0.1.x.
- Record every protected-leg result as retained evidence; treat missing credentials/infrastructure as a **blocked release gate, not a passing skip**.
- Close release-integrity gap #4 from the roadmap baseline: current HEAD lineage must end in a signed release tag with matching publication evidence.

## Non-goals

- Any Phase 13 candidate capability (Studio, hosted cloud, channels, remote browsers, additional forges/queues/engines/stores).
- New dependencies, packages, subpaths, or public API additions unless a Task 0 freeze-record deviation is required and justified.
- Turning a blocker into a skip to preserve a release date.
- Publishing `0.1.0` automatically; signed tag, npm OIDC provenance publication, and registry push remain explicit operator actions after evidence review (roadmap exit gate).

## Expected Outcome

- Clean packed consumers complete enterprise and coding journeys using only public exports and documented installs: one packed-install enterprise fixture, one packed-install ACP coding-agent fixture, both green in CI.
- Multi-replica agent run/reconnect, durable custom loop, batched approval, ACP editor session, sandboxed coding process, forge handoff, OIDC identity, policy decision, MCP OAuth, OpenAPI side effect, artifact delivery, and restart recovery all pass end to end on protected infrastructure with recorded evidence.
- Supported Node/PostgreSQL/provider/protocol/platform matrix and explicit unsupported combinations documented in `docs/release-and-install.md` and machine-checked where practical.
- Upgrade/migration from 0.0.17 through each roadmap release verified: compatible stores preserved or tested migration/refusal behavior recorded in `docs/migration.md`.
- Reproducible capacity envelopes published for event throughput, reconnect latency, database contention/storage growth, policy/identity overhead, approval state, repository/LSP/process operations, ACP streaming, proxy egress, and package startup/install size (`scripts/benchmark-0.1.0.mjs` + checked-in `scripts/benchmark-0.1.0.json`, thresholds in `docs/performance.md`).
- `npm audit` policy tightened to moderate-or-higher; CodeQL/SAST, dependency review, secret scan, SBOM/license, provenance, and tarball-content checks mandatory and green; signed `v0.1.0` tag prepared.
- `docs/0.1.0-readiness.md` rewritten to concrete Phases 1–11 capabilities with current-line evidence rows (replacing the stale 0.0.16/0.0.27 framing); `docs/release-and-install.md`, `docs/migration.md`, `docs/performance.md`, `docs/public-contracts.md`, `docs/index.md` frozen and consistent with 0.1.0.
- `npm run release:check -- --version 0.1.0`, `npm run release:publish -- --version 0.1.0 --dry-run --allow-untagged`, and full `sdk:ready` pass from a clean checkout; publication handoff documented as the final operator step.

## Tasks

- [ ] Task 0 — Feature freeze, compatibility/support matrix freeze, capacity budget freeze
  - Acceptance Criteria:
    - Functional: freeze manifest declares the 0.1.0 support contract: supported Node versions (current LTS + one prior LTS at minimum, matching `release.yml` matrix), supported PostgreSQL server range (matching `test:postgres` and `docs/postgres-persistence.md`), provider protocol surface (OpenAI-compatible + registered provider packages), protocol SDK pins (`@modelcontextprotocol/sdk@1.30.0`, pinned AG-UI/ACP/A2A SDK versions from manifests), platforms (Linux x86_64 measured; others stated as untested or listed where CI covers them).
    - Functional: freeze manifest lists explicit **unsupported** combinations (Node EOL, PostgreSQL below range, experimental ACP v2, Cedar, Redis/Kafka, multiple forges/object stores) mirroring roadmap non-goals.
    - Functional: freeze manifest records per-scenario capacity ceilings (event append/replay throughput, reconnect p95, policy/identity decision overhead, approval state ops, repository/LSP/process op p95, ACP streaming chunk rate, egress proxy throughput, startup time, packed install size) carried forward from `benchmark-0.0.23.json` … `benchmark-0.0.28.json` ceilings and existing `scripts/budgets.json` entries; no ceiling may be silently loosened — any change from prior phase ceilings is recorded with rationale.
    - Functional: feature freeze declared: no new exports/subpaths/migrations after Task 0 except blocker fixes, each recorded as a freeze deviation.
    - Performance: freeze publishes the tolerance model for benchmark regression (existing `benchmarkMedians` ±25% convention or replacement, stated explicitly).
    - Code Quality: one machine-checked manifest + schema test wired into `npm test`, following the plan 010/011 freeze pattern (`scripts/phase10-freeze-manifest.json`, `scripts/phase11-freeze-manifest.json`).
    - Security: freeze restates the audit policy target (`--audit-level=moderate` at 0.1.0), provenance requirement (npm OIDC trusted publishing), and signed-tag requirement.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 12 + Release Validation Checklist; `docs/0.1.0-readiness.md` (current stale 0.0.16 baseline); `docs/release-and-install.md`; `docs/performance.md`; `scripts/budgets.json`; `scripts/benchmark-0.0.23.json` … `benchmark-0.0.28.json`.
      - `.github/workflows/release.yml`, `security.yml`, `live-canaries.yml`, `sandbox-browser.yml` for the actual protected matrix legs.
      - `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Prose-only freeze in the readiness doc: not machine-checkable; reject (plan 010/011 precedent is manifest + test).
      - Reuse plan 011 manifest shape: wrong domain (adapter caps vs release contract); new `scripts/phase12-freeze-manifest.json` chosen.
    - Chosen Approach:
      - `scripts/phase12-freeze-manifest.json` + `scripts/phase12-freeze.test.mjs` validating support matrix, unsupported list, capacity ceilings, audit/provenance/tag policy, and feature-freeze deviation log; wired into the `npm test` script list.
    - API Notes and Examples:
      ```jsonc
      // scripts/phase12-freeze-manifest.json (illustrative; exact values frozen in Task 0)
      { "release": "0.1.0",
        "node": { "supported": ["20", "22", "24"], "eol": "<20" },
        "postgres": { "supportedRange": ">=14 <18" },
        "audit": { "level": "moderate", "provenance": "npm-oidc", "signedTag": "v0.1.0" },
        "capacity": { "reconnectP95Ms": 0, "eventAppendPerSec": 0 },
        "unsupported": ["acp-v2-experimental", "cedar", "redis", "kafka"],
        "deviations": [] }
      ```
    - Files to Create/Edit:
      - `scripts/phase12-freeze-manifest.json` (new), `scripts/phase12-freeze.test.mjs` (new), `package.json` (`test` script: add phase12 test files), `roadmap.md` no change yet.
    - References:
      - `scripts/phase10-freeze-manifest.json` / `phase11-freeze-manifest.json` patterns; `scripts/budget-gates.mjs`; roadmap Release Validation Checklist.
  - Test Cases to Write:
    - Freeze schema validation: supported/unsupported disjoint, ceilings positive, deviation entries structured, audit policy present.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (internal freeze only).
    - Docs pages to create/edit: none (per-task docs follow).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 1 — Compatibility matrix: documented and machine-checked
  - Acceptance Criteria:
    - Functional: `docs/release-and-install.md` states the supported Node/PostgreSQL/provider/protocol/platform matrix and explicit unsupported combinations, sourced from the Task 0 freeze manifest (single source of truth; docs tripwire asserts key rows match the manifest where practical).
    - Functional: Node supported-version matrix runs in protected CI (`release.yml`) — build + packed public import on every supported Node line; failing legs block the release gate.
    - Functional: PostgreSQL supported-version conformance runs against each supported server version in the protected disposable suite (or records why one leg is blocked as a release gate, never a silent skip).
    - Functional: provider/protocol compatibility stated as pinned SDK versions + conformance suites (`provider-conformance`, MCP 38-test suite, AG-UI/ACP/A2A conformance) with links to evidence.
    - Performance: matrix runs reuse existing conformance suites; no new long-running test infrastructure beyond what protected workflows already provide.
    - Code Quality: machine checks prefer extending existing docs tripwires (`src/__tests__/docs.test.ts`) and freeze tests over new harnesses.
    - Security: matrix docs state the security-support boundary (which lines receive audit fixes) consistent with `docs/host-security.md`.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`, `docs/0.1.0-readiness.md`, `.github/workflows/release.yml` matrix config, Node release schedule (LTS lines), PostgreSQL release/support policy.
    - Options Considered:
      - Prose matrix only: drifts from CI reality; reject.
      - Full cross-product matrix (every Node × every Postgres): combinatorial CI cost; reject — pin each leg to the version range with one representative per line, state the range.
      - Docs tripwire + workflow matrix alignment: chosen.
    - Chosen Approach:
      - Align `release.yml` matrix with freeze manifest; add a docs tripwire asserting manifest/docs agreement for the rows that matter (Node lines, Postgres range, audit level).
    - API Notes and Examples:
      ```bash
      # protected leg example
      PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres
      ```
    - Files to Create/Edit:
      - `docs/release-and-install.md`, `src/__tests__/docs.test.ts` (tripwire), `.github/workflows/release.yml` (matrix alignment only if it deviates from freeze), `scripts/phase12-freeze.test.mjs` (docs-agreement assertions).
    - References:
      - Existing Node 20/current import smoke in `sdk:ready` history (Phase 6 evidence); plan 001 docs tripwire pattern.
  - Test Cases to Write:
    - Docs tripwire: supported/unsupported rows in `release-and-install.md` match freeze manifest.
    - Workflow matrix leg failure blocks release gate (dry verification via release.mjs behavior).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (support contract is public, though no API changes).
    - Docs pages to create/edit: `docs/release-and-install.md` (matrix + unsupported list + security-support boundary), `docs/host-security.md` (boundary cross-reference).
    - `docs/index.md` update: yes; Release/install entry must mention the frozen 0.1.x support matrix.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 2 — Upgrade/migration matrix 0.0.17 → 0.1.0 and release-integrity repair
  - Acceptance Criteria:
    - Functional: `docs/migration.md` has one verified section per roadmap release line (0.0.18 … 0.0.28 → 0.1.0): what changed, store-compatibility statement (compatible / tested migration / tested refusal), and breaking-default callouts (e.g., `inputLayout` default, registry activation default).
    - Functional: persistent-store upgrade paths verified: PostgreSQL migration checksums (`packages/session-store-postgres`, `packages/enterprise-postgres`) run clean from the oldest shipped schema version to current in the disposable suite; incompatible store state fails with typed refusal, not corruption.
    - Functional: release-integrity gap closed: every release from 0.0.18 onward has a signed tag or a documented publication-evidence pointer; `v0.1.0` signing procedure exercised in dry run (`release:publish --dry-run --allow-untagged` semantics verified).
    - Functional: compat baselines (`scripts/compat-baseline/`) regenerated for 0.1.0 with zero breaking declaration deltas vs 0.0.28 (additive-only otherwise documented as deviation).
    - Performance: migration verification reuses existing disposable PostgreSQL suites; no new database infrastructure.
    - Code Quality: migration matrix is one doc section + tests, not a new migration framework.
    - Security: migration fixtures never contain credentials; refusal paths for unauthorized/foreign-schema stores covered.
  - Approach:
    - Documentation Reviewed:
      - `docs/migration.md` (sections 0.0.17 → 0.0.28), `docs/database-persistence.md`, `docs/postgres-persistence.md`, `docs/enterprise-postgres-state.md`, migration/checksum sources in the postgres packages, `scripts/release.mjs` tag/provenance behavior.
    - Options Considered:
      - Verify only 0.0.28 → 0.1.0: roadmap requires 0.0.17-through chain; reject.
      - Live-upgrade a production-shaped replica cluster: no operational owner; reject — disposable suite with schema replay is the proven pattern.
    - Chosen Approach:
      - Extend disposable PostgreSQL suite with an upgrade-chain test (oldest shipped schema → current migrations, checksum-guarded) and a refusal test for foreign/corrupt migration state; docs tripwire per migration section (existing pattern).
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs check --version 0.1.0
      node scripts/release.mjs publish --version 0.1.0 --dry-run --allow-untagged
      ```
    - Files to Create/Edit:
      - `docs/migration.md` (0.1.0 section + matrix completeness pass), `src/__tests__/docs.test.ts` (tripwire for 0.1.0 section), postgres package upgrade-chain test(s), `scripts/compat-baseline/*` (regenerated at bump time), `docs/release-and-install.md` (tag/provenance handoff).
    - References:
      - Phase 6 migration/checksum work (plan 006); roadmap confirmed defect #4 (HEAD beyond `v0.0.17` without signed tag/publication evidence).
  - Test Cases to Write:
    - Schema upgrade chain: oldest shipped → current, checksums intact, idempotent re-run.
    - Foreign/corrupt migration state: typed refusal, no partial apply.
    - Docs tripwire: migration section per release line present; 0.1.0 callouts complete.
    - Compat gate: zero breaking deltas at 0.1.0 bump.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (upgrade contract is public).
    - Docs pages to create/edit: `docs/migration.md`, `docs/release-and-install.md`, `docs/public-contracts.md` (compat statement).
    - `docs/index.md` update: yes; Migration entry states 0.0.17 → 0.1.0 chain verified.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 3 — Packed-install end-to-end journeys (enterprise + coding)
  - Acceptance Criteria:
    - Functional: a fresh packed-install consumer fixture completes an enterprise journey using only public exports and documented installs: OIDC identity → policy decision → agent run with durable events → batched approval → OpenAPI side effect with idempotency → artifact upload/signed delivery, against disposable PostgreSQL + fake servers.
    - Functional: a fresh packed-install consumer fixture completes a coding journey: ACP editor session (init capability negotiation, session load/resume) → bounded coding tools (search modes/glob/read-before-write/delete/move) → sandboxed process session → forge handoff fixture, using only public exports.
    - Functional: fixtures install from `npm pack` tarballs (not workspace source paths), resolving the exact 0.1.0 manifest graph.
    - Performance: fixtures run network-free except protected canary legs; total runtime bounded (state a ceiling in the freeze manifest).
    - Code Quality: fixtures follow existing packed-install patterns from Phase 5/9/10 evidence rather than a new harness; reuse `scripts/fixtures` conventions.
    - Security: fixtures contain no real credentials; fake OIDC/OPA/auth-server/object-store fixtures from Phase 11 are reused.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md` packed-import pattern, plan 005/009/010 packed-install evidence, `examples/` demo-gate conventions, Phase 11 fake-server fixtures.
    - Options Considered:
      - Single mega-fixture: hard to attribute failures; reject — two journey fixtures.
      - Run against workspace source: defeats the packed-install claim; reject.
    - Chosen Approach:
      - Two fixture packages under `scripts/fixtures/` (or wherever Phase 11 fixtures live) wired into `npm test` as node --test files; protected legs reuse the same fixtures with real infra.
    - API Notes and Examples:
      ```bash
      node --test scripts/e2e-enterprise-journey.test.mjs
      node --test scripts/e2e-coding-journey.test.mjs
      ```
    - Files to Create/Edit:
      - `scripts/e2e-enterprise-journey.test.mjs` (new), `scripts/e2e-coding-journey.test.mjs` (new), fixture support files, `package.json` test script wiring, `docs/release-and-install.md` (journey evidence row).
    - References:
      - Roadmap Phase 12 functional criteria list (journey steps); `docs/acp.md`, `docs/openapi-tools.md`, `docs/forge-integration.md`, `docs/work-artifacts-and-review.md`.
  - Test Cases to Write:
    - Enterprise journey happy path + one failure-injection (policy deny, artifact hash mismatch) proving fail-closed behavior.
    - Coding journey happy path + one denial path (execution policy deny, read-before-write reject).
    - Install-from-tarball assertion: no workspace-relative resolution.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (fixtures exercise existing public API).
    - Docs pages to create/edit: `docs/release-and-install.md` (journey evidence), `docs/0.1.0-readiness.md` (gate rows).
    - `docs/index.md` update: no (no new page).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 4 — Protected multi-replica and restart-recovery evidence
  - Acceptance Criteria:
    - Functional: multi-replica run/reconnect passes: agent run started on replica A, replica A killed, stream resumed on replica B through the durable PostgreSQL `AgentEventSource` with no gap/duplicate visible to consumers (Phase 7 conformance extended to the journey fixture).
    - Functional: restart recovery verified at each checkpoint class: replica/process/database restart during event streaming, tool-effect unknown-outcome window, and pending-approval suspension — each resumes without rerunning completed work or silently replaying side effects.
    - Functional: durable custom loop snapshot/restore (Phase 8), batched/partial approvals, ACP editor session across restart (Phase 10), sandboxed coding process recovery semantics (Phase 9), and forge handoff reconciliation pass on protected infrastructure.
    - Functional: `npm run test:postgres` and any live/sandbox legs run under protected workflows; missing `PRISM_TEST_POSTGRES_URL` or credentials records a **blocked gate** (named, visible) rather than a passing skip.
    - Performance: reconnect p95 and contention results recorded against Task 0 ceilings.
    - Code Quality: reuse `scripts/phase7-conformance.test.mjs` and protected workflow patterns; add script aliases (`test:live`, `test:sandbox-browser`) only if they reduce workflow duplication — otherwise workflows invoke existing commands unchanged.
    - Security: restart fixtures cannot leak another tenant's events/cursors/approvals; ownership rechecks on resume covered.
  - Approach:
    - Documentation Reviewed:
      - `docs/agent-events.md`, `docs/tool-effects.md`, `docs/agent-loops.md`, `docs/acp.md`, `docs/process-sessions.md`, `scripts/phase7-conformance.test.mjs`, `.github/workflows/live-canaries.yml`, `sandbox-browser.yml`.
    - Options Considered:
      - Simulate replicas with two in-process event sources: does not prove cross-process durability; reject for the primary leg, acceptable for network-free unit coverage.
      - Real two-process PostgreSQL fixture: chosen (Phase 7 already proved the pattern).
    - Chosen Approach:
      - Extend the enterprise/coding journey fixtures with kill/resume variants gated behind protected env; protected workflow records evidence artifacts.
    - API Notes and Examples:
      ```bash
      PRISM_TEST_POSTGRES_URL="$DATABASE_URL" npm run test:postgres
      # protected: live provider/MCP/forge/OIDC/object-store canaries
      node scripts/live-canary.mjs
      ```
    - Files to Create/Edit:
      - Journey fixture kill/resume variants, `scripts/phase7-conformance.test.mjs` (restart cases if missing), `.github/workflows/*.yml` (evidence recording, blocked-gate semantics), `package.json` (script aliases only if justified).
    - References:
      - Phase 7 completion evidence (multi-process reconnect suite); roadmap defect #5 (protected gates not recorded for HEAD).
  - Test Cases to Write:
    - Kill-between-events resume on second process: no gap, no duplicate, cursor intact.
    - Restart inside tool-effect unknown-outcome window: idempotent replay or host-resolution demand, never silent double-apply.
    - Restart with pending batched approvals: decisions survive, CAS versions hold.
    - Cross-tenant isolation on resume (foreign cursor/event/approval rejected).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (evidence for existing behavior).
    - Docs pages to create/edit: `docs/0.1.0-readiness.md` (protected-evidence rows), `docs/release-and-install.md` (how operators re-run each leg).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 5 — Capacity envelopes: benchmark-0.1.0 and frozen performance contract
  - Acceptance Criteria:
    - Functional: `scripts/benchmark-0.1.0.mjs` covers every roadmap-named envelope: event throughput, reconnect latency, database contention/storage growth, policy/identity overhead, approval state, repository/LSP/process operations, ACP streaming, proxy egress, package startup/install size — reusing prior scenario scripts where they already measure them, extending only gaps.
    - Functional: results checked in as `scripts/benchmark-0.1.0.json` under Task 0 ceilings; a regression test fails `npm test` if medians exceed ceilings beyond the frozen tolerance.
    - Functional: `docs/performance.md` publishes the envelopes with methodology (hardware, Node/Postgres versions, dataset), p95 values, and explicit pass/fail thresholds; labels network-free vs protected measurements.
    - Performance: benchmark runtime bounded (state ceiling); no flaky timing assertions on constrained CI (use medians/tolerance per existing convention).
    - Code Quality: one new benchmark script composing existing scenario modules where possible; no new benchmark framework.
    - Security: benchmark fixtures contain no secrets; storage-growth measurement uses disposable database.
  - Approach:
    - Documentation Reviewed:
      - `docs/performance.md`, `scripts/benchmark-0.0.23.mjs` … `benchmark-0.0.28.mjs` + JSON results, `scripts/budget-gates.mjs`, `docs/0.1.0-readiness.md` gate table.
    - Options Considered:
      - Keep per-phase benchmark scripts as the 0.1.0 evidence: fragmented and phase-scoped; reject as the release artifact (kept as history).
      - One composed 0.1.0 script + checked JSON + gate test: chosen (matches phase precedent).
    - Chosen Approach:
      - Compose prior scenarios into `benchmark-0.1.0.mjs`; gate via a `benchmark-0.1.0.test.mjs` (or budget-gate entry) wired into `npm test`.
    - API Notes and Examples:
      ```bash
      node scripts/benchmark-0.1.0.mjs --out scripts/benchmark-0.1.0.json
      node --test scripts/benchmark-0.1.0.test.mjs
      ```
    - Files to Create/Edit:
      - `scripts/benchmark-0.1.0.mjs` (new), `scripts/benchmark-0.1.0.json` (new, checked), `scripts/benchmark-0.1.0.test.mjs` (new), `package.json` test wiring, `docs/performance.md`.
    - References:
      - `scripts/benchmark-0.0.28.json` ceilings; plan 007–010 benchmark evidence pattern.
  - Test Cases to Write:
    - Ceiling regression test: synthetic over-ceiling fixture fails the gate; real results pass.
    - Install-size/startup rows reproduced from budget gate (no duplicate measurement).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (published capacity contract).
    - Docs pages to create/edit: `docs/performance.md` (full envelope rewrite for 0.1.0), `docs/0.1.0-readiness.md` (benchmark gate row).
    - `docs/index.md` update: yes; Performance entry points at the 0.1.0 envelopes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 6 — Security and supply-chain gates hardened to the 0.1.0 policy
  - Acceptance Criteria:
    - Functional: `npm audit` enforced at `--audit-level=moderate` in `security.yml` and release gate (currently tolerated at higher level per readiness page); zero moderate-or-higher findings with fixable paths at bump time, or each finding dispositioned (fixed, pinned with rationale, or recorded as blocked gate).
    - Functional: CodeQL/SAST, dependency review, secret scan (`scripts/scan-secrets.mjs`), SBOM/license (`scripts/verify-sbom.mjs`), tarball allow/deny content checks, and provenance configuration all mandatory in `security.yml`/`release.yml` with recorded evidence for the 0.1.0 tree.
    - Functional: tenant/protocol/sandbox/egress/OAuth threat suites from Phases 7–11 run green as one named 0.1.0 security evidence leg (aggregate over existing conformance scripts; no rewrite).
    - Functional: protected live integrations (provider, MCP, forge, OIDC, policy, object-store canaries) run with retained evidence; absence of credentials is a blocked gate with a named owner, never a silent skip.
    - Performance: security leg adds no unbounded scan cost beyond existing workflows.
    - Code Quality: enforcement is configuration + gate assertions, not new scanning tooling.
    - Security: supply-chain negative fixtures pass (tampered tarball content, unexpected file types, missing provenance flag detected in dry run); signed `v0.1.0` tag creation procedure verified end to end in dry run.
  - Approach:
    - Documentation Reviewed:
      - `.github/workflows/security.yml`, `release.yml`, `scripts/scan-secrets.mjs`, `scripts/verify-sbom.mjs`, `scripts/release.mjs` gate implementation, npm trusted publishing/provenance docs, GitHub Actions security hardening docs, `docs/host-security.md`.
    - Options Considered:
      - Keep `--audit-level=high`: roadmap 0.1.0 acceptance requires moderate policy; reject.
      - Add a new SAST product: existing CodeQL leg suffices; reject.
    - Chosen Approach:
      - Tighten audit level, aggregate existing threat suites into one evidence leg, verify provenance/signed-tag dry-run path in `release.mjs`.
    - API Notes and Examples:
      ```bash
      npm audit --audit-level=moderate
      node scripts/scan-secrets.mjs && node scripts/verify-sbom.mjs
      ```
    - Files to Create/Edit:
      - `.github/workflows/security.yml`, `scripts/release.mjs` (gate policy level if encoded there), `docs/host-security.md` (0.1.0 security evidence section), `docs/0.1.0-readiness.md` (security gate rows).
    - References:
      - Roadmap defect #2 precedent (MCP SDK audit fix, Phase 1); plan 001 security criteria.
  - Test Cases to Write:
    - Audit-level assertion in release gate test (moderate finding fails gate).
    - Supply-chain negative fixture: unexpected tarball entry rejected by content checks.
    - Blocked-gate semantics: missing canary credential produces named blocked record.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (security policy and evidence).
    - Docs pages to create/edit: `docs/host-security.md`, `docs/0.1.0-readiness.md`, `docs/release-and-install.md` (provenance/signed-tag statements).
    - `docs/index.md` update: yes; Security/auth/trust entries mention the 0.1.0 evidence leg.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 7 — Docs freeze, version bump, release dry-run, publication handoff
  - Acceptance Criteria:
    - Functional: `docs/0.1.0-readiness.md` rewritten: current-line table at 0.1.0, gate rows with commands and 0.1.0-tree evidence (retiring stale 0.0.16/0.0.27 framing), explicit list of what remains operator-gated for 1.0.
    - Functional: `docs/public-contracts.md` states the frozen 0.1.x public contract surface (declaration/exports, events, protocol payloads, migration checksums) and the compatibility promise for 0.1.x patch releases.
    - Functional: every public docs page, package README/changelog (48 manifests), example, and `docs/index.md` verified consistent with 0.1.0 behavior: no retired/unsupported claim, package counts correct, readiness text truthful (docs tripwires green).
    - Functional: all 48 manifests + lockfile + runtime metadata at exact 0.1.0; `release:check -- --version 0.1.0` green; compat baseline regenerated with additive-only delta; `sdk:ready` green from clean checkout.
    - Functional: `release:publish -- --version 0.1.0 --dry-run --allow-untagged` deterministic and recorded; final signed-tag + npm OIDC publication documented as explicit operator steps with rollback notes.
    - Performance: bump/dry-run adds no new long-running work beyond existing release gate.
    - Code Quality: version bump is scripted (`scripts/release.mjs`), no hand-edited manifest drift; changelogs one entry per package touched by Phases 1–12.
    - Security: publication dry run verifies provenance flags and tarball allow-lists; no credential required for dry run.
  - Approach:
    - Documentation Reviewed:
      - `docs/0.1.0-readiness.md`, `docs/index.md`, `docs/public-contracts.md`, `docs/migration.md`, `docs/release-and-install.md`, `docs/performance.md`, all package READMEs/changelogs, `.agents/skills/create-plan/references/prism-wiki.md`.
    - Options Considered:
      - Bump first, fix docs after: docs tripwires would fail `sdk:ready`; reject — docs before bump.
      - Publish in the same task: roadmap keeps publication an explicit operator action after evidence review; reject.
    - Chosen Approach:
      - Docs freeze → tripwires green → version bump via release script → full `sdk:ready` → publish dry-run → handoff section in `docs/release-and-install.md`.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm run release:check -- --version 0.1.0
      npm run release:publish -- --version 0.1.0 --dry-run --allow-untagged
      ```
    - Files to Create/Edit:
      - `docs/0.1.0-readiness.md`, `docs/public-contracts.md`, `docs/index.md`, `docs/release-and-install.md`, `docs/migration.md`, package READMEs/changelogs, 48 `package.json` manifests + `package-lock.json` (scripted), `roadmap.md` (completion evidence after exit gate).
    - References:
      - Plan 001 Task 9 release-handoff pattern; roadmap Release Validation Checklist.
  - Test Cases to Write:
    - Docs tripwires: readiness current-line row = 0.1.0; public-contracts 0.1.x section present; index entries complete for all 48 packages.
    - Release dry-run determinism: repeated `release:check` produces identical result.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (readiness/support/compat contract frozen for 0.1.x).
    - Docs pages to create/edit: as listed above.
    - `docs/index.md` update: yes; full pass — every public package/capability discoverable, no retired claims.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
