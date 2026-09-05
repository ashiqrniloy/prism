# Embeddings

## What it does

`EmbeddingsProvider` is the provider-neutral embeddings contract: one-shot batch
text→vector generation with usage accounting, per-item error mapping, and
capability-gated models. First-party adapters ship in
[`@arnilo/prism-providers/openai`](providers/openai.md) (OpenAI-compatible
`POST {base}/embeddings`) and [`@arnilo/prism-providers/alibaba`](providers/alibaba.md)
(DashScope `compatible-mode/v1/embeddings`); offline conformance runs via
`runEmbeddingsConformance` from `@arnilo/prism/testing/provider-conformance`.

## When to use it

Use it when a host owns its embedding pipeline (RAG ingestion, memory indexing,
semantic search) and wants a portable contract instead of per-provider HTTP code.
Do not use it as a live integration runner: the contract is caller-gated, adapters
perform no network on construction, and batch caps are enforced with typed errors
rather than silent auto-chunking — chunk callers themselves (for example,
`@arnilo/prism-memory`'s `embedBatched`).

## Inputs / request

| Field | Type | Meaning |
| --- | --- | --- |
| `model` | `string` | Embedding model id, e.g. `text-embedding-3-small` or `text-embedding-v4`. |
| `inputs` | `readonly string[]` | Texts to embed; order is preserved on `result.vectors`. Non-empty and within the provider batch cap. |
| `dimensions` | `number?` | Output-dimensions override; only for models that support reduced dimensions (OpenAI `dimensions` param, DashScope 64–2048). |
| `signal` | `AbortSignal?` | Cancellation; observed by the adapter transport. |

Adapter options: `apiKey` (`CredentialValueSource` — the existing credential seam,
resolved per call and redacted from errors), `baseUrl`/`preset` (Alibaba),
`fetch` (inject a fake transport for offline tests), `headers`, and default
`dimensions`/`encodingFormat` where the provider supports them.

## Outputs / response / events

| Field | Type | Meaning |
| --- | --- | --- |
| `vectors` | `readonly (readonly number[])[]` | Vectors in input order; `vectors[i]` corresponds to `inputs[i]`. |
| `usage` | `Usage` | Provider-reported token usage (`inputTokens`, `totalTokens`); empty object when the provider omits it. |
| `dimensions` | `number` | Actual vector dimensionality reported by the response. |

Failures throw `EmbeddingsError` with a stable `code`:
`empty_input` (no inputs), `batch_too_large` (over the provider cap — OpenAI 2048,
DashScope 10), `request_failed` (non-2xx, secret-redacted message),
`response_malformed` (missing index, wrong dimensionality), `unsupported_model`
(via `assertEmbeddingsSupported` when the host checks
`ModelCapabilities.embeddings`).

## Request/response example

```json
{ "model": "text-embedding-3-small", "input": ["hello", "world"], "dimensions": 256 }
```

## Implementation example

```ts
import { createOpenAIEmbeddingsProvider } from "@arnilo/prism-providers/openai";
import { runEmbeddingsConformance } from "@arnilo/prism/testing/provider-conformance";

const embeddings = createOpenAIEmbeddingsProvider({ apiKey: process.env.OPENAI_API_KEY });
const result = await embeddings.embedMany({
  model: "text-embedding-3-small",
  inputs: ["hello", "world"],
});
// result.vectors.length === 2; result.usage.inputTokens reported

// Offline conformance (fake transport, no network):
await runEmbeddingsConformance({
  provider: createOpenAIEmbeddingsProvider({ apiKey: "sk-test", fetch: fakeFetch }),
  model: "text-embedding-3-small",
  maxBatchSize: 2048,
  sample: { inputs: ["a", "b"], dimensions: 2 },
});
```

## Extension and configuration notes

- Implement `EmbeddingsProvider` (`{ id, embedMany }`) for other vendors; the
  contract is structural — no base class, no registry.
- Models declare support with `capabilities.embeddings`; hosts gate with
  `modelSupportsEmbeddings(capabilities)` / `assertEmbeddingsSupported(model)`,
  mirroring the structured-output guard pattern.
- `@arnilo/prism-memory` keeps its dependency-free `Embedder` host seam; adapters
  bridge structurally (`createAlibabaEmbedder` remains assignable to `Embedder`
  without importing it). The contract is a superset: it adds usage and per-item
  error mapping.
- Adapters never auto-chunk: a batch over the provider cap rejects with
  `batch_too_large`, so `embedBatched`-style callers own batching and preserve
  per-item error attribution.

## Security and performance notes

- API keys resolve through the existing `CredentialValueSource` seam and are
  redacted from every thrown error (`redactSecrets`); no new secret paths.
- Responses are read through the bounded transport (`readBoundedResponseJson` /
  `readBoundedResponseText`) — response bodies cannot exhaust memory.
- Input text is never logged; error messages carry status and redacted body only.
- One HTTP request per `embedMany` call; response mapping allocates one vector
  copy per input and nothing else. Per-item token caps are server-enforced;
  the local cap is batch count.

## Related APIs

- [`@arnilo/prism-memory`](working-and-semantic-memory.md): `Embedder` host seam and `embedBatched` —
  consumption side of the structural bridge.
- [Provider conformance](provider-conformance.md): `runEmbeddingsConformance` and
  the offline conformance matrix this contract joins.
- [Provider packages](provider-packages.md): subpath import rules for
  `@arnilo/prism-providers/openai` and `@arnilo/prism-providers/alibaba`.
