import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createExtensionKernel } from "@arnilo/prism";
import {
  createWikiExtension,
  WIKI_INJECTOR_NAME,
  WIKI_READ_PAGE_TOOL_NAME,
  WIKI_RECORD_INSIGHT_TOOL_NAME,
  WIKI_SEARCH_TOOL_NAME,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// ponytail: family layout — walks up to the memory package manifest
const pkgPath = join(__dirname, "../../../package.json");

describe("prism-wiki primitive seams & package scaffold", () => {
  it("package_metadata_conforms_to_independent_release_spec", () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    assert.ok(pkg.exports["./wiki"], "memory family manifest must expose ./wiki");
    // peer follows the package's Decision B window (^0.3.1 since the plan 039 cut).
    assert.equal(pkg.peerDependencies["@arnilo/prism"], "^0.5.0");
    assert.equal(pkg.publishConfig?.access, "public");
  });

  it("createWikiExtension_registers_tools_commands_skills_and_injectors", async () => {
    const kernel = createExtensionKernel();
    const wikiExt = createWikiExtension({
      wikiRoot: ".wiki-test",
      profile: "codebase",
      autoDeploySkills: false,
    });

    assert.equal(wikiExt.name, "@arnilo/prism-memory/wiki");
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
    await kernel.load([createWikiExtension({ autoDeploySkills: false })]);

    const tool = kernel.registries.tools.get(WIKI_SEARCH_TOOL_NAME);
    assert.ok(tool);

    const result = await tool.execute({ query: "How does authentication work?" }, { sessionId: "s1", runId: "r1", toolCallId: "call_1" });

    assert.equal(result.toolCallId, "call_1");
    assert.equal(result.name, WIKI_SEARCH_TOOL_NAME);
    assert.ok(result.content && result.content.length > 0);
  });
});
