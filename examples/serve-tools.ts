/**
 * Phase 14 end to end, offline: serving a run's tools to an external agent's own loop.
 *
 * The driver below is the template an adapter author copies for Phase 15. It names no vendor. It runs inside one
 * `session.run` and, for that run's session, it:
 *  - binds a git worktree through the `workspace` service, and materializes the vendor's MCP configuration into
 *    that worktree with `excludeOverlay`, so the file is git-excluded and never reaches a diff or a commit
 *  - serves `read` and `edit` from `@arnilo/prism-tools-coding`, plus the permission tool, with `serveTools`
 *  - runs the vendor binary (the scripted CLI from `@arnilo/prism/testing`, `jsonl-stream` dialect) over
 *    `loopback-http` first and `stdio-relay` second, handing it the endpoint as `--mcp-endpoint`
 *  - closes the served handle and runs the vendor again, to show a call after `close()` is refused
 * The run shows, in order:
 *  - an allowed `edit`, which changes the file in the worktree because the session is bound to it (Task 7)
 *  - a declined `edit` under `@arnilo/prism-approval` in `ask` mode, whose deny text reaches the vendor
 *  - the permission tool's deny and allow, each one `run.ask` that never executes anything
 *  - a tool outside the allow list, which the vendor cannot see
 *  - the worktree diff, which lists the edit and not the overlay, and a conflicting merge, reported unresolved
 * Imports only `@arnilo/prism`, `@arnilo/prism/driver-kit`, `@arnilo/prism/testing`, `@arnilo/prism-mcp-server`,
 * `@arnilo/prism-tools-coding`, `@arnilo/prism-approval`, and Node built-ins.
 * Run: npm run build:core && bun examples/serve-tools.ts
 */
import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  type AgentEvent,
  type EventOrigin,
  type JsonValue,
  type PackageInstance,
  type RunController,
  createAgent,
  createMemorySessionStore,
  definePackage,
} from "@arnilo/prism";
import {
  type DriverBinary,
  type DriverRunContext,
  type HookCodec,
  type McpEndpoint,
  buildChildEnv,
  createCallbackBroker,
  createProfiles,
  createRunDirectory,
  defineDriver,
  driverPackage,
  relayCommand,
  signalLadder,
} from "@arnilo/prism/driver-kit";
import {
  type ScriptStep,
  type ScriptedCli,
  type ScriptedRecordEntry,
  createScriptedCli,
  createScriptedHostUi,
  jsonlStreamDialect,
} from "@arnilo/prism/testing";
import { type ServeToolsTransport, serveTools } from "@arnilo/prism-mcp-server";
import approval from "@arnilo/prism-approval";
import toolsCoding, { type WorkspaceService } from "@arnilo/prism-tools-coding";

/** The vendor's MCP configuration, written into the worktree and excluded from git. */
const MCP_CONFIG = ".mcp.json";
/** The tracked file the vendor edits. The driver re-seeds it per leg, so both legs start from the same worktree. */
const EDITED_FILE = "a.txt";
/** The origin every served call is attributed to; it rides each `tool.*` event the call emits. */
const ORIGIN: EventOrigin = { kind: "external", agent: "vendor-loop", agentId: "vendor-loop", vendor: "example", depth: 0 };
/** The broker's answer when a relay frame arrives and the route cannot: the vendor must not proceed. */
const FAIL_CLOSED = { exitCode: 2, stdout: '{"allow":false,"message":"prism relay is unavailable"}' };
/** This vendor gates through the served permission tool, not the relay, so no hook frame is expected. */
const NO_HOOKS: HookCodec = { decode: () => ({ kind: "stop" }), encode: () => FAIL_CLOSED };
/** A stable identity for git in the fixture, so no user-level configuration is read. */
const GIT_ENV = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" };

type Agent = Awaited<ReturnType<typeof createAgent>>;

interface DriverConfig {
  /** The driver's own config keys. The spec never carries them. */
  readonly binary: string;
  readonly args?: readonly string[];
}

