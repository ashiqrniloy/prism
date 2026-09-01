import { accessSync, constants, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const MAX_SKILL_FILE_BYTES = 262_144;

const MAX_ERROR_CHARS = 512;

/** Host may point at a skills parent or at the compiled skill directory itself. */
export const SKILL_FILE_CANDIDATES = ["skills/impeccable/SKILL.md", "SKILL.md"] as const;

export class UpstreamResolveError extends Error {
  readonly code = "upstream_resolve_failed" as const;

  constructor(message: string) {
    super(message);
    this.name = "UpstreamResolveError";
  }
}

export interface ResolveUpstreamRootOptions {
  /** Host-owned path to an Impeccable checkout or compiled skill dir. */
  readonly upstreamPath: string;
}

export interface ResolvedImpeccableUpstream {
  readonly root: string;
  readonly skillRelativePath: string;
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

function readableFile(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve Impeccable upstream; throws when `upstreamPath` has no readable `SKILL.md`. */
export function resolveUpstreamRoot(options: ResolveUpstreamRootOptions): ResolvedImpeccableUpstream {
  const raw = options.upstreamPath?.trim();
  if (!raw) {
    throw new UpstreamResolveError("Impeccable upstreamPath is required (npm impeccable is the detector CLI, not a skill tree)");
  }

  const root = resolve(raw);
  for (const relative of SKILL_FILE_CANDIDATES) {
    if (readableFile(join(root, relative))) return { root, skillRelativePath: relative };
  }
  throw new UpstreamResolveError(
    redactPaths("Upstream root is missing a readable SKILL.md (skills/impeccable/SKILL.md or SKILL.md)", [root]),
  );
}
