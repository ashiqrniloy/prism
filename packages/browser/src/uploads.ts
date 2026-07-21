/**
 * Realpath-contained upload path approval for browser file inputs.
 */
import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { BrowserError } from "./errors.js";
import type { ResolvedBrowserLimits } from "./limits.js";

export interface BrowserUploadOptions {
  /** Absolute workspace roots that may contribute upload files. */
  readonly roots: readonly string[];
  /** Per-file byte cap override (still clamped by resolved limits). */
  readonly maxBytes?: number;
}

export interface ApprovedUploadFile {
  readonly path: string;
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface UploadBudget {
  count: number;
  aggregateBytes: number;
}

export function createUploadBudget(): UploadBudget {
  return { count: 0, aggregateBytes: 0 };
}

function isPathInside(root: string, target: string): boolean {
  const from = resolve(root);
  const to = resolve(target);
  const rel = relative(from, to);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function assertInsideRoots(roots: readonly string[], target: string): Promise<string> {
  if (!isAbsolute(target)) {
    throw new BrowserError("ERR_PRISM_BROWSER_ARTIFACT", "upload path must be absolute");
  }
  let targetReal: string;
  try {
    targetReal = await realpath(target);
  } catch {
    throw new BrowserError("ERR_PRISM_BROWSER_ARTIFACT", "upload path does not exist");
  }
  for (const root of roots) {
    if (!isAbsolute(root)) {
      throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "upload root must be absolute");
    }
    let rootReal: string;
    try {
      rootReal = await realpath(root);
    } catch {
      continue;
    }
    if (isPathInside(rootReal, targetReal)) return targetReal;
  }
  throw new BrowserError("ERR_PRISM_BROWSER_ARTIFACT", "upload path escapes approved roots");
}

export async function approveUploadPaths(
  paths: readonly string[],
  options: BrowserUploadOptions,
  limits: ResolvedBrowserLimits,
  budget: UploadBudget,
): Promise<readonly ApprovedUploadFile[]> {
  if (!options.roots.length) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "uploads.roots is required before upload");
  }
  if (paths.length === 0) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "upload requires at least one path");
  }
  if (budget.count + paths.length > limits.maxUploads) {
    throw new BrowserError("ERR_PRISM_BROWSER_LIMIT", `maxUploads ${limits.maxUploads} exceeded`);
  }

  const perFileCap = Math.min(options.maxBytes ?? limits.maxUploadBytes, limits.maxUploadBytes);
  const approved: ApprovedUploadFile[] = [];

  for (const raw of paths) {
    if (typeof raw !== "string" || !raw) {
      throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "upload path must be a non-empty string");
    }
    const abs = isAbsolute(raw) ? raw : resolve(raw);
    // Reject symlink escapes: lstat the leaf; realpath for containment of final target.
    let leafStat;
    try {
      leafStat = await lstat(abs);
    } catch {
      throw new BrowserError("ERR_PRISM_BROWSER_ARTIFACT", `upload path not found: ${basename(abs)}`);
    }
    if (leafStat.isSymbolicLink()) {
      // Allow only if the resolved target stays inside roots.
      const parentReal = await realpath(dirname(abs)).catch(() => undefined);
      if (!parentReal) {
        throw new BrowserError("ERR_PRISM_BROWSER_ARTIFACT", "upload symlink parent is unresolvable");
      }
    }
    if (!leafStat.isFile() && !leafStat.isSymbolicLink()) {
      throw new BrowserError("ERR_PRISM_BROWSER_ARTIFACT", "upload path must be a regular file");
    }

    const real = await assertInsideRoots(options.roots, abs);
    const stat = await lstat(real);
    if (!stat.isFile()) {
      throw new BrowserError("ERR_PRISM_BROWSER_ARTIFACT", "upload path must resolve to a regular file");
    }
    if (stat.size > perFileCap) {
      throw new BrowserError(
        "ERR_PRISM_BROWSER_LIMIT",
        `upload exceeds maxUploadBytes ${perFileCap}`,
      );
    }
    if (budget.aggregateBytes + stat.size > limits.maxUploadAggregateBytes) {
      throw new BrowserError(
        "ERR_PRISM_BROWSER_LIMIT",
        `upload exceeds maxUploadAggregateBytes ${limits.maxUploadAggregateBytes}`,
      );
    }

    const hash = createHash("sha256");
    const handle = await open(real, "r");
    try {
      const buf = Buffer.alloc(64 * 1024);
      let remaining = stat.size;
      while (remaining > 0) {
        const { bytesRead } = await handle.read(buf, 0, Math.min(buf.length, remaining), null);
        if (bytesRead <= 0) break;
        hash.update(buf.subarray(0, bytesRead));
        remaining -= bytesRead;
      }
    } finally {
      await handle.close();
    }

    approved.push({
      path: real,
      name: basename(real),
      bytes: stat.size,
      sha256: hash.digest("hex"),
    });
    budget.count += 1;
    budget.aggregateBytes += stat.size;
  }

  return approved;
}

/** Join a relative upload path under the first root (host convenience). */
export function resolveUploadCandidate(root: string, relativePath: string): string {
  if (!isAbsolute(root)) {
    throw new BrowserError("ERR_PRISM_BROWSER_INPUT", "upload root must be absolute");
  }
  if (isAbsolute(relativePath) || relativePath.includes("\0") || /(^|[\\/])\.\.([\\/]|$)/.test(relativePath)) {
    throw new BrowserError("ERR_PRISM_BROWSER_ARTIFACT", "upload relative path is invalid");
  }
  return join(root, relativePath);
}
