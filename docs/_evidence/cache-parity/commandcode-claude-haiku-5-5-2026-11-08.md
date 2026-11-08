# Cache parity: commandcode claude-haiku-5-5

Date 2026-11-08. Prism commit `bc87e539`. pi 1.5.0. Route: by model. Thinking: medium.

**Verdict: behind**. Requests 24 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.000 (0.000–0.000) | 0.000 | 3 | 3/3 |
| pi 1.5.0 | 0.677 (0.674–0.681) | 0.803 | 4 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 3 | 23056 | 0 | 0 | 0.000 | yes |
| prism | 2 | ok | 3 | 22763 | 0 | 0 | 0.000 | yes |
| prism | 3 | ok | 3 | 23056 | 0 | 0 | 0.000 | yes |
| pi | 1 | ok | 4 | 13883 | 9453 | 4420 | 0.681 | yes |
| pi | 2 | ok | 4 | 14201 | 9568 | 4623 | 0.674 | yes |
| pi | 3 | ok | 4 | 14167 | 9594 | 4563 | 0.677 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
