import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createExtensionKernel } from "@arnilo/prism";
import {
  WIKI_INJECTOR_NAME,
  WIKI_READ_PAGE_TOOL_NAME,
  WIKI_RECORD_INSIGHT_TOOL_NAME,
  WIKI_SEARCH_TOOL_NAME,
  createWikiExtension,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, "../../package.json");

describe("prism-wiki primitive seams & package scaffold", () => {
  it("package_metadata_conforms_to_independent_release_spec", () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    assert.equal(pkg.name, "@arnilo/prism-wiki");
    assert.equal(pkg.version, "0.0.1");
    assert.deepEqual(pkg.exports["."], { types: "./dist/index.d.ts", default: "./dist/index.js" });
    assert.equal(pkg.peerDependencies["@arnilo/prism"], "^0.3.0");
    assert.equal(pkg.publishConfig?.access, "public");
  });

  it("createWikiExtension_registers_tools_commands_skills_and_injectors", async () => {
    const kernel = createExtensionKernel();
    const wikiExt = createWikiExtension({
      wikiRoot: ".wiki-test",
      profile: "codebase",
    });

    assert.equal(wikiExt.name, "@arnilo/prism-wiki");
    await kernel.load([wikiExt]);

    // Verify Tools registered in registry
    assert.ok(kernel.registries.tools.get(WIKI_SEARCH_TOOL_NAME));
    assert.ok(kernel.registries.tools.get(WIKI_READ_PAGE_TOOL_NAME));
    assert.ok(kernel.registries.tools.get(WIKI_RECORD_INSIGHT_TOOL_NAME));

    // Verify Commands registered in registry
    assert.ok(kernel.registries.commands.get("wiki-init"));
    assert.ok(kernel.registries.commands.get("wiki-refresh"));
    assert.ok(kernel.registries.commands.get("wiki-lint"));

    // Verify Skills registered in registry
    assert.ok(kernel.registries.skills.get("wiki-searcher"));
    assert.ok(kernel.registries.skills.get("wiki-maintainer"));

    // Verify Instruction Injectors registered
    assert.ok(kernel.registries.instructionInjectors.get(WIKI_INJECTOR_NAME));
  });

  it("search_tool_executes_with_safe_response", async () => {
    const kernel = createExtensionKernel();
    await kernel.load([createWikiExtension()]);

    const tool = kernel.registries.tools.get(WIKI_SEARCH_TOOL_NAME);
    assert.ok(tool);

    const result = await tool.execute({ query: "How does authentication work?" }, { sessionId: "s1", runId: "r1", toolCallId: "call_1" });

    assert.equal(result.toolCallId, "call_1");
    assert.equal(result.name, WIKI_SEARCH_TOOL_NAME);
    assert.ok(result.content && result.content.length > 0);
  });
});
