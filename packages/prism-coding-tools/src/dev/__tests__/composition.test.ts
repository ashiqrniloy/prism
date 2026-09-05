/**
 * Plan 040 Task 1 — composition guard: the package consumes only public
 * exports of core/server/ag-ui, never core internals, and validates its own
 * release posture (peer range, umbrella omission).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createPrismDevInspector } from "../index.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const srcRoot = join(pkgRoot, "src/dev");

function readManifest(
  rel: string,
): Record<string, unknown> & { name: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(join(pkgRoot, rel), "utf8"));
}

function sourceImportSpecifiers(): { relative: string[]; arnilo: string[]; other: string[] } {
  const relative: string[] = [];
  const arnilo: string[] = [];
  const other: string[] = [];
  for (const name of readdirSync(srcRoot)) {
    if (!name.endsWith(".ts")) continue;
    const text = readFileSync(join(srcRoot, name), "utf8");
    for (const match of text.matchAll(/(?:import|export)[^"']*from\s*"([^"]+)"/g)) {
      const specifier = match[1]!;
      if (specifier.startsWith(".")) relative.push(specifier);
      else if (specifier.startsWith("@arnilo/")) arnilo.push(specifier);
      else other.push(specifier);
    }
  }
  return { relative, arnilo, other };
}

describe("composition (plan 040 Task 1)", () => {
  it("imports only public seams: no core internals, allow-listed @arnilo specifiers", () => {
    const { relative, arnilo, other } = sourceImportSpecifiers();
    for (const specifier of relative) {
      assert.ok(specifier.startsWith("./"), `relative import must stay inside the package: ${specifier}`);
    }
    // Public seams only: peer core, peer server, peer ag-ui subpaths. No
    // deeper core subpath (e.g. @arnilo/prism/testing/...) and no internals.
    const allowList = ["@arnilo/prism", "@arnilo/prism-server", "@arnilo/prism-core/runtime/server", "@arnilo/prism-ag-ui/renderer"];
    assert.deepEqual(
      [...new Set(arnilo)].sort(),
      [...new Set(arnilo)].filter((used) => allowList.includes(used)).sort(),
      "arnilo imports must stay inside the documented seam allow-list",
    );
    assert.deepEqual(
      [...new Set(other)].sort(),
      // node builtins only (http server seam + the Task-4 CLI bin's fs/path/url/process/stream)
      ["node:fs", "node:http", "node:path", "node:process", "node:stream", "node:url"],
      "only node builtins besides the seam imports: no third-party runtime dependencies",
    );
  });

  it("manifest: peers ^0.5.0, diff dependency declared", () => {
    const manifest = readManifest("package.json");
    assert.equal(manifest.name, "@arnilo/prism-coding-tools");
    assert.equal(manifest.version, "0.5.0");
    assert.equal(manifest.peerDependencies?.["@arnilo/prism"], "^0.5.0");
    assert.ok(manifest.dependencies?.diff, "diff dependency declared");
    assert.equal(manifest.private, undefined, "must be publishable");
  });

  it("boot: create + bind stays under the 1s envelope (excl. host model calls)", async () => {
    const inspector = createPrismDevInspector({ agent: mockAgent(), port: 0 });
    const started = performance.now();
    await inspector.listen();
    const bootMs = performance.now() - started;
    assert.ok(bootMs < 1000, `boot took ${bootMs.toFixed(0)}ms, budget 1000ms`);
    await inspector.close();
  });

  it("composed handler: direct agent run flows through createPrismHandler with the local-user default", async () => {
    const inspector = createPrismDevInspector({ agent: mockAgent("Hello from mock"), port: 0 });
    await inspector.listen();
    try {
      const response = await fetch(`${inspector.url}/agents/default/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "Hi" }),
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(response.status, 200);
      const result = (await response.json()) as { text: string; status: string };
      assert.equal(result.text, "Hello from mock");
      assert.equal(result.status, "succeeded");
    } finally {
      await inspector.close();
    }
  });
});

function mockAgent(text = "Hello"): ReturnType<typeof createAgent> {
  return createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerTextDelta(text), providerDone()]),
  });
}
