import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  type AgentIdentity,
  ARTIFACT_CHECKPOINT_NAMESPACE,
  type ArtifactApproval,
  type ArtifactCitation,
  type ArtifactDeliveryToken,
  ArtifactError,
  type ArtifactRecord,
  type ArtifactRevision,
  artifactCheckpointKey,
  assertIdentityActive,
  assertIdentityMatchesOwnership,
  CheckpointConflictError,
  type CheckpointStore,
  type OwnershipScope,
  type PersistencePage,
  type SecretRedactor,
} from "@arnilo/prism";
import type { PrismRequestHandler, PrismServerAuthorization } from "./types.js";
import { PrismServerError } from "./types.js";

/** Phase 9 freeze: artifacts/thread 64/256; revisions 32/128; record 8/64 KiB; preview 16/64 KiB;
 *  citations 32/128 and 2/8 KiB each; mime 128/512 B; hash 256/1 KiB; delivery TTL 5 min/24 h;
 *  delivery token 4/16 KiB. Compare is exactly 2 revisions (hash+metadata only; host renders content). */
export const DEFAULT_ARTIFACTS_PER_THREAD = 64;
export const HARD_ARTIFACTS_PER_THREAD = 256;
export const DEFAULT_ARTIFACT_REVISIONS = 32;
export const HARD_ARTIFACT_REVISIONS = 128;
export const DEFAULT_ARTIFACT_RECORD_BYTES = 8 * 1024;
export const HARD_ARTIFACT_RECORD_BYTES = 64 * 1024;
export const DEFAULT_ARTIFACT_PREVIEW_BYTES = 16 * 1024;
export const HARD_ARTIFACT_PREVIEW_BYTES = 64 * 1024;
export const DEFAULT_ARTIFACT_CITATIONS = 32;
export const HARD_ARTIFACT_CITATIONS = 128;
export const DEFAULT_ARTIFACT_CITATION_BYTES = 2 * 1024;
export const HARD_ARTIFACT_CITATION_BYTES = 8 * 1024;
export const DEFAULT_ARTIFACT_MIME_BYTES = 128;
export const HARD_ARTIFACT_MIME_BYTES = 512;
export const DEFAULT_ARTIFACT_HASH_BYTES = 256;
export const HARD_ARTIFACT_HASH_BYTES = 1024;
export const DEFAULT_ARTIFACT_URI_BYTES = 2 * 1024;
export const HARD_ARTIFACT_URI_BYTES = 8 * 1024;
export const DEFAULT_ARTIFACT_NOTE_BYTES = 1024;
export const HARD_ARTIFACT_NOTE_BYTES = 8 * 1024;
export const DEFAULT_ARTIFACT_TITLE_BYTES = 256;
export const HARD_ARTIFACT_TITLE_BYTES = 2 * 1024;
export const DEFAULT_ARTIFACT_LIST_PAGE_LIMIT = 50;
export const HARD_ARTIFACT_LIST_PAGE_LIMIT = 200;
export const DEFAULT_DELIVERY_LINK_TTL_SECONDS = 300;
export const HARD_DELIVERY_LINK_TTL_SECONDS = 24 * 3600;
export const DEFAULT_DELIVERY_LINK_TOKEN_BYTES = 4 * 1024;
export const HARD_DELIVERY_LINK_TOKEN_BYTES = 16 * 1024;
export const DEFAULT_ARTIFACT_REQUEST_BYTES = 64 * 1024;
export const HARD_ARTIFACT_REQUEST_BYTES = 1024 * 1024;

export interface ArtifactLimits {
  readonly artifactsPerThread?: number;
  readonly revisionsPerArtifact?: number;
  readonly recordBytes?: number;
  readonly previewBytes?: number;
  readonly citations?: number;
  readonly citationBytes?: number;
  readonly mimeBytes?: number;
  readonly hashBytes?: number;
  readonly uriBytes?: number;
  readonly noteBytes?: number;
  readonly titleBytes?: number;
  readonly listPageLimit?: number;
  readonly deliveryLinkTtlSeconds?: number;
  readonly deliveryLinkTokenBytes?: number;
  readonly maxRequestBytes?: number;
}

