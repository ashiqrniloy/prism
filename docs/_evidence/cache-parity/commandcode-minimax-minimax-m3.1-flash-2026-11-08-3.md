# Cache parity: commandcode minimax/minimax-m3.1-flash

Date 2026-11-08. Prism commit `2fd3c592`. pi 1.5.0. Route: by model. Thinking: medium.

**Verdict: pass**. Requests 44 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.844 (0.844–0.870) | 0.914 | 8 | 3/3 |
| pi 1.5.0 | 0.780 (0.751–0.789) | 0.839 | 6 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 8 | 45402 | 38300 | 0 | 0.844 | yes |
| prism | 2 | ok | 10 | 58495 | 50913 | 0 | 0.870 | yes |
| prism | 3 | ok | 8 | 49179 | 41498 | 0 | 0.844 | yes |
| pi | 1 | ok | 6 | 18759 | 14080 | 0 | 0.751 | yes |
| pi | 2 | ok | 6 | 18717 | 14771 | 0 | 0.789 | yes |
| pi | 3 | ok | 6 | 19044 | 14848 | 0 | 0.780 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
