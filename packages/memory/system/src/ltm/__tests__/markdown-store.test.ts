/**
 * Plan 188.1 Task 5: the markdown store is the default when `tools.root` is set.
 *
 * These exercise the package wiring (store selection, the notes tree, `memory:reindex`, in-place
 * correction, restart durability), not the store internals — those live in
 * `@arnilo/prism-memory-core`'s `fabric/__tests__/markdown.test.ts`.
 */
import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgent, type JsonObject, type ProviderEvent, type ProviderRequest } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";

import memorySystem, { type MemoryFabricConfig } from "../../index.js";
import { projectResourceId, resolveProjectIdentity } from "../scope/identity.js";

/** The default project resource: the test process cwd is inside the repo, so identity is stable. */
const PROJECT_RESOURCE = projectResourceId(resolveProjectIdentity(process.cwd()));
const PROJECT_FACTS = join("notes", "prism", ...PROJECT_RESOURCE.split("/"), "facts");

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-markdown-store-"));
  dirs.push(dir);
  return dir;
}

async function harness(options: { config: MemoryFabricConfig; script: readonly (readonly ProviderEvent[])[] }) {
  const requests: ProviderRequest[] = [];
  const provider = mockProvider(options.script, { onRequest: (request) => requests.push(request) });
  const agent = await createAgent({
    model: { provider: "mock", model: "main" },
    packages: [provider, memorySystem({ ltm: options.config })],
  });
  return { agent, requests };
}

