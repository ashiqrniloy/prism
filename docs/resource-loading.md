# Resource loading

## What it does

Resource helpers decode text, JSON objects, binary payloads, and Prism manifests through a caller-provided `ResourceLoader`.

APIs:

- `loadBinaryResource()`
- `loadTextResource()`
- `loadJsonResource()`
- `loadManifestResource()`
- `ResourceLoader`, `Resource`, `ResourceLoadContext`

## When to use it

Use these helpers when a host already has a resource loader and wants small decoding helpers for prompts, skills, manifests, binary attachments, or package resources.

Do not use them for filesystem access, network access, package discovery, URI routing, caching, trust policy, dynamic imports, or agent/session runtime startup. The host-provided loader owns all I/O and trust decisions.

## Inputs / request

```ts
loadBinaryResource(loader, uri, context?, options?)
loadTextResource(loader, uri, context?)
loadJsonResource(loader, uri, context?)
loadManifestResource(loader, uri, context?)
```

Inputs:

| Field | Type | Purpose |
| --- | --- | --- |
| `loader` | `ResourceLoader` | Host-owned loader called once for the requested URI. |
| `uri` | `string` | Resource identifier chosen by the host/package. |
| `context` | `ResourceLoadContext` | Optional abort signal and metadata forwarded to the loader. |
| `options` | `LoadBinaryResourceOptions` | Optional `maxItemBytes` override for `loadBinaryResource()`. |

## Outputs / response / events

- `loadBinaryResource()` returns `resource.data` or UTF-8 encoded `resource.text`, rejecting payloads above `maxItemBytes` (default `DEFAULT_MAX_MEDIA_ITEM_BYTES`).
- `loadTextResource()` returns `resource.text` or decodes `resource.data` with `TextDecoder`.
- `loadJsonResource()` parses text as JSON and returns a JSON object.
- `loadManifestResource()` parses a JSON object and validates it with `parsePrismManifest()`.
- No events are emitted and no registries are modified.

## Request/response example

```json
{
  "uri": "package://demo/prism.manifest.json",
  "resource": {
    "mediaType": "application/json",
    "text": "{\"name\":\"demo-package\"}"
  }
}
```

## Implementation example

```ts
import { loadBinaryResource, loadManifestResource, loadTextResource, type ResourceLoader } from "@arnilo/prism";

const loader: ResourceLoader = {
  async load(uri, context) {
    context?.signal?.throwIfAborted();
    if (uri.endsWith("prism.manifest.json")) {
      return { uri, mediaType: "application/json", text: '{"name":"demo-package"}' };
    }
    if (uri.endsWith(".pdf")) {
      return { uri, mediaType: "application/pdf", data: pdfBytes };
    }
    return { uri, mediaType: "text/markdown", text: "Prompt text" };
  },
};

const bytes = await loadBinaryResource(loader, "package://demo/report.pdf");
const manifest = await loadManifestResource(loader, "package://demo/prism.manifest.json");
const prompt = await loadTextResource(loader, "package://demo/prompt.md");

console.log(bytes.byteLength, manifest.name, prompt);
```

## Extension and configuration notes

- Manifest `resources` entries can reference prompts, skills, manifests, and package resources by URI.
- Helpers do not choose a loader by URI scheme. Hosts can use contribution registries or their own routing when they need that.
- Helpers do not execute loaded text or imported modules. Package activation remains a host decision.
- `loadManifestResource()` only validates manifest data; it does not register manifest contributions.

## Security and performance notes

- The caller-provided loader owns URI trust, permissions, filesystem/network access, and credential boundaries.
- Node hosts can use `@arnilo/prism/node/trust` (`createPathTrustPolicy`) to guard filesystem paths. It resolves symlinks on the trusted root and target and rejects paths whose realpath escapes the root; missing roots or realpath errors fail closed.
- `loadBinaryResource()` enforces `ResourceLoadContext.permission` and a finite byte ceiling per call.
- Helpers call `loader.load()` once per helper call and do not cache, scan, list, watch, poll, or discover packages.
- JSON parsing fails closed for invalid JSON or non-object JSON.
- Do not put resolved credential values, tokens, headers, or executable code in loaded config, manifests, prompts, skills, or metadata.

## Related APIs

- [Multimodal content](multimodal-content.md): bounded `resolveMediaContentBlock()` and SSRF/MIME policy for URL/resource/binary sources.
- [Configuration and manifests](configuration-and-manifests.md): data-only manifests and manifest resource declarations.
- [Contribution registries](contribution-registries.md): host-owned registries can store resource loaders.
- [Public contracts](public-contracts.md): base `ResourceLoader`, `Resource`, and `ResourceLoadContext` contracts.

`ResourceLoadContext.permission` checks `resource:<uri>:load` before calling the loader. Prism still does no resource discovery, package discovery, or trust prompts; hosts own those decisions. See [Security/auth/trust](settings-auth-trust-security.md).
