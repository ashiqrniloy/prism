import type { Readable, Writable } from "node:stream";
import { homedir } from "node:os";
import process from "node:process";
import { createAgent, createMockProvider, providerDone, providerTextDelta, resolveInstructionInjectors, createContributionRegistry } from "./index.js";
import type { AgentSession, AgentEvent, ContributionFileKind, InstructionInjector, ModelConfig, RunOptions, Skill, SystemPromptContribution } from "./contracts.js";
import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { createContributionRegistries, registerDiscoveredContributions } from "./contributions.js";
import { createSkillRegistry } from "./skills.js";
import { discoverContributions } from "./node/contribution-discovery.js";
import { registerDiscoveredInstructionInjectors } from "./node/instruction-injectors.js";
import { loadSystemPromptFiles } from "./node/system-project-prompts.js";
import { createPathTrustPolicy } from "./node/trust.js";
import { runRpcServer, type RpcSessionFactory } from "./rpc.js";

export type CliMode = "print" | "json" | "rpc";

export interface CliOptions {
  readonly mode: CliMode;
  readonly prompt?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly session?: string;
  readonly config: readonly string[];
  readonly resources: readonly string[];
  readonly extensions: readonly string[];
  readonly tools: readonly string[];
  readonly system?: string;
  readonly context: readonly string[];
  readonly compact?: number;
  readonly maxToolRounds?: number;
  readonly help: boolean;
  readonly discover: boolean;
  readonly discoverKinds: readonly ContributionFileKind[];
  readonly discoverGlobal: boolean;
  readonly noDiscovery: boolean;
  /** Runtime-populated (not a parsed flag): skills discovered by `--discover`,
   *  threaded into `createSession` so the bootstrap can build a SkillRegistry. */
  readonly discoveredSkills: readonly Skill[];
  /** Runtime-populated (not a parsed flag): instruction injectors discovered by
   *  `--discover`, selectable by name via `--instruction` (Task 8). */
  readonly discoveredInjectors: readonly InstructionInjector[];
  /** Parsed flag: `--instruction <name>` (repeatable). `false` disables injectors. */
  readonly instructions: readonly string[];
  /** Parsed flag: `--injector-file <path>` (repeatable); markdown → static injector. */
  readonly injectorFiles: readonly string[];
  /** Runtime-populated: `--instruction`/`--injector-file` resolved to live injectors. */
  readonly resolvedInstructionInjectors: readonly InstructionInjector[];
  /** Parsed flag: `--no-agents-md` / `--no-system-md` skip the corresponding auto-load. */
  readonly noAgentsMd: boolean;
  readonly noSystemMd: boolean;
  /** Parsed flag: `--agents-md-file <path>` / `--system-md-file <path>` override read paths. */
  readonly agentsMdFile?: string;
  readonly systemMdFile?: string;
  /** Runtime-populated: AGENTS.md/SYSTEM.md layers loaded from disk (print/json modes only;
  *  RPC is host-owned). Threaded into `AgentConfig.systemPrompt` by `defaultCreateSession`. */
  readonly systemPromptLayers: readonly SystemPromptContribution[];
}

export interface CliRuntime {
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
  readonly createSession?: (options: CliOptions) => AgentSession;
  readonly commands?: RpcSessionFactory["commands"];
  /** Workspace root for `--discover`. Defaults to `process.cwd()`. */
  readonly workspaceRoot?: string;
  /** Global root for `--discover-global`. Defaults to `os.homedir()`. */
  readonly globalRoot?: string;
}

