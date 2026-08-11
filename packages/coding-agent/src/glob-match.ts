/**
 * Minimal glob matcher: `*`, `?`, and `**` only. Brace expansion is an opt-in,
 * bounded extension (see `expandGlobBraces`). No regex, no dependency.
 */

export interface BraceExpansionOptions {
  /** Max alternatives produced by expansion (default 128). */
  maxAlternatives?: number;
  /** Max total bytes across all expanded alternatives (default 4096). */
  maxExpandedBytes?: number;
}

const DEFAULT_MAX_BRACE_ALTERNATIVES = 128;
const DEFAULT_MAX_BRACE_EXPANDED_BYTES = 4_096;

/**
 * Expand `{a,b}` groups in a pattern (cartesian across multiple groups).
 * Bounded: max alternatives and max total expanded bytes; unbalanced or nested
 * braces fail closed. With no braces (or empty text), returns `[pattern]`.
 */
export function expandGlobBraces(pattern: string, options?: BraceExpansionOptions): string[] {
  const maxAlternatives = options?.maxAlternatives ?? DEFAULT_MAX_BRACE_ALTERNATIVES;
  const maxExpandedBytes = options?.maxExpandedBytes ?? DEFAULT_MAX_BRACE_EXPANDED_BYTES;
  const results: string[] = [];

  const go = (start: number, prefix: string): void => {
    if (results.length >= maxAlternatives) {
      throw new Error(`brace expansion exceeds ${maxAlternatives} alternative limit`);
    }
    const open = pattern.indexOf("{", start);
    if (open === -1) {
      const out = prefix + pattern.slice(start);
      if (Buffer.byteLength(out, "utf8") > maxExpandedBytes) {
        throw new Error(`brace expansion exceeds ${maxExpandedBytes} byte limit`);
      }
      results.push(out);
      return;
    }
    let depth = 1;
    let close = -1;
    for (let i = open + 1; i < pattern.length; i++) {
      const ch = pattern[i]!;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) throw new Error(`unbalanced brace expansion in pattern: ${pattern}`);
    if (depth !== 0) throw new Error(`unbalanced brace expansion in pattern: ${pattern}`);
    const body = pattern.slice(open + 1, close);
    if (body.includes("{") || body.includes("}")) {
      throw new Error(`nested brace expansion is not supported in pattern: ${pattern}`);
    }
    if (body.length === 0) throw new Error(`empty brace expansion in pattern: ${pattern}`);
    for (const alt of body.split(",")) {
      go(close + 1, prefix + pattern.slice(start, open) + alt);
    }
  };

  go(0, "");
  return results;
}

export function validateGlobPattern(pattern: string, maxPatternBytes: number, options?: { braceExpansion?: boolean }): void {
  const patternBytes = Buffer.byteLength(pattern, "utf8");
  if (patternBytes < 1) throw new Error("pattern must be non-empty");
  if (patternBytes > maxPatternBytes) {
    throw new Error(`pattern exceeds ${maxPatternBytes} byte pattern limit`);
  }
  if (pattern.includes("{") || pattern.includes("}")) {
    if (options?.braceExpansion === true) {
      // Bounded expansion is validated by expandGlobBraces (alternatives + byte caps).
      expandGlobBraces(pattern);
      return;
    }
    throw new Error("brace expansion is not supported in glob patterns (set braceExpansion: true to enable the bounded expansion)");
  }
}

function matchSegment(pattern: string, segment: string): boolean {
  function go(pi: number, si: number): boolean {
    if (pi === pattern.length) return si === segment.length;
    const pc = pattern[pi]!;
    if (pc === "*") {
      if (pi === pattern.length - 1) return true;
      for (let k = si; k <= segment.length; k++) {
        if (go(pi + 1, k)) return true;
      }
      return false;
    }
    if (pc === "?") {
      if (si >= segment.length) return false;
      return go(pi + 1, si + 1);
    }
    if (si >= segment.length || pc !== segment[si]) return false;
    return go(pi + 1, si + 1);
  }
  return go(0, 0);
}

function splitPattern(pattern: string): string[] {
  const normalized = pattern.replace(/\\/g, "/");
  if (normalized === "") return [];
  const parts = normalized.split("/");
  if (parts.length > 0 && parts[0] === "") parts.shift();
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function matchSegments(patternParts: readonly string[], pathParts: readonly string[], pi: number, pj: number): boolean {
  while (pi < patternParts.length) {
    const part = patternParts[pi]!;
    if (part === "**") {
      pi++;
      if (pi === patternParts.length) return true;
      for (let k = pj; k <= pathParts.length; k++) {
        if (matchSegments(patternParts, pathParts, pi, k)) return true;
      }
      return false;
    }
    if (pj >= pathParts.length) return false;
    if (!matchSegment(part, pathParts[pj]!)) return false;
    pi++;
    pj++;
  }
  return pj === pathParts.length;
}

/** Match a workspace-relative path against a glob pattern using `/` separators. */
export function matchGlobPattern(pattern: string, path: string): boolean {
  const patternParts = splitPattern(pattern);
  const pathParts = splitPattern(path);
  if (patternParts.length === 0) return pathParts.length === 0;
  return matchSegments(patternParts, pathParts, 0, 0);
}
