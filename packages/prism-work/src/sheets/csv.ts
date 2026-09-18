import { resolveSheetsCaps, validateByteCap } from "./caps.js";
import { SheetsCapError, SheetsFormatError } from "./errors.js";
import { inferAndTransformRows } from "./inference.js";
import type { CellValue, CsvDialect, CsvParse, InferenceWarning, ParseCsvOptions, ResolvedSheetsCaps } from "./types.js";

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"] as const;

/**
 * Sniffs the primary delimiter from a text sample by analyzing delimiter frequency and consistency outside quotes.
 */
function sniffDelimiter(text: string): string {
  const sample = text.slice(0, 4096);
  const lines = sample
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 50);

  if (lines.length === 0) {
    return ",";
  }

  let bestDelimiter = ",";
  let bestScore = -1;

  for (const candidate of CANDIDATE_DELIMITERS) {
    const lineCounts: number[] = [];

    for (const line of lines) {
      let count = 0;
      let inQuote = false;

      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuote = !inQuote;
        } else if (ch === candidate && !inQuote) {
          count += 1;
        }
      }
      lineCounts.push(count);
    }

    const nonZeroCounts = lineCounts.filter((c) => c > 0);
    if (nonZeroCounts.length === 0) continue;

    const avg = lineCounts.reduce((a, b) => a + b, 0) / lineCounts.length;
    const variance = lineCounts.reduce((sum, c) => sum + (c - avg) ** 2, 0) / lineCounts.length;

    // Higher score for delimiters present on all lines with consistent (low-variance) counts
    const consistencyRatio = nonZeroCounts.length / lineCounts.length;
    const score = (avg > 0 ? 1000 : 0) + consistencyRatio * 100 - variance;

    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = candidate;
    }
  }

  return bestDelimiter;
}

/**
 * Raw parsed token from the CSV state machine.
 */
interface RawToken {
  readonly value: string;
  readonly quoted: boolean;
}

/**
 * Fast RFC 4180 compliant finite state machine that parses a CSV string into raw token rows.
 */
function parseCsvRecords(
  text: string,
  delimiter: string,
  quote: string,
  escape: string | undefined,
  caps: ResolvedSheetsCaps,
): { rows: RawToken[][]; warnings: InferenceWarning[] } {
  const rows: RawToken[][] = [];
  const warnings: InferenceWarning[] = [];
  let currentRow: RawToken[] = [];
  let currentField = "";
  let inQuotes = false;
  let isQuotedField = false;

  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (escape && ch === escape && i + 1 < len) {
        currentField += text[i + 1];
        i += 2;
        continue;
      }

      if (ch === quote) {
        // RFC 4180 doubled quote check: "" inside "..." -> literal "
        if (i + 1 < len && text[i + 1] === quote) {
          currentField += quote;
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i += 1;
        continue;
      }

      currentField += ch;
      i += 1;
      continue;
    }

    // Outside quotes
    if (ch === quote && currentField.length === 0) {
      inQuotes = true;
      isQuotedField = true;
      i += 1;
      continue;
    }

    if (ch === delimiter) {
      if (currentRow.length + 1 > caps.maxColumns) {
        throw new SheetsCapError(`CSV row ${rows.length + 1} exceeds maxColumns cap (${caps.maxColumns})`);
      }
      currentRow.push({ value: currentField, quoted: isQuotedField });
      currentField = "";
      isQuotedField = false;
      i += 1;
      continue;
    }

    if (ch === "\r") {
      if (i + 1 < len && text[i + 1] === "\n") {
        i += 1;
      }
      if (currentRow.length + 1 > caps.maxColumns) {
        throw new SheetsCapError(`CSV row ${rows.length + 1} exceeds maxColumns cap (${caps.maxColumns})`);
      }
      currentRow.push({ value: currentField, quoted: isQuotedField });
      if (rows.length + 1 > caps.maxRows) {
        throw new SheetsCapError(`CSV input exceeds maxRows cap (${caps.maxRows})`);
      }
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
      isQuotedField = false;
      i += 1;
      continue;
    }

    if (ch === "\n") {
      if (currentRow.length + 1 > caps.maxColumns) {
        throw new SheetsCapError(`CSV row ${rows.length + 1} exceeds maxColumns cap (${caps.maxColumns})`);
      }
      currentRow.push({ value: currentField, quoted: isQuotedField });
      if (rows.length + 1 > caps.maxRows) {
        throw new SheetsCapError(`CSV input exceeds maxRows cap (${caps.maxRows})`);
      }
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
      isQuotedField = false;
      i += 1;
      continue;
    }

    currentField += ch;
    i += 1;
  }

  // Trailing record if input did not end with a newline
  if (currentField.length > 0 || isQuotedField || currentRow.length > 0) {
    if (currentRow.length + 1 > caps.maxColumns) {
      throw new SheetsCapError(`CSV row ${rows.length + 1} exceeds maxColumns cap (${caps.maxColumns})`);
    }
    currentRow.push({ value: currentField, quoted: isQuotedField });
    if (rows.length + 1 > caps.maxRows) {
      throw new SheetsCapError(`CSV input exceeds maxRows cap (${caps.maxRows})`);
    }
    rows.push(currentRow);
  }

  // Dialect validation: verify expected column count across rows
  if (rows.length > 1) {
    const expectedCols = rows[0].length;
    for (let r = 1; r < rows.length; r++) {
      if (rows[r].length !== expectedCols && warnings.length < caps.maxWarnings) {
        warnings.push({
          kind: "dialect-mismatch",
          message: `Row ${r + 1} has ${rows[r].length} fields (expected ${expectedCols})`,
          row: r + 1,
          mismatchCount: 1,
        });
      }
    }
  }

  return { rows, warnings };
}

