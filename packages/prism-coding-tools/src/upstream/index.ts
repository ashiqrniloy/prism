/**
 * Primitives shared by the upstream persona resolvers (`caveman`, `ponytail`,
 * `impeccable`).
 *
 * Each persona keeps its own `resolveUpstreamRoot`: the contracts differ (required
 * host path + `skills/` marker, optional path with optional-peer fallback, SKILL.md
 * candidate probe) and so do the return types. What is identical for the personas
 * that remain lives here — the error class, path redaction, bounded reads, and the
 * caps.
 *
 * `UpstreamResolveError` is one class for all personas: `name` and `code` are
 * unchanged, and `instanceof` also holds across personas.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const MAX_SKILL_FILE_BYTES = 262_144;

const MAX_ERROR_CHARS = 512;

export class UpstreamResolveError extends Error {
  readonly code = "upstream_resolve_failed" as const;

  constructor(message: string) {
    super(message);
    this.name = "UpstreamResolveError";
  }
}

/** Redact absolute paths and home directory segments from upstream errors. */
export function redactPaths(text: string, paths: readonly string[] = []): string {
  let out = text;
  for (const path of paths) {
    if (!path) continue;
    out = out.split(path).join("<path>");
    const resolved = resolve(path);
    if (resolved !== path) out = out.split(resolved).join("<path>");
  }
  const home = homedir();
  if (home) out = out.split(home).join("~");
  if (out.length > MAX_ERROR_CHARS) return `${out.slice(0, MAX_ERROR_CHARS - 1)}…`;
  return out;
}

/** Read a file under `root`, rejecting paths that escape `root` or exceed `maxBytes`. */
export function readBoundedFile(root: string, relativePath: string, maxBytes: number): string {
  const filePath = resolve(root, relativePath);
  const normalizedRoot = resolve(root);
  if (!filePath.startsWith(`${normalizedRoot}/`) && filePath !== normalizedRoot) {
    throw new UpstreamResolveError(redactPaths("Path escapes upstream root", [filePath, normalizedRoot]));
  }
  const data = readFileSync(filePath);
  if (data.byteLength > maxBytes) {
    throw new UpstreamResolveError(redactPaths(`File exceeds ${maxBytes} byte cap`, [filePath]));
  }
  return data.toString("utf8");
}
