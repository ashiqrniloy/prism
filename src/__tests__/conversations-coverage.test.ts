// Plan 025 Task 5 — focused behavior regressions for the root conversation codec +
// projection (src/conversations.ts), which was 16% covered (the server service is
// tested separately; these pure helpers were not). Behavior-backed: each test asserts
// an observable outcome (a round-tripped cursor, a thrown cursor error reason, a
// projected thread shape, a serialized marker), not line count. Covers the D5
// conversations weak branches: cursor encode/decode validation, thread-from-record
// projection (marker presence, branch filtering, ownership + state + version),
// and marker serialization.

import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRecord } from "../contracts.js";
import {
  CONVERSATION_METADATA_KEY,
  ConversationError,
  type ConversationReplayCursor,
  conversationMarkerMetadata,
  conversationThreadFromRecord,
  DEFAULT_MAX_CONVERSATION_CURSOR_BYTES,
  decodeConversationReplayCursor,
  encodeConversationReplayCursor,
  HARD_MAX_CONVERSATION_CURSOR_BYTES,
} from "../conversations.js";

function record(metadata: SessionRecord["metadata"], overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "thread-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    metadata,
    ...overrides,
  } as SessionRecord;
}

// ── cursor codec ───────────────────────────────────────────────────────────────

test("encodeConversationReplayCursor round-trips a cursor with and without an opaque store cursor", () => {
  const withCursor: ConversationReplayCursor = { v: 1, threadId: "t1", cursor: "opaque-keyset" };
  assert.deepEqual(decodeConversationReplayCursor(encodeConversationReplayCursor(withCursor), "t1"), withCursor);
  const noCursor: ConversationReplayCursor = { v: 1, threadId: "t1" };
  assert.deepEqual(decodeConversationReplayCursor(encodeConversationReplayCursor(noCursor), "t1"), noCursor);
});

for (const [label, encoded, expectedReason] of [
  ["empty string", "", "invalid_cursor"],
  ["non-string", 7 as unknown as string, "invalid_cursor"],
  ["oversize", "x".repeat(HARD_MAX_CONVERSATION_CURSOR_BYTES + 1), "cursor_too_large"],
] as const) {
  test(`decodeConversationReplayCursor rejects ${label} (${expectedReason})`, () => {
    assert.throws(
      () => decodeConversationReplayCursor(encoded, "t1", HARD_MAX_CONVERSATION_CURSOR_BYTES),
      (err: ConversationError) => err.reason === expectedReason,
    );
  });
}

test("decodeConversationReplayCursor rejects a malformed base64/json payload", () => {
  assert.throws(
    () => decodeConversationReplayCursor("!!!not-base64-json!!!", "t1"),
    (err: ConversationError) => err.reason === "invalid_cursor",
  );
});

for (const [label, payload, expectedReason] of [
  ["non-object payload", JSON.stringify([1, 2]), "invalid_cursor"],
  ["wrong version", JSON.stringify({ v: 2, threadId: "t1" }), "invalid_cursor"],
  ["missing threadId", JSON.stringify({ v: 1 }), "invalid_cursor"],
  ["empty threadId", JSON.stringify({ v: 1, threadId: "" }), "invalid_cursor"],
  ["cursor not a string", JSON.stringify({ v: 1, threadId: "t1", cursor: 5 }), "invalid_cursor"],
  ["empty cursor", JSON.stringify({ v: 1, threadId: "t1", cursor: "" }), "invalid_cursor"],
] as const) {
  test(`decodeConversationReplayCursor rejects ${label} (${expectedReason})`, () => {
    const encoded = Buffer.from(payload, "utf8").toString("base64url");
    assert.throws(
      () => decodeConversationReplayCursor(encoded, "t1"),
      (err: ConversationError) => err.reason === expectedReason,
    );
  });
}

test("decodeConversationReplayCursor rejects a cursor minted for another thread", () => {
  const encoded = encodeConversationReplayCursor({ v: 1, threadId: "other" });
  assert.throws(
    () => decodeConversationReplayCursor(encoded, "t1"),
    (err: ConversationError) => err.reason === "cursor_thread_mismatch",
  );
});

test("decodeConversationReplayCursor honors a custom maxBytes under the hard cap", () => {
  // A cursor whose encoded form sits between the custom cap (DEFAULT/2) and the default cap.
  const encoded = encodeConversationReplayCursor({ v: 1, threadId: "t1", cursor: "x".repeat(2200) });
  assert.throws(
    () => decodeConversationReplayCursor(encoded, "t1", DEFAULT_MAX_CONVERSATION_CURSOR_BYTES / 2),
    (err: ConversationError) => err.reason === "cursor_too_large",
  );
  // The same cursor is accepted under the default cap.
  assert.ok(decodeConversationReplayCursor(encoded, "t1"));
});

