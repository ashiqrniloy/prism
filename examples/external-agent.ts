/**
 * Phase 13 end to end, offline: an external agent driven through `@arnilo/prism/driver-kit`.
 *
 * The driver below is the template an adapter author copies. It names no vendor. Its binary is the scripted CLI
 * from `@arnilo/prism/testing`, which speaks the `jsonl-stream` dialect. The run shows, in order:
 *  - an account profile signed in through a terminal request, which runs the login command for real
 *  - a run under a replaced prompt with two bridged tools (called through the broker's MCP route), one materialized
 *    skill, thinking and text deltas, a skill activation, a nested sub-agent, and a steer during the run
 *  - a write gated through `prism relay` with a scripted HostUi, then a second write whose relay fails closed
 *    because the broker's socket is gone
 *  - a run suspended for approval and resumed with `allow_once`
 *  - a session search with `createSessionIndex`
 *  - the policy errors: `plan_login_not_permitted`, `profile_principal_mismatch`, and `profile_busy`
 * Imports only `@arnilo/prism`, `@arnilo/prism/driver-kit`, and `@arnilo/prism/testing`, plus Node built-ins.
 * Run: npm run build:core && bun examples/external-agent.ts
 * With `--conformance`, it runs `driverConformance` on the same driver for both reference dialects instead.
 */
import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  type AgentEvent,
  type AgentInput,
  type JsonObject,
  type JsonValue,
  type Message,
  type Skill,
  type ToolDefinition,
  createAgent,
  createMemorySessionStore,
  createSessionIndex,
} from "@arnilo/prism";
import {
  type CallbackBroker,
  type DriverRunContext,
  type HookCodec,
  type ToolBridge,
  buildChildEnv,
  bridgeTools,
  createCallbackBroker,
  createProfiles,
  createRunDirectory,
  defineDriver,
  driverPackage,
  effectsTable,
  materializeSkills,
  relayCommand,
  signalLadder,
} from "@arnilo/prism/driver-kit";
import {
  type ScriptStep,
  type ScriptedCli,
  type ScriptedDialect,
  createScriptedCli,
  createScriptedHostUi,
  driverConformance,
  jsonRpcDialect,
  jsonlStreamDialect,
} from "@arnilo/prism/testing";

/** The profile env var the login and status commands read. Its value is a path, never a credential. */
const HOME_ENV = "EXAMPLE_HOME";

type Agent = Awaited<ReturnType<typeof createAgent>>;

interface ExampleConfig {
  /** The driver's own config keys. The spec never carries them. */
  readonly binary: string;
  readonly args?: readonly string[];
}

/** What the driver reports back to the example, for the structured output. */
interface Evidence {
  readonly materialized: string[];
  readonly bridged: { name: string; value: unknown }[];
}

/**
 * The descriptor is the driver's declaration: what the vendor can do, what it reports, and how it signs in. The
 * kit checks `requires` against it, and the policy guard reads `auth` before every run.
 */
const descriptor = {
  vendor: "example",
  usesModel: false as const,
  models: "passthrough" as const,
  controls: {
    systemPrompt: ["replace" as const, "append" as const],
    builtinTools: "partial" as const,
    clientTools: "mcp" as const,
    skills: true,
    subagents: true,
    permissionCallback: true,
    rewrite: false,
    continueOnStop: true,
    steer: "mid-turn" as const,
    resume: "store" as const,
    isolation: "flags" as const,
  },
  capture: {
    textDeltas: true,
    thinking: "deltas" as const,
    skillActivation: "tool" as const,
    toolCalls: true,
    fileDiffs: true,
    subagents: "summary" as const,
    usage: "tokens" as const,
  },
  auth: {
    modes: [
      // A key mode needs no sign-in. `driverConformance` selects it, so the conformance legs need no account.
      { name: "key", kind: "api-key" as const, deployments: ["local" as const], protected: { paths: [".example/api-key"], env: [] } },
      {
        name: "account",
        kind: "account" as const,
        deployments: ["local" as const],
        // Protected paths and variables are never opened or read by the kit (the canary checks this).
        protected: { paths: [".example/credentials.json"], env: ["EXAMPLE_TOKEN"] },
        // `{binary}` is replaced by the probed binary. Login runs in the host's terminal; status is parsed, then dropped.
        login: ["{binary}", "-e", `require("node:fs").writeFileSync(process.env.${HOME_ENV} + "/signed-in", "ok")`],
        status: ["{binary}", "-e", `process.exit(require("node:fs").existsSync(process.env.${HOME_ENV} + "/signed-in") ? 0 : 1)`],
        homeEnv: HOME_ENV,
      },
    ],
  },
};

