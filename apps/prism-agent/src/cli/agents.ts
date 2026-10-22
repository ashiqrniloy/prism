import type { Agent, PackageInstance } from "@arnilo/prism";
import type { HostConfig, HostDeps } from "../host/config.js";
import type { AgentName } from "./args.js";

type Factory = (config: HostConfig, deps?: HostDeps) => Promise<Agent>;

/**
 * One dynamic import per agent module, so `run --agent coding` does not load the research worker.
 * The specifiers are literals: the boundary gate rejects a non-literal import().
 */
export async function loadAgent(name: AgentName): Promise<Factory> {
  if (name === "coding") {
    const mod = await import("../host/coding.js");
    return mod.createCodingWorker;
  }
  if (name === "research") {
    const mod = await import("../host/research.js");
    return mod.createResearchWorker;
  }
  const mod = await import("../host/orchestrator.js");
  return mod.createOrchestrator;
}

/**
 * Fresh-process tests cannot share an in-memory mock provider. `PRISM_AGENT_MOCK` names a script
 * the scenarios seam registers. Unset on a real run.
 */
export async function mockPackages(): Promise<readonly PackageInstance[]> {
  const kind = process.env.PRISM_AGENT_MOCK;
  if (kind === undefined || kind.length === 0) return [];
  const seam = await import("../scenarios/mock-seam.js");
  return seam.mockPackages(kind);
}
