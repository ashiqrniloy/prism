// Plan 060 leak tests: N=200 browser open/closeRun cycles must not grow the
// run registry. Fake Playwright host; deterministic, no sleeps. Skips on tiny heaps.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getHeapStatistics } from "node:v8";
import { FakeBrowser } from "../browser/__tests__/fake-playwright.js";
import { createBrowserManager } from "../browser/manager.js";

const N = 200;
const LOW_MEM = getHeapStatistics().heap_size_limit < 512 * 1024 * 1024;

describe("leak: browser runs return to baseline", { skip: LOW_MEM }, () => {
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
