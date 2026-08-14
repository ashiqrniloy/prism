import { createRequire } from "node:module";
import { accessSync, constants, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const MAX_SKILL_FILE_BYTES = 262_144;
export const MAX_CONFIG_FILE_BYTES = 16_384;
export const MAX_INJECTED_INSTRUCTION_BYTES = 32_768;

export const SKILLS_DIR_NAME = "skills";
export const PONYTAIL_PEER_PACKAGE = "@dietrichgebert/ponytail";
export const PONYTAIL_PEER_RANGE = "^4.8.4";

const MAX_ERROR_CHARS = 512;
const require = createRequire(import.meta.url);

export class UpstreamResolveError extends Error {
  readonly code = "upstream_resolve_failed" as const;

  constructor(message: string) {
    super(message);
    this.name = "UpstreamResolveError";
  }
}

export interface ResolveUpstreamRootOptions {
  /** Optional host-owned path; falls back to optional peer ${PONYTAIL_PEER_PACKAGE}. */
  readonly upstreamPath?: string;
  readonly packageName?: string;
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

function assertSkillsMarker(root: string): void {
  const skillsDir = join(root, SKILLS_DIR_NAME);
  try {
    accessSync(skillsDir, constants.R_OK);
    accessSync(skillsDir, constants.X_OK);
  } catch {
    throw new UpstreamResolveError(redactPaths("Upstream root is missing a readable skills/ directory", [root, skillsDir]));
  }
}

function resolvePeerPackageRoot(packageName: string): string {
  try {
    const pkgJson = require.resolve(`${packageName}/package.json`);
    return dirname(pkgJson);
  } catch {
    throw new UpstreamResolveError(redactPaths(`Could not resolve ${packageName}; install the optional peer or set upstreamPath`));
  }
}

/** Resolve Ponytail upstream root from `upstreamPath` or optional peer package. */
export function resolveUpstreamRoot(options: ResolveUpstreamRootOptions = {}): string {
  const packageName = options.packageName ?? PONYTAIL_PEER_PACKAGE;
  const raw = options.upstreamPath?.trim();

  const root = raw ? resolve(raw) : resolvePeerPackageRoot(packageName);
  assertSkillsMarker(root);
  return root;
}
