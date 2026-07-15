import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapMcpContentToBlocks, summarizeMcpContent } from "../content.js";

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

  it("summarizes MCP error content", () => {
    const message = summarizeMcpContent([{ type: "text", text: "tool failed" }]);
    assert.equal(message, "tool failed");
  });
});
