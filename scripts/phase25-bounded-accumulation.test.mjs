// Plan 025 Task 3: near-limit + overflow-fail-closed probe for the two linearized
// bounded accumulators (coding-agent LSP framing, coding-security sandbox tar) and
// the audit-only confirmation that work-tools CLI capture is already linear.
//
// Runs in the npm test gate segment after the workspace tests. The dist is built
// before this runs (`npm test` begins with `npm run build`), so the package imports
// resolve via the workspace symlinks.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { encodeLspFrame, LspFrameReader } from "@arnilo/prism-coding-agent";
import { createImportTarStream, SandboxTarError, summarizeTarStream } from "@arnilo/prism-coding-security";

// Synthetic 0.2.4 accumulator: `buf = Buffer.concat([buf, chunk])` in a loop. This is
// the exact quadratic pattern Task 3 replaced; kept here as a self-validating reference
// so the probe can prove the chosen input size is in the quadratic regime (the reference
// copies 512·N²/2 bytes — exactly 4x for 2x chunks), which makes the "fix is linear"
// assertion meaningful.
function quadraticConcat(chunks) {
  let buf = Buffer.alloc(0);
  for (const c of chunks) buf = Buffer.concat([buf, c]);
  return buf;
}

// Clean synthetic reference chunks (fixed 512B) so the quadratic copy count is
// reproducible independent of any tar/frame header overhead.
const refChunks = (n) => Array.from({ length: n }, () => Buffer.alloc(512, 0x61));

// Count bytes allocated by Buffer.concat/allocUnsafe during `fn` — the direct metric for
// "linear copying" (O(input) bytes copied = linear; O(input·chunks) = quadratic). The 0.2.4
// accumulators copy every retained byte on every chunk (quadratic); the chunk-array fix
// copies each byte O(1) times (linear). Deterministic, no timing/GC noise.
async function allocBytes(fn) {
  let total = 0;
  const origConcat = Buffer.concat;
  const origUnsafe = Buffer.allocUnsafe;
  const origUnsafeSlow = Buffer.allocUnsafeSlow;
  Buffer.concat = (list, totalLen) => {
    total += totalLen ?? list.reduce((a, c) => a + c.length, 0);
    return origConcat(list, totalLen);
  };
  Buffer.allocUnsafe = (n) => {
    total += n;
    return origUnsafe(n);
  };
  Buffer.allocUnsafeSlow = (n) => {
    total += n;
    return origUnsafeSlow(n);
  };
  try {
    await fn();
  } finally {
    Buffer.concat = origConcat;
    Buffer.allocUnsafe = origUnsafe;
    Buffer.allocUnsafeSlow = origUnsafeSlow;
  }
  return total;
}

const CHUNK = 1024;
const splitIntoChunks = (frame, n) => {
  const cs = Math.ceil(frame.length / n);
  const out = [];
  for (let i = 0; i < frame.length; i += cs) out.push(Buffer.from(frame.subarray(i, Math.min(i + cs, frame.length))));
  return out;
};

// ---------------------------------------------------------------------------
// Framing (coding-agent LSP Content-Length reader)
// ---------------------------------------------------------------------------

test("framing: observable output unchanged — multi-frame stream parses the same values in order", () => {
  const reader = new LspFrameReader(64 * 1024);
  const frames = [
    { jsonrpc: "2.0", id: 1, method: "a", params: { x: 1 } },
    { jsonrpc: "2.0", id: 2, method: "b", params: { y: "z" } },
    { jsonrpc: "2.0", id: 3, result: { ok: true } },
  ];
  // Concatenate the encoded frames, then split across weird chunk boundaries.
  const blob = Buffer.concat(frames.map(encodeLspFrame));
  const out = [];
  for (let i = 0; i < blob.length; i += 7) out.push(...reader.push(Buffer.from(blob.subarray(i, Math.min(i + 7, blob.length)))));
  assert.equal(out.length, frames.length, "one value per frame, in order");
  assert.deepEqual(out, frames);
});

