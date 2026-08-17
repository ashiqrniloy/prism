import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import type {
  AuditCursorStore,
  AuditExporter,
  AuditPageSource,
  AuditRedactionPolicy,
  AuditSiemSink,
  AuditWormSink,
  VerifyAuditBatchResult,
} from "../index.js";
import { AuditExportError, canonicalJson, createAuditExporter, createMemoryAuditCursorStore, verifyAuditBatch } from "../index.js";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const signer = {
  keyId: "k1",
  sign: (bytes: Uint8Array) => createSign("sha256").update(bytes).sign(keys.privateKey),
};
const TENANT = "acme";

function recordSource(records: Readonly<Record<string, unknown>>[]): AuditPageSource {
  // One-shot per (tenant, cursor): a page served with nextCursor=undefined is
  // exhausted, and re-reading that cursor yields nothing (matches durable
  // page tokens); the exporter replays failed batches from its held page
  // instead of re-reading.
  const served = new Set<string>();
  return {
    async read(input) {
      const key = `${input.tenantId}|${input.cursor ?? ""}`;
      if (served.has(key)) return { items: [], nextCursor: undefined };
      const start = input.cursor === undefined || input.cursor === "" ? 0 : Number(input.cursor);
      const items = records.slice(start, start + input.limit);
      const next = start + items.length;
      if (next >= records.length) {
        served.add(key);
        return { items: items.map((record) => ({ record })), nextCursor: undefined };
      }
      return { items: items.map((record) => ({ record })), nextCursor: String(next) };
    },
  };
}

function worm(): { sink: AuditWormSink; wrote: Array<{ batchId: string; digest: string; tenantId: string }>; fail: boolean } {
  const wrote: Array<{ batchId: string; digest: string; tenantId: string }> = [];
  const self: { sink: AuditWormSink; wrote: typeof wrote; fail: boolean } = { sink: null as unknown as AuditWormSink, wrote, fail: false };
  self.sink = {
    async write(input) {
      if (self.fail) throw new Error("worm unavailable");
      wrote.push({ batchId: input.batchId, digest: input.digest, tenantId: input.tenantId });
      return { batchId: input.batchId, digest: input.digest };
    },
  };
  return self;
}

function siem(): { sink: AuditSiemSink; sent: Array<{ batchId: string; tenantId: string }>; fail: boolean } {
  const sent: Array<{ batchId: string; tenantId: string }> = [];
  const self: { sink: AuditSiemSink; sent: typeof sent; fail: boolean } = { sink: null as unknown as AuditSiemSink, sent, fail: false };
  self.sink = {
    async write(input) {
      if (self.fail) throw new Error("siem unavailable");
      sent.push({ batchId: input.batchId, tenantId: input.tenantId });
    },
  };
  return self;
}

function exporter(
  store: AuditCursorStore,
  source: AuditPageSource,
  wormSink: AuditWormSink,
  siemSink?: AuditSiemSink,
  redact?: AuditRedactionPolicy,
): AuditExporter {
  return createAuditExporter({
    source,
    cursorStore: store,
    signer,
    wormSink,
    ...(siemSink ? { siemSink } : {}),
    ...(redact ? { redact } : {}),
  });
}

function run(artifact: Uint8Array, previousDigest?: string): VerifyAuditBatchResult {
  return verifyAuditBatch({ artifactBytes: artifact, publicKey: publicKeyPem, expectedTenantId: TENANT, previousDigest });
}

function mutate(text: string, index: number): Uint8Array {
  const out = Buffer.from(text, "utf8");
  out[index] = out[index] === 48 ? 49 : 48; // flip one ASCII digit
  return new Uint8Array(out);
}

