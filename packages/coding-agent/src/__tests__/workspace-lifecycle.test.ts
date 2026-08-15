/**
 * Ownership-scoped multi-repository and worktree lifecycle (plan 026 Task 3).
 *
 * Memory CheckpointStore/LeaseStore fixtures plus fake cwd-bound GitOperations
 * runners. Threat T3 coverage: path escape, cleanup refusal (dirty/locked/
 * main/missing/unowned/mismatched), stale fencing, ownership, and resume
 * fingerprint verification.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createMemoryCheckpointStore, createMemoryLeaseStore } from "@arnilo/prism";
import type { CheckpointStore, LeaseStore } from "@arnilo/prism";
import type { GitFingerprint, GitOperations, GitWorktreeEntry } from "../git.js";
import type { ArtifactReference } from "../git.js";
import {
  WORKSPACE_NAMESPACE,
  WORKSPACE_LOCK_REASON_PREFIX,
  WorkspaceError,
  createCodingWorkspaceLifecycle,
} from "../workspace-lifecycle.js";
import type { CodingWorkspaceRecord, WorkspaceRepositoryRegistration } from "../workspace-lifecycle.js";

interface FakeWorktree extends GitWorktreeEntry {
  dirExists: boolean;
  dirty: boolean;
}

interface FakeGit {
  readonly root: string;
  remoteUrl: string;
  readonly defaultBranch: string;
  readonly worktrees: Map<string, FakeWorktree>;
  readonly calls: { action: string; path?: string; branch?: string; force?: boolean; reason?: string }[];
  head: string;
}

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "ffffffffffffffffffffffffffffffffffffffff";

function fingerprintOf(fake: FakeGit): GitFingerprint {
  const redacted = fake.remoteUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^@/]*@/i, (m) => m.replace(/[^:]*@$/, ""));
  const source = Buffer.from(`${redacted}\0${fake.defaultBranch}`, "utf8");
  return { remoteFingerprint: createHash("sha256").update(source).digest("hex"), defaultBranch: fake.defaultBranch };
}

function makeFakeGit(root: string, overrides: Partial<FakeGit> = {}): FakeGit {
  return {
    root,
    remoteUrl: "https://git.example.com/org/app.git",
    defaultBranch: "main",
    worktrees: new Map(),
    calls: [],
    head: SHA,
    ...overrides,
  };
}

function makeFakeOperations(fake: FakeGit): GitOperations {
  const list = (): FakeWorktree[] => [...fake.worktrees.values()];
  return {
    async status() {
      throw new Error("not used");
    },
    async diff() {
      throw new Error("not used");
    },
    async branch() {
      throw new Error("not used");
    },
    async worktree(request) {
      fake.calls.push(request);
      if (request.action === "list") {
        return { worktrees: list() };
      }
      if (request.action === "add") {
        if (!request.path || !request.branch) throw new Error("path and branch required");
        if (fake.worktrees.has(request.path)) throw new Error(`worktree already exists: ${request.path}`);
        fake.worktrees.set(request.path, {
          path: request.path,
          head: fake.head,
          branch: `refs/heads/${request.branch}`,
          dirExists: true,
          dirty: false,
        });
        return { worktrees: list(), path: request.path };
      }
      if (request.action === "lock" || request.action === "unlock") {
        if (!request.path) throw new Error("path required");
        const entry = fake.worktrees.get(request.path);
        if (!entry) throw new Error(`unknown worktree: ${request.path}`);
        if (request.action === "lock") {
          entry.locked = true;
          entry.lockReason = request.reason;
        } else {
          entry.locked = false;
          entry.lockReason = undefined;
        }
        return { worktrees: list(), path: request.path };
      }
      if (!request.path) throw new Error("path required");
      const entry = fake.worktrees.get(request.path);
      if (!entry) throw new Error(`unknown worktree: ${request.path}`);
      if (!request.force && entry.dirty) throw new Error("fatal: worktree contains modified or untracked files");
      fake.worktrees.delete(request.path);
      return { worktrees: list(), path: request.path };
    },
    async fingerprint() {
      return fingerprintOf(fake);
    },
    async apply() {
      throw new Error("not used");
    },
    async commit() {
      throw new Error("not used");
    },
    async prHandoff() {
      throw new Error("not used");
    },
  } as GitOperations;
}

interface Harness {
  checkpoints: CheckpointStore;
  leases: LeaseStore;
  fakes: Record<string, FakeGit>;
  lifecycle: ReturnType<typeof createCodingWorkspaceLifecycle>;
  worktreeRoot: string;
}

async function makeHarness(overrides?: {
  repositories?: Record<string, WorkspaceRepositoryRegistration>;
  policy?: Record<string, boolean>;
  limits?: Record<string, number>;
  ownerId?: string;
  worktreeRoots?: readonly string[];
}): Promise<Harness> {
  const worktreeRoot = await mkdtemp(join(tmpdir(), "phase26-ws-"));
  const appRoot = await mkdtemp(join(tmpdir(), "phase26-app-"));
  const apiRoot = await mkdtemp(join(tmpdir(), "phase26-api-"));
  const fakes: Record<string, FakeGit> = {
    app: makeFakeGit(appRoot),
    api: makeFakeGit(apiRoot, { remoteUrl: "https://git.example.com/org/api.git" }),
  };
  const repositories: Record<string, WorkspaceRepositoryRegistration> = {
    app: { root: appRoot, git: makeFakeOperations(fakes.app!) },
    api: { root: apiRoot, git: makeFakeOperations(fakes.api!) },
    ...(overrides?.repositories ?? {}),
  };
  const checkpoints = createMemoryCheckpointStore();
  const leases = createMemoryLeaseStore();
  const lifecycle = createCodingWorkspaceLifecycle({
    checkpoints,
    leases,
    ownerId: overrides?.ownerId ?? "replica-1",
    ownership: { tenantId: "tenant-a" },
    repositories,
    worktreeRoots: overrides?.worktreeRoots ?? [worktreeRoot],
    policy: overrides?.policy,
    limits: overrides?.limits,
  });
  return { checkpoints, leases, fakes, lifecycle, worktreeRoot };
}

const artifact = (n: number): ArtifactReference => ({
  kind: "diff",
  uri: `artifact://refs/${n}`,
  sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  bytes: n,
});

async function expectCode(promise: Promise<unknown>, code: string): Promise<WorkspaceError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof WorkspaceError, `expected WorkspaceError, got ${String(error)}`);
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
    return error;
  }
  assert.fail(`expected ${code} to be thrown`);
}

/** Save a hostile record straight into the store, bypassing the lifecycle. */
async function tamperRecord(h: Harness, workspaceId: string, mutate: (record: CodingWorkspaceRecord) => CodingWorkspaceRecord): Promise<void> {
  const existing = await h.checkpoints.loadCheckpoint({ namespace: WORKSPACE_NAMESPACE, key: workspaceId, tenantId: "tenant-a" });
  assert.ok(existing, "record exists");
  const record = mutate(existing.value as CodingWorkspaceRecord);
  await h.checkpoints.saveCheckpoint({
    namespace: WORKSPACE_NAMESPACE,
    key: workspaceId,
    version: existing.version + 1,
    expectedVersion: existing.version,
    fencingToken: (existing.fencingToken ?? 0) + 1,
    value: record,
    category: "coding-workspace",
    tenantId: "tenant-a",
  });
}

