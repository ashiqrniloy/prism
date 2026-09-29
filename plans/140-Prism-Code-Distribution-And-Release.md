# Prism Code: Distribution (Bun + curl installer) and the 0.4.0 Release

## Objectives

- Make Prism Code installable as a standalone terminal app through two channels:
  - **Bun:** `bun add -g @arnilo/prism-code` (and `bunx @arnilo/prism-code`).
  - **Native curl installer:** `curl -fsSL <install-url> | sh`, which downloads a self-contained `bun build --compile` binary into `~/.prism/bin` with no Bun or npm needed.
- Ship `@arnilo/prism-code@0.4.0` (the next version after the previously published `0.3.0`, which was the retired coding-agent profile library) and `@arnilo/prism-agent-sdk@0.1.0` (never published; npm returns 404) through the existing independent-versioning release flow.
- Prove the shipped artifacts (tarballs and binaries, not the working tree) with install smoke tests and one live end-to-end journey.

## Expected Outcome

- `@arnilo/prism-code` manifest `0.4.0`, `@arnilo/prism-agent-sdk` manifest `0.1.0`, internal ranges consistent, `release:gate` (independent mode) green, package-truth docs regenerated.
- In a clean container with only Bun, `bun add -g @arnilo/prism-code && prism-code --version` prints `0.4.0`, and `prism-code doctor` passes except for "no provider configured".
- In a clean container with only `curl` and `sh`, running `curl -fsSL https://raw.githubusercontent.com/ashiqrniloy/prism/main/install.sh | sh` installs `~/.prism/bin/prism-code`, verifies its SHA-256, prints a PATH hint, and `prism-code --version` prints `0.4.0`. The same works on macOS arm64/x64 and Linux x64/arm64 (glibc and musl).
- GitHub release `prism-code-v0.4.0` carries six binary archives + `SHA256SUMS`; npm has `@arnilo/prism-code@0.4.0` and `@arnilo/prism-agent-sdk@0.1.0`; git tags `@arnilo/prism-code@0.4.0` and `@arnilo/prism-agent-sdk@0.1.0` exist.
- The live journey (provider login → multi-step task with approvals → quit → resume → OM on → stdio MCP tool) passes on both the Bun install and the binary.
- Docs: `docs/prism-code.md` (Install section), `docs/release-and-install.md` (binary channel), `CHANGELOG.md` entries, `packages/prism-code/README.md`, `docs/index.md`.
- Depends on: plans 136–139 (all P0/P1 behavior). Publishing steps require explicit user confirmation at execution time.

## Tasks

