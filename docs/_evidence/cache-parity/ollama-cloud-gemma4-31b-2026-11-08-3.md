# Cache parity: ollama-cloud gemma4:31b

Date 2026-11-08. Prism commit `2fd3c592`. pi 1.5.0. Route: native (Prism) / chat completions (pi). Thinking: medium.

**Verdict: behind**. Requests 50 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.850 (0.849–0.883) | 0.943 | 8 | 3/3 |
| pi 1.5.0 | 0.890 (0.867–0.892) | 0.925 | 8 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 11 | 47824 | 42240 | 0 | 0.883 | yes |
| prism | 2 | ok | 8 | 31760 | 27008 | 0 | 0.850 | yes |
| prism | 3 | ok | 8 | 31811 | 27008 | 0 | 0.849 | yes |
| pi | 1 | ok | 7 | 16912 | 14656 | 0 | 0.867 | yes |
| pi | 2 | ok | 8 | 19955 | 17792 | 0 | 0.892 | yes |
| pi | 3 | ok | 8 | 18525 | 16480 | 0 | 0.890 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi-ollama-cloud ignores every base-URL override, so pi ran a run-scoped copy of the extension with its single base-URL constant changed to the proxy; models, compat and request building are the extension's own.
