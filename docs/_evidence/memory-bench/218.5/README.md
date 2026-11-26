# Plan 218.5 evidence

Evidence for plan 218.5 (memory system: STM recording fixes and a long-session bench that decides working memory). Every file here holds ids, counts and hashes only, and is written by a runner, never by hand.

| File | Task | What it holds |
| --- | --- | --- |
| `stm-fixes-replay.json` | 1 | The 36-session replay of the STM recording fixes. |
| `gates/owner-gate-long.json` | 2, 6, 7 | The owner's design decisions, the frozen rule `sessionBenchLong` with its hash, and the owner's approval of the hash. |
| `session-bench-long-pilot.json` | 7 | The live pilot's report under rule `f42e1fe0`: 24 rows (smoke, calibration and the pilot stage on 3 sessions), the live guardrails (G11-live and no-overflow missed) and the pilot verdict. |

## Task 7: the live pilot (rule `eb3b5269` held every live guardrail; rerun after the WM fixes)

Rule `eb3b5269` (benchmark version 2: 150-task sessions; main agent `opencode-go/hy4-flash-free` at thinking low with a 16,384-token output reserve; memory worker `opencode-go/muse-spark-1.3-contributor`; input cap 29,952) ran on 2026-11-24/25: 24 rows, 0 window overflows, 520M input tokens. Every live guardrail held:

| Live guardrail | Value | Min |
| --- | --- | --- |
| `oracle-notes` tasks passed | 90% | 60% |
| `amnesic` fails D2 / D4 / D2R | 100% / 70.4% / 100% | 70% |
| `G11-live`: STM-only's pool overflows before the first `after` dependent | 2 of 3 sessions | 2 |
| Rows that overflow W | 0 | 0 |

Tasks passed: `STM-only` 93.6%, `STM-only-protect` 91.1%, `STM+WM` 90.4%, `STM+WM-deterministic` 91.1%, `memory-off-llm` 81.3%, `mem0` 85.1% (side arm). Three sessions cannot decide: the pilot's verdict keeps `STM-only` as the reference and `relevance` as the eviction default, and leaves WM to the owner. Task 8 decides on the 12 dev sessions.

Earlier rules under Task 7, each a new hash: `c2e39021` stopped at calibration (the main agent's 2,048-token output reserve: hy4 spent it all on reasoning), `60898b62` paused in the pilot stage (live STM pressure overflowed after every version-1 `after` dependent), `0d6beef6` stopped on `beam-free`'s free daily allowance, `cddf6f16` stopped for `deepseek-v4.1-flash`'s 10–35 s worker latency. The plan's Task 7 notes record each.

After the `eb3b5269` pilot the owner ordered four fixes and a rerun of Task 7 from the start (2026-11-25): WM items count against the pool, finished task requests are batched for WM, request protection lapses after 3 newer user requests, deterministic WM keeps only high or critical outcomes, and the control guard leaves out the noisy `count-errors` job (analysis v2). `session-bench-long-pilot.json` is rewritten by the rerun.

### The rerun after the WM fixes (rule `f42e1fe0`, 2026-11-25/26)

24 rows; calibration held (`oracle-notes` 94.0%; `amnesic` fails D2 100%, D4 70.4% against a 60% floor, D2R 100%). Two pilot guardrails missed: `G11-live` 1 of 3 (STM-only's pool overflowed at tasks 93-102, at the first `after` dependents) and no-overflow (mem0 overflowed W 4 times on one session). Tasks passed: `STM-only` 95.8%, `STM-only-protect` 93.6%, `STM+WM-deterministic` 90.4%, `STM+WM` 88.4%, `oracle-notes` 94.0%, `mem0` 85.1%, `memory-off-llm` 78.7%, `amnesic` 78.7%.

The fixes made WM run early (first pass at tasks 26-32) and stay bounded, but letting WM judge finished task requests cost the user's rules: STM+WM-deterministic passed 18 of 27 D2 checks and 3 of 6 D2R checks against STM-only's 26 and 6. The 3-session verdict reads WM `drop` (STM+WM `after` -6.3 points, STM+WM-deterministic -20.8). Task 8 decides on the 12 dev sessions, after the owner's call on that fix and on the G11 margin. The plan's Task 7 notes hold the details.

### The owner's calls after `f42e1fe0` (2026-11-26): rule `a7dd52a3`, awaiting approval

The owner set the objective: decide WM objectively, and show objectively whether the memory system beats simple compaction and mem0. Fix 1 is reverted (a user task request kept word for word stays out of WM batches). Benchmark version 3 puts every `after` dependent in tasks 111-150, and analysis v3 scores an `after` check only at or past STM-only's measured first overflow in its session plus 10 tasks. mem0 becomes a baseline, beside `memory-off-llm`, in a new verdict step. The no-overflow guardrail now counts tasks that ended on an overflow: `f42e1fe0`'s 4 mem0 overflows were compacted around and every task completed. The claims against the baselines will be read on held-out sessions after Task 8.
