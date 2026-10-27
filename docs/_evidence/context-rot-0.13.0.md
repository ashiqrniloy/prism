# Context rot on 0.13.0

One model each on Hyper and OpenCode Go (the plan 183 matrix); Hyper needs `HYPER_API_KEY` and the manual `release/context-rot` job. Full method: [`scripts/context-rot/README.md`](../../scripts/context-rot/README.md).

| Model | Declared window | Effective input budget | With fold batch | Accuracy at 0 / budget | Evidence |
| --- | ---: | ---: | ---: | --- | --- |
| opencode-go/mimo-v2.5 | 1,000,000 | 96,000 | 96,000 | 100.0% / 100.0% | [`opencode-go-mimo-v2.5-2026-10-24`](context-rot/opencode-go-mimo-v2.5-2026-10-24.md) |

Pilot row: OpenCode Go ran one task per kind at five lengths and one repeat (3 of 30 tasks, 99 calls, 94.6% cache reads). The manual `release/context-rot` job runs all 30 tasks at three repeats for both providers; Hyper needs `HYPER_API_KEY`.