- [x] Task 1: Manifests, versions, and dependency shape for a standalone app
  - Acceptance Criteria:
    - Functional: `packages/prism-code/package.json` version is `0.4.0` and `packages/agent-sdk/package.json` version is `0.1.0` (npm has no prior agent-sdk version, verified with `npm view @arnilo/prism-agent-sdk` → 404 at execution time; if a version exists by then, use the next minor above it). Prism Code's range on the SDK becomes `^0.1.0`; all other internal ranges satisfy the current manifests (independent mode).
    - Functional: prism-code moves `@arnilo/prism` and `@arnilo/prism-providers` from (optional) peer dependencies to `dependencies` so a global install is self-sufficient (an app, unlike the libraries, owns its runtime graph). The providers' own optional peers (e.g. `@ai-sdk/provider`) are resolved or documented.
    - Functional: `--version` reads the manifest version (plan 136 Task 2) and the binary build injects it via `--define`.
    - Functional: the npm `@arnilo/prism-code` README states that 0.4.0+ is the terminal app, and that the former 0.3.x coding-agent profile moved to `@arnilo/prism-coding-tools`/`@arnilo/prism-agent-sdk`.
    - Performance: packed tarball size recorded; no test/map files packed (existing `files` rules).
    - Code Quality: `node scripts/release.mjs changed` and the independent `gate` pass; `bun scripts/package-truth.mjs --emit-docs` regenerates the inventory tables (`docs/release-and-install.md`, `docs/index.md`).
    - Security: dependency additions are pinned by range consistent with the release gate; `security.yml` (audit) passes. Plan the compat-baseline regeneration: `node scripts/release.mjs gate --update-baseline` for the two packages' public surfaces (`scripts/compat-baseline/*`), recording the post-regeneration `release:gate` diff and stating that both packages are new in the baseline (no inherited removals).
  - Approach:
    - Documentation Reviewed:
      - `scripts/release.mjs` (independent mode: `validateReleaseIndependent`, `bumpPackage`, `changedPackages`, `detectBaselineTag`), `docs/release-and-install.md`, `scripts/package-truth.mjs`
      - npm registry state: `@arnilo/prism-code` latest `0.3.0` (2026-08-20), `@arnilo/prism-agent-sdk` 404
    - Options Considered:
      - Keep lockstep `0.12.0`. Rejected per user direction (prism-code 0.4.0, SDK 0.1.0) and supported by the independent mode.
      - Publish the app under a new name (e.g. `@arnilo/prism-code-cli`). Rejected: the user chose `@arnilo/prism-code`; the 0.3.x → 0.4.0 change is a documented breaking minor in 0.x.
    - Chosen Approach: manual version set for the two new-to-baseline packages + independent gate.
    - API Notes and Examples:
      ```bash
      node scripts/release.mjs changed
      node scripts/release.mjs gate --update-baseline
      bun scripts/package-truth.mjs --emit-docs
      ```
    - Files to Create/Edit:
      - `packages/prism-code/package.json`, `packages/agent-sdk/package.json`: versions, dependency shape
      - `bun.lock`: regenerated (see the execution note; `bun install --lockfile-only` alone corrupts it)
      - `packages/prism-code/README.md`, `packages/prism-code/CHANGELOG.md`, `packages/agent-sdk/CHANGELOG.md`, root `CHANGELOG.md`
      - `docs/release-and-install.md`, `docs/index.md`, `README.md`, `docs/_evidence/phase54-package-map.md`, `scripts/package-truth.json`: regenerated inventory; the `release-and-install.md` peer-policy paragraph names the app exception
      - `scripts/compat-baseline/*`: regenerated (no-op)
      - Tests that encoded lockstep/peer assumptions: `scripts/phase24-truth.test.mjs`, `src/__tests__/packaging.test.ts`, `src/__tests__/release.test.ts`, `src/__tests__/docs.test.ts`
    - References:
      - User direction: prism-code 0.4.0, SDK 0.1.0
  - Test Cases to Write:
    - `scripts/package-truth.test.mjs` / `packaging-current.test.mjs` updated expectations pass.
    - Release gate independent mode passes with the new versions.
  - Notes (executed 2026-09-29):
    - Registry state re-verified: `npm view @arnilo/prism-agent-sdk` → 404; `@arnilo/prism-code` versions end at `0.3.0`. Manifests set to `0.4.0` / `0.1.0`, and prism-code pins `@arnilo/prism-agent-sdk@^0.1.0`. All other internal ranges stay `^0.12.0` and satisfy the current manifests.
    - Dependency shape: prism-code drops `peerDependencies`/`peerDependenciesMeta` and lists `@arnilo/prism`, `@arnilo/prism-providers`, and `@arnilo/prism-hooks` under `dependencies` (all `^0.12.0`; hooks is added with a `file:../hooks` devDependency). The hooks addition, and the SDK peer change below, came from a static-import audit: the SDK root entry imports `@arnilo/prism-hooks` (`planes/hooks.ts`), `@arnilo/prism-coding-tools/agent` (`presets.ts`), and `@arnilo/prism-mcp` (`planes/mcp.ts`) at load time, but it declared all three as *optional* peers. An install without them crashed on import. Since 0.1.0 is the SDK's first publish, `peerDependenciesMeta` was removed, making the three peers required. `@ai-sdk/provider` stays an optional peer of `@arnilo/prism-providers`: only the `/ai-sdk` subpath reaches it, prism-code never imports that subpath (verified by grep), and the README documents this.
    - `--version`: `packages/prism-code/src/version.ts` already prefers the `PRISM_CODE_VERSION` define, then the manifest. `bun packages/prism-code/dist/bin/prism-code.js --version` → `0.4.0`, and `home.test.ts` asserts manifest parity. The `--define` injection lands with Task 3's build script.
    - README: install line is `bun add -g @arnilo/prism-code`, with a callout that 0.4.0+ is the app and the 0.3.x library moved to `@arnilo/prism-coding-tools`/`@arnilo/prism-agent-sdk`. The Requirements section describes the self-contained graph. Package CHANGELOGs are rewritten to `[0.4.0] - Unreleased` / `[0.1.0] - Unreleased`; the false lockstep anchor sections ("first published version is 0.12.0") are removed. The root CHANGELOG has an `[Unreleased]` → Changed entry.
    - Tarballs (`npm pack --dry-run`): `arnilo-prism-code-0.4.0.tgz` 156,392 B packed / 648,316 B unpacked / 92 files; `arnilo-prism-agent-sdk-0.1.0.tgz` 23,808 B / 94,637 B / 24 files. Neither contains `__tests__`, `*.map`, or `src/`.
    - Lockfile: `bun install --lockfile-only` (and plain `bun install`) on top of HEAD's `bun.lock` writes duplicate `"@arnilo/prism-code/@arnilo/*"` keys. Bun 1.4.2 then rejects the file (`Duplicate package path`), and `bun audit`/`--frozen-lockfile` fail. This reproduced with the pre-task manifests, so the cause is adding the two new workspaces incrementally, not the peer move. A from-scratch lock is valid but resolves every workspace's `@arnilo/prism` to the **registry** 0.12.0 tarball, which installs nested duplicate cores (the `instanceof` split). The committed lock is a from-scratch lock with three fixes: (a) the 12 `<pkg>/@arnilo/prism` entries set back to HEAD's `@arnilo/prism@root:`; (b) every third-party entry shared with HEAD restored to HEAD's pin (37 lines); (c) HEAD's `bluebird`/`path-is-absolute` re-added for the pinned `mammoth@1.12.2`. Verified: a clean `rm -rf node_modules packages/*/node_modules && bun install --frozen-lockfile` leaves the lock byte-identical, `node_modules/@arnilo/prism → ../..` with no nested copies, and third-party versions equal HEAD plus additions only (OpenTUI 0.5.12 + platform packages, `@xterm/headless`, and their transitive deps).
    - Gates: `bun run release:gate` exits 0 with `"updated": false` (independent ranges, compat, and tarball stages all pass). It was run as CI's verify job runs it (`PRISM_RELEASE_POSTGRES_JOB=1`, which marks the Postgres surface `protected`); without that env the local gate fails closed on the documented `test:postgres` evidence blocker. `node scripts/release.mjs gate --update-baseline` rewrote `scripts/compat-baseline/*` byte-identically (md5 check). `arnilo__prism-agent-sdk.txt` and `arnilo__prism-code.txt` are new, untracked baselines with no prior git version, so there are no inherited removals. `bun audit --audit-level=moderate` → no vulnerabilities (192 packages). `bun scripts/package-truth.mjs --emit-docs` regenerated the inventories (0.1.0/0.4.0 rows) and is idempotent.
    - `node scripts/release.mjs changed` lists 12 packages but **not** prism-code or agent-sdk, because both directories are untracked in git (`git diff` ignores untracked files). They appear once committed, and `validateReleaseIndependent` treats them as new packages (no baseline version). They must be committed before Task 5's tag-driven publish.
    - Tests: `scripts/{package-truth,packaging-current,phase24-truth,truth-current,phase54-package-map}.test.mjs` and `src/__tests__/{packaging,release,docs,public-export-contract}.test.ts`, plus `install-smoke.test.ts` (`--timeout=0`, 15/15, packed tarballs install with the new graph), all pass. Package suites: agent-sdk 72/72, prism-code 335/335. Test updates: phase24 counts `codeWithPeer` 12 / `pureManifest` 1 and asserts the app's `dependencies` ranges; packaging asserts the app depends on core with no peers; the lockstep and `0.1.0`-anchor checks exempt the two independent-line packages and instead require their own version section. Biome format/lint are clean on the touched files.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — package versions and dependency shape.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: regenerated inventory
      - `CHANGELOG.md`: 0.4.0/0.1.0 entries (history lives here, not in API pages)
    - `docs/index.md` update: yes — regenerated package inventory rows.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 2: Bun install channel and packed-tarball install smoke
  - Acceptance Criteria:
    - Functional: `scripts/prism-code-install-smoke.mjs` packs all first-party tarballs the app needs (`npm pack` per package), installs them globally into a temp `BUN_INSTALL` in a clean container (no repo checkout on the path), and asserts:
      - `prism-code --version`;
      - `prism-code -p "hi" --mode json` with the mock provider (`--model mock/default`);
      - a TUI launch/exit via the PTY harness from plan 139 Task 7;
      - `prism-code doctor --json`.

      Registry mode (`--registry`) repeats the checks against npm after publish (extends `scripts/post-publish-smoke.mjs`).
    - Functional: `bunx @arnilo/prism-code --version` works from the registry.
    - Functional: verifies there is no duplicate `@arnilo/prism` instance in the installed tree (the `instanceof` split seen with `file:../..` dev deps): `bun pm ls` shows a single `@arnilo/prism` path.
    - Performance: cold `prism-code --version` on the installed package < 300 ms; recorded.
    - Code Quality: the smoke script is reusable in CI (`release.yml` pre-publish step) and locally.
    - Security: the smoke uses the mock provider and a temp `PRISM_HOME`; no secrets.
  - Approach:
    - Documentation Reviewed:
      - Bun docs: `bun add -g`, `BUN_INSTALL`, `bunx`; `scripts/post-publish-smoke.mjs` (`--local` tarball mode)
    - Options Considered:
      - Test via workspace links. Rejected: hides packaging bugs; tarballs mirror what users get.
    - Chosen Approach: tarball + registry smoke sharing one script.
    - API Notes and Examples:
      ```bash
      BUN_INSTALL=$(mktemp -d) bun add -g ./dist-packs/arnilo-prism-code-0.4.0.tgz ./dist-packs/*.tgz
      "$BUN_INSTALL/bin/prism-code" --version
      ```
    - Files to Create/Edit:
      - `scripts/prism-code-install-smoke.mjs`: new
      - `scripts/post-publish-smoke.mjs`: add the prism-code surface
      - `.github/workflows/release.yml`: pre-publish smoke step
    - References:
      - Analysis section 1 (install story unverified; `file:../..` caveat)
  - Test Cases to Write:
    - Local tarball smoke (CI) and registry smoke (post-publish).
  - Notes (executed 2026-09-29):
    - `scripts/prism-code-install-smoke.mjs` (new) has three modes:
      - default: `npm pack` of the first-party closure, derived from the manifests (dependencies plus required peers, transitively; 11 packages);
      - `--packs <dir>`: reuse tarballs that are already packed;
      - `--registry [--version x.y.z]`: install `@arnilo/prism-code@<manifest version>` from npm.
      `--keep` leaves the temp directory for debugging.
    - The smoke installs with `bun add -g` into a throwaway `BUN_INSTALL`. In tarball modes, the global `package.json` carries `overrides` that map every first-party range to its tarball. This is required: the SDK is not on npm before its first publish, and it guarantees the packed bytes rather than the registry's previous release. `BUN_INSTALL_BIN`/`BUN_INSTALL_GLOBAL_DIR` are pinned too, because the `oven/bun` image sets `BUN_INSTALL_BIN=/usr/local/bin`, which put the bin outside the temp tree on the first container run.
    - The child environment is hermetic: temp HOME/PRISM_HOME/cwd, and `PATH` holds only the Bun directory plus system bins (no repo). `state.json` is seeded with `credentialStore: "memory"`; without it, `doctor` probed the host keychain and listed a stored key.
    - Checks (11):
      - the bin exists;
      - `--version` equals the manifest version;
      - cold `--version` median of 5 < 300 ms;
      - headless `-p hi --mode json --model mock/default` exits 0, ending in `agent_finished` with "Mock response";
      - `doctor --json --model mock/default` has `ok: true` and no failing checks;
      - `doctor --json` without a model fails only `model`, which matches the expected "no provider configured" outcome;
      - the doctor `runtime` check finds the OpenTUI native package;
      - exactly one `node_modules/@arnilo/prism` on disk;
      - `bun pm ls --all` lists a single `@arnilo/prism@…`;
      - the TUI over the plan 139 PTY harness reaches "Type a prompt", answers, exits 0 on Ctrl+D;
      - the TUI leaves the alternate screen (`ESC[?1049l`).
      Registry mode adds `bunx @arnilo/prism-code@<version> --version`.
    - Evidence:
      - Host (CachyOS, Bun 1.4.2): PASS 11/11. Install 8.7 s including packing; cold `--version` median 134–136 ms as measured from the Bun-spawned probe (about 12 ms measured directly from the shell); TUI first frame 452 ms.
      - Clean container (`docker run oven/bun:1.4.2`, no npm, repo and tarballs mounted read-only, `--packs /packs`): PASS 11/11. Install 2.7 s; `--version` median 9 ms; TUI first frame 289 ms.
      - `bun scripts/post-publish-smoke.mjs --local --prism-code`: library smoke PASS, then the app smoke PASS 11/11.
      - The registry `bunx` leg can only run after the Task 6 publish.
    - Performance fix: the first measurement was about 370 ms for `--version`, because the bin statically imported the whole `src/index.js` graph. `packages/prism-code/bin/prism-code.ts` now parses flags from `src/flags.js` and answers `--help`/`--version` from `src/version.js`, then dynamically imports `src/index.js`. `missingCredentialGuidance` takes the loaded module. This also serves Task 3's cold-start target.
    - `scripts/lib/pty-harness.mjs`: `startTui` accepts `command` (launcher argv, default `bun` + the repo bin).
    - `scripts/post-publish-smoke.mjs`: `--prism-code` appends the app smoke; local mode runs it on tarballs, and registry mode passes `--registry` plus `--prism-code-version`, which defaults to the prism-code manifest version because the app is independently versioned. Opt-in, so a library-only post-publish run does not require the app on npm. `--prism-code-version` without `--prism-code` is rejected.
    - `release.yml` publish job: the "pre-publish prism-code install smoke" step (`--packs release-artifacts`, 10 min timeout) runs after pack/secret scan and before auth wiring/publish. The registry post-publish job is Task 5.
    - Docs: `docs/prism-code.md` has an `### Install` section under Inputs / request covering Bun install, `bunx`, upgrade, uninstall (`bun remove -g` verified), PATH, the single-core graph, the 0.3.x note, and the smoke. `packages/prism-code/CHANGELOG.md` has the install channel and the `--version` fast path.
    - Verification: prism-code package suite 335/335; `src/__tests__/docs.test.ts` 159/159; `scripts/e2e-prism-code-tui.test.mjs` 8/8 after the harness/bin change; Biome clean on the four touched scripts/bin.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documented install channel.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: "Install" section (Bun)
    - `docs/index.md` update: no (Task 4 updates the Prism Code entry once for both channels).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Standalone binaries with `bun build --compile`
  - Acceptance Criteria:
    - Functional: `scripts/build-prism-code-binaries.mjs` compiles `packages/prism-code/bin/prism-code.ts` into single-file executables for `linux-x64`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl`, `darwin-x64`, and `darwin-arm64`. It uses `--minify --bytecode --define PRISM_CODE_VERSION=…`. Each binary embeds:
      - the OpenTUI native library (`@opentui/core-<platform>` loads `libopentui.so`/`.dylib` via `import(…, { with: { type: "file" } })`, which Bun embeds and extracts at runtime);
      - the `@napi-rs/keyring` `.node` addon;
      - all provider adapters (literal dynamic `import("@arnilo/prism-providers/<id>")` calls are bundled; any non-literal import found is converted).
    - Functional: CI builds each target on a native runner (ubuntu x64/arm64, an Alpine container for musl, macOS x64/arm64) so platform optional packages are installed natively. Each job runs the built binary (`--version`, headless mock prompt, `doctor --json`, and a PTY launch/exit) before archiving `prism-code-<target>.tar.gz`. A final job writes `SHA256SUMS`.
    - Functional: features that need a runtime outside the binary degrade clearly:
      - User tool modules (`tools.add`) load from disk and resolve their own dependencies. Documented: importing `@arnilo/prism` from a user module in binary mode resolves a separate copy (identity caveat). The recommended approach is to author modules against the plain `ToolDefinition` shape.
      - Obscura/web backends are external binaries, as before.
    - Performance: binary size and cold start recorded per target (target: cold `--version` < 150 ms, TUI first frame < 500 ms).
    - Code Quality: the build script is deterministic (pinned Bun `1.4.2`, pinned lockfile); no code path differs between the binary and the Bun install except the version define and `process.execPath` checks.
    - Security: archives are produced only in CI from a tagged commit; `SHA256SUMS` are published with the release. macOS binaries are ad-hoc signed (Bun default) and the docs note Gatekeeper behavior (curl downloads are not quarantined). Signing with a Developer ID and SLSA provenance/attestations (`actions/attest-build-provenance`) are enabled if available in the repo settings; this is recorded in the task note either way.
  - Approach:
    - Documentation Reviewed:
      - Bun docs `bundler/executables.mdx` (`bun build --compile`, `--target=bun-<os>-<arch>[-musl]`, `--bytecode`, `--define`), bun source note on embedded `.node`/`.so` extraction (`resolve_embedded_file_to_buf`)
      - `node_modules/@opentui/core-linux-x64/index.bun.js` (file-import of `libopentui.so`), `@opentui/core` `optionalDependencies` (8 platform packages, 0.5.12)
      - `packages/prism-code/src/providers.ts:301-360` (literal provider imports)
    - Options Considered:
      - Cross-compile all targets from one Linux runner with `--target`. Rejected as the default: platform-specific optional native packages (OpenTUI, keyring) must be present for each target; native runners avoid installing foreign-platform packages. It stays a documented fallback if verified.
      - Ship a Node SEA. Rejected: OpenTUI requires Bun FFI (Node only with `--experimental-ffi`).
    - Chosen Approach: native-runner matrix, each compiling for its own platform and self-testing.
    - API Notes and Examples:
      ```bash
      bun build --compile --minify --bytecode --target=bun-linux-x64 \
        --define PRISM_CODE_VERSION='"0.4.0"' packages/prism-code/bin/prism-code.ts --outfile dist-bin/prism-code
      ```
    - Files to Create/Edit:
      - `scripts/build-prism-code-binaries.mjs`: new
      - `.github/workflows/prism-code-binaries.yml`: new matrix workflow (triggered by `@arnilo/prism-code@*` tags and manual dispatch)
      - `packages/prism-code/bin/prism-code.ts`: version define fallback
      - `packages/prism-code/src/providers.ts`: any non-literal imports made literal
    - References:
      - User direction: native curl installer
  - Test Cases to Write:
    - Per-target CI self-test (version, headless mock, doctor, PTY launch/exit).
    - A keychain probe in the binary returns a result (available/unavailable) without crashing on Linux runners without Secret Service.
  - Notes (executed 2026-09-29):
    - `scripts/build-prism-code-binaries.mjs` (new) runs `bun build --compile --minify --bytecode --format=esm --target=bun-<os>-<arch>[-musl] --external playwright-core --no-compile-autoload-dotenv --no-compile-autoload-bunfig --define PRISM_CODE_VERSION=…` on `packages/prism-code/bin/prism-code.ts` (802 modules).
      - `--self-test` runs the shared checks against the binary and `--archive` writes `prism-code-<target>.tar.gz` (binary + LICENSE). `--checksums <dir>` writes a `sha256sum -c` compatible `SHA256SUMS`. Every run writes `<target>/build-report.json` with sizes, hashes, and timings.
      - `--format=esm` is required: OpenTUI uses top-level await, which the default CJS bytecode format rejects.
      - Guards, all fail closed: Bun must be exactly `1.4.2`; the target must be the host's own (`--cross` is an unverified escape hatch); the target's `@opentui/core-*` and `@napi-rs/keyring-*` packages must be installed; the output may link only system libraries (`ldd`/`otool -L` allow-list).
      - The portability guard caught a real problem: this workstation's distro-packaged Bun links the system ICU (`libicui18n.so.78`), and `bun build --compile` copies the running Bun as the runtime even with an explicit `--target`. The resulting binary failed in a clean container, and that Bun also started a compiled hello-world in ~145 ms versus ~5 ms for the official runtime. Builds therefore use the official Bun (CI `setup-bun`, or `oven/bun` locally).
      - The official musl Bun itself links `libstdc++`/`libgcc_s`, so those two are allowed for musl targets only, and Alpine hosts need `apk add libstdc++ libgcc` (documented; a bare `alpine:3.20` fails with relocation errors).
    - Embedding, verified in the binaries:
      - The OpenTUI native library and its parser worker are embedded through OpenTUI's `with { type: "file" }` imports.
      - The `@napi-rs/keyring` `.node` addon loads from the binary. Under the host D-Bus session the keychain store is `ok`; with no session doctor reports "no credential store selected" instead of crashing.
      - All provider imports in `providers.ts`/`oauth.ts`/`tui/commands.ts` were already literal, so none needed converting.
    - Fixes the binary exposed:
      - (a) `@arnilo/prism-memory` `wiki/cli.ts` and `@arnilo/prism-coding-tools` `dev/cli.ts` detected a direct run by comparing `import.meta.url` with `process.argv[1]`. Inside a compiled binary every bundled module shares the binary's URL, so `prism-code doctor` ran the `prism-wiki` CLI. Both now use `import.meta.main`, which was verified false for bundled modules and true for a direct run; `bun dist/wiki/cli.js help` and `bun dist/dev/cli.js --help` still work. Suites: memory 493/493, coding-tools 659/659.
      - (b) `doctor`'s `runtime` check resolved package paths (`require.resolve`), which fails in a binary. It now dynamically imports `@opentui/core` and calls `resolveRenderLib()`. That is one code path for both channels and a stronger check, since it catches a broken native library.
      - (c) OpenTUI loads its musl library only when `OPENTUI_LIBC=musl`, and loading the glibc library on a musl host crashes. `packages/prism-code/src/libc.ts` `applyOpenTuiLibc()` runs in the bin before the app graph loads and sets `musl` when `process.report` has no `glibcVersionRuntime` (0.2 ms); an explicit value wins. This applies to both channels, so the binary needs no libc define. It is unit-tested (`libc.test.ts`) and kept off the package index to avoid public-API churn.
    - Binary vs Bun install, the only differences:
      - the version define;
      - no `.env`/`bunfig.toml` autoload (a repository `bunfig.toml` `preload` would otherwise execute repository code in the agent);
      - `playwright-core` external (the opt-in Obscura native browser tools report the optional peer as missing, exactly as in a Bun install without it).
      There are no `process.execPath` branches. User `tools.add` modules load from disk (self-tested); the identity caveat and the plain-`ToolDefinition` recommendation are documented.
    - Shared checks: `scripts/lib/prism-code-checks.mjs` (new) holds the sandbox, the recorder, and `runPrismCodeChecks`. The Task 2 install smoke now uses it and still passes 11/11.
      - Binary self-test, 11 checks, with no Bun on `PATH`: version, cold `--version` median < 150 ms, headless mock, doctor ok / only-`model` fail / OpenTUI native load, keychain probe answers without crashing, `tools.add` module loads and runs, PTY launch + answer + exit 0, alternate screen restored, first frame < 500 ms.
    - Evidence (official images, final source):
      | target | image | binary | archive | cold `--version` median | TUI first frame | self-test |
      | --- | --- | --- | --- | --- | --- | --- |
      | `linux-x64` | `oven/bun:1.4.2` | 117,073,376 B | 49,032,201 B | 20 ms | 130 ms | PASS 11/11 |
      | `linux-x64-musl` | `oven/bun:1.4.2-alpine` | 111,044,144 B | 46,501,088 B | 25 ms | 129 ms | PASS 11/11 |
      - Determinism: two builds of the same tree produced byte-identical binaries (`0c25559f…`) and archives (`c9268679…`).
      - Reproducibility across checkouts: a clean copy (no `node_modules`/`dist`) followed by `bun ci && bun run build` in `oven/bun:1.4.2-alpine`, mirroring the CI musl leg, reproduced the musl archive hash (`2d6a3d21…`) of the build from the working tree.
      - The glibc archive, extracted with `tar`, runs `--version`, a headless mock prompt, and `doctor` (no failures) on `debian:bookworm-slim` and `ubuntu:24.04` with no Bun installed. The musl archive does the same on `alpine:3.20` after `apk add libstdc++ libgcc`.
      - Not verified locally: `linux-arm64`, `linux-arm64-musl`, `darwin-x64`, `darwin-arm64` (no arm64 emulation or macOS host here). They are verified by their native CI legs on first run, where the self-test is the gate.
    - `.github/workflows/prism-code-binaries.yml` (new):
      - Triggers on `@arnilo/prism-code@*` tags and `workflow_dispatch`. On a tag push, the tag version must equal the manifest version.
      - Six-leg `fail-fast: false` matrix on native runners: `ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15-intel`, `macos-15`. The musl legs run `docker run oven/bun:1.4.2-alpine` on the Ubuntu runners, because JavaScript actions cannot run in Alpine job containers on arm64.
      - `SOURCE_DATE_EPOCH` is the commit time.
      - The `checksums` job downloads all six archives (`actions/download-artifact` v8.0.1 pinned to `3e5f45b2…`, resolved with `gh api`), writes and verifies `SHA256SUMS`, writes a per-target size/timing table to the job summary, attests the archives and sums with `actions/attest-build-provenance` (already used by `release.yml`, so available), and uploads `prism-code-binaries`.
      - Permissions: `contents: read`, plus `id-token`/`attestations: write` on the checksums job only. The GitHub Release is Task 5.
    - Signing: macOS binaries carry Bun's ad-hoc signature only. There is no Developer ID signature or notarization because the repository has no Apple signing identity. `curl` downloads are not quarantined; the browser-download `xattr` workaround is documented. SLSA provenance is enabled through attestations.
    - Tests and gates:
      - `scripts/build-prism-code-binaries.test.mjs` (new, in `GATE_FILES`, 6/6) covers the target table vs. the OpenTUI/keyring optional-dependency lists, workflow matrix coverage, the ustar format via `tar -tv`/`-x`, archive determinism, and `SHA256SUMS`.
      - prism-code 338/338; `e2e-prism-code-tui` + `run-all-tests` + binaries test 32/32; docs + live-doc-check 165/165; truth-current + version-literal-gate 13/13; `bun run lint` clean; Biome clean on every touched file.
      - `release:gate` (CI env) exits 0 with `"updated": false` after restoring the original order of the `index.ts` doctor re-export. A Biome `--write` had reordered it, and the compat stage compares that statement's text.
    - Task 1 regression fixed on the way: `scripts/version-literal-gate.test.mjs` still required every manifest to claim the lockstep `0.12.0`, so it failed 0/2 on the 0.4.0/0.1.0 manifests. It now treats `INDEPENDENT_LINES` (same set as `packaging.test.ts`) as self-consistent: the lockfile, package-truth, and every internal range must equal the package's own manifest version. A new positive control bumps the SDK alone and requires all three surfaces to be reported.
    - Package-truth regenerated: the prism-code per-module export counts moved to 335/370 because of the new `libc.ts` module.
    - Docs: `docs/release-and-install.md` has a new "Prism Code standalone binaries" section (targets, runners, host requirements, embedding, differences, build guards, determinism, CI, attestations, signing/Gatekeeper). `docs/index.md` Release and install entry, `docs/prism-code.md` (Install pointer; binary identity caveat and actual `allowedModules` matching in Security notes), `CHANGELOG.md` (Added binaries; Fixed bundled-CLI main detection), `packages/prism-code/CHANGELOG.md`, and `.gitignore` (`dist-bin/`) are updated.
    - Follow-ups (not in this task's scope):
      - (1) `bun run format:check` fails on 16 pre-existing prism-code/TUI files and `scripts/e2e-prism-code-tui.test.mjs` from plans 136–139 (untouched here); CI's `format:check` phase will fail until they are formatted.
      - (2) Relative `tools.allowedModules` entries are not resolved against the config directory, contrary to the "all path-bearing values resolve against the config directory" note. Fix the loader or narrow the doc.
      - (3) The Bun channel still honors a repository `bunfig.toml` (`preload`) because the bin runs under `#!/usr/bin/env bun`. Consider a guarded launcher, or document it as a trust boundary.
      - (4) The keychain probe reports `available` inside containers without a Secret Service, likely keyring's kernel-keyutils backend. This is the same in both channels, but a session keyring does not persist across reboots; review the `auto` store choice for headless Linux.
      - (5) `macos-15-intel` is the last Intel macOS runner label; track its retirement for `darwin-x64`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new distribution artifact.
    - Docs pages to create/edit:
      - `docs/release-and-install.md`: binary channel, targets, checksums, signing status
    - `docs/index.md` update: yes — Release and install entry mentions the standalone binary channel.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4: Native curl installer
  - Acceptance Criteria:
    - Functional: POSIX `install.sh` at the repo root (served from `https://raw.githubusercontent.com/ashiqrniloy/prism/main/install.sh`):
      - detects OS (`Linux`/`Darwin`), arch (`x86_64`/`aarch64`/`arm64`), and libc (musl via `ldd --version`/`/lib/ld-musl-*`);
      - resolves the version from `PRISM_CODE_VERSION`/`--version`, else the npm registry `https://registry.npmjs.org/@arnilo/prism-code/latest` (no GitHub API rate limits);
      - downloads `https://github.com/ashiqrniloy/prism/releases/download/prism-code-v<version>/prism-code-<target>.tar.gz` and `SHA256SUMS`, and verifies with `sha256sum`/`shasum -a 256` (aborts on mismatch);
      - installs atomically to `${PRISM_HOME:-$HOME/.prism}/bin/prism-code` (`0755`, dirs `0700`).
    - Functional: PATH handling: if `~/.prism/bin` is not on PATH, print the exact line for the detected shell (bash/zsh/fish). Only edit a shell rc when `--modify-path` is passed; never by default.
    - Functional: re-running upgrades in place; `install.sh --uninstall` removes the binary (not user data) and prints how to remove `~/.prism`. Unsupported platforms (Windows, other arch) exit with a clear message pointing to the Bun channel.
    - Functional: `prism-code --version` reports the install channel (`binary` vs `bun`) for support diagnostics.
    - Performance: the installer makes one version request, one archive download, and one checksum download; no build steps.
    - Code Quality: `shellcheck` clean; works under `sh` (dash) and `bash`; no `sudo`; `set -eu`; temp files are cleaned up with `trap`.
    - Security: HTTPS only (`curl --proto '=https' --tlsv1.2 -fsSL`); checksum verification is mandatory; the version string is validated against a semver regex before use in URLs/paths; the script is short enough to audit (≤ 200 lines).
  - Approach:
    - Documentation Reviewed:
      - GitHub Releases download URL format; npm registry `GET /<pkg>/latest` document; shellcheck docs
      - Prior art for curl installers (Bun `bun.sh/install`, Deno `install.sh`): detection patterns only, no code copied
    - Options Considered:
      - Host the installer on a custom domain. Deferred: raw GitHub URL works now; a short domain can redirect later.
      - Resolve latest via the GitHub API. Rejected: rate-limited for anonymous calls; npm `latest` is the source of truth for versions.
    - Chosen Approach: small POSIX script, npm-resolved version, GitHub Release assets, mandatory checksum.
    - API Notes and Examples:
      ```bash
      curl -fsSL https://raw.githubusercontent.com/ashiqrniloy/prism/main/install.sh | sh
      curl -fsSL https://raw.githubusercontent.com/ashiqrniloy/prism/main/install.sh | sh -s -- --version 0.4.0
      ```
    - Files to Create/Edit:
      - `install.sh`: new
      - `scripts/install-sh.test.mjs`: runs the installer against a local HTTPS fixture server serving fake archives/checksums (success, checksum mismatch, unsupported platform, upgrade, uninstall); host `sh` leg plus an Alpine musl container leg
      - `.github/workflows/prism-code-binaries.yml`: `install.sh fixture tests` job (real-release installer verification against the published release stays with Task 5's post-publish job, because the release does not exist on the first tag push until Task 5 creates it)
      - `packages/prism-code/src/version.ts`: channel in `--version` (plan file said `flags.ts`; `flags.ts` is pure arg parsing, so channel detection lives beside the version resolver)
      - `packages/prism-code/bin/prism-code.ts`, `packages/prism-code/src/__tests__/home.test.ts`
      - `scripts/lib/prism-code-checks.mjs`, `scripts/prism-code-install-smoke.mjs`, `scripts/build-prism-code-binaries.mjs`: expected `--version` line gains the channel suffix
      - `scripts/run-all-tests.mjs`: installer test joins `GATE_FILES` (host leg only; the docker leg is opt-in)
      - the test generates its own self-signed cert with `openssl` at run time (no private key is committed; the secret scan would reject one)
    - References:
      - User direction: native curl installer
  - Test Cases to Write:
    - Fixture-server installer tests listed above (host `sh` + Alpine musl container).
    - Post-release: the real installer on each runner is exercised by Task 5's post-publish job against the published release (the release must exist first).
  - Notes (executed 2026-09-29):
    - `install.sh` (new, 154 lines, POSIX `sh`, `shellcheck -s sh` clean) installs the target archive into `${PRISM_HOME:-$HOME/.prism}/bin/prism-code`:
      - target from `uname -s`/`-m` plus musl detection (`ldd --version` or `/lib/ld-musl-*`); Windows and other arch/os exit with a pointer to `bun add -g @arnilo/prism-code`;
      - version from `--version`/`PRISM_CODE_VERSION`, else one `GET https://registry.npmjs.org/@arnilo/prism-code/latest`; the semver regex is checked before the value reaches a URL or path;
      - HTTPS enforced by `curl --proto '=https' --tlsv1.2 -fsSL` on every request (one archive, one `SHA256SUMS`); the archive is staged only after its SHA-256 matches the sums entry (`sha256sum`, else `shasum -a 256`, else fail) and atomically renamed into place; dirs `0700`, binary `0755`; an `EXIT` trap removes the temp dir and staged file;
      - PATH hint prints the exact bash/zsh/fish line; `--modify-path` appends it to the shell rc at most once; re-running upgrades in place; `--uninstall` removes the binary and prints how to remove `~/.prism` without touching it.
      - `PRISM_CODE_REGISTRY_BASE_URL`/`PRISM_CODE_RELEASE_BASE_URL` are the fixture-test only overrides and stay HTTPS-enforced.
    - `--version` channel: `resolvePrismCodeChannel()` in `packages/prism-code/src/version.ts` returns `binary` when the `PRISM_CODE_VERSION` define is present, else `bun`; the bin prints `0.4.0 (bun)` / `0.4.0 (binary)`. Kept off the package index so the public export surface and compat baseline are unchanged. `scripts/lib/prism-code-checks.mjs` now requires a `channel` and both smokes supply it.
    - Tests: `scripts/install-sh.test.mjs` generates a self-signed cert with `openssl` at run time (SAN `localhost`/`127.0.0.1`; `CURL_CA_BUNDLE` trusts it; no committed private key — the secret scan rejects PEM keys) and uses async child spawns — a sync spawn deadlocks the in-process server. Host `sh` leg (7 tests) covers latest resolution, pinned version, non-semver rejection, checksum mismatch, upgrade, uninstall, `--modify-path` for bash and fish, and unsupported platform/arch stubs. An Alpine leg (`PRISM_INSTALL_SH_DOCKER=1`, docker available, `apk add curl`) proves real musl detection and install. The test is in `GATE_FILES` (host leg) and the binaries workflow runs the docker leg in the new `install.sh fixture tests` job. The real release installer runs in Task 5's post-publish job.
    - Evidence: `bun test scripts/install-sh.test.mjs` host 7/7 + docker 8/8; `bun scripts/prism-code-install-smoke.mjs` PASS 11/11 with `--version` `0.4.0 (bun)`; `docker run oven/bun:1.4.2 bun scripts/build-prism-code-binaries.mjs --self-test` PASS 11/11 with `0.4.0 (binary)`; prism-code package suite 338/338 (dist, rebuilt); `src/__tests__/docs.test.ts` 159/159; `live-doc-check.test.mjs` green; `release:gate` exit 0 `{ "updated": false, "packages": 14 }`.
    - Package-truth regenerated because `version.ts` gained one export: `scripts/package-truth.json`, `docs/{index,release-and-install,provider-packages}.md`, `README.md`, `docs/_evidence/phase54-package-map.md` (prism-code src exports 370 → 371). Generated blocks only; the hand-written binary/installer prose survived.
    - Docs: `docs/prism-code.md` Install section now documents both channels (curl first, `--modify-path`, `--uninstall`, checksum, channel in `--version`), `docs/release-and-install.md` gains a `Native curl installer` section, `docs/index.md` Prism Code entry mentions the curl installer, and the root/package CHANGELOGs and `packages/prism-code/README.md` carry the channel.
    - Gate environment note: `bun run release:gate` needs `PRISM_RELEASE_POSTGRES_JOB=1` **and** `PRISM_TEST_POSTGRES_URL` when `scripts/postgres-evidence.json` already matches HEAD, because the protected-surface branch only fires when no evidence file exists; with both set the gate is green (same as Task 3's note).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new install channel.
    - Docs pages to create/edit:
      - `docs/prism-code.md`: "Install" section (curl + Bun, upgrade, uninstall, PATH)
      - `docs/release-and-install.md`: installer behavior and checksum policy
    - `docs/index.md` update: yes — Prism Code entry: "install with Bun or the curl installer".
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5: Release pipeline wiring for independent package tags and binary releases
  - Acceptance Criteria:
    - Functional: pushing tags `@arnilo/prism-agent-sdk@0.1.0` and `@arnilo/prism-code@0.4.0` runs the existing `release.yml` verification and publish for those packages only (independent mode). The binaries workflow then builds and creates GitHub Release `prism-code-v0.4.0` with archives + `SHA256SUMS` and the CHANGELOG excerpt as notes.
    - Functional: publish order is SDK first, then prism-code (topological order from `validateReleaseIndependent`); a partial failure is resumable with the existing `--resume` publish mode.
    - Functional: the post-publish job runs the registry install smoke (Task 2) and the real curl installer (Task 4) against the new release.
    - Performance: the release pipeline adds ≤ 1 matrix workflow; binary jobs run in parallel.
    - Code Quality: no hardcoded version lists in the new workflow (tag-derived version).
    - Security: npm publish uses the existing token/provenance setup; the GitHub Release is created with `GITHUB_TOKEN` scoped to `contents: write` for that job only.
  - Approach:
    - Documentation Reviewed:
      - `.github/workflows/release.yml` (tag triggers include `@arnilo/*@*`), `scripts/release.mjs` publish/`--resume`, GitHub Actions `softprops/action-gh-release` or `gh release create` docs
    - Options Considered:
      - Build binaries inside `release.yml`. Rejected: keeps npm publish independent of the slower native matrix.
    - Chosen Approach: a separate binaries workflow chained on the prism-code tag.
    - API Notes and Examples:
      ```bash
      gh release create "prism-code-v${VERSION}" dist-bin/*.tar.gz dist-bin/SHA256SUMS --notes-file notes.md
      ```
    - Files to Create/Edit:
      - `.github/workflows/prism-code-binaries.yml`: `release` job (tag-derived version, archives + `SHA256SUMS` + CHANGELOG notes, draft for a pre-release, resumable via `gh release edit`/`upload --clobber`)
      - `.github/workflows/release.yml`: `post-publish-smoke` job (registry install smoke, then the real `install.sh` against the published release)
      - `CHANGELOG.md`, `docs/release-and-install.md`, `docs/prism-code.md`: present-tense release-pipeline prose (no new pages)
    - References:
      - Tasks 2–4
  - Test Cases to Write:
    - Deferred live dry-run: dispatch `prism-code-binaries.yml` with the workflow ref set to an `@arnilo/prism-code@<version>-rc.1` tag and confirm the draft release has all six archives and `SHA256SUMS`. Locally the branch logic is exercised with a stubbed `gh`, and the notes are generated from the real `packages/prism-code/CHANGELOG.md`.
  - Notes (executed 2026-09-29):
    - `release` job in `.github/workflows/prism-code-binaries.yml` (`needs: checksums`, `permissions: { contents: write }` on that job only; the workflow default stays `contents: read`): the version is `GITHUB_REF` minus `refs/tags/@arnilo/prism-code@` and must equal the manifest; it downloads the `prism-code-binaries` artifact, asserts six archives, extracts the `## [<version>]` section from `packages/prism-code/CHANGELOG.md` (fallback line when absent) and appends the curl-install snippet; `gh release create prism-code-v<version> … --target $GITHUB_SHA --title "Prism Code v<version>"` creates the tag-derived release, and a `-` pre-release version adds `--draft --prerelease`. A re-run finds the release and switches to `gh release edit` + `gh release upload --clobber`, so a partial binary failure is resumable too.
    - `post-publish-smoke` job in `.github/workflows/release.yml` (`needs: publish`, gated on `refs/tags/@arnilo/prism-code@`): first `bun scripts/prism-code-install-smoke.mjs --registry --version "$VERSION"` (Task 2's registry mode), then polls the release's `SHA256SUMS` over HTTPS for up to 20 minutes (the binaries workflow builds in parallel), runs the raw `install.sh` into a scratch `PRISM_HOME`, and asserts `prism-code --version` is `<version> (binary)`. Timeout 45 minutes (30 on the installer step).
    - The existing `release.yml` trigger list (`@arnilo/*@*`), the `publish` gate (`startsWith(github.ref, 'refs/tags/@arnilo/')`), and the independent branch's `--resume` already satisfied the tag-driven independent publish; they are unchanged. The hardcoded list in `publish in dependency order` is the pre-existing lockstep-cut list, not part of the new workflow.
    - Verification: `bun scripts/release.mjs publish --resume --dry-run --allow-dirty --allow-untagged` returned 12 changed lockstep packages all `skipped` (already published) — `--resume` works; the two new packages are invisible to `git diff` until committed (Task 1 note). Topological order with the new dirs treated as changed (`validateReleaseIndependent` with injected `gitDiff`/`baselineVersion`) puts `@arnilo/prism-agent-sdk` at index 11 and `@arnilo/prism-code` at 13. The release-notes awk produced the real 0.4.0 section and the stub-`gh` run exercised create (stable and `--draft --prerelease`) plus edit/upload. `docs` tests 165/0; `version-literal-gate` + `build-prism-code-binaries` 9/0; `tooling-gate` + `phase23-skip-manifest` + `office-golden-packed` 21/0; `workflow-liveness` and `postgres-evidence` pass. actionlint reports no issue in the new steps (the four infos left — binaries line 126 `SC2012`/`SC2016`, release.yml line 222 `SC2001`, line 264 `SC2016` — are pre-existing).
    - Deviation to record: the plan's dry-run test case needs GitHub Actions, so it is deferred to an operator with repo access. Dispatch the binaries workflow directly on the RC tag ref — pushing an RC tag would also run `release.yml`'s publish (pre-existing behavior, unchanged here).
    - Known window to record: npm publish and the binaries build run in parallel from the same tag, so `latest` on npm can point at the new version for the few minutes before the GitHub Release assets exist; `install.sh` resolves `latest` and would 404 in that window. Chosen over serializing (build binaries inside `release.yml`) so npm publication stays independent of the native matrix; a `workflow_run` chain or an installer retry loop can close it later if it matters.
    - Follow-ups (pre-existing, not Task 5): `scripts/phase30-release.test.mjs` fails because its temp fixtures lack `bun.lock` (`ENOENT … /tmp/prism-rel-*/bun.lock`, 8 tests), and `scripts/phase15-freeze.test.mjs`'s "baseline manifest count is coherent with the real filesystem" fails at 12 vs 14 manifests — both files are retired from the default suite; carry them into the plan-end/backlog handoff if they should be repaired.
    - Live-path prerequisite: the Task 2–5 files are still untracked (`install.sh`, `packages/prism-code`, `packages/agent-sdk`, the new scripts/workflow); they must be committed and merged to `main` before the tag-driven release works, because the smoke fetches `install.sh` from `raw.githubusercontent.com/…/main/install.sh`, `git diff` drives the publish order, and the release job builds from the tag commit.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — CI plumbing; the user-facing install behavior is documented by Tasks 2–4.
    - Docs pages to create/edit: `docs/release-and-install.md` (CI paragraph now describes the release and post-publish jobs) and `docs/prism-code.md` (verified-install line); no new pages.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 6: Live end-to-end acceptance, publish, and npm transition
  - Acceptance Criteria:
    - Functional: the live journey passes on both the Bun install and the Linux x64 binary with a real provider:
      1. `/provider` login (API key)
      2. a multi-step coding task using tools with approvals in `ask` mode and `todo_write`
      3. quit
      4. `--continue` resume
      5. OM on with `/om:status` showing observations
      6. a stdio MCP server tool used by the model
      7. a `doctor` pass

      The run is recorded as release evidence in the task note (transcript excerpt, redacted).
    - Functional: after explicit user confirmation, publish `@arnilo/prism-agent-sdk@0.1.0` and `@arnilo/prism-code@0.4.0` via tags (Task 5), then run `npm deprecate "@arnilo/prism-code@<0.4.0" "Replaced by the Prism Code terminal app (0.4.0+). The former coding-agent profile lives in @arnilo/prism-coding-tools and @arnilo/prism-agent-sdk."`. Deprecation is outward-facing and irreversible in practice, so it needs separate confirmation.
    - Functional: `CHANGELOG.md` entries for both packages are final; `docs/prism-code.md` Install section links to the release.
    - Performance: record time-to-first-response in the live journey.
    - Code Quality: all plans 136–139 are checked off, or their remaining items are recorded in `plans/backlog.md` through their own plan-end handoffs.
    - Security: the live journey uses a dedicated low-limit API key (`--max-cost` set); no credentials in recorded evidence.
  - Approach:
    - Documentation Reviewed:
      - `scripts/e2e-prism-code-live.test.mjs` (plans 136/137), `.github/workflows/live-matrix.yml`, npm `deprecate` docs
    - Options Considered:
      - Skip deprecating 0.3.x. Rejected: users pinned to `^0.3.0` would not learn about the app/library split.
    - Chosen Approach: evidence-backed live journey, then confirmed publish, then confirmed deprecation.
    - API Notes and Examples:
      ```bash
      git tag @arnilo/prism-agent-sdk@0.1.0 && git tag @arnilo/prism-code@0.4.0 && git push origin --tags   # after confirmation
      ```
    - Files to Create/Edit:
      - `scripts/e2e-prism-code-live.test.mjs`: full journey
      - `CHANGELOG.md`, `packages/*/CHANGELOG.md`, `docs/prism-code.md`
    - References:
      - Analysis "Verification before calling it done"
  - Test Cases to Write:
    - The live journey on both channels.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — first public release of the app and SDK.
    - Docs pages to create/edit:
      - `CHANGELOG.md`: release entries
      - `docs/prism-code.md`: Install links
    - `docs/index.md` update: no (updated by Tasks 1, 3, 4).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
