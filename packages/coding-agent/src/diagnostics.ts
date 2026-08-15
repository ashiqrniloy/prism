/**
 * Bounded normalization of host-parsed check diagnostics and deterministic
 * added/removed/unchanged deltas between generations. No language/tool-
 * specific parser catalog: hosts parse check output into RawDiagnostic and
 * this module validates, bounds, and fingerprints it.
 */

import { isAbsolute, relative, resolve } from "node:path";
import {
  DEFAULT_MAX_DIAGNOSTIC_MESSAGE_BYTES,
  DEFAULT_MAX_REVIEW_DIAGNOSTICS,
  HARD_MAX_DIAGNOSTIC_MESSAGE_BYTES,
  HARD_MAX_REVIEW_DIAGNOSTICS,
  validateCodingLimit,
} from "./limits.js";

export interface ResolvedDiagnosticsLimits {
  readonly maxDiagnosticsPerFile: number;
  readonly maxMessageBytes: number;
}

export function resolveDiagnosticsLimits(options?: {
  readonly maxDiagnosticsPerFile?: number;
  readonly maxMessageBytes?: number;
}): ResolvedDiagnosticsLimits {
  return {
    maxDiagnosticsPerFile: validateCodingLimit(
      "maxDiagnosticsPerFile",
      options?.maxDiagnosticsPerFile ?? DEFAULT_MAX_REVIEW_DIAGNOSTICS,
      HARD_MAX_REVIEW_DIAGNOSTICS,
    ),
    maxMessageBytes: validateCodingLimit(
      "maxMessageBytes",
      options?.maxMessageBytes ?? DEFAULT_MAX_DIAGNOSTIC_MESSAGE_BYTES,
      HARD_MAX_DIAGNOSTIC_MESSAGE_BYTES,
    ),
  };
}

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface RawDiagnostic {
  readonly file: string;
  readonly line?: number;
  readonly character?: number;
  readonly endLine?: number;
  readonly endCharacter?: number;
  readonly severity?: DiagnosticSeverity;
  readonly message: string;
  readonly source?: string;
  readonly code?: string | number;
}

/** Normalized diagnostic: workspace-relative file, bounded fields, generation tag. */
export interface NormalizedDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly character: number;
  readonly endLine: number;
  readonly endCharacter: number;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly source: string;
  readonly code?: string | number;
  /** Monotonic producer generation (document version for LSP, host counter for checks). */
  readonly generation: number;
}

export interface NormalizeDiagnosticsOptions {
  /** Workspace root for containment; host-supplied, absolute. */
  readonly workspaceRoot: string;
  /** Diagnostics per file cap (default/hard 500/5000). */
  readonly maxDiagnosticsPerFile?: number;
  /** Message byte cap (default/hard 4096/16384). */
  readonly maxMessageBytes?: number;
  /** Generation stamped onto every normalized diagnostic. */
  readonly generation: number;
}

export interface DiagnosticDelta {
  readonly generation: number;
  readonly added: readonly NormalizedDiagnostic[];
  readonly removed: readonly NormalizedDiagnostic[];
  readonly unchanged: readonly NormalizedDiagnostic[];
  /** True when every input was deduplicated/truncated to the caps. */
  readonly truncated: boolean;
}

export interface DiagnosticDeltaRequest {
  /** Newest diagnostics, already normalized (generation must be >= previous). */
  readonly next: readonly NormalizedDiagnostic[];
  /** Prior generation view; entries older than next's generation are stale. */
  readonly previous?: readonly NormalizedDiagnostic[];
  /** Deterministic identity: file:source:line:character:code (default) or custom key. */
  readonly identity?: (diagnostic: NormalizedDiagnostic) => string;
}

const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const TRUNCATE_SUFFIX = "…";

/** Stable identity key; the delta treats two diagnostics with the same key as one item. */
export function diagnosticIdentity(diagnostic: NormalizedDiagnostic): string {
  const code = diagnostic.code === undefined ? "" : String(diagnostic.code);
  return `${diagnostic.file}:${diagnostic.source}:${diagnostic.line}:${diagnostic.character}:${code}`;
}

/**
 * Validate and bound host-parsed diagnostics. Throws nothing on malformed
 * entries: each is dropped fail-closed (never partially normalized).
 * Out-of-workspace paths, control characters, and non-finite positions are
 * rejected per entry; overflow charges the per-file cap.
 */
