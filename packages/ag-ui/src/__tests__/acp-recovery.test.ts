/**
 * Durable ACP/live-task run recovery tests (plan 026 Task 5).
 *
 * Threat T5 coverage: restored active-run references re-resolve against
 * durable run state (suspended runs preserve pending approval ids, terminal
 * runs report terminal, unprovable in-flight streams report unknown — never a
 * restarted prompt); durable cancellation is ownership/version/fence checked,
 * terminal/idempotent, and never replays pending/dispatched tools (security
 * test 'T5 duplicate approval/effect'); corrupt or oversized refs/markers fail
 * closed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { client, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import {
  AgentRunStateError,
  createAgent,
  createAgentRunLifecycle,
  createMemoryCheckpointStore,
  createMemoryLeaseStore,
  createMemorySessionStore,
  providerDone,
  providerTextDelta,
  type AgentRunLifecycle,
  type CheckpointStore,
  type LeaseStore,
} from "@arnilo/prism";
import {
  AcpError,
  createPrismAcpAgent,
  createAcpRunRecovery,
  ACP_RUN_CANCEL_NAMESPACE,
  type AcpAuthorization,
  type AcpRunCancelMarker,
  type AcpSessionStore,
  type PersistedAcpSession,
} from "../acp/index.js";
import { MAX_ACTIVE_RUN_REF_BYTES, validateActiveRunRef, validatePersistedSession, type PersistedAcpRunRef } from "../acp/session-store.js";

const iso = "2026-08-16T12:00:00.000Z";

/** In-memory AcpSessionStore fixture; also serves as the shared store across "restarts". */
class MemorySessionStore implements AcpSessionStore {
  readonly entries = new Map<string, PersistedAcpSession>();
  saves: PersistedAcpSession[] = [];
  async save(entry: PersistedAcpSession): Promise<void> {
    this.entries.set(entry.sessionId, entry);
    this.saves.push(entry);
  }
  async loadAll(): Promise<readonly PersistedAcpSession[]> {
    return [...this.entries.values()];
  }
  async evict(sessionId: string): Promise<void> {
    this.entries.delete(sessionId);
  }
}

interface FakeLifecycleOptions {
  state?: { status: string; interruption?: { reason?: string; pendingDecisions?: Array<{ approvalId: string }> } };
  version?: number;
  throwStateError?: boolean;
}

function fakeLifecycle(options: FakeLifecycleOptions = {}): AgentRunLifecycle {
  return {
    async status() {
      if (options.throwStateError) throw new AgentRunStateError("No durable agent run run-1");
      return {
        state: options.state ?? { status: "running" },
        version: options.version ?? 1,
      };
    },
    async resume() {
      throw new Error("not used");
    },
    async *resumeStream() {},
  } as unknown as AgentRunLifecycle;
}

function makeRecovery(overrides?: {
  lifecycle?: AgentRunLifecycle;
  checkpoints?: CheckpointStore;
  leases?: LeaseStore;
  ownerId?: string;
  leaseTtlMs?: number;
}) {
  return createAcpRunRecovery({
    lifecycle: overrides?.lifecycle ?? fakeLifecycle(),
    checkpoints: overrides?.checkpoints ?? createMemoryCheckpointStore(),
    leases: overrides?.leases ?? createMemoryLeaseStore(),
    ownerId: overrides?.ownerId ?? "replica-1",
    ...(overrides?.leaseTtlMs !== undefined ? { leaseTtlMs: overrides.leaseTtlMs } : {}),
  });
}

const ref = { runId: "run-1", sessionId: "s-1" };
const ownership = { tenantId: "tenant-a" };

