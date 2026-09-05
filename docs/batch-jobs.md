# Batch jobs

## What it does

`BatchJobsProvider` is the provider-neutral async batch contract (plan 061
Task 7): `submit` (requests + metadata → opaque job id), `status`, `cancel`, and
paged `results`, with a typed job-state union and a `pollBatch` backoff utility
exported standalone — core never loops or awaits completion for you. The
first-party adapter is [`createOpenAIBatchJobsProvider`](providers/openai.md)
(Files API JSONL upload + `/v1/batches` lifecycle). Offline conformance runs via
`runBatchJobsConformance` from `@arnilo/prism/testing/provider-conformance`.

## When to use it

Use it for large asynchronous workloads that tolerate 24-hour completion
windows — offline scoring, backfills, bulk classification. Do not use it as a
scheduler or an orchestration saga: the contract is standalone by decision
(integration with the workflows saga is deferred — see plan 061 Further
Actions). Interactive low-latency requests belong on the normal provider path.

## Inputs / request

| Call | Inputs | Meaning |
| --- | --- | --- |
| `submit` | `{ model, requests, metadata? }` | `requests` are provider-native `{ customId?, body: JsonObject }` items; bodies are opaque to the contract and inherit provider caps. |
| `status` | opaque job id | Current `BatchJob` snapshot (state union + provider counts + `raw`). |
| `cancel` | opaque job id | Best-effort cancellation; returns the transitioning job (`cancelling`). |
| `results` | job id + `{ cursor?, pageSize? }` | Page of per-request outcomes; cursor is an opaque continuation token. |
| `pollBatch` | provider + job id + `{ intervalMs?, backoffMultiplier?, maxIntervalMs?, maxAttempts? }` | Utility only — resolves on `completed`, throws typed on `failed`/`cancelled`/`expired`. |

Adapter options: `apiKey` (`CredentialValueSource` — resolved per call,
redacted from errors), `baseUrl`, `fetch` (fake transport for offline tests),
`headers`, `endpoint` (defaults to `/v1/chat/completions`),
`completionWindow` (defaults `24h`).

## Outputs / response / events

| Field | Type | Meaning |
| --- | --- | --- |
| `job.state` | `"queued" \| "running" \| "cancelling" \| "completed" \| "failed" \| "cancelled" \| "expired"` | Neutral union; adapters map provider states (OpenAI `validating`→`queued`, `in_progress`/`finalizing`→`running`, …). `isBatchJobTerminal` classifies. |
| `job.id` | `string` | Opaque provider id — the contract never parses or scopes it. |
| `job.requestCounts` | `{ total, completed, failed }?` | Provider progress counts. |
| `job.raw` | `JsonObject?` | Provider-native job fields, unmodified, for audits. |
| `result.items[n]` | `{ customId, response?, error?, raw? }` | Per-request outcome; per-item failures ride alongside a `completed` job. |

Failures throw `BatchJobsError` with a stable `code`: `empty_requests`,
`too_many_requests` (adapter cap `OPENAI_BATCH_MAX_REQUESTS` = 50,000, OpenAI's
documented limit), `unsupported_model` (via `assertBatchJobsSupported` when the
host checks `ModelCapabilities.batchJobs`), `job_not_found`, `invalid_cursor`,
`request_failed` (non-2xx, secret-redacted), `response_malformed`, and — from
`pollBatch` on terminal states — `job_failed`, `job_cancelled`, `job_expired`.

## Request/response example

```json
{ "input_file_id": "file-X123", "endpoint": "/v1/chat/completions", "completion_window": "24h" }
```

## Implementation example

```ts
import { createOpenAIBatchJobsProvider } from "@arnilo/prism-providers/openai";
import { pollBatch, runBatchJobsConformance } from "@arnilo/prism";
import { runBatchJobsConformance } from "@arnilo/prism/testing/provider-conformance";

const batch = createOpenAIBatchJobsProvider({ apiKey: process.env.OPENAI_API_KEY });
const job = await batch.submit({
  model: "gpt-4o-mini",
  requests: [{ customId: "doc-1", body: { messages: [{ role: "user", content: "summarize" }] } }],
});
// pollBatch is a plain utility — host owns scheduling and persistence:
const done = await pollBatch(batch, job.id, { intervalMs: 30_000, backoffMultiplier: 1.5, maxIntervalMs: 300_000 });
let cursor: string | null | undefined = null;
do {
  const page = await batch.results(done.id, { cursor });
  for (const item of page.items) { /* host owns per-item handling */ }
  cursor = page.nextCursor ?? null;
} while (cursor !== null);

// Offline conformance (fake transport, no network):
await runBatchJobsConformance({
  provider: createOpenAIBatchJobsProvider({ apiKey: "sk-test", fetch: fakeFetch }),
  maxRequests: 50_000,
  sample: { model: "gpt-4o-mini", requests: [{ body: { messages: [] } }] },
});
```

## Extension and configuration notes

- Implement `BatchJobsProvider` for other vendors; the contract is structural —
  no base class, no registry. Map your provider's states onto the neutral union
  and surface your raw job payload on `job.raw`.
- Models declare support with `capabilities.batchJobs`; hosts gate with
  `modelSupportsBatchJobs` / `assertBatchJobsSupported`, mirroring the
  embeddings/speech/image/video/moderation guard pattern.
- Workflow-saga integration (auto-submission from run failure recovery) is
  intentionally out of scope for v1 — see plan 061 Further Actions.

## Security and performance notes

- Job ids are opaque strings; results cursors are opaque continuation tokens
  (adapter: line offsets — never parsed as authorization).
- API keys resolve through the existing `CredentialValueSource` seam and are
  redacted from every thrown error; no new secret paths.
- All responses read through the bounded readers
  (`OPENAI_BATCH_MAX_RESPONSE_BYTES`, 256 MiB for JSONL downloads — batches are
  large by design); oversized payloads reject instead of buffering.
- One provider request per call; paging is client-side over the downloaded
  output/error file — no network per page boundary.
- Inputs, payloads, and raw files are never logged by core; error messages
  carry status and a redacted body only.

## Related APIs

- [Provider conformance](provider-conformance.md): `runBatchJobsConformance`
  and the offline conformance matrix.
- [Provider packages](provider-packages.md): subpath import rules for
  `@arnilo/prism-providers/openai`.
- [Multimodal content](multimodal-content.md): sibling one-shot modality
  contracts sharing the same capability-flag and guard pattern.
