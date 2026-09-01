import {
  type ColumnOptions,
  generateWorkbookSync,
  parseWorkbook as ooParseWorkbook,
  type WorkbookOptions,
  type WorksheetOptions,
} from "@office-open/xlsx";
import type { CellValue, SheetData, SheetModel } from "../types.js";

function mapCellValue(cell: CellValue) {
  if (cell === null || cell === undefined) {
    return { value: "" };
  }
  if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") {
    return { value: cell };
  }
  if ("type" in cell) {
    if (cell.type === "decimal") {
      // # ponytail: xlsx numeric cells are IEEE-754 doubles in Excel.
      // We convert canonical decimal strings to Number for spreadsheet arithmetic,
      // while the Prism sheet model and raw XML parse preserve exact decimal strings.
      const num = Number(cell.value);
      return { value: Number.isFinite(num) ? num : cell.value };
    }
    if (cell.type === "date" || cell.type === "datetime") {
      return { value: cell.value };
    }
  }
  if ("formula" in cell) {
    const rawFormula = cell.formula.startsWith("=") ? cell.formula.slice(1) : cell.formula;
    return {
      formula: rawFormula,
      value: cell.cachedValue !== undefined && cell.cachedValue !== null ? cell.cachedValue : undefined,
    };
  }
  return { value: "" };
}

function sheetDataToWorksheet(data: SheetData): WorksheetOptions {
  const rows = data.cells.map((row) => ({
    cells: row.map(mapCellValue),
  }));

  const columns: ColumnOptions[] | undefined = data.columnWidths
    ? data.columnWidths.map((cw) => ({
        min: cw.column + 1,
        max: cw.column + 1,
        width: cw.width,
      }))
    : undefined;

  const freezePanes = data.frozenPanes
    ? {
        row: data.frozenPanes.rows,
        col: data.frozenPanes.columns,
      }
    : undefined;

  return {
    name: data.name,
    columns,
    freezePanes,
    rows,
  };
}

export function sheetModelToXlsxOptions(model: SheetModel): WorkbookOptions {
  return {
    worksheets: model.sheets.map(sheetDataToWorksheet),
  };
}

export function generateXlsxBytes(model: SheetModel): Uint8Array {
  const options = sheetModelToXlsxOptions(model);
  const result = generateWorkbookSync(options);
  return new Uint8Array(result);
}

export function parseXlsxBytes(bytes: Uint8Array): SheetModel {
  const parsed = ooParseWorkbook(bytes);
  const worksheets = parsed.worksheets ?? [];
  const sheets: SheetData[] = [];

  for (const ws of worksheets) {
    const name = ws.name ?? "Sheet1";
    const cells: CellValue[][] = [];

    for (const row of ws.rows ?? []) {
      const rowCells: CellValue[] = [];
      for (const c of row.cells ?? []) {
        if (c.formula && typeof c.formula === "object" && "formula" in c.formula && typeof c.formula.formula === "string") {
          const raw = c.formula.formula;
          const formulaStr = raw.startsWith("=") ? raw : `=${raw}`;
          rowCells.push({
            formula: formulaStr,
            cachedValue: c.value !== undefined ? (c.value as string | number | boolean | null) : null,
          });
        } else if (typeof c.value === "number") {
          rowCells.push(c.value);
        } else if (typeof c.value === "string") {
          rowCells.push(c.value);
        } else if (typeof c.value === "boolean") {
          rowCells.push(c.value);
        } else if (c.value === null || c.value === undefined) {
          rowCells.push(null);
        } else {
          rowCells.push(String(c.value));
        }
      }
      cells.push(rowCells);
    }

    const columnWidths = ws.columns?.map((cw, i) => ({
      column: cw.min !== undefined ? cw.min - 1 : i,
      width: cw.width ?? 10,
    }));

    const frozenPanes = ws.freezePanes
      ? {
          rows: ws.freezePanes.row,
          columns: ws.freezePanes.col,
        }
      : undefined;

    sheets.push({
      name,
      cells,
      columnWidths,
      frozenPanes,
    });
  }

  return {
    kind: "sheet",
    modelVersion: 1,
    sheets,
  };
}
