/**
 * Reference S3-compatible artifact body store (Phase 11 / 0.0.28): hand-rolled SigV4
 * presigning over native fetch + WebCrypto, path-style addressing, single-chunk PUT with
 * exact Content-Length and x-amz-content-sha256 = verified SHA-256 hex (no chunked transfer).
 * Implements the core `ArtifactBodyStore` contract; hosts may substitute any store.
 *
 * Security posture: ownership verified on every operation; size/hash/MIME verified on put
 * and get (fail closed); delete refuses under legal hold (host `isHeld` callback) and is
 * idempotent; credentials only via the host resolver; bucket/path/key never appear in
 * errors, telemetry, or artifact records (the object key is derived from the ref).
 */
import { type ArtifactBodyRef, type ArtifactBodyStore, ArtifactBodyStoreError } from "@arnilo/prism";
import { presignV4, sha256Hex, signRequestV4 } from "./artifact-bodies-s3.js";

/** Host-resolved S3 credentials; never inline, never logged. */
export interface S3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Optional session token (STS); included in the signature scope when present. */
  readonly sessionToken?: string;
}

export interface ArtifactBodyLimits {
  readonly maxBodyBytes?: number;
  readonly maxConcurrentTransfers?: number;
  readonly presignTtlMs?: number;
  readonly maxRefBytes?: number;
}

export interface ResolvedArtifactBodyLimits {
  readonly maxBodyBytes: number;
  readonly maxConcurrentTransfers: number;
  readonly presignTtlMs: number;
  readonly maxRefBytes: number;
}

/** Phase 11 freeze: body 64 MiB/512 MiB; concurrent transfers 4/16; presign TTL 10 min/24 h; ref 256 B/1 KiB. */
export const DEFAULT_ARTIFACT_BODY_LIMITS: ResolvedArtifactBodyLimits = {
  maxBodyBytes: 64 * 1024 * 1024,
  maxConcurrentTransfers: 4,
  presignTtlMs: 10 * 60 * 1000,
  maxRefBytes: 256,
};
export const HARD_ARTIFACT_BODY_LIMITS: ResolvedArtifactBodyLimits = {
  maxBodyBytes: 512 * 1024 * 1024,
  maxConcurrentTransfers: 16,
  presignTtlMs: 24 * 3600 * 1000,
  maxRefBytes: 1024,
};

export function resolveArtifactBodyLimits(input: ArtifactBodyLimits = {}): ResolvedArtifactBodyLimits {
  const resolved: Record<keyof ResolvedArtifactBodyLimits, number> = {
    maxBodyBytes: DEFAULT_ARTIFACT_BODY_LIMITS.maxBodyBytes,
    maxConcurrentTransfers: DEFAULT_ARTIFACT_BODY_LIMITS.maxConcurrentTransfers,
    presignTtlMs: DEFAULT_ARTIFACT_BODY_LIMITS.presignTtlMs,
    maxRefBytes: DEFAULT_ARTIFACT_BODY_LIMITS.maxRefBytes,
  };
  for (const key of Object.keys(DEFAULT_ARTIFACT_BODY_LIMITS) as Array<keyof ResolvedArtifactBodyLimits>) {
    const value = input[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 1 || value > HARD_ARTIFACT_BODY_LIMITS[key]) {
      throw new ArtifactBodyStoreError(`${key} must be a positive safe integer at or below the hard cap`, "STORE");
    }
    resolved[key] = value;
  }
  return resolved as ResolvedArtifactBodyLimits;
}

export interface S3ArtifactBodyStoreOptions {
  /** Absolute base URL of the S3-compatible endpoint (https; http only for loopback hosts). */
  readonly endpoint: string;
  /** Bucket name (path-style addressing; no slashes). */
  readonly bucket: string;
  /** SigV4 region scope; default "us-east-1". */
  readonly region?: string;
  /** Host resolver for credentials; never inline keys. */
  readonly credentials: () => S3Credentials | Promise<S3Credentials>;
  /**
   * Optional host-owned client-side encryption: `encrypt` runs before upload, `decrypt`
   * after download. The ref hash/size always refer to the plaintext; the stored bytes are
   * the ciphertext (so size is verified on the decrypted plaintext when kms is set).
   */
  readonly kms?: (op: "encrypt" | "decrypt", body: Uint8Array) => Promise<Uint8Array>;
  /** Optional legal-hold check; delete refuses (ERR_PRISM_ARTIFACT_BODY_HELD) when held. */
  readonly isHeld?: (ref: ArtifactBodyRef) => boolean | Promise<boolean>;
  readonly limits?: ArtifactBodyLimits;
  /** Test seam; defaults to global fetch. */
  readonly fetch?: typeof fetch;
  /** Test seam; defaults to Date.now. */
  readonly now?: () => number;
}

