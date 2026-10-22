import type { Agent, PackageInstance } from "@arnilo/prism";
import { createCodingWorker } from "../host/coding.js";
import type { HostConfig } from "../host/config.js";
import { createExternalWorker } from "../host/external.js";
import { createOrchestrator } from "../host/orchestrator.js";
import { connectRemoteWorker } from "../host/remote.js";
import { createResearchWorker } from "../host/research.js";
import { clockFromEnv, createHostScheduler, SCHEDULE_OWNERSHIP } from "../host/schedule.js";
import { HostStartError, startAgent } from "../host/start.js";
import { mockPackages } from "./agents.js";
import type { ScheduleArgs } from "./args.js";
import { exitLine, type LineIO, writeEvent } from "./jsonl.js";
import { configFile, type RunDeps, readHostConfig } from "./run.js";

export interface ScheduleDeps extends RunDeps {
  /** Resolves when the process is told to stop. Default: SIGTERM or SIGINT. */
  readonly stopped?: Promise<void>;
}

function signalled(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGTERM", () => resolve());
    process.once("SIGINT", () => resolve());
  });
}

/** The build graph's four workers. Only created when `schedule.build` is configured. */
async function buildAgents(
  config: HostConfig,
  configPath: string,
  research: Agent,
  packages: readonly PackageInstance[],
  opened: Agent[],
): Promise<Agent> {
  if (config.external === undefined) throw new HostStartError("prism-agent schedule.build needs an external block");
  const deps = { ownership: SCHEDULE_OWNERSHIP, packages };
  const coding = await startAgent(() => createCodingWorker(config, { packages }));
  opened.push(coding);
  const external = await startAgent(() => createExternalWorker(config, { packages }));
  opened.push(external);
  const remote = await startAgent(() => connectRemoteWorker({ configPath }));
  opened.push(remote);
  const orchestrator = await startAgent(() => createOrchestrator(config, { ...deps, workers: { research, coding, external, remote } }));
  opened.push(orchestrator);
  return orchestrator;
}

/**
 * Runs the scheduler until signalled, then lets in-flight firings settle. Exit 0.
 * `PRISM_AGENT_CLOCK=file:<path>` swaps the clock for a shared fake one (scenarios only).
 */
export async function scheduleCommand(args: ScheduleArgs, io: LineIO, deps: ScheduleDeps = {}): Promise<number> {
  const opened: Agent[] = [];
  try {
    const path = configFile(args, deps.cwd ?? process.cwd());
    const config = readHostConfig(path);
    if (config.schedule?.brief === undefined && config.schedule?.build === undefined) {
      throw new HostStartError("prism-agent config has no schedule.brief or schedule.build");
    }
    const packages = [...(deps.packages ?? []), ...(await mockPackages())];
    const research = await startAgent(() =>
      createResearchWorker(config, { ownership: SCHEDULE_OWNERSHIP, ...(packages.length === 0 ? {} : { packages }) }),
    );
    opened.push(research);
    const orchestrator = config.schedule.build === undefined ? undefined : await buildAgents(config, path, research, packages, opened);
    const clock = clockFromEnv(process.env.PRISM_AGENT_CLOCK);
    const scheduler = await createHostScheduler(config, {
      research,
      ...(orchestrator === undefined ? {} : { orchestrator }),
      ...(clock === undefined ? {} : { clock }),
    });
    const stopped = deps.stopped ?? signalled();
    scheduler.start();
    await stopped;
    await scheduler.stop();
    return 0;
  } catch (error) {
    if (error instanceof HostStartError) {
      io.writeError(error.message);
      writeEvent(io, exitLine(2));
      return 2;
    }
    throw error;
  } finally {
    await Promise.all(opened.map((agent) => agent.dispose()));
  }
}
