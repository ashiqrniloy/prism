import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent, createMemorySessionStore, providerDone, providerTextDelta } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createMockProvider, packageConformance } from "@arnilo/prism/testing";
import workflows, { defineWorkflow, functionNode, runWorkflow } from "../index.js";

describe("@arnilo/prism-workflows package", () => {
  it("workflows_package_conformance", async () => {
    const result = await packageConformance(workflows);
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  }, 60_000);

  it("no_checkpoints_service_status_note", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackage("test-provider", [createMockProvider([providerTextDelta("ok"), providerDone()])]), workflows],
    });
    assert.match(JSON.stringify(agent.inspect()), /no checkpoints service; workflow runs are not durable across processes/);
    // With no store package listed the engine still runs, in memory.
    const result = await runWorkflow(
      defineWorkflow({ revision: "1", id: "memory-wf", nodes: { n: functionNode({ execute: () => "ok" }) } }),
      null,
    );
    assert.equal(result.status, "succeeded");
    await agent.dispose();
  });

  it("root_import_loads_no_store_driver", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
    const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));
    assert.ok(files.length >= 3);
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      assert.doesNotMatch(source, /from "(bun:sqlite|pg)"|require\("(bun:sqlite|pg)"\)/, file);
    }
    const manifest = JSON.parse(readFileSync(join(dir, "..", "package.json"), "utf8"));
    assert.deepEqual(Object.keys(manifest.dependencies ?? {}), []);
  });
});
