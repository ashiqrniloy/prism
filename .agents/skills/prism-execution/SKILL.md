---
name: prism-execution
description: Execute work in the Prism repo: the `@arnilo/prism` 0.13.0 SDK kernel, its native packages, host libraries, and the Prism Agent reference host, on the way to the 0.13.0 publish. Use it to implement, fix, or refactor code, execute a plan task ("do task N", "next unchecked task", "complete Task 4"), or change the kernel, packages, providers, tools, memory, stores, host libraries, the reference host, docs, or release plumbing. Do NOT use it to write a new plan document (create-plan) or to look up third-party library docs (find-docs).
---

# Prism Execution

Execute Prism tasks with progressive disclosure:
1. the repo graph first
2. the architecture reference when the task touches the kernel/package boundary
3. one area reference
4. full docs pages only when a code span is not enough

## Where the repo is

`roadmap.md` defines the design: the `@arnilo/prism` 0.13.0 SDK kernel (agents, sessions, the loop, hooks, slots, and a package system) plus native packages for every capability. Roadmap Phases 0–10 and 12–17 have landed:

- the kernel is `src/`, published as TypeScript source with zero runtime dependencies
- native packages and host libraries are `packages/<group>/<name>` (`providers`, `tools`, `memory`, `context`, `stores`, `policy`, `integrations`, `hosts`, `drivers`, `credentials`)
- the reference host is `apps/prism-agent` (private, never published)
- the 0.12 family packages, `@arnilo/prism-agent-sdk`, and Prism Code are gone from the tree; their last docs are archived in `docs/history/`

What remains is roadmap Phase 11: the **0.13.0 release path** table in `plans/README.md`, run strictly in its step order.

Each reference has a **Target** section (the roadmap sections and invariants that govern the area) and a **Today** section (where the code lives now). Today sections can lag the tree; graft is the source of truth for file locations.

When sources disagree: a release-path plan that records an owner decision wins over the roadmap (for example plan 182 deleting 17 provider packages); otherwise the roadmap wins for new work. For a bug fix on the released 0.12.1 line, the 0.12 archives in `docs/history/` describe the contract; `/docs` describes 0.13.0. If a task does not say which line it serves, ask.

## Graft first (before grep, before reading source)

```bash
graft ask "<task or question>" --source   # ranked nodes with code spans
graft skeleton <file>                     # API surface, ~10x cheaper than reading
graft callers <symbol> --depth all        # every caller: run before any rename, move, or delete
graft grep "<literal>"                    # exhaustive occurrence search (retirement sweeps)
```

Cite `file:line` spans and edit from `--source`. Open a source file only at the exact span you need. After large moves, run `graft build`.

## Route: read the architecture reference, then ONE area reference

Read [references/architecture.md](references/architecture.md) first whenever the task creates, moves, or changes anything in the kernel or a package, or you cannot tell where a change belongs. It holds the placement rules, the hook and slot model, and the 0.12 → target map.

| Task touches | Read |
| --- | --- |
| Agent, session, loop, `RunController`, hooks, slots, events, limits, suspend/resume, host port | [references/kernel.md](references/kernel.md) |
| `definePackage`, `PackageAPI`, package loading/config/capabilities/state/services, manifest, `prism` CLI, package authoring and conformance | [references/packages.md](references/packages.md) |
| Model core, `ModelProvider`, provider-kit, provider packages, credentials slot, OAuth, keyring | [references/models.md](references/models.md) |
| Tool registry, skills, commands, coding/web/browser/work/computer-use/OpenAPI tools, approval, context files | [references/tools.md](references/tools.md) |
| Compaction slot, observational memory, LLM compaction, RAG, wiki, fabric, context engineering | [references/memory.md](references/memory.md) |
| Store slot, JSONL/SQLite/Postgres stores, package-state entries, suspended runs, checkpoints | [references/stores.md](references/stores.md) |
| Governance, identity/principal, guardrail packs, model router, redaction, trust, secret refs | [references/governance.md](references/governance.md) |
| MCP, hooks.json, workflows, delegate, observability; host libraries (ACP, AG-UI, MCP server, channels, evals, devtools) | [references/interop.md](references/interop.md) |
| The Prism Agent reference host (`apps/prism-agent`): agents, workflow, `HostUi` routing, CLI, ACP, scenarios | [references/reference-host.md](references/reference-host.md) |
| Exports, compat baselines, package truth, packaging gates, changelog, version, publish | [references/release.md](references/release.md) |

