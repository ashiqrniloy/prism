import { Ajv, type ValidateFunction } from "ajv";
import { DocumentsValidationError } from "./errors.js";
import type { DocModel, DocumentKind, DocumentModel, SheetModel, TableBlock } from "./types.js";

export type JsonSchema = Record<string, unknown>;

// --- Draft-07 Shared Block and Cell Definitions ---

const SHARED_DEFS: Record<string, JsonSchema> = {
  DocRun: {
    type: "object",
    properties: {
      text: { type: "string" },
      bold: { type: "boolean" },
      italic: { type: "boolean" },
      underline: { type: "boolean" },
      strikethrough: { type: "boolean" },
      code: { type: "boolean" },
      link: { type: "string", maxLength: 2048 },
    },
    required: ["text"],
    additionalProperties: false,
  },
  ListItem: {
    type: "object",
    properties: {
      text: { type: "string" },
      runs: {
        type: "array",
        items: { $ref: "#/$defs/DocRun" },
        maxItems: 1000,
      },
    },
    required: ["text"],
    additionalProperties: false,
  },
  DecimalCellValue: {
    type: "object",
    properties: {
      type: { const: "decimal" },
      value: {
        type: "string",
        pattern: "^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?$",
        maxLength: 128,
      },
    },
    required: ["type", "value"],
    additionalProperties: false,
  },
  DateCellValue: {
    type: "object",
    properties: {
      type: { const: "date" },
      value: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      },
    },
    required: ["type", "value"],
    additionalProperties: false,
  },
  DateTimeCellValue: {
    type: "object",
    properties: {
      type: { const: "datetime" },
      value: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$",
      },
    },
    required: ["type", "value"],
    additionalProperties: false,
  },
  FormulaCellValue: {
    type: "object",
    properties: {
      formula: { type: "string", pattern: "^=.*$", maxLength: 4096 },
      cachedValue: {
        type: ["string", "number", "boolean", "null"],
      },
    },
    required: ["formula"],
    additionalProperties: false,
  },
  CellValue: {
    anyOf: [
      { type: "string", maxLength: 100000 },
      { type: "number" },
      { type: "boolean" },
      { type: "null" },
      { $ref: "#/$defs/DecimalCellValue" },
      { $ref: "#/$defs/DateCellValue" },
      { $ref: "#/$defs/DateTimeCellValue" },
      { $ref: "#/$defs/FormulaCellValue" },
    ],
  },
  ChartSeries: {
    type: "object",
    properties: {
      name: { type: "string", maxLength: 256 },
      values: {
        type: "array",
        items: { type: "number" },
        maxItems: 10000,
      },
    },
    required: ["name", "values"],
    additionalProperties: false,
  },
  ChartData: {
    type: "object",
    properties: {
      categories: {
        type: "array",
        items: { type: "string", maxLength: 256 },
        maxItems: 10000,
      },
      series: {
        type: "array",
        items: { $ref: "#/$defs/ChartSeries" },
        maxItems: 100,
      },
    },
    required: ["categories", "series"],
    additionalProperties: false,
  },
  HeadingBlock: {
    type: "object",
    properties: {
      type: { const: "heading" },
      level: { type: "integer", minimum: 1, maximum: 6 },
      text: { type: "string", maxLength: 10000 },
      id: { type: "string", maxLength: 256 },
    },
    required: ["type", "level", "text"],
    additionalProperties: false,
  },
  ParagraphBlock: {
    type: "object",
    properties: {
      type: { const: "paragraph" },
      text: { type: "string", maxLength: 100000 },
      runs: {
        type: "array",
        items: { $ref: "#/$defs/DocRun" },
        maxItems: 5000,
      },
    },
    required: ["type"],
    additionalProperties: false,
  },
  ListBlock: {
    type: "object",
    properties: {
      type: { const: "list" },
      ordered: { type: "boolean" },
      items: {
        type: "array",
        items: {
          anyOf: [{ type: "string", maxLength: 10000 }, { $ref: "#/$defs/ListItem" }],
        },
        maxItems: 10000,
      },
    },
    required: ["type", "items"],
    additionalProperties: false,
  },
  TableBlock: {
    type: "object",
    properties: {
      type: { const: "table" },
      rows: { type: "integer", minimum: 0, maximum: 100000 },
      columns: { type: "integer", minimum: 0, maximum: 1000 },
      headers: {
        type: "array",
        items: { type: "string", maxLength: 1000 },
        maxItems: 1000,
      },
      cells: {
        type: "array",
        items: {
          type: "array",
          items: { $ref: "#/$defs/CellValue" },
          maxItems: 1000,
        },
        maxItems: 100000,
      },
    },
    required: ["type", "rows", "columns", "cells"],
    additionalProperties: false,
  },
  ImageBlock: {
    type: "object",
    properties: {
      type: { const: "image" },
      data: { type: "string" },
      mimeType: { type: "string", maxLength: 128 },
      alt: { type: "string", maxLength: 1024 },
      width: { type: "number", minimum: 0 },
      height: { type: "number", minimum: 0 },
      ref: { type: "string", maxLength: 1024 },
    },
    required: ["type"],
    additionalProperties: false,
  },
  PageBreakBlock: {
    type: "object",
    properties: {
      type: { const: "page-break" },
    },
    required: ["type"],
    additionalProperties: false,
  },
  ChartBlock: {
    type: "object",
    properties: {
      type: { const: "chart" },
      chartType: { type: "string", enum: ["bar", "line", "pie", "scatter"] },
      title: { type: "string", maxLength: 512 },
      data: { $ref: "#/$defs/ChartData" },
      alt: { type: "string", maxLength: 1024 },
      width: { type: "number", minimum: 0 },
      height: { type: "number", minimum: 0 },
    },
    required: ["type", "chartType", "data"],
    additionalProperties: false,
  },
  DocBlock: {
    anyOf: [
      { $ref: "#/$defs/HeadingBlock" },
      { $ref: "#/$defs/ParagraphBlock" },
      { $ref: "#/$defs/ListBlock" },
      { $ref: "#/$defs/TableBlock" },
      { $ref: "#/$defs/ImageBlock" },
      { $ref: "#/$defs/PageBreakBlock" },
      { $ref: "#/$defs/ChartBlock" },
    ],
  },
  ColumnWidth: {
    type: "object",
    properties: {
      column: { type: "integer", minimum: 0 },
      width: { type: "number", minimum: 0 },
    },
    required: ["column", "width"],
    additionalProperties: false,
  },
  FrozenPanes: {
    type: "object",
    properties: {
      rows: { type: "integer", minimum: 0 },
      columns: { type: "integer", minimum: 0 },
    },
    additionalProperties: false,
  },
  SheetData: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 256 },
      cells: {
        type: "array",
        items: {
          type: "array",
          items: { $ref: "#/$defs/CellValue" },
          maxItems: 16384,
        },
        maxItems: 1048576,
      },
      columnWidths: {
        type: "array",
        items: { $ref: "#/$defs/ColumnWidth" },
        maxItems: 16384,
      },
      frozenPanes: { $ref: "#/$defs/FrozenPanes" },
      numberFormats: {
        type: "object",
        additionalProperties: { type: "string", maxLength: 256 },
      },
    },
    required: ["name", "cells"],
    additionalProperties: false,
  },
  SlideLayout: {
    type: "string",
    enum: ["title", "title-and-content", "section-header", "two-column", "blank"],
  },
  SlideData: {
    type: "object",
    properties: {
      layout: { $ref: "#/$defs/SlideLayout" },
      title: { type: "string", maxLength: 1024 },
      subtitle: { type: "string", maxLength: 1024 },
      bullets: {
        type: "array",
        items: {
          anyOf: [{ type: "string", maxLength: 10000 }, { $ref: "#/$defs/ListItem" }],
        },
        maxItems: 1000,
      },
      notes: { type: "string", maxLength: 100000 },
      image: { $ref: "#/$defs/ImageBlock" },
      chart: { $ref: "#/$defs/ChartBlock" },
    },
    required: ["layout"],
    additionalProperties: false,
  },
};

