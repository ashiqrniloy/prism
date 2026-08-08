import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { afterEach, describe, it } from "node:test";
import { type ArtifactBodyRef, type ArtifactBodyStore, ArtifactBodyStoreError } from "@arnilo/prism";
import { createS3ArtifactBodyStore, type S3ArtifactBodyError, s3ObjectKey } from "../artifact-bodies.js";
import { sha256Hex, signV4 } from "../artifact-bodies-s3.js";

const ACCESS_KEY = "AKIDEXAMPLE";
const SECRET_KEY = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";

const servers: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

interface FakeS3Options {
  readonly delayMs?: number;
  readonly failStatus?: number;
  readonly tamperKey?: string;
  readonly wrongLengthKey?: string;
  readonly wrongTypeKey?: string;
}

interface FakeS3 {
  readonly origin: string;
  readonly objects: Map<string, { body: Buffer; contentType: string }>;
  readonly requests: Array<{ method: string; url: string; headers: Record<string, string | string[] | undefined>; body: Buffer }>;
  readonly maxConcurrent: () => number;
  readonly close: () => Promise<void>;
}

/** Minimal S3-compatible fake that verifies every SigV4 signature before serving. */
async function startFakeS3(options: FakeS3Options = {}): Promise<FakeS3> {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const requests: FakeS3["requests"] = [];
  let concurrent = 0;
  let peak = 0;

  async function verifySignature(req: IncomingMessage, url: URL, _body: Buffer): Promise<boolean> {
    const amzDate = (req.headers["x-amz-date"] as string | undefined) ?? url.searchParams.get("X-Amz-Date");
    if (!amzDate) return false;
    const credential = url.searchParams.get("X-Amz-Credential");
    const accessKeyId = credential?.split("/")[0] ?? ACCESS_KEY;
    const region = credential?.split("/")[2] ?? "us-east-1";
    const service = credential?.split("/")[3] ?? "s3";
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      if (key !== "X-Amz-Signature") query[key] = value;
    }
    const signedHeaders = (url.searchParams.get("X-Amz-SignedHeaders") ?? "host").split(";");
    const authorization = req.headers.authorization as string | undefined;
    if (authorization) {
      const match = /SignedHeaders=([^,]+)/.exec(authorization);
      if (match) signedHeaders.splice(0, signedHeaders.length, ...match[1].split(";"));
    }
    const headers: Record<string, string> = { host: req.headers.host ?? "" };
    for (const name of signedHeaders) {
      if (name === "host") continue;
      const value = req.headers[name];
      if (typeof value !== "string") return false;
      headers[name] = value;
    }
    const payloadHash =
      url.searchParams.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256"
        ? "UNSIGNED-PAYLOAD"
        : ((req.headers["x-amz-content-sha256"] as string | undefined) ?? "");
    const { signature } = await signV4({
      method: req.method ?? "GET",
      path: url.pathname,
      query,
      headers,
      signedHeaders,
      payloadHash,
      region,
      service,
      amzDate,
      accessKeyId,
      secretAccessKey: SECRET_KEY,
    });
    const expected = url.searchParams.get("X-Amz-Signature");
    if (expected) return signature === expected;
    if (!authorization) return false;
    return authorization.includes(`Signature=${signature}`);
  }

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
    concurrent += 1;
    peak = Math.max(peak, concurrent);
    try {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (options.failStatus !== undefined) {
        res.writeHead(options.failStatus).end("boom");
        return;
      }
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!(await verifySignature(req, url, body))) {
        res.writeHead(403).end("signature mismatch");
        return;
      }
      const key = url.pathname.slice(1);
      if (req.method === "PUT") {
        const sentHash = req.headers["x-amz-content-sha256"] as string | undefined;
        if (sentHash !== (await sha256Hex(new Uint8Array(body)))) {
          res.writeHead(400).end("checksum mismatch");
          return;
        }
        objects.set(key, { body, contentType: (req.headers["content-type"] as string) ?? "application/octet-stream" });
        res.writeHead(200).end();
        return;
      }
      if (req.method === "GET") {
        const stored = objects.get(key);
        if (!stored) {
          res.writeHead(404).end("not found");
          return;
        }
        let payload = stored.body;
        let contentType = stored.contentType;
        if (options.tamperKey !== undefined && key.endsWith(options.tamperKey)) payload = Buffer.from("xxxxx");
        if (options.wrongLengthKey !== undefined && key.endsWith(options.wrongLengthKey)) {
          res.writeHead(200, { "content-type": contentType, "content-length": String(payload.length + 1) });
          res.end(payload);
          return;
        }
        if (options.wrongTypeKey !== undefined && key.endsWith(options.wrongTypeKey)) contentType = "application/octet-stream";
        res.writeHead(200, { "content-type": contentType, "content-length": String(payload.length) });
        res.end(payload);
        return;
      }
      if (req.method === "DELETE") {
        objects.delete(key);
        res.writeHead(204).end();
        return;
      }
      res.writeHead(405).end();
    } finally {
      concurrent -= 1;
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fake s3 failed to listen");
  const origin = `http://127.0.0.1:${address.port}`;
  servers.push({ close: () => new Promise((resolve) => server.close(() => resolve())) });
  return {
    origin,
    objects,
    requests,
    maxConcurrent: () => peak,
    close: servers[servers.length - 1].close,
  };
}

