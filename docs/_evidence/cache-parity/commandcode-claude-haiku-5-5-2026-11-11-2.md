# Cache parity: commandcode claude-haiku-5-5

Date 2026-11-11. Prism commit `24f589be`. pi 1.5.2. Route: by model. Thinking: medium.

**Verdict: pass**. Requests 31 of 120 (ceiling 20 per run).

| Harness | hitRate median (range) | first-turn-excluded | requests (median) | solved |
| --- | --- | --- | --- | --- |
| prism | 0.700 (0.694–0.874) | 0.869 | 4 | 3/3 |
| pi 1.5.2 | 0.675 (0.675–0.685) | 0.800 | 4 | 3/3 |

## Runs

| Harness | Run | Status | Requests | Prompt tokens | Cache read | Cache write | hitRate | Solved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| prism | 1 | ok | 11 | 114840 | 100387 | 14429 | 0.874 | yes |
| prism | 2 | ok | 4 | 26258 | 18232 | 8016 | 0.694 | yes |
| prism | 3 | ok | 4 | 25693 | 17973 | 7710 | 0.700 | yes |
| pi | 1 | ok | 4 | 14198 | 9579 | 4609 | 0.675 | yes |
| pi | 2 | ok | 4 | 13586 | 9309 | 4267 | 0.685 | yes |
| pi | 3 | ok | 4 | 14182 | 9568 | 4604 | 0.675 | yes |

- Metrics come from the wire proxy's usage log only; Prism's own usage events are cross-checked against it per request.
- The system prompt carries a per-run id (Prism: workspace AGENTS.md; pi: --append-system-prompt) so a prefix cached by an earlier run cannot score the first request.
- pi reached the proxy through COMMANDCODE_API_BASE and a scratch copy of its model catalog.
