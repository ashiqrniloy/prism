import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

// ponytail: data-driven guard; one entry per published package, drive every assertion from this list
const packages = [
  { dir: ".", name: "@arnilo/prism", isCore: true },
  { dir: "packages/provider-openai", name: "@arnilo/prism-provider-openai" },
  { dir: "packages/provider-opencode-go", name: "@arnilo/prism-provider-opencode-go" },
  { dir: "packages/provider-openrouter", name: "@arnilo/prism-provider-openrouter" },
  { dir: "packages/provider-zai", name: "@arnilo/prism-provider-zai" },
  { dir: "packages/provider-kimi", name: "@arnilo/prism-provider-kimi" },
  { dir: "packages/provider-neuralwatt", name: "@arnilo/prism-provider-neuralwatt" },
  { dir: "packages/provider-ai-sdk", name: "@arnilo/prism-provider-ai-sdk" },
  { dir: "packages/coding-agent", name: "@arnilo/prism-coding-agent" },
  { dir: "packages/compaction-llm", name: "@arnilo/prism-compaction-llm" },
  { dir: "packages/compaction-observational-memory", name: "@arnilo/prism-compaction-observational-memory" },
  { dir: "packages/observability-opentelemetry", name: "@arnilo/prism-observability-opentelemetry" },
  { dir: "packages/tool-validator-json-schema", name: "@arnilo/prism-tool-validator-json-schema" },
  { dir: "packages/mcp", name: "@arnilo/prism-mcp" },
  { dir: "packages/session-store-sqlite", name: "@arnilo/prism-session-store-sqlite" },
  { dir: "packages/session-store-postgres", name: "@arnilo/prism-session-store-postgres" },
  { dir: "packages/credentials-node", name: "@arnilo/prism-credentials-node" },
  { dir: "packages/coding-security", name: "@arnilo/prism-coding-security" },
  { dir: "packages/workflows", name: "@arnilo/prism-workflows" },
  { dir: "packages/evals", name: "@arnilo/prism-evals" },
  { dir: "packages/memory", name: "@arnilo/prism-memory" },
  { dir: "packages/rag", name: "@arnilo/prism-rag" },
  { dir: "packages/server", name: "@arnilo/prism-server" },
  { dir: "packages/supervisor", name: "@arnilo/prism-supervisor" },
  // Pure-manifest family/profile packages (no dist/exports/peer): ship README + changelog + manifest.
  { dir: "packages/prism-providers", name: "@arnilo/prism-providers", isMeta: true },
  { dir: "packages/prism-compaction", name: "@arnilo/prism-compaction", isMeta: true },
  { dir: "packages/prism-base", name: "@arnilo/prism-base", isMeta: true },
  { dir: "packages/prism-code", name: "@arnilo/prism-code", isMeta: true },
  { dir: "packages/prism-sdk", name: "@arnilo/prism-sdk", isMeta: true },
  { dir: "packages/prism-all", name: "@arnilo/prism-all", isMeta: true },
];

