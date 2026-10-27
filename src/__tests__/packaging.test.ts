import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRange, parseVersion, satisfies } from "../packages/semver.js";
// @ts-expect-error stdlib-only release gate scripts intentionally ship as runnable JavaScript.
import { assertTarballAllowDeny } from "../../scripts/release-gates.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

// Plan 071 Task 1 (plan 070 FA 10): the release version has one source — the root
// manifest, which the lockstep cut rewrites first — so every claim surface in this
// suite derives from it instead of hardcoding the cut. `scripts/version-literal-gate.test.mjs`
// asserts the same surfaces (manifests, caret ranges, lockfile, version constant).
const releaseVersion = (): string => readPkg(".").version as string;
/** The kernel peer window every native package admits: the whole 0.x line, floored at the API-level cut. */
const KERNEL_PEER = ">=0.13.0 <1.0.0";
/**
 * A code package on the lockstep line pins the core at the caret of the current version. A package
 * that owns its version line (scripts/independent-packages.json) pins the same 0.x line at a floor:
 * a lockstep cut that rewrote it would change an already-published manifest, and the next release
 * --resume would then refuse because the local manifest no longer matches the registry's.
 */
const INDEPENDENT_LINES = new Set(
  (JSON.parse(readFileSync(join(repoRoot, "scripts", "independent-packages.json"), "utf8")) as { packages: string[] }).packages,
);
const corePin = (owner: string, range: string | undefined): string | undefined => {
  if (!INDEPENDENT_LINES.has(owner)) return range;
  const [major, minor] = (releaseVersion() as string).split(".");
  assert.match(
    range ?? "",
    new RegExp(`^\\^${major}\\.${minor}\\.\\d+$`),
    `${owner} must pin the core with a caret on the ${major}.${minor} line, got ${range}`,
  );
  return range;
};

// ponytail: data-driven guard; one entry per published package, drive every assertion from this list
const packages: Array<{
  dir: string;
  name: string;
  isCore?: boolean;
  isSubpaths?: boolean;
  isMeta?: boolean;
  /** Publishes TypeScript source (`./src/index.ts`) instead of `dist`. */
  sourceExport?: boolean;
  /** Also publishes a TypeScript `bin/` entrypoint (source package). */
  sourceBin?: boolean;
}> = [
  { dir: ".", name: "@arnilo/prism", isCore: true, sourceExport: true },
  { dir: "packages/integrations/mcp", name: "@arnilo/prism-mcp", sourceExport: true },
  { dir: "packages/hosts/mcp-server", name: "@arnilo/prism-mcp-server", sourceExport: true },
  { dir: "packages/hosts/acp", name: "@arnilo/prism-acp", sourceExport: true },
  { dir: "packages/hosts/headless", name: "@arnilo/prism-headless", sourceExport: true },
  { dir: "packages/hosts/remote", name: "@arnilo/prism-remote", sourceExport: true },
  { dir: "packages/memory/core", name: "@arnilo/prism-memory-core", sourceExport: true },
  { dir: "packages/memory/rag", name: "@arnilo/prism-memory-rag", sourceExport: true },
  { dir: "packages/memory/fabric", name: "@arnilo/prism-memory-fabric", sourceExport: true },
  { dir: "packages/memory/wiki", name: "@arnilo/prism-memory-wiki", sourceExport: true },
  { dir: "packages/memory/compaction", name: "@arnilo/prism-memory-compaction", sourceExport: true },
  { dir: "packages/memory/observational", name: "@arnilo/prism-memory-observational", sourceExport: true },
  { dir: "packages/tools/browser", name: "@arnilo/prism-tools-browser", sourceExport: true },
  { dir: "packages/hosts/ag-ui", name: "@arnilo/prism-ag-ui", sourceExport: true },
  { dir: "packages/tools/coding", name: "@arnilo/prism-tools-coding", sourceExport: true },
  { dir: "packages/tools/web", name: "@arnilo/prism-tools-web", sourceExport: true },
  { dir: "packages/tools/research", name: "@arnilo/prism-tools-research", sourceExport: true },
  { dir: "packages/tools/openapi", name: "@arnilo/prism-tools-openapi", sourceExport: true },
  { dir: "packages/tools/computer-use", name: "@arnilo/prism-tools-computer-use", sourceExport: true },
  { dir: "packages/policy/approval", name: "@arnilo/prism-approval", sourceExport: true },
  { dir: "packages/policy/guardrail-packs", name: "@arnilo/prism-guardrail-packs", sourceExport: true },
  { dir: "packages/policy/governance", name: "@arnilo/prism-governance", sourceExport: true },
  { dir: "packages/policy/model-router", name: "@arnilo/prism-model-router", sourceExport: true },
  { dir: "packages/integrations/observability", name: "@arnilo/prism-observability", sourceExport: true },
  { dir: "packages/integrations/workflows", name: "@arnilo/prism-workflows", sourceExport: true },
  { dir: "packages/drivers/process", name: "@arnilo/prism-driver-process", sourceExport: true },
  { dir: "packages/integrations/delegate", name: "@arnilo/prism-delegate", sourceExport: true },
  { dir: "packages/integrations/advisor", name: "@arnilo/prism-advisor", sourceExport: true },
  { dir: "packages/context/files", name: "@arnilo/prism-context-files", sourceExport: true },
  { dir: "packages/context/engineering", name: "@arnilo/prism-context-engineering", sourceExport: true },
  { dir: "packages/hosts/channels", name: "@arnilo/prism-channels", sourceExport: true },
  { dir: "packages/hosts/evals", name: "@arnilo/prism-evals", sourceExport: true },
  { dir: "packages/hosts/devtools", name: "@arnilo/prism-devtools", sourceExport: true, sourceBin: true },
  { dir: "packages/integrations/hooks-json", name: "@arnilo/prism-hooks-json", sourceExport: true },
  { dir: "packages/credentials/keyring", name: "@arnilo/prism-credentials-keyring", sourceExport: true },
  { dir: "packages/stores/jsonl", name: "@arnilo/prism-store-jsonl", sourceExport: true },
  { dir: "packages/stores/codecs", name: "@arnilo/prism-store-codecs", sourceExport: true },
  { dir: "packages/stores/sqlite", name: "@arnilo/prism-store-sqlite", sourceExport: true },
  { dir: "packages/stores/postgres", name: "@arnilo/prism-store-postgres", sourceExport: true },
  { dir: "packages/providers/hyper", name: "@arnilo/prism-provider-hyper", sourceExport: true },
  { dir: "packages/providers/laya", name: "@arnilo/prism-provider-laya", sourceExport: true },
  { dir: "packages/providers/liquid", name: "@arnilo/prism-provider-liquid", sourceExport: true },
  { dir: "packages/providers/openai-codex", name: "@arnilo/prism-provider-openai-codex", sourceExport: true },
  { dir: "packages/providers/opencode-go", name: "@arnilo/prism-provider-opencode-go", sourceExport: true },
  { dir: "packages/providers/openrouter", name: "@arnilo/prism-provider-openrouter", sourceExport: true },
  { dir: "packages/providers/typesafe", name: "@arnilo/prism-provider-typesafe", sourceExport: true },
  // Pure-manifest family/profile packages (no dist/exports/peer): ship README + changelog + manifest.
  { dir: "packages/tools/work", name: "@arnilo/prism-tools-work", sourceExport: true, isSubpaths: true },
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
  // npm 12 emits an object keyed by package name; npm 11 and earlier emitted an array of entries.
  type PackEntry = { readonly files: readonly { readonly path: string }[] };
  const parsed = JSON.parse(result.stdout) as PackEntry[] | Record<string, PackEntry>;
  const entries = Array.isArray(parsed) ? parsed : Object.values(parsed);
  const files = (entries[0]?.files ?? []).map((file) => file.path);
  packCache.set(dir, files);
  return files;
}

