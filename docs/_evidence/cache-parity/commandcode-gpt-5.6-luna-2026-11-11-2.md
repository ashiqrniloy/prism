# Cache parity: commandcode gpt-5.6-luna

Date 2026-11-11. Prism commit `24f589be`. pi 1.5.2. Route: by model. Thinking: medium.

**Verdict: pass**. Requests 44 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.860 (0.816–0.878) | 0.912 | 10 | 3/3 |
| pi 1.5.2 | 0.735 (0.735–0.772) | 0.810 | 5 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 10 | 39287 | 33801 | 5456 | 0.860 | yes |
| prism | 2 | ok | 7 | 24253 | 19802 | 4430 | 0.816 | yes |
| prism | 3 | ok | 11 | 42381 | 37205 | 5143 | 0.878 | yes |
| pi | 1 | ok | 5 | 11703 | 8605 | 3083 | 0.735 | yes |
| pi | 2 | ok | 6 | 14149 | 10920 | 3211 | 0.772 | yes |
| pi | 3 | ok | 5 | 11709 | 8611 | 3083 | 0.735 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
