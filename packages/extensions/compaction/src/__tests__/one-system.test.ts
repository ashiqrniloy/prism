/**
 * Plan 218.3 Task 2: one compaction system per agent. LLM compaction and the memory system's session compaction each
 * provide `compaction.system`, so listing both fails at agent creation whichever loads first; context-engineering's
 * `fold` cannot run beside session compaction either. With session compaction off, LLM compaction and `fold` run beside
 * the memory system as before.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, createMemorySessionStore } from "@arnilo/prism";
import { contextEngineering } from "@arnilo/prism-extensions/context-engineering";
import memorySystem from "@arnilo/prism-memory-system";
import compaction from "../index.js";

const model = { provider: "mock", model: "main", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };
const failsWith = (pattern: RegExp) => (error: unknown) => error instanceof Error && pattern.test(error.message);

describe("one compaction system per agent", () => {
  it("other_compaction_is_refused_beside_session_memory", async () => {
    await assert.rejects(
      createAgent({ model, packages: [memorySystem({}), compaction({})] }),
      failsWith(/LLM compaction cannot run beside another compaction system \("session-memory"\)/),
    );
    await assert.rejects(
      createAgent({ model, packages: [compaction({}), memorySystem({})] }),
      failsWith(/memory_system_compaction_conflict: .*"llm-compaction"/),
    );
    await assert.rejects(
      createAgent({ model, packages: [memorySystem({}), contextEngineering({ fold: {} })] }),
      failsWith(/fold and attention cannot run beside session memory/),
    );
    await assert.rejects(
      createAgent({ model, packages: [contextEngineering({ attention: {} }), memorySystem({})] }),
      failsWith(/memory_system_compaction_conflict: .*fold and attention/),
    );
  });

  it("one_compaction_system_error_names_the_switch", async () => {
    // Plan 240 Task 5: whichever loads second, the refusal tells the host how to keep the other one.
    await assert.rejects(createAgent({ model, packages: [memorySystem({}), compaction({})] }), failsWith(/set its context\.compaction: false/));
    await assert.rejects(createAgent({ model, packages: [compaction({}), memorySystem({})] }), failsWith(/set context\.compaction: false/));
  });

  it("llm_compaction_beside_memory_with_session_compaction_off", async () => {
    const agent = await createAgent({
      model,
      packages: [memorySystem({ context: { compaction: false } }), compaction({}), contextEngineering({ fold: {} })],
      slots: { store: createMemorySessionStore() },
    });
    assert.equal((await agent.inspect()).slots.compaction, "@arnilo/prism-extensions/compaction");
    await agent.dispose();
  });

  it("context_engineering_without_fold_or_attention_runs_beside_session_memory", async () => {
    const agent = await createAgent({
      model,
      packages: [memorySystem({}), contextEngineering({ accounting: true })],
      slots: { store: createMemorySessionStore() },
    });
    assert.equal((await agent.inspect()).slots.compaction, "@arnilo/prism-memory-system");
    await agent.dispose();
  });
});
