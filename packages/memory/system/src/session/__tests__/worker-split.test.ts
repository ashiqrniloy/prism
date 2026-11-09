import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { ModelProvider, SessionEntry } from "@arnilo/prism";
import { providerDone } from "@arnilo/prism";
import { type MemoryObservation } from "../../index.js";
import { DEFAULT_STM_INSTRUCTION, runStm } from "../workers/stm.js";
import { clientFor, memoryModel } from "./helpers.js";

const source: SessionEntry = {
  id: "m1",
  sessionId: "s1",
  timestamp: "2026-06-20T00:00:00.000Z",
  kind: "message",
  message: { role: "user", content: [{ type: "text", text: "Route workers separately." }] },
};
const existingObservation = {
  id: "aaaaaaaaaaaa",
  kind: "statement",
  description: "Existing secret-value observation",
  timestamp: source.timestamp,
  relevance: "high",
  sourceEntryIds: ["m1"],
  tokenCount: 50,
} satisfies MemoryObservation;

describe("observational memory worker prompts", () => {
  it("stm_default_prompt_is_domain_neutral_and_appends_custom_instruction", async () => {
    const requests: string[] = [];
    const memoryProvider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        const system = request.messages.find((message) => message.role === "system")?.content[0];
        requests.push(system?.type === "text" ? system.text : "");
        yield providerDone();
      },
    };
    await runStm({
      entries: [source],
      client: clientFor(memoryProvider, memoryModel),
      maxTurns: 1,
      instruction: "Prefer finance-domain wording.",
    });
    assert.equal(requests.length, 1);
    assert.match(requests[0]!, /call record_event once per meaningful event/i);
    assert.match(requests[0]!, /record an outcome/i);
    assert.match(requests[0]!, /identifiers, paths, commands, errors and numbers exact/i);
    assert.match(requests[0]!, /set supersedes to its id/i);
    assert.match(requests[0]!, /one self-contained line/i);
    assert.match(requests[0]!, /Prefer finance-domain wording/);
    assert.equal(DEFAULT_STM_INSTRUCTION.includes("coding"), false);
  });

  it("stm_prompt_lists_the_recent_record_index", async () => {
    const prompts: string[] = [];
    const observerProvider: ModelProvider = {
      id: "observer",
      async *generate(request) {
        const prompt = request.messages.find((message) => message.role === "user")?.content[0];
        prompts.push(prompt?.type === "text" ? prompt.text : "");
        yield providerDone();
      },
    };
    await runStm({
      entries: [source],
      recent: [existingObservation],
      client: clientFor(observerProvider, memoryModel),
      maxTurns: 1,
      secrets: ["secret-value"],
    });
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!, /Recent STM records \(id, kind, first 120 characters\)/);
    assert.match(prompts[0]!, /\[aaaaaaaaaaaa\]/);
    assert.doesNotMatch(prompts[0]!, /secret-value/);
  });

  it("observer_exposes_record_task_state", async () => {
    const tools: string[] = [];
    await runStm({
      entries: [source],
      client: clientFor({
        id: "mock",
        async *generate(request) {
          tools.push(...(request.tools?.map((tool) => tool.name) ?? []));
          yield providerDone();
        },
      }),
      maxTurns: 1,
    });
    assert.doesNotMatch(DEFAULT_STM_INSTRUCTION, /record_current_task/);
    assert.deepEqual(tools, ["record_event", "record_task_state"]);
    assert.match(DEFAULT_STM_INSTRUCTION, /assumptions without user confirmation under openQuestions/);
  });
});
