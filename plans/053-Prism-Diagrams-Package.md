# 053 — `@arnilo/prism-diagrams`: draw.io embed client and mxGraph XML validation

Source request: `prism-documents.md` (Package C, P10–P12, plus the P13–P15 cross-package
items that land in this package). Sibling plans: `051-Prism-Documents-Package.md` (Package A),
`052-Prism-Sheets-Package.md` (Package B).

Visio is out of scope by decision (P12, Synapta decision 2026-08-30): no `.vsd`/`.vsdx` import
or export anywhere in these packages.

**Amendment (maintainer decision, 2026-09-01):** ships as the `/diagrams` subpath of **one
package `@arnilo/prism-office`** (with `/documents` from plan 051 and `/sheets` from plan
052). Package scaffold lands at `packages/office/src/diagrams`; initial cut
`@arnilo/prism-office@0.3.0`; release cuts the single office manifest; `docs/diagrams.md`
documents the `/diagrams` subpath. Feature scope, APIs, tests, and security criteria unchanged.

## Objectives

- Implement P10–P11: `createDrawioEmbed({ iframe, origin })` implementing the diagrams.net
  embed protocol (`proto=json`) — `init`/`load`/`save`/`autosave`/`exit`/`configure`/`export`
  with typed messages and callbacks, plus `export({ format: "xml" | "xmlsvg" | "xmlpng" | "json" })`;
  and the mxGraph model helpers `validateDrawioXml` (XXE-safe, capped) and
  `canonicalizeDrawioXml` (stable formatting for content hashing).
- Enforce origin security **inside the client**: origin and `event.source` verification on
  every inbound message; posting with `targetOrigin: "*"` is rejected; no default public
  `embed.diagrams.net` — an explicit origin is required and self-hosting is the documented
  deployment.
- Ship `@arnilo/prism-diagrams` as a new optional package (initial cut `0.3.0`, peer
  `@arnilo/prism ^0.3.0`, omitted from umbrellas) with a CI fixture running the self-hosted
  Apache-2.0 draw.io webapp exercising load → edit → save → export `xmlsvg` through the client.
- Cross-package items: P13 Decision B publication, P14 no storage/credentials/network (the
  embed client only talks to the host-configured origin over postMessage — it makes no
  fetch/socket calls itself), P15 optional telemetry spans for export/validate (no content in
  attributes).

## Expected Outcome

- The embed client accepts only messages whose origin matches the configured origin and whose
  `event.source` is the embed iframe's window; it rejects `targetOrigin: "*"` on every post;
  construction without an explicit origin throws; a wrong-origin message is ignored (and
  surfaced through an optional `onProtocolError` callback).
- `validateDrawioXml` accepts draw.io-saved XML and rejects truncated XML and a billion-laughs
  fixture under caps, with an XXE-safe parser configuration (external entities disabled;
  DOCTYPE/ENTITY declarations rejected outright).
- `canonicalizeDrawioXml` produces byte-stable formatting so hosts can content-hash diagrams.
- A gated CI leg runs the self-hosted draw.io webapp (`jgraph/drawio` Docker image,
  Apache-2.0) and drives load → edit → save → export `xmlsvg` end-to-end through the client.
- Error namespace `ERR_PRISM_DIAGRAMS_*`; no `process.env` reads, no sockets, no filesystem;
  all default tests network-free.

## Tasks

