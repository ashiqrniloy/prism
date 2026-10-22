import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync as readFileSyncSync, readdirSync as readdirSyncSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "bun:test";

import {
  type EmbeddingsProvider,
  type JsonObject,
  type ModelProvider,
  type PackageInstance,
  type ProviderRequest,
  createAgent,
  definePackage,
} from "@arnilo/prism";
import { createHashEmbedder, type Embedder } from "@arnilo/prism-memory-core";
import {
  createMockProvider,
  mockProvider,
  packageConformance,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism/testing";

import memoryRag, { createRagSearchTool, type RagConfig } from "../index.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const RAG_SRC = join(REPO_ROOT, "packages/memory/rag/src");

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
  delete process.env.RAG_TEST_RERANK_KEY;
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-memory-rag-"));
  dirs.push(dir);
  return dir;
}

/** A deterministic `EmbeddingsProvider` plus a call counter, so "no embedding on a turn" is provable. */
function embeddingsFixture(): { provider: EmbeddingsProvider; calls: () => number } {
  const embedder: Embedder = createHashEmbedder({ dimensions: 8, id: "fake-embeddings" });
  let calls = 0;
  const provider: EmbeddingsProvider = {
    id: "fake-embeddings",
    async embedMany({ inputs }) {
      calls += 1;
      const vectors = await embedder.embed([...inputs]);
      return { vectors, usage: {}, dimensions: embedder.dimensions };
    },
  };
  return { provider, calls: () => calls };
}

const EMBEDDING_MODEL = { provider: "mock", model: "text-embedding", capabilities: { embeddings: true } } as const;

function baseConfig(overrides: Partial<RagConfig> = {}): RagConfig {
  return { embeddings: { model: EMBEDDING_MODEL as never, dimensions: 8 }, ...overrides };
}

interface HarnessOptions {
  readonly config?: RagConfig;
  readonly script?: readonly (readonly import("@arnilo/prism").ProviderEvent[])[];
  readonly extraPackages?: readonly PackageInstance[];
}

async function harness(options: HarnessOptions = {}) {
  const requests: ProviderRequest[] = [];
  const embeddings = embeddingsFixture();
  const provider = mockProvider(options.script ?? [[providerTextDelta("ok"), providerDone()]], {
    embeddings: embeddings.provider,
    onRequest: (request) => requests.push(request),
  });
  const agent = await createAgent({
    model: { provider: "mock", model: "main" },
    packages: [provider, memoryRag(options.config ?? baseConfig()), ...(options.extraPackages ?? [])],
  });
  return { agent, requests, embeddings };
}

const RAG_TOOL_SCRIPT = [
  [providerToolCall(toolCallContent("c1", "rag_search", { query: "durable approval" })), providerDone()],
  [providerTextDelta("answered"), providerDone()],
] as const;

function toolResultText(requests: readonly ProviderRequest[]): string {
  const last = requests.at(-1);
  return JSON.stringify(last?.messages ?? []);
}

