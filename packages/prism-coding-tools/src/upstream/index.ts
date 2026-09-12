/**
 * Primitives shared by the persona upstream resolvers (`caveman`, `ponytail`,
 * `impeccable`).
 *
 * Each persona keeps its own `resolveUpstreamRoot`: the contracts differ (required
 * host path + `skills/` marker, optional path with optional-peer fallback, SKILL.md
 * candidate probe) and so do the return types. What is identical for all three lives
 * here — the error class, path redaction, bounded reads, the `skills/` marker check,
 * the caps, and optional-peer package root discovery.
 *
 * `UpstreamResolveError` is one class for all three personas: `name` and `code` are
 * unchanged, and `instanceof` now also holds across personas.
 */
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const MAX_SKILL_FILE_BYTES = 262_144;
export const MAX_CONFIG_FILE_BYTES = 16_384;
export const MAX_INJECTED_INSTRUCTION_BYTES = 32_768;

/** Directory an upstream root must expose for the `skills/` marker check. */
export const SKILLS_DIR_NAME = "skills";

const MAX_ERROR_CHARS = 512;
const require = createRequire(import.meta.url);

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

/** Fail closed unless `root` exposes a readable, searchable `skills/` directory. */
export function assertSkillsMarker(root: string): void {
  const skillsDir = join(root, SKILLS_DIR_NAME);
  try {
    accessSync(skillsDir, constants.R_OK);
    accessSync(skillsDir, constants.X_OK);
  } catch {
    throw new UpstreamResolveError(redactPaths("Upstream root is missing a readable skills/ directory", [root, skillsDir]));
  }
}

/** Resolve an installed optional peer's package root, or fail closed with `UpstreamResolveError`. */
export function resolvePeerPackageRoot(packageName: string): string {
  const manifestPath = tryResolve(`${packageName}/package.json`);
  if (manifestPath) return dirname(manifestPath);
  // Peers that do not export "./package.json" (ponytail since 4.9) resolve by entry, then walk up.
  const entryPath = tryResolve(packageName);
  const root = entryPath ? findPackageRoot(dirname(entryPath), packageName) : undefined;
  if (root) return root;
  throw new UpstreamResolveError(redactPaths(`Could not resolve ${packageName}; install the optional peer or set upstreamPath`));
}

function tryResolve(specifier: string): string | undefined {
  try {
    return require.resolve(specifier);
  } catch {
    return undefined;
  }
}

/** Walk up from a resolved entry directory to the manifest that declares `packageName`. */
function findPackageRoot(from: string, packageName: string): string | undefined {
  let dir = from;
  for (;;) {
    const manifestPath = join(dir, "package.json");
    if (existsSync(manifestPath)) {
      try {
        if ((JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string }).name === packageName) return dir;
      } catch {
        // Unreadable or invalid manifest: keep walking.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
