import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { createAgent } from "@arnilo/prism";
import {
  createWikiSearchTool,
  memoryWiki,
  WIKI_INGEST_COMMAND_NAME,
  WIKI_INGEST_TOOL_NAME,
  WIKI_INJECTOR_NAME,
  WIKI_READ_PAGE_TOOL_NAME,
  WIKI_RECORD_INSIGHT_TOOL_NAME,
  WIKI_SEARCH_TOOL_NAME,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// ponytail: the package manifest sits one level above `src/`
const pkgPath = join(__dirname, "../../package.json");

describe("prism-wiki primitive seams & package scaffold", () => {
  it("package_metadata_conforms_to_independent_release_spec", () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    assert.equal(pkg.name, "@arnilo/prism-memory-wiki");
    assert.deepEqual(Object.keys(pkg.exports), ["."], "the wiki package exposes one entry point");
    assert.equal(pkg.bin["prism-wiki"], "./src/cli.ts");
    // the kernel peer is the 0.x API window, not the package's own version.
    assert.equal(pkg.peerDependencies["@arnilo/prism"], ">=0.13.0 <1.0.0");
    assert.equal(pkg.publishConfig?.access, "public");
  });

  it("wiki_package_registers_tools_commands_skills_and_injectors", async () => {
    const instance = memoryWiki({
      wikiRoot: ".wiki-test",
      profile: "codebase",
      autoDeploySkills: false,
    });
    assert.equal(instance.definition.name, "@arnilo/prism-memory-wiki");
    const agent = await createAgent({ model: { provider: "mock", model: "wiki" }, packages: [instance] });
    try {
      const inspected = agent.inspect();
      const tools = new Set(inspected.tools.map((tool) => tool.name));
      assert.ok(tools.has(WIKI_SEARCH_TOOL_NAME));
      assert.ok(tools.has(WIKI_READ_PAGE_TOOL_NAME));
      assert.ok(tools.has(WIKI_RECORD_INSIGHT_TOOL_NAME));
      assert.ok(tools.has(WIKI_INGEST_TOOL_NAME));
      const commands = new Set(inspected.commands.map((command) => command.name));
      assert.ok(commands.has("wiki-init"));
      assert.ok(commands.has("wiki-refresh"));
      assert.ok(commands.has("wiki-lint"));
      assert.ok(commands.has(WIKI_INGEST_COMMAND_NAME));
      const skills = new Set(inspected.skills.map((skill) => skill.name));
      assert.ok(skills.has("wiki-searcher"));
      assert.ok(skills.has("wiki-maintainer"));
      assert.ok(inspected.hooks["context.build"]?.some((hook) => hook.id.endsWith(`#${WIKI_INJECTOR_NAME}`)));
    } finally {
      await agent.dispose();
    }
  });

  it("search_tool_executes_with_safe_response", async () => {
    const tool = createWikiSearchTool({ autoDeploySkills: false });
    assert.ok(tool);

    const result = await tool.execute({ query: "How does authentication work?" }, { sessionId: "s1", runId: "r1", toolCallId: "call_1" });

    assert.equal(result.toolCallId, "call_1");
    assert.equal(result.name, WIKI_SEARCH_TOOL_NAME);
    assert.ok(result.content && result.content.length > 0);
  });
});
