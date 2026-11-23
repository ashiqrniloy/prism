# Plan 218.5 evidence

Evidence for plan 218.5 (memory system: STM recording fixes and a long-session bench that decides working memory). Every file here holds ids, counts and hashes only, and is written by a runner, never by hand.

| File | Task | What it holds |
| --- | --- | --- |
| `stm-fixes-replay.json` | 1 | The 36-session replay of the STM recording fixes. |
| `gates/owner-gate-long.json` | 2, 6, 7 | The owner's design decisions, the frozen rule `sessionBenchLong` with its hash, and the owner's approval of the hash. |
| `session-bench-long-pilot.json` | 7 | The live pilot's report under rule `c2e39021`: 7 rows (the smoke job and calibration), the live guardrails and the incomplete verdict. |

## Task 7: the live pilot (stopped at calibration)

Rule `c2e39021` (main agent `opencode-go/hy4-flash-free`, memory worker `opencode-go/beam-free`, W = 32K) ran on 2026-11-23. The smoke job and all six calibration jobs finished with no worker fault, provider error, overflow or quota wait. Then the run stopped on its own: `oracle-notes`, the ceiling arm, passed 54.7% of tasks against a minimum of 60%. `amnesic`, the floor arm, held all three of its guardrails: it failed 100% of D2, 89% of D4 and 100% of D2R checks.

`oracle-notes` passed fewer tasks than `amnesic`. With the harness's notes block in context, the main agent made no tool calls on most tasks from task 13 on, including tasks the notes do not touch. The fix needs a new hash and a new pilot, on the owner's word. The plan's Task 7 notes record that finding, the harness fixes made for the owner's condition (model call failures and internet outages, hashes `7391bbc6`, `d1701bb0` and `0de8550d`) and the switch of the worker from `muse-spark-1.3-contributor` to `beam-free`.
