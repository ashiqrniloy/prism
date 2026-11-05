import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error stdlib-only release tooling intentionally ships as runnable JavaScript.
import { loadRelease } from "../../scripts/release.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Plan 215 Task 3: the experimental memory line (scripts/independent-packages.json `experimental`) sits outside the
 * stability promise, so no stable package may depend on it or ship source that imports it. A `devDependency`
 * used only by `__tests__` is allowed: it is never installed by a consumer and never ships in `src/`.
 */

interface BoundaryPackage {
  readonly path: string;
  readonly manifest: {
    readonly name: string;
    readonly private?: boolean;
    readonly dependencies?: Record<string, string>;
    readonly optionalDependencies?: Record<string, string>;
    readonly peerDependencies?: Record<string, string>;
  };
}

const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"] as const;
const SKIP_DIRS = new Set(["__tests__", "node_modules", "dist"]);

function experimentalSet(root: string): Set<string> {
  const file = join(root, "scripts", "independent-packages.json");
  const data = JSON.parse(readFileSync(file, "utf8")) as { experimental?: string[] };
  return new Set(data.experimental ?? []);
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...sourceFiles(join(dir, entry.name)));
    } else if (/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const escape = (name: string): string => name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Every experimental specifier a source text imports: static, type-only, re-export, bare, or literal dynamic. */
function experimentalImports(text: string, experimental: ReadonlySet<string>): string[] {
  if (experimental.size === 0) return [];
  const names = [...experimental].map(escape).join("|");
  const specifier = `["'](${names})(?:/[^"']*)?["']`;
  const patterns = [
    new RegExp(`^[ \\t]*(?:import|export)\\b[^;]*?\\bfrom\\s*${specifier}`, "gm"),
    new RegExp(`^[ \\t]*import\\s*${specifier}`, "gm"),
    new RegExp(`\\bimport\\s*\\(\\s*${specifier}\\s*\\)`, "g"),
  ];
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const lineStart = text.lastIndexOf("\n", match.index) + 1;
      // A dynamic import named in a `//` or block comment is prose, not an import.
      if (/^[ \t]*(?:\/\/|\/?\*)/.test(text.slice(lineStart, match.index + match[0].length).split("\n")[0] ?? "")) continue;
      found.add(match[1] as string);
    }
  }
  return [...found];
}

/** Violations as `package: reason`, naming the package, the field or file, and the experimental name. */
function experimentalBoundaryViolations(root: string, packages: readonly BoundaryPackage[], experimental: ReadonlySet<string>): string[] {
  const violations: string[] = [];
  for (const pkg of packages) {
    const name = pkg.manifest.name;
    if (pkg.manifest.private === true || experimental.has(name)) continue;
    for (const field of DEPENDENCY_FIELDS) {
      for (const dependency of Object.keys(pkg.manifest[field] ?? {})) {
        if (experimental.has(dependency)) violations.push(`${name}: ${field} names experimental ${dependency}`);
      }
    }
    for (const file of sourceFiles(join(root, pkg.path, "src"))) {
      for (const imported of experimentalImports(readFileSync(file, "utf8"), experimental)) {
        violations.push(`${name}: ${relative(root, file)} imports experimental ${imported}`);
      }
    }
  }
  return violations;
}

describe("experimental boundary", () => {
  it("stable_packages_never_depend_on_experimental", () => {
    const release = loadRelease(repoRoot) as { packages: BoundaryPackage[] };
    const experimental = experimentalSet(repoRoot);
    assert.ok(experimental.size > 0, "the experimental set must come from scripts/independent-packages.json");
    assert.deepEqual(experimentalBoundaryViolations(repoRoot, release.packages, experimental), []);
  });

  describe("fixtures", () => {
    const experimental = new Set(["@arnilo/prism-memory-core", "@arnilo/prism-memory-rag"]);
    const make = (files: Record<string, string>, manifest: Record<string, unknown> = {}) => {
      const root = mkdtempSync(join(tmpdir(), "prism-boundary-"));
      mkdirSync(join(root, "packages", "stable", "src", "__tests__"), { recursive: true });
      for (const [file, text] of Object.entries(files)) writeFileSync(join(root, "packages", "stable", file), text);
      const pkg: BoundaryPackage = { path: "packages/stable", manifest: { name: "@arnilo/stable", ...manifest } };
      return { root, pkg };
    };

    it("fails on a stable manifest dependency, naming package, field and experimental name", () => {
      const { root, pkg } = make({}, { peerDependencies: { "@arnilo/prism-memory-core": "^0.13.0" } });
      try {
        assert.deepEqual(experimentalBoundaryViolations(root, [pkg], experimental), [
          "@arnilo/stable: peerDependencies names experimental @arnilo/prism-memory-core",
        ]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("fails on type-only, re-export, bare and literal dynamic imports in stable src", () => {
      const { root, pkg } = make({
        "src/type.ts": 'import type { A } from "@arnilo/prism-memory-rag";\n',
        "src/reexport.ts": 'export type {\n  B,\n} from "@arnilo/prism-memory-core/sub";\n',
        "src/bare.ts": 'import "@arnilo/prism-memory-core";\n',
        "src/dynamic.ts": 'export const load = () => import("@arnilo/prism-memory-rag");\n',
      });
      try {
        const found = experimentalBoundaryViolations(root, [pkg], experimental).map((line) => line.split(" imports ")[0]);
        assert.deepEqual(found.sort(), [
          "@arnilo/stable: packages/stable/src/bare.ts",
          "@arnilo/stable: packages/stable/src/dynamic.ts",
          "@arnilo/stable: packages/stable/src/reexport.ts",
          "@arnilo/stable: packages/stable/src/type.ts",
        ]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it("allows devDependencies, __tests__, comments, private packages and the experimental packages themselves", () => {
      const { root, pkg } = make(
        {
          "src/__tests__/a.test.ts": 'import { x } from "@arnilo/prism-memory-core";\n',
          "src/comment.ts": '// import("@arnilo/prism-memory-rag")\n/**\n * import x from "@arnilo/prism-memory-core";\n */\nexport {};\n',
        },
        { devDependencies: { "@arnilo/prism-memory-core": "file:../core" } },
      );
      try {
        assert.deepEqual(experimentalBoundaryViolations(root, [pkg], experimental), []);
        const privatePkg = { ...pkg, manifest: { ...pkg.manifest, private: true, dependencies: { "@arnilo/prism-memory-core": "1" } } };
        assert.deepEqual(experimentalBoundaryViolations(root, [privatePkg], experimental), []);
        const self = {
          ...pkg,
          manifest: { ...pkg.manifest, name: "@arnilo/prism-memory-rag", dependencies: { "@arnilo/prism-memory-core": "1" } },
        };
        assert.deepEqual(experimentalBoundaryViolations(root, [self], experimental), []);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
