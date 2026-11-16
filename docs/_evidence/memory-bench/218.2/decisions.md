# Plan 218.2 decisions

The four decision rules were fixed in `gates/owner-gate-replay.json` before the baseline ran (rules hash `195b0fd3…`,
`REPLAY_RULES` in `scripts/memory-bench/worker-replay/score.mjs`). No rule changed afterwards. Where the owner overrode
an outcome, the gate record's `changes` holds the override; the rule and its hash stayed as they were.

Models: `opencode-go/muse-spark-1.3-contributor` (Muse), `opencode-go/deepseek-v4.1-flash` (DeepSeek),
`opencode-go/mimo-v2.6-flash` (MiMo). Fixture `worker-replay` (`0ce56d6b…`): 60 STM and 48 WM requests.

| Rule | Run | Outcome by the rule | Shipped | Deleted |
|---|---|---|---|---|
| Task 2: English patterns vs `record_event` fields | `replay-task2.json` vs `replay-baseline.json` | keep the patterns as a union | as the rule said | nothing |
| Task 4: automatic evidence chunk | `replay-task4.json` vs `replay-baseline.json` | off | **on**, `stm.autoChunkBytes: 1024` (owner, 2026-11-15) | nothing |
| Task 5: one `judge` call vs four per-record tools | `replay-task5-judge.json` vs `replay-task5-incumbent.json` | judge loses (one check, one model) | **`judge`** (owner, 2026-11-15) | `keep`, `summarize`, `derive`, `discard` tools and their tests; the flush's per-call record cap; the harness's `--wm-format`, `--settle-first`, `--incumbent` |
| Task 6: scope digest | `replay-task6.json` vs `replay-task5-judge.json` | off | off | the digest worker, its rendering, the harness's `--scope-digest` (flush, ledger and config wiring never written) |

## Task 2: structured signals

Rule: the patterns go only if, on every model, field recall is at least the pattern's on English, higher on
non-English, with precision no lower; output tokens per event rise at most 15%.

| recall / precision, pattern → field | Muse | DeepSeek | MiMo |
|---|---|---|---|
| Correction, English | 1.00/0.75 → 0.00/– | 0.83/0.71 → 0.83/1.00 | 0.83/0.67 → 0.67/1.00 |
| Correction, non-English | 0.00 → 0.56/1.00 | 0.00 → 0.89/1.00 | 0.00 → 0.78/1.00 |
| Failure, English | 1.00/0.22 → 0.00/– | 0.67/0.16 → 0.50/0.75 | 0.67/0.16 → 0.17/0.29 |
| Failure, non-English | 0.39/0.44 → 0.61/1.00 | 0.44/0.41 → 0.89/0.80 | 0.50/0.69 → 0.72/0.81 |
| Output tokens per event | 750 → 683 (−9%) | 327 → 300 (−8%) | 608 → 670 (+10%) |

Outcome: the fields lose English recall on every model, so `CORRECTION`, `FAILED_VERIFICATION` and `FAILED_OUTCOME`
stay as a union for records that carry no field. Every new `outcome` must carry `status`, so on new records the
failure signal is the worker's `status`; the pattern reads only status-less outcomes from old ledgers. Output-token
rise is under 15% on every model. Nothing deleted.

## Task 4: evidence kept by rule

Rule: on by default if coverage rises on every model and chunk bytes per 10k source tokens stay under 2× the baseline.

| | Muse | DeepSeek | MiMo |
|---|---|---|---|
| Evidence covered (of 42): baseline → rule off → rule on | 2 → 0 → 11 | 22 → 19 → 26 | 13 → 13 → 21 |
| Chunk bytes per 10k source tokens: baseline → on (bound) | 74 → 188 (148) | 212 → 359 (424) | 396 → 529 (793) |
| Coverage rises / bytes under bound | yes / **no** | yes / yes | yes / yes |

