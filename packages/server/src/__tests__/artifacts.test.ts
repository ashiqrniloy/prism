import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { ArtifactError, type ArtifactRecord, type CheckpointStore, createMemoryCheckpointStore, createSecretRedactor } from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-session-store-sqlite";
import {
  type ArtifactService,
  createArtifactHandler,
  createArtifactService,
  signArtifactDeliveryLink,
  verifyArtifactDeliveryLink,
} from "../artifacts.js";

const ownership = { tenantId: "tenant-1", userId: "user-1" };
const otherOwnership = { tenantId: "tenant-1", userId: "user-2" };
const SECRET = "art-secret-value";
const LINK_SECRET = "delivery-link-key-material";

const identity = {
  tenantId: "tenant-1",
  userId: "user-1",
  principal: { kind: "user", id: "user-1" },
  scopes: ["artifact.write"],
  issuedAt: new Date().toISOString(),
  verified: true as const,
};

function makeService(
  options: {
    store?: CheckpointStore;
    limits?: Parameters<typeof createArtifactService>[1]["limits"];
    onDecision?: Parameters<typeof createArtifactService>[1]["onDecision"];
  } = {},
): { store: CheckpointStore; service: ArtifactService } {
  const store = options.store ?? createMemoryCheckpointStore();
  const service = createArtifactService(store, {
    redactor: createSecretRedactor([SECRET]),
    linkSecret: LINK_SECRET,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.onDecision === undefined ? {} : { onDecision: options.onDecision }),
  });
  return { store, service };
}

const attachInput = {
  threadId: "thread-1",
  uri: "https://blob.example/doc-v1",
  mime: "text/markdown",
  hash: "sha256:aaa",
};