Mixed tasks: pick the area that owns the entry point. Read at most the architecture reference plus two area references.

## Invariants (every task)

**Architecture** (from `roadmap.md` Part 1):
- **The kernel never imports or names a package.** A capability that can be a package is a package.
- **Gates live in primitives, not the loop.** Tools run only through `RunController.executeTools`, which always fires `tool.call`. Model turns run only through `RunController.turn`.
- **Installed = listed = active.** A package needs no host wiring. The kernel loads nothing the host did not list.
- **No compatibility aliases for 0.12.** Replace a mechanism, then delete the old one in the same task.

**Safety:**
- **Fail closed at trust boundaries.** This covers validation, permissions, unknown config, slot conflicts, missing services, throwing gates, and `host.ui` answering `unavailable`. Never weaken a fail-closed test to pass a change; fix the boundary and its tests together.
- **Secrets stay refs.** Config and the manifest hold `env:` / `keyring:` refs. Secrets never appear in argv, logs, events, `inspect()`, errors, or tests.
- **Byte hard caps stay.** Do not raise or remove `maxRequestBytes` / `maxResponseBytes`.

**Change discipline:**
- **Leave the tree green after every task.** A rename updates every caller in the same task (`graft callers --depth all`).
- **Moved export → regenerate the baseline in the same task.** Run `bun scripts/release.mjs gate --update-baseline`, and paste the diff into the task note with removals attributed.
- **Retired name, error, or config → repo-wide grep** over `src/ packages/ apps/ scripts/ examples/ docs/` (excluding `dist/`, `plans/`, `docs/history/`, `docs/_evidence/`).
- **No new dependency** without an explicit plan task. The kernel has zero runtime dependencies; heavy dependencies load only inside their owning package.
- **Shortest working diff after reading the whole flow.** Fix at the root cause where all callers route through.
- **One runnable check per non-trivial change:** the smallest test that fails if the logic breaks.

## Plan-task loop

1. Read the full plan file in `plans/` and the roadmap phase it implements.
2. Select the first unchecked task, unless the user names one.
3. Implement only that task. A small, explicitly noted prerequisite is allowed.
4. Run the task's listed tests and checks plus directly affected suites, `bun run typecheck`, and `bun scripts/release.mjs gate` if exports moved.
5. Mark `- [x]` only after the implementation and checks pass. Write `Notes (executed <date>)`:
   - what changed
   - findings that affect later tasks
   - the baseline diff, if any
   - the sweep result, if any
6. If the approach, files, or tests changed during execution, update that task's text before moving on. If a finding invalidates a later task, amend it now and record why.
7. Repeat until the implementation and verification tasks are done.
8. Run the plan's `Verification (whole plan)`. Then fill `Compromises Made` and `Further Actions`, and run the create-plan backlog handoff into `plans/backlog.md`.

## Stop conditions: how much context to pull

- **Understand-only question:** graft plus at most one docs page or roadmap section.
- **Never open** `docs/migration.md`, `docs/migrate-to-*.md`, `docs/performance.md`, `docs/_evidence/**`, or `docs/history/**` unless the task is a migration, benchmark, audit, or release-history task.
- **Never paste docs pages or roadmap sections into references or replies.** Cite the path and section, and open files at `file:line`.
- References are one level deep: they link docs pages and roadmap sections, never other references.