export const usage = `Usage: prism [--mode print|json|rpc] [-p prompt] [options]

Options:
  -p, --prompt <text>        Prompt to run in print/json mode
  --provider <name>          Explicit provider id (mock is built in for smoke tests)
  --model <name>             Explicit model name
  --session <id>             Session id
  --config <path>            Explicit config path (recorded, not auto-loaded)
  --resource <uri>           Explicit resource URI (recorded, not auto-loaded)
  --extension <name>         Explicit extension name (recorded, not auto-loaded)
  --tool <name>              Explicit tool name (recorded, not auto-enabled)
  --system <text>            System instructions
  --context <text>           Context text
  --compact <entries>        Auto-compaction threshold
  --max-tool-rounds <n>      Maximum tool rounds
  --discover                 Enable workspace contribution discovery (opt-in)
  --discover-kinds <csv>     Kinds to discover (default: skill; skill,tool,context,instructions,agent)
  --discover-global          Also scan ~/.prism/agent/ (global root)
  --no-discovery             Disable discovery even if --discover is set
  --no-agents-md             Skip auto-loading <workspaceRoot>/AGENTS.md
  --no-system-md             Skip auto-loading ~/.prism/agent/SYSTEM.md
  --agents-md-file <path>    Read AGENTS.md from <path> instead (trust-gated, source: app)
  --system-md-file <path>    Read SYSTEM.md from <path> instead (source: user)
  -h, --help                 Show this help
`;