describe("createArtifactService", () => {
  it("attaches an artifact with revision 1 in pending state", async () => {
    const { service } = makeService();
    const record = await service.attach({ ...attachInput, ownership, identity, title: "Doc" });
    assert.equal(record.threadId, "thread-1");
    assert.equal(record.revisions.length, 1);
    assert.equal(record.revisions[0].version, 1);
    assert.equal(record.revisions[0].hash, "sha256:aaa");
    assert.equal(record.approvals.length, 0);
    assert.equal(record.lastValidatedVersion, undefined);
    assert.equal(record.title, "Doc");
  });

  it("attach with an explicit id is idempotent get-or-create", async () => {
    const { service } = makeService();
    const first = await service.attach({ ...attachInput, ownership, id: "art-fixed" });
    const second = await service.attach({
      ...attachInput,
      uri: "https://blob.example/other",
      hash: "sha256:zzz",
      ownership,
      id: "art-fixed",
    });
    assert.equal(first.id, "art-fixed");
    assert.equal(second.id, "art-fixed");
    assert.equal(second.revisions.length, 1);
    assert.equal(second.revisions[0].hash, "sha256:aaa");
  });

  it("revise appends a revision and inherits mime when omitted", async () => {
    const { service } = makeService();
    const record = await service.attach({ ...attachInput, ownership });
    const revised = await service.revise({
      ownership,
      threadId: "thread-1",
      artifactId: record.id,
      uri: "https://blob.example/doc-v2",
      hash: "sha256:bbb",
      changeNote: "edits",
    });
    assert.equal(revised.revisions.length, 2);
    assert.equal(revised.revisions[1].version, 2);
    assert.equal(revised.revisions[1].mime, "text/markdown");
    assert.equal(revised.revisions[1].changeNote, "edits");
  });

  it("compare returns exactly two revisions with bounded change flags", async () => {
    const { service } = makeService();
    const record = await service.attach({ ...attachInput, ownership });
    await service.revise({
      ownership,
      threadId: "thread-1",
      artifactId: record.id,
      uri: "https://blob.example/doc-v2",
      hash: "sha256:bbb",
    });
    const diff = await service.compare({ ownership, threadId: "thread-1", artifactId: record.id, from: 1, to: 2 });
    assert.equal(diff.from.version, 1);
    assert.equal(diff.to.version, 2);
    assert.equal(diff.changed.hash, true);
    assert.equal(diff.changed.uri, true);
    assert.equal(diff.changed.mime, false);
  });

  it("compare rejects identical or missing revisions", async () => {
    const { service } = makeService();
    const record = await service.attach({ ...attachInput, ownership });
    await assert.rejects(
      () => service.compare({ ownership, threadId: "thread-1", artifactId: record.id, from: 1, to: 1 }),
      (error: unknown) => error instanceof ArtifactError && error.reason === "invalid_input",
    );
    await assert.rejects(
      () => service.compare({ ownership, threadId: "thread-1", artifactId: record.id, from: 1, to: 9 }),
      (error: unknown) => error instanceof ArtifactError && error.reason === "not_found",
    );
  });

  it("approve advances lastValidated and records the reviewer", async () => {
    const { service } = makeService();
    const record = await service.attach({ ...attachInput, ownership, identity });
    const approved = await service.approve({ ownership, identity, threadId: "thread-1", artifactId: record.id, version: 1 });
    assert.equal(approved.lastValidatedVersion, 1);
    assert.equal(approved.approvals.length, 1);
    assert.equal(approved.approvals[0].state, "approved");
    assert.equal(approved.approvals[0].reviewer, "user:user-1");
  });

  it("reject (request changes) keeps the last validated revision recoverable", async () => {
    const { service } = makeService();
    const record = await service.attach({ ...attachInput, ownership, identity });
    await service.approve({ ownership, identity, threadId: "thread-1", artifactId: record.id, version: 1 });
    const revised = await service.revise({
      ownership,
      threadId: "thread-1",
      artifactId: record.id,
      uri: "https://blob.example/doc-v2",
      hash: "sha256:bbb",
    });
    const rejected = await service.reject({
      ownership,
      identity,
      threadId: "thread-1",
      artifactId: revised.id,
      version: 2,
      note: "needs work",
    });
    assert.equal(rejected.lastValidatedVersion, 1);
    const decision = rejected.approvals.find((a) => a.version === 2);
    assert.equal(decision?.state, "rejected");
    assert.equal(decision?.note, "needs work");
    const last = await service.lastValidated({ ownership, threadId: "thread-1", artifactId: record.id });
    assert.equal(last.version, 1);
  });

  it("lastValidated fails closed before any approval", async () => {
    const { service } = makeService();
    const record = await service.attach({ ...attachInput, ownership });
    await assert.rejects(
      () => service.lastValidated({ ownership, threadId: "thread-1", artifactId: record.id }),
      (error: unknown) => error instanceof ArtifactError && error.reason === "not_validated",
    );
  });

  it("concurrent reviewers resolve via CAS without lost approvals", async () => {
    const base = createMemoryCheckpointStore();
    // Gate the first approve's commit so both reviewers load the same checkpoint version
    // before either writes, deterministically reproducing the concurrent-reviewer race.
    let armGate = false;
    let pausedOnce = false;
    let reachedSave!: () => void;
    const reached = new Promise<void>((resolve) => {
      reachedSave = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store: CheckpointStore = {
      ...base,
      async saveCheckpoint(input) {
        if (armGate && !pausedOnce) {
          pausedOnce = true;
          reachedSave();
          await gate;
        }
        return base.saveCheckpoint(input);
      },
    };
    const { service } = makeService({ store });
    const record = await service.attach({ ...attachInput, ownership, identity });
    await service.revise({
      ownership,
      threadId: "thread-1",
      artifactId: record.id,
      uri: "https://blob.example/doc-v2",
      hash: "sha256:bbb",
    });
    armGate = true;
    const first = service.approve({ ownership, identity, threadId: "thread-1", artifactId: record.id, version: 1 });
    await reached; // first reviewer has loaded and is about to commit (checkpoint still at v2)
    const second = service.approve({ ownership, identity, threadId: "thread-1", artifactId: record.id, version: 2 });
    const secondResult = await second; // wins the CAS (v2 -> v3)
    assert.equal(secondResult.lastValidatedVersion, 2);
    release(); // first reviewer's stale CAS (expected v2, now v3) must fail closed
    await assert.rejects(
      () => first,
      (error: unknown) => error instanceof ArtifactError && error.reason === "conflict",
    );
    // Exactly one approval is durable — no lost or duplicated decision.
    const final = await service.get({ ownership, threadId: "thread-1", artifactId: record.id });
    assert.equal(final.approvals.length, 1);
    assert.equal(final.approvals[0].version, 2);
  });

  it("a failed update rolls back (revision cap persists nothing)", async () => {
    const { service } = makeService({ limits: { revisionsPerArtifact: 1 } });
    const record = await service.attach({ ...attachInput, ownership });
    await assert.rejects(
      () =>
        service.revise({ ownership, threadId: "thread-1", artifactId: record.id, uri: "https://blob.example/doc-v2", hash: "sha256:bbb" }),
      (error: unknown) => error instanceof ArtifactError && error.reason === "too_many_revisions",
    );
    const after = await service.get({ ownership, threadId: "thread-1", artifactId: record.id });
    assert.equal(after.revisions.length, 1);
  });

  it("enforces the per-thread artifact cap", async () => {
    const { service } = makeService({ limits: { artifactsPerThread: 2 } });
    await service.attach({ ...attachInput, ownership, id: "art-a" });
    await service.attach({ ...attachInput, ownership, id: "art-b" });
    await assert.rejects(
      () => service.attach({ ...attachInput, ownership, id: "art-c" }),
      (error: unknown) => error instanceof ArtifactError && error.reason === "too_many_artifacts",
    );
  });

  it("denies cross-ownership access fail-closed as not-found", async () => {
    const { service } = makeService();
    const record = await service.attach({ ...attachInput, ownership });
    await assert.rejects(
      () => service.get({ ownership: otherOwnership, threadId: "thread-1", artifactId: record.id }),
      (error: unknown) => error instanceof ArtifactError && error.reason === "not_found",
    );
    const page = await service.list({ ownership: otherOwnership, threadId: "thread-1" });
    assert.equal(page.items.length, 0);
  });

  it("rejects local filesystem paths in uri and citations", async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.attach({ ...attachInput, uri: "file:///etc/passwd", ownership }),
      (error: unknown) => error instanceof ArtifactError && error.reason === "unsafe_uri",
    );
    await assert.rejects(
      () => service.attach({ ...attachInput, uri: "/home/user/doc.txt", ownership }),
      (error: unknown) => error instanceof ArtifactError && error.reason === "unsafe_uri",
    );
    await assert.rejects(
      () => service.attach({ ...attachInput, ownership, citations: [{ uri: "file:///secret" }] }),
      (error: unknown) => error instanceof ArtifactError && error.reason === "unsafe_uri",
    );
  });

  it("redacts secrets before persisting the record", async () => {
    const { store, service } = makeService();
    const record = await service.attach({ ...attachInput, ownership, title: `t-${SECRET}`, changeNote: `note-${SECRET}` });
    assert.ok(!JSON.stringify(record).includes(SECRET));
    // The stored checkpoint value is also redacted.
    const stored = await store.loadCheckpoint({ namespace: "prism.artifact", key: `thread-1:${record.id}`, ...ownership });
    assert.ok(stored);
    assert.ok(!JSON.stringify(stored.value).includes(SECRET));
  });

  it("emits redacted audit events via onDecision", async () => {
    const events: string[] = [];
    const { service } = makeService({
      onDecision: (event) => {
        events.push(event.type);
      },
    });
    const record = await service.attach({ ...attachInput, ownership, identity });
    await service.approve({ ownership, identity, threadId: "thread-1", artifactId: record.id, version: 1 });
    assert.deepEqual(events, ["artifact_attached", "artifact_approved"]);
  });
});

