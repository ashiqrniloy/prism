# Cache parity: commandcode claude-haiku-5-5

Date 2026-11-11. Prism commit `2cd2b553`. pi 1.5.2. Route: by model. Thinking: medium.

**Verdict: pass**. Requests 30 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.726 (0.696–0.756) | 0.873 | 4.5 | 2/3 |
| pi 1.5.2 | 0.685 (0.674–0.734) | 0.818 | 4 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 8 | 69476 | 58119 | 11339 | 0.837 | no |
| prism | 2 | ok | 5 | 34417 | 26020 | 8385 | 0.756 | yes |
| prism | 3 | ok | 4 | 26192 | 18219 | 7963 | 0.696 | yes |
| pi | 1 | ok | 5 | 19397 | 14241 | 5144 | 0.734 | yes |
| pi | 2 | ok | 4 | 13601 | 9312 | 4279 | 0.685 | yes |
| pi | 3 | ok | 4 | 14417 | 9715 | 4692 | 0.674 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
