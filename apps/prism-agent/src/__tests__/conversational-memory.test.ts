import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockProvider, providerDone } from "@arnilo/prism/testing";
import { createCodingWorker } from "../host/coding.js";
import type { HostConfig } from "../host/config.js";
import { loadHostConfig } from "../host/config.js";
import { createOrchestrator } from "../host/orchestrator.js";
import { createResearchWorker } from "../host/research.js";
import { conversationalMemory, MEMORY_FACT } from "../scenarios/conversational-memory.js";
import { ontologyMemory } from "../scenarios/ontology-memory.js";

const MODEL = { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };

function config(root: string): HostConfig {
  return {
    models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
    storePath: join(root, "sessions.db"),
    workspace: join(root, "workspace"),
    approval: "ask",
    web: { backend: "obscura" },
  };
}

test("conversational_memory_scenario_recalls_across_sessions_and_forgets", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-memory-"));
  mkdirSync(join(root, "workspace"));
  try {
    const result = await conversationalMemory(config(root));
    assert.match(result.recalled, new RegExp(MEMORY_FACT), "session B's recall must return the archived exchange");
    assert.equal(result.forgetFound, true, "memory.forget must delete the exchange note");
    // The abstention line names the searched terms by contract (`no matching memory for: <terms>; scopes: <levels>`),
    // so the query term appears in it. What must be absent is the forgotten note: no hit, none of its text.
    assert.match(result.afterForget, new RegExp(`^no matching memory for: ${MEMORY_FACT}; scopes: `), "the fourth session abstains");
    assert.doesNotMatch(result.afterForget, /favourite colour is/, "the forgotten exchange's text is not recalled");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const EXPERIMENTAL = [
  "@arnilo/prism-memory-core",
  "@arnilo/prism-memory-observational",
  "@arnilo/prism-memory-fabric",
  "@arnilo/prism-memory-wiki",
  "@arnilo/prism-memory-rag",
];

test("reference_host_default_loads_no_experimental_package", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-memory-default-"));
  mkdirSync(join(root, "workspace"));
  try {
    const provider = mockProvider([[providerDone()]]);
    const cfg = config(root);
    const coding = await createCodingWorker(cfg, { packages: [provider] });
    const research = await createResearchWorker(cfg, { packages: [provider] });
    const orchestrator = await createOrchestrator(cfg, { packages: [provider] });
    try {
      for (const agent of [coding, research, orchestrator]) {
        const names = agent.inspect().packages.map((entry) => entry.name);
        assert.deepEqual(
          names.filter((name) => EXPERIMENTAL.includes(name)),
          [],
          "a default agent loads no experimental package",
        );
      }
      const compaction = research.inspect().packages.find((entry) => entry.name === "@arnilo/prism-memory-compaction");
      assert.ok(compaction, "memory-compaction owns compaction on the default path");
    } finally {
      await Promise.all([coding.dispose(), research.dispose(), orchestrator.dispose()]);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reference_host_memory_opt_in_loads_om_and_fabric", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-memory-optin-"));
  mkdirSync(join(root, "workspace"));
  try {
    const provider = mockProvider([[providerDone()]]);
    const coding = await createCodingWorker({ ...config(root), memory: "coding" }, { packages: [provider] });
    const research = await createResearchWorker({ ...config(root), memory: "conversational" }, { packages: [provider] });
    try {
      for (const agent of [coding, research]) {
        const names = agent.inspect().packages.map((entry) => entry.name);
        assert.equal(names.includes("@arnilo/prism-memory-fabric"), true);
        assert.equal(names.includes("@arnilo/prism-memory-observational"), true);
        assert.equal(names.includes("@arnilo/prism-memory-compaction"), true, "compaction stays on the compaction slot");
      }
      assert.equal(
        research.inspect().packages.some((entry) => entry.name === "@arnilo/prism-memory-rag"),
        false,
        "rag needs embeddings",
      );
    } finally {
      await coding.dispose();
      await research.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("research_worker_loads_memory_rag_only_with_embeddings", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-memory-rag-"));
  mkdirSync(join(root, "workspace"));
  try {
    const provider = mockProvider([[providerDone()]]);
    const research = await createResearchWorker({ ...config(root), embeddings: { model: "mock/embed" } }, { packages: [provider] });
    try {
      const names = research.inspect().packages.map((entry) => entry.name);
      assert.equal(names.includes("@arnilo/prism-memory-rag"), true);
      assert.equal(names.includes("@arnilo/prism-memory-fabric"), false);
    } finally {
      await research.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("memory_option_rejects_unknown_value", () => {
  const root = mkdtempSync(join(tmpdir(), "pa-memory-config-"));
  const path = join(root, "prism-agent.json");
  try {
    writeFileSync(
      path,
      JSON.stringify({
        models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
        storePath: join(root, "sessions.db"),
        workspace: join(root, "workspace"),
        approval: "ask",
        web: { backend: "obscura" },
        memory: "unknown",
      }),
    );
    assert.throws(() => loadHostConfig(path), /memory must be conversational or coding/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("memory_option_accepts_coding", () => {
  const root = mkdtempSync(join(tmpdir(), "pa-memory-config-"));
  const path = join(root, "prism-agent.json");
  try {
    writeFileSync(
      path,
      JSON.stringify({
        models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
        storePath: join(root, "sessions.db"),
        workspace: join(root, "workspace"),
        approval: "ask",
        web: { backend: "obscura" },
        memory: "coding",
      }),
    );
    assert.equal(loadHostConfig(path).memory, "coding");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reference_host_ontology_option_recalls_concept_across_sessions", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-ontology-"));
  mkdirSync(join(root, "workspace"));
  try {
    const result = await ontologyMemory(config(root));
    assert.equal(result.concepts, 1, "the pass writes one concept on the config-selected model");
    assert.equal(result.claims.length, 3);
    const first = result.recalled.split("\n").find((line) => /^\[?[0-9a-f]{12}\]? /.test(line)) ?? "";
    assert.match(first, /concept payments/, "memory.recall returns the concept before the notes it cites");
    assert.equal(result.claimsAfterForget.length, 2, "forgetting a cited note removes its claim");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reference_host_ontology_off_by_default", async () => {
  const root = mkdtempSync(join(tmpdir(), "pa-ontology-default-"));
  mkdirSync(join(root, "workspace"));
  try {
    const provider = mockProvider([[providerDone()]]);
    const names = async (cfg: HostConfig) => {
      const coding = await createCodingWorker(cfg, { packages: [provider] });
      const research = await createResearchWorker(cfg, { packages: [provider] });
      try {
        return [coding, research].map((agent) => agent.inspect().packages.map((entry) => entry.name));
      } finally {
        await coding.dispose();
        await research.dispose();
      }
    };
    for (const list of await names({ ...config(root), memory: "coding" })) {
      assert.equal(list.includes("@arnilo/prism-memory-fabric"), true);
      assert.equal(list.includes("@arnilo/prism-memory-wiki"), false, "memory alone never adds the ontology tier");
    }
    for (const list of await names({ ...config(root), memory: "coding", ontology: true })) {
      assert.equal(list.includes("@arnilo/prism-memory-wiki"), true, "ontology: true adds the wiki beside the fabric");
    }
    await assert.rejects(() => createCodingWorker({ ...config(root), ontology: true }, { packages: [provider] }), /needs memory/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ontology_option_is_validated_in_the_config_file", () => {
  const root = mkdtempSync(join(tmpdir(), "pa-ontology-config-"));
  const path = join(root, "prism-agent.json");
  const base = {
    models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
    storePath: join(root, "sessions.db"),
    workspace: join(root, "workspace"),
    approval: "ask",
    web: { backend: "obscura" },
  };
  const load = (extra: object) => {
    writeFileSync(path, JSON.stringify({ ...base, ...extra }));
    return loadHostConfig(path);
  };
  try {
    assert.equal(load({ memory: "coding", ontology: true, ontologyModel: "openai/gpt-5-mini" }).ontology, true);
    assert.equal(load({ memory: "coding" }).ontology, undefined);
    assert.throws(() => load({ ontology: true }), /ontology needs memory/);
    assert.throws(() => load({ memory: "coding", ontology: "yes" }), /ontology must be a boolean/);
    assert.throws(() => load({ memory: "coding", ontologyModel: "openai/gpt-5-mini" }), /ontologyModel needs ontology/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