/** Frozen S3 adapter failure reasons. */
export type S3ArtifactBodyErrorCode = "PRESIGN" | "UPLOAD" | "DOWNLOAD" | "DELETE" | "CREDENTIALS";

/** Typed S3 adapter failure; `code` is one of the frozen ERR_PRISM_S3_* codes. */
export class S3ArtifactBodyError extends Error {
  readonly code: `ERR_PRISM_S3_${S3ArtifactBodyErrorCode}`;
  constructor(
    message: string,
    readonly reason: S3ArtifactBodyErrorCode,
  ) {
    super(message);
    this.name = "S3ArtifactBodyError";
    this.code = `ERR_PRISM_S3_${reason}`;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const BUCKET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Deterministic object key derived from the ref; bucket/path/key never enter artifact records. */
export function s3ObjectKey(ref: ArtifactBodyRef): string {
  return `prism-artifacts/${ref.tenantId}/${ref.threadId}/${ref.artifactId}/${ref.version}`;
}

function validateRef(ref: ArtifactBodyRef, limits: ResolvedArtifactBodyLimits): void {
  if (![ref.tenantId, ref.accountId, ref.userId].some((v) => typeof v === "string" && v.length > 0)) {
    throw new ArtifactBodyStoreError("Ownership is required on every body reference", "OWNERSHIP");
  }
  for (const [name, value] of [
    ["threadId", ref.threadId],
    ["artifactId", ref.artifactId],
  ] as const) {
    if (typeof value !== "string" || value.length === 0 || value.length > 128 || !ID_PATTERN.test(value)) {
      throw new ArtifactBodyStoreError(`${name} is invalid`, "STORE");
    }
  }
  if (!Number.isSafeInteger(ref.version) || ref.version < 1) {
    throw new ArtifactBodyStoreError("version must be a positive safe integer", "STORE");
  }
  if (!Number.isSafeInteger(ref.size) || ref.size < 0 || ref.size > limits.maxBodyBytes) {
    throw new ArtifactBodyStoreError("size must be a non-negative safe integer at or below maxBodyBytes", "STORE");
  }
  if (typeof ref.hash !== "string" || !HASH_PATTERN.test(ref.hash)) {
    throw new ArtifactBodyStoreError("hash must be a 64-char SHA-256 hex digest", "STORE");
  }
  if (typeof ref.mime !== "string" || ref.mime.length === 0 || Buffer.byteLength(ref.mime, "utf8") > 512) {
    throw new ArtifactBodyStoreError("mime must be a non-empty string at or below 512 bytes", "STORE");
  }
  if (Buffer.byteLength(JSON.stringify(ref), "utf8") > limits.maxRefBytes) {
    throw new ArtifactBodyStoreError("body reference exceeds maxRefBytes", "STORE");
  }
}

function validateEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ArtifactBodyStoreError("endpoint must be an absolute URL", "STORE");
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new ArtifactBodyStoreError("endpoint must be https (http only for loopback hosts)", "STORE");
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new ArtifactBodyStoreError("endpoint must not carry credentials, query, or fragment", "STORE");
  }
  return url;
}

async function readBoundedStream(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ArtifactBodyStoreError("body exceeds maxBodyBytes", "SIZE_MISMATCH");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function createSemaphore(max: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (active >= max) await new Promise<void>((resolve) => waiters.push(resolve));
      active += 1;
      try {
        return await fn();
      } finally {
        active -= 1;
        waiters.shift()?.();
      }
    },
  };
}

