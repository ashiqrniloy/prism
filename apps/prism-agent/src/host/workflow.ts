import { execFileSync } from "node:child_process";
import type { Agent } from "@arnilo/prism";
import { agentNode, defineWorkflow, fanOut, gateNode, humanGate, type WorkflowDefinition } from "@arnilo/prism-extensions/workflows";
import type { HostConfig } from "./config.js";

/** The four workers the build graph closes over. The host passes these factories' agents; it never loads a manifest. */
export interface BuildWorkers {
  readonly research: Agent;
  readonly coding: Agent;
  readonly external: Agent;
  readonly remote: Agent;
}

const SLICES = ["coding", "external", "remote"] as const;

function sliceAgent(workers: BuildWorkers, item: unknown): Agent {
  if (item === "coding" || item === "external" || item === "remote") return workers[item];
  throw new Error("prism-agent build slice is not a worker");
}

/** Exit 0 passes. A throw or a non-zero exit is a failed gate; the graph's back edge owns the retry. */
function runGateCommand(config: HostConfig): { pass: true } | { pass: false; reason: string } {
  const command = config.gate?.command;
  if (command === undefined || command.length === 0) return { pass: false, reason: "gate_command_unset" };
  try {
    execFileSync(command[0]!, command.slice(1), { stdio: "ignore", timeout: 30_000 });
    return { pass: true };
  } catch (error) {
    const status = (error as { status?: number }).status;
    return { pass: false, reason: `exit_${status ?? "error"}` };
  }
}

/**
 * One declarative graph (roadmap §2.12.13). No engine here: nodes, edges, and a fixed argv check.
 * `fanOut` leaves concurrency at `resolveMaxFanOut`'s default. The tests gate's back edge is the coding worker.
 */
export function buildWorkflow(config: HostConfig, workers: BuildWorkers): WorkflowDefinition {
  return defineWorkflow({
    id: "prism-agent.build",
    revision: "1",
    limits: { maxSupersteps: 24 },
    nodes: {
      brief: agentNode({ agent: workers.research, input: () => "Write the research brief." }),
      slices: fanOut({
        items: () => SLICES,
        route: (item) => agentNode({ agent: sliceAgent(workers, item), input: () => `Implement the ${String(item)} slice.` }),
      }),
      // `any`: the repair back edge is not an upstream this gate waits for on the first pass.
      tests: gateNode({
        activation: "any",
        check: () => runGateCommand(config),
        onFail: "coding",
        maxIterations: 2,
      }),
      coding: agentNode({
        agent: workers.coding,
        activation: "any",
        input: () => "Fix the failing tests.",
      }),
      signoff: humanGate({
        request: { kind: "confirm", title: "Ship the change?" },
        onFail: "tests",
      }),
      report: agentNode({ agent: workers.research, input: () => "Write the report and cite the ledger." }),
    },
    edges: [
      ["brief", "slices"],
      ["slices", "tests"],
      ["tests", "coding"],
      ["coding", "tests"],
      ["tests", "signoff"],
      ["signoff", "tests"],
      ["signoff", "report"],
    ],
  });
}
