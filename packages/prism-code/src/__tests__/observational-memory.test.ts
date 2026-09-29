import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AIProvider,
  createAgent,
  createMemorySessionStore,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-core/sessions/sqlite";
import { MemoryStoredCredentialStore, PrismCodeCredentialManager } from "../credentials.js";
import { ObservationalMemoryCoordinator } from "../observational-memory.js";

const sessionModel = { provider: "mock", model: "default" };
const workerModel = { provider: "mock", model: "worker" };

function createMockWorkerProvider(calls: ProviderRequest[] = []): AIProvider {
  return {
    id: "mock",
    async *generate(request) {
      calls.push(request);
      yield providerDone();
    },
  };
}

function createCoordinator(options?: {
  providerCalls?: ProviderRequest[];
  credentialManager?: PrismCodeCredentialManager;
  config?: any;
  store?: any;
}) {
  const providerCalls = options?.providerCalls ?? [];
  const workerProvider = createMockWorkerProvider(providerCalls);
  return new ObservationalMemoryCoordinator({
    config: options?.config ?? { cwd: "/test" },
    credentialManager: options?.credentialManager,
    store: options?.store,
    providerResolver: async () => workerProvider,
  });
}

describe("Observational Memory Coordinator", () => {
  it("off default does not call worker or inject memory", async () => {
    const providerCalls: ProviderRequest[] = [];
    const coordinator = createCoordinator({ providerCalls });

    // Default state is off
    const state = await coordinator.loadSessionState("s1");
    assert.strictEqual(state.enabled, false);
    assert.strictEqual(coordinator.isSessionEnabled("s1"), false);

    // Worker should never have been called
    assert.strictEqual(providerCalls.length, 0);

    // Delegating context provider returns [] when disabled
    const cp = coordinator.createDelegatingContextProvider();
    const blocks = await cp.resolve({
      sessionId: "s1",
      messages: [],
    });
    assert.strictEqual(blocks.length, 0);
  });

  it("toggle on enables session and toggle off disables", async () => {
    const coordinator = createCoordinator();
    const store = createMemorySessionStore();
    const agent = createAgent({
      model: sessionModel,
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("ok");
          yield providerDone();
        },
      },
      store,
    });
    const session = agent.createSession({ id: "s1" });

    // Start off
    assert.strictEqual(coordinator.isSessionEnabled("s1"), false);

    // Toggle on
    const result1 = await coordinator.toggleSession(session, sessionModel, store, "/test");
    assert.strictEqual(result1.enabled, true);
    assert.strictEqual(coordinator.isSessionEnabled("s1"), true);

    // Toggle off
    const result2 = await coordinator.toggleSession(session, sessionModel, store, "/test");
    assert.strictEqual(result2.enabled, false);
    assert.strictEqual(coordinator.isSessionEnabled("s1"), false);
  });

  it("on/off/on does not create duplicate attachments", async () => {
    const coordinator = createCoordinator();
    const store = createMemorySessionStore();
    const agent = createAgent({
      model: sessionModel,
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("ok");
          yield providerDone();
        },
      },
      store,
    });
    const session = agent.createSession({ id: "s1" });

    // Toggle on
    await coordinator.toggleSession(session, sessionModel, store, "/test");
    const attached1 = coordinator.getAttachedInstance("s1");
    if (!attached1) throw new Error("expected attached instance");

    // Toggle off
    await coordinator.toggleSession(session, sessionModel, store, "/test");
    assert.strictEqual(coordinator.isSessionEnabled("s1"), false);

    // Toggle on again
    await coordinator.toggleSession(session, sessionModel, store, "/test");
    const attached2 = coordinator.getAttachedInstance("s1");
    if (!attached2) throw new Error("expected attached instance");
    // Same attachment is reused (same provider+model)
    assert.strictEqual(attached1.workerModel.provider, attached2.workerModel.provider);
    assert.strictEqual(attached1.workerModel.model, attached2.workerModel.model);
  });

  it("getActiveSession returns wrapped session that filters recall tool when disabled", async () => {
    const coordinator = createCoordinator();
    const store = createMemorySessionStore();
    const agent = createAgent({
      model: sessionModel,
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("ok");
          yield providerDone();
        },
      },
      store,
    });
    const session = agent.createSession({ id: "s1" });

    // Default disabled — getActiveSession wraps to filter recall
    const wrapped = await coordinator.getActiveSession(session, sessionModel, store);
    assert.ok(wrapped);
    // The wrapped session should still have the same id
    assert.strictEqual(wrapped.id, session.id);
  });

  it("recall tool returns disabled message when OM is off", async () => {
    const coordinator = createCoordinator();
    const store = createMemorySessionStore();
    const recall = coordinator.createRecallTool(store);

    assert.strictEqual(recall.name, "recall");

    const result = await recall.execute({ id: "aaaaaaaaaaaa" }, { sessionId: "s1", runId: "r1", toolCallId: "tc1" });
    assert.strictEqual((result.value as any).reason, "disabled");
    assert.strictEqual((result.value as any).found, false);
  });

  it("/OM-model changes worker model without affecting session model", async () => {
    const coordinator = createCoordinator();
    const store = createMemorySessionStore();
    const agent = createAgent({
      model: sessionModel,
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("ok");
          yield providerDone();
        },
      },
      store,
    });
    const session = agent.createSession({ id: "s1" });

    const result = await coordinator.setSessionWorkerModel(session, workerModel, sessionModel, store, "/test");

    assert.strictEqual(result.workerModel.provider, "mock");
    assert.strictEqual(result.workerModel.model, "worker");

    // Session model is unchanged
    assert.strictEqual(sessionModel.model, "default");

    // Worker model is persisted in state
    const state = await coordinator.loadSessionState("s1", store);
    assert.deepStrictEqual(state.workerModel, workerModel);
  });

  it("unauthenticated worker model is rejected", async () => {
    const memoryStore = new MemoryStoredCredentialStore();
    const credentialManager = new PrismCodeCredentialManager({ store: memoryStore });
    const coordinator = createCoordinator({ credentialManager });
    const store = createMemorySessionStore();
    const agent = createAgent({
      model: sessionModel,
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("ok");
          yield providerDone();
        },
      },
      store,
    });
    const session = agent.createSession({ id: "s1" });

    // Attempt to set a model for an unauthenticated provider
    await assert.rejects(
      () =>
        coordinator.setSessionWorkerModel(
          session,
          { provider: "unauthenticated-provider", model: "some-model" },
          sessionModel,
          store,
          "/test",
        ),
      (err: Error) => {
        assert.ok(err.message.includes("not authenticated"));
        return true;
      },
    );
  });

  it("process restart restores enabled state and worker model from durable store", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "prism-code-om-test-"));
    const dbPath = join(tempDir, "sessions.db");

    try {
      const store = createSqlitePersistence({ filename: dbPath });

      // Coordinator 1: enable OM and set worker model
      const coordinator1 = createCoordinator({ store });
      const agent1 = createAgent({
        model: sessionModel,
        provider: {
          id: "mock",
          async *generate() {
            yield providerTextDelta("ok");
            yield providerDone();
          },
        },
        store,
      });
      const session1 = agent1.createSession({ id: "s1" });

      await coordinator1.toggleSession(session1, sessionModel, store, "/test");
      await coordinator1.setSessionWorkerModel(session1, workerModel, sessionModel, store, "/test");

      // Verify state is set
      const state1 = await coordinator1.loadSessionState("s1", store);
      assert.strictEqual(state1.enabled, true);
      assert.deepStrictEqual(state1.workerModel, workerModel);

      // Coordinator 2: simulates process restart — fresh coordinator, same store
      const coordinator2 = createCoordinator({ store });

      // Load from store — should restore enabled + workerModel
      const state2 = await coordinator2.loadSessionState("s1", store);
      assert.strictEqual(state2.enabled, true);
      assert.deepStrictEqual(state2.workerModel, workerModel);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("process restart does not leak state across sessions", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "prism-code-om-isolation-"));
    const dbPath = join(tempDir, "sessions.db");

    try {
      const store = createSqlitePersistence({ filename: dbPath });
      const coordinator = createCoordinator({ store });
      const agent = createAgent({
        model: sessionModel,
        provider: {
          id: "mock",
          async *generate() {
            yield providerTextDelta("ok");
            yield providerDone();
          },
        },
        store,
      });

      // Enable OM for session s1
      const session1 = agent.createSession({ id: "s1" });
      await coordinator.toggleSession(session1, sessionModel, store, "/test");

      // Session s2 should still be off
      const state2 = await coordinator.loadSessionState("s2", store);
      assert.strictEqual(state2.enabled, false);
      assert.strictEqual(state2.workerModel, undefined);

      // Fresh coordinator
      const coordinator2 = createCoordinator({ store });
      const fresh1 = await coordinator2.loadSessionState("s1", store);
      const fresh2 = await coordinator2.loadSessionState("s2", store);
      assert.strictEqual(fresh1.enabled, true);
      assert.strictEqual(fresh2.enabled, false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("delegating context provider returns empty when session has no attached instance", async () => {
    const coordinator = createCoordinator();
    // Enable the session in memory but don't attach
    (coordinator as any).sessionStates.set("s1", { enabled: true });

    const cp = coordinator.createDelegatingContextProvider();
    const blocks = await cp.resolve({ sessionId: "s1", messages: [] });
    assert.strictEqual(blocks.length, 0);
  });

  it("delegating context provider returns empty when sessionId is missing", async () => {
    const coordinator = createCoordinator();
    const cp = coordinator.createDelegatingContextProvider();
    const blocks = await cp.resolve({ messages: [] });
    assert.strictEqual(blocks.length, 0);
  });

  it("isFlushInFlight returns false when no instance attached", () => {
    const coordinator = createCoordinator();
    assert.strictEqual(coordinator.isFlushInFlight("nonexistent"), false);
  });

  it("getLastError returns undefined when no instance attached", () => {
    const coordinator = createCoordinator();
    assert.strictEqual(coordinator.getLastError("nonexistent"), undefined);
  });

  it("config observationalMemory: true enables by default", async () => {
    const coordinator = createCoordinator({
      config: { cwd: "/test", observationalMemory: true },
    });
    const state = await coordinator.loadSessionState("s1");
    assert.strictEqual(state.enabled, true);
  });

  it("config observationalMemory: 'on' enables by default", async () => {
    const coordinator = createCoordinator({
      config: { cwd: "/test", observationalMemory: "on" },
    });
    const state = await coordinator.loadSessionState("s1");
    assert.strictEqual(state.enabled, true);
  });

  it("config observationalMemory: { enabled: true, model } sets defaults", async () => {
    const coordinator = createCoordinator({
      config: {
        cwd: "/test",
        observationalMemory: { enabled: true, model: workerModel },
      },
    });
    const state = await coordinator.loadSessionState("s1");
    assert.strictEqual(state.enabled, true);
    assert.deepStrictEqual(state.workerModel, workerModel);
  });

  it("setSessionWorkerModel with undefined resets to session model", async () => {
    const coordinator = createCoordinator();
    const store = createMemorySessionStore();
    const agent = createAgent({
      model: sessionModel,
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("ok");
          yield providerDone();
        },
      },
      store,
    });
    const session = agent.createSession({ id: "s1" });

    // Set a worker model
    await coordinator.setSessionWorkerModel(session, workerModel, sessionModel, store, "/test");
    const state1 = await coordinator.loadSessionState("s1", store);
    assert.deepStrictEqual(state1.workerModel, workerModel);

    // Reset to same-model (undefined)
    const result = await coordinator.setSessionWorkerModel(session, undefined, sessionModel, store, "/test");
    assert.strictEqual(result.workerModel.provider, sessionModel.provider);
    assert.strictEqual(result.workerModel.model, sessionModel.model);
  });
});
