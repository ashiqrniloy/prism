import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Agent, AgentEvent, PackageInstance, RunLimits } from "@arnilo/prism";
import { type HostConfig, loadHostConfig } from "../host/config.js";
import { HostStartError, startAgent } from "../host/start.js";
import { loadAgent, mockPackages } from "./agents.js";
import type { AgentName, RunArgs } from "./args.js";
import { exitCode, type TerminalStatus, verdictOf } from "./exit-codes.js";
import { exitLine, type LineIO, writeEvent } from "./jsonl.js";

export interface RunDeps {
  readonly packages?: readonly PackageInstance[];
  readonly cwd?: string;
  /** Agent-wide ceilings, handed to the worker (the coding worker honours them). */
  readonly limits?: RunLimits;
}

export function configFile(args: { readonly config?: string }, cwd: string): string {
  return args.config ?? join(cwd, "prism-agent.json");
}

export function readHostConfig(path: string): HostConfig {
  if (!existsSync(path) || !statSync(path).isFile()) throw new HostStartError(`prism-agent config must name a file: ${path}`);
  try {
    return loadHostConfig(path);
  } catch (error) {
    throw new HostStartError(error instanceof Error ? error.message : String(error), { cause: error });
  }
}

function terminalOf(event: AgentEvent, current: TerminalStatus | undefined): TerminalStatus | undefined {
  if (event.type === "run.suspended") return "suspended";
  if (event.type === "run.failed") return "failed";
  if (event.type === "run.completed") return event.status;
  return current;
}

async function openAgent(name: AgentName, config: HostConfig, packages: readonly PackageInstance[], limits?: RunLimits): Promise<Agent> {
  const create = await loadAgent(name);
  return startAgent(() => create(config, { ...(packages.length === 0 ? {} : { packages }), ...(limits === undefined ? {} : { limits }) }));
}

/** One prompt, each session event written as it arrives. No host redactor and no reshaping. */
export async function runCommand(args: RunArgs, io: LineIO, deps: RunDeps = {}): Promise<number> {
  let agent: Agent | undefined;
  try {
    const config = readHostConfig(configFile(args, deps.cwd ?? process.cwd()));
    const packages = [...(deps.packages ?? []), ...(await mockPackages())];
    agent = await openAgent(args.agent, config, packages, deps.limits);
    const session = await agent.session({
      ...(args.session === undefined ? {} : { id: args.session, create: true }),
      actor: { kind: "prism", agent: args.agent },
    });
    let terminal: TerminalStatus | undefined;
    for await (const event of session.stream(args.prompt)) {
      writeEvent(io, event);
      terminal = terminalOf(event, terminal);
    }
    const verify =
      args.agent === "research" && (terminal === "completed" || terminal === "stopped")
        ? verdictOf(await agent.commands.run("research.verify", {}, { session }))
        : undefined;
    const code = exitCode(terminal, verify);
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
  }
}

export async function agentFor(name: AgentName, config: HostConfig, packages: readonly PackageInstance[]): Promise<Agent> {
  return openAgent(name, config, packages);
}
