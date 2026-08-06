import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventType } from "@ag-ui/core";
import type { AgentEvent, ThinkingContent } from "@arnilo/prism";
import { createAgUiEventMapper } from "../ag-ui-mapper.js";
import { createReasoningEncryptedValue } from "../encrypted-value.js";
import { DEFAULT_MAX_REASONING_BYTES } from "../limits.js";

const content: ThinkingContent = { type: "thinking", text: "secret reasoning" };
const event: AgentEvent = { type: "message_delta", sessionId: "s1", runId: "r1", content };

describe("createReasoningEncryptedValue", () => {
  it("returns the bounded encrypted value from the host encrypt function", async () => {
    const result = createReasoningEncryptedValue({
      encrypt: (c, e) => `enc:${c.text}:${e.runId}`,
      content,
      event,
    });
    assert.deepEqual(result, { encryptedValue: "enc:secret reasoning:r1" });
  });

  it("caps output at maxBytes (default DEFAULT_MAX_REASONING_BYTES) without splitting UTF-8", async () => {
    const big = "é".repeat(100_000);
    const result = createReasoningEncryptedValue({ encrypt: () => big, content, event });
    assert.ok(result);
    const value = result.encryptedValue ?? "";
    assert.ok(Buffer.byteLength(value) <= DEFAULT_MAX_REASONING_BYTES);
    assert.ok(Buffer.byteLength(value) > DEFAULT_MAX_REASONING_BYTES - 64);
    // No split multi-byte char: no replacement char, and every é survives intact.
    assert.ok(!value.includes("\uFFFD"));
    assert.equal((value.match(/é/g) ?? []).length, 32760);
    const small = createReasoningEncryptedValue({ encrypt: () => "abc", content, event, maxBytes: 2 });
    assert.deepEqual(small, { encryptedValue: "… [truncated]" });
  });

  it("fails closed on missing, throwing, or non-string encrypt", async () => {
    assert.equal(createReasoningEncryptedValue({ encrypt: undefined as never, content, event }), undefined);
    assert.equal(
      createReasoningEncryptedValue({ encrypt: () => { throw new Error("boom"); }, content, event }),
      undefined,
    );
    assert.equal(createReasoningEncryptedValue({ encrypt: () => 42 as never, content, event }), undefined);
    assert.equal(createReasoningEncryptedValue({ encrypt: () => "", content, event }), undefined);
  });

  it("never infers an encrypted value from the reasoning signature; passes encrypt output verbatim", async () => {
    const seen: Array<[ThinkingContent, AgentEvent]> = [];
    const result = createReasoningEncryptedValue({
      encrypt: (c, e) => { seen.push([c, e]); return "opaque-ciphertext"; },
      content,
      event,
    });
    assert.deepEqual(result, { encryptedValue: "opaque-ciphertext" });
    assert.equal(seen.length, 1);
    assert.equal(seen[0][0], content);
    assert.equal(seen[0][1], event);
  });
});

describe("mapper integration", () => {
  it("emits REASONING_ENCRYPTED_VALUE with the helper output", async () => {
    const mapper = createAgUiEventMapper({
      projection: {
        reasoning: (c, e) => createReasoningEncryptedValue({ encrypt: () => "host-encrypted", content: c, event: e }),
      },
    });
    const mapped = await mapper.map(event);
    const encrypted = mapped.find((m) => m.type === EventType.REASONING_ENCRYPTED_VALUE);
    assert.ok(encrypted);
    assert.equal((encrypted as { encryptedValue: string }).encryptedValue, "host-encrypted");
  });

  it("emits nothing when the helper declines", async () => {
    const mapper = createAgUiEventMapper({
      projection: { reasoning: () => createReasoningEncryptedValue({ encrypt: () => undefined, content, event }) },
    });
    assert.deepEqual(await mapper.map(event), []);
  });
});
