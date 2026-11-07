# Host-builder evaluation (plan 215 Task 20)

Measures whether the `@arnilo/prism-host-builder` kit (the skill, the version-exact indexes, the MCP server) helps a
Prism builder agent build a Prism host. The builder works on fixture tasks and is graded by hidden tests it never sees.

## Arms

| Arm | The builder has |
| --- | --- |
| `none` | `tools-coding` (shell enabled inside the project), `contextFiles`, and the installed Prism docs under `node_modules/@arnilo` |
| `skill` | the same, plus the host-builder package installed (indexes, example sources) and the skill copied to `.agents/skills` by `prism-host-builder install --target agents` |
| `skill+mcp` | the `skill` arm plus `@arnilo/prism-mcp` connected over stdio to `prism-host-builder mcp --root <project>` |

`host_builder_eval_arms_differ_only_by_the_kit` checks that nothing else differs. The `skill+mcp` server is started
without `--entry` or `--package`, so only the lookup tools and docs resources are offered.

## Tasks

Seven fixture tasks from plan 215 Task 13 (c). Each has a seed project in `workspaces/<task>/` (on top of
`workspaces/_common/`), a hidden acceptance test in `hidden/<task>.test.ts` and an oracle solution in `solutions/<task>/`.

| Task | What the builder does | Friction it comes from |
| --- | --- | --- |
| `headless-host` | create a minimal headless host | a missing principal makes durable tools fail |
| `approval-ask` | make `write`, `edit` and `shell` ask a person, and refuse when nobody can answer | fail-closed approval |
| `sqlite-resume` | persist sessions in SQLite and reopen one by id | stores are packages; `store: "memory"` is a 0.12 shape |
| `acp-serve` | serve the agent over ACP with client-side permission | host libraries are found by reading READMEs |
| `compaction-slot` | add `memory-compaction` next to a package that already claims `compaction` | a slot with two owners fails closed |
| `package-conformance` | write a package and a conformance test | hook payload names, the conformance helper |
| `upgrade-0-12` | upgrade a 0.12-shaped host | the retired-name tables in `docs/migrate-to-0.13.md` |

## Scorers

- `typecheck_passes`: `tsc -p tsconfig.json` reports no error in the project's own files.
- `acceptance_tests_pass`: the hidden test passes. It is copied into `__acceptance__/` after the run and removed.
- `public_surface_only`: the reference host's import allow-list, applied to the project.
- `no_retired_names`: no 0.12 name from `docs/migrate-to-0.13.md`.
- `tool_calls` (cost, not a claim): `1 / (1 + tool calls)`. Tokens, cost and wall time come from the experiment report.

## Claim rules

Pre-registered in `criteria.json` and locked in `criteria.lock.json`. Per provider, `compareExperiments` compares
`skill` with `none`, `skill+mcp` with `none` and `skill+mcp` with `skill` on the four claim scorers at alpha .05.

- A claim is published only for a significant improvement, on every provider that ran.
- A significant regression of either skill arm against `none` blocks the plan until that component is fixed and
  re-measured once (`--round 2`). If it still regresses the owner decides and the decision is recorded.
- An unscored record (provider or harness failure) makes the result `inconclusive`: rerun, never publish.

## Running

```bash
timeout 600 bun scripts/host-builder-evals/run.mjs --offline                       # scripted oracle, no key, about 15 s
bun scripts/host-builder-evals/run.mjs --register                                  # lock the criteria and inputs, then commit
timeout 1800 bun scripts/host-builder-evals/run.mjs --dry-run --providers hyper    # three tasks, one trial: the cost estimate
timeout 3600 bun scripts/host-builder-evals/run.mjs --live --providers hyper,opencode-go
```

Offline mode answers every task with its oracle solution through the real write tool. It proves the workspaces, the
arms, the hidden tests and the scorers are wired together, not that the kit helps. A paid run (`--dry-run` or `--live`)
needs the lock to match `criteria.json` and every registered input; a `--live` run also needs `scripts/host-builder-evals`,
the skill and the indexes committed. Keys come from `~/.config/prism/live.env`; the builder's shell inherits none of them
(`host_builder_eval_builder_shell_never_sees_live_keys`). Models come from
`PRISM_LIVE_HOST_BUILDER_EVAL_{HYPER,OPENCODE}_MODEL`.

Evidence is written to `docs/_evidence/host-builder/212/<providers>.json` and `.md` (`.dry-run` and `.round2` suffixes).
It passes `redactSecrets` and a no-secret assertion. `--dump-dir <dir>` writes each trial's tool-by-tool transcript and
check output outside the evidence directory, for debugging a fixture.

## What the staged install is

The read tools refuse a path that resolves outside the project, so a symlinked `node_modules/@arnilo/prism` would hide
the docs from the builder. Each trial therefore gets real copies of `@arnilo/prism` and every published package as a
tarball lays them out (sources without tests, docs without `_evidence`, READMEs, indexes, skills), and symlinks to every
other dependency. The `none` arm's tree has no host-builder package. Diagnostics inside `node_modules` do not count
against `typecheck_passes`: the installed sources are checked by the repository's own gates.
