import { parseA1Cell, parseXlsx, XlsxReadContext } from "@office-open/xlsx";
import type { Element } from "@office-open/xml";
import { resolveSheetsCaps, validateByteCap, validateZipSignature } from "./caps.js";
import { SheetsCapError, SheetsError, SheetsParseError } from "./errors.js";
import { inferAndTransformRows } from "./inference.js";
import type {
  CellValue,
  FormulaCellValue,
  InferenceWarning,
  ParseWorkbookOptions,
  ResolvedSheetsCaps,
  SheetParse,
  WorkbookParse,
} from "./types.js";

/**
 * Extracts concatenated text content from an OpenXML Element tree.
 */
function extractText(el: Element | undefined): string {
  if (!el) return "";
  if (el.text !== undefined && el.text !== null) {
    return String(el.text);
  }
  if (!el.elements || el.elements.length === 0) {
    return "";
  }
  let result = "";
  for (const child of el.elements) {
    if (child.type === "text" || child.text !== undefined) {
      result += String(child.text ?? "");
    } else {
      result += extractText(child);
    }
  }
  return result;
}

/**
 * Extracts the shared strings table from OpenXML sharedStrings.xml (`<sst>`).
 */
function extractSharedStrings(sstElement: Element | undefined): string[] {
  if (!sstElement?.elements) return [];
  const strings: string[] = [];
  for (const child of sstElement.elements) {
    if (child.name === "si") {
      strings.push(extractText(child));
    }
  }
  return strings;
}

/**
 * Built-in standard ECMA-376 number format IDs that represent dates/times.
 */
const BUILT_IN_DATE_NUM_FMT_IDS = new Set<number>([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47]);

/**
 * Checks whether a number format code represents a date or datetime.
 */
function isDateFormatCode(code: string): boolean {
  // Strip quoted literal strings e.g. "Year" or \"
  const stripped = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
  // Check for common date/time format tokens
  return /\b(yy|yyyy|m|mm|d|dd|h|hh|ss|am\/pm)\b/i.test(stripped) || /[yYmMdDhHsS]/.test(stripped);
}

/**
 * Builds a Set of style `<xf>` indices that format cell values as dates.
 */
function extractDateStyleIndices(stylesElement: Element | undefined): Set<number> {
  const dateStyles = new Set<number>();
  if (!stylesElement?.elements) return dateStyles;

  // 1. Parse custom numFmts: id -> formatCode
  const customNumFmts = new Map<number, string>();
  const numFmtsElem = stylesElement.elements.find((e) => e.name === "numFmts");
  if (numFmtsElem?.elements) {
    for (const nf of numFmtsElem.elements) {
      if (nf.name === "numFmt" && nf.attributes) {
        const id = Number(nf.attributes.numFmtId);
        const code = String(nf.attributes.formatCode ?? "");
        if (!Number.isNaN(id) && code) {
          customNumFmts.set(id, code);
        }
      }
    }
  }

  // 2. Parse cellXfs: index -> isDate
  const cellXfsElem = stylesElement.elements.find((e) => e.name === "cellXfs");
  if (cellXfsElem?.elements) {
    let xfIndex = 0;
    for (const xf of cellXfsElem.elements) {
      if (xf.name === "xf" && xf.attributes) {
        const numFmtId = Number(xf.attributes.numFmtId ?? 0);
        if (BUILT_IN_DATE_NUM_FMT_IDS.has(numFmtId)) {
          dateStyles.add(xfIndex);
        } else if (customNumFmts.has(numFmtId)) {
          const code = customNumFmts.get(numFmtId)!;
          if (isDateFormatCode(code)) {
            dateStyles.add(xfIndex);
          }
        }
      }
      xfIndex += 1;
    }
  }

  return dateStyles;
}

/**
 * Converts an Excel serial date number to ISO-8601 date or datetime string.
 */
function excelSerialToIso(serial: number): { type: "date" | "datetime"; value: string } {
  // Excel epoch: 1900-01-01 is day 1, with the 1900 leap year bug
  const adjustedSerial = serial > 60 ? serial - 1 : serial;
  const msPerDay = 86400 * 1000;
  // Milliseconds from 1970-01-01 to 1900-01-01 is 2209161600000 (with day 1 offset: 2209161600000 - 86400000)
  const epochMs = Date.UTC(1899, 11, 31);
  const dateMs = epochMs + Math.round(adjustedSerial * msPerDay);
  const d = new Date(dateMs);

  const hasTime = serial % 1 !== 0;
  if (hasTime) {
    return { type: "datetime", value: d.toISOString() };
  }
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return { type: "date", value: `${yyyy}-${mm}-${dd}` };
}

