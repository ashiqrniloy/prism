import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AntigravityConversationError,
  assertConversationContinuation,
  createAntigravityConversationStore,
  validateConversationId,
} from "../index.js";

test("validateConversationId: validates non-empty strings and rejects invalid inputs", () => {
  assert.equal(validateConversationId("conv-12345"), "conv-12345");
  assert.equal(validateConversationId("  conv-abc  "), "conv-abc");

  // Invalid types
  assert.throws(() => validateConversationId(""), AntigravityConversationError);
  assert.throws(() => validateConversationId("   "), AntigravityConversationError);
  assert.throws(() => validateConversationId(null), AntigravityConversationError);
  assert.throws(() => validateConversationId(undefined), AntigravityConversationError);
  assert.throws(() => validateConversationId(12345), AntigravityConversationError);

  // Control characters
  assert.throws(() => validateConversationId("conv\0id"), AntigravityConversationError);
  assert.throws(() => validateConversationId("conv\nid"), AntigravityConversationError);
  assert.throws(() => validateConversationId("conv\rid"), AntigravityConversationError);

  // Exceeding byte limit
  const longId = "a".repeat(513);
  assert.throws(() => validateConversationId(longId), AntigravityConversationError);
});

test("createAntigravityConversationStore: stores, retrieves, and isolates conversation IDs", () => {
  const store = createAntigravityConversationStore();

  // Initially undefined
  assert.equal(store.get("session-1"), undefined);
  assert.equal(store.has("session-1"), false);

  // Set and get main branch
  store.set("session-1", "conv-session-1");
  assert.equal(store.get("session-1"), "conv-session-1");
  assert.equal(store.has("session-1"), true);

  // Set and get named branch
  store.set("session-1", "conv-session-1-branch-a", "branch-a");
  assert.equal(store.get("session-1", "branch-a"), "conv-session-1-branch-a");
  assert.equal(store.get("session-1"), "conv-session-1");

  // Entries
  const entries = store.entries();
  assert.equal(entries.length, 2);

  // Clear branch
  store.clear("session-1", "branch-a");
  assert.equal(store.get("session-1", "branch-a"), undefined);
  assert.equal(store.get("session-1"), "conv-session-1");

  // Clear main session
  store.clear("session-1");
  assert.equal(store.get("session-1"), undefined);
});

test("createAntigravityConversationStore: prevents conversation ID hijacking across sessions", () => {
  const store = createAntigravityConversationStore();

  store.set("session-1", "shared-conversation-id");

  // Setting the exact same conversation ID for session-2 must fail closed
  assert.throws(() => store.set("session-2", "shared-conversation-id"), AntigravityConversationError);

  // Updating the conversation ID for the same session-1 is allowed
  store.set("session-1", "new-conversation-id");
  assert.equal(store.get("session-1"), "new-conversation-id");
});

test("assertConversationContinuation: verifies continuation binding", () => {
  const store = createAntigravityConversationStore();

  // No prior binding: accepts requested ID
  assert.equal(assertConversationContinuation(store, "session-1", "conv-1"), "conv-1");

  store.set("session-1", "conv-1");

  // Matching binding: accepts
  assert.equal(assertConversationContinuation(store, "session-1", "conv-1"), "conv-1");

  // Conflicting binding: throws
  assert.throws(() => assertConversationContinuation(store, "session-1", "conv-2"), AntigravityConversationError);
});