test("create: two repositories, isolated branches and worktrees, correlated record", async () => {
  const { fakes, leases, lifecycle, worktreeRoot } = await makeHarness();
  const record = await lifecycle.create({
    taskId: "task-1",
    repositories: [
      { repositoryId: "app", branch: "agent/task-1" },
      { repositoryId: "api", branch: "agent/task-1" },
    ],
    artifactRefs: [artifact(1)],
  });
  assert.equal(record.state, "active");
  assert.equal(record.repositories.length, 2);
  assert.equal(record.fencingToken, 1);
  const app = record.repositories[0]!;
  const api = record.repositories[1]!;
  assert.ok(app.worktreePath.startsWith(worktreeRoot), "worktree under approved root");
  assert.ok(api.worktreePath.startsWith(worktreeRoot), "worktree under approved root");
  assert.notEqual(app.worktreePath, api.worktreePath, "isolated worktrees");
  assert.equal(app.branch, "agent/task-1");
  assert.equal(app.base, SHA);
  assert.equal(app.head, SHA);
  assert.equal(app.remoteFingerprint.length, 64);
  assert.equal(fakes.app!.worktrees.size, 1);
  assert.equal(fakes.api!.worktrees.size, 1);
  const locked = fakes.app!.worktrees.get(app.worktreePath)!;
  assert.equal(locked.locked, true);
  assert.equal(locked.lockReason, `${WORKSPACE_LOCK_REASON_PREFIX}${record.workspaceId}`);
  assert.equal(record.artifactRefs.length, 1);
  // lease released after create: another worker can take it
  const lease = await leases.tryAcquireLease({
    namespace: WORKSPACE_NAMESPACE,
    key: record.workspaceId,
    ownerId: "probe",
    ttlMs: 30_000,
    tenantId: "tenant-a",
  });
  assert.ok(lease, "lease is free after create");
});

