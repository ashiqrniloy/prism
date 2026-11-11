import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Agent, type AgentEvent, createAgent, definePackage, providerDone, providerTextDelta } from "@arnilo/prism";
import { createProfiles } from "@arnilo/prism/driver-kit";
import { createScriptedCli, createScriptedHostUi, mockProvider, type ScriptStep } from "@arnilo/prism/testing";
import { adapterDriver, processDriver } from "@arnilo/prism-hosts/driver-process";
import { sqliteStore } from "@arnilo/prism-extensions/store-sqlite";
import workflows, {
  agentNode,
  defineWorkflow,
  fanOut,
  gateNode,
  humanGate,
  type WorkflowRun,
  type WorkflowStreamEvent,
  workflowCommand,
} from "@arnilo/prism-extensions/workflows";
import { createWorkspaceService } from "@arnilo/prism-tools/coding";
import { rpcServerDialect, rpcServerFixtures } from "./adapters/rpc-server.dialect.js";
import { rpcServer } from "./adapters/rpc-server.js";
import { streamCliDialect, streamCliFixtures } from "./adapters/stream-cli.dialect.js";
import { streamCli } from "./adapters/stream-cli.js";

/**
 * The §2.11 orchestration, offline (roadmap Phase 16 Done): `/build` runs research, plan, a plan gate that fails once
 * and routes back, a `humanGate`, a `fanOut` of six tasks in git worktrees (three to a UI engineer under a profile cap
 * of two), a merge gate over `workspace.merge`, a validator, and a tests gate.
 *
 *  - host agent: the mock provider.
 *  - planner and UI engineer: the `stream-cli` reference adapter. Validator: the `rpc-server` reference adapter.
 *    Each runs over `createScriptedCli`, so no vendor binary and no network.
 *  - one SQLite file holds sessions, vendor state, checkpoints, and leases; a temp git repository backs `workspace`.
 *
 * The demo asserts the Done criteria it can reach in one process and throws on any miss. The rest are proven by tests:
 * kill-and-resume by `kill_and_resume_skips_completed_nodes`, `workflowLoop` under approval by
 * `workflow_loop_gates_tools_under_approval` (and `examples/workflow-loop.ts`), and no kernel checkpoints or leases by
 * `kernel_contains_no_checkpoints_or_leases`.
 * Run: npm run build:core && bun examples/build-workflow.ts
 */

const PROFILE_CAP = 2;
const TASKS = [
  { id: 1, ui: false },
  { id: 2, ui: true },
  { id: 3, ui: false },
  { id: 4, ui: false },
  { id: 5, ui: true },
  { id: 6, ui: true },
].map((task) => ({ ...task, prompt: `Build task ${task.id}` }));

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`build-workflow: ${message}`);
}
const delta = (value: string): ScriptStep => ({ out: { kind: "message.delta", content: { type: "text", text: value } } });
/** The final assistant message is what `result.text` reads; deltas alone only stream. */
const final = (value: string): ScriptStep => ({
  out: { kind: "message", message: { role: "assistant", content: [{ type: "text", text: value }] } },
});
const text = (value: string): readonly ScriptStep[] => [delta(value), final(value)];

