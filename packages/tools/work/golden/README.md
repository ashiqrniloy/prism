# Prism Documents Golden Files

This directory contains reference golden files and source models for `@arnilo/prism-documents`.

## Files

- `golden.doc.model.json` & `golden.docx`: Word document golden artifact.
- `golden.sheet.model.json` & `golden.xlsx`: Excel spreadsheet golden artifact with formulas and decimal strings.
- `golden.deck.model.json` & `golden.pptx`: PowerPoint presentation golden artifact with multi-slide layouts and speaker notes.

## Regeneration

Golden binary artifacts are deterministically reproducible directly from their JSON model sources without manual editing:

```bash
npx tsx src/__tests__/regen-golden.ts
```

## Office Compatibility Evidence

All three golden files are tested to:
1. Conform to the OOXML specification (ZIP container with spec-compliant XML parts).
2. Open cleanly in Microsoft Office (Word, Excel, PowerPoint) and LibreOffice without repair prompts.
3. Round-trip through `generateDocument` → `parseDocument` with structural model equality per `src/__tests__/equality.ts`.
