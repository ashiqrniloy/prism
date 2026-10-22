// Offline pre-publish gates: API surface diff, tarball allow/deny, version ranges.
// Stdlib-only. Used by `release.mjs gate` and wired into `bun run sdk:ready`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { checkKernelBudget, loadBudgets, measureExportCounts, measureKernelSourceLines } from "./budget-gates.mjs";

export const BASELINE_DIR = "scripts/compat-baseline";

// Paths that must never appear in a published tarball.
export const TARBALL_DENY_PATTERNS = [
  /(^|\/)code-reviews\//,
  /(^|\/)bug-reports\//,
  /(^|\/)plans\//,
  /(^|\/)scripts\/benchmark-/,
  /(^|\/)docs\/review-coverage-/,
  /(^|\/)docs\/_evidence\//,
  /(^|\/)docs\/release-.*-evidence\.md$/,
  /(^|\/)docs\/api-page-template\.md$/,
  /(^|\/)__tests__\//,
  /\.map$/,
  // Unexpected file types: binaries, native modules, and credential material
  // must never ship in a published artifact (plan 012 Task 6 negative fixture).
  /\.(exe|dll|so|dylib|node|a|o|pem|key|p12|pfx|cer|jks|keystore)$/i,
];

export function baselineName(manifestName) {
  return `${manifestName.replace("@", "").replace("/", "__")}.txt`;
}

function collapse(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

// Resolve "./x.js" / "./x" relative to a .d.ts file to an existing .d.ts path.
function resolveModuleFile(fromFile, specifier) {
  const base = join(dirname(fromFile), specifier).replace(/\.js$/, "");
  for (const candidate of [`${base}.d.ts`, join(base, "index.d.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

// Extract exported names from `export { a, b as c } from "..."` statements.
function reexportNames(statement) {
  const inner = statement.match(/\{([^}]*)\}/)?.[1] ?? "";
  return inner
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const as = part.split(/\s+as\s+/);
      return (as[1] ?? as[0]).trim();
    })
    .filter((name) => name && name !== "default");
}

// Parse one .d.ts file. Returns { locals: Map<name, signature>, stars: [file], named: Map<name, signature> }.
export function parseDeclarationFile(file, text = readFileSync(file, "utf8")) {
  const locals = new Map();
  const named = new Map();
  const stars = [];

  // Local declarations: export declare function|class|const|... Name ... (; or {)
  const declRe =
    /export declare (?:abstract |async |readonly )*(?:function|class|const|let|var|enum|interface|type|namespace|module)\s+([A-Za-z0-9_$]+)/g;
  let match;
  while ((match = declRe.exec(text))) {
    const name = match[1];
    const start = match.index;
    let end = text.indexOf(";", start);
    const brace = text.indexOf("{", start);
    if (brace !== -1 && (end === -1 || brace < end)) end = brace;
    const signature = collapse(end === -1 ? text.slice(start, start + 500) : text.slice(start, end));
    if (!locals.has(name)) locals.set(name, signature);
  }

  // export default
  if (/export default\b/.test(text) && !locals.has("default")) locals.set("default", "export default");

  // Named re-exports: export { ... } from "..."; export type { ... } from "..."; export * as ns from "..."
  const stmtRe = /export (?:type )?(?:\* as ([A-Za-z0-9_$]+)|\{[^}]*\})\s*from\s*["']([^"']+)["']/g;
  while ((match = stmtRe.exec(text))) {
    const [, ns, specifier] = match;
    if (ns) {
      if (!named.has(ns)) named.set(ns, collapse(match[0]));
      continue;
    }
    const signature = collapse(match[0]);
    for (const name of reexportNames(match[0])) {
      if (!named.has(name)) named.set(name, signature);
    }
    void specifier;
  }

  // Star re-exports: export * from "..."; export type * from "..."
  const starRe = /export (?:type )?\*\s*from\s*["']([^"']+)["']/g;
  while ((match = starRe.exec(text))) {
    const target = resolveModuleFile(file, match[1]);
    if (target) stars.push(target);
  }

  return { locals, named, stars };
}

// Union surface of every .d.ts under distDir, resolving star re-exports within the package.
export function extractDeclaredSurface(distDir) {
  const surface = new Map();
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".d.ts")) files.push(full);
    }
  })(distDir);

  const visited = new Set();
  function visit(file) {
    if (visited.has(file)) return;
    visited.add(file);
    const { locals, named, stars } = parseDeclarationFile(file);
    for (const star of stars) visit(star);
    for (const [name, signature] of named) if (!surface.has(name)) surface.set(name, signature);
    for (const [name, signature] of locals) surface.set(name, signature);
  }
  for (const file of files.sort()) visit(file);
  return surface;
}

function sourceEntry(manifest) {
  const exp = manifest.exports?.["."];
  const target = typeof exp === "string" ? exp : exp?.default;
  return typeof target === "string" && target.endsWith(".ts") ? target : undefined;
}