/** What the vendor's own loop asks the served tools to do, in order. */
const VENDOR_SCRIPT: readonly ScriptStep[] = [
  // What the vendor can see: the allow list in order, then the permission tool.
  { mcp: { method: "tools/list" } },
  // An allowed edit. `@arnilo/prism-approval` asks the host; the host approves once, and the file changes.
  { mcp: { method: "tools/call", params: { name: "edit", arguments: { path: "a.txt", edits: [{ oldText: "one", newText: "served" }] } } } },
  // A read is allowed without a prompt, so it costs no host request.
  { mcp: { method: "tools/call", params: { name: "read", arguments: { path: "a.txt" } } } },
  // A declined edit: the host says no, and the deny text reaches the vendor as the tool result.
  {
    mcp: { method: "tools/call", params: { name: "edit", arguments: { path: "a.txt", edits: [{ oldText: "served", newText: "again" }] } } },
  },
  // The permission tool: the vendor asks, Prism decides through the same gate, and nothing is executed.
  { mcp: { method: "tools/call", params: { name: "permission", arguments: { toolName: "shell", input: { command: "cat secrets" } } } } },
  { mcp: { method: "tools/call", params: { name: "permission", arguments: { toolName: "shell", input: { command: "ls" } } } } },
  // A tool outside the allow list is not served at all, so the call is a JSON-RPC error.
  { mcp: { method: "tools/call", params: { name: "delete", arguments: { path: "a.txt" } } } },
];

/** The driver's descriptor: what the vendor can enforce and capture. The kit checks `requires` against it. */
const descriptor = {
  vendor: "example",
  usesModel: false as const,
  models: "passthrough" as const,
  controls: {
    systemPrompt: [] as readonly ("replace" | "append")[],
    builtinTools: "none" as const,
    clientTools: "mcp" as const,
    skills: false,
    subagents: false,
    permissionCallback: true,
    rewrite: false,
    continueOnStop: false,
    steer: "none" as const,
    resume: "none" as const,
    isolation: "none" as const,
  },
  capture: {
    textDeltas: false,
    thinking: "none" as const,
    skillActivation: "none" as const,
    toolCalls: true,
    fileDiffs: false,
    subagents: "none" as const,
    usage: "none" as const,
  },
  auth: {
    // A key mode needs no sign-in, so the example runs offline with no account and no terminal request.
    modes: [{ name: "key", kind: "api-key" as const, deployments: ["local" as const], protected: { paths: [], env: [] } }],
  },
};

