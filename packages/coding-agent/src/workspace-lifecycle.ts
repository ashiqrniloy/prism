/**
 * Ownership-scoped multi-repository and worktree lifecycle (plan 026 Task 3).
 *
 * A durable coding workspace correlates task/session/run identity with host
 * repositories and linked worktrees. The lifecycle composes existing bounded
 * primitives only: `CheckpointStore` CAS records (versioned namespace, never
 * `CodingCheckpointMetadata` v1), `LeaseStore` fencing, and cwd-bound
 * `GitOperations` runners. There is no clone manager, Git library, watcher,
 * new database schema, or second task runtime.
 *
 * The main worktree of every registered repository is immutable through this
 * service: only linked worktrees created by `create` are ever locked,
 * verified, or removed. Roots, worktree destinations, and loaded records are
 * canonicalized and containment-checked under host-approved roots; remote
 * identity is stored as a credential-free fingerprint, never a URL.
 */
import { access, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  HARD_MAX_CODING_ARTIFACTS,
  HARD_MAX_WORKSPACE_CLEANUP_OPERATIONS,
  HARD_MAX_WORKSPACE_LEASE_TTL_MS,
  HARD_MAX_WORKSPACE_RECORD_BYTES,
  HARD_MAX_WORKSPACE_REPOSITORIES,
  HARD_MAX_WORKSPACE_WORKTREES,
  DEFAULT_MAX_CODING_ARTIFACTS,
  DEFAULT_MAX_WORKSPACE_CLEANUP_OPERATIONS,
  DEFAULT_MAX_WORKSPACE_LEASE_TTL_MS,
  DEFAULT_MAX_WORKSPACE_RECORD_BYTES,
  DEFAULT_MAX_WORKSPACE_REPOSITORIES,
  DEFAULT_MAX_WORKSPACE_WORKTREES,
  validateCodingLimit,
} from "./limits.js";
import { createHash } from "node:crypto";
import type { ArtifactReference, GitOperations } from "./git.js";

/** Separate versioned namespace: never collides with coding checkpoint v1 keys. */
export const WORKSPACE_NAMESPACE = "prism.coding-agent.workspace.v1" as const;
export const WORKSPACE_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_LOCK_REASON_PREFIX = "prism-workspace:" as const;

/** Frozen workspace state machine: active | cleaning | closed | unknown. */
export type WorkspaceState = "active" | "cleaning" | "closed" | "unknown";
export const WORKSPACE_STATES: readonly WorkspaceState[] = ["active", "cleaning", "closed", "unknown"];

export type WorkspaceRepositoryState = "active" | "removed" | "unknown";

export type WorkspaceErrorCode =
  | "ERR_PRISM_WORKSPACE_UNKNOWN"
  | "ERR_PRISM_WORKSPACE_LIMIT"
  | "ERR_PRISM_WORKSPACE_OWNERSHIP"
  | "ERR_PRISM_WORKSPACE_FENCE"
  | "ERR_PRISM_WORKSPACE_DIRTY"
  | "ERR_PRISM_WORKSPACE_LOCKED"
  | "ERR_PRISM_WORKSPACE_MAIN"
  | "ERR_PRISM_WORKSPACE_PATH_ESCAPE"
  | "ERR_PRISM_WORKSPACE_FINGERPRINT";

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

/** Host-approved repository registration; `git` must be cwd-bound to `root`. */
export interface WorkspaceRepositoryRegistration {
  readonly root: string;
  readonly git: GitOperations;
}

/** Durable per-repository leg of a workspace record. */
export interface WorkspaceRepositoryRecord {
  readonly repositoryId: string;
  /** Canonical absolute root; the main worktree is immutable. */
  readonly root: string;
  /** Credential-free remote fingerprint (sha256 hex), never a URL. */
  readonly remoteFingerprint: string;
  readonly defaultBranch?: string;
  readonly branch: string;
  /** Branch base at create time. */
  readonly base: string;
  /** Verified head at create/last verify. */
  readonly head: string;
  readonly worktreeId: string;
  readonly worktreePath: string;
  readonly state: WorkspaceRepositoryState;
  readonly createdAt: string;
}

/** Durable workspace record (schemaVersion 1, namespace WORKSPACE_NAMESPACE). */
export interface CodingWorkspaceRecord {
  readonly schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly taskId: string;
  readonly ownerId: string;
  readonly state: WorkspaceState;
  readonly repositories: readonly WorkspaceRepositoryRecord[];
  /** Artifact references only; never artifact contents or credentials. */
  readonly artifactRefs: readonly ArtifactReference[];
  /** Lease fencing token at last mutation; monotonic per record. */
  readonly fencingToken: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly cleanupAt?: string;
}

