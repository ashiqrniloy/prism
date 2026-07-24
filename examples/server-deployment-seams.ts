import {
  createAgent,
  createMemoryLeaseStore,
  createMockProvider,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import {
  createPrismDeploymentLease,
  createPrismDrainController,
  createPrismHandler,
  createPrismHealthHandler,
  createMemoryRateLimiter,
} from "@arnilo/prism-server";

/** Network-free deployment seam demo: health + drain + rate-limit + coordinator lease. */
export async function demo(): Promise<Record<string, unknown>> {
  const drain = createPrismDrainController({ deadlineMs: 1_000 });
  const rateLimit = createMemoryRateLimiter({ maxRequests: 8, windowMs: 60_000 });
  const agent = createAgent({
    model: { provider: "mock", model: "offline" },
    provider: createMockProvider([providerTextDelta("deployed"), providerDone()]),
  });
  const api = createPrismHandler({
    agents: { support: agent },
    authorize: () => ({ ownership: { tenantId: "demo", userId: "ops" } }),
    drain,
    rateLimit,
  });
  const health = createPrismHealthHandler({ drain, ready: async () => true });
  const lease = createPrismDeploymentLease({
    leases: createMemoryLeaseStore(),
    ownerId: "replica-1",
    key: "coordinator",
    ownership: { tenantId: "demo" },
  });

  const live = await health(new Request("https://example.test/health/livez"));
  const run = await api(new Request("https://example.test/prism/agents/support/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: "hi" }),
  }));
  const coordinator = await lease.tryAcquire();
  drain.beginDrain();
  const readyAfterDrain = await health(new Request("https://example.test/health/readyz"));
  const rejected = await api(new Request("https://example.test/prism/agents/support/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: "late" }),
  }));

  return {
    live: live.status,
    run: run.status,
    coordinatorOwner: coordinator?.ownerId,
    fencingToken: coordinator?.fencingToken,
    readyAfterDrain: readyAfterDrain.status,
    admitWhileDraining: rejected.status,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await demo()));
}
