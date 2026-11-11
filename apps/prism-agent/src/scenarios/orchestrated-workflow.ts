import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentEvent } from "@arnilo/prism";
import { createScriptedCli, createScriptedHostUi, mockProvider, providerDone, providerTextDelta } from "@arnilo/prism/testing";
import { createSqlitePersistence } from "@arnilo/prism-extensions/store-sqlite";
import {
  defineWorkflow,
  functionNode,
  gateNode,
  resolveMaxFanOut,
  runWorkflow,
  type WorkflowRun,
  type WorkflowStreamEvent,
} from "@arnilo/prism-extensions/workflows";
import type { HostConfig } from "../host/config.js";
import {
  connectRemoteWorker,
  createCodingWorker,
  createExternalWorker,
  createOrchestrator,
  createResearchWorker,
  sessionIndex,
} from "../host/index.js";
import { buildWorkflow } from "../host/workflow.js";
import { externalScript } from "./external-worker-attribution.js";
import { writeObscuraFixture } from "./fixtures/obscura-fixture.js";
import { fetchBothScript } from "./fixtures/scripts.js";
import { hostStreamCliDialect } from "./stream-cli.dialect.js";

export interface WorkerOrigin {
  readonly agentId: string;
  readonly events: number;
  readonly executedBy: readonly string[];
  readonly remote: readonly string[];
  readonly bare: number;
}

export interface OrchestratedWorkflowResult {
  readonly status: string;
  readonly gatePasses: readonly boolean[];
  readonly failRoute: readonly string[];
  readonly humanGateAsked: number;
  readonly sessionAgentIds: readonly string[];
  readonly origins: readonly WorkerOrigin[];
  readonly cited: boolean;
  readonly fanOutLimit: number;
  readonly codingSessions: number;
}

function repository(workspace: string): void {
  mkdirSync(workspace, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", workspace]);
  execFileSync("git", ["config", "user.name", "Prism Agent"], { cwd: workspace });
  execFileSync("git", ["config", "user.email", "prism-agent@example.invalid"], { cwd: workspace });
  writeFileSync(join(workspace, "README.md"), "# workspace\n");
  execFileSync("git", ["add", "-A"], { cwd: workspace });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: workspace });
}

function writeGateCommand(root: string): readonly string[] {
  const count = join(root, "gate-count");
  const script = join(root, "gate.mjs");
  writeFileSync(count, "0");
  writeFileSync(
    script,
    `import { readFileSync, writeFileSync } from "node:fs";
const file = process.argv[2];
const n = Number(readFileSync(file, "utf8"));
writeFileSync(file, String(n + 1));
process.exit(n === 0 ? 1 : 0);
`,
  );
  return [process.execPath, script, count];
}

function present(values: readonly (string | undefined)[]): readonly string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))];
}

function originsOf(events: readonly AgentEvent[], sessionAgent: ReadonlyMap<string, string>, agentId: string): WorkerOrigin {
  const mine = events.filter((event) => event.sessionId !== undefined && sessionAgent.get(event.sessionId) === agentId);
  return {
    agentId,
    events: mine.length,
    executedBy: present(mine.map((event) => event.origin?.executedBy)),
    remote: present(mine.map((event) => event.origin?.remote)),
    bare: mine.filter((event) => event.origin === undefined).length,
  };
}

function gateData(event: WorkflowStreamEvent): { nodeId?: string; pass?: boolean; route?: readonly string[] } {
  if (event.type !== "package.event" || event.data === null || typeof event.data !== "object" || Array.isArray(event.data)) return {};
  const data = event.data;
  return {
    ...(typeof data.nodeId === "string" ? { nodeId: data.nodeId } : {}),
    ...(typeof data.pass === "boolean" ? { pass: data.pass } : {}),
    ...(Array.isArray(data.route) ? { route: data.route.filter((item): item is string => typeof item === "string") } : {}),
  };
}

