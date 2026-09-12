/**
 * Artifact service (plan 070 Task 8 split of runtime/server/artifacts.ts, moved verbatim):
 * the request/result types, the ownership + bounds validation helpers, and the durable
 * `createArtifactService` factory over a `CheckpointStore`. Content bodies stay host-side;
 * the service records metadata, revisions, decisions, and audit events.
 */
import { randomUUID } from "node:crypto";
import {
  type AgentIdentity,
  ARTIFACT_CHECKPOINT_NAMESPACE,
  type ArtifactApproval,
  type ArtifactBodyRef,
  type ArtifactBodyStore,
  type ArtifactCitation,
  type ArtifactDeliveryToken,
  ArtifactError,
  type ArtifactRecord,
  type ArtifactRevision,
  artifactCheckpointKey,
  assertIdentityMatchesOwnership,
  CheckpointConflictError,
  type CheckpointStore,
  type OwnershipScope,
  type PersistencePage,
  type SecretRedactor,
} from "@arnilo/prism";
import { signArtifactDeliveryLink } from "./artifacts-delivery-links.js";
import { type ArtifactLimits, bounded, type ResolvedArtifactLimits, resolveArtifactLimits } from "./artifacts-limits.js";

export interface ArtifactServiceInput {
  readonly ownership: OwnershipScope;
  readonly identity?: AgentIdentity;
  readonly signal?: AbortSignal;
}

export interface ArtifactAttachInput extends ArtifactServiceInput {
  readonly threadId: string;
  readonly uri: string;
  readonly mime: string;
  readonly hash: string;
  /** Expected body byte length; required when a blob store is wired for delivery. */
  readonly size?: number;
  /** Explicit id makes attach idempotent (get-or-create). Generated when omitted. */
  readonly id?: string;
  readonly title?: string;
  readonly changeNote?: string;
  readonly producerRunId?: string;
  readonly citations?: readonly ArtifactCitation[];
  readonly preview?: Readonly<Record<string, unknown>>;
}

