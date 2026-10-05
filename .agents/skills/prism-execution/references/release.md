# Release — exports, baselines, package truth, changelog, publish

Export-surface gates, compat baselines, package-truth generation, packaging and tarball rules, the changelog, versioning (lockstep plus independent), and the 0.13.0 publish.

## Target

- [roadmap.md](../../../../roadmap.md) Part 3 (version targets), Phase 11 (kernel freeze and 0.13.0), §1.4 (Bun-native: TypeScript source published, no build step).
- **One publish, not one per phase.** `@arnilo/prism` 0.13.0 and the native packages ship together in Phase 11, after Phases 13–16. After that, each package is versioned independently.
- **Deprecations happen at Phase 11 only.** `@arnilo/prism-agent-sdk` and the 0.12 family packages are deprecated on npm then, not earlier.
- **Changelog:** every phase records user-visible changes under `## [Unreleased]` in `CHANGELOG.md` as they land. The Phase 11 changelog and migration note from 0.12 is assembled from those entries.

## Every task that touches public surface

- **Moved, renamed, or removed export:**
  - Run `node scripts/release.mjs gate --update-baseline` in the same task, which rewrites `scripts/compat-baseline/<pkg>.txt`.
  - Paste the diff into the task note, with removals attributed to this plan or inherited.
  - Then run `node scripts/release.mjs gate` and confirm it exits 0.
  - The root-export freeze in `src/__tests__/public-export-contract.test.ts` (`root export surface is frozen`) is updated deliberately in the same task.
- **New or removed package:**
  - Update the root `workspaces` and the `build` script's package list.
  - Regenerate package truth with `node scripts/package-truth.mjs --emit-docs`.
  - Update the `packaging.test.ts` package list and add the baseline file.
  - Decide lockstep vs independent in `scripts/independent-packages.json`.
- **Retired error or name:** grep `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`).

## Today (0.12.1 mechanics)

- Gates: `bun run release:gate` runs ranges, compat (the `.d.ts` diff against `scripts/compat-baseline/`), and a tarball deny-list check. `bun run sdk:ready` is the full local gate (typecheck, lint, format:check, test, coverage, pack dry-run, release gate).
- Versioning: a lockstep `v*` cut for the family packages. Independent lines (`@arnilo/prism-agent-sdk`, `@arnilo/prism-code`) ship from their own `@arnilo/<name>@<version>` tag. The version literal gate (`scripts/version-literal-gate.test.mjs`) derives every version claim from the root manifest.
- Publishing: tag push → `.github/workflows/release.yml` → a verify job, then publish via npm on the release host (OIDC provenance). Contributors use Bun only.
- Packaging today builds to `dist/` with `.d.ts`, and `public-export-contract.test.ts` / `packaging.test.ts` assert that. The first plan that creates a TypeScript-source native package (roadmap Phase 2) owns changing those gates for the new layout.
- Docs: [release-and-install.md](../../../../docs/release-and-install.md) ("Release checklist" is the self-maintaining gate table: extend the matching row when you add a package, example, or API page), [testing.md](../../../../docs/testing.md), [contributing.md](../../../../docs/contributing.md).

## Graft queries

- `graft ask "release gate compat baseline diff allow-break" --source`
- `graft ask "independent packages lockstep cut publish order" --source`
- `graft grep "workspacePackageCounts"`

## Tests and gates

- `src/__tests__/packaging.test.ts`, `release.test.ts`, `public-export-contract.test.ts`, `install-smoke.test.ts`, `docs.test.ts`
- `scripts/release-gate.test.mjs`, `scripts/truth-current.test.mjs`, `scripts/packaging-current.test.mjs`, `scripts/version-literal-gate.test.mjs`, `scripts/workflow-liveness.test.mjs`

## Rules

- Never commit `scripts/release-evidence.json` (it is regenerated each run) or `scripts/live.env` (local secrets; the secret scan fails on it by design).
- Never widen or delete freeze-test literals to make a gate pass. Update them to the new true values with the edit tool; sed mangles regex literals.
- Never use `--allow-break` without a migration note naming the target version.
- Run workspace package tests from the workspace directory; their paths are cwd-relative.
- Before pushing, run `bun run format` / `biome check --write` and the regeneration commands. Formatting and stale generated docs are the most common verify blockers.
