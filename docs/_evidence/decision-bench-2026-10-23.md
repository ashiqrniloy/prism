# Decision bench — 2026-10-23

Live run of `scripts/decision-bench.mjs` over `scripts/fixtures/decision-bench.jsonl`. 

## Environment

- Host: AMD Ryzen 9 PRO 7940HS w/ Radeon 780M Graphics (x64, linux), 61 GB RAM
- Bun 1.4.4 on Node 26.3.0
- llama-server: 0.7.0-dev (build 11840, commit 36e36e63a)
- d1-3B GGUF sha256: Q8_0=2f0942d5a5f64cf69c3356d2be439b71644b1f0eb3a580912a5a0179eeaba77d; Q4_K_M=16aff27ea2eefdc32b9897f43854a5d3170c1dc8dccb9c756905af30a4e22402; mmproj-Q8_0=2505920ce464b7c54acd8b7b74a931c0c671f06d0c8833760b2fbceeb253e92a
- Items: 200 (with option-reversal repeats)
- Request budget: liquid-local/d1-3B@Q8_0=400, liquid-local/d1-3B@Q4_K_M=400

## Metrics

| model | echoed model | answered | errors | accuracy | ECE | Brier | p50 ms | p95 ms | flip rate | input tokens | cost USD |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| liquid-local/d1-3B@Q8_0 | d1-3B | 200 | 0 | 62.5% | 0.112 | 0.189 | 744 | 1412 | 12.0% | 17655 | 0.000000 |
| liquid-local/d1-3B@Q4_K_M | d1-3B | 200 | 0 | 63.0% | 0.118 | 0.194 | 330 | 818 | 12.0% | 17655 | 0.000000 |

### By category

| model | category | items | accuracy | ECE | Brier |
| --- | --- | ---: | ---: | ---: | ---: |
| liquid-local/d1-3B@Q8_0 | approval-risk | 50 | 34.0% | 0.589 | 0.468 |
| liquid-local/d1-3B@Q8_0 | route | 50 | 48.0% | 0.276 | 0.105 |
| liquid-local/d1-3B@Q8_0 | tool | 50 | 84.0% | 0.207 | 0.064 |
| liquid-local/d1-3B@Q8_0 | tool-result-error | 50 | 84.0% | 0.120 | 0.117 |
| liquid-local/d1-3B@Q4_K_M | approval-risk | 50 | 36.0% | 0.625 | 0.497 |
| liquid-local/d1-3B@Q4_K_M | route | 50 | 44.0% | 0.252 | 0.097 |
| liquid-local/d1-3B@Q4_K_M | tool | 50 | 86.0% | 0.209 | 0.068 |
| liquid-local/d1-3B@Q4_K_M | tool-result-error | 50 | 86.0% | 0.106 | 0.114 |

## Agreement between models

Hosted-vs-local is the README-facing rate; quant-to-quant is the Q4_K_M vs Q8_0 drift.

| model A | model B | shared items | agreement |
| --- | --- | ---: | ---: |
| liquid-local/d1-3B@Q8_0 | liquid-local/d1-3B@Q4_K_M | 200 | 95.5% |

## Method

- Accuracy: noul thresholded at 0.5, choice label match, score rounded to its 1-based level.
- ECE: 10 equal-width probability bins; Brier over the same probability/label pairs. Choice uses `probabilities[label]` when the answer carries it; score uses `confidence` against correctness.
- Flip rate: choice items only, second request with the criteria order reversed; counted when the chosen label changes.
- Agreement: same item, comparable answer (choice label / noul threshold / rounded score), no request errors.
- Cost: `usage.input_tokens` × the vendor's per-MTok input price; output tokens are always 0 for decision models.