// ── conversationThreadFromRecord projection ────────────────────────────────────

test("conversationThreadFromRecord returns undefined when the marker is absent", () => {
  assert.equal(conversationThreadFromRecord(record(undefined)), undefined);
  assert.equal(conversationThreadFromRecord(record({ other: 1 })), undefined);
});

test("conversationThreadFromRecord returns undefined when the marker is not a conversation object", () => {
  assert.equal(conversationThreadFromRecord(record({ [CONVERSATION_METADATA_KEY]: "not-an-object" })), undefined);
  assert.equal(conversationThreadFromRecord(record({ [CONVERSATION_METADATA_KEY]: [1, 2] })), undefined);
});

test("conversationThreadFromRecord projects an active thread with ownership, title, and version", () => {
  const thread = conversationThreadFromRecord(
    record(
      { [CONVERSATION_METADATA_KEY]: { state: "active", title: "My thread", metadata: { color: "blue" } } },
      { tenantId: "t1", accountId: "a1", userId: "u1", version: 7 },
    ),
  );
  assert.deepEqual(thread, {
    id: "thread-1",
    tenantId: "t1",
    accountId: "a1",
    userId: "u1",
    title: "My thread",
    state: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    branches: [],
    version: 7,
    metadata: { color: "blue" },
  });
});

test("conversationThreadFromRecord defaults to active state and version 0 for legacy rows", () => {
  const thread = conversationThreadFromRecord(record({ [CONVERSATION_METADATA_KEY]: { state: "unknown" } }));
  assert.equal(thread?.state, "active");
  assert.equal(thread?.version, 0);
  assert.equal(thread?.title, undefined);
  assert.equal("title" in (thread as object), false);
});

test("conversationThreadFromRecord projects an archived thread and omits title when empty", () => {
  const thread = conversationThreadFromRecord(record({ [CONVERSATION_METADATA_KEY]: { state: "archived", title: "" } }));
  assert.equal(thread?.state, "archived");
  assert.equal(thread?.title, undefined);
});

test("conversationThreadFromRecord filters invalid branch refs and freezes the array", () => {
  const thread = conversationThreadFromRecord(
    record({
      [CONVERSATION_METADATA_KEY]: {
        state: "active",
        branches: [
          { leafId: "leaf-1", createdAt: "2026-01-01T00:00:00.000Z" },
          { leafId: "leaf-2" }, // missing createdAt -> filtered
          "not-an-object", // filtered
          { leafId: 5, createdAt: "x" }, // non-string fields -> filtered
          { leafId: "leaf-3", createdAt: "2026-01-03T00:00:00.000Z" },
        ],
      },
    }),
  );
  assert.deepEqual(thread?.branches, [
    { leafId: "leaf-1", createdAt: "2026-01-01T00:00:00.000Z" },
    { leafId: "leaf-3", createdAt: "2026-01-03T00:00:00.000Z" },
  ]);
  assert.ok(Object.isFrozen(thread?.branches));
});

test("conversationThreadFromRecord ignores non-object metadata", () => {
  const thread = conversationThreadFromRecord(record({ [CONVERSATION_METADATA_KEY]: { state: "active", metadata: "not-an-object" } }));
  assert.equal(thread?.metadata, undefined);
  assert.equal("metadata" in (thread as object), false);
});

// ── conversationMarkerMetadata serialization ───────────────────────────────────

test("conversationMarkerMetadata serializes a full marker", () => {
  const marker = conversationMarkerMetadata({
    title: "t",
    state: "active",
    branches: [{ leafId: "l1", createdAt: "2026-01-01T00:00:00.000Z" }],
    requestId: "req-1",
    metadata: { k: "v" },
  });
  assert.deepEqual(marker, {
    [CONVERSATION_METADATA_KEY]: {
      title: "t",
      state: "active",
      branches: [{ leafId: "l1", createdAt: "2026-01-01T00:00:00.000Z" }],
      requestId: "req-1",
      metadata: { k: "v" },
    },
  });
});

test("conversationMarkerMetadata omits optional fields when absent or empty", () => {
  assert.deepEqual(conversationMarkerMetadata({ state: "archived" }), {
    [CONVERSATION_METADATA_KEY]: { state: "archived" },
  });
  assert.deepEqual(conversationMarkerMetadata({ state: "active", branches: [] }), {
    [CONVERSATION_METADATA_KEY]: { state: "active" },
  });
});
