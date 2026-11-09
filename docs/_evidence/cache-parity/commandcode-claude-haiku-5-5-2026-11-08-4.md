# Cache parity: commandcode claude-haiku-5-5

Date 2026-11-08. Prism commit `2fd3c592`. pi 1.5.0. Route: by model. Thinking: medium.

**Verdict: inconclusive** (a harness solved fewer than two of three runs). Requests 30 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.789 (0.702–0.837) | 0.870 | 6 | 1/3 |
| pi 1.5.0 | 0.676 (0.655–0.687) | 0.804 | 4 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 6 | 58931 | 46498 | 12419 | 0.789 | no |
| prism | 2 | ok | 4 | 25951 | 18223 | 7718 | 0.702 | yes |
| prism | 3 | ok | 8 | 87468 | 73187 | 14263 | 0.837 | no |
| pi | 1 | ok | 4 | 13535 | 9296 | 4229 | 0.687 | yes |
| pi | 2 | ok | 4 | 15688 | 10270 | 5408 | 0.655 | yes |
| pi | 3 | ok | 4 | 13965 | 9443 | 4512 | 0.676 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
