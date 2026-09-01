import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AgentIdentity, createMemoryLeaseStore, createSecretRedactor, type LeaseStore, type SecretRedactor } from "@arnilo/prism";
import {
  createMemoryWorkflowCheckpoints,
  defineSaga,
  resumeSaga,
  runSaga,
  WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION,
  type WorkflowLoopIterationRecord,
} from "../index.js";

const identity: AgentIdentity = {
  tenantId: "tenant-a",
  principal: { kind: "user", id: "operator-a" },
  scopes: ["saga:resolve"],
  issuedAt: new Date(Date.now() - 1_000).toISOString(),
  verified: true,
};

function options(
  overrides: {
    readonly checkpoints?: ReturnType<typeof createMemoryWorkflowCheckpoints>;
    readonly leases?: ReturnType<typeof createMemoryLeaseStore>;
    readonly ownerId?: string;
    readonly tenantId?: string;
    readonly input?: unknown;
    readonly maxAttempts?: number;
    readonly runId?: string;
    readonly leaseTtlMs?: number;
    readonly redactor?: SecretRedactor;
  } = {},
) {
  return {
    checkpoints: overrides.checkpoints ?? createMemoryWorkflowCheckpoints(),
    leases: overrides.leases ?? createMemoryLeaseStore(),
    ownerId: overrides.ownerId ?? "worker-a",
    tenantId: overrides.tenantId ?? "tenant-a",
    input: overrides.input ?? { invoiceId: "invoice-1" },
    maxAttempts: overrides.maxAttempts ?? 1,
    runId: overrides.runId ?? "default-run",
    leaseTtlMs: overrides.leaseTtlMs ?? 30_000,
    ...(overrides.redactor === undefined ? {} : { redactor: overrides.redactor }),
  } as const;
}

function unknownError(message: string): Error & { readonly unknown: true } {
  return Object.assign(new Error(message), { unknown: true as const });
}

