# Behavior Integration and Graft Removals

Removes the first-class Ponytail, Caveman, and Graft integrations so hosts provide their
own implementations through public extension APIs, external MCP servers, or host-authored
native tools. Everything here is opt-in surface; nothing is default behavior. Removals ship
with 0.10.0 (plan 106 owns the cut; this plan must complete before plan 106 Tasks 8–10,
after or in parallel with plan 106 Tasks 1–7).

Decision record (2026-09-19): Ponytail and Caveman are already inert, opt-in subpaths of
`@arnilo/prism-coding-tools` built entirely on public extension APIs (`registerSkill`,
`registerCommand`, `registerInstructionInjector`, `api.use("input_assembly")`, `api.emit`,
host-supplied persistence callbacks) — a host can reimplement them without compromise.
Graft's context-graph tools are already reachable through the graft MCP server exposed by
hosts, and hosts can author native Prism tools if they want first-class behavior; the
`@arnilo/prism-memory/graft` subpath (and `@nanonets/graft` optional peer) is therefore
redundant first-party surface. Scope: shipped package integration only — the repo-local
graft context graph (`graft/`), the `.mcp.json` graft entry, and the AGENTS.md graft block
stay; graft remains this repo's development context tool.

## Objectives

- Delete `@arnilo/prism-coding-tools/caveman` and `/ponytail` subpaths: source, package
  manifest entries (subpaths, `@dietrichgebert/ponytail` optional peer, `files`, test
  scripts), fixtures, docs pages, index entries, and examples.
- Keep a host-side reference implementation: `examples/caveman-ponytail.ts` is ported to
  load upstream skills from a directory using public APIs only (no prism-coding-tools
  subpath import).
- Delete the `@arnilo/prism-memory/graft` subpath: source, manifest entries (`./graft`
  export, `@nanonets/graft` optional peer, `files`, test scripts), fixtures, `docs/graft.md`,
  index/release/peer-dependency mentions, and `examples/graft-extension.*`.
- Keep the repo-local graft context graph (`graft/`), the `.mcp.json` graft entry, and the
  AGENTS.md graft block untouched — graft stays this repo's development context tool; only
  the shipped Prism package integration goes.
- Regenerate the compatibility baseline for the removed exports and fold the removals into
  the 0.10.0 changelog.

## Expected Outcome

- `@arnilo/prism-coding-tools` and `@arnilo/prism-memory` ship without the three subpaths
  and without their optional peers; `npm install` graphs no longer carry `@dietrichgebert/ponytail`
  or `@nanonets/graft` references in Prism manifests.
- `examples/caveman-ponytail.ts` remains a working, dependency-light reference for hosts
  implementing behavior packages (skills + injector + command + persistence) on public APIs.
- Hosts integrate graft via MCP (host-exposed `graft` server) or their own tools;
  `docs/hooks.md` (plan 106) and `docs/extensions.md` remain the authoring guides. This
  repo itself keeps using graft (`graft/`, `.mcp.json`, AGENTS.md block) for development.
- `release:gate` green on a regenerated baseline that records these removals as this plan's
  (not inherited); all removals ship in 0.10.0 via plan 106's cut.

## Tasks