/**
 * Maps an individual OpenXML `<c>` element to a strongly-typed `CellValue`.
 */
function parseCellElement(cellElem: Element, sharedStrings: readonly string[], dateStyles: ReadonlySet<number>): CellValue {
  const attributes = cellElem.attributes ?? {};
  const t = attributes.t ? String(attributes.t) : undefined;
  const s = attributes.s !== undefined ? Number(attributes.s) : undefined;

  // 1. Check for formula element <f>
  const fElem = cellElem.elements?.find((e) => e.name === "f");
  if (fElem) {
    const rawFormula = extractText(fElem).trim();
    const formulaStr = rawFormula.startsWith("=") ? rawFormula : `=${rawFormula}`;
    const vElem = cellElem.elements?.find((e) => e.name === "v");
    const cachedVal = vElem ? extractText(vElem) : null;
    const formulaCell: FormulaCellValue = {
      type: "formula",
      formula: formulaStr,
      cachedValue: cachedVal,
    };
    return formulaCell;
  }

  // 2. Shared String (t="s")
  if (t === "s") {
    const vElem = cellElem.elements?.find((e) => e.name === "v");
    const rawIdx = extractText(vElem).trim();
    const idx = Number.parseInt(rawIdx, 10);
    if (!Number.isNaN(idx) && idx >= 0 && idx < sharedStrings.length) {
      return sharedStrings[idx];
    }
    return rawIdx;
  }

  // 3. Inline String (t="inlineStr")
  if (t === "inlineStr") {
    const isElem = cellElem.elements?.find((e) => e.name === "is");
    return extractText(isElem);
  }

  // 4. String literal (t="str")
  if (t === "str") {
    const vElem = cellElem.elements?.find((e) => e.name === "v");
    return extractText(vElem);
  }

  // 5. Boolean (t="b")
  if (t === "b") {
    const vElem = cellElem.elements?.find((e) => e.name === "v");
    const vText = extractText(vElem).trim();
    return vText === "1" || vText.toLowerCase() === "true";
  }

  // 6. Error cell (t="e")
  if (t === "e") {
    const vElem = cellElem.elements?.find((e) => e.name === "v");
    return extractText(vElem);
  }

  // 7. Date cell (t="d")
  if (t === "d") {
    const vElem = cellElem.elements?.find((e) => e.name === "v");
    const vText = extractText(vElem).trim();
    return { type: "date", value: vText };
  }

  // 8. Numeric / Decimal (t omitted or t="n")
  const vElem = cellElem.elements?.find((e) => e.name === "v");
  if (!vElem) {
    return null;
  }

  const rawValueText = extractText(vElem).trim();
  if (rawValueText === "") {
    return null;
  }

  // Date style check on numeric serial
  if (s !== undefined && dateStyles.has(s)) {
    const serialNum = Number(rawValueText);
    if (!Number.isNaN(serialNum)) {
      return excelSerialToIso(serialNum);
    }
  }

  // Decimal-safety: parse raw text without float coercion
  if (/^-?\d+$/.test(rawValueText)) {
    // Pure integer string
    const intVal = Number(rawValueText);
    if (Number.isSafeInteger(intVal)) {
      return intVal;
    }
    return { type: "decimal", value: rawValueText };
  }

  if (/^-?\d+\.\d+$/.test(rawValueText)) {
    // Real decimal value -> preserve exact string
    return { type: "decimal", value: rawValueText };
  }

  // Fallback for exponential or other numeric formats
  return rawValueText;
}

/**
 * Parses an XLSX workbook binary buffer with strict cap validation and ZIP gating.
 *
 * @param bytes Raw XLSX archive bytes (`Uint8Array`).
 * @param options Caps and optional telemetry.
 * @returns Parsed workbook containing worksheets and warnings.
 */
