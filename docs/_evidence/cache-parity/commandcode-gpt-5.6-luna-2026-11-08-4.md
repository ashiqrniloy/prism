# Cache parity: commandcode gpt-5.6-luna

Date 2026-11-08. Prism commit `2fd3c592`. pi 1.5.0. Route: by model. Thinking: medium.

**Verdict: pass**. Requests 38 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.808 (0.784–0.865) | 0.887 | 7 | 3/3 |
| pi 1.5.0 | 0.737 (0.735–0.737) | 0.814 | 5 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 7 | 25330 | 20468 | 4841 | 0.808 | yes |
| prism | 2 | ok | 10 | 37785 | 32674 | 5081 | 0.865 | yes |
| prism | 3 | ok | 6 | 20045 | 15712 | 4315 | 0.784 | yes |
| pi | 1 | ok | 5 | 11442 | 8436 | 2991 | 0.737 | yes |
| pi | 2 | ok | 5 | 11475 | 8457 | 3003 | 0.737 | yes |
| pi | 3 | ok | 5 | 11106 | 8160 | 2931 | 0.735 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
