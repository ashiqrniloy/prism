import type { KeyObject } from "node:crypto";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { canonicalJson } from "./canonical.js";
import { PolicyError } from "./errors.js";

export const AUDIT_EXPORT_HARD_LIMITS = {
  maxRecordsPerBatch: 1_000,
  maxBytesPerBatch: 10 * 1024 * 1024,
  maxPendingSiemBatches: 8,
  digestAlgorithm: "sha256",
  digestLength: 64,
} as const;

const GENESIS_DIGEST = "0".repeat(AUDIT_EXPORT_HARD_LIMITS.digestLength);

export class AuditExportError extends PolicyError {
  constructor(message: string, code = "ERR_PRISM_POLICY_AUDIT") {
    super(message, code);
    this.name = "AuditExportError";
  }
}

/** Host-owned signer — Prism never accepts raw private keys. */
export interface AuditSigner {
  /** Node crypto verify algorithm used to check signatures (default "sha256"). */
  readonly algorithm?: string;
  /** Key identifier recorded in the artifact so rotation is observable. */
  readonly keyId?: string;
  sign(bytes: Uint8Array): Promise<Uint8Array> | Uint8Array;
}

export type AuditPublicKey = string | KeyObject;

export interface AuditRedaction {
  readonly path: string;
  readonly reason: string;
}

/**
 * Host-owned classification/redaction policy. Applied to each record before
 * hashing so the verifier sees exactly the exported bytes; the original value
 * is never carried past this point and only {path, reason} provenance survives.
 */
export interface AuditRedactionPolicy {
  apply(record: Readonly<Record<string, unknown>>): {
    record: Readonly<Record<string, unknown>>;
    redactions?: readonly AuditRedaction[];
  };
}

export interface AuditExportItem {
  readonly record: Readonly<Record<string, unknown>>;
  /** Set when the host source is under an active legal hold for this record. */
  readonly legalHold?: boolean;
}

export interface AuditPage {
  readonly items: readonly AuditExportItem[];
  readonly nextCursor?: string;
}

/**
 * Tenant-scoped, stable-order page source. Host adapters own the record ledger.
 *
 * Cursor tokens are one-shot: reading a cursor that already served its final
 * page (the one carrying `nextCursor: undefined`) yields an empty page. The
 * exporter NEVER re-reads a token after a failed batch — it retains the
 * uncommitted page in memory (bounded to one page of ≤1,000 records/10 MiB)
 * and replays it on the next `exportNext`, so retries reuse the same batch id.
 */
export interface AuditPageSource {
  read(input: { tenantId: string; cursor?: string; limit: number; signal?: AbortSignal }): Promise<AuditPage>;
}

export interface AuditSiemPending {
  readonly batchId: string;
  readonly digest: string;
  readonly firstSequence: number;
  readonly lastSequence: number;
}

export interface AuditCursor {
  readonly tenantId: string;
  /** Opaque source cursor; advanced only after durable WORM acknowledgement. */
  readonly cursor: string;
  readonly lastSequence: number;
  /** Chain tail digest: the digest of the last exported envelope (genesis zeros when empty). */
  readonly lastDigest: string;
  readonly version: number;
  /** Batches that reached WORM but not yet the SIEM sink; replayable by the host. */
  readonly siemPending: readonly AuditSiemPending[];
}

export interface AuditCursorSaveInput {
  readonly tenantId: string;
  readonly cursor: string;
  readonly lastSequence: number;
  readonly lastDigest: string;
  readonly version: number;
  readonly siemPending: readonly AuditSiemPending[];
}

/** CAS-versioned cursor store — the exporter advances a cursor only on a matched version. */
export interface AuditCursorStore {
  load(tenantId: string): Promise<AuditCursor | undefined>;
  save(input: AuditCursorSaveInput): Promise<AuditCursor>;
}

export interface AuditWormAck {
  /** Must equal the written batch id; the durable receipt names the stored batch. */
  readonly batchId: string;
  /** Must equal sha256 of the artifact bytes; integrity receipt provided by the sink. */
  readonly digest: string;
}

export interface AuditWormWrite {
  readonly tenantId: string;
  readonly batchId: string;
  readonly digest: string;
  readonly artifactBytes: Uint8Array;
}

/** Host-owned immutable sink (S3 object-lock, WORM bucket, CAS store, …). */
export interface AuditWormSink {
  write(input: AuditWormWrite): Promise<AuditWormAck>;
}

