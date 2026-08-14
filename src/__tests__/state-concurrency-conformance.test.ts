// plan 022 Task 4: memory-leg run of the multi-process state-concurrency
// harness (checkpoints + events; router/idempotency/sessions legs run in the
// adapter packages where those stores live).

import { describe, it } from "node:test";
import { createMemoryAgentEventSource } from "../agent-event-source.js";
import { createMemoryCheckpointStore } from "../checkpoints.js";
import { assertStateConcurrencyConforms } from "../testing/state-concurrency-conformance.js";

describe("state concurrency conformance (memory)", () => {
  it("passes the approval, checkpoint CAS, and cursor probes against the memory stores", async () => {
    const probes = await assertStateConcurrencyConforms({
      checkpoints: () => createMemoryCheckpointStore(),
      events: { create: () => createMemoryAgentEventSource() },
    });
    for (const probe of ["approval-determinism", "checkpoint-cas", "cursor-resume"]) {
      if (!probes.includes(probe)) throw new Error(`memory run did not execute probe ${probe}`);
    }
  });
});
