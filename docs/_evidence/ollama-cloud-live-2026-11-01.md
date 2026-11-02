# Plan 206 Task 5 — Ollama Cloud live acceptance

Executed 2026-11-01 against `https://ollama.com` with the owner's `OLLAMA_API_KEY` read
from `~/.config/prism/live.env` (mode `0600`). No key value appears in this file, the run
log, or the evidence JSON.

## Run

```sh
PRISM_LIVE_ENV_FILE=/home/arn/.config/prism/live.env \
PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/ollama-cloud bun run test:live
```

Result: **1 suite ran, 0 skipped, 0 failed**; **13 passed, 0 skipped, 0 failed**, two files in
33.68 s. Report: `docs/_evidence/live-matrix-report.md`.

| leg | native | openai |
|---|---|---|
| text, leak scan | pass | pass |
| 2-turn tool loop, thinking replay | pass | pass |
| abort observed before first request | pass | pass |
| 3-turn prefix cache probe | pass (read 284 / 284) | pass (read 224 / 224) |
| structured output, pure JSON, no fence | pass | pass |
| unknown model → named error, no key leak | pass | pass |

Package legs: **3-turn `createAgent` kernel smoke passed** on the default route — tool call
echoed 7, the second turn read the tool result back, and a third image turn answered "red"
on `gemma4:31b`'s vision path. Leak assertions passed on every leg.

Models: `gemma4:31b` (default, text/vision/tools), `gpt-oss:20b` (thinking exemplar and
cache model). Usage observed: text 19 in / 3 out; tool loop 89 in / 15 out (64 cache-read)
then 128 in / 19 out (96 cache-read).

## Cost and balance

19 generation requests from the suite: 6 per route in the shared scenarios, 2
structured-output and 2 unknown-model per route, 3 in the kernel smoke. The abort legs send
no request. Balance before: session **100%**, weekly **98.40%**; after: session **99.66%**,
weekly **98.27%**, purchased credit 0. Well under the 50-request ceiling. Four diagnostic
probes during the session (fence and prompt investigations, ~10 requests) are counted
separately and are included in the after figure.

Cache probe: both routes report cache reads on a warm prefix (native 284, compat 224
tokens), so the route-level cache claim holds at the small-prefix scale as well as in
Task 3's 8 KiB probe.

## Two provider behaviours found and handled

1. **JSON fencing on the compat route.** `response_format` with a JSON schema was honoured,
   but the cloud still wrapped the answer in a ```` ```json ```` fence — measured on
   `gemma4:31b`. The native route already stripped it; the OpenAI-compatible route did not.
   Fixed in `src/provider.ts`: when `structuredOutput` is set, text deltas are buffered
   under the provider-kit 512 KiB cap and the fence is stripped once before `usage`/`done`.
   Pinned offline by `ollama_openai_route_strips_json_fence_for_structured_output` and live
   by `live_structured_output_is_pure_json_*`.
2. **Two shared live scenarios do not fit this service's wire.** With the shared
   schema-less prompt every measured model answers in prose asking for the schema, and an
   empty `messages` array is accepted rather than rejected. Both are provider-side, so the
   shared harness gained two optional route hooks — `structuredPrompt` and `errorModel` —
   threaded through `runProviderLiveScenarios` and `executeProviderLiveScenarios`
   (`liveScenarioStructuredOutput` takes `prompt`, `liveScenarioErrorResponse` takes
   `errorModel`). This row now runs the shared structured-output and error scenarios on both
   routes with a concrete prompt and an unknown model id (404 → named error), so **no
   scenario is skipped**; the interim package-local `live-wire.test.ts` was deleted. Pinned
   offline by `live_scenarios_use_per_route_structured_prompt_and_error_model` and documented
   in `docs/testing.md` (plan 183 amendment).

## Probe thresholds (Task 3, same day)

Recorded against the Task 3 thresholds rather than re-spent: both routes measured reuse
**1.00227** (> 0.5), **33 504** four-turn cache-read tokens vs pi's **25 088**, and median
warm text TTFT **726.62 ms** native / **716.59 ms** compat vs pi's **2 206.59 ms**. Full
evidence: `docs/_evidence/cache-probe/` and `docs/_evidence/206-task3-cache-parity.md`.

## Prompt sensitivity follow-up

A separate probe (`ollama-cloud-structured-prompt-probe-2026-11-01.ts`, output
`ollama-cloud-structured-prompt-2026-11-01.json`) varied only the prompt: the shared schema-less
instruction scored 0/4 on `gemma4:31b` + `gpt-oss:20b` (both answered "no schema provided" with the
schema on the wire), while three concrete phrasings scored 12/12; `kimi-k3`, outside the Free plan,
was refused 8/8 with 402. 28 requests; weekly usage 98.27% → 98.15%. The finding is in the
package README's Structured output section.

## Checks

- `bun test --timeout=0 src/__tests__/ollama-cloud.test.ts`: 18 passed.
- `bun x biome check packages/providers/ollama-cloud/src`: passed.
- `scan-secrets` over the new files: no finding (also asserted in-test by the leak scans).

## Not claimed

`/v1/messages` is not shipped and not tested live, per the Task 1 decision. Local
`ollama serve`, Ollama web tools, System One decisions, and cloud usage histograms remain
Further Actions.
