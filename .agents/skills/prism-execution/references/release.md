# Release — exports, baselines, package truth, changelog, publish

Export-surface gates, compat baselines, package-truth generation, packaging and tarball rules, the changelog, versioning (lockstep plus independent), and the 0.13.0 publish.

## Target

- [roadmap.md](../../../../roadmap.md) Part 3 (version targets), Phase 11 (kernel freeze and 0.13.0), §1.4 (Bun-native: TypeScript source published, no build step).
- **One publish.** `@arnilo/prism` 0.13.0 and the six bundles ship together, in lockstep, at the end of the 0.13.0 release path (`plans/README.md`; plan 224 Task 10 is the publish step). Seven npm packages in total: the kernel, the four stable bundles (`@arnilo/prism-ai`, `@arnilo/prism-extensions`, `@arnilo/prism-tools`, `@arnilo/prism-hosts`) and the two experimental ones (`@arnilo/prism-memory-system`, `@arnilo/prism-knowledge`). Every former package is a subpath of a bundle, and no former name is published, so none of them needs a deprecation. After that, each stable bundle is versioned independently — except `@arnilo/prism-hosts`, which stays on the kernel's line because `prism-host-builder`'s indexes describe one kernel version — and each package subpath declares the kernel API level it targets (`requires: { api: 1 }`, peer range `>=0.13.0 <1.0.0`).
- **Owner gates.** The `v0.13.0` tag push and the npm deprecations (`@arnilo/prism-agent-sdk`, `@arnilo/prism-code`, the 0.12 family packages, and the deleted provider packages) need explicit owner confirmation; never run them unprompted.
- **Changelog:** every task records user-visible changes under `## [Unreleased]` in `CHANGELOG.md` as they land. The 0.13.0 changelog and the migration note (`docs/migrate-to-0.13.md`) are assembled from those entries.

## Every task that touches public surface

- **Moved, renamed, or removed export:**
  - Run `bun scripts/release.mjs gate --update-baseline` in the same task, which rewrites `scripts/compat-baseline/<pkg>.txt`.
  - Paste the diff into the task note, with removals attributed to this plan or inherited.
  - Then run `bun scripts/release.mjs gate` and confirm it exits 0.
  - The root-export freeze in `src/__tests__/public-export-contract.test.ts` (`root export surface is frozen`) is updated deliberately in the same task.
- **New or removed bundle (owner decision):**
  - Update the root `workspaces` and the `build` script's package list.
  - Regenerate package truth with `node scripts/package-truth.mjs --emit-docs`.
  - Update the `packaging.test.ts` package list and add the baseline file.
  - Decide lockstep vs independent in `scripts/independent-packages.json`; `@arnilo/prism-hosts` stays lockstep with the kernel.
- **New or removed package subpath:** add or delete its `scripts/bundles.json` row, its `exports` and `files` entries in the bundle's `package.json`, its `README.md` and `docs/index.md` link, and its line in the `packaging.test.ts` package list. No new workspace, baseline or `independent-packages.json` entry.
- **Retired error or name:** regenerate the list with `bun scripts/retired-names.mjs --generate` (a removed tool goes in `scripts/retired-tool-names.json`), then fix every hit `bun scripts/retired-names.mjs` reports. The sweep skips migration guides, tests, history, and sentences that state the removal; a name that stays an ordinary word goes in `vocabulary` with a reason.

## Today