- [x] Task 1: Removal inventory — exact export surface and every consumer
  - Acceptance Criteria:
    - Functional: An inventory recorded in this task's completion notes lists, per removal: (a) the exact public exports of each subpath (from `dist/*.d.ts`/source index), (b) every consumer found by repo-wide search — `grep -rn "prism-coding-tools/caveman\|prism-coding-tools/ponytail\|prism-memory/graft\|@dietrichgebert/ponytail\|@nanonets/graft"` across `packages/`, `src/`, `scripts/`, `examples/`, `docs/` (excluding `docs/history/` and `docs/_evidence/`), and `plans/00x` archives, and excluding the `graft/` context-graph directory itself (generated output, kept — refresh it with `graft build` after Tasks 2–3 land), (c) confirmation that nothing outside `packages/prism-coding-tools` and `packages/memory` imports the subpaths (expected: none, verified above for `/graft`), (d) the exact diff between `ponytail:`/`caveman` *code-comment markers* (an unrelated repo convention — e.g. `src/__tests__/docs.test.ts:250`, `packages/prism-coding-tools/src/agent/*.ts`) and the behavior-package artifacts this plan removes. The inventory decides whether a public `loadSkillDirectory(dir)`-style bounded skill-directory loader should be promoted from the deleted `upstream.ts` into `@arnilo/prism` (recommendation: yes, one export, keeps "host reimplements with zero compromise" literally true; it unblocks the ported example).
    - Performance: n/a (inventory).
    - Code Quality: The inventory names every file each later task will touch so Tasks 2–5 have zero discovery work.
    - Security: Confirms the removed optional peers (`@dietrichgebert/ponytail`, `@nanonets/graft`) appear nowhere else in Prism manifests or lockfile-anchoring package.jsons.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-coding-tools/package.json` (subpaths at lines 36–43, peers 70–75 + devDep 87, keywords 115–116; **no** caveman/ponytail `files` entry — `files` is `dist`/`skills` only), `packages/memory/package.json` (`./graft` at 40–43, peer 71 + meta 74 + devDep 84, keywords 107; **no** graft `files` entry; test scripts 65–66)
      - `src/__tests__/docs.test.ts` (example coverage list ~3329–3330; history-only asserts at ~2462 for the 0.0.22-era standalone `@arnilo/prism-caveman`/`@arnilo/prism-ponytail` packages — history, must keep passing untouched)
      - `docs/index.md` (lines 37, 224–226, 254, 260), `docs/release-and-install.md` (graft rows/mentions), `docs/peer-dependencies.md`, `docs/live-testing.md`, `docs/migration.md` (graft mentions)
      - `docs/graft.md`, `docs/caveman.md`, `docs/ponytail.md`, `docs/extensions.md:155-156`, `examples/README.md`
      - `scripts/release.mjs` gate + `scripts/compat-baseline/` (baseline regeneration mechanics per skill rule)
      - `scripts/package-truth.mjs` / `scripts/package-truth.json` (manifest counts; confirmed: no caveman/graft entries beyond package manifests)
    - Options Considered:
      - Deprecate-with-alias for one release — rejected: subpaths are opt-in and 0.x; clean removal with migration notes in CHANGELOG + `docs/migration.md`-style guidance inside `docs/hooks.md`/CHANGELOG is the 0.x-correct move.
      - Keep the ported example importing the subpaths — rejected: defeats the point; it must use only public `@arnilo/prism` exports.
    - Chosen Approach: Hard removal in 0.10.0 + host-side reference example + CHANGELOG migration note.
    - API Notes and Examples:
      ```bash
      # inventory greps (also run each against scripts/, examples/, every workspace)
      grep -rn "prism-coding-tools/ponytail\|prism-coding-tools/caveman" --exclude-dir=node_modules .
      grep -rn "prism-memory/graft\|@nanonets/graft" --exclude-dir=node_modules --exclude-dir=graft .
      ```
    - Files to Create/Edit: none (review task).
    - References: skill rule on public-symbol removal + baseline regeneration; plan 068 current-vs-history docs rule.
  - Test Cases to Write: none (inventory).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (review only).
    - Docs pages to create/edit: `none` with reason: inventory; edits land in Tasks 2–5.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion notes:
    - **(a) Public export surface** (source index == `dist/*.d.ts/index.d.ts`; no wildcard exports):
      | Subpath | Exports |
      | --- | --- |
      | `@arnilo/prism-coding-tools/caveman` | value: `createCavemanExtension`; types: `CavemanAppendOptions`, `CavemanExtensionOptions`, `CavemanExtensionState`, `CavemanLevel` |
      | `@arnilo/prism-coding-tools/ponytail` | value: `createPonytailExtension`; types: `PonytailAppendOptions`, `PonytailExtensionOptions`, `PonytailExtensionState`, `PonytailMode` |
      | `@arnilo/prism-memory/graft` | values: `childEnv`, `childTimeoutMs`, `DEFAULT_MAX_RESULT_BYTES`, `runGraftExit`, `runGraftJson`, `createGraftExtension`, `deepProviderEnv`, `GRAFT_EXTENSION_NAME`, `GRAFT_PEER_PACKAGE`, `GRAFT_PEER_RANGE`, `GraftResolveError`, `readBoundedFile`, `redactPaths`, `resolveGraftCli`; types: `GraftAppendOptions`, `GraftDeepModel`, `GraftDeepProvider`, `GraftExtensionOptions`, `GraftExtensionState`, `GraftMode`, `ResolvedGraftCli`, `ResolveGraftCliOptions` |
      Baseline note: `scripts/compat-baseline/<pkg>.txt` is extracted from **all** `dist/**/*.d.ts`, so Task 4's regen also drops non-index module names (e.g. `CAVEMAN_LEVELS`, `CAVEMAN_SKILL_NAMES`, `CAVEMAN_UPSTREAM_PACKAGE`, `DEFAULT_CAVEMAN_CONFIG`, `DEFAULT_PONYTAIL_CONFIG`, `PONYTAIL_MODES`, `PONYTAIL_PEER_PACKAGE`, `PONYTAIL_SKILL_NAMES`, `loadUpstreamSkills`, `requireCavemanSkills`/`requirePonytailSkills`, `resolveUpstreamRoot`, `GRAFT_SKILL_BODY`, `GRAFT_STATE_TYPE`, graft commands/tools/injector/edit-watch exports). All are intended; review the regen diff against this list.
    - **(b) Consumers** (grep over `packages/`, `src/`, `scripts/`, `examples/`, `docs/` excluding `docs/history|_evidence`, plus `plans/00x`; repo-local `graft/` graph absent — `graft` CLI is an MCP server here, not checked in):
      | File | Refs | Task/action |
      | --- | --- | --- |
      | `packages/prism-coding-tools/package.json` | exports `./caveman` 36–39, `./ponytail` 40–43; peer 70 + meta 74; devDep 87; keywords 115–116 | Task 2 (no `files` entry exists — plan's `files` claim is wrong; `files` is `dist`/`skills` only. No test-script path either — glob `dist/**/__tests__/*.test.js`) |
      | `packages/prism-coding-tools/src/caveman/`, `src/ponytail/` (incl. `__tests__/`, both `packed-consumer.test.ts`, `real-peer.test.ts`) | source + self-name strings `extension.ts:15/49`, `:15/43/52` | Task 2 delete |
      | `packages/prism-coding-tools/fixtures/caveman/`, `fixtures/ponytail/` | full + minimal upstream trees, `PROVENANCE.md` | Task 2 delete; the ported example needs a replacement tracked fixture — recommend `examples/fixtures/behavior-skills/skills/{ponytail,ponytail-audit,caveman}/SKILL.md` carrying the 3 markers the current demo asserts (`seen every over-engineered codebase`, `ponytail-review, repo-wide`, `Skill caveman:`) |
      | `packages/prism-coding-tools/src/__tests__/coding-tools-conformance.test.ts` | imports `../caveman/index.js`, `../ponytail/index.js`; `expectedSubpaths` 20–32 ("9 subpaths"); factory asserts 53/54 | Task 2 edit (missing from plan's file list) |
      | `packages/prism-coding-tools/src/upstream/` | shared resolver primitives; `assertSkillsMarker`/`resolvePeerPackageRoot`/`SKILLS_DIR_NAME` become dead once caveman/ponytail go (impeccable keeps `redactPaths`, `readBoundedFile`, `MAX_SKILL_FILE_BYTES`, `UpstreamResolveError`) | Task 2 prune internals + tests |
      | `packages/prism-coding-tools/README.md` 12–13 | subpath bullets | Task 2 de-mention |
      | `packages/memory/package.json` | `./graft` 40–43; peer 71 + meta 74; devDep 84; `test`/`test:postgres` `dist/graft/__tests__/*.test.js` 65–66; keywords 107 | Task 3 (no `files` entry exists — `files` is `dist`/`skills`) |
      | `packages/memory/src/graft/` (+ `__tests__/`: cli, commands, edit-watch, injector, real-peer, tools, upstream) | source | Task 3 delete |
      | `packages/memory/fixtures/graft-package-fixture/` (3 files) | stub CLI fixture | Task 3 delete |
      | `packages/memory/README.md:3` | `/graft` subpath | Task 3 de-mention (missing from plan) |
      | `examples/caveman-ponytail.ts` 17–18, `.js` 4–5 | subpath imports; 165-line demo | Task 2 port |
      | `examples/graft-extension.ts` 13, 51, `.js` 3, 35 | subpath imports | Task 3 delete |
      | `examples/tsconfig.json:33` | `@arnilo/prism-memory/graft` path mapping | Task 3 remove (missing from plan) |
      | `examples/README.md` 33, 166 (graft), caveman-ponytail row nearby | demo rows | Tasks 2–3 |
      | `scripts/fixtures/e2e-full-surface-journey.mjs` 236–239, 626–632 | dynamic imports graft / caveman+ponytail | Tasks 2–3 edit (keeps `wiki` leg) — missing from plan |
      | `scripts/phase24-truth.test.mjs:229–230` | asserts `@dietrichgebert/ponytail ^4.9.0` peer | Task 2 edit — missing from plan |
      | `scripts/package-truth.mjs` 191–192, 202 | `PACKAGE_NOTES` subpath strings | Tasks 2–3 + `--emit-docs` (Task 4) |
      | `scripts/compat-baseline/arnilo__prism-coding-tools.txt`, `arnilo__prism-memory.txt` | subpath exports | Task 4 regen. Legacy `arnilo__prism-{caveman,ponytail,graft}.txt` are pre-consolidation leftovers; `--update-baseline` never writes or prunes them — leave (out of scope) |
      | `src/__tests__/install-smoke.test.ts:133` | imports `@arnilo/prism-memory/graft` from packed tarball | Task 3 edit — missing from plan |
      | `src/__tests__/packaging.test.ts:255–278` | memory exports deepEqual incl. `./graft`; graft peer asserts 275–276 | Task 3 edit — missing from plan; no coding-tools caveman/ponytail equivalent exists (tarball allow/deny is path-pattern only) |
      | `src/__tests__/docs.test.ts:3345–3346` | demos list includes caveman-ponytail + graft-extension (compiled **and executed** at 3308/3372) | Tasks 2–3 (missing graft from plan) |
      | `docs/index.md` 53 (graft graph commands), 242–243 (integration entries), 244 (graft entry), 273 + 280 (generated subpath tables) | plan cited 37/224–226/254/260 — stale; actual lines above | Tasks 2–4 |
      | `docs/extensions.md` 172–173 | integration links | Task 2 (deletes pages) |
      | `docs/coding-tools.md` 18, 31–32, 68–73 | install line, subpath table rows, persona example | Task 2 — missing from plan |
      | `docs/context-and-skills.md` 203–210 | "Third-party behavior packages (Caveman, Ponytail, Impeccable)" section | Task 2 rewrite → Impeccable only — missing from plan |
      | `docs/peer-dependencies.md` 23–24 (rows), 50 (process-peer list), 82 (`/graft` resolver prose), 96 (doc links) | shared by both tasks | Task 2 removes ponytail row/link + line 50 entry; Task 3 removes graft row/link/line 82 |
      | `docs/release-and-install.md` 21, 28, 62 (generated tables/prose → `--emit-docs`), 94 (graft install row), 264 (stale `prism-caveman`/`prism-ponytail` legacy prose — pre-existing stale, leave or footnote) | | Tasks 2–4 |
      | `docs/live-testing.md:104` | `memory/graft` live-leg row | Task 3 (plan names the file, no line) |
      | `docs/graft.md` | whole page | Task 3 delete |
      | `docs/caveman.md`, `docs/ponytail.md` | whole pages | Task 2 delete |
      | `README.md` 34, 167, 174 | generated subpath tables/prose | Task 4 `--emit-docs` (generated; do not hand-edit) |
      | `CHANGELOG.md` 0.10.0 header (~3) + Changed (~28) | says plan 107 "deferred" and "baselines … zero removals" | Task 4 revise; 155/160/234 are historical entries — keep |
      | `docs/migration.md` 0.10.0 section (~7) | "Nothing was removed … zero removals" | Task 4 revise (this is the page `release-gates.migrationMentionsVersion` reads); 89 is historical graft peer note — keep |
      | `docs/migrate-to-0.6.md` 32, 58 | frozen older-line migration prose | keep (historical) |
      | `plans/005, 024, 025, 029, 033, 054, 056, 069, 070` | archival design/history refs | keep |
      | `scripts/phase54-package-map.mjs` 167, 205, 940, 945 (+ `phase54-package-map.test.mjs` — no assertions on them) | historical evidence generator | keep (report-only generator) |
      | `package-lock.json` 428–430, 2998–3009, 3050–3064 | dev-dep entries for both peers | Tasks 2–3 regenerate (`npm install --package-lock-only`) — missing from plan |
      | `security-artifacts/sbom.spdx.json` 365–370, 461–704 | committed SBOM snapshot | Task 4 note: CI regenerates (`workflow-liveness.test.mjs:217`); `verify-sbom.mjs` only validates — refresh owned by the cut/handoff |
    - **(c) Import confirmation, corrected.** The plan's expectation "nothing outside `packages/prism-coding-tools`/`packages/memory` imports the subpaths" is **false as written**: package-level only those two declare/depend on them, but repo-local dev surfaces do import them — `examples/caveman-ponytail.{ts,js}` (Task 2 port), `examples/graft-extension.{ts,js}` (Task 3 delete), `scripts/fixtures/e2e-full-surface-journey.mjs` (Tasks 2–3 edit), `src/__tests__/install-smoke.test.ts` (Task 3 edit), `examples/tsconfig.json` path mapping (Task 3 edit), plus manifest/export-list assertions in `coding-tools-conformance.test.ts` (Task 2), `packaging.test.ts` (Task 3). Nothing else imports or re-exports them; `src/index.ts` and the core barrels never mention them.
    - **(d) Code-comment markers vs package artifacts.** `ponytail:` markers are an unrelated repo-wide shortcut convention: 204 occurrences (`*.ts|js|mjs`, excl `node_modules`/`dist`); only 19 sit in files this plan deletes (`caveman/mode.ts:44`, memory `graft/edit-watch.ts:98`, `graft/extension.ts:166`, `graft/injector.ts:9/102/173`, `graft/tools.ts:179`, ponytail fixture hooks comments). The other 185 stay untouched, including the marker strings freeze tests pin (`scripts/phase23-quality-gates.test.mjs:44–52`, `phase1x-freeze.test.mjs` "ponytail: comments" allowances) and `src/__tests__/docs.test.ts:252/284/301/384/3041/3710`; none of the pinned markers live in a deleted path. `caveman:` is **not** a comment convention: 3 hits total — string literals `examples/caveman-ponytail.{ts:94,js:69}` and event type `caveman:status` in `src/caveman/extension.ts:48`; nothing to preserve.
    - **`loadSkillDirectory` decision: promote — yes.** Gap is real: core's only directory loader, `discoverContributions`, is a trust-gated `.agents/<kind>s/<name>/` scanner returning inert envelopes with unbounded `readFile`, so it cannot load a third-party package's skill tree; the deleted `loadUpstreamSkills` (identical 12 lines in caveman+ponytail) is the only bounded scanner and it dies with the subpaths. **Placement (lazy):** add `loadSkillDirectory(dir, options?)` to the existing `@arnilo/prism/node/contribution-discovery` subpath — it already owns directory walking, `parseSkillFile`, and the ENOENT-tolerant `readOptionalFile`; reuse those, add per-file size cap defaulting to `HARD_MAX_SKILL_INSTRUCTION_BYTES` (262 144, `src/skill-disclosure.ts:12`), realpath-containment per SKILL.md, skip non-dirs without SKILL.md, return `readonly Skill[]`. No new subpath; root stays fs-free (`parseSkillFile` is already a root export). The ported example then uses it, keeping the host story "public APIs only". One test: bounded load + oversize reject + escape reject. Memory's own `readBoundedFile`/`redactPaths` (graft upstream) are a second copy deleted in Task 3 — no shared promotion needed.
    - **Security:** both optional peers appear in exactly the two package manifests (3 refs each) and nowhere else in Prism manifests; remaining hits are lockfile (`package-lock.json` 428–430, 2998–3009, 3050–3064 — dev-deps), the committed SBOM snapshot, historical CHANGELOG/plans/docs prose, and the two package-source files deleted by Tasks 2–3. `scripts/phase24-truth.test.mjs:230` re-asserts the ponytail peer and must be relaxed/removed by Task 2.
    - No blockers; Tasks 2–5 file lists corrected above (add `coding-tools-conformance.test.ts`, `docs/coding-tools.md`, `docs/context-and-skills.md`, `packages/*/README.md`, `scripts/fixtures/e2e-full-surface-journey.mjs`, `src/__tests__/install-smoke.test.ts`, `src/__tests__/packaging.test.ts`, `examples/tsconfig.json`, `scripts/phase24-truth.test.mjs`, `docs/peer-dependencies.md`, `package-lock.json`, `docs/migration.md`/`CHANGELOG.md` 0.10.0 truth lines; `examples/graft/` does not exist).

- [x] Task 2: Remove Ponytail and Caveman from `@arnilo/prism-coding-tools`; port the example
  - Acceptance Criteria:
    - Functional: `packages/prism-coding-tools/src/caveman/`, `src/ponytail/`, their `__tests__`, and their fixtures are deleted. The manifest loses the `./caveman`/`./ponytail` subpaths, both `@dietrichgebert/ponytail` peer/optional-peer entries, the `caveman`/`ponytail` `files` entries, and any test-script paths. `examples/caveman-ponytail.ts` is ported to build the same behavior (load upstream SKILL.md files from a host-supplied directory, register skills + `/caveman`-style command + every-turn injector + session-entry persistence callbacks) using only `@arnilo/prism` public exports; `examples/caveman-ponytail.js` regenerated. If Task 1 approved the loader promotion, `@arnilo/prism` exports the bounded skill-directory loader (`loadSkillDirectory`) with its own test, and the example uses it.
    - Performance: package tarball and install graph shrink (optional peer gone).
    - Code Quality: No dangling references: `grep -rn "prism-coding-tools/ponytail\|prism-coding-tools/caveman"` over `packages/`, `src/`, `scripts/`, `examples/`, `docs/` (excluding `docs/history/`, `docs/_evidence/`) returns only historical prose. `docs.test.ts` example list updated; `ponytail:` code-comment markers elsewhere are untouched (they are an unrelated convention).
    - Security: Removing the optional peer removes the only third-party code path these subpaths could pull in.
  - Approach:
    - Documentation Reviewed:
      - Task 1 inventory; `docs/caveman.md`, `docs/ponytail.md`, `docs/extensions.md:155-156`, `docs/index.md:224-225,254`
      - Upstream loading internals (`packages/prism-coding-tools/src/ponytail/upstream.ts` — bounded reads, skills markers, peer-root resolution) to decide promotion scope
      - `examples/caveman-ponytail.ts` current shape (already takes `upstreamPath` + persistence callbacks — port is mostly import-surface work)
    - Options Considered:
      - Move the extensions to `examples/` wholesale — rejected: examples must demo the *pattern* on public APIs, not ship 500-line vendor shims.
      - Keep subpaths, mark deprecated — rejected per Task 1.
    - Chosen Approach: Delete; port example onto public APIs (+ promoted loader if approved).
    - API Notes and Examples:
      ```ts
      // ported example sketch — public APIs only
      import { loadSkillDirectory, type Extension } from "@arnilo/prism";
      const ext: Extension = {
        name: "host-caveman",
        setup(api) {
          for (const skill of loadSkillDirectory(upstreamDir)) api.registerSkill(skill);
          api.registerInstructionInjector({ name: "caveman-style", apply: () => ({ when: "every_turn", instructions: levelSlice }) });
          api.registerCommand({ name: "caveman", /* host CLI dispatch */ });
        },
      };
      ```
    - Files to Create/Edit:
      - `packages/prism-coding-tools/package.json`: remove subpaths, peer entries, `files`, test paths.
      - `packages/prism-coding-tools/src/`: delete `caveman/`, `ponytail/` (+ tests, fixtures).
      - `src/contracts.ts` + `src/skills.ts` (or the module owning skill loading — Task 1 confirms): optional `loadSkillDirectory` export + test.
      - `examples/caveman-ponytail.ts` / `.js`: port; `examples/README.md` row update.
      - `docs/index.md`: drop lines 224–225, fix line 254 subpath list.
      - `docs/extensions.md`: drop lines 155–156.
      - Delete `docs/caveman.md`, `docs/ponytail.md`.
      - `src/__tests__/docs.test.ts`: example coverage list update.
      - `CHANGELOG.md`: 0.10.0 removal entry with migration note (host pattern pointer to the example).
    - References: analysis session 2026-09-19 (public-API audit of both extensions); skill removal/baseline rule (baseline regen deferred to Task 4).
  - Test Cases to Write:
    - `loadSkillDirectory` (if promoted): loads bounded SKILL.md set, rejects marker-mismatched dirs, caps file sizes.
    - Ported example compiles and its unit behaviors (skill registration count, injector slice, command handler) hold — keep a small `examples` smoke test if the repo pattern requires it (check `docs.test.ts` compile coverage).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — two package subpaths removed; possibly one core export added.
    - Docs pages to create/edit: deletions + edits listed above; `docs/hooks.md` (plan 106) gains nothing here; CHANGELOG migration note.
    - `docs/index.md` update: yes — remove the two integration entries and the subpath-list mention.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion notes:
    - **Deleted:** `packages/prism-coding-tools/src/{caveman,ponytail}/` (source + `__tests__` + `packed-consumer`/`real-peer` suites), `packages/prism-coding-tools/fixtures/{caveman,ponytail}/` (vendored full+minimal upstream trees, `PROVENANCE.md`), `docs/caveman.md`, `docs/ponytail.md`.
    - **Manifest (`packages/prism-coding-tools/package.json`):** `./caveman` + `./ponytail` exports, the `@dietrichgebert/ponytail` peer, its `peerDependenciesMeta.optional` entry, the devDependency, and both keywords removed. Plan corrections confirmed: there was **no** caveman/ponytail `files` entry and **no** test-script path to remove (`files` = `dist`/`skills`; `test` already a `dist/**/__tests__/*.test.js` glob). `package-lock.json` regenerated with `npm install --package-lock-only --ignore-scripts`: exactly 12 deletions (root dev link, package entry, manifest peer/dev/meta), zero unrelated drift.
    - **`loadSkillDirectory` promoted (Task 1 approved):** added to `src/node/contribution-discovery.ts` (`loadSkillDirectory(directory, { maxSkillBytes? })` + `LoadSkillDirectoryOptions`), reusing `parseSkillFile`/`readOptionalFile`/`isPathInsideReal`, capped at `HARD_MAX_SKILL_INSTRUCTION_BYTES` (262 144) by default. **Deviation:** the plan sketched `src/contracts.ts` + `src/skills.ts` (root export); the Task 1 recommendation placed it on the existing `@arnilo/prism/node/contribution-discovery` subpath because the root index is fs-free by design. Four tests in `src/__tests__/node-contribution-discovery.test.ts` (sorted load + non-skill skips, unreadable dir throws, over-cap throws with override, symlink escape skipped) — all pass. Root export ceiling rebaselined 1456 → 1458 in `scripts/budgets.json` with a recorded reason; `scripts/budget-gate.test.mjs` green.
    - **Shared internals pruned:** `src/upstream/index.ts` keeps only `MAX_SKILL_FILE_BYTES`, `UpstreamResolveError`, `redactPaths`, `readBoundedFile` (all still used by impeccable); `assertSkillsMarker`, `resolvePeerPackageRoot`, `SKILLS_DIR_NAME`, `MAX_CONFIG_FILE_BYTES`, `MAX_INJECTED_INSTRUCTION_BYTES` were caveman/ponytail-only and are gone, with their cases dropped from `upstream-primitives.test.ts`.
    - **Example ported:** `examples/caveman-ponytail.ts` now builds both personas from public APIs only — `loadSkillDirectory` + one host `createPersonaExtension` per persona (skill registration, `/caveman`-style command, every-turn injector slice, session-entry mode persistence with restore, `CommandResult`). New tracked fixture `examples/fixtures/behavior-skills/skills/{caveman,ponytail,ponytail-audit}/SKILL.md` carries the three body markers the demo asserts. Runtime output: `{"skillCount":3,"extensionsLoaded":true,"catalogOnly":true,"injectorSliceWithoutBody":true,"auditBodyLoaded":true,"loadedCount":1,"persistedModeEntries":1}`. **Plan correction:** `examples/caveman-ponytail.js` is untracked emit output (`.gitignore` `examples/*.js`; `docs.test.ts` compiles+runs and removes it), so nothing is "regenerated" — the stale copy was deleted.
    - **Other files touched (not in the plan's list):** `packages/prism-coding-tools/src/__tests__/coding-tools-conformance.test.ts` (9 → 7 subpaths, imports/factory asserts), `src/__tests__/docs.test.ts` (phase-5 persona test rewritten: asserts the two pages are gone + `loadSkillDirectory`/impeccable/cross-links instead of the deleted docs), `docs/{index.md,extensions.md,coding-tools.md,context-and-skills.md,peer-dependencies.md,impeccable.md,graft.md,contribution-discovery.md}` (subpath/peer/link removal + the new loader section; graft.md and impeccable.md only had their dead persona links fixed — graft.md is deleted by Task 3), `packages/prism-coding-tools/README.md`, `examples/README.md`, `CHANGELOG.md` (0.10.0: `### Removed` entry + `Added` loader bullet + header no longer lists 107 as deferred), `scripts/fixtures/e2e-full-surface-journey.mjs` (persona leg → impeccable only; subpath count comment 10 → 7), `scripts/phase24-truth.test.mjs` (asserts the ponytail peer is **gone** from `prism-coding-tools`), `scripts/package-truth.mjs` `PACKAGE_NOTES` + `--emit-docs` (regenerated README/docs/release-and-install/`scripts/package-truth.json`; only the coding-tools note line changed), `scripts/e2e-coverage.json` (stale `./caveman`/`./ponytail` annotations removed) + `scripts/e2e-coverage.test.mjs` (surface total 110 → 108).
    - **Evidence:** coding-tools package suite 640 pass / 1 skipped / 0 fail; `node-contribution-discovery` + `docs.test` 170 pass (demos execute, including the ported example); `docs.test` docs/link rules green; `live-doc-check` peer matrix green; `e2e-full-surface` packed journey green; `packaging` 73 pass; `dead-export-verify` / `sweep-unused` / `phase23-quality-gates` green; `npm run typecheck` (build + all workspaces + examples) green. Pre-existing and out of scope: `scripts/phase15-freeze.test.mjs` "baseline manifest count" fails at HEAD too — it is a retired gate (plan 057; `phase16-freeze.test.mjs` asserts it is not in the test chain).
    - **Deferred to Task 4 (on purpose, to avoid double-editing):** compat-baseline regen for `arnilo__prism-coding-tools.txt`/`arnilo__prism.txt` (`loadSkillDirectory`, the removed names), the 0.10.0 "zero removals" baseline bullet and its `@arnilo/prism` 1456 ceiling figure (now 1458), `docs/migration.md` 0.10.0 note, and the committed SBOM snapshot (CI regenerates it via `npm sbom`).

- [x] Task 3: Remove the graft integration from `@arnilo/prism-memory`
  - Acceptance Criteria:
    - Functional: `packages/memory/src/graft/` (commands, edit-watch, injector, skills, state, tools, types, upstream, cli, extension + `__tests__/`) and `fixtures/graft-package-fixture/` are deleted. The manifest loses the `./graft` subpath, both `@nanonets/graft` peer entries, the `graft` `files` entry, and the `dist/graft/__tests__` paths in `test`/`test:postgres`. `docs/graft.md` deleted; `docs/index.md` loses the graft graph commands line (37), the integration entry (226), and the `/graft` mention in the version table (260); `docs/release-and-install.md` loses the graft install row (~93) and subpath mentions (~27, 61); `docs/peer-dependencies.md` and `docs/live-testing.md` lose graft mentions; `examples/graft-extension.{ts,js}` deleted and `examples/README.md` updated; stale `examples/graft/.cache` dir removed.
    - Performance: memory tarball and optional-peer surface shrink; no runtime change (subpath was opt-in).
    - Code Quality: `grep -rn "prism-memory/graft\|@nanonets/graft\|graft-extension"` over `packages/`, `src/`, `scripts/`, `examples/`, `docs/` (excluding `docs/history/`, `docs/_evidence/`) returns only historical prose. `docs.test.ts` example list and any graft references updated; publish-handoff history asserts (~2462) untouched and still passing.
    - Security: removes the only manifest references to a third-party CLI dependency family.
  - Approach:
    - Documentation Reviewed:
      - Task 1 inventory; `docs/graft.md`; `docs/index.md`; `docs/release-and-install.md`; `docs/peer-dependencies.md`; `docs/live-testing.md`; `packages/memory/package.json`
    - Options Considered:
      - Keep a thin re-export that throws with a migration message — rejected: 0.x opt-in subpath; CHANGELOG note suffices.
      - Move graft bridge into the R4 hooks adapter — rejected: graft is a context-graph tool suite reachable via MCP; hosts needing native tools author them (the decision record).
    - Chosen Approach: Full removal; hosts use MCP or native tools.
    - API Notes and Examples:
      ```md
      <!-- CHANGELOG migration note shape -->
      Removed `@arnilo/prism-memory/graft`. Integrate graft via a host-exposed graft MCP
      server, or author native tools/commands with `registerTool`/`registerCommand`.
      ```
    - Files to Create/Edit:
      - `packages/memory/package.json`: remove subpath, peers, `files` entry, test paths.
      - `packages/memory/src/graft/`, `packages/memory/fixtures/graft-package-fixture/`: delete (dist cleaned by build).
      - `docs/graft.md`: delete. `docs/index.md`, `docs/release-and-install.md`, `docs/peer-dependencies.md`, `docs/live-testing.md`: de-mention.
      - `examples/graft-extension.ts`, `examples/graft-extension.js`, `examples/graft/`: delete. `examples/README.md`: update.
      - `src/__tests__/docs.test.ts`: coverage list update.
      - `CHANGELOG.md`: removal + migration note.
    - References: user decision 2026-09-19 (graft via MCP / host-native tools); plan 054 history (how `/graft` was folded in — history only).
  - Test Cases to Write:
    - Existing memory suites re-run green with graft tests gone (`npm test -w @arnilo/prism-memory`); `docs.test.ts` green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — one package subpath removed.
    - Docs pages to create/edit: deletions/de-mentions listed above.
    - `docs/index.md` update: yes — remove graft entries (3 locations).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Completion notes:
    - **Deleted:** `packages/memory/src/graft/` (cli, commands, edit-watch, extension, index, injector, skills, state, tools, types, upstream + 7 `__tests__` suites including `real-peer`), `packages/memory/fixtures/graft-package-fixture/` (stub `bin/graft.mjs`, `graft/INDEX.md`, `package.json` — the now-empty `fixtures/` dir is gone too), `docs/graft.md`, `examples/graft-extension.ts`. Stale `packages/memory/dist/graft/` was removed by hand — **`tsc` does not prune deleted sources**, so the pack would have shipped it; `npm run pack:dry-run -w @arnilo/prism-memory` now reports 294 files with zero `graft` matches.
    - **Manifest (`packages/memory/package.json`):** `./graft` export, the `@nanonets/graft` peer, its `peerDependenciesMeta` block, the devDependency, the `graft` keyword, the description's "Graft bridge", and the `dist/graft/__tests__/*.test.js` glob in both `test` and `test:postgres`. Plan corrections: there was **no** `graft` `files` entry (`files` = `dist`/`skills`/README/CHANGELOG/LICENSE) and no fixture entry to remove; `fixtures/` is packaging-only local tooling, not shipped.
    - **Lockfile:** `npm install --package-lock-only --ignore-scripts` → `-588` lines, exactly the `@nanonets/graft` subtree (tree-sitter\*, `openai`, `@anthropic-ai/sdk`, `standardwebhooks`, `gray-matter`, `js-yaml`, `esprima`, …); no workspace manifest references any of them any more. `+1` line is the memory peer object shrinking to `@arnilo/prism` only.
    - **SBOM (supersedes the Task 2 "defer to Task 4" note):** the committed `security-artifacts/sbom.spdx.json` carried the peer's 40-package subtree. `npm prune --ignore-scripts` uninstalled it locally, then `npm sbom --sbom-format spdx` was regenerated and `scripts/verify-sbom.mjs security/license-policy.json` passes: 174 → **134 packages**, zero `graft` / `nanonets` / `dietrichgebert` references (CI regenerates the same file from `npm ci`).
    - **Docs/scripts:** `docs/index.md` (the `/graft-*` command bullet and the third-party integrations entry removed; generated inventory now reads `/rag, /compaction/*, /fabric, /wiki`), `docs/release-and-install.md` (family prose + the graft install row removed, generated row regenerated), `docs/peer-dependencies.md` (matrix row, the bytes-local sentence, the extension-notes `/graft` resolver example, and the package-link list), `docs/live-testing.md` regenerated via `node scripts/generate-live-docs.mjs --write` after `scripts/live-matrix.json` lost its `memory/graft` leg (58 → 57 entries), `packages/memory/README.md`, `examples/README.md` (run list + demo index), `examples/tsconfig.json` (the `@arnilo/prism-memory/graft` path mapping), `src/__tests__/install-smoke.test.ts` (specifier), `src/__tests__/packaging.test.ts` (exports set now 9 keys; peer set asserted to be exactly `@arnilo/prism` with **no** `peerDependenciesMeta`; `dist/graft/index.js` dropped from the packed-file list), `src/__tests__/docs.test.ts` (example coverage list), `scripts/fixtures/e2e-full-surface-journey.mjs` (the memory leg is now wiki-only — the `redactPaths` assert went with the subpath), `scripts/e2e-coverage.json` (`./graft` annotation removed, no remaining references to deleted suites) + `scripts/e2e-coverage.test.mjs` (surface total 108 → 107), `scripts/package-truth.mjs` (memory note) + `--emit-docs` (regenerated `docs/index.md`, `docs/release-and-install.md`, `README.md`, `docs/provider-packages.md`, `docs/_evidence/phase54-package-map.md`, `scripts/package-truth.json`; counts unchanged at 12/11/20/4/7), `CHANGELOG.md` (0.10.0 `### Removed` entry: MCP server or host-native `registerTool`/`registerCommand` as the integration path).
    - **Budgets:** the non-null assertion rows were lowered to their sweep values per the ratchet rule — `examples` 34 → 29, `packages/memory/src` 229 → 199, `packages/prism-coding-tools/src` 275 → 270 (measured total 2185 against the unchanged 2225 ceiling) — with the removal recorded in the `$comment`. This also unblocked `scripts/budget-gate.test.mjs`'s positive control, which requires at least one allowlisted row to sit exactly at its measured count.
    - **Evidence:** `npm test -w @arnilo/prism-memory` 473 tests (468 pass, 5 skipped, 0 fail); root `docs.test` + `packaging.test` + `install-smoke.test` 243 pass / 0 fail; the `GATE_FILES` segment of `scripts/run-all-tests.mjs` 250 pass / 0 fail / 2 skipped (one earlier parallel run hit the timing-sensitive `benchmark-redaction` flake; green on re-run); `truth-current`, `e2e-full-surface`, `e2e-coverage`, `live-matrix`, `live-doc-check`, `scan-secrets`, `phase24-truth`, `sweep-unused`, `dead-export-verify`, `phase23-quality-gates`, `budget-gate` green; `npm run typecheck` (build + 11 workspaces + examples) green.
    - **Left as-is (historical or unrelated to the subpath):** the hardcoded `/graft` rows in `scripts/phase54-package-map.mjs` (plan-054 evidence generator, still the source for `phase54-legacy-registry.mjs`), the `hasGraftPackage` existence checks in `scripts/phase{24,27}-*.test.mjs`, the `packages/prism-graft` exclusion in `scripts/phase16-freeze.test.mjs`, `scripts/scan-secrets.mjs`'s `graft` ignore (the repo context-graph cache dir, not the subpath), and `.mcp.json` / `opencode.json` / `.grok/skills/graft` (dev tooling for the context graph). Not in the test chain and failing before this plan: `scripts/phase15-freeze.test.mjs` and `scripts/phase27-release.test.mjs` (the latter expects the 10-package 0.3.0 layout, now 12).
    - **Deferred to Task 4:** compat-baseline regen (`arnilo__prism-memory.txt` loses the 21 `graft/*` names, `arnilo__prism.txt` gains `loadSkillDirectory`/`LoadSkillDirectoryOptions` from Task 2), the memory export ceiling 934, `docs/migration.md:89`'s `@nanonets/graft` peer-range line, and the 0.10.0 "zero removals" / `@arnilo/prism` 1456 prose.

- [ ] Task 4: Baseline regeneration and 0.10.0 fold-in
  - Acceptance Criteria:
    - Functional: `node scripts/release.mjs gate --update-baseline` regenerates `scripts/compat-baseline/` files; the diff contains exactly this plan's removals (the two prism-coding-tools subpaths, the memory `/graft` subpath, optional-peer changes, and the promoted loader export if added) plus any inherited drift — inherited drift is enumerated in the task note and attributed, per the skill rule. `release:gate` green after regeneration. `node scripts/package-truth.mjs` refreshed; `docs/release-and-install.md` counts match. Full workspace `npm test` green. This plan precedes plan 106 Tasks 8–10.
    - Performance: n/a.
    - Code Quality: baseline diff reviewed line-by-line in the task note (no accidental export drops beyond the intended three subpaths).
    - Security: n/a.
  - Approach:
    - Documentation Reviewed: `scripts/release.mjs` gate usage; `scripts/compat-baseline/` layout; plan 106 Tasks 8–10; plan 084 Task 8 precedent (inherited-drift absorption).
    - Options Considered: defer regen to plan 106 — rejected: the skill rule requires this plan to own its removal baseline explicitly.
    - Chosen Approach: Regenerate here; plan 106 Task 9 re-verifies gate green at cut time.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs gate --update-baseline
      npm run release:gate
      ```
    - Files to Create/Edit: `scripts/compat-baseline/*` (regenerated), `scripts/package-truth.json`, `plans/106-…md` (note), `CHANGELOG.md` (if not already covered by Tasks 2–3).
    - References: skill rule (baseline regeneration on public-symbol removal); plan 083/084 history.
  - Test Cases to Write: `release:gate` green is the test.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (release plumbing over Tasks 2–3 removals).
    - Docs pages to create/edit: `docs/release-and-install.md` counts (from package-truth).
    - `docs/index.md` update: no (version table updates belong to plan 106's cut).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.
  - Absorbed 2026-09-23 by plan [115](../plans/115-Bun-Toolchain-Follow-Ups.md) Task 5 (this checkbox stays 107's to flip). Its baseline half landed there: `scripts/compat-baseline/{arnilo__prism,arnilo__prism-memory,arnilo__prism-coding-tools}.txt` regenerated through the gate's own `runGates({ updateBaseline: true })` (the CLI path is blocked — `checkReleaseEvidence` throws on nine missing coverage rows and `PRISM_TEST_POSTGRES_URL` before `runGates`, for `--update-baseline` too), the diff reviewed as a set comparison across the three files (+29/−127 lines; symbols removed 0/58/48, changed 7/0/14, added 5/0/3 — identical to the pre-regeneration measurement, so no export dropped beyond the intended three subpaths), the compat leg green (`{"version":"0.10.0","updated":false,"packages":12}`) and pinned by a new gate-suite test. Every removal is attributed name-by-name to this plan's Tasks 2–3 (106 of 106 traced into the `v0.10.0` graft/caveman/ponytail/upstream trees); the 21 changed signature lines (7/0/14) are inherited from plans 108/109/110 and additive. Full table and transcripts: `docs/_evidence/phase115-suite-budget.md` §12. Still owned here: `scripts/package-truth.json` refresh, `docs/release-and-install.md` counts, the cut-time `release:gate` run, and the changelog placement question — the removals sit under the `[0.10.0]` entry (lines 24–25) while the published 0.10.0 (tag `v0.10.0`) still ships both subpaths.

## Compromises Made
- To be filled after tasks are completed and tests pass.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
