# Contribution quality budgets

## What it does

Records the code-quality ceilings a change must not raise, and the procedure for lowering them. Three budgets exist today: the non-null assertion allowance per directory, the public export surface per package, and the benchmark/timing envelopes. All live in `scripts/budgets.json` and are enforced by in-chain gates that run as part of `npm test`.

## When to use it

Before a change that adds a `!` non-null assertion, adds a public export, or moves code between directories; and after any sweep that removes them — the recorded numbers are lowered in the same change, never later.

## Non-null assertions

`style/noNonNullAssertion` is an **error** repo-wide in `biome.json`. Directories that still carry legacy sites are switched back to `off` per directory through `overrides`, and `scripts/budgets.json` → `nonNullAssertions` records how many sites remain in each of them.

Rules:

- New code does not add `!`. Narrow the value once — a local `const` behind an explicit guard — or capture the seam in a helper (the durable-session and elicitation seams are the models). Do not trade the assertion for an `as` cast or a `??` placeholder.
- Keep the allowlist and the budget rows identical: the gate asserts that the `biome.json` allowlist directories and the `nonNullAssertions.byPath` keys describe the same set, so there is no ambiguity about which row an override corresponds to.
- A sweep lowers the directory's `byPath` number and the `ceiling` in the same change. Raising a number needs a reason in the `$comment`.
- When a directory reaches zero sites, delete its `overrides` entry and its `byPath` row: the gate fails on a stale zero row rather than letting the allowance rot.
- The clusters swept in that pass — `src/agent-approval.ts`, `src/agent-loops.ts`, `src/agent-tool-dispatch.ts`, `packages/prism-coding-tools/src/agent/{glob-match,delete,git*}.ts`, `packages/prism-coding-tools/src/agent/language/framing.ts`, and `packages/prism-coding-tools/src/security/{sandbox-tar,sandbox-fs-operations}.ts` — are re-enabled as errors by the last override in `biome.json` (the last matching override wins), so they cannot regress. The gate rejects a rename that would silently drop that enforcement.
- Measure locally with one pass: `node_modules/.bin/biome lint --only=style/noNonNullAssertion --reporter=json .`. `--only` reports the rule inside allowlisted directories too, which is what makes the counting gate possible; the gate also fails when a site appears outside the allowlist.

## Public export surface

`scripts/budgets.json` → `exportCounts` records a ceiling per package. Growth fails the gate and names the package and the exact delta. Prefer re-exporting an existing symbol (or documenting the host-side composition) over widening a package's surface; moving an existing internal helper between modules does not change the count, because the counter dedupes by name.

## Timing envelopes

Benchmark medians and p95 ceilings in `scripts/budgets.json` are non-flaky sanity bounds, not portable SLOs; the startup gate additionally compares a machine-relative ratio so external CPU load cannot fail the suite. `scripts/benchmark.mjs` produces the evidence-of-record numbers.

## Related APIs

- `scripts/budget-gates.mjs`: `measureNonNullAssertions()`, `evaluateNonNullBudget()`, `measureExportCounts()`, `checkExportBudget()`, and the startup helpers.
- `scripts/budget-gate.test.mjs`: the in-chain gate, including the negative fixtures that prove each failure mode.
- `scripts/run-all-tests.mjs`: the stages `npm test` runs (`gate suites` includes the budget gate).
- [Release and install](release-and-install.md): the release gates that re-assert these budgets before publication.
