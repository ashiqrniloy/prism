/**
 * Optional worktree isolation for supervised spawns (plan 078 Task 6).
 *
 * Fake lifecycle for helper behavior; one real `createCodingWorkspaceLifecycle` case proves
 * missing `worktreeRoots` fails closed before the child factory runs and without Git.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createMemoryCheckpointStore, createMemoryLeaseStore, type Agent } from "@arnilo/prism";
import type { DelegationChildContext, DelegationCompletion } from "@arnilo/prism-core/runtime/supervisor";
import type { GitOperations } from "../git.js";
import { createWorktreeChildFactory } from "../spawn-worktree.js";
import { createCodingWorkspaceLifecycle, WorkspaceError } from "../workspace-lifecycle.js";

const WORKTREE = "/approved/roots/ws-1";

function context(delegationId: string, signal = new AbortController().signal): DelegationChildContext {
  return {
    childId: "explore",
    delegationId,
    depth: 1,
    path: ["explore"],
    ownership: { tenantId: "tenant-a" },
    resourceId: `supervisor/${delegationId}/explore`,
    threadId: `supervisor/${delegationId}/explore/default`,
    permission: {},
    signal,
    delegate: () => Promise.reject(new Error("not used")),
  } as unknown as DelegationChildContext;
}

function completion(delegationId: string, status: DelegationCompletion["status"] = "succeeded"): DelegationCompletion {
  return { childId: "explore", delegationId, depth: 1, status, text: "" };
}

function fakeWorkspaces(options?: { readonly failCleanupWith?: WorkspaceError }): {
  lifecycle: Parameters<typeof createWorktreeChildFactory>[1]["workspaces"];
  calls: { readonly create: { taskId: string; branch: string }[]; readonly cleanup: string[] };
} {
  const calls = { create: [] as { taskId: string; branch: string }[], cleanup: [] as string[] };
  const record = (taskId: string, branch: string) => ({
    schemaVersion: 1,
    workspaceId: "ws-1",
    taskId,
    ownerId: "replica-1",
    state: "active",
    repositories: [{ repositoryId: "app", worktreePath: WORKTREE, branch, state: "active" }],
    artifactRefs: [],
    fencingToken: 1,
  });
  const lifecycle = {
    async create(request: { taskId: string; repositories: readonly { repositoryId: string; branch: string }[] }) {
      const [repository] = request.repositories;
      assert.ok(repository);
      calls.create.push({ taskId: request.taskId, branch: repository.branch });
      return record(request.taskId, repository.branch);
    },
    async cleanup({ taskId }: { taskId: string }) {
      if (options?.failCleanupWith) throw options.failCleanupWith;
      calls.cleanup.push(taskId);
      return { ...record(taskId, "agent/x"), state: "closed" };
    },
  };
  return { lifecycle: lifecycle as unknown as Parameters<typeof createWorktreeChildFactory>[1]["workspaces"], calls };
}

const child = (): Agent => ({ config: {}, createSession: () => ({}) }) as unknown as Agent;

test("isolated child runs in its worktree; cleanup is keyed by delegationId and one-shot", async () => {
  const { lifecycle, calls } = fakeWorkspaces();
  let seenCwd: string | undefined;
  const factory = createWorktreeChildFactory(
    (ctx) => {
      seenCwd = ctx.cwd;
      return child();
    },
    {
      workspaces: lifecycle,
      repositoryId: "app",
    },
  );
  // Constructing the helper performs no Git or store work.
  assert.deepEqual(calls.create, []);
  await factory.createAgent(context("supervisor-1"));
  assert.equal(seenCwd, WORKTREE);
  assert.deepEqual(calls.create, [{ taskId: "supervisor-1", branch: "agent/supervisor-1" }]);
  assert.deepEqual(calls.cleanup, []);

  await factory.after(completion("supervisor-1"));
  await factory.after(completion("supervisor-1"));
  assert.deepEqual(calls.cleanup, ["supervisor-1"], "cleanup is idempotent");

  // Aborted children clean up the same way.
  await factory.createAgent(context("supervisor-2"));
  await factory.after(completion("supervisor-2", "aborted"));
  assert.deepEqual(calls.cleanup, ["supervisor-1", "supervisor-2"]);
});

test("shared-cwd children and foreign handles never touch the workspace lifecycle", async () => {
  const { lifecycle, calls } = fakeWorkspaces();
  const isolated = createWorktreeChildFactory(() => child(), { workspaces: lifecycle, repositoryId: "app" });
  const shared = createWorktreeChildFactory(() => child(), { workspaces: lifecycle, repositoryId: "app" });
  await isolated.createAgent(context("supervisor-1"));
  await shared.after(completion("supervisor-1")); // a sibling helper never cleans another's tree
  await isolated.after(completion("foreign-9"));
  assert.deepEqual(calls.cleanup, []);
  await isolated.after(completion("supervisor-1"));
  assert.deepEqual(calls.cleanup, ["supervisor-1"]);
});

test("resume re-creates the identical workspace for a suspended delegation", async () => {
  const { lifecycle, calls } = fakeWorkspaces();
  const factory = createWorktreeChildFactory(() => child(), {
    workspaces: lifecycle,
    repositoryId: "app",
    branch: "agent/explore",
  });
  await factory.createAgent(context("supervisor-3"));
  await factory.createAgent(context("supervisor-3"));
  assert.deepEqual(calls.create, [
    { taskId: "supervisor-3", branch: "agent/explore" },
    { taskId: "supervisor-3", branch: "agent/explore" },
  ]);
});

test("cleanup refusal surfaces to the supervisor terminal hook", async () => {
  const dirty = new WorkspaceError("ERR_PRISM_WORKSPACE_DIRTY", "refusing to remove dirty worktree");
  const { lifecycle } = fakeWorkspaces({ failCleanupWith: dirty });
  const factory = createWorktreeChildFactory(() => child(), { workspaces: lifecycle, repositoryId: "app" });
  await factory.createAgent(context("supervisor-4"));
  await assert.rejects(factory.after(completion("supervisor-4")), /dirty/);
});

test("missing worktreeRoots fails closed before the child factory runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "spawn-worktree-"));
  let gitCalls = 0;
  const git = {
    worktree: async () => {
      gitCalls += 1;
      throw new Error("git must not run");
    },
  } as unknown as GitOperations;
  const workspaces = createCodingWorkspaceLifecycle({
    checkpoints: createMemoryCheckpointStore(),
    leases: createMemoryLeaseStore(),
    ownerId: "replica-1",
    ownership: { tenantId: "tenant-a" },
    repositories: { app: { root, git } },
    worktreeRoots: [],
  });
  let spawned = 0;
  const factory = createWorktreeChildFactory(
    () => {
      spawned += 1;
      return child();
    },
    { workspaces, repositoryId: "app" },
  );
  await assert.rejects(factory.createAgent(context("supervisor-5")), (error: unknown) => {
    assert.ok(error instanceof WorkspaceError);
    assert.equal(error.code, "ERR_PRISM_WORKSPACE_LIMIT");
    return true;
  });
  assert.equal(spawned, 0, "child factory never ran");
  assert.equal(gitCalls, 0, "no Git mutation before the containment check");
});