describe("canonical JSON (RFC 8785 semantics)", () => {
  it("sorts keys with prefix-shortest-first order and drops whitespace", () => {
    assert.equal(canonicalJson({}), "{}");
    assert.equal(canonicalJson([]), "[]");
    assert.equal(canonicalJson({ a: "b" }), '{"a":"b"}');
    assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
    assert.equal(canonicalJson({ b: 1, a: { c: [1, 2] } }), '{"a":{"c":[1,2]},"b":1}');
    assert.equal(canonicalJson({ ab: 1, a: 2 }), '{"a":2,"ab":1}');
    assert.equal(canonicalJson({ a: 'a\\b"c\u0001' }), '{"a":"a\\\\b\\"c\\u0001"}');
  });

  it("renders numbers with the ECMAScript shortest round-trip and collapses -0", () => {
    assert.equal(canonicalJson({ x: -0 }), '{"x":0}');
    assert.equal(canonicalJson({ b: 1e30, a: 1 }), '{"a":1,"b":1e+30}');
    // biome-ignore lint/correctness/noPrecisionLoss: RFC 8785 vector exercising the ECMAScript shortest round-trip
    assert.equal(canonicalJson({ x: 123456789012345678901234567890 }), '{"x":1.2345678901234568e+29}');
    assert.equal(canonicalJson({ x: 0.000001 }), '{"x":0.000001}');
  });

  it("rejects non-finite, BigInt, undefined, function, and cyclic values", () => {
    assert.throws(() => canonicalJson({ x: NaN }), /non-finite/);
    assert.throws(() => canonicalJson({ x: Infinity }), /non-finite/);
    assert.throws(() => canonicalJson({ x: -Infinity }), /non-finite/);
    assert.throws(() => canonicalJson({ x: 1n }), /BigInt/);
    assert.throws(() => canonicalJson({ x: undefined }), /undefined/);
    assert.throws(() => canonicalJson({ x: () => undefined }), /function/);
    assert.throws(() => canonicalJson([undefined]), /undefined/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.throws(() => canonicalJson(cyclic), /cyclic/);
  });
});

describe("audit export", () => {
  it("produces byte-identical batches with a stable retry key", async () => {
    const records = Array.from({ length: 5 }, (_, index) => ({ kind: "payment", id: `p${index}`, amount: index * 10 }));
    const a = await exporter(createMemoryAuditCursorStore(), recordSource(records), worm().sink).exportNext({ tenantId: TENANT });
    const b = await exporter(createMemoryAuditCursorStore(), recordSource(records), worm().sink).exportNext({ tenantId: TENANT });
    assert.ok(a.artifactBytes && b.artifactBytes);
    assert.deepEqual(Buffer.from(a.artifactBytes), Buffer.from(b.artifactBytes));
    assert.equal(a.batchId, b.batchId);
  });

  it("fails verification on reorder, deletion, insertion, byte mutation, prior-digest mutation, signature mutation, and truncation", async () => {
    const records = Array.from({ length: 5 }, (_, index) => ({ kind: "grant", id: `g${index}`, n: index }));
    const store = createMemoryAuditCursorStore();
    const exp = exporter(store, recordSource(records), worm().sink);
    const result = await exp.exportNext({ tenantId: TENANT, maxRecords: 4 });
    assert.ok(result.artifactBytes);
    assert.equal(run(result.artifactBytes).ok, true);
    const ok = Buffer.from(result.artifactBytes).toString("utf8");

    // byte mutation inside the embedded canonical document / signature / truncation
    const docAt = ok.indexOf('"id":"g1"') + 6;
    assert.equal(run(mutate(ok, docAt)).ok, false);
    const sigAt = ok.indexOf('"value":"') + '"value":"'.length + 2;
    assert.equal(run(mutate(ok, sigAt)).ok, false);
    assert.equal(run(new Uint8Array(Buffer.from(ok).subarray(0, ok.length - 2))).ok, false);
    assert.equal(run(new Uint8Array(0)).ok, false);

    const parsed = JSON.parse(ok);
    const reorder = JSON.parse(parsed.document);
    parsed.document = canonicalJson({ ...reorder, records: [...reorder.records].reverse() });
    assert.equal(run(new Uint8Array(Buffer.from(canonicalJson(parsed), "utf8"))).ok, false);

    const deleteDoc = { ...reorder, records: reorder.records.slice(0, -1), lastSequence: reorder.lastSequence - 1 };
    parsed.document = canonicalJson(deleteDoc);
    assert.equal(run(new Uint8Array(Buffer.from(canonicalJson(parsed), "utf8"))).ok, false);

    const inserted = {
      ...reorder,
      records: [
        ...reorder.records.slice(0, 2),
        {
          ...reorder.records[0],
          sequence: reorder.records[2].sequence + 1,
          priorDigest: reorder.records[1].digest,
          digest: "0".repeat(64),
        },
      ],
    };
    parsed.document = canonicalJson(inserted);
    assert.equal(run(new Uint8Array(Buffer.from(canonicalJson(parsed), "utf8"))).ok, false);

    const priorShifted = {
      ...reorder,
      records: reorder.records.map((record: any, index: number) => (index === 1 ? { ...record, priorDigest: "1".repeat(64) } : record)),
    };
    parsed.document = canonicalJson(priorShifted);
    assert.equal(run(new Uint8Array(Buffer.from(canonicalJson(parsed), "utf8"))).ok, false);

    // cross-batch continuity on the same exporter's durable cursor
    const next = await exp.exportNext({ tenantId: TENANT });
    assert.equal(next.firstSequence, 5);
    assert.equal(run(next.artifactBytes!, result.nextDigest).ok, true);
    assert.equal(run(next.artifactBytes!, "0".repeat(64)).ok, false);
  });

  it("leaves the cursor unchanged when the worm fails or mis-acknowledges", async () => {
    const store = createMemoryAuditCursorStore();
    const w = worm();
    const exp = exporter(store, recordSource([{ id: "a" }, { id: "b" }]), w.sink);
    w.fail = true;
    await assert.rejects(exp.exportNext({ tenantId: TENANT }), (error: AuditExportError) => error.code === "ERR_PRISM_POLICY_AUDIT_WORM");
    assert.equal(await store.load(TENANT), undefined, "no cursor may exist after worm failure");

    w.fail = false;
    const first = await exp.exportNext({ tenantId: TENANT });
    assert.equal(first.wormAcked, true);
    assert.equal(w.wrote.length, 1);

    const store2 = createMemoryAuditCursorStore();
    const lying = createAuditExporter({
      source: recordSource([{ id: "a" }]),
      cursorStore: store2,
      signer,
      wormSink: {
        async write(input) {
          return { batchId: input.batchId, digest: "0".repeat(64) };
        },
      },
    });
    await assert.rejects(lying.exportNext({ tenantId: TENANT }), (error: AuditExportError) => error.code === "ERR_PRISM_POLICY_AUDIT_WORM");
    assert.equal(await store2.load(TENANT), undefined);
  });

  it("records replayable SIEM pending status without duplicate chain entries, then replays", async () => {
    const store = createMemoryAuditCursorStore();
    const w = worm();
    const s = siem();
    const exp = exporter(store, recordSource([{ id: "x" }, { id: "y" }]), w.sink, s.sink);

    s.fail = true;
    const first = await exp.exportNext({ tenantId: TENANT, maxRecords: 1 });
    assert.equal(first.siemStatus, "pending");
    assert.equal((await store.load(TENANT))?.siemPending.length, 1);
    assert.equal(w.wrote.length, 1, "worm holds exactly one chain entry");

    const second = await exp.exportNext({ tenantId: TENANT, maxRecords: 1 });
    assert.equal(second.siemStatus, "pending");
    assert.equal(w.wrote.length, 2, "second export appends a new chain entry, never a duplicate");
    assert.equal((await store.load(TENANT))?.siemPending.length, 2);

    s.fail = false;
    assert.ok(first.artifactBytes);
    await exp.retryPendingSiem({ tenantId: TENANT, batchId: first.batchId!, artifactBytes: first.artifactBytes });
    assert.equal(s.sent.length, 1);
    assert.equal((await store.load(TENANT))?.siemPending.length, 1, "only the second batch remains pending");
    assert.equal(w.wrote.length, 2, "replay never re-writes the worm");

    await assert.rejects(
      exp.retryPendingSiem({ tenantId: TENANT, batchId: first.batchId!, artifactBytes: new Uint8Array(4) }),
      (error: AuditExportError) => error.code === "ERR_PRISM_POLICY_AUDIT_STATE",
    );
    // a second successful replay is idempotent at the cursor level
    await exp.retryPendingSiem({ tenantId: TENANT, batchId: second.batchId!, artifactBytes: second.artifactBytes! });
    assert.equal((await store.load(TENANT))?.siemPending.length, 0);
  });

  it("keeps per-tenant chains and cursors isolated", async () => {
    const store = createMemoryAuditCursorStore();
    const w = worm();
    const exp = exporter(store, recordSource([{ id: "one" }]), w.sink);
    const a = await exp.exportNext({ tenantId: "tenant-a", maxRecords: 1 });
    const b = await exp.exportNext({ tenantId: "tenant-b", maxRecords: 1 });
    assert.equal(a.firstSequence, 1);
    assert.equal(b.firstSequence, 1);
    assert.notEqual(a.batchId, b.batchId);
    const verifiedA = verifyAuditBatch({ artifactBytes: a.artifactBytes!, publicKey: publicKeyPem, expectedTenantId: "tenant-a" });
    const wrongTenant = verifyAuditBatch({ artifactBytes: a.artifactBytes!, publicKey: publicKeyPem, expectedTenantId: "tenant-b" });
    assert.equal(verifiedA.ok, true);
    assert.equal(wrongTenant.ok, false);
    // unverified chain tails are never accepted
    await assert.rejects(
      exp.retryPendingSiem({ tenantId: "tenant-b", batchId: a.batchId!, artifactBytes: a.artifactBytes! }),
      (error: AuditExportError) => error.code === "ERR_PRISM_POLICY_AUDIT_STATE",
    );
  });

  it("preserves legal hold and hashes only the redacted record", async () => {
    const source: AuditPageSource = {
      async read() {
        return { items: [{ record: { ssn: "123-45-6789", name: "Ada", kind: "person" }, legalHold: true }] };
      },
    };
    const redact: AuditRedactionPolicy = {
      apply(record) {
        const { ssn: _removed, ...rest } = record;
        return { record: rest, redactions: [{ path: "$.ssn", reason: "pii" }] };
      },
    };
    const result = await exporter(createMemoryAuditCursorStore(), source, worm().sink, undefined, redact).exportNext({
      tenantId: TENANT,
      maxRecords: 1,
    });
    assert.ok(result.artifactBytes);
    const artifactText = Buffer.from(result.artifactBytes).toString("utf8");
    assert.ok(!artifactText.includes("123-45-6789"), "original value must never reach the artifact");
    // the artifact embeds the document as a single canonical string; inspect the
    // parsed document text for provenance fields
    const parsedArtifact = JSON.parse(artifactText) as { document: string };
    const documentText = parsedArtifact.document;
    assert.ok(documentText.includes('"$.ssn"') && documentText.includes('"pii"'), "redaction provenance travels into the chain");
    assert.ok(documentText.includes('"legalHold":true'), "legal hold provenance travels into the chain");
    assert.ok(documentText.includes("Ada"));
    assert.equal(run(result.artifactBytes).ok, true, "verifier sees exactly the exported bytes");
  });

  it("surfaces signer errors without advancing the cursor, and names the key for rotation", async () => {
    const failing = createAuditExporter({
      source: recordSource([{ id: "z" }]),
      cursorStore: createMemoryAuditCursorStore(),
      signer: { keyId: "k1", sign: () => Promise.reject(new Error("hsm unavailable")) },
      wormSink: worm().sink,
    });
    await assert.rejects(failing.exportNext({ tenantId: TENANT }), /hsm unavailable/);

    const result = await exporter(createMemoryAuditCursorStore(), recordSource([{ id: "z" }]), worm().sink).exportNext({
      tenantId: TENANT,
    });
    assert.ok(result.artifactBytes);
    assert.equal(JSON.parse(Buffer.from(result.artifactBytes).toString("utf8")).signature.keyId, "k1");

    const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString();
    const wrongKey = verifyAuditBatch({ artifactBytes: result.artifactBytes, publicKey: rotated, expectedTenantId: TENANT });
    assert.equal(wrongKey.ok, false);
    assert.ok(wrongKey.errors.some((error) => error.includes("signature")));
    assert.equal(run(result.artifactBytes).ok, true, "artifact still verifies under the key it names");
  });

  it("streams 10,000 records in bounded pages with a continuous verifiable chain", async () => {
    const records = Array.from({ length: 10_000 }, (_, index) => ({ kind: "event", id: `e${index}`, n: index }));
    const exp = exporter(createMemoryAuditCursorStore(), recordSource(records), worm().sink);
    let previousDigest: string | undefined;
    let total = 0;
    let batches = 0;
    for (;;) {
      const result = await exp.exportNext({ tenantId: TENANT, maxRecords: 1_000 });
      if (result.recordCount === 0) break;
      batches += 1;
      assert.ok(batches <= 10, "pagination must terminate at the record boundary");
      assert.ok(result.recordCount <= 1_000);
      total += result.recordCount;
      const verified = run(result.artifactBytes!, previousDigest);
      assert.ok(verified.ok, verified.errors.join("; "));
      previousDigest = result.nextDigest;
    }
    assert.equal(batches, 10);
    assert.equal(total, 10_000);
    assert.equal(previousDigest?.length, 64);
  });

  it("honors per-batch record and byte budgets", async () => {
    const exp = exporter(
      createMemoryAuditCursorStore(),
      recordSource(Array.from({ length: 10 }, (_, index) => ({ id: `r${index}` }))),
      worm().sink,
    );
    const first = await exp.exportNext({ tenantId: TENANT, maxRecords: 3 });
    assert.equal(first.recordCount, 3);
    const second = await exp.exportNext({ tenantId: TENANT, maxRecords: 2 });
    assert.equal(second.recordCount, 2);
    assert.equal(second.firstSequence, 4);

    const big = exporter(createMemoryAuditCursorStore(), recordSource([{ blob: "x".repeat(2 * 1024 * 1024) }]), worm().sink);
    await assert.rejects(
      big.exportNext({ tenantId: TENANT, maxBytes: 1024 }),
      (error: AuditExportError) => error.code === "ERR_PRISM_POLICY_AUDIT_CAP",
    );
  });

  it("validates expected sequence boundaries and tenant", async () => {
    const result = await exporter(createMemoryAuditCursorStore(), recordSource([{ id: "a" }, { id: "b" }]), worm().sink).exportNext({
      tenantId: TENANT,
    });
    assert.ok(result.artifactBytes);
    const ok = verifyAuditBatch({
      artifactBytes: result.artifactBytes,
      publicKey: publicKeyPem,
      expectedTenantId: TENANT,
      expectedFirstSequence: 1,
      expectedLastSequence: 2,
    });
    assert.equal(ok.ok, true);
    const badLast = verifyAuditBatch({
      artifactBytes: result.artifactBytes,
      publicKey: publicKeyPem,
      expectedTenantId: TENANT,
      expectedLastSequence: 3,
    });
    assert.equal(badLast.ok, false);
    assert.ok(badLast.errors.some((error) => error.includes("last sequence")));
    const wrongTenant = verifyAuditBatch({ artifactBytes: result.artifactBytes, publicKey: publicKeyPem, expectedTenantId: "another" });
    assert.equal(wrongTenant.ok, false);
  });
});
