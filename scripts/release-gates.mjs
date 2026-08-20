// Offline pre-publish gates: API surface diff, tarball allow/deny, version ranges.
// Stdlib-only. Used by `release.mjs gate` and wired into `npm run sdk:ready`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export const BASELINE_DIR = "scripts/compat-baseline";

// Paths that must never appear in a published tarball.
export const TARBALL_DENY_PATTERNS = [
  /(^|\/)code-reviews\//,
  /(^|\/)bug-reports\//,
  /(^|\/)plans\//,
  /(^|\/)scripts\/benchmark-/,
  /(^|\/)docs\/review-coverage-/,
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

export function packedFilePaths(root, pkgPath) {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: pkgPath === "." ? root : join(root, pkgPath),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`npm pack --dry-run failed for ${pkgPath}: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  return (parsed[0]?.files ?? []).map((f) => f.path.replace(/\\/g, "/"));
}

export function runGates({ release, version, independent = false, allowBreak = false, updateBaseline = false, skipTarball = false }) {
  // 1. Version-range drift (lockstep exact-graph, or independent range satisfaction).
  const errors = [];
  try {
    // validateRelease is injected by caller to avoid a circular import.
    if (independent) release.validateIndependent?.();
    else release.validate(version);
  } catch (error) {
    errors.push(`ranges: ${error.message}`);
  }

  // 2. API surface diff against checked-in baselines.
  const breaks = [];
  for (const pkg of release.packages) {
    const distDir = join(release.root, pkg.path, "dist");
    if (!existsSync(distDir)) {
      // Manifest-only profiles ship no code; nothing to diff.
      if (!pkg.manifest.types && !pkg.manifest.main && !pkg.manifest.exports) continue;
      errors.push(`compat: ${pkg.manifest.name} has no dist/ — run npm run build first`);
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
  }
  errors.push(...breaks);

  // 3. Tarball deny list.
  if (!skipTarball) {
    for (const pkg of release.packages) {
      try {
        assertTarballAllowDeny(pkg.manifest.name, packedFilePaths(release.root, pkg.path));
      } catch (error) {
        errors.push(`tarball: ${error.message}`);
      }
    }
  }

  if (errors.length) throw new Error(errors.join("\n"));
  return {
    version,
    updated: updateBaseline,
    packages: release.packages.length,
  };
}
