# Cache parity: commandcode minimax/minimax-m3.1-flash

Date 2026-11-11. Prism commit `24f589be`. pi 1.5.2. Route: by model. Thinking: medium.

**Verdict: pass**. Requests 49 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.830 (0.810–0.874) | 0.879 | 10 | 3/3 |
| pi 1.5.2 | 0.711 (0.682–0.743) | 0.765 | 6 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 10 | 54133 | 43847 | 0 | 0.810 | yes |
| prism | 2 | ok | 10 | 68251 | 59634 | 0 | 0.874 | yes |
| prism | 3 | ok | 11 | 62610 | 51970 | 0 | 0.830 | yes |
| pi | 1 | ok | 7 | 19966 | 14843 | 0 | 0.743 | yes |
| pi | 2 | ok | 6 | 18848 | 13407 | 0 | 0.711 | yes |
| pi | 3 | ok | 5 | 13619 | 9286 | 0 | 0.682 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
