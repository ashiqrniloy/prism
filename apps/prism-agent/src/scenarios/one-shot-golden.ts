import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../cli/run.js";
import type { HostConfig } from "../host/config.js";
import { mockPackages } from "./mock-seam.js";

const FIXED = "2026-01-01T00:00:00.000Z";
export const GOLDEN_SESSION = "session_golden";

/**
 * Kernel has no clock slot. `new Date().toISOString()` and `Date.now()` are patched for this call
 * only. `runId` and other minted ids stay random; the test replaces those keys.
 */
function installClock(): () => void {
  const realNow = Date.now;
  const realIso = Date.prototype.toISOString;
  Date.now = () => Date.parse(FIXED);
  Date.prototype.toISOString = () => FIXED;
  return () => {
    Date.now = realNow;
    Date.prototype.toISOString = realIso;
  };
}

export async function oneShotGolden(root: string): Promise<readonly string[]> {
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  const config: HostConfig = {
    models: {
      orchestrator: { provider: "mock", model: "m" },
      coding: { provider: "mock", model: "m" },
      research: { provider: "mock", model: "m" },
    },
    storePath: join(root, "sessions.db"),
    workspace,
    approval: "ask",
    web: { backend: "obscura" },
  };
  const path = join(root, "prism-agent.json");
  writeFileSync(path, JSON.stringify(config));
  const lines: string[] = [];
  const restore = installClock();
  try {
    await runCommand(
      { command: "run", agent: "orchestrator", config: path, session: GOLDEN_SESSION, prompt: "say ok" },
      { write: (line) => lines.push(line), writeError: () => undefined },
      { packages: mockPackages("text") },
    );
  } finally {
    restore();
  }
  return lines;
}
