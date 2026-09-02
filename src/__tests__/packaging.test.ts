import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

// ponytail: data-driven guard; one entry per published package, drive every assertion from this list
const packages: Array<{
  dir: string;
  name: string;
  isCore?: boolean;
  isSubpaths?: boolean;
  isMeta?: boolean;
}> = [
  { dir: ".", name: "@arnilo/prism", isCore: true },
  { dir: "packages/mcp", name: "@arnilo/prism-mcp" },
  { dir: "packages/memory", name: "@arnilo/prism-memory" },
  { dir: "packages/web-tools", name: "@arnilo/prism-web-tools" },
  { dir: "packages/ag-ui", name: "@arnilo/prism-ag-ui" },
  { dir: "packages/acp-agent", name: "@arnilo/prism-acp-agent" },
  { dir: "packages/prism-coding-tools", name: "@arnilo/prism-coding-tools" },
  { dir: "packages/prism-core", name: "@arnilo/prism-core" },
  // Pure-manifest family/profile packages (no dist/exports/peer): ship README + changelog + manifest.
  { dir: "packages/prism-providers", name: "@arnilo/prism-providers", isSubpaths: true },
  { dir: "packages/office", name: "@arnilo/prism-office", isSubpaths: true },
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
        const labels = junk.map((f) => `${f} (${deniedPatterns.find((d) => d.pattern.test(f))?.label ?? "source .ts"})`);
        assert.deepEqual(junk, [], `${pkg.name} packs denied files: ${labels.join(", ")}`);
      });

      it("includes required release documentation", () => {
        const files = getPackList(pkg.dir, pkg.name);
        assert.ok(files.includes("README.md"), `${pkg.name} missing README.md in pack`);
        for (const required of pkg.isMeta ? ["CHANGELOG.md"] : ["LICENSE", "CHANGELOG.md"]) {
          assert.ok(files.includes(required), `${pkg.name} missing ${required} in pack`);
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
            assert.ok(files.includes(rel), `${pkg.name} exports ${subpath} ${field} (${file}) missing from pack`);
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
          assert.ok(files.includes("templates/README.md"), `${pkg.name} missing templates gallery README`);
          assert.ok(files.includes("templates/deep-research/manifest.json"), `${pkg.name} missing deep-research manifest`);
          assert.ok(files.includes("templates/deep-research/package.json.tmpl"), `${pkg.name} missing deep-research template`);
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
        assert.ok(manifest.sideEffects === false || Array.isArray(manifest.sideEffects), `${pkg.name} missing sideEffects`);
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
          assert.equal(
            peers?.["@arnilo/prism"],
            "^0.4.0",
            `${pkg.name} @arnilo/prism peer must be ^0.4.0, got ${peers?.["@arnilo/prism"]}`,
          );
          const meta = manifest.peerDependenciesMeta as Readonly<Record<string, { readonly optional?: boolean }>> | undefined;
          assert.ok(!meta?.["@arnilo/prism"]?.optional, `${pkg.name} must not mark the @arnilo/prism peer optional`);
        });
      }

      if (pkg.isMeta) {
        it("meta package declares its exact hard dependency set", () => {
          const manifest = readPkg(pkg.dir);
          const deps = manifest.dependencies as Record<string, string> | undefined;
          assert.ok(deps, `${pkg.name} missing dependencies`);
          const depNames = Object.keys(deps);
          const expected: Record<string, string[]> = {
            "@arnilo/prism-base": ["@arnilo/prism", "@arnilo/prism-core", "@arnilo/prism-memory"],
            "@arnilo/prism-code": ["@arnilo/prism-base", "@arnilo/prism-coding-tools", "@arnilo/prism-mcp"],
            "@arnilo/prism-sdk": ["@arnilo/prism-base", "@arnilo/prism-core", "@arnilo/prism-mcp"],
            "@arnilo/prism-all": [
              "@arnilo/prism-acp-agent",
              "@arnilo/prism-ag-ui",
              "@arnilo/prism-code",
              "@arnilo/prism-core",
              "@arnilo/prism-memory",
              "@arnilo/prism-providers",
              "@arnilo/prism-sdk",
              "@arnilo/prism-web-tools",
            ],
          };
          const want = expected[pkg.name];
          assert.ok(want, `${pkg.name} not in expected meta-package map`);
          assert.deepEqual(depNames.sort(), want.sort(), `${pkg.name} dependencies must be exactly its family`);
          for (const v of Object.values(deps)) {
            assert.equal(v, "^0.3.0", `${pkg.name} dependency must use the ^0.3.0 caret window`);
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

  it("prism-coding-tools package ships its local computer-use skill", () => {
    const desktop = packages.find((pkg) => pkg.name === "@arnilo/prism-coding-tools");
    assert.ok(desktop, "prism-coding-tools missing from packaging package list");
    const files = getPackList(desktop.dir, desktop.name);
    assert.ok(files.includes("skills/computer-use-linux/SKILL.md"), "desktop package missing bundled skill");
    const manifest = readPkg(desktop.dir);
    assert.ok((manifest.files as string[] | undefined)?.includes("skills"), "desktop package manifest must include skills");
  });

  it("web-tools family keeps browser/Obscura subpaths peer-gated and out of the root import", () => {
    const webTools = readPkg("packages/web-tools");
    const exportsMap = webTools.exports as Record<string, { types: string; default: string }>;
    assert.deepEqual(Object.keys(exportsMap).sort(), [".", "./brave", "./browser", "./exa", "./firecrawl", "./obscura"]);
    const peers = webTools.peerDependencies as Record<string, string>;
    const meta = webTools.peerDependenciesMeta as Record<string, { optional?: boolean }>;
    assert.equal(peers["playwright-core"], "1.61.0", "browser subpath must pin the playwright-core peer");
    assert.equal(meta["playwright-core"]?.optional, true, "playwright-core must stay an optional peer");
    assert.equal(peers["@arnilo/prism-mcp"], "^0.4.0", "obscura subpath must keep the MCP bridge peer");
    assert.equal(meta["@arnilo/prism-mcp"]?.optional, undefined, "@arnilo/prism-mcp must stay a required peer where Obscura needs it");
    const files = getPackList("packages/web-tools", "@arnilo/prism-web-tools");
    for (const required of [
      "dist/index.js",
      "dist/browser/index.js",
      "dist/obscura/index.js",
      "dist/browser/policy.js",
      "dist/obscura/process.js",
    ]) {
      assert.ok(files.includes(required), `web-tools pack missing ${required}`);
    }
  });

  it("memory family keeps rag/compaction/graft/wiki subpaths and the wiki bin in one tarball", () => {
    const memory = readPkg("packages/memory");
    const exportsMap = memory.exports as Record<string, { types: string; default: string }>;
    assert.deepEqual(Object.keys(exportsMap).sort(), [
      ".",
      "./compaction/llm",
      "./compaction/observational-memory",
      "./graft",
      "./rag",
      "./rag/loaders",
      "./rag/parsers",
      "./wiki",
    ]);
    const peers = memory.peerDependencies as Record<string, string>;
    const meta = memory.peerDependenciesMeta as Record<string, { optional?: boolean }>;
    assert.equal(peers["@nanonets/graft"], "^0.16.0", "graft subpath must peer @nanonets/graft");
    assert.equal(meta["@nanonets/graft"]?.optional, true, "@nanonets/graft must stay an optional peer");
    assert.equal(
      (memory.bin as Record<string, string>)["prism-wiki"],
      "./dist/wiki/cli.js",
      "prism-wiki bin must ship from the wiki subpath",
    );
    const files = getPackList("packages/memory", "@arnilo/prism-memory");
    for (const required of [
      "dist/index.js",
      "dist/rag/index.js",
      "dist/compaction/llm/index.js",
      "dist/compaction/observational-memory/index.js",
      "dist/graft/index.js",
      "dist/wiki/cli.js",
      "skills/wiki-maintainer/SKILL.md",
      "skills/wiki-searcher/SKILL.md",
    ]) {
      assert.ok(files.includes(required), `memory pack missing ${required}`);
    }
  });

  it("phase48 neuralwatt adapter ships in the provider family and umbrella membership is release-gated", () => {
    const providers = packages.find((pkg) => pkg.name === "@arnilo/prism-providers");
    assert.ok(providers, "@arnilo/prism-providers missing from packaging package list");
    const files = getPackList(providers.dir, providers.name);
    assert.ok(files.includes("dist/neuralwatt/index.js"), "provider family pack missing dist/neuralwatt/index.js");
    assert.ok(files.includes("dist/neuralwatt/index.d.ts"), "provider family pack missing dist/neuralwatt/index.d.ts");

    const providersManifest = readPkg(providers.dir);
    const exports = providersManifest.exports as Record<string, Record<string, string>>;
    assert.deepEqual(
      exports["./neuralwatt"],
      { types: "./dist/neuralwatt/index.d.ts", default: "./dist/neuralwatt/index.js" },
      "@arnilo/prism-providers/neuralwatt subpath exports must keep JS + type declaration targets",
    );

    // Plan 054 Task 8: prism-all is retired; the provider family is the only remaining umbrella.
    assert.match(
      (providersManifest.peerDependencies as Record<string, string>)["@arnilo/prism"] ?? "",
      /^\^0\.4\.0$/,
      "provider family must peer @arnilo/prism@^0.4.0",
    );
  });

  it("provider family exports exactly the 19 adapter subpaths with no activating root barrel", () => {
    const manifest = readPkg("packages/prism-providers");
    const exports = manifest.exports as Record<string, Record<string, string>>;
    const adapters = [
      "ai-sdk",
      "alibaba",
      "anthropic",
      "azure",
      "bedrock",
      "clinepass",
      "commandcode",
      "deepseek",
      "google",
      "hyper",
      "kimi",
      "neuralwatt",
      "ollama",
      "openai",
      "opencode-go",
      "openrouter",
      "vertex",
      "xai",
      "zai",
    ];
    assert.deepEqual(
      Object.keys(exports).sort(),
      adapters.map((a) => `./${a}`).sort(),
      "provider family exports must be exactly the 19 adapter subpaths",
    );
    assert.equal(exports["."], undefined, "provider family must have no root barrel: no adapter may activate at family-root import");
    // Adapter isolation: compiled adapter code only imports its own directory and
    // the @arnilo/prism peer — never another adapter's dist output.
    for (const adapter of adapters) {
      const dir = join(repoRoot, "packages/prism-providers/dist", adapter);
      const walk = (d: string): string[] =>
        readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(".js") ? [join(d, e.name)] : [],
        );
      for (const file of walk(dir)) {
        const text = readFileSync(file, "utf8");
        const foreign = [...text.matchAll(/from "(\.[^"]+)"/g)]
          .map((m) => posix.normalize(posix.join(adapter, posix.dirname(file.slice(dir.length + 1)), m[1])))
          .filter((resolved) => resolved !== adapter && !resolved.startsWith(`${adapter}/`));
        // Plan 055 deliberate family-internal reuse: `shared/` serializers (Task 1,
        // every adapter) and the hyper → openai Responses-machinery import (Task 8,
        // plan-approved reuse over copying). Everything else must stay adapter-local.
        // (Foreign paths are repo-relative to dist/, e.g. "shared/anthropic-messages.js".)
        const allowed: readonly string[] = ["shared/", ...(adapter === "hyper" ? ["openai/"] : [])];
        const violations = foreign.filter((resolved) => !allowed.some((prefix) => resolved.startsWith(prefix)));
        assert.deepEqual(violations, [], `${adapter} compiled output imports outside its own adapter: ${violations.join(", ")}`);
      }
    }
  });

  it("office family exports exactly documents/sheets/diagrams with no activating root barrel", () => {
    const manifest = readPkg("packages/office");
    const exports = manifest.exports as Record<string, Record<string, string>>;
    assert.deepEqual(Object.keys(exports).sort(), ["./diagrams", "./documents", "./sheets"]);
    assert.equal(exports["."], undefined, "office family must have no root barrel");
    const files = getPackList("packages/office", "@arnilo/prism-office");
    for (const required of ["dist/documents/index.js", "dist/sheets/index.js", "dist/diagrams/index.js"]) {
      assert.ok(files.includes(required), `office pack missing ${required}`);
    }
  });

  it("workspace dependency tree is clean (npm ls --all --depth=0 exits 0)", () => {
    const result = spawnSync("npm", ["ls", "--all", "--depth=0"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `npm ls failed:\n${result.stdout}\n${result.stderr}`);
  });

  it("plan 054 Task 7: every retired name has legacy-registry metadata and a successor/recipe anchor", () => {
    const evidence = readFileSync(join(repoRoot, "docs/_evidence/phase54-package-map.md"), "utf8");
    const guide = readFileSync(join(repoRoot, "docs/migrate-to-0.4.md"), "utf8");
    const section = evidence.split("## 8. Legacy Registry Plan & Deprecation Commands (55 Packages)")[1];
    assert.ok(section, "evidence carries the legacy registry command block");
    // GitHub heading slugs of the migration guide (code fences ignored).
    const anchors = new Set<string>();
    let inFence = false;
    for (const line of guide.split("\n")) {
      if (line.startsWith("```")) inFence = !inFence;
      if (inFence) continue;
      const h = /^#{1,6}\s+(.+?)\s*$/.exec(line);
      if (h)
        anchors.add(
          h[1]
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s-]/gu, "")
            .trim()
            .replace(/\s+/g, "-"),
        );
    }
    assert.ok(anchors.size > 0, "guide headings parsed");
    const tagCommands = [...section.matchAll(/^npm dist-tag add (@arnilo\/prism-[a-z0-9-]+)@([0-9.]+) legacy$/gm)];
    const deprecateCommands = [...section.matchAll(/^npm deprecate (@arnilo\/prism-[a-z0-9-]+)@"<0\.4\.0" "(.*)"$/gm)];
    assert.equal(tagCommands.length, 55, "55 legacy dist-tag commands (one per retired name)");
    assert.equal(deprecateCommands.length, 55, "55 <0.4.0 deprecation commands");
    const tagNames = new Set(tagCommands.map((m) => m[1]));
    const deprecateNames = new Set(deprecateCommands.map((m) => m[1]));
    assert.equal(tagNames.size, 55, "retired names are distinct in tag commands");
    assert.deepEqual(deprecateNames, tagNames, "tag and deprecate cover the same names");
    for (const [, name, version] of tagCommands) {
      assert.match(version, /^\d+\.\d+\.\d+$/, `final version is exact: ${name}`);
    }
    for (const [, name, message] of deprecateCommands) {
      assert.ok(message.startsWith("Legacy 0.3 "), `legacy status: ${name}`);
      assert.ok(message.includes("Prism 0.4+:"), `successor/recipe clause: ${name}`);
      const url = message.match(/https:\/\/github\.com\/ashiqrniloy\/prism\/blob\/main\/docs\/migrate-to-0\.4\.md#([\w-]+)$/);
      assert.ok(url, `guide URL with anchor: ${name}`);
      assert.ok(anchors.has(url[1]), `anchor exists in guide: ${name} -> #${url[1]}`);
    }
  });

  it("plan 054 Task 8: office family exports and migration guide cover documents/sheets/diagrams", () => {
    const office = readPkg("packages/office");
    const exports = Object.keys(office.exports as Record<string, unknown>).sort();
    assert.deepEqual(exports, ["./diagrams", "./documents", "./sheets"]);
    const guide = readFileSync(join(repoRoot, "docs/migrate-to-0.4.md"), "utf8");
    assert.ok(guide.includes("### Office suite"), "migration guide missing Office suite heading");
    for (const spec of ["@arnilo/prism-office/documents", "@arnilo/prism-office/sheets", "@arnilo/prism-office/diagrams"]) {
      assert.ok(guide.includes(spec), `migration guide missing ${spec}`);
    }
    const truth = JSON.parse(readFileSync(join(repoRoot, "scripts/package-truth.json"), "utf8")) as { counts: { publishable: number } };
    assert.equal(truth.counts.publishable, 10, "package truth must report 10 active packages");
  });

  it("0.4 package set — 10 manifests, no shims, family roots stay inert", () => {
    const root = readPkg(".");
    assert.equal(root.version, "0.4.0");
    const names = packages.map((pkg) => pkg.name).sort();
    assert.equal(names.length, 10, "10 active packages including root");
    for (const pkg of packages) {
      // Plan 055 Task 6 (Decision B changed-package cut): the provider family
      // moved 0.4.0 → 0.4.1 for the two new adapters; every other manifest stays 0.4.0.
      const expected = pkg.name === "@arnilo/prism-providers" ? "0.4.1" : "0.4.0";
      assert.equal(readPkg(pkg.dir).version, expected, `${pkg.name} at ${expected}`);
    }
    const retired = [
      "@arnilo/prism-base",
      "@arnilo/prism-code",
      "@arnilo/prism-sdk",
      "@arnilo/prism-all",
      "@arnilo/prism-browser",
      "@arnilo/prism-provider-openai",
    ];
    for (const name of retired) {
      assert.ok(!names.includes(name), `retired ${name} must not be a workspace package`);
    }
    for (const dir of ["packages/prism-providers", "packages/office"]) {
      const exports = Object.keys((readPkg(dir).exports as Record<string, unknown>) ?? {});
      assert.ok(!exports.includes("."), `${dir} must not activate a root barrel`);
    }
  });
});
