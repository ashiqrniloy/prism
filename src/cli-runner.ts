import type { Readable, Writable } from "node:stream";
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "./index.js";
import type { AgentSession, AgentEvent, ModelConfig, RunOptions } from "./contracts.js";
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
}

export interface CliRuntime {
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
  readonly createSession?: (options: CliOptions) => AgentSession;
  readonly commands?: RpcSessionFactory["commands"];
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
  -h, --help                 Show this help
`;

const valueFlags = new Set(["--prompt", "--mode", "--provider", "--model", "--session", "--config", "--resource", "--extension", "--tool", "--system", "--context", "--compact", "--max-tool-rounds"]);

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
  const config: string[] = [];
  const resources: string[] = [];
  const extensions: string[] = [];
  const tools: string[] = [];
  const context: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "-h" || flag === "--help") {
      help = true;
      continue;
    }
    const name = flag === "-p" ? "--prompt" : flag;
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
    }
  }

  return { mode, prompt, provider, model, session, config, resources, extensions, tools, system, context, compact, maxToolRounds, help };
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
    const session = (runtime.createSession ?? defaultCreateSession)(options);
    await runPromptMode(session, options, runtime.stdout, options.mode);
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
  return createAgent({ model, provider: createMockProvider([providerTextDelta("Hello"), providerDone()]), instructions: options.system }).createSession({ id: options.session });
}

function runOptions(options: CliOptions): RunOptions {
  return {
    maxToolRounds: options.maxToolRounds,
    compaction: options.compact ? { thresholdEntries: options.compact } : undefined,
  };
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new CliUsageError(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function write(stream: Writable, text: string): void {
  stream.write(text);
}
