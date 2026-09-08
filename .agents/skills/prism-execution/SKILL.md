---
name: prism-execution
description: Execute work in the Prism repo — implement, fix, or refactor code, execute a plan task ("do task N", "next unchecked task", "complete Task 4"), or make coding changes against Prism packages, providers, tools, docs, or release plumbing. Use for any Prism coding change. Do NOT use to write a new plan document (create-plan) or to look up third-party library docs (find-docs).
---

# Prism Execution

Execute Prism plan tasks and coding changes with progressive disclosure: the repo
graph first, one classified reference second, full API pages only when a span is
insufficient.

## Graft first (before grep, before reading source)

Prism is indexed in `graft/`. For any task, run:

```bash
graft ask "<task or question>" --source   # ranked nodes with code spans
graft skeleton <file>                     # API surface, ~10x cheaper than reading
graft callers <symbol>                    # exact call edges / blast radius
graft grep "<literal>"                    # exhaustive occurrence search
```

Cite the node's `covers:` file:line spans and edit from `--source`. Open a source
file only when the node lacks a needed detail, at the exact span. After large code
edits, refresh the graph: `graft build` (deterministic, no key).

## Classify the task → read ONE reference

| Task touches | Read |
| --- | --- |
| Session, run, loop, events, steer, limits, usage, durable resume | [references/runtime.md](references/runtime.md) |
| Provider adapter, request construction, cache, thinking, usage map | [references/providers.md](references/providers.md) |
| Tool registry, coding tools, sandbox, process, forge, execution policy, extensions | [references/tools.md](references/tools.md) |
| Session store, checkpoint, lease, postgres/sqlite, run ledger, conversations | [references/persistence.md](references/persistence.md) |
| Compaction, observational memory, RAG, wiki, skills, prompt assembly | [references/memory.md](references/memory.md) |
| ACP, AG-UI, A2A, MCP, server, CLI/RPC, workflows, multi-agent | [references/interop.md](references/interop.md) |
| Identity, policy, approvals, credentials, redaction, trust, host security | [references/governance.md](references/governance.md) |
| Version bump, exports, freeze tests, workflows, packaging, tag/release | [references/release.md](references/release.md) |
| Office documents/sheets/diagrams, web tools, browser, obscura, devices | [references/office-web.md](references/office-web.md) |

Mixed tasks: pick the cluster owning the entry point; the reference lists adjacent
pages. Read at most two references per task.

## Universal invariants (every task, every cluster)

- **Fail closed at trust boundaries.** Validation, permissions, redaction, and
  security defaults must fail closed. Never weaken a fail-closed test to make a
  change pass; if a boundary is wrong, fix the boundary and its tests together.
- **No new dependencies** for what a few lines, the stdlib, or an installed
  package can do. Never add a dependency without an explicit plan task.
- **Shortest working diff after reading the flow.** Trace callers (`graft callers`)
  and the full path end to end first; a small diff in the wrong place is a second bug.
- **One runnable check** per non-trivial change: the smallest test that fails if
  the logic breaks. No fixture frameworks for one assert.
- **Root cause over symptom.** Fix where all callers route through, not the path
  the ticket names.
- **Secrets never** in argv, logs, events, or tests. Credentials resolve at the
  provider edge only.
- **Byte HARD caps stay.** `maxRequestBytes`/`maxResponseBytes` ceilings are
  process-safety; do not raise or remove them.

## Plan-task loop

1. Read the full plan file in `plans/`.
2. Select the first unchecked task unless the user names a specific task.
3. Implement only that task unless dependencies require a small, explicitly noted
   prerequisite.
4. Run the task's listed tests/checks plus directly relevant suites.
5. Mark the checkbox `- [x]` only after implementation and checks pass.
6. If the approach, files, or tests changed during execution, update that task's
   section before moving on.
7. Repeat from 2 until implementation and verification tasks are complete.
8. Run final verification for the plan, then fill `Compromises Made` and
   `Further Actions` with actual deviations, deferred work, rationale, priority.

## Stop conditions — how much context to pull

- **Understand-only question**: graft + at most ONE current docs page. That is enough.
- **Never open** `docs/migration.md`, `docs/performance.md`, `docs/_evidence/**`,
  or `docs/history/**` unless the task IS a migration, benchmark, audit, or
  release-history task. These are frozen archives, not current contracts.
- **Never paste API pages into references or replies.** Cite the page path and the
  graft span; open the file at `file:line` when a definition is needed.
- Reference files are one level deep — they link docs pages, never other references.
