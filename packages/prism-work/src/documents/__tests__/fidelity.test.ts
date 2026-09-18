import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crc32 } from "node:zlib";
import { type DocModel, generateDocument, importDocument, parseDocument, reportImportFidelity } from "../index.js";

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function zipStore(files: ReadonlyArray<{ name: string; data?: Uint8Array }>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const file of files) {
    const name = enc.encode(file.name);
    const data = file.data ?? new Uint8Array(0);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cd = concat(centrals);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, offset, true);
  return concat([...locals, cd, eocd]);
}

describe("import fidelity", () => {
  const doc: DocModel = {
    kind: "doc",
    modelVersion: 1,
    title: "Fidelity",
    blocks: [{ type: "paragraph", text: "Hello." }],
  };

  it("reports comments, macros, and media as dropped", () => {
    const bytes = zipStore([
      { name: "[Content_Types].xml" },
      { name: "word/document.xml" },
      { name: "word/comments.xml" },
      { name: "word/vbaProject.bin" },
      { name: "word/media/image1.png" },
    ]);
    const report = reportImportFidelity(bytes, "doc");
    assert.equal(report.kind, "doc");
    assert.deepEqual(
      report.issues.map((i) => i.code),
      ["comments", "macros", "media"],
    );
    assert.equal(report.issues[0]?.lost, "dropped");
    assert.equal(report.issues[0]?.part, "word/comments.xml");
  });

  it("Prism-generated DOCX has no dropped structures; parseDocument still returns the model", async () => {
    const { bytes } = await generateDocument(doc, { format: "docx" });
    const imported = await importDocument(bytes, { kind: "doc" });
    assert.equal(imported.model.kind, "doc");
    assert.equal(imported.fidelity.issues.filter((i) => i.lost === "dropped").length, 0);
    const parsed = await parseDocument(bytes, { kind: "doc" });
    assert.equal(parsed.kind, "doc");
  });
});
