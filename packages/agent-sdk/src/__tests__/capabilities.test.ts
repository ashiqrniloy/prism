import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type CommandDefinition,
  type CompactionOptions,
  type CompactionResult,
  type CompactionStrategy,
  createMockProvider,
  providerDone,
  providerTextDelta,
  type ToolRegistry,
} from "@arnilo/prism";
import { createWikiIngestCommand, createWikiInitCommand, createWikiLintCommand, createWikiRefreshCommand } from "@arnilo/prism-memory/wiki";
import { createObscuraWebTools } from "@arnilo/prism-web-tools/obscura";
import { defineAgent, resolveToolPlane } from "../index.js";

describe("capabilities composition", () => {
  const defaultModel = { provider: "mock", model: "mock-model" };

  it("bare definition has zero commands, zero web tools, zero network activity", async () => {
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    const app = await defineAgent({
      model: defaultModel,
      provider,
    });

    assert.strictEqual(app.commands.length, 0);
    const tools = (app.agent.config.tools as ToolRegistry).list();
    assert.strictEqual(tools.length, 0);
    assert.strictEqual(app.connectedMcpServerIds.length, 0);

    await app.dispose();
  });

  it("registers host-supplied CommandDefinitions for host-only dispatch (not model-visible tools)", async () => {
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    let executed = false;

    const myCommand: CommandDefinition = {
      name: "clear-cache",
      description: "Clears host temporary cache",
      execute: async () => {
        executed = true;
        return {
          name: "clear-cache",
          metadata: { message: "cache cleared" },
        };
      },
    };

    const app = await defineAgent({
      model: defaultModel,
      provider,
      commands: [myCommand],
    });

    // Registered on app.commands
    assert.strictEqual(app.commands.length, 1);
    assert.strictEqual(app.commands[0].name, "clear-cache");

    // NOT exposed as a model-visible tool
    const tools = (app.agent.config.tools as ToolRegistry).list();
    assert.strictEqual(tools.length, 0);

    // Host can dispatch directly
    const result = await app.commands[0].execute({}, {});
    assert.strictEqual(executed, true);
    assert.strictEqual(result.name, "clear-cache");
    assert.deepStrictEqual(result.metadata, { message: "cache cleared" });

    await app.dispose();
  });

  it("rejects duplicate command names fail-closed by default", async () => {
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);

    const cmd1: CommandDefinition = {
      name: "test-cmd",
      execute: () => ({ name: "test-cmd" }),
    };
    const cmd2: CommandDefinition = {
      name: "test-cmd",
      execute: () => ({ name: "test-cmd" }),
    };

    await assert.rejects(
      async () => {
        await defineAgent({
          model: defaultModel,
          provider,
          commands: [cmd1, cmd2],
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("Duplicate command: test-cmd"));
        return true;
      },
    );
  });

  it("demonstrates opt-in web tools plane with unique web_search and web_fetch tools", async () => {
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    // Obscura web tools factory (inert until tools execute)
    const obscura = createObscuraWebTools({
      command: "/usr/bin/obscura",
      nativeTools: false,
    });

    const webPlane = resolveToolPlane({
      planes: {
        web: obscura.tools,
      },
    });

    assert.strictEqual(webPlane.length, 2);
    assert.deepStrictEqual(
      webPlane.map((t) => t.name),
      ["web_search", "web_fetch"],
    );

    const app = await defineAgent({
      model: defaultModel,
      provider,
      tools: {
        planes: {
          web: obscura.tools,
        },
      },
    });

    const tools = (app.agent.config.tools as ToolRegistry).list();
    assert.strictEqual(tools.length, 2);
    assert.ok(tools.find((t) => t.name === "web_search"));
    assert.ok(tools.find((t) => t.name === "web_fetch"));

    await app.dispose();
  });

  it("demonstrates registering the four wiki commands from @arnilo/prism-memory/wiki", async () => {
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    const wikiOptions = { workspaceRoot: "/workspace/wiki", autoDeploySkills: false };

    const wikiCommands: CommandDefinition[] = [
      createWikiInitCommand(wikiOptions),
      createWikiRefreshCommand(wikiOptions),
      createWikiLintCommand(wikiOptions),
      createWikiIngestCommand(wikiOptions),
    ];

    const app = await defineAgent({
      model: defaultModel,
      provider,
      commands: wikiCommands,
    });

    assert.strictEqual(app.commands.length, 4);
    assert.deepStrictEqual(
      app.commands.map((c) => c.name),
      ["wiki-init", "wiki-refresh", "wiki-lint", "wiki-ingest"],
    );

    // Commands are host-only, not model-visible tools
    const tools = (app.agent.config.tools as ToolRegistry).list();
    assert.strictEqual(tools.length, 0);

    await app.dispose();
  });

  it("passes compaction configuration through to the underlying agent", async () => {
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);

    let compactionRan = false;
    const mockStrategy: CompactionStrategy = {
      name: "custom-test-compaction",
      async compact(): Promise<CompactionResult> {
        compactionRan = true;
        return {
          summary: "test compacted summary",
        };
      },
    };

    const compactionConfig: CompactionOptions = {
      strategy: mockStrategy,
    };

    const app = await defineAgent({
      model: defaultModel,
      provider,
      compaction: compactionConfig,
    });

    assert.strictEqual(app.agent.config.compaction, compactionConfig);
    const session = app.createSession();
    const result = await session.compact(app.agent.config.compaction as CompactionOptions);
    assert.strictEqual(compactionRan, true);
    assert.strictEqual(result.summary, "test compacted summary");

    await app.dispose();
  });
});