const valueFlags = new Set(["--prompt", "--mode", "--provider", "--model", "--session", "--config", "--resource", "--extension", "--tool", "--system", "--context", "--compact", "--max-tool-rounds", "--discover-kinds", "--instruction", "--injector-file", "--agents-md-file", "--system-md-file"]);
const boolFlags = new Set(["--discover", "--discover-global", "--no-discovery", "--no-agents-md", "--no-system-md"]);
const ALL_KINDS: readonly ContributionFileKind[] = ["skill", "tool", "context", "instructions", "agent"];

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let mode: CliMode = "print";
  let prompt: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  let session: string | undefined;
  let system: string | undefined;
  let compact: number | undefined;
  let maxToolRounds: number | undefined;
  let help = false;
  let discover = false;
  let discoverKinds: readonly ContributionFileKind[] = ["skill"];
  let discoverGlobal = false;
  let noDiscovery = false;
  let noAgentsMd = false;
  let noSystemMd = false;
  let agentsMdFile: string | undefined;
  let systemMdFile: string | undefined;
  const config: string[] = [];
  const resources: string[] = [];
  const extensions: string[] = [];
  const tools: string[] = [];
  const context: string[] = [];
  const instructions: string[] = [];
  const injectorFiles: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "-h" || flag === "--help") {
      help = true;
      continue;
    }
    const name = flag === "-p" ? "--prompt" : flag;
    if (boolFlags.has(name)) {
      switch (name) {
        case "--discover": discover = true; break;
        case "--discover-global": discoverGlobal = true; break;
        case "--no-discovery": noDiscovery = true; break;
        case "--no-agents-md": noAgentsMd = true; break;
        case "--no-system-md": noSystemMd = true; break;
      }
      continue;
    }
    if (!valueFlags.has(name)) throw new CliUsageError(`Unknown flag: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new CliUsageError(`Missing value for ${flag}`);
    i += 1;
    switch (name) {
      case "--prompt": prompt = value; break;
      case "--mode":
        if (value !== "print" && value !== "json" && value !== "rpc") throw new CliUsageError(`Invalid mode: ${value}`);
        mode = value;
        break;
      case "--provider": provider = value; break;
      case "--model": model = value; break;
      case "--session": session = value; break;
      case "--config": config.push(value); break;
      case "--resource": resources.push(value); break;
      case "--extension": extensions.push(value); break;
      case "--tool": tools.push(value); break;
      case "--system": system = value; break;
      case "--context": context.push(value); break;
      case "--compact": compact = positiveInt(value, flag); break;
      case "--max-tool-rounds": maxToolRounds = positiveInt(value, flag); break;
      case "--discover-kinds": discoverKinds = parseKinds(value, flag); break;
      case "--instruction": instructions.push(value); break;
      case "--injector-file": injectorFiles.push(value); break;
      case "--agents-md-file": agentsMdFile = value; break;
      case "--system-md-file": systemMdFile = value; break;
    }
  }

  return { mode, prompt, provider, model, session, config, resources, extensions, tools, system, context, compact, maxToolRounds, help, discover, discoverKinds, discoverGlobal, noDiscovery, discoveredSkills: [], discoveredInjectors: [], instructions, injectorFiles, resolvedInstructionInjectors: [], noAgentsMd, noSystemMd, agentsMdFile, systemMdFile, systemPromptLayers: [] };
}

function parseKinds(csv: string, flag: string): readonly ContributionFileKind[] {
  const kinds = csv.split(",").map((k) => k.trim()).filter(Boolean);
  if (kinds.length === 0) throw new CliUsageError(`Invalid value for ${flag}: ${csv}`);
  const invalid = kinds.filter((k) => !ALL_KINDS.includes(k as ContributionFileKind));
  if (invalid.length > 0) throw new CliUsageError(`Invalid kinds for ${flag}: ${invalid.join(", ")}`);
  return kinds as readonly ContributionFileKind[];
}

export async function runCli(argv: readonly string[], runtime: CliRuntime): Promise<number> {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    write(runtime.stderr, `${error instanceof Error ? error.message : String(error)}\n${usage}`);
    return 2;
  }

  if (options.help) {
    write(runtime.stdout, usage);
    return 0;
  }

  try {
    if (options.mode === "rpc") {
      await runRpcServer({ stdin: runtime.stdin, stdout: runtime.stdout, createSession: (id) => (runtime.createSession ?? defaultCreateSession)({ ...options, session: id ?? options.session }), commands: runtime.commands });
      return 0;
    }
    if (!options.prompt) throw new CliUsageError("Missing prompt: use -p or --prompt");
    const mode = options.mode;
    // ponytail: discovery is opt-in. --no-discovery hard-disables; default runs never touch the FS.
    // Registering all kinds honors the plan (tool/context/agent descriptors registered),
    // but only skills are wired into the mock agent here — other kinds are host-owned execution.
    let discoveredSkills = options.discoveredSkills;
    let discoveredInjectors = options.discoveredInjectors;
    if (options.discover && !options.noDiscovery) {
      const discovered = await discoverContributions({
        kinds: options.discoverKinds,
        workspaceRoot: runtime.workspaceRoot ?? process.cwd(),
        ...(options.discoverGlobal ? { globalRoot: runtime.globalRoot ?? homedir() } : {}),
      });
      const registries = createContributionRegistries();
      registerDiscoveredContributions(registries, discovered);
      discoveredSkills = registries.skills.list();
      // ponytail: Phase 30 — discovered instruction injectors register host-owned (no core auto-import).
      await registerDiscoveredInstructionInjectors(registries, discovered);
      discoveredInjectors = registries.instructionInjectors.list();
      options = { ...options, discoveredSkills, discoveredInjectors };
    }
    // ponytail: Phase 30 — resolve --instruction names against discovered injectors (fail-closed)
    // and load --injector-file markdown as static injectors. `--instruction false` disables all.
    const resolvedInstructionInjectors = options.instructions.includes("false")
      ? []
      : await resolveCliInjectors(options.instructions, options.injectorFiles, discoveredInjectors);
    options = { ...options, resolvedInstructionInjectors };
    // ponytail: Phase 31 — auto-load AGENTS.md (trust-gated, source: app) and ~/.prism/agent/SYSTEM.md
    // (user-owned, source: user) as systemPrompt layers composed on top of `--system` (base/instructions).
    // RPC mode skips auto-load: host owns the session factory and is responsible for its own layers.
    if (options.mode !== "rpc") {
      const workspaceRoot = runtime.workspaceRoot ?? process.cwd();
      // ponytail: explicit --agents-md-file opt-in → trust its parent dir too so the named file passes
      // the containment check (the user named it, so it's trusted by that act).
      const trustedRoots = options.agentsMdFile ? [workspaceRoot, dirname(options.agentsMdFile)] : [workspaceRoot];
      const trust = createPathTrustPolicy({ trustedRoots });
      const layers = await loadSystemPromptFiles({
        ...(options.noAgentsMd ? {} : { workspaceRoot, trust, ...(options.agentsMdFile ? { agentsMdPath: options.agentsMdFile } : {}) }),
        ...(options.noSystemMd ? {} : { globalRoot: runtime.globalRoot ?? homedir(), ...(options.systemMdFile ? { systemMdPath: options.systemMdFile } : {}) }),
      });
      options = { ...options, systemPromptLayers: layers };
    }
    const session = (runtime.createSession ?? defaultCreateSession)(options);
    await runPromptMode(session, options, runtime.stdout, mode);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof CliUsageError) {
      write(runtime.stderr, `${message}\n${usage}`);
      return 2;
    }
    if (options.mode === "json") write(runtime.stdout, `${JSON.stringify({ type: "error", error: { message } })}\n`);
    else write(runtime.stderr, `${message}\n`);
    return 1;
  }
}

export async function runPromptMode(session: AgentSession, options: CliOptions, stdout: Writable, mode: "print" | "json"): Promise<void> {
  const events = (async () => {
    for await (const event of session.subscribe()) {
      if (mode === "json") write(stdout, `${JSON.stringify({ type: "event", sessionId: event.sessionId, runId: "runId" in event ? event.runId : undefined, event })}\n`);
      else if (event.type === "message_delta" && event.content.type === "text") write(stdout, event.content.text);
    }
  })();
  await session.run(options.prompt ?? "", runOptions(options));
  await events;
}

export class CliUsageError extends Error {}

function defaultCreateSession(options: CliOptions): AgentSession {
  if (options.provider !== "mock") throw new CliUsageError("No provider configured. Pass --provider mock for a smoke test or embed Prism with an explicit provider.");
  const model: ModelConfig = { provider: "mock", model: options.model ?? "mock" };
  return createAgent({
    model,
    provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
    instructions: options.system,
    // ponytail: Phase 31 — file layers compose with `instructions` (base) via the existing
    // composeSystemPrompt pipeline; rank order (user<package<app<run) is enforced inside.
    ...(options.systemPromptLayers.length > 0 ? { systemPrompt: options.systemPromptLayers } : {}),
    // ponytail: discovered skills become selectable via RunOptions.activeSkills (set by runOptions below).
    ...(options.discoveredSkills.length > 0 ? { skills: createSkillRegistry(options.discoveredSkills) } : {}),
  }).createSession({ id: options.session });
}

function runOptions(options: CliOptions): RunOptions {
  return {
    maxToolRounds: options.maxToolRounds,
    compaction: options.compact ? { thresholdEntries: options.compact } : undefined,
    // ponytail: --discover is the explicit opt-in that activates discovered skills.
    ...(options.discover && !options.noDiscovery && options.discoveredSkills.length > 0
      ? { activeSkills: options.discoveredSkills.map((s) => s.name) }
      : {}),
    ...(options.resolvedInstructionInjectors.length > 0
      ? { instructionInjectors: options.resolvedInstructionInjectors }
      : {}),
  };
}

// ponytail: resolve --instruction names against discovered injectors (fail-closed) and load
// --injector-file markdown files as static every_turn injectors. Names route through
// resolveInstructionInjectors so an unknown name throws (caught by runCli's error handler).
async function resolveCliInjectors(
  names: readonly string[],
  files: readonly string[],
  discovered: readonly InstructionInjector[],
): Promise<readonly InstructionInjector[]> {
  const registry = createContributionRegistry<InstructionInjector>({ label: "instruction injector" });
  for (const inj of discovered) registry.register(inj.name, inj);
  const byName = names.length ? resolveInstructionInjectors({ registry, names }) : [];
  const fromFiles: InstructionInjector[] = [];
  for (const path of files) {
    const text = await readFile(path, "utf8");
    fromFiles.push({
      name: basename(path).replace(/\.[^.]+$/, ""),
      apply: () => ({ instructions: text, when: "every_turn" }),
    });
  }
  return [...byName, ...fromFiles];
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new CliUsageError(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function write(stream: Writable, text: string): void {
  stream.write(text);
}
