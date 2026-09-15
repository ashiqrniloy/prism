import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  createSessionEntry,
  providerDone,
  providerTextDelta,
  type SessionEntry,
} from "@arnilo/prism";
import {
  createWorkScopeController,
  foldObservationalMemoryLedger,
  foldWorkScopeMap,
  isWorkBindRef,
  isWorkScopeId,
  MAX_WORK_SCOPE_BINDS,
  MAX_WORK_SCOPES,
  OBSERVATIONS_RECORDED,
  REFLECTIONS_RECORDED,
  SESSION_WORK_SCOPE_ID,
  WORK_SCOPE_BOUND,
  WORK_SCOPE_OPENED,
  type MemoryObservation,
  type MemoryReflection,
} from "../index.js";

const model = { provider: "mock", model: "demo" };
const observation: MemoryObservation = {
  id: "aaaaaaaaaaaa",
  content: "Keep work scopes append-only.",
  timestamp: "2026-09-15T00:00:00.000Z",
  relevance: "high",
  sourceEntryIds: ["source"],
  tokenCount: 5,
};
const reflection: MemoryReflection = {
  id: "bbbbbbbbbbbb",
  content: "Work scopes are a separate index.",
  supportingObservationIds: [observation.id],
  tokenCount: 6,
};

async function setup() {
  const store = createMemorySessionStore();
  const agent = createAgent({ model, provider: createMockProvider([providerTextDelta("ok"), providerDone()]), store });
  const session = agent.createSession({ id: "scopes" });
  await session.run("hello");
  return { session, store, controller: createWorkScopeController({ session, appendEntry: (entry) => store.append(entry) }) };
}

async function appendData(
  session: { readonly id: string; readonly leafId?: string; checkout: (id: string) => Promise<void> },
  store: { append: (entry: SessionEntry) => Promise<void> },
  data: unknown,
): Promise<void> {
  const parentId = session.leafId;
  if (!parentId) throw new Error("session has no leaf");
  const entry = createSessionEntry({ sessionId: session.id, parentId, kind: "custom", data });
  await store.append(entry);
  await session.checkout(entry.id);
}

function entry(id: string, data: unknown): SessionEntry {
  return { id, sessionId: "scopes", timestamp: "2026-09-15T00:00:00.000Z", kind: "custom", data };
}

