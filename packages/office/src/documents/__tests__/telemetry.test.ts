import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type DocModel,
  DocumentsFormatError,
  type DocumentsTelemetry,
  type DocumentsTelemetryAttributeValue,
  type DocumentsTelemetrySpan,
  generateDocument,
  parseDocument,
  patchDocument,
  renderPreviewBlocks,
  renderPreviewHtml,
} from "../index.js";

interface RecordedSpan {
  name: string;
  attributes: Record<string, DocumentsTelemetryAttributeValue>;
  events: Array<{ name: string; attributes?: Record<string, DocumentsTelemetryAttributeValue> }>;
  failed: boolean;
  ended: boolean;
}

class TestDocumentsTelemetry implements DocumentsTelemetry {
  readonly spans: RecordedSpan[] = [];

  startSpan(name: string, initialAttributes?: Readonly<Record<string, DocumentsTelemetryAttributeValue>>): DocumentsTelemetrySpan {
    const record: RecordedSpan = {
      name,
      attributes: { ...(initialAttributes ?? {}) },
      events: [],
      failed: false,
      ended: false,
    };
    this.spans.push(record);

    return {
      setAttribute(key, value) {
        record.attributes[key] = value;
      },
      addEvent(eventName, eventAttrs) {
        record.events.push({ name: eventName, attributes: eventAttrs ? { ...eventAttrs } : undefined });
      },
      recordError() {
        record.failed = true;
      },
      end() {
        record.ended = true;
      },
    };
  }
}

describe("DocumentsTelemetry seam", () => {
  const markerString = "TOP_SECRET_PROPRIETARY_PAYLOAD_xyz987";
  const docFixture: DocModel = {
    kind: "doc",
    modelVersion: 1,
    title: `Document ${markerString}`,
    blocks: [
      { type: "heading", level: 1, text: `Heading ${markerString}` },
      { type: "paragraph", text: `Paragraph body ${markerString}` },
    ],
  };

  it("operates cleanly with undefined telemetry without overhead or errors", async () => {
    const { bytes } = await generateDocument(docFixture, { format: "docx" });
    assert.ok(bytes.length > 0);

    const parsed = await parseDocument(bytes, { kind: "doc" });
    assert.equal(parsed.kind, "doc");

    const patched = patchDocument(docFixture, [{ op: "set", target: { title: true }, value: "New Title" }]);
    assert.equal(patched.title, "New Title");

    const blocks = renderPreviewBlocks(docFixture);
    assert.ok(blocks.length > 0);

    const html = renderPreviewHtml(docFixture);
    assert.ok(html.length > 0);
  });

  it("records spans across generate, parse, patch, and preview without leaking model text", async () => {
    const telemetry = new TestDocumentsTelemetry();

    // 1. Generate
    const { bytes } = await generateDocument(docFixture, { format: "docx", telemetry });
    assert.equal(telemetry.spans.length, 1);
    const genSpan = telemetry.spans[0];
    assert.equal(genSpan.name, "documents.generate");
    assert.equal(genSpan.attributes["documents.kind"], "doc");
    assert.equal(genSpan.attributes["documents.format"], "docx");
    assert.equal(typeof genSpan.attributes["documents.bytes"], "number");
    assert.equal(genSpan.ended, true);
    assert.equal(genSpan.failed, false);

    // 2. Parse
    await parseDocument(bytes, { kind: "doc", telemetry });
    assert.equal(telemetry.spans.length, 2);
    const parseSpan = telemetry.spans[1];
    assert.equal(parseSpan.name, "documents.parse");
    assert.equal(parseSpan.attributes["documents.kind"], "doc");
    assert.equal(parseSpan.attributes["documents.bytes"], bytes.byteLength);
    assert.equal(parseSpan.attributes["documents.blocks"], 2);
    assert.equal(parseSpan.ended, true);

    // 3. Patch
    patchDocument(docFixture, [{ op: "set", target: { title: true }, value: "Updated" }], { telemetry });
    assert.equal(telemetry.spans.length, 3);
    const patchSpan = telemetry.spans[2];
    assert.equal(patchSpan.name, "documents.patch");
    assert.equal(patchSpan.attributes["documents.kind"], "doc");
    assert.equal(patchSpan.attributes["documents.patches_count"], 1);
    assert.equal(patchSpan.ended, true);

    // 4. Preview Blocks & HTML
    renderPreviewBlocks(docFixture, { telemetry });
    renderPreviewHtml(docFixture, { telemetry });
    assert.equal(telemetry.spans.length, 5);
    assert.equal(telemetry.spans[3].name, "documents.preview");
    assert.equal(telemetry.spans[3].attributes["documents.preview_type"], "blocks");
    assert.equal(telemetry.spans[4].name, "documents.preview");
    assert.equal(telemetry.spans[4].attributes["documents.preview_type"], "html");

    // 5. SECURITY INVARIANT: Assert marker string is never present in any attribute key or value
    for (const span of telemetry.spans) {
      for (const [key, val] of Object.entries(span.attributes)) {
        assert.equal(key.includes(markerString), false, `attribute key ${key} contains marker`);
        assert.equal(String(val).includes(markerString), false, `attribute value ${val} contains marker`);
      }
    }
  });

  it("calls recordError on span failure", async () => {
    const telemetry = new TestDocumentsTelemetry();

    await assert.rejects(async () => generateDocument(docFixture, { format: "xlsx", telemetry }), DocumentsFormatError);

    assert.equal(telemetry.spans.length, 1);
    const span = telemetry.spans[0];
    assert.equal(span.name, "documents.generate");
    assert.equal(span.failed, true);
    assert.equal(span.ended, true);
  });
});