/** One served leg, as the example reports it. `env` holds the bearer token's *name*, never its value. */
interface ServedLeg {
  readonly transport: ServeToolsTransport;
  readonly tools: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/** What the driver learned about the worktree, the diff, and the merge, for the example's output. */
interface Evidence {
  readonly served: ServedLeg[];
  worktree?: { readonly path: string; readonly branch: string; readonly base: string };
  overlay?: { readonly path: string; readonly excluded: boolean };
  diff?: { readonly changes: readonly string[]; readonly truncated: boolean };
  merge?: { readonly status: string; readonly files: readonly string[]; readonly worktreeUnchanged: boolean };
  worktreeFile?: string;
}

/** What the driver needs from the example: the package's service, the repository, and where to report. */
interface DriverDeps {
  readonly workspace: () => WorkspaceService | undefined;
  readonly repo: string;
  readonly evidence: Evidence;
}

/** The driver: a config schema, a status parser, and `start`, which probes the binary and serves it tools. */
export function exampleDriver(deps: DriverDeps) {
  return defineDriver<DriverConfig>({
    name: "serve-tools-example",
    vendor: "example",
    revision: "1",
    descriptor,
    config: {
      type: "object",
      properties: { binary: { type: "string", minLength: 1 }, args: { type: "array", items: { type: "string" } } },
      required: ["binary"],
    },
    parseStatus: () => ({ signedIn: true }),
    start: {
      probe: async (config) => ({ path: config.binary, version: "1.0.0" }),
      run: (context) => runAdapter(context, deps),
    },
  });
}

/** One run: a run directory, a callback broker, one bound worktree, and two served legs, closed in `finally`. */
async function runAdapter(context: DriverRunContext<DriverConfig>, deps: DriverDeps): Promise<void> {
  const { run, lease, binary, config } = context;
  if (lease === undefined) throw new Error("the example driver needs a profile lease");
  const workspace = deps.workspace();
  if (workspace === undefined) throw new Error("no workspace service: the package root must be inside a git repository");
  // The run directory holds the relay socket, so keep its name short (a Unix socket path must fit in 103 bytes).
  const runDir = await createRunDirectory(lease.home, randomUUID().slice(0, 8));
  try {
    const broker = await createCallbackBroker(run, { runDir: runDir.path, hookCodec: NO_HOOKS, failClosed: FAIL_CLOSED, timeoutMs: 5000 });
    try {
      // One worktree for this run's session. Task 7's routing makes this session's coding tools run inside it.
      const worktree = await workspace.worktree.create({ sessionId: run.session.id });
      deps.evidence.worktree = { path: worktree.path, branch: worktree.branch, base: worktree.base };
      try {
        // Both legs must start from the same worktree, so each one re-seeds the file the vendor edits.
        const seed = readFileSync(join(worktree.path, EDITED_FILE), "utf8");
        for (const transport of ["loopback-http", "stdio-relay"] as const) {
          writeFileSync(join(worktree.path, EDITED_FILE), seed);
          const served = await serveTools(run, {
            broker,
            // The definitions are the agent's own registered tools; only the allow list is exposed.
            tools: context.tools,
            allow: ["read", "edit"],
            transport,
            origin: ORIGIN,
            permissionTool: { name: "permission" },
            ...(transport === "stdio-relay" ? { relay: { command: relayCommand() } } : {}),
          });
          // The vendor reads its MCP configuration from the worktree. Prism writes it there and excludes it from git.
          await workspace.excludeOverlay(worktree.path, [
            { path: MCP_CONFIG, content: JSON.stringify({ mcpServers: { prism: served.endpoint } }, null, 2) },
          ]);
          deps.evidence.served.push({ transport, tools: served.tools, env: redact(served.env) });
          try {
            await driveVendor(run, binary, config, served.endpoint, served.env);
            await served.close();
            // The route is gone, but the vendor still knows the endpoint: the next call is refused.
            await driveVendor(run, binary, config, served.endpoint, served.env);
          } finally {
            await served.close();
          }
        }

        deps.evidence.worktreeFile = readFileSync(join(worktree.path, EDITED_FILE), "utf8").trim();
        const { changes, truncated } = await workspace.diff(worktree.path);
        deps.evidence.diff = { changes: changes.map((change) => `${change.change} ${change.path}`), truncated };
        deps.evidence.overlay = {
          path: MCP_CONFIG,
          // The file is on disk in the worktree, and no diff line names it.
          excluded: existsSync(join(worktree.path, MCP_CONFIG)) && !changes.some((change) => change.path === MCP_CONFIG),
        };

        // A conflicting change on the target branch, so the merge has something to report and nothing to resolve.
        writeFileSync(join(deps.repo, EDITED_FILE), "a conflicting change on main\n");
        git(deps.repo, ["commit", "-am", "conflicting change"]);
        const merged = await workspace.merge(worktree.path, { into: "main", commit: { message: "serve-tools example merge" } });
        deps.evidence.merge =
          merged.status === "conflict"
            ? {
                status: merged.status,
                files: merged.files,
                worktreeUnchanged: readFileSync(join(worktree.path, EDITED_FILE), "utf8").trim() === deps.evidence.worktreeFile,
              }
            : { status: merged.status, files: [], worktreeUnchanged: false };
      } finally {
        // The worktree is dirty after a reported conflict, and the branch was never merged.
        await worktree.dispose({ force: true });
      }
    } finally {
      await broker.close();
    }
  } finally {
    await runDir.dispose();
  }
}

/** Spawns the vendor binary against one served endpoint and waits for its turn to end. */
async function driveVendor(
  run: RunController,
  binary: DriverBinary,
  config: DriverConfig,
  endpoint: McpEndpoint,
  env: Readonly<Record<string, string>>,
): Promise<void> {
  const child = spawn(binary.path, [...(config.args ?? []), "--mcp-endpoint", JSON.stringify(endpoint)], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...buildChildEnv({ base: process.env, modes: descriptor.auth.modes }), ...env },
  }) as ChildProcessWithoutNullStreams;
  child.stdin.on("error", () => undefined);

  let turnDone!: () => void;
  const turn = new Promise<"turn">((resolve) => (turnDone = () => resolve("turn")));
  const exited = new Promise<"exit">((resolve) => child.once("close", () => resolve("exit")));
  const aborted = new Promise<"abort">((resolve) => run.signal.addEventListener("abort", () => resolve("abort"), { once: true }));

  createInterface({ input: child.stdout }).on("line", (line) => {
    const output = jsonlStreamDialect.parseFrame(line);
    if (output === undefined) return;
    // A client-gated hook call is not this example's path; a real adapter would answer it through `run.ask`.
    if (output.kind === "hook") return;
    // `turn.done` is the only frame without a `kind`. A real adapter also maps activity frames through `run.observe`.
    if (!("kind" in output.frame)) turnDone();
  });

  child.stdin.write(`${jsonlStreamDialect.encodeInput({ kind: "user", text: "Serve the tools to the vendor." })}\n`);
  const outcome = await Promise.race([turn, exited, aborted]);
  if (outcome === "exit" && !run.signal.aborted) throw new Error("the vendor process exited before turn.done");
  child.stdin.end();
  await Promise.race([exited, sleep(2000)]);
  if (child.exitCode === null && child.signalCode === null) await signalLadder(child, { graceMs: 200 });
}

