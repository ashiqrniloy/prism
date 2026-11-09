# Task 37 — registry cleanup, done

`@arnilo` scope as read on 2026-11-09 (`docs/_evidence/registry/arnilo-scope-2026-11-09.json`):
**66 of 68 names unpublished, 0 left to delete.** The two that stay are below; no command remains,
and every name 0.13.0 reuses comes back at the publish.

Evidence of the completed run: `arnilo-scope-2026-11-08.json` (before, 68 names) and
`arnilo-scope-2026-11-09.json` (after, 2 names), plus the plan that ran:
`arnilo-cleanup-plan-2026-11-08.sh` and `arnilo-cleanup-plan-2026-11-09.sh`.

## Kept

- `@arnilo/liveframe` (16 (0.0.0-stage … 0.2.3-rc.1)) — no 0.13 list names @arnilo/liveframe (owner decision)
- `@arnilo/prism` (64 (0.0.1 … 0.12.1)) — the kernel: 0.13.0 publishes this name and its 0.12.x line stays installable
