import type { Agent } from "@arnilo/prism";
import { createSqlitePersistence } from "@arnilo/prism-extensions/store-sqlite";
import { continueInterrupted, findInterruptedRuns } from "@arnilo/prism-hosts/headless";
import { HostStartError } from "../host/start.js";
import { sessionIndex } from "../host/store.js";
import { mockPackages } from "./agents.js";
import type { RecoverArgs } from "./args.js";
import { exitCode, type TerminalStatus } from "./exit-codes.js";
import { exitLine, type LineIO, writeEvent } from "./jsonl.js";
import { agentFor, configFile, type RunDeps, readHostConfig } from "./run.js";

/** Precedence as for `run`: suspended > failed > completed. */
function worst(current: TerminalStatus | undefined, next: TerminalStatus): TerminalStatus {
  const rank = { completed: 0, stopped: 0, failed: 1, suspended: 2 } as const;
  return current === undefined || rank[next] > rank[current] ? next : current;
}

/**
 * The startup sweep: continue every run the ledger still records as `running` for `--agent`'s
 * sessions. Needs the `recovery` config block (which also turns the run ledger on). One
 * `prism-agent.recovery` line per run, then the exit line. Nothing to continue exits 0.
 */
export async function recoverCommand(args: RecoverArgs, io: LineIO, deps: RunDeps = {}): Promise<number> {
  let agent: Agent | undefined;
  const ledger: { close?: () => void }[] = [];
  try {
    const config = readHostConfig(configFile(args, deps.cwd ?? process.cwd()));
    if (config.recovery === undefined) throw new HostStartError("prism-agent recover needs a recovery block in the config");
    const packages = [...(deps.packages ?? []), ...(await mockPackages())];
    agent = await agentFor(args.agent, config, packages);
    const persistence = createSqlitePersistence({ filename: config.storePath });
    ledger.push(persistence);
    const found = await findInterruptedRuns(persistence, {
      ownership: agent.config.ownership ?? {},
      ...(config.recovery.olderThanMs === undefined ? {} : { olderThanMs: config.recovery.olderThanMs }),
    });
    // The ledger has no agent name; the session's actor says which worker owns it.
    const index = sessionIndex(config.storePath);
    const mine = [];
    for (const run of found) {
      if ((await index.get(run.sessionId))?.actor?.agent === args.agent) mine.push(run);
    }
    let terminal: TerminalStatus | undefined;
    for (const outcome of await continueInterrupted(agent, mine, { concurrency: 2 })) {
      if (outcome.status === "continued") {
        const status = outcome.result.status === "aborted" ? "failed" : outcome.result.status;
        terminal = worst(terminal, status);
        writeEvent(io, { type: "prism-agent.recovery", sessionId: outcome.sessionId, runId: outcome.runId, status: outcome.result.status });
      } else if (outcome.status === "skipped") {
        writeEvent(io, {
          type: "prism-agent.recovery",
          sessionId: outcome.sessionId,
          runId: outcome.runId,
          status: "skipped",
          reason: outcome.reason,
        });
      } else {
        terminal = worst(terminal, "failed");
        io.writeError(outcome.error instanceof Error ? outcome.error.message : String(outcome.error));
        writeEvent(io, { type: "prism-agent.recovery", sessionId: outcome.sessionId, runId: outcome.runId, status: "failed" });
      }
    }
    const code = exitCode(terminal ?? "completed");
    writeEvent(io, exitLine(code));
    return code;
  } catch (error) {
    if (error instanceof HostStartError) {
      io.writeError(error.message);
      writeEvent(io, exitLine(2));
      return 2;
    }
    throw error;
  } finally {
    await agent?.dispose();
    for (const handle of ledger) handle.close?.();
  }
}
