# Release 0.2.4 — Package, Documentation, and Compatibility Truth

Roadmap phase: `roadmap.md` § **0.2.4 — Package, documentation, and compatibility truth**.
Baseline: `@arnilo/prism` **0.2.3** (plan 023 complete; 50-package publish graph = root + 49 workspace — 14 provider + 9 `prism-*` + 26 capability; `npm test` exit 0 — 3495 tests / 3462 pass / 33 protected-live skips / 0 fail; `security:threat-suites` 50/50; `test:postgres` 91/91; core coverage 90.49% lines; `exitGate.green: true` in `scripts/phase23-baseline.json`; Biome zero diagnostics; Node 20 packed imports 24/24; 43 code packages pin exact `@arnilo/prism: 0.2.3` peers (6 also pin a second `@arnilo/prism-*` peer: ag-ui, coding-agent, coding-security, document-reader, rag, server; 6 pure-manifest packages have no peer: prism-all, prism-base, prism-code, prism-compaction, prism-providers, prism-sdk); no 0.2.4-specific mandatory regression matrix item — the 12-item matrix is closed across 0.2.0–0.2.3).
Target: `@arnilo/prism` **0.2.4**. Behavior changes are documentation, manifest-description, peer-version-policy, and docs-test tooling only. No public runtime contract change is planned; no published package export is added or removed; no package is added to or removed from the publish graph. The migration is contributor/docs/consumer-policy-facing (truthful umbrella wording, generated tables, peer-version decision, structural docs tests).

Scope items (mapped one-to-one to the four roadmap 0.2.4 bullets):

1. Make package claims match manifests: correct README/profile/umbrella wording for `prism-providers` and `prism-all`; explicitly list current omissions (`document-reader`, `openapi-tools`, `session-store-nats`, Caveman, Ponytail) without changing umbrella membership in 0.2.x. Actual catalog/membership expansion stays deferred to 0.3.0.
2. Generate package/version/profile tables: use manifests as the single source for package count, provider membership, version, profile closure, and release status; refresh `docs/0.1.0-readiness.md`, `docs/index.md`, `docs/release-and-install.md`, root/package READMEs, roadmap completion status, and changelogs; eliminate stale 0.1.1/0.0.23 "current line" text and contradictory provider counts.
3. Define peer-version policy: decide whether exact `@arnilo/prism: <current>` peers remain required until compatibility stabilizes or move to a tested compatible range; document atomic-upgrade expectations and verify mixed supported patches in packed installs.
4. Keep docs semantic, not phrase-only: add structural tests for generated navigation/package data and remove stray/truncated roadmap text; do not add brittle prose snapshots.

## Objectives

- Close the four confirmed package/docs/compatibility-truth defects without adding a runtime dependency, a published package, a background service, a second runtime, or a generic docs-site framework beyond the existing `scripts/` release tooling, the `docs.test.ts` semantic-test harness, and the `scripts/compat-baseline` shape.
- Make package manifests the single source of truth for every published claim: a dependency-closure check must prove or refute any "all"/"every"/"family"/"profile"/"umbrella" wording, and a generated table must replace hand-maintained counts so drift is mechanically impossible rather than policed by prose snapshots.
- Preserve all normal single-process behavior: `npm run build`, `npm run clean`, `npm test`, `npm run test:coverage`, `npm run typecheck`, `npm run sdk:ready`, `npm run lint`/`format`, `npm run release:gate`, `test:postgres`, and `security:threat-suites` keep their current happy paths and exit codes; only the named false claims, stale version/count literals, peer-version policy, and docs-test structure change.
- Keep every truth assertion bounded, machine-readable, and fail closed before the release green: a README/manifest description or docs table that overstates closure (claims a package the manifest does not depend on) fails the gate; a generated table that drifts from the manifests fails the gate; a peer-version mixture outside the documented supported range fails clearly in a packed install.
- Publish explicit migration guidance for consumers and contributors: the umbrella-wording correction (no behavior change), the generated-table single-source rule, the peer-version policy decision (exact vs range with atomic-upgrade expectations), and the structural docs-test replacement of prose snapshots.
- Record machine-checkable baseline, threat model, compatibility, package-budget, protected-matrix, and release evidence; satisfy the roadmap 0.2.4 acceptance criteria (no page claims "every"/"all" unless closure proves it; packed-install tests assert documented contents; generated checks catch drift; stale current-line text gone; docs tests fail on wrong package closure/version/navigation while permitting editorial changes).

## Non-goals

- No security-blocker work from 0.2.0, no provider/network trust work from 0.2.1, no state-concurrency work from 0.2.2, no build/coverage/release-evidence work from 0.2.3, no refactoring from 0.2.5, no coding-agent readiness from 0.2.6, no ERP readiness from 0.2.7.
- No change to umbrella membership in 0.2.x: `prism-providers` stays 11 provider deps (omits Azure/Bedrock/Vertex); `prism-all` stays its current dep set (omits document-reader, openapi-tools, session-store-nats, Caveman, Ponytail, and the rest computed from manifests). Actual membership expansion is 0.3.0 (`roadmap.md` §0.3.0 "Umbrella membership fix"). 0.2.4 only makes the existing membership *honest*.
- No new model provider, delegated agent, enterprise adapter, forge, object store, policy engine, live-canary, package, export subpath, or runtime capability. The publish graph stays 50 packages; no manifest gains or loses a runtime export.
- No generic docs-site generator, no static-site framework, no Markdown AST dependency, no external table library. The generator is a dependency-free `scripts/` helper reading `package.json` manifests with stdlib JSON; structural tests reuse the existing `docs.test.ts` harness and `node:test`.
- No change to `ProviderEvent`, `AgentEvent`, `RunRecord`, `SessionRecord`, `CheckpointRecord`, peer-dependency *names*, `engines.node`, `publishConfig`, `files`, or any runtime contract. Peer *version specifiers* may change (exact → range) only if Task 0 decides a range is supported; the peer *name* `@arnilo/prism` and the dev `file:../..` link stay.
- No removal of `npm run clean`, `npm run build`, `npm test`, the core coverage gate, the `phase*-freeze.test.mjs` legs, the `compat-baseline` gate, or any existing script. The generator and truth tests are additive `scripts/`-only and `docs.test.ts`-only artifacts.
- No assumption that docs prose is ever the source of truth: every package/version/profile claim must be derivable from manifests; prose snapshots are replaced by closure/derivation asserts, not by tighter string equality.
- No brittle per-paragraph docs snapshot added anywhere; structural tests assert *derived values* (closure, count, version, navigation shape), never verbatim prose.
- No new code-wiki task: `.agents/skills/project-wiki/` does not exist (same as 0.2.0–0.2.3).

## Expected Outcome

- A dependency-free package-truth generator (`scripts/package-truth.mjs`) reads every workspace manifest plus the root manifest and emits `scripts/package-truth.json` recording: total publishable count, root name/version, per-package name/version/peer spec/`engines.node`/`publishConfig.access`/`files` summary, the 14-provider membership list, the `prism-providers` closure (11 deps + 3 omitted cloud providers named), the `prism-all` closure (its dep set + the computed omission set), the 9 `prism-*` family/profile packages, the 26 capability packages, and each profile's transitive closure. The generator is the single source for `docs/release-and-install.md` counts and tables; the JSON artifact is tarball-excluded (`scripts/`) and CI-retained.
- `docs/release-and-install.md` is corrected and regenerated against the manifest truth: the canonical count statement reads **50 publishable manifests = root + 49 workspace (14 provider + 9 `prism-*` + 26 capability)** with the "Regenerate the counts" hint replaced by "Generated by `node scripts/package-truth.mjs`"; the stale `@arnilo/prism@0.1.0` peer literal (line 7) and the `arnilo-prism-...-0.1.0.tgz` tarball-name literals (line 97) advance to the current version (or to the documented peer-version spec from Task 3); the stale "All 49 manifests (root + 48 workspace: 42 code + 6 family/profile)" line (line 699) advances to 50/49 with the correct 9 family/profile and the capability count; the `prism-providers`/`prism-all` install-profile rows name the *actual* closure and the explicit omissions rather than "all"/"every".
- `README.md` package table rows for `@arnilo/prism-providers` and `@arnilo/prism-all` (lines 180 and 185) stop claiming "all 14" / "every first-party package"; they state the true closure (11 of 14 providers; the cloud adapters Azure/Bedrock/Vertex are added separately by `prism-all`; `prism-all` omits document-reader, openapi-tools, session-store-nats, Caveman, and Ponytail — full omission set generated). `packages/prism-providers/package.json` and `packages/prism-all/package.json` `description` fields stop claiming "all"/"every" and state the true membership; package READMEs (`packages/prism-providers/README.md`, `packages/prism-all/README.md`) match.
- `docs/0.1.0-readiness.md` "Current line" table is refreshed from the stale 0.1.1 freeze (status line 3, `## Current line (0.1.1)` heading line 23, "49 publishable manifests at exact 0.1.1" row line 27) to the actual current line **0.2.4** with the 50-manifest graph, the current version, the current compat promise, and the 0.1.7 terminal-baseline note for the completed 0.1.x line; the page keeps its 0.1.0 historical sections below as immutable record. The stale 0.0.23 "47 manifests" reference (line 566 in `docs/release-and-install.md`) stays as *historical per-release* record (it is inside the 0.0.23 release block, not a current-line claim) and is not touched except where a structural test flags it as a current-line contradiction.
- A peer-version policy is decided (Task 0 ratified **Decision A**) and documented in `docs/release-and-install.md` and `docs/migration.md`: exact `@arnilo/prism: <current>` peers remain required through 0.2.x until compatibility stabilizes (the range widens to `^1.0.0` at the 1.x stable release — the pre-existing documented policy, literal refreshed), with the atomic-upgrade rule (all `@arnilo/prism-*` packages must move together at the same version; partial upgrades are unsupported) and a clear unsupported-mixture refusal (npm ERESOLVE). The decision, the exact pin, the atomic-upgrade expectation, and the unsupported-mixture behavior are recorded in Task 0 and asserted by a packed-install test (mismatched exact pins fail clearly; matched set installs cleanly). The scripted bump updates the version literal in all 43 code-package peer specifiers consistently.
- `src/__tests__/docs.test.ts` gains structural truth tests that derive expected values from `scripts/package-truth.json` (or directly from manifests) rather than hardcoding prose: the canonical count, the provider membership, the `prism-providers`/`prism-all` closures + omissions, the profile closures, the current-line version in `docs/index.md`/`docs/0.1.0-readiness.md`, and the navigation shape (one index link per docs page — already present) are asserted against manifest-derived truth. The existing "canonical manifest-count narrative: one statement, no stale counts" test (line 243) is kept and strengthened to assert the generated count equals the manifest count. Stray/truncated roadmap text is removed (grep `roadmap.md` and `docs/**` for truncation markers, dangling section fragments, and leftover 0.0.x/0.1.x "current line" claims that contradict the generated truth). No brittle prose snapshot is added; editorial wording changes remain permitted.
- Direct source tests, built public-import tests, and a fresh packed plain-JavaScript consumer prove the truth fixes without relying on TypeScript: the packed consumer asserts the documented package contents (umbrella closures, provider membership, profile closure) match the installed tarballs, and that a peer-version mixture outside the documented supported range fails clearly (or installs cleanly when inside the range, per Task 0).
- 0.2.4 exits with 50 packages, zero new runtime dependencies, zero unexplained lint diagnostics, standard budgets green, no docs page claiming "all"/"every" without closure proof, every count/version/navigation value manifest-derived, and an operator-ready signed-tag/OIDC handoff.

## Operational Ownership