/**
 * Maps a raw CSV token into a typed `CellValue`.
 */
function mapTokenToCellValue(token: RawToken): CellValue {
  if (!token.quoted && token.value === "") {
    return null;
  }
  if (token.quoted && token.value === "") {
    return "";
  }

  const str = token.value;

  if (!token.quoted) {
    const lower = str.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;

    // Pure integer
    if (/^-?\d+$/.test(str)) {
      const num = Number(str);
      if (Number.isSafeInteger(num)) {
        return num;
      }
      return { type: "decimal", value: str };
    }

    // Pure decimal number -> preserve string without float conversion
    if (/^-?\d+\.\d+$/.test(str)) {
      return { type: "decimal", value: str };
    }
  }

  return str;
}

/**
 * Parses a CSV document from string or Uint8Array with dialect sniffing and fail-closed bounds.
 *
 * @param input Raw CSV string or UTF-8 byte buffer.
 * @param options Caps, optional dialect overrides, and telemetry.
 * @returns Parsed CSV rows, schema, dialect, and warnings.
 */
export async function parseCsv(input: string | Uint8Array, options?: ParseCsvOptions): Promise<CsvParse> {
  const caps = resolveSheetsCaps(options?.caps);

  let text: string;
  let byteLength: number;

  if (typeof input === "string") {
    byteLength = Buffer.byteLength(input, "utf8");
    validateByteCap(byteLength, caps);

    // UTF-16 rejection
    if (input.startsWith("\uFFFE") || (input.length > 2 && input.charCodeAt(1) === 0 && input.charCodeAt(3) === 0)) {
      throw new SheetsFormatError("UTF-16 encoding is unsupported; input must be UTF-8 encoded");
    }

    // Strip UTF-8 BOM if present
    text = input.startsWith("\uFEFF") ? input.slice(1) : input;
  } else {
    byteLength = input.byteLength;
    validateByteCap(byteLength, caps);

    // UTF-16 BOM detection
    if (input.length >= 2) {
      if ((input[0] === 0xfe && input[1] === 0xff) || (input[0] === 0xff && input[1] === 0xfe)) {
        throw new SheetsFormatError("UTF-16 encoding is unsupported; input must be UTF-8 encoded");
      }
    }

    // Strip UTF-8 BOM (0xEF, 0xBB, 0xBF)
    let sliceStart = 0;
    if (input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
      sliceStart = 3;
    }

    const decoder = new TextDecoder("utf-8", { fatal: false });
    text = decoder.decode(input.subarray(sliceStart));
  }

  const span = options?.telemetry?.startSpan("sheets.parse", {
    "sheets.format": "csv",
    "sheets.bytes": byteLength,
  });

  try {
    if (text.trim() === "") {
      return {
        rows: [],
        schema: [],
        dialect: {
          delimiter: options?.dialect?.delimiter ?? ",",
          quote: options?.dialect?.quote ?? '"',
          escape: options?.dialect?.escape,
          hasHeader: false,
        },
        warnings: [],
      };
    }

    const delimiter = options?.dialect?.delimiter ?? sniffDelimiter(text);
    const quote = options?.dialect?.quote ?? '"';
    const escape = options?.dialect?.escape;

    const { rows: rawRows, warnings: parseWarnings } = parseCsvRecords(text, delimiter, quote, escape, caps);

    const mappedRows: CellValue[][] = rawRows.map((row) => row.map(mapTokenToCellValue));
    const { schema, rows: transformedRows, warnings: inferenceWarnings } = inferAndTransformRows(mappedRows, caps);

    const allWarnings: InferenceWarning[] = [...parseWarnings];
    for (const w of inferenceWarnings) {
      if (allWarnings.length < caps.maxWarnings) {
        allWarnings.push(w);
      }
    }

    const hasHeader = transformedRows.length > 1 && transformedRows[0].every((c) => typeof c === "string" && c.trim() !== "");

    const dialect: CsvDialect = {
      delimiter,
      quote,
      ...(escape ? { escape } : {}),
      hasHeader,
    };

    const maxCols = Math.max(...transformedRows.map((r) => r.length), 0);

    span?.setAttribute("sheets.sheetCount", 1);
    span?.setAttribute("sheets.rows", transformedRows.length);
    span?.setAttribute("sheets.columns", maxCols);

    return {
      rows: transformedRows,
      schema,
      dialect,
      warnings: allWarnings,
    };
  } catch (err) {
    span?.recordError();
    throw err;
  } finally {
    span?.end();
  }
}
