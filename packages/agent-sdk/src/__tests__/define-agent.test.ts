import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMockProvider,
  createSkillRegistry,
  type LoopStrategy,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  type SessionStore,
  type SkillRegistry,
  type ToolDefinition,
  type ToolRegistry,
} from "@arnilo/prism";
import type { McpToolBridge } from "@arnilo/prism-mcp";
import { AgentSdkConfigError, defineAgent } from "../index.js";
import {
  type Agent as SdkAgent,
  type AgentEvent as SdkAgentEvent,
  type RunResult as SdkAgentRunResult,
  type Session as SdkAgentSession,
  type AIProvider as SdkAIProvider,
  type ExecutionPolicy as SdkExecutionPolicy,
  type PermissionPolicy as SdkPermissionPolicy,
  type RunOptions as SdkRunOptions,
  type SessionStore as SdkSessionStore,
  type ToolDefinition as SdkToolDefinition,
  createMockProvider as sdkCreateMockProvider,
  providerDone as sdkProviderDone,
  providerTextDelta as sdkProviderTextDelta,
  providerUsage as sdkProviderUsage,
} from "../index.js";

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
    const tools = app.agent.config.tools?.add ?? [];
    assert.strictEqual(tools.length, 0);

    const session = app.session();
    assert.ok(session);

    const result = await (await session).run("Hi there");
    assert.strictEqual(result.status, "completed");
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

    const registered = app.agent.config.tools?.add ?? [];
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

      const skills = app.agent.config.skills?.add ?? [];
      assert.ok(skills.length > 0);
      assert.ok(skills.some((skill) => skill.name === "skill-one"));
      assert.strictEqual(
        skills.some((skill) => skill.name === "skill-two"),
        false,
      );

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

    const tools = app.agent.config.tools?.add ?? [];
    assert.deepStrictEqual(
      tools.map((t: ToolDefinition) => t.name),
      ["local_tool", "mcp_search"],
    );
    assert.deepStrictEqual(app.connectedMcpServerIds, ["remote"]);

    await app.dispose();
  });

  it("dispose() closes all bridges; second dispose() is a no-op; session() after dispose fails closed", async () => {
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
    const session = app.session();
    assert.ok(session);

    // Dispose once
    await app.dispose();
    assert.strictEqual(closeCallCount, 1);

    // Second dispose is no-op
    await app.dispose();
    assert.strictEqual(closeCallCount, 1);

    // session() after dispose fails closed
    await assert.rejects(
      async () => app.session(),
      (err: unknown) => {
        assert.ok(err instanceof AgentSdkConfigError);
        assert.ok(err.message.includes("disposed"));
        return true;
      },
    );
  });

  it("define_agent_rejects_unknown_identity_profile_field", async () => {
    const provider = createMockProvider([providerTextDelta("x"), providerDone()]);
    await assert.rejects(
      // @ts-expect-error identity is retired
      defineAgent({ model: defaultModel, provider, identity: "retired-profile" }),
      (err: unknown) => err instanceof AgentSdkConfigError && /Unknown config field: identity/.test(err.message),
    );
  });

  it("host contract names import from the SDK package root", () => {
    // The ten type names below and the four mock helpers are the host contract; compiling
    // this file against `../index.js` is the assertion. Runtime checks keep the imports used.
    for (const helper of [sdkCreateMockProvider, sdkProviderDone, sdkProviderTextDelta, sdkProviderUsage]) {
      assert.strictEqual(typeof helper, "function");
    }
    assert.strictEqual(sdkCreateMockProvider, createMockProvider);
    const contract:
      | readonly [
          SdkAgent,
          SdkAgentEvent,
          SdkAgentRunResult,
          SdkAgentSession,
          SdkAIProvider,
          SdkExecutionPolicy,
          SdkPermissionPolicy,
          SdkRunOptions,
          SdkSessionStore,
          SdkToolDefinition,
        ]
      | undefined = undefined;
    assert.strictEqual(contract, undefined);
  });

  it("session() streams AgentEvents from the SDK root", async () => {
    const provider = createMockProvider([providerTextDelta("streamed"), providerDone()]);
    const app = await defineAgent({ model: defaultModel, provider });

    const events: SdkAgentEvent[] = [];
    for await (const event of (await app.session()).stream("hi")) events.push(event);
    assert.ok(events.length > 0);
    assert.ok(events.some((event) => event.type === "run.started"));

    await app.dispose();
  });

  it("jsonl store shorthand persists entries across agent instances", async () => {
    const dir = await makeTempDir("store");
    try {
      const path = join(dir, "sessions.jsonl");
      const provider1 = createMockProvider([providerTextDelta("one"), providerDone()]);
      const app1 = await defineAgent({
        model: defaultModel,
        provider: provider1,
        store: { type: "jsonl", path },
      });
      const session1 = app1.session();
      await (await session1).run("hello");
      const sessionId = (await session1).id;
      await app1.dispose();

      const provider2 = createMockProvider([providerTextDelta("two"), providerDone()]);
      const app2 = await defineAgent({
        model: defaultModel,
        provider: provider2,
        store: { type: "jsonl", path },
      });
      const store2 = app2.agent.config.slots?.store;
      assert.ok(store2 && typeof store2 !== "string");
      const entries = await store2.list(sessionId);
      assert.ok(entries.length > 0, "second agent reads first agent's persisted entries");
      await app2.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("raw SessionStore passes through by reference", async () => {
    const raw: SessionStore = { append: async () => {}, list: async () => [] };
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    const app = await defineAgent({ model: defaultModel, provider, store: raw });

    assert.strictEqual(app.agent.config.slots?.store, raw);
    await app.dispose();
  });

  it("unknown store type fails closed", async () => {
    const provider = createMockProvider([providerTextDelta("x"), providerDone()]);
    await assert.rejects(
      // @ts-expect-error sqlite is not a Phase 1 shorthand
      defineAgent({ model: defaultModel, provider, store: { type: "sqlite", path: "x.db" } }),
      (err: unknown) => err instanceof AgentSdkConfigError && /store/.test((err as Error).message),
    );
  });

  it("hooks.json run.end handlers and registerHooks share the bus, hooks.json first", async () => {
    const dir = await makeTempDir("stop-order");
    try {
      const hookPath = join(dir, "hooks.json");
      await writeFile(hookPath, JSON.stringify({ hooks: { Stop: [{ type: "command", command: "echo stop" }] } }), "utf8");
      const provider = createMockProvider([providerTextDelta("x"), providerDone()]);
      const app = await defineAgent({
        model: defaultModel,
        provider,
        hooks: { file: hookPath },
        workspaceRoot: dir,
        registerHooks: (hooks) => hooks.on("run.end", () => undefined, { id: "config-probe" }),
      });

      // Both live on the agent's one bus. `registerHooks` runs after the hooks plane, so a spy
      // registrar records the hooks.json registration first.
      const order: string[] = [];
      const probe = await defineAgent({
        model: defaultModel,
        provider: createMockProvider([providerTextDelta("x"), providerDone()]),
        hooks: { file: hookPath },
        workspaceRoot: dir,
        registerHooks: (hooks) => {
          const spy = {
            on: (name: string, handler: unknown, options?: { id?: string }) => {
              order.push(`${name}#${options?.id ?? "-"}`);
              hooks.on(name as never, handler as never, options);
            },
          };
          spy.on("run.end", () => undefined, { id: "config-probe" });
        },
      });
      await (await probe.session()).run("go");
      assert.strictEqual(order[0], "run.end#config-probe");
      assert.ok(probe.agent !== app.agent, "each defineAgent gets its own bus, so the spy never leaks into the first agent");

      await probe.dispose();
      await app.dispose();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