- **Release and package/docs-truth owner:** Prism maintainer/operator `arn`; owns scope amendments, threat acceptance, compatibility review, the peer-version policy decision, protected evidence, signed `v0.2.4` tag, and npm OIDC publication.
- **Package-truth generator owner:** `scripts/` maintainer; owns `scripts/package-truth.mjs`, the `scripts/package-truth.json` artifact shape, the manifest-reading/closure-computation logic, and the single-source regeneration procedure; coordinates with workspace package maintainers whose manifest `description`/`dependencies` are corrected.
- **Umbrella-wording owner:** root `README.md` + `packages/prism-providers` + `packages/prism-all` maintainer; owns the README table rows, the two umbrella `package.json` `description` fields, and the two umbrella package READMEs; coordinates with the generator owner so wording matches the generated closure.
- **Docs-truth owner:** `docs/release-and-install.md` + `docs/0.1.0-readiness.md` + `docs/index.md` + `CHANGELOG.md` maintainer; owns the regenerated counts/tables, the current-line refresh, the peer-version policy section, and the changelog entry; coordinates with the generator owner.
- **Peer-version policy owner:** `scripts/release.mjs` + root `package.json` maintainer; owns the ratified Decision A (exact pins), the atomic-upgrade rule, the scripted peer-spec update across the 43 code packages, and the packed-install mixture verification.
- **Docs-test owner:** `src/__tests__/docs.test.ts` maintainer; owns the structural truth tests, the stray/truncated-text removal grep, and the no-brittle-snapshot rule; coordinates with the generator owner on the asserted JSON shape.
- **CI evidence owner:** release workflow maintainer; the generated `scripts/package-truth.json` and the truth-test results are retained as release artifacts; a docs claim that contradicts the generated truth blocks the 0.2.4 gate rather than shipping.

## Migration Impact

- **Umbrella-wording correction (no runtime migration):** `prism-providers` and `prism-all` package `description` fields and README/docs wording change from over-broad "all"/"every" to the true closure with named omissions. No dependency is added or removed; no install resolution changes; a host that already installs `@arnilo/prism-providers` still gets the same 11 providers. The migration is documentation-only: hosts who relied on the *wording* (not the manifest) to assume Azure/Bedrock/Vertex were in `prism-providers` are corrected — they must install `@arnilo/prism-all` or the three cloud providers directly (which is already the documented behavior in `docs/release-and-install.md:20` "includes all eleven"). Rollback: restoring the 0.2.3 wording restores the false claims — not a mitigation; the truth fix is the remediation.
- **Generated tables (contributor-facing, no runtime migration):** counts and tables in `docs/release-and-install.md`, `docs/0.1.0-readiness.md`, `docs/index.md`, and root/package READMEs are regenerated from manifests. The canonical count advances 49→50 where it was stale (the 0.1.1 current-line block) and stays 50 where it was already correct. No persisted state change; no checkpoint/session/router shape change. Rollback: restoring 0.2.3 restores the stale 0.1.1 current-line text and the hand-maintained counts.
- **Peer-version policy (consumer-facing):** Task 0 ratified **Decision A** (exact pins remain through 0.2.x); the 43 code-package peer specifiers stay `@arnilo/prism: 0.2.4` after the scripted bump — no consumer migration, only the policy is *documented* (the pre-existing "pinned for the current 0.x release, widen to `^1.0.0` at 1.x" policy, stale 0.0.28 literal refreshed). `docs/migration.md` gains a `0.2.3 → 0.2.4` note (version literal + peer-policy decision; the compat gate requires the migration.md mention for any changed delta; here the delta is the version literal only). Rollback: restoring 0.2.3 manifests restores the prior literals.
- **Structural docs tests (contributor-facing):** `docs.test.ts` truth tests assert manifest-derived values; editorial docs edits remain permitted (no prose snapshot). A future docs edit that restates a wrong count/provider-membership fails the gate — the intended behavior. Rollback: restoring 0.2.3 removes the truth tests and the false-claim gate.
- **No runtime consumer migration beyond the peer spec:** 0.2.4 ships no `docs/migration.md` *runtime* section (no runtime contract delta); the migration.md entry is the version note + the ratified Decision A policy (no peer-spec change). Runtime behavior, persisted shapes, exports, and events are unchanged.

## Package and Performance Budget

- Publish graph remains **50 packages**; no package or export subpath is added or removed. All new artifacts (`scripts/package-truth.mjs`, `scripts/package-truth.json`, `scripts/phase24-*.test.mjs`) live under `scripts/` and are excluded from every tarball (existing `scripts/**` exclude in `files`/coverage and the release pack allow-list). The two umbrella `package.json` `description` edits and README edits change only metadata text, not `dependencies`/`files`/`exports`.
- Runtime dependencies remain unchanged: core stays dependency-free; the generator uses only `node:fs`/`node:path`/stdlib JSON; the truth tests use `node:test`/`node:assert`/`node:fs`. No Markdown AST library, no static-site generator, no table-rendering dependency.
- Root and affected package packed/unpacked/file-count growth must remain within `scripts/budgets.json` tolerance. The only expected packed delta is the `description` string length change in two umbrella manifests (a few bytes) and README text — within the existing 5% tolerance; re-baselined only if measured outside it, with a dated `$comment` per the recorded release convention.
- Generator: O(manifests) = O(50) JSON reads + one closure computation (transitive `dependencies` walk over the `@arnilo/prism-*` subgraph, bounded by the 50-package graph); no network; no test run; sub-second. Truth tests: O(1) JSON load + O(docs files) grep; no extra test run beyond the existing `npm test` docs leg.
- Peer-version change (Decision A): zero runtime cost; the scripted bump rewrites the version literal in 43 peer specifiers and regenerates the lockfile (`npm install --package-lock-only`); packed-install verification is one extra `npm install` in the existing install-smoke lifecycle.
- Structural docs tests and packed truth conformance are test-only; no runtime cost.

## Tasks

