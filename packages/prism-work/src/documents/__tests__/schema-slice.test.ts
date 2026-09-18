import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Ajv } from "ajv";
import { DocumentsValidationError, deckModelSchema, docModelSchema, documentModelSchema, sheetModelSchema } from "../index.js";

describe("JSON Schema Draft-07 Definitions and Slicing", () => {
  const ajv = new Ajv({
    allErrors: true,
    validateSchema: true,
    allowUnionTypes: true,
  });

  it("compiles full doc, sheet, and deck schemas successfully", () => {
    assert.doesNotThrow(() => ajv.compile(docModelSchema));
    assert.doesNotThrow(() => ajv.compile(sheetModelSchema));
    assert.doesNotThrow(() => ajv.compile(deckModelSchema));
  });

  it("returns full schema when slice is omitted", () => {
    const fullDoc = documentModelSchema("doc");
    assert.equal(fullDoc.title, "Prism Document Model (doc)");
    const defs = fullDoc.$defs as Record<string, unknown>;
    assert.ok(defs.ParagraphBlock);
    assert.ok(defs.TableBlock);
    assert.ok(defs.HeadingBlock);
    assert.ok(defs.ChartBlock);
  });

  it("slices doc.paragraph returning only ParagraphBlock and DocRun in $defs closure", () => {
    const slice = documentModelSchema("doc", "doc.paragraph");
    assert.equal(slice.$ref, "#/$defs/ParagraphBlock");
    const defs = slice.$defs as Record<string, unknown>;

    // ParagraphBlock depends on DocRun
    assert.ok(defs.ParagraphBlock, "ParagraphBlock must be present");
    assert.ok(defs.DocRun, "DocRun must be present");

    // TableBlock, HeadingBlock, etc. should NOT be present in this slice closure
    assert.equal(defs.TableBlock, undefined, "TableBlock must be excluded");
    assert.equal(defs.HeadingBlock, undefined, "HeadingBlock must be excluded");
    assert.equal(defs.ChartBlock, undefined, "ChartBlock must be excluded");
    assert.equal(defs.SheetData, undefined, "SheetData must be excluded");

    // Standalone compilation succeeds without dangling references
    assert.doesNotThrow(() => ajv.compile(slice));
  });

  it("slices doc.table returning TableBlock and CellValue dependency closure", () => {
    const slice = documentModelSchema("doc", "doc.table");
    assert.equal(slice.$ref, "#/$defs/TableBlock");
    const defs = slice.$defs as Record<string, unknown>;

    assert.ok(defs.TableBlock);
    assert.ok(defs.CellValue);
    assert.ok(defs.DecimalCellValue);
    assert.ok(defs.DateCellValue);
    assert.ok(defs.DateTimeCellValue);
    assert.ok(defs.FormulaCellValue);

    assert.equal(defs.DocRun, undefined);
    assert.equal(defs.ChartBlock, undefined);

    assert.doesNotThrow(() => ajv.compile(slice));
  });

  it("slices multiple named blocks into anyOf with combined dependency closure", () => {
    const slice = documentModelSchema("doc", ["doc.heading", "doc.paragraph"]);
    assert.ok(Array.isArray(slice.anyOf));
    assert.equal(slice.anyOf.length, 2);
    assert.deepEqual(slice.anyOf, [{ $ref: "#/$defs/HeadingBlock" }, { $ref: "#/$defs/ParagraphBlock" }]);

    const defs = slice.$defs as Record<string, unknown>;
    assert.ok(defs.HeadingBlock);
    assert.ok(defs.ParagraphBlock);
    assert.ok(defs.DocRun);
    assert.equal(defs.TableBlock, undefined);

    assert.doesNotThrow(() => ajv.compile(slice));
  });

  it("slices sheet and deck models correctly", () => {
    const sheetSlice = documentModelSchema("sheet", "sheet.cell");
    assert.equal(sheetSlice.$ref, "#/$defs/CellValue");
    const sheetDefs = sheetSlice.$defs as Record<string, unknown>;
    assert.ok(sheetDefs.CellValue);
    assert.ok(sheetDefs.DecimalCellValue);
    assert.equal(sheetDefs.ColumnWidth, undefined);
    assert.doesNotThrow(() => ajv.compile(sheetSlice));

    const deckSlice = documentModelSchema("deck", "deck.slide");
    assert.equal(deckSlice.$ref, "#/$defs/SlideData");
    const deckDefs = deckSlice.$defs as Record<string, unknown>;
    assert.ok(deckDefs.SlideData);
    assert.ok(deckDefs.SlideLayout);
    assert.doesNotThrow(() => ajv.compile(deckSlice));
  });

  it("throws on unknown kind or unknown slice", () => {
    assert.throws(
      // @ts-expect-error test invalid kind
      () => documentModelSchema("unknown_kind"),
      DocumentsValidationError,
    );
    assert.throws(() => documentModelSchema("doc", "non_existent_definition"), DocumentsValidationError);
  });
});
