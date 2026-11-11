# Cache parity: commandcode minimax/minimax-m3.1-flash

Date 2026-11-11. Prism commit `2cd2b553`. pi 1.5.2. Route: by model. Thinking: medium.

**Verdict: pass**. Requests 48 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.794 (0.744–0.802) | 0.848 | 9 | 3/3 |
| pi 1.5.2 | 0.733 (0.716–0.794) | 0.790 | 6 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 9 | 54127 | 42961 | 0 | 0.794 | yes |
| prism | 2 | ok | 9 | 57465 | 46069 | 0 | 0.802 | yes |
| prism | 3 | ok | 11 | 74092 | 55116 | 0 | 0.744 | yes |
| pi | 1 | ok | 7 | 20047 | 14692 | 0 | 0.733 | yes |
| pi | 2 | ok | 6 | 17238 | 12335 | 0 | 0.716 | yes |
| pi | 3 | ok | 6 | 18535 | 14720 | 0 | 0.794 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
