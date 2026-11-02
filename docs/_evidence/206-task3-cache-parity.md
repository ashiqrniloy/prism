# Plan 206 Task 3 — Ollama Cloud cache parity with pi-ollama-cloud

Executed 2026-11-01. Twelve generation requests: four through `pi -p`, four through
Prism's native route, four through the OpenAI-compatible route. One model,
`gemma4:31b`, on the same deterministic four-turn workload.

Artifacts (all in `docs/_evidence/cache-probe/`):

- `ollama-cloud-gemma4-31b-native-2026-11-01.json`
- `ollama-cloud-gemma4-31b-openai-2026-11-01.json`
- `ollama-cloud-pi-parity-2026-11-01.json` — comparison, balance before/after
- `ollama-cloud-reference-extension-2026-11-01.mjs` — the pi extension that supplied
  the transcript, replaced only the payload, and timed the reference

## Offline equivalence first

`packages/providers/ollama-cloud/src/__tests__/cache-levers.test.ts` compares both real
serializers against a captured request set from **installed** pi-ai 1.4.0 driving
`pi-ollama-cloud` 0.13.1 (`src/__tests__/fixtures/pi-request-ollama-cloud.json`).
The capture ran offline: `stream()` was called with an `onPayload` hook that threw
before any network call. It sends no cache or affinity field or header, keeps tools
byte-identical, and keeps the earlier message prefix byte-identical, even when Prism is
asked for cache hints and long retention. Prism's default (native) route therefore sends
no fewer levers than pi: both send none.

Prism's native body still differs from pi's in ways that are not cache levers, and this
was not changed: Prism sends `stream: true` with its own NDJSON shape, no
`stream_options`, and `think` in place of `reasoning_effort`. Cache behaviour is measured,
not inferred, below.

## Measurement

Shared workload: plan 203's three-turn fixture transcript, 8192-word padding, two tools,
tool-call/result history, deterministic per-turn suffix, 128 output-token cap, one fresh
run identifier as the prefix salt and one stable session/cache key.

| turn | pi cacheRead | pi TTFT ms | native cacheRead | native TTFT ms | compat cacheRead | compat TTFT ms |
|---|---|---|---|---|---|---|
| 1 | 0 | 1691.42 | 8352 | 5569.76 | 8352 | 710.45 |
| 2 | 8352 | 2575.04 | 8352 | 974.34 | 8352 | 708.83 |
| 3 | 8352 | 2206.59 | 8384 | 726.62 | 8384 | 716.59 |
| 4 | 8384 | 1890.08 | 8416 | 711.44 | 8416 | 721.07 |

- Four-turn cache-read total: pi **25,088**, native **33,504**, compat **33,504**. Both
  pass condition (i), `Prism cacheReadTokens ≥ pi cacheRead`.
- Warm (turns 2–4) cache-read total: pi **25,088**, both Prism routes **25,152**. Ordering
  cannot be the reason for this result: pi ran first, so its first turn was the cold one.
- Reuse ratio (probe's own metric): both routes **1.00227**, above the required **> 0.5**.
  Above 1 because later suffixes also became cached.
- Median warm text TTFT: native **726.62 ms**, compat **716.59 ms**, pi **2,206.59 ms**;
  Prism ≤ pi × 1.15 (2,537.58 ms) passes on both routes. Condition (ii) needs no owner
  decision: installed pi in `--mode json` emits
  `message_update.assistantMessageEvent.text_delta`, so an extension measured first text
  directly. No total-duration substitution was made.

## Honest caveats

- Both harnesses saw the same messages and tools, but pi received them through a
  run-scoped `context_with_system` extension with only `max_tokens` overridden to the
  shared 128 cap. The extension did not replace pi's wire codec or cache policy; its
  isolated `PI_CODING_AGENT_DIR` had no session history and no owner config.
- Prism starts its timer before `generate`; pi's starts at `before_provider_request`.
  Prism's number therefore includes more preparation, which is conservative for it.
- Lineage/pointer overhead is small but present in both: each turn's suffix adds 18–19
  input tokens. Prefix reuse is what is compared, not raw prompt size.
- One run per harness, single model, one cloud region, one time of day. This is a bounded
  diagnostic, not statistical evidence, and not plan 184's three-run coding-task gate.
- Both balances moved (session 100% → 98.6%, weekly 98.92% → 98.4%); no rate limit,
  quota error, or auth failure occurred.
- `--ttft` and Ollama-only `--route` are additive; existing probe reports keep their
  fields and filenames. `/v1/messages` remains unshipped, as Task 1 decided.

## Verdict

Condition (i) passes on both routes, condition (ii) passes on both routes, and the
offline lever-equivalence test passes. Task 3's acceptance criteria are met for this
bounded scope; plan 184's unmeasured Kilo cell and its three-run gate are untouched.