// --- Per-Kind Schema Definitions ---

export const docModelSchema: JsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Prism Document Model (doc)",
  type: "object",
  properties: {
    kind: { const: "doc" },
    modelVersion: { type: "integer", minimum: 1 },
    title: { type: "string", maxLength: 1000 },
    metadata: { type: "object", additionalProperties: true },
    blocks: {
      type: "array",
      items: { $ref: "#/$defs/DocBlock" },
      maxItems: 50000,
    },
  },
  required: ["kind", "modelVersion", "blocks"],
  additionalProperties: false,
  $defs: {
    DocRun: SHARED_DEFS.DocRun,
    ListItem: SHARED_DEFS.ListItem,
    DecimalCellValue: SHARED_DEFS.DecimalCellValue,
    DateCellValue: SHARED_DEFS.DateCellValue,
    DateTimeCellValue: SHARED_DEFS.DateTimeCellValue,
    FormulaCellValue: SHARED_DEFS.FormulaCellValue,
    CellValue: SHARED_DEFS.CellValue,
    HeadingBlock: SHARED_DEFS.HeadingBlock,
    ParagraphBlock: SHARED_DEFS.ParagraphBlock,
    ListBlock: SHARED_DEFS.ListBlock,
    TableBlock: SHARED_DEFS.TableBlock,
    ImageBlock: SHARED_DEFS.ImageBlock,
    PageBreakBlock: SHARED_DEFS.PageBreakBlock,
    ChartSeries: SHARED_DEFS.ChartSeries,
    ChartData: SHARED_DEFS.ChartData,
    ChartBlock: SHARED_DEFS.ChartBlock,
    DocBlock: SHARED_DEFS.DocBlock,
  },
};

