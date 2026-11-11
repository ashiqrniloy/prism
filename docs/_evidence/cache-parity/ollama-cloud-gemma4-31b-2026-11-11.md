# Cache parity: ollama-cloud gemma4:31b

Date 2026-11-11. Prism commit `2cd2b553`. pi 1.5.2. Route: native (Prism) / chat completions (pi). Thinking: medium.

**Verdict: pass**. Requests 54 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.897 (0.876–0.902) | 0.953 | 12 | 3/3 |
| pi 1.5.2 | 0.853 (0.842–0.861) | 0.909 | 6 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 12 | 50903 | 45664 | 0 | 0.897 | yes |
| prism | 2 | ok | 13 | 58562 | 52832 | 0 | 0.902 | yes |
| prism | 3 | ok | 10 | 47577 | 41664 | 0 | 0.876 | yes |
| pi | 1 | ok | 7 | 16610 | 13984 | 0 | 0.842 | yes |
| pi | 2 | ok | 6 | 13570 | 11680 | 0 | 0.861 | yes |
| pi | 3 | ok | 6 | 13426 | 11456 | 0 | 0.853 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi-ollama-cloud ignores every base-URL override, so pi ran a run-scoped copy of the extension with its single base-URL constant changed to the proxy; models, compat and request building are the extension's own.
