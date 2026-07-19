import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createExtensionKernel, type CompactionStrategy, type Extension } from "../index.js";

function files(dir: string, predicate: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, predicate) : predicate(path) ? [path] : [];
  });
}

describe("phase 13 compaction llm boundaries", () => {
  it("phase13_compaction_llm_imports_from_public_entrypoint", async () => {
    const mod = await import("../../packages/compaction-llm/" + "dist/index.js") as Record<string, unknown>;
    for (const name of [
      "createLlmCompactionStrategy",
      "createLlmCompactionExtension",
      "prepareLlmCompaction",
      "serializeCompactionConversation",
      "collectFileOperations",
      "estimateEntryTokens",
    ]) assert.equal(typeof mod[name], "function", `missing ${name}`);
    assert.equal(typeof mod.SUMMARIZATION_SYSTEM_PROMPT, "string");
    assert.equal(typeof mod.packageName, "string");
  });

  it("phase13_compaction_llm_setup_is_inert", async () => {
    type LlmCompactionModule = {
      createLlmCompactionStrategy(options: unknown): CompactionStrategy;
      createLlmCompactionExtension(options: unknown): Extension;
    };
    const { createLlmCompactionExtension, createLlmCompactionStrategy } = await import("../../packages/compaction-llm/" + "dist/index.js") as LlmCompactionModule;
    let calls = 0;
    const options = {
      summaryProvider: () => { calls++; throw new Error("provider factory should not run during setup"); },
      credential: () => { calls++; return "fake-key"; },
      summaryModel: { provider: "mock", model: "summary" },
    };

    createLlmCompactionStrategy(options);
    await createExtensionKernel().load([createLlmCompactionExtension(options)]);

    assert.equal(calls, 0);
  });

  it("phase13_docs_index_links_compaction_llm_page", () => {
    const index = readFileSync("docs/index.md", "utf8");
    assert.ok(existsSync("docs/compaction-llm.md"));
    assert.ok(index.includes("(compaction-llm.md)"));
  });

  it("phase13_package_exports_files_are_minimal", () => {
    const pkg = JSON.parse(readFileSync("packages/compaction-llm/package.json", "utf8"));
    assert.deepEqual(pkg.exports["."], { types: "./dist/index.d.ts", default: "./dist/index.js" });
    assert.deepEqual(pkg.files, ["dist", "!dist/__tests__", "!dist/**/*.map", "README.md", "CHANGELOG.md"]);
    assert.deepEqual(pkg.dependencies ?? {}, {});
    assert.deepEqual(pkg.devDependencies ?? {}, { "@arnilo/prism": "file:../.." });
    assert.equal(pkg.peerDependencies["@arnilo/prism"], "0.0.7");
    assert.equal(pkg.scripts.postinstall, undefined);
  });

  it("phase13_live_tests_are_skipped_by_default", () => {
    const text = readFileSync("packages/compaction-llm/src/__tests__/live.test.ts", "utf8");
    assert.ok(text.includes("PRISM_LIVE_COMPACTION_TESTS"));
    assert.ok(text.includes("skip:"));
  });

  it("phase13_core_does_not_default_to_llm_compaction", () => {
    const text = files("src", (path) => path.endsWith(".ts") && !path.includes("src/__tests__"))
      .map((path) => readFileSync(path, "utf8")).join("\n");
    assert.equal(text.includes("@arnilo/prism-compaction-llm"), false);
    assert.equal(text.includes("createLlmCompactionStrategy"), false);
    assert.equal(text.includes("llm-compaction"), false);
  });

  it("phase13_no_real_secrets_in_docs_or_fixtures", () => {
    const text = [
      ...files("docs", (path) => path.endsWith(".md")),
      ...files("packages/compaction-llm", (path) => /(__tests__|README\.md)/.test(path) && /\.(ts|md)$/.test(path)),
    ].map((path) => readFileSync(path, "utf8")).join("\n");
    assert.equal(/sk-[A-Za-z0-9]{20,}/.test(text), false);
    assert.equal(/Bearer\s+[A-Za-z0-9._-]{24,}/.test(text), false);
  });
});
