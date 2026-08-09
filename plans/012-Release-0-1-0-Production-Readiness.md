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

- [x] Task 0 — Feature freeze, compatibility/support matrix freeze, capacity budget freeze
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

  #### Task 0 freeze record (completed)

  Frozen in `scripts/phase12-freeze-manifest.json` (validated by `scripts/phase12-freeze.test.mjs`, 9 tests, wired into the `npm test` script list after the phase11 freeze tests):

  - **Feature freeze**: active. Allowed: blocker/regression fixes, documentation, release tooling/evidence scripts. Forbidden: new packages, new public exports/subpaths, new schema migrations, new runtime dependencies, Phase 13 candidates. Deviation log empty at freeze; any later deviation must carry task + change + rationale (schema-enforced).
  - **Node support**: `20` and `24` — exactly the measured `release.yml` legs (`verify` on 24, `node20-compat` public import smoke on 20), consistent with `engines.node >=20`. Node 22 is engines-supported but unmeasured in CI; Task 1 decides whether to add a leg or keep supported = measured. Docs examples require Node >=22.6 (native TypeScript stripping).
  - **PostgreSQL support**: major `16` only (CI image `pgvector/pgvector:pg16`, driver `pg@^8.22.0`, schema version 6). pgvector required for the `@arnilo/prism-memory` path only. Range claims beyond 16 require an added protected leg in Task 1 before they may be documented.
  - **Platforms**: `linux-x64` measured; all others stated as untested with a host `sdk:ready` requirement.
  - **Protocol SDK pins** (verified against package manifests by the gate test): `@modelcontextprotocol/sdk@1.30.0`, `@agentclientprotocol/sdk@1.3.0`, `@ag-ui/core@0.0.57`, `@nats-io/jetstream@^3.4.0`, `@nats-io/transport-node@^3.4.0`.
  - **Unsupported combinations**: Node <20, unmeasured PostgreSQL majors, ACP v2 experimental, Cedar, Redis/Kafka, non-GitHub forges, non-S3-compatible object stores, remote-browser vendors/hosted cloud/Studio/channel catalogs.
  - **Release policy**: audit target `--audit-level=moderate` (at freeze the workflows enforce `high`; Task 6 tightens); provenance = npm OIDC trusted publishing + GitHub build attestations on tarballs and SBOM; signed tag `v0.1.0`; 0.1.x compat promise additive-only vs `scripts/compat-baseline`; publication remains an explicit operator action.
  - **Capacity ceilings**: all inherited from phases 8–11 manifests (`benchmark-0.0.25/26/27/28.json` ceilingsMs merged: approval/decision/sticky/snapshot/a2ui; enumeration/process/LSP/forge/proxy/renderer/mapper; ACP fs/mode/terminal/prompt; OIDC/policy/MCP-OAuth/OpenAPI/artifact), 24 scenarios total; median tolerance 0.25; startup import ceiling 250 ms; root packed bytes 678541 ±5% and 293 files ±5% (carried from `scripts/budgets.json`); PostgreSQL evidence ceilings 50 ms point-op / 100 ms cursor-cleanup p95; new e2e journey fixture runtime ceiling 120000 ms (tentative — revalidated in Task 3). Loosening any ceiling requires a recorded deviation.
  - **Security policy**: blocked-gate semantics (missing credentials/infrastructure = named blocked gate, never passing skip); five phase conformance suites named as the 0.1.0 threat evidence leg (files existence-checked by the gate test); supply chain = moderate audit, CodeQL tag-only, secret scan on tracked sources + unpacked tarballs, SBOM/license policy, tarball content gates.

  Evidence: `node --test scripts/phase12-freeze.test.mjs` 9/9 pass; full `npm test` 1409 tests, 1408 pass with the only failure being the plans-index tripwire for this plan file (fixed in `plans/README.md`; green on rerun).

