# Cache parity: commandcode minimax/minimax-m3.1-flash

Date 2026-11-08. Prism commit `bc87e539`. pi 1.5.0. Route: by model. Thinking: medium.

**Verdict: pass**. Requests 49 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.848 (0.843–0.883) | 0.908 | 10 | 3/3 |
| pi 1.5.0 | 0.779 (0.756–0.814) | 0.852 | 6 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 9 | 61978 | 52224 | 0 | 0.843 | yes |
| prism | 2 | ok | 10 | 54964 | 46592 | 0 | 0.848 | yes |
| prism | 3 | ok | 12 | 67129 | 59264 | 0 | 0.883 | yes |
| pi | 1 | ok | 7 | 19639 | 15993 | 0 | 0.814 | yes |
| pi | 2 | ok | 5 | 13364 | 10099 | 0 | 0.756 | yes |
| pi | 3 | ok | 6 | 18404 | 14336 | 0 | 0.779 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
