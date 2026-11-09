# Cache parity: commandcode claude-haiku-5-5

Date 2026-11-08. Prism commit `2fd3c592`. pi 1.5.0. Route: by model. Thinking: medium.

**Verdict: pass**. Requests 30 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.749 (0.703–0.795) | 0.875 | 5 | 2/3 |
| pi 1.5.0 | 0.675 (0.672–0.676) | 0.800 | 4 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 8 | 92881 | 77471 | 15392 | 0.834 | no |
| prism | 2 | ok | 4 | 25842 | 18170 | 7662 | 0.703 | yes |
| prism | 3 | ok | 6 | 52713 | 41899 | 10800 | 0.795 | yes |
| pi | 1 | ok | 4 | 13960 | 9442 | 4508 | 0.676 | yes |
| pi | 2 | ok | 4 | 14449 | 9715 | 4724 | 0.672 | yes |
| pi | 3 | ok | 4 | 14198 | 9587 | 4601 | 0.675 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