export const sheetModelSchema: JsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Prism Sheet Model (sheet)",
  type: "object",
  properties: {
    kind: { const: "sheet" },
    modelVersion: { type: "integer", minimum: 1 },
    title: { type: "string", maxLength: 1000 },
    metadata: { type: "object", additionalProperties: true },
    sheets: {
      type: "array",
      items: { $ref: "#/$defs/SheetData" },
      maxItems: 1000,
    },
  },
  required: ["kind", "modelVersion", "sheets"],
  additionalProperties: false,
  $defs: {
    DecimalCellValue: SHARED_DEFS.DecimalCellValue,
    DateCellValue: SHARED_DEFS.DateCellValue,
    DateTimeCellValue: SHARED_DEFS.DateTimeCellValue,
    FormulaCellValue: SHARED_DEFS.FormulaCellValue,
    CellValue: SHARED_DEFS.CellValue,
    ColumnWidth: SHARED_DEFS.ColumnWidth,
    FrozenPanes: SHARED_DEFS.FrozenPanes,
    SheetData: SHARED_DEFS.SheetData,
  },
};

export const deckModelSchema: JsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Prism Deck Model (deck)",
  type: "object",
  properties: {
    kind: { const: "deck" },
    modelVersion: { type: "integer", minimum: 1 },
    title: { type: "string", maxLength: 1000 },
    metadata: { type: "object", additionalProperties: true },
    slides: {
      type: "array",
      items: { $ref: "#/$defs/SlideData" },
      maxItems: 2000,
    },
  },
  required: ["kind", "modelVersion", "slides"],
  additionalProperties: false,
  $defs: {
    DocRun: SHARED_DEFS.DocRun,
    ListItem: SHARED_DEFS.ListItem,
    ImageBlock: SHARED_DEFS.ImageBlock,
    ChartSeries: SHARED_DEFS.ChartSeries,
    ChartData: SHARED_DEFS.ChartData,
    ChartBlock: SHARED_DEFS.ChartBlock,
    SlideLayout: SHARED_DEFS.SlideLayout,
    SlideData: SHARED_DEFS.SlideData,
  },
};

const SCHEMAS_BY_KIND: Record<DocumentKind, JsonSchema> = {
  doc: docModelSchema,
  sheet: sheetModelSchema,
  deck: deckModelSchema,
};

