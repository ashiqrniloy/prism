# Diagramming, draw.io embed client, and mxGraph XML validation (`@arnilo/prism-office/diagrams`)

## What it does

The `@arnilo/prism-office/diagrams` package provides an origin-enforced draw.io / diagrams.net iframe embed client, XXE-safe mxGraph XML validation, and byte-stable deterministic XML canonicalization for content hashing and visual artifact workflows in Prism applications and agent runtimes.

### Core Capabilities

- **Origin-Enforced Embed Client**: `createDrawioEmbed({ iframe, origin })` establishes a typed, secure postMessage bridge between host applications and embedded draw.io editor iframes adhering to the diagrams.net `proto=json` embed protocol.
- **Dual Inbound Verification Boundary**: Inbound `message` events are verified against **both** the configured origin and `iframe.contentWindow` prior to JSON parsing. Foreign origins, rogue windows, and malformed frames are dropped immediately at the boundary.
- **Strict Outbound Target Enforcement**: Prohibits wildcard `targetOrigin: "*"` on all outbound actions. Every postMessage transmits exclusively to the exact validated origin.
- **No Public SaaS Default**: Construction requires an explicit, validated origin string (`https://` or `http://`). No default fallback to public SaaS endpoints (`embed.diagrams.net`) exists; self-hosting is the documented deployment.
- **XXE & Billion-Laughs Defenses**: `validateDrawioXml` rejects DOCTYPE and ENTITY declarations up-front (`UNSAFE_XML_DECLARATION_PATTERN = /<!\s*(?:DOCTYPE|ENTITY)/i`) with `ERR_PRISM_DIAGRAMS_XXE`, and operates with XML parser entity and HTML entity expansion disabled under strict element, attribute, and byte caps.
- **Deterministic XML Canonicalization**: `canonicalizeDrawioXml` sorts element attributes lexicographically (`a-z`), standardizes double quotes and entity escaping, and normalizes insignificant whitespace while preserving document sequence, producing byte-identical outputs for SHA-256 content hashing.
- **Visio Format Exclusion (P12 Guard)**: Detects and rejects Microsoft Visio binary (`.vsd`) and OpenXML (`.vsdx`) inputs across all entrypoints with `ERR_PRISM_DIAGRAMS_UNSUPPORTED_FORMAT`.
- **Dependency-Free Telemetry Seam (P15)**: Pluggable `DiagramsTelemetry` interface emits `diagrams.validate` and `diagrams.canonicalize` spans tracking byte sizes, element/cell counts, and durations without leaking diagram contents or node text.

## When to use it

Use `@arnilo/prism-office/diagrams` when applications, host workspaces, or autonomous agents need to:
1. Embed an interactive, self-hosted draw.io / diagrams.net editor inside a web or Electron iframe with strictly enforced cross-origin security.
2. Coordinate diagram editing lifecycles (`init` handshake, `load`, `save`, `autosave`, `merge`, and `export`).
3. Execute save-with-preview workflows generating SVG (`xmlsvg`) or PNG (`xmlpng`) visual snapshots from the active editor session.
4. Validate untrusted agent-generated or user-uploaded mxGraph XML models against structural and memory boundaries before persistence.
5. Compute deterministic content hashes (`sha256(canonicalizeDrawioXml(xml))`) for version control, caching, and change detection.

Do **not** use this package for:
- Microsoft Visio format conversion (`.vsd` / `.vsdx` files are explicitly excluded and rejected per P12).
- Server-side headless diagram rendering without an editor instance (use headless browser automation or containerized export services).

## Inputs / request

### Primary Functions

| Function | Signature | Description |
| --- | --- | --- |
| `createDrawioEmbed` | `(options: DrawioEmbedOptions) => DrawioEmbed` | Creates an origin-enforced embed client bound to an iframe element or structural frame. |
| `validateDrawioXml` | `(xml: string \| Uint8Array, options?: DrawioXmlOptions) => DrawioModelSummary` | Validates mxGraph XML well-formedness, caps, and structure, extracting page/cell/edge metrics. |
| `canonicalizeDrawioXml` | `(xml: string \| Uint8Array, options?: DrawioCanonicalizeOptions) => string` | Produces byte-stable, attribute-sorted, whitespace-normalized XML for content hashing. |
| `validateDiagramsOrigin` | `(origin: unknown) => string` | Validates that an origin string is a valid `https:` or `http:` URL origin without paths, queries, hashes, or wildcards. |
| `assertNotVisio` | `(input: string \| Uint8Array) => void` | Asserts that input is not a Microsoft Visio file, throwing `DiagramsFormatError` if Visio signatures are detected. |

