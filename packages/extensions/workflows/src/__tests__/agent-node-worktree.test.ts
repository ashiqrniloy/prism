import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { type Agent, createAgent, providerDone, providerTextDelta, type Session } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import {
  agentNode,
  defineWorkflow,
  functionNode,
  gateNode,
  runWorkflow,
  WorkflowDefinitionError,
  type WorkflowNodeContext,
  WorkflowRuntimeError,
} from "../index.js";

const agents: Agent[] = [];
afterEach(async () => {
  for (const agent of agents.splice(0)) await agent.dispose();
});

/** A stateful fake of the `workspace` service: one live worktree per session, like the real one. */
function fakeWorkspace() {
  let next = 0;
  const live = new Map<string, { path: string; branch: string; sessionId: string }>();
  const files = new Map<string, string[]>();
  const creates: { sessionId: string; branch?: string; base?: string }[] = [];
  const handle = (record: { path: string; branch: string; sessionId: string }) => ({
    path: record.path,
    branch: record.branch,
    async dispose() {
      live.delete(record.sessionId);
    },
  });
  return {
    creates,
    files,
    service: {
      worktree: {
        async create(request: { sessionId: string; branch?: string; base?: string }) {
          creates.push(request);
          if (live.has(request.sessionId)) throw Object.assign(new Error("bound"), { code: "workspace_session_bound" });
          next += 1;
          const record = { path: `/wt/${next}`, branch: request.branch ?? `prism/${next}`, sessionId: request.sessionId };
          live.set(request.sessionId, record);
          files.set(record.path, []);
          return handle(record);
        },
        bound(sessionId: string) {
          const record = live.get(sessionId);
          return record === undefined ? undefined : handle(record);
        },
      },
      async diff(path: string) {
        return {
          changes: (files.get(path) ?? []).map((file) => ({ kind: "file", path: file, change: "added", source: "diff" })),
          truncated: false,
        };
      },
    },
  };
}

function hostPrism(workspace: ReturnType<typeof fakeWorkspace>) {
  const emitted: { name: string; data: Record<string, unknown> }[] = [];
  const runtime = { events: { emit: (name: string, data: Record<string, unknown>) => emitted.push({ name, data }) } };
  const prism = {
    services: { consume: (name: string) => (name === "workspace" ? workspace.service : name === "workflows" ? runtime : undefined) },
  } as never;
  return { prism, emitted };
}

async function worker(turns = 3): Promise<Agent> {
  const agent = await createAgent({
    id: "worker",
    model: { provider: "mock", model: "m" },
    packages: [mockProvider(Array.from({ length: turns }, (_, index) => [providerTextDelta(`attempt ${index + 1}`), providerDone()]))],
  });
  agents.push(agent);
  return agent;
}

/** start → work → checks; a failing gate sends the run back to `work`. */
function factory(
  agent: Agent,
  options: { session?: () => Session; worktree?: object; pass: (attempt: number) => boolean },
  seen: string[][],
  workspace: ReturnType<typeof fakeWorkspace>,
) {
  let attempts = 0;
  return defineWorkflow({
    id: "factory",
    revision: "1",
    limits: { maxSupersteps: 20 },
    nodes: {
      start: functionNode({ execute: () => "go" }),
      work: {
        ...agentNode({
          agent,
          ...(options.session === undefined ? {} : { session: options.session }),
          worktree: { dispose: "keep", ...options.worktree },
          // Runs after the worktree is bound: record what this attempt sees, then "change a file".
          input: (ctx: WorkflowNodeContext) => {
            attempts += 1;
            const path = [...workspace.files.keys()].at(-1) ?? "";
            const tree = workspace.files.get(path) ?? [];
            seen.push([...tree]);
            tree.push(`attempt-${attempts}.txt`);
            return `work ${ctx.nodeId}`;
          },
        }),
        activation: "any" as const,
      },
      checks: gateNode({
        onFail: "work",
        maxIterations: 3,
        check: () => (options.pass(attempts) ? { pass: true } : { pass: false, reason: "tests fail" }),
      }),
      done: functionNode({ execute: () => "done" }),
    },
    edges: [
      ["start", "work"],
      ["work", "checks"],
      ["checks", "work"],
      ["checks", "done"],
    ],
  });
}

