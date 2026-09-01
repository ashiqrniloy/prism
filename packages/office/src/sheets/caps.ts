import { SheetsCapError, SheetsFormatError, SheetsValidationError } from "./errors.js";
import type { ResolvedSheetsCaps, SheetsCaps } from "./types.js";

// --- Default and Hard Ceiling Constants ---

export const DEFAULT_MAX_SHEET_BYTES = 32 * 1024 * 1024; // 32 MiB
export const HARD_MAX_SHEET_BYTES = 512 * 1024 * 1024; // 512 MiB

export const DEFAULT_MAX_SHEETS = 100;
export const HARD_MAX_SHEETS = 1_000;

export const DEFAULT_MAX_ROWS = 100_000;
export const HARD_MAX_ROWS = 1_000_000;

export const DEFAULT_MAX_COLUMNS = 1_000;
export const HARD_MAX_COLUMNS = 16_384;

export const DEFAULT_INFERENCE_WINDOW_ROWS = 500;
export const HARD_INFERENCE_WINDOW_ROWS = 5_000;

export const DEFAULT_MAX_WARNINGS = 100;
export const HARD_MAX_WARNINGS = 1_000;

function resolveCap(name: string, value: number | undefined, defaultVal: number, hardCap: number): number {
  if (value === undefined) return defaultVal;
  if (!Number.isInteger(value) || value <= 0 || value > hardCap) {
    throw new SheetsValidationError(`sheets cap ${name} must be an integer in (0, ${hardCap}], got ${value}`);
  }
  return value;
}

/**
 * Resolves user-supplied caps against safe defaults and hard ceilings.
 */
export function resolveSheetsCaps(caps?: SheetsCaps): ResolvedSheetsCaps {
  return {
    maxBytes: resolveCap("maxBytes", caps?.maxBytes, DEFAULT_MAX_SHEET_BYTES, HARD_MAX_SHEET_BYTES),
    maxSheets: resolveCap("maxSheets", caps?.maxSheets, DEFAULT_MAX_SHEETS, HARD_MAX_SHEETS),
    maxRows: resolveCap("maxRows", caps?.maxRows, DEFAULT_MAX_ROWS, HARD_MAX_ROWS),
    maxColumns: resolveCap("maxColumns", caps?.maxColumns, DEFAULT_MAX_COLUMNS, HARD_MAX_COLUMNS),
    inferenceWindowRows: resolveCap(
      "inferenceWindowRows",
      caps?.inferenceWindowRows,
      DEFAULT_INFERENCE_WINDOW_ROWS,
      HARD_INFERENCE_WINDOW_ROWS,
    ),
    maxWarnings: resolveCap("maxWarnings", caps?.maxWarnings, DEFAULT_MAX_WARNINGS, HARD_MAX_WARNINGS),
  };
}

/**
 * Enforces byte size ceiling. Throws {@link SheetsCapError} if exceeded.
 */
export function validateByteCap(byteLength: number, caps: ResolvedSheetsCaps): void {
  if (byteLength > caps.maxBytes) {
    throw new SheetsCapError(`input size ${byteLength} bytes exceeds maxBytes cap (${caps.maxBytes})`);
  }
}

/**
 * Validates standard PKZIP magic bytes (PK\x03\x04 = 0x50, 0x4b, 0x03, 0x04) at the container boundary.
 * Throws {@link SheetsFormatError} if the buffer does not begin with the ZIP signature.
 */
export function validateZipSignature(bytes: Uint8Array): void {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new SheetsFormatError("Invalid XLSX container: missing ZIP signature (PK\\x03\\x04)");
  }
}
