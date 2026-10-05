import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "bun:test";
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { createAgent, type ModelConfig, type ProviderRequest } from "@arnilo/prism";
import { packageConformance } from "@arnilo/prism/testing";
import { providerConformance } from "@arnilo/prism/provider-kit";
import aiSdkDefinition, {
  AI_SDK_PEER,
  aiSdk,
  assertSupportedAiSdkVersion,
  createAiSdkProvider,
  probeAiSdkPeer,
  readInstalledAiSdkVersion,
  SUPPORTED_AI_SDK_VERSION_MATRIX,
} from "../index.js";

const MODEL: ModelConfig = { provider: "ai-sdk:fake", model: "fake-1", displayName: "fake-1" };

const REPO_ROOT = fileURLToPath(new URL("../../../../..", import.meta.url));

function streamOf(parts: readonly LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function createFakeModel(
  parts?: readonly LanguageModelV4StreamPart[],
  onStream?: (call: LanguageModelV4CallOptions) => void,
): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "fake",
    modelId: "fake-1",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("doGenerate should not be used by the Prism adapter");
    },
    doStream: async (call: LanguageModelV4CallOptions) => {
      onStream?.(call);
      return {
        stream: streamOf(
          parts ?? [
            { type: "text-delta", id: "t1", delta: "hello" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
            },
          ],
        ),
        warnings: [],
      };
    },
  };
}

