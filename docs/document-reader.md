# Document reader (`@arnilo/prism-document-reader`)

## What it does

Optional bounded literal-text extraction for PDF and DOCX files, consumed by the coding `read` tool (plan 018 closeout `doc-reader`, 0.1.6). `createDocumentReader()` returns a `DocumentReader` that the host wires into `createReadTool(cwd, { documentReader })`; the read tool then extracts text from supported documents instead of falling back to the raw text page.

## When to use it

Use when coding agents must read PDF/Office files (specs, requirements docs, reports) as literal text. Do **not** use it when embedded content execution, macro evaluation, or external resource fetching is required — this adapter never does any of those by construction, and the optional peer parsers (`pdf-parse`, `mammoth`) are the only parsing code involved. Docker-less hosts that need document reads pair this with the network-free native sandbox backend (`@arnilo/prism-coding-security` `createNativeSandbox`) for the surrounding tool execution.

Activation is explicit: no file-extension sniffing anywhere enables parsing. Absent `documentReader` option = exactly the 0.1.5 read behavior.

## Inputs / request

`createDocumentReader(options?)`:

| Option | Meaning | Default | Ceiling |
| --- | --- | --- | --- |
| `maxBytes` | Hard input size cap; oversize files refuse before loading | 32 MiB | 512 MiB |
| `maxPages` | Page cap for formats that report pages; over-page documents refuse | 1000 | 10 000 |
| `maxTextBytes` | Extracted-literal-text cap; over-cap results truncate (`truncatedBy: "bytes"`) | 2 MiB | 64 MiB |
| `parsers` | Host-selected `DocumentParser[]`; default wiring loads the optional peers | `[pdf, docx]` | — |
| `redactor` | Optional `SecretRedactor` applied to extracted text at the adapter boundary | none | — |

Format gating is magic-byte based: PDF header (`%PDF-`); DOCX zip container + `word/document.xml` part marker. Unsupported buffers return `null` and the read falls through to its text path.

## Outputs / response / events

`DocumentReader.extract({ buffer, path, signal })` resolves to `{ text, format, pages, truncatedBy }` or `null`. The read tool returns the text as a normal text content block with `metadata.document = { format, pages, truncatedBy }`.

Errors: `DocumentReaderError` with code `ERR_PRISM_DOCUMENT_READER` for missing peers (at creation), over-page/oversize refusal, and parser output beyond `maxTextBytes`. Invalid caps throw `RangeError` at creation.

## Request/response example

```ts
import { createReadTool } from "@arnilo/prism-coding-agent";
import { createDocumentReader } from "@arnilo/prism-document-reader";

const documentReader = await createDocumentReader({
  maxBytes: 32 * 1024 * 1024,
  maxPages: 1000,
  redactor: hostRedactor, // optional
});
const read = createReadTool(cwd, { documentReader });
```

A `read` of `spec.pdf` yields text content extracted from the PDF (up to 2 MiB of literal text) with `metadata.document = { format: "pdf", pages, truncatedBy }`.

## Implementation example

```ts
import { createDocumentReader, createPdfParser, type DocumentParser } from "@arnilo/prism-document-reader";

// Host-selected parser wiring: swap in a different PDF backend without touching bounds.
const myPdfParser: DocumentParser = {
  format: "pdf",
  detect: (buffer) => buffer.toString("latin1", 0, 5) === "%PDF-",
  extract: async (buffer, { maxPages, maxTextBytes }) => {
    // ... host parser (must honor caps, never fetch, never execute)
    return { text, pages, truncatedBy: null };
  },
};
const reader = await createDocumentReader({ parsers: [myPdfParser, await createPdfParser()] });
```

## Extension and configuration notes

- Default parser wiring uses the optional peer dependencies `pdf-parse` (PDF) and `mammoth` (DOCX raw text). Both are declared optional (`peerDependenciesMeta`); `createDocumentReader` fails closed with a documented error at creation when a selected format's peer is absent — never at read time. Hosts pin parser versions (their CVE surface is the host's responsibility; parser advisory is reviewed at ship time).
- DOCX has no page concept in raw text: `pages` is always `1` and the page cap applies to PDF only; the text cap governs DOCX output.
- The read tool re-checks `maxTextBytes` on results (parity with its text-page bounds check) and refuses reader output beyond it.
- The adapter truncates over-cap text at a UTF-8 byte boundary (never splits a code point).

## Security and performance notes

- No embedded-script execution, no macro evaluation, no external resource fetching — the peer raw-text surfaces are pure extractors, and the no-fetch property is enforced by an egress tripwire test.
- Decompression/size-bomb protection: the read tool stats and refuses files above `maxBytes` before loading; output is capped at `maxTextBytes`.
- Extraction envelope (recorded in `scripts/budgets.json` `docReader`, measured 2026-08-11): a max-cap 1000-page PDF (288 KB) extracts in ~162 ms with ~17 MB heap delta; the gate asserts completion within the ceiling or documented refusal.
- Parser code never receives a buffer whose format gate failed; random binaries never reach a parser.

## Related APIs

- `createReadTool` / `DocumentReader` / `DocumentReaderResult` (`@arnilo/prism-coding-agent`)
- `SecretRedactor` (`@arnilo/prism` redaction)
- `docs/_evidence/phase18-primitive-review.md` (doc-reader threat model D1–D8)
- `docs/coding-security.md` (native sandbox backend for surrounding execution containment)
