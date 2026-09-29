import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentLoopStrategy,
  createMockProvider,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  type SkillRegistry,
  singleShotLoop,
  type ToolDefinition,
  type ToolRegistry,
} from "@arnilo/prism";
import type { McpToolBridge } from "@arnilo/prism-mcp";
import { AgentSdkConfigError, defineAgent } from "../index.js";

function stubTool(name: string, description = `stub:${name}`): ToolDefinition {
  return {
    name,
    description,
    execute: () => ({ toolCallId: "1", name, value: "done" }),
  };
}

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-sdk-agent-${prefix}-`));
}

async function writeFileDeep(filePath: string, text: string): Promise<void> {
  const dir = join(filePath, "..");
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, text, "utf8");
}

describe("defineAgent", () => {
  const defaultModel = { provider: "mock", model: "mock-model" };

  it("bare defineAgent (no planes) runs mock provider end-to-end with zero tools", async () => {
    const provider = createMockProvider([providerTextDelta("Hello bare agent!"), providerDone()]);

    const app = await defineAgent({
      model: defaultModel,
      provider,
    });

    assert.ok(app.agent);
    const tools = (app.agent.config.tools as ToolRegistry).list();
    assert.strictEqual(tools.length, 0);

    const session = app.createSession();
    assert.ok(session);

    const result = await session.run("Hi there");
    assert.strictEqual(result.status, "succeeded");
    assert.strictEqual(result.text, "Hello bare agent!");

    await app.dispose();
  });

  it("exclude / replace / add observable via agent tool registry introspection", async () => {
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    const toolA = stubTool("tool_a");
    const toolB = stubTool("tool_b");
    const replacementB = stubTool("tool_b", "custom replacement");
    const toolC = stubTool("tool_c");

    const app = await defineAgent({
      model: defaultModel,
      provider,
      tools: {
        planes: { base: [toolA, toolB] },
        replace: { tool_b: replacementB },
        add: [toolC],
      },
    });

    const registered = (app.agent.config.tools as ToolRegistry).list();
    assert.deepStrictEqual(
      registered.map((t: ToolDefinition) => t.name),
      ["tool_a", "tool_b", "tool_c"],
    );
    assert.strictEqual(registered[1].description, "custom replacement");

    await app.dispose();
  });

  it("skills plane: temp .agents/skills/<name> discovered and excluded name is absent", async () => {
    const tempDir = await makeTempDir("skills-plane");
    try {
      await writeFileDeep(
        join(tempDir, ".agents/skills/skill-one/SKILL.md"),
        "---\nname: skill-one\ndescription: first skill\n---\nFirst\n",
      );
      await writeFileDeep(
        join(tempDir, ".agents/skills/skill-two/SKILL.md"),
        "---\nname: skill-two\ndescription: second skill\n---\nSecond\n",
      );

      const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
      const app = await defineAgent({
        model: defaultModel,
        provider,
        skills: {
          workspaceRoot: tempDir,
          exclude: ["skill-two"],
        },
      });

      const skillRegistry = app.agent.config.skills as SkillRegistry;
      assert.ok(skillRegistry);
      assert.ok(skillRegistry.get("skill-one"));
      assert.strictEqual(skillRegistry.get("skill-two"), undefined);

      await app.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("skills plane: discovered skills render in prompt catalog on first run without activeSkills (regression)", async () => {
    const tempDir = await makeTempDir("skills-render");
    try {
      await writeFileDeep(
        join(tempDir, ".agents/skills/active-skill/SKILL.md"),
        "---\nname: active-skill\ndescription: renders in catalog\n---\nActive body\n",
      );

      const capturedRequests: ProviderRequest[] = [];
      const capturingProvider = {
        id: "mock",
        async *generate(request: ProviderRequest) {
          capturedRequests.push(request);
          yield providerTextDelta("done");
          yield providerDone();
        },
      };

      const app = await defineAgent({
        model: defaultModel,
        provider: capturingProvider,
        skills: {
          workspaceRoot: tempDir,
        },
      });

      const session = app.createSession();
      await session.run("Test message");

      assert.strictEqual(capturedRequests.length, 1);
      const text = (capturedRequests[0]?.messages ?? [])
        .flatMap((m) => m.content)
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("\n");
      assert.match(text, /Skill active-skill: renders in catalog/);

      await app.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("instructions plane: AGENTS.md layer present in assembled system prompt, disabled is absent", async () => {
    const tempDir = await makeTempDir("instructions-plane");
    try {
      await writeFileDeep(join(tempDir, "AGENTS.md"), "# Project Agent Rules\nAlways run tests.\n");

      const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);

      // Enabled case (default on when workspaceRoot is provided)
      const appEnabled = await defineAgent({
        model: defaultModel,
        provider,
        workspaceRoot: tempDir,
      });

      const sp = appEnabled.agent.config.systemPrompt;
      assert.ok(Array.isArray(sp));
      assert.strictEqual(sp.length, 1);
      assert.strictEqual(sp[0].id, "agents-md");
      assert.ok(sp[0].text.includes("Always run tests."));

      await appEnabled.dispose();

      // Disabled case (agentsMd: false)
      const appDisabled = await defineAgent({
        model: defaultModel,
        provider,
        workspaceRoot: tempDir,
        instructions: {
          agentsMd: false,
        },
      });

      assert.strictEqual(appDisabled.agent.config.systemPrompt, undefined);
      await appDisabled.dispose();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("MCP: denied allow fails at defineAgent with no session created", async () => {
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);

    await assert.rejects(
      async () => {
        await defineAgent({
          model: defaultModel,
          provider,
          mcp: {
            servers: [
              {
                serverId: "test-server",
                command: "some-command",
                allow: "https://wrong-allow.example.com",
              },
            ],
          },
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof AgentSdkConfigError);
        assert.ok(err.message.includes('requires allow: "stdio"'));
        return true;
      },
    );
  });

  it("MCP: bridged tools appended after local plane", async () => {
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    const mockBridgeTool = stubTool("mcp_search", "mcp bridged search");

    const mockBridge: McpToolBridge = {
      tools: [mockBridgeTool],
      close: async () => {},
      refresh: async () => {},
    };

    const app = await defineAgent({
      model: defaultModel,
      provider,
      tools: {
        add: [stubTool("local_tool")],
      },
      mcp: {
        servers: [
          {
            serverId: "remote",
            command: "stub",
            allow: "stdio",
          },
        ],
        connector: async () => mockBridge,
      },
    });

    const tools = (app.agent.config.tools as ToolRegistry).list();
    assert.deepStrictEqual(
      tools.map((t: ToolDefinition) => t.name),
      ["local_tool", "mcp_search"],
    );
    assert.deepStrictEqual(app.connectedMcpServerIds, ["remote"]);

    await app.dispose();
  });

  it("dispose() closes all bridges; second dispose() is a no-op; createSession after dispose fails closed", async () => {
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    let closeCallCount = 0;

    const mockBridge: McpToolBridge = {
      tools: [stubTool("remote_tool")],
      close: async () => {
        closeCallCount++;
      },
      refresh: async () => {},
    };

    const app = await defineAgent({
      model: defaultModel,
      provider,
      mcp: {
        servers: [
          {
            serverId: "remote",
            command: "test",
            allow: "stdio",
          },
        ],
        connector: async () => mockBridge,
      },
    });

    // Session before disposal works
    const session = app.createSession();
    assert.ok(session);

    // Dispose once
    await app.dispose();
    assert.strictEqual(closeCallCount, 1);

    // Second dispose is no-op
    await app.dispose();
    assert.strictEqual(closeCallCount, 1);

    // createSession after dispose fails closed
    assert.throws(
      () => app.createSession(),
      (err: unknown) => {
        assert.ok(err instanceof AgentSdkConfigError);
        assert.ok(err.message.includes("disposed"));
        return true;
      },
    );
  });

  it("per-run loop override in createSession().run(input, { loop }) reaches resolveLoop", async () => {
    let customLoopInvoked = false;

    const customLoop: AgentLoopStrategy = {
      name: "custom-test-loop",
      async run(ctx) {
        customLoopInvoked = true;
        await ctx.generate(await ctx.assemble([]));
      },
    };

    const provider = createMockProvider([providerTextDelta("hello"), providerDone()]);

    const app = await defineAgent({
      model: defaultModel,
      provider,
      loop: singleShotLoop,
    });

    const session = app.createSession();
    await session.run("test", { loop: customLoop });

    assert.strictEqual(customLoopInvoked, true);
    await app.dispose();
  });
});
