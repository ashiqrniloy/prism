/**
 * Bounded patch-review manifest binding review decisions to the exact
 * repository/worktree/base/head identity plus patch digest and artifact
 * revision. Pure helpers compose over the server ArtifactService (attach /
 * approve / reject) — no second approval engine, no raw patch body persisted.
 */

import { createHash } from "node:crypto";
import {
  DEFAULT_MAX_REVIEW_DIAGNOSTICS,
  DEFAULT_MAX_REVIEW_MANIFEST_BYTES,
  DEFAULT_MAX_REVIEW_REVISIONS,
  HARD_MAX_REVIEW_DIAGNOSTICS,
  HARD_MAX_REVIEW_MANIFEST_BYTES,
  HARD_MAX_REVIEW_REVISIONS,
  validateCodingLimit,
} from "./limits.js";

export type CodingPatchReviewState = "pending" | "accepted" | "rejected" | "superseded";

export type ReviewDiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface CodingPatchReviewCheckSummary {
  readonly name: string;
  readonly exitCode: number;
  readonly summary: string;
}

export interface CodingPatchReviewDiagnosticSummary {
  readonly file: string;
  readonly severity: ReviewDiagnosticSeverity;
  readonly count: number;
  readonly generation: number;
}

export interface CodingPatchReviewDiffstatEntry {
  readonly file: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface CodingPatchReviewIdentity {
  readonly repositoryId: string;
  /** Credential-free remote fingerprint (GitOperations.fingerprint). */
  readonly remoteFingerprint: string;
  readonly defaultBranch: string;
  /** Relative worktree path inside the approved worktree roots; optional. */
  readonly worktreePath?: string;
}

export interface CodingPatchReview {
  readonly schemaVersion: 1;
  readonly reviewId: string;
  readonly state: CodingPatchReviewState;
  readonly threadId: string;
  readonly artifactId: string;
  readonly identity: CodingPatchReviewIdentity;
  readonly base: string;
  readonly head: string;
  readonly patch: {
    readonly kind: "patch" | "bundle" | "diff" | "other";
    readonly uri: string;
    readonly sha256: string;
    readonly bytes: number;
  };
  readonly changedPaths: readonly string[];
  readonly diffstat: readonly CodingPatchReviewDiffstatEntry[];
  readonly checks: readonly CodingPatchReviewCheckSummary[];
  readonly diagnostics: readonly CodingPatchReviewDiagnosticSummary[];
  /** SHA-256 over the canonical manifest JSON — the acceptance binding. */
  readonly digest: string;
  readonly createdAt: string;
}

export interface CreateCodingPatchReviewInput {
  readonly threadId: string;
  readonly artifactId: string;
  readonly identity: CodingPatchReviewIdentity;
  readonly base: string;
  readonly head: string;
  readonly patch: CodingPatchReview["patch"];
  readonly changedPaths?: readonly string[];
  readonly diffstat?: readonly CodingPatchReviewDiffstatEntry[];
  readonly checks?: readonly CodingPatchReviewCheckSummary[];
  readonly diagnostics?: readonly CodingPatchReviewDiagnosticSummary[];
  readonly limits?: CodingReviewLimits;
  /** Explicit review id; defaults to a deterministic id from the digest. */
  readonly reviewId?: string;
  /** Explicit ISO-8601 timestamp (deterministic manifests); defaults to now. */
  readonly createdAt?: string;
}

export interface CodingReviewLimits {
  readonly maxRevisions?: number;
  readonly maxDiagnostics?: number;
  readonly maxManifestBytes?: number;
}

export interface ResolvedCodingReviewLimits {
  readonly maxRevisions: number;
  readonly maxDiagnostics: number;
  readonly maxManifestBytes: number;
}

export function resolveCodingReviewLimits(options?: CodingReviewLimits): ResolvedCodingReviewLimits {
  return {
    maxRevisions: validateCodingLimit("maxRevisions", options?.maxRevisions ?? DEFAULT_MAX_REVIEW_REVISIONS, HARD_MAX_REVIEW_REVISIONS),
    maxDiagnostics: validateCodingLimit(
      "maxDiagnostics",
      options?.maxDiagnostics ?? DEFAULT_MAX_REVIEW_DIAGNOSTICS,
      HARD_MAX_REVIEW_DIAGNOSTICS,
    ),
    maxManifestBytes: validateCodingLimit(
      "maxManifestBytes",
      options?.maxManifestBytes ?? DEFAULT_MAX_REVIEW_MANIFEST_BYTES,
      HARD_MAX_REVIEW_MANIFEST_BYTES,
    ),
  };
}

/** Structural subset of the server ArtifactAttachInput (thread/uri/hash/preview). */
export interface CodingReviewArtifactInput {
  readonly threadId: string;
  readonly id: string;
  readonly uri: string;
  readonly mime: string;
  readonly hash: string;
  readonly size?: number;
  readonly title?: string;
  readonly changeNote?: string;
  readonly producerRunId?: string;
  readonly preview?: Readonly<Record<string, unknown>>;
}

/** Structural subset of the server ArtifactRecord for acceptance checks. */
export interface CodingReviewArtifactRecord {
  readonly artifactId: string;
  readonly threadId: string;
  readonly revisions: readonly {
    readonly version: number;
    readonly hash: string;
    readonly uri: string;
    readonly preview?: Readonly<Record<string, unknown>>;
  }[];
  readonly approvals: readonly {
    readonly version: number;
    readonly state: "pending" | "approved" | "rejected";
    readonly reviewer?: string;
    readonly note?: string;
  }[];
}

export type CodingPatchReviewErrorCode =
  | "ERR_PRISM_REVIEW_INPUT"
  | "ERR_PRISM_REVIEW_LIMIT"
  | "ERR_PRISM_REVIEW_BINDING"
  | "ERR_PRISM_REVIEW_STATE"
  | "ERR_PRISM_REVIEW_OWNERSHIP";

export class CodingPatchReviewError extends Error {
  readonly code: CodingPatchReviewErrorCode;
  constructor(code: CodingPatchReviewErrorCode, message: string) {
    super(message);
    this.name = "CodingPatchReviewError";
    this.code = code;
  }
}

const HEX64 = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const REF_PATTERN = /^[^\s]{1,255}$/;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Build the bounded review manifest. Validates every identity field, caps
 * changed paths / diffstat / check summaries / diagnostic summaries, computes
 * the digest over the canonical manifest JSON, and returns the structural
 * artifact input whose `preview.review` embeds the manifest (digest binding).
 * Never embeds a raw patch body, command, env, or secret.
 */
export function createCodingPatchReviewManifest(
  input: CreateCodingPatchReviewInput,
): { review: CodingPatchReview; artifactInput: CodingReviewArtifactInput } {
  const limits = resolveCodingReviewLimits(input.limits);
  if (!ID_PATTERN.test(input.threadId)) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", "threadId must match [A-Za-z0-9][A-Za-z0-9._:-]*");
  }
  if (!ID_PATTERN.test(input.artifactId)) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", "artifactId must match [A-Za-z0-9][A-Za-z0-9._:-]*");
  }
  if (!ID_PATTERN.test(input.identity.repositoryId)) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", "repositoryId must match [A-Za-z0-9][A-Za-z0-9._:-]*");
  }
  if (!HEX64.test(input.identity.remoteFingerprint)) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", "remoteFingerprint must be a 64-hex sha256");
  }
  if (!REF_PATTERN.test(input.identity.defaultBranch) || input.identity.defaultBranch.includes("..")) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", "defaultBranch is invalid");
  }
  if (input.identity.worktreePath !== undefined) {
    assertRelativePath(input.identity.worktreePath, "worktreePath");
  }
  if (!REF_PATTERN.test(input.base) || input.base.includes("..")) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", "base is invalid");
  }
  if (!REF_PATTERN.test(input.head) || input.head.includes("..")) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", "head is invalid");
  }
  if (!HEX64.test(input.patch.sha256)) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", "patch.sha256 must be a 64-hex sha256");
  }
  if (!Number.isSafeInteger(input.patch.bytes) || input.patch.bytes < 0) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", "patch.bytes must be a non-negative safe integer");
  }
  if (input.patch.uri.length > 2_048 || CONTROL_PATTERN.test(input.patch.uri)) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", "patch.uri exceeds 2048 bytes or contains control characters");
  }

  const changedPaths = (input.changedPaths ?? []).map((path) => assertRelativePath(path, "changedPaths"));
  const diffstat = (input.diffstat ?? []).map((entry) => {
    const file = assertRelativePath(entry.file, "diffstat");
    if (!Number.isSafeInteger(entry.additions) || entry.additions < 0 || !Number.isSafeInteger(entry.deletions) || entry.deletions < 0) {
      throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", "diffstat counts must be non-negative safe integers");
    }
    return { file, additions: entry.additions, deletions: entry.deletions };
  });
  const checks = (input.checks ?? []).map((check) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(check.name)) {
      throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", `check name is invalid: ${check.name}`);
    }
    if (!Number.isInteger(check.exitCode)) {
      throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", `check ${check.name} exitCode must be an integer`);
    }
    const summary = String(check.summary).replace(CONTROL_PATTERN, "");
    if (Buffer.byteLength(summary, "utf8") > 8_192) {
      throw new CodingPatchReviewError("ERR_PRISM_REVIEW_LIMIT", `check ${check.name} summary exceeds 8192 bytes`);
    }
    return { name: check.name, exitCode: check.exitCode, summary };
  });
  const diagnostics = (input.diagnostics ?? []).map((diag) => {
    const file = assertRelativePath(diag.file, "diagnostics");
    if (diag.severity !== "error" && diag.severity !== "warning" && diag.severity !== "info" && diag.severity !== "hint") {
      throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", `diagnostic severity is invalid: ${String(diag.severity)}`);
    }
    if (!Number.isSafeInteger(diag.count) || diag.count < 0 || !Number.isSafeInteger(diag.generation) || diag.generation < 0) {
      throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", "diagnostic count/generation must be non-negative safe integers");
    }
    return { file, severity: diag.severity, count: diag.count, generation: diag.generation };
  });
  if (changedPaths.length > limits.maxRevisions * 250) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_LIMIT", `changedPaths exceed the bounded manifest budget (${limits.maxRevisions * 250})`);
  }
  if (checks.length > limits.maxRevisions) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_LIMIT", `checks exceed ${limits.maxRevisions}`);
  }
  if (diffstat.length > limits.maxRevisions * 250) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_LIMIT", `diffstat exceeds the bounded manifest budget (${limits.maxRevisions * 250})`);
  }
  if (diagnostics.length > limits.maxDiagnostics) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_LIMIT", `diagnostic summaries exceed ${limits.maxDiagnostics}`);
  }
  if (input.reviewId !== undefined && !ID_PATTERN.test(input.reviewId)) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", "reviewId must match [A-Za-z0-9][A-Za-z0-9._:-]*");
  }

  const body: Omit<CodingPatchReview, "digest" | "createdAt"> = {
    schemaVersion: 1,
    reviewId: "",
    state: "pending",
    threadId: input.threadId,
    artifactId: input.artifactId,
    identity: input.identity,
    base: input.base,
    head: input.head,
    patch: input.patch,
    changedPaths,
    diffstat,
    checks,
    diagnostics,
  };
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (typeof createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt)) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", "createdAt must be an ISO-8601 UTC timestamp");
  }
  const digest = sha256Hex(Buffer.from(JSON.stringify({ ...body, createdAt }), "utf8"));
  const reviewId = input.reviewId ?? `review-${digest.slice(0, 24)}`;
  const review: CodingPatchReview = { ...body, reviewId, digest, createdAt };

  const manifestJson = JSON.stringify(review);
  if (Buffer.byteLength(manifestJson, "utf8") > limits.maxManifestBytes) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_LIMIT", `review manifest exceeds ${limits.maxManifestBytes} bytes`);
  }

  const artifactInput: CodingReviewArtifactInput = {
    threadId: input.threadId,
    id: input.artifactId,
    uri: input.patch.uri,
    mime: `application/x-${input.patch.kind}`,
    hash: input.patch.sha256,
    size: input.patch.bytes,
    title: `Coding patch review ${reviewId}`,
    changeNote: `head ${input.head} over base ${input.base}`,
    preview: {
      review,
    },
  };
  return { review, artifactInput };
}

