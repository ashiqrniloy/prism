import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, UsageError } from "../cli/args.js";
import { type RecoverAfterCrashResult, recoverAfterCrash } from "../scenarios/recover-after-crash.js";

let root: string;
let result: RecoverAfterCrashResult;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "pa-rec-"));
  result = await recoverAfterCrash(root);
}, 90_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test("reference_host_completes_a_killed_run_after_restart", () => {
  expect(result.crashSignal).toBe("SIGKILL");
  expect(result.ledgerStatus).toBe("running");
  expect(result.written).toBe("written");
  expect(result.recoverExit).toBe(0);
  expect(result.recoveryLines).toEqual([
    { type: "prism-agent.recovery", sessionId: "recover-after-crash", runId: expect.any(String), status: "completed" },
    { type: "prism-agent.exit", code: 0 },
  ]);
  // No new user message: the continuation answered the tool result.
  expect(result.roles).toEqual(["user", "assistant", "tool", "assistant"]);
  expect(result.finalText).toBe("ok");
});

test("a_second_sweep_skips_the_recovered_session", () => {
  // The continuation ran under a new run id, so the killed run's row stays `running`; the session owes nothing now.
  expect(result.secondSweep).toEqual([
    {
      type: "prism-agent.recovery",
      sessionId: "recover-after-crash",
      runId: expect.any(String),
      status: "skipped",
      reason: "nothing_to_continue",
    },
    { type: "prism-agent.exit", code: 0 },
  ]);
});

test("recover_command_takes_only_agent_and_config", () => {
  expect(parseArgs(["recover", "--config", "x.json"])).toEqual({ command: "recover", agent: "orchestrator", config: "x.json" });
  expect(() => parseArgs(["recover", "--session", "s"])).toThrow(UsageError);
  expect(() => parseArgs(["recover", "extra"])).toThrow(UsageError);
});
