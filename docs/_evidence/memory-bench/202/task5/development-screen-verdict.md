# Task 5 Development Screen Verdict: miss

- **Criteria Version:** `202-task5-candidate-gap-v2-screen`
- **Manifest Hash:** `8828ec96fa4efde255ca7b07d4d855123486a14a6b2531dc461df3d4476c26a7`
- **Mode:** `development-screen` (candidate-gap rows gate; ability guard is descriptive under Task 5.4.6 owner disposition)
- **Generated At:** `2026-11-05T12:32:37.515Z`
- **Overall Screen Verdict:** **`miss`**

## Summary by Suite

| Suite | Complete Pairs | Control Gap | Candidate Gap | Ratio | Target (<= 0.5x) | Gap Verdict | Ability Regressions | Suite Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `beam-100k` | 27 | 85.2% (23/27) | 81.5% (22/27) | 0.957 | <=42.6% | **`miss`** | abstention, preference_following | **`miss`** |
| `locomo` | 55 | 67.3% (37/55) | 81.8% (45/55) | 1.216 | <=33.6% | **`miss`** | open-domain, adversarial | **`miss`** |
| `memoryagentbench-cr` | 0 (20 paired) | null (unmeasurable) | null (unmeasurable) | n/a | n/a | **`inconclusive`** | none | **`inconclusive`** |
| `beam-1m` | 8 | 100.0% (8/8) | 87.5% (7/8) | 0.875 | <=50.0% | **`miss`** | multi_session_reasoning | **`miss`** |

## Candidate-Gap Detail

### `beam-100k`

- **Complete Pairs:** 27 (of 33 total paired questions)
- **Control Gap:** 23/27 (85.19%)
- **Candidate Gap:** 22/27 (81.48%)
- **Ratio:** 0.957 (required: <= 0.500)
- **Halving Target:** <= 42.59%
- **Paired Difference (Candidate - Control):** -3.70% (95% CI: [-14.81%, 8.70%], two-sided sign-flip p = 1.0000)
- **Worst-Case Bound:** candidate failures counted as not-surfaced: 23/28 (79.31%, passed: false)
- **Candidate-Gap Verdict:** **`miss`**

### `locomo`

- **Complete Pairs:** 55 (of 60 total paired questions)
- **Control Gap:** 37/55 (67.27%)
- **Candidate Gap:** 45/55 (81.82%)
- **Ratio:** 1.216 (required: <= 0.500)
- **Halving Target:** <= 33.64%
- **Paired Difference (Candidate - Control):** 14.55% (95% CI: [0.00%, 28.99%], two-sided sign-flip p = 0.1875)
- **Worst-Case Bound:** candidate failures counted as not-surfaced: 47/57 (78.33%, passed: false)
- **Candidate-Gap Verdict:** **`miss`**

### `memoryagentbench-cr`

- **Status:** Unmeasurable (no fine-round labels or unresolved gold reference; missingness is never zero)
- **Verdict:** `inconclusive`

### `beam-1m`

- **Complete Pairs:** 8 (of 11 total paired questions)
- **Control Gap:** 8/8 (100.00%)
- **Candidate Gap:** 7/8 (87.50%)
- **Ratio:** 0.875 (required: <= 0.500)
- **Halving Target:** <= 50.00%
- **Paired Difference (Candidate - Control):** -12.50% (95% CI: [-37.50%, 0.00%], two-sided sign-flip p = 1.0000)
- **Worst-Case Bound:** candidate failures counted as not-surfaced: 8/9 (88.89%, passed: false)
- **Candidate-Gap Verdict:** **`miss`**

## Ability-Guard Detail (Descriptive)

### `beam-100k`