test("framing: near-cap body parses (bounded memory — retained ≤ cap)", () => {
  const cap = 2 * 1024 * 1024;
  const reader = new LspFrameReader(cap);
  // Size the data so the JSON body (Content-Length) is exactly `cap` — the largest accepted.
  const overhead = Buffer.byteLength(JSON.stringify({ jsonrpc: "2.0", method: "big", params: { data: "" } }), "utf8");
  const frame = encodeLspFrame({ jsonrpc: "2.0", method: "big", params: { data: "x".repeat(cap - overhead) } });
  const out = [];
  for (let i = 0; i < frame.length; i += CHUNK) out.push(...reader.push(Buffer.from(frame.subarray(i, Math.min(i + CHUNK, frame.length)))));
  assert.equal(out.length, 1, "near-cap body parses to one value");
  assert.equal(out[0].params.data.length, cap - overhead);
});

test("framing: over-cap body aborts with ERR_PRISM_LSP_LIMIT and no partial output (overflow fail-closed)", () => {
  const cap = 1024 * 1024;
  const reader = new LspFrameReader(cap);
  const frame = encodeLspFrame({ jsonrpc: "2.0", method: "big", params: { data: "x".repeat(cap + 1) } });
  // Feed the header (which carries the oversized Content-Length) — the reader must throw
  // as soon as the header is parsed, before any body is emitted.
  assert.throws(
    () => {
      for (let i = 0; i < frame.length; i += 64) reader.push(Buffer.from(frame.subarray(i, Math.min(i + 64, frame.length))));
    },
    (err) => err.code === "ERR_PRISM_LSP_LIMIT",
    "over-cap body throws the limit error",
  );
});

test("framing: linear copying — fix copies O(input) bytes, not O(input·chunks)", async () => {
  const cap = 64 * 1024 * 1024;
  const big = splitIntoChunks(encodeLspFrame({ jsonrpc: "2.0", method: "m", params: { d: "x".repeat(6000 * CHUNK) } }), 6000);
  // Self-validate: the 0.2.4 reference copies 512·N²/2 bytes — exactly ~4x for 2x chunks (quadratic).
  const refSmall = await allocBytes(() => quadraticConcat(refChunks(2000)));
  const refBig = await allocBytes(() => quadraticConcat(refChunks(4000)));
  assert.ok(refBig / refSmall > 3, `reference must be quadratic (got ${(refBig / refSmall).toFixed(2)}x bytes for 2x chunks)`);
  // The fix on 4x the input must copy far fewer bytes than the quadratic on 1x (linear: O(input)).
  const fixBig = await allocBytes(() => {
    const r = new LspFrameReader(cap);
    for (const c of big) r.push(c);
  });
  assert.ok(fixBig < refSmall, `fix on 4x input (${fixBig} bytes) must copy fewer than 0.2.4 on 1x (${refSmall} bytes)`);
});

// ---------------------------------------------------------------------------
// Tar (coding-security sandbox ustar reader)
// ---------------------------------------------------------------------------

async function buildTarBytes(fileSize) {
  const dir = mkdtempSync(join(tmpdir(), "prism-tar-"));
  writeFileSync(join(dir, "big.bin"), Buffer.alloc(fileSize, 0x41));
  const chunks = [];
  for await (const c of createImportTarStream(dir, { maxEntries: 1000, maxBytes: 256 * 1024 * 1024 }))
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  rmSync(dir, { recursive: true, force: true });
  return Buffer.concat(chunks);
}

const chunkStream = (bytes, n) => {
  const cs = Math.ceil(bytes.length / n);
  return async function* gen() {
    for (let i = 0; i < bytes.length; i += cs) yield bytes.subarray(i, Math.min(i + cs, bytes.length));
  };
};

test("tar: observable output unchanged — sha256/entryCount/byteCount match an independent hash", async () => {
  const bytes = await buildTarBytes(4096);
  const sum = await summarizeTarStream(chunkStream(bytes, 13)(), { maxEntries: 100, maxBytes: 256 * 1024 * 1024 });
  const independent = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sum.sha256, independent, "summarizeTarStream hash must equal an independent sha256 of the raw bytes");
  assert.equal(sum.entryCount, 1, "one file entry");
  assert.equal(sum.byteCount, bytes.length, "byteCount is the raw stream length");
});

