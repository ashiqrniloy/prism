import { serveAcp } from "@arnilo/prism-acp";
import { HostStartError } from "../host/start.js";
import { mockPackages } from "./agents.js";
import type { AcpArgs } from "./args.js";
import { exitLine, type LineIO, writeEvent } from "./jsonl.js";
import { agentFor, configFile, type RunDeps, readHostConfig } from "./run.js";

/** ACP over stdio only. The editor owns the other half of the stream. */
export async function acpCommand(args: AcpArgs, io: LineIO, deps: RunDeps = {}): Promise<number> {
  let agent: Awaited<ReturnType<typeof agentFor>> | undefined;
  try {
    const config = readHostConfig(configFile(args, deps.cwd ?? process.cwd()));
    const packages = [...(deps.packages ?? []), ...(await mockPackages())];
    agent = await agentFor(args.agent, config, packages);
    const server = serveAcp(agent, { stdio: true });
    await server.closed;
    return 0;
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
