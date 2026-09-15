import { createAgent, createMemoryLeaseStore, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import {
  createMemoryRateLimiter,
  createPrismDeploymentLease,
  createPrismDrainController,
  createPrismHandler,
  createPrismHealthHandler,
  createPrismOperatorHandler,
} from "@arnilo/prism-core/runtime/server";
import {
  createMemoryWorkflowCheckpoints,
  createWorkflowCoordinator,
  defineWorkflow,
  enqueueWorkflow,
  functionNode,
} from "@arnilo/prism-core/runtime/workflows";

/** Network-free deployment seam demo: health + drain + fair worker + operator queue. */
export async function demo(): Promise<Record<string, unknown>> {
  const drain = createPrismDrainController({ deadlineMs: 1_000 });
  const rateLimit = createMemoryRateLimiter({ maxRequests: 8, windowMs: 60_000 });
  const ownership = { tenantId: "demo", userId: "ops" };
  const agent = createAgent({
    model: { provider: "mock", model: "offline" },
    provider: createMockProvider([providerTextDelta("deployed"), providerDone()]),
  });
  const api = createPrismHandler({
    agents: { support: agent },
    authorize: () => ({ ownership }),
    drain,
    rateLimit,
  });
  const health = createPrismHealthHandler({ drain, ready: async () => true });
  const leases = createMemoryLeaseStore();
  const lease = createPrismDeploymentLease({
    leases,
    ownerId: "replica-1",
    key: "coordinator",
    ownership: { tenantId: "demo" },
  });
  const checkpoints = createMemoryWorkflowCheckpoints();
  const flow = defineWorkflow({
    revision: "1",
    id: "ping",
    nodes: { work: functionNode({ execute: () => "pong" }) },
    edges: [],
  });
  await enqueueWorkflow(flow, null, { checkpoints, ownership, runId: "ping-1", metadata: { workloadClass: "interactive" } });
  const worker = createWorkflowCoordinator({
    coordinatorId: "worker-1",
    workflows: { [flow.id]: flow },
    checkpoints,
    leases,
    ownership,
    admission: { perTenant: 2, drain, maxPagesPerPoll: 4 },
  });
  const ops = createPrismOperatorHandler({
    authorize: (request) => (request.headers.get("authorization") === "Bearer ops" ? { ownership } : false),
    checkpoints,
    workflows: { [flow.id]: flow },
  });

  const live = await health(new Request("https://example.test/health/livez"));
  const run = await api(
    new Request("https://example.test/prism/agents/support/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hi" }),
    }),
  );
  const queue = await ops(new Request("https://example.test/ops/queue", { headers: { authorization: "Bearer ops" } }));
  const claimed = await worker.pollOnce();
  const coordinator = await lease.tryAcquire();
  drain.beginDrain();
  const readyAfterDrain = await health(new Request("https://example.test/health/readyz"));
  const rejected = await api(
    new Request("https://example.test/prism/agents/support/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "late" }),
    }),
  );
  const noClaimWhileDraining = await worker.pollOnce();

  return {
    live: live.status,
    run: run.status,
    queue: queue.status,
    claimed,
    coordinatorOwner: coordinator?.ownerId,
    fencingToken: coordinator?.fencingToken,
    readyAfterDrain: readyAfterDrain.status,
    admitWhileDraining: rejected.status,
    noClaimWhileDraining,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await demo()));
}