const tools: ToolDefinition[] = [
  {
    name: "lookup",
    description: "Looks up a note by key.",
    parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"] },
    effects: ["read"],
    execute: (args, context) => ({ toolCallId: context.toolCallId, name: "lookup", value: { key: String(args.key), found: true } }),
  },
  {
    name: "note",
    description: "Appends a note.",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    effects: ["write"],
    execute: (args, context) => ({ toolCallId: context.toolCallId, name: "note", value: { saved: String(args.text).length } }),
  },
];

type Parts = { readonly evidence: Evidence };

const reviewNotes: Skill = { name: "review-notes", description: "Review the notes before editing.", instructions: "Read the notes first." };

/** The effects the gate reports for each name. An unknown name gets every effect, so it is gated as the riskiest. */
const effectOf = effectsTable({ lookup: ["read"], note: ["write"], write_file: ["write"] });

/** Fresh parts for one agent: the evidence the driver reports. The tools and skills it bridges come from the run context. */
export function exampleParts(): Parts {
  return { evidence: { materialized: [], bridged: [] } };
}

/** The driver: a config schema, a status parser, and `start`, which probes the binary and runs one conversation. */
export function exampleDriver(parts: Parts = exampleParts(), dialect: ScriptedDialect = jsonlStreamDialect) {
  return defineDriver<ExampleConfig>({
    name: "example-driver",
    vendor: "example",
    revision: "1",
    descriptor,
    config: {
      type: "object",
      properties: { binary: { type: "string", minLength: 1 }, args: { type: "array", items: { type: "string" } } },
      required: ["binary"],
    },
    // The kit keeps only `signedIn`. The raw status output is parsed here and dropped.
    parseStatus: ({ exitCode }) => ({ signedIn: exitCode === 0 }),
    start: {
      probe: async (config) => ({ path: config.binary, version: "1.0.0" }),
      run: (context) => runAdapter(context, parts, dialect),
    },
  });
}

/** One run: a run directory, a callback broker, and the vendor process, closed in `finally` however the run ends. */
async function runAdapter(context: DriverRunContext<ExampleConfig>, parts: Parts, dialect: ScriptedDialect): Promise<void> {
  const { run, spec, lease } = context;
  if (lease === undefined) throw new Error("the adapter needs a profile lease");
  // The run directory holds the relay socket, so keep its name short (a Unix socket path must fit in 103 bytes).
  const runDir = await createRunDirectory(lease.home, randomUUID().slice(0, 8));
  try {
    if (spec.skills !== undefined) {
      // Skills are copied from the agent's registry into the run directory, never linked.
      const skills = await materializeSkills(runDir, context.skills, spec.skills);
      parts.evidence.materialized.push(...skills.pathToSkill.keys());
    }
    const broker = await createCallbackBroker(run, {
      runDir: runDir.path,
      hookCodec: gateCodec(effectOf),
      // Answered whenever the broker cannot: the relay prints this and the vendor must not proceed.
      failClosed: { exitCode: 2, stdout: '{"allow":false,"message":"prism relay is unavailable"}' },
      timeoutMs: 5000,
    });
    try {
      const bridge = bridgeTools(run, spec.prismTools ?? [], {
        origin: { kind: "external", agent: spec.name, agentId: spec.name, vendor: "example", depth: 0 },
        tools: context.tools,
      });
      broker.route("mcp", (request) => serveMcp(request, bridge, parts.evidence));
      await converse(context, broker, runDir.path, dialect);
    } finally {
      await broker.close();
    }
  } finally {
    await runDir.dispose();
  }
}

