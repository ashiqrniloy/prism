# Retiring the Node runtime (0.12.0)

> Archived record. Node runtime support retired in **0.12.0**; the live runtime contract is
> [release and install](../release-and-install.md). Kept verbatim for audit — do not read it as
> current guidance.

## What the 0.1.x–0.11.x line declared

Through 0.11.1 Prism described itself as a TypeScript/Node.js agent harness and declared
`engines.node >=22` in every publishable manifest. The support matrix was frozen by Phase 12 Task 0
in `scripts/phase12-freeze-manifest.json`:

| Runtime | Supported | Measured in CI |
| --- | --- | --- |
| Node | 22, 24 (`engines.node >=22`, the 0.x floor) | two declared legs: `verify` imports every public root `exports` default target on Node 24, and `node22-compat` runs the same public export imports on Node 22, for the declared `engines.node >=22` this table recorded. |

The floor moved once: Node 20 was dropped in 0.6.0 (`dev-006`; Node 20 reached upstream end-of-life
2026-04-30) and the `node20-compat` CI leg became `node22-compat`. `@types/node` stayed on the
published floor (`^22.20.0`) so that an API the published line could not provide failed the build
instead of compiling clean against a newer type surface. The docs-example path needed Node >=22.6
native TypeScript stripping, which is why the import smoke (not the full demo run) was the Node 22
leg.

**Recorded compatibility matrix (2026-07-26, release 0.0.16):**

| Leg | Node | Result |
| --- | --- | --- |
| Full SDK readiness (`bun run sdk:ready`: typecheck, lint, format, test, coverage, pack, release:gate) | 24.18.0 (current) | ✅ green — 1312/1312 tests, lint 0 errors, format clean, coverage 64/72/79 vs 60/70/75 thresholds. |
| Build toolchain (`tsc` 7.0.2, `biome` 2.5.13) | 20.20.2 (LTS iron) | ✅ both run under Node 20. |
| Public surface import smoke (all 21 root `exports` default targets) | 20.20.2 | ✅ all import cleanly. |
| Full core test suite | 20.20.2 | 1311/1312 — the single failure is `examples_demos_run_to_completion_and_emit_no_secret`, which executes `examples/*.ts` via Node's native TypeScript stripping (Node 22.6+). This is a test-harness capability, not an SDK runtime incompatibility, and is exactly why CI scoped Node 20 to build + import smoke. |

## What changed

Plans 124–129 moved the contributor toolchain, the test runner, the CI runtime, and finally the
consumer contract to Bun:

- **Plan 124** moved every test stage, script wrapper, and CI step to the Bun binary; the only
  surviving Node process is the branch-coverage audit (`scripts/branch-coverage-audit.mjs`), because
  Bun 1.4.2 emits no branch data.
- **Plan 125 Task 1** replaced `engines.node` with `engines.bun >=1.4.2` in all twelve publishable
  manifests and retired the two declared Node legs together with it. Both legs were *measured*
  (each ran `scripts/public-import-smoke.mjs`, since deleted) rather than dead, so the retirement
  removed a real check and replaced it with the packed-consumer import sweep that imports every
  public subpath of every package on Bun (`scripts/packaging-current.test.mjs`).
- **Plan 125 Task 4** rewrote the live install and runtime documentation around `bun add`, moved the
  Node story here, and recorded the retirement in `CHANGELOG.md`.

`engines.bun` is advisory metadata: neither npm nor Bun 1.4.2 enforces it (a manifest declaring
`engines.bun >=99.0.0` installs silently under both), so the retirement's compensating control is the
import-side failure message that plan 126 Task 2 adds when the durable storage layer moves to
`bun:sqlite`. A Node host running a 0.12.0 package fails closed at import with an actionable
message instead of at install time. No 0.12.0 tarball reaches the registry before plan 129's cut, so
no Node host sees the gap without the message.

The registry keeps the 0.11.x line for Node hosts; hosts that install with npm can still install
Prism (the published 0.11.x tarballs declare `engines.node >=22`), but the runtime contract for the
0.12.0 line is Bun. The release host keeps npm for `pack`/`publish`/`sbom` — runner images ship
Node, `bun pack` does not exist, and `bun publish` has no `--provenance` on 1.4.2 (plan 125 Task 5).
