# OM and preset arm completion smoke — plan 202 Task 16

One LongMemEval-S question per arm, two free OpenRouter models, free judges, zero dollar spend.
**This is a completion smoke, not a development partition or quality comparison.**

| Model | Arm | Status | Correct | Judge verdicts | Worker errors |
| --- | --- | --- | --- | --- | ---: |
| nvidia/nemotron-3-ultra-550b-a55b:free | om | partial | False | {'openrouter/dots-studio/dots-3-note-preview:free': 'no', 'openrouter/cohere/north-mini-code:free': 'no'} | 0 |
| nvidia/nemotron-3-ultra-550b-a55b:free | om+fabric | partial | False | {'openrouter/dots-studio/dots-3-note-preview:free': 'no', 'openrouter/cohere/north-mini-code:free': 'no'} | 0 |
| nvidia/nemotron-3-ultra-550b-a55b:free | fabric-x-tools | partial | True | {'openrouter/dots-studio/dots-3-note-preview:free': 'yes', 'openrouter/cohere/north-mini-code:free': 'yes'} | 0 |
| nvidia/nemotron-3.5-super-vl:free | om | partial | False | {'openrouter/dots-studio/dots-3-note-preview:free': 'no', 'openrouter/cohere/north-mini-code:free': 'no'} | 0 |
| nvidia/nemotron-3.5-super-vl:free | om+fabric | partial | False | {'openrouter/dots-studio/dots-3-note-preview:free': 'no', 'openrouter/cohere/north-mini-code:free': 'no'} | 0 |
| nvidia/nemotron-3.5-super-vl:free | fabric-x-tools | partial | True | {'openrouter/dots-studio/dots-3-note-preview:free': 'yes', 'openrouter/cohere/north-mini-code:free': 'yes'} | 0 |

All six runs reached the answer phase and were scored. The OM arms made live observer calls;
no worker error survived to the completion checkpoint. The earlier historical
`MemoryBenchWorkerError` is explained by the benchmark aborting on a background worker failure:
the retained cause was either the arm's own token ceiling or a provider rate limit. The benchmark
now records non-budget worker errors and continues, as the product contract already does.
