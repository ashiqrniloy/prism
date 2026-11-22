import { DiagramsCapError } from "./errors.js";

// --- Default and Hard Ceiling Constants ---

export const DEFAULT_MAX_XML_BYTES = 32 * 1024 * 1024; // 32 MiB

export const DEFAULT_MAX_ELEMENTS = 100_000;

export const DEFAULT_MAX_ATTRIBUTES = 500_000;

export interface DrawioXmlCaps {
  readonly maxBytes?: number;
  readonly maxElements?: number;
  readonly maxAttributes?: number;
}

export interface ResolvedDrawioXmlCaps {
  readonly maxBytes: number;
  readonly maxElements: number;
  readonly maxAttributes: number;
}

/** A host-set cap: a positive integer. The host's value is the cap (plan 239 Task 5). */
function resolveCap(name: string, value: number | undefined, defaultVal: number): number {
  if (value === undefined) return defaultVal;
  if (!Number.isInteger(value) || value <= 0) {
    throw new DiagramsCapError(`diagrams cap ${name} must be a positive integer, got ${value}`);
  }
  return value;
}

/**
 * Resolves user-supplied caps against safe defaults and hard ceilings.
 */
export function resolveDiagramsCaps(caps?: DrawioXmlCaps): ResolvedDrawioXmlCaps {
  return {
    maxBytes: resolveCap("maxBytes", caps?.maxBytes, DEFAULT_MAX_XML_BYTES),
    maxElements: resolveCap("maxElements", caps?.maxElements, DEFAULT_MAX_ELEMENTS),
    maxAttributes: resolveCap("maxAttributes", caps?.maxAttributes, DEFAULT_MAX_ATTRIBUTES),
  };
}

/**
 * Enforces input byte size ceiling. Throws {@link DiagramsCapError} if exceeded.
 */
export function validateByteCap(byteLength: number, caps: ResolvedDrawioXmlCaps): void {
  if (byteLength > caps.maxBytes) {
    throw new DiagramsCapError(`XML input size ${byteLength} bytes exceeds maxBytes cap (${caps.maxBytes})`);
  }
}
