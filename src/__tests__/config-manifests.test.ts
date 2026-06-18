import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  definePrismManifest,
  loadConfigLayers,
  mergeConfigLayers,
  parsePrismManifest,
  type ConfigProvider,
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
});