test("duplicate create is idempotent; conflicting create fails closed", async () => {
  const { fakes, lifecycle } = await makeHarness();
  const request = { taskId: "task-2", repositories: [{ repositoryId: "app", branch: "agent/task-2" }] };
  const first = await lifecycle.create(request);
  const callsBefore = fakes.app!.calls.length;
  const second = await lifecycle.create(request);
  assert.equal(second.workspaceId, first.workspaceId);
  assert.deepEqual(second, first);
  assert.equal(fakes.app!.calls.length, callsBefore, "no Git mutation on duplicate create");
  await expectCode(
    lifecycle.create({ taskId: "task-2", repositories: [{ repositoryId: "app", branch: "agent/other" }] }),
    "ERR_PRISM_WORKSPACE_FENCE",
  );
});

test("lease fencing: held lease rejects; stale CAS worker rejects", async () => {
  const { leases, lifecycle } = await makeHarness();
  const record = await lifecycle.create({ taskId: "task-3", repositories: [{ repositoryId: "app", branch: "agent/task-3" }] });
  const wsId = record.workspaceId;
  const held = await leases.tryAcquireLease({
    namespace: WORKSPACE_NAMESPACE,
    key: wsId,
    ownerId: "replica-2",
    ttlMs: 60_000,
    tenantId: "tenant-a",
  });
  assert.ok(held, "external lease acquired");
  await expectCode(lifecycle.cleanup({ taskId: "task-3" }), "ERR_PRISM_WORKSPACE_FENCE");
  await expectCode(lifecycle.attachArtifacts({ taskId: "task-3", artifactRefs: [artifact(2)] }), "ERR_PRISM_WORKSPACE_FENCE");
  await leases.releaseLease({ namespace: WORKSPACE_NAMESPACE, key: wsId, ownerId: "replica-2", token: held!.token, tenantId: "tenant-a" });
  // stale fence: a worker whose lease lapsed cannot renew; a lower-fence write must fail
  await leases.releaseLease({ namespace: WORKSPACE_NAMESPACE, key: wsId, ownerId: "replica-2", token: held!.token, tenantId: "tenant-a" });
  const fresh = await leases.tryAcquireLease({
    namespace: WORKSPACE_NAMESPACE,
    key: wsId,
    ownerId: "replica-2",
    ttlMs: 60_000,
    tenantId: "tenant-a",
  });
  assert.ok(fresh);
  await expectCode(
    lifecycle.attachArtifacts({ taskId: "task-3", artifactRefs: [artifact(3)] }),
    "ERR_PRISM_WORKSPACE_FENCE",
    // replica-2 holds the lease: the lifecycle (replica-1) cannot acquire
  );
  await leases.releaseLease({ namespace: WORKSPACE_NAMESPACE, key: wsId, ownerId: "replica-2", token: fresh!.token, tenantId: "tenant-a" });
});

test("ownership: another tenant fails closed as ownership", async () => {
  const h = await makeHarness();
  await h.lifecycle.create({ taskId: "task-17", repositories: [{ repositoryId: "app", branch: "b" }] });
  const otherTenant = createCodingWorkspaceLifecycle({
    checkpoints: h.checkpoints,
    leases: h.leases,
    ownerId: "replica-9",
    ownership: { tenantId: "tenant-b" },
    repositories: { app: { root: h.fakes.app!.root, git: makeFakeOperations(h.fakes.app!) } },
    worktreeRoots: [h.worktreeRoot],
  });
  await expectCode(otherTenant.cleanup({ taskId: "task-17" }), "ERR_PRISM_WORKSPACE_OWNERSHIP");
  await expectCode(otherTenant.get({ taskId: "task-17" }), "ERR_PRISM_WORKSPACE_OWNERSHIP");
});

test("unknown repository and limits fail closed", async () => {
  const { lifecycle } = await makeHarness();
  await expectCode(
    lifecycle.create({ taskId: "task-4", repositories: [{ repositoryId: "nope", branch: "b" }] }),
    "ERR_PRISM_WORKSPACE_UNKNOWN",
  );
  const small = await makeHarness({ limits: { maxRepositories: 1 } });
  await expectCode(
    small.lifecycle.create({
      taskId: "task-5",
      repositories: [
        { repositoryId: "app", branch: "b1" },
        { repositoryId: "api", branch: "b2" },
      ],
    }),
    "ERR_PRISM_WORKSPACE_LIMIT",
  );
  await expectCode(
    lifecycle.create({ taskId: "bad task!", repositories: [{ repositoryId: "app", branch: "b" }] }),
    "ERR_PRISM_WORKSPACE_LIMIT",
  );
});

