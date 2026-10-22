import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { createScopeClock, readScopeClockState, SCOPE_CLOCK_COUNTER } from "../clock.js";

describe("Scope clock (plan 188.4 Task 2)", () => {
  it("ticks_each_scope_once_per_session_and_reads_back_the_ordinal", async () => {
    const store = createMemoryVectorStore();
    const clock = createScopeClock(store.scopeCounter, "t");

    const first = await clock.tick([], ["projects/a", "projects/b"]);
    assert.deepEqual([...first.counted].sort(), ["projects/a", "projects/b"]);
    assert.deepEqual(first.clocks, { "projects/a": 1, "projects/b": 1 });

    // The second turn of the same session writes nothing and returns no new ordinals.
    const again = await clock.tick(first.counted, ["projects/a", "projects/b"]);
    assert.deepEqual(again.clocks, {});
    assert.equal(await clock.read("projects/a"), 1);

    // A new session (empty `counted`) advances both scopes.
    const next = await clock.tick([], ["projects/a"]);
    assert.deepEqual(next.clocks, { "projects/a": 2 });
    assert.equal(SCOPE_CLOCK_COUNTER, "sessions");
  });

  it("session_state_round_trips_only_string_resource_ids", () => {
    assert.deepEqual(readScopeClockState(undefined), { counted: [] });
    assert.deepEqual(readScopeClockState({ counted: ["projects/a", 7] }), { counted: ["projects/a"] });
    assert.deepEqual(readScopeClockState("junk"), { counted: [] });
  });
});
