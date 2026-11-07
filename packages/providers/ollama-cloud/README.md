# @arnilo/prism-provider-ollama-cloud

Ollama Cloud provider package for Prism. Registers the `ollama-cloud` provider, resolves its key
from an `env:`/`keyring:` ref per request, and serves hosted models from `https://ollama.com`.

```ts
import ollamaCloud from "@arnilo/prism-provider-ollama-cloud";
import { createAgent } from "@arnilo/prism";

const agent = await createAgent({
  model: "ollama-cloud/gemma4:31b",
  packages: [ollamaCloud({ apiKey: "env:OLLAMA_API_KEY" })],
});
```

The key is a ref, never a value. A ref that resolves to nothing records a `warn` status note and
registers the provider anyway; a run then fails with `credential_unavailable`.

## Routes

| Config | Wire | Use |
| --- | --- | --- |
| `route: "native"` (default) | `POST /api/chat` (NDJSON) | Text, tools, thinking, structured output, images; reports `prompt_eval_cached_count`. |
| `route: "openai"` | `POST /v1/chat/completions` (SSE) | The route `pi-ollama-cloud` uses; reports `prompt_tokens_details.cached_tokens`. |

A model's `compat.route` wins over the package `route`:

```ts
const compatModel = {
  provider: "ollama-cloud",
  model: "gemma4:31b",
  compat: { route: "openai" },
};
```

Native NDJSON lines are capped at 1 MiB. Structured-output replies are buffered to strip the
measured JSON fence, capped at 512 KiB; ordinary text streams without whole-response buffering.
Finishing or rejecting a stream cancels its reader.

The Anthropic Messages route is not shipped: Task 1 measured reuse there too, but the native route is
the measurable default and no reference harness uses `/v1/messages`.

## Prompt caching

Ollama's prompt cache is server-side and needs no request levers: the package sends no
`prompt_cache_key`, affinity header, or `cache_control` block, matching `pi-ollama-cloud` (which sends
none). Keep the prefix byte-stable; reuse is reported per route:

- native: `prompt_eval_cached_count / prompt_eval_count`
- OpenAI-compatible: `usage.prompt_tokens_details.cached_tokens`

`prompt_eval_duration`, `eval_duration`, and `load_duration` are absent on cloud; only
`total_duration` is present, under `usage.metadata.ollama.totalDurationNs`.

## Structured output

Both routes send the schema on the wire — native `format`, OpenAI-compatible `response_format`
(`json_schema`) — and both strip the single ```` ```json ```` fence the cloud adds, so a
caller receives bare JSON. That is a wire guarantee, not model obedience: the schema field alone does
not make these models emit JSON.

Measured on 2026-11-01 (native route, two reps per cell, `gemma4:31b` and `gpt-oss:20b`, same schema):

| Prompt | `gemma4:31b` | `gpt-oss:20b` |
| --- | --- | --- |
| "Reply with a JSON object matching the requested schema." | 0/2 JSON | 0/2 JSON (one asked for the schema, one refused) |
| "Return a JSON object with the single boolean key ok set to true." | 2/2 | 2/2 |
| schema restated inline in the prompt | 2/2 | 2/2 |
| `JSON only. {"ok":true}` | 2/2 | 2/2 |

So phrase the schema in the prompt as well as passing `structuredOutput`; a schema-less instruction
scores 0/4 while the three concrete phrasings score 12/12. A model outside the Free plan (`kimi-k3`) was
refused 8/8 with HTTP 402 "this model is not included in your free usage" (classified `permanent`),
so obedience there is unmeasured on a key without credits. Evidence:
`docs/_evidence/ollama-cloud-structured-prompt-2026-11-01.json`, produced by the committed
`docs/_evidence/ollama-cloud-structured-prompt-probe-2026-11-01.ts`.

## Plan limits

`ollamaCloudBalance()` reads `/api/balance`. Current plans report the monthly included credit
(`included`: USD left, allowance and period); legacy plans report session/weekly percentages and
reset times instead. Both carry the purchased balance. It is an explicit helper for hosts and
preflight checks and is never called during a run. It never returns or logs the key.

```ts
import { ollamaCloudBalance } from "@arnilo/prism-provider-ollama-cloud";

const balance = await ollamaCloudBalance({ apiKey: "env:OLLAMA_API_KEY" });
// current: { included: { balanceUsd, allowanceUsd, periodFrom, periodUntil }, purchasedUsd }
// legacy:  { session: { remainingPercent, resetsAt }, weekly: { remainingPercent, resetsAt }, purchasedUsd }
```

## Decision models

Models whose `/api/show` capabilities include `decision` (for example `clef:27b`) answer typed
questions in one pass over the System One wire at `/v1/systemone`, with the same key. Discovery maps
them to `capabilities.decisions: true` (no tools, no streaming, no reasoning), and the provider
serves them two ways:

- `prism.models.decisions("ollama-cloud/clef:27b")` (or `provider.decisions().decide(...)`) sends
  `noul`, `choice` and `score` questions and returns calibrated probabilities.
- A run on a decision model with JSON-schema structured output compiles the schema to questions on
  the same endpoint; without a schema the request is refused, as for every decision provider.

`defineOllamaCloudDecisionModel()` declares one statically. Decision models bill input tokens only.

## Discovery

`models()` calls `GET /api/tags` once, then `POST /api/show` per model with concurrency 4, mapping
capabilities, context window, and thinking levels. Cost is `1 + N` free metadata requests; pass a
static `models:` catalog in production to avoid it.

Every static and discovered model declares `limits.contextWindow` when `/api/show` provides one. A
model whose window is unknown is left undefined (never guessed) and named in `docs/live-testing.md`'s
live evidence when encountered.

## Thinking

`think` is derived from the model's declared `/api/show` values:

- boolean models (`[false,true]`): `none` → `false`, any other level → `true`;
- named-level models (`["low","medium","high"]`): the requested portable level is snapped to a
  declared name (`max` → `high` for `gpt-oss:20b`);
- `none` always maps to `false`; no requested level leaves the model default alone.

## Security

- The key is ref-only and resolved per request.
- Provider-owned `authorization`/`content-type` headers win over caller headers.
- Error bodies pass through `redactSecrets`.
- Ollama states that API inputs and outputs are not used to train models; see the
  [privacy policy](https://ollama.com/privacy).