/** Reference S3-compatible ArtifactBodyStore (AWS S3, MinIO, Cloudflare R2). */
export function createS3ArtifactBodyStore(options: S3ArtifactBodyStoreOptions): ArtifactBodyStore {
  const limits = resolveArtifactBodyLimits(options.limits);
  const base = validateEndpoint(options.endpoint);
  if (typeof options.bucket !== "string" || !BUCKET_PATTERN.test(options.bucket)) {
    throw new ArtifactBodyStoreError("bucket must match [A-Za-z0-9][A-Za-z0-9._-]{0,62}", "STORE");
  }
  const region = options.region ?? "us-east-1";
  if (typeof region !== "string" || region.length === 0 || region.length > 64) {
    throw new ArtifactBodyStoreError("region must be a non-empty string at or below 64 bytes", "STORE");
  }
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const semaphore = createSemaphore(limits.maxConcurrentTransfers);

  async function resolveCredentials(): Promise<S3Credentials> {
    let credentials: S3Credentials;
    try {
      credentials = await options.credentials();
    } catch (error) {
      throw new S3ArtifactBodyError(
        `credential resolution failed: ${error instanceof Error ? error.message : "unknown error"}`,
        "CREDENTIALS",
      );
    }
    if (
      typeof credentials?.accessKeyId !== "string" ||
      credentials.accessKeyId.length === 0 ||
      typeof credentials?.secretAccessKey !== "string" ||
      credentials.secretAccessKey.length === 0
    ) {
      throw new S3ArtifactBodyError("credentials must provide non-empty accessKeyId and secretAccessKey", "CREDENTIALS");
    }
    return credentials;
  }

  function amzDate(): string {
    return new Date(now())
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  }

  function objectPath(ref: ArtifactBodyRef): string {
    return `/${options.bucket}/${s3ObjectKey(ref)
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  }

  async function presignGet(ref: ArtifactBodyRef, ttlMs: number, signal?: AbortSignal): Promise<string> {
    const credentials = await resolveCredentials();
    const date = amzDate();
    const expiresSeconds = Math.ceil(ttlMs / 1000);
    let query: string;
    try {
      query = await presignV4({
        method: "GET",
        path: objectPath(ref),
        headers: { host: base.host },
        payloadHash: "UNSIGNED-PAYLOAD",
        region,
        service: "s3",
        amzDate: date,
        expiresSeconds,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        ...(credentials.sessionToken === undefined ? {} : { sessionToken: credentials.sessionToken }),
      });
    } catch (error) {
      throw new S3ArtifactBodyError(`presign failed: ${error instanceof Error ? error.message : "unknown error"}`, "PRESIGN");
    }
    signal?.throwIfAborted();
    return `${base.origin}${objectPath(ref)}?${query}`;
  }

  return {
    async put(ref, body, transferOptions) {
      validateRef(ref, limits);
      const bytes = body instanceof Uint8Array ? body : await readBoundedStream(body, limits.maxBodyBytes);
      if (bytes.byteLength > limits.maxBodyBytes) {
        throw new ArtifactBodyStoreError("body exceeds maxBodyBytes", "SIZE_MISMATCH");
      }
      if (bytes.byteLength !== ref.size) {
        throw new ArtifactBodyStoreError(`body size ${bytes.byteLength} does not match ref size ${ref.size}`, "SIZE_MISMATCH");
      }
      const hash = await sha256Hex(bytes);
      if (hash !== ref.hash.toLowerCase()) {
        throw new ArtifactBodyStoreError("body SHA-256 does not match the reference hash", "HASH_MISMATCH");
      }
      const payload = options.kms ? await options.kms("encrypt", bytes) : bytes;
      const payloadHash = await sha256Hex(payload);
      const credentials = await resolveCredentials();
      const date = amzDate();
      const path = objectPath(ref);
      const headers: Record<string, string> = {
        host: base.host,
        "content-type": ref.mime,
        "x-amz-content-sha256": payloadHash,
      };
      const signed = await signRequestV4({
        method: "PUT",
        path,
        headers,
        signedHeaders: ["host", "content-type", "x-amz-content-sha256"],
        payloadHash,
        region,
        service: "s3",
        amzDate: date,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        ...(credentials.sessionToken === undefined ? {} : { sessionToken: credentials.sessionToken }),
      });
      try {
        await semaphore.run(async () => {
          // host is signed but not sent explicitly: fetch sets it from the URL.
          const requestHeaders = { ...signed.headers };
          delete requestHeaders.host;
          const response = await fetchImpl(`${base.origin}${path}`, {
            method: "PUT",
            headers: requestHeaders,
            body: payload as BodyInit,
            ...(transferOptions?.signal === undefined ? {} : { signal: transferOptions.signal }),
          });
          if (!response.ok) {
            throw new S3ArtifactBodyError(`upload failed with HTTP ${response.status}`, "UPLOAD");
          }
        });
      } catch (error) {
        if (error instanceof S3ArtifactBodyError) throw error;
        throw new S3ArtifactBodyError(`upload failed: ${error instanceof Error ? error.message : "unknown error"}`, "UPLOAD");
      }
    },

    async get(ref, transferOptions) {
      validateRef(ref, limits);
      const url = await presignGet(ref, limits.presignTtlMs, transferOptions?.signal);
      let response: Response;
      try {
        response = await semaphore.run(async () =>
          fetchImpl(url, { method: "GET", ...(transferOptions?.signal === undefined ? {} : { signal: transferOptions.signal }) }),
        );
      } catch (error) {
        throw new S3ArtifactBodyError(`download failed: ${error instanceof Error ? error.message : "unknown error"}`, "DOWNLOAD");
      }
      if (!response.ok) throw new S3ArtifactBodyError(`download failed with HTTP ${response.status}`, "DOWNLOAD");
      // Fast-fail size/MIME checks (skipped for the stored size when kms is set: the stored
      // bytes are ciphertext, so size is verified on the decrypted plaintext below).
      if (!options.kms) {
        const contentLength = response.headers.get("content-length");
        if (contentLength === null || Number(contentLength) !== ref.size) {
          throw new ArtifactBodyStoreError("download size does not match the reference size", "SIZE_MISMATCH");
        }
        const contentType = response.headers.get("content-type");
        if (contentType === null || contentType !== ref.mime) {
          throw new ArtifactBodyStoreError("download MIME type does not match the reference MIME", "MIME_MISMATCH");
        }
      }
      let bytes: Uint8Array;
      try {
        bytes = await readBoundedStream(response.body ?? new ReadableStream(), limits.maxBodyBytes);
      } catch (error) {
        if (error instanceof ArtifactBodyStoreError) throw error;
        throw new S3ArtifactBodyError(`download failed: ${error instanceof Error ? error.message : "unknown error"}`, "DOWNLOAD");
      }
      if (!options.kms && bytes.byteLength !== ref.size) {
        throw new ArtifactBodyStoreError(`download size ${bytes.byteLength} does not match ref size ${ref.size}`, "SIZE_MISMATCH");
      }
      const plaintext = options.kms ? await options.kms("decrypt", bytes) : bytes;
      if (plaintext.byteLength !== ref.size) {
        throw new ArtifactBodyStoreError(`download size ${plaintext.byteLength} does not match ref size ${ref.size}`, "SIZE_MISMATCH");
      }
      const hash = await sha256Hex(plaintext);
      if (hash !== ref.hash.toLowerCase()) {
        throw new ArtifactBodyStoreError("download SHA-256 does not match the reference hash", "HASH_MISMATCH");
      }
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(plaintext);
          controller.close();
        },
      });
    },

    async delete(ref, transferOptions) {
      validateRef(ref, limits);
      if (options.isHeld) {
        let held: boolean;
        try {
          held = await options.isHeld(ref);
        } catch (error) {
          throw new ArtifactBodyStoreError(`hold check failed: ${error instanceof Error ? error.message : "unknown error"}`, "STORE");
        }
        if (held) throw new ArtifactBodyStoreError("delete refused: resource is under legal hold", "HELD");
      }
      const credentials = await resolveCredentials();
      const date = amzDate();
      const path = objectPath(ref);
      let query: string;
      try {
        query = await presignV4({
          method: "DELETE",
          path,
          headers: { host: base.host },
          payloadHash: "UNSIGNED-PAYLOAD",
          region,
          service: "s3",
          amzDate: date,
          expiresSeconds: Math.ceil(limits.presignTtlMs / 1000),
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          ...(credentials.sessionToken === undefined ? {} : { sessionToken: credentials.sessionToken }),
        });
      } catch (error) {
        throw new S3ArtifactBodyError(`presign failed: ${error instanceof Error ? error.message : "unknown error"}`, "PRESIGN");
      }
      try {
        await semaphore.run(async () => {
          const response = await fetchImpl(`${base.origin}${path}?${query}`, {
            method: "DELETE",
            ...(transferOptions?.signal === undefined ? {} : { signal: transferOptions.signal }),
          });
          // 204 and 404 are both success: body delete is idempotent.
          if (response.status !== 204 && response.status !== 404) {
            throw new S3ArtifactBodyError(`delete failed with HTTP ${response.status}`, "DELETE");
          }
        });
      } catch (error) {
        if (error instanceof S3ArtifactBodyError) throw error;
        throw new S3ArtifactBodyError(`delete failed: ${error instanceof Error ? error.message : "unknown error"}`, "DELETE");
      }
    },

    async presign(ref, presignOptions) {
      validateRef(ref, limits);
      const ttlMs = presignOptions?.ttlMs ?? limits.presignTtlMs;
      if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > limits.presignTtlMs) {
        throw new ArtifactBodyStoreError("presign TTL must be a positive safe integer at or below presignTtlMs", "STORE");
      }
      return presignGet(ref, ttlMs, presignOptions?.signal);
    },
  };
}