function makeRef(overrides: Partial<ArtifactBodyRef> = {}): ArtifactBodyRef {
  return {
    tenantId: "tenant-1",
    accountId: "acct-1",
    userId: "user-1",
    artifactId: "art-1",
    threadId: "thread-1",
    version: 1,
    mime: "text/plain",
    size: 5,
    hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", // sha256("hello")
    ...overrides,
  };
}

async function makeStore(fake: FakeS3, options: Partial<Parameters<typeof createS3ArtifactBodyStore>[0]> = {}) {
  return createS3ArtifactBodyStore({
    endpoint: fake.origin,
    bucket: "prism-bucket",
    region: "us-east-1",
    credentials: () => ({ accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY }),
    ...options,
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function errorCode(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => Promise.reject(new Error("expected rejection")),
    (error: unknown) => {
      if (error instanceof ArtifactBodyStoreError || (error as S3ArtifactBodyError).code?.startsWith("ERR_PRISM_S3_")) {
        return (error as { code: string }).code;
      }
      throw error;
    },
  );
}

describe("SigV4 signing", () => {
  it("matches the official AWS sig-v4-test-suite get-vanilla vector", async () => {
    const { signature } = await signV4({
      method: "GET",
      path: "/",
      headers: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" },
      signedHeaders: ["host", "x-amz-date"],
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      region: "us-east-1",
      service: "service",
      amzDate: "20150830T123600Z",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    });
    assert.equal(signature, "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
  });
});

describe("createS3ArtifactBodyStore", () => {
  it("round-trips a body through a signature-verifying fake store", async () => {
    const fake = await startFakeS3();
    const store = await makeStore(fake);
    const ref = makeRef();
    await store.put(ref, new TextEncoder().encode("hello"));
    const stream = await store.get(ref);
    assert.equal(new TextDecoder().decode(await readAll(stream)), "hello");
    assert.equal(fake.objects.size, 1);
    const key = s3ObjectKey(ref);
    assert.equal(fake.objects.has(`prism-bucket/${key}`), true);
    const put = fake.requests.find((request) => request.method === "PUT");
    assert.ok(put, "expected a PUT request");
    assert.equal(put.headers["x-amz-content-sha256"], ref.hash);
    assert.equal(put.headers["content-type"], "text/plain");
    const authorization = put.headers.authorization;
    assert.equal(typeof authorization, "string");
    assert.ok((authorization as string).startsWith("AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/"));
    const get = fake.requests.find((request) => request.method === "GET");
    assert.ok(get, "expected a GET request");
    assert.ok(get.url?.includes("X-Amz-Signature="), "presigned GET must carry a signature");
  });

  it("accepts a stream body and verifies it before upload", async () => {
    const fake = await startFakeS3();
    const store = await makeStore(fake);
    const ref = makeRef();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("he"));
        controller.enqueue(new TextEncoder().encode("llo"));
        controller.close();
      },
    });
    await store.put(ref, stream);
    assert.equal(fake.objects.size, 1);
  });

  it("fails closed on hash mismatch before any upload", async () => {
    const fake = await startFakeS3();
    const store = await makeStore(fake);
    const ref = makeRef({ hash: "0".repeat(64) });
    assert.equal(await errorCode(store.put(ref, new TextEncoder().encode("hello"))), "ERR_PRISM_ARTIFACT_BODY_HASH_MISMATCH");
    assert.equal(fake.requests.length, 0, "no upload may reach the store");
  });

  it("fails closed on size mismatch", async () => {
    const fake = await startFakeS3();
    const store = await makeStore(fake);
    const ref = makeRef({ size: 4 });
    assert.equal(await errorCode(store.put(ref, new TextEncoder().encode("hello"))), "ERR_PRISM_ARTIFACT_BODY_SIZE_MISMATCH");
    assert.equal(fake.requests.length, 0);
  });

  it("rejects bodies over maxBodyBytes", async () => {
    const fake = await startFakeS3();
    const store = await makeStore(fake, { limits: { maxBodyBytes: 4 } });
    const ref = makeRef({ size: 5 });
    assert.equal(await errorCode(store.put(ref, new TextEncoder().encode("hello"))), "ERR_PRISM_ARTIFACT_BODY_STORE");
  });

  it("fails closed on download size mismatch", async () => {
    const fake = await startFakeS3({ wrongLengthKey: s3ObjectKey(makeRef()) });
    const store = await makeStore(fake);
    const ref = makeRef();
    await store.put(ref, new TextEncoder().encode("hello"));
    assert.equal(await errorCode(store.get(ref)), "ERR_PRISM_ARTIFACT_BODY_SIZE_MISMATCH");
  });

  it("fails closed on download MIME mismatch", async () => {
    const fake = await startFakeS3({ wrongTypeKey: s3ObjectKey(makeRef()) });
    const store = await makeStore(fake);
    const ref = makeRef();
    await store.put(ref, new TextEncoder().encode("hello"));
    assert.equal(await errorCode(store.get(ref)), "ERR_PRISM_ARTIFACT_BODY_MIME_MISMATCH");
  });

  it("fails closed on tampered download content", async () => {
    const fake = await startFakeS3({ tamperKey: s3ObjectKey(makeRef()) });
    const store = await makeStore(fake);
    const ref = makeRef();
    await store.put(ref, new TextEncoder().encode("hello"));
    assert.equal(await errorCode(store.get(ref)), "ERR_PRISM_ARTIFACT_BODY_HASH_MISMATCH");
  });

  it("delete is idempotent", async () => {
    const fake = await startFakeS3();
    const store = await makeStore(fake);
    const ref = makeRef();
    await store.put(ref, new TextEncoder().encode("hello"));
    await store.delete(ref);
    await store.delete(ref); // second delete of a missing object is still success
    assert.equal(fake.objects.size, 0);
  });

  it("refuses delete while the resource is under legal hold", async () => {
    const fake = await startFakeS3();
    const store = await makeStore(fake, { isHeld: (candidate) => candidate.artifactId === "art-1" });
    const ref = makeRef();
    await store.put(ref, new TextEncoder().encode("hello"));
    assert.equal(await errorCode(store.delete(ref)), "ERR_PRISM_ARTIFACT_BODY_HELD");
    assert.equal(fake.objects.size, 1, "held body must survive");
    const other = makeRef({ artifactId: "art-2" });
    await store.put(other, new TextEncoder().encode("hello"));
    await store.delete(other);
    assert.equal(fake.objects.size, 1);
  });

  it("presigns a bounded-TTL delivery URL", async () => {
    const fake = await startFakeS3();
    const store = await makeStore(fake);
    const ref = makeRef();
    const url = await store.presign(ref, { ttlMs: 60_000 });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    assert.equal(parsed.searchParams.get("X-Amz-Expires"), "60");
    assert.equal(parsed.searchParams.get("X-Amz-SignedHeaders"), "host");
    assert.ok(parsed.searchParams.get("X-Amz-Signature"));
    assert.equal(parsed.pathname, `/prism-bucket/${s3ObjectKey(ref)}`);
  });

  it("rejects presign TTLs beyond the cap", async () => {
    const fake = await startFakeS3();
    const store = await makeStore(fake, { limits: { presignTtlMs: 60_000 } });
    const ref = makeRef();
    assert.equal(await errorCode(store.presign(ref, { ttlMs: 60_001 })), "ERR_PRISM_ARTIFACT_BODY_STORE");
    assert.equal(await errorCode(store.presign(ref, { ttlMs: 0 })), "ERR_PRISM_ARTIFACT_BODY_STORE");
  });

  it("surfaces typed errors on credential resolution failure", async () => {
    const fake = await startFakeS3();
    const store = await makeStore(fake, { credentials: () => ({ accessKeyId: "", secretAccessKey: "" }) });
    const ref = makeRef();
    assert.equal(await errorCode(store.put(ref, new TextEncoder().encode("hello"))), "ERR_PRISM_S3_CREDENTIALS");
    const throwing = await makeStore(fake, {
      credentials: () => {
        throw new Error("vault unreachable");
      },
    });
    assert.equal(await errorCode(throwing.presign(ref)), "ERR_PRISM_S3_CREDENTIALS");
  });

  it("surfaces typed errors on object-store outage, never silent success", async () => {
    const fake = await startFakeS3({ failStatus: 500 });
    const store = await makeStore(fake);
    const ref = makeRef();
    assert.equal(await errorCode(store.put(ref, new TextEncoder().encode("hello"))), "ERR_PRISM_S3_UPLOAD");
    assert.equal(await errorCode(store.get(ref)), "ERR_PRISM_S3_DOWNLOAD");
    assert.equal(await errorCode(store.delete(ref)), "ERR_PRISM_S3_DELETE");
  });

  it("supports host-owned client-side encryption via the kms callback", async () => {
    const fake = await startFakeS3();
    const store = await makeStore(fake, {
      kms: async (op, body) => (op === "encrypt" ? new Uint8Array([...body, 0]) : body.slice(0, -1)),
    });
    const ref = makeRef();
    await store.put(ref, new TextEncoder().encode("hello"));
    const stored = fake.objects.get(`prism-bucket/${s3ObjectKey(ref)}`);
    assert.ok(stored, "body must be stored");
    assert.equal(stored.body.length, 6, "stored bytes are ciphertext (plaintext + 1)");
    assert.equal(new TextDecoder().decode(await readAll(await store.get(ref))), "hello");
  });

  it("bounds concurrent transfers", async () => {
    const fake = await startFakeS3({ delayMs: 30 });
    const store = await makeStore(fake, { limits: { maxConcurrentTransfers: 1 } });
    const ref = makeRef();
    await Promise.all([
      store.put(ref, new TextEncoder().encode("hello")),
      store.put(makeRef({ artifactId: "art-2" }), new TextEncoder().encode("hello")),
      store.put(makeRef({ artifactId: "art-3" }), new TextEncoder().encode("hello")),
    ]);
    assert.equal(fake.maxConcurrent(), 1);
  });

  it("requires ownership on every reference", async () => {
    const fake = await startFakeS3();
    const store = await makeStore(fake);
    const ref = makeRef({ tenantId: undefined, accountId: undefined, userId: undefined });
    assert.equal(await errorCode(store.put(ref, new TextEncoder().encode("hello"))), "ERR_PRISM_ARTIFACT_BODY_OWNERSHIP");
    assert.equal(await errorCode(store.get(ref)), "ERR_PRISM_ARTIFACT_BODY_OWNERSHIP");
    assert.equal(await errorCode(store.delete(ref)), "ERR_PRISM_ARTIFACT_BODY_OWNERSHIP");
    assert.equal(await errorCode(store.presign(ref)), "ERR_PRISM_ARTIFACT_BODY_OWNERSHIP");
  });

  it("rejects malformed references fail closed", async () => {
    const fake = await startFakeS3();
    const store = await makeStore(fake);
    const ref = makeRef({ hash: "not-a-hash" });
    assert.equal(await errorCode(store.put(ref, new TextEncoder().encode("hello"))), "ERR_PRISM_ARTIFACT_BODY_STORE");
    assert.equal(await errorCode(store.presign(makeRef({ version: 0 }))), "ERR_PRISM_ARTIFACT_BODY_STORE");
    assert.equal(await errorCode(store.presign(makeRef({ mime: "" }))), "ERR_PRISM_ARTIFACT_BODY_STORE");
  });

  it("rejects non-loopback http endpoints and invalid buckets", async () => {
    const fake = await startFakeS3();
    assert.throws(
      () =>
        createS3ArtifactBodyStore({
          endpoint: "http://s3.example.com",
          bucket: "b",
          credentials: () => ({ accessKeyId: "a", secretAccessKey: "s" }),
        }),
      (error: unknown) => error instanceof ArtifactBodyStoreError && error.reason === "STORE",
    );
    assert.throws(
      () =>
        createS3ArtifactBodyStore({
          endpoint: fake.origin,
          bucket: "bad/bucket",
          credentials: () => ({ accessKeyId: "a", secretAccessKey: "s" }),
        }),
      (error: unknown) => error instanceof ArtifactBodyStoreError && error.reason === "STORE",
    );
  });

  it("never discloses bucket or key in errors", async () => {
    const fake = await startFakeS3({ failStatus: 500 });
    const store = await makeStore(fake);
    const ref = makeRef();
    const error = await store.put(ref, new TextEncoder().encode("hello")).then(
      () => Promise.reject(new Error("expected rejection")),
      (caught: unknown) => caught as Error,
    );
    assert.ok(!error.message.includes("prism-bucket"));
    assert.ok(!error.message.includes("prism-artifacts"));
    assert.ok(!error.message.includes("tenant-1"));
  });
});

describe("ArtifactBodyStore contract", () => {
  it("is satisfied by the S3 adapter (put/get/delete/presign by opaque ref)", async () => {
    const fake = await startFakeS3();
    const store: ArtifactBodyStore = await makeStore(fake);
    const ref = makeRef();
    await store.put(ref, new TextEncoder().encode("hello"));
    assert.equal(new TextDecoder().decode(await readAll(await store.get(ref))), "hello");
    assert.ok((await store.presign(ref)).includes("X-Amz-Signature="));
    await store.delete(ref);
    assert.equal(fake.objects.size, 0);
  });
});
