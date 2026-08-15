# Coding workspaces

Ownership-scoped multi-repository and worktree lifecycle (plan 026 Task 3, `@arnilo/prism-coding-agent`). A durable coding workspace correlates task/session/run identity with host repositories and linked worktrees so that resume, cleanup, artifacts, and recovery stay bounded and reconcilable.

The lifecycle composes existing bounded primitives only: `CheckpointStore` CAS records in a separate versioned namespace (`prism.coding-agent.workspace.v1`), `LeaseStore` fencing, and cwd-bound `GitOperations` runners. There is no clone manager, Git library, watcher, new database schema, or second task runtime.

## Activation

```ts
import { createCodingWorkspaceLifecycle } from "@arnilo/prism-coding-agent";

const workspaces = createCodingWorkspaceLifecycle({
  checkpoints,                 // CheckpointStore (ownership-scoped)
  leases,                      // LeaseStore
  ownerId: replicaId,          // worker/replica identity
  ownership: { tenantId },     // part of the trust boundary
  repositories: {
    app: { root: "/src/app", git: appGit },   // git must be cwd-bound to root
    api: { root: "/src/api", git: apiGit },
  },
  worktreeRoots: ["/work/prism"],             // host-approved linked-worktree roots
  policy: { allowDirtyCleanup: false },       // all cleanup refusals default to refuse
});

const workspace = await workspaces.create({
  taskId: "task-42",
  repositories: [{ repositoryId: "app", branch: "agent/task-42" }],
});
```

Nothing starts on import or construction; worktrees are created only by explicit `create` calls. Repository roots and worktree roots are canonicalized (`realpath`) and containment-checked; the main worktree of every registered repository is immutable through this service.

## Record

`CodingWorkspaceRecord` (schemaVersion 1) holds: stable `workspaceId` (deterministic from `taskId`) and `taskId`; `ownerId`; frozen state `active | cleaning | closed | unknown`; per-repository legs with repository id, canonical root, credential-free remote fingerprint (sha256 of the redacted remote URL plus default branch — never a URL), default branch, task branch, base/head shas, worktree id/path, repository state `active | removed | unknown`, created timestamp; artifact references only (kind/uri/sha256/bytes, never contents); fencing token; created/updated/cleanup timestamps. Records are bounded (64 KiB default / 256 KiB hard).

## Operations

- `create({ taskId, repositories, artifactRefs? })` — validates task/repository/branch identity, acquires a lease, captures fingerprints, adds one linked worktree per repository (`git worktree add -b`), locks each with `prism-workspace:<id>` reason, and persists the record with a fencing-token CAS write. Duplicate create with an identical active record returns it as-is with no Git mutation; a conflicting request, a live foreign lease, or a CAS/fence conflict fails with `ERR_PRISM_WORKSPACE_FENCE`. A worktree left behind by a crashed earlier attempt is reused.
- `get({ taskId })` / `list({ cursor?, limit? })` — bounded reads; malformed or escaped records fail closed.
- `verify({ taskId })` — resume gate: revalidates repository root containment, worktree containment, worktree presence and head, and the remote/default-branch fingerprint before tools, processes, index results, patches, or artifacts are reused. Any change fails with `ERR_PRISM_WORKSPACE_FINGERPRINT` / `ERR_PRISM_WORKSPACE_PATH_ESCAPE`.
- `attachArtifacts({ taskId, artifactRefs })` — bounded CAS update of artifact refs (16 default / 64 hard refs).
- `cleanup({ taskId })` — removes owned linked worktrees and closes the record. Idempotent on `closed`; refuses while another worker cleans (`cleaning`); every mutation takes the lease and writes with a monotonic fencing token.
- `remove({ taskId })` — deletes the durable record only; never touches Git.

## Cleanup refusals

Cleanup refuses, unless the host policy explicitly allows the documented action:

- dirty worktree — `ERR_PRISM_WORKSPACE_DIRTY` (`allowDirtyCleanup` → forced removal, potential data loss);
- externally locked worktree — `ERR_PRISM_WORKSPACE_LOCKED` (`allowLockedCleanup`); locks owned by this service (`prism-workspace:<id>` reason) are always released first;
- missing worktree — `ERR_PRISM_WORKSPACE_UNKNOWN` (`allowMissingCleanup` → claim as removed);
- unowned path (exists on disk but is not a registered worktree) — `ERR_PRISM_WORKSPACE_UNKNOWN` (`allowUnownedCleanup` → unclaim without touching the foreign directory);
- mismatched head — `ERR_PRISM_WORKSPACE_FINGERPRINT` (`allowMismatchedCleanup` → forced removal);
- main-worktree path — always `ERR_PRISM_WORKSPACE_MAIN`, no policy overrides.

Partial failure persists state `unknown` with per-repository `unknown`/`removed` legs and remains reconcilable: retrying cleanup converges to `closed`.

## Ownership and fencing

Ownership scopes are part of the trust boundary: records are read and written under the configured `tenantId`/`accountId`/`userId`, and lease acquisition under another scope fails closed as `ERR_PRISM_WORKSPACE_OWNERSHIP`. Every mutation runs under a `LeaseStore` lease (`tryAcquireLease`/`releaseLease`, TTL 30 s default / 300 s hard); the lease fencing token is stored in the record and each `CheckpointStore` save is a version CAS plus a monotonic fencing-token check, so a worker whose lease lapsed or was fenced out cannot overwrite newer state. Stale workers reject deterministically with `ERR_PRISM_WORKSPACE_FENCE`.

## Errors

`ERR_PRISM_WORKSPACE_UNKNOWN`, `ERR_PRISM_WORKSPACE_LIMIT`, `ERR_PRISM_WORKSPACE_OWNERSHIP`, `ERR_PRISM_WORKSPACE_FENCE`, `ERR_PRISM_WORKSPACE_DIRTY`, `ERR_PRISM_WORKSPACE_LOCKED`, `ERR_PRISM_WORKSPACE_MAIN`, `ERR_PRISM_WORKSPACE_PATH_ESCAPE`, `ERR_PRISM_WORKSPACE_FINGERPRINT` (`WorkspaceError`).

## Caps

Repositories per task 4 / 16; worktrees 4 / 16 (git caps); record bytes 65536 / 262144; lease TTL 30000 / 300000 ms; cleanup operations 100 / 1000; artifact refs 16 / 64; artifact uri 2048 bytes; task id 128 bytes; repository id 64 bytes. Cleanup is O(worktrees owned by one task); there is no per-file worktree scan and no global timer.