/** Reads the package's `workspace` service once the packages are set up, so the driver can bind a worktree. */
function workspaceProbe(): { readonly package: PackageInstance; readonly service: () => WorkspaceService | undefined } {
  let service: WorkspaceService | undefined;
  const instance = definePackage({
    name: "example-workspace-probe",
    version: "1.0.0",
    requires: { api: 1 },
    setup: ({ services }) => {
      service = services.consume<WorkspaceService>("workspace");
    },
  })();
  return { package: instance, service: () => service };
}

/** The served environment with every value masked: a token is never printed, only the variable that carries it. */
function redact(env: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.keys(env).map((name) => [name, "[redacted]"]));
}

/** One process run of the scripted CLI: every run starts with an `argv` entry, so a record splits into runs. */
function runs(cli: ScriptedCli): readonly (readonly ScriptedRecordEntry[])[] {
  const groups: ScriptedRecordEntry[][] = [];
  for (const entry of cli.record()) {
    if (entry.event === "argv") groups.push([]);
    groups.at(-1)?.push(entry);
  }
  return groups;
}

const callsOf = (run: readonly ScriptedRecordEntry[]) => run.filter((entry) => entry.event === "mcp");
const resultOf = (entry: ScriptedRecordEntry | undefined): JsonValue | undefined =>
  entry !== undefined && "result" in entry ? entry.result : undefined;
const refused = (entry: ScriptedRecordEntry | undefined): boolean => entry !== undefined && "error" in entry;
/** The MCP result's own error flag: a denied or failed tool call is a result, not a JSON-RPC error. */
const isErrorOf = (entry: ScriptedRecordEntry | undefined): boolean =>
  (resultOf(entry) as { readonly isError?: boolean } | undefined)?.isError === true;

/** The text of an MCP `tools/call` result, joined across its text blocks. */
function resultText(result: JsonValue | undefined): string {
  const blocks = (result as { readonly content?: readonly { readonly text?: string }[] } | undefined)?.content ?? [];
  return blocks.map((block) => block.text ?? "").join("");
}

/** The tool names in a `tools/list` result. */
function listedNames(result: JsonValue | undefined): readonly string[] {
  const tools = (result as { readonly tools?: readonly { readonly name?: string }[] } | undefined)?.tools ?? [];
  return tools.map((tool) => tool.name ?? "");
}

/** The neutral permission decision a permission-tool result carries as JSON text. */
function decisionOf(entry: ScriptedRecordEntry | undefined): string {
  return (JSON.parse(resultText(resultOf(entry)) || "{}") as { readonly behavior?: string }).behavior ?? "none";
}

interface LegEvidence {
  readonly transport: string;
  readonly tools: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly listed: readonly string[];
  readonly allowedEdit: { readonly isError: boolean; readonly replaced: boolean };
  readonly read: { readonly isError: boolean; readonly text: string };
  readonly declinedEdit: { readonly isError: boolean; readonly denied: boolean };
  readonly permission: { readonly denied: string; readonly allowed: string };
  readonly outsideAllowList: { readonly refused: boolean };
  readonly afterClose: { readonly refused: boolean };
}

