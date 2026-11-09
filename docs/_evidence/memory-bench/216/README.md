# Plan 216 — behaviour preservation and the cache-pin re-attestation

Plan 216 moved the ontology into `@arnilo/prism-wiki` (Task 3), the session tiers (Task 4) and the fabric (Task 5) into
`@arnilo/prism-memory-system`, added components and partial-use profiles (Task 6), and removed LTM working memory, the
episode view and episode merge (Task 7). Task 8 measures what those moves changed and what they left alone. Every file
here is written by a script; nothing is typed by hand.

| File | Written by | What it holds |
| --- | --- | --- |
| [equivalence.json](equivalence.json) | `prefix-probe.mjs --equivalence --base-harness own` | Answer-path provider requests (`preset-r1`, `passive-only`; 54 requests), base vs this tree, twice each |
| [preservation.json](preservation.json) | `preservation.mjs` | One row per move with its fixtures, result and attributed differences; the C-1 dry run |

Commands: [the benchmark README](../../../../scripts/memory-bench/README.md#cache-stability-pin-equivalence-and-cache-probe-plan-202-task-415).

## Base

`37ee1a24` (`OM-before`), checked out at `.cache/memory-bench/216/om-before`. It holds plan 210's slimmed product plus
plan 216 Tasks 1–3, so it is the point the Task 3 golden was re-pinned at. Plan 210's slimmed product on its own
(`867f8277…`) was never committed. Task 3's change was measured in the tree before that commit, through the plan 210
golden re-pin, and this record carries that result over. The base predates `@arnilo/prism-memory-system`, so it runs
its own committed harness (`harness: "per-tree"`).

## Result

Verdict: **preserved: every difference is attributed.**

| Task | Fixture | Result | Attributed differences |
| --- | --- | --- | --- |
| 3 | plan 210 golden (2 presets × 12 requests) | re-pinned in-tree | `memory.recall` schema no longer names `concept`; context unchanged. C-1 arm `concept-prior-loo` retired (the concept kind prior went with the ontology) |
| 4 | `session-replay.mjs` (3 turns + observer passes, compact, 1 turn; 12 requests) | identical after attribution (3 identical, 9 renamed) | `# Observational Memory` → `# Session Memory`; worker `sessionId`/`cacheKey` `om:s` → `memory.session:s` |
| 5 | golden through `memorySystem({ ltm })`; answer paths | no difference | none |
| 6 | `session-replay.mjs` rehearsal pool | pool 52 tokens vs target 20,000: not crossed | none (the omitted-`rehearsal` change cannot show below the target) |
| 7 | golden; answer paths; prefix probe | different, attributed | golden re-pin `6ee12dbd…` → `0a02d4e4…`; tool schemas and the system tool catalogue of `memory.forget`, `memory.insert`, `memory.recall`, `memory.replace` and `memory.view`; prefix probe lost the `working-update` scenario and the `fabric-working` block; `CACHE_STABILITY_TESTS` lost `working_memory_update_reaches_the_tail_not_the_prefix`; three mechanisms rows excluded through `210/dispositions.json` |

- **Answer paths.** Of the 54 requests, `preset-r1` differs in `system` and `tools`, `passive-only` in `system` only.
  Context, transcript and tail are identical everywhere. With the tool schemas and the system tool catalogue taken out,
  all 54 requests are byte-identical, and the only tools whose text differs are the five above.
- **Prefix probe.** The six remaining scenarios render the same `fabric-directory` and `fabric-rules` block hashes,
  request by request, on both trees.
- **C-1 dry run** (`dryRunC1Manifest`). 160 jobs: 124 build against the new paths, with their configs resolved through
  the package schemas and their historical variants patching files under `packages/memory/system`,
  `packages/memory/core` or `packages/knowledge/wiki`. 36 are retired by a named removal: `supersessionHint`,
  `enrichment` and `timeline` (plan 210 Task 7, checked against the slimmed record) and `conceptPrior` (plan 216 Task 3).
  0 errors.

## Cache pin

The plan 202 pin (`../202/cache-stability/record.json`) is re-attested on product `4fb60791…`
(`packages/memory/system/src/ltm`). The prefix suite runs 27 pass / 0 fail, with every name in
`CACHE_STABILITY_TESTS` present. `../202/cache-stability/equivalence.json` is a copy of this directory's file. Per the
plan 202 rule, `preset-r1` and `passive-only` stay `rerunArms` with `mergeWithPreChangeCells: false`, so a later paid run
compares like with like. No paid call ran.