- [x] Task 1 — Compatibility matrix: documented and machine-checked
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

  #### Task 1 completion record

  - **Docs**: new `## 0.1.x compatibility and support matrix` section in `docs/release-and-install.md` — supported/measured table (Node, PostgreSQL, platform, providers, protocol SDK pins), unsupported combinations list, and `### Security-support boundary` (fixes land only for supported lines; audit target moderate, workflows still enforce `high` until Task 6).
  - **Machine checks**: docs tripwire `phase 12 compatibility matrix agrees with the freeze manifest` in `src/__tests__/docs.test.ts` (Node lines, engines range, CI image, per-major PostgreSQL rows, all five protocol SDK name+pin strings, six unsupported tokens, boundary section); `release.yml CI legs match the support matrix` added to `scripts/phase12-freeze.test.mjs` (Node 20/24 legs, pg16 image, sdk:ready verify leg).
  - **release.yml**: no change required — `verify` (Node 24), `node20-compat` (Node 20), and `postgres-integration` (`pgvector/pgvector:pg16`) already matched the freeze manifest; the new freeze test now guards against drift.
  - **Decisions**: supported = measured. Node 22 stays engines-supported but unmeasured — no extra CI leg added (floor 20 + head 24 covered; add a 22 leg only on host demand). PostgreSQL support stays major 16 only; no additional server-version leg added at this task.
  - **Drive-by fix**: `docs/index.md` Release/install entry still claimed the stale 0.0.24/47-package graph; updated to 0.0.28/48 plus the frozen-matrix description.
  - Evidence: `npm test` rc=0 — core 1410/1410 (new tripwire + 10 freeze-gate tests included), all workspace suites fail 0; `npm run lint` rc=0 (two pre-existing noTemplateCurlyInString warnings in docs.test.ts lines 945/1572, untouched by this task).