- **The gate.** `bun run release:gate` runs, in order: the release-evidence manifest, the client-neutrality check, the reference host suite, the process-driver suite, the reference adapters (`examples/adapters/conformance.ts`), the vendor-neutrality and kernel-constraint tests, the clean-install idempotence suite, and `bun scripts/release.mjs gate` (version-range drift, the per-package API surface against `scripts/compat-baseline/`, the kernel size budget, the tarball deny list). [release.md](../../../../docs/release.md) "What the gate runs" is the authoritative list; the durable Postgres leg needs `PRISM_TEST_POSTGRES_URL` or the gate stops at `checkReleaseEvidence`.
- **Full local check.** `bun run sdk:ready` = typecheck, lint, format check, all tests, coverage, `pack:dry-run`, and `release:gate`.
- **`scripts/release.mjs` modes:** `check`, `publish`, `gate`, `bump`, `changed`, `pack` (plus `--update-baseline`, `--resume`, `--dry-run`, `--lockstep --version <v>` / `--independent`).
- **Versions.** Every first-party package reads its version from its own `package.json` (`manifest.version`); `scripts/version-literal-gate.test.mjs` fails on a version literal.
- **Version lines.** `scripts/independent-packages.json` holds two lists. `experimental` names the bundles on the prerelease line (`@arnilo/prism-memory-system` and `@arnilo/prism-knowledge` at `0.13.0-experimental.N`, dist-tag `experimental`, bumped only with `prerelease`, each from its own `@arnilo/<name>@<version>` tag). `packages` names stable bundles on their own line; it is empty at the 0.13.0 cut, so `v0.13.0` (`release.mjs --lockstep --version 0.13.0`) publishes every stable bundle together. After the 0.13.0 publish, plan 224 Task 10 lists `@arnilo/prism-ai`, `@arnilo/prism-extensions` and `@arnilo/prism-tools` in `packages`; `@arnilo/prism-hosts` stays out because it versions with the kernel. From then each listed bundle versions independently: `changed` finds what moved since its last tag, `bump` sets its version, it publishes from its own `@arnilo/<name>@<version>` tag, and its subpaths keep their kernel peer range `>=0.13.0 <1.0.0` while the kernel targets API level 1. [release.md](../../../../docs/release.md) "Experimental packages" has the enforced rules.
- **Publishing.** Tag push → `.github/workflows/release.yml`: a verify job, then `bun scripts/release.mjs pack --destination release-artifacts` once, GitHub build provenance on those tarballs, and `npm publish <tarball> --provenance` for the same bytes under OIDC (plan 215 Task 38). Bun has no trusted-publishing support; the release-host npm toolchain is the deliberate exception. Six new bundle names need the owner’s first-publish bootstrap before their trusted publishers can be configured. The SBOM is `bun scripts/sbom.mjs` (SPDX 2.3). Deprecations run through `.github/workflows/npm-deprecate.yml`.
- **Packaging.** Every publishable workspace ships TypeScript source and no `dist/`; `public-export-contract.test.ts` and `packaging.test.ts` assert it, and the compat diff emits declarations into a throwaway `.types/`.
- Docs: [release.md](../../../../docs/release.md) ("What the gate runs": extend the matching check when you add a package, example, or docs page), [testing.md](../../../../docs/testing.md), [contributing.md](../../../../docs/contributing.md).

## Graft queries

- `graft ask "release gate compat baseline diff allow-break" --source`
- `graft ask "independent packages lockstep cut publish order" --source`
- `graft grep "workspacePackageCounts"`

## Tests and gates

- `src/__tests__/packaging.test.ts`, `release.test.ts`, `public-export-contract.test.ts`, `install-smoke.test.ts`, `docs.test.ts`
- `scripts/release-gate.test.mjs`, `scripts/truth-current.test.mjs`, `scripts/packaging-current.test.mjs`, `scripts/version-literal-gate.test.mjs`, `scripts/workflow-liveness.test.mjs`

## Rules

- Never commit `scripts/release-evidence.json` (it is regenerated each run) or `scripts/live.env` (local secrets; the secret scan fails on it by design).
- Live provider keys live in `~/.config/prism/live.env` (mode 0600, override with `PRISM_LIVE_ENV_FILE`). Never ask for a key in chat.
- Never widen or delete freeze-test literals to make a gate pass. Update them to the new true values with the edit tool; sed mangles regex literals.
- Never use `--allow-break` without a migration note naming the target version.
- Run workspace package tests from the workspace directory; their paths are cwd-relative.
- Before pushing, run `bun run format` / `biome check --write` and the regeneration commands. Formatting and stale generated docs are the most common verify blockers.
