import { isAbsolute, relative, resolve } from "node:path";

/** Absolute sandbox root with bounded read/write operations. */
export interface WorkSandboxFilesystem {
  readonly root: string;
  readFile(path: string, options: { readonly maxBytes: number; readonly signal?: AbortSignal }): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array, options: { readonly maxBytes: number; readonly signal?: AbortSignal }): Promise<void>;
  /** Required by backends that expose host paths. */
  readonly assertPathInsideRoots?: (roots: readonly string[], target: string) => Promise<boolean>;
}

export async function resolveSandboxPath(filesystem: WorkSandboxFilesystem, path: string): Promise<string> {
  if (isAbsolute(path)) throw new TypeError("sandbox path must be relative");
  const target = resolve(filesystem.root, path);
  const rel = relative(resolve(filesystem.root), target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new TypeError("sandbox path escapes the configured root");
  if (filesystem.assertPathInsideRoots && !(await filesystem.assertPathInsideRoots([filesystem.root], target))) {
    throw new TypeError("sandbox path escapes the configured root");
  }
  return target;
}