| Ability | Pairs | Control Acc | Candidate Acc | Diff | 95% CI | Sign-Flip p | Holm p | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `abstention` | 4 | 75.0% (3/4) | 25.0% (1/4) | -50.0% | [-100.0%, 0.0%] | 0.5000 | 1.0000 | **regression** |
| `contradiction_resolution` | 4 | 0.0% (0/4) | 0.0% (0/4) | +0.0% | [0.0%, 0.0%] | 1.0000 | 1.0000 | pass |
| `event_ordering` | 4 | 0.0% (0/4) | 0.0% (0/4) | +0.0% | [0.0%, 0.0%] | 1.0000 | 1.0000 | pass |
| `information_extraction` | 4 | 50.0% (2/4) | 50.0% (2/4) | +0.0% | [0.0%, 0.0%] | 1.0000 | 1.0000 | pass |
| `instruction_following` | 4 | 50.0% (2/4) | 75.0% (3/4) | +25.0% | [0.0%, 75.0%] | 1.0000 | 1.0000 | pass |
| `knowledge_update` | 3 | 66.7% (2/3) | 66.7% (2/3) | +0.0% | [0.0%, 0.0%] | 1.0000 | 1.0000 | pass |
| `multi_session_reasoning` | 4 | 0.0% (0/4) | 25.0% (1/4) | +25.0% | [0.0%, 75.0%] | 1.0000 | 1.0000 | pass |
| `preference_following` | 4 | 75.0% (3/4) | 25.0% (1/4) | -50.0% | [-100.0%, 0.0%] | 0.5000 | 1.0000 | **regression** |
| `summarization` | 0 | null | null | null | null | null | null | **unverified** |
| `temporal_reasoning` | 0 | null | null | null | null | null | null | **unverified** |

### `locomo`

| Ability | Pairs | Control Acc | Candidate Acc | Diff | 95% CI | Sign-Flip p | Holm p | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `multi-hop` | 12 | 25.0% (3/12) | 33.3% (4/12) | +8.3% | [0.0%, 21.4%] | 1.0000 | 1.0000 | pass |
| `temporal` | 12 | 66.7% (8/12) | 66.7% (8/12) | +0.0% | [-25.0%, 20.0%] | 1.0000 | 1.0000 | pass |
| `open-domain` | 10 | 50.0% (5/10) | 40.0% (4/10) | -10.0% | [-23.1%, 0.0%] | 1.0000 | 1.0000 | **regression** |
| `single-hop` | 12 | 91.7% (11/12) | 91.7% (11/12) | +0.0% | [-25.0%, 20.0%] | 1.0000 | 1.0000 | pass |
| `adversarial` | 9 | 77.8% (7/9) | 66.7% (6/9) | -11.1% | [-45.5%, 40.0%] | 1.0000 | 1.0000 | **regression** |

### `memoryagentbench-cr`

| Ability | Pairs | Control Acc | Candidate Acc | Diff | 95% CI | Sign-Flip p | Holm p | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `conflict-resolution-single-hop` | 10 | 100.0% (10/10) | 100.0% (10/10) | +0.0% | [0.0%, 0.0%] | 1.0000 | 1.0000 | pass |
| `conflict-resolution-multi-hop` | 8 | 37.5% (3/8) | 37.5% (3/8) | +0.0% | [-27.3%, 37.5%] | 1.0000 | 1.0000 | pass |

### `beam-1m`

| Ability | Pairs | Control Acc | Candidate Acc | Diff | 95% CI | Sign-Flip p | Holm p | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `abstention` | 2 | 50.0% (1/2) | 50.0% (1/2) | +0.0% | [0.0%, 0.0%] | 1.0000 | 1.0000 | pass |
| `contradiction_resolution` | 1 | 0.0% (0/1) | 0.0% (0/1) | +0.0% | [0.0%, 0.0%] | 1.0000 | 1.0000 | pass |
| `event_ordering` | 1 | 0.0% (0/1) | 0.0% (0/1) | +0.0% | [0.0%, 0.0%] | 1.0000 | 1.0000 | pass |
| `information_extraction` | 2 | 100.0% (2/2) | 100.0% (2/2) | +0.0% | [0.0%, 0.0%] | 1.0000 | 1.0000 | pass |
| `instruction_following` | 1 | 0.0% (0/1) | 0.0% (0/1) | +0.0% | [0.0%, 0.0%] | 1.0000 | 1.0000 | pass |
| `knowledge_update` | 0 | null | null | null | null | null | null | **unverified** |
| `multi_session_reasoning` | 2 | 100.0% (2/2) | 50.0% (1/2) | -50.0% | [-100.0%, 0.0%] | 1.0000 | 1.0000 | **regression** |
| `preference_following` | 1 | 100.0% (1/1) | 100.0% (1/1) | +0.0% | [0.0%, 0.0%] | 1.0000 | 1.0000 | pass |
| `summarization` | 0 | null | null | null | null | null | null | **unverified** |
| `temporal_reasoning` | 0 | null | null | null | null | null | null | **unverified** |

