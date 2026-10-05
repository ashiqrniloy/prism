import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  createAgent,
  createMemorySessionStore,
  createMemoryToolEffectStore,
  providerDone,
  providerTextDelta,
  toolCallContent,
  type Principal,
  definePackage,
} from "../index.js";
import { deriveToolEffectKey, toolEffectArgumentsHash } from "../tool-effects.js";
import { providerPackage } from "../provider-kit/index.js";

async function probe(agentPrincipal?: Principal, runPrincipal?: Principal) {
  const seen: unknown[] = [];
  const events: unknown[] = [];
  const store = createMemorySessionStore();
  let turns = 0;
  const agent = await createAgent({
    model: { provider: "mock", model: "test" },
    principal: agentPrincipal,
    slots: { store },
    hooks(hooks) {
      hooks.on("tool.call", (_payload, context) => {
        seen.push(context.session?.principal);
      });
      hooks.on("package.event", (event) => {
        events.push(event);
      });
    },
    packages: [definePackage({
        name: "probe",
        version: "1.0.0",
        setup(api) {
          api.tools.register({
            name: "probe",
            execute(_args, context) {
              seen.push(context.principal, context.session?.principal);
              return { toolCallId: context.toolCallId, name: "probe" };
            },
          });
        },
      })(), providerPackage("test-provider", [{
      id: "mock",
      async *generate() {
        if (turns++ === 0) yield { type: "tool_call" as const, call: toolCallContent("call", "probe", {}) };
        else yield providerTextDelta("done");
        yield providerDone();
      },
    }])],
  });
  const session = await agent.session();
  await session.run("go", { principal: runPrincipal });
  await session.close();
  await agent.dispose();
  return { seen, serialized: JSON.stringify([events, await store.list(session.id)]) };
}

test("no_kernel_path_synthesizes_an_identity", async () => {
  const { seen, serialized } = await probe();
  assert.deepEqual(seen, [undefined, undefined, undefined]);
  assert.equal(/local-operator|prism\.identity|\"identity\"|\"principal\"/.test(serialized), false);
});

test("principal_passes_through_unchanged_and_run_overrides_agent", async () => {
  // Extra fields and invalid governance dates are opaque to the kernel.
  const principal = { kind: "user", id: "host", expiresAt: "invalid" } as Principal;
  assert.ok((await probe(principal)).seen.every((value) => value === principal));
  const override: Principal = { kind: "service", id: "run" };
  assert.ok((await probe(principal, override)).seen.every((value) => value === override));
});

test("cached_session_context_tracks_each_run_principal_without_persisting_it", async () => {
  const principal: Principal = { kind: "user", id: "default" };
  const override: Principal = { kind: "user", id: "override" };
  const seen: unknown[] = [];
  const agent = await createAgent({
    model: { provider: "mock", model: "test" },
    principal,
    packages: [providerPackage("test-provider", [{
      id: "mock",
      async *generate() {
        yield providerTextDelta("ok");
        yield providerDone();
      },
    }])],
    hooks(hooks) {
      hooks.on("run.input", (input, ctx) => {
        seen.push(ctx.session?.principal);
        return input;
      });
    },
  });
  const session = await agent.session();
  await session.run("one", { principal: override });
  await session.run("two");
  assert.deepEqual(seen, [override, principal]);
  await session.close();
  await agent.dispose();
});

test("tool_effect_claims_stay_scoped_by_tenant_after_identity_is_removed", async () => {
  const store = createMemoryToolEffectStore();
  const base = {
    ownership: { tenantId: "one" },
    sessionId: "s",
    runId: "r",
    toolCallId: "c",
    toolName: "probe",
    argumentsHash: toolEffectArgumentsHash({}),
  };
  const key = { ...base, key: deriveToolEffectKey(base) };
  await store.begin(key);
  const other = { ...key, ownership: { tenantId: "two" } };
  assert.equal(await store.get(other), undefined);
  assert.equal((await store.begin(other)).outcome, "acquired");
  assert.notEqual(deriveToolEffectKey(other), key.key);
  for (const ownership of [
    { tenantId: "one", accountId: "other" },
    { tenantId: "one", userId: "other" },
  ]) {
    assert.equal(await store.get({ ...key, ownership }), undefined);
    assert.notEqual(deriveToolEffectKey({ ...base, ownership }), key.key);
  }
  assert.throws(() => deriveToolEffectKey({ ...base, ownership: { tenantId: "" } }), /ownership/);
});