### Message & Options Types

```ts
export interface DrawioEmbedOptions {
  readonly iframe: DrawioEmbedFrame;
  readonly origin: string;
  readonly messageSource?: DrawioMessageSource;
  readonly onProtocolError?: (error: DiagramsProtocolError) => void;
  readonly defaultExportTimeoutMs?: number;
}

export interface DrawioLoadOptions {
  readonly xml: string;
  readonly autosave?: boolean;
  readonly saveAndExit?: boolean;
  readonly noSaveBtn?: boolean;
  readonly noExitBtn?: boolean;
  readonly title?: string;
}

export interface DrawioExportOptions {
  readonly format: "xml" | "xmlsvg" | "xmlpng" | "json" | "png" | "svg";
  readonly scale?: number;
  readonly border?: number;
  readonly xml?: string;
  readonly embedImages?: boolean;
  readonly timeoutMs?: number;
}

export interface DrawioXmlCaps {
  readonly maxBytes?: number;
  readonly maxElements?: number;
  readonly maxAttributes?: number;
}
```

### Capacity Limits and Defaults

| Cap | Default | Hard Ceiling | Description |
| --- | --- | --- | --- |
| `maxBytes` | 32 MiB (`33,554,432`) | 512 MiB (`536,870,912`) | Maximum input XML string or byte length. |
| `maxElements` | 100,000 | 500,000 | Maximum total XML element count in diagram tree. |
| `maxAttributes` | 500,000 | 2,000,000 | Maximum total XML attribute count across elements. |
| `defaultExportTimeoutMs` | 30,000 ms | Unlimited | Timeout waiting for editor export responses. |

## Outputs / response / events

### Error Hierarchy

All error classes extend `DiagramsError` and carry structured `ERR_PRISM_DIAGRAMS_*` error codes:

| Error Class | Code | Cause / Trigger |
| --- | --- | --- |
| `DiagramsOriginError` | `ERR_PRISM_DIAGRAMS_ORIGIN_INVALID` | Origin is empty, wildcard (`*`), malformed URL, or contains forbidden path/query/hash components. |
| `DiagramsProtocolError` | `ERR_PRISM_DIAGRAMS_PROTOCOL` | Inbound message failed JSON parsing, missing event discriminator, or postMessage issued without contentWindow. |
| `DiagramsXxeError` | `ERR_PRISM_DIAGRAMS_XXE` | XML input contains forbidden DOCTYPE or ENTITY declaration. |
| `DiagramsCapError` | `ERR_PRISM_DIAGRAMS_XML_CAP` | XML input exceeds byte length, total element count, or total attribute count caps. |
| `DiagramsXmlMalformedError` | `ERR_PRISM_DIAGRAMS_XML_MALFORMED` | XML input is truncated or violates XML well-formedness rules. |
| `DiagramsModelInvalidError` | `ERR_PRISM_DIAGRAMS_XML_INVALID_MODEL` | XML root is neither `<mxfile>` nor `<mxGraphModel>`. |
| `DiagramsFormatError` | `ERR_PRISM_DIAGRAMS_UNSUPPORTED_FORMAT` | Visio format (.vsd/.vsdx) detected in input (P12). |
| `DiagramsTimeoutError` | `ERR_PRISM_DIAGRAMS_TIMEOUT` | Export operation timed out waiting for editor response. |

### Output Types

```ts
export interface DrawioModelSummary {
  readonly pages: number;
  readonly cells: number;
  readonly edges: number;
  readonly width?: number;
  readonly height?: number;
  readonly compressed?: boolean;
}

export interface DrawioExportResult {
  readonly format: string;
  readonly data: string;
  readonly xml?: string;
  readonly bounds?: DrawioExportBounds;
}
```

## Request/response example

### Protocol Envelope (`proto=json`)

Inbound editor-to-host `message` event:
```json
{
  "event": "save",
  "xml": "<mxfile host=\"drawio.internal\"><diagram id=\"1\">...</diagram></mxfile>",
  "exit": false
}
```

Outbound host-to-editor action postMessage:
```json
{
  "action": "load",
  "xml": "<mxfile host=\"drawio.internal\"><diagram id=\"1\">...</diagram></mxfile>",
  "autosave": 1,
  "title": "System Architecture"
}
```

