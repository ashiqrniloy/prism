/**
 * Plan 216 Task 3: the ontology left memory for the wiki. The fabric (LTM) holds no `concept` kind and no ontology
 * code, and offers a consumer outside memory one read-only port, `memory.ltm`.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent, definePackage } from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createMemory, createMemoryFabric, createMemoryLtmPort, MEMORY_LTM_SERVICE, type MemoryLtmPort, memoryFabric } from "../index.js";
import { DEFAULT_RECALL_KINDS, MEMORY_NOTE_KINDS, unreadableNoteReason } from "../types.js";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const READ_MEMBERS = ["activity", "deletions", "epoch", "read", "scanMetadata", "scopeId", "scopes"];

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (path.endsWith(".ts")) yield path;
  }
}

describe("LTM after the ontology moved to the wiki", () => {
  it("ltm_has_no_concept_kind_or_ontology_code", () => {
    assert.equal((MEMORY_NOTE_KINDS as readonly string[]).includes("concept"), false);
    assert.equal((DEFAULT_RECALL_KINDS as readonly string[]).includes("concept"), false);
    assert.equal(existsSync(join(SRC, "ontology")), false, "src/ontology is gone");
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      // The one named migration line: a stored concept reads as `retired-concept`.
      const text = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !line.includes("retired-concept"))
        .join("\n");
      for (const name of [
        'kind === "concept"',
        'kind: "concept"',
        "FabricOntologyPort",
        "MEMORY_FABRIC_SERVICE",
        '"memory.fabric"',
        "concept-deletion",
      ]) {
        if (text.includes(name)) offenders.push(`${file.slice(SRC.length)}: ${name}`);
      }
    }
    assert.deepEqual(offenders, []);
    // A concept note an older version stored is unreadable here, with a named reason.
    assert.equal(unreadableNoteReason({ fabric: { v: 1, kind: "concept", subject: "payments" } }), "retired-concept");
  });

  it("ltm_port_is_read_only", async () => {
    const vectorStore = createMemoryVectorStore();
    const memory = createMemory({
      tenantId: "t",
      resourceId: "r",
      threadId: "th",
      embedder: createHashEmbedder({ dimensions: 8 }),
      vectorStore,
    });
    const port = createMemoryLtmPort({ scopes: () => [{ level: "project", memory, store: vectorStore }] });
    assert.deepEqual(Object.keys(port).sort(), READ_MEMBERS, "a write member would fail this");
    const fabric = createMemoryFabric({ memory, vectorStore, consolidate: false });
    const note = await fabric.remember({ kind: "fact", content: "the deploy runs on tuesdays", keywords: ["deploy"] });
    const [view] = await port.read("project", [note.id]);
    assert.equal(view?.text, "the deploy runs on tuesdays");
    assert.equal(view?.status, "verified");
    const page = await port.scanMetadata("project");
    assert.deepEqual(
      page.notes.map((entry) => entry.id),
      [note.id],
    );
    assert.equal("text" in page.notes[0]!, false, "a metadata page carries no text");
    await assert.rejects(
      port.read(
        "project",
        Array.from({ length: 33 }, () => note.id),
      ),
      /at most 32 ids/,
    );
    await assert.rejects(port.read("user", [note.id]), /not readable here/);

    // The package provides it as `memory.ltm` with indexed notes on, and `memory.fabric` no longer exists.
    let provided: MemoryLtmPort | undefined;
    let retired: unknown = "unset";
    const probe = definePackage({
      name: "@test/ltm-probe",
      version: "0.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.hooks.on("session.opened", () => {
          provided = prism.services.consume<MemoryLtmPort>(MEMORY_LTM_SERVICE);
          retired = prism.services.consume("memory.fabric");
        });
      },
    })();
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [memoryFabric({}), probe] });
    try {
      await agent.session({ id: "s1", create: true });
      assert.ok(provided);
      assert.deepEqual(Object.keys(provided!).sort(), READ_MEMBERS);
      assert.equal(retired, undefined);
    } finally {
      await agent.dispose();
    }
  });

  it("the_recall_tool_names_no_concept_kind", async () => {
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [memoryFabric({})] });
    try {
      const recall = agent.inspect().tools.find((tool) => tool.name === "memory.recall");
      assert.ok(recall);
      assert.equal(JSON.stringify(recall).includes('"concept"'), false);
    } finally {
      await agent.dispose();
    }
  });
});