describe("active-run reference validation", () => {
  it("valid refs round-trip through the persisted session shape", () => {
    const runRef: PersistedAcpRunRef = { runId: "run-1", sessionId: "s-1", status: "suspended", version: 7, updatedAt: iso };
    const validated = validateActiveRunRef(runRef);
    assert.deepEqual(validated, runRef);
    const entry: PersistedAcpSession = {
      sessionId: "acp-1",
      ownership: { userId: "user-1" },
      configValues: {},
      cwd: "/tmp",
      additionalDirectories: [],
      updatedAt: iso,
      activeRun: runRef,
    };
    validatePersistedSession(entry); // must not throw
  });

  it("field caps bound every ref well inside the frozen 512-byte total cap", () => {
    // Maximal field sizes must still fit the frozen total cap; oversized ids fail closed.
    const maximal = {
      runId: `r${"x".repeat(127)}`,
      sessionId: `s${"y".repeat(127)}`,
      status: "running" as const,
      updatedAt: iso,
    };
    assert.deepEqual(validateActiveRunRef(maximal), maximal);
    assert.ok(Buffer.byteLength(JSON.stringify(maximal), "utf8") <= MAX_ACTIVE_RUN_REF_BYTES);
    assert.throws(
      () => validateActiveRunRef({ ...maximal, runId: `r${"x".repeat(200)}` }),
      (error: unknown) => error instanceof AcpError && error.code === "ERR_PRISM_ACP_LIMIT",
    );
  });

  it("malformed refs fail closed", () => {
    assert.throws(() => validateActiveRunRef({ runId: "", sessionId: "s", status: "running", updatedAt: iso }), (error: unknown) => error instanceof AcpError);
    assert.throws(() => validateActiveRunRef({ runId: "r", sessionId: "s", status: "restarting", updatedAt: iso }), (error: unknown) => error instanceof AcpError);
    assert.throws(() => validateActiveRunRef({ runId: "r", sessionId: "s", status: "running", version: -1, updatedAt: iso }), (error: unknown) => error instanceof AcpError);
    assert.throws(() => validateActiveRunRef({ runId: "r", sessionId: "s", status: "running", updatedAt: "yesterday" }), (error: unknown) => error instanceof AcpError);
    assert.throws(() => validateActiveRunRef(null), (error: unknown) => error instanceof AcpError);
    assert.throws(
      () => validatePersistedSession({
        sessionId: "acp-1",
        ownership: { userId: "user-1" },
        configValues: {},
        cwd: "/tmp",
        additionalDirectories: [],
        updatedAt: iso,
        activeRun: { runId: "r", sessionId: "s", status: "running", updatedAt: iso, env: "k0" },
      } as unknown as PersistedAcpSession),
      (error: unknown) => error instanceof AcpError,
    );
  });
});

describe("recovered run status reporting", () => {
  it("suspended runs preserve pending approval ids and the durable version", async () => {
    const recovery = makeRecovery({
      lifecycle: fakeLifecycle({
        version: 7,
        state: {
          status: "suspended",
          interruption: {
            reason: "1 approval request(s) remain",
            pendingDecisions: [{ approvalId: "a1" }, { approvalId: "a2" }],
          },
        },
      }),
    });
    const report = await recovery.status(ref, { ownership });
    assert.equal(report.status, "suspended");
    assert.equal(report.version, 7);
    assert.deepEqual(report.pendingApprovalIds, ["a1", "a2"]);
    assert.equal(report.interruptionReason, "1 approval request(s) remain");
  });

  it("terminal runs report terminal", async () => {
    const recovery = makeRecovery({ lifecycle: fakeLifecycle({ state: { status: "succeeded" }, version: 3 }) });
    const report = await recovery.status(ref, { ownership });
    assert.equal(report.status, "terminal");
    assert.equal(report.version, 3);
  });

  it("unprovable in-flight runs report unknown, never a restarted prompt", async () => {
    const recovery = makeRecovery({ lifecycle: fakeLifecycle({ state: { status: "running" } }) });
    const report = await recovery.status(ref, { ownership });
    assert.equal(report.status, "unknown");
  });

  it("stale refs (no durable run) report unknown", async () => {
    const recovery = makeRecovery({ lifecycle: fakeLifecycle({ throwStateError: true }) });
    const report = await recovery.status(ref, { ownership });
    assert.equal(report.status, "unknown");
  });

  it("a durable cancel marker takes precedence over run state", async () => {
    const checkpoints = createMemoryCheckpointStore();
    await checkpoints.saveCheckpoint({
      namespace: ACP_RUN_CANCEL_NAMESPACE,
      key: "run-1",
      category: "coding-cancel",
      value: { schemaVersion: 1, runId: "run-1", sessionId: "s-1", ownerId: "replica-1", cancelledAt: iso },
      version: 1,
      expectedVersion: 0,
      ...ownership,
    });
    const recovery = makeRecovery({
      checkpoints,
      lifecycle: fakeLifecycle({ state: { status: "suspended", interruption: { pendingDecisions: [{ approvalId: "a1" }] } } }),
    });
    const report = await recovery.status(ref, { ownership });
    assert.equal(report.status, "cancelled");
    assert.deepEqual(report.pendingApprovalIds, []);
    assert.equal(report.cancelledAt, iso);
  });
});

