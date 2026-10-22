import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import {
  agentNode,
  createMemoryLeaseStore,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  LEASE_CONFLICT_CODE,
  resumeWorkflow,
  runWorkflow,
  WorkflowCheckpointError,
  WorkflowRuntimeError,
} from "../index.js";
import { childWorkflow, countsFile, dagWorkflow, gatedWorker, openPersistence, RUN_ID } from "./fixtures/kill-fixture.js";

const worker = new URL("./fixtures/kill-worker.ts", import.meta.url).pathname;

/** Starts the worker, waits for READY, then SIGKILLs it: no cleanup, no release, no final checkpoint. */
async function killWorker(dir: string, scenario: "dag" | "child"): Promise<string> {
  const child = spawn(process.execPath, [worker], {
    env: { ...process.env, PRISM_KILL_WORKER: JSON.stringify({ dir, scenario }) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let seen = "";
  let errors = "";
  child.stderr.on("data", (chunk) => (errors += String(chunk)));
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`worker never became ready: ${seen}${errors}`)), 20_000);
    child.stdout.on("data", (chunk) => {
      seen += String(chunk);
      if (seen.includes("READY") && seen.endsWith("\n")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", () => reject(new Error(`worker exited early: ${seen}${errors}`)));
  });
  child.kill("SIGKILL");
  await exited;
  return seen;
}

const counts = (dir: string): string[] => (existsSync(countsFile(dir)) ? readFileSync(countsFile(dir), "utf8").trim().split("\n") : []);
const withDir = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), "prism-kill-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
const reopen = openPersistence;