// --- Ajv Compilation and Caching ---

const ajv = new Ajv({
  allErrors: true,
  validateSchema: true,
  allowUnionTypes: true,
  addUsedSchema: false,
});

const compiledValidators = new Map<DocumentKind, ValidateFunction>();

function getValidator(kind: DocumentKind): ValidateFunction {
  let validator = compiledValidators.get(kind);
  if (!validator) {
    const schema = SCHEMAS_BY_KIND[kind];
    validator = ajv.compile(schema);
    compiledValidators.set(kind, validator);
  }
  return validator;
}

// --- Slice Key Aliases ---

const ALIAS_MAP: Record<string, string> = {
  "doc.heading": "HeadingBlock",
  heading: "HeadingBlock",
  "doc.paragraph": "ParagraphBlock",
  paragraph: "ParagraphBlock",
  "doc.list": "ListBlock",
  list: "ListBlock",
  "doc.table": "TableBlock",
  table: "TableBlock",
  "doc.image": "ImageBlock",
  image: "ImageBlock",
  "doc.page-break": "PageBreakBlock",
  "doc.pagebreak": "PageBreakBlock",
  pagebreak: "PageBreakBlock",
  "page-break": "PageBreakBlock",
  "doc.chart": "ChartBlock",
  chart: "ChartBlock",
  "doc.run": "DocRun",
  run: "DocRun",
  "doc.block": "DocBlock",
  block: "DocBlock",
  "sheet.sheet": "SheetData",
  "sheet.sheetdata": "SheetData",
  sheetdata: "SheetData",
  "sheet.cell": "CellValue",
  cell: "CellValue",
  cellvalue: "CellValue",
  decimal: "DecimalCellValue",
  date: "DateCellValue",
  datetime: "DateTimeCellValue",
  formula: "FormulaCellValue",
  "deck.slide": "SlideData",
  slide: "SlideData",
  slidedata: "SlideData",
  "deck.layout": "SlideLayout",
  layout: "SlideLayout",
};

function resolveDefKey(schemaDefs: Record<string, JsonSchema>, sliceName: string): string {
  if (schemaDefs[sliceName]) return sliceName;
  const alias = ALIAS_MAP[sliceName.toLowerCase()];
  if (alias && schemaDefs[alias]) return alias;
  // Case-insensitive fallback
  const lower = sliceName.toLowerCase();
  for (const key of Object.keys(schemaDefs)) {
    if (key.toLowerCase() === lower) return key;
  }
  throw new DocumentsValidationError(`unknown schema slice "${sliceName}"`);
}

function extractRefKeys(obj: unknown, refs: Set<string>): void {
  if (typeof obj !== "object" || obj === null) return;
  if (Array.isArray(obj)) {
    for (const item of obj) extractRefKeys(item, refs);
    return;
  }
  const record = obj as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === "$ref" && typeof value === "string") {
      const match = value.match(/^#\/\$defs\/([A-Za-z0-9_]+)$/);
      if (match) refs.add(match[1]);
    } else {
      extractRefKeys(value, refs);
    }
  }
}

function calculateDefsClosure(allDefs: Record<string, JsonSchema>, rootKeys: readonly string[]): Record<string, JsonSchema> {
  const collected = new Set<string>();
  const queue = [...rootKeys];

  while (queue.length > 0) {
    const key = queue.pop()!;
    if (collected.has(key)) continue;
    collected.add(key);
    const def = allDefs[key];
    if (!def) continue;

    const childRefs = new Set<string>();
    extractRefKeys(def, childRefs);
    for (const child of childRefs) {
      if (!collected.has(child) && allDefs[child]) {
        queue.push(child);
      }
    }
  }

  const result: Record<string, JsonSchema> = {};
  for (const key of collected) {
    result[key] = allDefs[key];
  }
  return result;
}

/**
 * Returns the full Draft-07 JSON Schema for the given document kind, or a
 * minimal dependency-closure schema for the requested slice(s).
 */
