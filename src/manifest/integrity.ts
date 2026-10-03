import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ManifestError } from "./errors.js";
import type { ManifestScope } from "./format.js";

/** A package tree over these bounds is refused rather than hashed. */
export const MAX_TREE_FILES = 20_000;
export const MAX_TREE_BYTES = 256 * 1024 * 1024;
const READ_BATCH = 16;

interface Walked {
  readonly rel: string;
  readonly abs: string;
}

async function walk(root: string, scope: ManifestScope, name: string): Promise<Walked[]> {
  const files: Walked[] = [];
  const visit = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new ManifestError(
          "integrity_mismatch",
          `Package ${name} (${scope}) contains a symlink at ${rel.slice(0, 120)}, which is refused.`,
          {
            scope,
            package: name,
          },
        );
      }
      if (entry.isDirectory()) await visit(abs, rel);
      else if (entry.isFile()) {
        files.push({ rel, abs });
        if (files.length > MAX_TREE_FILES) {
          throw new ManifestError("integrity_mismatch", `Package ${name} (${scope}) has more than ${MAX_TREE_FILES} files.`, {
            scope,
            package: name,
          });
        }
      }
    }
  };
  await visit(root, "");
  return files;
}

/**
 * The canonical tree hash: SRI `sha512-<base64>` over every file's relative path, size, and bytes, in
 * byte-sorted path order. A symlink anywhere in the tree is refused, so a link cannot point the hash (or
 * the import) at bytes outside the package.
 */
export async function hashPackageTree(dir: string, context: { readonly scope: ManifestScope; readonly name: string }): Promise<string> {
  const { scope, name } = context;
  const files = await walk(dir, scope, name);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const hasher = createHash("sha512");
  let total = 0;
  // Read a batch at a time, hash in path order.
  for (let start = 0; start < files.length; start += READ_BATCH) {
    const batch = files.slice(start, start + READ_BATCH);
    const contents = await Promise.all(batch.map((file) => readFile(file.abs)));
    batch.forEach((file, index) => {
      const bytes = contents[index] as Buffer;
      total += bytes.length;
      if (total > MAX_TREE_BYTES) {
        throw new ManifestError("integrity_mismatch", `Package ${name} (${scope}) is larger than ${MAX_TREE_BYTES} bytes.`, {
          scope,
          package: name,
        });
      }
      hasher.update(`${file.rel}\0${bytes.length}\0`);
      hasher.update(bytes);
    });
  }
  return `sha512-${hasher.digest("base64")}`;
}

/** The installed package directory inside a scope's managed project. */
export function installedPackageDir(packagesDir: string, name: string): string {
  return join(packagesDir, "node_modules", ...name.split("/"));
}

/**
 * Recomputes the tree hash of an installed package and compares it with the recorded one, before any
 * `import()`. Fails closed as `package_missing` or `integrity_mismatch`, naming the package and scope.
 */
export async function verifyInstalled(
  entry: { readonly name: string; readonly integrity: string },
  packagesDir: string,
  scope: ManifestScope,
): Promise<void> {
  const dir = installedPackageDir(packagesDir, entry.name);
  let actual: string;
  try {
    actual = await hashPackageTree(dir, { scope, name: entry.name });
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") {
      throw new ManifestError("package_missing", `Package ${entry.name} (${scope}) is not installed in ${packagesDir}.`, {
        scope,
        package: entry.name,
      });
    }
    throw error;
  }
  if (actual !== entry.integrity) {
    throw new ManifestError("integrity_mismatch", `Package ${entry.name} (${scope}) does not match its recorded integrity hash.`, {
      scope,
      package: entry.name,
    });
  }
}
