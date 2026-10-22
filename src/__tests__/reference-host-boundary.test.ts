import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computePackageTruth,
  workspaceShape,
  // @ts-expect-error package-truth is a directly runnable script, same as release.mjs.
} from "../../scripts/package-truth.mjs";
import { classify, REJECT, referenceHostPackages } from "./reference-host-allowlist.js";

/**
 * Reference-host boundary (plan 172 Task 3). Scans `apps/prism-agent/{src,bin}` and fails closed
 * on a specifier the Task 1 (a) allow-list cannot prove. The package allow-list is derived from
 * non-private `packages/<group>/<name>` manifests minus the flat 0.12 reject list.
 * The allow-list and `classify` live in `reference-host-allowlist.ts` (plan 173 Task 9) so the
 * README walkthrough is checked against the same rules.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const APP = join(REPO, "apps/prism-agent");
const TUI = ["@mariozechner/pi-tui", "ink", "blessed", "neo-blessed", "terminal-kit"];
const FROM_CLAUSE = /\b(?:import|export)\s+(?:type\s+)?([^'"`;]*?)\s*from\s*["']([^"']+)["']/g;
const LITERAL_CALL = /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;
const NON_LITERAL = /\b(?:import|require)\s*\(\s*(?!["'])/g;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " ")).replace(/\/\/.*$/gm, (line) => " ".repeat(line.length));
}

function appFiles(appRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== "node_modules") walk(path);
      } else if (name.endsWith(".ts")) out.push(path);
    }
  };
  walk(join(appRoot, "src"));
  walk(join(appRoot, "bin"));
  return out;
}

export function scanReferenceHost(appRoot: string, packages = referenceHostPackages(REPO)): string[] {
  const violations: string[] = [];
  for (const file of appFiles(appRoot)) {
    const text = stripComments(readFileSync(file, "utf8"));
    const where = relative(appRoot, file);
    if ([...text.matchAll(NON_LITERAL)].length > 0) violations.push(`${where}: non-literal dynamic import`);
    const specs = [...text.matchAll(FROM_CLAUSE)]
      .map((match) => match[2]!)
      .concat([...text.matchAll(LITERAL_CALL)].map((match) => match[1]!));
    for (const spec of specs) {
      const reason = classify(spec, file, appRoot, packages);
      if (reason) violations.push(`${where}: ${reason}`);
    }
  }
  return violations;
}

function tuiDependencies(manifest: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}): string[] {
  const names = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  });
  return names.filter((name) => name.startsWith("@opentui/") || TUI.includes(name));
}

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-gate-"));
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

describe("reference host boundary", () => {
  const packages = referenceHostPackages(REPO);

  it("reference_host_imports_only_public_surface", () => {
    assert.ok(packages.has("@arnilo/prism-tools-research"), "a new native package is allowed without editing this test");
    assert.equal(packages.has("@arnilo/prism-channels"), true, "do not reject from PRISM_FAMILY");
    for (const name of REJECT) assert.equal(packages.has(name), false, `${name} stays rejected`);
    assert.ok(appFiles(APP).length >= 2, "the scaffold must be scanned");
    assert.deepEqual(scanReferenceHost(APP, packages), []);

    const clean = fixture({
      "src/ok.ts": `import { createAgent } from "@arnilo/prism";\nimport research from "@arnilo/prism-tools-research";\nimport "@arnilo/prism/manifest";\nexport const unused = [createAgent, research];\n`,
      "src/scenarios/offline.ts": `import { mockProvider } from "@arnilo/prism/testing";\nexport const provider = mockProvider;\n`,
      "src/__tests__/helper.ts": `import { mockProvider } from "@arnilo/prism/testing/tool-conformance";\nexport const helper = mockProvider;\n`,
    });
    try {
      assert.deepEqual(scanReferenceHost(clean, packages), []);
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }

    const violations: Array<[string, string, string]> = [
      ["family package", "src/bad.ts", `import core from "${"@arnilo/" + "prism-core"}";\n`],
      ["prism-code", "src/bad.ts", `import code from "@arnilo/prism-code";\n`],
      ["provider-kit", "src/bad.ts", `import kit from "@arnilo/prism/provider-kit";\n`],
      ["node subpath", "src/bad.ts", `import config from "@arnilo/prism/node/config";\n`],
      ["deep path", "src/bad.ts", `import ledger from "@arnilo/prism-tools-research/src/ledger.ts";\n`],
      ["testing outside", "src/index.ts", `import { mockProvider } from "@arnilo/prism/testing";\n`],
      ["non-literal", "src/bad.ts", `const name = "@arnilo/prism";\nimport(name);\n`],
      ["relative escape", "src/bad.ts", `import outside from "../../outside";\n`],
    ];
    for (const [label, rel, text] of violations) {
      const root = fixture({ [rel]: text });
      try {
        const found = scanReferenceHost(root, packages);
        assert.ok(found.length > 0, `${label} must fail`);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("reference_host_has_no_terminal_ui_dependency", () => {
    const manifest = JSON.parse(readFileSync(join(APP, "package.json"), "utf8"));
    assert.deepEqual(tuiDependencies(manifest), []);
    assert.ok(tuiDependencies({ dependencies: { ink: "1.0.0" } }).includes("ink"));
    assert.ok(tuiDependencies({ devDependencies: { "@opentui/core": "1.0.0" } }).includes("@opentui/core"));
  });

  it("reference_host_is_private", () => {
    const manifest = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")) as { private?: boolean; exports?: unknown };
    assert.equal(manifest.private, true);
    assert.equal(manifest.exports, undefined, "omitted exports keep the app out of the e2e coverage gate");
  });

  it("package_truth_skips_private_workspaces", () => {
    const truth = computePackageTruth(REPO) as { versions: Record<string, string>; capability: string[]; counts: { workspace: number } };
    assert.equal(truth.versions["@arnilo/prism-agent"], undefined);
    assert.equal(truth.capability.includes("@arnilo/prism-agent"), false);
    assert.equal(workspaceShape(REPO).names.includes("prism-agent"), false);
    assert.ok(truth.counts.workspace > 0);
  });
});