/**
 * `dist/` when the package builds, otherwise a declaration emit for a TypeScript-source export.
 * Plan 174 Task 8: the kernel is a TypeScript-source package too, so `@arnilo/prism` takes the
 * emit path — there is no `dist/` for it any more.
 * Returns `{ distDir }`, `{}` (manifest-only) or `{ error }`; never throws, so one gate run reports
 * every package that fails to emit instead of stopping at the first. The caller owns `cleanup` and
 * must run it in a `finally`, so `<pkg>/.types/` and the temp tsconfig never survive a run.
 */
function declarationDir(root, pkg) {
  const distDir = join(root, pkg.path, "dist");
  if (existsSync(distDir)) return { distDir };
  const entry = sourceEntry(pkg.manifest);
  if (!entry) return {};
  const pkgDir = join(root, pkg.path);
  const out = join(pkgDir, ".types");
  const configPath = join(pkgDir, ".types-tsconfig.json");
  const cleanup = () => {
    rmSync(out, { recursive: true, force: true });
    rmSync(configPath, { force: true });
  };
  cleanup();
  // Extend the package's own tsconfig so the emit sees the same paths, types and
  // module settings as `typecheck`; fall back to the shared packages config.
  const ownConfig = join(pkgDir, "tsconfig.json");
  const base = existsSync(ownConfig) ? "./tsconfig.json" : relative(pkgDir, join(root, "tsconfig.packages.json"));
  writeFileSync(
    configPath,
    JSON.stringify({
      extends: base,
      compilerOptions: {
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: ".types",
        // The kernel publishes TypeScript source (plan 174 Task 8), so a package's program includes
        // the kernel's `.ts` files and the common source directory is the repo root. Pin `rootDir`
        // there — leaving it out fails TS5011 — and read the package's own declarations back out of
        // the nested path in `.types`. The kernel's declarations land in the same throwaway tree.
        rootDir: relative(pkgDir, root),
      },
      include: ["src"],
      exclude: ["src/**/__tests__"],
    }),
  );
  const result = spawnSync("bun", ["x", "tsc", "-p", configPath], { cwd: pkgDir, encoding: "utf8" });
  if (result.status !== 0) {
    return { error: `compat: ${pkg.manifest.name} declaration emit failed:\n${result.stdout}\n${result.stderr}`, cleanup };
  }
  return { distDir: join(out, pkg.path), cleanup };
}

export function serializeSurface(surface) {
  return `${[...surface.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, signature]) => `${name}\t${signature}`)
    .join("\n")}\n`;
}

export function parseSurface(text) {
  const surface = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    surface.set(tab === -1 ? line : line.slice(0, tab), tab === -1 ? "" : line.slice(tab + 1));
  }
  return surface;
}

export function diffSurface(current, baseline) {
  const removed = [];
  const changed = [];
  const added = [];
  for (const [name, signature] of baseline) {
    if (!current.has(name)) removed.push(name);
    else if (current.get(name) !== signature) changed.push(name);
  }
  for (const name of current.keys()) if (!baseline.has(name)) added.push(name);
  return {
    removed: removed.sort(),
    changed: changed.sort(),
    added: added.sort(),
  };
}

export function migrationMentionsVersion(root, version) {
  const file = join(root, "docs/migration.md");
  return existsSync(file) && readFileSync(file, "utf8").includes(version);
}

// Pure tarball check: list of packed file paths (relative, forward slashes).
export function assertTarballAllowDeny(pkgName, filePaths) {
  const violations = filePaths.filter((path) => TARBALL_DENY_PATTERNS.some((re) => re.test(path)));
  if (violations.length) {
    throw new Error(
      `${pkgName} tarball contains denied paths:\n${violations
        .sort()
        .map((v) => `  ${v}`)
        .join("\n")}`,
    );
  }
  return true;
}

/**
 * Packs one package for real and returns its file list, packed bytes, and unpacked bytes.
 * The kernel budget (plan 174 Task 10) reads the root pack from here, so the tarball the
 * deny list inspects is also the tarball the size budget measures — one pack, not two.
 */
