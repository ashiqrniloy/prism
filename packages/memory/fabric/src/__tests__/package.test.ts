import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { createAgent, definePackage, type JsonObject, type PackageInstance, type ProviderEvent, type ProviderRequest } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import {
  createMockProvider,
  mockProvider,
  packageConformance,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism/testing";
import { createHashEmbedder, type Embedder } from "@arnilo/prism-memory-core";
import { contextEngineering } from "../../../../context/engineering/src/index.js";

import memoryFabric, { type MemoryFabricConfig } from "../index.js";
import { parseProjectFile, projectResourceId, resolveProjectIdentity } from "../scope/identity.js";

/** The default project resource: the test process cwd is inside the repo, so identity is stable. */
const PROJECT_RESOURCE = projectResourceId(resolveProjectIdentity(process.cwd()));
const PROJECT_NOTES = join("notes", "prism", ...PROJECT_RESOURCE.split("/"));

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-memory-fabric-"));
  dirs.push(dir);
  return dir;
}

/** Another package's `Embedder`, the way `@arnilo/prism-memory-rag` provides it. */
function embeddingsPackage(): PackageInstance {
  const embedder: Embedder = createHashEmbedder({ dimensions: 8, id: "fake-embeddings" });
  return definePackage({
    name: "@acme/embeddings",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.services.provide("embeddings", embedder);
    },
  })();
}

interface HarnessOptions {
  readonly config?: MemoryFabricConfig;
  readonly script?: readonly (readonly ProviderEvent[])[];
  readonly extraPackages?: readonly PackageInstance[];
}

async function harness(options: HarnessOptions = {}) {
  const requests: ProviderRequest[] = [];
  const provider = mockProvider(options.script ?? [[providerTextDelta("ok"), providerDone()]], {
    onRequest: (request) => requests.push(request),
  });
  const agent = await createAgent({
    model: { provider: "mock", model: "main" },
    packages: [provider, memoryFabric(options.config ?? {}), ...(options.extraPackages ?? [])],
  });
  return { agent, requests };
}

const INSERT_THEN_ANSWER = [
  [providerToolCall(toolCallContent("c1", "memory.insert", { text: "canary rollout protects deploys", block: "core" })), providerDone()],
  [providerTextDelta("stored"), providerDone()],
] as const;

function toolNames(requests: readonly ProviderRequest[]): string[] {
  return (requests.at(-1)?.tools ?? []).map((tool) => tool.name);
}

function lastToolResult(requests: readonly ProviderRequest[]): string {
  return JSON.stringify(requests.at(-1)?.messages ?? []);
}