## Plan 210 Hand-Off

- **Disposition:** deferred to plan 210 by the plan 202 Task 5.4.6 owner disposition; the full target is postponed, not dropped
- **Summary:** Candidate gap did not achieve the required 50% reduction in any measurable suite (ratios 0.88-1.22 vs target <= 0.50). MAB was unmeasurable due to lack of fine round labels. Descriptive ability regressions observed on beam-100k (abstention, preference_following), locomo (adversarial, open-domain), and beam-1m (multi_session_reasoning), with summarization and temporal_reasoning unverified. Screen closes as miss; deferred arms and root-cause investigations hand off to Plan 210.
- **Deferred Arms and Tasks:**
  - `longmemeval-m` full write & recall execution deferred to Plan 210 Task 5
  - `beam-1m` full 40-question cohort deferred to Plan 210 Task 5
  - Ability guard veto evaluation deferred to Plan 210 Task 9 (suite coverage)
  - Root-cause recall investigations on LoCoMo and BEAM hand off to Plan 210 Task 1 ledger

## Source Reports

| Cell ID | Status | Scored / Total | Report Path | sha256 |
| --- | --- | --- | --- | --- |
| `202-task5.control.beam-100k.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free` | failed | 32/33 | `docs/_evidence/memory-bench/202/task5/run-202-task5.control.beam-100k.preset-r1.kilo.nvidia-nemotron-3-ultra-550b-a55b:free.json` | `b2b1ea89f67599fc...` |
| `202-task5.candidate.beam-100k.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free` | completed | 38/40 | `docs/_evidence/memory-bench/202/task5/run-202-task5.candidate.beam-100k.preset-r1.kilo.nvidia-nemotron-3-ultra-550b-a55b:free.json` | `30c78f6da9d52bd0...` |
| `202-task5.control.locomo.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free` | completed | 57/60 | `docs/_evidence/memory-bench/202/task5/run-202-task5.control.locomo.preset-r1.kilo.nvidia-nemotron-3-ultra-550b-a55b:free.json` | `242610b8689bc47b...` |
| `202-task5.candidate.locomo.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free` | completed | 58/60 | `docs/_evidence/memory-bench/202/task5/run-202-task5.candidate.locomo.preset-r1.kilo.nvidia-nemotron-3-ultra-550b-a55b:free.json` | `c81d5a4a8d96df63...` |
| `202-task5.control.memoryagentbench-cr.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free` | completed | 20/20 | `docs/_evidence/memory-bench/202/task5/run-202-task5.control.memoryagentbench-cr.preset-r1.kilo.nvidia-nemotron-3-ultra-550b-a55b:free.json` | `1764afa6f96a29d9...` |
| `202-task5.candidate.memoryagentbench-cr.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free` | completed | 18/20 | `docs/_evidence/memory-bench/202/task5/run-202-task5.candidate.memoryagentbench-cr.preset-r1.kilo.nvidia-nemotron-3-ultra-550b-a55b:free.json` | `1ccfed08e4c26af2...` |
| `202-task5.control.beam-1m.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free` | completed | 40/40 | `docs/_evidence/memory-bench/202/task5/run-202-task5.control.beam-1m.preset-r1.kilo.nvidia-nemotron-3-ultra-550b-a55b:free.json` | `6b13e2fe40ada26e...` |
| `202-task5.candidate.beam-1m.preset-r1.kilo.nvidia/nemotron-3-ultra-550b-a55b:free` | failed | 27/31 | `docs/_evidence/memory-bench/202/task5/run-202-task5.candidate.beam-1m.preset-r1.kilo.nvidia-nemotron-3-ultra-550b-a55b:free.json` | `11339def7581737e...` |
