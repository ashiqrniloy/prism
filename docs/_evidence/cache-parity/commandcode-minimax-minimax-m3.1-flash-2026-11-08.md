# Cache parity: commandcode minimax/minimax-m3.1-flash

Date 2026-11-08. Prism commit `bc87e539`. pi 1.5.0. Route: by model. Thinking: medium.

**Verdict: pass**. Requests 47 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.867 (0.829–0.893) | 0.915 | 9 | 3/3 |
| pi 1.5.0 | 0.783 (0.761–0.786) | 0.849 | 6 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 8 | 55882 | 46336 | 0 | 0.829 | yes |
| prism | 2 | ok | 12 | 73933 | 66048 | 0 | 0.893 | yes |
| prism | 3 | ok | 9 | 67600 | 58624 | 0 | 0.867 | yes |
| pi | 1 | ok | 6 | 18339 | 14423 | 0 | 0.786 | yes |
| pi | 2 | ok | 6 | 16821 | 12800 | 0 | 0.761 | yes |
| pi | 3 | ok | 6 | 19291 | 15101 | 0 | 0.783 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
