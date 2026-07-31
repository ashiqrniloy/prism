/**
 * Minimal glob matcher: `*`, `?`, and `**` only. No brace expansion, no regex.
 */

export function validateGlobPattern(pattern: string, maxPatternBytes: number): void {
  const patternBytes = Buffer.byteLength(pattern, "utf8");
  if (patternBytes < 1) throw new Error("pattern must be non-empty");
  if (patternBytes > maxPatternBytes) {
    throw new Error(`pattern exceeds ${maxPatternBytes} byte pattern limit`);
  }
  if (pattern.includes("{") || pattern.includes("}")) {
    throw new Error("brace expansion is not supported in glob patterns");
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
