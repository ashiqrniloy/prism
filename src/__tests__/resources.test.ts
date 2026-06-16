import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadJsonResource, loadManifestResource, loadTextResource, type ResourceLoadContext, type ResourceLoader } from "../index.js";

describe("resource helpers", () => {
  it("loads text resources from text or data", async () => {
    const loader: ResourceLoader = {
      async load(uri) {
        return uri.endsWith(".bin")
          ? { uri, data: new TextEncoder().encode("from data") }
          : { uri, text: "from text" };
      },
    };

    assert.equal(await loadTextResource(loader, "package://demo/prompt.md"), "from text");
    assert.equal(await loadTextResource(loader, "package://demo/prompt.bin"), "from data");
  });

  it("loads json resources as objects", async () => {
    const loader: ResourceLoader = {
      async load(uri) {
        return { uri, text: '{"demo":{"enabled":true}}' };
      },
    };

    assert.deepEqual(await loadJsonResource(loader, "package://demo/config.json"), { demo: { enabled: true } });
  });

  it("rejects invalid json or non object json", async () => {
    const loader: ResourceLoader = {
      async load(uri) {
        return { uri, text: uri.endsWith("array.json") ? "[]" : "{" };
      },
    };

    await assert.rejects(() => loadJsonResource(loader, "package://demo/bad.json"), /Invalid JSON resource/);
    await assert.rejects(() => loadJsonResource(loader, "package://demo/array.json"), /must be a JSON object/);
  });

  it("loads manifests through manifest validation", async () => {
    const loader: ResourceLoader = {
      async load(uri) {
        return { uri, text: JSON.stringify({ name: "demo", resources: [{ uri: "package://demo/prompt.md", purpose: "prompt" }] }) };
      },
    };

    assert.deepEqual(await loadManifestResource(loader, "package://demo/prism.manifest.json"), {
      name: "demo",
      contributions: undefined,
      resources: [{ uri: "package://demo/prompt.md", purpose: "prompt" }],
    });
  });

  it("forwards context and calls the loader once", async () => {
    const signal = AbortSignal.abort("stop");
    const context: ResourceLoadContext = { signal, metadata: { run: "demo" } };
    const calls: Array<{ uri: string; context?: ResourceLoadContext }> = [];
    const loader: ResourceLoader = {
      async load(uri, ctx) {
        calls.push({ uri, context: ctx });
        return { uri, text: "hello" };
      },
    };

    assert.equal(await loadTextResource(loader, "package://demo/prompt.md", context), "hello");
    assert.deepEqual(calls, [{ uri: "package://demo/prompt.md", context }]);
  });
});
