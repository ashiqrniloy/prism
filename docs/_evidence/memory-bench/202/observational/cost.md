# Observational memory worker cost — plan 202 Task 16

Live one-question LongMemEval-S run, free OpenRouter answer and judges, zero dollar spend.
Source message tokens: **121,798**. The observer ran at its default 10k trigger; the reflector
trigger was lowered to 1k only to force a reflector pass.

| Worker | Calls | Input tokens | Output tokens | Input / 10k source tokens | Output / 10k source tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| Observer | 160 | 2,843,914 | 40,039 | 233,494 | 3,287 |
| Reflector | 5 | 20,734 | 4,356 | 1,702 | 358 |
| Dropper | 0 | 0 | 0 | 0 | 0 |

The arm completed with no worker error. Total arm input was 2,987,872 tokens; the observer
is the dominant OM cost because each pass re-sends the bounded active-observation window and may issue
several tool-call turns. The reflector and dropper are cheap relative to the source stream.

Limitations: one live question, free route, and a lowered reflector threshold. This is a cost
measurement, not quality evidence.