describe("fabric markdown store (plan 188.1 Task 5)", () => {
  it("fabric_defaults_to_markdown_with_root", async () => {
    const root = await tempRoot();
    const { agent } = await harness({ config: { tools: { root } }, script: [[providerTextDelta("ok"), providerDone()]] });
    try {
      const session = await agent.session({ id: "layout", create: true });
      await session.run("hello");
      await session.close();
    } finally {
      await agent.dispose();
    }
    assert.ok(existsSync(join(root, "notes", ".index.sqlite")), "the derived index is under notes/");
    assert.ok(existsSync(join(root, "notes", "index.md")), "the OKF root index is regenerated");
    assert.equal(existsSync(join(root, ".prism-memory.sqlite")), false, "no hidden SQLite store at the root");
  });

  it("markdown_dir_outside_root_fails_config", async () => {
    const root = await tempRoot();
    const script = [[providerTextDelta("ok"), providerDone()]] as const;
    await assert.rejects(harness({ config: { store: "markdown" }, script }), /requires tools.root/);
    for (const dir of ["../outside", join(await tempRoot(), "outside")]) {
      await assert.rejects(
        harness({ config: { tools: { root }, store: { markdown: { dir } } }, script }),
        /inside tools.root/,
      );
    }
  });

  it("fabric_notes_dir_excluded_from_file_reconcile", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "keep.md"), "keep me");
    await mkdir(join(root, "notes", "decoy"), { recursive: true });
    await writeFile(join(root, "notes", "decoy", "stray.md"), "not a fabric note");
    const { agent } = await harness({ config: { tools: { root } }, script: [[providerTextDelta("ok"), providerDone()]] });
    const session = await agent.session({ id: "reconcile-notes", create: true });
    await session.run("hello");
    await session.close();
    await agent.dispose();
    const { createMarkdownMemoryStores } = await import("@arnilo/prism-memory-core/fabric");
    const stores = await createMarkdownMemoryStores({ root: join(root, "notes") });
    try {
      const records = await stores.vectorStore.getByThread({ tenantId: "prism", resourceId: PROJECT_RESOURCE, threadId: "default" });
      const paths = records
        .map((record) => (record.metadata?.fabric as { path?: string } | undefined)?.path)
        .filter((path): path is string => typeof path === "string");
      assert.ok(paths.includes("keep.md"), "the root file is mirrored as a file note");
      assert.ok(!paths.some((path) => path.startsWith("notes/")), "the notes tree is never mirrored as file notes");
    } finally {
      await stores.close();
    }
  });

  it("memory_reindex_command_reports_counts", async () => {
    const root = await tempRoot();
    await mkdir(join(root, "notes", "prism", "fabric", "facts"), { recursive: true });
    await writeFile(join(root, "notes", "prism", "fabric", "facts", "bad--aaaa00001111.md"), "not an OKF note\n");
    const { agent } = await harness({ config: { tools: { root } }, script: [[providerTextDelta("ok"), providerDone()]] });
    const session = await agent.session({ id: "reindex", create: true });
    await session.run("hello");
    const result = (await agent.commands.run("memory:reindex", { full: true } as JsonObject, { session })) as {
      ok: boolean;
      indexed: number;
      removed: number;
      malformed: number;
      text: string;
    };
    assert.equal(result.ok, true);
    assert.equal(result.malformed, 1, "a full pass re-reads the malformed note file");
    assert.equal(typeof result.indexed, "number");
    assert.match(result.text, /Reindexed \d+ note\(s\), removed \d+, \d+ malformed/);
    await session.close();
    await agent.dispose();
  });

  it("memory_replace_rewrites_note_file", async () => {
    const root = await tempRoot();
    const { providerPackage } = await import("@arnilo/prism/provider-kit");
    let turn = 0;
    const agent = await createAgent({
      model: "fixture/main",
      packages: [
        providerPackage("fixture-provider", [
          {
            id: "fixture",
            async *generate(request) {
              turn++;
              if (turn === 1) {
                yield providerToolCall(toolCallContent("i", "memory.insert", { kind: "fact", text: "canary rollout protects deploys" }));
              } else if (turn === 3) {
                const id = /"id":"([a-f0-9]{12})"/.exec(JSON.stringify(request.messages))?.[1];
                assert.ok(id, "the inserted note id is in the transcript");
                yield providerToolCall(toolCallContent("r", "memory.replace", { id, old: "canary", new: "blue" }));
              } else {
                yield providerTextDelta("ok");
              }
              yield providerDone();
            },
          },
        ]),
        memorySystem({ ltm: { tools: { root }, consolidate: false } }),
      ],
    });
    try {
      const session = await agent.session({ create: true });
      await session.run("remember");
      await session.run("fix");
      await session.close();
    } finally {
      await agent.dispose();
    }
    const facts = readdirSync(join(root, PROJECT_FACTS));
    assert.equal(facts.length, 1, "a corrected note stays in facts/ instead of moving to archive/");
    const content = readFileSync(join(root, PROJECT_FACTS, facts[0]!), "utf8");
    assert.match(content, /blue rollout protects deploys/);
    assert.doesNotMatch(content, /canary/);
  });

  it("fabric_reopen_after_restart_recalls_markdown_notes", async () => {
    const root = await tempRoot();
    const config = { tools: { root }, consolidate: false };
    const first = await harness({
      config,
      script: [
        [
          providerToolCall(toolCallContent("i", "memory.insert", { kind: "fact", text: "canary rollout protects deploys" })),
          providerDone(),
        ],
        [providerTextDelta("stored"), providerDone()],
      ],
    });
    const session = await first.agent.session({ id: "one", create: true });
    await session.run("remember");
    await session.close();
    await first.agent.dispose();
    assert.equal(readdirSync(join(root, PROJECT_FACTS)).length, 1, "the fact is a file on disk");
    const next = await harness({
      config,
      script: [
        [providerToolCall(toolCallContent("r", "memory.recall", { query: "canary rollout" })), providerDone()],
        [providerTextDelta("done"), providerDone()],
      ],
    });
    const reopened = await next.agent.session({ id: "two", create: true });
    await reopened.run("recall");
    assert.match(JSON.stringify(next.requests.at(-1)?.messages ?? []), /canary rollout protects deploys/);
    await reopened.close();
    await next.agent.dispose();
  });
});
