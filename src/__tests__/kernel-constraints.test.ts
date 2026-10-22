import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Plan 174 Task 10: the three kernel constraints. Each is a pure check over a root so the
// fixture below can prove it fails on a violation, not only that it passes today.
const ROOT = join(import.meta.dirname, "..", "..");

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function sourceFiles(root: string): string[] {
  return tsFiles(join(root, "src")).filter((file) => !file.includes("__tests__"));
}

// `import ... from "x"`, `export ... from "x"` (the clause cannot contain a quote, so prose
// and strings are not jumped into), a bare `import "x"`, and `import("x")`.
const STATIC_FROM = /^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom[ \t]*[`"']([^`"'\n]+)[`"']/gm;
const SIDE_EFFECT = /^[ \t]*import[ \t]*[`"']([^`"'\n]+)[`"']/gm;
const DYNAMIC = /\bimport[ \t]*\([ \t]*[`"']([^`"'\n]+)[`"']/g;

function importSpecifiers(root: string): { file: string; specifier: string }[] {
  const found: { file: string; specifier: string }[] = [];
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, "utf8");
    for (const pattern of [STATIC_FROM, SIDE_EFFECT, DYNAMIC])
      for (const match of text.matchAll(pattern)) {
        // A template substitution is a computed specifier: `kernel_imports_no_computed_specifier` owns it.
        if (match[1].includes("${")) continue;
        found.push({ file, specifier: match[1] });
      }
  }
  return found;
}

// Relative and absolute path specifiers cannot name a package; `node:*`/`bun`/`bun:*` are the
// only bare specifiers the Bun runtime provides without a dependency.
function isBuiltinSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier === "bun" ||
    specifier.startsWith("bun:") ||
    specifier.startsWith("node:")
  );
}

// A specifier built at runtime can name a package the kernel does not declare, which is the one
// thing `kernel_imports_only_builtins` cannot see. The single allowed form resolves to an
// absolute `file:` URL (manifest/definition.ts imports an installed package by its integrity-pinned
// path), so it can never reach a bare specifier.
const COMPUTED = /\b(?:import|require)\s*\(\s*([^)]*)/g;

function isComputedArgument(raw: string): boolean {
  const argument = raw.trim();
  if (argument.includes("pathToFileURL(")) return false; // resolves to a file: URL, never a bare specifier
  if (argument.startsWith('"') || argument.startsWith("'")) return false; // plain string literal
  if (argument.startsWith("`")) {
    if (!argument.includes("${")) return false; // a template with no substitution is a literal
    const head = argument.slice(1).split("${")[0];
    if (head.startsWith(".") || head.startsWith("/")) return false; // relative prefix stays relative
  }
  return true;
}

function computedSpecifiers(root: string): { file: string; call: string }[] {
  const found: { file: string; call: string }[] = [];
  for (const file of sourceFiles(root)) {
    const text = readFileSync(file, "utf8");
    // `require` is also an ordinary method name (driver-kit profiles, package services);
    // only a `createRequire`d module require can load a specifier.
    const moduleRequire = text.includes("createRequire(");
    for (const match of text.matchAll(COMPUTED)) {
      if (match[0].startsWith("require") && !moduleRequire) continue;
      // An empty argument is prose (`import()` in a comment), not a call.
      if (!match[1].trim()) continue;
      if (!isComputedArgument(match[1])) continue;
      found.push({ file, call: match[0] });
    }
  }
  return found;
}

const RUNTIME_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies", "bundleDependencies"];

function runtimeDependencyFields(root: string): string[] {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return RUNTIME_FIELDS.filter((field) => {
    const value = manifest[field];
    return value !== undefined && (typeof value !== "object" || value === null || Object.keys(value).length > 0);
  });
}

function fixture(manifest: Record<string, unknown>, sources: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "prism-kernel-"));
  writeFileSync(join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [path, text] of Object.entries(sources)) {
    mkdirSync(dirname(join(root, "src", path)), { recursive: true });
    writeFileSync(join(root, "src", path), text);
  }
  return root;
}

describe("kernel constraints", () => {
  it("kernel_has_no_runtime_dependencies", () => {
    assert.deepEqual(
      runtimeDependencyFields(ROOT),
      [],
      "the kernel must declare no dependencies, peerDependencies, optionalDependencies, or bundleDependencies",
    );
    const root = fixture({ name: "@arnilo/prism", version: "0.13.0", dependencies: { zod: "^3" } }, {});
    try {
      assert.deepEqual(runtimeDependencyFields(root), ["dependencies"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("kernel_imports_only_builtins", () => {
    const offenders = importSpecifiers(ROOT).filter((hit) => !isBuiltinSpecifier(hit.specifier));
    assert.deepEqual(
      offenders,
      [],
      `kernel source must import only relative paths, node:*, bun, or bun:*:\n${offenders.map((o) => `${o.file}: ${o.specifier}`).join("\n")}`,
    );
    const root = fixture({ name: "@arnilo/prism" }, { "index.ts": 'import { z } from "zod";\n' });
    try {
      assert.deepEqual(
        importSpecifiers(root).filter((hit) => !isBuiltinSpecifier(hit.specifier)),
        [{ file: join(root, "src", "index.ts"), specifier: "zod" }],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("kernel_imports_no_computed_specifier", () => {
    const offenders = computedSpecifiers(ROOT);
    assert.deepEqual(
      offenders,
      [],
      `a specifier built at runtime can reach an undeclared package:\n${offenders.map((o) => `${o.file}: ${o.call}`).join("\n")}`,
    );
    const root = fixture({ name: "@arnilo/prism" }, { "index.ts": 'const name = "@arnilo/prism-core";\nawait import(name);\n' });
    try {
      assert.equal(computedSpecifiers(root).length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