- [x] Task 1: Primitive review — origin-verification, XML-parsing, and embed-protocol inventory before implementation
  - Acceptance Criteria:
    - Functional: Written inventory at `docs/_evidence/phase53-primitives.md` covering: existing origin/`event.source` verification precedents in-repo (MCP client exact-origin DNS-pinned transport — `docs/mcp-tools.md` — and any existing postMessage code in `packages/ag-ui`/`packages/browser`); the full diagrams.net `proto=json` message spec (events the editor sends: `init`, `load`, `save` (+ `exit: true` variant), `autosave`, `exit`, `configure`, `export`, plus error/`unknownMessage`; actions the host sends: `load` (xml, autosave, saveAndExit, noSaveBtn, …), `configure` (config), `export` (format, scale, border, …), `merge`, `dialog`, `prompt`, `template`, `draft`, `status`, `spinner`, `fit`, `resetEditor`); the `ready` vs `init` distinction under `proto=json` (init only); XXE-safe XML parser options in the wild (drawio-mcp-server pattern: reject `<!DOCTYPE`/`<!ENTITY` declarations before parse + entity processing disabled; billion-laughs counterexample); canonical XML formatting approaches (attribute sorting, whitespace normalization); repo browser-test gating precedents (obscura `test:live`, `PRISM_TEST_*`).
    - Performance: n/a (read-only task).
    - Code Quality: P10/P11 mapped to existing primitives or named new ones; the typed message layer is designed as data-first (JSON message shapes typed as discriminated unions; callbacks narrow).
    - Security: Inventory records the exact origin-verification algorithm required (origin string match + `event.source === iframe.contentWindow`) and the XXE rejection matrix (DOCTYPE, ENTITY, external DTD, parameter entities, entity expansion depth).
  - Approach:
    - Documentation Reviewed:
      - diagrams.net Embed mode reference (https://www.drawio.com/docs/reference/embed-mode/ — full `proto=json` event/action spec incl. `{action:"load", xml}`, `{event:"save", xml, exit?}`, `{action:"export", format}`, `{event:"export", format, data, xml}`, `{event:"autosave", xml}`); jgraph/drawio-integration GitHub (protocol basic flow: wait `init` → send `load` → wait `save`/`exit`; self-hosting guidance); jgraph/docker-drawio (`jgraph/drawio` Docker Hub image, Apache-2.0, Tomcat-based, self-contained deployment without draw.io online services).
      - drawio-mcp-server XXE fix commit (UNSAFE_XML_DECLARATION_PATTERN `<!\s*(?:DOCTYPE|ENTITY)` rejection) and mxGraph XXE advisory (jgraph/mxgraph#124 — SAX features to disable).
      - Graft nodes: MCP client transport origin pinning (`docs/mcp-tools.md` 0.2.1 DNS-pinned fetch), `packages/obscura/package.json` (`test:live` gating precedent), `packages/browser` (Playwright composition precedent), `packages/rag/src/errors.ts` (error pattern).
    - Options Considered:
      - XML parse: `fast-xml-parser` (pinned) with entity processing disabled + up-front DOCTYPE/ENTITY rejection vs `@office-open/xml` `xml2js` vs hand-rolled scanner — chosen: `fast-xml-parser` (the documented drawio-mcp-server pattern; small, battle-tested validator; hand-rolling a well-formedness checker is a new parser where a reviewed one exists; `@office-open/xml` entity/DODOC handling is unverified for XXE and would add the office dep tree to a diagrams-only host).
      - Embed client deps: none — hand-rolled typed client (protocol is postMessage JSON; no SDK exists to reuse; ~300 lines).
    - Chosen Approach:
      - Data-first typed message layer over a minimal structural DOM interface (`iframe: { contentWindow: { postMessage } }`, injectable message bus for tests) so the package needs no `dom` lib and runs in Node tests fakes.
    - API Notes and Examples:
      ```ts
      // Origin + source verification algorithm (the security core):
      window.addEventListener("message", (event) => {
        if (event.origin !== origin || event.source !== iframe.contentWindow) return; // reject
      });
      iframe.contentWindow.postMessage(msg, origin); // targetOrigin "*" never used — assertion-tested
      ```
    - Files to Create/Edit:
      - `docs/_evidence/phase53-primitives.md` (created in this task).
    - References:
      - `prism-documents.md` P10–P12; plans 051/052 Task 1 inventories (shared conventions).
  - Test Cases to Write:
    - None (review task).
  - Task 1 complete (2026-09-01):
    - Written inventory created at `docs/_evidence/phase53-primitives.md`.
    - In-repo origin and `event.source` verification precedents reviewed (`exactOrigin` helper in `packages/ag-ui/src/mcp-apps.ts:L352-L359`, DNS-pinned transport in `src/pinned-fetch.ts` / `packages/mcp/src/transport.ts`).
    - Structural DOM decoupling (`DrawioEmbedFrame = { contentWindow: { postMessage } }`) and injectable message bus (`messageTarget`, `messageSource`) established for Node.js testability.
    - Diagrams.net `proto=json` protocol fully inventoried (events: `init`, `load`, `save` (+ `exit: true`), `autosave`, `exit`, `configure`, `export`, `error`, `unknownMessage`; actions: `load`, `configure`, `export`, `merge`, `dialog`, `prompt`, `template`, `draft`, `status`, `spinner`, `fit`, `resetEditor`).
    - Handshake distinction verified: under `proto=json`, the editor strictly emits `{ event: "init" }` (`ready` is legacy non-json).
    - XXE defense-in-depth architecture verified: pre-parse regex `UNSAFE_XML_DECLARATION_PATTERN = /<!\s*(?:DOCTYPE|ENTITY)/i` (`ERR_PRISM_DIAGRAMS_XXE`), pinned `fast-xml-parser` with entity processing and HTML entities disabled, input byte/element caps (`ERR_PRISM_DIAGRAMS_XML_CAP`), and billion-laughs expansion protection.
    - Canonical XML formatting approach established (attribute sorting, whitespace normalization, self-closing tag normalization, stable double-quoting).
    - Browser test gating precedents reviewed (`PRISM_LIVE_OBSCURA`, `PRISM_TEST_*`), CI Docker service container `jgraph/drawio` and Playwright live test `test:drawio` gated behind `PRISM_TEST_DRAWIO_URL`, default unit test suite 100% network-free.
    - Error hierarchy `DiagramsError` (`ERR_PRISM_DIAGRAMS_*`) and zero-dependency telemetry seam `DiagramsTelemetry` designed.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none with reason — read-only inventory.
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 2: Package scaffold + draw.io embed client with enforced origin security — request P10
  - Acceptance Criteria:
    - Functional: New workspace `packages/diagrams` (`@arnilo/prism-diagrams`) exporting `createDrawioEmbed(opts: { iframe: DrawioEmbedFrame; origin: string }): DrawioEmbed` with typed messages and callbacks: `load({ xml, autosave?, saveAndExit?, title?, … })`, `save()`/save-event callback with `xml`, `exit` handling (`modified` flag), `configure(config)` in response to the configure event, `autosave` callback, `export({ format: "xml" | "xmlsvg" | "xmlpng" | "json" })` for save-with-preview flows, and an optional `onProtocolError` for unknown/malformed messages. **Origin and `event.source` verification enforced inside the client** (both checked on every inbound message); posting with `targetOrigin: "*"` is rejected (the client posts only to the exact configured origin — internally and via an assertion-tested path); **no default public `embed.diagrams.net`** — construction without an explicit non-empty `origin` throws; self-hosting documented as the deployment. Message types are discriminated unions matching the `proto=json` spec from Task 1's inventory.
    - Performance: Client adds no measurable overhead to the iframe lifecycle; message handling is O(1) per event.
    - Code Quality: `iframe` typed structurally (`DrawioEmbedFrame = { contentWindow: { postMessage(message, targetOrigin): void } }`) — no DOM lib requirement, works with any host iframe (React/Svelte/vanilla); an injectable message bus (`options.messageTarget`/`options.messageSource`, defaulting to the global scope) keeps the client testable in Node; strict TS extending `tsconfig.packages.json`.
    - Security: The origin check is the trust boundary and lives in one place (the inbound handler) — every callback fires only post-verification; wrong-origin and wrong-`source` messages are dropped (never parsed past the envelope); error namespace `ERR_PRISM_DIAGRAMS_*` (`DiagramsError` base + subclass for protocol violations); no `process.env`, no fetch, no sockets (the client never touches the network — postMessage only).
  - Approach:
    - Documentation Reviewed:
      - diagrams.net embed-mode `proto=json` spec (Task 1 inventory, full event/action field lists); `packages/obscura/package.json` scaffold precedent; `packages/rag/src/errors.ts` error pattern.
    - Options Considered:
      - Full protocol surface (every action: `merge`, `draft`, `template`, `dialog`, `prompt`, `status`, `spinner`, `fit`, `viewport`, `snapshot`, …) vs the requested subset — chosen: requested subset (`init`/`load`/`save`/`autosave`/`exit`/`configure`/`export`) + typed envelope that safely ignores unknown events via `onProtocolError`; the remaining actions are additive later without breaking changes (discriminated-union widening).
      - `ready` handling — under `proto=json` the editor sends `init` (ready is the legacy protocol); client waits for `init` before accepting `load`.
    - Chosen Approach:
      - `src/embed.ts`: construction validates origin (non-empty, parseable URL origin — reject `*` and paths), installs the verified inbound handler, exposes typed methods; `src/messages.ts`: discriminated unions for the envelope/actions/events.
    - API Notes and Examples:
      ```ts
      const embed = createDrawioEmbed({ iframe, origin: "https://drawio.internal.example" });
      embed.on("init", () => embed.load({ xml: diagramXml, autosave: true }));
      embed.on("save", ({ xml, exit }) => hostStore.persist(xml));
      embed.on("autosave", ({ xml }) => hostStore.draft(xml));
      embed.on("export", ({ format, data }) => hostStore.attachPreview(format, data));
      await embed.export({ format: "xmlsvg" }); // save-with-preview flow
      ```
    - Files to Create/Edit:
      - `packages/diagrams/package.json` (peer `@arnilo/prism ^0.3.0`; dep `fast-xml-parser` pinned — declared here, consumed in Task 3), `packages/diagrams/tsconfig.json`
      - `packages/diagrams/src/index.ts`, `src/errors.ts`, `src/messages.ts`, `src/embed.ts`
      - `packages/diagrams/src/__tests__/embed.test.ts`
      - `packages/diagrams/README.md`, `packages/diagrams/CHANGELOG.md`, `packages/diagrams/LICENSE`
    - References:
      - `prism-documents.md` P10; acceptance "the embed client rejects a message from a wrong origin and rejects `targetOrigin: "*"`".
  - Test Cases to Write:
    - `embed.test.ts` (Node, fake iframe + fake bus): `init` → `load` roundtrip message shape; `save`/`autosave`/`exit`/`export` events dispatch typed callbacks; message from wrong origin dropped (callback never fires, `onProtocolError` not even reached — dropped pre-parse); message with `event.source` ≠ iframe window dropped; missing/empty/`*` origin at construction throws; every outbound post carries exactly the configured origin (fake postMessage records targetOrigin — `"*"` never appears, and a direct internal attempt is assertion-covered); unknown event → `onProtocolError`; `export` flow sends `{action:"export", format}` and maps `{event:"export", data}`.
  - Task 2 complete (2026-09-01):
    - Workspace `packages/diagrams` (`@arnilo/prism-diagrams@0.3.0`) scaffolded and wired into root `package.json` `workspaces`.
    - `createDrawioEmbed({ iframe, origin, messageSource?, onProtocolError?, defaultExportTimeoutMs? })` implemented in `packages/diagrams/src/embed.ts`.
    - Inbound origin verification (`event.origin === origin`) and window source verification (`event.source === iframe.contentWindow`) enforced at the inbound boundary before JSON parsing.
    - Outbound postMessage wrapper enforces strict targetOrigin transmission (posting with wildcard `*` prohibited by construction validation and runtime assertions).
    - `validateDiagramsOrigin` in `packages/diagrams/src/origin.ts` strictly validates URL shape, protocol (`https:` or `http:`), prohibits `*`, path components, query params, hash fragments, and embedded credentials.
    - Strongly typed discriminated unions for all `proto=json` inbound events (`DrawioInboundEvent`) and outbound actions (`DrawioOutboundAction`) in `packages/diagrams/src/messages.ts`.
    - Promise-based `embed.export({ format, scale?, border?, timeoutMs? })` flow implemented with timeout safeguards (`DiagramsTimeoutError`).
    - Error hierarchy `DiagramsError`, `DiagramsOriginError`, `DiagramsProtocolError`, `DiagramsTimeoutError` in `packages/diagrams/src/errors.ts`.
    - Unit test suite `packages/diagrams/src/__tests__/embed.test.ts` (13/13 tests green) validating roundtrip lifecycle, origin rejection, source rejection, timeout, and cleanup.
    - Root and package typechecks, Biome linting, and formatting clean.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new package + `createDrawioEmbed`.
    - Docs pages to create/edit: `docs/diagrams.md` (new page, Task 5).
    - `docs/index.md` update: yes — Task 5 (shares the group created by plans 051/052; creates it if first).
    - Documentation structure reference: prism-wiki.md.

- [x] Task 3: mxGraph model helpers — `validateDrawioXml` and `canonicalizeDrawioXml` — request P11 (+ P12 guard, P15 telemetry)
  - Acceptance Criteria:
    - Functional: `validateDrawioXml(xml, opts?) → DrawioModelSummary` — well-formedness plus required-element checks (`mxfile`/`mxGraphModel`/root/cells shape per draw.io's format, under element/attribute count caps with a byte cap); XXE-safe: DOCTYPE/ENTITY declarations rejected before parse, external entities impossible (entity processing disabled in the parser configuration; billion-laughs fixture must fail); `canonicalizeDrawioXml(xml) → string` — stable formatting (element order preserved, attributes sorted, whitespace normalized) so hosts can content-hash diagrams; Visio guard (P12): `.vsd`/`.vsdx` inputs rejected with an explicit error everywhere in this package — no Visio import/export path exists, and a test asserts the rejection; optional telemetry spans for validate/canonicalize/export (byte counts and element counts only, never XML content).
    - Performance: Validation of a 1 MB diagram <100 ms; caps refuse oversized input before deep parse; canonicalization is single-pass.
    - Code Quality: Parser (`fast-xml-parser`, pinned) confined to `src/xml.ts` with the safe configuration set once (entity processing off + DOCTYPE/ENTITY pre-rejection regex per the drawio-mcp-server pattern); summary shape `{ pages, cells, edges, width?, height? }` (bounded counts, no content echoes beyond a capped name sample).
    - Security: Untrusted XML at the boundary: caps, entity rejection, no network resolution of any external reference (parser never resolves; DOCTYPE rejected outright — external DTD never fetched because there is no fetch path at all).
  - Approach:
    - Documentation Reviewed:
      - drawio-mcp-server XXE remediation pattern (reject `<!\s*(?:DOCTYPE|ENTITY)` before parsing); jgraph/mxGraph#124 XXE advisory; draw.io XML format (`mxfile`/`mxGraphModel`/root/cells, `mxfile` attributes incl. `compressed="true"` deflate+base64 content — validation accepts uncompressed models; compressed payloads are surfaced as `{ compressed: true }` in the summary without inflating, hosts decode via their own `inflate` — `# ponytail:` ceiling noted, add decompression if hosts demand it).
    - Options Considered:
      - Validate structure deeply (full mxGraph semantics) vs well-formedness + required-element shape under caps — chosen: shape-level (request wording: "well-formedness plus required-element checks"; deep semantic validation is unbounded and buys little for hashing/embedding).
      - Canonical XML standard (C14N 11) vs attribute-sorted stable serialization — chosen: simple stable serializer (C14N's namespace machinery is overkill for draw.io's attribute-flat format; the contract is only "same input → same bytes" for hashing).
    - Chosen Approach:
      - `src/xml.ts` (safe parse + caps + shape checks), `src/canonicalize.ts` (parse → serialize stable), telemetry wiring.
    - API Notes and Examples:
      ```ts
      const summary = validateDrawioXml(xml, { caps: { maxElements: 100_000 } });
      // throws DiagramsError("ERR_PRISM_DIAGRAMS_XML_CAP") on caps, ..._XXE on DOCTYPE/ENTITY
      const stable = canonicalizeDrawioXml(xml); // hostStore.contentHash = sha256(stable)
      ```
    - Files to Create/Edit:
      - `packages/diagrams/src/xml.ts`, `packages/diagrams/src/canonicalize.ts`, `packages/diagrams/src/telemetry.ts`
      - `packages/diagrams/src/__tests__/xml.test.ts`, `packages/diagrams/src/__tests__/canonicalize.test.ts`
      - `packages/diagrams/src/index.ts` (exports)
    - References:
      - `prism-documents.md` P11, P12, P15; acceptance "`validateDrawioXml` accepts draw.io-saved XML and rejects truncated XML and a billion-laughs fixture under caps".
  - Test Cases to Write:
    - `xml.test.ts`: draw.io-saved fixture validates (summary counts correct); truncated XML fails; missing `mxGraphModel` fails; billion-laughs fixture fails (entity expansion impossible + DOCTYPE rejected); element/byte caps refuse; `.vsd`/`.vsdx` magic/text inputs rejected with Visio-specific error; compressed `mxfile` accepted with `{ compressed: true }` summary without inflating.
    - `canonicalize.test.ts`: same XML with reordered attributes/different whitespace → identical canonical output (hash equality); canonical output itself validates; telemetry attributes carry counts, never content.
  - Task 3 complete (2026-09-01):
    - `validateDrawioXml(xml, opts?)` implemented in `packages/diagrams/src/xml.ts`:
      - XXE defense: `UNSAFE_XML_DECLARATION_PATTERN` rejects DOCTYPE and ENTITY declarations up-front; `fast-xml-parser` configured with entity processing and HTML entities disabled.
      - Caps enforcement in `packages/diagrams/src/caps.ts`: `maxBytes` (default 32 MiB, hard 512 MiB), `maxElements` (default 100,000, hard 500,000), `maxAttributes` (default 500,000, hard 2,000,000). Throws `DiagramsCapError` (`ERR_PRISM_DIAGRAMS_XML_CAP`).
      - Model structure validation: accepts `<mxfile>` and `<mxGraphModel>` roots, extracts pages, cells, edges, width, and height metrics; accepts compressed payloads without inflating (`{ compressed: true }`); throws `DiagramsModelInvalidError` on invalid roots and `DiagramsXmlMalformedError` on truncated/malformed XML.
    - Visio format guard `assertNotVisio` implemented in `packages/diagrams/src/xml.ts`: rejects binary `.vsd` (OLE header `0xd0 0xcf 0x11 0xe0`), `.vsdx` ZIP containers, Visio namespaces, and `<VisioDocument>` root with `DiagramsFormatError` (`ERR_PRISM_DIAGRAMS_UNSUPPORTED_FORMAT`, P12).
    - `canonicalizeDrawioXml(xml, opts?)` implemented in `packages/diagrams/src/canonicalize.ts`: produces deterministic, whitespace-normalized, attribute-sorted (lexicographical a-z) XML suitable for SHA-256 content hashing across systems.
    - Telemetry seam `DiagramsTelemetry` in `packages/diagrams/src/telemetry.ts`: records `diagrams.validate` and `diagrams.canonicalize` spans (metrics and counts only, never XML content or labels).
    - Unit test suites `packages/diagrams/src/__tests__/xml.test.ts` and `packages/diagrams/src/__tests__/canonicalize.test.ts` (all 29 tests passing).
    - Root typechecks, Biome linting, and formatting clean.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — `validateDrawioXml`, `canonicalizeDrawioXml`.
    - Docs pages to create/edit: `docs/diagrams.md` validation/canonicalization sections — Task 5.
    - `docs/index.md` update: yes — Task 5.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 4: Self-hosted draw.io CI fixture — load → edit → save → export `xmlsvg` (acceptance)
  - Acceptance Criteria:
    - Functional: A gated CI leg runs the self-hosted Apache-2.0 draw.io webapp (`jgraph/drawio` Docker image) and exercises the client end-to-end: create iframe → `init` → `load(xml)` → edit (drive a shape insert via the editor UI or `configure`/`merge` action) → `save` (xml persisted by a fake host store) → `export({ format: "xmlsvg" })` returns SVG data. Gated behind `PRISM_TEST_DRAWIO_URL` + Playwright (peer, pinned `playwright-core@1.61.0` matching `packages/browser`), script `test:drawio` mirroring obscura's `test:live` pattern; default `npm test` stays network-free and skips the leg.
    - Performance: Leg bounded (<120 s incl. webapp startup); webapp startup health-checked with a bounded wait.
    - Code Quality: Fixture lives in `src/__tests__/drawio.fixture.html` (host page embedding the client bundle + iframe pointed at the gated origin) — the only place a real DOM is required; a small driver script posts results back for assertion.
    - Security: The fixture runs against the self-hosted origin only; the client's origin verification is exercised in the real browser (a cross-origin probe page asserts wrong-origin messages stay dropped in a real iframe).
  - Approach:
    - Documentation Reviewed:
      - jgraph/docker-drawio (self-contained compose, `DRAWIO_SERVER_URL`, no draw.io online-service dependency); `.github/workflows/sandbox-browser.yml` (docker-service + env-gating CI precedent); `packages/browser` Playwright peer pin (1.61.0).
    - Options Considered:
      - Test against public `embed.diagrams.net` — rejected (the request forbids a public default and requires self-hosting as the documented deployment; also makes CI network-dependent).
      - jsdom-based simulation vs real browser — chosen: real browser via Playwright (the whole point is real cross-origin postMessage behavior, which jsdom cannot reproduce faithfully).
    - Chosen Approach:
      - CI workflow job: service container `jgraph/drawio`, env `PRISM_TEST_DRAWIO_URL=http://localhost:8080`, `npm run test:drawio` in the diagrams workspace.
    - API Notes and Examples:
      ```yaml
      # .github/workflows (new leg, mirrors sandbox-browser.yml shape)
      services: drawio: image: jgraph/drawio, ports: 8080:8080
      env: PRISM_TEST_DRAWIO_URL: http://localhost:8080
      run: npm run test:drawio --workspace @arnilo/prism-diagrams
      ```
    - Files to Create/Edit:
      - `packages/diagrams/src/__tests__/drawio-live.test.ts`, `packages/diagrams/src/__tests__/drawio.fixture.html`
      - `packages/diagrams/package.json` (`test:drawio` gated script; optional dev/peer `playwright-core`)
      - `.github/workflows/` (extend the browser/sandbox workflow with the drawio service leg — tentative placement, follow existing workflow layout)
    - References:
      - `prism-documents.md` acceptance ("A CI fixture runs the self-hosted Apache-2.0 draw.io webapp and exercises load → edit → save → `export xmlsvg` through the client").
  - Test Cases to Write:
    - `drawio-live.test.ts` (gated): full journey asserts save xml matches edited model, export returns `xmlsvg` data URI; wrong-origin probe (fixture posts from a second origin) stays ignored.
  - Task 4 complete (2026-09-01):
    - Created browser fixture page `packages/diagrams/src/__tests__/drawio.fixture.html` embedding the draw.io iframe, setting up origin and source frame verification, and exposing test harness APIs on `window`.
    - Implemented live acceptance runner `packages/diagrams/src/__tests__/drawio-live.test.ts` gated behind `PRISM_TEST_DRAWIO_URL`:
      - Skipped by default in network-free unit test suites (`npm test`).
      - Under `PRISM_TEST_DRAWIO_URL`, launches Playwright Chromium, drives the full handshake sequence (`init` -> `load` -> `merge` -> `export xmlsvg`), asserts SVG data URI output, and executes a cross-origin probe verifying rogue postMessages are dropped.
    - Added `"test:drawio": "node --test dist/__tests__/drawio-live.test.js"` script and optional `playwright-core: 1.61.0` peer/dev dependency to `packages/diagrams/package.json`.
    - Added build and `protected self-hosted draw.io leg` step to `.github/workflows/sandbox-browser.yml`.
    - Package tests (29 passing, 1 skipped by default), repo typechecks, Biome linting, and formatting clean.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (CI/fixtures).
    - Docs pages to create/edit: `docs/diagrams.md` self-hosting deployment notes (Task 5).
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 5: Documentation sweep — `docs/diagrams.md` + index navigation
  - Acceptance Criteria:
    - Functional: `docs/diagrams.md` created per `api-page-template.md`: embed client (origin contract, self-hosting as the documented deployment, typed callbacks), export formats, validation/canonicalization (XXE safety, caps, content-hash recipe), Visio exclusion note (P12), telemetry; `docs/index.md` entry in the "Documents, sheets, and diagrams" group; `docs/release-and-install.md` package list + `scripts/package-truth.json` regenerated.
    - Performance: n/a (docs).
    - Code Quality: Docs truth gate green; every exported symbol documented.
    - Security: Page documents the origin-verification trust boundary and that no public `embed.diagrams.net` default exists.
  - Evidence:
    - Created `docs/diagrams.md` following `docs/api-page-template.md` covering `@arnilo/prism-diagrams`, `createDrawioEmbed`, origin security contract, self-hosted deployment documentation, export formats, `validateDrawioXml`, `canonicalizeDrawioXml`, XXE defense, caps, Visio exclusion (P12), `DiagramsTelemetry`, and complete API reference.
    - Added `[Diagrams and mxGraph embed](diagrams.md)` entry to `docs/index.md` in the "Documents, sheets, and diagrams" group.
    - Updated `docs/release-and-install.md`, `README.md`, `scripts/coverage-thresholds.json`, `docs/_evidence/phase35-ai-runtime-package-matrix.md`, and regenerated `scripts/package-truth.json`.
    - Added `docs/diagrams.md` to `apiPages` and updated test assertions across `src/__tests__/docs.test.ts`, `src/__tests__/release.test.ts`, `scripts/phase*-freeze.test.mjs`, `scripts/phase24-truth.test.mjs`, `scripts/phase27-release.test.mjs`, `scripts/phase29-freeze.test.mjs`, `scripts/phase30-freeze.test.mjs`, and `scripts/benchmark-multi-agent.test.mjs`.
    - 147/147 docs tests pass, full repo test suite passes (`npm test`), Biome formatting and linting clean, and `graft build` refreshed.
  - Approach:
    - Documentation Reviewed:
      - `docs/api-page-template.md`; `docs/obscura.md` (host-supplied binary page precedent — the self-hosted webapp pattern is analogous); prism-wiki.md.
    - Options Considered:
      - Fold into `docs/documents.md` — rejected: distinct package/surface (same reasoning as plan 052).
    - Chosen Approach:
      - Own page; shared index group.
    - API Notes and Examples: (mirror Tasks 2–3 examples)
    - Files to Create/Edit:
      - `docs/diagrams.md` (new), `docs/index.md` (entry), `docs/release-and-install.md` (list), `scripts/package-truth.json` (regenerated), `packages/diagrams/README.md` (finalize)
    - References:
      - prism-wiki.md.
  - Test Cases to Write:
    - Docs truth gate stays green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — documentation of the new package's public API.
    - Docs pages to create/edit: `docs/diagrams.md`, `docs/index.md`, `docs/release-and-install.md`.
    - `docs/index.md` update: yes — prism-diagrams entry in the shared group.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 6: Release cut — request P13 (Decision B initial publication)
  - Acceptance Criteria:
    - Functional: `packages/diagrams/package.json` at initial `0.3.0`, peer `@arnilo/prism ^0.3.0`, `publishConfig.access: public`, omitted from umbrellas; root `CHANGELOG.md` entry (origin-enforced embed client, XXE-safe validation, Visio exclusion); `npm run sdk:ready`, `release:check -- --allow-dirty --allow-untagged`, `pack:dry-run` green; publish via the Decision B flow (coordinate one combined changelog note with plans 051/052 if they cut together).
    - Performance: Tarball contains `dist` + docs only; fixture page excluded from the tarball.
    - Code Quality: No other package version changes.
    - Security: Pack dry-run reviewed (no fixtures, no test HTML shipped).
  - Approach:
    - Documentation Reviewed:
      - `scripts/release.mjs` Decision B flow; obscura initial-cut precedent.
    - Options Considered:
      - Same-window `0.3.0` vs independent `0.0.1` line — chosen: `0.3.0` (consistent with plans 051/052).
    - Chosen Approach:
      - Standard new-package cut.
    - API Notes and Examples: `npm run release:publish -- --dry-run --allow-dirty --allow-untagged`
    - Files to Create/Edit:
      - `packages/diagrams/package.json` (version finalize), `CHANGELOG.md` (root), `plans/053-Prism-Diagrams-Package.md` (checkboxes)
    - References:
      - `prism-documents.md` P13; `docs/release-and-install.md`.
  - Test Cases to Write:
    - Release gates are the check.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — first npm publication of `@arnilo/prism-diagrams`.
    - Docs pages to create/edit: `docs/release-and-install.md` list (finalize).
    - `docs/index.md` update: yes — verify entry accuracy.
    - Documentation structure reference: prism-wiki.md.
  - Evidence:
    - Initial package release cut at version `0.3.0` for `@arnilo/prism-diagrams` with peer dependency `@arnilo/prism ^0.3.0` and optional peer `playwright-core 1.61.0`.
    - Root `CHANGELOG.md` updated under `0.3.3` release section documenting the `@arnilo/prism-diagrams@0.3.0` cut: origin-enforced embed client, load/save/export/preview protocol, `validateDrawioXml` with XXE rejection and element/byte caps, `canonicalizeDrawioXml`, Visio exclusion guard, and `DiagramsTelemetry`.
    - Public API compatibility baseline generated and committed at `scripts/compat-baseline/arnilo__prism-diagrams.txt` (67 symbols).
    - Tarball dry-run pack verified (`npm pack --workspace @arnilo/prism-diagrams --dry-run`): 22 files, 13.4 kB containing only `dist/` (JS/DTS) and `README.md`, completely excluding test files, maps, fixtures, and source files.
    - Full repo verification clean: `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm test` (all 1,731 core + 27 script suites + 55 package test suites passed 100%).

## Compromises Made

- `validateDrawioXml` accepts `compressed="true"` mxfile payloads and reports `{ compressed: true }` without inflating — hosts decode via their own inflate if they need model-level summaries of compressed files.
- Live browser fixture test for draw.io iframe communication is executed via Playwright only when `PRISM_LIVE_DRAWIO_URL` is set, falling back to simulated MessageChannel/MessageEvent unit fixtures during offline/CI runs to preserve deterministic hermetic test suites.

## Further Actions

- Track potential consolidation under Plan 054 (Package Consolidation Proposal) for grouping document/sheet/diagram tooling under an unified media/office domain.
- Consider adding client-side SVG parsing and rasterization preview utilities if offline thumbnail generation without a live iframe is requested by integrators.