import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { ManifestError } from "./errors.js";
import type { ManifestScope } from "./format.js";

/** A package tree over these bounds is refused rather than hashed. */
export const MAX_TREE_FILES = 20_000;
export const MAX_TREE_BYTES = 256 * 1024 * 1024;
export const MAX_CLOSURE_PACKAGES = 512;
const READ_BATCH = 16;

interface Walked {
  readonly rel: string;
  readonly abs: string;
}

export interface HashPackageTreeContext {
  readonly scope: ManifestScope;
  readonly name: string;
  readonly rootPackage?: string;
  readonly dependency?: string;
}

async function walk(root: string, context: HashPackageTreeContext): Promise<Walked[]> {
  const { scope, name, rootPackage, dependency } = context;
  const pkgName = rootPackage ?? name;
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink()) {
    throw new ManifestError(
      "integrity_mismatch",
      dependency
        ? `Package ${pkgName} (${scope}) dependency ${dependency} is a symlink, which is refused.`
        : `Package ${pkgName} (${scope}) is a symlink, which is refused.`,
      {
        scope,
        package: pkgName,
        ...(dependency ? { dependency } : {}),
      },
    );
  }
  const files: Walked[] = [];
  const visit = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new ManifestError(
          "integrity_mismatch",
          dependency
            ? `Package ${pkgName} (${scope}) dependency ${dependency} contains a symlink at ${rel.slice(0, 120)}, which is refused.`
            : `Package ${pkgName} (${scope}) contains a symlink at ${rel.slice(0, 120)}, which is refused.`,
          {
            scope,
            package: pkgName,
            ...(dependency ? { dependency } : {}),
          },
        );
      }
      if (entry.isDirectory()) await visit(abs, rel);
      else if (entry.isFile()) {
        files.push({ rel, abs });
        if (files.length > MAX_TREE_FILES) {
          throw new ManifestError(
            "integrity_mismatch",
            dependency
              ? `Package ${pkgName} (${scope}) dependency ${dependency} has more than ${MAX_TREE_FILES} files.`
              : `Package ${pkgName} (${scope}) has more than ${MAX_TREE_FILES} files.`,
            {
              scope,
              package: pkgName,
              ...(dependency ? { dependency } : {}),
            },
          );
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
export async function hashPackageTree(dir: string, context: HashPackageTreeContext): Promise<string> {
  const { scope, name, rootPackage, dependency } = context;
  const pkgName = rootPackage ?? name;
  const files = await walk(dir, context);
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
        throw new ManifestError(
          "integrity_mismatch",
          dependency
            ? `Package ${pkgName} (${scope}) dependency ${dependency} is larger than ${MAX_TREE_BYTES} bytes.`
            : `Package ${pkgName} (${scope}) is larger than ${MAX_TREE_BYTES} bytes.`,
          {
            scope,
            package: pkgName,
            ...(dependency ? { dependency } : {}),
          },
        );
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

async function resolveDependencyDir(
  depName: string,
  fromDir: string,
  packagesDir: string,
  rootName: string,
  scope: ManifestScope,
): Promise<string> {
  let curr = fromDir;
  const parts = depName.split("/");
  while (curr === packagesDir || curr.startsWith(`${packagesDir}/`)) {
    if (basename(curr) !== "node_modules") {
      const candidate = join(curr, "node_modules", ...parts);
      try {
        const st = await lstat(candidate);
        if (st.isSymbolicLink()) {
          throw new ManifestError(
            "integrity_mismatch",
            `Package ${rootName} (${scope}) dependency ${depName} is a symlink, which is refused.`,
            { scope, package: rootName, dependency: depName },
          );
        }
        if (st.isDirectory()) {
          try {
            await lstat(join(candidate, "package.json"));
            return candidate;
          } catch {
            // Not a package directory, continue walking up
          }
        }
      } catch (error) {
        if (error instanceof ManifestError) throw error;
      }
    }
    const parent = dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  throw new ManifestError(
    "package_missing",
    `Package ${rootName} (${scope}) dependency ${depName} is not installed in ${packagesDir}.`,
    { scope, package: rootName, dependency: depName },
  );
}

export interface HashPackageClosureOptions {
  readonly maxClosurePackages?: number;
}

/**
 * Computes the canonical integrity hash over an installed package and its full runtime dependency
 * closure (dependencies and non-optional peerDependencies), resolved via Node resolution within the
 * managed project. Each package is hashed with `hashPackageTree`, and the hashes are combined in
 * sorted package name order.
 */
export async function hashPackageClosure(
  packagesDir: string,
  rootName: string,
  scope: ManifestScope,
  options: HashPackageClosureOptions = {},
): Promise<string> {
  const maxClosurePackages = options.maxClosurePackages ?? MAX_CLOSURE_PACKAGES;
  const rootDir = installedPackageDir(packagesDir, rootName);

  try {
    const st = await lstat(rootDir);
    if (st.isSymbolicLink()) {
      throw new ManifestError(
        "integrity_mismatch",
        `Package ${rootName} (${scope}) is a symlink, which is refused.`,
        { scope, package: rootName },
      );
    }
    if (!st.isDirectory()) {
      throw new ManifestError(
        "package_missing",
        `Package ${rootName} (${scope}) is not installed in ${packagesDir}.`,
        { scope, package: rootName },
      );
    }
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ENOTDIR") {
      throw new ManifestError(
        "package_missing",
        `Package ${rootName} (${scope}) is not installed in ${packagesDir}.`,
        { scope, package: rootName },
      );
    }
    throw error;
  }

  const visitedDirs = new Set<string>();
  visitedDirs.add(rootDir);

  const packages: Array<{ readonly name: string; readonly dir: string; readonly dependency?: string }> = [
    { name: rootName, dir: rootDir },
  ];
  const queue: Array<{ readonly name: string; readonly dir: string; readonly dependency?: string }> = [
    { name: rootName, dir: rootDir },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    let pkgJson: Record<string, unknown>;
    try {
      const text = await readFile(join(current.dir, "package.json"), "utf8");
      pkgJson = JSON.parse(text);
    } catch {
      if (current.dependency) {
        throw new ManifestError(
          "package_missing",
          `Package ${rootName} (${scope}) dependency ${current.dependency} is not installed in ${packagesDir}.`,
          { scope, package: rootName, dependency: current.dependency },
        );
      }
      throw new ManifestError(
        "package_missing",
        `Package ${rootName} (${scope}) is not installed in ${packagesDir}.`,
        { scope, package: rootName },
      );
    }

    const dependencies = new Set<string>();
    if (pkgJson.dependencies && typeof pkgJson.dependencies === "object" && !Array.isArray(pkgJson.dependencies)) {
      for (const dep of Object.keys(pkgJson.dependencies)) {
        dependencies.add(dep);
      }
    }
    if (pkgJson.peerDependencies && typeof pkgJson.peerDependencies === "object" && !Array.isArray(pkgJson.peerDependencies)) {
      const meta =
        pkgJson.peerDependenciesMeta && typeof pkgJson.peerDependenciesMeta === "object" && !Array.isArray(pkgJson.peerDependenciesMeta)
          ? (pkgJson.peerDependenciesMeta as Record<string, { optional?: boolean }>)
          : {};
      for (const dep of Object.keys(pkgJson.peerDependencies)) {
        if (meta[dep]?.optional !== true) {
          dependencies.add(dep);
        }
      }
    }

    for (const dep of dependencies) {
      const depDir = await resolveDependencyDir(dep, current.dir, packagesDir, rootName, scope);
      if (!visitedDirs.has(depDir)) {
        if (packages.length >= maxClosurePackages) {
          throw new ManifestError(
            "integrity_mismatch",
            `Package ${rootName} (${scope}) dependency closure exceeds ${maxClosurePackages} packages.`,
            { scope, package: rootName },
          );
        }
        visitedDirs.add(depDir);
        const item = { name: dep, dir: depDir, dependency: dep };
        packages.push(item);
        queue.push(item);
      }
    }
  }

  const hashes: Array<{ readonly name: string; readonly hash: string; readonly dir: string }> = [];
  for (const pkg of packages) {
    const hash = await hashPackageTree(pkg.dir, {
      scope,
      name: pkg.name,
      rootPackage: rootName,
      dependency: pkg.dependency,
    });
    hashes.push({ name: pkg.name, hash, dir: pkg.dir });
  }

  hashes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
  const hasher = createHash("sha512");
  for (const item of hashes) {
    hasher.update(`${item.name}\0${item.hash}\0`);
  }
  return `sha512-${hasher.digest("base64")}`;
}

/**
 * Recomputes the closure hash of an installed package and compares it with the recorded one, before any
 * `import()`. Fails closed as `package_missing` or `integrity_mismatch`, naming the package and scope.
 */
export async function verifyInstalled(
  entry: { readonly name: string; readonly integrity: string },
  packagesDir: string,
  scope: ManifestScope,
  options: HashPackageClosureOptions = {},
): Promise<void> {
  let actual: string;
  try {
    actual = await hashPackageClosure(packagesDir, entry.name, scope, options);
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
    throw new ManifestError(
      "integrity_mismatch",
      `Package ${entry.name} (${scope}) does not match its recorded integrity hash; run 'prism add ${entry.name}' to reinstall.`,
      {
        scope,
        package: entry.name,
      },
    );
  }
}

