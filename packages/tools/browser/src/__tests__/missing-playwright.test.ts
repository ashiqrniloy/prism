import { describe, it, mock } from "bun:test";
import assert from "node:assert/strict";
import { createAgent } from "@arnilo/prism";
import toolsBrowser from "../index.js";

// The peer is optional and absent at runtime when a host never installed it. A throwing factory
// would surface as an unhandled error while bun builds the mock record for other test files, so
// the stub keeps the module shape and fails at the first use instead — the same `setup` branch.
mock.module("playwright-core", () => ({
  chromium: {
    launch: async (): Promise<never> => {
      throw new Error("playwright-core is not installed");
    },
  },
}));

describe("@arnilo/prism-tools-browser without playwright-core", () => {
  it("tools_browser_missing_playwright_notes", async () => {
    const agent = await createAgent({ model: { provider: "mock", model: "m" }, packages: [toolsBrowser({ headless: true })] });
    try {
      assert.equal(agent.tools.length, 0, "a missing playwright-core registers no tools");
      const warns = agent.inspect().statusNotes.filter((note) => note.level === "warn");
      assert.ok(
        warns.some((note) => /playwright-core is not installed/.test(note.message)),
        JSON.stringify(warns),
      );
    } finally {
      await agent.dispose();
    }
  });
});