describe("durable cancellation", () => {
  it("cancels a suspended run: marker written, idempotent, status flips to cancelled", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const recovery = makeRecovery({
      checkpoints,
      lifecycle: fakeLifecycle({ state: { status: "suspended", interruption: { pendingDecisions: [{ approvalId: "a1" }] } }, version: 5 }),
    });
    const result = await recovery.cancel(ref, { ownership, expectedVersion: 5 });
    assert.equal(result.cancelled, true);
    assert.equal(result.terminal, false);
    assert.ok(result.at);
    // Idempotent: a second cancel returns the same marker without a new write.
    const again = await recovery.cancel(ref, { ownership });
    assert.equal(again.cancelled, true);
    assert.equal(again.at, result.at);
    const marker = await checkpoints.loadCheckpoint({ namespace: ACP_RUN_CANCEL_NAMESPACE, key: "run-1", ...ownership });
    assert.ok(marker);
    assert.equal((marker.value as AcpRunCancelMarker).expectedVersion, 5);
    // Status after cancel: cancelled, never suspended (pending approvals must not replay).
    const report = await recovery.status(ref, { ownership });
    assert.equal(report.status, "cancelled");
    assert.deepEqual(report.pendingApprovalIds, []);
  });

  it("terminal runs cancel idempotently without a marker", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const recovery = makeRecovery({ checkpoints, lifecycle: fakeLifecycle({ state: { status: "succeeded" } }) });
    const result = await recovery.cancel(ref, { ownership });
    assert.deepEqual(result, { cancelled: false, terminal: true });
    const marker = await checkpoints.loadCheckpoint({ namespace: ACP_RUN_CANCEL_NAMESPACE, key: "run-1", ...ownership });
    assert.equal(marker, null);
    const again = await recovery.cancel(ref, { ownership });
    assert.deepEqual(again, { cancelled: false, terminal: true });
  });

  it("missing durable runs fail closed toward cancellation (never replay)", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const recovery = makeRecovery({ checkpoints, lifecycle: fakeLifecycle({ throwStateError: true }) });
    const result = await recovery.cancel(ref, { ownership });
    assert.equal(result.cancelled, true);
    assert.equal(await recovery.isCancelled(ref, { ownership }).then((r) => r.cancelled), true);
  });

  it("stale version check fails closed with ERR_PRISM_RECOVERY_FENCE", async () => {
    const recovery = makeRecovery({ lifecycle: fakeLifecycle({ state: { status: "suspended" }, version: 9 }) });
    await assert.rejects(
      () => recovery.cancel(ref, { ownership, expectedVersion: 4 }),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "ERR_PRISM_RECOVERY_FENCE",
    );
  });

  it("a held cancel lease fences the second canceller", async () => {
    const leases = createMemoryLeaseStore();
    const held = await leases.tryAcquireLease({
      namespace: "prism.coding-agent.cancel.lease.v1",
      key: "cancel:run-1",
      ownerId: "replica-2",
      ttlMs: 30_000,
      ...ownership,
    });
    assert.ok(held);
    const recovery = makeRecovery({ leases, lifecycle: fakeLifecycle({ state: { status: "suspended" } }) });
    await assert.rejects(
      () => recovery.cancel(ref, { ownership }),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "ERR_PRISM_RECOVERY_FENCE",
    );
  });

  it("cross-tenant cancel fails closed with ERR_PRISM_RECOVERY_OWNERSHIP", async () => {
    const leases = createMemoryLeaseStore();
    await leases.tryAcquireLease({
      namespace: "prism.coding-agent.cancel.lease.v1",
      key: "cancel:run-1",
      ownerId: "replica-1",
      ttlMs: 30_000,
      ...ownership,
    });
    const recovery = makeRecovery({ leases, lifecycle: fakeLifecycle({ state: { status: "suspended" } }) });
    await assert.rejects(
      () => recovery.cancel(ref, { ownership: { tenantId: "tenant-b" } }),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "ERR_PRISM_RECOVERY_OWNERSHIP",
    );
  });

  it("corrupt cancel markers fail closed and are rewritten by a later cancel", async () => {
    const checkpoints = createMemoryCheckpointStore();
    await checkpoints.saveCheckpoint({
      namespace: ACP_RUN_CANCEL_NAMESPACE,
      key: "run-1",
      category: "coding-cancel",
      value: { schemaVersion: 1, runId: "run-1", env: "k0", cancelledAt: iso },
      version: 1,
      expectedVersion: 0,
      ...ownership,
    });
    const recovery = makeRecovery({ checkpoints, lifecycle: fakeLifecycle({ state: { status: "suspended" } }) });
    assert.equal((await recovery.isCancelled(ref, { ownership })).cancelled, false);
    const result = await recovery.cancel(ref, { ownership });
    assert.equal(result.cancelled, true);
  });
});