describe("@arnilo/prism-memory-fabric package (plan 158 Task 4)", () => {
  it("memory.read finds a note in another active scope by id", async () => {
    const root = await mkdtemp(join(tmpdir(), "fabric-scope-read-"));
    dirs.push(root);
    let readResult: string | undefined;
    const provider = providerPackage(
      "dynamic-read",
      [
        {
          id: "mock",
          async *generate(request) {
            const blocks = request.messages.flatMap((message) => (Array.isArray(message.content) ? (message.content as JsonObject[]) : []));
            const calls = blocks.filter((block) => block.type === "tool_call");
            const results = blocks.filter((block) => block.type === "tool_result");
            if (calls.length === 0) {
              yield providerToolCall(
                toolCallContent("c1", "memory.insert", { text: "prefers terse replies", kind: "preference", scope: "user" }),
              );
            } else if (results.length === 1) {
              const id = (results[0]?.result as { id?: string } | undefined)?.id;
              yield providerToolCall(toolCallContent("c2", "memory.read", typeof id === "string" ? { ids: [id] } : {}));
            } else {
              readResult = JSON.stringify(results[1]?.result);
              yield providerTextDelta("ok");
            }
            yield providerDone();
          },
        },
      ],
      "Dynamic read provider",
    );
    const agent = await createAgent({
      model: { provider: "mock", model: "main" },
      packages: [provider, memoryFabric({ tools: { root } })],
    });
    try {
      await (await agent.session({ create: true })).run("Remember that I prefer terse replies.");
    } finally {
      await agent.dispose();
    }
    // The project scope is memories[0] while this note lives in the user scope; the tool must find it anyway.
    assert.match(readResult ?? "", /prefers terse replies/);
  });

  it("passive recall runs once per user turn and preserves tail bytes through tool rounds", async () => {
    let embeddings = 0;
    const base = createHashEmbedder({ dimensions: 8, id: "uncalibrated-fixture" });
    const service = definePackage({
      name: "fixture-embeddings",
      version: "0.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.services.provide("embeddings", {
          ...base,
          async embed(texts: readonly string[], options: Parameters<Embedder["embed"]>[1]) {
            embeddings++;
            return base.embed(texts, options);
          },
        });
      },
    })();
    const { agent, requests } = await harness({
      config: { retrieval: "hybrid", inject: { minSimilarity: 0.35 }, consolidate: false },
      extraPackages: [
        service,
        contextEngineering({ fold: { minAgeTurns: 1, minBytes: 1, maxSummaryBytes: 32 }, budget: { maxInputTokens: 20_000 } }),
      ],
      script: [
        [providerToolCall(toolCallContent("i1", "memory.insert", { kind: "fact", text: "needle" })), providerDone()],
        [providerTextDelta("stored"), providerDone()],
        [providerToolCall(toolCallContent("w1", "memory.insert", { block: "plan", text: "continue" })), providerDone()],
        [providerTextDelta("done"), providerDone()],
      ],
    });
    try {
      const session = await agent.session({ create: true });
      await session.run("needle");
      // One write embedding plus one query embedding per active scope (project, agent, user).
      assert.equal(embeddings, 4);
      await session.run("needle");
      assert.equal(embeddings, 7);
      const tails = requests.slice(2).map((request) => request.messages.find((message) => message.metadata?.contextBlocks));
      assert.ok(tails[0]);
      const semantic = (tail: (typeof tails)[number]) => tail?.content.at(-1);
      assert.deepEqual(semantic(tails[0]), semantic(tails[1]));
      assert.match(JSON.stringify(tails[1]), /fabric-working/);
      assert.doesNotMatch(JSON.stringify(requests[3]?.context ?? []), /fabric-working/);
      assert.match(JSON.stringify(tails[0]), /fabric-semantic/);
      assert.equal(agent.inspect().statusNotes.filter((note) => /provisional cosine floor/.test(note.message)).length, 1);
      await session.close();
    } finally {
      await agent.dispose();
    }
  });

  it("injected citations touch durable notes after streamed provider output", async () => {
    const root = await tempRoot();
    const { providerPackage } = await import("@arnilo/prism/provider-kit");
    let turn = 0;
    let injected = "";
    const agent = await createAgent({
      model: "fixture/main",
      packages: [
        providerPackage("fixture-provider", [
          {
            id: "fixture",
            async *generate(request) {
              turn++;
              if (turn === 1) yield providerToolCall(toolCallContent("i", "memory.insert", { kind: "fact", text: "needle" }));
              else if (turn === 2) yield providerTextDelta("stored");
              else {
                const tail = request.messages.find((message) => message.metadata?.contextBlocks);
                injected = /\[([a-f0-9]{12})\]/.exec(JSON.stringify(tail))?.[1] ?? "";
                assert.ok(injected);
                yield providerTextDelta(`Using [${injected.slice(0, 4)}`);
                yield providerTextDelta(`${injected.slice(4)}]`);
              }
              yield providerDone();
            },
          },
        ]),
        memoryFabric({ tools: { root }, inject: {}, consolidate: false }),
        embeddingsPackage(),
      ],
    });
    try {
      const session = await agent.session({ create: true });
      await session.run("needle");
      await session.run("needle");
      await session.close();
    } finally {
      await agent.dispose();
    }
    const { createMarkdownMemoryStores } = await import("@arnilo/prism-memory-core/fabric");
    const stores = await createMarkdownMemoryStores({ root: join(root, "notes") });
    try {
      const records = await stores.vectorStore.getByIds({ tenantId: "prism", resourceId: PROJECT_RESOURCE, threadId: "default" }, [
        injected,
      ]);
      assert.ok(records[0]?.lastAccessedAt);
    } finally {
      await stores.close();
    }
  });

  it("directory_prefix_stays_identical_across_working_writes", async () => {
    const root = join(await tempRoot(), "directory-root");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "plan.md"), "plan");
    const { agent, requests } = await harness({
      config: { tools: { root }, semantic: false },
      script: [...INSERT_THEN_ANSWER, [providerTextDelta("again"), providerDone()], [providerTextDelta("once more"), providerDone()]],
    });
    try {
      const session = await agent.session({ id: "dir", create: true });
      await session.run("remember");
      await session.run("next");
      await session.run("last");
      const rendered = requests.map((request) => JSON.stringify(request));
      assert.ok(rendered[0]!.includes("Long-term memory"), "files alone populate the directory");
      assert.ok(!rendered[0]!.includes("Blocks:"));
      const prefixes = requests.map((request) => JSON.stringify(request.context));
      assert.equal(new Set(prefixes).size, 1, "working writes leave the epoch prefix unchanged");
      assert.match(JSON.stringify(requests[1]?.messages.at(-1)), /fabric-working/);
      assert.ok(!rendered.some((text) => text.includes("prism-memory.sqlite")), "the store file is never listed");
      await session.close();
    } finally {
      await agent.dispose();
    }
  });

  it("rules_block_renders_in_the_prefix_after_the_directory_and_stays_stable", async () => {
    const root = join(await tempRoot(), "core-root");
    await mkdir(root, { recursive: true });
    const { agent, requests } = await harness({
      config: { tools: { root } },
      script: [
        [providerToolCall(toolCallContent("c1", "memory.insert", { kind: "fact", text: "deploys run on fridays" })), providerDone()],
        [providerTextDelta("stored"), providerDone()],
        [providerTextDelta("again"), providerDone()],
        [providerTextDelta("last"), providerDone()],
      ],
    });
    try {
      let session = await agent.session({ id: "core-seed", create: true });
      await session.run("remember deploys");
      await session.close();
      session = await agent.session({ id: "core-prefix", create: true });
      await session.run("next");
      await session.run("last");
      const rendered = requests.map((request) => JSON.stringify(request));
      assert.ok(!rendered[0]!.includes("Standing rules"), "an empty rule set renders no block");
      assert.match(rendered[2]!, /Standing rules \(project prism\): \[[0-9a-f]{12}\] deploys run on fridays/);
      assert.ok(rendered[2]!.indexOf("Long-term memory") < rendered[2]!.indexOf("Standing rules"), "the directory stays first");
      const core = (text: string) => /Standing rules \(project prism\): [^"]+/.exec(text)?.[0];
      assert.equal(core(rendered[2]!), core(rendered[3]!), "no write between turns: identical bytes");
      assert.match(
        readFileSync(join(root, PROJECT_NOTES, "rules.md"), "utf8"),
        /deploys run on fridays/,
        "the markdown store persists the editable rules.md",
      );
      await session.close();
    } finally {
      await agent.dispose();
    }
  });

  it("model_decider_is_lazy_and_runs_once_for_a_similar_write", async () => {
    const { agent, requests } = await harness({
      config: { consolidate: { threshold: 0, decider: "model" } },
      extraPackages: [embeddingsPackage()],
      script: [
        [providerToolCall(toolCallContent("i1", "memory.insert", { kind: "fact", text: "Alice flight leaves at noon" })), providerDone()],
        [providerToolCall(toolCallContent("i2", "memory.insert", { kind: "fact", text: "Bob flight leaves at noon" })), providerDone()],
        [providerToolCall(toolCallContent("d1", "decide_memory", { action: "ADD" })), providerDone()],
        [providerTextDelta("stored"), providerDone()],
      ],
    });
    try {
      assert.equal(requests.length, 0);
      const session = await agent.session({ create: true });
      await session.run("remember flights");
      assert.equal(requests.filter((request) => request.tools?.some((tool) => tool.name === "decide_memory")).length, 1);
      assert.match(lastToolResult(requests), /similar/);
      await session.close();
    } finally {
      await agent.dispose();
    }
  });

  it("invalid_project_scope_warns_once_and_keeps_user_and_agent", async () => {
    const { agent } = await harness({ config: { semantic: false, scopes: { project: { id: "bad id" } } } });
    try {
      const warnings = agent.inspect().statusNotes.filter((note) => note.level === "warn" && /project scope disabled/.test(note.message));
      assert.equal(warnings.length, 1);
    } finally {
      await agent.dispose();
    }
  });

  it("project_md_records_the_identity_and_every_root", async () => {
    const root = await tempRoot();
    const { agent } = await harness({ config: { tools: { root }, semantic: false } });
    try {
      const identity = resolveProjectIdentity(process.cwd());
      const file = join(root, PROJECT_NOTES, "project.md");
      assert.ok(existsSync(file), "project.md is created on the first write");
      const content = readFileSync(file, "utf8");
      const parsed = parseProjectFile(content);
      assert.equal(parsed?.source, identity.source);
      assert.deepEqual(parsed?.roots, identity.roots);
      assert.doesNotMatch(content, /token|user@/);
    } finally {
      await agent.dispose();
    }
  });

  it("fabric_warns_without_durable_store", async () => {
    const { agent } = await harness({ config: { semantic: false } });
    assert.ok(agent.inspect().statusNotes.some((note) => note.level === "warn" && /no durable store configured/.test(note.message)));
    await agent.dispose();
  });

  it("fabric_defaults_to_markdown_with_root_and_working_memory_survives_restart", async () => {
    const root = join(await tempRoot(), "new-root");
    const config = { tools: { root }, semantic: false };
    const first = await harness({ config, script: INSERT_THEN_ANSWER });
    const session = await first.agent.session({ id: "durable", create: true });
    await session.run("remember");
    await session.close();
    await first.agent.dispose();
    assert.ok(existsSync(join(root, "notes", ".index.sqlite")), "the markdown store's derived index is the default");
    assert.ok(existsSync(join(root, PROJECT_NOTES, "working", "default.md")), "working memory is a browsable note file under notes/");
    const next = await harness({ config });
    const reopened = await next.agent.session({ id: "durable", create: true });
    await reopened.run("recall");
    assert.match(JSON.stringify(next.requests[0]), /canary rollout protects deploys/);
    await reopened.close();
    await next.agent.dispose();
  });

  it("fabric_startup_reconcile_uses_late_embeddings_and_skips_database_files", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "note.md"), "canary rollout protects deploys");
    let calls = 0;
    const hash = createHashEmbedder({ dimensions: 8, id: "fake-embeddings" });
    const embeddings = definePackage({
      name: "@acme/startup-embeddings",
      version: "0.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.services.provide("embeddings", {
          ...hash,
          embed: (...args: Parameters<typeof hash.embed>) => {
            if (args[0].some((text) => text.includes("canary rollout"))) calls++;
            return hash.embed(...args);
          },
        });
      },
    })();
    for (let restart = 0; restart < 3; restart++) {
      if (restart === 2) await writeFile(join(root, "note.md"), "updated canary rollout protects deploys");
      const { agent } = await harness({ config: { retrieval: "hybrid", tools: { root } }, extraPackages: [embeddings] });
      const session = await agent.session({ id: "reconcile-startup", create: true });
      await session.run("hello");
      assert.equal(calls, restart === 2 ? 2 : 1);
      await session.close();
      await agent.dispose();
    }
  });

  it("fabric_sqlite_path_outside_root_fails_config", async () => {
    const root = await tempRoot();
    for (const path of ["../outside.sqlite", join(await tempRoot(), "outside.sqlite")]) {
      await assert.rejects(harness({ config: { tools: { root }, store: { sqlite: { path } } } }), /inside tools.root/);
    }
    const outside = await tempRoot();
    await symlink(outside, join(root, "escape"));
    await assert.rejects(harness({ config: { tools: { root }, store: { sqlite: { path: "escape/db.sqlite" } } } }), /symlink/);
  });

  (process.env.PRISM_TEST_POSTGRES_URL ? it : it.skip)("fabric_postgres_uses_durable_working_store", async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.PRISM_TEST_POSTGRES_URL });
    const schema = `fabric_${crypto.randomUUID().replaceAll("-", "")}`;
    const config: MemoryFabricConfig = { semantic: false, store: { postgres: { connection: "env:PRISM_TEST_POSTGRES_URL", schema } } };
    try {
      const first = await harness({ config, script: INSERT_THEN_ANSWER });
      const session = await first.agent.session({ id: "pg-durable", create: true });
      await session.run("remember");
      await session.close();
      await first.agent.dispose();
      const next = await harness({ config });
      const reopened = await next.agent.session({ id: "pg-durable", create: true });
      await reopened.run("recall");
      assert.match(JSON.stringify(next.requests[0]), /canary rollout protects deploys/);
      await reopened.close();
      await next.agent.dispose();
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });

  it("memory_fabric_package_conformance", async () => {
    const base = createMockProvider([providerTextDelta("conformance"), providerDone()]);
    const result = await packageConformance(memoryFabric({ semantic: false }), { mockProvider: base });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("memory_fabric_working_memory_no_model_calls", async () => {
    const { agent, requests } = await harness({ config: { semantic: false }, script: INSERT_THEN_ANSWER });
    const session = await agent.session({ id: "fabric-working", create: true });
    await session.run("remember this");
    // One turn is one provider call; the fabric adds no model call of its own.
    assert.equal(requests.length, 2, "the tool round trip is the only extra provider call");
    assert.match(lastToolResult(requests), /"created":true/);
    await session.close();
    await agent.dispose();
  });

  it("memory_fabric_recall_available_without_embeddings", async () => {
    const { agent, requests } = await harness({ config: { semantic: true } });
    const inspection = agent.inspect();
    assert.equal(
      inspection.statusNotes.some((note) => note.level === "warn" && /embeddings service/.test(note.message)),
      false,
      "lexical retrieval needs no embeddings service and emits no warn note",
    );
    const session = await agent.session({ id: "fabric-no-embeddings", create: true });
    await session.run("hello");
    const offered = toolNames(requests);
    assert.equal(offered.includes("memory.recall"), true, "lexical recall is offered without an embeddings service");
    assert.equal(offered.includes("memory.insert"), true, "indexed writes are offered");
    await session.close();
    await agent.dispose();
  });

  it("fabric_lexical_default_makes_no_embedding_call", async () => {
    let embeddings = 0;
    const base = createHashEmbedder({ dimensions: 8, id: "counted-embeddings" });
    const service = definePackage({
      name: "@acme/counted-embeddings",
      version: "0.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.services.provide("embeddings", {
          ...base,
          async embed(texts: readonly string[], options: Parameters<Embedder["embed"]>[1]) {
            embeddings++;
            return base.embed(texts, options);
          },
        });
      },
    })();
    const { agent } = await harness({
      config: { consolidate: false },
      extraPackages: [service],
      script: [
        [
          providerToolCall(toolCallContent("i", "memory.insert", { kind: "fact", text: "canary rollout protects deploys" })),
          providerDone(),
        ],
        [providerTextDelta("stored"), providerDone()],
        [providerToolCall(toolCallContent("r", "memory.recall", { query: "canary rollout" })), providerDone()],
        [providerTextDelta("done"), providerDone()],
      ],
    });
    const session = await agent.session({ create: true });
    await session.run("remember");
    await session.run("recall");
    assert.equal(embeddings, 0, "the lexical default never calls the embeddings service");
    await session.close();
    await agent.dispose();
  });

  it("hybrid_without_service_notes_and_falls_back", async () => {
    const { agent, requests } = await harness({
      config: { retrieval: "hybrid" },
      script: [
        [
          providerToolCall(toolCallContent("i", "memory.insert", { kind: "fact", text: "canary rollout protects deploys" })),
          providerDone(),
        ],
        [providerTextDelta("stored"), providerDone()],
        [providerToolCall(toolCallContent("r", "memory.recall", { query: "canary rollout" })), providerDone()],
        [providerTextDelta("done"), providerDone()],
      ],
    });
    assert.ok(
      agent.inspect().statusNotes.some((note) => /hybrid needs an embeddings service/.test(note.message)),
      "hybrid without a service notes the fallback",
    );
    const session = await agent.session({ create: true });
    await session.run("remember");
    await session.run("recall");
    assert.match(JSON.stringify(requests.at(-1)?.messages ?? []), /canary rollout protects deploys/, "lexical recall still works");
    await session.close();
    await agent.dispose();
  });

  it("memory_fabric_tools_gated_per_session", async () => {
    const { agent, requests } = await harness({ config: { semantic: false }, script: INSERT_THEN_ANSWER });
    const session = await agent.session({ id: "fabric-gated", create: true });
    await session.run("first");
    assert.ok(toolNames(requests).includes("memory.insert"), "the enabled session sees the fabric tools");
    assert.ok(toolNames(requests).includes("memory.replace"));

    const off = (await agent.commands.run("memory", {} as JsonObject, { session })) as { enabled: boolean };
    assert.equal(off.enabled, false);
    await session.run("second");
    assert.equal(toolNames(requests).includes("memory.insert"), false, "a disabled session does not see the fabric tools");
    assert.equal(toolNames(requests).includes("memory.replace"), false);
    await session.close();
    await agent.dispose();
  });

  it("memory_fabric_scoped_recall_records_no_use_on_retrieval", async () => {
    const scopeRoot = await tempRoot();
    const toolsRoot = await tempRoot();
    const script = [
      [
        providerToolCall(toolCallContent("c1", "memory.insert", { path: "canary.md", text: "canary rollout protects deploys" })),
        providerDone(),
      ],
      [providerToolCall(toolCallContent("c2", "memory.recall", { query: "canary rollout protects deploys" })), providerDone()],
      [providerTextDelta("recalled"), providerDone()],
    ] as const;
    const { agent, requests } = await harness({
      config: { scoped: { scopeRoot }, tools: { root: toolsRoot } },
      extraPackages: [embeddingsPackage()],
      script,
    });
    const session = await agent.session({ id: "fabric-scoped", create: true });
    await session.run("remember and recall");
    const recalled = JSON.parse(lastToolResult(requests)) as Array<{ content?: Array<{ type: string; text?: string }> }>;
    assert.match(JSON.stringify(recalled), /"hits":\[\{/, "the scoped recall returned the indexed note");
    // A retrieval is not a use (D5): the scoped policy no longer writes a use row anywhere.
    await assert.rejects(readFile(join(scopeRoot, ".memory", "state.json"), "utf8"), /ENOENT/);
    await session.close();
    await agent.dispose();
  });

  // Plan 210 Task 2: capture reads the archived user turn; without the archive it cannot fire, so setup says so.
  it("rules_capture_without_the_exchange_archive_warns_at_setup", async () => {
    const { agent } = await harness({ config: { store: "memory", rules: { capture: "confirm" } } });
    const notes = agent.inspect().statusNotes.map((note) => note.message);
    assert.ok(
      notes.some((message) => /rules\.capture needs the exchange archive/.test(message)),
      "the silent no-op is reported",
    );
    await agent.dispose();
    const { agent: archived } = await harness({ config: { store: "memory", rules: { capture: "confirm" }, exchanges: {} } });
    assert.equal(
      archived.inspect().statusNotes.some((note) => /rules\.capture needs/.test(note.message)),
      false,
      "with the archive on, capture can fire and nothing is reported",
    );
    await archived.dispose();
  });

  // Plan 210 Task 2: the inspectability role of the `memory` toggle and `memory:status` rests on this test.
  it("memory_toggle_and_status_commands_are_inspectable", async () => {
    const script = [
      [providerToolCall(toolCallContent("c1", "memory.insert", { kind: "fact", text: "canary rollout protects deploys" })), providerDone()],
      [providerTextDelta("stored"), providerDone()],
    ] as const;
    const { agent } = await harness({ config: { store: "memory" }, script });
    const session = await agent.session({ id: "fabric-inspect", create: true });
    type Status = { ok: boolean; candidate: number; verified: number; archived: number; refused: number; text: string };
    const empty = (await agent.commands.run("memory:status", {} as JsonObject, { session })) as Status;
    assert.equal(empty.ok, true);
    assert.equal(empty.candidate + empty.verified + empty.archived, 0, "status counts an empty store as empty");
    await session.run("remember the canary rule");
    const after = (await agent.commands.run("memory:status", {} as JsonObject, { session })) as Status;
    assert.equal(after.candidate + after.verified, 1, "status counts the note the turn wrote");
    assert.equal(after.refused, 0);
    assert.match(after.text, /Fabric notes: \d+ candidate, \d+ verified, 0 archived/);
    const off = (await agent.commands.run("memory", {} as JsonObject, { session })) as { enabled: boolean; text?: string };
    assert.equal(off.enabled, false, "the toggle reports the state it set");
    const on = (await agent.commands.run("memory", {} as JsonObject, { session })) as { enabled: boolean };
    assert.equal(on.enabled, true, "a second toggle reports the restored state");
    await session.close();
    await agent.dispose();
  });

  it("memory_fabric_state_survives_reopen", async () => {
    const { agent } = await harness({ config: { semantic: false } });
    const first = await agent.session({ id: "fabric-reopen", create: true });
    await first.run("hello");
    const off = (await agent.commands.run("memory", {} as JsonObject, { session: first })) as { enabled: boolean };
    assert.equal(off.enabled, false);
    await first.close();

    const reopened = await agent.session({ id: "fabric-reopen" });
    await reopened.run("hello again");
    const toggled = (await agent.commands.run("memory", {} as JsonObject, { session: reopened })) as { enabled: boolean };
    assert.equal(toggled.enabled, true, "the disabled state survived the reopen");
    await reopened.close();
    await agent.dispose();
  });
});