export function documentModelSchema(kind: DocumentKind, slice?: string | readonly string[]): JsonSchema {
  const baseSchema = SCHEMAS_BY_KIND[kind];
  if (!baseSchema) {
    throw new DocumentsValidationError(`unsupported document kind: ${String(kind)}`);
  }

  const defs = (baseSchema.$defs ?? {}) as Record<string, JsonSchema>;

  if (!slice || (Array.isArray(slice) && slice.length === 0)) {
    return structuredClone(baseSchema);
  }

  const sliceList = Array.isArray(slice) ? slice : [slice];
  const rootKeys = sliceList.map((s) => resolveDefKey(defs, s));
  const closureDefs = calculateDefsClosure(defs, rootKeys);

  const slicedSchema: JsonSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: `Prism Document Schema Slice (${kind}: ${rootKeys.join(", ")})`,
    $defs: closureDefs,
  };

  if (rootKeys.length === 1) {
    slicedSchema.$ref = `#/$defs/${rootKeys[0]}`;
  } else {
    slicedSchema.anyOf = rootKeys.map((key) => ({ $ref: `#/$defs/${key}` }));
  }

  return slicedSchema;
}

const CANONICAL_DECIMAL_REGEX = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function validateInvariants(model: DocumentModel): void {
  if (model.kind === "doc") {
    const doc = model as DocModel;
    for (let index = 0; index < doc.blocks.length; index += 1) {
      const block = doc.blocks[index];
      if (block.type === "table") {
        const table = block as TableBlock;
        if (table.cells.length !== table.rows) {
          throw new DocumentsValidationError(
            `table block at index ${index} declares ${table.rows} rows but contains ${table.cells.length} rows`,
          );
        }
        for (let r = 0; r < table.cells.length; r += 1) {
          const row = table.cells[r];
          if (row.length !== table.columns) {
            throw new DocumentsValidationError(
              `table block at index ${index} row ${r} declares ${table.columns} columns but contains ${row.length} cells`,
            );
          }
        }
      }
    }
  } else if (model.kind === "sheet") {
    const sheetModel = model as SheetModel;
    for (let s = 0; s < sheetModel.sheets.length; s += 1) {
      const sheet = sheetModel.sheets[s];
      for (let r = 0; r < sheet.cells.length; r += 1) {
        const row = sheet.cells[r];
        for (let c = 0; c < row.length; c += 1) {
          const cell = row[c];
          if (cell !== null && typeof cell === "object" && "type" in cell && cell.type === "decimal") {
            if (!CANONICAL_DECIMAL_REGEX.test(cell.value)) {
              throw new DocumentsValidationError(
                `sheet "${sheet.name}" cell at row ${r}, col ${c} has invalid decimal string "${cell.value}"`,
              );
            }
          }
        }
      }
    }
  }
}

/**
 * Validates untrusted input against the Prism Document Model Draft-07 schema
 * and structural invariants. Throws {@link DocumentsValidationError} on failure.
 */
export function validateDocumentModel(model: unknown): asserts model is DocumentModel {
  if (typeof model !== "object" || model === null || Array.isArray(model)) {
    throw new DocumentsValidationError("model must be a non-null object");
  }

  const candidate = model as Record<string, unknown>;
  const kind = candidate.kind;
  if (kind !== "doc" && kind !== "sheet" && kind !== "deck") {
    throw new DocumentsValidationError(`unknown document kind: "${String(kind)}" (must be "doc", "sheet", or "deck")`);
  }

  if (typeof candidate.modelVersion !== "number" || !Number.isSafeInteger(candidate.modelVersion) || candidate.modelVersion <= 0) {
    throw new DocumentsValidationError("modelVersion must be a positive safe integer");
  }

  const validator = getValidator(kind as DocumentKind);
  const valid = validator(model);
  if (!valid) {
    const firstError = validator.errors?.[0];
    const path = firstError?.instancePath || "root";
    const msg = firstError?.message || "schema validation failed";
    throw new DocumentsValidationError(`model validation failed at ${path}: ${msg}`);
  }

  validateInvariants(model as DocumentModel);
}
