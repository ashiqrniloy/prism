# Behavior Integration and Graft Removals

Removes the first-class Ponytail, Caveman, and Graft integrations so hosts provide their
own implementations through public extension APIs, external MCP servers, or host-authored
native tools. Everything here is opt-in surface; nothing is default behavior. Removals ship
with 0.10.0 (plan 105 owns the cut; this plan must complete before plan 105's release-cut
task, after plan 106's implementation tasks or in parallel with them).

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
  (not inherited); all removals ship in 0.10.0 via plan 105.

## Tasks

- [ ] Task 1: Removal inventory — exact export surface and every consumer
  - Acceptance Criteria:
    - Functional: An inventory recorded in this task's completion notes lists, per removal: (a) the exact public exports of each subpath (from `dist/*.d.ts`/source index), (b) every consumer found by repo-wide search — `grep -rn "prism-coding-tools/caveman\|prism-coding-tools/ponytail\|prism-memory/graft\|@dietrichgebert/ponytail\|@nanonets/graft"` across `packages/`, `src/`, `scripts/`, `examples/`, `docs/` (excluding `docs/history/` and `docs/_evidence/`), and `plans/00x` archives, and excluding the `graft/` context-graph directory itself (generated output, kept — refresh it with `graft build` after Tasks 2–3 land), (c) confirmation that nothing outside `packages/prism-coding-tools` and `packages/memory` imports the subpaths (expected: none, verified above for `/graft`), (d) the exact diff between `ponytail:`/`caveman` *code-comment markers* (an unrelated repo convention — e.g. `src/__tests__/docs.test.ts:250`, `packages/prism-coding-tools/src/agent/*.ts`) and the behavior-package artifacts this plan removes. The inventory decides whether a public `loadSkillDirectory(dir)`-style bounded skill-directory loader should be promoted from the deleted `upstream.ts` into `@arnilo/prism` (recommendation: yes, one export, keeps "host reimplements with zero compromise" literally true; it unblocks the ported example).
    - Performance: n/a (inventory).
    - Code Quality: The inventory names every file each later task will touch so Tasks 2–5 have zero discovery work.
    - Security: Confirms the removed optional peers (`@dietrichgebert/ponytail`, `@nanonets/graft`) appear nowhere else in Prism manifests or lockfile-anchoring package.jsons.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-coding-tools/package.json` (subpaths at lines 36–42, peers 70–87, `files` 115–116), `packages/memory/package.json` (`./graft` at 40, peers 67–80, `files` 103, test scripts 61–62)
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

- [ ] Task 2: Remove Ponytail and Caveman from `@arnilo/prism-coding-tools`; port the example
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

- [ ] Task 3: Remove the graft integration from `@arnilo/prism-memory`
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

- [ ] Task 4: Baseline regeneration and 0.10.0 fold-in
  - Acceptance Criteria:
    - Functional: `node scripts/release.mjs gate --update-baseline` regenerates `scripts/compat-baseline/` files; the diff contains exactly this plan's removals (the two prism-coding-tools subpaths, the memory `/graft` subpath, optional-peer changes, and the promoted loader export if added) plus any inherited drift — inherited drift is enumerated in the task note and attributed, per the skill rule. `release:gate` green after regeneration. `node scripts/package-truth.mjs` refreshed; `docs/release-and-install.md` counts match. Full workspace `npm test` green. Sequencing note appended to plan 105 and plan 106 files: this plan precedes plan 105's release-cut task.
    - Performance: n/a.
    - Code Quality: baseline diff reviewed line-by-line in the task note (no accidental export drops beyond the intended three subpaths).
    - Security: n/a.
  - Approach:
    - Documentation Reviewed: `scripts/release.mjs` gate usage; `scripts/compat-baseline/` layout; plan 105 release-cut task; plan 084 Task 8 precedent (inherited-drift absorption).
    - Options Considered: defer regen to plan 105 — rejected: the skill rule requires this plan to own its removal baseline explicitly.
    - Chosen Approach: Regenerate here; plan 105 verifies gate green at cut time.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs gate --update-baseline
      npm run release:gate
      ```
    - Files to Create/Edit: `scripts/compat-baseline/*` (regenerated), `scripts/package-truth.json`, `plans/105-…md` (note), `plans/106-…md` (note), `CHANGELOG.md` (if not already covered by Tasks 2–3).
    - References: skill rule (baseline regeneration on public-symbol removal); plan 083/084 history.
  - Test Cases to Write: `release:gate` green is the test.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (release plumbing over Tasks 2–3 removals).
    - Docs pages to create/edit: `docs/release-and-install.md` counts (from package-truth).
    - `docs/index.md` update: no (version table updates belong to plan 105's cut).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- To be filled after tasks are completed and tests pass.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority.
