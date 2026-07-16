# Maintainability, Documentation, Packaging, and 0.0.5 Release Validation

## Objectives
- Freeze completed Phase 1-13 work into one internally consistent 0.0.5 package graph without publishing.
- Remove confirmed release-time maintenance/documentation drift and keep optional capabilities independently installable.
- Validate packed public composition, supply-chain controls, Node compatibility, persistence integrations, and deterministic resumable publication.

## Expected Outcome
- All 30 publishable manifests, lock entries, internal ranges, generated scaffolds, tests, docs, changelogs, tarballs, and release reports target 0.0.5.
- Public packed imports compose offline across Phase 1-13 capabilities; profiles retain explicit reviewed membership.
- `sdk:ready`, PostgreSQL integration, Node 20/24 checks, audit, dependency graph, registry collision preflight, and provenance-enabled publish dry-run pass with retained evidence and no actual publish.

## Tasks

- [x] Inventory release graph, maintenance hotspots, profile choices, and existing gates
  - Acceptance Criteria:
    - Functional: enumerate all publishable manifests, internal edges, public exports, generated templates, release scripts/workflow, docs/changelogs, and prior Phase 1-13 evidence.
    - Performance: record current source hotspots, test/runtime/tarball baselines, and optional package dependency/size impact before changing release metadata.
    - Code Quality: identify only proven cohesive splits, dead dependencies/exports, contradictory version text, and source-text assertions touched by this release; avoid speculative refactors.
    - Security: map existing secret, audit, install-script, artifact, SSRF/tool/approval/redaction/OAuth/persistence/media/server/MCP/memory/workflow/supervisor/A2A gates and any real gaps.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 14, Phases 1-13 plans/evidence, `README.md`, `CHANGELOG.md`, `docs/release-and-install.md`, `docs/migration.md`, `docs/review-coverage-2026-07-15.md`.
      - `scripts/release.mjs`, `.github/workflows/release.yml`, `package.json`, workspace manifests, pack/install/release/docs tests.
    - Options Considered:
      - Split large core/workflow files by line count: rejected unless Phase 1-13 changes reveal a stable cohesive ownership boundary.
      - Add all optional packages to `prism-all`: rejected by default; include only if size, privilege, and common-use review supports it.
      - Reuse current deterministic graph/tests and close measured gaps: chosen.
    - Chosen Approach:
      - Inventory using stdlib/`npm` commands and existing data-driven release tests; record decisions before version mutation.
    - API Notes and Examples:
      ```bash
      npm ls --all
      npm pack --dry-run --json --workspaces
      ```
    - Files to Create/Edit:
      - `plans/066-maintainability-documentation-packaging-and-0-0-5-release.md`: inventory evidence and decisions.
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`; roadmap Phase 14.
  - Completion Evidence (2026-07-16):
    - Release graph has 30 publishable manifests (root + 29 workspaces), 30 dry-run tarballs, 21 core subpath targets, and six profile/family manifests. Current artifacts total 688,621 packed / 2,633,232 unpacked bytes; core is 402,928 / 1,456,302 bytes.
    - Initial inventory kept Phase 4-13 packages independently installable and profile-excluded pending review: evals 9.8 kB, AI SDK 6.5 kB, memory 17.9 kB, RAG 9.0 kB, server 9.9 kB, supervisor 15.3 kB packed. Follow-up review approved provider/all umbrella inclusion because installation activates no code; focused profiles remain unchanged.
    - Cohesive hotspot review: `src/contracts.ts` 1,562 lines, `src/agents.ts` 881, workflow `run.ts` 1,248. Their recent additions cross shared public contracts/run state machines rather than forming a safe independent module; release-time splitting is rejected as churn. Revisit after 0.0.5 with dedicated compatibility tests.
    - Runtime dependency import scan found no unused direct runtime dependency. `npm ls --all` is clean; no workspace declares `postinstall`. Core still has zero runtime dependencies.
    - Existing gates already cover data-driven pack/import lists, denied artifacts, generated scaffold, exact release graph/order/resume/collision/provenance args, docs/examples, and focused security suites. Confirmed Phase 14 gaps: 0.0.5 retargeting, stale release docs/changelogs, broad packed Phase 1-13 composition, plan index, and whole-artifact secret/checksum evidence.
    - 65 historical tests read source/docs text. Release work will not mass-rewrite history; only touched implementation assertions/version gates will move to runtime/type/export behavior where practical. Package-manifest/docs/absence scans remain artifact-boundary tests, not implementation tests.
  - Test Cases to Write:
    - None unless inventory exposes a missing invariant; existing graph and packaging tests are the baseline.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; inventory only.
    - Docs pages to create/edit: none during inventory.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Retarget the complete package graph and generated projects to 0.0.5
  - Acceptance Criteria:
    - Functional: root/workspace manifests, lockfile workspace entries, exact internal dependency/peer ranges, runtime version, init templates/tests, tarball assertions, and release tests all target exactly 0.0.5.
    - Performance: no runtime dependency or install-hook change is introduced by the metadata bump.
    - Code Quality: one data-driven graph validates versions/ranges; historical 0.0.4 documentation remains explicitly historical rather than globally rewritten.
    - Security: registry publication remains impossible without clean exact `v0.0.5`; real publish cannot use dirty/untagged bypasses.
  - Approach:
    - Documentation Reviewed:
      - npm package manifest/lock semantics embodied by existing `validateRelease()` and `release.test.ts`; Node 20 package engines.
    - Options Considered:
      - `npm version` per workspace plus manual range edits: more commands and drift risk.
      - One stdlib JSON rewrite across known manifests followed by `npm install --package-lock-only`: chosen.
    - Chosen Approach:
      - Set each workspace version and each internal dependency/optional/peer/dev range to 0.0.5 only where package name belongs to the release graph; regenerate lock metadata and update version-specific behavioral assertions.
    - API Notes and Examples:
      ```bash
      npm run release:check -- --version 0.0.5 --allow-dirty --allow-untagged
      ```
    - Files to Create/Edit:
      - Root/workspace `package.json`, `package-lock.json`, `templates/init/package.json.tmpl` if versioned.
      - Version-specific tests under `src/__tests__` and generated-project fixtures.
  - Test Cases to Write:
    - Exact graph validation rejects non-0.0.5 workspace versions/ranges; fresh scaffold pins 0.0.5; packed filenames use 0.0.5.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; install/version identity and generated dependency pins change to 0.0.5.
    - Docs pages to create/edit: `docs/release-and-install.md`, `docs/migration.md`.
    - `docs/index.md` update: no new page; existing release/migration entries updated.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-16):
    - All 30 manifest versions and every internal runtime/optional/peer edge are exactly 0.0.5; workspace-local `file:` dev links remain local by design. `package-lock.json` was regenerated without scripts/audit and has no stale workspace version/range.
    - Root runtime `version`, MCP client/server identity defaults, generated scaffold package pins, package boundary tests, pack filename assertions, and deterministic release fixtures target 0.0.5.
    - `validateRelease(loadRelease(), "0.0.5")` returns all 30 packages in dependency order. Focused runtime version, scaffold generation/typecheck/offline test, and release graph/tag/collision/resume/provenance-argument tests pass.
    - No dependency version, engine, install script, or public API changed during retargeting.

- [x] Close maintainability, documentation, changelog, and profile drift
  - Acceptance Criteria:
    - Functional: every package has a finalized 0.0.5 changelog; README/docs/API/event/protocol/migration/profile statements match packed exports and current behavior; all plans are indexed without altering historical bodies.
    - Performance: report core/generated-project/all-package sizes and keep network-free tests under 60 seconds; profile decisions include measured dependency/size/privilege rationale.
    - Code Quality: remove confirmed dead dependencies/exports and contradictory text; replace touched implementation-source assertions with behavior/type/export checks; split large files only for a proven cohesive boundary.
    - Security: docs state activation/auth/credential/memory/network/sandbox boundaries; secret examples remain synthetic; optional privileged packages remain excluded from profiles unless explicitly justified.
  - Approach:
    - Documentation Reviewed:
      - Every Phase 1-13 page and package README/changelog; Prism wiki page structure; source hotspot and source-text-test inventories.
    - Options Considered:
      - Broad cleanup/refactor before release: rejected as regression risk.
      - Minimal evidence-driven corrections plus explicit deferrals: chosen.
    - Chosen Approach:
      - Finalize Unreleased entries as 0.0.5, add honest no-API-change entries where needed, remove stale release handoff contradictions, preserve historical 0.0.4 sections, and create a concise plans index.
    - API Notes and Examples:
      ```md
      ## [0.0.5] - 2026-07-16
      ```
    - Files to Create/Edit:
      - `CHANGELOG.md`, all `packages/*/CHANGELOG.md`, affected READMEs and `/docs` pages.
      - `plans/README.md`, `src/__tests__/docs.test.ts`, touched boundary tests.
  - Test Cases to Write:
    - Docs navigation/headings/exports/version checks; every package includes finalized 0.0.5 changelog; plan index covers every numbered plan.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; full 0.0.5 user/release documentation is finalized.
    - Docs pages to create/edit: `docs/index.md`, `docs/migration.md`, `docs/release-and-install.md`, `docs/review-coverage-2026-07-15.md`, plus only contradictory Phase 1-13 pages found by audit.
    - `docs/index.md` update: yes; descriptions/status must reflect completed 0.0.5 scope.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-16):
    - Root and all 29 workspace changelogs contain finalized `0.0.5` sections; current feature entries moved out of Unreleased while historical 0.0.4 records remain. Release/migration/index/review docs now describe 0.0.5, 30 packages, pgvector CI, and direct versus umbrella installation.
    - Added `plans/README.md`, indexing all 67 immutable numbered records through Plan 066. A docs test prevents index drift; historical plan bodies were not rewritten.
    - Follow-up profile review adds AI SDK interoperability to `prism-providers` and evals, memory, RAG, server, and supervisor directly to `prism-all` (AI SDK arrives transitively). Base/code/SDK remain unchanged; package installation remains inert and direct installs remain available. Exact dependency/transitive-completeness tests and final `sdk:ready` pass: 1,618 tests / 1,593 pass / 25 skipped / 0 fail; all 30 packs successful.
    - Direct-runtime import scan found no dead dependency; every workspace is free of postinstall scripts. No dead public export was identified by packed export/import and docs contract gates.
    - Replaced newly touched boundary-test `any` casts with typed public-kernel/runtime behavior. Retained artifact/source absence and documentation text checks where text is the contract. No large-file split: contracts/agent/workflow state is highly coupled and a release-time move would add churn without deletion.
    - Focused docs, changelog, plan-index, package metadata, public export, inert-extension, and profile/pack tests pass: 255 tests, 0 failures.

- [x] Extend packed integration and artifact/supply-chain release gates
  - Acceptance Criteria:
    - Functional: a fresh tarball consumer imports every package and composes streaming result, AI SDK fake adapter, eval, memory/RAG, durable workflow approval/schedule/replay, server/MCP, feedback, and supervisor/A2A without workspace-relative paths or live credentials.
    - Performance: packed journey is bounded, offline, deterministic, and keeps total network-free suite under approved budget.
    - Code Quality: extend the existing one-file install smoke and data-driven package list rather than creating a second harness.
    - Security: scan source/docs/examples/templates/generated project/tarballs/installed packages and integration output for real-looking tokens/private keys/canaries; audit licenses/install scripts and retain checksum/provenance argument coverage.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/install-smoke.test.ts`, `packaging.test.ts`, `release.test.ts`, `cli-init.test.ts`, and public examples from Phases 3-13.
    - Options Considered:
      - One mega realistic hosted app: rejected; too slow and brittle.
      - Small deterministic assertions per public seam in existing packed consumer: chosen.
    - Chosen Approach:
      - Add one packed Phase 1-13 composition script and one stdlib artifact secret scanner/checksum gate; keep provider/A2A network local/in-memory.
    - API Notes and Examples:
      ```ts
      const result = await session.run("offline");
      assert.equal(result.status, "succeeded");
      ```
    - Files to Create/Edit:
      - `src/__tests__/install-smoke.test.ts`, `src/__tests__/packaging.test.ts`, `src/__tests__/release.test.ts` only where existing coverage has a measured gap.
      - `.github/workflows/release.yml` only if artifact retention/gate ordering is incomplete.
  - Test Cases to Write:
    - Fresh packed Phase 1-13 public-import journey; generated scaffold install/test; tarball and output secret/canary scan; exact checksums and provenance/public/latest arguments.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; release validation only.
    - Docs pages to create/edit: `docs/release-and-install.md`, `docs/performance.md` for exact gates/results.
    - `docs/index.md` update: no new page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-16):
    - Extended the existing fresh-consumer install smoke rather than adding a harness. It packs/installs all 30 packages, imports every root subpath and code package, then composes result streaming, fake AI SDK V4, eval+feedback linkage, working/semantic memory, RAG, durable suspend/resume, schedule/coordinator/replay, Web handler, in-process MCP, supervisor, and in-process A2A solely through installed public specifiers.
    - Existing validator/parallel local+MCP/coding-approval journey remains intact. Generated `prism init` still packs core, installs it into a new project, typechecks, runs its offline test, and enforces the 50 MiB install ceiling.
    - Installed Prism package contents are scanned for private-key blocks and common OpenAI/npm/GitHub token shapes; denied tests/maps/source/plans/internal artifacts remain absent; integration canary remains absent from persisted entries and output. Existing focused suites cover redacted databases/checkpoints/events and source/docs/example/template synthetic-secret policy.
    - CI already creates SHA-256 checksums for every tarball, retains pack manifests/artifacts, and gates provenance-enabled public/latest publication after SDK, Node 20, and PostgreSQL jobs. Release tests pin deterministic order, collisions, resume fingerprints, incremental reports, and explicit `--provenance --access public --tag latest` arguments.
    - Focused packed install has 6 checks, all pass in ~8.0 seconds including 30 packs and fresh install; no live credential or network endpoint is used.

- [x] Run compatibility, persistence, registry, and publication dry-run matrix
  - Acceptance Criteria:
    - Functional: build/typecheck/tests/examples/generated project/packs/fresh imports pass on supported Node paths; PostgreSQL session+memory suite passes; registry reports all 0.0.5 package names available; dependency-ordered publish dry-run completes without publishing.
    - Performance: default `npm test` remains under 60 seconds and measured SDK/pack/runtime/tarball sizes are recorded.
    - Code Quality: `git diff --check`, strict TypeScript scans, `npm ls --all`, release report/order, and docs checks pass.
    - Security: `npm audit --audit-level=high` has zero high/critical findings; live credential/provider/A2A checks remain optional and are not falsely reported as run; no secret appears in logs/artifacts.
  - Approach:
    - Documentation Reviewed:
      - Release workflow, `scripts/release.mjs`, npm registry/publish behavior used by the existing tested CLI.
    - Options Considered:
      - Create/push tag or real publish: rejected; user requested completion/validation, not immutable publication.
      - Dirty/untagged registry check and provenance-enabled npm dry-run: chosen for working-tree execution; clean signed tag remains release-operator gate.
    - Chosen Approach:
      - Run all local/live-available gates, retain JSON reports/checksums in ignored temporary release artifacts, and record unavailable credential-gated checks honestly.
    - API Notes and Examples:
      ```bash
      npm run sdk:ready
      npm run test:postgres
      npm run release:check -- --version 0.0.5 --allow-dirty --allow-untagged
      npm run release:publish -- --version 0.0.5 --dry-run --allow-dirty --allow-untagged
      ```
    - Files to Create/Edit:
      - `docs/performance.md`, `docs/release-and-install.md`, `docs/review-coverage-2026-07-15.md`, release artifacts outside tracked source.
  - Test Cases to Write:
    - No new test if existing gates pass; fix only root causes exposed by matrix.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; verification evidence only.
    - Docs pages to create/edit: performance/release/review coverage evidence pages listed above.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion Evidence (2026-07-16):
    - Node 24.18.0: `npm test` 32.247 s; `npm run sdk:ready` 70.560 s; 1,618 tests / 1,593 pass / 25 explicit live skips / 0 fail; all 30 pack dry-runs pass. Default test remains below 60 seconds; SDK remains below 5-minute CI backstop.
    - Node 20.20.2 imported all 44 built root/package export targets. Core declares Node >=20 and has zero runtime dependencies.
    - Fresh `pgvector/pgvector:pg16`: PostgreSQL package 16 checks and memory/pgvector package 13 checks pass; 29 total, 0 fail/skip.
    - `npm audit --audit-level=high`: zero vulnerabilities at every severity. `npm ls --all`: clean. Runtime direct-dependency scan found no dead edge; `npm outdated` reports only deliberately deferred majors (`diff` 9, TypeScript 7, Node types 26).
    - Live npm registry preflight reports all 30 exact 0.0.5 versions available. Dependency-ordered provenance/public/latest publish dry-run completes 30/30; JSON preflight and publish reports retained under `/tmp/prism-p14-release`. No package was published.
    - 30 generated tarballs total 689,687 packed / 2,636,449 unpacked bytes / 699 files. Core is 402,985 / 1,456,420 bytes / 221 files. All SHA-256 checksums re-verify; extracted artifacts have zero private-key/OpenAI/npm/GitHub-token matches.
    - CycloneDX 1.5 SBOM has 181 components; observed licenses are MIT/ISC/BSD/Apache-compatible, none prohibited. `better-sqlite3` is the only install-script package and remains isolated in explicit SQLite installs.
    - Production TypeScript scan has no `any` cast, ts-ignore/expect directive, or empty catch. `git diff --check` passes. Provider/keychain/external-A2A live smokes were not run because no credentials/endpoints were configured; offline conformance remains authoritative.

- [x] Finalize Phase 14 roadmap, checklist, and plan evidence
  - Acceptance Criteria:
    - Functional: Phase 14 and every release checklist item proven locally are checked; publication-only items remain explicitly pending until clean signed tag/workflow completion.
    - Performance: final counts, durations, package sizes, and compromises are recorded.
    - Code Quality: plan tasks/checklists/evidence agree; historical plan bodies remain unchanged; no release blocker remains hidden.
    - Security: release verdict distinguishes offline authority, live PostgreSQL result, unavailable credentialed smokes, registry availability, and actual-publication state.
  - Approach:
    - Documentation Reviewed:
      - Final command logs and all Phase 0-14 evidence.
    - Options Considered:
      - Mark npm publication complete: rejected because no real publish/tag is requested or safe inside this working session.
      - Mark release candidate validation complete with publication handoff pending: chosen.
    - Chosen Approach:
      - Update roadmap, review matrix, release docs, and this plan after every applicable check passes.
    - API Notes and Examples:
      ```bash
      git diff --check
      ```
    - Files to Create/Edit:
      - `roadmap.md`, `plans/066-maintainability-documentation-packaging-and-0-0-5-release.md`, `docs/review-coverage-2026-07-15.md`.
  - Test Cases to Write:
    - Final docs/plan/checklist consistency checks.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no; status/evidence only.
    - Docs pages to create/edit: `docs/review-coverage-2026-07-15.md`, release/performance pages.
    - `docs/index.md` update: no unless final audit finds navigation drift.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

  - Completion Evidence (2026-07-16):
    - Roadmap Phase 14 is checked with exact implementation, test, timing, artifact, security, PostgreSQL, registry, and publication-dry-run evidence. All locally provable release checklist items are checked.
    - Three immutable-publication items remain unchecked by design: clean exact tag preflight, retained real publication artifacts/report, and npm `latest` after actual publish. Handoff commands and operator prerequisites are explicit in `docs/release-and-install.md`.
    - `docs/review-coverage-2026-07-15.md` marks Phases 1-14 implementation complete and publication pending; R-001/A-004/A-005/profile evidence now reflects actual 30-package state and measured deferrals.
    - Final verdict is GO after clean protected CI and signed-tag publication. No release blocker is hidden as completed, no tag was created, and no package was published.

## Compromises Made
- Release completion is a validated 0.0.5 release candidate plus deterministic handoff, not real publication. Clean signed tag, OIDC attestation, npm `latest`, and post-publish integrity cannot be truthfully completed in a dirty implementation session.
- `prism-all` now accepts kitchen-sink install cost and includes every first-party package; `prism-providers` includes all seven adapters. Focused base/code/SDK profiles stay minimal, and package installation activates nothing.
- Large shared files remain unsplit. `contracts.ts`, `agents.ts`, and workflow `run.ts` are genuine hotspots, but completed changes remain cross-cutting state/public-contract logic and did not reveal a deletion-producing cohesive split.
- Historical source-text tests remain where they enforce docs, manifest, absence, or frozen compatibility contracts. Only touched runtime assertions were converted; wholesale test churn would add release risk without behavior.
- Provider/keychain/external-A2A live smokes were unavailable. Offline conformance and live PostgreSQL/pgvector passed; docs do not claim unavailable checks ran.
- Secret scan is stdlib pattern/canary based, supplemented by focused redaction and artifact allow/deny tests. No new compliance dependency was added.

## Further Actions
- Priority high: release operator merges protected CI, verifies npm auth/OIDC, signs and pushes `v0.0.5`, retains workflow artifacts/report, and verifies all 30 versions, `latest`, integrity, and attestations.
- Priority medium: run official A2A conformance and credentialed provider/keychain/external endpoint smokes when deployment credentials exist.
- Priority medium: perform dedicated compatibility-preserving splits of contracts/agent/workflow hotspots only when ownership boundaries can reduce conflicts or code.
- Priority medium: replace remaining implementation-source assertions opportunistically when their owning APIs change.
- Priority low: use adoption data for future profile decisions; do not add another profile family without repeated co-install demand.
- Priority low: add a dedicated secret/license policy tool only if external compliance requires more than current npm/SBOM/stdlib gates.
