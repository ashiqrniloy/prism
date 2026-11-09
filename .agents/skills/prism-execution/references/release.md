# Release — exports, baselines, package truth, changelog, publish

Export-surface gates, compat baselines, package-truth generation, packaging and tarball rules, the changelog, versioning (lockstep plus independent), and the 0.13.0 publish.

## Target

- [roadmap.md](../../../../roadmap.md) Part 3 (version targets), Phase 11 (kernel freeze and 0.13.0), §1.4 (Bun-native: TypeScript source published, no build step).
- **One publish.** `@arnilo/prism` 0.13.0 and the native packages and host libraries ship together, in lockstep, at the end of the 0.13.0 release path (`plans/README.md`; plan 215 Task 39 is the publish step). After that, each package is versioned independently and declares the kernel API level it targets (`requires: { api: 1 }`, peer range `>=0.13.0 <1.0.0`).
- **Owner gates.** The `v0.13.0` tag push and the npm deprecations (`@arnilo/prism-agent-sdk`, `@arnilo/prism-code`, the 0.12 family packages, and the deleted provider packages) need explicit owner confirmation; never run them unprompted.
- **Changelog:** every task records user-visible changes under `## [Unreleased]` in `CHANGELOG.md` as they land. The 0.13.0 changelog and the migration note (`docs/migrate-to-0.13.md`) are assembled from those entries.

## Every task that touches public surface

- **Moved, renamed, or removed export:**
  - Run `bun scripts/release.mjs gate --update-baseline` in the same task, which rewrites `scripts/compat-baseline/<pkg>.txt`.
  - Paste the diff into the task note, with removals attributed to this plan or inherited.
  - Then run `bun scripts/release.mjs gate` and confirm it exits 0.
  - The root-export freeze in `src/__tests__/public-export-contract.test.ts` (`root export surface is frozen`) is updated deliberately in the same task.
- **New or removed package:**
  - Update the root `workspaces` and the `build` script's package list.
  - Regenerate package truth with `node scripts/package-truth.mjs --emit-docs`.
  - Update the `packaging.test.ts` package list and add the baseline file.
  - Decide lockstep vs independent in `scripts/independent-packages.json`.
- **Retired error or name:** regenerate the list with `bun scripts/retired-names.mjs --generate` (a removed tool goes in `scripts/retired-tool-names.json`), then fix every hit `bun scripts/retired-names.mjs` reports. The sweep skips migration guides, tests, history, and sentences that state the removal; a name that stays an ordinary word goes in `vocabulary` with a reason.

## Today

- **The gate.** `bun run release:gate` runs, in order: the release-evidence manifest, the client-neutrality check, the reference host suite, the process-driver suite, the reference adapters (`examples/adapters/conformance.ts`), the vendor-neutrality and kernel-constraint tests, the clean-install idempotence suite, and `bun scripts/release.mjs gate` (version-range drift, the per-package API surface against `scripts/compat-baseline/`, the kernel size budget, the tarball deny list). [release.md](../../../../docs/release.md) "What the gate runs" is the authoritative list; the durable Postgres leg needs `PRISM_TEST_POSTGRES_URL` or the gate stops at `checkReleaseEvidence`.
- **Full local check.** `bun run sdk:ready` = typecheck, lint, format check, all tests, coverage, `pack:dry-run`, and `release:gate`.
- **`scripts/release.mjs` modes:** `check`, `publish`, `gate`, `bump`, `changed`, `pack` (plus `--update-baseline`, `--resume`, `--dry-run`, `--lockstep --version <v>` / `--independent`).
- **Versions.** Every first-party package reads its version from its own `package.json` (`manifest.version`); `scripts/version-literal-gate.test.mjs` fails on a version literal.
- **Version lines.** `scripts/independent-packages.json` holds two lists. `experimental` names the packages on the prerelease line (the four memory and knowledge packages at `0.13.0-experimental.N`, dist-tag `experimental`, bumped only with `prerelease`, each from its own `@arnilo/<name>@<version>` tag). `packages` names stable packages on their own line; it is empty at the 0.13.0 cut, so `v0.13.0` (`release.mjs --lockstep --version 0.13.0`) publishes every stable package together. After the 0.13.0 publish, plan 215 Task 39 lists every native package and host library in `packages` except `@arnilo/prism-host-builder` (its indexes describe one kernel version, so it stays on the kernel's line). From then each listed package versions independently: `changed` finds what moved since its last tag, `bump` sets its version, it publishes from its own `@arnilo/<name>@<version>` tag, and it keeps its kernel peer range `>=0.13.0 <1.0.0` while it targets API level 1. [release.md](../../../../docs/release.md) "Experimental packages" has the enforced rules.
- **Publishing.** Tag push → `.github/workflows/release.yml`: a verify job, then `bun scripts/release.mjs pack --destination release-artifacts` once, GitHub build provenance on those tarballs, and `bun publish <tarball>` for the same bytes. No npm binary runs in the release path. The SBOM is `bun scripts/sbom.mjs` (SPDX 2.3). Deprecations run through `.github/workflows/npm-deprecate.yml`.
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