/**
 * The vendor's gate calls arrive as JSON on the relay's stdin. The codec turns each into a `pre-tool` request and
 * encodes the answer back. An approval that is pending comes back as a deny whose message says so.
 */
function gateCodec(effectOf: (name: string) => readonly ("read" | "write" | "execute" | "network" | "external")[]): HookCodec {
  return {
    decode(stdin) {
      const value = JSON.parse(stdin) as { kind?: string; id?: string; name?: string; args?: JsonValue };
      // Anything the codec does not recognize throws, and the broker answers fail-closed.
      if (value.kind !== "pre-tool" || value.id === undefined || value.name === undefined) throw new Error("unknown hook payload");
      return {
        kind: "pre-tool",
        request: { toolCallId: value.id, name: value.name, args: value.args ?? {}, effects: effectOf(value.name) },
      };
    },
    encode(answer) {
      if ("allow" in answer) {
        return answer.allow
          ? { exitCode: 0, stdout: '{"allow":true}' }
          : { exitCode: 2, stdout: JSON.stringify({ allow: false, message: answer.message }) };
      }
      if ("respond" in answer) return { exitCode: 0, stdout: JSON.stringify({ respond: answer.respond }) };
      return { exitCode: 0, stdout: "" };
    },
  };
}

/** Starts the vendor process, sends the input, maps its frames, and waits for the turn to end or the run to stop. */
async function converse(
  context: DriverRunContext<ExampleConfig>,
  broker: CallbackBroker,
  runDir: string,
  dialect: ScriptedDialect,
): Promise<void> {
  const { run, config, binary, descriptor: driverDescriptor } = context;
  // The vendor runs this command for each gate call, with the call as JSON on stdin. It is the relay, not a vendor script.
  const hookCommand = [...relayCommand(), "relay", "hook", "--run", runDir];
  const child = spawn(binary.path, [...(config.args ?? []), "--hook-command", JSON.stringify(hookCommand)], {
    stdio: ["pipe", "pipe", "pipe"],
    env: buildChildEnv({ base: process.env, modes: driverDescriptor.auth.modes }),
  }) as ChildProcessWithoutNullStreams;
  child.stdin.on("error", () => undefined);
  const write = (line: string) => child.stdin.write(`${line}\n`);

  let turnDone!: () => void;
  const turn = new Promise<"turn">((resolve) => (turnDone = () => resolve("turn")));
  const exited = new Promise<"exit">((resolve) => child.once("close", () => resolve("exit")));
  const aborted = new Promise<"abort">((resolve) => run.signal.addEventListener("abort", () => resolve("abort"), { once: true }));

  const handle = async (line: string): Promise<void> => {
    const output = dialect.parseFrame(line);
    if (output === undefined) return;
    if (output.kind === "hook") {
      // A dialect with client-side gating (`json-rpc`) sends each gate call as a request. Ask, then answer on stdin.
      const decision = await run.ask({
        toolCallId: output.call.id,
        name: output.call.tool,
        args: output.call.args,
        effects: effectOf(output.call.tool),
      });
      write(dialect.encodeInput({ kind: "answer", id: output.call.id, allow: "allow" in decision && decision.allow === true }));
      return;
    }
    const frame = output.frame;
    // `turn.done` is the only frame without a `kind`; every activity has one.
    if (!("kind" in frame)) {
      turnDone();
      return;
    }
    if (frame.kind === "raw" && frame.type === "mcp.call") {
      // A bridged-tool call. The vendor's MCP client would post it to the broker; the broker answers through the route.
      await callBridged(broker, frame.data);
      return;
    }
    await run.observe(frame);
  };
  // Frames are handled in order, one at a time, so a steer or an activity never overtakes the one before it.
  let queue: Promise<void> = Promise.resolve();
  createInterface({ input: child.stdout }).on("line", (line) => {
    queue = queue.then(() => handle(line)).catch(() => undefined);
  });

  void (async () => {
    for await (const message of run.steers()) write(dialect.encodeInput({ kind: "steer", text: messageText(message) }));
  })().catch(() => undefined);
  run.signal.addEventListener("abort", () => void signalLadder(child, { graceMs: 200 }), { once: true });

  write(dialect.encodeInput({ kind: "user", text: inputText(run.input) }));
  const outcome = await Promise.race([turn, exited, aborted]);
  if (outcome === "exit" && !run.signal.aborted) throw new Error("the vendor process exited before turn.done");
  child.stdin.end();
  await Promise.race([exited, sleep(2000)]);
  if (child.exitCode === null && child.signalCode === null) await signalLadder(child, { graceMs: 200 });
  await queue;
}

