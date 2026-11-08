# Cache parity: commandcode gpt-5.6-luna

Date 2026-11-08. Prism commit `bc87e539`. pi 1.5.0. Route: by model. Thinking: medium.

**Verdict: pass**. Requests 38 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.850 (0.796–0.863) | 0.935 | 8 | 3/3 |
| pi 1.5.0 | 0.735 (0.735–0.737) | 0.812 | 5 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 9 | 42747 | 36886 | 5834 | 0.863 | yes |
| prism | 2 | ok | 6 | 25565 | 20349 | 5198 | 0.796 | yes |
| prism | 3 | ok | 8 | 35146 | 29874 | 5248 | 0.850 | yes |
| pi | 1 | ok | 5 | 11035 | 8135 | 2885 | 0.737 | yes |
| pi | 2 | ok | 5 | 11353 | 8342 | 2996 | 0.735 | yes |
| pi | 3 | ok | 5 | 11718 | 8616 | 3087 | 0.735 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
