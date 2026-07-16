# Multimodal content

## What it does

Prism core ships generic `audio`, `file`, and `document` `ContentBlock` types plus bounded media resolution helpers. Blocks carry MIME type, optional name, and exactly one source: inline base64 `data`, remote `url`, or host `resourceUri`. Optional `transcript` metadata can accompany audio/document blocks.

`assembleProviderInput()` calls `assertMessagesSupportModelCapabilities()` so declared `ModelCapabilities.input` tags are enforced before provider calls. First-party provider packages map supported blocks locally; unsupported combinations fail closed with `UnsupportedModalityError` or an explicit provider error.

## When to use it

- **Host apps** attaching PDFs, audio clips, or generic files to user messages before a provider turn.
- **Resource loaders** returning binary payloads for `resourceUri` references under trust/permission policy.
- **Provider authors** reading truthful `ModelCapabilities.input` tags (`text`, `image`, `audio`, `file`, `document`) before mapping wire formats.

Do not embed provider upload IDs, tenant-scoped remote file IDs, or API-specific handles in core content blocks.

## Inputs / request

```ts
import {
  resolveMediaContentBlock,
  resolveMediaContentBlocks,
  assertSsrfAllowedUrl,
  type AudioContent,
  type FileContent,
  type DocumentContent,
} from "@arnilo/prism";

const file: FileContent = {
  type: "file",
  mediaType: "application/pdf",
  name: "report.pdf",
  data: base64Pdf,
};

const audio: AudioContent = {
  type: "audio",
  mediaType: "audio/wav",
  resourceUri: "package://demo/sample.wav",
  durationMs: 12_000,
};

await resolveMediaContentBlock(file, { bounds: { maxItemBytes: 10_000_000 } });
```

`ResolveMediaContentOptions` also exposes `ssrf`, `fetch`, `resolveHostname`, `requestUrl`, `loader`, `loadContext`, and `signal`. `MediaHostnameResolver`, `MediaHostAddress`, `MediaUrlRequester`, and `MediaUrlRequest` are exported for typed custom/test transports; ordinary callers need none of them.

Known `ModelCapabilities.input` tags are exported as `MODEL_INPUT_CAPABILITIES`:

| Tag | Block type | First-party mapping (declared capability required) |
| --- | --- | --- |
| `text` | `text` (default) | All providers |
| `image` | `image` | OpenAI Responses, OpenRouter, OpenCode Go Anthropic route, Kimi, NeuralWatt |
| `audio` | `audio` | OpenAI Responses (`input_audio`) |
| `file` | `file` | OpenAI Responses (`input_file`); Anthropic routes map PDF only |
| `document` | `document` | OpenAI Responses (`input_file`); OpenCode Go Anthropic route; Kimi |

## Outputs / response / events

- `resolveMediaContentBlock()` resolves one item and returns `{ mediaType, bytes, name?, durationMs?, transcript?, metadata? }`.
- `resolveMediaContentBlocks()` is the complete-request path: it rejects item count/inline estimates before I/O, resolves each item within its bound, then enforces exact aggregate decoded bytes.
- `assertModelSupportsContentBlocks()` / `assertMessagesSupportModelCapabilities()` throw `UnsupportedModalityError` when a declared capability list omits the block modality.
- `assertMediaBlocksWithinBounds()` enforces per-item bytes, total request bytes, item count, and audio duration ceilings.
- `assertSsrfAllowedUrl()` rejects loopback, private, link-local, unspecified, multicast, IPv4-mapped private, and metadata literals/hosts unless explicitly allow-listed.
- Default URL resolution performs one bounded `dns.lookup(..., { all: true })`, rejects the whole hostname if any answer is non-public, then pins the selected public address into `http.request()`/`https.request()` so a second DNS lookup cannot rebind the connection.
- `sniffMediaMimeType()` / `assertDeclaredMediaTypeMatches()` compare declared MIME types to magic bytes.
- No events are emitted and no provider calls occur in these helpers.

Default ceilings:

| Constant | Value |
| --- | --- |
| `DEFAULT_MAX_MEDIA_ITEM_BYTES` | 10 MB |
| `DEFAULT_MAX_MEDIA_REQUEST_BYTES` | 32 MiB |
| `DEFAULT_MAX_AUDIO_DURATION_MS` | 5 minutes |
| `DEFAULT_MEDIA_FETCH_TIMEOUT_MS` | 30 seconds |
| `DEFAULT_MAX_MEDIA_ITEMS_PER_REQUEST` | 32 items |

