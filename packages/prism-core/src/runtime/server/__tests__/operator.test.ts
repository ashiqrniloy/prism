import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  enqueueWorkflow,
  functionNode,
  getWorkflowRun,
  runWorkflow,
  suspend,
} from "../../workflows/index.js";
import { createPrismDrainController, createPrismOperatorHandler } from "../index.js";

const ownership = { tenantId: "acme", userId: "ops" };

function work(id: string, execute: () => unknown) {
  return defineWorkflow({ revision: "1", id, nodes: { work: functionNode({ execute }) }, edges: [] });
}

describe("prism operator handler", () => {
  it("denies missing authorize and empty ownership", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const handler = createPrismOperatorHandler({
      authorize: () => false,
      checkpoints,
    });
    const denied = await handler(new Request("https://example.test/ops/queue"));
    assert.equal(denied.status, 403);

    const empty = createPrismOperatorHandler({
      authorize: () => ({ ownership: {} }),
      checkpoints,
    });
    const forbidden = await empty(new Request("https://example.test/ops/queue"));
    assert.equal(forbidden.status, 403);
  });

  it("pages queue age, suspended, and failed without leaking input", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const queued = work("queue-me", () => "ok");
    const hung = work("review", () => suspend({ reason: "approve-pay", data: { secret: "n" } }));
    await enqueueWorkflow(
      queued,
      { prompt: "secret-input" },
      { checkpoints, ownership, runId: "q1", metadata: { workloadClass: "batch" } },
    );
    await runWorkflow(hung, null, { checkpoints, ownership, runId: "s1" });

    const handler = createPrismOperatorHandler({
      authorize: () => ({ ownership }),
      checkpoints,
      workflows: { [queued.id]: queued, [hung.id]: hung },
      clock: () => Date.parse("2026-01-01T00:00:10.000Z") + 5_000,
    });
    const queue = await handler(new Request("https://example.test/ops/queue"));
    assert.equal(queue.status, 200);
    const body = (await queue.json()) as { items: Array<Record<string, unknown>> };
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0]?.runId, "q1");
    assert.equal(body.items[0]?.class, "batch");
    assert.equal("workflowInput" in (body.items[0] ?? {}), false);
    assert.ok(typeof body.items[0]?.queueAgeMs === "number");

    const suspended = await handler(new Request("https://example.test/ops/suspended"));
    const sbody = (await suspended.json()) as { items: Array<Record<string, unknown>> };
    assert.equal(sbody.items[0]?.suspension, "approve-pay");
    assert.equal(JSON.stringify(sbody).includes("secret"), false);
  });

  it("cancels an owned queued run and rejects foreign reconcile retry", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const definition = work("cancellable", () => "ok");
    await enqueueWorkflow(definition, null, { checkpoints, ownership, runId: "c1" });
    let reconciled = 0;
    const handler = createPrismOperatorHandler({
      authorize: (request) => (request.headers.get("authorization") === "Bearer ops" ? { ownership } : false),
      checkpoints,
      workflows: { [definition.id]: definition },
      unknownEffects: {
        async list() {
          return { items: [{ key: "effect-1", expectedVersion: 2 }] };
        },
        async reconcile(input) {
          reconciled += 1;
          return { status: input.status };
        },
      },
    });

    const unauth = await handler(
      new Request("https://example.test/ops/cancel", { method: "POST", body: JSON.stringify({ workflowId: definition.id, runId: "c1" }) }),
    );
    assert.equal(unauth.status, 403);

    const cancel = await handler(
      new Request("https://example.test/ops/cancel", {
        method: "POST",
        headers: { authorization: "Bearer ops", "content-type": "application/json" },
        body: JSON.stringify({ workflowId: definition.id, runId: "c1" }),
      }),
    );
    assert.equal(cancel.status, 200);
    assert.equal((await getWorkflowRun(checkpoints, { workflowId: definition.id, runId: "c1", ownership }))?.value.status, "aborted");

    const retry = await handler(
      new Request("https://example.test/ops/reconcile", {
        method: "POST",
        headers: { authorization: "Bearer ops", "content-type": "application/json" },
        body: JSON.stringify({ key: "effect-1", expectedVersion: 2, status: "failed_retryable" }),
      }),
    );
    assert.equal(retry.status, 400);
    assert.equal(reconciled, 0);

    const ok = await handler(
      new Request("https://example.test/ops/reconcile", {
        method: "POST",
        headers: { authorization: "Bearer ops", "content-type": "application/json" },
        body: JSON.stringify({ key: "effect-1", expectedVersion: 2, status: "failed_terminal", evidence: "ticket-9" }),
      }),
    );
    assert.equal(ok.status, 200);
    assert.equal(reconciled, 1);

    const unknown = await handler(new Request("https://example.test/ops/unknown", { headers: { authorization: "Bearer ops" } }));
    assert.equal(unknown.status, 200);
  });

  it("does not convert unknown into retry; drain deadline is finite", () => {
    let now = 1_000;
    const drain = createPrismDrainController({ deadlineMs: 5_000, clock: () => now });
    const snap = drain.beginDrain();
    assert.equal(snap.draining, true);
    assert.equal(snap.expired, false);
    assert.equal(Date.parse(snap.deadlineAt ?? ""), 6_000);
    now = 8_000;
    assert.equal(drain.snapshot().expired, true);
  });
});
