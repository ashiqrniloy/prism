# @arnilo/prism-document-reader

Optional bounded PDF/Office literal-text extraction adapter for the Prism coding `read` tool (plan 018 closeout `doc-reader`).

- Explicit activation: pass the reader to `createReadTool({ documentReader })`; no file-extension sniffing ever enables parsing.
- Bounded by construction: input byte cap, page cap, output text cap; oversize/over-page documents refuse with a documented error.
- Literal text only: PDF via the optional `pdf-parse` peer, DOCX via the optional `mammoth` peer (raw text extraction — no embedded-script execution, no macro evaluation, no external resource fetching).
- Fails closed: creation throws `DocumentReaderError` (`ERR_PRISM_DOCUMENT_READER`) when a selected format's peer parser is absent.

## Usage

```ts
import { createReadTool } from "@arnilo/prism-coding-agent";
import { createDocumentReader } from "@arnilo/prism-document-reader";

const reader = createDocumentReader({ maxBytes: 32 * 1024 * 1024, maxPages: 1000 }); // throws if pdf-parse/mammoth absent
const read = createReadTool(cwd, { documentReader: reader });
```

## Changelog

## [0.1.5] - 2026-08-11

### Added
- Initial release: `createDocumentReader` with magic-byte-gated PDF/DOCX dispatch, byte/page/text caps, fail-closed peer loading, optional `SecretRedactor` at the extraction boundary, and the additive `DocumentReader` slot in `@arnilo/prism-coding-agent`'s `createReadTool`.
