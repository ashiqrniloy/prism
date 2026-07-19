import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapMcpContentToBlocks, summarizeMcpContent } from "../content.js";
import { measureBoundedJson } from "../json-bounds.js";

describe("mapMcpContentToBlocks", () => {
  it("maps text, image, resource, and resource_link blocks", () => {
    const mapped = mapMcpContentToBlocks(
      [
        { type: "text", text: "hello" },
        { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
        {
          type: "resource",
          resource: { uri: "file:///tmp/a.txt", text: "body", mimeType: "text/plain" },
        },
        {
          type: "resource_link",
          uri: "file:///tmp/b.txt",
          name: "b",
          description: "linked",
        },
      ],
      { maxResultBytes: 10_000 },
    );

    assert.equal(mapped.content.length, 4);
    assert.equal(mapped.content[0]?.type, "text");
    assert.equal(mapped.content[1]?.type, "image");
    assert.equal(mapped.truncated, false);
  });

  it("truncates when maxResultBytes is exceeded", () => {
    const mapped = mapMcpContentToBlocks(
      [{ type: "text", text: "x".repeat(100) }],
      { maxResultBytes: 10 },
    );
    assert.equal(mapped.truncated, true);
    assert.ok(mapped.bytesUsed <= 10);
  });

  it("summarizes MCP error content within its UTF-8 byte bound", () => {
    const message = summarizeMcpContent([{ type: "text", text: `tool failed ${"🙂".repeat(100)}` }], 32);
    assert.ok(Buffer.byteLength(message, "utf8") <= 32);
    assert.match(message, /^tool failed/);
  });
});

describe("measureBoundedJson", () => {
  it("measures escaped JSON without serializing a second copy", () => {
    const value = { text: "quote=\" newline=\n lone=\ud800", list: [true, null, 1] };
    const measured = measureBoundedJson(value, { maxBytes: 1_000, maxDepth: 8, maxProperties: 10 });
    assert.equal(measured.bytes, Buffer.byteLength(JSON.stringify(value), "utf8"));
    assert.equal(measured.properties, 5);
  });

  it("fails incrementally on byte, depth, property, cycle, and non-JSON bounds", () => {
    assert.throws(() => measureBoundedJson({ text: "long" }, { maxBytes: 8, maxDepth: 8, maxProperties: 8 }), /bytes/);
    assert.throws(() => measureBoundedJson({ a: { b: true } }, { maxBytes: 100, maxDepth: 2, maxProperties: 8 }), /depth/);
    assert.throws(() => measureBoundedJson({ a: 1, b: 2 }, { maxBytes: 100, maxDepth: 8, maxProperties: 1 }), /properties/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.throws(() => measureBoundedJson(cyclic, { maxBytes: 100, maxDepth: 8, maxProperties: 8 }), /cycle/);
    assert.throws(() => measureBoundedJson({ value: Infinity }, { maxBytes: 100, maxDepth: 8, maxProperties: 8 }), /non-finite/);
  });
});