export interface AssertCodingPatchAcceptedInput {
  /** Fresh manifest whose state is being derived; must match the artifact binding. */
  readonly review: CodingPatchReview;
  /** Server ArtifactRecord (structurally compatible with @arnilo/prism-server ArtifactRecord). */
  readonly artifact: CodingReviewArtifactRecord;
}

export interface AssertCodingPatchAcceptedResult {
  readonly state: CodingPatchReviewState;
  readonly version: number;
  readonly reviewer?: string;
  readonly reason?: string;
}

/**
 * Derive the review state from the artifact record. The binding is exact:
 * review digest + patch digest + artifact revision + workspace identity must
 * all match the recorded preview; any patch/repository/worktree/base/head
 * change since approval surfaces as `superseded` — never a silent accept.
 * Acceptance never applies, commits, pushes, or merges.
 */
export function assertCodingPatchAccepted(input: AssertCodingPatchAcceptedInput): AssertCodingPatchAcceptedResult {
  const { review, artifact } = input;
  if (artifact.threadId !== review.threadId || artifact.artifactId !== review.artifactId) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_OWNERSHIP", "artifact does not belong to this review thread");
  }
  const bound = artifact.revisions.find((revision) => revision.hash === review.patch.sha256);
  if (!bound) {
    return { state: "superseded", version: 0, reason: "no artifact revision matches the patch digest" };
  }
  const latestVersion = artifact.revisions.reduce((max, revision) => Math.max(max, revision.version), 0);
  if (bound.version < latestVersion) {
    return { state: "superseded", version: bound.version, reason: "a newer patch revision supersedes this acceptance" };
  }
  const preview = bound.preview?.review as Partial<CodingPatchReview> | undefined;
  if (!preview || typeof preview !== "object") {
    return { state: "superseded", version: bound.version, reason: "artifact revision carries no review binding" };
  }
  if (preview.digest !== review.digest) {
    return {
      state: "superseded",
      version: bound.version,
      reason: "review digest changed after the decision (patch, identity, base, or head changed)",
    };
  }
  if (
    preview.identity?.repositoryId !== review.identity.repositoryId ||
    preview.identity?.remoteFingerprint !== review.identity.remoteFingerprint ||
    preview.identity?.defaultBranch !== review.identity.defaultBranch ||
    preview.base !== review.base ||
    preview.head !== review.head
  ) {
    return { state: "superseded", version: bound.version, reason: "repository/worktree/base/head identity changed after the decision" };
  }
  const decision = artifact.approvals.find((approval) => approval.version === bound.version);
  if (!decision) {
    return { state: "pending", version: bound.version, reason: "no decision recorded for the bound revision" };
  }
  if (decision.state === "rejected") {
    return { state: "rejected", version: bound.version, reviewer: decision.reviewer, reason: decision.note };
  }
  if (decision.state !== "approved") {
    return { state: "pending", version: bound.version, reason: "decision for the bound revision is not approved" };
  }
  return { state: "accepted", version: bound.version, reviewer: decision.reviewer };
}

function assertRelativePath(path: string, field: string): string {
  if (typeof path !== "string" || path.length === 0) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", `${field} must be a non-empty string`);
  }
  if (path.includes("\0") || path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", `${field} must be workspace-relative: ${path}`);
  }
  if (path === ".." || path.startsWith("../") || path.split("/").includes("..")) {
    throw new CodingPatchReviewError("ERR_PRISM_REVIEW_INPUT", `${field} escapes the workspace: ${path}`);
  }
  return path;
}

function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
