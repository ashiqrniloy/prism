import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, createMemorySessionStore, type ProviderRequest, validateJsonSchema } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta } from "@arnilo/prism/testing";
import { MemoryValidationError } from "@arnilo/prism-memory-core";
import { CONVERSATIONAL_PRESET_REVISION, memoryFabricConfigSchema, resolveMemoryFabricConfig } from "../config.js";
import memoryFabric from "../index.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-fabric-preset-"));
  dirs.push(dir);
  return dir;
}

/** The 188.10 Task 9 `fabric-x-tools` arm, spelled out field by field (`scripts/memory-bench/ablations.mjs` before 188.11). */
const ACCEPTED_ARM = { exchanges: {}, inject: { query: "task", kinds: ["exchange"] }, semantic: true, promote: false } as const;

/** Resolved config without the preset's own report, which a spelled-out config cannot carry. */
function withoutPreset(config: ReturnType<typeof resolveMemoryFabricConfig>): Record<string, unknown> {
  const { preset: _preset, ...rest } = config;
  return rest;
}

describe("the conversational preset (plan 188.11 Task 3)", () => {
  it("preset_conversational_resolves_to_the_accepted_arm", () => {
    const preset = resolveMemoryFabricConfig({ preset: "conversational" });
    assert.deepEqual(withoutPreset(preset), withoutPreset(resolveMemoryFabricConfig({ ...ACCEPTED_ARM })));
    assert.equal(preset.exchanges.enabled, true);
    assert.deepEqual(preset.inject, { query: "task", kinds: ["exchange"] });
    assert.equal(preset.promote.enabled, false);
    assert.equal(preset.semantic, true);
    assert.deepEqual(preset.preset, { name: "conversational", revision: CONVERSATIONAL_PRESET_REVISION, overridden: [] });
  });

  it("preset_explicit_top_level_field_wins", () => {
    const preset = resolveMemoryFabricConfig({ preset: "conversational", inject: { budgetTokens: 2000 } });
    assert.deepEqual(
      preset.inject,
      { budgetTokens: 2000 },
      "the explicit inject replaces the preset's whole inject; nothing is deep-merged",
    );
    assert.equal(preset.exchanges.enabled, true, "fields the host did not give keep the preset value");
    assert.deepEqual(preset.preset?.overridden, ["inject"]);
  });

  it("preset_unknown_value_fails_closed", async () => {
    assert.equal(validateJsonSchema(memoryFabricConfigSchema, { preset: "coding" }).ok, false);
    assert.equal(validateJsonSchema(memoryFabricConfigSchema, { preset: "conversational" }).ok, true);
    assert.throws(
      () => resolveMemoryFabricConfig({ preset: "coding" as "conversational" }),
      (error: unknown) => error instanceof MemoryValidationError && /preset must be one of conversational/.test(error.message),
    );
    await assert.rejects(
      createAgent({
        model: { provider: "mock", model: "main" },
        packages: [mockProvider([[providerTextDelta("ok"), providerDone()]]), memoryFabric({ preset: "coding" as "conversational" })],
      }),
    );
  });

  it("preset_override_of_storage_class_emits_status_note", async () => {
    const config = resolveMemoryFabricConfig({ preset: "conversational", exchanges: false });
    assert.equal(config.exchanges.enabled, false, "explicit wins, even against the storage class");
    const agent = await createAgent({
      model: { provider: "mock", model: "main" },
      packages: [mockProvider([[providerTextDelta("ok"), providerDone()]]), memoryFabric({ preset: "conversational", exchanges: false })],
    });
    const overrides = agent.inspect().statusNotes.filter((note) => /override preset conversational/.test(note.message));
    assert.equal(overrides.length, 1, "one note");
    assert.match(overrides[0]?.message ?? "", /explicit exchanges override/);
    assert.match(overrides[0]?.message ?? "", /exchange archive is overridden/);
    await agent.dispose();
  });

  it("preset_contract_no_write_path_model_call", async () => {
    const root = await tempRoot();
    const requests: ProviderRequest[] = [];
    const turn = [providerTextDelta("Noted."), providerDone()];
    const agent = await createAgent({
      model: { provider: "mock", model: "main" },
      packages: [
        mockProvider([turn, turn, turn], { onRequest: (request) => requests.push(request) }),
        memoryFabric({ preset: "conversational", tools: { root } }),
      ],
      slots: { store: createMemorySessionStore() },
    });
    const session = await agent.session({ id: "preset-contract", create: true });
    for (const text of ["The launch is on Monday.", "The owner is Priya.", "The budget is small."]) await session.run(text);
    await agent.commands.run("memory:archive", {}, { session });
    await agent.commands.run("memory:consolidate", {}, { session });
    assert.equal(requests.length, 3, "the agent's three turns are the only model calls: no extractor, decider or summariser ran");
    await session.close();
    await agent.dispose();
  });

  it("preset_contract_needs_no_embeddings_service", () => {
    const config = resolveMemoryFabricConfig({ preset: "conversational" });
    assert.equal(config.retrieval, "lexical");
    assert.equal(config.promote.enabled, false);
    assert.equal(config.consolidate, undefined);
  });

  it("memory_status_reports_preset_and_revision", async () => {
    const root = await tempRoot();
    const agent = await createAgent({
      model: { provider: "mock", model: "main" },
      packages: [mockProvider([[providerTextDelta("ok"), providerDone()]]), memoryFabric({ preset: "conversational", tools: { root } })],
      slots: { store: createMemorySessionStore() },
    });
    const session = await agent.session({ id: "preset-status", create: true });
    const status = (await agent.commands.run("memory:status", {}, { session })) as {
      preset?: string;
      presetRevision?: number;
      text: string;
    };
    assert.equal(status.preset, "conversational");
    assert.equal(status.presetRevision, CONVERSATIONAL_PRESET_REVISION);
    assert.match(status.text, /Preset conversational \(revision 1\)/);
    const inspection = agent.inspect();
    assert.equal(inspection.packages.find((entry) => entry.name === "@arnilo/prism-memory-fabric")?.config.preset, "conversational");
    assert.ok(inspection.statusNotes.some((note) => /preset conversational revision 1/.test(note.message)));
    await session.close();
    await agent.dispose();
  });

  it("memory_status_omits_preset_when_none_is_named", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "main" },
      packages: [mockProvider([[providerTextDelta("ok"), providerDone()]]), memoryFabric({})],
      slots: { store: createMemorySessionStore() },
    });
    const session = await agent.session({ id: "no-preset", create: true });
    const status = (await agent.commands.run("memory:status", {}, { session })) as Record<string, unknown>;
    assert.equal("preset" in status, false);
    await session.close();
    await agent.dispose();
  });
});
