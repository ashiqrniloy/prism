import { isCurrencyString, isScientificNotation, normalizeDecimal } from "./decimal.js";
import type { CellValue, ColumnSchema, ColumnType, InferenceWarning, ResolvedSheetsCaps } from "./types.js";

const MONEY_COLUMN_NAME_PATTERN =
  /(^|_|-|\b)(amount|price|cost|total|revenue|salary|fee|balance|rate|subtotal|tax|discount|payment|deposit|refund|gross|net)($|_|-|\b)/i;

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

interface ColumnStats {
  nullCount: number;
  totalCount: number;
  sample?: string;
  hasCurrency: boolean;
  hasScientific: boolean;
  hasMixedDecimalSeparator: boolean;
  typeCounts: Map<ColumnType, number>;
}

export interface InferAndTransformResult {
  readonly schema: readonly ColumnSchema[];
  readonly rows: readonly (readonly CellValue[])[];
  readonly warnings: readonly InferenceWarning[];
}

/**
 * Infers column types across a bounded sampling window and validates all rows against the inferred schema.
 *
 * @param rawRows 2D array of parsed cell values.
 * @param caps Resolved limits and window configuration.
 * @returns Inferred column schemas, typed rows, and validation warnings.
 */
export function inferAndTransformRows(rawRows: readonly (readonly CellValue[])[], caps: ResolvedSheetsCaps): InferAndTransformResult {
  if (rawRows.length === 0) {
    return { schema: [], rows: [], warnings: [] };
  }

  const colCount = Math.max(...rawRows.map((r) => r.length), 0);
  if (colCount === 0) {
    return { schema: [], rows: [], warnings: [] };
  }

  // 1. Check for header row
  const hasHeaderRow =
    rawRows.length > 1 && rawRows[0].length === colCount && rawRows[0].every((cell) => typeof cell === "string" && cell.trim() !== "");

  const headerNames = hasHeaderRow
    ? rawRows[0].map((cell, idx) => (typeof cell === "string" && cell.trim() ? cell.trim() : `Column ${idx + 1}`))
    : Array.from({ length: colCount }, (_, idx) => `Column ${idx + 1}`);

  const dataRows = hasHeaderRow ? rawRows.slice(1) : rawRows;
  const sampleWindowRows = dataRows.slice(0, caps.inferenceWindowRows);

  // 2. Collect statistics over the sampling window
  const stats: ColumnStats[] = Array.from({ length: colCount }, () => ({
    nullCount: 0,
    totalCount: 0,
    hasCurrency: false,
    hasScientific: false,
    hasMixedDecimalSeparator: false,
    typeCounts: new Map<ColumnType, number>(),
  }));

  for (const row of sampleWindowRows) {
    for (let c = 0; c < colCount; c++) {
      const colStat = stats[c];
      colStat.totalCount += 1;
      const cell = row[c];

      if (cell === null || cell === undefined || cell === "") {
        colStat.nullCount += 1;
        continue;
      }

      if (colStat.sample === undefined) {
        if (typeof cell === "object" && cell !== null && "value" in cell) {
          colStat.sample = String(cell.value);
        } else if (typeof cell === "object" && cell !== null && "formula" in cell) {
          colStat.sample = cell.formula;
        } else {
          colStat.sample = String(cell);
        }
      }

      // Check formula cell
      if (typeof cell === "object" && cell !== null && "formula" in cell) {
        colStat.typeCounts.set("string", (colStat.typeCounts.get("string") ?? 0) + 1);
        continue;
      }

      // Check existing explicit types
      if (typeof cell === "object" && cell !== null && "type" in cell) {
        if (cell.type === "decimal") {
          colStat.typeCounts.set("decimal", (colStat.typeCounts.get("decimal") ?? 0) + 1);
        } else if (cell.type === "date") {
          colStat.typeCounts.set("date", (colStat.typeCounts.get("date") ?? 0) + 1);
        } else if (cell.type === "datetime") {
          colStat.typeCounts.set("datetime", (colStat.typeCounts.get("datetime") ?? 0) + 1);
        }
        continue;
      }

      if (typeof cell === "boolean") {
        colStat.typeCounts.set("boolean", (colStat.typeCounts.get("boolean") ?? 0) + 1);
        continue;
      }

      if (typeof cell === "number") {
        if (Number.isInteger(cell)) {
          colStat.typeCounts.set("integer", (colStat.typeCounts.get("integer") ?? 0) + 1);
        } else {
          colStat.typeCounts.set("decimal", (colStat.typeCounts.get("decimal") ?? 0) + 1);
        }
        continue;
      }

      // String token analysis
      const strVal = String(cell).trim();

      if (isScientificNotation(strVal)) {
        colStat.hasScientific = true;
        colStat.typeCounts.set("string", (colStat.typeCounts.get("string") ?? 0) + 1);
        continue;
      }

      if (isCurrencyString(strVal)) {
        colStat.hasCurrency = true;
      }

      if (strVal.toLowerCase() === "true" || strVal.toLowerCase() === "false") {
        colStat.typeCounts.set("boolean", (colStat.typeCounts.get("boolean") ?? 0) + 1);
        continue;
      }

      if (ISO_DATE_REGEX.test(strVal)) {
        colStat.typeCounts.set("date", (colStat.typeCounts.get("date") ?? 0) + 1);
        continue;
      }

      if (ISO_DATETIME_REGEX.test(strVal)) {
        colStat.typeCounts.set("datetime", (colStat.typeCounts.get("datetime") ?? 0) + 1);
        continue;
      }

      const normalized = normalizeDecimal(strVal);
      if (normalized !== null) {
        if (normalized.isMoney) {
          colStat.hasCurrency = true;
        }
        if (/^-?\d+$/.test(normalized.value) && !normalized.isMoney) {
          colStat.typeCounts.set("integer", (colStat.typeCounts.get("integer") ?? 0) + 1);
        } else {
          colStat.typeCounts.set("decimal", (colStat.typeCounts.get("decimal") ?? 0) + 1);
        }
      } else {
        colStat.typeCounts.set("string", (colStat.typeCounts.get("string") ?? 0) + 1);
      }
    }
  }

  // 3. Deduce schemas per column
  const schema: ColumnSchema[] = [];

  for (let c = 0; c < colCount; c++) {
    const colName = headerNames[c];
    const colStat = stats[c];
    const flags: string[] = [];
    let inferredType: ColumnType = "string";

    if (colStat.hasScientific) {
      inferredType = "string";
      flags.push("numeric-ambiguous");
    } else {
      const isMoneyNamed = MONEY_COLUMN_NAME_PATTERN.test(colName);
      const decimalCount = colStat.typeCounts.get("decimal") ?? 0;
      const integerCount = colStat.typeCounts.get("integer") ?? 0;
      const numericCount = decimalCount + integerCount;

      if ((colStat.hasCurrency || isMoneyNamed) && numericCount > 0) {
        inferredType = "decimal";
      } else {
        // Find dominant type
        let highestCount = 0;
        let dominantType: ColumnType = "string";

        for (const [t, count] of colStat.typeCounts.entries()) {
          if (count > highestCount) {
            highestCount = count;
            dominantType = t;
          }
        }

        if (dominantType === "integer" && decimalCount > 0) {
          // Mixed integer and decimal in non-money column -> decimal
          inferredType = "decimal";
        } else {
          inferredType = dominantType;
        }
      }
    }

    const nullRate = Number((colStat.nullCount / Math.max(sampleWindowRows.length, 1)).toFixed(4));

    schema.push({
      name: colName,
      type: inferredType,
      nullRate,
      sample: colStat.sample,
      flags,
    });
  }

  // 4. Validate all data rows and transform cell values to match the inferred schema
  const warnings: InferenceWarning[] = [];
  const mismatchCounts = new Map<number, number>();
  const mismatchSamples = new Map<number, string[]>();

  const transformedDataRows: CellValue[][] = [];

  for (let r = 0; r < dataRows.length; r++) {
    const rawRow = dataRows[r];
    const transformedRow: CellValue[] = [];

    for (let c = 0; c < colCount; c++) {
      const colSchema = schema[c];
      const cell = rawRow[c];

      if (cell === null || cell === undefined || cell === "") {
        transformedRow.push(null);
        continue;
      }

      // Preserve formula cells intact
      if (typeof cell === "object" && cell !== null && "formula" in cell) {
        transformedRow.push(cell);
        continue;
      }

      let transformedCell: CellValue = cell;
      let matched = true;

      switch (colSchema.type) {
        case "decimal": {
          if (typeof cell === "object" && cell !== null && "type" in cell && cell.type === "decimal") {
            transformedCell = cell;
          } else if (typeof cell === "number") {
            transformedCell = { type: "decimal", value: String(cell) };
          } else if (typeof cell === "string") {
            const norm = normalizeDecimal(cell);
            if (norm !== null) {
              transformedCell = { type: "decimal", value: norm.value };
            } else {
              matched = false;
              transformedCell = cell;
            }
          } else {
            matched = false;
          }
          break;
        }

        case "integer": {
          if (typeof cell === "number" && Number.isInteger(cell)) {
            transformedCell = cell;
          } else if (typeof cell === "string") {
            const norm = normalizeDecimal(cell);
            if (norm !== null && /^-?\d+$/.test(norm.value)) {
              const num = Number(norm.value);
              if (Number.isSafeInteger(num)) {
                transformedCell = num;
              } else {
                transformedCell = { type: "decimal", value: norm.value };
              }
            } else {
              matched = false;
              transformedCell = cell;
            }
          } else {
            matched = false;
          }
          break;
        }

        case "boolean": {
          if (typeof cell === "boolean") {
            transformedCell = cell;
          } else if (typeof cell === "string") {
            const lower = cell.trim().toLowerCase();
            if (lower === "true" || lower === "1") {
              transformedCell = true;
            } else if (lower === "false" || lower === "0") {
              transformedCell = false;
            } else {
              matched = false;
              transformedCell = cell;
            }
          } else {
            matched = false;
          }
          break;
        }

        case "date": {
          if (typeof cell === "object" && cell !== null && "type" in cell && cell.type === "date") {
            transformedCell = cell;
          } else if (typeof cell === "string" && ISO_DATE_REGEX.test(cell.trim())) {
            transformedCell = { type: "date", value: cell.trim() };
          } else {
            matched = false;
            transformedCell = cell;
          }
          break;
        }

        case "datetime": {
          if (typeof cell === "object" && cell !== null && "type" in cell && cell.type === "datetime") {
            transformedCell = cell;
          } else if (typeof cell === "string" && ISO_DATETIME_REGEX.test(cell.trim())) {
            transformedCell = { type: "datetime", value: cell.trim() };
          } else {
            matched = false;
            transformedCell = cell;
          }
          break;
        }

        default: {
          if (colSchema.flags.includes("numeric-ambiguous")) {
            if (typeof cell === "object" && cell !== null && "value" in cell) {
              transformedCell = String(cell.value);
            } else {
              transformedCell = String(cell);
            }
          } else {
            transformedCell = typeof cell === "object" && cell !== null && "value" in cell ? String(cell.value) : cell;
          }
          break;
        }
      }

      if (!matched) {
        const curCount = mismatchCounts.get(c) ?? 0;
        mismatchCounts.set(c, curCount + 1);
        const curSamples = mismatchSamples.get(c) ?? [];
        if (curSamples.length < 20) {
          curSamples.push(String(typeof cell === "object" && cell !== null && "value" in cell ? cell.value : cell));
          mismatchSamples.set(c, curSamples);
        }
      }

      transformedRow.push(transformedCell);
    }

    transformedDataRows.push(transformedRow);
  }

  // 5. Construct warning reports for column type mismatches
  for (let c = 0; c < colCount; c++) {
    const count = mismatchCounts.get(c) ?? 0;
    if (count > 0 && warnings.length < caps.maxWarnings) {
      warnings.push({
        kind: "type-mismatch",
        message: `Column "${schema[c].name}" had ${count} value(s) not matching inferred type "${schema[c].type}"`,
        column: schema[c].name,
        mismatchCount: count,
        samples: mismatchSamples.get(c) ?? [],
      });
    }
  }

  const finalRows = hasHeaderRow ? [rawRows[0], ...transformedDataRows] : transformedDataRows;

  return {
    schema,
    rows: finalRows,
    warnings,
  };
}
