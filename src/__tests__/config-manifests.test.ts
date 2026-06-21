import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createContributionRegistries,
  definePrismManifest,
  loadConfigLayers,
  mergeConfigLayers,
  parsePrismManifest,
  type ConfigProvider,
  type ManifestContributionKind,
} from "../index.js";

const base = {
  model: { provider: "mock", parameters: { temperature: 0 } },
  tools: ["echo"],
  enabled: true,
};

describe("configuration and manifests", () => {
  it("config layers merge in documented order", () => {
    const config = mergeConfigLayers([
      { name: "built-in", config: base },
      { name: "manifest", config: { model: { parameters: { topP: 1 } } } },
      { name: "runtime", config: { model: { provider: "other" }, tools: ["search"], enabled: false } },
    ]);

    assert.deepEqual(config, {
      model: { provider: "other", parameters: { temperature: 0, topP: 1 } },
      tools: ["search"],
      enabled: false,
    });
  });

  it("config layers do not mutate inputs", () => {
    const config = mergeConfigLayers([
      { name: "base", config: base },
      { name: "override", config: { model: { parameters: { temperature: 1 } } } },
    ]);

    (config.model as { parameters: { temperature: number } }).parameters.temperature = 2;

    assert.deepEqual(base, {
      model: { provider: "mock", parameters: { temperature: 0 } },
      tools: ["echo"],
      enabled: true,
    });
  });

  it("loads config layers from providers in order", async () => {
    const providers: ConfigProvider[] = [
      { name: "empty", load: () => undefined },
      { name: "host", load: () => ({ demo: { enabled: true } }) },
    ];

    assert.deepEqual(await loadConfigLayers(providers), [
      { name: "host", config: { demo: { enabled: true } } },
    ]);
  });

  it("manifest validation accepts data only contributions and defaults", () => {
    const manifest = definePrismManifest({
      name: "demo-package",
      configDefaults: { demo: { enabled: true } },
      contributions: [{ kind: "tool", name: "demo.echo", module: "./tool.js", exportName: "tool" }, { kind: "retryPolicy", name: "demo.retry", module: "./retry.js" }],
      resources: [{ uri: "package://demo/prompt.md", purpose: "prompt", mediaType: "text/markdown" }],
    });

    assert.equal(manifest.name, "demo-package");
    assert.deepEqual(manifest.configDefaults, { demo: { enabled: true } });
    assert.equal(manifest.contributions?.[0]?.kind, "tool");
    assert.equal(manifest.contributions?.[1]?.kind, "retryPolicy");
    assert.equal(manifest.resources?.[0]?.purpose, "prompt");
  });

  it("manifest validation rejects invalid name or non json defaults", () => {
    assert.throws(() => parsePrismManifest({ name: "", configDefaults: {} }), /manifest.name/);
    assert.throws(
      () => parsePrismManifest({ name: "demo", configDefaults: { run: () => undefined } }),
      /manifest.configDefaults must be a JSON object/,
    );
    assert.throws(
      () => parsePrismManifest({ name: "demo", contributions: [{ kind: "missing", name: "x" }] }),
      /known contribution kind/,
    );
  });

  it("manifest_accepts_current_provider_package_auth_policy_and_prompt_kinds", () => {
    const manifest = definePrismManifest({
      name: "demo-provider-package",
      contributions: [
        { kind: "providerPackage", name: "demo" },
        { kind: "authMethod", name: "demo.api-key" },
        { kind: "providerRequestPolicy", name: "demo.cache" },
        { kind: "systemPromptContribution", name: "demo.prompt" },
      ],
    });

    assert.deepEqual(
      manifest.contributions?.map((c) => c.kind),
      ["providerPackage", "authMethod", "providerRequestPolicy", "systemPromptContribution"],
    );
  });

  it("manifest_kind_list_matches_current_data_only_registry_categories", () => {
    const registries = createContributionRegistries();
    const registryToKind: Record<keyof typeof registries, ManifestContributionKind> = {
      providers: "provider",
      models: "model",
      tools: "tool",
      contextProviders: "contextProvider",
      skills: "skill",
      commands: "command",
      agents: "agent",
      inputBuilders: "inputBuilder",
      promptBuilders: "promptBuilder",
      compactionStrategies: "compactionStrategy",
      retryPolicies: "retryPolicy",
      storeFactories: "storeFactory",
      resourceLoaders: "resourceLoader",
      settingsProviders: "settingsProvider",
      credentialResolvers: "credentialResolver",
      providerPackages: "providerPackage",
      authMethods: "authMethod",
      providerRequestPolicies: "providerRequestPolicy",
      systemPromptContributions: "systemPromptContribution",
    };

    const expectedKinds = new Set(Object.values(registryToKind));
    const actualKinds = new Set<ManifestContributionKind>(Object.values(registryToKind));

    assert.deepEqual(new Set(Object.keys(registries)), new Set(Object.keys(registryToKind)));
    assert.deepEqual(actualKinds, expectedKinds);
  });

  it("manifest_auth_method_examples_do_not_allow_secret_values", () => {
    const manifest = parsePrismManifest({
      name: "demo",
      contributions: [
        {
          kind: "authMethod",
          name: "demo.api-key",
          metadata: { credentialName: "apiKey" },
        },
      ],
    });

    const authMethod = manifest.contributions?.[0];
    assert.equal(authMethod?.kind, "authMethod");
    assert.equal((authMethod?.metadata as Record<string, unknown> | undefined)?.credentialName, "apiKey");
    assert.equal((authMethod?.metadata as Record<string, unknown> | undefined)?.value, undefined);
    assert.equal((authMethod?.metadata as Record<string, unknown> | undefined)?.token, undefined);
  });
});