describe("@arnilo/prism-memory-rag package (plan 158 Task 3)", () => {
  it("memory_rag_package_conformance", async () => {
    const embeddings = embeddingsFixture();
    const base = createMockProvider([providerTextDelta("conformance"), providerDone()]);
    const provider: ModelProvider = { ...base, embeddings: () => embeddings.provider };
    const result = await packageConformance(
      memoryRag(
        baseConfig({
          reranker: { kind: "openai-compatible", baseUrl: "https://rerank.example/v1", apiKey: "env:RAG_TEST_RERANK_KEY" },
        }),
      ),
      { mockProvider: provider },
    );
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("memory_rag_search_returns_indexed_chunk", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "approval.md"), "# Durable approval\n\nA resumed tool rechecks current execution policy before side effects.");
    await writeFile(join(root, "unrelated.md"), "# House plants\n\nWater the ferns on Tuesdays.");
    const { agent, requests } = await harness({ config: baseConfig({ sources: [{ path: root }] }), script: RAG_TOOL_SCRIPT });
    const session = await agent.session({ id: "rag-search", create: true });
    await session.run("find the approval note");
    const text = toolResultText(requests);
    assert.match(text, /resumed tool rechecks current execution policy/, "the matching chunk reaches the tool result");
    assert.match(text, /approval\.md#\d+/, "the citation id reaches the tool result");
    await session.close();
    await agent.dispose();
  });

  it("memory_rag_context_off_by_default", async () => {
    const { agent, requests, embeddings } = await harness({ config: baseConfig() });
    const session = await agent.session({ id: "rag-context-off", create: true });
    await session.run("hello");
    assert.equal(embeddings.calls(), 0, "no context handler means no embedding call");
    assert.doesNotMatch(toolResultText(requests), /Retrieved context/);
    await session.close();
    await agent.dispose();
  });

  it("memory_rag_context_on_injects_untrusted_block", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "policy.md"), "# Policy\n\nApproval rechecks execution policy before every side effect.");
    const { agent, requests } = await harness({ config: baseConfig({ sources: [{ path: root }], context: true }) });
    const session = await agent.session({ id: "rag-context-on", create: true });
    await session.run("what is the approval policy?");
    assert.match(toolResultText(requests), /Approval rechecks execution policy before every side effect/);
    await session.close();
    await agent.dispose();
  });

  it("memory_rag_provides_embeddings_service", async () => {
    const seen: { embedder?: Embedder } = {};
    const consumer = definePackage({
      name: "@acme/embeddings-consumer",
      version: "0.0.0",
      requires: { api: 1 },
      setup(prism) {
        const embedder = prism.services.require<Embedder>("embeddings");
        seen.embedder = embedder;
        prism.tools.register({
          name: "consumer_embed",
          async execute(_args, context) {
            const vectors = await embedder.embed(["x"]);
            return { toolCallId: context.toolCallId, name: "consumer_embed", value: { count: vectors.length }, content: [] };
          },
        });
      },
    })();
    const { agent } = await harness({ extraPackages: [consumer] });
    assert.ok(seen.embedder, "a later package consumes the embeddings service");
    assert.equal(seen.embedder!.id, "fake-embeddings/text-embedding");
    assert.deepEqual((await seen.embedder!.embed(["x"]))[0]?.length, 8);
    await agent.dispose();
  });

  it("memory_rag_no_embedding_model_notes", async () => {
    const { agent } = await harness({ config: { store: "memory" } });
    const inspection = agent.inspect();
    assert.ok(
      inspection.statusNotes.some((note) => note.level === "warn" && /no embeddings configured/.test(note.message)),
      "a missing embeddings model is a warn note",
    );
    assert.equal(
      inspection.tools.some((tool) => tool.name === "rag_search"),
      false,
      "no embeddings means no rag_search tool",
    );
    await agent.dispose();
  });

  it("memory_rag_url_source_without_web_fetch_notes", async () => {
    const { agent } = await harness({
      config: baseConfig({ sources: [{ url: "https://example.com/guide.md" }] }),
      script: RAG_TOOL_SCRIPT,
    });
    const session = await agent.session({ id: "rag-url-skip", create: true });
    await session.run("search");
    assert.ok(
      agent.inspect().statusNotes.some((note) => note.level === "warn" && /web\.fetch is not provided/.test(note.message)),
      "a URL source without web.fetch is skipped with a note",
    );
    await session.close();
    await agent.dispose();
  });

  it("memory_rag_url_source_uses_web_fetch", async () => {
    const webFetch = definePackage({
      name: "@acme/web-fetch",
      version: "0.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.services.provide("web.fetch", {
          async fetch(url: string) {
            return {
              citationId: "web:test:guide",
              provider: "firecrawl",
              url,
              markdown: "# Remote guide\n\nRemote approval rechecks execution policy.",
              retrievedAt: "2026-01-01T00:00:00.000Z",
              untrusted: true,
            };
          },
        });
      },
    })();
    const { agent, requests } = await harness({
      config: baseConfig({ sources: [{ url: "https://example.com/guide.md" }] }),
      script: RAG_TOOL_SCRIPT,
      extraPackages: [webFetch],
    });
    const session = await agent.session({ id: "rag-url-fetch", create: true });
    await session.run("search");
    assert.match(toolResultText(requests), /Remote approval rechecks execution policy/, "the fetched document is indexed and retrieved");
    await session.close();
    await agent.dispose();
  });

  it("memory_rag_secret_refs_never_echoed", async () => {
    const secret = "prism-rag-secret-value-8f2a";
    process.env.RAG_TEST_RERANK_KEY = secret;
    const { agent } = await harness({
      config: baseConfig({
        reranker: { kind: "voyage", baseUrl: "https://rerank.example/v1", apiKey: "env:RAG_TEST_RERANK_KEY" },
      }),
    });
    const snapshot = JSON.stringify(agent.inspect());
    assert.equal(snapshot.includes(secret), false, "the resolved secret never reaches inspect()");
    await agent.dispose();
  });

  it("memory_rag_acl_enforced", async () => {
    // The tool surfaces exactly what the retrieval seam returns: a denied source never reaches it.
    const tool = createRagSearchTool({
      retrieve: async (query) => ({
        query,
        trust: { untrusted: true, inert: true, injectionCapable: true },
        text: "[allowed#1] permitted text",
        hits: [],
        citations: [],
        truncated: false,
      }),
    });
    const result = await tool.execute({ query: "anything" } as JsonObject, {
      sessionId: "s",
      runId: "r",
      toolCallId: "c",
    });
    const value = result.value as { text: string };
    assert.equal(value.text, "[allowed#1] permitted text");
    assert.deepEqual(tool.effects, ["read"]);
  });

  it("local_reranker_not_loaded_unless_configured", async () => {
    // Static: no source file value-imports the inference runtime; the loader is a non-literal dynamic import.
    const offenders: string[] = [];
    for (const file of sourceFiles(RAG_SRC)) {
      const text = readFileSyncSync(file, "utf8");
      if (/import\s+(?!type\b)[^;]*from\s*["']@huggingface\/transformers["']/.test(text)) offenders.push(file);
    }
    assert.deepEqual(offenders, [], "no rag source module may statically import the local reranker runtime");

    const script = [
      'const rag = await import("@arnilo/prism-memory-rag");',
      'const seen = () => Object.keys(require.cache ?? {}).some((key) => key.includes("@huggingface/transformers"));',
      "const before = seen();",
      'rag.resolveReranker({ kind: "none" });',
      "const after = seen();",
      'console.log(JSON.stringify({ inert: typeof rag.createRagSearchTool === "function", before, after }));',
    ].join("\n");
    const result = spawnSync("bun", ["-e", script], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const probe = JSON.parse(result.stdout.trim()) as { inert: boolean; before: boolean; after: boolean };
    assert.equal(probe.inert, true);
    assert.equal(probe.before, false, "the local reranker runtime is absent from the module graph");
    assert.equal(probe.after, false, "resolveReranker(none) never loads the runtime");
  });
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSyncSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...sourceFiles(path));
    } else if (entry.name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}