export interface AuditSiemWrite {
  readonly tenantId: string;
  readonly batchId: string;
  readonly digest: string;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly artifactBytes: Uint8Array;
}

/** Host-owned replayable mirror (SIEM, log stream, event bus). */
export interface AuditSiemSink {
  write(input: AuditSiemWrite): Promise<void>;
}

export interface AuditExporterOptions {
  readonly source: AuditPageSource;
  readonly cursorStore: AuditCursorStore;
  readonly signer: AuditSigner;
  readonly wormSink: AuditWormSink;
  readonly siemSink?: AuditSiemSink;
  /** Applied before hashing; when absent records are exported unredacted. */
  readonly redact?: AuditRedactionPolicy;
}

export interface AuditExportBatchInput {
  readonly tenantId: string;
  readonly maxRecords?: number;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

export type AuditSiemStatus = "disabled" | "sent" | "pending";

export interface AuditExportBatchResult {
  readonly batchId?: string;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly recordCount: number;
  readonly wormAcked: boolean;
  readonly siemStatus: AuditSiemStatus;
  readonly nextDigest: string;
  readonly artifactBytes?: Uint8Array;
}

export interface AuditExporter {
  exportNext(input: AuditExportBatchInput): Promise<AuditExportBatchResult>;
  /** Replays a WORM-acknowledged batch to SIEM when the host supplies its artifact bytes (e.g. fetched from WORM). */
  retryPendingSiem(input: { tenantId: string; batchId: string; artifactBytes: Uint8Array; signal?: AbortSignal }): Promise<void>;
}

interface AuditRecordEnvelope {
  readonly sequence: number;
  readonly priorDigest: string;
  readonly digest: string;
  readonly legalHold?: boolean;
  readonly redactions?: readonly AuditRedaction[];
  readonly record: Readonly<Record<string, unknown>>;
}

function sha256(text: string): string {
  return createHash(AUDIT_EXPORT_HARD_LIMITS.digestAlgorithm).update(text, "utf8").digest("hex");
}

function digestOfBytes(bytes: Uint8Array): string {
  return createHash(AUDIT_EXPORT_HARD_LIMITS.digestAlgorithm).update(bytes).digest("hex");
}

function assertDigest(value: string, label: string): void {
  const length = AUDIT_EXPORT_HARD_LIMITS.digestLength;
  if (!/^[0-9a-f]+$/.test(value) || value.length !== length) {
    throw new AuditExportError(`${label} must be a ${length}-character lowercase hex digest`, "ERR_PRISM_POLICY_AUDIT_STATE");
  }
}

/** Canonical bytes of one hash-chained record envelope. */
function envelopeBytes(tenantId: string, envelope: AuditRecordEnvelope): Buffer {
  return Buffer.from(
    canonicalJson({
      schemaVersion: 1,
      tenantId,
      sequence: envelope.sequence,
      priorDigest: envelope.priorDigest,
      ...(envelope.legalHold ? { legalHold: true } : {}),
      ...(envelope.redactions?.length ? { redactions: envelope.redactions } : {}),
      record: envelope.record,
    }),
    "utf8",
  );
}

/** Canonical text of the signed batch document (records + manifest metadata, no signature). */
function documentBytes(
  tenantId: string,
  batchId: string,
  firstSequence: number,
  lastSequence: number,
  previousDigest: string,
  nextDigest: string,
  records: readonly AuditRecordEnvelope[],
): Buffer {
  return Buffer.from(
    canonicalJson({
      schemaVersion: 1,
      tenantId,
      batchId,
      algorithm: AUDIT_EXPORT_HARD_LIMITS.digestAlgorithm,
      firstSequence,
      lastSequence,
      previousDigest,
      nextDigest,
      records: records.map((envelope) => ({
        sequence: envelope.sequence,
        priorDigest: envelope.priorDigest,
        digest: envelope.digest,
        ...(envelope.legalHold ? { legalHold: true } : {}),
        ...(envelope.redactions?.length ? { redactions: envelope.redactions } : {}),
        record: envelope.record,
      })),
    }),
    "utf8",
  );
}

function signedArtifactBytes(document: Buffer, signature: { algorithm: string; keyId?: string; value: string }): Buffer {
  return Buffer.from(
    canonicalJson({
      schemaVersion: 1,
      document: document.toString("utf8"),
      signature: {
        algorithm: signature.algorithm,
        ...(signature.keyId ? { keyId: signature.keyId } : {}),
        value: signature.value,
      },
    }),
    "utf8",
  );
}

export function createMemoryAuditCursorStore(): AuditCursorStore {
  const cursors = new Map<string, AuditCursor>();
  return {
    async load(tenantId) {
      const current = cursors.get(tenantId);
      return current ? { ...current, siemPending: [...current.siemPending] } : undefined;
    },
    async save(input) {
      const current = cursors.get(input.tenantId);
      if (current && current.version !== input.version) {
        throw new AuditExportError(
          `cursor for tenant ${input.tenantId} changed (version ${current.version} !== ${input.version})`,
          "ERR_PRISM_POLICY_AUDIT_CURSOR",
        );
      }
      const next: AuditCursor = {
        tenantId: input.tenantId,
        cursor: input.cursor,
        lastSequence: input.lastSequence,
        lastDigest: input.lastDigest,
        version: (current?.version ?? 0) + 1,
        siemPending: [...input.siemPending],
      };
      cursors.set(input.tenantId, next);
      return { ...next, siemPending: [...next.siemPending] };
    },
  };
}

export function createAuditExporter(options: AuditExporterOptions): AuditExporter {
  const { source, cursorStore, signer, wormSink, siemSink, redact } = options;
  // One uncommitted page per tenant: keeps one-shot source tokens honest across
  // failed batches so retries replay the same page instead of re-reading (and
  // dropping) it. Bounded: one page ≤ 1,000 records / 10 MiB per tenant.
  const uncommitted = new Map<string, { page: AuditPage; maxRecords: number; maxBytes: number }>();

  async function buildBatch(
    tenantId: string,
    cursor: AuditCursor,
    page: AuditPage,
    maxRecords: number,
    maxBytes: number,
  ): Promise<{ records: AuditRecordEnvelope[]; document: Buffer; batchId: string } | undefined> {
    assertDigest(cursor.lastDigest, "cursor lastDigest");
    const envelopes: AuditRecordEnvelope[] = [];
    let previousDigest = cursor.lastDigest;
    let bytes = 0;
    const overhead = 320; // bounded manifest/record metadata text, well under 10 MiB
    for (const [index, item] of page.items.entries()) {
      if (item.record === null || typeof item.record !== "object" || Array.isArray(item.record)) {
        throw new AuditExportError("each audit export record must be a plain JSON object", "ERR_PRISM_POLICY_AUDIT_RECORD");
      }
      let record: Readonly<Record<string, unknown>> = item.record;
      let redactions: readonly AuditRedaction[] | undefined;
      if (redact) {
        const applied = redact.apply(record);
        if (applied.record === null || typeof applied.record !== "object" || Array.isArray(applied.record)) {
          throw new AuditExportError("redaction policy must return a plain JSON object record", "ERR_PRISM_POLICY_AUDIT_RECORD");
        }
        record = applied.record;
        redactions = applied.redactions;
      }
      const base: AuditRecordEnvelope = {
        sequence: cursor.lastSequence + index + 1,
        priorDigest: previousDigest,
        digest: "",
        ...(item.legalHold ? { legalHold: true } : {}),
        ...(redactions?.length ? { redactions } : {}),
        record,
      };
      // Envelope bytes include tenant and sequence, so a cross-tenant record
      // can never be smuggled into another tenant's chain.
      const envelope: AuditRecordEnvelope = { ...base, digest: sha256(envelopeBytes(tenantId, base).toString("utf8")) };
      const envelopeSize = envelope.digest.length + envelopeBytes(tenantId, envelope).length + overhead;
      if (envelopes.length > 0 && bytes + envelopeSize > maxBytes) break;
      if (bytes + envelopeSize > maxBytes) {
        throw new AuditExportError(`a single audit record exceeds the ${maxBytes}-byte batch budget`, "ERR_PRISM_POLICY_AUDIT_CAP");
      }
      envelopes.push(envelope);
      bytes += envelopeSize;
      previousDigest = envelope.digest;
    }
    if (envelopes.length === 0) return undefined;
    if (envelopes.length > maxRecords) envelopes.length = maxRecords; // defensive: sources must honor limit, fail closed anyway
    const firstSequence = envelopes[0]!.sequence;
    const lastSequence = envelopes[envelopes.length - 1]!.sequence;
    const batchId = sha256(canonicalJson({ tenantId, firstSequence, lastSequence, previousDigest: cursor.lastDigest }));
    const document = documentBytes(
      tenantId,
      batchId,
      firstSequence,
      lastSequence,
      cursor.lastDigest,
      envelopes[envelopes.length - 1]!.digest,
      envelopes,
    );
    if (document.byteLength > maxBytes) {
      throw new AuditExportError(
        `batch document is ${document.byteLength} bytes, over the ${maxBytes}-byte budget`,
        "ERR_PRISM_POLICY_AUDIT_CAP",
      );
    }
    return { records: envelopes, document, batchId };
  }

  return {
    async exportNext(input) {
      input.signal?.throwIfAborted();
      const maxRecords = Math.min(
        input.maxRecords ?? AUDIT_EXPORT_HARD_LIMITS.maxRecordsPerBatch,
        AUDIT_EXPORT_HARD_LIMITS.maxRecordsPerBatch,
      );
      const maxBytes = Math.min(input.maxBytes ?? AUDIT_EXPORT_HARD_LIMITS.maxBytesPerBatch, AUDIT_EXPORT_HARD_LIMITS.maxBytesPerBatch);
      const loaded = await cursorStore.load(input.tenantId);
      const cursor: AuditCursor = loaded ?? {
        tenantId: input.tenantId,
        cursor: "",
        lastSequence: 0,
        lastDigest: GENESIS_DIGEST,
        version: 0,
        siemPending: [],
      };
      const held = uncommitted.get(input.tenantId);
      const page = held
        ? held.page
        : await source.read({ tenantId: input.tenantId, cursor: cursor.cursor, limit: maxRecords, signal: input.signal });
      const built = await buildBatch(input.tenantId, cursor, page, maxRecords, maxBytes);
      if (!built) {
        uncommitted.delete(input.tenantId);
        return {
          firstSequence: cursor.lastSequence,
          lastSequence: cursor.lastSequence,
          recordCount: 0,
          wormAcked: false,
          siemStatus: "disabled",
          nextDigest: cursor.lastDigest,
        };
      }
      // Retain the page until the batch durably lands; a failed batch replays it.
      uncommitted.set(input.tenantId, { page, maxRecords, maxBytes });
      const signature = await signer.sign(built.document);
      if (!(signature instanceof Uint8Array) || signature.byteLength === 0) {
        throw new AuditExportError("signer must return non-empty signature bytes", "ERR_PRISM_POLICY_AUDIT_SIGNER");
      }
      const artifactBytes = signedArtifactBytes(built.document, {
        algorithm: signer.algorithm ?? "sha256",
        ...(signer.keyId ? { keyId: signer.keyId } : {}),
        value: Buffer.from(signature).toString("base64"),
      });
      const digest = digestOfBytes(artifactBytes);
      // Required acknowledgement before any cursor movement: the WORM sink must
      // name the batch and confirm the exact artifact digest.
      let ack: AuditWormAck;
      try {
        ack = await wormSink.write({ tenantId: input.tenantId, batchId: built.batchId, digest, artifactBytes });
      } catch (error) {
        throw new AuditExportError(`worm sink rejected batch ${built.batchId}: ${errorMessage(error)}`, "ERR_PRISM_POLICY_AUDIT_WORM");
      }
      if (ack.batchId !== built.batchId || ack.digest !== digest) {
        throw new AuditExportError(
          `worm acknowledgement mismatch for batch ${built.batchId}: expected ${digest}, got ${ack.digest}`,
          "ERR_PRISM_POLICY_AUDIT_WORM",
        );
      }
      const firstSequence = built.records[0]!.sequence;
      const lastSequence = built.records[built.records.length - 1]!.sequence;
      let siemStatus: AuditSiemStatus = "disabled";
      let siemPending = [...cursor.siemPending];
      if (siemSink) {
        try {
          await siemSink.write({
            tenantId: input.tenantId,
            batchId: built.batchId,
            digest,
            firstSequence,
            lastSequence,
            artifactBytes,
          });
          siemStatus = "sent";
        } catch {
          // Durable WORM acknowledgement already obtained; record a replayable
          // pending status without duplicating chain entries on a later retry.
          const entry: AuditSiemPending = { batchId: built.batchId, digest, firstSequence, lastSequence };
          siemPending = [entry, ...siemPending].slice(0, AUDIT_EXPORT_HARD_LIMITS.maxPendingSiemBatches);
          siemStatus = "pending";
        }
      }
      try {
        await cursorStore.save({
          tenantId: input.tenantId,
          cursor: page.nextCursor ?? cursor.cursor,
          lastSequence,
          lastDigest: built.records[built.records.length - 1]!.digest,
          version: cursor.version,
          siemPending,
        });
      } catch (error) {
        // The batch is already durable on WORM; a re-export would duplicate the
        // chain. Drop the held page so a caller retry cannot re-sign it.
        uncommitted.delete(input.tenantId);
        throw new AuditExportError(
          `cursor advance raced for tenant ${input.tenantId}: ${errorMessage(error)}`,
          "ERR_PRISM_POLICY_AUDIT_CURSOR",
        );
      }
      uncommitted.delete(input.tenantId);
      return {
        batchId: built.batchId,
        firstSequence,
        lastSequence,
        recordCount: built.records.length,
        wormAcked: true,
        siemStatus,
        nextDigest: built.records[built.records.length - 1]!.digest,
        artifactBytes,
      };
    },

    async retryPendingSiem(input) {
      input.signal?.throwIfAborted();
      if (!siemSink) throw new AuditExportError("no siem sink configured", "ERR_PRISM_POLICY_AUDIT_STATE");
      const loaded = await cursorStore.load(input.tenantId);
      if (!loaded) throw new AuditExportError("no cursor for tenant", "ERR_PRISM_POLICY_AUDIT_STATE");
      const pending = loaded.siemPending.find((entry) => entry.batchId === input.batchId);
      if (!pending) throw new AuditExportError(`batch ${input.batchId} is not pending siem replay`, "ERR_PRISM_POLICY_AUDIT_STATE");
      const digest = digestOfBytes(input.artifactBytes);
      if (digest !== pending.digest) {
        throw new AuditExportError(
          `artifact bytes for batch ${input.batchId} do not match the pending digest`,
          "ERR_PRISM_POLICY_AUDIT_STATE",
        );
      }
      await siemSink.write({
        tenantId: input.tenantId,
        batchId: pending.batchId,
        digest,
        firstSequence: pending.firstSequence,
        lastSequence: pending.lastSequence,
        artifactBytes: input.artifactBytes,
      });
      const siemPending = loaded.siemPending.filter((entry) => entry.batchId !== input.batchId);
      await cursorStore.save({
        tenantId: input.tenantId,
        cursor: loaded.cursor,
        lastSequence: loaded.lastSequence,
        lastDigest: loaded.lastDigest,
        version: loaded.version,
        siemPending,
      });
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface VerifyAuditBatchInput {
  readonly artifactBytes: Uint8Array;
  readonly publicKey: AuditPublicKey;
  readonly expectedTenantId: string;
  /** Chain tail the batch must continue from; genesis zeros on first export. */
  readonly previousDigest?: string;
  readonly expectedFirstSequence?: number;
  readonly expectedLastSequence?: number;
}

export interface VerifyAuditBatchResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly batch?: {
    readonly tenantId: string;
    readonly batchId: string;
    readonly firstSequence: number;
    readonly lastSequence: number;
    readonly nextDigest: string;
    readonly recordCount: number;
  };
}

interface ParsedArtifact {
  readonly document: string;
  readonly signature: { algorithm: string; keyId?: string; value: string };
}

interface ParsedDocument {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly batchId: string;
  readonly algorithm: string;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly previousDigest: string;
  readonly nextDigest: string;
  readonly records: readonly {
    readonly sequence: number;
    readonly priorDigest: string;
    readonly digest: string;
    readonly legalHold?: boolean;
    readonly redactions?: readonly AuditRedaction[];
    readonly record: Readonly<Record<string, unknown>>;
  }[];
}

/**
 * Independent verification of a signed hash-chained audit batch.
 *
 * Checks, in order: artifact/document canonical bytes, manifest signature,
 * tenant match, sequence continuity, per-record digest replay over the exact
 * exported canonical envelope bytes, and chain continuity against
 * `previousDigest`. Never trusts a parsed document; everything is re-derived
 * from the supplied canonical bytes.
 */
export function verifyAuditBatch(input: VerifyAuditBatchInput): VerifyAuditBatchResult {
  const errors: string[] = [];
  const fail = (message: string): VerifyAuditBatchResult => ({ ok: false, errors: [...errors, message] });

  // 1. Artifact must be canonical JSON containing an embedded canonical document.
  let artifact: ParsedArtifact;
  try {
    artifact = JSON.parse(Buffer.from(input.artifactBytes).toString("utf8")) as ParsedArtifact;
  } catch {
    return fail("artifact is not valid JSON");
  }
  if (typeof artifact.document !== "string" || typeof artifact.signature?.value !== "string") {
    return fail("artifact must carry a canonical document and base64 signature");
  }
  const documentText = artifact.document;
  let canonicalDocument: string;
  try {
    canonicalDocument = canonicalJson(JSON.parse(documentText));
  } catch (error) {
    return fail(`document is not canonical JSON: ${errorMessage(error)}`);
  }
  if (canonicalDocument !== documentText) return fail("document is not in canonical form");

  // 2. Signature over the exact canonical document bytes.
  const key = typeof input.publicKey === "string" ? createPublicKey(input.publicKey) : input.publicKey;
  const signatureValid = (() => {
    try {
      return verifySignature(
        artifact.signature.algorithm ?? "sha256",
        Buffer.from(documentText, "utf8"),
        key,
        Buffer.from(artifact.signature.value, "base64"),
      );
    } catch {
      return false;
    }
  })();
  if (!signatureValid) return fail("manifest signature does not verify under the supplied public key");

  // 3. Document shape and bounds.
  let document: ParsedDocument;
  try {
    document = JSON.parse(documentText) as ParsedDocument;
  } catch {
    return fail("document is not valid JSON");
  }
  const bounds = AUDIT_EXPORT_HARD_LIMITS;
  if (document.schemaVersion !== 1) return fail(`unsupported schema version ${document.schemaVersion}`);
  if (document.algorithm !== bounds.digestAlgorithm) return fail(`unexpected digest algorithm ${document.algorithm}`);
  if (!Array.isArray(document.records) || document.records.length === 0) return fail("document has no records");
  if (document.records.length > bounds.maxRecordsPerBatch) return fail(`document exceeds ${bounds.maxRecordsPerBatch} records`);
  if (Buffer.byteLength(documentText, "utf8") > bounds.maxBytesPerBatch) return fail(`document exceeds ${bounds.maxBytesPerBatch} bytes`);

  // 4. Tenant, sequence continuity, and chain replay.
  if (document.tenantId !== input.expectedTenantId) return fail(`tenant mismatch: ${document.tenantId}`);
  const first = document.records[0]!;
  if (first.sequence !== document.firstSequence) return fail("first record sequence does not match the manifest");
  const last = document.records[document.records.length - 1]!;
  if (last.sequence !== document.lastSequence) return fail("last record sequence does not match the manifest");
  if (input.expectedFirstSequence !== undefined && document.firstSequence !== input.expectedFirstSequence) {
    return fail(`unexpected first sequence ${document.firstSequence}`);
  }
  if (input.expectedLastSequence !== undefined && document.lastSequence !== input.expectedLastSequence) {
    return fail(`unexpected last sequence ${document.lastSequence}`);
  }
  try {
    assertDigest(document.previousDigest, "manifest previousDigest");
    assertDigest(document.nextDigest, "manifest nextDigest");
  } catch (error) {
    return fail(errorMessage(error));
  }
  if (input.previousDigest !== undefined) {
    if (document.previousDigest !== input.previousDigest) {
      return fail(`chain discontinuity: expected previous digest ${input.previousDigest}, got ${document.previousDigest}`);
    }
  }
  for (let index = 0; index < document.records.length; index += 1) {
    const record = document.records[index]!;
    const expectedSequence = document.firstSequence + index;
    if (record.sequence !== expectedSequence)
      return fail(`sequence gap at index ${index}: expected ${expectedSequence}, got ${record.sequence}`);
    const expectedPrior = index === 0 ? document.previousDigest : document.records[index - 1]!.digest;
    if (record.priorDigest !== expectedPrior) return fail(`prior digest mismatch at sequence ${record.sequence}`);
    let envelopeText: string;
    try {
      envelopeText = envelopeBytes(document.tenantId, record).toString("utf8");
    } catch (error) {
      return fail(`envelope ${record.sequence} is not canonical: ${errorMessage(error)}`);
    }
    if (sha256(envelopeText) !== record.digest) return fail(`record digest mismatch at sequence ${record.sequence}`);
  }
  if (document.nextDigest !== last.digest) return fail("manifest next digest does not equal the final record digest");

  return {
    ok: true,
    errors,
    batch: {
      tenantId: document.tenantId,
      batchId: document.batchId,
      firstSequence: document.firstSequence,
      lastSequence: document.lastSequence,
      nextDigest: document.nextDigest,
      recordCount: document.records.length,
    },
  };
}
