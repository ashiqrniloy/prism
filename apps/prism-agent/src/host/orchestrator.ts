import { type Agent, createAgent, definePackage } from "@arnilo/prism";
import delegate from "@arnilo/prism-extensions/delegate";
import workflows, { type WorkflowRun, workflowCommand } from "@arnilo/prism-extensions/workflows";
import type { HostConfig, HostDeps } from "./config.js";
import { hostPortOf, sessionLimitsConfig } from "./config.js";
import { runLedgerConfig, sqlitePackage } from "./store.js";
import { type BuildWorkers, buildWorkflow } from "./workflow.js";

export interface OrchestratorDeps extends HostDeps {
  /** The four workers the build graph runs. Absent: `build` fails closed instead of guessing. */
  readonly workers?: BuildWorkers;
  /** Handed the live run before the command awaits it, so a host can read `run.stream()`. */
  readonly onRun?: (run: WorkflowRun) => void;
}

/**
 * Delegate child `research-brief` inherits nothing, so it runs with no tools, and is not the research worker.
 * It is a session of this agent linked to the calling session, so its transcript is in the shared SQLite file.
 * `build` is a host command, not a model-visible tool.
 */
export async function createOrchestrator(config: HostConfig, deps: OrchestratorDeps = {}): Promise<Agent> {
  const workers = deps.workers;
  const host = hostPortOf(deps);
  return createAgent({
    name: "orchestrator",
    ...(deps.ownership === undefined ? {} : { ownership: deps.ownership }),
    model: config.models.orchestrator,
    ...(host === undefined ? {} : { host }),
    ...runLedgerConfig(config),
    ...sessionLimitsConfig(config),
    packages: [
      sqlitePackage(config.storePath),
      workflows,
      delegate({ children: { "research-brief": { inherit: [] } } }),
      definePackage({
        name: "@prism-agent/build-command",
        version: "0.0.0",
        requires: { api: 2 },
        setup: (prism) => {
          prism.commands.register(
            workflowCommand(
              prism,
              "build",
              () => {
                if (workers === undefined) {
                  throw new Error("prism-agent build needs the research, coding, external, and remote workers");
                }
                return buildWorkflow(config, workers);
              },
              {
                description: "Run the build workflow",
                ...(deps.onRun === undefined ? {} : { onRun: deps.onRun }),
              },
            ),
          );
        },
      }),
      ...(deps.packages ?? []),
    ],
  });
}
