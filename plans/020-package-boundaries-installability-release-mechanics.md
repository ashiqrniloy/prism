# Phase 17 — Package Boundaries, Installability, and Release Mechanics

Tracks roadmap Phase 17: prove the published tarballs contain only what users need
and install cleanly, without changing Prism's public runtime behavior.

## Objectives

- Publish only compiled public output, release files, and shipped docs from the
  core `prism` package and every first-party workspace package; never publish
  built tests, source maps, plans, fixtures, or internal generated output.
- Add the release files and metadata npm consumers and registries expect:
  `LICENSE`, `CHANGELOG.md`, `repository`, `bugs`, `homepage`, `license`,
  `keywords`, and `sideEffects`.
- Make the `prism` peer dependency of every first-party package non-optional so
  installers cannot silently end up with a provider/compaction package that has
  no core to plug into.
- Prove installability with network-free pack-contents, dependency-tree, and
  fresh-tarball import smoke checks for core, every exported subpath, and every
  first-party workspace package.
- Add a minimal, reusable release/dry-run workflow for core plus first-party
  packages.
- Pin (or consciously revise) the default no-network test time budget.

## Expected Outcome

- `npm pack --dry-run --json` for core and every first-party package lists only
  `dist` public output (no `__tests__`, no `*.map`, no `*.tsbuildinfo`), plus
  `README.md`, `LICENSE`, `CHANGELOG.md`, and (for core) the `/docs` hub.
- `npm ls --all --depth=0` exits clean in the workspace.
- A fresh `npm install` of the packed tarballs in a temp directory lets a
  consumer dynamic-`import` every documented core subpath and every first-party
  package by specifier, with no workspace-relative paths leaking into imports.
- A CI workflow runs the full build/type/test/pack/import gauntlet on every push
  and can publish from a tag.
- Default tests stay network-free and finish within the recorded budget.
- `/docs` documents release/install behavior and links it from `docs/index.md`.

## Tasks