describe("durable sagas", () => {
  it("compensates only completed steps in reverse order", async () => {
    const calls: string[] = [];
    const saga = defineSaga({
      id: "invoice-release",
      revision: "1",
      steps: [
        {
          id: "reserve",
          run: ({ operationId }) => {
            calls.push(`run:${operationId}`);
            return { reservationId: "r1" };
          },
          compensate: ({ operationId }) => calls.push(`compensate:${operationId}`),
          reconcile: () => ({ status: "succeeded" as const }),
        },
        {
          id: "charge",
          run: ({ operationId }) => {
            calls.push(`run:${operationId}`);
            return { chargeId: "c1" };
          },
          compensate: ({ operationId }) => calls.push(`compensate:${operationId}`),
          reconcile: () => ({ status: "succeeded" as const }),
        },
        {
          id: "notify",
          run: ({ operationId }) => {
            calls.push(`run:${operationId}`);
            throw new Error("downstream rejected");
          },
          compensate: ({ operationId }) => calls.push(`compensate:${operationId}`),
          reconcile: () => ({ status: "succeeded" as const }),
        },
      ],
    });

    const result = await runSaga(saga, options({ runId: "invoice-1" }));

    assert.equal(result.status, "compensated");
    assert.deepEqual(calls, [
      "run:tenant-a/invoice-release/invoice-1/reserve/forward",
      "run:tenant-a/invoice-release/invoice-1/charge/forward",
      "run:tenant-a/invoice-release/invoice-1/notify/forward",
      "compensate:tenant-a/invoice-release/invoice-1/charge/compensate",
      "compensate:tenant-a/invoice-release/invoice-1/reserve/compensate",
    ]);
  });

  it("treats a loop as one saga step with reverse per-iteration compensation keys", async () => {
    const compensated: string[] = [];
    const iterations: WorkflowLoopIterationRecord[] = [
      {
        schemaVersion: WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION,
        iteration: 0,
        iterationId: "loop-saga/run/refine/0",
        done: false,
        output: { reservationId: "r0" },
      },
      {
        schemaVersion: WORKFLOW_LOOP_ITERATION_SCHEMA_VERSION,
        iteration: 1,
        iterationId: "loop-saga/run/refine/1",
        done: true,
        output: { reservationId: "r1" },
      },
    ];
    const saga = defineSaga({
      id: "loop-compensation",
      revision: "1",
      steps: [
        {
          id: "refine",
          run: () => ({ iterations }),
          compensate: ({ output }) => {
            const records = (output as { readonly iterations: readonly WorkflowLoopIterationRecord[] }).iterations;
            for (const record of [...records].reverse()) compensated.push(record.iterationId);
          },
          reconcile: () => ({ status: "succeeded" as const }),
        },
        {
          id: "fail",
          run: () => {
            throw new Error("stop loop");
          },
          compensate: () => undefined,
          reconcile: () => ({ status: "succeeded" as const }),
        },
      ],
    });

    const result = await runSaga(saga, options({ runId: "loop-compensation-run" }));
    assert.equal(result.status, "compensated");
    assert.deepEqual(compensated, ["loop-saga/run/refine/1", "loop-saga/run/refine/0"]);
    assert.deepEqual(result.compensatedStepIds, ["refine"]);
  });

  it("reconciles unknown outcomes and keeps stable operation keys", async () => {
    const operations: string[] = [];
    const reconciliations: string[] = [];
    const saga = defineSaga({
      id: "unknown-payment",
      revision: "1",
      steps: [
        {
          id: "pay",
          run: ({ operationId }) => {
            operations.push(operationId);
            throw unknownError("request timed out");
          },
          compensate: () => undefined,
          reconcile: ({ operationId }) => {
            reconciliations.push(operationId);
            return { status: "succeeded" as const, output: { paymentId: "p1" } };
          },
        },
        {
          id: "ledger",
          run: ({ outputs }) => {
            assert.deepEqual(outputs.pay, { paymentId: "p1" });
            return { posted: true };
          },
          compensate: () => undefined,
          reconcile: () => ({ status: "succeeded" as const }),
        },
      ],
    });

    const result = await runSaga(saga, options({ maxAttempts: 2 }));

    assert.equal(result.status, "completed");
    assert.equal(operations.length, 1);
    assert.equal(reconciliations.length, 1);
    assert.equal(operations[0], reconciliations[0]);
  });

  it("redacts persisted outputs before compensation receives them", async () => {
    let compensatedOutput: unknown;
    const saga = defineSaga({
      id: "redacted-compensation",
      revision: "1",
      steps: [
        {
          id: "create",
          run: () => ({ token: "secret-token" }),
          compensate: ({ output }) => {
            compensatedOutput = output;
          },
          reconcile: () => ({ status: "succeeded" as const }),
        },
        {
          id: "fail",
          run: () => {
            throw new Error("known failure");
          },
          compensate: () => undefined,
          reconcile: () => ({ status: "succeeded" as const }),
        },
      ],
    });

    const result = await runSaga(saga, options({ redactor: createSecretRedactor(["secret-token"]), runId: "redacted-1" }));

    assert.equal(result.status, "compensated");
    assert.deepEqual(compensatedOutput, { token: "[REDACTED]" });
  });

  it("fences a stale worker and resumes from its durable running cursor", async () => {
    const leases = createMemoryLeaseStore();
    const staleLeases: LeaseStore = {
      tryAcquireLease: leases.tryAcquireLease,
      renewLease: async () => null,
      releaseLease: leases.releaseLease,
      getLease: leases.getLease,
    };
    const checkpoints = createMemoryWorkflowCheckpoints();
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saga = defineSaga({
      id: "crash-recovery",
      revision: "1",
      steps: [
        {
          id: "dispatch",
          run: async () => {
            started();
            await gate;
            return { sent: true };
          },
          compensate: () => undefined,
          reconcile: () => ({ status: "succeeded" as const, output: { sent: true } }),
        },
      ],
    });

    const staleRun = runSaga(saga, options({ checkpoints, leases: staleLeases, ownerId: "stale", runId: "crash-1", leaseTtlMs: 30 }));
    await startedPromise;
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await assert.rejects(staleRun, /lease lost|stale|fenc/i);

    const resumed = await resumeSaga(saga, options({ checkpoints, leases, ownerId: "replacement", runId: "crash-1", leaseTtlMs: 100 }));
    assert.equal(resumed.status, "completed");
  });

  it("stops unresolved outcomes for verified manual resolution", async () => {
    const saga = defineSaga({
      id: "manual-reconcile",
      revision: "1",
      steps: [
        {
          id: "ship",
          run: () => {
            throw unknownError("carrier timeout");
          },
          compensate: () => undefined,
          reconcile: () => ({ status: "unknown" as const }),
        },
      ],
    });
    const base = options({ runId: "manual-1" });
    const manual = await runSaga(saga, base);
    assert.equal(manual.status, "manual_intervention");

    const resolved = await resumeSaga(saga, {
      ...base,
      manualResolution: {
        status: "compensated",
        expectedVersion: manual.version,
        reason: "Carrier confirmed shipment voided outside Prism",
        auditRef: "audit:saga:manual-1",
        actor: identity,
      },
    });
    assert.equal(resolved.status, "compensated");
    assert.equal(resolved.manualResolution?.auditRef, "audit:saga:manual-1");
  });

  it("rejects definition revision changes before handlers execute", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const leases = createMemoryLeaseStore();
    const original = defineSaga({
      id: "revision-guard",
      revision: "1",
      steps: [
        {
          id: "work",
          run: () => {
            throw unknownError("ambiguous");
          },
          compensate: () => undefined,
          reconcile: () => ({ status: "unknown" as const }),
        },
      ],
    });
    const base = options({ checkpoints, leases, runId: "revision-1" });
    await runSaga(original, base);
    let called = false;
    const changed = defineSaga({
      id: original.id,
      revision: "2",
      steps: [
        {
          id: "work",
          run: () => {
            called = true;
            return true;
          },
          compensate: () => undefined,
          reconcile: () => ({ status: "succeeded" as const }),
        },
      ],
    });

    await assert.rejects(resumeSaga(changed, base), /revision/i);
    assert.equal(called, false);
  });

  it("recovers a bounded 100-step saga from its durable cursor", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const leases = createMemoryLeaseStore();
    const staleLeases: LeaseStore = {
      tryAcquireLease: leases.tryAcquireLease,
      renewLease: async () => null,
      releaseLease: leases.releaseLease,
      getLease: leases.getLease,
    };
    const executionCounts = Array.from({ length: 100 }, () => 0);
    let step50Started!: () => void;
    const step50StartedPromise = new Promise<void>((resolve) => {
      step50Started = resolve;
    });
    let releaseStep50!: () => void;
    const step50Gate = new Promise<void>((resolve) => {
      releaseStep50 = resolve;
    });
    const steps = Array.from({ length: 100 }, (_, index) => ({
      id: `step-${index}`,
      run: async () => {
        executionCounts[index] += 1;
        if (index === 50) {
          step50Started();
          await step50Gate;
        }
        return { index };
      },
      compensate: () => undefined,
      reconcile: () => ({ status: "succeeded" as const, output: { index } }),
    }));
    const saga = defineSaga({ id: "bounded-100", revision: "1", steps });
    const staleRun = runSaga(saga, options({ checkpoints, leases: staleLeases, ownerId: "stale", runId: "bounded-100-1", leaseTtlMs: 30 }));
    await step50StartedPromise;
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseStep50();
    await assert.rejects(staleRun, /lease lost|stale|fenc/i);

    const result = await resumeSaga(
      saga,
      options({ checkpoints, leases, ownerId: "replacement", runId: "bounded-100-1", leaseTtlMs: 100 }),
    );
    assert.equal(result.status, "completed");
    assert.equal(result.completedStepIds.length, 100);
    assert.deepEqual(
      executionCounts.slice(0, 50),
      Array.from({ length: 50 }, () => 1),
    );
    assert.equal(executionCounts[50], 1);
    assert.deepEqual(
      executionCounts.slice(51),
      Array.from({ length: 49 }, () => 1),
    );
  });

  it("keeps identical run ids isolated by tenant ownership", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const leases = createMemoryLeaseStore();
    const saga = defineSaga({
      id: "tenant-isolation",
      revision: "1",
      steps: [
        {
          id: "work",
          run: ({ tenantId }) => ({ tenantId }),
          compensate: () => undefined,
          reconcile: () => ({ status: "succeeded" as const }),
        },
      ],
    });
    const first = await runSaga(saga, options({ checkpoints, leases, runId: "same", tenantId: "tenant-a" }));
    const second = await runSaga(saga, options({ checkpoints, leases, runId: "same", tenantId: "tenant-b" }));
    assert.equal(first.status, "completed");
    assert.equal(second.status, "completed");
  });

  it("bounds definitions and requires explicit compensation/reconciliation", () => {
    assert.throws(
      () =>
        defineSaga({
          id: "bad",
          revision: "1",
          steps: [
            { id: "same", run: () => undefined, compensate: () => undefined, reconcile: () => ({ status: "succeeded" as const }) },
            { id: "same", run: () => undefined, compensate: () => undefined, reconcile: () => ({ status: "succeeded" as const }) },
          ],
        }),
      /duplicate/i,
    );
    assert.throws(
      () =>
        defineSaga({
          id: "bad-step",
          revision: "1",
          steps: [{ id: "only-run", run: () => undefined } as never],
        }),
      /compensate|reconcile/i,
    );
    assert.throws(
      () =>
        defineSaga({
          id: "too-many",
          revision: "1",
          steps: Array.from({ length: 101 }, (_, index) => ({
            id: `step-${index}`,
            run: () => undefined,
            compensate: () => undefined,
            reconcile: () => ({ status: "succeeded" as const }),
          })),
        }),
      /100/,
    );
  });
});
