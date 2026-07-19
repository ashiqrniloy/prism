export const DEFAULT_MAX_LINES = 2_000;
export const HARD_MAX_LINES = 100_000;
export const DEFAULT_MAX_BYTES = 50 * 1024;
export const HARD_MAX_BYTES = 1024 * 1024;

export const DEFAULT_MAX_TEXT_SCAN_BYTES = 64 * 1024 * 1024;
export const HARD_MAX_TEXT_SCAN_BYTES = 1024 * 1024 * 1024;
export const DEFAULT_MAX_IMAGE_BYTES = 10_000_000;
export const HARD_MAX_IMAGE_BYTES = 32 * 1024 * 1024;

export const DEFAULT_MAX_WRITE_BYTES = 8 * 1024 * 1024;
export const HARD_MAX_WRITE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_EDIT_FILE_BYTES = 8 * 1024 * 1024;
export const HARD_MAX_EDIT_FILE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_EDIT_INPUT_BYTES = 2 * 1024 * 1024;
export const HARD_MAX_EDIT_INPUT_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_EDITS = 100;
export const HARD_MAX_EDITS = 1_000;

export const DEFAULT_SHELL_TIMEOUT_SECONDS = 600;
export const HARD_SHELL_TIMEOUT_SECONDS = 3_600;
export const DEFAULT_MAX_TOTAL_OUTPUT_BYTES = 64 * 1024 * 1024;
export const HARD_MAX_TOTAL_OUTPUT_BYTES = 1024 * 1024 * 1024;

/** Validate one configurable coding resource limit. Invalid values fail instead of clamping. */
export function validateCodingLimit(name: string, value: number, hardCap: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > hardCap) {
    throw new Error(`${name} must be a positive safe integer at most ${hardCap}`);
  }
  return value;
}
