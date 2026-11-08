# Cache parity: commandcode gpt-5.6-luna

Date 2026-11-08. Prism commit `bc87e539`. pi 1.5.0. Route: by model. Thinking: medium.

**Verdict: usage_mismatch** (request 1 inputTokens: harness 3278, proxy 3275). Requests 38 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.000 (0.000–0.000) | 0.000 | 9 | 3/3 |
| pi 1.5.0 | 0.000 (0.000–0.000) | 0.000 | 5 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | usage_mismatch | 9 | 5371 | 0 | 5371 | 0.000 | yes |
| prism | 2 | usage_mismatch | 5 | 4675 | 0 | 4675 | 0.000 | yes |
| prism | 3 | usage_mismatch | 9 | 5353 | 0 | 5353 | 0.000 | yes |
| pi | 1 | ok | 5 | 10778 | 0 | 0 | 0.000 | yes |
| pi | 2 | ok | 5 | 10456 | 0 | 0 | 0.000 | yes |
| pi | 3 | ok | 5 | 10653 | 0 | 0 | 0.000 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
