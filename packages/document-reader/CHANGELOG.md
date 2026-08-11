# Changelog

## [0.0.28] - 2026-08-08

### Changed
- Released with exact 0.0.28 graph.

## [0.1.0] - 2026-08-09

### Changed
- Released with exact 0.1.0 graph.

## [0.1.6] - 2026-08-11

### Added
- Initial release: `createDocumentReader` — bounded PDF/Office literal-text extraction adapter for `@arnilo/prism-coding-agent`'s `createReadTool({ documentReader })` slot (plan 018 closeout `doc-reader`): magic-byte-gated format dispatch (PDF header; DOCX zip + `word/document.xml` marker), input/page/text caps with over-cap refusal, fail-closed optional peer loading (`pdf-parse`, `mammoth`; `ERR_PRISM_DOCUMENT_READER`), optional `SecretRedactor` at the extraction boundary, `DocumentReaderError` codes, frozen `DEFAULT/HARD` caps.