function repository(root: string): string {
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git(repo, "config", "user.name", "Build Example");
  git(repo, "config", "user.email", "build@example.invalid");
  writeFileSync(join(repo, "README.md"), "# build example\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  return repo;
}

export async function demo(): Promise<Record<string, unknown>> {
  const root = mkdtempSync(join(tmpdir(), "bw-"));
  const clis: { dispose(): void }[] = [];
  try {
    const repo = repository(root);
    const dbPath = join(root, "state.db");
    const workspace = await createWorkspaceService({ root: repo, worktreeRoot: join(root, "trees"), maxWorktrees: 8 });
    const ui = createScriptedHostUi({ confirm: true });
    // Every agent gets the one workspace service, so a worktree the workflow creates is the one a driver resolves.
    const shared = definePackage({
      name: "@example/build-shared",
      version: "1.0.0",
      requires: { api: 1 },
      setup: (prism) => prism.services.provide("workspace", workspace),
    });
    const store = () => sqliteStore({ path: dbPath });

    // Drivers: one profile each, so the UI engineer's `maxConcurrentRuns` is the cap fanOut has to respect.
    const driverAgent = async (
      adapter: typeof streamCli | typeof rpcServer,
      dialect: typeof streamCliDialect,
      fixtures: typeof streamCliFixtures,
      options: { name: string; script: readonly ScriptStep[]; cap?: number },
    ): Promise<Agent> => {
      const cli = createScriptedCli({ dialect, script: options.script });
      clis.push(cli);
      await createProfiles({ root, driver: adapterDriver(adapter) }).create(options.name, {
        mode: "key",
        principal: "build",
        ...(options.cap === undefined ? {} : { maxConcurrentRuns: options.cap }),
      });
      return createAgent({
        id: options.name,
        packages: [store(), shared, processDriver(adapter)],
        packageConfig: {
          [adapter.name]: { ...fixtures.config(cli), name: options.name, profile: options.name, profilesRoot: root, principal: "build" },
        },
      });
    };

    const plan = JSON.stringify({ tasks: TASKS });
    const planner = await driverAgent(streamCli, streamCliDialect, streamCliFixtures, {
      name: "planner",
      script: [{ out: { kind: "message.delta", content: { type: "thinking", text: "Split the goal into six tasks." } } }, ...text(plan)],
    });
    const uiEngineer = await driverAgent(streamCli, streamCliDialect, streamCliFixtures, {
      name: "ui-engineer",
      cap: PROFILE_CAP,
      script: [
        { out: { kind: "message.delta", content: { type: "thinking", text: "Reuse the Button component." } } },
        { out: { kind: "subagent", phase: "started", id: "sub-1", name: "reviewer", parentToolCallId: "t-1" } },
        { wait: 300 },
        { out: { kind: "subagent", phase: "completed", id: "sub-1", result: "ok" } },
        ...text("UI task done."),
      ],
    });
    // The validator's frames use the same dialect-agnostic shape; the rpc-server dialect encodes them.
    const validator = await driverAgent(
      rpcServer,
      rpcServerDialect as typeof streamCliDialect,
      rpcServerFixtures as typeof streamCliFixtures,
      {
        name: "validator",
        script: text("Validated: all merged files present."),
      },
    );
    let onRun: (started: WorkflowRun) => void = () => undefined;
    const started = new Promise<WorkflowRun>((resolve) => {
      onRun = resolve;
    });
    const host = await createAgent({
      id: "host",
      model: { provider: "mock", model: "m" },
      packages: [
        store(),
        shared,
        workflows,
        mockProvider([[providerTextDelta("Research: prefer small, mergeable tasks."), providerDone()]]),
        definePackage({
          name: "@example/build-command",
          version: "1.0.0",
          requires: { api: 1 },
          setup: (prism) =>
            prism.commands.register(
              workflowCommand(prism, "build", () => build, {
                description: "Run the build workflow",
                args: {
                  type: "object",
                  properties: { goal: { type: "string", minLength: 1 } },
                  required: ["goal"],
                  additionalProperties: false,
                },
                onRun: (started) => onRun(started),
              }),
            ),
        }),
      ],
      host: { ui: ui.ui },
    });

    let planAttempts = 0;
    let planned: typeof TASKS = [];
    const merged: string[] = [];
    const build = defineWorkflow({
      id: "build",
      revision: "1",
      limits: { maxSupersteps: 24, maxConcurrency: 4 },
      nodes: {
        research: agentNode({ agent: host, input: (ctx) => `Research: ${String(ctx.workflowInput)}` }),
        plan: agentNode({
          agent: planner,
          activation: "any",
          input: (ctx) => `Plan: ${String(ctx.upstream.research ?? ctx.workflowInput)}`,
        }),
        planOk: gateNode({
          check: (ctx) => {
            planAttempts += 1;
            // The first draft is rejected as unreviewed; the revision passes.
            if (planAttempts < 2) return { pass: false, reason: "plan_unreviewed" };
            planned = (JSON.parse(String(ctx.upstream.plan)) as { tasks: typeof TASKS }).tasks;
            return { pass: true };
          },
        }),
        approve: humanGate({ request: { kind: "confirm", title: "Execute this plan?" }, onFail: "plan" }),
        // A node a failed gate routes back to needs `activation: "any"`: its back edge is not an upstream it waits for.
        execute: fanOut({
          activation: "any",
          items: () => planned,
          maxConcurrency: 4,
          route: (item) => {
            const task = item as (typeof TASKS)[number];
            return agentNode({
              agent: task.ui ? uiEngineer : host,
              worktree: true,
              input: () => task.prompt,
              // The scripted binaries edit nothing, so the node writes this task's file into its own worktree.
              output: (result) => {
                const tree = workspace.worktree.bound(result.sessionId);
                assert(tree !== undefined, `task ${task.id} has no bound worktree`);
                writeFileSync(join(tree.path, `task-${task.id}.txt`), `${result.text}\n`);
                return { task: task.id };
              },
            });
          },
        }),
        merge: gateNode({
          check: async (ctx) => {
            const results = ctx.upstream.execute as { worktree: { path: string; branch: string } }[];
            for (const [index, item] of results.entries()) {
              const outcome = await workspace.merge(item.worktree.path, { into: "main", commit: { message: `task ${index + 1}` } });
              if (outcome.status !== "merged") return { pass: false, reason: "merge_conflict" };
              merged.push(item.worktree.branch);
            }
            return { pass: true };
          },
        }),
        validate: agentNode({ activation: "any", agent: validator, input: () => "Validate the merged tree." }),
        tests: gateNode({
          check: () => {
            const present = TASKS.every((task) => existsSync(join(repo, `task-${task.id}.txt`)));
            return present ? { pass: true } : { pass: false, reason: "missing_task_files" };
          },
        }),
      },
      edges: [
        ["research", "plan"],
        ["plan", "planOk"],
        ["planOk", "plan"],
        ["planOk", "approve"],
        ["approve", "plan"],
        ["approve", "execute"],
        ["execute", "merge"],
        // A failed merge gate re-runs the fan-out; a failed tests gate re-runs the validator.
        ["merge", "execute"],
        ["merge", "validate"],
        ["validate", "tests"],
        ["tests", "validate"],
      ],
    });

    const parent = await host.session();
    // The command resolves when the run ends, so render the stream from the run `onRun` hands over.
    const command = host.commands.run("build", { goal: "add six tasks" }, { session: parent });
    const run = await Promise.race([started, command.then(() => Promise.reject(new Error("build ended before it started")))]);
    const events: WorkflowStreamEvent[] = [];
    for await (const event of run.stream()) {
      events.push(event);
    }
    const result = await run.result();
    await command;
    assert(result.status === "succeeded", `workflow ended ${result.status}`);

    // Done: the gate routed back once, inside maxSupersteps.
    const gates = events.filter((e) => e.type === "package.event" && e.name === "workflow.gate") as {
      data?: { nodeId?: string; pass?: boolean };
    }[];
    const planGate = gates.filter((g) => g.data?.nodeId === "planOk");
    assert(planGate.length === 2 && planGate[0]?.data?.pass === false, "the plan gate should fail once, then pass");

    // Done: the merged stream carries each agent's events with origin, including a sub-agent and thinking.
    // An external origin names the adapter it ran under; native children carry none.
    const agentEvents = events.filter((e): e is AgentEvent => e.type !== "package.event");
    const external = agentEvents.filter((e) => e.origin?.kind === "external");
    const adapters = new Set(external.map((e) => e.origin?.agent));
    assert(adapters.has(streamCli.name) && adapters.has(rpcServer.name), `origins seen: ${[...adapters].join(",")}`);
    assert(
      external.some((e) => e.type === "message.delta" && e.content.type === "thinking"),
      "no thinking delta in the stream",
    );
    assert(
      external.some((e) => e.origin?.subagentId !== undefined && (e.origin?.depth ?? 0) > 0),
      "no sub-agent origin in the stream",
    );
    assert(
      agentEvents.some((e) => e.origin === undefined),
      "the host's own events should carry no origin",
    );

    // Done: fanOut never ran more UI-engineer runs at once than the profile allows.
    const children = await host.sessions.list({ workflowRunId: run.id });
    const uiSessions = new Set(children.items.filter((item) => item.agentId === "ui-engineer").map((item) => item.sessionId));
    // An item refused by the profile is re-queued and opens a new session when it starts, so there can be more than three.
    assert(uiSessions.size >= TASKS.filter((task) => task.ui).length, `only ${uiSessions.size} UI sessions`);
    // A run refused with `profile_busy` starts and fails at once and is retried later, so only completed runs count.
    const uiEvents = agentEvents.filter((e) => e.sessionId !== undefined && uiSessions.has(e.sessionId));
    const admitted = new Set(uiEvents.filter((e) => e.type === "run.completed").map((e) => e.runId));
    let active = 0;
    let peak = 0;
    for (const event of uiEvents.filter((e) => e.runId !== undefined && admitted.has(e.runId))) {
      if (event.type === "run.started") peak = Math.max(peak, ++active);
      if (event.type === "run.completed") active -= 1;
    }
    assert(peak === PROFILE_CAP, `UI engineer peak concurrency ${peak}, expected the cap ${PROFILE_CAP} reached and not exceeded`);

    // Done: one search finds both an external agent's message and the host's, across the run's sessions.
    const externalHits = await host.sessions.search({ query: "UI task done", workflowRunId: run.id });
    const hosted = await host.sessions.search({ query: "Research", workflowRunId: run.id });
    assert(externalHits.items.length > 0 && hosted.items.length > 0, "build_workflow_session_search_spans_agents");

    assert(merged.length === TASKS.length, `merged ${merged.length} of ${TASKS.length} worktrees`);
    assert(readFileSync(join(repo, "task-6.txt"), "utf8").includes("UI task done"), "task 6 is not in the main tree");
    await parent.close();

    return {
      status: result.status,
      planGateRuns: planGate.length,
      humanGateAsked: ui.requestsOf("confirm").length,
      originAdapters: [...adapters].sort(),
      uiEngineerPeak: peak,
      profileCap: PROFILE_CAP,
      mergedWorktrees: merged.length,
      searchSpansAgents: true,
    };
  } finally {
    for (const cli of clis) cli.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
