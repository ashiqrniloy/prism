import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPostgresAgentEventSource,
  createPostgresPersistence,
  type ClosablePostgresAgentEventSource,
  type PostgresAgentEventSourceOptions,
} from "../index.js";

describe("session-store-postgres root exports", () => {
  it("re-exports the durable AgentEventSource from the package root (FR-6)", () => {
    assert.equal(typeof createPostgresAgentEventSource, "function");
    assert.equal(typeof createPostgresPersistence, "function");
    // Type-level surface: the options and closable source types resolve from the root.
    const options: PostgresAgentEventSourceOptions = {
      pool: {} as never,
      schema: "prism",
    };
    const source: ClosablePostgresAgentEventSource = createPostgresAgentEventSource(options);
    assert.equal(typeof source.append, "function");
    assert.equal(typeof source.close, "function");
    assert.equal(typeof source.subscribe, "function");
  });
});