describe("lifecycle retirement sweep (plan 188.4)", () => {
  const repoRoot = resolve(import.meta.dirname, "../../../../..");

  it("calendar_archive_after_days_is_gone", async () => {
    // Retired by plan 188.4: the exponential decay multiplied into relevance (D8, Task 3) and the
    // calendar-day archive (Task 4). Only frozen records and release notes may still name them.
    const retired = /scoreScopedHit|\btauDays\b|archiveAfterDays|candidateArchiveDays|isStaleCandidate|archiveStale/;
    const skipDir = /^(docs\/history|docs\/_evidence|plans|scripts\/compat-baseline|node_modules|dist|\.types)(\/|$)|\/\.types\//;
    const allowed = (key: string): boolean => /CHANGELOG\.md$/.test(key) || key === "packages/memory/fabric/src/__tests__/package.test.ts";
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!/^(node_modules|dist|\.git|\.types)$/.test(entry.name)) walk(path);
          continue;
        }
        if (!/\.(ts|tsx|mjs|cjs|js|json|md)$/.test(entry.name)) continue;
        const key = relative(repoRoot, path).split("\\").join("/");
        if (skipDir.test(key)) continue;
        if (retired.test(readFileSync(path, "utf8"))) hits.push(key);
      }
    };
    for (const root of ["src", "packages", "examples", "docs"]) {
      if (existsSync(join(repoRoot, root))) walk(join(repoRoot, root));
    }
    assert.deepEqual(
      hits.filter((key) => !allowed(key)),
      [],
      `no live file may name a retired lifecycle: ${hits.join(", ")}`,
    );
    // Positive control: the scan looked, and the exports are really gone.
    assert.ok(hits.length > 0, "release notes still describe the removals");
    const surface = await import("../exports.js");
    for (const name of ["scoreScopedHit", "isStaleCandidate", "DEFAULT_PROMOTE_ARCHIVE_AFTER_DAYS", "HARD_PROMOTE_ARCHIVE_AFTER_DAYS"]) {
      assert.equal(name in surface, false, `${name} is retired`);
    }
  });
});

