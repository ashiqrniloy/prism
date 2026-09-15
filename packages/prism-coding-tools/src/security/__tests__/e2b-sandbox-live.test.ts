import assert from "node:assert/strict";
import { describe, it } from "node:test";

const apiKey = process.env.PRISM_TEST_E2B_API_KEY;

describe("e2b sandbox live", { skip: apiKey ? false : "set PRISM_TEST_E2B_API_KEY to probe a real E2B sandbox" }, () => {
  it("creates, execs, pauses filesystem-only, and deletes", async () => {
    const { connectE2BSandbox, createE2BSandbox } = await import("../e2b-sandbox.js");
    const sandbox = await createE2BSandbox({
      apiKey,
      timeoutMs: 120_000,
      labels: { "prism.test": "e2b-live" },
      limits: { maxCommands: 16, maxOutputBytes: 64 * 1024 },
    });
    try {
      const echo = await sandbox.execFile({ file: "/bin/echo", args: ["prism-e2b"], cwd: "/workspace" });
      assert.equal(echo.exitCode, 0);
      const paused = await sandbox.pause!({ keepMemory: false });
      assert.equal(paused.kind, "filesystem");
      const reconnected = await connectE2BSandbox({
        apiKey,
        sandboxId: sandbox.id,
        expectedLabels: { "prism.test": "e2b-live" },
      });
      assert.equal((await reconnected.status()).state, "stopped");
      await reconnected.resume!();
      const after = await reconnected.execFile({ file: "/bin/echo", args: ["resumed"], cwd: "/workspace" });
      assert.equal(after.exitCode, 0);
      await reconnected.kill();
      assert.equal((await reconnected.status()).state, "removed");
    } finally {
      await sandbox.kill().catch(() => undefined);
    }
  });
});
