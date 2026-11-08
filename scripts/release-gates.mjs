// Offline pre-publish gates: API surface diff, tarball allow/deny, version ranges.
// Stdlib-only. Used by `release.mjs gate` and wired into `bun run sdk:ready`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { checkHostBuilderBudget, checkKernelBudget, loadBudgets, measureExportCounts, measureKernelSourceLines } from "./budget-gates.mjs";
import { classifyChange, displayKey, extractPackageSurface, PRODUCER_ONLY_TYPES, shapeDiff } from "./compat-shape.mjs";

export const BASELINE_DIR = "scripts/compat-baseline";
export { PRODUCER_ONLY_TYPES };

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

// First sentence-ish line of a JSDoc block, with tags and markup stripped; undefined when empty.
function docSummary(block) {
  const lines = block
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim());
  const body = [];
  for (const line of lines) {
    if (line.startsWith("@")) break;
    if (!line) {
      if (body.length) break;
      continue;
    }
    body.push(line);
  }
  const text = body
    .join(" ")
    .replace(/\{@(?:link|linkcode|linkplain)\s+([^}|\s]+)[^}]*\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  const sentence = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
  return sentence.length > 240 ? `${sentence.slice(0, 237)}...` : sentence;
}

// The declaration header with balanced brackets. A function, const or type ends at the first `;` outside
// brackets and strings, so an inline object parameter is not cut at its `{` the way the baseline text is.
// A class, interface, enum or namespace ends at its body `{`. Capped at 600 characters.
function richSignature(text, start, kind) {
  const bodyKinds = new Set(["class", "interface", "enum", "namespace", "module"]);
  let depth = 0;
  let quote = "";
  let index = start;
  for (; index < text.length && index - start < 4000; index++) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "{") {
      if (bodyKinds.has(kind) && depth === 0) break;
      depth++;
    } else if (char === "}") depth--;
    else if (char === ";" && depth <= 0) break;
  }
  const flat = text.slice(start, index).replace(/\s+/g, " ").trim();
  return flat.length > 600 ? `${flat.slice(0, 597)}...` : flat;
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

  // Additive model for the host-builder index (plan 215 Task 14): declarations tsc emits without
  // `declare` (`export interface`, `export type`), the leading doc comment of each declaration, and
  // the per-name source of a named re-export. `locals`, `named` and `stars` keep their meaning, so
  // the baseline text does not change.
  const typeLocals = new Map();
  const docs = new Map();
  const declDocs = (index) => {
    const before = text.slice(0, index).replace(/\s+$/, "");
    if (!before.endsWith("*/")) return undefined;
    const start = before.lastIndexOf("/**");
    return start === -1 ? undefined : docSummary(before.slice(start));
  };
  const typeRe = /^export (interface|type)\s+([A-Za-z0-9_$]+)/gm;
  while ((match = typeRe.exec(text))) {
    const name = match[2];
    if (!typeLocals.has(name)) typeLocals.set(name, richSignature(text, match.index, match[1]));
    const summary = declDocs(match.index);
    if (summary && !docs.has(name)) docs.set(name, summary);
  }
  const declKindRe =
    /export declare (?:abstract |async |readonly )*(function|class|const|let|var|enum|interface|type|namespace|module)\s+([A-Za-z0-9_$]+)/g;
  const rich = new Map();
  while ((match = declKindRe.exec(text))) {
    const name = match[2];
    if (!rich.has(name)) rich.set(name, richSignature(text, match.index, match[1]));
    const summary = declDocs(match.index);
    if (summary && !docs.has(name)) docs.set(name, summary);
  }
  const namedFrom = [];
  const fromRe = /export (type )?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  while ((match = fromRe.exec(text))) {
    const statementTypeOnly = Boolean(match[1]);
    for (const part of match[2]
      .split(",")
      .map((piece) => piece.trim())
      .filter(Boolean)) {
      const typeOnly = statementTypeOnly || /^type\s/.test(part);
      const pieces = part.replace(/^type\s+/, "").split(/\s+as\s+/);
      const original = pieces[0].trim();
      const exported = (pieces[1] ?? pieces[0]).trim();
      if (exported && exported !== "default") namedFrom.push({ exported, original, specifier: match[3], typeOnly });
    }
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

  return { locals, named, stars, typeLocals, rich, docs, namedFrom };
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

function kindOf(signature) {
  const declared = signature.match(
    /^export declare (?:abstract |async |readonly )*(function|class|const|let|var|enum|interface|type|namespace|module)\b/,
  );
  if (declared) return declared[1] === "module" ? "namespace" : declared[1];
  const plain = signature.match(/^export (interface|type)\b/);
  if (plain) return plain[1];
  return "reexport";
}

/**
 * The names reachable from one entry declaration file, each with `{ kind, signature, summary? }`.
 * Plan 215 Task 14: the host-builder index records the surface per `exports` subpath, where
 * `extractDeclaredSurface` above is a union over every emitted file. A local declaration wins over a
 * named re-export, which wins over a star re-export. A named re-export follows its relative specifier to
 * the declaration; a specifier outside the package keeps the re-export statement as its signature.
 */
export function extractEntrySurface(entryFile) {
  const cache = new Map();
  const active = new Set();
  function resolve(file) {
    if (cache.has(file)) return cache.get(file);
    if (active.has(file)) return new Map();
    active.add(file);
    const parsed = parseDeclarationFile(file);
    const result = new Map();
    for (const star of parsed.stars) {
      for (const [name, info] of resolve(star)) if (!result.has(name)) result.set(name, info);
    }
    for (const [name, signature] of parsed.named) {
      // `export * as ns from` is recorded in `named` as the full statement.
      if (/^export (?:type )?\* as /.test(signature)) result.set(name, { kind: "namespace", signature });
    }
    for (const { exported, original, specifier } of parsed.namedFrom) {
      const target = specifier.startsWith(".") ? resolveModuleFile(file, specifier) : undefined;
      const found = target ? resolve(target).get(original) : undefined;
      result.set(
        exported,
        found ?? {
          kind: "reexport",
          signature: `export { ${original === exported ? exported : `${original} as ${exported}`} } from "${specifier}"`,
        },
      );
    }
    for (const [name, signature] of parsed.locals) {
      const full = parsed.rich.get(name) ?? signature;
      const summary = parsed.docs.get(name);
      result.set(name, { kind: kindOf(signature), signature: full, ...(summary ? { summary } : {}) });
    }
    for (const [name, signature] of parsed.typeLocals) {
      const summary = parsed.docs.get(name);
      result.set(name, { kind: kindOf(signature), signature, ...(summary ? { summary } : {}) });
    }
    active.delete(file);
    cache.set(file, result);
    return result;
  }
  const out = resolve(entryFile);
  // A named re-export resolved through another file carries that file's summary already.
  return new Map([...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
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
 * Returns `{ distDir, declRoot }`, `{}` (manifest-only) or `{ error }`; never throws, so one gate run reports
 * every package that fails to emit instead of stopping at the first. The caller owns `cleanup` and
 * must run it in a `finally`, so `<pkg>/.types/` and the temp tsconfig never survive a run.
 */
export function declarationDir(root, pkg) {
  const distDir = join(root, pkg.path, "dist");
  // `declRoot` mirrors the package root, so an `exports` target maps to its declaration file under it.
  if (existsSync(distDir)) return { distDir, declRoot: join(root, pkg.path) };
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
  return { distDir: join(out, pkg.path), declRoot: join(out, pkg.path), cleanup };
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

/**
 * Per-name surface diff (plan 215 Task 28). `changed` holds breaking changes only; a change that is
 * additive by rule (new optional member, new overload, new member of a producer-only union) lands in
 * `compatible`. `diffs` maps every changed or compatible name to a unified diff of its normalized text.
 */
export function diffSurface(current, baseline, { producerOnly = PRODUCER_ONLY_TYPES } = {}) {
  const removed = [];
  const changed = [];
  const compatible = [];
  const added = [];
  const diffs = new Map();
  for (const [name, signature] of baseline) {
    if (!current.has(name)) removed.push(name);
    else if (current.get(name) !== signature) {
      (classifyChange(name, signature, current.get(name), producerOnly) === "compatible" ? compatible : changed).push(name);
      diffs.set(name, shapeDiff(signature, current.get(name)));
    }
  }
  for (const name of current.keys()) if (!baseline.has(name)) added.push(name);
  return {
    removed: removed.sort(),
    changed: changed.sort(),
    compatible: compatible.sort(),
    added: added.sort(),
    diffs,
  };
}

/** Readable gate detail for a diff: names plus the unified diff of every breaking change. */
export function describeBreak(diff) {
  const names = (keys) => keys.map(displayKey).join(", ");
  const summary = [
    diff.removed.length ? `removed: ${names(diff.removed)}` : "",
    diff.changed.length ? `changed: ${names(diff.changed)}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  const detail = diff.changed.map((key) => `  @@ ${displayKey(key)}\n${diff.diffs.get(key).replace(/^/gm, "  ")}`).join("\n");
  return { summary, detail };
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
  // Experimental packages (plan 215 Task 2) keep their baselines, but a removal or change is only
  // reported, in its own section: the line is outside the stability promise.
  const experimental = [];
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
      const { surface, missing } = extractPackageSurface(emitted.declRoot ?? distDir, pkg.manifest);
      if (missing.length) {
        errors.push(`compat: ${pkg.manifest.name} entries without a declaration file: ${missing.join(", ")}`);
        continue;
      }
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
      if (diff.compatible.length || diff.added.length) {
        const parts = [
          diff.compatible.length ? `compatible: ${diff.compatible.map(displayKey).join(", ")}` : "",
          diff.added.length ? `added: ${diff.added.map(displayKey).join(", ")}` : "",
        ];
        console.log(`compat (additive): ${pkg.manifest.name} ${parts.filter(Boolean).join("; ")}`);
      }
      if (diff.removed.length || diff.changed.length) {
        const noted = version ? migrationMentionsVersion(release.root, version) : true;
        const { summary: detail, detail: shapes } = describeBreak(diff);
        if (shapes) console.log(`compat: ${pkg.manifest.name} shape diff:\n${shapes}`);
        if (pkg.experimental) {
          experimental.push(`${pkg.manifest.name} ${detail}`);
          console.log(`compat (experimental, not gated): ${pkg.manifest.name} ${detail}`);
        } else if (allowBreak && noted) {
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
    let hostBuilderPack;
    for (const pkg of release.packages) {
      try {
        const packed = packStats(release.root, pkg.path);
        if (pkg.path === ".") rootPack = packed;
        if (pkg.manifest.name === "@arnilo/prism-host-builder") hostBuilderPack = packed;
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
    // 5. Host-builder size budget (plan 215 Task 14): its tarball carries the generated indexes.
    if (hostBuilderPack) {
      const measured = { packedBytes: hostBuilderPack.packedBytes, unpackedBytes: hostBuilderPack.unpackedBytes };
      for (const check of checkHostBuilderBudget(loadBudgets().hostBuilder, measured)) if (!check.ok) errors.push(check.message);
    }
  }

  if (errors.length) throw new Error(errors.join("\n"));
  return {
    version,
    updated: updateBaseline,
    packages: release.packages.length,
    ...(experimental.length ? { experimental } : {}),
  };
}
