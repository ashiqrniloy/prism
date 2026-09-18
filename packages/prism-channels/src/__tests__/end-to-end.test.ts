// Plan 079 Task 8: sqlite host composition, reopen, lease fence, process kill, admission timing.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type Agent,
  type AgentIdentity,
  type AIProvider,
  createAgent,
  ownershipFromIdentity,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-core/sessions/sqlite";
import { createChannelStateStore, createMessagingRuntime } from "../index.js";
import type { ChannelAuthorization, ChannelInboundEvent, ChannelReply, MessagingRuntimeOptions } from "../types.js";

const CONNECTION = "e2e-1";
const CHAT = "chat-1";
const ACTOR = "user-1";
const SECRET = "super-secret-payload";
const WORKER = join(dirname(fileURLToPath(import.meta.url)), "../../../../scripts/fixtures/messaging-restart-worker.mjs");
const SOAK = join(dirname(fileURLToPath(import.meta.url)), "../../../../scripts/fixtures/messaging-soak.mjs");

function identity(): AgentIdentity {
  return {
    tenantId: "e2e-tenant",
    userId: "e2e-user",
    principal: { kind: "user", id: "e2e-user" },
    scopes: ["chat"],
    issuedAt: new Date(0).toISOString(),
    verified: true,
  };
}

function authorization(): ChannelAuthorization {
  return { identity: identity(), agentAliases: ["primary"], grantRevision: "rev-1" };
}

