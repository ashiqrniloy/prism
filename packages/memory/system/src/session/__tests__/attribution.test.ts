/**
 * Plan 218 Task 4.1: speaker attribution. What the user stated is never folded into what the assistant proposed: STM
 * events carry an `attribution` derived from their cited entries' stored roles (never from the model), the worker reads
 * each message's role, and the memory block marks assistant proposals (plan 217 gate M-1, LongMemEval `9aaed6a3`).
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type ModelClient,
  type ModelProvider,
  type ProviderRequest,
  providerDone,
  providerToolCall,
  type SessionEntry,
  toolCallContent,
} from "@arnilo/prism";
import { foldObservationalMemoryLedger } from "../ledger.js";
import { renderObservationalMemory } from "../render.js";
import { serializeSessionEntry, serializeSourceEntries } from "../serialize.js";
import { type MemoryObservation, OBSERVATIONS_RECORDED } from "../types.js";
import { DEFAULT_STM_INSTRUCTION, runStm } from "../workers/stm.js";
import { runWm } from "../workers/wm.js";
import { clientFor } from "./helpers.js";

const at = "2026-11-12T12:45:00.000Z";
const message = (id: string, role: "user" | "assistant" | "tool" | "system", text: string): SessionEntry =>
  ({ id, sessionId: "s", kind: "message", timestamp: at, message: { role, content: [{ type: "text", text }] } }) as SessionEntry;
const user = message("u1", "user", "I spent $75 on groceries at SaveMart last week.");
const assistant = message("a1", "assistant", "A weekly SaveMart plan: total $55.39, $0.55 cashback.");
const tool = message("t1", "tool", "price lookup: milk $3.49");
const custom = { id: "x1", sessionId: "s", kind: "custom", timestamp: at, data: { note: "n" } } as unknown as SessionEntry;

function scripted(calls: readonly Record<string, unknown>[]): ModelProvider {
  return {
    id: "mock",
    async *generate(request: ProviderRequest) {
      if (!request.messages.some((entry) => entry.role === "tool"))
        for (const [index, args] of calls.entries()) yield providerToolCall(toolCallContent(`c${index}`, "record_event", args as never));
      yield providerDone();
    },
  };
}

const observation = (id: string, kind: MemoryObservation["kind"], extra: Partial<MemoryObservation> = {}): MemoryObservation => ({
  id,
  kind,
  description: `${kind} ${id}`,
  timestamp: at,
  observedAt: at,
  relevance: "medium",
  sourceEntryIds: ["e1"],
  tokenCount: 4,
  ...extra,
});

describe("speaker attribution (plan 218 Task 4.1)", () => {
  it("stm_event_attribution_derives_from_cited_entry_roles", async () => {
    const cases: [readonly string[], string | undefined][] = [
      [["u1"], "user"],
      [["a1"], "assistant"],
      [["t1"], "tool"],
      [["u1", "a1"], "mixed"],
      // Tool output beside one side counts as that side; a non-message entry adds no side.
      [["a1", "t1"], "assistant"],
      [["x1"], undefined],
    ];
    const events = await runStm({
      entries: [user, assistant, tool, custom],
      client: clientFor(
        scripted(
          cases.map(([ids], index) => ({
            kind: "statement",
            description: `event ${index}`,
            sourceEntryIds: ids,
            // A model-supplied attribution is never read: the roles of the cited entries decide.
            attribution: "user",
          })),
        ),
      ),
      maxTurns: 1,
    });
    assert.deepEqual(
      events.map((event) => event.attribution),
      cases.map(([, expected]) => expected),
    );
    // A recorded event with the field round-trips through the ledger validator.
    const ledger = foldObservationalMemoryLedger([{ type: OBSERVATIONS_RECORDED, observations: events }]);
    assert.equal(ledger.observations.length, events.length);
  });

  it("render_marks_assistant_proposals_and_mixed_events", () => {
    const text = renderObservationalMemory(
      [],
      [
        observation("aaaaaaaaaaaa", "statement", { attribution: "assistant", description: "SaveMart weekly plan totaled $55.39" }),
        observation("bbbbbbbbbbbb", "decision", { attribution: "assistant" }),
        observation("cccccccccccc", "request", { attribution: "assistant" }),
        observation("dddddddddddd", "statement", { attribution: "user", description: "Spent $75 on SaveMart groceries" }),
        observation("eeeeeeeeeeee", "request", { attribution: "mixed" }),
        observation("ffffffffffff", "action", { attribution: "assistant" }),
        observation("111111111111", "statement"),
      ],
      { advertiseRecall: false },
    );
    assert.match(text, /\[aaaaaaaaaaaa\] 12:45 \(medium\) assistant proposal: SaveMart weekly plan totaled \$55\.39/);
    assert.match(text, /\[bbbbbbbbbbbb\] 12:45 \(medium\) assistant proposal: /);
    assert.match(text, /\[cccccccccccc\] 12:45 \(medium\) assistant proposal: /);
    assert.match(text, /\[dddddddddddd\] 12:45 \(medium\) statement: Spent \$75 on SaveMart groceries/);
    assert.match(text, /\[eeeeeeeeeeee\] 12:45 \(medium\) request \(user \+ assistant\): /);
    // An assistant action is not a proposal; a record written before Task 4.1 renders as before.
    assert.match(text, /\[ffffffffffff\] 12:45 \(medium\) action: /);
    assert.match(text, /\[111111111111\] 12:45 \(medium\) statement: /);
  });

  it("serialized_message_lines_lead_with_the_role", () => {
    assert.match(serializeSessionEntry(user), /^\[2026-11-12T12:45:00\.000Z\] \[u1\] user: \{"role":"user"/);
    assert.match(serializeSessionEntry(assistant), /^\[[^\]]+\] \[a1\] assistant: /);
    assert.match(serializeSessionEntry(tool), /^\[[^\]]+\] \[t1\] tool: /);
    assert.match(serializeSessionEntry(custom), /^\[[^\]]+\] \[x1\] custom: \{"note":"n"\}$/);
    assert.doesNotMatch(serializeSourceEntries([user, assistant, tool]), /\] message: /);
  });

  it("stm_instruction_keeps_user_facts_apart_from_assistant_plans", () => {
    assert.match(DEFAULT_STM_INSTRUCTION, /the user states is its own event citing the user's entry/);
    assert.match(DEFAULT_STM_INSTRUCTION, /never folded into one about what the assistant suggested or calculated/);
    assert.match(DEFAULT_STM_INSTRUCTION, /an assistant's plan or estimate is a proposal, not something that happened/);
    assert.ok(DEFAULT_STM_INSTRUCTION.length <= 2_100, `${DEFAULT_STM_INSTRUCTION.length} characters`);
  });

  it("wm_item_keeps_assistant_attribution", async () => {
    const proposal = observation("aaaaaaaaaaaa", "statement", { attribution: "assistant" });
    const decision = observation("bbbbbbbbbbbb", "decision", { attribution: "assistant" });
    const fact = observation("cccccccccccc", "statement", { attribution: "user" });
    const action = observation("dddddddddddd", "action", { attribution: "assistant" });
    const legacy = observation("eeeeeeeeeeee", "statement");
    const records = [proposal, decision, fact, action, legacy];
    const calls: [string, Record<string, unknown>][] = [
      ["keep", { stmId: proposal.id, reason: "plan" }],
      ["summarize", { stmIds: [decision.id, fact.id], text: "User spent $75; assistant decided on a cheaper plan", relevance: "high" }],
      ["keep", { stmId: action.id, reason: "x" }],
      ["keep", { stmId: legacy.id, reason: "x" }],
    ];
    const client: ModelClient = {
      model: { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } },
      async *generate(request) {
        if (!request.messages.some((entry) => entry.role === "tool"))
          for (const [index, [name, args]] of calls.entries()) yield providerToolCall(toolCallContent(`c${index}`, name, args as never));
        yield providerDone();
      },
    };
    const { items } = await runWm({
      records,
      ledger: foldObservationalMemoryLedger([{ type: OBSERVATIONS_RECORDED, observations: records }]),
      client,
      maxTurns: 1,
    });
    const byCited = new Map(items.map((wmItem) => [wmItem.citedIds[0], wmItem]));
    assert.equal(byCited.get(proposal.id)?.attribution, "assistant");
    assert.equal(byCited.get(decision.id)?.attribution, "mixed");
    assert.equal(byCited.get(action.id)?.attribution, undefined, "an assistant action is not a proposal");
    assert.equal(byCited.get(legacy.id)?.attribution, undefined, "a source without attribution leaves the item without one");
    const text = renderObservationalMemory(items, [], { advertiseRecall: false });
    assert.match(text, new RegExp(`\\[${byCited.get(proposal.id)!.id}\\] .*event \\(assistant proposal\\): `));
    assert.match(text, new RegExp(`\\[${byCited.get(decision.id)!.id}\\] .*summary \\(user \\+ assistant\\): `));
  });
});