- [x] Task 0 — Primitive review, truth-drift inventory, threat model, ownership, migration, peer-version decision, and budget decisions
  - Acceptance Criteria:
    - Functional: create `docs/_evidence/phase24-primitive-review.md` before any source/docs/manifest edit, inventorying existing primitives: the publish graph in root `package.json` `workspaces` (24 glob entries expanding to 49 workspace packages); every workspace `package.json` (`name`/`version`/`description`/`dependencies`/`peerDependencies`/`devDependencies`/`engines`/`publishConfig`/`files`/`exports`); the two umbrella manifests `packages/prism-providers/package.json` (11 provider deps: ai-sdk, alibaba, anthropic, google, kimi, neuralwatt, ollama, openai, opencode-go, openrouter, zai — omits azure, bedrock, vertex) and `packages/prism-all/package.json` (20 deps incl. the 3 cloud providers; omits document-reader, openapi-tools, session-store-nats, prism-caveman, prism-ponytail, and the rest computed in Task 2); the 9 `prism-*` family/profile packages (prism-all, prism-base, prism-caveman, prism-code, prism-compaction, prism-openapi-tools, prism-ponytail, prism-providers, prism-sdk); the 14 `provider-*` packages; the 43 code packages pinning exact `@arnilo/prism: 0.2.3` peers (with 6 also pinning a second `@arnilo/prism-*` peer: ag-ui → mcp+supervisor, coding-agent → workflows, coding-security → coding-agent, document-reader → coding-agent, rag → memory, server → workflows; prism-ponytail additionally peers external `@dietrichgebert/ponytail ^4.8.4`); the 6 pure-manifest peerless packages (prism-all, prism-base, prism-code, prism-compaction, prism-providers, prism-sdk); the `scripts/release.mjs` `bump`/`gate`/`check` commands and `scripts/release-gates.mjs` (compat baseline, tarball allow/deny); the existing `src/__tests__/docs.test.ts` harness (the "canonical manifest-count narrative: one statement, no stale counts" test at line 243, the per-plan freeze tripwires, the `index links point to existing local markdown files` test at line 141, the `docs index contains exactly one navigation link per documentation page` test at line 214); the canonical count statement in `docs/release-and-install.md:5` (currently correct: 50/49/14/9/26) and the stale literals at lines 7 (`@arnilo/prism@0.1.0` peer), 20 (correct "eleven"), 97 (`0.1.0.tgz` tarball names), 699 ("49 manifests/48 workspace/42 code/6 family"), 566 (historical 0.0.23 "47 manifests"); the stale `docs/0.1.0-readiness.md` current-line block (lines 3, 23, 27 frozen at 0.1.1); `README.md:180` ("all 14") and `README.md:185` ("every first-party package"); the roadmap §0.2.4 bullets and the §0.3.0 "Umbrella membership fix" deferral; and `docs/migration.md` / `CHANGELOG.md` / `docs/index.md` consumer-facing surfaces.
    - Functional: document what can be fixed with those primitives and approve only the minimum reusable gaps: (a) one dependency-free package-truth generator reading manifests and emitting `scripts/package-truth.json` (approved because the counts are currently hand-maintained with only a "Regenerate the counts" hint — a generator is the minimum to make drift mechanically impossible, no static-site framework); (b) one structural truth-test block in `docs.test.ts` asserting manifest-derived values (approved because `docs.test.ts` already runs docs semantic tests and `node:test` is built in — adding closure/derivation asserts is the minimum, no prose-snapshot library); (c) one peer-version policy decision recorded with its atomic-upgrade rule and packed-install verification (approved because the 44 peer specifiers are already uniform exact pins — deciding exact-vs-range and documenting it is the minimum, no new dependency-resolution layer). Reject a docs-site generator, a Markdown AST dependency, a table-rendering library, a second publish graph, an umbrella membership change, or a new published package.
    - Functional: peer-version policy **decided (Decision A — exact pins)** and recorded: exact `@arnilo/prism: <current>` peers remain required through 0.2.x until compatibility stabilizes (stabilization criterion: "1.0 readiness gates operator-green on the 0.2.x line"; the range widens to `^1.0.0` at the 1.x stable release — the pre-existing documented policy, stale 0.0.28 literal refreshed); the atomic-upgrade rule (all `@arnilo/prism-*` packages move at the same version; partial upgrades are unsupported and fail clearly); the unsupported-mixture behavior (npm ERESOLVE peer conflict, documented). Decision B (tested compatible range) was considered and **rejected**: compatibility has not stabilized (0.2.x IS the stabilization line), a range can hide a real incompatibility, and the roadmap's "mixed supported patches" acceptance is met by proving the refusal plus the matched-set clean install. Fallback if Decision A proves to break real consumers: revisit at the 1.0 transition, where `^1.0.0` is the planned widening.
    - Functional: decide the umbrella-wording correction scope: for `prism-providers`, the true statement is "11 of 14 first-party provider adapters (omits Azure, Bedrock, Vertex, which `prism-all` adds separately)"; for `prism-all`, the true statement names the closure and the explicit omission set generated in Task 2 (the roadmap names document-reader, openapi-tools, session-store-nats, Caveman, Ponytail; the full set is manifest-derived). Record that 0.2.4 changes *wording only*; membership expansion is 0.3.0.
    - Functional: decide the current-line refresh target for `docs/0.1.0-readiness.md`: the "Current line" table advances to **0.2.4** (the actual current release) with the 50-manifest graph; the 0.1.7 release is recorded as the terminal baseline of the completed 0.1.x line; the page's 0.1.0 historical sections stay as immutable record. Record that the 0.0.23 "47 manifests" reference at `docs/release-and-install.md:566` is *historical per-release* record (inside the 0.0.23 release block) and is not a current-line claim — it is touched only if a structural test flags it as a current-line contradiction.
    - Functional: decide the stray/truncated-text removal scope: grep `roadmap.md` and `docs/**` for truncation markers (`...` mid-sentence, `TODO`/`XXX`/`FIXME`, dangling heading fragments, leftover 0.0.x/0.1.x "current line" claims that contradict generated truth); record each find and whether it is removed or retained-as-historical. Record the no-brittle-snapshot rule: structural tests assert derived values, never verbatim prose.
    - Functional: record threat actors, assets, entry points, trust boundaries, and mitigations for at least: false umbrella closure (a host installs `prism-providers` expecting Azure/Bedrock/Vertex and silently gets 11 — supply-chain trust defect; the 2026-08-12 review named this), stale current-line version (a consumer reads "current line 0.1.1" and pins to a stale version — upgrade-guidance defect), hand-maintained count drift (a future package add updates manifests but not the docs count — silent contradiction), peer-version mixture false-green (a host mixes `@arnilo/prism: 0.2.3` with `@arnilo/prism-coding-agent: 0.2.4` and gets silent incompatibility — under ratified Decision A this must fail clearly at install with ERESOLVE), generated-truth artifact tampering (a hand-edit to `package-truth.json` makes docs match a false claim — mitigated by regenerating in CI and asserting generator output equals artifact), and brittle prose snapshot false-green (a docs test hardcodes a count string that drifts from manifests — mitigated by derivation asserts). The full eight-threat table (T1–T8) with actors, assets, entry points, trust boundaries, mitigations, and test mapping is recorded in the Task 0 evidence document (§4).
    - Functional: map every threat to a concrete test in Tasks 1–5 and record the operational owner, migration decision, rollback posture, package budget, and protected environment for each item.
    - Performance: record baseline docs-test/generator wall times and proposed changes; stay within the Package and Performance Budget above.
    - Code Quality: reject a docs-site generator, a Markdown AST dependency, a table library, a second publish graph, an umbrella membership change, or new interfaces with a single consumer; retain existing script boundaries, the deny-by-default release posture, and the dependency-free core.
    - Security: explicitly decide that the truth tests are fail-closed (a docs claim that contradicts manifest-derived truth blocks the gate, never proceeds), the generator is reproducible (same manifests → same JSON, asserted byte-identical across runs), the peer-version policy is fail-closed on unsupported mixtures (ratified Decision A: ERESOLVE refusal for mismatched exact pins), and no fix weakens an existing ownership/redaction/secret-scan/compat-baseline control. Record all decisions in the evidence document.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` §0.2.4 (four bullets), §0.3.0 "Umbrella membership fix" deferral, release validation checklist, release order.
      - `.agents/skills/create-plan/SKILL.md` primitive-review requirement and `references/prism-wiki.md` documentation requirements.
      - Root `package.json` `workspaces`; all 49 workspace `package.json` files (closure of `prism-providers` and `prism-all`); `scripts/release.mjs` (`bump`/`gate`/`check`); `scripts/release-gates.mjs` (compat baseline, tarball allow/deny); `src/__tests__/docs.test.ts` (semantic-test harness, line 243 count test, line 141/214 navigation tests, per-plan freeze tripwires).
      - `docs/release-and-install.md` (lines 5, 7, 20, 35–38, 97, 182, 216, 566, 699, 800, 890); `docs/0.1.0-readiness.md` (lines 3, 23, 27, 35); `docs/index.md` (current-line entry); `docs/migration.md`; `CHANGELOG.md`; `README.md` (lines 180, 185); `packages/prism-providers/README.md`; `packages/prism-all/README.md`.
      - `plans/023` Task 0/6 primitive-review/bump/exit-gate precedent; `plans/020`–`022` threat-model precedent.
      - npm docs: peer-dependency resolution semantics (ERESOLVE), `~`/`>=` range specifiers, `npm install --package-lock-only`, packed-install peer enforcement.
    - Options Considered:
      - Generator: dependency-free manifest reader + JSON artifact (chosen) vs a docs-site generator (rejected — second runtime) vs hand-maintained counts with a lint rule (rejected — drift stays possible) vs extending `release-gates.mjs` only (rejected — no emitted artifact for docs tests to read).
      - Truth tests: manifest-derived asserts in `docs.test.ts` (chosen) vs prose snapshots (rejected — brittle) vs a separate docs-lint package (rejected — new dependency).
      - Peer-version: Decision A (exact pins, documented policy) vs Decision B (tested range) vs `*` (rejected — no compat promise) — chosen in Task 0 and recorded.
      - Umbrella wording: true closure + named omissions (chosen) vs membership expansion (rejected — 0.3.0) vs removing the umbrella rows (rejected — loses install guidance).
      - Current-line refresh: advance to 0.2.4 (chosen) vs freeze at 0.1.7 (rejected — 0.2.x has shipped) vs delete the readiness page (rejected — holds 1.0 gates).
      - Reuse-first review with one threat table and explicit decisions: chosen.
    - Chosen Approach:
      - Write one tarball-excluded evidence document before any docs/manifest/test edit; freeze the peer-version decision, the umbrella-wording statements, the current-line target, the generator JSON shape, and the truth-test assertions in Tasks 1–5.
      - The generator reuses `node:fs`/`node:path` + stdlib JSON; the truth tests reuse the existing `docs.test.ts` + `node:test`; the peer-version change reuses the existing `scripts/release.mjs bump` + `npm install --package-lock-only`; the packed verification reuses the existing `src/__tests__/install-smoke.test.ts` lifecycle.
    - API Notes and Examples:
      ```bash
      # Generate the single-source package truth
      node scripts/package-truth.mjs --out scripts/package-truth.json
      # Peer-version bump (Decision A ratified in Task 0: exact literal bump — no range rewrite)
      node scripts/release.mjs bump --from 0.2.3 --to 0.2.4
      # Structural docs truth tests run inside the existing docs leg
      node --test dist/__tests__/docs.test.js
      ```
      ```jsonc
      // scripts/package-truth.json (sketch — shape frozen in Task 0)
      { "generatedAt": "<iso>", "root": { "name": "@arnilo/prism", "version": "0.2.4" },
        "counts": { "publishable": 50, "workspace": 49, "provider": 14, "prismFamily": 9, "capability": 26 },
        "providers": ["ai-sdk","alibaba","anthropic","azure","bedrock","google","kimi","neuralwatt","ollama","openai","opencode-go","openrouter","vertex","zai"],
        "umbrella": {
          "prism-providers": { "deps": ["...11..."], "omitsProviders": ["azure","bedrock","vertex"] },
          "prism-all": { "deps": ["...20..."], "omits": ["document-reader","openapi-tools","session-store-nats","prism-caveman","prism-ponytail","...rest computed..."] }
        },
        "profiles": { "prism-base": ["...closure..."], "prism-code": ["..."], "prism-sdk": ["..."], "prism-all": ["..."], "prism-providers": ["..."] },
        "peerPolicy": { "decision": "A|B", "spec": "0.2.4 | ~0.2.4 | >=0.2.0 <0.3.0", "atomicUpgrade": true } }
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase24-primitive-review.md`: primitive inventory, truth-drift inventory, peer-version decision, threat model, owner/migration/budget matrix, and test mapping.
      - `plans/024-Release-0-2-4-Package-Documentation-And-Compatibility-Truth.md`: update only if review changes planned approach/files/tests.
    - References:
      - Root `package.json` `workspaces`; the 49 workspace manifests; `scripts/release.mjs`; `scripts/release-gates.mjs`; `src/__tests__/docs.test.ts`; `docs/release-and-install.md`; `docs/0.1.0-readiness.md`; `docs/index.md`; `README.md`; `packages/prism-providers/{package.json,README.md}`; `packages/prism-all/{package.json,README.md}`; `roadmap.md` §0.2.4 + §0.3.0; `plans/023` Task 0/6.
  - Test Cases to Write:
    - primitive inventory: the evidence doc names every primitive in the Acceptance Criteria and rejects a docs-site generator, a Markdown AST dependency, a table library, a second publish graph, an umbrella membership change, or a new published package.
    - truth-drift inventory: every named stale literal (README:180/185, release-and-install:7/97/699, readiness:3/23/27, the two umbrella `description` fields) is listed with its correction.
    - decision freeze: peer-version decision (A or B) with spec + atomic-upgrade rule + unsupported-mixture behavior; umbrella-wording statements for both umbrellas; current-line refresh target (0.2.4); generator JSON shape; truth-test assertion list.
    - threat mapping: every named threat maps to a concrete test in Tasks 1–5.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — Task 0 only produces the tarball-excluded evidence document and freezes decisions; no public API change.
    - Docs pages to create/edit:
      - `docs/_evidence/phase24-primitive-review.md`: primitive inventory, truth-drift inventory, peer-version decision, threat model, owner/migration/budget matrix, test mapping (tarball-excluded).
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable; evidence-only task.
  - **Task 0 EXECUTED (2026-08-14).** Evidence: `docs/_evidence/phase24-primitive-review.md` (tarball-excluded; primitive inventory, drift-inventory table, gap decisions, decision freeze, eight-threat model T1–T8, owner/migration/budget/protected matrix, test mapping, decisions ratified). Ratified: (1) peer-version **Decision A** — exact pins through 0.2.x, `^1.0.0` at 1.x, atomic-upgrade rule, ERESOLVE refusal; (2) umbrella wording — `prism-providers` = "11 of 14" naming Azure/Bedrock/Vertex omissions, `prism-all` = "20 deps / 43 transitive closure" naming document-reader/OpenAPI/NATS/Caveman/Ponytail (the Task 2 generator later proved those 5 are the complete omission set, correcting the Task 0 hand-walk's 31/18 — see §1.2 CORRECTION); membership frozen in 0.2.x, §0.3.0 owns expansion; (3) current-line refresh to 0.2.4 (50 manifests) with 0.1.7 as terminal 0.1.x baseline; historical 0.0.23/0.1.x blocks retained; (4) generator `scripts/package-truth.mjs` → `scripts/package-truth.json` with the frozen artifact shape; CI regeneration asserts equality; (5) structural truth tests derive values from the artifact, never verbatim prose; (6) roadmap §0.2.8 stray notes (background observers/Muse Code/Vent; opencode-go profiles) removed in Task 4; (7) plan-number corrections: **43** code packages with the core peer (not 44), **6** with a second `@arnilo/prism-*` peer (not 4), 6 pure-manifest peerless packages; (8) budget: 50-package graph unchanged, scripts-only artifacts, docs-test leg baseline 4.29 s, no new dependency, protected envs unchanged. All eight ratifications are asserted by the Tasks 1–5 test mapping in the evidence document (§6).

- [x] Task 1 — Make package claims match manifests (umbrella wording, descriptions, READMEs, omissions)
  - Acceptance Criteria:
    - Functional: correct `README.md:180` so the `@arnilo/prism-providers` row no longer claims "all 14 first-party provider adapters"; it states the true closure — 11 of 14 first-party provider adapters (lists or names the 11), with Azure/Bedrock/Vertex added separately by `prism-all`. Correct `README.md:185` so the `@arnilo/prism-all` row no longer claims "every first-party package"; it states the true closure and names the explicit omissions (document-reader, openapi-tools, session-store-nats, Caveman, Ponytail, plus the rest generated in Task 2). No other README package-table row changes unless its closure is also false (audited in Task 0).
    - Functional: correct `packages/prism-providers/package.json` `description` so it no longer claims "installs all first-party Prism provider adapters"; it states the true 11-of-14 membership and the cloud-provider omission. Correct `packages/prism-all/package.json` `description` so it no longer claims "Complete Prism umbrella: every first-party …"; it names the true closure and the omission set. Correct `packages/prism-providers/README.md` and `packages/prism-all/README.md` to match the manifest closure exactly.
    - Functional: no page (README, docs, package README, manifest `description`) claims "all", "every", or "complete" for `prism-providers` or `prism-all` unless the manifest dependency closure proves it. A grep over `README.md`, `docs/**/*.md`, `packages/prism-providers/**`, `packages/prism-all/**` for the over-broad qualifiers tied to those two package names returns only the corrected, closure-qualified wording. The omission set is explicitly listed wherever the umbrella is described.
    - Functional: umbrella membership is *not* changed in 0.2.x — `prism-providers` keeps its 11 deps, `prism-all` keeps its 20 deps; no `dependencies` entry is added or removed in either manifest. The fix is wording/description only.
    - Performance: no runtime cost; manifest metadata text edits only.
    - Code Quality: the corrected wording is generated/verified against `scripts/package-truth.json` (from Task 2) or directly against the manifest closure in a truth test; no hand-maintained count is reintroduced.
    - Security: a host reading the corrected wording is not misled into expecting a provider/package the manifest does not deliver; the supply-chain trust defect named in the 2026-08-12 review is closed for the two umbrellas.
  - Approach:
    - Documentation Reviewed:
      - `README.md:180,185`; `packages/prism-providers/package.json` (11 deps); `packages/prism-all/package.json` (20 deps); `packages/prism-providers/README.md`; `packages/prism-all/README.md`; `docs/release-and-install.md:20` (already says "eleven" — the contradiction source); Task 0 decisions; roadmap §0.2.4 bullet 1 + §0.3.0 deferral.
    - Options Considered:
      - True closure + named omissions (chosen): honest, no membership change, matches `docs/release-and-install.md:20`.
      - Membership expansion (add the 3 cloud providers to `prism-providers` / add the 5 omissions to `prism-all`): rejected — 0.3.0 scope, changes install resolution.
      - Remove the umbrella rows from README: rejected — loses install guidance.
      - Generic "see docs" wording with no closure: rejected — still not truth-verified.
    - Chosen Approach:
      - Rewrite the two README rows and the two `description` fields and the two package READMEs to state the true closure and the named omissions; verify against the Task 2 generator output; do not touch `dependencies`.
    - API Notes and Examples:
      ```text
      # README.md:180 (sketch — exact wording frozen in Task 0/2)
      | `@arnilo/prism-providers` | family: 11 of 14 first-party provider adapters (omits Azure/Bedrock/Vertex, which `prism-all` adds separately), including AI SDK interoperability |
      # README.md:185
      | `@arnilo/prism-all` | broad umbrella: 20 first-party packages across runtime, capability, provider, and persistence — omits document-reader, openapi-tools, session-store-nats, Caveman, and Ponytail (full omission set generated) |
      ```
    - Files to Create/Edit:
      - `README.md`: rows 180 and 185 (and any other audited false-closure row).
      - `packages/prism-providers/package.json`: `description` field.
      - `packages/prism-all/package.json`: `description` field.
      - `packages/prism-providers/README.md`: closure + omissions.
      - `packages/prism-all/README.md`: closure + omissions.
    - References:
      - Task 0 evidence; `README.md`; the two umbrella manifests + READMEs; `docs/release-and-install.md:20`; roadmap §0.2.4 bullet 1 + §0.3.0.
  - Test Cases to Write:
    - prism-providers closure honest: a truth test derives the 11 deps from the manifest and asserts the README/docs/`description` wording names 11 (not 14) and names the 3 cloud omissions; no "all 14" / "every provider" claim remains tied to `prism-providers`.
    - prism-all closure honest: a truth test derives the 20 deps and the omission set and asserts the wording names the true closure and the 5+ omissions; no "every first-party package" / "complete umbrella" claim remains tied to `prism-all`.
    - no membership change: `prism-providers` and `prism-all` `dependencies` arrays are byte-identical to 0.2.3 (no add/remove).
    - no over-broad qualifier: grep the named files for `all 14`/`every first-party`/`complete.*umbrella` tied to the two package names → zero.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — wording/description only; no export, dependency, or install-resolution change.
    - Docs pages to create/edit:
      - `README.md`: two package-table rows.
      - `packages/prism-providers/README.md`, `packages/prism-all/README.md`: closure + omissions.
    - `docs/index.md` update: no (the umbrella entries already link to `docs/release-and-install.md` and provider pages).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Task 1 EXECUTED (2026-08-14).** All acceptance criteria met; wording follows the Task 0 freeze verbatim.
    - `README.md`: :58 install comment → "broad umbrella (20 direct / 43 transitive packages)"; :180 `prism-providers` row → "family: 11 of 14 first-party provider adapters (omits Azure, Bedrock, Vertex, which `prism-all` adds separately), including AI SDK interoperability"; :185 `prism-all` row → "broad umbrella: 20 first-party packages (43 transitive) … omits document-reader, OpenAPI tools, NATS, Caveman, and Ponytail".
    - Manifests: `packages/prism-providers/package.json` `description` → "installs 11 of the 14 … (omits Azure, Bedrock, Vertex — added separately by @arnilo/prism-all)"; `packages/prism-all/package.json` `description` → "Broad Prism umbrella: 20 first-party … (43 transitive; omits document-reader, OpenAPI tools, NATS, Caveman, Ponytail)". `dependencies` untouched in both (byte-identical to 0.2.3 — verified by `packaging.test.ts` membership pins still passing).
    - `packages/prism-providers/README.md`: intro closure-qualified; "What it installs" list corrected to the full **11** (audit found the old list shipped only 9 — `provider-alibaba` and `provider-ollama` were missing; both added with manifest-derived descriptions); explicit "Not included" note naming azure/bedrock/vertex; tail "use `@arnilo/prism-all` for the broad umbrella (20 direct packages, 43 transitive)".
    - `packages/prism-all/README.md`: intro → "20 first-party packages (43 transitive)"; "Smaller installs" rows → "11 of 14 first-party providers" and "Broad umbrella (43 transitive packages)".
    - Beyond the plan's file list (the acceptance grep covers `docs/**`): `docs/release-and-install.md:33` "Install core + all providers" → "Install core + provider family (11 of 14)"; :39 "Install everything" → "Install the broad umbrella"; :873 "prism-all reaches every current publishable package except the deliberate Caveman/Ponytail opt-outs" (false) → "reaches 43 of the 49 workspace packages (20 direct + 23 transitive)".
    - `src/__tests__/docs.test.ts:2411` pinned the old false phrase "all 14 first-party provider adapters" in the README cache/provider-summary assertion — updated to "11 of 14 first-party provider adapters" (Task 4 replaces the phrase pin with the derived assert).
    - Audited and kept: `prism-compaction` description "installs all first-party Prism compaction strategies" is TRUE (2 deps); conformance claims "every first-party package exercises …" (docs/provider-packages.md, provider-conformance.md, performance.md) describe the provider-family suite, not umbrella membership; `prism-all/CHANGELOG.md` "complete umbrella" lines are historical records.
    - Evidence: build green; core suite 1508/1508 (docs + packaging legs included, 368 in those two files); script gates 308/310 with the 2 failures pre-existing postgres-env-blocked gates (PRISM_TEST_POSTGRES_URL); grep for `all 14`/`every first-party`/`Complete Prism umbrella`/`installs all first-party`/`Install everything` across README + docs + both package dirs returns zero umbrella-membership claims (only changelog history and provider-family conformance prose).

- [x] Task 2 — Generate package/version/profile tables from manifests as the single source
  - Acceptance Criteria:
    - Functional: add `scripts/package-truth.mjs` (dependency-free, `node:fs`/`node:path`/stdlib JSON) that reads the root manifest and every workspace manifest matched by `package.json` `workspaces`, computes the publishable count (root + workspace), the 14-provider membership, the 9 `prism-*` family/profile packages, the 26 capability packages, the `prism-providers` closure (11 deps + 3 omitted cloud providers), the `prism-all` closure (20 deps + computed omission set), and each profile's transitive closure (`prism-base`, `prism-code`, `prism-sdk`, `prism-all`, `prism-providers`), and emits `scripts/package-truth.json` with the shape frozen in Task 0. The generator is reproducible (same manifests → byte-identical JSON, modulo `generatedAt` which is either omitted or stable-ordered); it exits non-zero on a malformed manifest or a workspace glob that matches no directory.
    - Functional: regenerate the counts and tables in `docs/release-and-install.md` from `scripts/package-truth.json`: the canonical count statement (line 5) keeps 50/49/14/9/26 but replaces the "Regenerate the counts: `ls packages/*/package.json | wc -l` …" hint with "Generated by `node scripts/package-truth.mjs` → `scripts/package-truth.json`"; the stale `@arnilo/prism@0.1.0` peer literal (line 7) advances to the current version (or the Task 3 peer spec); the stale `arnilo-prism-...-0.1.0.tgz` tarball-name literals (line 97) advance to the current version; the stale "All 49 manifests (root + 48 workspace: 42 code + 6 family/profile)" line (line 699) advances to 50/49 with the correct 43 code + 6 pure-manifest breakdown and the 9 family/profile + 26 capability taxonomy; the install-profile table (lines 35–38) is verified against the generated profile closures and corrected if any row overstates closure. The 0.0.23 "47 manifests" reference (line 566) is retained as historical per-release record unless a structural test flags it as a current-line contradiction.
    - Functional: refresh `docs/0.1.0-readiness.md` "Current line" block from the stale 0.1.1 freeze (lines 3, 23, 27) to the current line **0.2.4** with the 50-manifest graph, the current version, the current compat promise, and the 0.1.7 terminal-baseline note for the completed 0.1.x line; the 0.1.0 historical sections below stay as immutable record. Refresh `docs/index.md` current-line entry to 0.2.4. Refresh root and affected package changelogs and `CHANGELOG.md` for the 0.2.4 truth release. Refresh `roadmap.md` 0.2.4 checkboxes only after all gates pass (Task 6).
    - Functional: every count/version/provider-membership/profile-closure value in the refreshed docs equals the generated `scripts/package-truth.json` value; a docs claim that contradicts the artifact fails the Task 4 truth test.
    - Performance: generator is O(50) JSON reads + one bounded closure walk; sub-second; no network; no test run. Docs edits are static text.
    - Code Quality: no docs-site generator, no Markdown AST dependency, no table library; the generator is `scripts/`-only and tarball-excluded; the JSON artifact is CI-retained and gitignored or committed-by-policy (decided in Task 0).
    - Security: the generator reads manifests only (no network, no secrets); the artifact contains package names/versions/peer specs only (no credentials); a tampered artifact is detected by regenerating in CI and asserting equality.
  - Approach:
    - Documentation Reviewed:
      - Root `package.json` `workspaces` (24 globs); the 49 workspace manifests; `docs/release-and-install.md` (lines 5, 7, 20, 35–38, 97, 566, 699); `docs/0.1.0-readiness.md` (lines 3, 23, 27, 35); `docs/index.md`; `CHANGELOG.md`; Task 0 decisions; `plans/013` Task 4 (the original canonical-count consolidation) and `plans/023` Task 6 (current-line/index advancement precedent).
    - Options Considered:
      - Dependency-free manifest reader + JSON artifact (chosen): minimum, reproducible, docs tests can read it.
      - Docs-site generator (e.g. Astro/Docusaurus): rejected — second runtime, new deps.
      - Hand-maintained counts with a CI lint rule: rejected — drift stays possible.
      - Extend `release-gates.mjs` only (no emitted artifact): rejected — docs tests have nothing to read.
    - Chosen Approach:
      - Add the generator; emit the artifact; regenerate the docs counts/tables/current-line against it; wire regeneration into `sdk:ready`/`release:gate` (Task 6) so CI regenerates and asserts equality.
    - API Notes and Examples:
      ```bash
      node scripts/package-truth.mjs --out scripts/package-truth.json
      # docs table is regenerated/verified against the artifact; a drift fails Task 4
      ```
    - Files to Create/Edit:
      - `scripts/package-truth.mjs`: the generator.
      - `scripts/package-truth.json`: the emitted artifact (CI-retained; commit policy in Task 0).
      - `docs/release-and-install.md`: canonical count, peer/tarball version literals, line 699 manifest breakdown, install-profile table verified.
      - `docs/0.1.0-readiness.md`: "Current line" block refreshed to 0.2.4 + 0.1.7 terminal baseline.
      - `docs/index.md`: current-line entry to 0.2.4.
      - `CHANGELOG.md` and affected package changelogs: 0.2.4 truth release.
      - `.gitignore` (if artifact is gitignored) or a commit-policy note (Task 0).
    - References:
      - Task 0 evidence; root `package.json` `workspaces`; the 49 manifests; `docs/release-and-install.md`; `docs/0.1.0-readiness.md`; `plans/013` Task 4; `plans/023` Task 6; roadmap §0.2.4 bullet 2.
  - Test Cases to Write:
    - generator reproducible: two runs produce byte-identical JSON (modulo `generatedAt` policy); a malformed manifest exits non-zero.
    - counts match manifests: the artifact's `publishable`/`workspace`/`provider`/`prismFamily`/`capability` equal the manifest-derived counts (50/49/14/9/26 at 0.2.4).
    - closures match manifests: `prism-providers` deps = 11, `omitsProviders` = [azure, bedrock, vertex]; `prism-all` deps = 20, `omits` = the generated set incl. document-reader, openapi-tools, session-store-nats, prism-caveman, prism-ponytail.
    - docs match artifact: every count/version/provider-membership/profile-closure value in the refreshed docs equals the artifact (asserted in Task 4).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — docs/counts/current-line only; no published package export change.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: canonical count, version literals, line 699 breakdown, install-profile table.
      - `docs/0.1.0-readiness.md`: "Current line" block.
      - `docs/index.md`: current-line entry.
      - `CHANGELOG.md` and affected package changelogs: 0.2.4 entry.
    - `docs/index.md` update: yes — current-line entry to 0.2.4.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Task 2 EXECUTED (2026-08-14).**
    - **Generator** `scripts/package-truth.mjs` (new, dependency-free): reads the root manifest + every workspace manifest via the `workspaces` globs (self-expanding `*` segments; a glob matching no directory exits 1); validates name/version (malformed manifest exits 1 naming the file); computes counts (50/49/14/9/26 + 43 codeWithPeer + 6 pureManifest), provider membership (14), the 9 `prism-*` family/profile set (explicit taxonomy constant — these names have no name-pattern separation from capability packages), umbrella closures (`prism-providers` 11 deps + 3 omitted cloud providers; `prism-all` 20 deps + transitive closure + omission set), profile closures (base/code/sdk/providers/all), and `peerPolicy` (Decision A, spec = root version). Emits `scripts/package-truth.json` per the §3.2 frozen shape; `generatedAt` is the only run-variant field; `--out`/`--root` flags; `computePackageTruth` exported for tests.
    - **CLOSURE CORRECTION (31 → 43, 18 → 5).** The generator proved the Task 0 hand-walk wrong: `prism-all`'s true transitive closure over workspace `dependencies` is **43** of 49, not 31 — the hand-walk only expanded `prism-providers` and missed the non-provider direct deps (`prism-code` → base/coding-agent/coding-security/mcp; `prism-sdk` → credentials-node/observability-opentelemetry/workflows; base → compaction/tool-validator-json-schema + the 2 compaction strategies). The omission set is **exactly the 5 roadmap-named packages** (caveman, document-reader, openapi-tools, ponytail, session-store-nats), not 18. Corrected everywhere: evidence doc §1.2/§1.3/§3.1/§3.2/§6 (CORRECTION note added), all Task 1 wording (README:58/185, both umbrella manifests, both package READMEs, release-and-install:873), and this plan's notes.
    - **Artifact committed-by-policy** (Task 0 option exercised): `scripts/package-truth.json` is committed, not gitignored — docs tests and the phase24 gate read it, and `scripts/phase24-truth.test.mjs` asserts the committed artifact equals fresh generator output, which is the tamper detection (npm test fails on a hand-edited artifact). Task 6 regenerates it after the version bump.
    - **Test file** `scripts/phase24-truth.test.mjs` (7 tests: reproducibility modulo generatedAt, committed-artifact equality, count/closure/profile asserts incl. the 43/5 correction, malformed-manifest exit 1, unmatched-glob exit 1) wired into `npm test` after `phase23-quality-gates.test.mjs`.
    - **Docs regenerated from the artifact**: `docs/release-and-install.md` :3 the `ls` regenerate-hint → "Generated by `node scripts/package-truth.mjs` → `scripts/package-truth.json`"; :6 stale `@arnilo/prism@0.1.0` peer → 0.2.3; :97 tarball names `-0.1.0.tgz` → `-0.2.3.tgz`; :699 "All 49 manifests (…42 code…)" → "All 50 manifests (…43 code packages + 6 pure-manifest family/profile…)" with the 9-family/profile taxonomy note (3 code + 6 pure-manifest); install-profile table verified against generated closures (no row overstates; base closure = compaction + validation + 2 strategies, matches its description). `docs/0.1.0-readiness.md`: current-line block refreshed to **0.2.3** with a new table (published graph 50/49/14/9/26 + generator reference, 0.2.x line summary, compat promise, security policy, 0.1.7 terminal-baseline row); the 0.1.1 table demoted to "## Previous line (0.1.1)" (verbatim); the 0.1.0 table untouched (historical). `docs/index.md:133` current-line "**0.0.23** published target" → "**0.2.3** current line; 0.1.7 terminal 0.1.x baseline". Changelogs: root `CHANGELOG.md` 0.2.4 entry (truth-release summary; Task 6 appends the exit-gate/handoff sentence) + `prism-providers`/`prism-all` 0.2.4 entries.
    - **Sequencing decision (deviation from the freeze's literal "0.2.4")**: current-line version literals were refreshed to **0.2.3** — the actual current version at execution — so docs never claim an unpublished version (the release's own principle). The ratified end-state (0.2.4) is completed by Task 6's bump, which also regenerates `scripts/package-truth.json` (single version-literal delta) so the Task 4 current-line assert and the phase24 artifact-equality assert pass at every step.
    - **Freeze-test pins updated** (all documented; Task 4 converts them to derived asserts): `docs.test.ts` phase-12 freeze peer/tarball pins → version-derived from the root manifest (`@arnilo/prism@${pkg.version}` / `arnilo-prism-${pkg.version}.tgz`); phase-48 neuralwatt gate phrase "All 49 manifests (…42 code…)" → the new 50-manifest wording; canonical-count token "ls packages/*/package.json | wc -l" → "node scripts/package-truth.mjs" + "scripts/package-truth.json"; plan-013 freeze heading assert "## Current line (0.1.1)" → "## Previous line (0.1.1)".
    - Evidence: core suite 1515/1515 (docs leg 4.39 s vs 4.29 s baseline), script gates green incl. the 7 phase24 tests and Biome 0 diagnostics, workspace suites 42/42, `node scripts/package-truth.mjs` runs clean twice (byte-identical modulo `generatedAt`).
- [x] Task 3 — Define peer-version policy (exact vs tested range, atomic upgrade, mixed patches)
  - Acceptance Criteria:
    - Functional: apply the ratified Task 0 peer-version decision (**Decision A — exact pins**) to the 43 code-package manifests consistently: the scripted `release.mjs bump --from 0.2.3 --to 0.2.4` keeps exact `@arnilo/prism: 0.2.4` peers (the 6 second `@arnilo/prism-*` peer pins and the `@dietrichgebert/ponytail` external peer advance by the same literal bump; the dev `file:../..` link is unchanged). No range rewrite is needed — `bumpRelease` literal replace suffices; the lockfile is regenerated with `npm install --package-lock-only`.
    - Functional: document the policy in `docs/release-and-install.md` and `docs/migration.md`: the chosen spec (exact pin `0.2.4`, ratified Decision A), the atomic-upgrade rule (all `@arnilo/prism-*` packages move at the same version; partial upgrades are unsupported), the supported-range story (third-party `@arnilo/prism-*` adapters peer on the exact current version; the range widens to `^1.0.0` at the 1.x stable release), the unsupported-mixture behavior (a mix like `@arnilo/prism: 0.2.3` + `@arnilo/prism-coding-agent: 0.2.4` fails clearly with npm ERESOLVE naming the conflicting peer), and the rollback posture. `docs/migration.md` gains a `0.2.3 → 0.2.4` note (version literal + peer-policy decision; the compat gate requires the version mention for any changed delta). The stale `@arnilo/prism@0.0.28` literal in the Extension notes is refreshed to the current version, keeping the policy sentence itself.
    - Functional: verify the peer policy in a packed install via `src/__tests__/install-smoke.test.ts` (or a new `phase24-peer-mix.test.mjs`): an unsupported mixture (mismatched exact pins, e.g. `@arnilo/prism: 0.2.3` + a `0.2.4` adapter) fails clearly (ERESOLVE or a Prism refusal) and a matched `0.2.4` set installs cleanly. The roadmap's "verify mixed supported patches" acceptance maps as: under ratified Decision A no mixed patches are supported — the packed test proves the refusal (unsupported mixtures fail clearly) and the matched-set clean install. The verification runs with no TS compiler (packed plain JavaScript) so the policy is runtime-enforced, not type-only.
    - Functional: third-party adapters have a supported-range story: the docs note that a third-party `@arnilo/prism-*` adapter should peer on the documented spec and that an unsupported mixture fails clearly; no third-party adapter is added in 0.2.4 (catalog breadth is 0.3.x).
    - Performance: zero runtime cost; the scripted bump rewrites 44 manifest fields and regenerates the lockfile; the packed verification is one extra `npm install` in the existing install-smoke lifecycle.
    - Code Quality: the peer-spec change is applied by the existing `scripts/release.mjs bump` literal replace (no extension needed under Decision A); no new dependency-resolution layer; the 43 manifests stay consistent (no half-updated peer).
    - Security: an unsupported peer mixture cannot silently install an incompatible core/adapter pair (Decision A fails closed via ERESOLVE); no peer spec is widened to `*` (no compat promise lost).
  - Approach:
    - Documentation Reviewed:
      - The 43 code-package `peerDependencies` (exact `@arnilo/prism: 0.2.3`; 6 with a second `@arnilo/prism-*` peer: ag-ui, coding-agent, coding-security, document-reader, rag, server; prism-ponytail additionally peers `@dietrichgebert/ponytail ^4.8.4`); `scripts/release.mjs bumpRelease` (literal version replace); npm peer-resolution docs (ERESOLVE, `~`/`>=` specifiers, `npm install --package-lock-only`); Task 0 evidence §3.3; `plans/023` Task 6 bump precedent; roadmap §0.2.4 bullet 3.
    - Options Considered:
      - Decision A (exact pins, documented policy + atomic-upgrade rule): **chosen and ratified in Task 0** — simplest, strongest compat promise, no consumer migration beyond the version literal, matches the pre-existing documented policy ("pinned for the current 0.x release, widen to `^1.0.0` at 1.x"); risk = every patch requires all packages to move together (already the release practice).
      - Decision B (tested compatible range, e.g. `~0.2.4` or `>=0.2.0 <0.3.0`): **rejected in Task 0** — lets consumers mix supported patches but a wider range can hide a real incompatibility, and compatibility has not stabilized (0.2.x IS the stabilization line).
      - `*` (any): rejected — no compat promise.
      - Chosen: Task 0 records A or B; this task applies the chosen spec and documents the policy.
    - Chosen Approach:
      - Apply the ratified Decision A via the scripted bump (literal replace only — no `bumpRelease` extension); regenerate the lockfile; document the policy + atomic-upgrade rule + supported-range story; add the packed-install refusal/clean-install verification.
    - API Notes and Examples:
      ```jsonc
      // Decision A (exact pin) — peerDependencies after bump (RATIFIED)
      { "peerDependencies": { "@arnilo/prism": "0.2.4" } }
      // Decision B examples retained for the 1.0 transition record only (rejected for 0.2.4)
      // { "peerDependencies": { "@arnilo/prism": "~0.2.4" } }
      // { "peerDependencies": { "@arnilo/prism": ">=0.2.0 <0.3.0" } }
      ```
    - Files to Create/Edit:
      - `packages/*/package.json` (43 code packages): version literal via the scripted bump (peer spec stays exact 0.2.4).
      - `package-lock.json`: regenerated.
      - `scripts/release.mjs`: no extension needed under Decision A (literal replace); if a later line ratifies a range, extend `bumpRelease` then.
      - `docs/release-and-install.md`: peer-version policy section (spec, atomic-upgrade rule, supported/unsupported mixture behavior, third-party adapter story).
      - `docs/migration.md`: `0.2.3 → 0.2.4` note (version literal + peer-policy decision).
      - `src/__tests__/install-smoke.test.ts` or `scripts/phase24-peer-mix.test.mjs`: packed-install verification (Decision A: mismatched exact pins fail clearly with ERESOLVE; matched 0.2.4 set installs cleanly).
    - References:
      - Task 0 evidence; the 44 manifests; `scripts/release.mjs`; npm peer-resolution docs; `src/__tests__/install-smoke.test.ts`; `plans/023` Task 6; roadmap §0.2.4 bullet 3.
  - Test Cases to Write:
    - consistent peer spec: all 43 code packages declare the same `@arnilo/prism` peer spec (exact `0.2.4`); no half-updated peer.
    - atomic-upgrade rule documented: `docs/release-and-install.md` + `docs/migration.md` state the spec, the atomic-upgrade rule, and the unsupported-mixture behavior.
    - Decision A mixture: a packed install with `@arnilo/prism: 0.2.3` + `@arnilo/prism-coding-agent: 0.2.4` fails clearly (ERESOLVE or Prism refusal); a matched `0.2.4` set installs cleanly.
    - no-range: no `*` or `~`/`>=` range specifier on the `@arnilo/prism` peer in any of the 43 manifests (grep → zero); Decision B range examples exist only in the plan/evidence as the 1.0 transition record.
    - no `*` spec: no peer spec is widened to `*` (grep the 44 manifests → zero `*` peers on `@arnilo/prism`).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no runtime export change; the peer *spec* may change (exact → range) which is a consumer-facing install-resolution policy, documented in migration.md.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: peer-version policy section.
      - `docs/migration.md`: `0.2.3 → 0.2.4` note.
    - `docs/index.md` update: no (policy lives on release/install + migration pages).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Task 3 EXECUTED (2026-08-14).**
    - **Policy documented (Decision A — exact pins)** in the release-and-install Extension notes ("Required `@arnilo/prism` peer" bullet, keeping the phrase pinned by the docs test): non-optional **exact** `@arnilo/prism@0.2.3` peer (bare version — no `~`/`^`/`>=` range, no `*`), the **atomic-upgrade rule** (all `@arnilo/prism-*` packages move at the same version; partial upgrades unsupported and fail clearly at install time with `ERESOLVE unable to resolve dependency tree` naming the conflicting peer), the third-party adapter story (peer on the documented exact current version; failure at install time, never runtime), the `^1.0.0` widening at the 1.x stable release (1.0 readiness gates operator-green on the 0.2.x line), and atomic rollback with the manifests/tag. `docs/migration.md` gains the `0.2.3 → 0.2.4` note (version literal + policy summary + no-migration compat declaration). The stale `@arnilo/prism@0.0.28` literals in the Extension bullet were refreshed to the current version, keeping the policy sentence.
    - **Bump path verified by inspection — no `release.mjs` extension needed.** `bumpRelease` literal-replaces `version` and every `DEPENDENCY_FIELDS` entry whose range equals the from-version for workspace packages: the 43 exact `@arnilo/prism@0.2.3` peers advance to `0.2.4` automatically; the 6 second `@arnilo/prism-*` peers (also exact `0.2.3`) advance the same way; the external `@dietrichgebert/ponytail ^4.8.4` peer is untouched (not a workspace package); the dev `file:../..` link is untouched. Lockfile regeneration happens in Task 6 at the actual bump.
    - **Packed refusal proof** (install-smoke): new describe "peer-version policy (plan 024 Task 3, Decision A: exact pins)" — a manufactured fake `@arnilo/prism-coding-agent@0.2.4` tarball (real package source copied to a temp dir, `version` + core peer bumped to `0.2.4` — the only delta) is packed alongside the real core; a fresh consumer installs core 0.2.3 then the fake adapter with `--offline`; npm exits 1 with `ERESOLVE` naming `peer @arnilo/prism@"0.2.4" from @arnilo/prism-coding-agent@0.2.4` (fail-closed, no `--legacy-peer-deps` fallback). The matched-set clean install is the main install-smoke journey (all tarballs at the same exact version, `installStatus` 0) — at the Task 6 bump that same journey becomes the matched 0.2.4 set.
    - **Peer-consistency test** (`phase24-truth.test.mjs`): all 43 code packages peer the bare exact root version (asserted against the generated `peerPolicy.spec` — no range specifier, no `*`), the 6 second-peer set is asserted exactly (ag-ui → mcp+supervisor; coding-agent → workflows; coding-security → coding-agent; document-reader → coding-agent; rag → memory; server → workflows), `prism-ponytail` peers `@dietrichgebert/ponytail ^4.8.4`, the 6 pure-manifest family/profile packages declare no core peer, and 42 of 43 code packages devDepend on the root via `file:../..`.
    - **Inventory correction (Task 0 said 43/43, actual 42/43):** `@arnilo/prism-session-store-codecs` peers the core but declares **no devDependencies at all** — no `file:../..` link. Workspace hoisting resolves the peer in tests, so no manifest change; the test exempts it by name.
    - **Generator change:** `readManifest` exported from `scripts/package-truth.mjs` for the test's manifest re-walk (module-level only; the artifact shape is untouched and the regenerated `scripts/package-truth.json` is byte-identical).
    - **Docs test:** new `peer-version policy (plan 024 Task 3)` it() in `docs.test.ts` — asserts the exact current spec phrase (version-derived from the root manifest), "atomic-upgrade rule", "ERESOLVE", "^1.0.0", the `## 0.2.3 → 0.2.4` migration section, and the migration note's atomic-upgrade statement. Version literals stay at 0.2.3 per the Task 2 sequencing decision; Task 6's bump advances them (and this test's derived assertions follow automatically).
    - Evidence: core suite 1518/1518 (docs 130 incl. the new policy test; install-smoke 11 incl. the ERESOLVE test), script gates 268/268 (phase24 now 8 tests), workspace suites 42/42, Biome 0 diagnostics, `package-truth` artifact unchanged.
- [x] Task 4 — Keep docs semantic, not phrase-only (structural truth tests + stray/truncated-text removal)
  - Acceptance Criteria:
    - Functional: add structural truth tests to `src/__tests__/docs.test.ts` that derive expected values from `scripts/package-truth.json` (or directly from manifests) and assert: the canonical count in `docs/release-and-install.md` equals the generated count; the provider membership list in docs/README matches the 14 generated providers; the `prism-providers` and `prism-all` wording matches the generated closure + omissions (Task 1); each profile closure in the install-profile table matches the generated transitive closure; the current-line version in `docs/index.md` and `docs/0.1.0-readiness.md` equals the root manifest version; the navigation shape (one index link per docs page — already asserted at line 214) holds. The existing "canonical manifest-count narrative: one statement, no stale counts" test (line 243) is kept and strengthened to assert the generated count equals the manifest count.
    - Functional: remove stray/truncated roadmap and docs text: grep `roadmap.md` and `docs/**/*.md` for truncation markers (`...` mid-sentence, `TODO`/`XXX`/`FIXME`, dangling heading fragments, leftover 0.0.x/0.1.x "current line" claims that contradict generated truth); remove or retain-as-historical each find per the Task 0 scope decision. No brittle prose snapshot is added — the tests assert *derived values* (closure, count, version, navigation shape), never verbatim prose, so editorial wording changes remain permitted.
    - Functional: the truth tests fail on wrong package closure/version/navigation while permitting editorial changes — a docs edit that restates a wrong count, omits a provider, or advances the current-line version without a manifest bump fails the gate; a docs edit that rewords a sentence without changing a derived value passes.
    - Performance: O(1) JSON load + O(docs files) grep; no extra test run beyond the existing `npm test` docs leg.
    - Code Quality: no prose-snapshot library; the truth tests reuse `node:test`/`node:assert`/`node:fs`; the asserted JSON shape is frozen in Task 0; the tests are deterministic (no timing, no network).
    - Security: the truth tests block a false docs claim from shipping (a wrong closure/version is a trust/upgrade defect); a tampered `package-truth.json` is detected by regenerating in CI and asserting equality (Task 6).
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/docs.test.ts` (line 141 navigation, line 214 one-link-per-page, line 243 count test, per-plan freeze tripwires); `scripts/package-truth.json` shape (Task 0/2); `roadmap.md`; `docs/**/*.md`; Task 0 stray-text scope; `plans/013` Task 4 (the original canonical-count test) and `plans/023` (the docs-test freeze-tripwire pattern).
    - Options Considered:
      - Manifest-derived asserts (chosen): drift-proof, editorial-friendly.
      - Prose snapshots / string equality on paragraphs (rejected — brittle, breaks on rewording).
      - A separate docs-lint package (rejected — new dependency).
      - AST-based prose checks (rejected — Markdown AST dependency, over-engineered).
    - Chosen Approach:
      - Add the derived-value asserts to `docs.test.ts`; run the stray/truncated-text grep and remove/retain per Task 0; keep the line-243 test and strengthen it.
    - API Notes and Examples:
      ```js
      // docs.test.ts truth assert (sketch)
      const truth = JSON.parse(readFileSync("scripts/package-truth.json", "utf8"));
      assert.equal(truth.counts.publishable, 50);
      const release = readFileSync("docs/release-and-install.md", "utf8");
      assert.ok(release.includes(`**${truth.counts.publishable} publishable manifests**`));
      // closure honest
      assert.ok(!/all 14 first-party provider/.test(readme), "README still claims all 14");
      ```
    - Files to Create/Edit:
      - `src/__tests__/docs.test.ts`: structural truth-test block + strengthened line-243 test.
      - `roadmap.md`, `docs/**/*.md`: stray/truncated-text removals per Task 0 scope.
      - `scripts/package-truth.json`: consumed by the tests (regenerated in CI, Task 6).
    - References:
      - Task 0 evidence; `src/__tests__/docs.test.ts`; `scripts/package-truth.json`; `roadmap.md`; `plans/013` Task 4; `plans/023` docs-test pattern; roadmap §0.2.4 bullet 4.
  - Test Cases to Write:
    - derived count: the docs canonical count equals `truth.counts.publishable` (50).
    - derived provider membership: docs/README provider list equals `truth.providers` (14).
    - derived umbrella closure: `prism-providers`/`prism-all` wording matches `truth.umbrella` (deps + omissions).
    - derived profile closure: install-profile table rows match `truth.profiles`.
    - derived current-line version: `docs/index.md` + `docs/0.1.0-readiness.md` current-line version equals the root manifest version.
    - editorial-permit: a reworded sentence that does not change a derived value passes the tests (demonstrated by a fixture or by the test design).
    - stray-text-gone: grep `roadmap.md` + `docs/**` for the Task 0 truncation markers → zero outside retained-historical sections.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — docs-test tooling + text cleanup; no published package export change.
    - Docs pages to create/edit:
      - `roadmap.md`, `docs/**/*.md`: stray/truncated-text removals per Task 0 scope.
    - `docs/index.md` update: no (navigation shape already asserted; current-line value covered by Task 2).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Task 4 EXECUTED (2026-08-14).**
    - **Derived-value tests** (docs.test.ts, new describe "plan 024 Task 4: docs truth derived from the generated artifact", 7 tests, all reading `scripts/package-truth.json`): (1) canonical count statement equals the generated counts — the existing canonical-narrative test's hardcoded tokens (`50 publishable manifests`, `49 workspace packages`, `14 provider adapters`, `9 prism-* family/profile`, `26 capability`) are now derived from the artifact, so a doc/artifact count drift fails; (2) every generated provider name appears in README.md and the release page (all 14); (3) umbrella wording matches the generated closures and omissions — README "`${providers.deps.length} of 14` first-party provider adapters", README "`${all.deps.length}` first-party packages (`${all.closure}` transitive)", the release checklist's "reaches 43 of the 49 workspace packages (20 direct + 23 transitive)" (derived from closure − direct), the 3 omitted provider short names, and the 5 roadmap-notable omission names via an `omissionReadable` map that fails loudly if the 0.3.0 membership change adds a new omission; (4) an install row exists for every generated profile (`@arnilo/prism-base`/`code`/`sdk`/`providers`/`all`); (5) current-line version equals the root manifest version (index.md + readiness heading); (6) no stale `current line (0.0.x|0.1.x)` claim remains in README/docs/roadmap (regex scan, `_evidence/` included); (7) roadmap carries no stray content (no TODO/FIXME/XXX, no `### 0.2.8` heading, no "Vent", no "Background observers"). All asserts are derived values — an editorial reword that keeps the value passes (property by construction, documented in the describe comment); a wrong closure/count/version fails.
    - **Stray text removed:** roadmap §0.2.8 (`### 0.2.8 linux-computer-use, Worktrees` heading + the two junk paragraphs — background observers/Muse Code/"Vent" and "Managing providers with profiles … Mostly for opencode go" — plus the dangling two-space line) deleted; "### Mandatory 0.2.x regression matrix" now follows 0.2.7 directly. Sweep results: no TODO/XXX/FIXME outside code examples (migration.md:422 `query: "TODO"` is a search-query example — retained), no mid-sentence ellipses outside code spans (`{...process.env}`, `// ... host parser` etc. — all JS/code, retained), no other stale current-line claims.
    - **Readiness historical demotion:** the plan-012 snapshot's `## Current line (0.1.0)` heading → `## Previous line (0.1.0)` (same demotion Task 2 applied to the 0.1.1 block; the 0.1.0 table content stays verbatim); the phase-12 freeze pin (docs.test.ts:540) updated to match. The phase-16 freeze test's hardcoded `current **0.2.3**` index assert is now derived from the root manifest version.
    - **Evidence doc rewording:** §1.2/§1.3 quotes of the 0.1.1-era "## Current line" heading reworded to "the 0.1.1-era '## Current line' readiness heading" so the stale-current-line scan (which includes `_evidence/`) stays green — same precedent as the §1.4 reword in Task 0.
    - Evidence: core suite 1525/1525 (docs leg 137 tests incl. the 7 new Task 4 tests, 3.7 s wall), script gates 268/268, workspace suites 42/42, Biome 0 diagnostics.