export async function parseWorkbook(bytes: Uint8Array, options?: ParseWorkbookOptions): Promise<WorkbookParse> {
  const caps: ResolvedSheetsCaps = resolveSheetsCaps(options?.caps);

  // 1. Enforce byte cap before any processing
  validateByteCap(bytes.byteLength, caps);

  // 2. Enforce ZIP signature gating (PK\x03\x04)
  validateZipSignature(bytes);

  const span = options?.telemetry?.startSpan("sheets.parse", {
    "sheets.format": "xlsx",
    "sheets.bytes": bytes.byteLength,
  });

  try {
    // 3. Low-level archive unpack via @office-open/xlsx
    let doc: ReturnType<typeof parseXlsx>;
    try {
      doc = parseXlsx(bytes);
    } catch (err) {
      if (err instanceof SheetsError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new SheetsParseError(`failed to parse XLSX archive structure: ${message}`);
    }

    // 4. Enforce sheet count cap
    const worksheetPaths = doc.worksheets ?? [];
    if (worksheetPaths.length > caps.maxSheets) {
      throw new SheetsCapError(`workbook contains ${worksheetPaths.length} sheets, exceeding maxSheets cap (${caps.maxSheets})`);
    }

    const ctx = new XlsxReadContext(doc);
    const sharedStrings = extractSharedStrings(doc.sharedStrings);
    const dateStyles = extractDateStyleIndices(doc.styles);

    // 5. Match sheet names to part paths
    const sheetDefs: Array<{ name: string; path: string }> = [];
    const sheetsElem = doc.workbook?.elements?.find((e) => e.name === "sheets");
    if (sheetsElem?.elements) {
      for (const s of sheetsElem.elements) {
        if (s.name === "sheet" && s.attributes) {
          const name = String(s.attributes.name ?? `Sheet${sheetDefs.length + 1}`);
          const rId = String(s.attributes["r:id"] ?? "");
          const resolvedPath = rId ? ctx.resolveRelationship(rId) : undefined;
          const targetPath = resolvedPath ?? worksheetPaths[sheetDefs.length];
          if (targetPath) {
            sheetDefs.push({ name, path: targetPath });
          }
        }
      }
    }

    if (sheetDefs.length === 0) {
      worksheetPaths.forEach((path, idx) => {
        sheetDefs.push({ name: `Sheet${idx + 1}`, path });
      });
    }

    const resultSheets: SheetParse[] = [];
    const warnings: InferenceWarning[] = [];
    let totalRowCount = 0;
    let maxColumnCount = 0;

    // 6. Parse each worksheet
    for (const def of sheetDefs) {
      const wsElem = ctx.getPart(def.path);
      if (!wsElem) {
        resultSheets.push({ name: def.name, rows: [], schema: [] });
        continue;
      }

      const sheetDataElem = wsElem.elements?.find((e) => e.name === "sheetData");
      const rowElements = sheetDataElem?.elements?.filter((e) => e.name === "row") ?? [];

      if (rowElements.length > caps.maxRows) {
        throw new SheetsCapError(`worksheet "${def.name}" contains ${rowElements.length} rows, exceeding maxRows cap (${caps.maxRows})`);
      }

      const rows: CellValue[][] = [];

      for (let rIdx = 0; rIdx < rowElements.length; rIdx++) {
        const rowElem = rowElements[rIdx];
        const cellElements = rowElem.elements?.filter((e) => e.name === "c") ?? [];
        const rowCells: CellValue[] = [];

        for (const cElem of cellElements) {
          const rAttr = cElem.attributes?.r ? String(cElem.attributes.r) : undefined;
          let colIdx = rowCells.length;

          if (rAttr) {
            const parsedCoord = parseA1Cell(rAttr);
            if (parsedCoord) {
              colIdx = parsedCoord.col - 1;
            }
          }

          if (colIdx + 1 > caps.maxColumns) {
            throw new SheetsCapError(`worksheet "${def.name}" column index ${colIdx + 1} exceeds maxColumns cap (${caps.maxColumns})`);
          }

          // Expand sparse columns with null
          while (rowCells.length < colIdx) {
            rowCells.push(null);
          }

          const cellVal = parseCellElement(cElem, sharedStrings, dateStyles);
          rowCells[colIdx] = cellVal;
        }

        rows.push(rowCells);
        if (rowCells.length > maxColumnCount) {
          maxColumnCount = rowCells.length;
        }
      }

      totalRowCount += rows.length;
      const { schema, rows: transformedRows, warnings: sheetWarnings } = inferAndTransformRows(rows, caps);
      for (const w of sheetWarnings) {
        if (warnings.length < caps.maxWarnings) {
          warnings.push(w);
        }
      }
      resultSheets.push({
        name: def.name,
        rows: transformedRows,
        schema,
      });
    }

    span?.setAttribute("sheets.sheetCount", resultSheets.length);
    span?.setAttribute("sheets.rows", totalRowCount);
    span?.setAttribute("sheets.columns", maxColumnCount);

    return {
      sheets: resultSheets,
      warnings,
    };
  } catch (err) {
    span?.recordError();
    throw err;
  } finally {
    span?.end();
  }
}