function event(overrides: Partial<ChannelInboundEvent> = {}): ChannelInboundEvent {
  return {
    connectionId: CONNECTION,
    externalConversationId: CHAT,
    externalActorId: ACTOR,
    eventId: "1",
    text: SECRET,
    ...overrides,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return;
    await delay(5);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function textProvider(calls: { count: number }): AIProvider {
  return {
    id: "mock",
    async *generate() {
      calls.count += 1;
      yield providerTextDelta(`answer ${calls.count}`);
      yield providerDone();
    },
  };
}

function hangingProvider(calls: { count: number }): AIProvider {
  return {
    id: "mock",
    async *generate(request) {
      calls.count += 1;
      await new Promise<void>((resolve) => {
        if (request.signal?.aborted) {
          resolve();
          return;
        }
        request.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new Error("aborted while the process was dying");
    },
  };
}

function agentWith(provider: AIProvider, persistence: ReturnType<typeof createSqlitePersistence>): Agent {
  return createAgent({ id: "channel-agent", model: { provider: "mock", model: "demo" }, provider, store: persistence });
}

function host(persistence: ReturnType<typeof createSqlitePersistence>, provider: AIProvider, rest: Partial<MessagingRuntimeOptions> = {}) {
  const delivered: ChannelReply[] = [];
  const runtime = createMessagingRuntime({
    authorize: () => authorization(),
    resolveAgent: () => agentWith(provider, persistence),
    deliver: (reply) => {
      delivered.push(reply);
      return { delivered: true };
    },
    checkpoints: persistence.checkpoints,
    leases: persistence.leases,
    ...rest,
  });
  return { runtime, delivered, persistence };
}

describe("plan 079 channel host end-to-end", () => {
  it("persists a mock turn through sqlite, reopens, and never re-executes a duplicate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-channels-e2e-"));
    const filename = join(dir, "channels.sqlite");
    const calls = { count: 0 };
    try {
      const firstStore = createSqlitePersistence({ filename });
      const first = host(firstStore, textProvider(calls));
      assert.equal((await first.runtime.admit(event())).status, "accepted");
      assert.equal((await first.runtime.drain()).settled, true);
      assert.equal(first.delivered[0]?.text, "answer 1");
      assert.doesNotMatch(JSON.stringify(first.runtime.diagnostics()), new RegExp(SECRET));
      await first.runtime.stop();
      firstStore.close();

      const callsAfter = { count: 0 };
      const reopenedStore = createSqlitePersistence({ filename });
      const reopened = host(reopenedStore, textProvider(callsAfter));
      const retry = await reopened.runtime.admit(event());
      assert.equal(retry.duplicate, true);
      await reopened.runtime.drain();
      assert.equal(callsAfter.count, 0);
      assert.equal(reopened.delivered.length, 0);
      assert.equal((await reopened.runtime.listUnresolved({ identity: identity() })).length, 0);
      await reopened.runtime.stop();
      reopenedStore.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("two sqlite hosts on one binding defer to the lease holder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-channels-e2e-"));
    const filename = join(dir, "channels.sqlite");
    const calls = { count: 0 };
    const ownerStore = createSqlitePersistence({ filename });
    const otherStore = createSqlitePersistence({ filename });
    try {
      const owner = host(ownerStore, hangingProvider(calls));
      const other = host(otherStore, textProvider({ count: 0 }));
      assert.equal((await owner.runtime.admit(event())).status, "accepted");
      await waitFor(() => owner.runtime.diagnostics().active === 1, "owner to hold the binding lease");
      assert.equal((await other.runtime.admit(event({ eventId: "2" }))).status, "accepted");
      await other.runtime.drain();
      assert.equal(other.delivered.length, 0);
      assert.ok(other.runtime.diagnostics().leaseLosses >= 1);
      await owner.runtime.stop();
      await other.runtime.stop();
    } finally {
      ownerStore.close();
      otherStore.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed on a sqlite queue flood without dropping accepted work", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-channels-e2e-"));
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = { count: 0 };
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        calls.count += 1;
        await gate;
        yield providerTextDelta("answer");
        yield providerDone();
      },
    };
    const persistence = createSqlitePersistence({ filename: join(dir, "channels.sqlite") });
    try {
      const { runtime } = host(persistence, provider, { limits: { maxPendingPerBinding: 1, maxRoutes: 1 } });
      assert.equal((await runtime.admit(event({ eventId: "1" }))).status, "accepted");
      await delay(5);
      assert.equal((await runtime.admit(event({ eventId: "2" }))).status, "accepted");
      assert.deepEqual(await runtime.admit(event({ eventId: "3" })), { status: "denied", reason: "capacity" });
      release?.();
      await runtime.drain();
      assert.equal(calls.count, 2);
      await runtime.stop();
    } finally {
      persistence.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("revokes before dispatch, then drain/stop leave no unresolved work", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-channels-e2e-"));
    const calls = { count: 0 };
    const persistence = createSqlitePersistence({ filename: join(dir, "channels.sqlite") });
    try {
      const { runtime } = host(persistence, textProvider(calls), {
        authorize: () => ({
          ...authorization(),
          identity: { ...identity(), revokedAt: new Date(0).toISOString() },
        }),
      });
      assert.deepEqual(await runtime.admit(event()), { status: "denied", reason: "revoked" });
      assert.equal(calls.count, 0);
      assert.equal((await runtime.drain()).settled, true);
      await runtime.stop();
      assert.equal((await runtime.listUnresolved({ identity: identity() })).length, 0);
    } finally {
      persistence.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("duplicate durable admission stays under the local p95 bound", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-channels-e2e-"));
    const calls = { count: 0 };
    const persistence = createSqlitePersistence({ filename: join(dir, "channels.sqlite") });
    try {
      const { runtime } = host(persistence, textProvider(calls));
      assert.equal((await runtime.admit(event())).status, "accepted");
      await runtime.drain();
      const samples: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        const started = performance.now();
        const retry = await runtime.admit(event());
        samples.push(performance.now() - started);
        assert.equal(retry.duplicate, true);
      }
      samples.sort((a, b) => a - b);
      const p95 = samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)] ?? samples[samples.length - 1];
      assert.ok((p95 ?? 0) < 500, `duplicate admission p95 ${p95}ms exceeds the CI bound`);
      assert.equal(calls.count, 1);
      await runtime.stop();
    } finally {
      persistence.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("SIGTERM stops the runtime and settles claimed work instead of leaving it executing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-channels-e2e-"));
    try {
      let lastState: string | undefined;
      // `stop()` settles in-flight work through its abort; one retry absorbs scheduler jitter.
      for (let attempt = 0; attempt < 2 && lastState !== "cancelled" && lastState !== "failed"; attempt += 1) {
        const stopFile = join(dir, `term-${attempt}.sqlite`);
        const stopped = await runWorker(stopFile, `term-${attempt}`, "SIGTERM");
        assert.equal(stopped.exitCode, 0, "the worker exits cleanly once stop() resolves");
        assert.equal(stopped.stopped, true, "the worker reached its SIGTERM handler");

        const afterStop = createSqlitePersistence({ filename: stopFile });
        const inspect = host(afterStop, textProvider({ count: 0 }));
        try {
          const journal = createChannelStateStore({ checkpoints: afterStop.checkpoints, maxJournalRecordBytes: 128 * 1024 });
          const stored = await journal.loadOperation({
            ownership: ownershipFromIdentity(identity()),
            connectionId: CONNECTION,
            operationId: stopped.operationId,
          });
          lastState = stored?.record.state;
          const unresolved = await inspect.runtime.listUnresolved({ identity: identity() });
          assert.equal(unresolved.length, 0, `SIGTERM left ${unresolved.length} unresolved operation(s)`);
        } finally {
          await inspect.runtime.stop();
          afterStop.close();
        }
      }
      assert.ok(lastState === "cancelled" || lastState === "failed", `SIGTERM left the operation in state ${lastState ?? "unknown"}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("soak runner loops admit/reconcile/prune offline and exits clean", async () => {
    const summary = await runSoak(1_000);
    assert.equal(summary.ok, true, JSON.stringify(summary));
    assert.ok(summary.iterations >= 1, "the soak ran at least one iteration");
    assert.ok(summary.delivered >= 1, "each accepted turn delivered");
    assert.equal(summary.denied, 0);
    assert.equal(summary.unsettled, 0);
    assert.equal(summary.unresolvedAtEnd, 0);
    assert.equal(summary.diagnostics.failed, 0);
    assert.equal(summary.diagnostics.storageFailures, 0);
    assert.ok(summary.pruned.scanned > 0, "prune scanned the journal");
    assert.ok(summary.pruned.deleted > 0, "the aged sweep deleted settled records");
  });

  it("SIGKILL leaves claimed work for reconcile without a second run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-channels-e2e-"));
    try {
      const killFile = join(dir, "kill.sqlite");
      const killed = await runWorker(killFile, "kill-1");
      const afterKill = createSqlitePersistence({ filename: killFile });
      const inspect = host(afterKill, textProvider({ count: 0 }));
      const unresolved = await inspect.runtime.listUnresolved({ identity: identity() });
      assert.equal(unresolved[0]?.state, "executing");
      assert.equal(unresolved[0]?.operationId, killed.operationId);
      const resolved = await inspect.runtime.reconcile({
        identity: identity(),
        connectionId: unresolved[0]?.connectionId ?? CONNECTION,
        operationId: unresolved[0]?.operationId ?? killed.operationId,
        expectedVersion: unresolved[0]?.version ?? killed.version,
        acknowledgeDuplicateRisk: true,
      });
      assert.equal(resolved.status, "resolved", JSON.stringify({ resolved, unresolved, killed }));
      assert.equal(resolved.outcome, "execution_unknown");
      assert.equal((await inspect.runtime.admit(event({ eventId: "kill-1" }))).duplicate, true);
      await inspect.runtime.stop();
      afterKill.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

interface WorkerStop {
  operationId: string;
  version: number;
  exitCode: number | null;
  stopped: boolean;
}

interface SoakSummary {
  ok: boolean;
  iterations: number;
  admitted: number;
  duplicates: number;
  denied: number;
  unsettled: number;
  delivered: number;
  pruned: { scanned: number; deleted: number; retained: number };
  unresolvedAtEnd: number;
  diagnostics: { failed: number; storageFailures: number; deliveries: number };
}

/** Plan 080 Task 9: bounded soak smoke; the 72h operator recipe is the same script with a longer cap. */
function runSoak(durationMs: number): Promise<SoakSummary> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SOAK, "--durationMs", String(durationMs)], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`soak timed out: ${stderr}`));
    }, durationMs + 30_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`soak exited ${code}: ${stdout.trim()}\n${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as SoakSummary);
    });
  });
}

function runWorker(filename: string, eventId: string, signal: "SIGKILL" | "SIGTERM" = "SIGKILL"): Promise<WorkerStop> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER], {
      env: {
        ...process.env,
        PRISM_CHANNELS_WORKER_INPUT: JSON.stringify({
          filename,
          connectionId: CONNECTION,
          eventId,
          chat: CHAT,
          actor: ACTOR,
        }),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`worker timed out: ${stderr}`));
    }, 10_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const line = stdout.split("\n").find((row) => row.startsWith("STATE "));
      if (line === undefined || settled) return;
      settled = true;
      clearTimeout(timer);
      const state = JSON.parse(line.slice(6)) as { operationId: string; version: number };
      child.kill(signal);
      child.once("exit", (code) => resolve({ ...state, exitCode: code, stopped: stdout.includes("STOPPED\n") }));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      if (settled) return;
      clearTimeout(timer);
      reject(new Error(`worker exited ${code}: ${stderr}`));
    });
  });
}
