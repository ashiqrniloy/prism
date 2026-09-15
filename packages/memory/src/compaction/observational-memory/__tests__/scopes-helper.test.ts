import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgent, createMemorySessionStore, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createWorkScopeController, foldWorkScopeMap, SESSION_WORK_SCOPE_ID, withWorkScope } from "../index.js";

const model = { provider: "mock", model: "demo" };

async function setup() {
  const store = createMemorySessionStore();
  const agent = createAgent({ model, provider: createMockProvider([providerTextDelta("ok"), providerDone()]), store });
  const session = agent.createSession({ id: "scopes-helper" });
  await session.run("hello");
  return { session, controller: createWorkScopeController({ session, appendEntry: (entry) => store.append(entry) }) };
}

describe("observational memory work-scope helper", () => {
  it("withWorkScope_leaves_on_throw", async () => {
    const { session, controller } = await setup();
    await assert.rejects(
      withWorkScope(controller, { id: "task:1" }, async () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(await controller.leaf(), SESSION_WORK_SCOPE_ID);
    assert.equal(foldWorkScopeMap(await session.entries()).scopes.get("task:1")?.status, "open");
  });

  it("withWorkScope_does_not_close", async () => {
    const { session, controller } = await setup();
    await controller.open({ id: "task:1" });
    await withWorkScope(controller, { id: "task:1" }, async () => assert.equal(await controller.leaf(), "task:1"));

    const map = foldWorkScopeMap(await session.entries());
    assert.equal(map.scopes.get("task:1")?.status, "open");
    assert.equal(map.stack.at(-1), SESSION_WORK_SCOPE_ID);
  });
});