function readPkg(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, dir, "package.json"), "utf8"));
}

/**
 * Every publishable workspace's manifest, read from the root `workspaces` globs (the authority), plus
 * the root manifest itself. Private apps are excluded: nothing publishes them and they declare no
 * `@arnilo/prism` peer.
 */
function workspaceManifests(): Array<{ dir: string; manifest: Record<string, unknown> }> {
  const root = readPkg(".");
  const dirs = (root.workspaces as string[]).flatMap((glob) => {
    const star = glob.indexOf("*");
    assert.ok(star !== -1, `workspace glob ${glob} must contain a star`);
    const base = join(repoRoot, glob.slice(0, star));
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(glob.slice(0, star), entry.name))
      .filter((dir) => existsSync(join(repoRoot, dir, "package.json")));
  });
  return [{ dir: ".", manifest: root }, ...dirs.map((dir) => ({ dir, manifest: readPkg(dir) }))];
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
          if (pkg.sourceExport && f.startsWith("src/") && f.endsWith(".ts") && !f.includes("__tests__")) return false;
          if (pkg.sourceBin && f.startsWith("bin/") && f.endsWith(".ts") && !f.includes("__tests__")) return false;
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
        const exports = manifest.exports as Record<string, Record<string, string> | string>;
        for (const [subpath, target] of Object.entries(exports)) {
          // Plan 147/174: a TypeScript-source package points the subpath straight at the file it
          // publishes; a built package splits it into a `types` + `default` pair.
          const published = typeof target === "string" ? [target] : [target.types, target.default];
          for (const file of published) {
            if (!file) continue;
            const rel = file.replace(/^\.\//, "");
            assert.ok(files.includes(rel), `${pkg.name} exports ${subpath} (${file}) missing from pack`);
          }
        }
      });

      if (pkg.isCore) {
        it("ships the docs hub, CLI bin, and package scaffold", () => {
          const files = getPackList(pkg.dir, pkg.name);
          assert.ok(files.includes("docs/index.md"), `${pkg.name} missing docs/index.md`);
          assert.ok(files.includes("src/cli.ts"), `${pkg.name} missing src/cli.ts`);
          assert.ok(files.includes("manifest/schema.json"), `${pkg.name} missing manifest/schema.json`);
          assert.equal(
            files.some((file) => file.startsWith("dist/")),
            false,
            `${pkg.name} must publish TypeScript source only, without a dist/ build output`,
          );
          for (const file of ["package.json", "src/index.ts", "package.test.ts", "README.md"]) {
            assert.ok(files.includes(`templates/package/${file}.tmpl`), `${pkg.name} missing templates/package/${file}.tmpl`);
          }
          assert.ok(files.includes("templates/README.md"), `${pkg.name} missing templates README`);
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
          corePin(pkg.name, peers?.["@arnilo/prism"]);
          if (!INDEPENDENT_LINES.has(pkg.name)) {
            assert.equal(
              peers?.["@arnilo/prism"],
              KERNEL_PEER,
              `${pkg.name} @arnilo/prism peer must be ${KERNEL_PEER}, got ${peers?.["@arnilo/prism"]}`,
            );
          }
          const meta = manifest.peerDependenciesMeta as Readonly<Record<string, { readonly optional?: boolean }>> | undefined;
          assert.ok(!meta?.["@arnilo/prism"]?.optional, `${pkg.name} must not mark the @arnilo/prism peer optional`);
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

  it("the research package ships its four bundled skills", () => {
    const research = packages.find((pkg) => pkg.name === "@arnilo/prism-tools-research");
    assert.ok(research, "prism-tools-research missing from packaging package list");
    const files = getPackList(research.dir, research.name);
    for (const skill of ["research-scoping", "source-triage", "research-synthesis", "research-report"]) {
      assert.ok(files.includes(`skills/${skill}/SKILL.md`), `research package missing ${skill}`);
    }
  });

  it("the computer-use package ships its local skill", () => {
    const desktop = packages.find((pkg) => pkg.name === "@arnilo/prism-tools-computer-use");
    assert.ok(desktop, "prism-tools-computer-use missing from packaging package list");
    const files = getPackList(desktop.dir, desktop.name);
    assert.ok(files.includes("skills/computer-use-linux/SKILL.md"), "desktop package missing bundled skill");
    const manifest = readPkg(desktop.dir);
    assert.ok((manifest.files as string[] | undefined)?.includes("skills"), "desktop package manifest must include skills");
  });

  it("prism-channels publishes source surface, keeps telegram isolated from signal, and has no third-party peers", () => {
    const manifest = readPkg("packages/hosts/channels");
    const exportsMap = manifest.exports as Record<string, string>;
    assert.deepEqual(Object.keys(exportsMap).sort(), [".", "./signal", "./telegram"]);
    assert.deepEqual(Object.keys((manifest.peerDependencies as Record<string, string>) ?? {}), ["@arnilo/prism"]);
    assert.equal(manifest.dependencies, undefined, "channels must not add runtime dependencies");
    const files = getPackList("packages/hosts/channels", "@arnilo/prism-channels");
    for (const required of ["src/index.ts", "src/telegram.ts", "src/signal.ts"]) {
      assert.ok(files.includes(required), `channels pack missing ${required}`);
    }
    assert.equal(
      files.some((file) => file.includes("__tests__") || file.includes("fixtures")),
      false,
      "channels tarball must not ship tests or fixtures",
    );
    const telegram = readFileSync(join(repoRoot, "packages/hosts/channels/src/telegram.ts"), "utf8");
    assert.equal(telegram.includes("./signal.js") || telegram.includes("node:net"), false, "telegram must not load signal or Unix sockets");
  });

  it("tools-browser publishes the browser source surface and the web-tools workspace is gone", () => {
    assert.equal(existsSync(join(repoRoot, "packages/web-tools")), false, "the web-tools workspace is deleted");

    const browser = readPkg("packages/tools/browser");
    assert.equal((browser.exports as Record<string, string>)["."], "./src/index.ts", "tools-browser publishes TypeScript source");
    const peers = browser.peerDependencies as Record<string, string>;
    const meta = browser.peerDependenciesMeta as Record<string, { optional?: boolean }>;
    assert.equal(peers["playwright-core"], "1.63.0", "tools-browser pins the playwright-core peer");
    assert.equal(meta["playwright-core"]?.optional, true, "playwright-core must stay an optional peer");
    const files = getPackList("packages/tools/browser", "@arnilo/prism-tools-browser");
    for (const required of ["src/index.ts", "src/tools.ts", "src/manager.ts", "src/config.ts"]) {
      assert.ok(files.includes(required), `tools-browser pack missing ${required}`);
    }
    assert.equal(
      files.some((file) => file.includes("__tests__")),
      false,
      "tools-browser tarball must not ship tests",
    );
  });

  it("memory family workspace is deleted, not shimmed, and the wiki package owns the bin, skills, and CLI", () => {
    // Plan 158 Task 6: the family is gone; the six packages are the only memory workspaces.
    assert.ok(!existsSync(join(repoRoot, "packages", "memory", "package.json")), "packages/memory/package.json must be deleted");
    assert.equal(
      packages.some((pkg) => pkg.name === "@arnilo/prism-memory"),
      false,
      "@arnilo/prism-memory must not be in the package list",
    );
    assert.deepEqual(
      packages
        .filter((pkg) => pkg.name.startsWith("@arnilo/prism-memory"))
        .map((pkg) => pkg.name)
        .sort(),
      [
        "@arnilo/prism-memory-compaction",
        "@arnilo/prism-memory-core",
        "@arnilo/prism-memory-fabric",
        "@arnilo/prism-memory-observational",
        "@arnilo/prism-memory-rag",
        "@arnilo/prism-memory-wiki",
      ],
      "the six memory packages are present and the family root is absent",
    );

    const wiki = readPkg("packages/memory/wiki");
    assert.equal((wiki.bin as Record<string, string>)["prism-wiki"], "./src/cli.ts", "prism-wiki ships from the wiki package");
    const wikiFiles = getPackList("packages/memory/wiki", "@arnilo/prism-memory-wiki");
    for (const required of ["src/cli.ts", "src/index.ts", "skills/wiki-maintainer/SKILL.md", "skills/wiki-searcher/SKILL.md"]) {
      assert.ok(wikiFiles.includes(required), `wiki pack missing ${required}`);
    }

    // No memory tarball may ship the retired family's build output or its canary fixture.
    for (const dir of ["packages/memory/core", "packages/memory/rag", "packages/memory/fabric", "packages/memory/wiki"]) {
      const files = getPackList(dir, readPkg(dir).name as string);
      assert.equal(
        files.some((file) => file.startsWith("dist/") || file.startsWith(".wiki/")),
        false,
        `${dir} must publish TypeScript source only, without the retired family dist or the wiki canary fixture`,
      );
    }
  });

  it("kernel_tarball_has_no_dist_and_no_tests", () => {
    // Plan 174 Task 8: the kernel publishes TypeScript source, so the tarball carries `src/**`
    // (tests and fixtures excluded) plus the emitted manifest schema — never a `dist/` output.
    const files = getPackList(".", "@arnilo/prism");
    assert.equal(
      files.some((file) => file.startsWith("dist/")),
      false,
      `kernel tarball must not ship dist/, got ${files.filter((f) => f.startsWith("dist/")).join(", ")}`,
    );
    assert.equal(
      files.some((file) => file.includes("__tests__") || file.includes("/fixtures/")),
      false,
      `kernel tarball must not ship tests or fixtures, got ${files.filter((f) => f.includes("__tests__") || f.includes("/fixtures/")).join(", ")}`,
    );
    assert.ok(files.includes("src/index.ts"), "kernel tarball missing src/index.ts");
    assert.ok(files.includes("manifest/schema.json"), "kernel tarball missing manifest/schema.json");
    assertTarballAllowDeny("@arnilo/prism", files);
  });

  function validateProviderPackageRequirements(
    pkgDir: string,
    vendor: string,
    liveMatrixSuites: ReadonlyArray<{ id: string; status: string }>,
  ): string[] {
    const missing: string[] = [];

    // 1. Non-empty src/__tests__/wire/
    const wireDir = join(pkgDir, "src/__tests__/wire");
    if (!existsSync(wireDir) || readdirSync(wireDir).length === 0) {
      missing.push("non-empty src/__tests__/wire/");
    }

    // 2. live.test.ts calling runProviderLiveScenarios or runSystemOneLiveScenarios
    const liveTestPath = join(pkgDir, "src/__tests__/live.test.ts");
    if (!existsSync(liveTestPath)) {
      missing.push("src/__tests__/live.test.ts");
    } else {
      const liveContent = readFileSync(liveTestPath, "utf8");
      if (!/\b(runProviderLiveScenarios|runSystemOneLiveScenarios)\b/.test(liveContent)) {
        missing.push("live.test.ts calling runProviderLiveScenarios or runSystemOneLiveScenarios");
      }
    }

    // 3. Package test calling providerConformance({ recordings }) or systemOneConformance
    const testsDir = join(pkgDir, "src/__tests__");
    let hasConformance = false;
    if (existsSync(testsDir)) {
      const testFiles = readdirSync(testsDir, { withFileTypes: true })
        .filter((e) => e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".js")) && e.name !== "live.test.ts")
        .map((e) => join(testsDir, e.name));
      for (const testFile of testFiles) {
        const content = readFileSync(testFile, "utf8");
        if (/\b(providerConformance|systemOneConformance)\b/.test(content)) {
          hasConformance = true;
          break;
        }
      }
    }
    if (!hasConformance) {
      missing.push("package test calling providerConformance({ recordings }) or systemOneConformance");
    }

    // 4. Active providers/<vendor> row in scripts/live-matrix.json
    const activeRow = liveMatrixSuites.find((s) => s.id === `providers/${vendor}` && s.status === "active");
    if (!activeRow) {
      missing.push(`active providers/${vendor} row in scripts/live-matrix.json`);
    }

    return missing;
  }

  it("only_supported_provider_packages_exist", () => {
    // Plan 182 Task 2 & Plan 183 Task 6: the provider directory set equals {hyper, laya, opencode-go, typesafe}.
    // Each provider package must satisfy the supported-provider gate:
    // non-empty wire/, live.test.ts, package conformance test, and an active row in scripts/live-matrix.json.
    const providerDirs = readdirSync(join(repoRoot, "packages/providers"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    // A provider is shipped when it has a manifest. Plan 204 Task 4 lands the sign-in client under
    // packages/providers/openai-codex/src before the shell exists; Task 5 adds the manifest, and this
    // list grows with it.
    const shipped = providerDirs.filter((name) => existsSync(join(repoRoot, "packages/providers", name, "package.json")));
    assert.deepEqual(shipped, ["hyper", "laya", "liquid", "openai-codex", "opencode-go", "openrouter", "typesafe"]);
    for (const vendor of providerDirs.filter((name) => !shipped.includes(name)))
      assert.equal(
        existsSync(join(repoRoot, "packages/providers", vendor, "src/index.ts")),
        false,
        `${vendor} has no manifest, so it may not expose a provider entry point`,
      );

    const liveMatrix = JSON.parse(readFileSync(join(repoRoot, "scripts/live-matrix.json"), "utf8")) as {
      suites: Array<{ id: string; status: string }>;
    };

    for (const vendor of shipped) {
      const pkgDir = join(repoRoot, "packages/providers", vendor);
      const pkgName = `@arnilo/prism-provider-${vendor}`;
      const entry = packages.find((pkg) => pkg.name === pkgName);
      assert.ok(entry, `${pkgName} missing from packaging package list`);

      const files = getPackList(entry.dir, entry.name);
      assert.ok(files.includes("src/index.ts"), `${vendor} pack missing src/index.ts`);
      const manifest = readPkg(entry.dir);
      assert.deepEqual(
        manifest.exports,
        { ".": "./src/index.ts" },
        `${pkgName} must export its TypeScript entrypoint`,
      );
      assert.equal(
        (manifest.peerDependencies as Record<string, string>)["@arnilo/prism"],
        KERNEL_PEER,
        `${pkgName} must peer @arnilo/prism@${KERNEL_PEER}`,
      );
      assert.equal(
        (manifest.dependencies as Record<string, string> | undefined)?.["@arnilo/prism-providers"],
        undefined,
        "a standalone provider package must not depend on the family",
      );

      const missing = validateProviderPackageRequirements(pkgDir, vendor, liveMatrix.suites);
      assert.deepEqual(
        missing,
        [],
        `provider package ${vendor} is missing required supported-provider gate items: ${missing.join(", ")}`,
      );
    }

    assert.ok(!existsSync(join(repoRoot, "packages/prism-providers")), "the retired @arnilo/prism-providers workspace must be deleted");
  });

  it("provider_package_requires_recordings_live_suite_and_matrix_row", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "provider-gate-fixture-"));
    try {
      const vendor = "test-vendor";
      const pkgDir = join(tempDir, vendor);
      const makeFixture = (overrides?: {
        omitWire?: boolean;
        emptyWire?: boolean;
        omitLive?: boolean;
        invalidLive?: boolean;
        omitConformance?: boolean;
        omitMatrixRow?: boolean;
        inactiveMatrixRow?: boolean;
      }) => {
        rmSync(pkgDir, { recursive: true, force: true });
        mkdirSync(join(pkgDir, "src/__tests__"), { recursive: true });

        if (!overrides?.omitWire) {
          const wireDir = join(pkgDir, "src/__tests__/wire");
          mkdirSync(wireDir, { recursive: true });
          if (!overrides?.emptyWire) {
            writeFileSync(join(wireDir, "sample.json"), "{}");
          }
        }

        if (!overrides?.omitLive) {
          writeFileSync(
            join(pkgDir, "src/__tests__/live.test.ts"),
            overrides?.invalidLive
              ? `import { test } from "bun:test"; test("noop", () => {});`
              : `import { runProviderLiveScenarios } from "@arnilo/prism/testing";\nrunProviderLiveScenarios({});`,
          );
        }

        writeFileSync(
          join(pkgDir, "src/__tests__/package.test.ts"),
          overrides?.omitConformance
            ? `import { test } from "bun:test"; test("noop", () => {});`
            : `import { providerConformance } from "@arnilo/prism/provider-kit";\nawait providerConformance();`,
        );

        const suites: Array<{ id: string; status: string }> = [];
        if (!overrides?.omitMatrixRow) {
          suites.push({
            id: `providers/${vendor}`,
            status: overrides?.inactiveMatrixRow ? "planned" : "active",
          });
        }
        return suites;
      };

      // 1. Valid fixture passes cleanly
      const validSuites = makeFixture();
      assert.deepEqual(validateProviderPackageRequirements(pkgDir, vendor, validSuites), []);

      // 2. Missing wire directory fails
      const omitWireSuites = makeFixture({ omitWire: true });
      assert.ok(
        validateProviderPackageRequirements(pkgDir, vendor, omitWireSuites).some((m) => m.toLowerCase().includes("wire")),
        "missing wire directory must be caught",
      );

      // 3. Empty wire directory fails
      const emptyWireSuites = makeFixture({ emptyWire: true });
      assert.ok(
        validateProviderPackageRequirements(pkgDir, vendor, emptyWireSuites).some((m) => m.toLowerCase().includes("wire")),
        "empty wire directory must be caught",
      );

      // 4. Missing live.test.ts fails
      const omitLiveSuites = makeFixture({ omitLive: true });
      assert.ok(
        validateProviderPackageRequirements(pkgDir, vendor, omitLiveSuites).some((m) => m.toLowerCase().includes("live.test.ts")),
        "missing live.test.ts must be caught",
      );

      // 5. live.test.ts not calling scenario runners fails
      const invalidLiveSuites = makeFixture({ invalidLive: true });
      assert.ok(
        validateProviderPackageRequirements(pkgDir, vendor, invalidLiveSuites).some((m) => m.toLowerCase().includes("live.test.ts")),
        "live.test.ts not calling scenario runners must be caught",
      );

      // 6. Missing conformance test fails
      const omitConformanceSuites = makeFixture({ omitConformance: true });
      assert.ok(
        validateProviderPackageRequirements(pkgDir, vendor, omitConformanceSuites).some((m) => m.toLowerCase().includes("conformance")),
        "missing conformance suite call must be caught",
      );

      // 7. Missing live matrix row fails
      const omitMatrixSuites = makeFixture({ omitMatrixRow: true });
      assert.ok(
        validateProviderPackageRequirements(pkgDir, vendor, omitMatrixSuites).some((m) => m.toLowerCase().includes("live-matrix.json")),
        "missing live matrix row must be caught",
      );

      // 8. Inactive live matrix row fails
      const inactiveMatrixSuites = makeFixture({ inactiveMatrixRow: true });
      assert.ok(
        validateProviderPackageRequirements(pkgDir, vendor, inactiveMatrixSuites).some((m) => m.toLowerCase().includes("live-matrix.json")),
        "inactive live matrix row must be caught",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("retired provider family workspace is deleted, not shimmed", () => {
    // Plan 152 Task 8: the umbrella had no importable surface after Task 6; the last
    // step is deleting it. `scripts/provider-*.test.mjs` and the per-package suites
    // carry the cross-vendor conformance that used to live in its __tests__.
    assert.ok(!existsSync(join(repoRoot, "packages/prism-providers")), "packages/prism-providers must not exist");
    assert.ok(
      !existsSync(join(repoRoot, "packages/prism-providers/package.json")),
      "the retired family must not keep a manifest (no alias workspace)",
    );
  });

  it("process driver publishes the isolated testing subpath", () => {
    assert.deepEqual(readPkg("packages/drivers/process").exports, { ".": "./src/index.ts", "./testing": "./src/testing.ts" });
  });

  it("work package exports the family subpaths behind one root barrel", () => {
    const manifest = readPkg("packages/tools/work");
    const exports = manifest.exports as Record<string, string>;
    assert.deepEqual(Object.keys(exports).sort(), [
      ".",
      "./connectors",
      "./connectors/drafts",
      "./connectors/google-workspace",
      "./connectors/microsoft365",
      "./diagrams",
      "./document-extraction",
      "./document-reader",
      "./documents",
      "./sandbox",
      "./sheets",
      "./skills",
      "./tools",
    ]);
    assert.equal(exports["."], "./src/index.ts", "the root barrel holds the definePackage entry");
    const files = getPackList("packages/tools/work", "@arnilo/prism-tools-work");
    for (const required of [
      "src/connectors/index.ts",
      "src/connectors/drafts.ts",
      "src/connectors/google-workspace.ts",
      "src/connectors/microsoft365.ts",
      "src/documents/index.ts",
      "src/sheets/index.ts",
      "src/diagrams/index.ts",
      "src/document-extraction/index.ts",
      "docling/ocr.py",
      "src/document-reader/index.ts",
      "src/sandbox/index.ts",
      "src/skills/index.ts",
      "src/tools/index.ts",
      "vendor/hermes-agent/skills/productivity/docx/SKILL.md",
      "vendor/hermes-agent/skills/productivity/xlsx/SKILL.md",
      "vendor/hermes-agent/skills/productivity/powerpoint/SKILL.md",
      "vendor/hermes-agent/skills/productivity/pdf/SKILL.md",
    ]) {
      assert.ok(files.includes(required), `work pack missing ${required}`);
    }
    const connectors = readFileSync(join(repoRoot, "packages/tools/work/src/connectors/index.ts"), "utf8");
    assert.doesNotMatch(connectors, /office-open|\.\.\/documents/, "connectors subpath must not load document dependencies");
  });

  it("retired_family_workspaces_are_deleted", () => {
    const retired: ReadonlyArray<readonly [string, string]> = [
      ["packages/prism-core", "@arnilo/" + "prism-core"],
      ["packages/prism-" + "coding-tools", "@arnilo/prism-" + "coding-tools"],
      ["packages/" + "agent-sdk", "@arnilo/prism-" + "agent-sdk"],
      ["packages/hosts/" + "acp-agent", "@arnilo/prism-" + "acp-agent"],
      ["packages/prism-providers", "@arnilo/prism-providers"],
    ];
    const root = readPkg(".");
    const workspaceJson = JSON.stringify(root.workspaces);
    const manifests = packages.map((pkg) => readPkg(pkg.dir));
    for (const [dir, name] of retired) {
      assert.equal(existsSync(join(repoRoot, dir)), false, `${dir} must be deleted`);
      const slug = name.slice("@arnilo/".length);
      assert.equal(workspaceJson.includes(slug), false, `root workspaces still name ${name}`);
      for (const manifest of manifests) {
        assert.equal(JSON.stringify(manifest).includes(name), false, `${String(manifest.name)} still names the retired package ${name}`);
      }
    }
  });

  it("independent_packages_list_names_only_live_workspaces", () => {
    const list = (JSON.parse(readFileSync(join(repoRoot, "scripts", "independent-packages.json"), "utf8")) as { packages: string[] })
      .packages;
    const live = new Set(packages.map((pkg) => pkg.name));
    for (const name of list) assert.ok(live.has(name), `independent-packages.json names a missing workspace: ${name}`);
  });

  it("work move has no forbidden runtime package edges", () => {
    const work = readPkg("packages/tools/work");
    for (const manifest of [work]) {
      const runtime = {
        ...(manifest.dependencies as Record<string, string> | undefined),
        ...(manifest.peerDependencies as Record<string, string> | undefined),
      };
      assert.equal(runtime["@arnilo/prism-tools-work"], undefined, "core must not runtime-depend on work");
      assert.equal(runtime["@arnilo/" + "prism-core"], undefined, "work must not runtime-depend on core");
      assert.equal(runtime["@arnilo/prism-" + "coding-tools"], undefined, "work must not runtime-depend on coding tools");
    }
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() && entry.name !== "__tests__"
          ? walk(join(dir, entry.name))
          : entry.name.endsWith(".js") || entry.name.endsWith(".ts")
            ? [join(dir, entry.name)]
            : [],
      );
    for (const dir of [join(repoRoot, "packages/tools/work/src")]) {
      for (const file of walk(dir)) {
        const text = readFileSync(file, "utf8");
        // The trailing delimiter keeps `@arnilo/prism-workflows` (a different, allowed package) out of the match.
        assert.doesNotMatch(
          text,
          /(?:from\s+|import\s*(?:\(\s*)?)["']@arnilo\/prism-(?:core|coding-tools|work)["'/]/,
          `${file} has a forbidden runtime package edge`,
        );
      }
    }
  });

  it("workspace_tree_resolves_under_bun", () => {
    // Plan 164 Task 8.4 took npm out of the release path, so this replaces `npm ls --all --depth=0`.
    // It is stricter about what actually broke the gate: a retired workspace used to leave a
    // dangling `node_modules/@arnilo/*` symlink behind, which made npm exit non-zero.
    const workspaces = workspaceManifests();
    assert.ok(workspaces.length >= 40, `expected the workspace globs to expand, found ${workspaces.length}`);

    // A declared dependency must resolve from its own workspace: `dependencies` always, peers unless
    // the manifest marks them optional (optional peers and optionalDependencies may be absent —
    // `@arnilo/prism-tools-coding`'s `e2b` peer is one, and npm only warned about those).
    const unresolved: string[] = [];
    for (const { dir, manifest } of workspaces) {
      const optionalPeers = new Set(
        Object.entries((manifest.peerDependenciesMeta as Record<string, { optional?: boolean }> | undefined) ?? {})
          .filter(([, meta]) => meta?.optional === true)
          .map(([name]) => name),
      );
      const required = {
        ...(manifest.dependencies as Record<string, string> | undefined),
        ...Object.fromEntries(
          Object.entries((manifest.peerDependencies as Record<string, string> | undefined) ?? {}).filter(
            ([name]) => !optionalPeers.has(name),
          ),
        ),
      };
      for (const name of Object.keys(required)) {
        // `createRequire` is Node's own resolution algorithm and is what npm used to walk here;
        // it keeps this check runtime-agnostic (no `Bun` global, no `npm` subprocess).
        const resolve = createRequire(join(repoRoot, dir, "package.json")).resolve;
        try {
          resolve(`${name}/package.json`);
        } catch {
          try {
            resolve(name);
          } catch {
            unresolved.push(`${manifest.name} -> ${name}`);
          }
        }
      }
    }
    assert.deepEqual(unresolved, [], `workspace dependencies must resolve:\n${unresolved.join("\n")}`);

    // And every `@arnilo` link must be a working link to a live publishable workspace.
    const scopeDir = join(repoRoot, "node_modules", "@arnilo");
    const live = new Set(workspaces.map(({ manifest }) => manifest.name));
    const stale = readdirSync(scopeDir).filter(
      (link) => link !== "prism" && (!existsSync(join(scopeDir, link)) || !live.has(`@arnilo/${link}`)),
    );
    assert.deepEqual(stale, [], `node_modules/@arnilo must hold a working link per live workspace and nothing else: ${stale.join(", ")}`);
  });

  it("plan 054 Task 7: every retired name has legacy-registry metadata and a successor/recipe anchor", () => {
    const evidence = readFileSync(join(repoRoot, "docs/_evidence/phase54-package-map.md"), "utf8");
    const guide = readFileSync(join(repoRoot, "docs/history/migrate-to-0.4.md"), "utf8");
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

  it("the private reference host is not a published package", () => {
    assert.equal(
      packages.some((pkg) => pkg.name === "@arnilo/prism-agent"),
      false,
    );
  });

  it("plan 054 Task 8: the historical migration guide preserves office subpaths", () => {
    const work = readPkg("packages/tools/work");
    const exports = Object.keys(work.exports as Record<string, unknown>).sort();
    assert.ok(["./diagrams", "./documents", "./sheets"].every((subpath) => exports.includes(subpath)));
    const guide = readFileSync(join(repoRoot, "docs/history/migrate-to-0.4.md"), "utf8");
    assert.ok(guide.includes("### Office suite"), "migration guide missing Office suite heading");
    for (const spec of ["@arnilo/prism-office/documents", "@arnilo/prism-office/sheets", "@arnilo/prism-office/diagrams"]) {
      assert.ok(guide.includes(spec), `migration guide missing ${spec}`);
    }
    const truth = JSON.parse(readFileSync(join(repoRoot, "scripts/package-truth.json"), "utf8")) as { counts: { publishable: number } };
    assert.equal(truth.counts.publishable, packages.length, "package truth must report every packaged manifest");
  });

  it("0.4 package set — 61 manifests in lockstep, no shims, family roots stay inert", () => {
    const root = readPkg(".");
    const names = packages.map((pkg) => pkg.name).sort();
    assert.equal(names.length, 47, "47 active packages including root (OpenRouter and OpenAI Codex restored)");
    assert.ok(names.includes("@arnilo/prism-tools-work"), "work package must be present");
    assert.ok(!names.includes("@arnilo/prism-office"), "office package must be absent");
    // Plan 140 Task 1: the SDK is on its own version line (0.1.x).
    const independentLines = new Set<string>([]);
    for (const pkg of packages.filter((p) => !independentLines.has(p.name))) {
      // Plan 055/066/070 cut history lives in CHANGELOG.md; here the invariant is the
      // lockstep itself: every active manifest at the root version (plan 071 Task 1).
      assert.equal(readPkg(pkg.dir).version, root.version, `${pkg.name} must be at the root lockstep version ${root.version}`);
    }
    const retired = ["@arnilo/prism-base", "@arnilo/prism-sdk", "@arnilo/prism-all", "@arnilo/prism-browser"];
    for (const name of retired) {
      assert.ok(!names.includes(name), `retired ${name} must not be a workspace package`);
    }
    for (const dir of ["packages/tools/work"]) {
      const exports = Object.keys((readPkg(dir).exports as Record<string, unknown>) ?? {});
      assert.ok(exports.includes("."), `${dir} must expose the definePackage root barrel`);
    }
  });

  it("prism_code_package_is_gone: the lab workspace and its build script are deleted", () => {
    assert.ok(!existsSync(join(repoRoot, "packages/prism-code")), "packages/prism-code must not exist");
    assert.ok(!(readPkg(".").workspaces as string[]).includes("packages/prism-code"), "workspaces must not list packages/prism-code");
    const scripts = readPkg(".").scripts as Record<string, string>;
    assert.ok(!String(scripts.build).includes("@arnilo/prism-code"), "build must not name @arnilo/prism-code");
    assert.ok(!packages.some((pkg) => pkg.name === "@arnilo/prism-code"), "the package set must not include @arnilo/prism-code");
    assert.ok(
      !existsSync(join(repoRoot, "scripts/build-prism-code-binaries.mjs")),
      "the lab-exclusive binary build script must be deleted",
    );
  });

  // Plan 175 Task 7: the version cut rewrites every `requires.prism` and internal range to the
  // 0.13.0 line. These two guards fail on a stale 0.12 pin, a pre-release range, or a missed source.
  const packageSourceFiles = (): string[] => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist") continue;
          walk(join(dir, entry.name));
        } else if (entry.name.endsWith(".ts")) files.push(join(dir, entry.name));
      }
    };
    walk(join(repoRoot, "packages"));
    return files;
  };

  it("every_package_declares_api_level", () => {
    const declared = new Map<string, string>();
    let prismOnly = 0;
    for (const file of packageSourceFiles().filter((file) => !file.includes("/__tests__/"))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/requires:\s*\{\s*api:\s*([0-9]+|KERNEL_API_LEVEL)/g)) {
        declared.set(`${file}:${match.index}`, match[1] === "KERNEL_API_LEVEL" ? "1" : match[1]);
      }
      prismOnly += [...text.matchAll(/requires:\s*\{\s*prism:/g)].length;
    }
    // The `definePackage` entries (not the `"*"` test fixtures) must declare the level.
    assert.ok(declared.size >= 28, `every definePackage requires.api must be scanned, found ${declared.size}`);
    const stale = [...declared.entries()].filter(([, api]) => api !== "1");
    assert.deepEqual(stale, [], "every definePackage requires.api must be 1");
    assert.equal(prismOnly, 0, "no source may gate on requires.prism alone; declare requires.api");
  });

  it("peer_ranges_are_wide", () => {
    for (const pkg of packages.filter((entry) => !entry.isCore && !entry.isMeta)) {
      const range = (readPkg(pkg.dir).peerDependencies as Record<string, string> | undefined)?.["@arnilo/prism"];
      assert.equal(range, KERNEL_PEER, `${pkg.name} peer must be ${KERNEL_PEER}, got ${range}`);
      const parsed = parseRange(range);
      assert.ok(satisfies(parseVersion("0.14.0") as never, parsed), `${pkg.name} must admit kernel 0.14.0`);
      assert.equal(satisfies(parseVersion("1.0.0") as never, parsed), false, `${pkg.name} must reject kernel 1.0.0`);
    }
  });

  it("no_prerelease_or_0_12_range_in_manifests", () => {
    const manifests: Array<Record<string, unknown>> = [{ file: "package.json", ...readPkg(".") }];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist") continue;
          walk(join(dir, entry.name));
        } else if (entry.name === "package.json") {
          manifests.push({ file: join(dir, entry.name), ...(JSON.parse(readFileSync(join(dir, entry.name), "utf8")) as Record<string, unknown>) });
        }
      }
    };
    walk(join(repoRoot, "packages"));
    const offenders: string[] = [];
    for (const manifest of manifests) {
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        for (const [name, range] of Object.entries((manifest[field] as Record<string, string> | undefined) ?? {})) {
          if (!name.startsWith("@arnilo/")) continue;
          if (String(range).includes("0.13.0-0")) offenders.push(`${manifest.file} ${field}.${name}=${range}`);
          if (String(range).startsWith("^0.12")) offenders.push(`${manifest.file} ${field}.${name}=${range}`);
        }
      }
    }
    for (const file of packageSourceFiles()) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/requires:\s*\{\s*prism:\s*"([^"]+)"/g)) {
        if (match[1].includes("0.13.0-0") || match[1].startsWith("^0.12")) offenders.push(`${file} requires.prism=${match[1]}`);
      }
    }
    assert.deepEqual(offenders, [], "no manifest or requires.prism may name 0.13.0-0 or the 0.12 line");
  });
});