describe("ACP agent wiring", () => {
  it("persists the active-run ref on live runs and restores it across a restart", async () => {
    const store = new MemorySessionStore();
    const checkpoints = createMemoryCheckpointStore();
    const leases = createMemoryLeaseStore();
    const prismAgent = createAgent({
      id: "recovery-agent",
      model: { provider: "mock", model: "mock" },
      store: createMemorySessionStore(),
      runState: { checkpoints, definitionRevision: "1" },
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("ok");
          yield providerDone();
        },
      },
    });
    const makeApp = () =>
      createPrismAcpAgent<AcpAuthorization>({
        authorize: () => ({ ownership: { userId: "user-1" } }),
        sessionFactory: () => ({ session: prismAgent.createSession({ id: "acp-session" }), agentId: "recovery-agent" }),
        lifecycle: createAgentRunLifecycle({ checkpoints, resolveAgent: () => ({ agent: prismAgent, definitionRevision: "1" }) }),
        sessionStore: store,
        sessions: {
          load: async () => ({ session: prismAgent.createSession({ id: "acp-session" }), agentId: "recovery-agent" }),
        },
        recovery: { checkpoints, leases, ownerId: "replica-1" },
      });
    const app = makeApp();
    const acpClient = client({ name: "test-client" }).onNotification(methods.client.session.update, () => void 0);
    let sessionId = "";
    await acpClient.connectWith(app, async (connection) => {
      await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      sessionId = created.sessionId;
      const result = await connection.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "go" }],
      });
      assert.equal(result.stopReason, "end_turn");
    });
    // The run-ref persistence is best-effort; wait for it.
    const deadline = Date.now() + 2000;
    while (!store.entries.get(sessionId)?.activeRun && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const persisted = store.entries.get(sessionId)!.activeRun!;
    assert.equal(persisted.sessionId, "acp-session");
    assert.equal(persisted.status, "terminal"); // last observed status: finished
    // Restart: a fresh agent instance over the same store restores the session
    // with its active-run ref, and cancel writes a durable marker.
    const app2 = makeApp();
    await acpClient.connectWith(app2, async (connection) => {
      await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      await connection.request(methods.agent.session.load, { sessionId, cwd: "/w", mcpServers: [] });
      await connection.notify(methods.agent.session.cancel, { sessionId });
    });
    const restored = store.entries.get(sessionId);
    assert.ok(restored?.activeRun);
    assert.equal(restored.activeRun.runId, persisted.runId);
    const marker = await checkpoints.loadCheckpoint({
      namespace: ACP_RUN_CANCEL_NAMESPACE,
      key: persisted.runId,
      userId: "user-1",
    });
    assert.ok(marker);
  });
});