describe("retired memory family workspace", () => {
  const repoRoot = resolve(import.meta.dirname, "../../../../..");
  const FAMILY = "@arnilo/prism-memory";

  it("no_workspace_imports_prism_memory_family", () => {
    // Plan 158 Task 6 deleted the family workspace. Live code must not import it, and only frozen
    // records (history/evidence/baselines/changelogs/migration pages), exported 0.12 docs, or
    // explicit negative guards may even name it. `rg` equivalent:
    //   rg -n '@arnilo/prism-memory"|@arnilo/prism-memory/' src packages scripts examples docs
    // `.types/` is gitignored tsc output for the source-exported packages.
    const skipDir = /^(docs\/history|docs\/_evidence|scripts\/compat-baseline|node_modules|dist|\.types)(\/|$)|\/\.types\//;
    const allowedFiles = new Set([
      "packages/memory/fabric/src/__tests__/package.test.ts", // this scan's own allow-list
      "packages/memory/fabric/src/__tests__/notes.test.ts", // asserts the family manifest is deleted
      "packages/memory/fabric/README.md", // "moved out of the `@arnilo/prism-memory/{fabric,scoped}` subpaths"
      "packages/memory/wiki/README.md", // "moved out of the `@arnilo/prism-memory/wiki` subpath"
      "scripts/deprecations-0.13.json", // the deliberate 0.13 registry deprecation ledger names every retired line
      "scripts/budgets.json", // frozen 0.12 family export budget and historical rationale
      "scripts/phase12-freeze-manifest.json", // frozen 0.12 record: "pgvector (required by … path only)"
      "scripts/independent-packages.json", // the lockstep note names the retired family it replaced
      "scripts/phase24-truth.test.mjs", // the unreachable 0.11-era peer-map branch
      "scripts/phase29-freeze-manifest.json", // 0.2.9 supersession map: family -> @arnilo/prism-memory-core
      "scripts/phase54-package-map.mjs", // frozen 0.4 consolidation spec plus retired migration rows
      "scripts/phase54-package-map.test.mjs", // pins the frozen spec's prism-wiki bin target
      "scripts/postgres-evidence.test.mjs", // negative-control filter that drops the memory leg
      "src/__tests__/docs.test.ts", // the frozen phase 9/10 evidence token lists
      "src/__tests__/host-composition-compat.test.ts", // asserts the packed consumer names no family
      "src/__tests__/packaging.test.ts", // asserts the family manifest is deleted
      "src/__tests__/public-export-contract.test.ts", // asserts the family workspace is gone
    ]);
    const allowed = (path: string): boolean => allowedFiles.has(path) || /\/CHANGELOG\.md$/.test(path) || path.startsWith("docs/"); // released 0.12 pages; plan 158 Phase 11 owns them
    const importsFamily = new RegExp(`\\bfrom\\s+"${FAMILY}(?![-\\w])|import\\(\\s*"${FAMILY}(?![-\\w])`);
    const namesFamily = new RegExp(`${FAMILY}(?![-\\w])`);

    const mentions: string[] = [];
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx|mjs|cjs|js|json|md)$/.test(entry.name)) continue;
        const key = relative(repoRoot, path).split("\\").join("/");
        if (skipDir.test(key)) continue;
        const text = readFileSync(path, "utf8");
        if (!namesFamily.test(text)) continue;
        mentions.push(key);
        if (importsFamily.test(text)) importers.push(key);
      }
    };
    for (const root of ["src", "packages", "scripts", "examples", "docs"]) {
      if (existsSync(join(repoRoot, root))) walk(join(repoRoot, root));
    }

    // The importer leg is the one that matters: a frozen record (or a released 0.12 doc showing the old
    // import path) may quote the specifier, but nothing live may import it.
    assert.deepEqual(
      importers.filter((path) => !allowed(path)),
      [],
      `no live file may import the retired family: ${importers.join(", ")}`,
    );
    assert.deepEqual(
      mentions.filter((path) => !allowed(path)),
      [],
      `only frozen records and explicit negative guards may name the retired ${FAMILY} family`,
    );
    // Positive controls: the workspace is really gone and the scan really looked.
    assert.equal(existsSync(join(repoRoot, "packages", "memory", "package.json")), false, "the family manifest must stay deleted");
    assert.equal(existsSync(join(repoRoot, "packages", "memory", "src")), false, "the family source tree must stay deleted");
    assert.ok(mentions.length > 0, "the scan must find the frozen-record mentions it allows");
  });
});