test("record byte cap and artifact caps", async () => {
  const tiny = await makeHarness({ limits: { maxRecordBytes: 1024 } });
  await expectCode(
    tiny.lifecycle.create({
      taskId: "task-6",
      repositories: [{ repositoryId: "app", branch: "b" }],
      artifactRefs: Array.from({ length: 16 }, (_, i) => artifact(i)),
    }),
    "ERR_PRISM_WORKSPACE_LIMIT",
  );
  const { lifecycle } = await makeHarness();
  await lifecycle.create({ taskId: "task-7", repositories: [{ repositoryId: "app", branch: "b" }] });
  await expectCode(
    lifecycle.attachArtifacts({ taskId: "task-7", artifactRefs: Array.from({ length: 65 }, (_, i) => artifact(i)) }),
    "ERR_PRISM_WORKSPACE_LIMIT",
  );
});

test("verify: head, worktree, and fingerprint mismatches fail closed", async () => {
  const { fakes, lifecycle } = await makeHarness();
  await lifecycle.create({ taskId: "task-8", repositories: [{ repositoryId: "app", branch: "agent/task-8" }] });
  const record = await lifecycle.verify({ taskId: "task-8" });
  assert.equal(record.state, "active");
  const entry = [...fakes.app!.worktrees.values()][0]!;
  entry.head = OTHER_SHA;
  await expectCode(lifecycle.verify({ taskId: "task-8" }), "ERR_PRISM_WORKSPACE_FINGERPRINT");
  entry.head = SHA;
  fakes.app!.worktrees.delete(entry.path);
  await expectCode(lifecycle.verify({ taskId: "task-8" }), "ERR_PRISM_WORKSPACE_FINGERPRINT");
  fakes.app!.worktrees.set(entry.path, { ...entry, dirExists: true, dirty: false });
  fakes.app!.remoteUrl = "https://git.example.com/other/app.git";
  await expectCode(lifecycle.verify({ taskId: "task-8" }), "ERR_PRISM_WORKSPACE_FINGERPRINT");
  await expectCode(lifecycle.verify({ taskId: "missing-task" }), "ERR_PRISM_WORKSPACE_UNKNOWN");
});

test("path escape: tampered worktree path outside approved roots fails closed", async () => {
  const h = await makeHarness();
  const record = await h.lifecycle.create({ taskId: "task-9", repositories: [{ repositoryId: "app", branch: "b" }] });
  await tamperRecord(h, record.workspaceId, (r) => ({
    ...r,
    repositories: r.repositories.map((repo) => ({ ...repo, worktreePath: "/etc/passwd" })),
  }));
  await expectCode(h.lifecycle.get({ taskId: "task-9" }), "ERR_PRISM_WORKSPACE_PATH_ESCAPE");
});

test("cleanup: clean remove closes the record", async () => {
  const { fakes, lifecycle } = await makeHarness();
  await lifecycle.create({
    taskId: "task-10",
    repositories: [
      { repositoryId: "app", branch: "b" },
      { repositoryId: "api", branch: "b" },
    ],
  });
  const closed = await lifecycle.cleanup({ taskId: "task-10" });
  assert.equal(closed.state, "closed");
  assert.ok(closed.cleanupAt);
  assert.equal(fakes.app!.worktrees.size, 0);
  assert.equal(fakes.api!.worktrees.size, 0);
  assert.ok(fakes.app!.calls.some((c) => c.action === "unlock"), "own lock released before removal");
  const again = await lifecycle.cleanup({ taskId: "task-10" });
  assert.equal(again.state, "closed");
});