- [x] Task 5 — Built public-import and packed-JavaScript truth conformance (umbrella closure, peer mixture, current-line)
  - Acceptance Criteria:
    - Functional: add a focused `scripts/phase24-truth.test.mjs` leg (wired into `security:threat-suites` or the `npm test` docs/script gate segment) that asserts the truth fixes over built public entrypoints and the generated artifact: the built `dist` exposes the frozen export surface and the manifest version; `scripts/package-truth.json` matches a fresh generator run (tamper detection); the umbrella closures in the built/packed manifests match the docs wording; the current-line version in `docs/index.md` and `docs/0.1.0-readiness.md` equals the root manifest version; no docs page claims "all"/"every" for the two umbrellas without closure proof.
    - Functional: extend `src/__tests__/install-smoke.test.ts` with a packed plain-JavaScript truth journey (no TS compiler): after a local tarball install, assert the documented package contents match the installed tarballs — the `prism-providers` tarball depends on exactly 11 provider tarballs (not 14), the `prism-all` tarball's dep set matches the generated closure, and the peer-version mixture behavior (ratified Decision A: mismatched exact pins fail clearly with ERESOLVE; matched 0.2.4 set installs cleanly) holds against the installed tarballs.
    - Functional: the suite names the roadmap 0.2.4 acceptance criteria explicitly: "no page claims every/all unless closure proves it", "packed-install tests assert documented contents", "generated checks catch drift", "stale current-line text gone", "docs tests fail on wrong closure/version/navigation while permitting editorial changes".
    - Performance: the truth leg adds no measurable benchmark regression; budget gates green.
    - Code Quality: typecheck, Biome lint/format, unused sweep, docs semantic tests, public export tests pass; the leg cannot be skipped (no protected env required — truth is static).
    - Security: the adversarial tests prove the truth fixes are runtime-enforced, not type-only; a false closure claim cannot ship; an unsupported peer mixture cannot silently install.
  - Approach:
    - Documentation Reviewed:
      - `plans/023` Task 5 (security-regression + packed-conformance precedent); `src/__tests__/install-smoke.test.ts`; `scripts/phase23-security.test.mjs`; `scripts/package-truth.mjs` (Task 2); Task 0–4.
    - Options Considered:
      - Type-only fixtures: rejected; the truth gaps are docs/install-runtime.
      - A new standalone pack harness: rejected; reuse the existing install-smoke lifecycle.
      - Extend the existing packed consumer + one focused truth leg: chosen.
    - Chosen Approach:
      - Test source-level details in Tasks 1–4, public built entrypoints and the generated artifact here, and all packed truth/peer-mixture assertions in the existing install-smoke lifecycle; wire `phase24-truth.test.mjs` into the gate segment.
    - API Notes and Examples:
      ```bash
      npm run build
      node scripts/package-truth.mjs --out scripts/package-truth.json
      node --test scripts/phase24-truth.test.mjs
      node --test dist/__tests__/install-smoke.test.js
      ```
    - Files to Create/Edit:
      - `scripts/phase24-truth.test.mjs`: focused public-entry truth + artifact-tamper + closure/current-line conformance.
      - `src/__tests__/install-smoke.test.ts`: packed plain-JavaScript truth + peer-mixture journey.
      - `package.json`: append `scripts/phase24-truth.test.mjs` to the gate segment (or `security:threat-suites`).
      - `scripts/phase24-baseline.json`: reserve final evidence fields; values recorded only in Task 6.
    - References:
      - `plans/023` Task 5; `src/__tests__/install-smoke.test.ts`; `scripts/phase23-security.test.mjs`; `scripts/package-truth.mjs`; roadmap §0.2.4 acceptance criteria.
  - Test Cases to Write:
    - built truth: the built `dist` exposes the frozen export surface + manifest version; the artifact matches a fresh generator run.
    - packed umbrella closure: the installed `prism-providers` tarball depends on exactly 11 provider tarballs; `prism-all` matches the generated closure.
    - packed peer mixture (Decision A/B per Task 3): mismatched/out-of-range fails clearly; matched/supported installs cleanly.
    - packed current-line: the installed root manifest version equals the docs current-line version.
    - gate accounting: the phase-24 leg ran and names the five roadmap 0.2.4 acceptance criteria.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new behavior — executable verification of Tasks 1–4.
    - Docs pages to create/edit:
      - `none`: public behavior docs belong to Tasks 1–4; release evidence is recorded in Task 6.
    - `docs/index.md` update: no.
    - Documentation structure reference: not applicable; verification-only task.
  - **Task 5 EXECUTED (2026-08-14).**
    - **Built public-entry truth** (scripts/phase24-truth.test.mjs, 4 new tests — leg now 12 tests, still in the `npm test` gate segment after phase23-quality-gates): (1) the built `dist/index.js` exists and its `version` export equals the root manifest version, with the frozen public surface resolving (`resumeAgentRunStream` spot-check — the full surface snapshot stays pinned by `public-export-contract.test.ts`); (2) docs current-line equals the root manifest version (`docs/index.md` `current **<version>**`, readiness `## Current line (<version>)`); (3) umbrella wording freeze scan — the six false-claim shapes Task 1 removed (`all 14 first-party provider adapters`, `every first-party package, including`, `installs all first-party prism provider adapters`, `complete prism umbrella`, `all first-party prism provider`, `every current publishable package`) banned across README + release page + index + readiness + both umbrella package READMEs; quantified/omission-named claims ("11 of 14", "all eleven") are closure-proven and not banned (Task 4's derived tests pin the true wording); (4) gate accounting — roadmap §0.2.4 must state all five acceptance criteria this suite enforces (no-every/all-unless-proven, packed-install contents, generated-checks-catch-drift, stale-current-line-gone, wrong-closure/version/navigation fails while editorial changes pass).
    - **Packed plain-JS truth** (src/__tests__/install-smoke.test.ts, new describe "packed truth conformance (plan 024 Task 5)", 3 tests reading the INSTALLED manifests in the fresh consumer — the tarballs as npm laid them down, no TS compiler): the installed `prism-providers` tarball's dependencies equal exactly the generated 11 provider names (not 14); the installed `prism-all` tarball's dependencies equal the generated 20 and every member of the generated 43-member closure is present in `node_modules` (Azure presence spot-checked); the packed current-line holds — installed core tarball version equals the root manifest version and the docs current-line. Each test skips with a reason if the main install failed so noise never masks the real failure.
    - **Peer mixture**: the Task 3 ERESOLVE refusal test (mismatched exact pin fails naming the conflicting peer) is the packed mixture proof; the matched-set clean install is the main journey's `installStatus === 0` (every tarball at the same exact version) — at the Task 6 bump both become the matched 0.2.4 set.
    - **scripts/phase24-baseline.json reserved** (committed): `exitGate` fields (`command`, `version`, `platform`, `counts`, `hashes`, `skipsBlocks`, `compatDeltas`, `dependencyGraph`, `packageTruth`, `protectedEvidence`, `green`) all `null` with a Task 6 note; values recorded only after the bump + full gate run.
    - No package.json change needed (phase24 leg already wired in Task 2). Evidence: core 1532/1532 (install-smoke 14 tests incl. the 3 new packed-truth), script gates 272/272 (phase24 12/12), workspaces 42/42, Biome 0 diagnostics.

- [x] Task 6 — Docs finalization, 0.2.4 bump, and fail-loud exit gate
  - Acceptance Criteria:
    - Functional: add a `docs/release-and-install.md` section for 0.2.3 → 0.2.4 covering the umbrella-wording correction (no behavior change), the generated-table single-source rule (`node scripts/package-truth.mjs`), the peer-version policy decision (spec, atomic-upgrade rule, supported/unsupported mixture, third-party adapter story), and the structural docs-test replacement of prose snapshots — with before/after behavior, plain-JavaScript examples, and rollback-risk warning. Add the `docs/migration.md` `0.2.3 → 0.2.4` note (version literal + peer-policy decision; no runtime contract delta).
    - Functional: update root and affected package changelogs/READMEs, `docs/index.md`, `docs/0.1.0-readiness.md`, `docs/release-and-install.md`, and roadmap 0.2.4 checkboxes only after Tasks 0–5 pass. Documentation must not claim a live-service matrix, an umbrella membership expansion, a 0.3.x capability, or any closure the manifest does not deliver.
    - Functional: run `node scripts/release.mjs bump --from 0.2.3 --to 0.2.4` across all 50 manifests/lockfile (and apply the Task 3 peer-spec decision consistently) and update version-sensitive tests, exact internal peer pins, tarball names, and release docs.
    - Functional: run a plain pre-refresh compatibility gate and review every delta. The only expected deltas are the version literal, the two umbrella `description` fields (text only), and any additive `scripts/`-only artifacts (no published export change is planned; the peer spec stays exact per ratified Decision A). Any unexpected breaking declaration halts release and requires a recorded plan/manifest amendment before `--allow-break`. Refresh affected baselines only after review, then require the normal gate green.
    - Functional: run `node scripts/package-truth.mjs --out scripts/package-truth.json` in CI and assert the regenerated artifact equals the committed/generated one (tamper detection); run focused tests, `npm run security:threat-suites`, protected Postgres matrix (where `PRISM_TEST_POSTGRES_URL` is present; else blocked per the 0.2.3 skip manifest), `npm run sdk:ready`, full audit, tracked/unpacked secret scans, pack dry-run twice byte-identical, budget/benchmark gates, Node 20 packed imports, and the release gate. No truth item may be skipped silently.
    - Functional: record command, version, platform, counts, hashes, skips/blocks, compatibility deltas, package/dependency graph, the generated `package-truth.json` summary, protected evidence, and `green` in `scripts/phase24-baseline.json.exitGate`; the phase-24 freeze done-state passes.
    - Performance: root and affected package sizes remain in budget; the generator and truth tests add no measurable benchmark regression.
    - Code Quality: typecheck, Biome lint/format, unused sweep review, docs semantic + truth tests, public export tests, and diff checks pass; plan checkboxes, files, tests, compromises, and further actions reflect actual implementation.
    - Security: audit reports zero policy violations; secret scans report zero findings; packed JS and threat suites pass; protected evidence is present or blocked-visible (never an unexplained green skip); no docs page claims a closure the manifest does not deliver; signed tag/provenance remain operator-gated after clean protected CI.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md`; `docs/index.md`; `docs/0.1.0-readiness.md`; root/package changelogs; `roadmap.md` release validation checklist and 0.2.4 acceptance criteria; `plans/023` Task 6 compatibility review and exit-gate pattern; `.github/workflows/{release,security}.yml`.
    - Options Considered:
      - Release after unit tests with the truth gate optional: rejected; truth drift is a release blocker.
      - Skip the additive `scripts/`-only baseline refresh: rejected; even `scripts/`-only artifacts need a reviewed compat-baseline refresh if they touch the frozen root surface.
      - Scripted bump, reviewed normal compatibility gate, regenerate truth artifact in CI, complete protected evidence, operator publication: chosen.
    - Chosen Approach:
      - Finalize contributor docs first, bump once (with the Task 3 peer spec), review declarations, regenerate and assert the truth artifact, run all gates, record immutable evidence, then hand off signed tag/publication.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs bump --from 0.2.3 --to 0.2.4
      node scripts/package-truth.mjs --out scripts/package-truth.json
      npm run security:threat-suites
      npm run sdk:ready
      npm audit --audit-level=moderate
      git ls-files -z | xargs -0 node scripts/scan-secrets.mjs
      node scripts/release.mjs gate --version 0.2.4
      ```
    - Files to Create/Edit:
      - `docs/release-and-install.md`: 0.2.4 section + generated-table/peer-policy notes.
      - `docs/migration.md`: `0.2.3 → 0.2.4` note.
      - `docs/index.md`: current release and final navigation verification.
      - `CHANGELOG.md` and affected package changelogs: 0.2.4 truth release.
      - `package.json`, all workspace manifests, `package-lock.json`: scripted 0.2.4 bump + Task 3 peer spec.
      - `src/index.ts` version const, release/install/packaging/docs/public-export tests, package pin tests: version-sensitive updates (if any).
      - `scripts/compat-baseline/*`: reviewed additive/version baseline refresh only.
      - `scripts/phase24-baseline.json`: complete exit evidence.
      - `scripts/phase24-freeze-manifest.json`: final task/evidence tokens; deviations only if actually required.
      - `scripts/package-truth.json`: regenerated and asserted in CI.
      - `roadmap.md`: mark the four 0.2.4 items complete after all gates pass.
      - `plans/024-...md`: close tasks and fill actual compromises/further actions.
      - `plans/README.md`: status complete only after exit gate.
    - References:
      - `plans/023-Release-0-2-3-Build-Coverage-And-Release-Evidence-Integrity.md` Task 6; `plans/021` Task 8; `plans/020` Task 6.
  - Test Cases to Write:
    - contributor-doc semantic tripwire: `docs/release-and-install.md` contains the 0.2.4 section (umbrella correction, generated-table rule, peer-version policy, structural-test note); `docs/migration.md` contains the `0.2.3 → 0.2.4` note.
    - compatibility sequence: plain pre-refresh delta reviewed; plain post-refresh gate green; unexpected removal blocks.
    - release accounting: all tests/skips/protected environments named in the 0.2.3 skip manifest; any missing phase-24 item evidence makes `green: false`.
    - package truth: 50 manifests, versions/peers/lockfile consistent with the Task 3 decision, zero new dependency names, deterministic tarballs, `package-truth.json` regenerated and equal.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — publishes contributor/release truth for package/docs/compatibility; no runtime contract change (peer spec is a documented install-resolution policy).
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: 0.2.4 section + generated-table/peer-policy notes.
      - `docs/migration.md`: `0.2.3 → 0.2.4` note.
      - `CHANGELOG.md` and affected package changelogs: shipped behavior.
      - Task 1–4 docs: final semantic verification and corrections only.
    - `docs/index.md` update: yes — current release line 0.2.4 plus final Release and install navigation verification.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - **Task 6 EXECUTED (2026-08-15).**
    - **Docs finalization (0.2.4 literals):** release-and-install gains `### 0.2.4 publish handoff (plan 024 Task 6)` (umbrella correction with before/after behavior, generated-table single-source rule with a plain-JS consumer example, peer-version policy Decision A summary, structural-test note, **Rollback notes** — store-safe downgrade, truth tests fail red if docs revert — operator prereq block, protected-evidence paragraph); version literals advanced (peer bullet 0.2.4 with the 0.2.5 partial-upgrade example, tarball names, canonical statement unchanged at 50/49/14/9/26); index.md current line 0.2.4 with the plan-024 cut summary; readiness Current line (0.2.4) table (0.2.4 cut row, upgrade 0.2.3 → 0.2.4, compat at 0.2.4, docs freeze row); root CHANGELOG 0.2.4 entry completed with the exit-gate/handoff claim; roadmap 0.2.4 checkboxes all [x]; docs.test.ts gains the plan-024 Task 6 freeze test (four handoff topics + migration note) and the plan-023/plan-017 index current-line asserts became version-derived; packaging/release tests' current-version pins at 0.2.4.
    - **Bump:** `node scripts/release.mjs bump --from 0.2.3 --to 0.2.4` — 50 manifests + package-lock (exact peers advance to 0.2.4 incl. the 6 second peers; external `@dietrichgebert/ponytail ^4.8.4` untouched); `src/index.ts` version const + version-sensitive tests (index, cli-provider-add, docs:549, packaging 8 pins, release.test, install-smoke tarball names, Task 3 fake peer version → 0.2.5, 12 workspace skeleton peer pins at the 0.2.4 literal); `scripts/package-truth.json` regenerated (root.version 0.2.4, counts unchanged); 12 workspace dist rebuilds.
    - **Compat sequence:** plain pre-refresh gate at 0.2.3 → **0 deltas** (Tasks 1–5 changed no export); post-bump plain gate at 0.2.4 → the version literal alone (d.ts const on @arnilo/prism); reviewed, `--update-baseline`, plain gate green, **no --allow-break**. migration.md note (Task 3) satisfies the gate's version-note rule.
    - **Exit gate (all with PRISM_TEST_POSTGRES_URL set — plan-023 dockerized postgres:16-alpine on 127.0.0.1:54329 reused):** npm test **3567/3534/33/0 fail** (zero BLOCKED; phase12 restart-recovery + phase22 state-concurrency legs ran), test:postgres **91/91** (31+16+33+11 with prism_phase22_* durable schemas), security:threat-suites **50/50**, `npm audit` **0**, secret scan **1552 files / 0 findings**, pack dry-run **twice byte-identical** (sha256 0926355aa63e0979), release:gate **0.2.4 / 50 packages / 0 errors / 0 breaking deltas**, node v20.20.2 packed imports **24/24**, publish --dry-run **twice byte-identical** (50/50 dry-run; check-mode preflight needs the v0.2.4 tag — operator step), **sdk:ready exit 0** (typecheck + lint + format:check + npm test + coverage + pack + release:evidence 58 surfaces blocked=false + release:gate). Formatting fixes: biome format --write on 3 files (install-smoke, package-truth, docs.test additions).
    - **Artifacts:** `scripts/phase24-freeze-manifest.json` (7 items, allowed/forbidden changes, compat promise, 9 deviations incl. the closure correction and the version-sequencing decision); `scripts/phase24-baseline.json` `exitGate` completed (green true, blocked false, counts, protected evidence, compat, note).
    - **Remaining operator handoff (recorded, not executed):** signed `v0.2.4` tag + npm OIDC publication after clean protected CI (release.yml verify + postgres-integration + node20-compat + codeql + supply-chain).

## Compromises Made

- **Closure numbers were wrong once and were corrected by the generator** (Task 2): the Task 0 hand-walk recorded prism-all closure 31 / 18 unreachable; the manifest-derived generator proved 43 / omits exactly 5 (the roadmap's named omissions are the complete set). All wording, evidence, and plan numbers now read 43. Ceiling: the omission-name map in the Task 4 test (and the README wording) must grow when 0.3.0 changes membership — the test fails loudly until they do.
- **Docs version literals lag the bump** (sequencing decision): docs stayed at 0.2.3 (the shipped version) through Tasks 2–5 and advanced to 0.2.4 only at the Task 6 bump, so no page ever claimed an unshipped version. Ceiling: the same dance repeats at every release; the version-derived tests make most of it automatic, but the 12 workspace skeleton peer pins and the install-smoke tarball-name assert stay hardcoded (repo convention).
- **`scripts/package-truth.json` is committed** rather than gitignored like the other generated artifacts, because docs tests read it directly; tamper detection is the in-gate equality test (artifact == fresh generator run).
- **Protected Postgres evidence reuses the plan-023 container** (prism-test-pg on 127.0.0.1:54329) — no fresh postgres spin-up was needed; 91/91 with durable schemas.
- **registry preflight (release:check) is operator-gated by the v0.2.4 tag** and a clean tree — recorded, not run; publish --dry-run ran twice byte-identical instead.

## Further Actions

- **0.3.0 umbrella membership decision + enforcement** (roadmap §0.3.0): the omission-name map in the Task 4 test and the README wording must be extended to match whatever membership 0.3.0 ships; the generator already makes the closure computation automatic. (high)
- **Derive the 12 workspace skeleton peer pins** from the root manifest (or a shared constant) so the bump stops touching 12 files every release. (medium)
- **A 0.2.5 pass could sweep remaining hardcoded current-version literals** in tests (release.test/packaging.test version consts) into the version-derived pattern used by the docs tests. (low)
- **Consider adding the phase24-truth leg to `security:threat-suites`** as well as the npm test gate segment, so the threat-suite surface also covers the truth fixes. (low)
- **Node 20 packed-import reproduction stays manual/local** (recorded in the baseline); the CI node20-compat job remains the canonical gate. (informational)