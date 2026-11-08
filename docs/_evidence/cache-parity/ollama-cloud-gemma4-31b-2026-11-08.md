# Cache parity: ollama-cloud gemma4:31b

Date 2026-11-08. Prism commit `bc87e539`. pi 1.5.0. Route: native (Prism) / chat completions (pi). Thinking: medium.

**Verdict: pass**. Requests 49 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.894 (0.882–0.895) | 0.958 | 9 | 3/3 |
| pi 1.5.0 | 0.874 (0.819–0.884) | 0.914 | 7 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 10 | 52695 | 46496 | 0 | 0.882 | yes |
| prism | 2 | ok | 9 | 46702 | 41792 | 0 | 0.895 | yes |
| prism | 3 | ok | 9 | 46853 | 41888 | 0 | 0.894 | yes |
| pi | 1 | ok | 6 | 13291 | 10880 | 0 | 0.819 | yes |
| pi | 2 | ok | 8 | 19619 | 17344 | 0 | 0.884 | yes |
| pi | 3 | ok | 7 | 16433 | 14368 | 0 | 0.874 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi-ollama-cloud ignores every base-URL override, so pi ran a run-scoped copy of the extension with its single base-URL constant changed to the proxy; models, compat and request building are the extension's own.
