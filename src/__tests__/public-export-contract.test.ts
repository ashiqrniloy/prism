import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

// ponytail: data-driven contract; one entry per published package (shared shape
// with packaging.test.ts / install-smoke.test.ts). Adding a package is one line.
const packages = [
  { dir: ".", name: "@arnilo/prism", isCore: true },
  { dir: "packages/provider-openai", name: "@arnilo/prism-provider-openai" },
  { dir: "packages/provider-opencode-go", name: "@arnilo/prism-provider-opencode-go" },
  { dir: "packages/provider-openrouter", name: "@arnilo/prism-provider-openrouter" },
  { dir: "packages/provider-zai", name: "@arnilo/prism-provider-zai" },
  { dir: "packages/provider-kimi", name: "@arnilo/prism-provider-kimi" },
  { dir: "packages/compaction-llm", name: "@arnilo/prism-compaction-llm" },
  { dir: "packages/compaction-observational-memory", name: "@arnilo/prism-compaction-observational-memory" },
];

type Manifest = {
  exports?: Record<string, Record<string, string> | string>;
  main?: string;
  types?: string;
  bin?: string | Record<string, string>;
};

function readPkg(dir: string): Manifest {
  return JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8"));
}

// Collect every public surface target a package.json can point a consumer at:
// exports.* (types + default), main, types, and (core) bin. Each entry is the
// raw manifest path (e.g. "./dist/index.js").
function collectTargets(pkg: { dir: string; isCore?: boolean }): Map<string, string> {
  const manifest = readPkg(pkg.dir);
  const out = new Map<string, string>(); // label -> target path
  const exports = manifest.exports ?? {};
  for (const [subpath, target] of Object.entries(exports)) {
    if (typeof target === "string") {
      out.set(`exports["${subpath}"]`, target);
      continue;
    }
    for (const field of ["types", "default"] as const) {
      if (target[field]) out.set(`exports["${subpath}"].${field}`, target[field]!);
    }
  }
  if (manifest.main) out.set("main", manifest.main);
  if (manifest.types) out.set("types", manifest.types);
  if (pkg.isCore && manifest.bin) {
    const bin = manifest.bin;
    if (typeof bin === "string") {
      out.set("bin", bin);
    } else {
      for (const [name, path] of Object.entries(bin)) out.set(`bin["${name}"]`, path);
    }
  }
  return out;
}

function norm(p: string): string {
  return p.replace(/^\.\//, "");
}

describe("public-export contract (build-time, pre-pack)", () => {
  for (const pkg of packages) {
    describe(pkg.name, () => {
      const targets = collectTargets(pkg);
      const pkgRoot = join(repoRoot, pkg.dir);
      const distDir = join(pkgRoot, "dist");

      it("dist/ exists (run `npm run build` before this test)", () => {
        // ponytail: fail closed with a directing message instead of a cryptic ENOENT
        assert.ok(existsSync(distDir), `${pkg.name}: dist/ missing — run \`npm run build\` first`);
      });

      for (const [label, target] of targets) {
        it(`${label} (${target}) resolves to a built file under dist/`, () => {
          const rel = norm(target);
          // boundary: public targets must live under dist/ — no src/ or examples/ leak
          // via a manifest misconfiguration.
          assert.ok(
            rel.startsWith("dist/") && !rel.includes("/src/") && !rel.startsWith("examples/"),
            `${pkg.name} ${label} -> ${rel} must target dist/ (not src/ or examples/)`,
          );
          assert.ok(
            existsSync(join(pkgRoot, rel)),
            `${pkg.name} ${label} -> ${rel} missing from disk (built output not found; run \`npm run build\`)`,
          );
        });

        // types/d.ts pair check: every .js target should have a sibling .d.ts so
        // TypeScript consumers resolve types at the published specifier.
        const rel = norm(target);
        if (rel.endsWith(".js")) {
          const dts = rel.slice(0, -".js".length) + ".d.ts";
          it(`${label} has a sibling .d.ts (${dts})`, () => {
            assert.ok(
              existsSync(join(pkgRoot, dts)),
              `${pkg.name} ${label} -> ${rel} has no sibling ${dts} (types missing for the published specifier)`,
            );
          });
        }
      }

      // negative guard: NO target of any kind escapes dist/. Catches a future
      // manifest edit that points main/exports/bin at source or examples.
      it("no public target escapes dist/", () => {
        for (const [label, target] of targets) {
          const rel = norm(target);
          if (isAbsolute(target) || !rel.startsWith("dist/")) {
            assert.fail(`${pkg.name} ${label} -> ${target} escapes dist/`);
          }
          const inside = relative(join(pkgRoot, "dist"), join(pkgRoot, rel));
          assert.ok(
            !inside.startsWith(".."),
            `${pkg.name} ${label} -> ${rel} resolves outside dist/ (-> ${inside})`,
          );
        }
      });
    });
  }
});
