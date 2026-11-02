# Plan 202 Task 6 evidence

## Closure note (2026-11-01)

Owner instruction: **"Close task 6 with a note."** Task 6 is closed on the functional
implementation plus the bounded free-model diagnostic below. The acceptance target names
*every model where the baseline showed a temporal gap*; that multi-model confirmation is
**not** claimed here and remains handed off to Plan 210 Task 9.

### Diagnostic protocol

- Suite: `longmemeval-s`, subset `targeted`, ability `temporal-reasoning` (30 questions).
- Candidate: `fabric-x-tools`; comparator: `full`.
- Answer model: `nvidia/nemotron-3-ultra-550b-a55b:free` through Kilo AI Gateway.
- Judges: `dots-studio/dots-3-note-preview:free` and `cohere/north-mini-code:free`,
  plain-text verdicts (`plain-text-v1`), `bounded-wire`, label injections off.
- Cost: $0 (free routes); no paid call was made.

### Results

| Arm | Scored | Correct | Accuracy |
| --- | ---: | ---: | ---: |
| Candidate (`fabric-x-tools`) | 30 | 19 | 63.3% |
| `full` | 26 | 6 | 23.1% |

Matched 26 scored questions:

| Arm | Correct | Accuracy |
| --- | ---: | ---: |
| Candidate | 18 | 69.2% |
| `full` | 6 | 23.1% |

- Paired outcomes: 12 candidate-only wins, 0 full-only wins.
- Exact paired sign-test: p ≈ 0.000488.
- Candidate `recallAtK`: 0.9655.
- Four `full` rows were lost to free-judge stream/verdict errors, so the matched subset is used.

### Raw reports

Raw reports contain benchmark question and answer text and are kept out of the repository:

- `.cache/memory-bench/task6-quick/kilo-candidate-30.json`
  sha256 `fd536c9cf9deeb4dddbaba277cd5d554892759c6544580f6631a894de1952407`
- `.cache/memory-bench/task6-quick/kilo-full-30-resume2.json`
  sha256 `befd60b5ac2b0f552de207bfad4c5918d2c430fc298888332ecca1b6267c4706`

Machine-readable aggregate: [closure.json](closure.json).

### Residual

Plan 210 Task 9 still owns the multi-model and baseline-model temporal screen. This closure
does not promote a default or claim a published multi-model accuracy improvement.