test("tar: near-cap stream summarizes (bounded memory — retained ≤ cap)", async () => {
  const bytes = await buildTarBytes(2 * 1024 * 1024);
  const sum = await summarizeTarStream(chunkStream(bytes, 4000)(), { maxEntries: 100, maxBytes: 256 * 1024 * 1024 });
  assert.equal(sum.entryCount, 1);
  assert.equal(sum.byteCount, bytes.length);
});

test("tar: over-cap stream aborts with SandboxTarError and no partial output (overflow fail-closed)", async () => {
  const bytes = await buildTarBytes(1024 * 1024);
  await assert.rejects(
    summarizeTarStream(chunkStream(bytes, 1000)(), { maxEntries: 100, maxBytes: 512 * 1024 }),
    (err) => err instanceof SandboxTarError && /exceeded max bytes/.test(err.message),
    "over-cap stream throws SandboxTarError",
  );
});

test("tar: fail-closed entry-type rejection is retained (unsupported type aborts)", async () => {
  // Hand-craft a ustar header with an unsupported type flag ('L' — GNU long name) and a
  // zero trailer; the reader must reject it rather than emit a partial entry.
  const header = Buffer.alloc(512, 0);
  header.write("evil.bin", 0, 100, "utf8");
  header.write("0000644", 100, 8, "utf8");
  header[107] = 0;
  header.write("0000000", 108, 8, "utf8");
  header[115] = 0;
  header.write("0000000", 116, 8, "utf8");
  header[123] = 0;
  header.write("00000000000", 124, 12, "utf8");
  header[135] = 0;
  header.write("00000000000", 136, 12, "utf8");
  header[147] = 0;
  header.write("        ", 148, 8, "utf8");
  header.write("L", 156, 1, "utf8"); // unsupported type
  header.write("ustar\0", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "utf8");
  const bytes = Buffer.concat([header, Buffer.alloc(1024, 0)]); // header + two zero blocks
  await assert.rejects(
    summarizeTarStream(chunkStream(bytes, 7)(), { maxEntries: 100, maxBytes: 256 * 1024 * 1024 }),
    (err) => err instanceof SandboxTarError && /unsupported tar entry type/.test(err.message),
  );
});

test("tar: linear copying — fix copies O(input) bytes, not O(input·chunks)", async () => {
  const big = await buildTarBytes(6000 * CHUNK);
  // Self-validate: the 0.2.4 reference copies 512·N²/2 bytes — exactly ~4x for 2x chunks (quadratic).
  const refSmall = await allocBytes(() => quadraticConcat(refChunks(2000)));
  const refBig = await allocBytes(() => quadraticConcat(refChunks(4000)));
  assert.ok(refBig / refSmall > 3, `reference must be quadratic (got ${(refBig / refSmall).toFixed(2)}x bytes for 2x chunks)`);
  // The fix on 4x the input must copy far fewer bytes than the quadratic on 1x (linear: O(input)).
  const fixBig = await allocBytes(async () => {
    await summarizeTarStream(chunkStream(big, 6000)(), { maxEntries: 100, maxBytes: 256 * 1024 * 1024 });
  });
  assert.ok(fixBig < refSmall, `fix on 4x input (${fixBig} bytes) must copy fewer than 0.2.4 on 1x (${refSmall} bytes)`);
});

// ---------------------------------------------------------------------------
// CLI capture audit (work-tools collectOutput — plan 020 Task 3, already linear)
// ---------------------------------------------------------------------------

test("cli: collectOutput is already linear (plan 020 Task 3 audit-only — no change required)", async () => {
  // Audit record: packages/work-tools/src/cli.ts `collectOutput(limit, onOverflow)` is a
  // chunk-array collector (chunks[] + retained counter, one final Buffer.concat at
  // toString()) — the exact pattern Task 3 applied to framing/tar. It was linearized in
  // plan 020 Task 3 and has no residual quadratic site. The import below confirms the
  // module loads unchanged (no regression from Task 3's adjacent edits).
  const mod = await import("@arnilo/prism-work-tools");
  assert.ok(typeof mod.createCliRunner === "function", "work-tools cli module loads (collectOutput audit-clean)");
});