export function packStats(root, pkgPath) {
  // Bun-only: pack the real tarball, then list its bytes. `bun pm pack --dry-run`
  // prints no machine-readable list on Bun 1.4.2, and the destination tarball is
  // the same artifact Task 8.4 attests and publishes, so the deny check inspects
  // exactly what the registry would receive.
  const cwd = pkgPath === "." ? root : join(root, pkgPath);
  const destination = mkdtempSync(join(tmpdir(), "prism-pack-"));
  try {
    const result = spawnSync("bun", ["pm", "pack", "--destination", destination], { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`bun pm pack failed for ${pkgPath}: ${result.stderr || result.stdout}`);
    const tarballs = readdirSync(destination).filter((name) => name.endsWith(".tgz"));
    if (tarballs.length !== 1) throw new Error(`bun pm pack produced ${tarballs.length} tarballs for ${pkgPath}`);
    const tarball = join(destination, tarballs[0]);
    const listing = spawnSync("tar", ["-tvzf", tarball], { encoding: "utf8" });
    if (listing.status !== 0) throw new Error(`tar listing failed for ${pkgPath}: ${listing.stderr}`);
    const files = [];
    let unpackedBytes = 0;
    for (const line of listing.stdout.split("\n")) {
      // `-rw-r--r-- 0/0 1234 2026-10-15 15:00 package/src/index.ts`
      const match = line.match(/^\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.+)$/);
      if (!match) continue;
      files.push(match[2].replace(/^package\//, ""));
      unpackedBytes += Number(match[1]);
    }
    return { files, packedBytes: statSync(tarball).size, unpackedBytes };
  } finally {
    rmSync(destination, { recursive: true, force: true });
  }
}

export function packedFilePaths(root, pkgPath) {
  return packStats(root, pkgPath).files;
}

export function runGates({
  release,
  version,
  independent = false,
  allowBreak = false,
  updateBaseline = false,
  skipTarball = false,
  packageName,
  kernelBudget,
}) {
  // 1. Version-range drift (lockstep exact-graph, or independent range satisfaction).
  const errors = [];
  try {
    // validateRelease is injected by caller to avoid a circular import.
    if (independent) release.validateIndependent?.();
    else release.validate(version);
  } catch (error) {
    errors.push(`ranges: ${error.message}`);
  }

  // 2. API surface diff against checked-in baselines. A declaration emit that fails
  // is collected, not thrown, so one run names every failing package.
  const breaks = [];
  for (const pkg of release.packages) {
    if (packageName && pkg.manifest.name !== packageName) continue;
    const emitted = declarationDir(release.root, pkg);
    try {
      if (emitted.error) {
        errors.push(emitted.error);
        continue;
      }
      const distDir = emitted.distDir;
      if (!distDir) {
        // Manifest-only profiles ship no code; nothing to diff.
        if (!pkg.manifest.types && !pkg.manifest.main && !pkg.manifest.exports) continue;
        errors.push(`compat: ${pkg.manifest.name} has no dist/ and no TypeScript-source export — run bun run build first`);
        continue;
      }
      const surface = extractDeclaredSurface(distDir);
      const baselinePath = join(release.root, BASELINE_DIR, baselineName(pkg.manifest.name));
      if (updateBaseline) {
        mkdirSync(dirname(baselinePath), { recursive: true });
        writeFileSync(baselinePath, serializeSurface(surface));
        continue;
      }
      if (!existsSync(baselinePath)) {
        errors.push(`compat: missing baseline ${relative(release.root, baselinePath)} — run with --update-baseline after review`);
        continue;
      }
      const diff = diffSurface(surface, parseSurface(readFileSync(baselinePath, "utf8")));
      if (diff.removed.length || diff.changed.length) {
        const noted = version ? migrationMentionsVersion(release.root, version) : true;
        const detail = [
          diff.removed.length ? `removed: ${diff.removed.join(", ")}` : "",
          diff.changed.length ? `changed: ${diff.changed.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; ");
        if (allowBreak && noted) {
          console.log(`compat: ${pkg.manifest.name} documented break (${detail})`);
        } else {
          breaks.push(
            `compat: ${pkg.manifest.name} ${detail}${noted ? "" : ` (no ${version} note in docs/migration.md)`} — fix or pass --allow-break with migration note`,
          );
        }
      }
    } finally {
      emitted.cleanup?.();
    }
  }
  errors.push(...breaks);

  // 3. Tarball deny list, and the kernel size budget from the root pack it makes.
  if (!skipTarball) {
    let rootPack;
    for (const pkg of release.packages) {
      try {
        const packed = packStats(release.root, pkg.path);
        if (pkg.path === ".") rootPack = packed;
        assertTarballAllowDeny(pkg.manifest.name, packed.files);
      } catch (error) {
        errors.push(`tarball: ${error.message}`);
      }
    }
    // 4. Kernel size budget (plan 174 Task 10): packed/unpacked bytes, file count,
    // root exports, and non-test src lines, each a strict ceiling.
    if (rootPack) {
      const budget = kernelBudget ?? loadBudgets().kernel;
      const measured = {
        packedBytes: rootPack.packedBytes,
        unpackedBytes: rootPack.unpackedBytes,
        fileCount: rootPack.files.length,
        rootExports: measureExportCounts(release.root)["@arnilo/prism"] ?? 0,
        sourceLines: measureKernelSourceLines(release.root),
      };
      for (const check of checkKernelBudget(budget, measured)) if (!check.ok) errors.push(check.message);
    }
  }

  if (errors.length) throw new Error(errors.join("\n"));
  return {
    version,
    updated: updateBaseline,
    packages: release.packages.length,
  };
}
