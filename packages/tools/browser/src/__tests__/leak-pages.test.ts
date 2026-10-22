// Plan 060 leak tests: N=200 browser open/closeRun cycles must not grow the
// run registry. Fake Playwright host; deterministic, no sleeps. Skips on tiny heaps.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { getHeapStatistics } from "node:v8";
import { createBrowserManager } from "../manager.js";
import { FakeBrowser } from "./fake-playwright.js";

const N = 200;
const LOW_MEM = getHeapStatistics().heap_size_limit < 512 * 1024 * 1024;

describe.skipIf(Boolean(LOW_MEM))("leak: browser runs return to baseline", () => {
  it("200 open/closeRun cycles leave no registered runs", async () => {
    const manager = createBrowserManager({
      browser: new FakeBrowser(),
      limits: { closeGraceMs: 1 },
      networkPolicy: { requireContainedProxy: false },
    });
    for (let i = 0; i < N; i++) {
      const runId = `leak-${i}`;
      await manager.open(runId);
      assert.equal(manager.hasRun(runId), true, `cycle ${i}: open must register`);
      await manager.closeRun(runId);
      assert.equal(manager.hasRun(runId), false, `cycle ${i}: closeRun must deregister`);
    }
    await manager.close();
    assert.equal(manager.hasRun("leak-0"), false, "close must leave no runs");
  });
});
