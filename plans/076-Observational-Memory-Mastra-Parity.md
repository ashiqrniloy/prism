# 076 — Observational Memory Mastra Parity (**superseded**)

**Do not execute.** Superseded by [077 — Work-Scope Memory Index](077-Work-Scope-Memory-Index.md).

## Why

076 treated the working set as a **dropper** (KEEP + token target + `om.current_task`). That cannot express a coding loop where task-1 observations must survive for task 15, and phase-1 invariants must be **promoted** into phase 2 rather than dumped or GC’d.

077 replaces that with host-named **work scopes** (open / bind / project / enter). Current task **is** the leaf scope. Dropper stays only for **unscoped** attach (0.6.0 compat). Observer default-instruction tightening moved to 077 Task 6.

## What moved

| 076 idea | 077 |
| --- | --- |
| `om.current_task` | Leaf `WorkScope` id + label in the outline |
| KEEP / `maxDropIds` / coverage-aware drop | Projection query; dropper skipped when any host scope exists |
| Resource-scope OM | Still rejected |
| Observer production instructions | 077 Task 6 |
| Attention Compiler / Memory Fabric | 074 / 075, both in the extended 0.7.0 line (075 reassigned from 0.8.0 on 2026-09-14) |

Locked forks live in 077 (leaf-only auto-bind, closed ancestors included, helper not in `runWorkflow`, OM bind targets only).