describe("artifact delivery links", () => {
  it("signs and verifies a round-trip token", async () => {
    const { service } = makeService();
    const record = await service.attach({ ...attachInput, ownership, identity });
    await service.approve({ ownership, identity, threadId: "thread-1", artifactId: record.id, version: 1 });
    const { link, token } = await service.deliveryLink({ ownership, threadId: "thread-1", artifactId: record.id });
    assert.equal(token.version, 1);
    const verified = verifyArtifactDeliveryLink(link, LINK_SECRET);
    assert.equal(verified.artifactId, record.id);
    assert.equal(verified.version, 1);
    assert.equal(verified.userId, "user-1");
  });

  it("defaults to the last validated revision", async () => {
    const { service } = makeService();
    const record = await service.attach({ ...attachInput, ownership, identity });
    await service.approve({ ownership, identity, threadId: "thread-1", artifactId: record.id, version: 1 });
    await service.revise({
      ownership,
      threadId: "thread-1",
      artifactId: record.id,
      uri: "https://blob.example/doc-v2",
      hash: "sha256:bbb",
    });
    const { token } = await service.deliveryLink({ ownership, threadId: "thread-1", artifactId: record.id });
    assert.equal(token.version, 1);
  });

  it("rejects tampered and expired links", () => {
    const token = {
      artifactId: "art-1",
      threadId: "thread-1",
      version: 1,
      ...ownership,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const link = signArtifactDeliveryLink(token, LINK_SECRET);
    assert.throws(
      () => verifyArtifactDeliveryLink(`${link.slice(0, -2)}xx`, LINK_SECRET),
      (error: unknown) => error instanceof ArtifactError && error.reason === "invalid_link",
    );
    assert.throws(
      () => verifyArtifactDeliveryLink(link, "wrong-secret"),
      (error: unknown) => error instanceof ArtifactError && error.reason === "invalid_link",
    );
    const expired = signArtifactDeliveryLink({ ...token, expiresAt: new Date(Date.now() - 1000).toISOString() }, LINK_SECRET);
    assert.throws(
      () => verifyArtifactDeliveryLink(expired, LINK_SECRET),
      (error: unknown) => error instanceof ArtifactError && error.reason === "link_expired",
    );
  });

  it("rejects over-long TTLs at the hard cap", async () => {
    const { service } = makeService();
    const record = await service.attach({ ...attachInput, ownership });
    await assert.rejects(
      () => service.deliveryLink({ ownership, threadId: "thread-1", artifactId: record.id, ttlSeconds: 999_999 }),
      RangeError,
    );
  });
});

describe("createArtifactHandler", () => {
  function jsonRequest(path: string, body?: unknown, method = "POST"): Request {
    return new Request(`https://example.test${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { "content-type": "application/json" },
    });
  }

  function handler(
    service: ArtifactService,
    authorize: () => false | { ownership: typeof ownership; identity?: typeof identity } = () => ({ ownership, identity }),
  ) {
    return createArtifactHandler({ service, authorize, linkSecret: LINK_SECRET, redactor: createSecretRedactor([SECRET]) });
  }

  it("serves attach/get/revise/approve/delivery/download over HTTP", async () => {
    const { service } = makeService();
    const h = handler(service);
    const created = await h(jsonRequest("/prism/artifacts/thread-1", attachInput));
    assert.equal(created.status, 201);
    const record = (await created.json()) as ArtifactRecord;

    const got = await h(jsonRequest(`/prism/artifacts/thread-1/${record.id}`, undefined, "GET"));
    assert.equal(got.status, 200);

    const revised = await h(
      jsonRequest(`/prism/artifacts/thread-1/${record.id}/revise`, { uri: "https://blob.example/doc-v2", hash: "sha256:bbb" }),
    );
    assert.equal(revised.status, 200);

    const approved = await h(jsonRequest(`/prism/artifacts/thread-1/${record.id}/approve`, { version: 1 }));
    assert.equal(approved.status, 200);

    const linkRes = await h(jsonRequest(`/prism/artifacts/thread-1/${record.id}/delivery-link`, {}));
    assert.equal(linkRes.status, 200);
    const { link } = (await linkRes.json()) as { link: string };

    const download = await h(jsonRequest(`/prism/artifacts/download?link=${encodeURIComponent(link)}`, undefined, "GET"));
    assert.equal(download.status, 200);
    const body = (await download.json()) as { revision: { version: number; uri: string } };
    assert.equal(body.revision.version, 1);
  });

  it("download reauthorizes and fails closed on ownership mismatch", async () => {
    const { service } = makeService();
    const record = await service.attach({ ...attachInput, ownership, identity });
    await service.approve({ ownership, identity, threadId: "thread-1", artifactId: record.id, version: 1 });
    const { link } = await service.deliveryLink({ ownership, threadId: "thread-1", artifactId: record.id });
    // Authorizer resolves a different ownership than the token carries -> 403.
    const foreign = handler(service, () => ({ ownership: otherOwnership }));
    const res = await foreign(jsonRequest(`/prism/artifacts/download?link=${encodeURIComponent(link)}`, undefined, "GET"));
    assert.equal(res.status, 403);
  });

  it("download rejects an expired link with 410", async () => {
    const { service } = makeService();
    const record = await service.attach({ ...attachInput, ownership });
    const expired = signArtifactDeliveryLink(
      {
        artifactId: record.id,
        threadId: "thread-1",
        version: 1,
        ...ownership,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      LINK_SECRET,
    );
    const h = handler(service);
    const res = await h(jsonRequest(`/prism/artifacts/download?link=${encodeURIComponent(expired)}`, undefined, "GET"));
    assert.equal(res.status, 410);
  });

  it("denies all routes when authorize returns false", async () => {
    const { service } = makeService();
    const denying = handler(service, () => false);
    const res = await denying(jsonRequest("/prism/artifacts/thread-1", attachInput));
    assert.equal(res.status, 403);
  });

  it("returns 404 for unknown artifacts and routes", async () => {
    const { service } = makeService();
    const h = handler(service);
    assert.equal((await h(jsonRequest("/prism/artifacts/thread-1/art-missing", undefined, "GET"))).status, 404);
    assert.equal((await h(jsonRequest("/prism/artifacts/thread-1/art-x/bogus", {}))).status, 404);
    assert.equal((await h(jsonRequest("/prism/artifacts", undefined, "GET"))).status, 404);
  });
});

describe("artifact durability (sqlite checkpoint store)", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  it("persists revisions/approvals across a store reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prism-art-"));
    tempDirs.push(dir);
    const filename = join(dir, "art.db");
    const redactor = createSecretRedactor([SECRET]);

    const first = createSqlitePersistence({ filename });
    const serviceA = createArtifactService(first.checkpoints, { redactor, linkSecret: LINK_SECRET });
    const record = await serviceA.attach({ ...attachInput, ownership, identity, id: "art-durable" });
    await serviceA.revise({
      ownership,
      threadId: "thread-1",
      artifactId: record.id,
      uri: "https://blob.example/doc-v2",
      hash: "sha256:bbb",
    });
    await serviceA.approve({ ownership, identity, threadId: "thread-1", artifactId: record.id, version: 1 });
    first.close();

    const second = createSqlitePersistence({ filename });
    const serviceB = createArtifactService(second.checkpoints, { redactor, linkSecret: LINK_SECRET });
    const reloaded = await serviceB.get({ ownership, threadId: "thread-1", artifactId: "art-durable" });
    assert.equal(reloaded.revisions.length, 2);
    assert.equal(reloaded.lastValidatedVersion, 1);
    const last = await serviceB.lastValidated({ ownership, threadId: "thread-1", artifactId: "art-durable" });
    assert.equal(last.version, 1);
    second.close();
  });
});
