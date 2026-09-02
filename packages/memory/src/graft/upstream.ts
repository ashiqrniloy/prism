import { accessSync, constants, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const MAX_ERROR_CHARS = 512;

/** Ceiling for files Prism reads from a graft checkout/graph (INDEX.md orientation etc.). */
export const MAX_GRAPH_FILE_BYTES = 262_144;

export const GRAFT_PEER_PACKAGE = "@nanonets/graft";
export const GRAFT_PEER_RANGE = "^0.16.0";
export const GRAFT_RESOLVE_ERROR_CODE = "graft_resolve_failed";

const require = createRequire(import.meta.url);

export class GraftResolveError extends Error {
  readonly code = "graft_resolve_failed" as const;

  constructor(message: string) {
    super(message);
    this.name = "GraftResolveError";
  }
}

export interface ResolveGraftCliOptions {
  /** Explicit path to a `graft` CLI entry (native executable or JS file); wins over all else. */
  readonly cliPath?: string;
  /** Host-owned path to an installed `@nanonets/graft` package root; bin is read from its manifest. */
  readonly packageRoot?: string;
  readonly packageName?: string;
}

/**
 * A resolved way to invoke the graft CLI.
 * - `explicit`: run `command` with the call's own argv appended.
 * - `peer-bin`: run `process.execPath <manifest bin>` with the call's argv appended
 *   (the npm `bin` target of `@nanonets/graft`).
 */
export interface ResolvedGraftCli {
  readonly kind: "explicit" | "peer-bin";
  readonly command: string;
  readonly args: readonly string[];
}

/** Redact absolute paths and home directory segments from upstream errors. */
export function redactPaths(text: string, paths: readonly string[] = []): string {
  let out = text;
  for (const path of paths) {
    if (!path) continue;
    out = out.split(path).join("<path>");
    const resolvedPath = resolve(path);
    if (resolvedPath !== path) out = out.split(resolvedPath).join("<path>");
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
    throw new GraftResolveError(redactPaths("Path escapes graph root", [filePath, normalizedRoot]));
  }
  const data = readFileSync(filePath);
  if (data.byteLength > maxBytes) {
    throw new GraftResolveError(redactPaths(`File exceeds ${maxBytes} byte cap`, [filePath]));
  }
  return data.toString("utf8");
}

function assertExecutableFile(path: string): void {
  try {
    accessSync(path, constants.R_OK);
  } catch {
    throw new GraftResolveError(redactPaths("Graft CLI entry is not readable", [path]));
  }
}

function readPeerBin(packageRoot: string): ResolvedGraftCli {
  const manifestPath = join(packageRoot, "package.json");
  let manifest: { bin?: Record<string, string> | string };
  try {
    manifest = JSON.parse(readBoundedFile(packageRoot, "package.json", MAX_GRAPH_FILE_BYTES));
  } catch (error) {
    if (error instanceof GraftResolveError) throw error;
    throw new GraftResolveError(redactPaths("Package root has no readable package.json", [manifestPath]));
  }
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.graft;
  if (typeof bin !== "string" || bin.trim() === "") {
    throw new GraftResolveError(redactPaths("Package root declares no graft bin", [manifestPath]));
  }
  const binPath = resolve(packageRoot, bin);
  assertExecutableFile(binPath);
  return { kind: "peer-bin", command: process.execPath, args: [binPath] };
}

function resolvePeerPackageRoot(packageName: string): string {
  try {
    const pkgJson = require.resolve(`${packageName}/package.json`);
    return dirname(pkgJson);
  } catch {
    throw new GraftResolveError(redactPaths(`Could not resolve ${packageName}; install the optional peer or set cliPath/packageRoot`));
  }
}

/**
 * Resolve how to invoke the graft CLI:
 * 1. explicit `cliPath` (used verbatim — host-owned responsibility),
 * 2. host-owned `packageRoot` (bin read from that manifest),
 * 3. optional peer `${GRAFT_PEER_PACKAGE}` resolved from the module graph.
 * Fails closed with a redacted {@link GraftResolveError} when none apply.
 */
export function resolveGraftCli(options: ResolveGraftCliOptions = {}): ResolvedGraftCli {
  const rawCliPath = options.cliPath?.trim();
  if (rawCliPath) {
    if (!isAbsolute(rawCliPath)) {
      throw new GraftResolveError("cliPath must be absolute");
    }
    assertExecutableFile(rawCliPath);
    return { kind: "explicit", command: rawCliPath, args: [] };
  }

  const rawPackageRoot = options.packageRoot?.trim();
  if (rawPackageRoot) return readPeerBin(resolve(rawPackageRoot));

  return readPeerBin(resolvePeerPackageRoot(options.packageName ?? GRAFT_PEER_PACKAGE));
}
