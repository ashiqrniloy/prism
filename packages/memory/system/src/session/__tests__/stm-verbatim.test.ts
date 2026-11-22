/**
 * Plan 218.5 Task 1: STM recording fixes 1–3 (owner 2026-11-22, after Session-Bench screen a1c6df8d): each short user message is kept word for
 * word, without the model, and is never superseded; the instruction keeps a user's statement or change of an earlier
 * value as its own event. Every STM D2 miss and every STM D4 miss on replay was a user statement the model left out or
 * folded into a task line.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type ModelProvider,
  type ProviderRequest,
  providerDone,
  providerToolCall,
  type SessionEntry,
  toolCallContent,
} from "@arnilo/prism";
import { resolveMemorySystemConfig } from "../../index.js";
import { renderObservationalMemory } from "../render.js";
import { isMemoryObservation, type MemoryObservation, OBSERVATIONS_DROPPED } from "../types.js";
import { DEFAULT_STM_INSTRUCTION, fallbackObservations, runStm, verbatimUserObservations } from "../workers/stm.js";
import { clientFor } from "./helpers.js";

const user = (id: string, text: string, minute = 0): SessionEntry =>
  ({
    id,
    sessionId: "s",
    kind: "message",
    timestamp: new Date(Date.UTC(2026, 10, 22, 9, minute)).toISOString(),
    message: { role: "user", content: [{ type: "text", text }] },
  }) as SessionEntry;
const assistant = (id: string, text: string): SessionEntry =>
  ({
    id,
    sessionId: "s",
    kind: "message",
    timestamp: "2026-11-22T09:30:00.000Z",
    message: { role: "assistant", content: [{ type: "text", text }] },
  }) as SessionEntry;

function scripted(requests: ProviderRequest[], calls: readonly { name: string; args: Record<string, unknown> }[]): ModelProvider {
  return {
    id: "mock",
    async *generate(request) {
      requests.push({ ...request, messages: [...request.messages] });
      if (!request.messages.some((message) => message.role === "tool"))
        for (const [index, call] of calls.entries()) yield providerToolCall(toolCallContent(`c${index}`, call.name, call.args as never));
      yield providerDone();
    },
  };
}
const promptOf = (request: ProviderRequest) =>
  request.messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");

const CHANGE = "Task 3. Run the project check catalog-rule-3.\nChange of plan: we ship on Tuesday, not Monday.";

describe("STM keeps user messages word for word (fix 1)", () => {
  it("stm_keeps_a_short_user_message_word_for_word", async () => {
    const requests: ProviderRequest[] = [];
    const recorded = await runStm({
      entries: [user("u3", CHANGE), assistant("a3", "Done.")],
      client: clientFor(scripted(requests, [])),
      maxTurns: 1,
    });
    const kept = recorded.filter((item) => item.verbatim);
    assert.equal(kept.length, 1, "one record per user message, none for the assistant");
    const [record] = kept as [MemoryObservation];
    assert.equal(record.kind, "request");
    assert.equal(
      record.description,
      "User said: Task 3. Run the project check catalog-rule-3. Change of plan: we ship on Tuesday, not Monday.",
    );
    assert.equal(record.relevance, "high");
    assert.equal(record.attribution, "user");
    assert.deepEqual(record.sourceEntryIds, ["u3"]);
    assert.equal(record.observedAt, "2026-11-22T09:00:00.000Z");
    assert.ok(isMemoryObservation(record));
    assert.match(promptOf(requests[0]!), /User messages kept word for word \(no request event needed\): entries u3\./);
  });

  it("stm_leaves_a_long_user_message_to_the_model_and_zero_turns_it_off", () => {
    assert.equal(verbatimUserObservations([user("u1", "x ".repeat(1_100))]).length, 0, "over 2,000 characters");
    assert.equal(verbatimUserObservations([user("u1", "x ".repeat(1_100))], [], 5_000).length, 1);
    assert.equal(verbatimUserObservations([user("u1", "short")], [], 0).length, 0);
  });

  it("stm_verbatim_record_redacts_secrets", () => {
    const [record] = verbatimUserObservations([user("u1", "The token is sk-SECRET-123, use it")], ["sk-SECRET-123"]);
    assert.ok(record);
    assert.equal(record.description.includes("sk-SECRET-123"), false);
  });

  it("stm_verbatim_record_masks_credential_shapes", () => {
    const [record] = verbatimUserObservations([
      user("u1", "Deploy with sk-observational-memory-demo-sentinel and ghp_abcdefghijklmnopqrstuv1234 today"),
    ]);
    assert.ok(record);
    assert.equal(record.description, "User said: Deploy with [credential] and [credential] today");
  });

  it("stm_never_supersedes_a_verbatim_record", async () => {
    const [old] = verbatimUserObservations([user("u1", "Planning note: we ship on Monday.")]);
    const requests: ProviderRequest[] = [];
    const records: unknown[] = [];
    const recorded = await runStm({
      entries: [user("u3", CHANGE, 5)],
      recent: [old!],
      client: clientFor(
        scripted(requests, [
          {
            name: "record_event",
            args: {
              kind: "statement",
              description: "Ship day changed Monday → Tuesday",
              sourceEntryIds: ["u3"],
              supersedes: old?.id,
              corrects: true,
            },
          },
        ]),
      ),
      maxTurns: 2,
      onRecord: (record) => records.push(record),
    });
    assert.equal(
      records.some((record) => (record as { type?: string }).type === OBSERVATIONS_DROPPED),
      false,
      "the user's words stay",
    );
    const statement = recorded.find((item) => item.kind === "statement");
    assert.ok(statement, "the event is still recorded");
    assert.equal(statement.corrects, true);
    const toolResult = JSON.stringify(requests[1]?.messages.at(-1) ?? "");
    assert.match(toolResult, /kept word for word is never superseded/);
  });

  it("stm_fallback_keeps_user_messages_word_for_word_once", () => {
    const records = fallbackObservations(
      [user("u1", "Team rule: label every ticket ember-93."), assistant("a1", "Noted.")],
      [],
      "worker_error",
    );
    const kept = records.filter((item) => item.verbatim);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.fallback, undefined, "the user's words were not guessed at");
    assert.equal(records.filter((item) => item.description.includes("ember-93")).length, 1, "no second, truncated copy");
    assert.ok(
      records.some((item) => item.fallback === "worker_error"),
      "the assistant line is still a fallback record",
    );
  });

  it("render_marks_a_verbatim_record", () => {
    const [record] = verbatimUserObservations([user("u1", "Planning note: we ship on Monday.")]);
    assert.match(renderObservationalMemory([], [record!]), /\(high\) request \(verbatim\): User said: Planning note: we ship on Monday\./);
  });

  it("stm_verbatim_user_chars_config_defaults_to_2000", () => {
    assert.equal(resolveMemorySystemConfig({}).stm.verbatimUserChars, 2_000);
    assert.equal(resolveMemorySystemConfig({ stm: { verbatimUserChars: 0 } }).stm.verbatimUserChars, 0);
  });
});

describe("STM keeps a user's statement or change as its own event (fix 2)", () => {
  it("stm_instruction_never_folds_a_user_statement_or_change", () => {
    assert.match(DEFAULT_STM_INSTRUCTION, /each change to an earlier one, is its own statement/);
    assert.match(DEFAULT_STM_INSTRUCTION, /never folded into an outcome, a request or what the assistant suggested/);
    assert.match(DEFAULT_STM_INSTRUCTION, /a change sets corrects and supersedes the earlier record/);
    assert.match(DEFAULT_STM_INSTRUCTION, /A user message kept word for word needs no request event/);
    assert.ok(DEFAULT_STM_INSTRUCTION.length <= 2_100);
  });
});

describe("a user correction ranks with what it replaces (fix 3)", () => {
  const old: MemoryObservation = {
    id: "aaaaaaaaaaaa",
    kind: "statement",
    description: "User stated: we ship on Monday",
    timestamp: "2026-11-22T09:00:00.000Z",
    observedAt: "2026-11-22T09:00:00.000Z",
    relevance: "critical",
    sourceEntryIds: ["u1"],
    attribution: "user",
    durable: "constraint",
    tokenCount: 8,
  };
  const correct = async (args: Record<string, unknown>, recent: readonly MemoryObservation[] = [old]) => {
    const records: unknown[] = [];
    const recorded = await runStm({
      verbatimUserChars: 0,
      entries: [user("u3", CHANGE, 5)],
      recent,
      client: clientFor(scripted([], [{ name: "record_event", args: { kind: "statement", sourceEntryIds: ["u3"], ...args } }])),
      maxTurns: 2,
      onRecord: (record) => records.push(record),
    });
    return { recorded, records };
  };

  it("stm_correction_inherits_the_replaced_records_relevance_and_mark", async () => {
    const { recorded, records } = await correct({
      description: "Ship day changed Monday → Tuesday",
      supersedes: old.id,
      corrects: true,
      relevance: "medium",
    });
    const [statement] = recorded;
    assert.equal(statement?.relevance, "critical", "not below the record it replaces");
    assert.equal(statement?.durable, "constraint");
    assert.deepEqual(records, [
      { type: OBSERVATIONS_DROPPED, observationIds: [old.id], reason: "superseded", supersededBy: statement?.id },
    ]);
  });

  it("stm_user_correction_is_at_least_high", async () => {
    const { recorded } = await correct({ description: "Actually the port is 8081", corrects: true, relevance: "low" }, []);
    assert.equal(recorded[0]?.relevance, "high");
  });

  it("stm_assistant_event_inherits_nothing", async () => {
    const records: unknown[] = [];
    const recorded = await runStm({
      verbatimUserChars: 0,
      entries: [assistant("a3", "I moved the ship day.")],
      recent: [old],
      client: clientFor(
        scripted(
          [],
          [
            {
              name: "record_event",
              args: {
                kind: "action",
                description: "Assistant moved the ship day",
                sourceEntryIds: ["a3"],
                supersedes: old.id,
                relevance: "low",
              },
            },
          ],
        ),
      ),
      maxTurns: 2,
      onRecord: (record) => records.push(record),
    });
    assert.equal(recorded[0]?.relevance, "low");
    assert.equal(recorded[0]?.durable, undefined);
  });
});
