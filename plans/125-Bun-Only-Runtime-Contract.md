# Bun-Only Runtime Contract

Plan 2 of 6 for the Bun-only migration (with [124](124-Bun-Only-Toolchain-And-Test-Runner.md),
[126](126-Bun-Native-Sqlite.md), [127](127-Bun-Runtime-Concurrency-Performance.md),
[128](128-Test-Import-Migration.md), [129](129-Release-0-12-0.md)). Depends on plan 124 (the toolchain is Bun-only first). This plan
flips the **consumer** contract: published packages target hosts that run the Bun runtime.

Two probed facts shape the registry boundary (verified on 1.4.2, 2026-09-25): `bun pack` does not
exist (`error: Script not found "pack"`), and `bun publish` has `--access`/`--otp` but no
`--provenance`. So npm stays the registry *toolchain* on the release host only — packing,
provenance publishing, and SBOM. It leaves the contributor and consumer paths entirely.

## Objectives

- All 12 publishable manifests declare `engines: { "bun": ">=1.4.2" }`; `engines.node` is gone.
  The npm registry is unchanged — hosts `bun add @arnilo/prism`.
- The compatibility contract ("imports every public export on the supported runtime") is measured
  on Bun, not Node 22: the host-composition consumer simulation installs tarballs with
  `bun install --offline` and runs the contract under `bun`.
- Generated scaffolds (`prism init`, `prism provider add`, dev hints) emit Bun commands.
- `docs/release-and-install.md` documents the Bun runtime matrix (1.4.x) and moves the Node
  22/24 support story to history; the release-host npm exception is stated where it lives.
- No public export is added, removed, or renamed; the compat baseline is not regenerated.

## Expected Outcome

- A host with Bun 1.4.2 installs and runs every Prism package; a host without Bun fails at install
  (`engines` warning) or at first `bun:`-dependent import (after plan 126), with an actionable
  message — never silently.
- `scripts/packaging-current.test.mjs` simulates a Bun consumer; `examples/host-composition-compat`
  runs under `bun install` from packed tarballs.
- The only npm/Node invocations in the repository are the release-host registry operations in
  `scripts/release.mjs` + `release.yml`'s publish job, each carrying a one-line comment naming the
  runner-image Node dependency.
- Docs, README, and scaffold output name Bun commands only.

## Tasks