export function normalizeDiagnostics(
  raw: readonly RawDiagnostic[],
  options: NormalizeDiagnosticsOptions,
): readonly NormalizedDiagnostic[] {
  const limits: ResolvedDiagnosticsLimits = resolveDiagnosticsLimits({
    maxDiagnosticsPerFile: options.maxDiagnosticsPerFile,
    maxMessageBytes: options.maxMessageBytes,
  });
  const root = resolve(options.workspaceRoot);
  const perFileCounts: Record<string, number> = {};
  const out: NormalizedDiagnostic[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const file = normalizeFile(root, entry.file);
    if (!file) {
      continue;
    }
    if (typeof entry.message !== "string" || entry.message.length === 0) {
      continue;
    }
    const severity = entry.severity ?? "error";
    if (severity !== "error" && severity !== "warning" && severity !== "info" && severity !== "hint") {
      continue;
    }
    const line = finiteInt(entry.line, 0);
    const character = finiteInt(entry.character, 0);
    const endLine = finiteInt(entry.endLine, line);
    const endCharacter = finiteInt(entry.endCharacter, character);
    // negative or non-finite positions are rejected, never clamped
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(character) || !Number.isSafeInteger(endLine) || !Number.isSafeInteger(endCharacter)) {
      continue;
    }
    if (endLine < line || (endLine === line && endCharacter < character)) {
      continue;
    }
    const message = truncateUtf8(entry.message.replace(CONTROL_PATTERN, ""), limits.maxMessageBytes);
    if (message.length === 0) {
      continue;
    }
    const code = validCode(entry.code) ? entry.code : undefined;
    const source = truncateUtf8(String(entry.source ?? "check"), limits.maxMessageBytes);
    const diagnostic: NormalizedDiagnostic = {
      file,
      line,
      character,
      endLine,
      endCharacter,
      severity,
      message,
      source,
      code,
      generation: options.generation,
    };
    const count = perFileCounts[file] ?? 0;
    if (count >= limits.maxDiagnosticsPerFile) {
      continue;
    }
    perFileCounts[file] = count + 1;
    out.push(diagnostic);
  }
  return out;
}

/**
 * Deterministic added/removed/unchanged delta between two diagnostic
 * generations. Identity is `diagnosticIdentity` (file:source:position:code);
 * message/severity changes keep the same identity and count as unchanged —
 * the delta tracks presence, not content edits (hosts diff content on demand).
 * Stale previous entries (generation >= next's generation) are ignored.
 */
export function diagnosticDelta(request: DiagnosticDeltaRequest): DiagnosticDelta {
  const identity = request.identity ?? diagnosticIdentity;
  const nextGeneration = request.next[0]?.generation ?? 0;
  const nextKeys = new Map<string, NormalizedDiagnostic>();
  const previousKeys = new Map<string, NormalizedDiagnostic>();
  let truncated = false;

  for (const d of request.next) {
    if (!d || typeof d !== "object") {
      truncated = true;
      continue;
    }
    const key = identity(d);
    if (nextKeys.has(key)) {
      truncated = true;
      continue;
    }
    nextKeys.set(key, d);
  }
  for (const d of request.previous ?? []) {
    if (!d || typeof d !== "object") continue;
    if (d.generation > nextGeneration) continue; // stale: newer than the new view
    const key = identity(d);
    if (!previousKeys.has(key)) previousKeys.set(key, d);
  }

  const added: NormalizedDiagnostic[] = [];
  const unchanged: NormalizedDiagnostic[] = [];
  for (const d of nextKeys.values()) {
    (previousKeys.has(identity(d)) ? unchanged : added).push(d);
  }
  const removed: NormalizedDiagnostic[] = [];
  for (const d of previousKeys.values()) {
    if (!nextKeys.has(identity(d))) removed.push(d);
  }

  return { generation: nextGeneration, added, removed, unchanged, truncated };
}

function normalizeFile(root: string, file: unknown): string | undefined {
  if (typeof file !== "string" || file.length === 0) return undefined;
  if (file.includes("\0")) return undefined;
  if (isAbsolute(file)) {
    const rel = relative(root, file);
    if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
    return rel.split("\\").join("/");
  }
  const abs = resolve(root, file);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel.split("\\").join("/");
}

function finiteInt(value: unknown, fallback: number): number {
  if (value === undefined) return fallback; // absent position defaults
  if (typeof value !== "number" || !Number.isFinite(value)) return Number.NaN; // malformed rejected
  const floored = Math.floor(value);
  if (floored < 0) return Number.NaN; // negative positions rejected
  return floored;
}

function validCode(value: unknown): value is string | number {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return text;
  let result = text;
  while (bytes > maxBytes && result.length > 0) {
    result = result.slice(0, result.length - 1);
    bytes = Buffer.byteLength(result, "utf8");
  }
  return result + TRUNCATE_SUFFIX;
}