## Implementation example

```ts
import { createDrawioEmbed, validateDrawioXml, canonicalizeDrawioXml } from "@arnilo/prism-office/diagrams";

// 1. Initialize embed client with strict origin binding
const embed = createDrawioEmbed({
  iframe: document.getElementById("drawio-frame") as HTMLIFrameElement,
  origin: "https://drawio.internal.example",
  onProtocolError(error) {
    console.error("Protocol error:", error.message);
  },
});

// 2. Register typed event listeners
embed.on("init", () => {
  const initialXml = `<mxfile host="drawio.internal"><diagram id="d1" name="Architecture"><mxGraphModel dx="800" dy="600"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Core Agent" vertex="1" parent="1"><mxGeometry x="100" y="100" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;
  embed.load({ xml: initialXml, autosave: true });
});

embed.on("save", async ({ xml, exit }) => {
  // Validate model before persisting
  const summary = validateDrawioXml(xml);
  console.log(`Validated diagram with ${summary.cells} cells and ${summary.edges} edges`);

  // Compute canonical hash for content-addressed storage
  const canonical = canonicalizeDrawioXml(xml);
  console.log("Canonical XML ready for persistence");

  if (exit) {
    console.log("Editor exit requested by user");
  }
});

embed.on("autosave", ({ xml }) => {
  console.log("Draft autosaved:", xml.length, "bytes");
});

// 3. Save-with-preview flow: export SVG snapshot
const preview = await embed.export({ format: "xmlsvg" });
console.log("Exported preview format:", preview.format, "data:", preview.data.slice(0, 40));
```

## Extension and configuration notes

### Self-Hosted draw.io Deployment

The recommended and supported deployment is a self-hosted instance of the Apache-2.0 `jgraph/drawio` container:

```bash
docker run -d -p 8080:8080 -e DRAWIO_SERVER_URL="http://localhost:8080" jgraph/drawio
```

Iframe embed URLs are formed with query parameters configuring json protocol mode:
```text
http://localhost:8080/?embed=1&proto=json&spin=1
```

### Decoupled Structural DOM Interface

`DrawioEmbedFrame` is typed structurally:
```ts
export interface DrawioEmbedFrame {
  readonly contentWindow: {
    postMessage(message: unknown, targetOrigin: string): void;
  } | null;
}
```
This enables use with vanilla DOM elements, React/Svelte/Vue refs, Electron webviews, and headless test doubles without requiring browser globals or `@types/dom`.

### OpenTelemetry Telemetry Seam

Pass an optional `DiagramsTelemetry` implementation to record spans without runtime overhead:
```ts
const summary = validateDrawioXml(xml, {
  telemetry: {
    startSpan(name, attributes) {
      // Maps to OTel tracer.startSpan("diagrams.validate", { attributes })
      // Diagram text and labels are NEVER passed to spans.
      return activeSpan;
    },
  },
});
```

## Security and performance notes

- **Trust Boundary Placement**: Origin and `event.source` checks execute inside the embed client before JSON parsing. Rogue cross-origin messages and foreign window messages are dropped without triggering listeners or error handlers.
- **Wildcard Prohibition**: `targetOrigin: "*"` is blocked at construction and runtime. Outbound messages are posted exclusively to the verified origin.
- **XXE Prevention**: DOCTYPE and ENTITY declarations are rejected up-front by regex pre-checks; `fast-xml-parser` is configured with entity expansion disabled.
- **Memory Caps**: Progressive limits on byte size, element counts, and attribute counts prevent XML decompression bombs and heap exhaustion.
- **Single-Pass Performance**: Canonicalization and validation process 1 MB XML models in under 10 ms.

## Related APIs

- [`@arnilo/prism-office/documents`](./documents.md): Specification-compliant OpenXML document generation and preview rendering for DOCX, XLSX, and PPTX.
- [`@arnilo/prism-office/sheets`](./sheets.md): Spreadsheet and CSV parsing engine with strict financial decimal safety guarantees.
- [`@arnilo/prism-web-tools/browser`](./browser-automation.md): Browser automation tools and quarantine lifecycle.
- [`@arnilo/prism-ag-ui`](./ag-ui.md): Agent-User Interface projection and timeline components.
- [`@arnilo/prism-core/governance/observability`](./observability.md): OpenTelemetry instrumentation and trace adapters.