describe("observational memory work scopes", () => {
  it("fold_empty_is_session_root_only", () => {
    const map = foldWorkScopeMap([]);
    assert.deepEqual([...map.scopes.values()], [{ id: SESSION_WORK_SCOPE_ID, status: "open" }]);
    assert.deepEqual([...map.binds], []);
    assert.deepEqual(map.stack, [SESSION_WORK_SCOPE_ID]);
  });

  it("open_enter_leave_close_roundtrip", async () => {
    const { session, store } = await setup();
    const controller = createWorkScopeController({ session, appendEntry: (entry) => store.append(entry), secrets: ["secret-value"] });
    await controller.open({ id: "phase:1", kind: "phase", label: "secret-value phase" });
    await controller.open({ id: "task:1", parentId: "phase:1", kind: "task" });
    await controller.enter("phase:1");
    await controller.enter("task:1");
    assert.equal(await controller.leaf(), "task:1");
    await controller.leave();
    assert.equal(await controller.leaf(), "phase:1");
    await controller.enter("task:1");
    await controller.close("phase:1");

    const map = foldWorkScopeMap(await session.entries());
    assert.equal(map.scopes.get("phase:1")?.status, "closed");
    assert.equal(map.scopes.get("task:1")?.status, "open");
    assert.deepEqual(map.stack, [SESSION_WORK_SCOPE_ID]);
    assert.doesNotMatch(JSON.stringify(await session.entries()), /secret-value/);
  });

  it("open_rejects_missing_parent_duplicate_reserved_id_bad_charset_dotdot", async () => {
    const { controller } = await setup();
    assert.equal(isWorkScopeId("phase:1"), true);
    assert.equal(isWorkScopeId("phase..1"), false);
    assert.equal(isWorkScopeId("phase 1"), false);
    await assert.rejects(controller.open({ id: "task:missing", parentId: "missing" }), /parent/);
    await controller.open({ id: "phase:1" });
    await assert.rejects(controller.open({ id: "phase:1" }), /already exists/);
    await assert.rejects(controller.open({ id: "session" }), /reserved/);
    await assert.rejects(controller.open({ id: "phase..1" }), /Invalid/);
    await assert.rejects(controller.open({ id: "phase 1" }), /Invalid/);
  });

  it("bind_rejects_unknown_scope_and_unknown_om_id", async () => {
    const { session, store, controller } = await setup();
    await controller.open({ id: "phase:1" });
    await assert.rejects(controller.bind("missing", ["om:aaaaaaaaaaaa"]), /Unknown work scope/);
    await assert.rejects(controller.bind("phase:1", ["om:aaaaaaaaaaaa"]), /existing observational memory ids/);

    await appendData(session, store, { type: OBSERVATIONS_RECORDED, observations: [observation] });
    await appendData(session, store, { type: REFLECTIONS_RECORDED, reflections: [reflection] });
    assert.equal(isWorkBindRef("om:aaaaaaaaaaaa"), true);
    assert.equal(isWorkBindRef("reflection:bbbbbbbbbbbb"), true);
    assert.equal(isWorkBindRef("om:not-an-id"), false);
    await controller.bind("phase:1", ["om:aaaaaaaaaaaa", "reflection:bbbbbbbbbbbb"]);
    assert.deepEqual(foldWorkScopeMap(await session.entries()).binds.get("phase:1"), ["om:aaaaaaaaaaaa", "reflection:bbbbbbbbbbbb"]);
  });

  it("bind_to_closed_scope_allowed_and_unbind_does_not_delete_observation", async () => {
    const { session, store, controller } = await setup();
    await controller.open({ id: "phase:1" });
    await controller.close("phase:1");
    await appendData(session, store, { type: OBSERVATIONS_RECORDED, observations: [observation] });
    await controller.bind("phase:1", ["om:aaaaaaaaaaaa"]);
    await controller.unbind("phase:1", ["om:aaaaaaaaaaaa"]);

    const entries = await session.entries();
    assert.deepEqual(foldWorkScopeMap(entries).binds.get("phase:1"), undefined);
    assert.deepEqual(foldObservationalMemoryLedger(entries).observations, [observation]);
  });

  it("close_pops_closed_id_and_frames_above", async () => {
    const { session, controller } = await setup();
    await controller.open({ id: "phase:1" });
    await controller.open({ id: "plan:1", parentId: "phase:1" });
    await controller.open({ id: "task:1", parentId: "plan:1" });
    await controller.enter("task:1");
    await controller.close("plan:1");
    assert.deepEqual(foldWorkScopeMap(await session.entries()).stack, [SESSION_WORK_SCOPE_ID, "phase:1"]);
  });

  it("caps_max_scopes_depth_stack_binds_fail_closed", async () => {
    const scopeEntries = Array.from({ length: MAX_WORK_SCOPES + 1 }, (_, index) =>
      entry(`open-${index}`, { type: WORK_SCOPE_OPENED, id: `scope:${index}` }),
    );
    assert.equal(foldWorkScopeMap(scopeEntries).scopes.size, MAX_WORK_SCOPES + 1);

    const { session, store, controller } = await setup();
    let parentId = SESSION_WORK_SCOPE_ID;
    for (let index = 1; index <= 8; index += 1) {
      const id = `depth:${index}`;
      await controller.open({ id, parentId });
      parentId = id;
    }
    await controller.enter(parentId);
    assert.equal(await controller.leaf(), "depth:8");
    await assert.rejects(controller.open({ id: "depth:9", parentId }), /depth limit/);
    await assert.rejects(controller.open({ id: "too-long", label: "x".repeat(513) }), /at most 512/);

    await controller.open({ id: "binds" });
    const refs = Array.from({ length: MAX_WORK_SCOPE_BINDS }, (_, index) => `om:${index.toString(16).padStart(12, "0")}`);
    await appendData(session, store, { type: WORK_SCOPE_BOUND, scopeId: "binds", refs });
    await appendData(session, store, { type: OBSERVATIONS_RECORDED, observations: [observation] });
    await assert.rejects(controller.bind("binds", ["om:aaaaaaaaaaaa"]), /bind limit/);
  });

  it("append_wrong_session_throws", async () => {
    const { session, store } = await setup();
    const otherStore = createMemorySessionStore();
    const controller = createWorkScopeController({ session, appendEntry: (entry) => otherStore.append(entry) });
    const before = session.leafId;
    await assert.rejects(controller.open({ id: "phase:1" }), /did not append to the owning session branch/);
    assert.equal(session.leafId, before);
    assert.equal(
      (await store.list(session.id)).some((item) => item.kind === "custom"),
      false,
    );
    assert.equal(
      (await otherStore.list(session.id)).some((item) => item.kind === "custom"),
      true,
    );
  });
});
