import { describe, it } from "bun:test";
import { assertStateConcurrencyConforms } from "@arnilo/prism/testing/state-concurrency-conformance";
import { createSqlitePersistence } from "../persistence.js";

describe("state concurrency conformance (sqlite)", () => {
  it("passes the conversation metadata CAS probe against sqlite :memory:", async () => {
    // The checkpoint and lease probes live in @arnilo/prism-extensions/workflows/testing (plan 168 Tasks 3-5).
    const probes = await assertStateConcurrencyConforms({
      sessions: () => createSqlitePersistence({ filename: ":memory:" }),
    });
    for (const probe of ["conversation-metadata-cas"]) {
      if (!probes.includes(probe)) throw new Error(`sqlite run did not execute probe ${probe}`);
    }
  });
});
