# @arnilo/prism-graft

[Graft](https://github.com/NanoNets/Graft) (`@nanonets/graft`) context-graph integration for Prism agents.

Opt-in package: import is inert; nothing registers until `kernel.load([createGraftExtension({...])])`. The graft CLI is resolved fail-closed from an explicit `cliPath`, a host-owned `packageRoot`, or the optional peer `@nanonets/graft@^0.13.0`. Not included in `@arnilo/prism-code` / `-sdk` / `-all`.

Levels:

- **pull** (default): native tools over the graft CLI's `--json` surface (`ask`/`grep`/`callers`/`skeleton`/`map`/`blast`).
- **push**: gated, deduped pointers-only retrieval pack per turn plus first-turn orientation.
- deep: post-edit blast radius on coding-tool results.

All CLI children run with array argv (never a shell), fixed-base env (`DO_NOT_TRACK=1` by default), wall-clock budgets, and byte-capped stdout.

See `docs/graft.md` (plan 033) for the full API page.
