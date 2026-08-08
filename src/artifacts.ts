import type { OwnershipScope } from "./contracts.js";

/**
 * Durable artifact co-work review types (Phase 9 / 0.0.14). Core exports types only;
 * the service + delivery-link signer live in `@arnilo/prism-server`. Prism persists bounded
 * metadata, revisions, approvals, and delivery references — never file bodies (hosts own blobs).
 */

/** Review state of an artifact's latest revision. */
export type ArtifactApprovalState = "pending" | "approved" | "rejected";

/** A resolved decision on one revision (pending is the absence of a decision). */
export type ArtifactDecisionState = Exclude<ArtifactApprovalState, "pending">;

/** Bounded citation / data-source reference. Host resolves the body; Prism stores the ref only. */
export interface ArtifactCitation {
  readonly uri: string;
  readonly title?: string;
  /** Data-source kind (e.g. "web", "database", "upload"); host-defined, bounded. */
  readonly kind?: string;
}

/** One immutable revision of an artifact. `uri`/`hash` reference host-owned content. */
export interface ArtifactRevision {
  /** 1-based, monotonic within the artifact. */
  readonly version: number;
  /** Host-owned blob reference (redacted; never a local filesystem path). */
  readonly uri: string;
  readonly mime: string;
  /** Host-computed content hash for integrity compare. */
  readonly hash: string;
  /** Expected body byte length; required when a blob store is wired for delivery. */
  readonly size?: number;
  readonly changeNote?: string;
  /** Run that produced this revision, if any. */
  readonly producerRunId?: string;
  readonly citations?: readonly ArtifactCitation[];
  /** Preview metadata only; the host renders content. */
  readonly preview?: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

/** A reviewer decision on a specific revision. */
export interface ArtifactApproval {
  readonly version: number;
  readonly state: ArtifactDecisionState;
  /** Redacted reviewer actor reference. */
  readonly reviewer: string;
  /** Change-request / rejection note. */
  readonly note?: string;
  readonly decidedAt: string;
}

/**
 * Durable artifact record. Stored as a versioned checkpoint value; the checkpoint version
 * is the CAS counter for concurrent reviewers, distinct from revision numbers.
 */
export interface ArtifactRecord extends OwnershipScope {
  readonly id: string;
  readonly threadId: string;
  readonly title?: string;
  readonly revisions: readonly ArtifactRevision[];
  readonly approvals: readonly ArtifactApproval[];
  /** Last approved revision; remains recoverable after a later rejection. */
  readonly lastValidatedVersion?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Signed, expiring delivery authorization. Reauthorized per download; never a bearer secret. */
export interface ArtifactDeliveryToken extends OwnershipScope {
  readonly artifactId: string;
  readonly threadId: string;
  readonly version: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/**
 * Opaque, ownership-scoped reference to one artifact body revision. The store derives its
 * internal object key from these fields; hosts never see or store bucket/path/key internals.
 * `size` is the expected byte length and `hash` the expected SHA-256 hex; both are verified
 * on every put/get (fail closed on mismatch).
 */
export interface ArtifactBodyRef extends OwnershipScope {
  readonly artifactId: string;
  readonly threadId: string;
  readonly version: number;
  readonly mime: string;
  /** Expected body byte length; verified against the actual body on put and get. */
  readonly size: number;
  /** Expected SHA-256 hex digest of the body; verified on put and get. */
  readonly hash: string;
}

/** Transfer options shared by put/get/delete. */
export interface ArtifactBodyTransferOptions {
  readonly signal?: AbortSignal;
}

/** Presign options: bounded TTL for the returned delivery URL. */
export interface ArtifactBodyPresignOptions extends ArtifactBodyTransferOptions {
  /** Bounded by the store's presignTtlMs cap; defaults to the store default. */
  readonly ttlMs?: number;
}

/**
 * Host-owned blob storage contract (Phase 11 / 0.0.28). Core exports the contract only;
 * the reference S3-compatible adapter lives in `@arnilo/prism-server/artifact-bodies`.
 * Implementations must verify ownership on every operation, verify hash/size/MIME on
 * put/get (fail closed), refuse delete under legal hold, and never disclose bucket/path/key
 * in errors, telemetry, or records. All failures surface typed errors, never silent success.
 */
export interface ArtifactBodyStore {
  /** Store a body; verifies size + SHA-256 hash against the ref before persisting. */
  put(ref: ArtifactBodyRef, body: Uint8Array | ReadableStream<Uint8Array>, options?: ArtifactBodyTransferOptions): Promise<void>;
  /** Retrieve a body; verifies size, MIME, and SHA-256 hash before returning bytes. */
  get(ref: ArtifactBodyRef, options?: ArtifactBodyTransferOptions): Promise<ReadableStream<Uint8Array>>;
  /** Delete a body; idempotent. Refuses while the resource is under legal hold. */
  delete(ref: ArtifactBodyRef, options?: ArtifactBodyTransferOptions): Promise<void>;
  /** Return a bounded-TTL, single-object delivery URL (never a bucket listing or wildcard). */
  presign(ref: ArtifactBodyRef, options?: ArtifactBodyPresignOptions): Promise<string>;
}

/** Frozen ArtifactBodyStore failure reasons (fail-closed posture). */
export type ArtifactBodyErrorCode = "OWNERSHIP" | "HASH_MISMATCH" | "SIZE_MISMATCH" | "MIME_MISMATCH" | "HELD" | "STORE";

/** Well-known error codes for ArtifactBodyStore failures. */
export const ARTIFACT_BODY_ERROR_CODES: Readonly<Record<ArtifactBodyErrorCode, `ERR_PRISM_ARTIFACT_BODY_${ArtifactBodyErrorCode}`>> = {
  OWNERSHIP: "ERR_PRISM_ARTIFACT_BODY_OWNERSHIP",
  HASH_MISMATCH: "ERR_PRISM_ARTIFACT_BODY_HASH_MISMATCH",
  SIZE_MISMATCH: "ERR_PRISM_ARTIFACT_BODY_SIZE_MISMATCH",
  MIME_MISMATCH: "ERR_PRISM_ARTIFACT_BODY_MIME_MISMATCH",
  HELD: "ERR_PRISM_ARTIFACT_BODY_HELD",
  STORE: "ERR_PRISM_ARTIFACT_BODY_STORE",
};

/** Typed ArtifactBodyStore failure; `code` is one of the frozen ERR_PRISM_ARTIFACT_BODY_* codes. */
export class ArtifactBodyStoreError extends Error {
  readonly code: `ERR_PRISM_ARTIFACT_BODY_${ArtifactBodyErrorCode}`;
  constructor(
    message: string,
    readonly reason: ArtifactBodyErrorCode,
  ) {
    super(message);
    this.name = "ArtifactBodyStoreError";
    this.code = ARTIFACT_BODY_ERROR_CODES[reason];
  }
}

/** Well-known checkpoint namespace for artifact records. */
export const ARTIFACT_CHECKPOINT_NAMESPACE = "prism.artifact";

export class ArtifactError extends Error {
  readonly code = "ERR_PRISM_ARTIFACT";
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "ArtifactError";
  }
}

/** Checkpoint key for an artifact: thread-scoped so per-thread listing uses a key prefix. */
export function artifactCheckpointKey(threadId: string, artifactId: string): string {
  return `${threadId}:${artifactId}`;
}

/** Current review state: the decision on the latest revision, or pending when undecided. */
export function artifactApprovalState(record: ArtifactRecord): ArtifactApprovalState {
  const latest = record.revisions[record.revisions.length - 1];
  if (latest === undefined) return "pending";
  const decision = record.approvals.find((approval) => approval.version === latest.version);
  return decision?.state ?? "pending";
}
