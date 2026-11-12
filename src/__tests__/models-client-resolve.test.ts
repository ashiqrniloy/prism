import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, definePackage, type ModelConfig, type ModelProvider, providerDone, providerTextDelta } from "../index.js";
import type { ModelClient } from "../packages/api.js";
import { providerPackage } from "../provider-kit/index.js";

/**
 * Plan 217 Task 6.1: `models.client("<provider>/<model>")` built a bare `{ provider, model }`, so a memory worker's
 * thinking level and any provider mapping that reads `request.model.compat` saw nothing. The client now resolves the
 * model against its provider's own description.
 */
const DESCRIBED: ModelConfig = {
  provider: "described",
  model: "thinker",
  limits: { contextWindow: 128_000, maxOutputTokens: 8_192 },
  capabilities: { thinkingLevels: ["none", "low", "high"] },
  compat: { thinkingFamily: "reasoning_effort", thinkingValues: [false, "low", "high"] },
};

function describedProvider(state: { listed: number; seen: ModelConfig[] }, catalog: () => Promise<readonly ModelConfig[]>): ModelProvider {
  return {
    id: "described",
    async models() {
      state.listed += 1;
      return catalog();
    },
    async *generate(request) {
      state.seen.push(request.model);
      yield providerTextDelta("ok");
      yield providerDone();
    },
  };
}

async function clientsFor(
  refs: readonly (string | undefined)[],
  catalog: () => Promise<readonly ModelConfig[]> = async () => [DESCRIBED],
  model: unknown = "described/thinker",
) {
  const state = { listed: 0, seen: [] as ModelConfig[] };
  const clients: ModelClient[] = [];
  const user = definePackage<any>({
    name: "@acme/side",
    version: "1.0.0",
    requires: { api: 1 },
    capabilities: ["models"],
    setup: ({ models }: any) => {
      for (const ref of refs) clients.push(models.client(ref));
    },
  });
  const agent = await createAgent({ model: model as never, packages: [user, providerPackage("p", [describedProvider(state, catalog)])] });
  return { agent, clients, state };
}

const drain = async (client: ModelClient) => {
  for await (const _event of client.generate({ messages: [] }));
};

describe("models.client resolves the provider's model description (plan 217 Task 6.1)", () => {
  it("models_client_resolves_the_provider_description_for_a_string_ref", async () => {
    const { agent, clients, state } = await clientsFor(["described/thinker"], undefined, { provider: "described", model: "other" });
    const [client] = clients;
    assert.deepEqual(client!.model, { provider: "described", model: "thinker" }, "the ref as given");
    const resolved = await client!.resolve!();
    assert.deepEqual(resolved.compat, DESCRIBED.compat);
    assert.deepEqual(resolved.limits, DESCRIBED.limits);
    await drain(client!);
    assert.deepEqual(state.seen.at(-1)?.compat, DESCRIBED.compat, "the provider receives the described model");
    await agent.dispose();
  });

  it("models_client_uses_the_configured_model_object_for_its_own_ref", async () => {
    const configured = { ...DESCRIBED, compat: { thinkingFamily: "reasoning_effort", thinkingValues: [false, true] } };
    const { agent, clients } = await clientsFor(["described/thinker", undefined], async () => [], configured);
    for (const client of clients) assert.deepEqual(client.model.compat, configured.compat, "complete without a catalog read");
    // A ref field wins over the configured object.
    await agent.dispose();
    const own = await clientsFor(
      [{ provider: "described", model: "thinker", limits: { contextWindow: 1_000 } } as never],
      async () => [],
      configured,
    );
    assert.equal(own.clients[0]!.model.limits?.contextWindow, 1_000);
    assert.deepEqual(own.clients[0]!.model.compat, configured.compat);
    await own.agent.dispose();
  });

  it("models_client_falls_back_to_the_ref_when_the_catalog_fails", async () => {
    const { agent, clients, state } = await clientsFor(
      ["described/thinker", "described/unknown"],
      async () => {
        throw new Error("catalog down");
      },
      { provider: "described", model: "other" },
    );
    assert.deepEqual(await clients[0]!.resolve!(), { provider: "described", model: "thinker" });
    await drain(clients[1]!);
    assert.deepEqual(state.seen.at(-1), { provider: "described", model: "unknown" }, "a failed catalog never fails the call");
    await agent.dispose();
  });

  it("models_client_reads_a_provider_catalog_once", async () => {
    const { agent, clients, state } = await clientsFor(["described/thinker", "described/thinker", "described/other"], undefined, {
      provider: "described",
      model: "x",
    });
    await Promise.all(clients.map((client) => client.resolve!()));
    for (const client of clients) await drain(client);
    assert.equal(state.listed, 1);
    await agent.dispose();
  });
});
