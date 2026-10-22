import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { basename, isAbsolute } from "node:path";
import type { ArtifactBodyRef, ArtifactBodyStore, JsonObject } from "@arnilo/prism";
import { WorkToolError } from "./errors.js";

export interface UploadBytes {
  readonly bytes: Buffer;
  readonly contentHash: string;
  readonly name: string;
}

export function artifactRef(value: unknown): ArtifactBodyRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", "artifact must be an artifact body reference");
  }
  const row = value as Record<string, unknown>;
  const string = (key: string, max = 2_048): string => {
    const field = row[key];
    if (typeof field !== "string" || !field || Buffer.byteLength(field, "utf8") > max) {
      throw new WorkToolError("ERR_PRISM_WORK_INPUT", `artifact.${key} must be a bounded non-empty string`);
    }
    return field;
  };
  const size = row.size;
  const version = row.version;
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", "artifact size and version must be non-negative integers");
  }
  const hash = string("hash", 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "artifact.hash must be a SHA-256 hex digest");
  const accountId = row.accountId;
  const userId = row.userId;
  if (accountId !== undefined && (typeof accountId !== "string" || !accountId))
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", "artifact.accountId must be a string");
  if (userId !== undefined && (typeof userId !== "string" || !userId))
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", "artifact.userId must be a string");
  return {
    tenantId: string("tenantId", 512),
    artifactId: string("artifactId", 512),
    threadId: string("threadId", 512),
    version,
    mime: string("mime", 256),
    size,
    hash,
    ...(accountId === undefined ? {} : { accountId }),
    ...(userId === undefined ? {} : { userId }),
  };
}

export async function readUploadBytes(
  args: JsonObject,
  bodies: ArtifactBodyStore | undefined,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<UploadBytes> {
  const artifact = args.artifact;
  const filePath = args.filePath;
  if ((artifact === undefined) === (filePath === undefined)) {
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", "provide exactly one of artifact or filePath");
  }
  if (artifact !== undefined) {
    if (!bodies) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "artifact requires a configured artifact body store");
    const ref = artifactRef(artifact);
    if (ref.size > maxBytes) throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "File exceeds byte limit");
    const bytes = await readStream(await bodies.get(ref, { signal }), maxBytes, signal);
    return { bytes, contentHash: sha256(bytes), name: requiredString(args, "name") };
  }
  if (typeof filePath !== "string" || !filePath) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "filePath must be a non-empty string");
  if (isRemoteUrl(filePath)) throw new WorkToolError("ERR_PRISM_WORK_INPUT", "filePath must be a host-local path");
  const bytes = await readPath(filePath, maxBytes, signal);
  return { bytes, contentHash: sha256(bytes), name: basename(filePath) };
}

export function assertContentHash(args: JsonObject, actual: string): void {
  const expected = args.contentHash;
  if (expected !== undefined && (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected) || expected !== actual)) {
    throw new WorkToolError("ERR_PRISM_WORK_DRAFT_DIGEST", "File content changed after draft approval");
  }
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readPath(path: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  try {
    return await readChunks(createReadStream(path), maxBytes, signal);
  } catch (error) {
    if (error instanceof WorkToolError) throw error;
    throw new WorkToolError("ERR_PRISM_WORK_INPUT", "filePath could not be read from the host");
  }
}

async function readStream(stream: ReadableStream<Uint8Array>, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, total);
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "File exceeds byte limit");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
}

async function readChunks(stream: AsyncIterable<Uint8Array>, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    signal?.throwIfAborted();
    total += chunk.byteLength;
    if (total > maxBytes) throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "File exceeds byte limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

function requiredString(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new WorkToolError("ERR_PRISM_WORK_INPUT", `${key} must be a non-empty string`);
  return value;
}

function isRemoteUrl(value: string): boolean {
  try {
    new URL(value);
    return !isAbsolute(value);
  } catch {
    return false;
  }
}
