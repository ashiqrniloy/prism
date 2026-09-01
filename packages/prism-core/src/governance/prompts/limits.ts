import { PromptLimitError, PromptValidationError } from "./errors.js";

export const DEFAULT_MAX_PROMPT_NAME_BYTES = 256;
export const HARD_MAX_PROMPT_NAME_BYTES = 1024;
export const DEFAULT_MAX_PROMPT_BODY_BYTES = 64 * 1024;
export const HARD_MAX_PROMPT_BODY_BYTES = 1024 * 1024;
export const DEFAULT_MAX_PROMPT_LABELS = 32;
export const HARD_MAX_PROMPT_LABELS = 128;
export const DEFAULT_MAX_PROMPT_LABEL_BYTES = 128;
export const HARD_MAX_PROMPT_LABEL_BYTES = 512;
export const DEFAULT_MAX_PROMPT_METADATA_BYTES = 16 * 1024;
export const HARD_MAX_PROMPT_METADATA_BYTES = 128 * 1024;
export const DEFAULT_PROMPT_PAGE_SIZE = 100;
export const HARD_PROMPT_PAGE_SIZE = 500;
export const DEFAULT_MAX_PROMPT_CURSOR_BYTES = 4096;
export const HARD_MAX_PROMPT_CURSOR_BYTES = 16 * 1024;
export const DEFAULT_MAX_PROMPT_DIFF_LINES = 1024;
export const HARD_MAX_PROMPT_DIFF_LINES = 4096;

export interface PromptLimitsInput {
  readonly maxNameBytes?: number;
  readonly maxBodyBytes?: number;
  readonly maxLabels?: number;
  readonly maxLabelBytes?: number;
  readonly maxMetadataBytes?: number;
  readonly pageSize?: number;
  readonly maxCursorBytes?: number;
  readonly maxDiffLines?: number;
}

export interface PromptLimits {
  readonly maxNameBytes: number;
  readonly maxBodyBytes: number;
  readonly maxLabels: number;
  readonly maxLabelBytes: number;
  readonly maxMetadataBytes: number;
  readonly pageSize: number;
  readonly maxCursorBytes: number;
  readonly maxDiffLines: number;
}

export function resolvePromptLimits(input: PromptLimitsInput = {}): PromptLimits {
  return Object.freeze({
    maxNameBytes: bounded(input.maxNameBytes, DEFAULT_MAX_PROMPT_NAME_BYTES, HARD_MAX_PROMPT_NAME_BYTES, "maxNameBytes"),
    maxBodyBytes: bounded(input.maxBodyBytes, DEFAULT_MAX_PROMPT_BODY_BYTES, HARD_MAX_PROMPT_BODY_BYTES, "maxBodyBytes"),
    maxLabels: bounded(input.maxLabels, DEFAULT_MAX_PROMPT_LABELS, HARD_MAX_PROMPT_LABELS, "maxLabels"),
    maxLabelBytes: bounded(input.maxLabelBytes, DEFAULT_MAX_PROMPT_LABEL_BYTES, HARD_MAX_PROMPT_LABEL_BYTES, "maxLabelBytes"),
    maxMetadataBytes: bounded(
      input.maxMetadataBytes,
      DEFAULT_MAX_PROMPT_METADATA_BYTES,
      HARD_MAX_PROMPT_METADATA_BYTES,
      "maxMetadataBytes",
    ),
    pageSize: bounded(input.pageSize, DEFAULT_PROMPT_PAGE_SIZE, HARD_PROMPT_PAGE_SIZE, "pageSize"),
    maxCursorBytes: bounded(input.maxCursorBytes, DEFAULT_MAX_PROMPT_CURSOR_BYTES, HARD_MAX_PROMPT_CURSOR_BYTES, "maxCursorBytes"),
    maxDiffLines: bounded(input.maxDiffLines, DEFAULT_MAX_PROMPT_DIFF_LINES, HARD_MAX_PROMPT_DIFF_LINES, "maxDiffLines"),
  });
}

function bounded(value: number | undefined, fallback: number, hard: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > hard) {
    throw new PromptValidationError(`${label} must be an integer in [1, ${hard}]`, "ERR_PRISM_PROMPT_LIMITS");
  }
  return value;
}

export function resolvePromptPageLimit(value: number | undefined, limits: PromptLimits): number {
  if (value === undefined) return limits.pageSize;
  if (!Number.isSafeInteger(value) || value < 1)
    throw new PromptValidationError("limit must be a positive safe integer", "ERR_PRISM_PROMPT_LIMITS");
  return Math.min(value, limits.pageSize);
}

export function assertBytes(value: string, maxBytes: number, label: string): void {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > maxBytes) throw new PromptLimitError(`${label} exceeds ${maxBytes} bytes (${bytes})`);
}

export function assertDiffLines(value: number, maxLines: number, label: string): void {
  if (value > maxLines) throw new PromptLimitError(`${label} exceeds ${maxLines} lines`);
}
