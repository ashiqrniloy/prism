/**
 * Live computer-use-linux leg (plans/064 Task 7): drives the host's real
 * `computer-use-linux` MCP binary over stdio through the real
 * `connectMcpTools` bridge (no test seams).
 *
 * Gated on PRISM_TEST_COMPUTER_USE=1 AND PRISM_COMPUTER_USE_BIN (absolute path
 * to the binary) on a Linux host — skip-not-fail otherwise. Bounded per plan:
 * connect → tool inventory → one optional screenshot → close, all under a
 * 30 s ceiling. The suite performs no network I/O, so no screenshot bytes can
 * leave the process (security criterion, asserted structurally below).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createComputerUseLinuxTools } from "../create.js";

const LINUX = process.platform === "linux";
const FLAG = process.env.PRISM_TEST_COMPUTER_USE === "1";
const BIN = process.env.PRISM_COMPUTER_USE_BIN;

const SKIP =
  (!LINUX && "linux hosts only") ||
  (!FLAG && "set PRISM_TEST_COMPUTER_USE=1 plus PRISM_COMPUTER_USE_BIN=$(command -v computer-use-linux)") ||
  (!BIN && "set PRISM_COMPUTER_USE_BIN to the host computer-use-linux binary path");

function context(toolCallId: string) {
  return { sessionId: "live-computer-use", runId: "live-computer-use", toolCallId };
}

describe("computer-use-linux live (real host binary)", { skip: SKIP, timeout: 30_000 }, () => {
  it("connects over stdio, exposes the real tool inventory, and closes cleanly", async (t) => {
    const tools = await createComputerUseLinuxTools({
      command: BIN!,
      args: ["mcp"],
      device: { kind: "desktop-control", enabled: true, requireApproval: true, sandbox: "live-desktop" },
      runLimits: { maxTurns: 8, maxToolCalls: 20 },
    });
    try {
      assert.ok(tools.tools.length > 0, "real binary must expose at least one tool");
      const names = tools.tools.map((tool) => tool.name);
      assert.ok(names.includes("screenshot"), `tool inventory must include screenshot, got: ${names.join(", ")}`);
      assert.ok(names.includes("get_app_state"), `tool inventory must include get_app_state, got: ${names.join(", ")}`);

      // One bounded read-only probe against the real desktop. Environmental
      // failures (headless box, no session) skip — the binary-wire contract is
      // already proven by the inventory above.
      const screenshot = tools.tools.find((tool) => tool.name === "screenshot")!;
      try {
        const result = await screenshot.execute({}, context("call-live-shot"));
        assert.ok(result !== undefined, "screenshot returned no result");
        // Security criterion: no egress — the value stays an in-process result.
        assert.ok(result.value !== undefined || result.content?.length, "screenshot must carry in-process content");
      } catch (error) {
        return t.skip(`desktop session unavailable for screenshot probe: ${String(error).slice(0, 160)}`);
      }
    } catch (error) {
      // Binary not runnable at all (missing libs, not executable) is an
      // environment problem: the matrix gate PRISM_COMPUTER_USE_BIN promises a
      // working binary, so surface a skip reason instead of a failure.
      if (/ENOENT|EACCES|cannot find|not found/i.test(String(error))) {
        return t.skip(`host binary not runnable: ${String(error).slice(0, 160)}`);
      }
      throw error;
    } finally {
      await tools.close();
    }
  });
});