describe("durable resume after a process kill", () => {
  it("kill_and_resume_skips_completed_nodes", async () => {
    await withDir(async (dir) => {
      await killWorker(dir, "dag");
      assert.deepEqual(counts(dir), ["a", "b"]);
      const { persistence, checkpoints, leases } = await reopen(dir);
      try {
        const result = await resumeWorkflow(dagWorkflow({ dir, hang: false }), RUN_ID, { checkpoints, leases });
        assert.equal(result.status, "succeeded");
        assert.deepEqual(result.outputs, { a: "a-out", b: "b-out", c: "c-out" });
        // a ran once; b was interrupted so it reran (default policy); c ran once.
        assert.deepEqual(counts(dir), ["a", "b", "b", "c"]);
      } finally {
        persistence.close();
      }
    });
  });

  it("kill_and_resume_resumes_suspended_child", async () => {
    await withDir(async (dir) => {
      const ready = JSON.parse((await killWorker(dir, "child")).split("READY ")[1]!) as {
        status: string;
        version: number;
        approvals: string[];
      };
      assert.equal(ready.status, "suspended");
      assert.equal(ready.approvals.length, 1);
      const { persistence, checkpoints, leases } = await reopen(dir);
      const agent = await gatedWorker({ dir, store: persistence, turnsSeen: 1 });
      try {
        const result = await resumeWorkflow(childWorkflow(agent), RUN_ID, {
          checkpoints,
          leases,
          resume: {
            decision: "approve",
            expectedVersion: ready.version,
            input: ready.approvals.map((approvalId) => ({ approvalId, outcome: "allow_once" })),
          },
        });
        assert.equal(result.status, "succeeded");
        assert.equal(result.outputs.build, "child-done");
        // The same child session continued: its tool ran once, after the approval.
        assert.deepEqual(counts(dir), ["tool"]);
      } finally {
        await agent.dispose();
        persistence.close();
      }
    });
  });

  it("resume_claim_is_exclusive", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const leases = createMemoryLeaseStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pausing = defineWorkflow({
      id: "kill-dag",
      revision: "1",
      nodes: {
        a: functionNode({ execute: () => "a" }),
        b: functionNode({
          execute: async () => {
            await gate;
            return "b";
          },
        }),
        c: functionNode({ execute: () => "c" }),
      },
      edges: [
        ["a", "b"],
        ["b", "c"],
      ],
    });
    // A killed run: a checkpoint with b running.
    const controller = new AbortController();
    void runWorkflow(pausing, null, { checkpoints, runId: RUN_ID, signal: controller.signal }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const claim = await leases.tryAcquireLease({ namespace: "workflow-run", key: `kill-dag/${RUN_ID}`, ownerId: "other", ttlMs: 60_000 });
    assert.ok(claim);
    await assert.rejects(
      () => resumeWorkflow(pausing, RUN_ID, { checkpoints, leases }),
      (error: unknown) => (error as { code?: string }).code === LEASE_CONFLICT_CODE,
    );
  });

  it("resume_revision_mismatch_fails_closed", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const make = (revision: string) => defineWorkflow({ id: "rev", revision, nodes: { a: functionNode({ execute: () => "a" }) } });
    await runWorkflow(make("1"), null, { checkpoints, runId: RUN_ID });
    await assert.rejects(
      () => resumeWorkflow(make("2"), RUN_ID, { checkpoints, leases: createMemoryLeaseStore() }),
      (error: unknown) => error instanceof WorkflowCheckpointError && /definition hash mismatch/.test(error.message),
    );
  });

  it("not_idempotent_node_fails_on_resume", async () => {
    await withDir(async (dir) => {
      await killWorker(dir, "dag");
      const { persistence, checkpoints, leases } = await reopen(dir);
      try {
        const failing = dagWorkflow({ dir, hang: false, bIdempotent: "fail" });
        await assert.rejects(
          () => resumeWorkflow(failing, RUN_ID, { checkpoints, leases }),
          (error: unknown) => error instanceof WorkflowRuntimeError && error.code === "not_idempotent",
        );
        // Fail closed and stay failed: b did not run again, and a second resume refuses too.
        assert.deepEqual(counts(dir), ["a", "b"]);
        await assert.rejects(
          () => resumeWorkflow(failing, RUN_ID, { checkpoints, leases }),
          (error: unknown) => error instanceof WorkflowRuntimeError && error.code === "not_idempotent",
        );
        assert.deepEqual(counts(dir), ["a", "b"]);
      } finally {
        persistence.close();
      }
    });
  });

  it("foreign_tenant_cannot_resume", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    const wf = defineWorkflow({ id: "tenant", revision: "1", nodes: { a: functionNode({ execute: () => "a" }) } });
    await runWorkflow(wf, null, { checkpoints, runId: RUN_ID, ownership: { tenantId: "t1" } });
    await assert.rejects(() =>
      resumeWorkflow(wf, RUN_ID, { checkpoints, leases: createMemoryLeaseStore(), ownership: { tenantId: "t2" } }),
    );
  });

  it("worktree_rebound_after_kill", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    let created = 0;
    const rebinds: unknown[] = [];
    const handle = { path: "/wt/one", branch: "prism/one", async dispose() {} };
    const workspace = {
      worktree: {
        async create() {
          created += 1;
          return handle;
        },
        bound: () => undefined,
        async rebind(request: unknown) {
          rebinds.push(request);
          return handle;
        },
      },
      async diff() {
        return { changes: [], truncated: false };
      },
    };
    const agent = await createAgent({
      id: "wt",
      model: { provider: "mock", model: "m" },
      packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])],
    });
    const wf = defineWorkflow({ id: "wt", revision: "1", nodes: { build: agentNode({ agent, worktree: true, input: () => "go" }) } });
    const session = await agent.session({ parent: { agentId: agent.id, workflowRunId: RUN_ID } });
    const prism = { services: { consume: () => workspace } } as never;
    await checkpoints.save({
      workflowId: wf.id,
      runId: RUN_ID,
      version: 1,
      value: await interruptedValue(wf, session.id),
    });
    await resumeWorkflow(wf, RUN_ID, { checkpoints, leases: createMemoryLeaseStore(), prism });
    assert.equal(created, 0, "never creates a fresh worktree");
    assert.deepEqual(rebinds, [{ path: "/wt/one", sessionId: session.id, branch: "prism/one" }]);
    await agent.dispose();
  });

  it("worktree_lost_fails_closed", async () => {
    const checkpoints = createMemoryWorkflowCheckpoints();
    let created = 0;
    const workspace = {
      worktree: {
        async create() {
          created += 1;
          return { path: "/wt/one", branch: "prism/one", async dispose() {} };
        },
        // A fresh process holds no binding.
        bound: () => undefined,
      },
      async diff() {
        return { changes: [], truncated: false };
      },
    };
    const agent = await createAgent({
      id: "wt",
      model: { provider: "mock", model: "m" },
      packages: [mockProvider([])],
    });
    const wf = defineWorkflow({ id: "wt", revision: "1", nodes: { build: agentNode({ agent, worktree: true, input: () => "go" }) } });
    // The killed run: the node is running with its session and worktree recorded.
    const session = await agent.session({ parent: { agentId: agent.id, workflowRunId: RUN_ID } });
    const prism = { services: { consume: () => workspace } } as never;
    await checkpoints.save({
      workflowId: "wt",
      runId: RUN_ID,
      version: 1,
      value: await interruptedValue(wf, session.id),
    });
    await assert.rejects(
      () => resumeWorkflow(wf, RUN_ID, { checkpoints, leases: createMemoryLeaseStore(), prism }),
      (error: unknown) => error instanceof WorkflowRuntimeError && error.code === "worktree_lost",
    );
    assert.equal(created, 0, "never creates a fresh worktree or runs in the main tree");
    await agent.dispose();
  });
});

async function interruptedValue(wf: ReturnType<typeof defineWorkflow>, sessionId: string) {
  const { hashWorkflowDefinition } = await import("../util.js");
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    workflowId: wf.id,
    runId: RUN_ID,
    definitionHash: hashWorkflowDefinition(wf),
    status: "running" as const,
    readyNodeIds: [],
    completedNodeIds: [],
    nodes: { build: { nodeId: "build", status: "running" as const, sessionId, worktree: { path: "/wt/one", branch: "prism/one" } } },
    workflowInput: null,
    createdAt: now,
    updatedAt: now,
    redacted: false,
  };
}
