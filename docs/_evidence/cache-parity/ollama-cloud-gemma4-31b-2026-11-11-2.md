# Cache parity: ollama-cloud gemma4:31b

Date 2026-11-11. Prism commit `24f589be`. pi 1.5.2. Route: native (Prism) / chat completions (pi). Thinking: medium.

**Verdict: pass**. Requests 55 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.901 (0.844–0.902) | 0.946 | 13 | 3/3 |
| pi 1.5.2 | 0.867 (0.855–0.872) | 0.916 | 6 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 8 | 36298 | 30624 | 0 | 0.844 | yes |
| prism | 2 | ok | 13 | 65501 | 59008 | 0 | 0.901 | yes |
| prism | 3 | ok | 13 | 58332 | 52640 | 0 | 0.902 | yes |
| pi | 1 | ok | 9 | 21502 | 18752 | 0 | 0.872 | yes |
| pi | 2 | ok | 6 | 13365 | 11584 | 0 | 0.867 | yes |
| pi | 3 | ok | 6 | 13391 | 11456 | 0 | 0.855 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi-ollama-cloud ignores every base-URL override, so pi ran a run-scoped copy of the extension with its single base-URL constant changed to the proxy; models, compat and request building are the extension's own.
