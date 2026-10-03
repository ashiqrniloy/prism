import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import { createAgent, type PackageInstance } from "@arnilo/prism";
import { alibabaPackage } from "../alibaba/index.js";
import { anthropicModels, anthropicPackage } from "../anthropic/index.js";
import { azurePackage } from "../azure/index.js";
import { bedrockPackage } from "../bedrock/index.js";
import { clinepassPackage } from "../clinepass/index.js";
import { commandcodePackage } from "../commandcode/index.js";
import { deepseekPackage } from "../deepseek/index.js";
import { googlePackage } from "../google/index.js";
import { hyperPackage } from "../hyper/index.js";
import { kimiPackage } from "../kimi/index.js";
import { layaPackage } from "../laya/index.js";
import { neuralwattPackage } from "../neuralwatt/index.js";
import { ollamaPackage } from "../ollama/index.js";
import { openaiPackage } from "../openai/index.js";
import { opencodeGoPackage } from "../opencode-go/index.js";
import { openrouterPackage } from "../openrouter/index.js";
import { typesafePackage } from "../typesafe/index.js";
import { vertexPackage } from "../vertex/index.js";
import { xaiPackage } from "../xai/index.js";
import { zaiPackage } from "../zai/index.js";

const key = () => "vendor-package-test-key";
const credential = () => "vendor-package-test-key";
const aws = () => ({ accessKeyId: "a", secretAccessKey: "b" });

const vendors: readonly { id: string; factory: () => PackageInstance }[] = [
  { id: "alibaba", factory: () => alibabaPackage({ apiKey: key }) },
  { id: "anthropic", factory: () => anthropicPackage({ apiKey: key }) },
  { id: "azure", factory: () => azurePackage({ endpoint: "https://demo.openai.azure.com", credential }) },
  { id: "bedrock", factory: () => bedrockPackage({ region: "us-east-1", credential: aws }) },
  { id: "clinepass", factory: () => clinepassPackage({ apiKey: key }) },
  { id: "commandcode", factory: () => commandcodePackage({ apiKey: key }) },
  { id: "deepseek", factory: () => deepseekPackage({ apiKey: key }) },
  { id: "google", factory: () => googlePackage({ apiKey: key }) },
  { id: "hyper", factory: () => hyperPackage({ apiKey: key }) },
  { id: "kimi-coding", factory: () => kimiPackage({ kimiApiKey: key }) },
  { id: "laya", factory: () => layaPackage({ apiKey: key }) },
  { id: "neuralwatt", factory: () => neuralwattPackage({ apiKey: key }) },
  { id: "ollama", factory: () => ollamaPackage({ apiKey: key }) },
  { id: "openai", factory: () => openaiPackage({ apiKey: key }) },
  { id: "opencode-go", factory: () => opencodeGoPackage({ apiKey: key }) },
  { id: "openrouter", factory: () => openrouterPackage({ apiKey: key }) },
  { id: "typesafe", factory: () => typesafePackage({ apiKey: key }) },
  { id: "vertex", factory: () => vertexPackage({ projectId: "p", location: "us-central1", credential }) },
  { id: "xai", factory: () => xaiPackage({ apiKey: key }) },
  { id: "zai", factory: () => zaiPackage({ apiKey: key }) },
];

async function resolves(instance: PackageInstance, providerId: string): Promise<void> {
  let hits = 0;
  const agent = await createAgent({
    model: { provider: providerId, model: "probe" },
    packages: [instance],
  });
  try {
    const session = await (await agent.session());
    const result = await session.run("hi");
    // The run misses the mock wire, so it ends failed (a result, not a throw); it must not be provider resolution.
    assert.equal(result.status, "failed");
    assert.doesNotMatch(result.error?.message ?? "", /Unknown provider/, `${providerId} was not registered`);
    hits += 1;
  } finally {
    await agent.dispose();
  }
  assert.equal(hits, 1, `${providerId} run should miss the mock wire, not provider resolution`);
}

describe("vendor packages", () => {
  for (const vendor of vendors) {
    it(`${vendor.id}_package_registers_provider`, async () => {
      await resolves(vendor.factory(), vendor.id);
    });
  }

  it("provider_package_resolves_model_without_host_provider", async () => {
    let url = "";
    const agent = await createAgent({
      model: anthropicModels[0]!,
      packages: [
        anthropicPackage({
          apiKey: () => "sk-ant-test",
          fetch: (async (input) => {
            url = String(input);
            return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
          }) as typeof fetch,
        }),
      ],
    });
    try {
      const session = await (await agent.session());
      await session.run("hi").catch(() => undefined);
      assert.match(url, /anthropic\.com/);
    } finally {
      await agent.dispose();
    }
  });

  it("provider_key_never_surfaces", async () => {
    const secret = "sk-ant-api03-real-looking-key-should-not-surface";
    const agent = await createAgent({
      model: { provider: "anthropic", model: "claude-haiku-4-5" },
      packages: [
        anthropicPackage({
          apiKey: () => secret,
          fetch: (async () => new Response("data: [DONE]\n\n", { status: 200 })) as typeof fetch,
        }),
      ],
    });
    try {
      const session = await (await agent.session());
      const events: unknown[] = [];
      const reader = (async () => {
        for await (const event of session.subscribe()) events.push(event);
      })();
      await session.run("hi").catch(() => undefined);
      await reader;
      assert.equal((JSON.stringify(agent.inspect()) + JSON.stringify(events)).includes(secret), false);
    } finally {
      await agent.dispose();
    }
  });

  it("loading_one_vendor_never_evaluates_another", () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-vendor-graph-"));
    const out = join(dir, "graph.js");
    try {
      const built = spawnSync("bun", ["build", "--target=bun", "packages/prism-providers/src/anthropic/index.ts", `--outfile=${out}`], {
        encoding: "utf8",
      });
      assert.equal(built.status, 0, built.stderr);
      const text = readFileSync(out, "utf8");
      for (const sibling of ["openai", "google", "bedrock", "xai"]) {
        assert.equal(text.includes(`/src/${sibling}/`), false, `anthropic bundle evaluated ${sibling}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