test("cleanup refuses dirty unless policy allows; partial failure records unknown", async () => {
  const h = await makeHarness();
  const { fakes, lifecycle } = h;
  await lifecycle.create({
    taskId: "task-11",
    repositories: [
      { repositoryId: "app", branch: "b" },
      { repositoryId: "api", branch: "b" },
    ],
  });
  const appEntry = [...fakes.app!.worktrees.values()][0]!;
  appEntry.dirty = true;
  const error = await expectCode(lifecycle.cleanup({ taskId: "task-11" }), "ERR_PRISM_WORKSPACE_DIRTY");
  assert.match(error.message, /dirty/);
  assert.equal(fakes.app!.worktrees.size, 1, "refused tree stays");
  assert.equal(fakes.api!.worktrees.size, 0, "other tree still removed");
  const partial = await lifecycle.get({ taskId: "task-11" });
  assert.equal(partial!.state, "unknown");
  assert.equal(partial!.repositories.find((r) => r.repositoryId === "app")!.state, "unknown");
  assert.equal(partial!.repositories.find((r) => r.repositoryId === "api")!.state, "removed");
  // reconcile with a permissive policy over the same stores, root, and fake git
  const permissive = createCodingWorkspaceLifecycle({
    checkpoints: h.checkpoints,
    leases: h.leases,
    ownerId: "replica-1",
    ownership: { tenantId: "tenant-a" },
    repositories: { app: { root: fakes.app!.root, git: makeFakeOperations(fakes.app!) } },
    worktreeRoots: [h.worktreeRoot],
    policy: { allowDirtyCleanup: true },
  });
  const closed = await permissive.cleanup({ taskId: "task-11" });
  assert.equal(closed.state, "closed");
  assert.equal(fakes.app!.worktrees.size, 0);
});

test("cleanup refuses externally locked, missing, unowned, and mismatched trees", async () => {
  const { fakes, lifecycle } = await makeHarness();
  await lifecycle.create({ taskId: "task-12", repositories: [{ repositoryId: "app", branch: "b" }] });
  const record = await lifecycle.get({ taskId: "task-12" });
  const entry = [...fakes.app!.worktrees.values()][0]!;
  entry.lockReason = "someone-else";
  await expectCode(lifecycle.cleanup({ taskId: "task-12" }), "ERR_PRISM_WORKSPACE_LOCKED");
  entry.lockReason = `${WORKSPACE_LOCK_REASON_PREFIX}${record!.workspaceId}`;
  fakes.app!.worktrees.delete(entry.path);
  await expectCode(lifecycle.cleanup({ taskId: "task-12" }), "ERR_PRISM_WORKSPACE_UNKNOWN");
  await mkdir(entry.path, { recursive: true });
  await expectCode(lifecycle.cleanup({ taskId: "task-12" }), "ERR_PRISM_WORKSPACE_UNKNOWN");
  await rm(entry.path, { recursive: true, force: true });
  fakes.app!.worktrees.set(entry.path, { ...entry, head: OTHER_SHA, dirExists: true, dirty: false });
  await expectCode(lifecycle.cleanup({ taskId: "task-12" }), "ERR_PRISM_WORKSPACE_FINGERPRINT");
});

test("cleanup refuses the main worktree", async () => {
  const worktreeRoot = await mkdtemp(join(tmpdir(), "phase26-main-"));
  const appRoot = join(worktreeRoot, "app");
  await mkdir(appRoot);
  const fake = makeFakeGit(appRoot);
  const h = await makeHarness({
    worktreeRoots: [worktreeRoot],
    repositories: { app: { root: appRoot, git: makeFakeOperations(fake) } },
  });
  const record = await h.lifecycle.create({ taskId: "task-13", repositories: [{ repositoryId: "app", branch: "b" }] });
  await tamperRecord(h, record.workspaceId, (r) => ({
    ...r,
    repositories: r.repositories.map((repo) => ({ ...repo, worktreePath: repo.root })),
  }));
  await expectCode(h.lifecycle.cleanup({ taskId: "task-13" }), "ERR_PRISM_WORKSPACE_MAIN");
});

test("cleanup operation cap", async () => {
  const h = await makeHarness({ limits: { maxCleanupOperations: 1 } });
  await h.lifecycle.create({
    taskId: "task-14",
    repositories: [
      { repositoryId: "app", branch: "b" },
      { repositoryId: "api", branch: "b" },
    ],
  });
  await expectCode(h.lifecycle.cleanup({ taskId: "task-14" }), "ERR_PRISM_WORKSPACE_LIMIT");
  const partial = await h.lifecycle.get({ taskId: "task-14" });
  assert.equal(partial!.state, "unknown");
});

test("list and remove", async () => {
  const { lifecycle } = await makeHarness();
  await lifecycle.create({ taskId: "task-15", repositories: [{ repositoryId: "app", branch: "b" }] });
  await lifecycle.create({ taskId: "task-16", repositories: [{ repositoryId: "api", branch: "b" }] });
  const page = await lifecycle.list();
  assert.equal(page.items.length, 2);
  assert.equal(await lifecycle.remove({ taskId: "task-15" }), true);
  assert.equal(await lifecycle.remove({ taskId: "task-15" }), false);
  assert.equal(await lifecycle.get({ taskId: "task-15" }), null);
});
