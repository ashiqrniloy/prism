import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  AgentConfig,
  AgentEvent,
  AIProvider,
  ContextProvider,
  CredentialResolver,
  Extension,
  ResourceLoader,
  SettingsProvider,
  Skill,
  ToolDefinition,
} from "../index.js";

const provider: AIProvider = {
  id: "mock",
  async *generate() {
    yield { type: "done" };
  },
};

const context: ContextProvider = {
  name: "demo-context",
  resolve() {
    return [{ title: "Demo", content: "Public contract example." }];
  },
};

const tool: ToolDefinition = {
  name: "echo",
  parameters: { type: "object" },
  execute(_args, ctx) {
    return { toolCallId: ctx.toolCallId, name: "echo", value: "ok" };
  },
};

const skill: Skill = {
  name: "brief",
  instructions: "Answer briefly.",
  toolNames: ["echo"],
};

describe("public contracts", () => {
  it("host can configure agent with provider context skill and tool", () => {
    const config: AgentConfig = {
      id: "demo-agent",
      model: { provider: "mock", model: "demo-model" },
      provider,
      context: [context],
      skills: [skill],
      tools: [tool],
      metadata: { example: true },
    };

    assert.equal(config.provider?.id, "mock");
    assert.equal(config.context?.[0]?.name, "demo-context");
    assert.equal(Array.isArray(config.tools), true);
  });

  it("host can type extension resource settings and credentials", async () => {
    const extension: Extension = {
      name: "demo-extension",
      setup(api) {
        api.registerProvider(provider);
        api.registerContextProvider(context);
        api.registerSkill(skill);
        api.registerTool(tool);
      },
    };

    const resources: ResourceLoader = {
      async load(uri) {
        return { uri, mediaType: "text/plain", text: "example" };
      },
    };

    const settings: SettingsProvider = {
      get<T>(key: string) {
        return key === "demo.enabled" ? (true as T) : undefined;
      },
    };

    const credentials: CredentialResolver = {
      resolve() {
        return undefined;
      },
    };

    assert.equal(extension.name, "demo-extension");
    assert.equal((await resources.load("memory:demo")).text, "example");
    assert.equal(await settings.get("demo.enabled"), true);
    assert.equal(await credentials.resolve({ name: "demo" }), undefined);
  });

  it("agent event narrows by type", () => {
    const event: AgentEvent = {
      type: "message_delta",
      sessionId: "s1",
      runId: "r1",
      content: { type: "text", text: "hello" },
    };

    if (event.type === "message_delta" && event.content.type === "text") {
      assert.equal(event.content.text, "hello");
      return;
    }

    assert.fail("event did not narrow");
  });

  it("public contracts do not mention app-specific tool categories", () => {
    const files = [
      "src/index.ts",
      "src/contracts.ts",
      "dist/index.d.ts",
      "dist/contracts.d.ts",
    ];
    const banned = [
      /safe.?tool/i,
      /dangerous/i,
      /synapta/i,
      /shell/i,
      /filesystem/i,
      /browser/i,
    ];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of banned) {
        assert.equal(pattern.test(text), false, `${file} matched ${pattern}`);
      }
    }
  });
});
