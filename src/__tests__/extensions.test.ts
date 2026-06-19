import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createExtensionEventBus, createExtensionKernel, defineProviderPackage } from "../index.js";
import type { AIProvider, Extension, ExtensionEvent, ToolDefinition } from "../index.js";

const provider: AIProvider = {
  id: "mock",
  async *generate() {
    yield { type: "done" };
  },
};

const tool: ToolDefinition = {
  name: "echo",
  execute(_args, ctx) {
    return { toolCallId: ctx.toolCallId, name: "echo", value: "ok" };
  },
};

function allContributionsExtension(): Extension {
  return {
    name: "all",
    setup(api) {
      api.registerProvider(provider);
      api.registerModel({ provider: "mock", model: "demo" });
      api.registerTool(tool);
      api.registerContextProvider({ name: "context", resolve: () => [{ content: "context" }] });
      api.registerSkill({ name: "brief" });
      api.registerCommand({ name: "say", execute: () => ({ name: "say", value: "ok" }) });
      api.registerAgent({ name: "agent", create: () => ({ config: { model: { provider: "mock", model: "demo" }, provider }, createSession: () => { throw new Error("not implemented"); } }) });
      api.registerInputBuilder({ name: "input", build: () => [] });
      api.registerPromptBuilder({ name: "prompt", build: (request) => request.messages });
      api.registerCompactionStrategy({ name: "compact", compact: () => ({ summary: "summary" }) });
      api.registerRetryPolicy({ name: "retry", decide: () => ({ retry: false }) });
      api.registerStoreFactory({ name: "memory", create: () => ({ append: async () => undefined, list: async () => [] }) });
      api.registerResourceLoader("memory", { load: async (uri) => ({ uri, text: "resource" }) });
      api.registerSettingsProvider("settings", { get: () => undefined });
      api.registerCredentialResolver("credentials", { resolve: () => undefined });
      api.registerProviderPackage(defineProviderPackage({ name: "demo-provider", setup: () => undefined }));
      api.registerAuthMethod({ provider: "mock", kind: "api_key", credentialName: "apiKey" });
      api.registerProviderRequestPolicy({ name: "cache", apply: ({ request }) => request });
      api.registerSystemPromptContribution({ id: "demo-prompt", source: "package", mode: "append", text: "Be brief." });
    },
  };
}

describe("extension event bus", () => {
  it("emits handlers in registration order", async () => {
    const bus = createExtensionEventBus();
    const seen: number[] = [];

    bus.on("turn", () => { seen.push(1); });
    bus.on("turn", () => { seen.push(2); });

    await bus.emit({ type: "turn" });

    assert.deepEqual(seen, [1, 2]);
  });

  it("isolates handler errors by default", async () => {
    const bus = createExtensionEventBus({ secrets: ["token-123"] });
    const events: ExtensionEvent[] = [];

    bus.on("extension_error", (event) => { events.push(event); });
    bus.on("turn", () => { throw new Error("bad token-123"); });
    bus.on("turn", () => { events.push({ type: "turn" }); });

    await bus.emit({ type: "turn", extension: "demo" });

    assert.equal(events[0]?.type, "extension_error");
    assert.equal(events[0]?.extension, "demo");
    assert.equal(events[0]?.error?.message, "bad [REDACTED]");
    assert.equal(events[1]?.type, "turn");
  });
});

describe("extension kernel", () => {
  it("loads extensions in order", async () => {
    const order: string[] = [];
    const kernel = createExtensionKernel();

    await kernel.load([
      { name: "one", setup: () => { order.push("one"); } },
      { name: "two", setup: () => { order.push("two"); } },
    ]);

    assert.deepEqual(order, ["one", "two"]);
  });

  it("registers all contribution categories through ExtensionAPI", async () => {
    const kernel = createExtensionKernel();

    await kernel.load([allContributionsExtension()]);

    assert.equal(kernel.registries.providers.resolve("mock"), provider);
    assert.equal(kernel.registries.models.resolve("mock", "demo").model, "demo");
    assert.equal(kernel.registries.tools.resolve("echo"), tool);
    assert.equal(kernel.registries.contextProviders.resolve("context").name, "context");
    assert.equal(kernel.registries.skills.resolve("brief").name, "brief");
    assert.equal(kernel.registries.commands.resolve("say").name, "say");
    assert.equal(kernel.registries.agents.resolve("agent").name, "agent");
    assert.equal(kernel.registries.inputBuilders.resolve("input").name, "input");
    assert.equal(kernel.registries.promptBuilders.resolve("prompt").name, "prompt");
    assert.equal(kernel.registries.compactionStrategies.resolve("compact").name, "compact");
    assert.equal(kernel.registries.retryPolicies.resolve("retry").name, "retry");
    assert.equal(kernel.registries.storeFactories.resolve("memory").name, "memory");
    assert.equal(await kernel.registries.resourceLoaders.resolve("memory").load("memory:x").then((item) => item.text), "resource");
    assert.equal(kernel.registries.settingsProviders.resolve("settings").get("x"), undefined);
    assert.equal(kernel.registries.credentialResolvers.resolve("credentials").resolve({ name: "apiKey" }), undefined);
    assert.equal(kernel.registries.providerPackages.resolve("demo-provider").name, "demo-provider");
    assert.equal(kernel.registries.authMethods.resolve("mock\0api_key").provider, "mock");
    assert.equal(kernel.registries.providerRequestPolicies.resolve("cache").name, "cache");
    assert.equal(kernel.registries.systemPromptContributions.resolve("demo-prompt").text, "Be brief.");
  });

  it("lets extensions register middleware", async () => {
    const kernel = createExtensionKernel();

    await kernel.load([{ name: "mw", setup: (api) => { api.use<{ value: number }>("provider_request", (value) => ({ value: value.value + 1 })); } }]);

    assert.deepEqual(await kernel.middleware.run("provider_request", { value: 1 }), { value: 2 });
  });

  it("turns setup errors into redacted extension_error events by default", async () => {
    const kernel = createExtensionKernel({ secrets: ["token-123"] });
    const errors: ExtensionEvent[] = [];

    kernel.events.on("extension_error", (event) => { errors.push(event); });
    await kernel.load([{ name: "bad", setup: () => { throw new Error("bad token-123"); } }]);

    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.extension, "bad");
    assert.equal(errors[0]?.error?.message, "bad [REDACTED]");
  });

  it("throws setup errors when host opts in", async () => {
    const kernel = createExtensionKernel({ errorPolicy: "throw" });

    await assert.rejects(() => kernel.load([{ name: "bad", setup: () => { throw new Error("boom"); } }]), /boom/);
  });
});
