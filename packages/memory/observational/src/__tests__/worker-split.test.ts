import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { ModelProvider, SessionEntry } from "@arnilo/prism";
import { providerDone } from "@arnilo/prism";
import { type MemoryObservation } from "../index.js";
import { DEFAULT_OBSERVER_INSTRUCTION, runObserver } from "../workers/observer.js";
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
  content: "Existing secret-value observation",
  timestamp: source.timestamp,
  relevance: "high",
  sourceEntryIds: ["m1"],
  tokenCount: 50,
} satisfies MemoryObservation;

describe("observational memory worker prompts", () => {
  it("observer_default_prompt_is_domain_neutral_and_appends_custom_instruction", async () => {
    const requests: string[] = [];
    const memoryProvider: ModelProvider = {
      id: "mock",
      async *generate(request) {
        const system = request.messages.find((message) => message.role === "system")?.content[0];
        requests.push(system?.type === "text" ? system.text : "");
        yield providerDone();
      },
    };
    await runObserver({
      entries: [source],
      client: clientFor(memoryProvider, memoryModel),
      maxTurns: 1,
      instruction: "Prefer finance-domain wording.",
    });
    assert.equal(requests.length, 1);
    assert.match(requests[0]!, /assertions as facts, not questions/i);
    assert.match(requests[0]!, /user assertions are authoritative/i);
    assert.match(requests[0]!, /superseding facts when source-backed state changes/i);
    assert.match(requests[0]!, /completed: only for real completion/i);
    assert.match(requests[0]!, /identifiers, paths, and errors/i);
    assert.match(requests[0]!, /Do not repeat existing observations/i);
    assert.match(requests[0]!, /single-line prose/i);
    assert.match(requests[0]!, /Prefer finance-domain wording/);
    assert.equal(DEFAULT_OBSERVER_INSTRUCTION.includes("coding"), false);
  });

  it("observer_prompt_lists_existing_active_observations", async () => {
    const prompts: string[] = [];
    const observerProvider: ModelProvider = {
      id: "observer",
      async *generate(request) {
        const prompt = request.messages.find((message) => message.role === "user")?.content[0];
        prompts.push(prompt?.type === "text" ? prompt.text : "");
        yield providerDone();
      },
    };
    await runObserver({
      entries: [source],
      observations: [existingObservation],
      client: clientFor(observerProvider, memoryModel),
      maxTurns: 1,
      secrets: ["secret-value"],
    });
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!, /Existing active observations:/);
    assert.match(prompts[0]!, /\[aaaaaaaaaaaa\]/);
    assert.doesNotMatch(prompts[0]!, /secret-value/);
  });

  it("observer_exposes_record_task_state", async () => {
    const tools: string[] = [];
    await runObserver({
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
    assert.doesNotMatch(DEFAULT_OBSERVER_INSTRUCTION, /record_current_task/);
    assert.deepEqual(tools, ["record_observation", "record_task_state"]);
    assert.match(DEFAULT_OBSERVER_INSTRUCTION, /assumptions without user confirmation under openQuestions/);
  });
});
