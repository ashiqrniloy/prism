# Cache parity: ollama-cloud gemma4:31b

Date 2026-11-08. Prism commit `bc87e539`. pi 1.5.0. Route: native (Prism) / chat completions (pi). Thinking: medium.

**Verdict: pass**. Requests 50 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.866 (0.844–0.891) | 0.947 | 9 | 3/3 |
| pi 1.5.0 | 0.860 (0.813–0.901) | 0.908 | 6 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 8 | 36290 | 30624 | 0 | 0.844 | yes |
| prism | 2 | ok | 9 | 36900 | 31968 | 0 | 0.866 | yes |
| prism | 3 | ok | 12 | 53245 | 47456 | 0 | 0.891 | yes |
| pi | 1 | ok | 6 | 13494 | 10976 | 0 | 0.813 | yes |
| pi | 2 | ok | 9 | 22132 | 19936 | 0 | 0.901 | yes |
| pi | 3 | ok | 6 | 13431 | 11552 | 0 | 0.860 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi-ollama-cloud ignores every base-URL override, so pi ran a run-scoped copy of the extension with its single base-URL constant changed to the proxy; models, compat and request building are the extension's own.
