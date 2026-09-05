// Plan 060 leak tests: N=200 spawn/exit cycles across teardown modes must
// leave no running records and an empty registry after dispose. Records are
// retained as terminal job-table entries by design (re-readable output), so
// the leak assertion is terminal-only residue plus post-dispose empty —
// deterministic, no sleeps. Skips on tiny heaps.
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { getHeapStatistics } from "node:v8";
import { createSessionsHost } from "../process/sessions-host.js";
import { startSession } from "../process/sessions-spawn.js";
import { disposeSessions } from "../process/sessions-teardown.js";

const N = 200;
const PER_MODE = Math.floor(N / 3);
const LOW_MEM = getHeapStatistics().heap_size_limit < 512 * 1024 * 1024;
const TERMINAL = new Set(["exited", "killed", "released", "expired", "unknown"]);

describe("leak: process sessions leave no running residue", { skip: LOW_MEM }, () => {
  it("200 spawn/exit cycles stay terminal-only; dispose empties the registry", async () => {
    const host = createSessionsHost({ cwd: tmpdir(), onEvent: () => {}, limits: { maxLifetimeMs: 60_000 } });
    try {
      const modes = ["exit", "kill", "release"] as const;
      for (const mode of modes) {
        for (let i = 0; i < PER_MODE; i++) {
          const long = mode !== "exit";
          const p = await startSession(host, {
            command: process.execPath,
            args: long ? ["-e", "setInterval(() => {}, 1000)"] : ["-e", "process.exit(0)"],
            lifetimeMs: 30_000,
          });
          let terminalState: string;
          if (mode === "kill") {
            await p.kill();
            terminalState = (await p.wait({ timeoutMs: 5_000 })).state;
          } else if (mode === "release") {
            await p.release(); // release is itself terminal; wait() would throw "session released"
            terminalState = p.state;
          } else {
            terminalState = (await p.wait({ timeoutMs: 5_000 })).state;
          }
          assert.ok(TERMINAL.has(terminalState), `${mode} cycle ${i}: must reach terminal, got ${terminalState}`);
        }
      }
      const live = [...host.sessions.values()].filter((r) => !TERMINAL.has(r.state));
      assert.equal(live.length, 0, `${live.length} non-terminal records leaked`);
    } finally {
      await disposeSessions(host);
    }
    assert.equal(host.sessions.size, 0, "dispose must empty the registry");
  });
});
