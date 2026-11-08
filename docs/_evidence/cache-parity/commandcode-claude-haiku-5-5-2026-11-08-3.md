# Cache parity: commandcode claude-haiku-5-5

Date 2026-11-08. Prism commit `bc87e539`. pi 1.5.0. Route: by model. Thinking: medium.

**Verdict: pass**. Requests 28 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.742 (0.695–0.790) | 0.879 | 5 | 2/3 |
| pi 1.5.0 | 0.680 (0.676–0.683) | 0.810 | 4 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 4 | 26444 | 18373 | 8061 | 0.695 | yes |
| prism | 2 | ok | 5 | 53607 | 38552 | 15043 | 0.719 | no |
| prism | 3 | ok | 6 | 41093 | 32461 | 8618 | 0.790 | yes |
| pi | 1 | ok | 4 | 13971 | 9442 | 4519 | 0.676 | yes |
| pi | 2 | ok | 4 | 13813 | 9434 | 4369 | 0.683 | yes |
| pi | 3 | ok | 4 | 13865 | 9434 | 4421 | 0.680 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