Outcome by the rule: off (Muse's bytes pass 2× its own small baseline). The owner turned it on
(`stm.autoChunkBytes: 1024`, 2026-11-15: "turning it on (stm.autoChunkBytes: 1024) is approved"). Nothing deleted.

## Task 5: WM verdict format

Rule: `judge` replaces the four tools if, on every model, verdict share, later-step records kept and changed values kept
are no lower, and output tokens per record fall at least 30% or refused calls fall.

| 48 WM requests, 3,504 records | Muse incumbent → judge | DeepSeek incumbent → judge | MiMo incumbent → judge |
|---|---|---|---|
| Verdict share | 0.45 → 1.00 | 0.68 → 0.99 | 0.12 → 0.75 |
| Later-step records kept (of 96) | 66 → 85 | 90 → **89** | 9 → 66 |
| Later-step records discarded | 0 → 11 | 4 → 3 | 0 → 9 |
| Changed values kept (of 48) | 36 → 48 | 47 → 48 | 5 → 37 |
| Output tokens per record | 69 → 45 (−35%) | 111 → 37 (−67%) | 168 → 75 (−55%) |
| Output-cap stops | 0 → 0 | 1 → 0 | 48 → 8 |

Outcome by the rule: `judgeWins: false`, `settledFirstPasses: false`, on one check: DeepSeek kept 89 later-step
records against 90 (the same incumbent format kept 93 in the baseline). The owner shipped `judge` ("Ship judge (gate
change)", 2026-11-15). Deleted: the four tools and their tests (no alias, no switch), the flush's cap of three quarters
of `worker.maxToolCalls` per batch, and the harness comparison flags. Carried: later-step records discarded rose on Muse
(0 → 11) and MiMo (0 → 9); the after-replay below reads them against the baseline.

## Task 6: scope digest

Rule: on by default only if, on the long-scope set, later-step records kept rise on at least one model and fall on none
(reference amended to `replay-task5-judge.json`, 2026-11-15; rule and hash unchanged).

| Long-scope, 24 requests | Muse | DeepSeek | MiMo |
|---|---|---|---|
| Later-step records kept (of 48), judge → +digest | 42 → 43 | 44 → 43 | 34 → 31 |
| Digest calls ok (of 12) | 12 | 9 | 1 |

Outcome: `defaultOn: false`. Deleted: `workers/scope-digest.ts`, the digest rendering in `scope.ts` and `workers/wm.ts`,
and the harness's `--scope-digest`. No config key, ledger record or docs remain.

## Task 9: the finished product against the baseline

`replay-after.json`: the whole fixture (60 STM and 48 WM requests per model) on the product after Tasks 2–7, at the
package defaults (`stm.autoChunkBytes: 1024`, `judge`, settled-first, no scope digest), same models, fixture hash and
rules hash as `replay-baseline.json`. Product hash `e7e100f1…` (baseline) → `c1c741b2…` (after); `paired` in the report
holds every row below (`pairReplays`). 0 failed requests, no ceiling hit, no fixture text (0 of 12,584 fixture lines
in 674 report strings), secret scan clean. In the signal rows the baseline reads the English patterns and the after-run
reads the fields alone; the product's union (the pattern for a record with no field) is not scored separately.

| STM, 60 requests, baseline → after | Muse | DeepSeek | MiMo |
|---|---|---|---|
| Events per 10k source tokens | 4.4 → 5.0 | 9.3 → 11.4 | 6.7 → 6.9 |
| **Output tokens per 10k source tokens** | 3,279 → 3,368 (+3%) | 3,031 → 3,190 (+5%) | 4,099 → 4,357 (+6%) |
| Output tokens per event | 750 → 668 | 327 → 280 | 608 → 631 |
| Outcomes found (of 78) | 62 → 67 | 63 → 73 | 61 → 60 |
| Correction recall / precision, all | 0.40/0.80 → 0.30/1.00 | 0.37/0.76 → 0.93/1.00 | 0.30/0.63 → 0.53/1.00 |
| Correction recall, English → non-English (after) | 0.00 / 0.50 | 0.92 / 0.94 | 0.33 / 0.67 |
| Failure recall / precision, all | 0.43/0.23 → 0.30/0.90 | 0.53/0.23 → 0.90/0.88 | 0.63/0.31 → 0.57/0.71 |
| **Failure recall, English: pattern (baseline) → field (after)** | 0.92 → **0.00** | 0.75 → 0.83 | 0.67 → **0.33** |
| Failure recall, non-English | 0.11 → 0.50 | 0.39 → 0.94 | 0.61 → 0.72 |
| `durable` recall / precision (of 36) | – → 0.64 / 1.00 | – → 0.97 / 0.74 | – → 0.94 / 0.97 |
| `resolves` recall / precision (of 36) | – → 0.97 / 1.00 | – → 0.92 / 1.00 | – → 0.67 / 1.00 |
| Evidence covered (of 42) | 2 → 9 | 22 → 27 | 13 → 16 |
| Chunk bytes per 10k source tokens | 74 → 185 | 212 → 381 | 396 → 520 |

| WM, 48 requests, 3,504 records, baseline → after | Muse | DeepSeek | MiMo |
|---|---|---|---|
| Verdict share | 0.39 → 1.00 | 0.68 → 0.99 | 0.13 → 0.83 |
| Later-step records kept (of 96) | 62 → 85 | 93 → 92 | 32 → 67 |
| **Later-step records discarded** | 0 → **9** | 3 → 1 | 0 → **15** |
| Changed values kept (of 48) | 34 → 48 | 48 → 47 | 17 → 39 |
| Durable records discarded (of 48) | 0 → 0 | 0 → 1 (a preference; not WM-protected by design) | 0 → 0 |
| Finished records discarded (share of 2,112) | 0.22 → 1.00 | 0.59 → 0.98 | 0.10 → 0.82 |
| Achieved ratio (target 0.2) | 0.18 → 0.08 | 0.16 → 0.11 | 0.33 → 0.10 |
| Output tokens per record | 63 → 47 | 103 → 34 | 140 → 72 |
| Turns / output-cap stops | 63 / 0 → 84 / 0 | 85 / 0 → 51 / 0 | 79 / 31 → 48 / 5 |
| Refused calls | 560 → 966 (`already_processed` 779, `unknown_id` 128, `invalid_arguments` 59) | 922 → 4 | 8 → 0 |
| Long-scope later-step kept share | 0.65 → 0.90 | 0.98 → 0.96 | 0.35 → 0.71 |

| Run | Muse | DeepSeek | MiMo |
|---|---|---|---|
| Input tokens (wire), baseline → after | 1.33M → 1.46M | 1.61M → 1.12M | 1.86M → 1.35M |
| Estimated USD ($0.065 per 1M input) | $0.09 → $0.10 | $0.10 → $0.07 | $0.12 → $0.09 |
| Latency p95 | 50 s → 43 s | 89 s → 40 s | 449 s → 264 s |

Reading:

- **WM** gives a verdict on almost every record on every model, keeps more later-step records and changed values on
  Muse and MiMo, and holds DeepSeek level, for fewer output tokens per record. Later-step records *discarded* rose on
  Muse (0 → 9) and MiMo (0 → 15), as Task 5 found; WM also now compresses well below its 0.2 target (0.08–0.11). No
  constraint was discarded.
- **STM** output per 10k source tokens rose 3–6%, inside Task 2's 15% bound. Evidence coverage rose on every model.
  Non-English correction and failure recall rose on every model, and precision rose sharply.
- **English failure signal:** on the fields alone, Muse finds none of the English failed checks and MiMo a third, below
  the pattern baseline. Every new outcome carries `status`, so on those outcomes the pattern no longer applies. Task 2
  named the lever for this case: the `status` schema text, not the pattern. It is carried as a further action
  (plan 218.2 `Further Actions`; `plans/backlog.md`), not changed here: Task 9 changes no product code.
- **Cost:** 4.79M → 3.94M input tokens over the three models (about $0.31 → $0.26).