## Request/response example

```json
{
  "block": {
    "type": "file",
    "mediaType": "application/pdf",
    "name": "report.pdf",
    "resourceUri": "package://demo/report.pdf"
  },
  "resolved": {
    "mediaType": "application/pdf",
    "bytes": "<Uint8Array>",
    "name": "report.pdf"
  }
}
```

## Implementation example

```ts
import {
  assembleProviderInput,
  loadBinaryResource,
  resolveMediaContentBlock,
  UnsupportedModalityError,
} from "@arnilo/prism";

const loader = {
  async load(uri) {
    return { uri, mediaType: "application/pdf", data: pdfBytes };
  },
};

const bytes = await loadBinaryResource(loader, "package://demo/report.pdf");
const resolved = await resolveMediaContentBlock(
  { type: "document", mediaType: "application/pdf", resourceUri: "package://demo/report.pdf" },
  { loader },
);

try {
  await assembleProviderInput({
    model: { provider: "demo", model: "text-only", capabilities: { input: ["text"] } },
    input: [{ role: "user", content: [{ type: "file", mediaType: "application/pdf", data: "..." }] }],
  });
} catch (error) {
  if (error instanceof UnsupportedModalityError) {
    // Host-visible reject before provider HTTP.
  }
}
```

## Extension and configuration notes

- URL fetches use the DNS-classifying, address-pinned Node transport by default. `resolveHostname` and `requestUrl` are paired test/custom seams; `requestUrl` must connect to the supplied validated address while preserving the original URL hostname for HTTP Host/TLS verification.
- Supplying `fetch` is a trusted compatibility/custom-transport escape hatch: Prism still checks URL literals and host allow-lists, but the host-provided fetch owns DNS resolution, rebinding protection, redirects, proxies, TLS, auth, and logging.
- `resourceUri` resolution requires a caller-provided `ResourceLoader` and optional `ResourceLoadContext.permission` check.
- Local filesystem paths should use trust policies such as `createPathTrustPolicy()` before exposing URIs to loaders.
- Provider upload/create/delete lifecycles are provider-package-local. `@arnilo/prism-provider-openai` inlines files under 4 MiB as `data:<mediaType>;base64,...` `file_data`, otherwise uses a bounded per-run upload cache and best-effort `DELETE /v1/files` cleanup after each stream.
- Shared wire helpers live in `@arnilo/prism/providers/media` (`resolveProviderMediaMessages`, `serializeOpenAIResponsesInputFile`, `serializePdfDocumentWireBlock`, `createBoundedUploadCache`). OpenAI Responses, Kimi, and OpenCode Go Anthropic routes resolve their complete media collection once before serialization or upload.

## Security and performance notes

- SSRF deny-by-default blocks IPv4/IPv6 loopback, private/unique-local, link-local, unspecified, multicast, IPv4-mapped private, and cloud metadata targets. DNS answers are all classified before one public address is pinned; mixed public/private answers fail closed.
- `allowedHostnames` is an explicit trust override and may permit a private destination. `denyPrivateHosts: false` is broader and should be reserved for hosts that intentionally own private-network access.
- DNS lookup, connection, and body streaming share `fetchTimeoutMs` and caller abort; more than 32 resolved addresses, redirects, and oversized response bodies are rejected.
- MIME validation rejects common magic-byte spoofing; extensions alone are never trusted.
- Byte budgets use base64 size estimates before decode and re-check decoded bytes after every read/fetch. Complete-request resolution keeps at most the configured request budget plus one bounded item in memory and performs no provider upload/request until validation succeeds.
- Media errors omit raw bytes/base64 payloads from messages.
- Fetch readers are cancelled promptly after bound violations or abort signals.

## Related APIs

- [Input and prompt assembly](input-and-prompt-assembly.md): attachments and `assembleProviderInput()` capability checks.
- [Resource loading](resource-loading.md): `loadBinaryResource()` and text/JSON helpers.
- [Model registry](model-registry.md): `ModelCapabilities.input` metadata.
- [Provider conformance](provider-conformance.md): serialized request coverage for content blocks.
- [Persistence, credentials, and multimodality primitives](persistence-credentials-multimodality-primitives.md): Plan 056 inventory and threat model.
