# Image generation and editing

## What it does

`ImageGenerationProvider` is the provider-neutral image contract: `generate`
(prompt→image[s] with size/format/quality/count options) and `edit`
(image+mask+prompt, reusing the existing `ImageContent` binary content parts).
Results are `Uint8Array` bytes plus provenance — hosts own persistence; no
disk writes, no URL-only contract. Adapters ship in
[`@arnilo/prism-providers/openai`](providers/openai.md) (`/v1/images/generations`,
`/v1/images/edits`, always `b64_json`) and
[`@arnilo/prism-providers/alibaba`](providers/alibaba.md) (DashScope wanx async
task API); offline conformance runs via `runImageGenerationConformance` from
`@arnilo/prism/testing/provider-conformance`.

## When to use it

Use it when the host owns image storage and lifecycle and wants portable
generate/edit calls with typed errors. Do not use it for image *input* to a chat
model — that is the existing `ImageContent` content part on
[`ModelConfig`](public-contracts.md) — and do not use the Alibaba adapter for
edits (DashScope has no first-party image-edit route; it rejects with
`unsupported_operation`).

## Inputs / request

| Field | Type | Meaning |
| --- | --- | --- |
| `model` | `string` | e.g. `gpt-image-1` (OpenAI), `wanx2.1-t2i-turbo` (DashScope). |
| `prompt` | `string` | Non-empty, within the provider cap (OpenAI 32,000 chars, wanx 800). |
| `images` / `mask` | `ImageContent[]` / `ImageContent?` (edit) | Base64 `data` parts decode inline; `url` parts resolve through `pinnedFetch` (SSRF-guarded, DNS-pinned, byte-bounded). |
| `size` / `format` / `quality` / `count` | `string?` / `string?` / `string?` / `number?` | Provider-defined vocabulary (`1024x1024`, `png`, `standard`/`hd`, 1–10 OpenAI / 1–4 wanx). |
| `signal` | `AbortSignal?` | Cancellation; observed by the adapter transport and the DashScope poll loop. |

Adapter options: `apiKey` (`CredentialValueSource` — the existing credential
seam, resolved per call and redacted from errors), `baseUrl`, `fetch` (inject a
fake transport for offline tests), `fetchUrl` (inject a result/input-image
downloader; defaults to `pinnedFetch`), `headers`, and `maxImageBytes`.

## Outputs / response / events

| Field | Type | Meaning |
| --- | --- | --- |
| `images` | `GeneratedImage[]` | One entry per generated image, in provider order. |
| `images[].bytes` | `Uint8Array` | Decoded image bytes (one allocation per image; no re-encode loops). |
| `images[].mimeType` | `string` | e.g. `image/png` (from the provider's `output_format` or the request format). |
| `images[].provider` / `.model` | `string` | Preserved provenance — hosts can attribute stored output. |
| `images[].url` / `.revisedPrompt` | `string?` | Provider-native passthrough when returned. |
| `usage` | `Usage?` | Provider-reported usage when available. |

Failures throw `ImageGenerationError` with a stable `code`: `empty_input`
(no prompt / edit without image parts), `input_too_large` (prompt or count over
cap, over-ceiling input image), `unsupported_operation` (edit on providers
without an edit route), `request_failed` (non-2xx, failed task, failed download,
secret-redacted message), `response_malformed` (missing `b64_json`, invalid
base64, no result URLs), `unsupported_model` (via `assertImageGenerationSupported`
when the host checks `ModelCapabilities.imageGeneration`).

## Request/response example

```json
{ "model": "gpt-image-1", "prompt": "a red cube", "size": "1024x1024", "n": 1, "response_format": "b64_json" }
```

## Implementation example

```ts
import { createOpenAIImageGenerationProvider } from "@arnilo/prism-providers/openai";
import { createAlibabaImageGenerationProvider } from "@arnilo/prism-providers/alibaba";
import { runImageGenerationConformance } from "@arnilo/prism/testing/provider-conformance";

const images = createOpenAIImageGenerationProvider({ apiKey: process.env.OPENAI_API_KEY });
const { images: generated } = await images.generate({ model: "gpt-image-1", prompt: "a red cube", size: "1024x1024" });
// generated[0] = { bytes: Uint8Array, mimeType: "image/png", provider: "openai", model: "gpt-image-1" }

const edited = await images.edit({
  model: "gpt-image-1",
  prompt: "make it blue",
  images: [{ type: "image", data: base64Png, mimeType: "image/png" }],
});

// DashScope wanx: submit + poll + download, wrapped in one call:
const alibaba = createAlibabaImageGenerationProvider({ apiKey: process.env.DASHSCOPE_API_KEY });
const wanx = await alibaba.generate({ model: "wanx2.1-t2i-turbo", prompt: "a red cube" });

// Offline conformance (fake transport, no network):
await runImageGenerationConformance({
  provider: createOpenAIImageGenerationProvider({ apiKey: "sk-test", fetch: fakeFetch }),
  model: "gpt-image-1",
  maxPromptChars: 32000,
  sample: { prompt: "a red cube", count: 1 },
});
```

## Extension and configuration notes

- Implement `ImageGenerationProvider` for other vendors; the contract is
  structural — no base class, no registry. Providers without an edit route
  reject `edit` with `ImageGenerationError("unsupported_operation")` rather
  than pretending.
- Models declare support with `capabilities.imageGeneration`; hosts gate with
  `modelSupportsImageGeneration` / `assertImageGenerationSupported`, mirroring
  the embeddings/speech guard pattern.
- The DashScope adapter owns the async-task lifecycle (submit with
  `X-DashScope-Async: enable`, poll until terminal status, download result
  URLs); `pollIntervalMs` and `timeoutMs` tune the loop, and the abort signal
  is honored between polls.

## Security and performance notes

- API keys resolve through the existing `CredentialValueSource` seam and are
  redacted from every thrown error (`redactSecrets`); no new secret paths.
- All URL fetches (edit inputs, DashScope result images) go through
  `pinnedFetch` — DNS-pinned, SSRF-guarded, byte-bounded (`maxImageBytes`,
  25 MiB default); responses over the ceiling reject instead of buffering.
- Prompts and image bytes are never logged; error messages carry status and a
  redacted body only. The contract never touches local disk — bytes return to
  the host.
- Base64 payloads decode exactly once per image; response mapping allocates
  per-image and nothing else.

## Related APIs

- [Multimodal content](public-contracts.md): `ImageContent` parts — the edit
  input vocabulary and the chat image-input path.
- [Provider conformance](provider-conformance.md): `runImageGenerationConformance`
  and the offline conformance matrix.
- [Provider packages](provider-packages.md): subpath import rules for
  `@arnilo/prism-providers/openai` and `@arnilo/prism-providers/alibaba`.
