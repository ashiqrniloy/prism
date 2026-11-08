# Cache parity: commandcode gpt-5.6-luna

Date 2026-11-08. Prism commit `bc87e539`. pi 1.5.0. Route: by model. Thinking: medium.

**Verdict: pass**. Requests 40 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.836 (0.789–0.864) | 0.907 | 8 | 3/3 |
| pi 1.5.0 | 0.739 (0.737–0.769) | 0.814 | 5 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 6 | 19157 | 15114 | 4025 | 0.789 | yes |
| prism | 2 | ok | 8 | 28793 | 24082 | 4687 | 0.836 | yes |
| prism | 3 | ok | 10 | 39301 | 33954 | 5317 | 0.864 | yes |
| pi | 1 | ok | 6 | 12484 | 9603 | 2863 | 0.769 | yes |
| pi | 2 | ok | 5 | 11458 | 8448 | 2995 | 0.737 | yes |
| pi | 3 | ok | 5 | 12336 | 9114 | 3207 | 0.739 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
