# Long-run soak evidence

Generated: 2026-11-18T06:55:49.450Z
Runtime: bun 1.4.4 (linux/x64, AMD Ryzen 9 PRO 7940HS w/ Radeon 780M Graphics)

Workload: 200 runs × 50 turns (10000 total turns, one tool call per tool round), default compactor enabled (`contextWindow: 16000`, `payloadBytes: 512`).

## Results

| Store | Runs × Turns | Compactions | Turn 100 median (ms) | End median (ms) | Overhead ratio | Heap baseline → end (MiB) | Heap growth | Store reads/turn (early → late) |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | --- |
| sqlite | 200 × 50 (10000) | 181 | 1.5977 | 1.9787 | 1.238× | 8.00 → 7.31 | -8.56% | 0.767 (0.772 → 0.756) |
| jsonl | 10 × 50 (500) | 9 | 12.6933 | 13.8433 | 1.091× | 9.20 → 11.28 | +22.68% | 11.344 (8.417 → 17.200) |

## Notes

- **SQLite (budgeted):** uses `readBranchPath({ from: "compaction" })` (tail snapshots) for both runs and compactions, keeping per-turn overhead, retained JS heap after forced GC, and store reads per turn flat across 10,000 turns.
- **JSONL (comparison, 10 runs):** has no `readBranchPath` and caches every session entry in memory, so store reads and retained heap grow linearly with branch length. Use SQLite or Postgres for multi-day jobs.

## Checks

- [x] `sqlite_all_runs_completed`
- [x] `sqlite_compaction_exercised`
- [x] `sqlite_turn_overhead_within_budget`
- [x] `sqlite_heap_growth_within_budget`
- [x] `sqlite_store_reads_per_turn_constant`

```json
{
  "version": "0.13.0",
  "generatedAt": "2026-11-18T06:55:49.450Z",
  "environment": {
    "runtime": "bun 1.4.4",
    "platform": "linux",
    "arch": "x64",
    "cpu": "AMD Ryzen 9 PRO 7940HS w/ Radeon 780M Graphics",
    "memoryBytes": 65972367360,
    "network": false,
    "credentials": false
  },
  "fixture": {
    "runs": 200,
    "turns": 50,
    "totalTurns": 10000,
    "jsonlRuns": 10,
    "payloadBytes": 512,
    "contextWindow": 16000
  },
  "ceilings": {
    "maxTurnOverheadRatio": 1.5,
    "maxHeapGrowthRatio": 1.05,
    "maxStoreReadGrowthRatio": 1.25
  },
  "results": [
    {
      "name": "sqlite",
      "runs": 200,
      "turnsPerRun": 50,
      "totalTurns": 10000,
      "totalToolCalls": 9800,
      "compactions": 181,
      "failedRuns": 0,
      "totalMs": 48568.8,
      "turn100MedianMs": 1.5977,
      "endTurnMedianMs": 1.9787,
      "turnOverheadRatio": 1.238,
      "baselineRun": 50,
      "heapAtBaselineBytes": 8386859,
      "heapAtEndBytes": 7669087,
      "heapGrowthRatio": 0.9144,
      "heapGrowthPct": -8.56,
      "storeEntriesReadPerTurn": 0.767,
      "earlyReadsPerTurn": 0.772,
      "lateReadsPerTurn": 0.756,
      "storeReadGrowthRatio": 0.98,
      "storeReads": {
        "list": 0,
        "readBranchPath": 7607,
        "get": 8
      }
    },
    {
      "name": "jsonl",
      "runs": 10,
      "turnsPerRun": 50,
      "totalTurns": 500,
      "totalToolCalls": 490,
      "compactions": 9,
      "failedRuns": 0,
      "totalMs": 10464.8,
      "turn100MedianMs": 12.6933,
      "endTurnMedianMs": 13.8433,
      "turnOverheadRatio": 1.091,
      "baselineRun": 5,
      "heapAtBaselineBytes": 9641881,
      "heapAtEndBytes": 11828919,
      "heapGrowthRatio": 1.2268,
      "heapGrowthPct": 22.68,
      "storeEntriesReadPerTurn": 11.344,
      "earlyReadsPerTurn": 8.417,
      "lateReadsPerTurn": 17.2,
      "storeReadGrowthRatio": 2.044,
      "storeReads": {
        "list": 5101,
        "readBranchPath": 0,
        "get": 5
      }
    }
  ],
  "checks": [
    {
      "name": "sqlite_all_runs_completed",
      "pass": true
    },
    {
      "name": "sqlite_compaction_exercised",
      "pass": true
    },
    {
      "name": "sqlite_turn_overhead_within_budget",
      "pass": true
    },
    {
      "name": "sqlite_heap_growth_within_budget",
      "pass": true
    },
    {
      "name": "sqlite_store_reads_per_turn_constant",
      "pass": true
    }
  ]
}
```
