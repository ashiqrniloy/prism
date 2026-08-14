// plan 022 Task 4: sqlite leg of the state-concurrency harness. The `:memory:`
// store is the harness's memory leg for conversation metadata (no core memory
// appendSession exists); checkpoints run on the same instance.

import { describe, it } from "node:test";
import { assertStateConcurrencyConforms } from "@arnilo/prism/testing/state-concurrency-conformance";
import { createSqlitePersistence } from "../persistence.js";

describe("state concurrency conformance (sqlite)", () => {
  it("passes the conversation metadata CAS and checkpoint probes against sqlite :memory:", async () => {
    const probes = await assertStateConcurrencyConforms({
      sessions: () => createSqlitePersistence({ filename: ":memory:" }),
      checkpoints: () => createSqlitePersistence({ filename: ":memory:" }).checkpoints,
    });
    for (const probe of ["conversation-metadata-cas", "approval-determinism", "checkpoint-cas"]) {
      if (!probes.includes(probe)) throw new Error(`sqlite run did not execute probe ${probe}`);
    }
  });
});