const deniedPatterns: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /__tests__\//, label: "compiled tests" },
  { pattern: /\.map$/, label: "source maps" },
  { pattern: /\.tsbuildinfo$/, label: "tsbuildinfo" },
  { pattern: /^src\//, label: "source" },
  { pattern: /^plans\//, label: "plans" },
  { pattern: /^\.agents\//, label: "agents" },
  { pattern: /^roadmap\.md$/, label: "roadmap" },
  { pattern: /tsconfig/, label: "tsconfig" },
  { pattern: /^packages\//, label: "workspace packages" },
  { pattern: /^examples\//, label: "examples" },
];

function isSourceTs(path: string): boolean {
  return path.endsWith(".ts") && !path.endsWith(".d.ts");
}

const packCache = new Map<string, string[]>();

function getPackList(dir: string, name: string): string[] {
  const cached = packCache.get(dir);
  if (cached) return cached;
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: join(repoRoot, dir),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  assert.equal(result.status, 0, `npm pack --dry-run failed for ${name} (status ${result.status})`);
  const parsed = JSON.parse(result.stdout) as Array<{ files: Array<{ path: string }> }>;
  const files = parsed[0].files.map((f) => f.path);
  packCache.set(dir, files);
  return files;
}

function readPkg(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8"));
}

describe("packaging guard", () => {
  for (const pkg of packages) {
    describe(pkg.name, () => {
      it("ships no tests, maps, source, plans, or internal files", () => {
        const files = getPackList(pkg.dir, pkg.name);
        const junk = files.filter((f) => {
          // Checked-in init templates intentionally include *.tmpl names that look like
          // tsconfig/tests; they are scaffold inputs, not package internals.
          if (f.startsWith("templates/")) return false;
          return deniedPatterns.some((d) => d.pattern.test(f)) || isSourceTs(f);
        });
        const labels = junk.map(
          (f) =>
            `${f} (${
              deniedPatterns.find((d) => d.pattern.test(f))?.label ?? "source .ts"
            })`,
        );
        assert.deepEqual(junk, [], `${pkg.name} packs denied files: ${labels.join(", ")}`);
      });

      it("includes required release documentation", () => {
        const files = getPackList(pkg.dir, pkg.name);
        assert.ok(files.includes("README.md"), `${pkg.name} missing README.md in pack`);
        for (const required of pkg.isMeta ? ["CHANGELOG.md"] : ["LICENSE", "CHANGELOG.md"]) {
          assert.ok(
            files.includes(required),
            `${pkg.name} missing ${required} in pack`,
          );
        }
      });

      it("ships every exports target as compiled output", () => {
        if (pkg.isMeta) return; // family/profile packages have no exports
        const files = getPackList(pkg.dir, pkg.name);
        const manifest = readPkg(pkg.dir);
        const exports = manifest.exports as Record<string, Record<string, string>>;
        for (const [subpath, target] of Object.entries(exports)) {
          for (const field of ["types", "default"] as const) {
            const file = target[field];
            if (!file) continue;
            const rel = file.replace(/^\.\//, "");
            assert.ok(
              files.includes(rel),
              `${pkg.name} exports ${subpath} ${field} (${file}) missing from pack`,
            );
          }
        }
      });

      if (pkg.isCore) {
        it("ships the docs hub, CLI bin, and init templates", () => {
          const files = getPackList(pkg.dir, pkg.name);
          assert.ok(files.includes("docs/index.md"), `${pkg.name} missing docs/index.md`);
          assert.ok(files.includes("dist/cli.js"), `${pkg.name} missing dist/cli.js`);
          assert.ok(files.includes("templates/init/package.json.tmpl"), `${pkg.name} missing init templates`);
          assert.ok(files.includes("templates/init/src/agent.ts.tmpl"), `${pkg.name} missing agent template`);
          assert.ok(files.includes("templates/init/providers.json"), `${pkg.name} missing init provider catalog`);
        });
      }

      it("declares license, repository, bugs, homepage, keywords, and sideEffects metadata", () => {
        const manifest = readPkg(pkg.dir);
        assert.ok(typeof manifest.license === "string" && manifest.license, `${pkg.name} missing license`);
        const repository = manifest.repository as { url?: string; directory?: string } | undefined;
        assert.ok(repository?.url, `${pkg.name} missing repository.url`);
        if (!pkg.isCore) {
          assert.ok(repository?.directory, `${pkg.name} missing repository.directory`);
        }
        const bugs = manifest.bugs as { url?: string } | undefined;
        assert.ok(bugs?.url, `${pkg.name} missing bugs.url`);
        assert.ok(typeof manifest.homepage === "string" && manifest.homepage, `${pkg.name} missing homepage`);
        assert.ok(Array.isArray(manifest.keywords) && (manifest.keywords as string[]).length > 0, `${pkg.name} missing keywords`);
        assert.ok(
          manifest.sideEffects === false || Array.isArray(manifest.sideEffects),
          `${pkg.name} missing sideEffects`,
        );
        assert.equal(
          (manifest.publishConfig as { access?: string } | undefined)?.access,
          "public",
          `${pkg.name} missing publishConfig.access: public (scoped packages default to restricted)`,
        );
      });

      if (!pkg.isCore && !pkg.isMeta) {
        it("makes @arnilo/prism a required (non-optional) peer dependency", () => {
          const manifest = readPkg(pkg.dir);
          const peers = manifest.peerDependencies as Record<string, string> | undefined;
          assert.equal(peers?.["@arnilo/prism"], "0.0.5", `${pkg.name} @arnilo/prism peer must be 0.0.5`);
          assert.ok(
            !manifest.peerDependenciesMeta,
            `${pkg.name} must not mark the @arnilo/prism peer optional (peerDependenciesMeta should be absent)`,
          );
        });
      }

      if (pkg.isMeta) {
        it("meta package declares its exact hard dependency set", () => {
          const manifest = readPkg(pkg.dir);
          const deps = manifest.dependencies as Record<string, string> | undefined;
          assert.ok(deps, `${pkg.name} missing dependencies`);
          const depNames = Object.keys(deps);
          const expected: Record<string, string[]> = {
            "@arnilo/prism-providers": [
              "@arnilo/prism-provider-openai",
              "@arnilo/prism-provider-opencode-go",
              "@arnilo/prism-provider-openrouter",
              "@arnilo/prism-provider-zai",
              "@arnilo/prism-provider-kimi",
              "@arnilo/prism-provider-neuralwatt",
              "@arnilo/prism-provider-ai-sdk",
            ],
            "@arnilo/prism-compaction": [
              "@arnilo/prism-compaction-llm",
              "@arnilo/prism-compaction-observational-memory",
            ],
            "@arnilo/prism-base": [
              "@arnilo/prism",
              "@arnilo/prism-compaction",
              "@arnilo/prism-tool-validator-json-schema",
            ],
            "@arnilo/prism-code": [
              "@arnilo/prism-base",
              "@arnilo/prism-coding-agent",
              "@arnilo/prism-coding-security",
              "@arnilo/prism-mcp",
            ],
            "@arnilo/prism-sdk": [
              "@arnilo/prism-base",
              "@arnilo/prism-credentials-node",
              "@arnilo/prism-mcp",
              "@arnilo/prism-observability-opentelemetry",
              "@arnilo/prism-workflows",
            ],
            "@arnilo/prism-all": [
              "@arnilo/prism-code",
              "@arnilo/prism-sdk",
              "@arnilo/prism-providers",
              "@arnilo/prism-session-store-sqlite",
              "@arnilo/prism-session-store-postgres",
              "@arnilo/prism-evals",
              "@arnilo/prism-memory",
              "@arnilo/prism-rag",
              "@arnilo/prism-server",
              "@arnilo/prism-supervisor",
            ],
          };
          const want = expected[pkg.name];
          assert.ok(want, `${pkg.name} not in expected meta-package map`);
          assert.deepEqual(depNames.sort(), want.sort(), `${pkg.name} dependencies must be exactly its family`);
          for (const v of Object.values(deps)) {
            assert.equal(v, "0.0.5", `${pkg.name} dependency must be pinned to 0.0.5`);
          }
        });
      }

      if (pkg.isCore) {
        it("core package is named @arnilo/prism", () => {
          const manifest = readPkg(pkg.dir);
          assert.equal(manifest.name, "@arnilo/prism", `core package name must be @arnilo/prism`);
        });
      }
    });
  }

  it("phase48 neuralwatt package exports types and umbrella membership are release-gated", () => {
    const neuralWatt = packages.find((pkg) => pkg.name === "@arnilo/prism-provider-neuralwatt");
    assert.ok(neuralWatt, "@arnilo/prism-provider-neuralwatt missing from packaging package list");
    const files = getPackList(neuralWatt.dir, neuralWatt.name);
    assert.ok(files.includes("dist/index.js"), "NeuralWatt pack missing dist/index.js");
    assert.ok(files.includes("dist/index.d.ts"), "NeuralWatt pack missing dist/index.d.ts");

    const neuralWattManifest = readPkg(neuralWatt.dir);
    assert.deepEqual(
      neuralWattManifest.exports,
      { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
      "NeuralWatt manifest exports must keep JS + type declaration targets",
    );

    const providers = readPkg("packages/prism-providers").dependencies as Record<string, string> | undefined;
    assert.equal(providers?.["@arnilo/prism-provider-neuralwatt"], "0.0.5", "@arnilo/prism-providers must hard-depend on NeuralWatt");
    const all = readPkg("packages/prism-all").dependencies as Record<string, string> | undefined;
    assert.equal(all?.["@arnilo/prism-providers"], "0.0.5", "@arnilo/prism-all must hard-depend on provider umbrella");
  });

  it("prism-all transitively includes every published first-party package", () => {
    const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
    const included = new Set<string>();
    const visit = (name: string) => {
      if (included.has(name)) return;
      included.add(name);
      const pkg = byName.get(name);
      if (!pkg) return;
      const dependencies = readPkg(pkg.dir).dependencies as Record<string, string> | undefined;
      for (const dependency of Object.keys(dependencies ?? {})) {
        if (byName.has(dependency)) visit(dependency);
      }
    };
    visit("@arnilo/prism-all");
    assert.deepEqual([...included].sort(), packages.map((pkg) => pkg.name).sort());
  });

  it("workspace dependency tree is clean (npm ls --all --depth=0 exits 0)", () => {
    const result = spawnSync("npm", ["ls", "--all", "--depth=0"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `npm ls failed:\n${result.stdout}\n${result.stderr}`);
  });
});