/** Posts one bridged call to the broker's MCP route, with the per-run bearer token. */
async function callBridged(broker: CallbackBroker, data: JsonValue): Promise<void> {
  const response = await fetch(`${broker.url}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${broker.token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: data }),
  });
  await response.text();
}

/** The MCP route: `tools/list` shows the bridged tools, `tools/call` runs one through `executeTools`, so `tool.call` fires. */
async function serveMcp(request: Request, bridge: ToolBridge, evidence: Evidence): Promise<Response> {
  const message = (await request.json()) as { id: string; method: string; params: { name: string; arguments: JsonObject } };
  if (message.method === "tools/list") return rpc(message.id, { tools: bridge.tools });
  const outcome = await bridge.invoke({
    type: "tool_call",
    id: message.id,
    name: message.params.name,
    arguments: message.params.arguments,
  });
  evidence.bridged.push({ name: message.params.name, value: outcome.value });
  return rpc(message.id, { value: outcome.value ?? null });
}

const rpc = (id: string, result: unknown): Response =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "content-type": "application/json" } });

/**
 * The scripted terminal runs the login command in the profile home, as a person would in a shell. The terminal's
 * output never reaches the kit; the answer carries only the exit code.
 */
function runLogin(command: readonly string[], env: Readonly<Record<string, string>>): { exitCode: number } {
  const [program = "", ...args] = command;
  return { exitCode: spawnSync(program, args, { env, encoding: "utf8" }).status ?? 1 };
}

/** A host UI: confirms every gate prompt, and runs the login command for a terminal request. */
const scriptedUi = () =>
  createScriptedHostUi((request) => {
    if (request.kind === "terminal") return runLogin(request.command, request.env ?? {});
    if (request.kind === "confirm") return true;
    return { status: "unavailable" as const };
  });

/** The main run: thinking and text, a skill, a sub-agent, two bridged calls, a gated write, a steer, and a fail-closed write. */
const MAIN_SCRIPT: ScriptStep[] = [
  { out: { kind: "message.delta", content: { type: "thinking", text: "Read the notes, then write them up." } } },
  { out: { kind: "message.delta", content: { type: "text", text: "Reading the notes." } } },
  { out: { kind: "skill", name: "review-notes", source: "tool", resolved: true } },
  { out: { kind: "subagent", phase: "started", id: "sub-1", name: "reviewer", parentToolCallId: "t-1" } },
  { out: { kind: "raw", vendor: "example", type: "mcp.call", data: { name: "lookup", arguments: { key: "readme" } } } },
  { out: { kind: "raw", vendor: "example", type: "mcp.call", data: { name: "note", arguments: { text: "reviewed" } } } },
  { hook: { tool: "write_file", id: "w-1", args: { path: "README.md" } } },
  { wait: 800 },
  { hook: { tool: "write_file", id: "w-2", args: { path: "CHANGELOG.md" }, breakBroker: true } },
  { out: { kind: "subagent", phase: "completed", id: "sub-1", result: "reviewed" } },
  { out: { kind: "message.delta", content: { type: "text", text: "Done." } } },
];

const RESUME_SCRIPT: ScriptStep[] = [{ hook: { tool: "write_file", id: "r-1", args: { path: "RESUME.md" } } }];
const FINAL_SCRIPT: ScriptStep[] = [{ out: { kind: "message.delta", content: { type: "text", text: "Written." } } }];
const BUSY_SCRIPT: ScriptStep[] = [{ wait: 800 }];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const eventName = (event: AgentEvent): string => (event.type === "package.event" ? event.name : event.type);
const messageText = (message: Message): string =>
  message.content.map((block) => ("text" in block && typeof block.text === "string" ? block.text : "")).join("");
const inputText = (input: AgentInput): string =>
  typeof input === "string" ? input : (Array.isArray(input) ? input : [input]).map(messageText).join("");
const codeOf = (result: { readonly error?: { readonly code?: string | number; readonly message: string } }): string | undefined =>
  result.error === undefined ? undefined : String(result.error.code ?? result.error.message);

export async function demo(): Promise<Record<string, unknown>> {
  const root = mkdtempSync(join(tmpdir(), "ex-"));
  const parts = exampleParts();
  const { evidence } = parts;
  const driver = exampleDriver(parts);
  const store = createMemorySessionStore();
  const ui = scriptedUi();
  const clis: ScriptedCli[] = [];

  /** One agent over the scripted CLI. Each agent gets its own binary, so each scenario's record is its own. */
  const agentFor = async (options: {
    readonly script: readonly ScriptStep[];
    readonly profile: string;
    readonly principal?: string;
    readonly deployment?: "local" | "hosted";
    readonly withUi: boolean;
  }): Promise<{ agent: Agent; cli: ScriptedCli }> => {
    const cli = createScriptedCli({ dialect: jsonlStreamDialect, script: options.script });
    clis.push(cli);
    const agent = await createAgent({
      id: "external-agent-demo",
      packages: [driverPackage(driver)],
      packageConfig: {
        [driver.name]: {
          binary: cli.command[0],
          args: cli.command.slice(1),
          name: "planner",
          profile: options.profile,
          profilesRoot: root,
          principal: options.principal ?? "u1",
          ...(options.deployment === undefined ? {} : { deployment: options.deployment }),
          systemPrompt: { replace: "You are the planner. Keep each edit small." },
          prismTools: ["lookup", "note"],
          skills: ["review-notes"],
          requires: { steer: "mid-turn", resume: "store", thinking: "deltas", skillActivation: true, subagents: true },
        },
      },
      ...(options.withUi ? { host: { ui: ui.ui } } : {}),
      slots: { store },
      // Every write asks the host. Without a UI the ask suspends the run, which the resume scenario relies on.
      hooks: (hooks) => hooks.on("tool.call", (call) => (call.name === "write_file" ? { ask: "Allow the write?" } : undefined)),
      tools: { add: [...tools] },
      skills: { add: [reviewNotes] },
    });
    return { agent, cli };
  };

  try {
    // Sign in: the profile is created, then `ensure` runs the login through the scripted terminal.
    // `binary` replaces `{binary}` in the login and status argv, as the driver package does with its probed path.
    const profiles = createProfiles({ root, driver, host: { ui: ui.ui }, binary: process.execPath });
    await profiles.create("me", { mode: "account", principal: "u1" });
    await profiles.ensure("me");
    const me = await profiles.read("me");

    // 1. The main run: deltas, a skill, a sub-agent, bridged tools, a gated write, a steer, and a fail-closed write.
    const main = await agentFor({ script: MAIN_SCRIPT, profile: "me", withUi: true });
    const session = await main.agent.session();
    const subscription = session.subscribe({ acrossRuns: true });
    const events: AgentEvent[] = [];
    const pump = (async () => {
      for await (const event of subscription) events.push(event);
    })();
    const running = session.run("Update the README and the changelog.");
    await sleep(300);
    session.steer("change course");
    const result = await running;
    await session.close();
    await pump.catch(() => undefined);

    const names = new Set(events.map(eventName));
    const hookResult = (id: string) =>
      main.cli.record().flatMap((entry) => (entry.event === "hook-result" && entry.id === id ? [entry] : []))[0];

    // 2. Suspension and resume: with no UI the gated write suspends. A new agent over the same store, as a new process
    //    would be, reopens the session and resumes it with `allow_once`. The resumed process has nothing left to gate.
    const gated = await agentFor({ script: RESUME_SCRIPT, profile: "me", withUi: false });
    const suspendedSession = await gated.agent.session();
    const first = await suspendedSession.run("Write the resume file.");
    const decisions = (first.pending ?? []).map((entry) => ({ approvalId: entry.approvalId, outcome: "allow_once" as const }));
    const finisher = await agentFor({ script: FINAL_SCRIPT, profile: "me", withUi: false });
    const reopened = await finisher.agent.session({ id: suspendedSession.id });
    const resumed: string[] = [];
    for await (const event of reopened.resume(decisions)) resumed.push(event.type);

    // 3. Search: the sessions this demo wrote, through the same store.
    const page = await createSessionIndex(store).search({ query: "README" });

    // 4. Policy: each refusal happens before the vendor process starts, so these scripts never run.
    const hosted = await agentFor({ script: [], profile: "me", deployment: "hosted", withUi: true });
    const hostedRun = await (await hosted.agent.session()).run("Hello");
    const other = await agentFor({ script: [], profile: "me", principal: "u2", withUi: true });
    const mismatch = await (await other.agent.session()).run("Hello");
    await profiles.create("busy", { mode: "account", principal: "u1", maxConcurrentRuns: 1 });
    await profiles.ensure("busy");
    const busy = await agentFor({ script: BUSY_SCRIPT, profile: "busy", withUi: true });
    const [firstBusy, secondBusy] = await Promise.all([
      busy.agent.session().then((s) => s.run("first")),
      busy.agent.session().then((s) => s.run("second")),
    ]);
    const busyResults = [firstBusy, secondBusy];

    return {
      signIn: { signedIn: me?.auth?.signedIn === true, terminalRuns: ui.requestsOf("terminal").length },
      main: {
        status: result.status,
        thinkingDeltas: events.some((event) => event.type === "message.delta" && event.content.type === "thinking"),
        textDeltas: events.some((event) => event.type === "message.delta" && event.content.type === "text"),
        skillActivation: names.has("agent.skill"),
        subagent: names.has("agent.subagent"),
        materializedSkills: [...new Set(evidence.materialized)],
        bridgedTools: evidence.bridged.map((call) => call.name),
        steered: main.cli.record().some((entry) => entry.event === "input" && entry.input.kind === "steer"),
        confirmRequests: ui.requestsOf("confirm").length,
        allowedWriteExit: hookResult("w-1")?.exitCode,
        failClosedExit: hookResult("w-2")?.exitCode,
      },
      resume: {
        suspended: first.status === "suspended",
        completed: resumed.at(-1) === "run.completed",
        gateEntries: gated.cli.record().filter((entry) => entry.event === "hook").length,
      },
      search: { hits: page.items.length, found: page.items.some((hit) => hit.sessionId === session.id) },
      policy: {
        hosted: codeOf(hostedRun),
        principal: codeOf(mismatch),
        busy: {
          completed: busyResults.filter((run) => run.status === "completed").length,
          refused: busyResults.map(codeOf).filter(Boolean),
        },
      },
    };
  } finally {
    for (const cli of clis) cli.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * `--conformance` runs `driverConformance` on this example's driver, once per reference dialect, and prints each
 * leg. The Phase 13 Done record cites this output; a test spawns it.
 */
async function conformance(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const dialect of [jsonlStreamDialect, jsonRpcDialect]) {
    // The key mode declares a protected path, so the canary leg runs; it reads no account and needs no sign-in.
    const result = await driverConformance(exampleDriver(exampleParts(), dialect), {
      dialect,
      fixtures: { mode: "key", config: (cli) => ({ binary: cli.command[0] ?? "", args: cli.command.slice(1) }) },
    });
    out[dialect.name] = result.legs;
  }
  return out;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(process.argv.includes("--conformance") ? await conformance() : await demo()));
}