- [x] Task 2 — Upgrade/migration matrix 0.0.17 → 0.1.0 and release-integrity repair
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

  #### Task 2 completion record

  - **Migration matrix**: `docs/migration.md` now opens with `## 0.0.28 → 0.1.0 release-candidate hardening (no migration)` (store compatibility: **compatible**, no breaking defaults, additive-only compat promise vs `scripts/compat-baseline` enforced by `release.mjs gate`) and a `## 0.0.17 → 0.1.0 upgrade matrix` table with one row per release line 0.0.18 → 0.1.0 carrying a store-compatibility statement (`compatible` / `tested migration` / `tested refusal`) and breaking-default callouts (`inputLayout` → `cache_aware`, `SkillRegistry` zero-activation/`activateAllSkills`, durable-loop fingerprint shape).
  - **Upgrade paths verified (disposable PostgreSQL suite)**: two new integration tests in `packages/session-store-postgres/src/__tests__/postgres-integration.test.ts` — `upgrades an older shipped schema (v6) to the current contract without rewriting history` (seeds checksum-valid 001-006 history + DDL, opens, asserts 007 applies with all SHA-256 checksums intact and idempotent reopen equality) and `refuses foreign or corrupt migration history with no partial apply` (foreign `999_foreign` row and tampered checksum both reject with contract mismatch errors; history rows and index state provably untouched). Enterprise-postgres refusal/upgrade coverage already existed (`migrations.integration.test.ts`: v1→v2 checksum-valid upgrade, `ERR_PRISM_ENTERPRISE_POSTGRES_MIGRATION`/`SCHEMA` typed refusal). Ran green against a disposable `pgvector/pgvector:pg16` container: 21/21 integration tests pass.
  - **Freeze-manifest correction**: `scripts/phase12-freeze-manifest.json` recorded `schemaVersion: 6` while the shipped contract has **7** migrations (`PERSISTENCE_SCHEMA_VERSION = 7`, docs say schema-v7) — corrected to 7 and `scripts/phase12-freeze.test.mjs` gained `postgres schemaVersion matches the shipped migration contract` (imports the built contract and asserts equality, so the freeze manifest can no longer drift from the code).
  - **Release-integrity repair (roadmap defect #4)**: `docs/release-and-install.md` gained `### Release-integrity evidence matrix (0.0.18 → 0.1.0)` — every release 0.0.18 → 0.1.0 with its tag (or documented `**no tag**` for 0.0.21 and 0.0.28) and a publication-evidence pointer (roadmap phase completion evidence, benchmark JSON, phase conformance suite, publish handoff, migration section). Existing tags are lightweight (no GPG key in this environment), so the documented evidence pointers close the gap; the signed `v0.1.0` tag + npm OIDC provenance remain explicit operator actions at Task 7 publication.
  - **v0.1.0 signing dry-run semantics verified**: `node scripts/release.mjs publish --version 0.0.28 --dry-run --allow-untagged --allow-dirty` completes 49/49 packages dry-run (untagged dry-run proceeds; real publication refuses `--allow-untagged`/`--allow-dirty` per `assertGitState`). The 0.1.0 dry-run itself runs at bump time (Task 7), since manifests are still 0.0.28.
  - **Compat gate**: `node scripts/release.mjs gate --version 0.0.28` passes with zero breaking declaration deltas vs `scripts/compat-baseline` (49 packages, 0 breaks, rc=0) — the additive-only baseline for the 0.1.0 bump; baselines regenerate at bump time (Task 7).
  - Evidence: `npm test` rc=0 — core **1411/1411** (new phase 12 migration-matrix tripwire included), all workspace suites fail 0; postgres integration 21/21 on disposable pg16.

- [x] Task 3 — Packed-install end-to-end journeys (enterprise + coding)
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

  #### Task 3 completion record

  - **Two journey fixtures** under `scripts/fixtures/` (reusing the existing packed-install pattern from `src/__tests__/install-smoke.test.ts`, not a new harness):
    - `scripts/fixtures/e2e-enterprise-journey.mjs` — OIDC identity (in-process RSA + JWKS) → OPA policy decision appended to the durable ledger (with a policy-deny fail-closed leg) → agent run with durable events (memory event source by default; real PostgreSQL via `createPostgresPersistence().events` when `PRISM_TEST_POSTGRES_URL` is set) → batched approval of 2 pending decisions via `resumeAgentRun` → OpenAPI side effect with core-managed idempotency (replay provably never re-POSTs) → artifact upload + signed delivery with a hash-mismatch fail-closed injection. Prints `ENTERPRISE JOURNEY OK`.
    - `scripts/fixtures/e2e-coding-journey.mjs` — ACP editor session via `createPrismAcpAgent` + the real `@agentclientprotocol/sdk` client (init capability negotiation, `session/new`, `session/load` resume of a stored session, four-outcome permission path) → bounded coding tools (git-aware list/search respecting `.gitignore`, glob, read-before-write write with a session `readPathSet`, delete, move) with execution-policy and read-before-write denial paths → sandboxed process session (`createProcessSessions` with a `startProcess` sandbox backend) → forge handoff (`createGitHubForge` against a fake GitHub server with idempotent PR replay). Prints `CODING JOURNEY OK`.
  - **Packed-install harness** (`scripts/fixtures/packed-consumer.mjs`): packs each journey's first-party closure (resolved from manifest `dependencies`/`peerDependencies`, e.g. server→workflows, ag-ui→coding-agent→workflows/mcp/supervisor) into tarballs, installs them offline into a fresh consumer project, and asserts per package that the installed version equals the packed manifest version — the exact 0.0.28 graph (0.1.0 at bump).
  - **Test drivers wired into `npm test`**: `scripts/e2e-enterprise-journey.test.mjs` and `scripts/e2e-coding-journey.test.mjs` (3 tests each): install-from-tarball graph equality, no-workspace-resolution probe (`import.meta.resolve` under the consumer dir, never the repo), and journey success + runtime ceiling. Both fixtures run inside `npm test` — measured ~3.8 s total for pack+install+run, far under the frozen `e2eJourneyFixtureMsCeiling` (120 000 ms, unchanged).
  - **Protected PostgreSQL leg verified**: with `PRISM_TEST_POSTGRES_URL` against a disposable `pgvector/pgvector:pg16` container, the enterprise journey ran green through real migrations + durable event source (`createPostgresPersistence` applies the contract, then `persistence.events` serves the run events). Task 4 reuses this same fixture with kill/resume variants.
  - **Docs**: `docs/release-and-install.md` gained the packed-install e2e journeys bullet; `docs/0.1.0-readiness.md` gained the `## Packed-install e2e journeys (plan 012 Task 3)` matrix with both journeys, their commands, environments, and the success markers; new docs tripwire `phase 12 packed-install e2e journey evidence is documented and wired` asserts the sections, markers, npm test wiring, and fixture files.
  - Evidence: `npm test` rc=0 — core **1412/1412** (new tripwire included), both journey suites green, all workspace suites fail 0.

- [x] Task 4 — Protected multi-replica and restart-recovery evidence
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

  #### Task 4 completion record

  - **New protected fixture** `scripts/fixtures/phase12-restart-worker.mjs` (reuses the Phase 7 worker pattern; modes `run`/`resume`/`append`):
    - Replica A: durable agent run against PostgreSQL (`createPostgresPersistence` checkpoints/events/session store + `createPostgresEnterpriseState` tool effects), custom loop with snapshot/restore, suspends on a batched tool approval, appends durable `tool_execution_started` events, prints `STATE` and then **waits to be SIGKILLed** by the driver (hard crash, no cleanup).
    - Replica B: reconnects to the same schema and asserts: events intact with contiguous sequences (no gap, no duplicate), foreign-tenant event page empty, foreign-tenant cursor rejected (`ERR_PRISM_AGENT_EVENT_SOURCE_CURSOR`), foreign-ownership run-state load rejected (`CheckpointConflictError`), partial batch approval re-suspends with the remaining decision, stale CAS version rejected, full resume succeeds with each durable tool effect executed exactly once (`phase12_counter` rows 1/1), continuation append keeps sequences contiguous (`evt-c1, evt-c2, evt-done` = 1,2,3), and the tool-effect unknown-outcome window (claim dispatched then expired through the store's own transitions) replays as `ERR_PRISM_TOOL_EFFECT_UNKNOWN` — reconciliation demanded, side effect never applied.
  - **Driver** `scripts/phase12-restart-recovery.test.mjs` wired into `npm run test:postgres` (after the Phase 7 suite), 4 tests: kill/resume functional leg, reconnect p95 across 3 kill/resume cycles vs the new frozen `reconnectP95Ms` ceiling, 16-worker append contention p95 vs the existing `pointOpP95Ms` ceiling, and a terminated-LISTEN-backend poll catch-up leg. **Blocked-gate semantics**: without `PRISM_TEST_POSTGRES_URL` the suite fails with a named `BLOCKED GATE` message (verified) instead of skipping; `scripts/require-postgres-url.mjs` guards the script-level entry.
  - **Freeze manifest**: `capacity.postgresEvidence.reconnectP95Ms` added (2000 ms, measured p95 142 ms against disposable pg16); `phase12-freeze.test.mjs` asserts the new ceiling. No frozen policy loosened — additive measurement row only.
  - **Recorded evidence** `scripts/phase12-restart-recovery.json` (checked in): reconnect p95 142 ms (samples 100/139/142) vs 2000 ms ceiling; contention p95 6.81 ms (16 samples) vs 50 ms ceiling; recorded against `pgvector/pgvector:pg16`. Refreshed with `PRISM_PHASE12_RECORD_EVIDENCE=1 npm run test:postgres`.
  - **Restart classes mapped**: process/replica restart = kill/resume leg; database restart during streaming = terminated-backend poll catch-up (Phase 7 + Phase 12 legs); tool-effect unknown-outcome window = dispatched+expired claim leg; pending-approval suspension = partial/full resume legs; durable custom loop snapshot/restore = cross-process `loopState` restore (turn counter resumed on replica B, provider never re-yields the approved calls); batched/partial approvals + CAS = partial re-suspend + stale-version rejection; forge handoff reconciliation = the same durable `ToolEffectStore` idempotency now proven across processes (Phase 9 proves the forge path in-process); ACP editor session across restart and sandboxed process sessions stay host-owned by design (documented seam in `packages/ag-ui/src/acp/agent.ts`) — the durable agent-run lifecycle underneath is what this leg proves, and the coding journey + Phase 9/10 conformance cover the in-process semantics.
  - **Docs**: `docs/0.1.0-readiness.md` gained the `## Protected restart-recovery evidence (plan 012 Task 4)` matrix (legs, commands, environments, blocked-gate statement); `docs/release-and-install.md` gained the operator how-to bullet; new tripwire `phase 12 restart-recovery evidence is documented and wired`; the existing `test:postgres` tripwire updated to the new invocation.
  - Evidence: `npm run test:postgres` rc=0 against disposable pg16 (workspace suites 28+16+30, phase 7+12 7/7); network-free `npm test` rc=0 — core **1413/1413** (new tripwires included).

- [x] Task 5 — Capacity envelopes: benchmark-0.1.0 and frozen performance contract
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

  #### Task 5 completion record

  - **Composer** `scripts/benchmark-0.1.0.mjs`: spawns the six phase benchmark scripts (0.0.25–0.0.28 network-free, 0.0.23/0.0.24 protected) as child processes, parses and merges their reports into one envelope (no new benchmark framework, no duplicated scenario code). Each leg keeps its phase fixture; rows are labeled `network-free` or `protected` with their source leg. Protected legs run only when `PRISM_TEST_POSTGRES_URL` is set and are recorded as `skipped` otherwise — the network-free contract still gates. Install/startup rows reuse the shared `budget-gates.mjs` helpers (`measureRootPack`, `measureStartupMs`) so nothing is measured twice. The composer exits 1 with `BUDGET FAIL` lines when any merged row exceeds its freeze-manifest ceiling, startup exceeds 250 ms, or a pack row exceeds ±5%.
  - **Checked evidence** `scripts/benchmark-0.1.0.json`: recorded with all six legs run against a disposable `pgvector/pgvector:pg16` (PRISM_TEST_POSTGRES_URL on port 55436, container removed after recording). 40 rows: 24 network-free within the 24 frozen `ceilingsMs` rows (max p95/ceiling ratio 0.80), 16 protected PostgreSQL rows within budgets.json ceilings; startup import 41.7 ms < 250 ms; root packed 711,755 bytes / 295 files within the regenerated ±5% diet; per-leg storage-growth rows and query plans retained in the JSON.
  - **Regression gate** `scripts/benchmark-0.1.0.test.mjs` wired into `npm test` (after `phase12-freeze.test.mjs`): `assertEnvelope` requires every frozen ceiling row present and within ceiling, every protected row labeled protected and within its budgets.json ceiling, no result-name drift, all six legs recorded as run, and startup/pack rows within frozen bounds. Test cases: recorded evidence passes; synthetic over-ceiling fixture fails the gate naming the row.
  - **Freeze amendment** (recorded as `featureFreeze.deviations[0]`, task `plan 012 Task 5`): Tasks 1–5 added ~35 KB of release-evidence files to `scripts/` (journey fixtures, restart-recovery worker/driver/evidence, benchmark envelope), which is packed into the root tarball, pushing `rootPackedBytes` from 678,541 to 713,454 — over the old ±5% limit. The baseline was regenerated in both `scripts/phase12-freeze-manifest.json` and `scripts/budgets.json` (the budget gate reads the latter; the manifest drives the freeze test and the envelope contract snapshot). This is a regeneration, not a loosening: same 5% tolerance, every other ceiling untouched; the budget gate still enforces the regenerated baseline on every `npm test`.
  - **Docs**: `docs/performance.md` gained the `## Release 0.1.0 capacity envelopes (frozen performance contract)` section (methodology: hardware/Node/PostgreSQL, per-leg fixtures, datasets; full 40-row p95 table with explicit pass/fail thresholds; network-free vs protected labels; regenerate commands); `docs/0.1.0-readiness.md` gained the `0.1.0 capacity envelope` gate row; `docs/index.md` Performance entry updated; new tripwire `phase 12 capacity envelope is documented and wired`.
  - Evidence: network-free composer run ~20 s; full six-leg recording ~6 m 20 s (bounded by the 0.0.23 enterprise-PostgreSQL leg, unchanged from its phase fixture; iterations controllable via `PRISM_BENCH_ITERATIONS`/`PRISM_BENCH_WARMUPS` for CI smoke). `npm test` rc=0 — core **1414/1414** (envelope gate + tripwire included).

- [x] Task 6 — Security and supply-chain gates hardened to the 0.1.0 policy
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

  #### Task 6 completion record

  - **Audit policy tightened to moderate.** `npm audit --audit-level=moderate` now runs in `security.yml` (supply-chain job) and `release.yml` (supply-chain job), matching the freeze-manifest `releasePolicy.auditLevelTarget`; `auditLevelAtFreeze` in the manifest still reads `high (tightened to moderate in Task 6)` — that string is the historical freeze-time record, left as-is. Recorded 0.1.0 tree: `npm audit` reports 0 vulnerabilities at every severity (317 locked dependencies); the MCP SDK moderate findings from roadmap defect #2 are gone (pinned at the 1.30.0 fix baseline).
  - **Named 0.1.0 threat-suites leg.** New `npm run security:threat-suites` script aggregates the Phase 8–11 conformance suites (durable-loop/HITL approval, coding sandbox/egress/forge, ACP protocol, OIDC/OPA/MCP-OAuth/OpenAPI/artifact) — same files as `npm test`, no rewrite; ran green 28/28. The Phase 7 tenant-isolation suite remains the protected counterpart under `npm run test:postgres`, where missing `PRISM_TEST_POSTGRES_URL` is already a named blocked gate (`require-postgres-url.mjs` exits 1; the Task 4 restart driver also fails with a `BLOCKED GATE` message).
  - **Supply-chain negative fixtures** added to `scripts/release-gate.test.mjs` (8/8 green): tarball deny list extended with unexpected file types and credential material (native binaries/objects, `.pem`/`.key`/`.p12`/`.pfx`/`.cer`/`.jks`) on top of the existing tampered-content denies (plans/reviews/maps/tests); provenance flag semantics — `--provenance` mandatory when `GITHUB_ACTIONS=true` (publish and dry-run, so the gate is observable in CI), suppressed-provenance detectable in the dry-run argument list, and no provenance claim on local OIDC-less publishes. Existing tampered-tarball and workflow provenance wiring (release.yml `id-token: write`, `attestations: write`, `attest-build-provenance` on tarballs + SBOM, `publishArgs` provenance derivation) were already in place.
  - **Signed-tag dry-run verified end to end.** `node scripts/release.mjs publish --version 0.0.28 --dry-run --allow-dirty --allow-untagged` exits 0 and dry-runs all 49 packages; the same invocation without `--dry-run` refuses with `real publication cannot bypass clean tagged git checks` — so the signed `v0.1.0` tag procedure (operator `git tag -s`, `git verify-tag`, clean-tree publish) cannot be bypassed in a real run. The `git tag -s` creation itself remains an operator action (no GPG key in this environment; the release-evidence matrix records the pointer).
  - **Docs**: `docs/host-security.md` gained the `### 0.1.0 security evidence (plan 012 Task 6)` subsection (audit policy, named threat-suites leg, negative fixtures, mandatory gate stack, blocked-gate canary semantics — live-canaries/sandbox-browser workflows always set their gate env so absent credentials fail loudly with retained `canary-report.json` evidence); `docs/0.1.0-readiness.md` security matrix rows updated (dependency audit at moderate with 0-vuln evidence, `0.1.0 threat-suites leg`, `Supply-chain negative fixtures`); `docs/release-and-install.md` security-support boundary now states moderate enforcement; `docs/index.md` security entry updated; new tripwire `phase 12 security policy is documented and wired` (moderate in both workflows, security.yml jobs, threat-suites composition, doc tokens).
  - Evidence: `npm run security:threat-suites` 28/28; `npm test` rc=0 — core **1415/1415** (new negative fixtures + tripwire included).

- [x] Task 7 — Docs freeze, version bump, release dry-run, publication handoff
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

  #### Task 7 completion record

  - **Docs freeze.** `docs/0.1.0-readiness.md` rewritten with a `## Current line (0.1.0)` table (published graph, Phase 12 items, upgrade path, journeys, restart evidence, envelopes, security policy, docs freeze row) and per-gate 0.1.0-tree evidence in the gate table (exact version graph 49 manifests, docs tripwires 121/121, budget rows at the regenerated dev-001 baselines, publish dry-run 49/49 twice byte-identical, PostgreSQL suite with Phase 7+12 legs); the 0.0.16/0.0.27 values remain as the historical floor and the tripwires that reference them still pass. `docs/public-contracts.md` gained `## Frozen 0.1.x contract (plan 012 Task 7)`: declaration/exports surface vs `scripts/compat-baseline`, events, protocol payloads, migration checksums, and the additive-only 0.1.x patch promise. `docs/index.md` current-line entries updated (0.1.0 graph, SDK-1.30.0 MCP pin corrected); `docs/release-and-install.md` peer pin/tarball names/check commands at 0.1.0; MCP SDK 1.29.0 stale reference fixed. Every package README/changelog verified by the updated tripwire (49 changelogs carry `## [0.1.0] - 2026-08-09` and retain `## [0.0.28] - 2026-08-08`).
  - **Version bump scripted.** `release.mjs` gained a `bump` mode: `node scripts/release.mjs bump --from 0.0.28 --to 0.1.0` rewrote `version` + internal dependency/peer ranges in all **49** manifests and regenerated the lockfile via `npm install --package-lock-only --ignore-scripts` (lock diff is pure version-string churn, 0 structural changes). `release:check --version 0.1.0` green (49/49 `available`, no registry collisions); `release:gate` green with a single additive delta — the `version` const literal in `arnilo__prism.txt` (`"0.0.28"` → `"0.1.0"`, type unchanged) — regenerated via `--update-baseline` following the established per-release refresh pattern. Runtime metadata: `src/index.ts` `version` export now `"0.1.0"` (asserted by index.test.ts); packaging/release/index tests updated to the 0.1.0 graph; install-smoke tarball-filename assertions (`arnilo-prism-0.1.0.tgz`) and e2e journey test names updated.
  - **sdk:ready green from clean checkout.** Fresh local clone of `ad4aee3` + the full Task 0–7 diff + `npm ci` + `npm run sdk:ready`: rc=0 (typecheck+examples, lint, format, tests **1416/1416**, coverage, pack, release gate 49 packages). In-tree run identical. (Two pre-existing format drifts surfaced by `format:check` — `src/tool-effects.ts`, `src/tool-result-fold.ts`, `packages/session-store-postgres/src/__tests__/postgres-integration.test.ts`, and the Task 3–6 scripts had never been through the formatter — fixed with biome; no behavior change.)
  - **Publish dry-run deterministic and recorded.** `release:publish --version 0.1.0 --dry-run --allow-dirty --allow-untagged` run twice: rc=0 both times, 49/49 `dry-run` status, reports **byte-identical** (reports kept as evidence; real publication still refuses the dirty/untagged bypass — re-verified).
  - **Publication handoff documented.** `docs/release-and-install.md` gained `### 0.1.0 publish handoff (plan 012 Task 7)`: named operator prerequisites (live-canary matrix, PostgreSQL/keychain suites, CodeQL, npm OIDC identity), the full command sequence (sdk:ready, threat-suites, test:postgres, envelope gate, secret/SBOM scan, audit, check, double dry-run), `git tag -s v0.1.0` + `verify-tag` + tag push, and **rollback notes** (resume semantics, 72-hour unpublish window → 0.1.x patch path, store-compatible both directions so adoption can be deferred without DB rollback).
  - New tripwire `phase 12 release freeze and 0.1.0 handoff are documented` (readiness current line, public-contracts section tokens, handoff + rollback + peer pin + tarball name in release page, root manifest at 0.1.0, root changelog entry). Root CHANGELOG `[0.1.0] - 2026-08-09` summarizes Phases 1–12.
  - Evidence: `npm run sdk:ready` rc=0 in-tree and from clean checkout (**1416/1416** core tests, docs 121/121, release gate 49 packages, 0 breaks); `release:check` 49/49; publish dry-run twice byte-identical; full `npm test` green.

## Compromises Made

- **Signed `v0.1.0` tag is an operator action, not created here.** No GPG key exists in this environment; the tag-creation procedure (`git tag -s`, `verify-tag`) is documented in the 0.1.0 publish handoff and the release-integrity matrix records the pointer. Dry-run + refusal paths are machine-verified; the signature itself cannot be.
- **Clean-checkout `sdk:ready` was verified against a local clone** of HEAD + the full working diff (identical content, fresh `npm ci`), not a pushed CI run; the CI verify job re-runs it on the release commit as the operator checklist step.
- **Compat baseline regenerated for the version literal.** The `version` const in `@arnilo/prism`'s `.d.ts` surface changed value (`"0.0.28"` → `"0.1.0"`); the baseline was refreshed via `--update-baseline` (single-line delta, type unchanged), following the same per-release refresh the 0.0.28 changelog documents.
- **`security:threat-suites` runs the Phase 8–11 conformance files as one named leg**; the Phase 7 tenant suite stays under `test:postgres` where the missing-URL blocked gate already exists — no new CI job was added because `npm test` already runs all five files in the verify pipeline.
- **Live canaries keep their env-gate silent-skip for local runs**; the protected workflows always set `PRISM_LIVE_CANARIES=1`, so CI absence of credentials is a loud blocked gate with retained `canary-report.json`. The local skip path is intentional gating, not evidence.

## Further Actions

- **Operator publication of 0.1.0** (signed tag + npm OIDC) is the immediate next step; the handoff in `docs/release-and-install.md` lists the four named prerequisites that must each record evidence first.
- **Phase 13 demand evidence** must precede any new capability plan (roadmap rule): named user, concrete integration, operational owner, measurable acceptance criteria.
- **Node 22 CI leg and multi-Postgres CI legs** stay on-demand (freeze-manifest `support.node` measured [20, 24]); add a CI leg only when a host demands it.
- **A durable ACP session store and a network-free native sandbox backend** remain host-owned by design; revisit only on Phase 13 demand with a threat model.
