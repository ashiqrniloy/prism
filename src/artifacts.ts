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

/** Well-known checkpoint namespace for artifact records. */
export const ARTIFACT_CHECKPOINT_NAMESPACE = "prism.artifact";

export class ArtifactError extends Error {
  readonly code = "ERR_PRISM_ARTIFACT";
  constructor(message: string, readonly reason: string) {
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
