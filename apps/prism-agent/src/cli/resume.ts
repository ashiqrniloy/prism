import type { Agent, Decision } from "@arnilo/prism";
import { HostStartError } from "../host/start.js";
import { sessionIndex } from "../host/store.js";
import { mockPackages } from "./agents.js";
import type { AgentName, ResumeArgs } from "./args.js";
import { UsageError } from "./args.js";
import { exitCode, type TerminalStatus } from "./exit-codes.js";
import { exitLine, type LineIO, writeEvent } from "./jsonl.js";
import { agentFor, configFile, type RunDeps, readHostConfig } from "./run.js";

function outcome(value: "allow" | "deny"): Decision["outcome"] {
  return value === "allow" ? "allow_once" : "reject_once";
}

async function namedAgent(storePath: string, sessionId: string): Promise<AgentName | undefined> {
  const page = await sessionIndex(storePath).list();
  const actor = page.items.find((item) => item.sessionId === sessionId)?.actor?.agent;
  if (actor === "orchestrator" || actor === "coding" || actor === "research") return actor;
  return undefined;
}

/** Resume a suspended session from the same SQLite file. Decisions are `allow` or `deny` on the CLI. */
export async function resumeCommand(args: ResumeArgs, io: LineIO, deps: RunDeps = {}): Promise<number> {
  let agent: Agent | undefined;
  try {
    const config = readHostConfig(configFile(args, deps.cwd ?? process.cwd()));
    const name = args.agent ?? (await namedAgent(config.storePath, args.session));
    if (name === undefined) throw new UsageError("resume needs --agent or a session actor");
    const packages = [...(deps.packages ?? []), ...(await mockPackages())];
    agent = await agentFor(name, config, packages);
    const session = await agent.session({ id: args.session });
    const decisions: Decision[] = args.decisions.map((item) => ({ approvalId: item.approvalId, outcome: outcome(item.outcome) }));
    let terminal: TerminalStatus | undefined;
    for await (const event of session.resume(decisions)) {
      writeEvent(io, event);
      if (event.type === "run.suspended") terminal = "suspended";
      else if (event.type === "run.failed") terminal = "failed";
      else if (event.type === "run.completed") terminal = event.status;
    }
    const code = exitCode(terminal);
    writeEvent(io, exitLine(code));
    return code;
  } catch (error) {
    if (error instanceof HostStartError || error instanceof UsageError) {
      io.writeError(error.message);
      writeEvent(io, exitLine(2));
      return 2;
    }
    throw error;
  } finally {
    await agent?.dispose();
  }
}
