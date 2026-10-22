import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");

describe("@arnilo/prism-tools-browser module graph", () => {
  it("playwright_not_loaded_unless_tools_browser_listed", () => {
    // Static: no source module value-imports playwright-core; the package requires it lazily in
    // setup, and the kernel never names it.
    const script = [
      'const browserPkg = await import("@arnilo/prism-tools-browser");',
      'const toolsWeb = (await import("@arnilo/prism-tools-web")).default;',
      'const toolsCoding = (await import("@arnilo/prism-tools-coding")).default;',
      'const { approvalPackage } = await import("@arnilo/prism-approval");',
      'const { createAgent } = await import("@arnilo/prism");',
      "const agent = await createAgent({",
      '  model: { provider: "mock", model: "m" },',
      "  packages: [",
      "    toolsCoding({ root: process.cwd() }),",
      '    toolsWeb({ backend: "brave", apiKey: "env:PRISM_PROBE_KEY" }),',
      '    approvalPackage({ mode: "auto" }),',
      "  ],",
      "});",
      "await agent.dispose();",
      'const seen = () => Object.keys(require.cache ?? {}).some((key) => key.includes("playwright-core"));',
      "const before = seen();",
      'await import("playwright-core");',
      "const after = seen();",
      'console.log(JSON.stringify({ inert: typeof browserPkg.createBrowserTools === "function", before, after }));',
    ].join("\n");
    const result = spawnSync("bun", ["-e", script], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const probe = JSON.parse(result.stdout.trim()) as { inert: boolean; before: boolean; after: boolean };
    assert.equal(probe.inert, true, "the package module loads without playwright-core");
    assert.equal(probe.before, false, "playwright-core is absent from an agent that does not list tools-browser");
    assert.equal(probe.after, true, "the probe can observe playwright-core once it is loaded");
  });
});
