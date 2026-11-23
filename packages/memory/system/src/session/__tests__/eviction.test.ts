/**
 * Plan 218.5 Task 3: the STM eviction order behind `context.eviction`. `"relevance"` is the order the package shipped
 * with (lowest relevance first, then smallest); `"protect-user"` is the candidate the long-session bench measures.
 */
import { it } from "bun:test";
import assert from "node:assert/strict";
import { type CompactionContext, validateJsonSchema } from "@arnilo/prism";
import { memorySessionConfigSchema, resolveMemorySystemConfig } from "../config.js";
import type { ObservationalMemoryLedger } from "../ledger.js";
import { boundMemoryPayload, HARD_MAX_FOLDED_PAYLOAD_BYTES } from "../memory-bounds.js";
import { createObservationalMemoryCompactor } from "../strategy.js";
import type { MemoryObservation } from "../types.js";

const at = (minute: number) => `2026-11-12T10:${String(minute).padStart(2, "0")}:00.000Z`;
let next = 0;
const record = (description: string, minute: number, tokenCount: number, extra: Partial<MemoryObservation> = {}): MemoryObservation => ({
  id: (++next).toString(16).padStart(12, "0"),
  kind: "result",
  description,
  timestamp: at(minute),
  relevance: "medium",
  sourceEntryIds: [`e${next}`],
  attribution: "tool",
  tokenCount,
  ...extra,
});

// A short user rule said early, a user message kept word for word, a durable preference, and the agent's own work.
const rule = record("Label every ticket cobalt47", 0, 5, { kind: "statement", attribution: "user" });
const said = record("User said: ship on Tuesday", 1, 8, { kind: "request", attribution: "user", verbatim: true, relevance: "high" });
const preference = record("Prefers short commit messages", 2, 6, { kind: "decision", durable: "preference", attribution: "mixed" });
const oldResult = record("Read the long design document", 3, 40);
const decision = record("Decided to keep the loader in src/config.ts", 4, 12, {
  kind: "decision",
  attribution: "assistant",
  relevance: "high",
});
const newResult = record("ls: 3 files", 5, 6);
const newAction = record("Ran the suite", 6, 20, { kind: "action", attribution: "assistant" });
const all = [rule, said, preference, oldResult, decision, newResult, newAction];
const total = all.reduce((sum, item) => sum + item.tokenCount, 0);

const keptAt = (maxTokens: number, eviction?: "relevance" | "protect-user") =>
  boundMemoryPayload(all, [], [], maxTokens, HARD_MAX_FOLDED_PAYLOAD_BYTES, eviction).observations.map((item) => item.description);
const names = (...items: MemoryObservation[]) => items.map((item) => item.description);

it("protect_user_eviction_keeps_user_statements_while_assistant_records_remain", () => {
  assert.equal(total, 97);
  // Today's order: the short user rule is the first record left out, before any tool result.
  assert.deepEqual(keptAt(total - 1), names(said, preference, oldResult, decision, newResult, newAction));
  assert.deepEqual(keptAt(total - 1, "relevance"), keptAt(total - 1));

  // The candidate leaves out the oldest of the agent's records first, lowest relevance before higher, and no durable
  // record or user statement while one of the agent's remains.
  const protect = (maxTokens: number) => keptAt(maxTokens, "protect-user");
  assert.deepEqual(protect(total - 1), names(rule, said, preference, decision, newResult, newAction));
  assert.deepEqual(protect(total - 41), names(rule, said, preference, decision, newAction));
  assert.deepEqual(protect(total - 47), names(rule, said, preference, decision));
  assert.deepEqual(protect(19), names(rule, said, preference), "every one of the agent's records is out before a user record");
  // Past that, the user's records go lowest relevance first, oldest first.
  assert.deepEqual(protect(18), names(said, preference));
  assert.deepEqual(protect(13), names(said));
  assert.deepEqual(protect(7), []);
  // Nothing is left out below the bound, and a bounded payload is marked a full fold under either order.
  const fits = boundMemoryPayload(all, [], [], total, HARD_MAX_FOLDED_PAYLOAD_BYTES, "protect-user");
  assert.deepEqual([fits.observations.length, fits.fullFold], [all.length, false]);
  assert.equal(boundMemoryPayload(all, [], [], total - 1, HARD_MAX_FOLDED_PAYLOAD_BYTES, "protect-user").fullFold, true);
});

it("context_eviction_config_defaults_to_relevance", () => {
  assert.equal(resolveMemorySystemConfig({}).context.eviction, "relevance");
  assert.equal(resolveMemorySystemConfig({ context: { eviction: "protect-user" } }).context.eviction, "protect-user");
  assert.equal(validateJsonSchema(memorySessionConfigSchema, { context: { eviction: "protect-user" } }).ok, true);
  assert.equal(validateJsonSchema(memorySessionConfigSchema, { context: { eviction: "smallest" } }).ok, false);
});

it("compaction_folds_the_pool_in_the_configured_eviction_order", async () => {
  const ledger: ObservationalMemoryLedger = { observations: all, wmItems: [], droppedObservationIds: [] };
  const summaryOf = async (eviction?: "relevance" | "protect-user") => {
    const compactor = createObservationalMemoryCompactor({
      observationsPoolMaxTokens: total - 1,
      ledgerOf: () => ledger,
      keepEntryIds: () => [],
      ...(eviction ? { eviction } : {}),
    });
    const result = await compactor.compact({ sessionId: "s", entries: [], trigger: "manual" } as unknown as CompactionContext);
    return result.summary ?? "";
  };
  const [byRelevance, protectUser] = [await summaryOf(), await summaryOf("protect-user")];
  assert.equal(byRelevance.includes(rule.description), false);
  assert.equal(byRelevance.includes(oldResult.description), true);
  assert.equal(protectUser.includes(rule.description), true);
  assert.equal(protectUser.includes(oldResult.description), false);
});