/** One leg's evidence, read from the two runs the driver made: while served, then after `close()`. */
function legEvidence(served: ServedLeg, main: readonly ScriptedRecordEntry[], late: readonly ScriptedRecordEntry[]): LegEvidence {
  const calls = callsOf(main);
  // The vendor's script fixes this order: list, edit, read, declined edit, denied permission, allowed permission, unserved name.
  const [, list, edit, read, declined, denied, allowed, outside] = calls;
  return {
    transport: served.transport,
    tools: served.tools,
    env: served.env,
    listed: listedNames(resultOf(list)),
    allowedEdit: { isError: isErrorOf(edit), replaced: /Edited .*: 1 block\(s\)/.test(resultText(resultOf(edit))) },
    read: { isError: isErrorOf(read), text: resultText(resultOf(read)).trim() },
    declinedEdit: { isError: isErrorOf(declined), denied: /denied/.test(resultText(resultOf(declined))) },
    permission: { denied: decisionOf(denied), allowed: decisionOf(allowed) },
    // The unserved name never reaches the run: the call is a JSON-RPC error, not a tool result.
    outsideAllowList: { refused: refused(outside) },
    afterClose: { refused: refused(callsOf(late)[0]) },
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs one git command in the fixture repository, failing loudly. */
function git(cwd: string, args: readonly string[]): void {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", env: GIT_ENV });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

export async function demo(): Promise<Record<string, unknown>> {
  const base = mkdtempSync(join(tmpdir(), "ex-serve-"));
  const repo = join(base, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q", "-b", "main", "."]);
  git(repo, ["config", "user.name", "Prism Example"]);
  git(repo, ["config", "user.email", "example@prism.local"]);
  writeFileSync(join(repo, "a.txt"), "one\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-qm", "seed"]);

  const vendor = createScriptedCli({ dialect: "jsonl-stream", script: VENDOR_SCRIPT });
  const probe = workspaceProbe();
  const evidence: Evidence = { served: [] };
  const driver = exampleDriver({ workspace: probe.service, repo, evidence });

  // A scripted terminal answers the gate prompts. Every select is `once`; the vendor's second edit per run is
  // declined, and so is the permission tool's read of a secret, so one run shows both an allow and a deny.
  let edits = 0;
  const scriptedUi = createScriptedHostUi((request) => {
    if (request.kind === "select") return "once";
    if (request.kind !== "confirm") return { status: "unavailable" };
    const detail = request.detail ?? "";
    if (detail.startsWith("shell ")) return !detail.includes("secrets");
    edits += 1;
    return edits % 2 === 1;
  });

  const profiles = createProfiles({ root: join(base, "profiles"), driver, host: { ui: scriptedUi.ui }, binary: process.execPath });
  try {
    await profiles.create("example", { mode: "key", principal: "u1" });
    const agent: Agent = await createAgent({
      id: "serve-tools-example",
      ownership: { tenantId: "example" },
      principal: { kind: "user", id: "u1" },
      packages: [
        driverPackage(driver),
        toolsCoding({ root: repo, workspace: { worktreeRoot: join(base, "worktrees") } }),
        approval({ mode: "ask" }),
        probe.package,
      ],
      packageConfig: {
        [driver.name]: {
          binary: vendor.command[0] as string,
          args: vendor.command.slice(1),
          name: "vendor-loop",
          profile: "example",
          profilesRoot: join(base, "profiles"),
          principal: "u1",
        },
      },
      host: { ui: scriptedUi.ui },
      slots: { store: createMemorySessionStore() },
    });

    const session = await agent.session();
    const events: AgentEvent[] = [];
    const pump = (async () => {
      for await (const event of session.subscribe()) events.push(event);
    })();
    const result = await session.run("Serve the tools to the vendor.");
    await session.close();
    await pump.catch(() => undefined);

    const groups = runs(vendor);
    const legs = evidence.served.map((served, index) => legEvidence(served, groups[index * 2] ?? [], groups[index * 2 + 1] ?? []));
    const origins = events.filter((event) => event.origin !== undefined);
    return {
      status: result.status,
      worktree: { branch: evidence.worktree?.branch, base: evidence.worktree?.base },
      worktreeFile: evidence.worktreeFile,
      overlay: evidence.overlay,
      diff: evidence.diff,
      merge: evidence.merge,
      http: legs[0],
      stdio: legs[1],
      origins: {
        types: [...new Set(origins.map((event) => event.type))].sort(),
        vendor: origins[0]?.origin?.vendor,
        kind: origins[0]?.origin?.kind,
        depth: origins[0]?.origin?.depth,
      },
      prompts: { confirm: scriptedUi.requestsOf("confirm").length, select: scriptedUi.requestsOf("select").length },
    };
  } finally {
    vendor.dispose();
    rmSync(base, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await demo()));
}