describe("@arnilo/prism-provider-ai-sdk package", () => {
  it("ai_sdk_passes_package_conformance", async () => {
    const result = await packageConformance(aiSdkDefinition);
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
      JSON.stringify(result.checks),
    );
    assert.equal(result.ok, true);
  });

  it("ai_sdk_passes_provider_conformance", async () => {
    // The AI SDK adapter has no HTTP transport of its own: the host model receives the call
    // options, so the captured "headers" are the ones Prism handed to `doStream`. Header
    // ownership is vacuous here (the adapter owns no wire header) but caller pass-through and
    // the secret-leak check still run.
    const canary = "ai-sdk-canary-header-value-should-not-surface";
    let captured: Headers | undefined;
    const model = createFakeModel(undefined, (call) => {
      captured = new Headers(call.headers as Record<string, string> | undefined);
    });
    const request: ProviderRequest = {
      model: MODEL,
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    };
    await providerConformance(() => createAiSdkProvider({ model }), {
      request,
      secrets: [canary],
      headers: {
        owned: {},
        caller: { authorization: `Bearer ${canary}`, "x-trace": "1" },
        captured: () => captured,
      },
      expect: { text: "hello" },
    });
  });

  it("ai_sdk_missing_peer_notes_status_and_registers_nothing", async () => {
    const agent = await createAgent({
      model: MODEL,
      packages: [
        aiSdk({
          model: createFakeModel(),
          readVersion: () => {
            throw new Error("Cannot find module '@ai-sdk/provider/package.json'");
          },
        }),
      ],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message.startsWith("ai-sdk: "));
      assert.equal(notes.length, 1, "a missing peer is a status note, not a failed setup");
      assert.equal(notes[0]?.level, "warn");
      assert.match(notes[0]?.message ?? "", new RegExp(`${AI_SDK_PEER.replace("/", "\\/")} is not installed`));
      assert.throws(() => agent.models.resolve("ai-sdk:fake/fake-1"), /Unknown provider/);
    } finally {
      await agent.dispose();
    }
  });

  it("ai_sdk_unsupported_peer_version_notes_status_and_registers_nothing", async () => {
    const agent = await createAgent({
      model: MODEL,
      packages: [aiSdk({ model: createFakeModel(), readVersion: () => "4.0.5" })],
    });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message.startsWith("ai-sdk: "));
      assert.equal(notes.length, 1);
      assert.equal(notes[0]?.level, "warn");
      assert.match(notes[0]?.message ?? "", /unsupported @ai-sdk\/provider version "4\.0\.5"/);
      assert.throws(() => agent.models.resolve("ai-sdk:fake/fake-1"), /Unknown provider/);
    } finally {
      await agent.dispose();
    }
  });

  it("ai_sdk_without_a_host_model_notes_status_and_registers_nothing", async () => {
    const agent = await createAgent({ model: MODEL, packages: [aiSdk()] });
    try {
      const notes = agent.inspect().statusNotes.filter((note) => note.message.startsWith("ai-sdk: "));
      assert.equal(notes.length, 1);
      assert.equal(notes[0]?.level, "info");
      assert.match(notes[0]?.message ?? "", /no host model/);
      assert.throws(() => agent.models.resolve("ai-sdk:fake/fake-1"), /Unknown provider/);
    } finally {
      await agent.dispose();
    }
  });

  it("ai_sdk_registers_the_host_model_and_lists_it_without_fetching", async () => {
    const agent = await createAgent({ model: MODEL, packages: [aiSdk({ model: createFakeModel() })] });
    try {
      assert.deepEqual(agent.inspect().statusNotes, []);
      const listed = await agent.models.list();
      assert.ok(listed.some((entry) => entry.model === "fake-1"));
      const session = await agent.session();
      const result = await session.run("hi");
      assert.notEqual(result.status, "failed");
    } finally {
      await agent.dispose();
    }
  });

  it("ai_sdk_configured_catalog_overrides_the_derived_entry", async () => {
    const pinned: ModelConfig = { provider: "ai-sdk:fake", model: "fake-1", displayName: "Pinned" };
    const agent = await createAgent({ model: MODEL, packages: [aiSdk({ model: createFakeModel(), models: [pinned] })] });
    try {
      const listed = await agent.models.list();
      assert.equal(listed.find((entry) => entry.model === "fake-1")?.displayName, "Pinned");
    } finally {
      await agent.dispose();
    }
  });

  it("ai_sdk_peer_probe_reports_missing_and_unsupported", () => {
    assert.deepEqual(
      probeAiSdkPeer(() => "4.0.13"),
      { ok: true, version: "4.0.13" },
    );
    assert.deepEqual(
      probeAiSdkPeer(() => "4.0.5"),
      { ok: false, reason: "unsupported", version: "4.0.5" },
    );
    assert.deepEqual(
      probeAiSdkPeer(() => {
        throw new Error("missing");
      }),
      { ok: false, reason: "missing" },
    );
    assert.ok(SUPPORTED_AI_SDK_VERSION_MATRIX.some((entry) => entry.providerVersion === readInstalledAiSdkVersion()));
    // The strict factory check stays: a direct call still fails closed on an unlisted version.
    assert.throws(() => assertSupportedAiSdkVersion("4.0.5"), /Unsupported @ai-sdk\/provider version/);
  });

  it("ai_sdk_peer_not_loaded_unless_listed", () => {
    // Source scan: only this package may name the optional peer.
    const providers = join(REPO_ROOT, "packages/providers");
    const offenders: string[] = [];
    for (const dir of readdirSync(providers)) {
      const src = join(providers, dir, "src");
      if (!existsSync(join(src, "index.ts"))) continue;
      for (const file of readdirSync(src, { recursive: true, encoding: "utf8" })) {
        if (!file.endsWith(".ts")) continue;
        const text = readFileSync(join(src, file), "utf8");
        if (text.includes(AI_SDK_PEER) && dir !== "ai-sdk") offenders.push(`${dir}/${file}`);
      }
    }
    assert.deepEqual(offenders, [], "no other provider package may load the AI SDK peer");
    // The bridge itself imports the peer as a type only: the built module stays inert.
    const scratch = mkdtempSync(join(tmpdir(), "prism-ai-sdk-graph-"));
    try {
      const out = join(scratch, "ai-sdk.js");
      const built = spawnSync("bun", ["build", "--target=bun", join(providers, "ai-sdk/src/index.ts"), `--outfile=${out}`], {
        encoding: "utf8",
      });
      assert.equal(built.status, 0, built.stderr);
      const bundle = readFileSync(out, "utf8");
      assert.equal(/from\s*"@ai-sdk\/provider"/.test(bundle), false, "the peer must not be a static import");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
