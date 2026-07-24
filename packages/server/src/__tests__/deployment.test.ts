import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAgent,
  createMemoryLeaseStore,
  createMockProvider,
  providerDone,
  providerTextDelta,
  type AgentEventRecord,
  type OwnershipScope,
  type PersistencePage,
} from "@arnilo/prism";
import {
  createPrismDeploymentLease,
  createPrismDrainController,
  createPrismEventReplay,
  createPrismHandler,
  createPrismHealthHandler,
  createPrismReplayHandler,
  createMemoryRateLimiter,
  PRISM_DEPLOYMENT_LEASE_NAMESPACE,
} from "../index.js";

const ownership: OwnershipScope = { tenantId: "tenant-1", userId: "user-1" };

function agent() {
  return createAgent({
    model: { provider: "mock", model: "offline" },
    provider: createMockProvider([providerTextDelta("ok"), providerDone()]),
  });
}

describe("server deployment seams", () => {
  it("health stays minimal; detail requires authorize; ready fails while draining", async () => {
    const drain = createPrismDrainController({ deadlineMs: 1_000 });
    const health = createPrismHealthHandler({
      ready: async () => true,
      drain,
      detail: () => ({ activeReplicas: 2 }),
      authorizeDetail: (request) => request.headers.get("authorization") === "Bearer ops",
    });

    const live = await health(new Request("https://example.test/health/livez"));
    assert.equal(live.status, 200);
    assert.deepEqual(await live.json(), { status: "ok", live: true });

    const denied = await health(new Request("https://example.test/health?detail=1"));
    assert.equal(denied.status, 403);

    const detailed = await health(new Request("https://example.test/health?detail=1", {
      headers: { authorization: "Bearer ops" },
    }));
    assert.equal(detailed.status, 200);
    const body = await detailed.json() as { detail?: { activeReplicas?: number }; drain?: { draining?: boolean } };
    assert.equal(body.detail?.activeReplicas, 2);
    assert.equal(body.drain?.draining, false);

    drain.beginDrain();
    const ready = await health(new Request("https://example.test/health/readyz"));
    assert.equal(ready.status, 503);
    assert.equal((await ready.json() as { ready: boolean }).ready, false);
  });

  it("drain rejects admits; status remains; rate-limit short-circuits before run", async () => {
    const drain = createPrismDrainController();
    const rateLimit = createMemoryRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const handler = createPrismHandler({
      agents: { support: agent() },
      authorize: () => ({ ownership }),
      drain,
      rateLimit,
    });

    const first = await handler(new Request("https://example.test/prism/agents/support/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "one" }),
    }));
    assert.equal(first.status, 200);

    const limited = await handler(new Request("https://example.test/prism/agents/support/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "two" }),
    }));
    assert.equal(limited.status, 429);
    assert.equal((await limited.json() as { error: { code: string } }).error.code, "ERR_PRISM_SERVER_RATE_LIMIT");
    assert.ok(limited.headers.get("retry-after"));

    const unlimited = createPrismHandler({
      agents: { support: agent() },
      authorize: () => ({ ownership }),
      drain,
    });
    drain.beginDrain();
    const admitted = await unlimited(new Request("https://example.test/prism/agents/support/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "nope" }),
    }));
    assert.equal(admitted.status, 503);
    assert.equal((await admitted.json() as { error: { code: string } }).error.code, "ERR_PRISM_SERVER_DRAINING");
  });

  it("event replay requires ownership and redacted pages; unauthorized handler denies", async () => {
    const pages: PersistencePage<AgentEventRecord>[] = [{
      items: [{
        id: "e1",
        sessionId: "s1",
        runId: "r1",
        type: "agent_finished",
        timestamp: new Date().toISOString(),
        event: { type: "agent_finished", runId: "r1", sessionId: "s1" },
        redacted: true,
        tenantId: "tenant-1",
        userId: "user-1",
      }],
    }];
    const replay = createPrismEventReplay({
      queryEvents: async (query) => {
        assert.equal(query.tenantId, "tenant-1");
        assert.equal(query.redacted, true);
        return pages[0]!;
      },
    });
    const page = await replay.page({ ownership, sessionId: "s1", runId: "r1" });
    assert.equal(page.items.length, 1);

    const handler = createPrismReplayHandler({
      replay,
      authorize: (request) => request.headers.get("authorization") === "Bearer ok" ? ownership : false,
    });
    const denied = await handler(new Request("https://example.test/prism/replay/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "s1", runId: "r1" }),
    }));
    assert.equal(denied.status, 403);

    const ok = await handler(new Request("https://example.test/prism/replay/events", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer ok" },
      body: JSON.stringify({ sessionId: "s1", runId: "r1" }),
    }));
    assert.equal(ok.status, 200);
  });

  it("deployment lease elects one coordinator; second acquire fails until release (fencing)", async () => {
    const leases = createMemoryLeaseStore();
    const a = createPrismDeploymentLease({ leases, ownerId: "proc-a", key: "coordinator", ownership, ttlMs: 5_000 });
    const b = createPrismDeploymentLease({ leases, ownerId: "proc-b", key: "coordinator", ownership, ttlMs: 5_000 });
    assert.equal(a.namespace, PRISM_DEPLOYMENT_LEASE_NAMESPACE);
    const first = await a.tryAcquire();
    assert.ok(first);
    assert.equal(first.fencingToken, 1);
    assert.equal(await b.tryAcquire(), null);
    assert.equal(await a.release(first.token), true);
    const second = await b.tryAcquire();
    assert.ok(second);
    assert.equal(second.fencingToken, 2);
    assert.equal(second.ownerId, "proc-b");
  });
});