- [x] 1. Publish-time file hygiene: exclude tests, maps, and stray files from every tarball
  - Acceptance Criteria:
    - Functional: `npm pack --dry-run --json` for `prism` and each
      `packages/*` package contains zero entries under `dist/__tests__/` and
      zero `*.map` / `*.tsbuildinfo` entries; core still publishes its public
      `dist/*.js`/`*.d.ts` and `bin`; packages still publish their public
      `dist/index.*`.
    - Performance: total packed core tarball size does not grow; removing maps
      and tests yields a measurable reduction versus current `files: ["dist"]`.
    - Code Quality: exclusion mechanism is the standard npm `files` whitelist;
      no workspace-relative `require`/`import` paths appear in shipped output.
    - Security: no plans, fixtures, `.agents/`, `roadmap.md`, `skills-lock.json`,
      `tsconfig*.json`, or source `.ts` files are published; `packages/*`
      workspace sources are never packed into the core tarball.
  - Approach:
    - Documentation Reviewed:
      - npm `package.json` `files` field and always-included list
        (https://docs.npmjs.com/cli/v10/configuring-npm/package-json/): `files`
        is a minimatch include whitelist; `package.json`, `README`, `LICENSE`,
        `main`, and `bin` are always included; `CHANGELOG` should be listed
        explicitly to be deterministic across npm versions.
      - npm `.npmignore` / Files & Ignores
        (https://github.com/npm/cli/wiki/Files-&-Ignores): `.npmignore` and
        `.gitignore` exclusions do **not** override entries matched by the
        `files` whitelist; the `files` array is the final authority.
      - npm/cli #2009 and #2441: negation inside the `files` array was buggy in
        npm v7 but works in npm 10+ (verified with npm 11.13); the repo
        requires `node >=20` / npm 10+, so `files` negation is safe.
      - npm lifecycle scripts (https://docs.npmjs.com/cli/v10/using-npm/scripts/):
        `prepack` runs on `npm pack`, `npm publish`, and git-dependency install.
    - Options Considered:
      - `.npmignore` per package: rejected after empirical verification — it
        cannot exclude files inside a directory whitelisted by `files`.
      - Split the build so tests compile to a separate dir and `dist` never
        contains them: rejected — adds tsconfigs and changes the test flow; more
        moving parts than a `files`-level exclusion.
      - Positive glob whitelist (`dist/**/*.js`, `dist/**/*.d.ts`): works but is
        verbose and must be updated for every new subpath.
      - `files` negation (`!dist/__tests__`, `!dist/**/*.map`) with the existing
        `files: ["dist"]` whitelist: chosen — minimal diff, no test-flow change,
        works in all supported npm versions.
    - Chosen Approach:
      - Core `package.json` `files`: `["dist", "!dist/__tests__",
        "!dist/**/*.map", "docs"]` (README/LICENSE auto-included; `docs` ships
        the API docs hub; `CHANGELOG.md` deferred to Task 2).
      - Each `packages/*` `package.json` `files`: `["dist", "!dist/__tests__",
        "!dist/**/*.map", "README.md"]` (README explicit for robustness).
      - Source maps stay emitted for local debugging (`tsconfig` sourceMap
        unchanged) but are stripped from every tarball; record this as a
        deliberate default in CHANGELOG/docs (knob: remove `!dist/**/*.map` to
        retain maps for a debug build).
      - No `.npmignore` files added — they are irrelevant once `files` is the
        authority and would only confuse future maintainers.
      - Existing boundary tests that asserted the old minimal `files` arrays
        (`["dist", "README.md"]`) were updated to assert the new, explicit
        arrays.
    - API Notes and Examples:
      ```bash
      # verify contents for every published package
      npm run build
      node -e '
      const { execSync } = require("child_process");
      const { resolve } = require("path");
      const pkgs = [".", ...["provider-openai","provider-opencode-go","provider-openrouter","provider-zai","provider-kimi"].map(n=>"packages/"+n), "packages/compaction-llm", "packages/compaction-observational-memory"];
      for (const d of pkgs) {
        const out = execSync("npm pack --dry-run --json", { cwd: resolve(d), encoding: "utf8" });
        const p = JSON.parse(out)[0];
        const junk = p.files.map(f=>f.path).filter(f=>/__tests__|\.map$/.test(f));
        console.log(p.name, junk.length ? "JUNK: "+junk : "clean");
      }
      '
      ```
    - Files to Create/Edit:
      - `package.json` (core): set `files` to `["dist", "!dist/__tests__",
        "!dist/**/*.map", "docs"]`.
      - `packages/*/package.json` (each): set `files` to `["dist",
        "!dist/__tests__", "!dist/**/*.map", "README.md"]`.
      - Existing boundary tests updated:
        - `src/__tests__/phase12-boundaries.test.ts`
        - `src/__tests__/phase13-boundaries.test.ts`
        - `src/__tests__/phase14-boundaries.test.ts`
        - `packages/compaction-llm/src/__tests__/index.test.ts`
        - `packages/compaction-observational-memory/src/__tests__/index.test.ts`
    - References:
      - Baseline: core `files: ["dist"]` shipped 209 files / 734.6KB including
        `dist/__tests__/*.test.js` and `*.map`.
      - After: core 103 files / 366.0KB, all packages clean (verified via
        `npm pack --dry-run --json`).
  - Test Cases to Write:
    - Pack-contents guard (implemented fully in Task 4): for each package, the
      `npm pack --dry-run --json` file list contains none of `__tests__/`,
      `*.map`, `*.tsbuildinfo`, `*.ts`, `roadmap.md`, `plans/`, `.agents/`,
      `packages/`, or `tsconfig*.json`.
    - Core pack still includes `dist/index.js`, every `exports` subpath target,
      the `bin`, `docs/`, `README.md`, `LICENSE` (auto), `CHANGELOG.md`
      (deferred to Task 2).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — changes package manifest `files`
      and what consumers receive when installing.
    - Docs pages to create/edit:
      - `docs/release-and-install.md` (created in Task 8): document tarball
        contents, what is intentionally excluded, and the map-retention knob.
    - `docs/index.md` update: yes — add a "Release and install" entry (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 2. Add release files and package metadata for core and every package
  - Acceptance Criteria:
    - Functional: root and every `packages/*` contain a real `LICENSE` and a
      `CHANGELOG.md`; every `package.json` declares `license`, `repository`
      (with `directory` for workspace packages), `bugs`, `homepage`, `keywords`,
      and `sideEffects`.
    - Performance: no impact on runtime; metadata-only change.
    - Code Quality: metadata is consistent across packages; `sideEffects` is set
      truthfully (verified, not guessed) and npm packs the new files.
    - Security: a real `LICENSE` is chosen and recorded; no secrets or personal
      tokens appear in metadata or CHANGELOG.
  - Approach:
    - Documentation Reviewed:
      - npm `package.json` metadata fields:
        https://docs.npmjs.com/cli/v10/configuring-npm/package-json/
        (`license`, `repository`, `bugs`, `homepage`, `keywords`, `sideEffects`,
        `private`).
      - `sideEffects` tree-shaking semantics (webpack/Parcel convention, also in
        package.json docs): `false` lets bundlers drop unused exports; an array
        lists files with side effects.
      - SPDX license identifiers: https://spdx.org/licenses/ (MIT, Apache-2.0).
    - Options Considered:
      - License choice: MIT (permissive, JS ecosystem default) vs Apache-2.0
        (explicit patent grant). Chose MIT; copyright holder set to
        "Prism contributors" pending maintainer confirmation.
      - `sideEffects: false` everywhere vs per-file array: used `false` for the
        pure library packages; used `sideEffects: ["dist/cli.js"]` for core
        because `src/cli.ts` runs the CLI and sets `process.exitCode` at the
        top level.
    - Chosen Approach:
      - Add root `LICENSE` (MIT, copyright "Prism contributors") and
        `CHANGELOG.md` (Keep a Changelog format, seeded with an
        `## [Unreleased]` section noting Phase 17 packaging changes).
      - Add `LICENSE` + `CHANGELOG.md` to each `packages/*` package.
      - Add `"CHANGELOG.md"` to every `files` array (core and packages) because
        npm does not guarantee auto-inclusion across versions.
      - Core `package.json`: add `license: "MIT"`,
        `repository: { type: "git", url: "git+https://github.com/ashiqrniloy/prism.git" }`,
        `bugs: { url: "https://github.com/ashiqrniloy/prism/issues" }`,
        `homepage: "https://github.com/ashiqrniloy/prism#readme"`,
        `keywords: ["prism", "agent", "llm", "ai", "framework", "chatbot"]`,
        and `sideEffects: ["dist/cli.js"]`.
      - Each `packages/*` `package.json`: add `license: "MIT"`,
        `repository: { type: "git", url: "git+https://github.com/ashiqrniloy/prism.git", directory: "packages/<name>" }`,
        `bugs`, `homepage`, package-specific `keywords`, and `sideEffects: false`.
      - Verified `sideEffects`: all library entrypoints are pure exports; only
        `src/cli.ts` has top-level execution side effects.
    - API Notes and Examples:
      ```json
      {
        "license": "MIT",
        "repository": { "type": "git", "url": "git+https://github.com/ashiqrniloy/prism.git", "directory": "packages/provider-openai" },
        "bugs": { "url": "https://github.com/ashiqrniloy/prism/issues" },
        "homepage": "https://github.com/ashiqrniloy/prism/tree/main/packages/provider-openai#readme",
        "keywords": ["prism", "provider", "openai", "agent", "llm"],
        "sideEffects": false
      }
      ```
    - Files to Create/Edit:
      - `LICENSE` (new, root) and `CHANGELOG.md` (new, root).
      - `packages/*/LICENSE` (new, one per package) and
        `packages/*/CHANGELOG.md` (new, one per package).
      - `package.json` (core): add metadata fields and `CHANGELOG.md` to `files`.
      - `packages/*/package.json` (each): add metadata fields and `CHANGELOG.md`
        to `files`.
      - Existing boundary tests updated to include `CHANGELOG.md` in the expected
        `files` arrays:
        - `src/__tests__/phase12-boundaries.test.ts`
        - `src/__tests__/phase13-boundaries.test.ts`
        - `src/__tests__/phase14-boundaries.test.ts`
        - `packages/compaction-llm/src/__tests__/index.test.ts`
        - `packages/compaction-observational-memory/src/__tests__/index.test.ts`
    - References:
      - Git remote: `git@github.com:ashiqrniloy/prism.git`.
      - Existing per-package READMEs already exist and will keep working.
      - Verified: `npm pack --dry-run --json` for core + all 7 packages includes
        `LICENSE`, `CHANGELOG.md`, and `README.md`.
  - Test Cases to Write:
      - Each published package's `package.json` has non-empty `license`,
        `repository`, `bugs`, `homepage`, `keywords`, and a boolean/array
        `sideEffects` (asserted in the Task 4 packaging guard).
      - `npm pack --dry-run --json` includes `LICENSE` and `CHANGELOG.md` for
        core and every package.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — manifest fields and license are
      part of the package contract.
    - Docs pages to create/edit:
      - `docs/release-and-install.md` (Task 8): record license, metadata, and
        `sideEffects` guidance.
    - `docs/index.md` update: yes (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 3. Make the `prism` peer dependency non-optional for first-party packages
  - Acceptance Criteria:
    - Functional: no first-party `packages/*` `package.json` marks `prism` as an
      optional peer; installing a first-party package without `prism` present
      produces an npm peer warning/error instead of silently succeeding.
    - Performance: no impact on runtime; install resolution unchanged for
      workspace consumers.
    - Code Quality: peer range is consistent across packages; the
      `peerDependenciesMeta.prism.optional` field is removed (not left as
      `false`, which is the same as omitted but misleading).
    - Security: a package can no longer be installed into a host that lacks the
      core, which prevents silently broken agents.
  - Approach:
    - Documentation Reviewed:
      - npm `peerDependencies` / `peerDependenciesMeta`:
        https://docs.npmjs.com/cli/v10/configuring-npm/package-json/#peerdependencies
      - npm RFC 0030 (no-install for optional peers):
        https://github.com/npm/rfcs/blob/main/implemented/0030-no-install-optional-peer-deps.md
        — npm 7+ auto-installs/requires non-optional peers and does NOT auto-
        install optional peers; removing `optional: true` makes `prism`
        required.
      - Caret semantics on `0.0.x`: `^0.0.1` still pins to `0.0.1`; document
        that the range will widen to `^1.0.0` at the first stable release.
    - Options Considered:
      - Keep optional peer (status quo): rejected — roadmap deliverable requires
        non-optional unless a tested install story proves otherwise; no such
        story exists for packages that call core APIs at runtime.
      - Move `prism` to `dependencies`: rejected — would force a specific core
        version and defeat the host-controlled single-core model; peer is
        correct.
      - Drop `peerDependenciesMeta` entirely so the peer is non-optional:
        chosen, with a workspace-local `devDependencies` shim so `npm install`
        continues to resolve in the monorepo.
    - Chosen Approach:
      - In every `packages/*/package.json`, remove the `peerDependenciesMeta`
        block (so `prism` is a required peer) and keep
        `peerDependencies: { "prism": "0.0.1" }`.
      - Add `"prism": "file:../.."` to `devDependencies` in every
        `packages/*/package.json`. This satisfies the required peer in the
        workspace without publishing a runtime dependency; devDependencies are
        stripped from consumer installs.
      - Document in root and per-package `CHANGELOG.md` that `prism` is now a
        required peer and that the range will widen to `^1.0.0` at 1.x.
      - Update boundary tests that asserted empty `devDependencies` to expect
        the workspace-only `prism` devDependency.
      - Verify `npm install` and `npm ls --all --depth=0` are clean in the
        workspace; Task 5 will prove consumer tarball installs resolve
        cleanly.
    - API Notes and Examples:
      ```json
      {
        "peerDependencies": { "prism": "0.0.1" },
        "devDependencies": { "prism": "file:../.." }
      }
      ```
      (`peerDependenciesMeta` omitted.)
    - Files to Create/Edit:
      - `packages/*/package.json` (each of the 7): remove `peerDependenciesMeta`,
        add `devDependencies.prism = "file:../.."`.
      - `CHANGELOG.md` (root) / `packages/*/CHANGELOG.md`: note the peer change.
      - `package-lock.json`: updated by `npm install` to reflect the new
        workspace links.
      - Existing boundary tests updated:
        - `src/__tests__/phase13-boundaries.test.ts`
        - `src/__tests__/phase14-boundaries.test.ts`
        - `packages/compaction-llm/src/__tests__/index.test.ts`
        - `packages/compaction-observational-memory/src/__tests__/index.test.ts`
    - References:
      - All 7 first-party packages previously set
        `peerDependenciesMeta.prism.optional = true`.
      - After: `npm ls --all --depth=0` exits 0; every workspace package links
        `prism@0.0.1 -> ./`.
  - Test Cases to Write:
      - The Task 5 install smoke test installs all first-party tarballs plus the
        core tarball together and `npm ls` is clean in the temp project.
      - A negative check (optional, workspace-local only): installing a package
        tarball without the core produces a peer-dep warning (assert via
        `npm install` stderr in the smoke harness).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — changes peer-dependency
      requirements consumers must satisfy.
    - Docs pages to create/edit:
      - `docs/release-and-install.md` (Task 8): document the required `prism`
        peer and the version-range plan.
    - `docs/index.md` update: yes (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 4. Packaging guard test: assert pack contents and a clean dependency tree
  - Acceptance Criteria:
    - Functional: a `node --test` guard asserts, for core and every first-party
      package, that `npm pack --dry-run --json` includes the expected files
      (public `dist`, README, LICENSE, CHANGELOG, `docs` for core) and excludes
      `__tests__`, `*.map`, `*.tsbuildinfo`, `*.ts`, plans, fixtures,
      `.agents/`, `roadmap.md`, `tsconfig*.json`, and `packages/`; it also
      asserts each `package.json` has the Task 2 metadata and Task 3 required
      peer.
    - Performance: the guard runs in seconds and stays network-free.
    - Code Quality: the guard is data-driven (one config list of packages +
      subpaths) and produces a precise failure message naming the offending
      file/package.
    - Security: catches accidental publication of secrets-bearing fixtures or
      internal scripts before release.
  - Approach:
    - Documentation Reviewed:
      - `npm pack --dry-run --json` output shape:
        https://docs.npmjs.com/cli/v10/commands/npm-pack/ (returns an array of
        pack results, each with `id`, `name`, `filename`, and `files[]` with
        `path`/`size`).
      - `npm ls --all --depth=0`:
        https://docs.npmjs.com/cli/v10/commands/npm-ls (exits non-zero on
        missing/extraneous/invalid deps).
      - `node:test` + `node:child_process` `spawnSync` for running npm from a
        test: https://nodejs.org/api/test.html
    - Options Considered:
      - Manual `npm pack --dry-run` review only: rejected — not repeatable and
        drifts; the repo already uses meta-tests (`docs.test.ts`,
        `network-free-guard.test.ts`), so a `packaging.test.ts` fits the pattern.
      - A separate shell script: rejected — `node --test` keeps it inside the
        default `npm test` flow and fails the build on regression.
    - Chosen Approach:
      - Added `src/__tests__/packaging.test.ts` that:
        1. Assumes `npm run build` ran (the `npm test` script builds first);
           invokes `npm pack --dry-run --json` for the root and each workspace
           package via `spawnSync`, parses JSON (cached per package dir).
        2. For each package, checks the file list against deny rules
           (`__tests__/`, `*.map`, `*.tsbuildinfo`, `src/`, `plans/`,
           `.agents/`, `roadmap.md`, `tsconfig`, `packages/`, and source `.ts`
           that is not `.d.ts`) and asserts README/LICENSE/CHANGELOG.md present.
        3. Derives expected compiled output from each `package.json` `exports`
           map and asserts every `types`/`default` target ships in the pack
           (works for core's 7 subpaths and each package's single entry).
        4. Core-only: asserts `docs/index.md` and `dist/cli.js` ship.
        5. Reads each `package.json` to assert Task 2 metadata (`license`,
           `repository.url`, `repository.directory` for packages, `bugs.url`,
           `homepage`, non-empty `keywords`, `sideEffects`).
        6. Packages-only: asserts `peerDependencies.prism === "0.0.1"` and no
           `peerDependenciesMeta`.
        7. Runs `npm ls --all --depth=0` in the repo and asserts exit code 0.
      - Driven from a single config array; adding a package is one line.
      - Verified the guard fails (exit 1) when a package's `files` is broken,
        then passes again once restored.
    - API Notes and Examples:
      ```ts
      // ponytail: data-driven guard; one entry per published package
      const packages = [
        { dir: ".", name: "prism", isCore: true },
        { dir: "packages/provider-openai", name: "@prism/provider-openai" },
        // ...
      ];
      const deniedPatterns = [
        { pattern: /__tests__\//, label: "compiled tests" },
        { pattern: /\.map$/, label: "source maps" },
        // ...
      ];
      ```
    - Files to Create/Edit:
      - `src/__tests__/packaging.test.ts` (new): the guard (41 assertions across
        8 packages + the `npm ls` check).
      - `package.json`: no script change needed; `npm test` globs
        `dist/__tests__/*.test.js` which picks up `packaging.test.js` after build.
    - References:
      - Existing meta-tests: `src/__tests__/docs.test.ts`,
        `src/__tests__/network-free-guard.test.ts`.
      - `package.json` test script: `node --test dist/__tests__/*.test.js`.
      - Guard runtime: ~4.2s (8 `npm pack --dry-run` + 1 `npm ls`), all
        network-free.
  - Test Cases to Write:
      - "no published test artifacts": deny `__tests__/` and `*.map`.
      - "core ships docs and bin": assert `dist/cli.js`, `docs/index.md`,
        `LICENSE`, `CHANGELOG.md` in core pack.
      - "packages ship required metadata and required peer": assert
        `package.json` fields and absent `peerDependenciesMeta.prism.optional`.
      - "npm ls clean": `npm ls --all --depth=0` exit 0.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — internal release gate, not a public
      API. Documented as part of the release process page.
    - Docs pages to create/edit:
      - `docs/release-and-install.md` (Task 8): mention the packaging guard as
        part of the release gate.
    - `docs/index.md` update: yes (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 5. Tarball install/import smoke tests for core, every subpath, and every package
  - Acceptance Criteria:
    - Functional: a `node --test` smoke test packs core and all first-party
      packages into a temp staging dir, creates a fresh temp project, installs
      them by tarball specifier (no workspace symlinks, no registry), and
      dynamic-`import`s every documented core subpath
      (`prism`, `prism/providers/openai-compatible`,
      `prism/testing/provider-conformance`, `prism/node/config`,
      `prism/node/settings`, `prism/node/trust`,
      `prism/node/session-store-jsonl`) and every first-party package
      (`@prism/provider-openai`, `@prism/provider-opencode-go`,
      `@prism/provider-openrouter`, `@prism/provider-zai`,
      `@prism/provider-kimi`, `@prism/compaction-llm`,
      `@prism/compaction-observational-memory`).
    - Performance: runs network-free and offline; finishes in well under the
      test budget; total install needs zero registry fetches (prism has no
      runtime deps).
    - Code Quality: imports use specifiers only (no workspace-relative paths);
      the installed `node_modules` copies contain no `__tests__`/`*.map`.
    - Security: no network calls; install is fully local-tarball; assert no
      `PRISM_*` secrets or fixtures end up installed.
  - Approach:
    - Documentation Reviewed:
      - `npm install <tarball>` behavior: local tarballs are extracted into
        `node_modules` (not symlinked), simulating a registry install.
      - Node dynamic `import()` of bare specifiers resolves through
        `node_modules` `exports` maps: confirm each subpath resolves under a
        fresh install.
      - `node:fs` `mkdtemp`/`rm` and `node:child_process` for an isolated
        install sandbox: https://nodejs.org/api/fs.html
      - Existing live-test gating pattern (`packages/provider-openai/src/__tests__/live.test.ts`)
        shows the repo's convention for opt-in network tests; the smoke test is
        the opposite — strictly offline.
    - Options Considered:
      - Use `npm pack` + `npm install --install-links` on directories: rejected
        — directory installs do not exercise the real tarball/`files` filter.
      - `yalc`/`npm link`: rejected — extra tooling and symlinks hide packaging
        bugs; tarballs are the real artifact.
      - Pack to tarballs, install by file specifier into a temp project, then
        import: chosen — exercises the exact published artifact end to end.
    - Chosen Approach:
      - Added `src/__tests__/install-smoke.test.ts` that:
        1. Assumes `npm run build` ran (the `npm test` script builds core and
           all workspaces first); packs core + every package into a staging
           `mkdtemp` dir via `npm pack --pack-destination <staging>`.
        2. `mkdtemp` a consumer dir, writes a minimal `package.json`
           (`"type": "module"`), and `npm install`s all tarballs with
           `--offline --no-audit --no-fund --no-update-notifier`, falling back
           to the same flags without `--offline` on a cold cache (zero registry
           fetches either way, since there are no runtime deps).
        3. Writes a generated `smoke.mjs` into the consumer dir that
           dynamic-imports every specifier and `process.exit(1)`s on any
           failure; runs it with `node` via `spawnSync`.
        4. Walks the installed `node_modules` and collects any path containing
           `__tests__` or ending in `.map` as leaked junk.
      - Core import specifiers are derived from the root `exports` map so the
        smoke list cannot drift from the public contract; package names come
        from the single config array (adding a package is one line).
      - Setup runs once in a `before` hook; cleanup is an `after` hook that
        `rmSync`s both temp dirs even on failure.
      - Verified the import path fails (exit 1, precise message) on a bad
        specifier, confirming the test catches regressions.
    - API Notes and Examples:
      ```js
      // consumer-dir/smoke.mjs (generated by the test)
      const specs = [
        "prism", "prism/providers/openai-compatible", "prism/testing/provider-conformance",
        "prism/node/config", "prism/node/settings", "prism/node/trust",
        "prism/node/session-store-jsonl",
        "@prism/provider-openai", "@prism/provider-opencode-go", "@prism/provider-openrouter",
        "@prism/provider-zai", "@prism/provider-kimi",
        "@prism/compaction-llm", "@prism/compaction-observational-memory",
      ];
      for (const s of specs) await import(s);
      ```
    - Files to Create/Edit:
      - `src/__tests__/install-smoke.test.ts` (new): 3 assertions
        (install resolves the required `prism` peer; every documented subpath
        and package imports; installed trees contain no test artifacts/maps).
      - `package.json`: no script change needed; relied on the existing broad
        `node --test dist/__tests__/*.test.js` glob to keep one `test` entry
        point, per the plan's preferred option.
    - References:
      - `exports` map in `package.json` enumerates all core subpaths to cover.
      - `workspaces` field lists every first-party package.
      - `packages/provider-openai/src/__tests__/live.test.ts` for the opt-in
        network convention.
      - Runtime: ~8-9s wall (8 `npm pack` + 1 offline `npm install` + `node`
        smoke), all network-free; dominated by npm pack.
  - Test Cases to Write:
      - "every documented subpath imports from a fresh install".
      - "every first-party package imports from a fresh install".
      - "installed packages contain no test artifacts or source maps".
      - "install resolves required prism peer" (peer from Task 3 satisfied by
        installing the core tarball alongside).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — proves the install/import contract
      that `docs/release-and-install.md` describes.
    - Docs pages to create/edit:
      - `docs/release-and-install.md` (Task 8): document the supported install
        specifiers and the fresh-install guarantee.
    - `docs/index.md` update: yes (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 6. Minimal release/dry-run workflow for core plus first-party packages
  - Acceptance Criteria:
    - Functional: a GitHub Actions workflow runs on push/pull request:
      checkout, `setup-node` with npm cache, `npm ci`, `npm run build`,
      `npm test` (which now includes the packaging and install-smoke guards),
      and `npm run pack:dry-run` for core and every package; a separate
      tag-triggered job performs `npm publish --dry-run` (and real publish when
      `NPM_TOKEN` is present) for core and each package.
    - Performance: workflow uses the Node version from `engines` (`>=20`) and
      caches `~/.npm`; no unnecessary matrix.
    - Code Quality: workflow is one file, minimal steps, no extra CI deps; uses
      existing npm scripts.
    - Security: publish is gated on `secrets.NPM_TOKEN` and `npm publish` uses
      `--provenance`/`--access public` only if desired; dry-run is the default.
  - Approach:
    - Documentation Reviewed:
      - `actions/setup-node@v4` with `cache: 'npm'` and `registry-url`:
        https://github.com/actions/setup-node
      - npm publish dry-run: https://docs.npmjs.com/cli/v10/commands/npm-publish
      - npm `provenance` (optional): https://docs.npmjs.com/generating-provenance-statements
    - Options Considered:
      - A release tool (changesets/release-please): rejected — YAGNI for a
        single-maintainer 0.x project; a plain workflow + CHANGELOG is enough.
      - Separate per-package workflows: rejected — one workflow iterating
        workspaces is DRYer.
    - Chosen Approach:
      - Added `.github/workflows/release.yml` with two jobs:
        1. `verify`: triggers on push (main/master, v* tags) and pull_request —
           checkout, setup-node (node 20, npm cache), `npm ci`, `npm test`,
           `npm run pack:dry-run`. The standalone `npm run build` step was
           dropped because `npm test` already builds core + all workspaces first
           (the test script is `npm run build && node --test ... && npm run test
           --workspaces`), so a separate build is pure redundancy. The packaging
           + install-smoke guards from Tasks 4–5 make `verify` a real release
           gate.
        2. `publish`: runs only on `refs/tags/v*` and `needs: verify` — same
           setup plus `registry-url`, `npm ci`, `npm run build`, then a publish
           step that emits `npm publish --dry-run --access public` for root and
           `--workspaces` when `NPM_TOKEN` is unset, or real `npm publish
           --access public` (root, then `--workspaces`) when the token is
           present. Core publishes first because first-party packages declare
           `prism` as a required peer, so it must exist on the registry for
           consumers. `--access public` is passed because the scoped
           `@prism/*` packages default to restricted otherwise. Sets
           `permissions.id-token: write` so provenance can be enabled later by
           adding `--provenance` without re-architecting permissions.
    - API Notes and Examples:
      ```yaml
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm test          # builds core + workspaces, then runs all guards
      - run: npm run pack:dry-run
      ```
    - Files to Create/Edit:
      - `.github/workflows/release.yml` (new): two-job release workflow.
      - `package.json`: added `"release:dry-run": "npm test && npm run pack:dry-run"`
        as a local mirror of the `verify` job.
    - References:
      - Existing scripts: `build`, `typecheck`, `test`, `pack:dry-run`.
      - `npm test` builds first, so `verify` needs no separate build step.
      - Local mirror `npm run release:dry-run` passes (436 pass / 0 fail, all
        8 packages pack cleanly).
  - Test Cases to Write:
      - The workflow's `verify` job is itself the test (it runs the full guard
        suite). Additionally, `npm run release:dry-run` (the local mirror)
        succeeds for core and every package (436 pass / 0 fail, pack:dry-run
        clean for all 8 packages).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — release process is part of the
      package contract for consumers and contributors.
    - Docs pages to create/edit:
      - `docs/release-and-install.md` (Task 8): document the release workflow,
        trigger, and publish order.
    - `docs/index.md` update: yes (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 7. Measure the no-network test budget and pin or consciously revise the target
  - Acceptance Criteria:
    - Functional: record the wall-clock time of `npm test` (no
      `PRISM_LIVE_PROVIDER_TESTS`) on the CI Node version and capture it in docs
      and/or CHANGELOG; set an explicit budget and either meet it or revise the
      roadmap's "release target" with a one-line rationale.
    - Performance: default suite runs within the chosen budget; if it does not,
      the roadmap is updated rather than silently regressing.
    - Code Quality: the budget number is written down once and referenced, not
      folklore.
    - Security: measurement is offline; live provider tests remain opt-in.
  - Approach:
    - Documentation Reviewed:
      - Existing opt-in live-test gating:
        `packages/provider-openai/src/__tests__/live.test.ts` skips unless
        `PRISM_LIVE_PROVIDER_TESTS=1`.
      - `network-free-guard.test.ts` already enforces default network-free
        behavior; this task only concerns wall-clock time.
    - Options Considered:
      - Add a hard timeout in CI: useful as a backstop but not a substitute for
        recording the target.
      - Record the budget in `docs/release-and-install.md` and the roadmap:
        chosen — single source of truth.
    - Chosen Approach:
      - Measured `npm test` (no `PRISM_LIVE_PROVIDER_TESTS`) on Node 20 across
        three runs; median wall-clock ~22.0s (21.98 / 22.21 / 21.96). Breakdown:
        build ~12.5s (`npm run build` core + workspaces), core tests ~5.4s
        (parallelized — the packaging guard ~4.2s and install-smoke ~9s of
        setup run concurrently and are hidden under this), workspace tests ~4s.
      - The plan's tentative budget was < 30s; observed ~22s meets it with ~35%
        headroom, so the target is pinned as-is rather than revised upward.
      - Budget pinned at **< 30s for `npm test` on Node 20** (baseline ~22s,
        including the packaging + install-smoke guards, which run in every
        default `npm test`). This supersedes the earlier "excluding the
        packaging/install-smoke guards" caveat — they are part of the default
        suite and the budget covers them.
      - Updated `roadmap.md` Phase 17: the "reduce test time" deliverable now
        records the baseline and pinned budget; the "default tests remain
        network-free and meet the chosen time budget" acceptance line now reads
        "< 30s for `npm test` on Node 20; baseline ~22s".
      - Recorded the budget in `CHANGELOG.md` under the Unreleased `### Changed`
        section (in addition to `roadmap.md`), satisfying the "docs and/or
        CHANGELOG" criterion; `docs/release-and-install.md` (Task 8) will
        restate it.
      - Added a backstop: `timeout-minutes: 3` on the `npm test` step in
        `.github/workflows/release.yml` (generous: 3min >> 22s, catches hangs
        without flapping on normal CI variance).
    - API Notes and Examples:
      ```bash
      time npm test            # no PRISM_LIVE_PROVIDER_TESTS set
      ```
    - Files to Create/Edit:
      - `roadmap.md`: Phase 17 deliverable + acceptance lines now carry the
        concrete baseline (~22s) and pinned budget (< 30s on Node 20).
      - `CHANGELOG.md`: Unreleased `### Changed` notes the pinned budget.
      - `.github/workflows/release.yml`: `npm test` step gained
        `timeout-minutes: 3` as a hang backstop.
      - `docs/release-and-install.md` (Task 8): will restate the budget.
    - References:
      - `network-free-guard.test.ts`; live-test gating convention.
      - Measurement: node 20, three runs, median ~22.0s wall.
      - CI measurement on an actual `ubuntu-latest` runner is pending the first
        workflow run; if CI median exceeds 30s, the budget will be reconciled
        then per the "consciously revise" criterion rather than silently
        regressed.
  - Test Cases to Write:
      - No new unit test; the budget is an assertion in the release process
        (CI step `timeout-minutes: 3` + documented number). The Task 4/5 guards
        already keep the suite deterministic and offline.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — internal release target.
    - Docs pages to create/edit:
      - `docs/release-and-install.md` (Task 8): note the offline test budget.
    - `docs/index.md` update: yes (Task 8).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] 8. Document release and install behavior and link it from the docs index
  - Acceptance Criteria:
    - Functional: `docs/release-and-install.md` exists and follows the Prism
      API-page structure (What it does / When to use it / Inputs / Outputs /
      Implementation example / Extension & configuration notes / Security &
      performance notes / Related APIs); it documents package layout, install
      specifiers, required `prism` peer, tarball contents, what is excluded and
      why, the map-retention knob, the release workflow, and the offline test
      budget; `docs/index.md` links it under a "Release and install" group; and
      `docs.test.ts` enforces its headings and index link.
    - Performance: docs test adds negligible time.
    - Code Quality: page is consistent with the required wiki structure and
      cross-links provider-packages/CLI-RPC pages.
    - Security: documents that secrets never enter tarballs/docs and that live
      tests stay opt-in.
  - Approach:
    - Documentation Reviewed:
      - Prism wiki requirements:
        `.agents/skills/create-plan/references/prism-wiki.md` (required API-page
        sections and index grouping).
      - `docs/api-page-template.md` and existing pages for tone/structure.
      - `docs.test.ts` enforcement pattern (`apiPages` array + heading checks +
        index-link checks).
    - Options Considered:
      - Defer all docs to Phase 18: rejected — the create-plan skill requires a
        per-task `Documentation/Wiki Assessment` and the prism-wiki reference
        requires docs when package manifests/install behavior change; ship the
        release page now.
    - Chosen Approach:
      - Created `docs/release-and-install.md` using every required section:
        What it does / When to use it / Inputs / request / Outputs / response /
        events / Request/response example / Implementation example / Extension
        and configuration notes / Security and performance notes / Related APIs.
        It documents core + 7-package layout, the public `exports`-derived core
        import specifiers, the required non-optional `prism` peer (and the
        workspace-local `file:../..` devDependency shim), tarball contents and
        the `!dist/__tests__` / `!dist/**/*.map` exclusions, the map-retention
        knob, the two-job release workflow (verify + tag-publish), and the
        offline test budget (< 30s on Node 20, baseline ~22s).
      - Added a "Release and install" group to `docs/index.md` with one entry.
      - Added `docs/release-and-install.md` to the `apiPages` array in
        `src/__tests__/docs.test.ts` (so required-headings checks apply) and
        added a dedicated `release_and_install_page_is_linked_from_index` test
        asserting the index link plus key phrases ("required `prism` peer",
        "map-retention knob", "offline test budget", "sideEffects",
        "peerDependencies").
    - API Notes and Examples:
      ```markdown
      # Release and install

      ## What it does
      Describe how `prism` and first-party packages are packed, published, and
      installed, and what each tarball contains.

      ## When to use it
      ...
      ## Inputs / request
      ## Outputs / response / events
      ## Request/response example
      ## Implementation example
      ## Extension and configuration notes
      ## Security and performance notes
      ## Related APIs
      ```
    - Files to Create/Edit:
      - `docs/release-and-install.md` (new): full release/install page.
      - `docs/index.md`: added "Release and install" group + link.
      - `src/__tests__/docs.test.ts`: registered the page in `apiPages` and added
        the index-link + phrase assertion.
    - References:
      - `docs/index.md` current groups; `docs.test.ts` `apiPages` + heading
        checks.
      - Cross-links to `provider-packages.md`, `cli-rpc.md`, and
        `configuration-and-manifests.md`.
  - Test Cases to Write:
      - `docs.test.ts`: `docs/release-and-install.md` is linked from
        `docs/index.md` and contains all required headings (enforced via the
        `apiPages` array); plus the `release_and_install_page_is_linked_from_index`
        phrase assertions.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — this task creates the docs page for
      the package/install contract changed by Tasks 1–7.
    - Docs pages to create/edit:
      - `docs/release-and-install.md` (new) and `docs/index.md` (nav).
    - `docs/index.md` update: yes — "Release and install" group.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- Used `files`-array negation (`!dist/__tests__`, `!dist/**/*.map`) instead of
  `.npmignore`. The original plan chose `.npmignore`, but empirical testing
  showed `.npmignore` cannot exclude files inside a directory that is matched by
  the `files` whitelist; `files` negation works in npm 10+ (the repo requires
  Node >=20 / npm 10+).
- Source maps are emitted locally (`tsconfig` `sourceMap: true` unchanged) but
  stripped from published tarballs by default. This keeps local debugging intact
  while shrinking the consumer package; the knob is documented in the
  `!dist/**/*.map` line.
- Core ships the full `/docs` directory in its tarball. Per-package docs remain
  in the core docs hub and in each package's README; this avoids per-package
  doc-copy machinery and drift.
- `sideEffects` is `false` for first-party packages but `sideEffects:
  ["dist/cli.js"]` for core, because `src/cli.ts` executes the CLI and sets
  `process.exitCode` at the top level. This is the only shipped file with
  import-time side effects.
- License default is MIT with copyright holder "Prism contributors"; override
  by maintainer if a different license or copyright holder is desired.
- `prism` is a required peer dependency for all first-party packages, but each
  package also declares `"prism": "file:../.."` in `devDependencies` so that
  `npm install` in the workspace can resolve the peer locally. This
  devDependency is stripped from consumer installs and will be removed once a
  cleaner workspace-native solution is available.

## Further Actions
- Add a pack-contents guard in Task 4 that asserts the exact `files` arrays,
  verifies `npm pack --dry-run --json` is junk-free, and checks that metadata
  fields (`license`, `repository`, `bugs`, `homepage`, `keywords`,
  `sideEffects`) are present; this is the safety net if npm ever regresses
  `files` negation.
- If the project ever drops support for npm <10, consider switching to positive
  glob whitelists (`dist/**/*.js`, `dist/**/*.d.ts`) for even more explicit
  packaging, at the cost of maintaining the glob list for every new subpath.
