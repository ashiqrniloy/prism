import { describe, it } from "bun:test";
import assert from "node:assert/strict";

describe("@arnilo/prism-hosts/a2a import", () => {
  it("import_is_inert", async () => {
    const realSetTimeout = globalThis.setTimeout;
    const realSetInterval = globalThis.setInterval;
    let timers = 0;
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
      timers += 1;
      return realSetTimeout(...args);
    }) as typeof setTimeout;
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      timers += 1;
      return realSetInterval(...args);
    }) as typeof setInterval;
    // No network either: the module has no top-level calls, and fetch is only ever injected or called in handlers.
    try {
      const module = await import(`../index.ts?inert=${Date.now()}`);
      assert.equal(typeof module.serveA2A, "function");
    } finally {
      globalThis.setTimeout = realSetTimeout;
      globalThis.setInterval = realSetInterval;
    }
    assert.equal(timers, 0);
  });
});
