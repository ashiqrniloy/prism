# Cache parity: commandcode gpt-5.6-luna

Date 2026-11-11. Prism commit `2cd2b553`. pi 1.5.2. Route: by model. Thinking: medium.

**Verdict: pass**. Requests 44 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.868 (0.855–0.870) | 0.922 | 10 | 3/3 |
| pi 1.5.2 | 0.737 (0.736–0.738) | 0.815 | 5 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 10 | 38033 | 33019 | 4984 | 0.868 | yes |
| prism | 2 | ok | 10 | 40002 | 34805 | 5167 | 0.870 | yes |
| prism | 3 | ok | 9 | 32253 | 27563 | 4663 | 0.855 | yes |
| pi | 1 | ok | 5 | 11386 | 8394 | 2977 | 0.737 | yes |
| pi | 2 | ok | 5 | 10894 | 8019 | 2860 | 0.736 | yes |
| pi | 3 | ok | 5 | 11798 | 8702 | 3081 | 0.738 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
