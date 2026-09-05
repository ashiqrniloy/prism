/**
 * Plans/064 Task 9 live artifact-bodies S3 adapter probes against a real
 * S3-compatible endpoint (AWS S3, MinIO, ...). Env-gated: skipped (never
 * failed) unless PRISM_TEST_S3_ENDPOINT, PRISM_TEST_S3_KEY,
 * PRISM_TEST_S3_SECRET, and PRISM_TEST_S3_BUCKET are all set — use a
 * dedicated throwaway bucket. PRISM_TEST_S3_REGION overrides the SigV4
 * scope (default us-east-1). Bounded: ≤ 3 real requests
 * (PUT, GET, DELETE; presign is signature-only).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ArtifactBodyRef } from "@arnilo/prism";
import { createS3ArtifactBodyStore, type S3ArtifactBodyStoreOptions } from "../artifact-bodies.js";

const ENDPOINT = process.env.PRISM_TEST_S3_ENDPOINT;
const KEY = process.env.PRISM_TEST_S3_KEY;
const SECRET = process.env.PRISM_TEST_S3_SECRET;
const BUCKET = process.env.PRISM_TEST_S3_BUCKET;
const REGION = process.env.PRISM_TEST_S3_REGION ?? "us-east-1";
const skip: string | false =
  !ENDPOINT || !KEY || !SECRET || !BUCKET
    ? "set PRISM_TEST_S3_ENDPOINT, PRISM_TEST_S3_KEY, PRISM_TEST_S3_SECRET, and PRISM_TEST_S3_BUCKET (a throwaway bucket) to run live S3 artifact-body probes"
    : false;

const PLAINTEXT = new TextEncoder().encode("prism-live-artifact-body-probe");

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Buffer.from(digest).toString("hex");
}

function ref(hash: string, size: number): ArtifactBodyRef {
  return {
    tenantId: "live-s3-tenant",
    accountId: "live-s3-account",
    userId: "live-s3-user",
    artifactId: "live-probe-artifact",
    threadId: "live-probe-thread",
    version: 1,
    mime: "text/plain",
    size,
    hash,
  };
}

function storeOptions(): S3ArtifactBodyStoreOptions {
  return {
    endpoint: ENDPOINT!,
    bucket: BUCKET!,
    region: REGION,
    credentials: () => ({ accessKeyId: KEY!, secretAccessKey: SECRET! }),
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

describe("@arnilo/prism-core runtime/server artifact-bodies S3 live tests", () => {
  it("live_put_get_presign_delete_lifecycle", { skip }, async () => {
    const hash = await sha256Hex(PLAINTEXT);
    const bodyRef = ref(hash, PLAINTEXT.byteLength);
    const store = createS3ArtifactBodyStore(storeOptions());

    await store.put(bodyRef, PLAINTEXT);
    const downloaded = await store.get(bodyRef);
    const bytes = await readAll(downloaded);
    assert.equal(
      Buffer.from(bytes).toString("utf8"),
      "prism-live-artifact-body-probe",
      "GET must return the exact uploaded plaintext (hash + size verified by the store)",
    );

    const url = await store.presign(bodyRef, { ttlMs: 60_000 });
    assert.ok(url.includes("X-Amz-Signature="), "presigned delivery URL must carry a SigV4 signature");

    await store.delete(bodyRef);
    await store.delete(bodyRef); // idempotent: second delete observes 404 and still succeeds
  });
});