/** The build graph, end to end, on the mock provider and the scripted CLI. */
export async function orchestratedWorkflow(config: HostConfig): Promise<OrchestratedWorkflowResult> {
  const root = dirname(config.storePath);
  const cli = createScriptedCli({ dialect: hostStreamCliDialect, script: externalScript() });
  const ui = createScriptedHostUi({ confirm: true, select: "once" });
  const ready: HostConfig = {
    ...config,
    web: { ...config.web, obscuraBinary: writeObscuraFixture(root) },
    gate: { command: writeGateCommand(root) },
    external: { binary: cli.command[0]!, args: cli.command.slice(1), profilesRoot: join(root, "p") },
  };
  writeFileSync(join(root, "remote.json"), JSON.stringify(ready));
  repository(ready.workspace);
  const research = await createResearchWorker(ready, {
    packages: [mockProvider([[providerTextDelta("Brief: three slices."), providerDone()], ...fetchBothScript()])],
  });
  const coding = await createCodingWorker(ready, {
    packages: [mockProvider([[providerTextDelta("coding slice"), providerDone()]])],
  });
  const external = await createExternalWorker(ready);
  const remote = await connectRemoteWorker({
    configPath: join(root, "remote.json"),
    ui: ui.ui,
    mirror: createSqlitePersistence({ filename: ready.storePath }),
    env: { PRISM_AGENT_MOCK: "text" },
  });
  let resolveRun: (run: WorkflowRun) => void = () => undefined;
  const started = new Promise<WorkflowRun>((resolve) => {
    resolveRun = resolve;
  });
  const orchestrator = await createOrchestrator(ready, {
    host: { ui: ui.ui },
    workers: { research, coding, external, remote },
    onRun: (run) => resolveRun(run),
  });
  try {
    const parent = await orchestrator.session();
    const command = orchestrator.commands.run("build", {}, { session: parent });
    const run = await Promise.race([started, command.then(() => Promise.reject(new Error("build ended before it started")))]);
    const events: WorkflowStreamEvent[] = [];
    for await (const event of run.stream()) events.push(event);
    const result = await run.result();
    await command;
    const page = await sessionIndex(ready.storePath).list({ workflowRunId: run.id });
    const sessionAgent = new Map(
      page.items.flatMap((item) => (item.agentId === undefined ? [] : [[item.sessionId, item.agentId] as const])),
    );
    const agentEvents = events.filter((event): event is AgentEvent => event.type !== "package.event");
    const gates = events.map(gateData).filter((data) => data.nodeId === "tests" && data.pass !== undefined);
    const failed = gates.find((data) => data.pass === false);
    let cited = false;
    for (const item of page.items.filter((item) => item.agentId === research.id)) {
      const session = await research.session({ id: item.sessionId });
      const verdict = (await research.commands.run("research.verify", {}, { session })) as { verdict: string; ledgerSize: number };
      if (verdict.verdict === "passed" && verdict.ledgerSize > 0) cited = true;
    }
    const graph = buildWorkflow(ready, { research, coding, external, remote });
    return {
      status: result.status,
      gatePasses: gates.map((data) => data.pass === true),
      failRoute: failed?.route ?? [],
      humanGateAsked: ui.requestsOf("confirm").length,
      sessionAgentIds: page.items.flatMap((item) => (item.agentId === undefined ? [] : [item.agentId])),
      origins: [research.id, coding.id, external.id, remote.id].map((agentId) => originsOf(agentEvents, sessionAgent, agentId)),
      cited,
      fanOutLimit: resolveMaxFanOut(graph, graph.nodes.slices!),
      codingSessions: page.items.filter((item) => item.agentId === coding.id).length,
    };
  } finally {
    await orchestrator.dispose();
    await remote.dispose();
    await external.dispose();
    await coding.dispose();
    await research.dispose();
    cli.dispose();
  }
}

/** A gate whose check throws, and that has no back edge, fails the run instead of continuing. */
export async function gateThrowFails(): Promise<string> {
  const graph = defineWorkflow({
    id: "prism-agent.gate-throw",
    revision: "1",
    limits: { maxSupersteps: 4 },
    nodes: {
      start: functionNode({ execute: () => "ok" }),
      tests: gateNode({
        check: () => {
          throw new Error("gate blew");
        },
      }),
    },
    edges: [["start", "tests"]],
  });
  try {
    await runWorkflow(graph, {});
    return "succeeded";
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
}