- [x] Task 1: `engines` flip across the 12 publishable manifests
  - Acceptance Criteria:
    - Functional: root + 11 workspace manifests replace `engines.node` with
      `engines: { "bun": ">=1.4.2" }`. `packageManager: "bun@1.4.2"` already pins the contributor
      side (plan 113).
    - Functional: the missing-Node-warning trade-off is decided and recorded: dropping
      `engines.node` means an npm-under-Node install no longer warns. The compensating control is
      the fail-closed import message (this task verifies the current shape; plan 126 Task 2 owns
      its `bun:sqlite` rewrite). The decision and message text land in the task note.
    - Functional: `scripts/package-truth.mjs` and the version/literal gates pass with the new
      engines shape; `src/__tests__/docs.test.ts` phrase pins that require Node-matrix wording are
      updated in the same change (the immutable `phase12-freeze-manifest.json` is NOT edited — it
      is era evidence).
    - Performance: none (declarative field).
    - Code Quality: one engines shape, identical across manifests.
    - Security: `engines` is advisory install metadata only; no trust-boundary change.
  - Approach:
    - Documentation Reviewed: plan 113 Task 2 (`engines.node` retention rationale — now superseded
      by the owner's Bun-only decision); `scripts/package-truth.mjs` manifest walk;
      `docs/release-and-install.md` Node 22/24 matrix rows.
    - Options Considered: keep both `engines.node` and `engines.bun` — rejected: dual engines
      advertises a Node guarantee this migration deliberately drops; `os`/`cpu`-style hard
      `engines` enforcement does not exist for bun fields — accepted, warning + fail-closed import
      is the enforceable pair.
    - Chosen Approach: single `engines.bun`, warning at install, hard failure at import.
    - API Notes and Examples:
      ```json
      { "engines": { "bun": ">=1.4.2" } }
      ```
    - Files to Create/Edit: `package.json`, `packages/*/package.json` (11),
      `src/__tests__/docs.test.ts` (phrase pins), `scripts/package-truth.mjs` only if its walk
      asserts the old field.
    - References: `scripts/version-literal-gate.test.mjs` (manifest truth sweep).
  - Test Cases to Write:
    - A packaging-current assertion: every publishable manifest carries `engines.bun` and no
      `engines.node`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — install/runtime contract (breaking, 0.12.0).
    - Docs pages to create/edit: `docs/release-and-install.md` matrix (Task 4 owns the rewrite).
    - `docs/index.md` update: Task 4 (one sentence).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: Compatibility contract on Bun — consumer simulation and host composition
  - Acceptance Criteria:
    - Functional: `scripts/packaging-current.test.mjs` offline consumer legs install packed
      tarballs with `bun install --offline --no-audit` (flag support probed in plan 124 Task 1) and
      assert import + one call per package family under `bun`. `npm pack --dry-run` stays the
      tarball producer (registry host toolchain).
    - Functional: the `examples/host-composition-compat` packed-install contract runs under the
      Bun consumer (install + execution); its pinned-old-family delta leg keeps its env gates
      unchanged.
    - Functional: a `bun -e` (or examples-based) import sweep covers every public export of every
      package on Bun 1.4.2 — the successor to the Node 22 import guarantee — recorded as a
      transcript, not prose.
    - Performance: consumer-install time recorded once (evidence note) — no gate.
    - Code Quality: one consumer simulation, not two (no Node leg remains).
    - Security: offline installs only (no registry network from gates); tarball contents
      unchanged — `npm pack --dry-run` byte checks still pass.
  - Approach:
    - Documentation Reviewed: plan 124 Task 1 (`bun install --offline` probe row);
      `scripts/packaging-current.test.mjs` current `npm install --offline` legs;
      `examples/host-composition-compat.ts` env-gated legs.
    - Options Considered: keep an npm-consumer leg "for npm-installing hosts" — rejected: hosts
      install with any package manager but *run* Bun; the runtime contract is what is tested.
    - Chosen Approach: one consumer, Bun, offline, from packed tarballs.
    - API Notes and Examples:
      ```js
      spawnSync("bun", ["install", "--offline", "--no-audit", tarball], { cwd: tmp });
      spawnSync("bun", ["-e", `import("${name}").then(m => ...)`], { cwd: tmp });
      ```
    - Files to Create/Edit: `scripts/packaging-current.test.mjs`;
      `scripts/examples-execution.test.mjs` or the host-composition root suite (as the leg lives
      today); `docs/_evidence/phase125-bun-contract.md` (import-sweep transcript, new).
      **As executed (2026-09-25):** the leg lives in the host-composition root suite, so
      `scripts/examples-execution.test.mjs` was not touched; "one consumer simulation" also required
      `scripts/fixtures/packed-consumer.mjs` (shared by five e2e/journey suites),
      `src/__tests__/install-smoke.test.ts`, `scripts/post-publish-smoke.mjs`, the phase 26 live
      playwright install, and one stale `npm --offline` line in `docs/testing.md`.
    - References: plan 122's packed-install consumer contract suite (the pattern being re-pointed).
  - Test Cases to Write:
    - Consumer leg fails when a tarball import throws on Bun; passes for all 12 families offline.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — supported-runtime contract; docs in Task 4.
    - Docs pages to create/edit: `docs/_evidence/phase125-bun-contract.md` (evidence only).
    - `docs/index.md` update: no (Task 4).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Scaffolds and hint strings emit Bun commands
  - Acceptance Criteria:
    - Functional: `src/cli-init.ts` scaffold output and README template say `bun install`,
      `bun test`, `bun run start`; `src/cli-provider-add.ts` follow-up steps likewise;
      `src/cli-dev.ts` hint says `bun add --dev @arnilo/prism-coding-tools`. Generated
      `package.json` scaffolds carry `"packageManager": "bun@1.4.2"` (no engines guess — the
      scaffold's runtime is the host's).
    - Functional: repo-wide grep for retired strings: `npm install`, `npm test`, `npm start`,
      `npm i better-sqlite3` (the last one is plan 126's hint to delete, listed here so the sweep
      is planned once) across `src/`, `packages/`, `examples/`, `docs/`, `scripts/` — every live
      hit is flipped or explicitly attributed (frozen evidence files excluded).
    - Functional: scaffold tests (`cli-init`, `cli-provider-add` suites) assert the new strings.
    - Performance: none.
    - Code Quality: no conditional "npm or bun" output — one ecosystem, one string set.
    - Security: unchanged.
  - Approach:
    - Documentation Reviewed: `src/cli-init.ts:311-312,599-600`, `src/cli-provider-add.ts:51,154-155`,
      `src/cli-dev.ts:30` (current strings); their test suites.
    - Options Considered: detect the invoking package manager and mirror it — rejected: scaffolds
      target Bun hosts by this plan's contract; a detector is unrequested flexibility.
    - Chosen Approach: static Bun strings.
    - API Notes and Examples: `"  bun install", "  bun test"`.
    - Files to Create/Edit: the three CLI sources; their tests; any live docs row naming scaffold
      output (Task 4 sweep).
      **As executed (2026-09-25):** also `packages/prism-coding-tools/src/dev/cli.ts` (two runtime
      hints), all five `templates/*/package.json.tmpl` (Bun scripts, `packageManager`, `engines`
      deleted) and their README/optional-example templates, nine provider/work live-suite headers,
      three `examples/` files, twelve chain-prose comments/labels, and
      `scripts/tooling-gate.test.mjs` (the npm allowlist gate).
    - References: plan 113 Task 2 (the deliberately-then-kept `npm i better-sqlite3` hint —
      retired by this migration).
  - Test Cases to Write:
    - Scaffold assertions on the new strings; a grep gate (extend `scripts/tooling-gate.test.mjs`)
      fails on a new live `npm ` scaffold/hint string outside the release-host allowlist.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — CLI output contract changes.
    - Docs pages to create/edit: pages quoting scaffold output (found by the sweep), with Task 4.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Docs contract rewrite — Bun runtime matrix, Node story to history
  - Acceptance Criteria:
    - Functional: `docs/release-and-install.md` install table says `bun add @arnilo/prism …`; the
      support matrix is Bun `>=1.4.2` (1.4.x tested); a "Node runtime support retired in 0.12.0"
      paragraph moves the Node 22/24 story to `docs/history/` + `CHANGELOG.md` (never an API-page
      recap); the release-host npm exception (pack/publish/sbom on runner-preinstalled Node) is
      one sentence where the publish job lives plus one row in the release section.
    - Functional: `docs/index.md` navigation sentences match (no plan numbers, no version
      narrative); `src/__tests__/docs.test.ts` phrase pins follow in the same change.
    - Functional: `docs/testing.md` and `README.md` are already Bun-only from plan 124 Task 6 —
      this task verifies, not re-edits (one grep, zero diffs expected).
    - Performance: none.
    - Code Quality: one install-command voice across every page.
    - Security: install docs keep the `--frozen-lockfile`/audit guidance for hosts.
  - Approach:
    - Documentation Reviewed: `docs/release-and-install.md` current rows (`:71-117` install table,
      Node matrix); `docs/index.md` entries; `src/__tests__/docs.test.ts` pins.
    - Options Considered: keep npm install commands (they work under Bun hosts too) — rejected:
      the owner's consistency decision; mixed voice is exactly what this migration removes.
    - Chosen Approach: full rewrite of the install/runtime sections, history move for Node.
    - API Notes and Examples: `bun add @arnilo/prism @arnilo/prism-core`.
    - Files to Create/Edit: `docs/release-and-install.md`, `docs/index.md`,
      `docs/history/retire-node-runtime.md` (new, short), `src/__tests__/docs.test.ts`,
      `README.md` (consumer rows only).
      **As executed (2026-09-25):** also `CHANGELOG.md` (`### Removed` bullet under
      `[Unreleased]`), `docs/migration.md` (two era Node-floor lines marked retired),
      `docs/history/README.md` (archive index entry), `scripts/package-truth.mjs` (usage comment +
      emitted block header → `bun scripts/package-truth.mjs`, then regenerated the four doc blocks
      and the Phase 54 map with the same generator), `scripts/live-doc-check.test.mjs` (the peer
      matrix install column is `bun add` now), and 16 more live docs pages plus 6 package READMEs
      whose install lines moved to `bun add` (Task 3's further action).
    - References: plan 068 current-line rule (no release narrative in API pages).
  - Test Cases to Write:
    - Docs phrase test: no live page names `npm install @arnilo/prism` or a Node support matrix.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documented runtime contract.
    - Docs pages to create/edit: as listed.
    - `docs/index.md` update: yes.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5: Registry boundary — npm stays the release-host toolchain, documented and gated
  - Acceptance Criteria:
    - Functional: `scripts/release.mjs` keeps `spawnSync("npm", publishArgs(...))` (provenance,
      `--access public`, resume/skip logic unchanged) and every npm call site gains/keeps a
      one-line comment: "release-host registry toolchain — runner images ship Node; contributors
      never invoke npm". `release.yml` publish job keeps `npm pack`/`npm publish`/`npm sbom` with
      the same comment.
    - Functional: the decision record names the probed gaps (2026-09-25, Bun 1.4.2): no `bun pack`,
      no `--provenance` on `bun publish` — so `bun publish` is rejected, not merely deferred.
    - Functional: `npm view` registry-collision checks in `release.mjs` stay (registry read, not
      runtime).
    - Performance: publish path unchanged.
    - Code Quality: the exception list is exactly: pack, publish, sbom, view. Anything else found
      on npm is a bug this task fixes.
    - Security: `NPM_TOKEN`, `id-token: write`, attest-build-provenance step, SBOM verify gate —
      all unchanged. Supply-chain audit remains `bun audit` (plan 113).
  - Approach:
    - Documentation Reviewed: `scripts/release.mjs` (`publishArgs`, `regenerateLockfile`,
      registry reads); `release.yml` publish job (`:227-284`); Bun 1.4.2 `bun publish --help`
      transcript (no provenance flag) and `bun pack` failure transcript.
    - Options Considered: `bun publish` — rejected on the provenance gap (OIDC attestations are a
      shipped security artifact); dual publish path — rejected (one registry contract).
    - Chosen Approach: npm on the release host, everything else Bun.
    - API Notes and Examples:
      ```yaml
      # release-host registry toolchain (runner ships Node); contributors never invoke npm
      - run: npm publish --provenance --access public
      ```
    - Files to Create/Edit: `scripts/release.mjs` (comments only), `.github/workflows/release.yml`
      (comments), `docs/release-and-install.md` release section row (Task 4 same page, one edit).
      **As executed (2026-09-25):** the boundary comment landed at every npm call site, not only the
      publish one — `scripts/{packaging-current.test.mjs, office-golden-packed.test.mjs,
      budget-gates.mjs, release-gates.mjs, post-publish-smoke.mjs, fixtures/packed-consumer.mjs,
      phase54-legacy-registry.mjs}` and `security.yml` too; the retired npm hints in 18 scripts
      flipped to `bun …`; and `scripts/tooling-gate.test.mjs` gained the gate the Test Case asks for.
    - References: plan 113 Task 2 (`bun publish` rejection, superseded scope now explicit).
  - Test Cases to Write:
    - The tooling-gate npm allowlist from Task 3 also covers `scripts/` + workflows: any npm
      invocation outside {pack, publish, sbom, view} fails the gate.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (release plumbing comments + docs).
    - Docs pages to create/edit: folded into Task 4's page edit.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Execution Notes

- Task 5 (2026-09-25): npm is now the *documented, gated* release-host registry toolchain. The
  probes (Bun 1.4.2) are recorded in `scripts/release.mjs`'s header: `bun pack`, `bun dist-tag` and
  `bun deprecate` do not exist and `bun publish` has no `--provenance`, so `bun publish` is rejected
  (OIDC attestations are a shipped artifact) and pack/publish/sbom/view stay on npm. Every npm call
  site — nine in `scripts/` (pack ×7, publish ×1, the plan 054 legacy `view`/`dist-tag`/`deprecate`
  helper) and five workflow lines (`release.yml` pack ×2 + sbom ×2, `security.yml` sbom + pack ×2) —
  carries the plan's one-liner `// release-host registry toolchain — runner images ship Node;
  contributors never invoke npm`, and the supply-chain surface (`NODE_AUTH_TOKEN`, `id-token: write`,
  both attest steps, the SBOM verify gate, `bun audit`) is asserted unchanged by the new gate.
  Retired npm hints flipped to `bun …` in 18 scripts; the pinned skip-manifest surface NAME
  `core npm test` is the one named exception. The new gate in `scripts/tooling-gate.test.mjs`
  (`npm survives only as the release-host registry toolchain`) walks both npm spawn shapes plus every
  workflow npm line, allows only the registry ops, requires the boundary comment, rejects computed
  spawns that are not the declared `publishArgs`, and bans retired npm invocations in non-fixture
  scripts. Two planted negative controls fire (a non-registry op, a retired hint), and the second one
  found a real bug in the first draft of the scanner (the hint scan sat behind the "file spawns no
  npm" early exit, so it could never see a hint-only file) which is fixed. Verification: tooling-gate
  9/0; affected batch 91 pass / 3 fail (the three pre-existing phase27-release Plan-027 closeout
  rows); `bun run lint` clean; `live-matrix --check` and `post-publish-smoke --local` green; the one
  new red is a pre-existing stale generated artifact (`scripts/coverage-summary.json` still records
  `core.pass=false` from a run whose only failure was the plans-index test plan 124 Task 4 fixed).
  Evidence: `docs/_evidence/phase125-bun-contract.md` §5.
- Task 4 (2026-09-25): the live install/runtime contract is Bun. `docs/release-and-install.md`
  rewrote its 23-row install table to `bun add`, its tool rows to `bunx`, its support matrix to
  **Bun `>=1.4.2` + PostgreSQL** with a "**Node runtime support retired in 0.12.0**" pointer, its
  release commands to `bun scripts/release.mjs` / `bun scripts/scan-secrets.mjs` / `bunx biome`,
  and added the release-host npm exception (one publish-bullet sentence + one release-checklist
  row) plus the host `bun install --frozen-lockfile` / `bun audit` guidance. The Node 22/24 story —
  era matrix row, both measured CI legs, the 0.6.0 floor move, the 0.0.16 recorded compatibility
  matrix, and the advisory-`engines.bun` probe — moved to the new
  `docs/history/retire-node-runtime.md`, with the retirement recorded in `CHANGELOG.md`
  (`### Removed`) and the archive index. `docs/index.md`'s intro, release entry, and 0.6.0
  carried-line bullet were updated; `README.md` moved to `bun add`/`bunx`; the peer matrix and its
  `live-doc-check` assertions flipped in lockstep; 16 more pages and 6 package READMEs followed.
  `src/__tests__/docs.test.ts` extended the `releaseDoc()` live+archive union to the new page
  (presence-only), flipped the canonical `package-truth` token, and gained the new test
  `live pages carry one Bun install voice and no current Node support claim` (0 npm install lines
  across live pages, no Node support claim without a retirement marker, and >=50 `bun add` lines so
  the surface cannot go empty). Verification: docs suite 157/0 from source; affected gate batch
  86/0; the only failures in the wider batch are the three pre-existing phase27-release Plan-027
  closeout rows (workspacePackages 11 vs 9, publishable count, `operations.md` linked twice,
  roadmap 0.2.7). Evidence: `docs/_evidence/phase125-bun-contract.md` §4.
- Task 3 (2026-09-25): every scaffold and hint surface now emits Bun commands, and the generated
  project was run end-to-end on Bun to prove it (`bun install` → `bun run typecheck` → `bun test`
  → `bun run start`, transcript in evidence §3.2). Change set: `src/cli-init.ts` (hints + README
  next steps), `src/cli-provider-add.ts`, `src/cli-dev.ts` (`bun add --dev`),
  `packages/prism-coding-tools/src/dev/cli.ts` (two runtime hints), all five
  `templates/*/package.json.tmpl` (`bun run build && bun test …`, `bun dist/index.js`,
  `"packageManager": "bun@1.4.2"`, **engines deleted**), five template READMEs plus two optional
  example headers, nine provider/work live-suite headers, three examples, twelve chain-prose
  comments/labels, and the three CLI test suites (which now also assert the new strings and the
  scaffold's manifest shape). New gate: `tooling-gate`'s `scaffolds and hint strings emit Bun
  commands only` — `src/cli-*.ts` + `templates/**/*.tmpl` may only mention npm as a release-host
  registry op (`pack|publish|sbom|view`) or npm naming-rule prose, with positive/negative fixtures
  and a non-vacuity assertion. The retired-string census (392 hits / 124 files) is bucketed in
  evidence §3.3: frozen era evidence excluded, docs pages attributed to Task 4, the pinned
  `core npm test` surface label and fixture-DATA strings attributed with reasons. Verification:
  CLI suites 27/0, tooling-gate 8/0, root suite 2122 tests / 0 fail, gate stage 290 tests / 0 fail.
- Task 2 (2026-09-25): the consumer simulation is Bun everywhere a tarball is installed. The
  surfaces converted: `packaging-current.test.mjs` (the npm root-tarball canary became one Bun
  consumer leg — all 12 tarballs packed with `npm pack --workspaces`, installed once with
  `bun install`, then a single `bun -e` sweep importing **110 public subpaths across 12 packages**
  plus one call per package, with an unknown-subpath positive control), the shared
  `scripts/fixtures/packed-consumer.mjs` (used by the three e2e journeys, the phase 26 journey and
  the host-composition suite), `src/__tests__/host-composition-compat.test.ts` (family tarballs
  installed on Bun; the contract and the Task 5/7 fixtures now run with `bun` **by name** instead of
  `process.execPath`, so a Node-hosted runner can no longer execute them; the pinned-old-family leg
  installs on Bun with its env gates and skip-on-unavailable behaviour unchanged),
  `install-smoke.test.ts` (its install leg, not its npm-resolver `ERESOLVE` metadata test),
  `post-publish-smoke.mjs`, the phase 26 live playwright install (`bun add --no-save`), and one
  stale `npm --offline` line in `docs/testing.md`. Measured: `bun install --offline` cannot resolve
  third-party ranges from a cold cache (probed: an empty cache fails, and a CI-style fresh cache
  populated by `bun install --frozen-lockfile` still has no manifests), so every leg is offline-first
  with a `--prefer-offline` retry — first-party content always comes from the tarballs, asserted by
  reading the consumer lockfile (12/12 `@arnilo/*` resolutions point at the staging tarballs).
  Verification: packaging-current 41/0 (install 148 ms offline), host-composition 3 pass/1 skip/0,
  install-smoke 15/0, three e2e journeys 5/3/3 pass, `post-publish-smoke --local` PASS, root suite
  2121 tests / 0 fail. Evidence: `docs/_evidence/phase125-bun-contract.md` §2.
- Task 1 (2026-09-25): root + 11 workspace manifests now declare
  `"engines": { "bun": ">=1.4.2" }` (one shape, twelve files) and the two declared Node CI legs
  retired with the flip — `release.yml` lost `setup-node`, the `node22-compat` job and the Node 24
  public-import smoke, `scripts/public-import-smoke.mjs` was deleted, and `publish` `needs:` is now
  the five remaining jobs. The immutable `scripts/phase12-freeze-manifest.json` was not touched:
  `phase12-freeze.test.mjs` now asserts the era record keeps `enginesRange: ">=22"` *and* that the
  live manifests/workflow carry no Node declaration, and `workflow-liveness.test.mjs` asserts no
  workflow sets up Node or executes `node`. Test cases: `packaging-current.test.mjs` gained the
  twelve-manifest `engines.bun`/no-`engines.node` assertion, `phase24-truth.test.mjs` switched the
  lockstep from `engines.node` to `engines.bun`, and `docs.test.ts` reads the era Node floor from the
  freeze manifest for the page's 0.1.x matrix wording. Verification: root suite 2121 tests / 167
  files / 0 fail, gate suite 289 tests / 4 fail (all pre-existing in-flight rows: biome diagnostics
  in `packages/prism-core/src/runtime/workflows/**`, phase54 map ×2, compat baseline), task-owned
  gates green. Evidence: `docs/_evidence/phase125-bun-contract.md` §1.
- Task 1 decision record — **the missing-Node warning trade-off**. Dropping `engines.node` removes
  the npm `EBADENGINE` warning a Node host used to see; `engines.bun` does **not** replace it,
  because neither npm 12 nor Bun 1.4.2 enforces a `bun` engines key (probed 2026-09-25: a packed
  package with `engines.bun >=99.0.0` installs silently under `npm install`, `bun add`, and as a
  root manifest). `engines` is therefore advisory documentation, and the compensating control is the
  **fail-closed import**, not an install warning: the first `bun:`-dependent import must throw an
  actionable message instead of Node's raw `ERR_UNSUPPORTED_ESM_URL_SCHEME`. Today's shape has no
  `bun:` import at all, so a Node host runs the 0.12.0 packages with no error — honest, because the
  declaration is only as strong as plan 126's driver. **Message text for plan 126 Task 2** (at the
  sqlite driver's entry point): `@arnilo/prism requires the Bun runtime (engines.bun >=1.4.2): the
  durable storage layer imports "bun:sqlite". Run this program with \`bun\` (https://bun.sh), or pin
  a Node-compatible Prism release (0.11.x or earlier).` No 0.12.0 tarball reaches the registry before
  plan 129's cut, so the declaration-only window is never user-visible.

## Compromises Made

- Task 5 extended the gate's registry allowlist to six ops, not the plan's four: `dist-tag` and
  `deprecate` are used by `scripts/phase54-legacy-registry.mjs` (plan 054's legacy distribution-tag
  and deprecation retirement path, exercised through the `PRISM_LEGACY_NPM` fixture seam). They are
  registry *mutations* like `pack`/`publish`, and Bun has no equivalent (`bun dist-tag` and
  `bun deprecate` both return `error: Script not found`), so the honest allowlist names them.
- Task 5 left the pinned skip-manifest surface NAME `core npm test` alone and named it as a gate
  exception. The label is a *surface identifier* pinned by `scripts/phase23-skip-manifest.test.mjs`,
  not an invocation; renaming it is a cross-file data change (manifest + emitter + pin + evidence
  format) that this task did not need to make.
- Task 5 kept `src/__tests__/install-smoke.test.ts`'s npm `ERESOLVE` peer-window describe (plan 125
  Task 2's compromise): Bun only warns on peer mismatches, so npm's fail-closed resolver is the test's
  subject. The new gate scopes to `scripts/` + workflows, so that publishing-metadata check is
  unaffected; anything else found on npm inside `src/` would still be a bug, just not this gate's.
- Task 5 did not flip the `node scripts/…` usage-header comments in the benchmark and utility scripts
  (`benchmark*.mjs`, `e2e-coverage-gate.mjs`, `generate-live-docs.mjs`, `verify-audit-export.mjs`,
  `phase54-legacy-registry.mjs`, …). They are invocation *hints* for local runs, not npm, and Task 4
  already recorded the broader command-transcript wording pass as its own action.
- Task 5 recorded, but did not fix, the stale `scripts/coverage-summary.json` core row: the artifact is
  generated (untracked) and its current `core.pass=false` came from a run whose only failure was the
  plans-index docs test that plan 124 Task 4 fixed. Regenerating it needs the build lock, which another
  agent's run held throughout this task.


- Task 4 moved the Node story to `docs/history/retire-node-runtime.md` and extended
  `releaseDoc()`'s live+archive union to include it instead of keeping the era phrases on the live
  page. That union is the file's own documented escape hatch for a live→archive split ("presence
  asserts read the live+archive union so frozen phrases survive the split; absence asserts keep
  reading the live file only"), so the 0.1.x-era gates still pin their recorded phrases without the
  current page recapping a retired runtime.
- Task 4 left the `docs/index.md` "Carried from the 0.x line" narrative (and its plan references)
  alone. That section *is* the version narrative the acceptance warns about; the pages Task 4 owns
  are the navigation entries, and rewriting the carried-line history is a separate editorial pass
  with no gate behind it.
- Task 4 regenerated `docs/_evidence/phase54-package-map.md` as a side effect of the generator
  string flip (`bun scripts/package-truth.mjs --emit-docs` writes all five targets). That file was
  already stale in the working tree from in-flight work; the regeneration is the honest form of the
  edit and it turned the phase54 gate row green.
- Task 4 left the benchmark/script transcripts (`docs/performance.md`, `docs/mcp-tools.md`,
  `docs/disaster-recovery.md`, `docs/attention-compiler.md`) on their recorded `node scripts/…`
  commands, and `docs/impeccable.md` on its third-party `npx impeccable` line plus its "no `npx` on
  import" security claim. Those are measurement records and third-party tool guidance, not Prism
  install/runtime voice; a separate wording pass owns them.
- Task 4 did not flip `scripts/release.mjs`'s own error-hint strings (`run node scripts/release.mjs
  gate --update-baseline`), which still read npm-era. That file is Task 5's (comments-only) surface,
  and its hint is pinned by `scripts/release-gate.test.mjs`; the docs page now names the Bun form, so
  the hint flip belongs with Task 5's comment pass (recorded below).


- Task 3 deleted the five template `engines` blocks instead of rewriting them to
  `"engines": { "bun": ">=1.4.2" }`. A scaffold runs on the host that installed it, so pinning a
  runtime would be a false promise (and `engines.bun` is not enforced by npm or Bun — Task 1's
  probe); `"packageManager": "bun@1.4.2"` records the toolchain the scaffold's own commands assume
  without claiming a runtime floor. The published packages keep `engines.bun` because *their*
  runtime contract is real.
- Task 3 flipped the scaffold and hint surfaces plus chain-prose wording, and **attributed** the
  remaining `npm install` hits instead of sweeping them: 41 docs pages/package READMEs (86 hits)
  are the docs pass Task 4 owns, the `core npm test` surface label is pinned by
  `phase23-skip-manifest.test.mjs`, and nine hits are fixture DATA (a guarded shell command, chat
  messages) where `npm test` is payload, not an instruction. Frozen baselines/manifests/CHANGELOG
  are excluded by the plan. The full bucket table is evidence §3.3, so the sweep cannot silently
  regress into "we grepped once".
- Task 3 left `scripts/live-doc-check.test.mjs`'s `assert.ok(row.install.startsWith("npm i "))`
  alone. It parses `docs/peer-dependencies.md`'s peer matrix, which Task 4 rewrites; flipping the
  assertion now would fail until the page moves with it (recorded as a further action so the pair
  lands together).
- Task 3's format check still reports six files, all in the in-flight Plan 130 work
  (`examples/cyclic-reflection.ts`, `packages/prism-core/src/runtime/workflows/**`). One of them,
  `examples/cyclic-reflection.ts`, carries a single flipped string from this task; it is an
  untracked in-flight file, so it was not reformatted wholesale.


- Task 2 kept the plan's *offline* requirement as offline-**first** rather than offline-only:
  `bun install --offline` cannot resolve third-party ranges without cached manifests, and a fresh
  CI cache has none (probed: `bun install --frozen-lockfile` on a fresh cache then
  `bun install --offline <tarballs>` → 39 `no cached manifest` errors). The retry is
  `--prefer-offline`, which is stricter than the npm-era fallback it replaces (cache first instead
  of an unrestricted install) and cannot substitute first-party content: the consumer lockfile is
  asserted to resolve all twelve `@arnilo/*` packages from the packed tarballs.
- Task 2 converted five surfaces beyond the plan's file list (`packed-consumer.mjs`,
  `install-smoke.test.ts`, `post-publish-smoke.mjs`, the phase 26 live playwright install, and one
  stale `docs/testing.md` line) because the acceptance criterion is "one consumer simulation, not
  two": leaving any of them on npm would have kept an npm consumer leg for the runtime contract the
  plan just moved to Bun. The one npm install left in a test is `cli-init.test.ts`'s
  generated-scaffold install, which Task 3 owns with the scaffold commands.
- Task 2 left `install-smoke.test.ts`'s peer-window `ERESOLVE` test on npm. It is not a runtime
  consumer leg: it asserts npm's resolver policy for an out-of-window peer range, and Bun does not
  implement that policy (it warns instead of failing), so converting it would have deleted a
  publishing guarantee rather than moving one.
- Task 2's sweep passes on Node today as well as Bun, and that is recorded rather than hidden:
  nothing in the tree imports a `bun:`-only module yet, so the import contract is currently
  runtime-agnostic and becomes Bun-only with plan 126's `bun:sqlite` driver. The gate is still
  fail-closed (unknown subpath rejected, non-zero exit on any failure).


- Task 1 retired the two declared Node CI legs (`release.yml`'s Node 24 smoke and the
  `node22-compat` job, plus `scripts/public-import-smoke.mjs`) even though Task 1's file list named
  only the manifests and doc pins. The legs existed solely because `engines.node >=22` was declared
  (plan 124's Compromises named this task as their retirement point); keeping them after the flip
  would have measured a contract the packages no longer declare, and they would have gone red as soon
  as plan 126 introduces `bun:sqlite`. The published 0.11.x line on the registry keeps its own Node
  declaration in its own tarballs, so nothing published is affected.
- Task 1 edited two era gates instead of the era record: `phase12-freeze.test.mjs` and
  `workflow-liveness.test.mjs` previously asserted that the *live* tree matched the frozen 0.1.x Node
  matrix. They now assert the frozen record is intact **and** that the live tree declares Bun only —
  the record stays immutable, and the check that used to compare live-vs-era became a check that the
  migration happened (a stricter statement about the live tree, not a removed assertion).
- `engines` is declaration-only on this toolchain (probed: npm and Bun 1.4.2 both ignore
  `engines.bun`). The plan's expected "warning at install" does not exist, so the accepted pair
  becomes "declaration + fail-closed import message" with the message implemented by plan 126 Task 2;
  `docs/release-and-install.md` states the runtime requirement where a host will look for it.
- `docs/release-and-install.md` got a minimal honesty pass rather than the full rewrite: the runtime
  matrix, the release-workflow/CI paragraphs, the release-checklist paragraph and the `@types/node`
  rationale were corrected here so the page does not contradict the manifests, and plan 125 Task 4
  still owns the install-table rewrite, the `docs/history/` move and the release-host row.
- `templates/*/package.json.tmpl` still declare `engines.node`. Task 3 owns scaffold output and
  removes the engines guess entirely (a scaffold inherits its host's runtime), so the five templates
  were left untouched rather than edited twice.

## Further Actions

- **Homed: plan 126 Task 4.** Regenerate `scripts/coverage-summary.json` (`bun run coverage:summary`) once the build lock frees, so
  the phase23-coverage "real artifact is well-formed" row reports the current suite. The row is stale,
  not a gate change — the plans-index failure it recorded is fixed.
- **Homed: plan 129 Task 2.** The `node scripts/...` usage headers in the benchmark and utility scripts are still Node-voiced
  (`node scripts/benchmark.mjs`, `node scripts/verify-audit-export.mjs`, …). They are local-run hints
  rather than stage runners, so no gate fails on them, but a single wording pass over `scripts/*.mjs`
  usage comments would finish the migration voice.
- **Homed: plan 128 Task 2.** `src/__tests__/install-smoke.test.ts`'s npm `ERESOLVE` describe is the last npm *resolver* test in
  the repo. If a future plan wants a Bun-only tree, replace it with a metadata assertion (the manifest
  peer range) rather than the resolver transcript — a behavioural equivalent does not exist on Bun.
- **Standing rule, no task.** The gate's `scripts/fixtures/` and `*.test.mjs` exclusions are deliberate (fixture data and era
  gates), so a retired npm string inside a *test* file is only caught by that file's own pins. If the
  fixture-data distinction ever blurs, extend the scan with an explicit allowlist rather than widening
  the exclusion.
- **Homed: plan 129 Task 2** (with the era-transcript rule: a recorded measurement keeps its command and gains a marker). A wording pass should move the benchmark and script transcripts in `docs/performance.md`,
  `docs/mcp-tools.md`, `docs/disaster-recovery.md`, and `docs/attention-compiler.md` to `bun …`
  forms; they record how each measurement was taken, and `docs/performance.md` alone carries six
  `node scripts/benchmark…` commands.
- **Homed: plan 129 Task 2.** `docs/migrate-to-*.md` still describe the era's install lines for hosts upgrading from 0.5–0.10
  (`docs/history/migrate-to-0.4.md` is archived). If a later plan wants one install voice across
  migration guides too, those pages need a per-era pass — the live guides currently carry no
  `npm install @arnilo/prism` line, so the new gate does not fail on them.
- **Done (Task 4).** `packages/*/README.md` now say `bun add` for Prism packages and their peers. If a host that
  installs with npm is still in scope for a future release, the READMEs are where the install line
  and the runtime claim would diverge — decide the audience before the next docs pass.
- **Done (Task 4, 2026-09-25).** The consumer-install flip landed: `npm install @arnilo/prism` -> `bun add @arnilo/prism` across the remaining docs
  pages and package READMEs (`npm install @arnilo/prism` → `bun add @arnilo/prism`, 86 hits in 41
  files), including `docs/peer-dependencies.md`'s peer matrix **together with**
  `scripts/live-doc-check.test.mjs`'s `startsWith("npm i ")` assertion and any `docs.test.ts` phrase
  pin that quotes those rows. Until then those pages still describe the npm install path.
- **Homed: plan 129 Task 3.** The `core npm test` surface label in `scripts/release-skip-manifest.mjs` (and its pin in
  `phase23-skip-manifest.test.mjs`) can be renamed to `core bun run test` in a change that updates
  both files plus the skip-manifest evidence format.
- **Covered by plan 126 Task 2's acceptance; zero live hits today.** Plan 126 Task 2 should delete the `npm i better-sqlite3` hint if it lands anywhere; this sweep
  found zero live occurrences, so the hint is already gone from the contributor path.
- **Done (Task 4).** The audience decision: the published READMEs carry the `bun add` line (enforced by `docs.test.ts`'s one-voice test) and a host that installs with npm keeps the recorded npm transcript on the history page. Task 4 should also decide whether `packages/*/README.md` (published in the tarballs) get a Bun
  install line in this release or keep the npm form for hosts that install with npm — the packages
  *run* on Bun, but the README is read before installation.
- **Standing rule, no task.** Task 3's scaffold tests are the regression guard for scaffold strings; if Task 6's docs pass
  re-quotes scaffold output anywhere, those quotes must match the template text byte-for-byte
  (stale-pin lesson).
- **Done (Task 3).** Task 3 must flip `src/__tests__/cli-init.test.ts`'s generated-project install
  (`runInProject("npm", ["install"])`) together with the scaffold command strings it asserts — it is
  the last npm consumer install in the tree, and the scaffold it validates is Task 3's own output.
- **Done (Task 5).** Task 5's registry boundary should confirm `scripts/post-publish-smoke.mjs`'s install stays Bun
  (converted here) and keep the `npm pack`/`publish`/`sbom`/`view` exception untouched.
- **Homed: plan 129 Task 3** (re-measure during the readiness run and update the page, or drop the timings). The pinned-old-family rehearsal numbers in `docs/testing.md` (≈9 s registry route, ≈11 s offline
  route) were measured on the npm consumer; Task 4's page pass should re-measure them on the Bun
  consumer or drop the timings.
- **Homed: plan 126 Task 2** (the message was already in its acceptance; the Node-side transcript bullet was added 2026-09-26). Plan 126 Task 2 must implement the recorded fail-closed message at the sqlite driver entry point
  (exact text in the Task 1 note above) and add the Node-side transcript that proves a Node host gets
  the actionable line instead of `ERR_UNSUPPORTED_ESM_URL_SCHEME`. Until it lands, `engines.bun` is a
  declaration with no runtime enforcement anywhere.
- **Done (Task 3).** Task 3 should flip or delete the five `templates/*/package.json.tmpl` `engines` blocks in the same
  change as the scaffold command strings, so `prism init` output and this repo's manifests agree.
- **Done (Task 4).** Task 4 should retire the 0.1.x matrix rows this task marked as era text (the Node row, the two
  release-workflow paragraphs) into `docs/history/` and pin the new Bun matrix instead of the era
  floor, so `docs.test.ts` stops reading the freeze manifest for page wording.
- **Standing rule, no task** (reinforced in plan 129 Task 2's pass). `docs/migrate-to-0.6.md`, `docs/migration.md`, `docs/index.md`'s "Carried from the 0.6.0 line"
  bullet and the frozen phase-12 record keep their Node wording on purpose — they describe the 0.6.0
  cut and the 0.1.x era, not the live contract. A future docs pass should not "fix" them.
