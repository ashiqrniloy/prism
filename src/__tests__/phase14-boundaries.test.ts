import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function files(dir: string, predicate: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, predicate) : predicate(path) ? [path] : [];
  });
}

describe("phase 14 observational memory boundaries", () => {
  it("phase14_observational_memory_imports_from_public_entrypoint", async () => {
    const mod = await import("../../packages/compaction-observational-memory/" + "dist/index.js") as Record<string, unknown>;
    for (const name of [
      "createObservationalMemoryRuntime",
      "createObservationalMemoryCompactionStrategy",
      "createObservationalMemoryExtension",
      "foldObservationalMemoryLedger",
      "buildObservationalMemoryProjection",
      "renderObservationalMemory",
      "recallObservationalMemory",
      "createRecallMemoryTool",
      "createMemoryStatusCommand",
      "createMemoryViewCommand",
      "createObservationalMemoryCommands",
      "resolveObservationalMemorySettings",
      "createMemoryId",
    ]) assert.equal(typeof mod[name], "function", `missing ${name}`);
    assert.equal(mod.packageName, "@arnilo/prism-compaction-observational-memory");
    assert.equal(mod.OBSERVATIONS_RECORDED, "om.observations.recorded");
    assert.equal(mod.REFLECTIONS_RECORDED, "om.reflections.recorded");
    assert.equal(mod.OBSERVATIONS_DROPPED, "om.observations.dropped");
    assert.equal(mod.FOLDED_MEMORY, "om.folded");
  });

  it("phase14_observational_memory_setup_is_inert", async () => {
    const { createObservationalMemoryExtension, createObservationalMemoryRuntime } = await import("../../packages/compaction-observational-memory/" + "dist/index.js") as any;
    let providerCalls = 0;
    const workerProvider = { generate: () => { providerCalls++; throw new Error("provider should not run during construction/setup"); } };
    const session = { id: "s1", entries: async () => [], checkout: async () => undefined };
    const runtime = createObservationalMemoryRuntime({ session, appendEntry: async () => { throw new Error("append should not run during construction"); }, workerProvider, workerModel: { provider: "mock", model: "memory" } });
    assert.equal(runtime.status().inFlight, false);
    createObservationalMemoryExtension({ recallTool: { getEntries: () => [] }, commands: { getEntries: () => [] } }).setup({
      registerCompactionStrategy: () => undefined,
      registerTool: () => undefined,
      registerCommand: () => undefined,
    });
    assert.equal(providerCalls, 0);
  });

  it("phase14_docs_index_links_observational_memory_page", () => {
    const index = readFileSync("docs/index.md", "utf8");
    const page = readFileSync("docs/compaction-observational-memory.md", "utf8");
    assert.ok(existsSync("docs/compaction-observational-memory.md"));
    assert.ok(index.includes("(compaction-observational-memory.md)"));
    for (const text of ["createRecallMemoryTool", "createMemoryStatusCommand", "createMemoryViewCommand", "createObservationalMemoryCompactionStrategy", "appendEntry", "tool_call", "tool_result"]) {
      assert.ok(page.includes(text), `docs missing ${text}`);
    }
    assert.equal(page.includes("session, matching `store`"), false, "docs still describe mismatched session/store runtime API");
  });

  it("phase14_package_exports_files_are_minimal", () => {
    const pkg = JSON.parse(readFileSync("packages/compaction-observational-memory/package.json", "utf8"));
    assert.deepEqual(pkg.exports["."], { types: "./dist/index.d.ts", default: "./dist/index.js" });
    assert.deepEqual(pkg.files, ["dist", "!dist/__tests__", "!dist/**/*.map", "README.md", "CHANGELOG.md"]);
    assert.deepEqual(pkg.dependencies ?? {}, {});
    assert.deepEqual(pkg.devDependencies ?? {}, { "@arnilo/prism": "file:../.." });
    assert.equal(pkg.peerDependencies["@arnilo/prism"], "0.0.1");
    assert.equal(pkg.scripts.postinstall, undefined);
  });

  it("phase14_live_tests_are_skipped_by_default", () => {
    const text = readFileSync("packages/compaction-observational-memory/src/__tests__/live.test.ts", "utf8");
    assert.ok(text.includes("PRISM_LIVE_OBSERVATIONAL_MEMORY_TESTS"));
    assert.ok(text.includes("skip:"));
  });

  it("phase14_core_does_not_default_to_observational_memory", () => {
    const text = files("src", (path) => path.endsWith(".ts") && !path.includes("src/__tests__"))
      .map((path) => readFileSync(path, "utf8")).join("\n");
    assert.equal(text.includes("@arnilo/prism-compaction-observational-memory"), false);
    assert.equal(text.includes("createObservationalMemoryCompactionStrategy"), false);
    assert.equal(text.includes("observational-memory"), false);
  });

  it("phase14_no_real_secrets_in_docs_or_fixtures", () => {
    const text = [
      ...files("docs", (path) => path.endsWith(".md")),
      ...files("packages/compaction-observational-memory", (path) => /(__tests__|README\.md)/.test(path) && /\.(ts|md)$/.test(path)),
    ].map((path) => readFileSync(path, "utf8")).join("\n");
    assert.equal(/sk-[A-Za-z0-9]{20,}/.test(text), false);
    assert.equal(/Bearer\s+[A-Za-z0-9._-]{24,}/.test(text), false);
  });
});
