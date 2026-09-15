import { createHash } from "node:crypto";
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

/** Optional host semantic verdict. Never treated as citation integrity or proof. */
export type CitationSupport = "unverified" | "supported" | "unsupported" | "uncertain";

/** Bounded citation / data-source reference. Host resolves the body; Prism stores the ref only. */
export interface ArtifactCitation {
  readonly uri: string;
  readonly title?: string;
  /** Data-source kind (e.g. "web", "database", "upload", "rag"); host-defined, bounded. */
  readonly kind?: string;
  readonly sourceId?: string;
  readonly revision?: string;
  /** SHA-256 hex of the retrieved source snapshot (optional `sha256:` prefix). */
  readonly contentHash?: string;
  readonly retrievedAt?: string;
  readonly excerpt?: string;
  readonly span?: { readonly start: number; readonly end: number };
  readonly tenantId?: string;
  readonly support?: CitationSupport;
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
  /** SHA-256 of bound citation sourceId/revision/contentHash tuples at decision time. */
  readonly evidenceDigest?: string;
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

export const HARD_CITATION_EXCERPT_BYTES = 8192;

export type CitationIntegrityReason =
  | "ok"
  | "missing_source"
  | "hash_mismatch"
  | "span_mismatch"
  | "revoked_acl"
  | "revision_changed"
  | "excerpt_too_large"
  | "cross_tenant";

export interface CitationLiveSource {
  readonly contentHash: string;
  readonly revision: string;
  readonly body?: string;
  readonly tenantId?: string;
  readonly authorized?: boolean;
}

export interface CitationIntegrityResult {
  readonly ok: boolean;
  readonly reason: CitationIntegrityReason;
}

function normalizeCitationHash(value: string): string {
  const raw = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
  return raw.trim().toLowerCase();
}

/** Deterministic source existence / hash / span / ACL check. Ignores `support`. */
export function checkCitationIntegrity(
  citation: ArtifactCitation,
  live?: CitationLiveSource,
  options?: { readonly boundRevision?: string; readonly maxExcerptBytes?: number },
): CitationIntegrityResult {
  const maxExcerpt = options?.maxExcerptBytes ?? HARD_CITATION_EXCERPT_BYTES;
  if (citation.excerpt !== undefined && Buffer.byteLength(citation.excerpt, "utf8") > maxExcerpt) {
    return { ok: false, reason: "excerpt_too_large" };
  }
  if (!live) return { ok: false, reason: "missing_source" };
  if (live.authorized === false) return { ok: false, reason: "revoked_acl" };
  if (citation.tenantId && live.tenantId && citation.tenantId !== live.tenantId) {
    return { ok: false, reason: "cross_tenant" };
  }
  if (!citation.contentHash) return { ok: false, reason: "missing_source" };
  if (normalizeCitationHash(citation.contentHash) !== normalizeCitationHash(live.contentHash)) {
    return { ok: false, reason: "hash_mismatch" };
  }
  if (citation.revision !== undefined && citation.revision !== live.revision) {
    return { ok: false, reason: "revision_changed" };
  }
  if (options?.boundRevision !== undefined && options.boundRevision !== live.revision) {
    return { ok: false, reason: "revision_changed" };
  }
  if (citation.span) {
    const { start, end } = citation.span;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
      return { ok: false, reason: "span_mismatch" };
    }
    if (live.body !== undefined) {
      const sliced = live.body.slice(start, end);
      if (citation.excerpt !== undefined && sliced !== citation.excerpt) {
        return { ok: false, reason: "span_mismatch" };
      }
    }
  } else if (citation.excerpt !== undefined && live.body !== undefined && citation.excerpt !== live.body) {
    return { ok: false, reason: "span_mismatch" };
  }
  return { ok: true, reason: "ok" };
}

/** Stable digest of citation identity tuples. Source body changes after approval fail this digest only when citations themselves change; live hash is `checkCitationIntegrity`. */
export function citationBindingDigest(citations: readonly ArtifactCitation[] | undefined): string {
  const rows = (citations ?? [])
    .map(
      (citation) =>
        `${citation.sourceId ?? ""}|${citation.revision ?? ""}|${citation.contentHash ? normalizeCitationHash(citation.contentHash) : ""}`,
    )
    .sort();
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

/** True when the approval digest still matches the revision and (if given) live sources pass integrity. */
export function approvalEvidenceIntact(
  approval: ArtifactApproval,
  revision: ArtifactRevision,
  liveSources?: Readonly<Record<string, CitationLiveSource>>,
): CitationIntegrityResult {
  if (approval.evidenceDigest !== undefined && approval.evidenceDigest !== citationBindingDigest(revision.citations)) {
    return { ok: false, reason: "revision_changed" };
  }
  if (liveSources === undefined) return { ok: true, reason: "ok" };
  for (const citation of revision.citations ?? []) {
    if (!citation.sourceId && !citation.contentHash) continue;
    const live = citation.sourceId ? liveSources[citation.sourceId] : undefined;
    const result = checkCitationIntegrity(citation, live, {
      ...(citation.revision === undefined ? {} : { boundRevision: citation.revision }),
    });
    if (!result.ok) return result;
  }
  return { ok: true, reason: "ok" };
}