export interface ArtifactListInput extends ArtifactServiceInput {
  readonly threadId: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ArtifactRefInput extends ArtifactServiceInput {
  readonly threadId: string;
  readonly artifactId: string;
}

export interface ArtifactReviseInput extends ArtifactRefInput {
  readonly uri: string;
  /** Defaults to the previous revision's mime when omitted. */
  readonly mime?: string;
  readonly hash: string;
  /** Expected body byte length; required when a blob store is wired for delivery. */
  readonly size?: number;
  readonly changeNote?: string;
  readonly producerRunId?: string;
  readonly citations?: readonly ArtifactCitation[];
  readonly preview?: Readonly<Record<string, unknown>>;
}

export interface ArtifactCompareInput extends ArtifactRefInput {
  readonly from: number;
  readonly to: number;
}

export interface ArtifactCompareResult {
  readonly artifactId: string;
  readonly from: ArtifactRevision;
  readonly to: ArtifactRevision;
  /** Hash+metadata-bounded change flags; the host renders content bodies. */
  readonly changed: {
    readonly hash: boolean;
    readonly mime: boolean;
    readonly uri: boolean;
    readonly citations: boolean;
  };
}

export interface ArtifactDecisionInput extends ArtifactRefInput {
  readonly version: number;
  readonly note?: string;
  /** Redacted reviewer ref; derived from identity when omitted. */
  readonly reviewer?: string;
}

export interface ArtifactDeliveryInput extends ArtifactRefInput {
  /** Defaults to the last validated revision, else the latest. */
  readonly version?: number;
  readonly ttlSeconds?: number;
}

export interface ArtifactDeliveryResult {
  readonly link: string;
  readonly token: ArtifactDeliveryToken;
  /** Presigned blob-store delivery URL; present only when a body store is wired. */
  readonly url?: string;
}

export type ArtifactDecisionEvent =
  | {
      readonly type: "artifact_attached" | "artifact_revised";
      readonly artifactId: string;
      readonly threadId: string;
      readonly version: number;
      readonly actor?: string;
      readonly timestamp: string;
    }
  | {
      readonly type: "artifact_approved" | "artifact_rejected";
      readonly artifactId: string;
      readonly threadId: string;
      readonly version: number;
      readonly reviewer: string;
      readonly timestamp: string;
    };

export interface CreateArtifactServiceOptions {
  /** Required: records are redacted before persist and on every response. */
  readonly redactor: SecretRedactor;
  /** Host HMAC key material for signing/verifying delivery links. */
  readonly linkSecret: string;
  readonly limits?: ArtifactLimits;
  /** Optional blob store: delivery links then resolve through `bodies.presign`. */
  readonly bodies?: ArtifactBodyStore;
  /** Audit seam (redacted refs only); hosts bridge to @arnilo/prism-policy. */
  readonly onDecision?: (event: ArtifactDecisionEvent) => void | Promise<void>;
}

export interface ArtifactService {
  attach(input: ArtifactAttachInput): Promise<ArtifactRecord>;
  list(input: ArtifactListInput): Promise<PersistencePage<ArtifactRecord>>;
  get(input: ArtifactRefInput): Promise<ArtifactRecord>;
  revise(input: ArtifactReviseInput): Promise<ArtifactRecord>;
  compare(input: ArtifactCompareInput): Promise<ArtifactCompareResult>;
  approve(input: ArtifactDecisionInput): Promise<ArtifactRecord>;
  reject(input: ArtifactDecisionInput): Promise<ArtifactRecord>;
  lastValidated(input: ArtifactRefInput): Promise<ArtifactRevision>;
  deliveryLink(input: ArtifactDeliveryInput): Promise<ArtifactDeliveryResult>;
}

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function createArtifactService(store: CheckpointStore, options: CreateArtifactServiceOptions): ArtifactService {
  const limits = resolveArtifactLimits(options.limits);
  if (typeof options.linkSecret !== "string" || options.linkSecret.length === 0) {
    throw new RangeError("createArtifactService requires non-empty linkSecret key material");
  }

  function reviewerRef(input: ArtifactServiceInput, explicit?: string): string {
    if (explicit !== undefined && explicit.length > 0) return assertBounded(explicit, limits.noteBytes, "reviewer_too_large");
    const principal = input.identity?.principal;
    if (principal?.id) return `${principal.kind}:${principal.id}`;
    throw new ArtifactError("A reviewer identity is required for review decisions", "invalid_input");
  }

  async function load(input: ArtifactServiceInput, threadId: string, artifactId: string) {
    assertOwnership(input.ownership);
    input.signal?.throwIfAborted();
    let checkpoint: Awaited<ReturnType<CheckpointStore["loadCheckpoint"]>>;
    try {
      checkpoint = await store.loadCheckpoint({
        namespace: ARTIFACT_CHECKPOINT_NAMESPACE,
        key: artifactCheckpointKey(assertId(threadId, "threadId"), assertId(artifactId, "artifactId")),
        ...input.ownership,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    } catch (error) {
      // Ownership mismatch fails closed as not-found (never leaks existence).
      if (error instanceof CheckpointConflictError) throw new ArtifactError("Artifact not found", "not_found");
      throw error;
    }
    if (!checkpoint) throw new ArtifactError("Artifact not found", "not_found");
    return { record: checkpoint.value as ArtifactRecord, version: checkpoint.version };
  }

  // Read-modify-write with checkpoint CAS: concurrent reviewers race on expectedVersion, one
  // wins and the loser surfaces a retryable conflict (no lost approvals). A throw before save
  // persists nothing, so failed updates roll back inherently.
  async function commit(
    input: ArtifactServiceInput,
    threadId: string,
    record: ArtifactRecord,
    expectedVersion: number,
  ): Promise<ArtifactRecord> {
    const redacted = options.redactor.redact(record) as ArtifactRecord;
    assertRecordBytes(redacted, limits.recordBytes);
    try {
      await store.saveCheckpoint({
        namespace: ARTIFACT_CHECKPOINT_NAMESPACE,
        key: artifactCheckpointKey(threadId, record.id),
        ...input.ownership,
        version: expectedVersion + 1,
        expectedVersion,
        value: redacted,
        category: "artifact",
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    } catch (error) {
      if (error instanceof CheckpointConflictError) {
        throw new ArtifactError("Artifact was modified concurrently; retry", "conflict");
      }
      throw error;
    }
    return redacted;
  }

  function buildRevision(
    input: {
      uri: string;
      mime: string;
      hash: string;
      size?: number;
      changeNote?: string;
      producerRunId?: string;
      citations?: readonly ArtifactCitation[];
      preview?: Readonly<Record<string, unknown>>;
    },
    version: number,
  ): ArtifactRevision {
    const uri = assertSafeUri(input.uri, limits.uriBytes);
    assertBounded(input.mime, limits.mimeBytes, "mime_too_large");
    assertBounded(input.hash, limits.hashBytes, "hash_too_large");
    if (input.size !== undefined && (!Number.isSafeInteger(input.size) || input.size < 0)) {
      throw new ArtifactError("size is invalid", "invalid_input");
    }
    if (input.changeNote !== undefined) assertBounded(input.changeNote, limits.noteBytes, "change_note_too_large");
    if (input.producerRunId !== undefined) assertId(input.producerRunId, "producerRunId");
    const citations = normalizeCitations(input.citations, limits);
    const preview = normalizePreview(input.preview, limits);
    return {
      version,
      uri,
      mime: input.mime,
      hash: input.hash,
      ...(input.size === undefined ? {} : { size: input.size }),
      ...(input.changeNote === undefined ? {} : { changeNote: input.changeNote }),
      ...(input.producerRunId === undefined ? {} : { producerRunId: input.producerRunId }),
      ...(citations === undefined ? {} : { citations }),
      ...(preview === undefined ? {} : { preview }),
      createdAt: new Date().toISOString(),
    };
  }

  async function audit(event: ArtifactDecisionEvent): Promise<void> {
    if (options.onDecision) await options.onDecision(event);
  }

  return {
    async attach(input) {
      assertOwnership(input.ownership);
      input.signal?.throwIfAborted();
      if (input.identity) assertIdentityMatchesOwnership(input.identity, input.ownership);
      const threadId = assertId(input.threadId, "threadId");
      const id = input.id === undefined ? `art_${randomUUID()}` : assertId(input.id, "id");
      if (input.id !== undefined) {
        const existing = await this.get({ ...input, threadId, artifactId: id }).catch((error: unknown) => {
          if (error instanceof ArtifactError && error.reason === "not_found") return undefined;
          throw error;
        });
        if (existing) return existing;
      }
      // Enforce the per-thread artifact cap before create.
      const page = await store.listCheckpoints({
        namespace: ARTIFACT_CHECKPOINT_NAMESPACE,
        keyPrefix: `${threadId}:`,
        ...input.ownership,
        limit: limits.artifactsPerThread,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (page.items.length >= limits.artifactsPerThread) {
        throw new ArtifactError("Too many artifacts for this thread", "too_many_artifacts");
      }
      if (input.title !== undefined) assertBounded(input.title, limits.titleBytes, "title_too_large");
      const now = new Date().toISOString();
      const record: ArtifactRecord = {
        id,
        threadId,
        ...input.ownership,
        ...(input.title === undefined ? {} : { title: input.title }),
        revisions: [buildRevision(input, 1)],
        approvals: [],
        createdAt: now,
        updatedAt: now,
      };
      const saved = await commit(input, threadId, record, 0);
      await audit({
        type: "artifact_attached",
        artifactId: id,
        threadId,
        version: 1,
        ...(input.identity ? { actor: `${input.identity.principal.kind}:${input.identity.principal.id}` } : {}),
        timestamp: now,
      });
      return saved;
    },

    async list(input) {
      assertOwnership(input.ownership);
      input.signal?.throwIfAborted();
      const threadId = assertId(input.threadId, "threadId");
      const limit = Math.min(input.limit ?? limits.listPageLimit, limits.listPageLimit);
      if (!Number.isSafeInteger(limit) || limit < 1) throw new ArtifactError("limit is invalid", "invalid_input");
      const page = await store.listCheckpoints({
        namespace: ARTIFACT_CHECKPOINT_NAMESPACE,
        keyPrefix: `${threadId}:`,
        ...input.ownership,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        limit,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      const items = page.items.map((checkpoint) => checkpoint.value as ArtifactRecord);
      return { items, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) };
    },

    get(input) {
      return load(input, input.threadId, input.artifactId).then((loaded) => loaded.record);
    },

    async revise(input) {
      const { record, version } = await load(input, input.threadId, input.artifactId);
      if (record.revisions.length >= limits.revisionsPerArtifact) {
        throw new ArtifactError("Too many revisions for this artifact", "too_many_revisions");
      }
      const previous = record.revisions[record.revisions.length - 1];
      const revision = buildRevision({ ...input, mime: input.mime ?? previous.mime }, previous.version + 1);
      const now = new Date().toISOString();
      const updated: ArtifactRecord = { ...record, revisions: [...record.revisions, revision], updatedAt: now };
      const saved = await commit(input, input.threadId, updated, version);
      await audit({
        type: "artifact_revised",
        artifactId: record.id,
        threadId: input.threadId,
        version: revision.version,
        ...(input.identity ? { actor: `${input.identity.principal.kind}:${input.identity.principal.id}` } : {}),
        timestamp: now,
      });
      return saved;
    },

    async compare(input) {
      const { record } = await load(input, input.threadId, input.artifactId);
      // Freeze: exactly 2 revisions per compare call; hash+metadata only.
      if (!Number.isSafeInteger(input.from) || !Number.isSafeInteger(input.to) || input.from === input.to) {
        throw new ArtifactError("compare requires two distinct revision numbers", "invalid_input");
      }
      const from = record.revisions.find((revision) => revision.version === input.from);
      const to = record.revisions.find((revision) => revision.version === input.to);
      if (!from || !to) throw new ArtifactError("Revision not found", "not_found");
      return {
        artifactId: record.id,
        from,
        to,
        changed: {
          hash: from.hash !== to.hash,
          mime: from.mime !== to.mime,
          uri: from.uri !== to.uri,
          citations: JSON.stringify(from.citations ?? []) !== JSON.stringify(to.citations ?? []),
        },
      };
    },

    async approve(input) {
      return decide(input, "approved");
    },

    async reject(input) {
      return decide(input, "rejected");
    },

    async lastValidated(input) {
      const { record } = await load(input, input.threadId, input.artifactId);
      if (record.lastValidatedVersion === undefined) {
        throw new ArtifactError("Artifact has no validated revision", "not_validated");
      }
      const revision = record.revisions.find((item) => item.version === record.lastValidatedVersion);
      if (!revision) throw new ArtifactError("Validated revision not found", "not_found");
      return revision;
    },

    async deliveryLink(input) {
      const { record } = await load(input, input.threadId, input.artifactId);
      const latest = record.revisions[record.revisions.length - 1];
      const version = input.version ?? record.lastValidatedVersion ?? latest?.version;
      if (version === undefined) throw new ArtifactError("Artifact has no revisions", "invalid_input");
      const revision = record.revisions.find((item) => item.version === version);
      if (!revision) throw new ArtifactError("Revision not found", "not_found");
      const ttlSeconds = bounded(input.ttlSeconds, limits.deliveryLinkTtlSeconds, limits.deliveryLinkTtlSeconds, "ttlSeconds");
      const now = Date.now();
      const token: ArtifactDeliveryToken = {
        artifactId: record.id,
        threadId: input.threadId,
        version,
        ...input.ownership,
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
      };
      const result: ArtifactDeliveryResult = { link: signArtifactDeliveryLink(token, options.linkSecret), token };
      if (options.bodies) {
        // Delivery resolves through the blob store: presign the exact revision's body.
        // A revision without a recorded size cannot be addressed; fail closed.
        if (revision.size === undefined) {
          throw new ArtifactError("Revision has no recorded size; cannot resolve a body reference", "invalid_input");
        }
        const ref: ArtifactBodyRef = {
          artifactId: record.id,
          threadId: input.threadId,
          version,
          mime: revision.mime,
          size: revision.size,
          // Artifact hashes conventionally carry a `sha256:` prefix; the body
          // ref contract is bare 64-char hex, so normalize before addressing.
          hash: revision.hash.startsWith("sha256:") ? revision.hash.slice("sha256:".length) : revision.hash,
          ...input.ownership,
        };
        const url = await options.bodies.presign(ref, {
          ttlMs: ttlSeconds * 1000,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        return { ...result, url };
      }
      return result;
    },
  };

  async function decide(input: ArtifactDecisionInput, state: "approved" | "rejected"): Promise<ArtifactRecord> {
    const { record, version } = await load(input, input.threadId, input.artifactId);
    if (!Number.isSafeInteger(input.version) || !record.revisions.some((revision) => revision.version === input.version)) {
      throw new ArtifactError("Revision not found", "not_found");
    }
    if (input.note !== undefined) assertBounded(input.note, limits.noteBytes, "note_too_large");
    const reviewer = reviewerRef(input, input.reviewer);
    const now = new Date().toISOString();
    const approval: ArtifactApproval = {
      version: input.version,
      state,
      reviewer,
      ...(input.note === undefined ? {} : { note: input.note }),
      decidedAt: now,
    };
    // Replace any prior decision on the same version; approval advances lastValidated,
    // rejection never clears it so the last validated revision stays recoverable.
    const approvals = [...record.approvals.filter((item) => item.version !== input.version), approval];
    const updated: ArtifactRecord = {
      ...record,
      approvals,
      ...(state === "approved" ? { lastValidatedVersion: input.version } : {}),
      updatedAt: now,
    };
    const saved = await commit(input, input.threadId, updated, version);
    await audit({
      type: state === "approved" ? "artifact_approved" : "artifact_rejected",
      artifactId: record.id,
      threadId: input.threadId,
      version: input.version,
      reviewer,
      timestamp: now,
    });
    return saved;
  }
}

function assertOwnership(ownership: OwnershipScope): void {
  if (![ownership.tenantId, ownership.accountId, ownership.userId].some((v) => typeof v === "string" && v.length > 0)) {
    throw new ArtifactError("Ownership is required", "ownership");
  }
}

function assertId(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || !ID_PATTERN.test(value)) {
    throw new ArtifactError(`${name} is invalid`, "invalid_id");
  }
  return value;
}

function assertBounded(value: string, maxBytes: number, reason: string): string {
  if (Buffer.byteLength(value, "utf8") > maxBytes) throw new ArtifactError(`Value exceeds ${maxBytes} bytes`, reason);
  return value;
}

function assertRecordBytes(record: ArtifactRecord, maxBytes: number): void {
  if (Buffer.byteLength(JSON.stringify(record), "utf8") > maxBytes) {
    throw new ArtifactError(`Artifact record exceeds ${maxBytes} bytes`, "record_too_large");
  }
}

/** Reject local filesystem references so paths never enter records/events/exports. */
function assertSafeUri(value: unknown, maxBytes: number): string {
  if (typeof value !== "string" || value.length === 0) throw new ArtifactError("uri is required", "invalid_input");
  assertBounded(value, maxBytes, "uri_too_large");
  const lower = value.toLowerCase();
  if (lower.startsWith("file:") || lower.startsWith("/") || /^[a-z]:[\\/]/.test(lower)) {
    throw new ArtifactError("uri must be a host-owned reference, not a local filesystem path", "unsafe_uri");
  }
  return value;
}

function normalizeCitations(
  citations: readonly ArtifactCitation[] | undefined,
  limits: ResolvedArtifactLimits,
): readonly ArtifactCitation[] | undefined {
  if (citations === undefined) return undefined;
  if (!Array.isArray(citations)) throw new ArtifactError("citations must be an array", "invalid_input");
  if (citations.length > limits.citations) throw new ArtifactError(`Too many citations (max ${limits.citations})`, "too_many_citations");
  return citations.map((citation) => {
    if (!citation || typeof citation.uri !== "string" || citation.uri.length === 0) {
      throw new ArtifactError("citation.uri is required", "invalid_input");
    }
    assertBounded(JSON.stringify(citation), limits.citationBytes, "citation_too_large");
    return {
      uri: assertSafeUri(citation.uri, limits.uriBytes),
      ...(citation.title === undefined ? {} : { title: assertBounded(citation.title, limits.citationBytes, "citation_too_large") }),
      ...(citation.kind === undefined ? {} : { kind: assertBounded(citation.kind, 128, "citation_too_large") }),
    };
  });
}

function normalizePreview(
  preview: Readonly<Record<string, unknown>> | undefined,
  limits: ResolvedArtifactLimits,
): Readonly<Record<string, unknown>> | undefined {
  if (preview === undefined) return undefined;
  if (!preview || typeof preview !== "object" || Array.isArray(preview))
    throw new ArtifactError("preview must be an object", "invalid_input");
  if (Buffer.byteLength(JSON.stringify(preview), "utf8") > limits.previewBytes) {
    throw new ArtifactError(`Preview metadata exceeds ${limits.previewBytes} bytes`, "preview_too_large");
  }
  return preview;
}
