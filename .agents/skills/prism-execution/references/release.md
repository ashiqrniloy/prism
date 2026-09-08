# Release — versions, exports, freeze tests, workflows, packaging

Lockstep version bumps, export-surface gates, freeze tests, GitHub Actions
release pipeline, package truth. Read for version-bump/tag/CHANGELOG tasks.

## Docs and files

- [release-and-install.md](../../../../docs/release-and-install.md): package graph, install rules, publication pipeline.
- [migrate-to-0.5.md](../../../../docs/migrate-to-0.5.md): 0.4 → 0.5 cuts and rollback.
- [CHANGELOG.md](../../../../CHANGELOG.md: per-version deltas (root; packages keep their own).
- [history/README.md](../../../../docs/history/README.md): frozen migration/handoff archives — traceability only.

## Graft queries

- `graft ask "release publish lockstep topological order" --source`
- `graft grep "HARD_RUN_LIMITS"`

## Tests and gates

- `src/__tests__/packaging.test.ts`, `release.test.ts`, `public-export-contract.test.ts`, `install-smoke.test.ts`
- `scripts/phase54-package-map.test.mjs`, `scripts/truth-current.test.mjs`, `scripts/packaging-current.test.mjs`
- Version bumps: bump ALL 10 package.json files + internal `@arnilo/*` ranges, then sweep stale `0\.5\.x` literals in test freeze asserts (`rg -l '0\.5\.3'`), update `src/index.ts` `export const version`, regenerate `scripts/compat-baseline/` + `node scripts/phase54-package-map.mjs` + `node scripts/package-truth.mjs --emit-docs`.

## Don't do

- Don't commit `scripts/release-evidence.json` (gitignored, regenerated per run).
- Don't commit secrets — `scripts/live.env` is local-only; secret-scan fails locally with it present by design.
- Don't remove or widen freeze-test literals to make a release pass — update them to the new true values via the edit tool (sed mangles regex literals).
- Don't run provider package tests from repo root — `cd` into the workspace first (cwd-relative paths).

## Pipeline

Tag push `vX.Y.Z` → `.github/workflows/release.yml`: verify job (format/lint/build/test/gates) → publish job (`npm run release:publish -- --lockstep --version <v> --resume`, OIDC provenance). Format failures (`biome`) and stale generated docs are the two most common verify blockers — run `npx biome check --write` and the regen commands locally before pushing.