export interface WorkspaceCreateRequest {
  readonly taskId: string;
  readonly repositories: readonly { readonly repositoryId: string; readonly branch: string }[];
  readonly artifactRefs?: readonly ArtifactReference[];
  readonly signal?: AbortSignal;
}

/** Host policy gates the documented cleanup refusals; all default to refuse. */
export interface WorkspaceCleanupPolicy {
  /** Allow forced removal of dirty worktrees (potential data loss). */
  readonly allowDirtyCleanup?: boolean;
  /** Allow unlocking worktrees locked by an external actor. */
  readonly allowLockedCleanup?: boolean;
  /** Allow claiming a missing worktree as removed. */
  readonly allowMissingCleanup?: boolean;
  /** Allow unclaiming a path that exists but is not a registered worktree. */
  readonly allowUnownedCleanup?: boolean;
  /** Allow forced removal when the worktree head no longer matches the record. */
  readonly allowMismatchedCleanup?: boolean;
}

export interface WorkspaceLimitOptions {
  readonly maxRepositories?: number;
  readonly maxWorktrees?: number;
  readonly maxRecordBytes?: number;
  readonly leaseTtlMs?: number;
  readonly maxCleanupOperations?: number;
}

export interface ResolvedWorkspaceLimits {
  readonly maxRepositories: number;
  readonly maxWorktrees: number;
  readonly maxRecordBytes: number;
  readonly leaseTtlMs: number;
  readonly maxCleanupOperations: number;
}

export function resolveWorkspaceLimits(options?: WorkspaceLimitOptions): ResolvedWorkspaceLimits {
  return {
    maxRepositories: validateCodingLimit(
      "maxRepositories",
      options?.maxRepositories ?? DEFAULT_MAX_WORKSPACE_REPOSITORIES,
      HARD_MAX_WORKSPACE_REPOSITORIES,
    ),
    maxWorktrees: validateCodingLimit(
      "maxWorktrees",
      options?.maxWorktrees ?? DEFAULT_MAX_WORKSPACE_WORKTREES,
      HARD_MAX_WORKSPACE_WORKTREES,
    ),
    maxRecordBytes: validateCodingLimit(
      "maxRecordBytes",
      options?.maxRecordBytes ?? DEFAULT_MAX_WORKSPACE_RECORD_BYTES,
      HARD_MAX_WORKSPACE_RECORD_BYTES,
    ),
    leaseTtlMs: validateCodingLimit(
      "leaseTtlMs",
      options?.leaseTtlMs ?? DEFAULT_MAX_WORKSPACE_LEASE_TTL_MS,
      HARD_MAX_WORKSPACE_LEASE_TTL_MS,
    ),
    maxCleanupOperations: validateCodingLimit(
      "maxCleanupOperations",
      options?.maxCleanupOperations ?? DEFAULT_MAX_WORKSPACE_CLEANUP_OPERATIONS,
      HARD_MAX_WORKSPACE_CLEANUP_OPERATIONS,
    ),
  };
}

export interface CreateCodingWorkspaceLifecycleOptions {
  readonly checkpoints: import("@arnilo/prism").CheckpointStore;
  readonly leases: import("@arnilo/prism").LeaseStore;
  /** Replica/worker identity; part of the fencing trust boundary. */
  readonly ownerId: string;
  readonly ownership?: import("@arnilo/prism").OwnershipScope;
  /** Host-approved repositories keyed by repositoryId. */
  readonly repositories: Readonly<Record<string, WorkspaceRepositoryRegistration>>;
  /** Host-approved linked-worktree destination roots (canonicalized). */
  readonly worktreeRoots: readonly string[];
  readonly policy?: WorkspaceCleanupPolicy;
  readonly limits?: WorkspaceLimitOptions;
}