export interface ResolvedArtifactLimits {
  readonly artifactsPerThread: number;
  readonly revisionsPerArtifact: number;
  readonly recordBytes: number;
  readonly previewBytes: number;
  readonly citations: number;
  readonly citationBytes: number;
  readonly mimeBytes: number;
  readonly hashBytes: number;
  readonly uriBytes: number;
  readonly noteBytes: number;
  readonly titleBytes: number;
  readonly listPageLimit: number;
  readonly deliveryLinkTtlSeconds: number;
  readonly deliveryLinkTokenBytes: number;
  readonly maxRequestBytes: number;
}

export function resolveArtifactLimits(input: ArtifactLimits = {}): ResolvedArtifactLimits {
  return {
    artifactsPerThread: bounded(input.artifactsPerThread, DEFAULT_ARTIFACTS_PER_THREAD, HARD_ARTIFACTS_PER_THREAD, "artifactsPerThread"),
    revisionsPerArtifact: bounded(input.revisionsPerArtifact, DEFAULT_ARTIFACT_REVISIONS, HARD_ARTIFACT_REVISIONS, "revisionsPerArtifact"),
    recordBytes: bounded(input.recordBytes, DEFAULT_ARTIFACT_RECORD_BYTES, HARD_ARTIFACT_RECORD_BYTES, "recordBytes"),
    previewBytes: bounded(input.previewBytes, DEFAULT_ARTIFACT_PREVIEW_BYTES, HARD_ARTIFACT_PREVIEW_BYTES, "previewBytes"),
    citations: bounded(input.citations, DEFAULT_ARTIFACT_CITATIONS, HARD_ARTIFACT_CITATIONS, "citations"),
    citationBytes: bounded(input.citationBytes, DEFAULT_ARTIFACT_CITATION_BYTES, HARD_ARTIFACT_CITATION_BYTES, "citationBytes"),
    mimeBytes: bounded(input.mimeBytes, DEFAULT_ARTIFACT_MIME_BYTES, HARD_ARTIFACT_MIME_BYTES, "mimeBytes"),
    hashBytes: bounded(input.hashBytes, DEFAULT_ARTIFACT_HASH_BYTES, HARD_ARTIFACT_HASH_BYTES, "hashBytes"),
    uriBytes: bounded(input.uriBytes, DEFAULT_ARTIFACT_URI_BYTES, HARD_ARTIFACT_URI_BYTES, "uriBytes"),
    noteBytes: bounded(input.noteBytes, DEFAULT_ARTIFACT_NOTE_BYTES, HARD_ARTIFACT_NOTE_BYTES, "noteBytes"),
    titleBytes: bounded(input.titleBytes, DEFAULT_ARTIFACT_TITLE_BYTES, HARD_ARTIFACT_TITLE_BYTES, "titleBytes"),
    listPageLimit: bounded(input.listPageLimit, DEFAULT_ARTIFACT_LIST_PAGE_LIMIT, HARD_ARTIFACT_LIST_PAGE_LIMIT, "listPageLimit"),
    deliveryLinkTtlSeconds: bounded(
      input.deliveryLinkTtlSeconds,
      DEFAULT_DELIVERY_LINK_TTL_SECONDS,
      HARD_DELIVERY_LINK_TTL_SECONDS,
      "deliveryLinkTtlSeconds",
    ),
    deliveryLinkTokenBytes: bounded(
      input.deliveryLinkTokenBytes,
      DEFAULT_DELIVERY_LINK_TOKEN_BYTES,
      HARD_DELIVERY_LINK_TOKEN_BYTES,
      "deliveryLinkTokenBytes",
    ),
    maxRequestBytes: bounded(input.maxRequestBytes, DEFAULT_ARTIFACT_REQUEST_BYTES, HARD_ARTIFACT_REQUEST_BYTES, "maxRequestBytes"),
  };
}

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

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

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
    if (input.changeNote !== undefined) assertBounded(input.changeNote, limits.noteBytes, "change_note_too_large");
    if (input.producerRunId !== undefined) assertId(input.producerRunId, "producerRunId");
    const citations = normalizeCitations(input.citations, limits);
    const preview = normalizePreview(input.preview, limits);
    return {
      version,
      uri,
      mime: input.mime,
      hash: input.hash,
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
      if (!record.revisions.some((revision) => revision.version === version)) {
        throw new ArtifactError("Revision not found", "not_found");
      }
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
      return { link: signArtifactDeliveryLink(token, options.linkSecret), token };
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

/** Sign an expiring delivery token: base64url(payload).base64url(HMAC-SHA256). */
export function signArtifactDeliveryLink(token: ArtifactDeliveryToken, secret: string): string {
  const payload = Buffer.from(JSON.stringify(token), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/** Verify signature + expiry and parse a delivery link. Fail-closed on any tamper/expiry. */
export function verifyArtifactDeliveryLink(
  link: string,
  secret: string,
  maxBytes: number = HARD_DELIVERY_LINK_TOKEN_BYTES,
): ArtifactDeliveryToken {
  if (typeof link !== "string" || link.length === 0) throw new ArtifactError("Delivery link is required", "invalid_link");
  if (Buffer.byteLength(link, "utf8") > maxBytes) throw new ArtifactError("Delivery link exceeds byte limit", "link_too_large");
  const dot = link.lastIndexOf(".");
  if (dot <= 0 || dot === link.length - 1) throw new ArtifactError("Delivery link is invalid", "invalid_link");
  const payload = link.slice(0, dot);
  const signature = link.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    throw new ArtifactError("Delivery link signature invalid", "invalid_link");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new ArtifactError("Delivery link is invalid", "invalid_link");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ArtifactError("Delivery link is invalid", "invalid_link");
  const token = parsed as Record<string, unknown>;
  if (
    typeof token.artifactId !== "string" ||
    typeof token.threadId !== "string" ||
    !Number.isSafeInteger(token.version) ||
    typeof token.issuedAt !== "string" ||
    typeof token.expiresAt !== "string"
  ) {
    throw new ArtifactError("Delivery link is invalid", "invalid_link");
  }
  const expiresAt = Date.parse(token.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new ArtifactError("Delivery link expired", "link_expired");
  return {
    artifactId: token.artifactId,
    threadId: token.threadId,
    version: token.version as number,
    ...(typeof token.tenantId === "string" ? { tenantId: token.tenantId } : {}),
    ...(typeof token.accountId === "string" ? { accountId: token.accountId } : {}),
    ...(typeof token.userId === "string" ? { userId: token.userId } : {}),
    issuedAt: token.issuedAt,
    expiresAt: token.expiresAt,
  };
}

export type ArtifactOperation =
  | "artifact.attach"
  | "artifact.list"
  | "artifact.get"
  | "artifact.revise"
  | "artifact.compare"
  | "artifact.approve"
  | "artifact.reject"
  | "artifact.last-validated"
  | "artifact.delivery-link"
  | "artifact.download";

export interface ArtifactAuthorizationInput {
  readonly request: Request;
  readonly operation: ArtifactOperation;
  readonly threadId?: string;
  readonly artifactId?: string;
  /** Present for download: the verified delivery token to reauthorize against. */
  readonly deliveryToken?: ArtifactDeliveryToken;
  readonly signal: AbortSignal;
}

export type ArtifactAuthorizer = (
  input: ArtifactAuthorizationInput,
) => false | PrismServerAuthorization | Promise<false | PrismServerAuthorization>;

export interface CreateArtifactHandlerOptions {
  readonly service: ArtifactService;
  readonly authorize: ArtifactAuthorizer;
  readonly linkSecret: string;
  readonly basePath?: string;
  readonly redactor?: SecretRedactor;
  readonly limits?: ArtifactLimits;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** Framework-free HTTP adapter for one mounted artifact service (default base `/prism/artifacts`). */
export function createArtifactHandler(options: CreateArtifactHandlerOptions): PrismRequestHandler {
  const base = normalizeBasePath(options.basePath ?? "/prism/artifacts");
  const limits = resolveArtifactLimits(options.limits);

  return async (request) => {
    try {
      const route = parseArtifactRoute(request, base);
      if (!route) throw new PrismServerError("Not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
      let deliveryToken: ArtifactDeliveryToken | undefined;
      if (route.kind === "download") {
        const link = new URL(request.url).searchParams.get("link");
        if (link === null) throw new PrismServerError("link query parameter is required", 400, "ERR_PRISM_SERVER_INPUT");
        deliveryToken = verifyArtifactDeliveryLink(link, options.linkSecret, limits.deliveryLinkTokenBytes);
      }
      const authorization = await options.authorize({
        request,
        operation: route.operation,
        ...(route.threadId === undefined ? {} : { threadId: route.threadId }),
        ...(route.artifactId === undefined ? {} : { artifactId: route.artifactId }),
        ...(deliveryToken === undefined ? {} : { deliveryToken }),
        signal: request.signal,
      });
      if (!authorization) throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");
      if (authorization.identity) {
        assertIdentityActive(authorization.identity);
        assertIdentityMatchesOwnership(authorization.identity, authorization.ownership);
      }
      // Download reauthorizes against the token's ownership; a mismatch fails closed.
      if (deliveryToken && !ownershipMatches(authorization.ownership, deliveryToken)) {
        throw new PrismServerError("Forbidden", 403, "ERR_PRISM_SERVER_FORBIDDEN");
      }
      const input = {
        ownership: authorization.ownership,
        ...(authorization.identity === undefined ? {} : { identity: authorization.identity }),
        signal: request.signal,
      };
      const service = options.service;
      switch (route.kind) {
        case "attach": {
          const body = await readBody(request, limits.maxRequestBytes);
          const record = await service.attach({
            ...input,
            threadId: route.threadId,
            uri: readString(body.uri, "uri"),
            mime: readString(body.mime, "mime"),
            hash: readString(body.hash, "hash"),
            ...(body.id === undefined ? {} : { id: readString(body.id, "id") }),
            ...(body.title === undefined ? {} : { title: readString(body.title, "title") }),
            ...(body.changeNote === undefined ? {} : { changeNote: readString(body.changeNote, "changeNote") }),
            ...(body.producerRunId === undefined ? {} : { producerRunId: readString(body.producerRunId, "producerRunId") }),
            ...(body.citations === undefined ? {} : { citations: readCitations(body.citations) }),
            ...(body.preview === undefined ? {} : { preview: readObject(body.preview, "preview") }),
          });
          return json(options, record, 201);
        }
        case "list": {
          const query = new URL(request.url).searchParams;
          const page = await service.list({
            ...input,
            threadId: route.threadId,
            ...(query.get("cursor") === null ? {} : { cursor: query.get("cursor") ?? undefined }),
            ...(query.get("limit") === null ? {} : { limit: readPositiveInt(query.get("limit"), "limit") }),
          });
          return json(options, page, 200);
        }
        case "get":
          return json(options, await service.get({ ...input, threadId: route.threadId, artifactId: route.artifactId }), 200);
        case "revise": {
          const body = await readBody(request, limits.maxRequestBytes);
          const record = await service.revise({
            ...input,
            threadId: route.threadId,
            artifactId: route.artifactId,
            uri: readString(body.uri, "uri"),
            hash: readString(body.hash, "hash"),
            ...(body.mime === undefined ? {} : { mime: readString(body.mime, "mime") }),
            ...(body.changeNote === undefined ? {} : { changeNote: readString(body.changeNote, "changeNote") }),
            ...(body.producerRunId === undefined ? {} : { producerRunId: readString(body.producerRunId, "producerRunId") }),
            ...(body.citations === undefined ? {} : { citations: readCitations(body.citations) }),
            ...(body.preview === undefined ? {} : { preview: readObject(body.preview, "preview") }),
          });
          return json(options, record, 200);
        }
        case "compare": {
          const body = await readBody(request, limits.maxRequestBytes);
          const result = await service.compare({
            ...input,
            threadId: route.threadId,
            artifactId: route.artifactId,
            from: readPositiveInt(body.from === undefined ? null : String(body.from), "from"),
            to: readPositiveInt(body.to === undefined ? null : String(body.to), "to"),
          });
          return json(options, result, 200);
        }
        case "approve":
        case "reject": {
          const body = await readBody(request, limits.maxRequestBytes);
          const decision = {
            ...input,
            threadId: route.threadId,
            artifactId: route.artifactId,
            version: readPositiveInt(body.version === undefined ? null : String(body.version), "version"),
            ...(body.note === undefined ? {} : { note: readString(body.note, "note") }),
            ...(body.reviewer === undefined ? {} : { reviewer: readString(body.reviewer, "reviewer") }),
          };
          const record = route.kind === "approve" ? await service.approve(decision) : await service.reject(decision);
          return json(options, record, 200);
        }
        case "last-validated": {
          const revision = await service.lastValidated({ ...input, threadId: route.threadId, artifactId: route.artifactId });
          return json(options, revision, 200);
        }
        case "delivery-link": {
          const body = await readBody(request, limits.maxRequestBytes);
          const result = await service.deliveryLink({
            ...input,
            threadId: route.threadId,
            artifactId: route.artifactId,
            ...(body.version === undefined ? {} : { version: readPositiveInt(String(body.version), "version") }),
            ...(body.ttlSeconds === undefined ? {} : { ttlSeconds: readPositiveInt(String(body.ttlSeconds), "ttlSeconds") }),
          });
          return json(options, result, 200);
        }
        case "download": {
          // Token verified + reauthorized above; serve the authorized revision reference only
          // (host fetches the body). Reverify the artifact still has the version.
          const token = deliveryToken as ArtifactDeliveryToken;
          const record = await service.get({ ...input, threadId: token.threadId, artifactId: token.artifactId });
          const revision = record.revisions.find((item) => item.version === token.version);
          if (!revision) throw new PrismServerError("Revision not found", 404, "ERR_PRISM_SERVER_NOT_FOUND");
          return json(options, { artifactId: record.id, threadId: record.threadId, revision }, 200);
        }
      }
    } catch (error) {
      return artifactErrorResponse(error);
    }
  };
}

type ArtifactRoute =
  | { readonly kind: "attach"; readonly operation: "artifact.attach"; readonly threadId: string; readonly artifactId?: undefined }
  | { readonly kind: "list"; readonly operation: "artifact.list"; readonly threadId: string; readonly artifactId?: undefined }
  | { readonly kind: "get"; readonly operation: "artifact.get"; readonly threadId: string; readonly artifactId: string }
  | { readonly kind: "revise"; readonly operation: "artifact.revise"; readonly threadId: string; readonly artifactId: string }
  | { readonly kind: "compare"; readonly operation: "artifact.compare"; readonly threadId: string; readonly artifactId: string }
  | { readonly kind: "approve"; readonly operation: "artifact.approve"; readonly threadId: string; readonly artifactId: string }
  | { readonly kind: "reject"; readonly operation: "artifact.reject"; readonly threadId: string; readonly artifactId: string }
  | {
      readonly kind: "last-validated";
      readonly operation: "artifact.last-validated";
      readonly threadId: string;
      readonly artifactId: string;
    }
  | { readonly kind: "delivery-link"; readonly operation: "artifact.delivery-link"; readonly threadId: string; readonly artifactId: string }
  | { readonly kind: "download"; readonly operation: "artifact.download"; readonly threadId?: undefined; readonly artifactId?: undefined };

function parseArtifactRoute(request: Request, base: string): ArtifactRoute | undefined {
  const pathname = new URL(request.url).pathname;
  if (pathname === `${base}/download` && request.method === "GET") {
    return { kind: "download", operation: "artifact.download" };
  }
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return undefined;
  let parts: string[];
  try {
    parts = pathname.slice(base.length).split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    throw new PrismServerError("Invalid route", 400, "ERR_PRISM_SERVER_ROUTE");
  }
  if (parts.length === 0) return undefined;
  const [threadId, artifactId, action] = parts;
  if (!ID_PATTERN.test(threadId) || threadId.length > 128) return undefined;
  if (parts.length === 1) {
    if (request.method === "POST") return { kind: "attach", operation: "artifact.attach", threadId };
    if (request.method === "GET") return { kind: "list", operation: "artifact.list", threadId };
    return undefined;
  }
  if (!ID_PATTERN.test(artifactId) || artifactId.length > 128) return undefined;
  if (parts.length === 2) {
    if (request.method === "GET") return { kind: "get", operation: "artifact.get", threadId, artifactId };
    return undefined;
  }
  if (parts.length !== 3) return undefined;
  if (action === "last-validated" && request.method === "GET")
    return { kind: "last-validated", operation: "artifact.last-validated", threadId, artifactId };
  if (request.method !== "POST") return undefined;
  if (action === "revise") return { kind: "revise", operation: "artifact.revise", threadId, artifactId };
  if (action === "compare") return { kind: "compare", operation: "artifact.compare", threadId, artifactId };
  if (action === "approve") return { kind: "approve", operation: "artifact.approve", threadId, artifactId };
  if (action === "reject") return { kind: "reject", operation: "artifact.reject", threadId, artifactId };
  if (action === "delivery-link") return { kind: "delivery-link", operation: "artifact.delivery-link", threadId, artifactId };
  return undefined;
}

function ownershipMatches(scope: OwnershipScope, token: ArtifactDeliveryToken): boolean {
  return scope.tenantId === token.tenantId && scope.accountId === token.accountId && scope.userId === token.userId;
}

function json(options: CreateArtifactHandlerOptions, value: unknown, status: number): Response {
  const safe = options.redactor?.redact(value) ?? value;
  return new Response(JSON.stringify(safe), { status, headers: JSON_HEADERS });
}

function artifactErrorResponse(error: unknown): Response {
  let status = 500;
  let code = "ERR_PRISM_SERVER_INTERNAL";
  let message = "Internal server error";
  if (error instanceof PrismServerError) {
    status = error.status;
    code = error.code;
    message = error.message;
  } else if (error instanceof ArtifactError) {
    code = error.code;
    message = error.message;
    status =
      error.reason === "not_found" || error.reason === "not_validated"
        ? 404
        : error.reason === "conflict"
          ? 409
          : error.reason === "ownership"
            ? 403
            : error.reason === "link_expired"
              ? 410
              : error.reason === "too_many_artifacts" || error.reason === "too_many_revisions"
                ? 422
                : error.reason === "invalid_link"
                  ? 401
                  : 400;
  } else if (error instanceof RangeError) {
    status = 400;
    code = "ERR_PRISM_SERVER_INPUT";
    message = error.message;
  } else if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ERR_PRISM_IDENTITY") {
    status = 403;
    code = "ERR_PRISM_SERVER_FORBIDDEN";
    message = "Forbidden";
  } else if (error instanceof DOMException && error.name === "AbortError") {
    status = 499;
    code = "ERR_PRISM_SERVER_ABORTED";
    message = "Request aborted";
  }
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: JSON_HEADERS });
}

function normalizeBasePath(value: string): string {
  if (!value.startsWith("/") || value.includes("?") || value.includes("#")) throw new RangeError("basePath must be an absolute URL path");
  const normalized = value.length > 1 ? value.replace(/\/+$/, "") : value;
  if (normalized === "/") throw new RangeError("basePath cannot expose the URL root");
  return normalized;
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

function bounded(value: number | undefined, fallback: number, cap: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > cap) {
    throw new RangeError(`${name} must be a positive safe integer <= ${cap}`);
  }
  return resolved;
}

async function readBody(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new PrismServerError("Request body too large", 413, "ERR_PRISM_SERVER_BODY_LIMIT");
  }
  if (text.length === 0) return {};
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object");
    return value as Record<string, unknown>;
  } catch {
    throw new PrismServerError("Invalid JSON object body", 400, "ERR_PRISM_SERVER_BODY");
  }
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new PrismServerError(`${name} must be a string`, 400, "ERR_PRISM_SERVER_INPUT");
  return value;
}

function readObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PrismServerError(`${name} must be an object`, 400, "ERR_PRISM_SERVER_INPUT");
  return value as Record<string, unknown>;
}

function readCitations(value: unknown): ArtifactCitation[] {
  if (!Array.isArray(value)) throw new PrismServerError("citations must be an array", 400, "ERR_PRISM_SERVER_INPUT");
  return value as ArtifactCitation[];
}

function readPositiveInt(value: string | null, name: string): number {
  const parsed = value === null ? NaN : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new PrismServerError(`${name} must be a positive safe integer`, 400, "ERR_PRISM_SERVER_INPUT");
  return parsed;
}