describe("agentNode worktree reuse", () => {
  it("back_edge_with_supplied_session_continues_in_the_same_worktree", async () => {
    const workspace = fakeWorkspace();
    const { prism, emitted } = hostPrism(workspace);
    const agent = await worker();
    const taskSession = await agent.session();
    const seen: string[][] = [];
    const wf = factory(
      agent,
      { session: () => taskSession, worktree: { branch: () => "factory/t1", base: "HEAD" }, pass: (n) => n >= 2 },
      seen,
      workspace,
    );
    const result = await runWorkflow(wf, null, { prism });
    assert.equal(result.status, "succeeded");
    assert.equal(workspace.creates.length, 1, "worktree.create runs once");
    assert.deepEqual(workspace.creates[0], { sessionId: taskSession.id, branch: "factory/t1", base: "HEAD" });
    assert.deepEqual(seen, [[], ["attempt-1.txt"]], "the second attempt sees the first attempt's change");
    const lastAttemptFiles = emitted.filter((event) => event.name === "agent.file").slice(-2);
    assert.deepEqual(
      lastAttemptFiles.map((event) => event.data.path),
      ["attempt-1.txt", "attempt-2.txt"],
      "the diff after the retry covers both attempts",
    );
    const output = result.outputs.work as { worktree: { path: string; branch: string } };
    assert.deepEqual(output.worktree, { path: "/wt/1", branch: "factory/t1", truncated: false });
  });

  it("node_without_session_gets_a_fresh_worktree_per_execution", async () => {
    const workspace = fakeWorkspace();
    const { prism } = hostPrism(workspace);
    const agent = await worker();
    const seen: string[][] = [];
    const result = await runWorkflow(factory(agent, { pass: (n) => n >= 2 }, seen, workspace), null, { prism });
    assert.equal(result.status, "succeeded");
    assert.equal(workspace.creates.length, 2);
    assert.notEqual(workspace.creates[0]?.sessionId, workspace.creates[1]?.sessionId);
    assert.deepEqual(seen, [[], []], "each fresh session starts from a fresh tree");
  });

  it("held_worktree_on_another_branch_fails_closed", async () => {
    const workspace = fakeWorkspace();
    const { prism } = hostPrism(workspace);
    const agent = await worker();
    const taskSession = await agent.session();
    await workspace.service.worktree.create({ sessionId: taskSession.id, branch: "other" });
    await assert.rejects(
      () =>
        runWorkflow(
          factory(agent, { session: () => taskSession, worktree: { branch: "factory/t1" }, pass: () => true }, [], workspace),
          null,
          { prism },
        ),
      (error: unknown) => error instanceof WorkflowRuntimeError && error.code === "worktree_branch_mismatch",
    );
  });

  it("invalid_branch_fails_at_definition_or_start", async () => {
    const agent = await worker();
    for (const branch of ["bad branch", "a..b", "-x", "ends/", "x.lock", ""]) {
      assert.throws(() => agentNode({ agent, worktree: { branch } }), WorkflowDefinitionError, branch);
    }
    assert.throws(() => agentNode({ agent, worktree: { base: "--upload-pack=x" } }), WorkflowDefinitionError);
    const workspace = fakeWorkspace();
    const { prism } = hostPrism(workspace);
    await assert.rejects(
      () => runWorkflow(factory(agent, { worktree: { branch: () => "bad~name" }, pass: () => true }, [], workspace), null, { prism }),
      (error: unknown) => error instanceof WorkflowRuntimeError && error.code === "invalid_worktree_branch",
    );
    assert.equal(workspace.creates.length, 0);
  });
});