export interface CodingWorkspaceLifecycle {
  /**
   * Create linked worktrees for a task and persist the workspace record.
   * Idempotent: an identical active record returns as-is (no Git mutation).
   * Stale or conflicting workers fail with ERR_PRISM_WORKSPACE_FENCE.
   */
  create(request: WorkspaceCreateRequest): Promise<CodingWorkspaceRecord>;
  get(input: { readonly taskId: string; readonly signal?: AbortSignal }): Promise<CodingWorkspaceRecord | null>;
  list(input?: { readonly cursor?: string; readonly limit?: number; readonly signal?: AbortSignal }): Promise<{
    readonly items: readonly CodingWorkspaceRecord[];
    readonly nextCursor?: string;
  }>;
  /**
   * Resume gate: revalidates repository/worktree identity and fingerprints
   * (root containment, worktree presence, head, remote/default-branch) before
   * tools, processes, index results, patches, or artifacts are reused.
   */
  verify(input: { readonly taskId: string; readonly signal?: AbortSignal }): Promise<CodingWorkspaceRecord>;
  attachArtifacts(input: {
    readonly taskId: string;
    readonly artifactRefs: readonly ArtifactReference[];
    readonly signal?: AbortSignal;
  }): Promise<CodingWorkspaceRecord>;
  /**
   * Remove owned linked worktrees and close the record. Refuses dirty, locked,
   * unowned, missing, or mismatched trees unless the host policy allows the
   * documented action; partial failure persists state `unknown` and remains
   * reconcilable by retrying.
   */
  cleanup(input: { readonly taskId: string; readonly signal?: AbortSignal }): Promise<CodingWorkspaceRecord>;
  /** Delete the durable record (no Git mutation); false when absent. */
  remove(input: { readonly taskId: string; readonly signal?: AbortSignal }): Promise<boolean>;
}

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const REPOSITORY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BRANCH = /^[^\s]{1,255}$/;
const SHA_HEX = /^[0-9a-f]{40,64}$/i;
const FINGERPRINT_HEX = /^[0-9a-f]{64}$/i;
const ARTIFACT_KINDS = new Set(["patch", "bundle", "diff", "other"]);
const MAX_ARTIFACT_URI_BYTES = 2048;
const MAX_OWNER_ID_BYTES = 512;
function workspaceIdForTask(taskId: string): string {
  return `ws-${createHash("sha256").update(taskId).digest("hex").slice(0, 24)}`;
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function createCodingWorkspaceLifecycle(options: CreateCodingWorkspaceLifecycleOptions): CodingWorkspaceLifecycle {
  const limits = resolveWorkspaceLimits(options.limits);
  const policy = {
    allowDirtyCleanup: options.policy?.allowDirtyCleanup === true,
    allowLockedCleanup: options.policy?.allowLockedCleanup === true,
    allowMissingCleanup: options.policy?.allowMissingCleanup === true,
    allowUnownedCleanup: options.policy?.allowUnownedCleanup === true,
    allowMismatchedCleanup: options.policy?.allowMismatchedCleanup === true,
  };
  if (
    typeof options.ownerId !== "string" ||
    options.ownerId.length === 0 ||
    Buffer.byteLength(options.ownerId, "utf8") > MAX_OWNER_ID_BYTES
  ) {
    throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", "ownerId must be a non-empty bounded string");
  }
  const registrations: ReadonlyMap<string, WorkspaceRepositoryRegistration> = new Map(
    Object.entries(options.repositories).map(([id, registration]) => {
      if (!REPOSITORY_ID.test(id)) throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", `invalid repositoryId: ${id}`);
      if (typeof registration?.root !== "string" || !isAbsolute(registration.root)) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_PATH_ESCAPE", `repository ${id} root must be an absolute path`);
      }
      if (!registration.git || typeof registration.git.worktree !== "function") {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", `repository ${id} has no bounded GitOperations`);
      }
      return [id, registration] as const;
    }),
  );
  if (registrations.size === 0) throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", "at least one repository registration is required");
  /** Sync resolve-based containment roots; realpath hardening runs on verify/cleanup. */
  const resolvedWorktreeRoots: readonly string[] = (options.worktreeRoots ?? []).map((root) => resolve(root));

  /** Canonicalized host-approved worktree destinations; captured lazily and cached. */
  let canonicalWorktreeRoots: readonly string[] | undefined;
  async function worktreeRoots(): Promise<readonly string[]> {
    if (canonicalWorktreeRoots) return canonicalWorktreeRoots;
    if (!options.worktreeRoots || options.worktreeRoots.length === 0) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", "at least one worktree root is required");
    }
    const roots: string[] = [];
    for (const raw of options.worktreeRoots) {
      if (typeof raw !== "string" || !isAbsolute(raw)) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_PATH_ESCAPE", "worktree roots must be absolute paths");
      }
      let canon: string;
      try {
        canon = await realpath(raw);
      } catch {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_PATH_ESCAPE", `worktree root does not exist: ${raw}`);
      }
      if (!roots.some((existing) => existing === canon)) roots.push(canon);
    }
    canonicalWorktreeRoots = roots;
    return roots;
  }

  async function canonicalRepositoryRoots(): Promise<Map<string, string>> {
    const roots = new Map<string, string>();
    for (const [id, registration] of registrations) {
      let canon: string;
      try {
        canon = await realpath(registration.root);
      } catch {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", `repository ${id} root does not exist`);
      }
      roots.set(id, canon);
    }
    return roots;
  }

  async function assertWorktreeContained(worktreePath: string): Promise<string> {
    const roots = await worktreeRoots();
    const resolved = resolve(worktreePath);
    for (const root of roots) {
      if (isInside(root, resolved)) return root;
    }
    throw new WorkspaceError("ERR_PRISM_WORKSPACE_PATH_ESCAPE", `worktree path escapes the approved roots: ${worktreePath}`);
  }

  function leaseKey(workspaceId: string) {
    return { namespace: WORKSPACE_NAMESPACE, key: workspaceId, ...options.ownership };
  }
  function checkpointKey(workspaceId: string) {
    return { namespace: WORKSPACE_NAMESPACE, key: workspaceId, ...options.ownership };
  }

  async function acquireLease(workspaceId: string, signal?: AbortSignal) {
    let lease: import("@arnilo/prism").LeaseRecord | null;
    try {
      lease = await options.leases.tryAcquireLease({
        ...leaseKey(workspaceId),
        ownerId: options.ownerId,
        ttlMs: limits.leaseTtlMs,
        signal,
      });
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_OWNERSHIP", "workspace lease ownership mismatch");
    }
    if (!lease) throw new WorkspaceError("ERR_PRISM_WORKSPACE_FENCE", "another worker holds the workspace lease");
    return lease;
  }

  async function releaseLease(workspaceId: string, token: string): Promise<void> {
    await options.leases.releaseLease({ ...leaseKey(workspaceId), ownerId: options.ownerId, token });
  }

  function validateArtifactRefs(refs: readonly ArtifactReference[]): void {
    if (!Array.isArray(refs) || refs.length > DEFAULT_MAX_CODING_ARTIFACTS) {
      throw new WorkspaceError(
        "ERR_PRISM_WORKSPACE_LIMIT",
        `artifact refs exceed ${DEFAULT_MAX_CODING_ARTIFACTS} (hard ${HARD_MAX_CODING_ARTIFACTS})`,
      );
    }
    for (const ref of refs) {
      if (!ref || !ARTIFACT_KINDS.has(ref.kind)) throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", "invalid artifact kind");
      if (typeof ref.uri !== "string" || Buffer.byteLength(ref.uri, "utf8") > MAX_ARTIFACT_URI_BYTES) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", "artifact uri must be a bounded string");
      }
      if (typeof ref.sha256 !== "string" || !FINGERPRINT_HEX.test(ref.sha256)) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", "artifact sha256 must be a sha256 hex digest");
      }
      if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 0) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", "artifact bytes must be a non-negative safe integer");
      }
    }
  }

  function validateRecord(value: unknown): CodingWorkspaceRecord {
    if (!value || typeof value !== "object") throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed workspace record");
    const record = value as CodingWorkspaceRecord;
    if (record.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", `unsupported workspace schemaVersion: ${String(record.schemaVersion)}`);
    }
    if (typeof record.workspaceId !== "string" || !record.workspaceId.startsWith("ws-")) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed workspaceId");
    }
    if (typeof record.taskId !== "string" || !TASK_ID.test(record.taskId)) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed taskId");
    }
    if (typeof record.ownerId !== "string" || record.ownerId.length === 0 || record.ownerId.length > MAX_OWNER_ID_BYTES) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed ownerId");
    }
    if (!WORKSPACE_STATES.includes(record.state))
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", `unknown workspace state: ${String(record.state)}`);
    if (!Array.isArray(record.repositories) || record.repositories.length === 0 || record.repositories.length > limits.maxRepositories) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed repository list");
    }
    const seen = new Set<string>();
    for (const repo of record.repositories) {
      if (typeof repo?.repositoryId !== "string" || !REPOSITORY_ID.test(repo.repositoryId)) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed repositoryId");
      }
      if (seen.has(repo.repositoryId)) throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "duplicate repositoryId");
      seen.add(repo.repositoryId);
      if (typeof repo.root !== "string" || !isAbsolute(repo.root))
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed repository root");
      if (typeof repo.remoteFingerprint !== "string" || !FINGERPRINT_HEX.test(repo.remoteFingerprint)) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed remote fingerprint");
      }
      if (repo.defaultBranch !== undefined && (typeof repo.defaultBranch !== "string" || !BRANCH.test(repo.defaultBranch))) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed default branch");
      }
      if (typeof repo.branch !== "string" || !BRANCH.test(repo.branch))
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed branch");
      if (typeof repo.base !== "string" || !SHA_HEX.test(repo.base))
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed base");
      if (typeof repo.head !== "string" || !SHA_HEX.test(repo.head))
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed head");
      if (typeof repo.worktreeId !== "string" || !repo.worktreeId.startsWith(record.workspaceId)) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed worktreeId");
      }
      if (typeof repo.worktreePath !== "string" || !isAbsolute(repo.worktreePath)) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed worktree path");
      }
      if (!resolvedWorktreeRoots.some((root) => isInside(root, resolve(repo.worktreePath)))) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_PATH_ESCAPE", "worktree path escapes the approved roots");
      }
      if (!["active", "removed", "unknown"].includes(repo.state)) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", `unknown repository state: ${String(repo.state)}`);
      }
      if (typeof repo.createdAt !== "string" || Number.isNaN(Date.parse(repo.createdAt))) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed createdAt");
      }
    }
    validateArtifactRefs(record.artifactRefs ?? []);
    if (!Number.isSafeInteger(record.fencingToken) || record.fencingToken < 0) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed fencing token");
    }
    if (typeof record.createdAt !== "string" || Number.isNaN(Date.parse(record.createdAt))) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed createdAt");
    }
    if (typeof record.updatedAt !== "string" || Number.isNaN(Date.parse(record.updatedAt))) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed updatedAt");
    }
    if (record.cleanupAt !== undefined && (typeof record.cleanupAt !== "string" || Number.isNaN(Date.parse(record.cleanupAt)))) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "malformed cleanupAt");
    }
    const encoded = Buffer.byteLength(JSON.stringify(record), "utf8");
    if (encoded > limits.maxRecordBytes) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", `workspace record exceeds ${limits.maxRecordBytes} bytes`);
    }
    return record;
  }

  async function loadCheckpointRecord(
    workspaceId: string,
    signal?: AbortSignal,
  ): Promise<{
    readonly record: CodingWorkspaceRecord;
    readonly version: number;
  } | null> {
    let checkpoint: import("@arnilo/prism").CheckpointRecord | null;
    try {
      checkpoint = await options.checkpoints.loadCheckpoint({ ...checkpointKey(workspaceId), signal });
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      // Ownership mismatch and store conflicts fail closed under one stable code.
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_OWNERSHIP", "workspace record access failed (ownership or store conflict)");
    }
    if (!checkpoint) return null;
    return { record: validateRecord(checkpoint.value), version: checkpoint.version };
  }

  async function loadRecord(workspaceId: string, signal?: AbortSignal): Promise<CodingWorkspaceRecord | null> {
    const loaded = await loadCheckpointRecord(workspaceId, signal);
    return loaded ? loaded.record : null;
  }

  async function saveRecord(
    record: CodingWorkspaceRecord,
    version: number,
    expectedVersion: number,
    fencingToken: number,
    signal?: AbortSignal,
  ): Promise<CodingWorkspaceRecord> {
    const encoded = Buffer.byteLength(JSON.stringify(record), "utf8");
    if (encoded > limits.maxRecordBytes) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", `workspace record exceeds ${limits.maxRecordBytes} bytes`);
    }
    try {
      await options.checkpoints.saveCheckpoint({
        ...checkpointKey(record.workspaceId),
        version,
        expectedVersion,
        fencingToken,
        value: record,
        category: "coding-workspace",
        signal,
      });
    } catch {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_FENCE", "workspace checkpoint CAS or fencing conflict");
    }
    return record;
  }

  async function verifyRepositoryIdentity(repo: WorkspaceRepositoryRecord, signal?: AbortSignal): Promise<void> {
    const registration = registrations.get(repo.repositoryId);
    if (!registration)
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", `repository ${repo.repositoryId} is not registered on this host`);
    let rootNow: string;
    try {
      rootNow = await realpath(registration.root);
    } catch {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_FINGERPRINT", `repository ${repo.repositoryId} root is gone`);
    }
    if (rootNow !== repo.root) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_PATH_ESCAPE", `repository ${repo.repositoryId} root moved (${rootNow})`);
    }
    await assertWorktreeContained(repo.worktreePath);
    const fingerprint = await registration.git.fingerprint({ signal });
    if (
      fingerprint.remoteFingerprint !== repo.remoteFingerprint ||
      (fingerprint.defaultBranch ?? undefined) !== (repo.defaultBranch ?? undefined)
    ) {
      throw new WorkspaceError(
        "ERR_PRISM_WORKSPACE_FINGERPRINT",
        `repository ${repo.repositoryId} remote/default-branch fingerprint changed`,
      );
    }
    const listed = await registration.git.worktree({ action: "list", signal });
    const entry = listed.worktrees.find((worktree) => worktree.path === repo.worktreePath);
    if (!entry)
      throw new WorkspaceError(
        "ERR_PRISM_WORKSPACE_FINGERPRINT",
        `worktree ${repo.worktreePath} is not registered to repository ${repo.repositoryId}`,
      );
    if (entry.head && entry.head !== repo.head) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_FINGERPRINT", `worktree ${repo.worktreePath} head changed`);
    }
  }

  async function create(request: WorkspaceCreateRequest): Promise<CodingWorkspaceRecord> {
    if (!request || typeof request.taskId !== "string" || !TASK_ID.test(request.taskId)) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", "taskId has invalid format");
    }
    if (!Array.isArray(request.repositories) || request.repositories.length === 0) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", "at least one repository is required");
    }
    if (request.repositories.length > limits.maxRepositories) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", `workspace exceeds ${limits.maxRepositories} repositories`);
    }
    if (request.repositories.length > limits.maxWorktrees) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", `workspace exceeds ${limits.maxWorktrees} worktrees`);
    }
    const requested = request.repositories.map((item) => {
      if (!REPOSITORY_ID.test(item.repositoryId)) throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", "invalid repositoryId");
      if (typeof item.branch !== "string" || !BRANCH.test(item.branch) || item.branch.includes("..") || item.branch.startsWith("-")) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", "invalid branch name");
      }
      return { repositoryId: item.repositoryId, branch: item.branch };
    });
    const repositoryIds = new Set(requested.map((item) => item.repositoryId));
    if (repositoryIds.size !== requested.length) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", "duplicate repositoryId in request");
    }
    for (const id of repositoryIds) {
      if (!registrations.has(id)) throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", `unknown repositoryId: ${id}`);
    }
    validateArtifactRefs(request.artifactRefs ?? []);

    const workspaceId = workspaceIdForTask(request.taskId);
    const existing = await loadRecord(workspaceId, request.signal);
    if (existing) {
      const sameSet =
        existing.repositories.length === requested.length &&
        requested.every((item) =>
          existing.repositories.some(
            (repo) => repo.repositoryId === item.repositoryId && repo.branch === item.branch && repo.state === "active",
          ),
        );
      if (existing.state === "active" && sameSet) return existing; // idempotent duplicate create
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_FENCE", `workspace exists in state ${existing.state}; remove or clean it first`);
    }

    const lease = await acquireLease(workspaceId, request.signal);
    try {
      const roots = await canonicalRepositoryRoots();
      const now = new Date().toISOString();
      const repositories: WorkspaceRepositoryRecord[] = [];
      const worktreeRoot = (await worktreeRoots())[0]!;
      for (const item of requested) {
        const registration = registrations.get(item.repositoryId)!;
        const root = roots.get(item.repositoryId)!;
        const fingerprint = await registration.git.fingerprint({ signal: request.signal });
        const worktreeId = `${workspaceId}-${item.repositoryId}`;
        const worktreePath = join(worktreeRoot, worktreeId);
        await assertWorktreeContained(worktreePath);
        // Retry-after-crash: a worktree already added by a previous attempt is reused.
        const listed = await registration.git.worktree({ action: "list", signal: request.signal });
        const existingTree = listed.worktrees.find((entry) => entry.path === worktreePath);
        let head: string | undefined = existingTree?.head;
        if (!existingTree) {
          await registration.git.worktree({ action: "add", path: worktreePath, branch: item.branch, signal: request.signal });
          const afterAdd = await registration.git.worktree({ action: "list", signal: request.signal });
          head = afterAdd.worktrees.find((entry) => entry.path === worktreePath)?.head;
        }
        await registration.git.worktree({
          action: "lock",
          path: worktreePath,
          reason: `${WORKSPACE_LOCK_REASON_PREFIX}${workspaceId}`,
          signal: request.signal,
        });
        if (!head) throw new WorkspaceError("ERR_PRISM_WORKSPACE_FINGERPRINT", `could not determine head for ${worktreePath}`);
        repositories.push({
          repositoryId: item.repositoryId,
          root,
          remoteFingerprint: fingerprint.remoteFingerprint,
          defaultBranch: fingerprint.defaultBranch,
          branch: item.branch,
          base: head,
          head,
          worktreeId,
          worktreePath,
          state: "active",
          createdAt: now,
        });
      }
      const record = validateRecord({
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        workspaceId,
        taskId: request.taskId,
        ownerId: options.ownerId,
        state: "active",
        repositories,
        artifactRefs: request.artifactRefs ?? [],
        fencingToken: lease.fencingToken,
        createdAt: now,
        updatedAt: now,
      });
      await saveRecord(record, 1, 0, lease.fencingToken, request.signal);
      return record;
    } finally {
      await releaseLease(workspaceId, lease.token);
    }
  }

  async function get(input: { readonly taskId: string; readonly signal?: AbortSignal }): Promise<CodingWorkspaceRecord | null> {
    if (typeof input?.taskId !== "string" || !TASK_ID.test(input.taskId)) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", "taskId has invalid format");
    }
    return loadRecord(workspaceIdForTask(input.taskId), input.signal);
  }

  async function list(input?: { readonly cursor?: string; readonly limit?: number; readonly signal?: AbortSignal }): Promise<{
    readonly items: readonly CodingWorkspaceRecord[];
    readonly nextCursor?: string;
  }> {
    const page = await options.checkpoints.listCheckpoints({
      ...options.ownership,
      namespace: WORKSPACE_NAMESPACE,
      category: "coding-workspace",
      cursor: input?.cursor,
      limit: input?.limit ?? 100,
      signal: input?.signal,
    });
    return { items: page.items.map((item) => validateRecord(item.value)), nextCursor: page.nextCursor };
  }

  async function verify(input: { readonly taskId: string; readonly signal?: AbortSignal }): Promise<CodingWorkspaceRecord> {
    const workspaceId = workspaceIdForTask(input.taskId);
    const record = await loadRecord(workspaceId, input.signal);
    if (!record) throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", `workspace for task ${input.taskId} not found`);
    if (record.state !== "active") {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_FENCE", `workspace state ${record.state} does not allow resume verification`);
    }
    for (const repo of record.repositories) {
      if (repo.state === "removed") continue;
      await verifyRepositoryIdentity(repo, input.signal);
    }
    return record;
  }

  async function attachArtifacts(input: {
    readonly taskId: string;
    readonly artifactRefs: readonly ArtifactReference[];
    readonly signal?: AbortSignal;
  }): Promise<CodingWorkspaceRecord> {
    validateArtifactRefs(input.artifactRefs ?? []);
    const workspaceId = workspaceIdForTask(input.taskId);
    const existing = await loadRecord(workspaceId, input.signal);
    if (!existing) throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", `workspace for task ${input.taskId} not found`);
    if (existing.state !== "active") {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_FENCE", `workspace state ${existing.state} does not allow artifact attachment`);
    }
    const lease = await acquireLease(workspaceId, input.signal);
    try {
      const loaded = await loadCheckpointRecord(workspaceId, input.signal);
      if (!loaded) throw new WorkspaceError("ERR_PRISM_WORKSPACE_FENCE", "workspace record vanished during artifact attach");
      const merged = [...loaded.record.artifactRefs, ...input.artifactRefs];
      if (merged.length > HARD_MAX_CODING_ARTIFACTS) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", `artifact refs exceed hard cap ${HARD_MAX_CODING_ARTIFACTS}`);
      }
      const updated: CodingWorkspaceRecord = validateRecord({
        ...loaded.record,
        artifactRefs: merged,
        updatedAt: new Date().toISOString(),
      });
      return await saveRecord(updated, loaded.version + 1, loaded.version, lease.fencingToken, input.signal);
    } finally {
      await releaseLease(workspaceId, lease.token);
    }
  }

  async function cleanup(input: { readonly taskId: string; readonly signal?: AbortSignal }): Promise<CodingWorkspaceRecord> {
    const workspaceId = workspaceIdForTask(input.taskId);
    const existing = await loadRecord(workspaceId, input.signal);
    if (!existing) throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", `workspace for task ${input.taskId} not found`);
    if (existing.state === "closed") return existing; // idempotent
    if (existing.state === "cleaning") {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_FENCE", "another worker is already cleaning this workspace");
    }
    const lease = await acquireLease(workspaceId, input.signal);
    try {
      const loaded = await loadCheckpointRecord(workspaceId, input.signal);
      if (!loaded) throw new WorkspaceError("ERR_PRISM_WORKSPACE_FENCE", "workspace record vanished during cleanup");
      const current = loaded.record;
      const cleaning: CodingWorkspaceRecord = validateRecord({ ...current, state: "cleaning", updatedAt: new Date().toISOString() });
      await saveRecord(cleaning, loaded.version + 1, loaded.version, lease.fencingToken, input.signal);

      let operations = 0;
      const failures: WorkspaceError[] = [];
      const nextRepos: WorkspaceRepositoryRecord[] = [];
      for (const repo of current.repositories) {
        if (repo.state === "removed") {
          nextRepos.push(repo);
          continue;
        }
        operations += 1;
        if (operations > limits.maxCleanupOperations) {
          failures.push(new WorkspaceError("ERR_PRISM_WORKSPACE_LIMIT", `cleanup exceeds ${limits.maxCleanupOperations} operations`));
          nextRepos.push({ ...repo, state: "unknown" });
          continue;
        }
        try {
          await removeWorktree(repo, input.signal);
          nextRepos.push({ ...repo, state: "removed" });
        } catch (error) {
          const failure = error instanceof WorkspaceError ? error : new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", "cleanup failed");
          failures.push(failure);
          nextRepos.push({ ...repo, state: "unknown" });
        }
      }
      const succeeded = failures.length === 0;
      const updated: CodingWorkspaceRecord = validateRecord({
        ...current,
        state: succeeded ? "closed" : "unknown",
        repositories: nextRepos,
        cleanupAt: succeeded ? new Date().toISOString() : undefined,
        updatedAt: new Date().toISOString(),
      });
      await saveRecord(updated, loaded.version + 2, loaded.version + 1, lease.fencingToken, input.signal);
      if (failures.length > 0) throw failures[0]!;
      return updated;
    } finally {
      await releaseLease(workspaceId, lease.token);
    }
  }

  async function removeWorktree(repo: WorkspaceRepositoryRecord, signal?: AbortSignal): Promise<void> {
    const registration = registrations.get(repo.repositoryId);
    if (!registration)
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_UNKNOWN", `repository ${repo.repositoryId} is not registered on this host`);
    if (repo.worktreePath === repo.root) {
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_MAIN", `refusing to remove the main worktree of repository ${repo.repositoryId}`);
    }
    await assertWorktreeContained(repo.worktreePath);
    const listed = await registration.git.worktree({ action: "list", signal });
    const entry = listed.worktrees.find((worktree) => worktree.path === repo.worktreePath);
    let existsOnDisk = true;
    try {
      await access(repo.worktreePath);
    } catch {
      existsOnDisk = false;
    }
    if (!entry) {
      if (!existsOnDisk) {
        if (!policy.allowMissingCleanup) {
          throw new WorkspaceError(
            "ERR_PRISM_WORKSPACE_UNKNOWN",
            `worktree ${repo.worktreePath} is missing; cleanup refused (allowMissingCleanup)`,
          );
        }
        return; // claimed as removed; nothing on disk or in git
      }
      if (!policy.allowUnownedCleanup) {
        throw new WorkspaceError(
          "ERR_PRISM_WORKSPACE_UNKNOWN",
          `path ${repo.worktreePath} exists but is not a registered worktree; cleanup refused (allowUnownedCleanup)`,
        );
      }
      return; // documented action: unclaim without touching the foreign directory
    }
    if (entry.locked && !isOwnLock(entry.lockReason, repo.worktreePath)) {
      if (!policy.allowLockedCleanup) {
        throw new WorkspaceError("ERR_PRISM_WORKSPACE_LOCKED", `worktree ${repo.worktreePath} is locked by an external actor`);
      }
      await registration.git.worktree({ action: "unlock", path: repo.worktreePath, signal });
    } else if (entry.locked) {
      await registration.git.worktree({ action: "unlock", path: repo.worktreePath, signal });
    }
    if (entry.head && entry.head !== repo.head && !policy.allowMismatchedCleanup) {
      throw new WorkspaceError(
        "ERR_PRISM_WORKSPACE_FINGERPRINT",
        `worktree ${repo.worktreePath} head no longer matches the record; cleanup refused (allowMismatchedCleanup)`,
      );
    }
    try {
      await registration.git.worktree({ action: "remove", path: repo.worktreePath, signal });
    } catch {
      if (policy.allowDirtyCleanup) {
        await registration.git.worktree({ action: "remove", path: repo.worktreePath, force: true, signal });
        return;
      }
      throw new WorkspaceError("ERR_PRISM_WORKSPACE_DIRTY", `worktree ${repo.worktreePath} is dirty; cleanup refused (allowDirtyCleanup)`);
    }
  }

  function isOwnLock(reason: string | undefined, worktreePath: string): boolean {
    if (!reason) return false;
    // Reconstruct the workspace id from the worktree path (ws-<sha>-<repoId>).
    const base = worktreePath.split(sep).pop() ?? "";
    const dash = base.lastIndexOf("-");
    const workspaceId = dash > 0 ? base.slice(0, dash) : "";
    return workspaceId.startsWith("ws-") && reason === `${WORKSPACE_LOCK_REASON_PREFIX}${workspaceId}`;
  }

  async function remove(input: { readonly taskId: string; readonly signal?: AbortSignal }): Promise<boolean> {
    const workspaceId = workspaceIdForTask(input.taskId);
    const existing = await loadRecord(workspaceId, input.signal);
    if (!existing) return false;
    const lease = await acquireLease(workspaceId, input.signal);
    try {
      const deleted = await options.checkpoints.deleteCheckpoint({ ...checkpointKey(workspaceId), signal: input.signal });
      if (!deleted) throw new WorkspaceError("ERR_PRISM_WORKSPACE_FENCE", "workspace record vanished during remove");
      return true;
    } finally {
      await releaseLease(workspaceId, lease.token);
    }
  }

  return { create, get, list, verify, attachArtifacts, cleanup, remove };
}
