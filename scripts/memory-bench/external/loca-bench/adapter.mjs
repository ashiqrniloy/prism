/**
 * Plan 218.1 Task 4: LOCA-Bench with Prism as the scaffold under test.
 *
 * One Prism agent per task instance. The instance (task prompt, mock MCP servers, evaluator, seed) is LOCA-Bench's,
 * served unchanged by `seam.py`, a sidecar running upstream's own environment, `MCPTool` and episode wrapper. The
 * plug-in point is the sidecar, not Prism's MCP bridge: upstream scores the end state with `env.step()` on the
 * environment object that generated the instance, inside the Python process that holds it, and upstream's `MCPTool`
 * shapes every tool's output text. Bridging the servers into Prism would rebuild both, so each Prism tool forwards its
 * call to the sidecar instead, and the sidecar answers with upstream's own observation.
 *
 * Arms differ only in context management: the memory packages come from `armMemory`
 * (`../../work-outcome/long-session.mjs`) at the package defaults, the same call gate M-2's long-horizon family makes.
 * The budget B is the model's context window (`limits.contextWindow`), with LOCA's output reservation
 * (`maxOutputTokens`) taken from it as LOCA's ReAct loop does with `--max-context-size` and `--max-tokens`; compaction
 * then fires from the arm's own trigger (the kernel's at 80% of the input cap for memory-off and fold, the memory
 * system's `compactAt` ratio for STM-only and WM, `SHIPPED_COMPACT_AT_RATIO` for llm-summary).
 *
 * `loca-react` is the calibration arm: upstream's own ReAct loop (`seam.py react`), unmodified, on the same model.
 *
 * Evidence holds ids, counts, rewards and hashes only: no prompt, tool output, model text or memory text.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createAgent, createMemorySessionStore, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { armMemory, longSessionWmStats, meteredLongSessionProviders } from "../../work-outcome/long-session.mjs";

export const SEAM_PATH = new URL("./seam.py", import.meta.url).pathname;
/** LOCA-Bench's environment-length presets (`task-configs/final_<preset>_set_config.json`). */
export const LOCA_PRESETS = Object.freeze(["8k", "16k", "32k", "64k", "96k", "128k", "256k"]);
/** The five seeds every preset repeats per task, in config order; a seed's ordinal (1–5) names the partition. */
export const LOCA_SEEDS = Object.freeze([42, 123, 456, 789, 2024]);
export const LOCA_TASK_COUNT = 15;
/** The Prism arms (Task 5 runs all five; the pilot runs memory-off and WM). */
export const LOCA_PRISM_ARMS = Object.freeze(["memory-off", "fold", "llm-summary", "STM-only", "WM"]);
export const LOCA_CALIBRATION_ARM = "loca-react";
export const LOCA_ARMS = Object.freeze([LOCA_CALIBRATION_ARM, ...LOCA_PRISM_ARMS]);
/**
 * The options every Prism arm passes to `armMemory`: the package defaults (`defaults: true`, the long-horizon family's
 * call), with the arm's worker model. Nothing else may differ between gate M-2's arms and these.
 */
export const locaArmMemoryOptions = (workerModel) => Object.freeze({ workerModel, defaults: true });
/** LOCA's ReAct sampling (`make_aihubmix_api_request`: temperature 1.0, top_p 1.0), used by every arm. */
export const LOCA_SAMPLING = Object.freeze({ temperature: 1 });
/** LOCA's per-instance tool budget (`--max-tool-uses` default). */
export const LOCA_MAX_TOOL_USES = 500;
/** The evidence row's keys: counts, ids, rewards. A row with any other key is refused (`assertLocaRowHoldsNoText`). */
export const LOCA_ROW_KEYS = Object.freeze([
  "instance",
  "task",
  "seed",
  "preset",
  "budget",
  "arm",
  "status",
  "code",
  "reward",
  "evaluation",
  "claimed",
  "toolCalls",
  "toolOutputTokens",
  "peakInputTokens",
  "main",
  "worker",
  "wmPasses",
  "wmItems",
  "compactions",
  "trims",
  "wallMs",
]);

/** The instances of one preset: config index, task name, seed and its ordinal. Ids are `<task>/s<ordinal>`. */
export function locaInstances(codeDir, preset) {
  if (!LOCA_PRESETS.includes(preset)) throw new Error(`LocaBench: unknown preset ${preset}`);
  const file = join(codeDir, "task-configs", `final_${preset}_set_config.json`);
  const configurations = JSON.parse(readFileSync(file, "utf8")).configurations;
  const instances = configurations.map((config, index) => {
    const seed = config.env_params?.seed;
    const ordinal = LOCA_SEEDS.indexOf(seed) + 1;
    if (!ordinal) throw new Error(`LocaBench: ${config.name} at index ${index} has an unknown seed`);
    return { id: `${config.name}/s${ordinal}`, index, task: config.name, seed, ordinal };
  });
  const tasks = new Set(instances.map((instance) => instance.task));
  if (tasks.size !== LOCA_TASK_COUNT || instances.length !== LOCA_TASK_COUNT * LOCA_SEEDS.length)
    throw new Error(`LocaBench: ${preset} holds ${tasks.size} tasks and ${instances.length} instances`);
  return { file, instances };
}

/** The environment the sidecar gets: no credentials, no user site, the pinned tiktoken cache. */
export function seamEnv(paths, extra = {}) {
  return {
    PATH: `${join(paths.venv, "bin")}:/usr/bin:/bin`,
    HOME: process.env.HOME ?? "/tmp",
    LANG: "C.UTF-8",
    TIKTOKEN_CACHE_DIR: paths.tiktoken,
    LOCA_QUIET: "1",
    ...extra,
  };
}

const seamArgs = (paths, command, { configFile, index, workspace }) => [
  "-I",
  SEAM_PATH,
  command,
  "--code",
  paths.code,
  "--config",
  configFile,
  "--index",
  String(index),
  "--workspace",
  workspace,
  "--venv",
  paths.venv,
  "--node-modules",
  paths.nodeModules,
  "--excel-venv",
  paths.excelVenv,
  "--max-tool-uses",
  String(LOCA_MAX_TOOL_USES),
];

/**
 * Start the sidecar for one instance. Its stderr (upstream's prints) goes to `<workspace>.log`, private. Resolves with
 * `{ ready, call(name, args), finish(text), close() }`; `ready` holds the task prompt and the tool schemas.
 */
export async function openSeam({ paths, configFile, index, workspace }) {
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  const child = spawn(paths.python, seamArgs(paths, "serve", { configFile, index, workspace }), {
    env: seamEnv(paths),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.pipe(createWriteStream(`${workspace}.log`, { mode: 0o600 }));
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });
  const next = async () => {
    const { value, done } = await lines.next();
    if (done) throw new Error(`LocaSeam: the sidecar ended (${JSON.stringify(exited)}); see ${workspace}.log`);
    return JSON.parse(value);
  };
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const ready = await next();
  if (ready.op !== "ready") throw new Error(`LocaSeam: expected ready, got ${ready.op}`);
  let pending = Promise.resolve();
  const exchange = (message) => {
    const result = pending.then(() => {
      send(message);
      return next();
    });
    pending = result.catch(() => {});
    return result;
  };
  return {
    ready,
    call: (id, name, args) => exchange({ op: "call", id, name, arguments: args }),
    finish: (text) => exchange({ op: "finish", text }),
    close() {
      child.stdin.end();
      if (!exited) setTimeout(() => !exited && child.kill("SIGTERM"), 5_000).unref();
    },
  };
}

/**
 * A provider fault (rate limit, quota, overload, transport): not an outcome of the task. The instance writes no row,
 * and the pilot waits and runs it again. A run limit (LOCA's 500 tool uses) is an outcome and stays a row.
 */
export class LocaProviderFault extends Error {
  constructor(message) {
    super(message);
    this.name = "LocaProviderFault";
  }
}
const PROVIDER_FAULT = /rate|quota|overload|provider|transport|network|timeout|http|429|5\d\d|ECONN|fetch failed/i;
export const isProviderFault = (code) => typeof code === "string" && !/RUN_LIMIT/i.test(code) && PROVIDER_FAULT.test(code);

/** Prism tools over the sidecar: LOCA's schemas and descriptions, each call forwarded; `onTerminated` on claim_done. */
export function locaTools(seam, { onTerminated, counts }) {
  return (seam.ready.tools ?? []).map(({ function: fn }) => ({
    name: fn.name,
    description: fn.description ?? "",
    parameters: fn.parameters ?? { type: "object", properties: {} },
    async execute(args, context) {
      counts.toolCalls++;
      const id = context?.toolCallId ?? `c${counts.toolCalls}`;
      const reply = await seam.call(id, fn.name, args ?? {});
      if (reply.terminated) onTerminated();
      const text = String(reply.content ?? "");
      counts.outputChars = (counts.outputChars ?? 0) + text.length;
      return { toolCallId: id, name: fn.name, value: text, content: [{ type: "text", text }] };
    },
  }));
}

/** Track the largest single agent request (input tokens) an arm sent: whether the environment outgrew B. */
export function peakTracked(providers, peak) {
  return providers.map((provider) => ({
    ...provider,
    async *generate(request) {
      const worker = (request.tools ?? []).some((tool) => ["record_event", "judge"].includes(tool.name));
      let usage;
      try {
        for await (const chunk of provider.generate(request)) {
          if (chunk.type === "usage" || chunk.type === "done") usage = chunk.usage ?? usage;
          yield chunk;
        }
      } finally {
        if (!worker) {
          const tokens = usage?.inputTokens ?? Math.ceil(JSON.stringify(request.messages ?? []).length / 4);
          peak.value = Math.max(peak.value, tokens);
        }
      }
    },
  }));
}

/** The model an arm runs: LOCA's window B, LOCA's output reservation, LOCA's sampling. */
export function locaModel(model, { budget, maxOutputTokens }) {
  return {
    ...model,
    limits: { ...(model.limits ?? {}), contextWindow: budget, maxOutputTokens },
    parameters: { ...(model.parameters ?? {}), maxTokens: maxOutputTokens, ...LOCA_SAMPLING },
  };
}

/** One evidence row: only the allowed keys, each a count, id, reward or status. */
export function locaRow(fields) {
  const row = Object.fromEntries(LOCA_ROW_KEYS.filter((key) => fields[key] !== undefined).map((key) => [key, fields[key]]));
  assertLocaRowHoldsNoText(row);
  return row;
}

const SAFE_STRING = /^[A-Za-z0-9_./:+-]{0,80}$/;
/** Refuse a row with an unknown key or any string that is not a short id (no prompt, tool output or model text). */
export function assertLocaRowHoldsNoText(row) {
  const walk = (value, path) => {
    if (typeof value === "string") {
      if (!SAFE_STRING.test(value)) throw new Error(`LocaEvidence: ${path} holds text`);
    } else if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) walk(item, `${path}[${index}]`);
    } else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
  };
  for (const key of Object.keys(row)) if (!LOCA_ROW_KEYS.includes(key)) throw new Error(`LocaEvidence: unknown key ${key}`);
  walk(row, "row");
  return row;
}

/**
 * One instance on one Prism arm. `providers` are the arm's providers (metered here: the agent apart from memory
 * workers), `model` the agent's model before B is applied, `workerModel` the memory/summary worker's ref.
 * `openSeam` is injectable (tests pass a scripted environment).
 */
export async function runLocaInstance({
  instance,
  arm,
  preset,
  budget,
  maxOutputTokens,
  providers,
  model,
  workerModel,
  paths,
  configFile,
  workspace,
  open = openSeam,
  store = createMemorySessionStore(),
  maxWallTimeMs = 4 * 3_600_000,
}) {
  if (!LOCA_PRISM_ARMS.includes(arm)) throw new Error(`LocaBench: ${arm} is not a Prism arm`);
  const started = Date.now();
  const seam = await open({ paths, configFile, index: instance.index, workspace });
  const counts = { toolCalls: 0 };
  const peak = { value: 0 };
  const controller = new AbortController();
  let claimed = false;
  const meter = {
    worker: { calls: 0, inputTokens: 0, outputTokens: 0 },
    main: { calls: 0, inputTokens: 0, outputTokens: 0 },
    ...(arm === "WM" || arm === "STM-only" ? { wm: { calls: 0, items: 0, capStops: 0, capNoItem: 0, stopReasons: {} } } : {}),
  };
  const agent = await createAgent({
    model: locaModel(model, { budget, maxOutputTokens }),
    packages: [
      providerPackage("loca-bench-providers", meteredLongSessionProviders(peakTracked(providers, peak), meter, {})),
      ...(await armMemory(arm, locaArmMemoryOptions(workerModel))),
    ],
    tools: {
      add: locaTools(seam, {
        counts,
        onTerminated() {
          claimed = true;
          // LOCA's loop ends at claim_done; the run stops before another model turn (the reward is already read).
          controller.abort();
        },
      }),
    },
    slots: { store },
    // LOCA's budget is 500 tool uses per instance and nothing else; every kernel count axis is set past it, so no
    // default fence (plan 229: 49 tool rounds, 75 provider attempts, 200 tool calls) ends a run LOCA would continue.
    limits: {
      maxTurns: LOCA_MAX_TOOL_USES + 10,
      maxToolRounds: LOCA_MAX_TOOL_USES,
      maxToolCalls: LOCA_MAX_TOOL_USES,
      maxProviderAttempts: 4 * LOCA_MAX_TOOL_USES,
      maxInputTokens: 60_000_000,
      maxTotalTokens: 64_000_000,
      maxOutputTokens: 4_000_000,
      maxWallTimeMs,
    },
  });
  let status = "unknown";
  let code;
  let finished;
  let stats = { compactions: 0, passes: 0, items: [] };
  try {
    const session = await agent.session({ id: `${instance.id}-${arm}`.replace(/[^A-Za-z0-9._-]/g, "-"), create: true });
    let result;
    try {
      result = await session.run(seam.ready.prompt, { signal: controller.signal });
      status = claimed ? "claimed" : (result?.status ?? "unknown");
      if (!claimed) code = result?.error?.code ?? result?.limit?.kind ?? result?.limit?.name ?? result?.stopReason;
      if (process.env.LOCA_DEBUG)
        console.error(JSON.stringify({ status: result?.status, error: result?.error, limit: result?.limit, stack: result?.error?.stack }));
    } catch (error) {
      if (process.env.LOCA_DEBUG) console.error(error);
      status = claimed ? "claimed" : "failed";
      if (!claimed) code = error?.code ?? error?.name ?? "error";
    }
    if (!claimed && status === "failed" && isProviderFault(String(code ?? ""))) throw new LocaProviderFault(`provider fault ${code}`);
    if (typeof session.entries === "function") stats = longSessionWmStats(await session.entries());
    finished = await seam.finish(claimed ? "" : String(result?.text ?? ""));
    await session.close().catch(() => {});
  } finally {
    await agent.dispose();
    seam.close();
  }
  return locaRow({
    instance: instance.id,
    task: instance.task,
    seed: instance.seed,
    preset,
    budget,
    arm,
    status,
    ...(code ? { code: String(code).slice(0, 60) } : {}),
    reward: finished?.reward ?? 0,
    evaluation: finished?.evaluation ?? "missing",
    claimed: Boolean(finished?.claimed),
    toolCalls: counts.toolCalls,
    // How much of the environment the run read (tool output, ceil(chars / 4)): whether it outgrew B.
    toolOutputTokens: Math.ceil((counts.outputChars ?? 0) / 4),
    peakInputTokens: peak.value,
    main: {
      calls: meter.main.calls,
      inputTokens: meter.main.inputTokens,
      outputTokens: meter.main.outputTokens,
      cacheReadTokens: meter.main.cacheReadTokens ?? 0,
    },
    worker: { calls: meter.worker.calls, inputTokens: meter.worker.inputTokens, outputTokens: meter.worker.outputTokens },
    wmPasses: stats.passes,
    wmItems: stats.items.reduce((sum, items) => sum + items, 0),
    compactions: stats.compactions,
    wallMs: Date.now() - started,
  });
}

/**
 * `loca-react` on one instance: upstream's own loop through `seam.py react`, against `baseUrl` (the pass-through's
 * `/v1`, which appends `/chat/completions`), with LOCA's `--max-context-size` = B and `--max-tokens`.
 */
export async function runLocaReact({ instance, preset, budget, maxOutputTokens, model, paths, configFile, workspace, baseUrl, apiKey }) {
  const started = Date.now();
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  const args = [
    ...seamArgs(paths, "react", { configFile, index: instance.index, workspace }),
    "--model",
    model,
    "--max-tokens",
    String(maxOutputTokens),
    "--max-context-size",
    String(budget),
  ];
  const out = await new Promise((resolve, reject) => {
    const child = spawn(paths.python, args, {
      env: seamEnv(paths, { LOCA_REACT_BASE_URL: baseUrl, LOCA_REACT_API_KEY: apiKey }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.pipe(createWriteStream(`${workspace}.log`, { mode: 0o600 }));
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += chunk;
    });
    child.on("error", reject);
    child.on("exit", (exitCode) =>
      exitCode === 0
        ? resolve(text)
        : reject(
            exitCode === 3
              ? new LocaProviderFault("LocaReact: the episode ended on an API error")
              : new Error(`LocaReact: exit ${exitCode}; see ${workspace}.log`),
          ),
    );
  });
  const result = JSON.parse(out.trim().split("\n").at(-1));
  return locaRow({
    instance: instance.id,
    task: instance.task,
    seed: instance.seed,
    preset,
    budget,
    arm: LOCA_CALIBRATION_ARM,
    status: result.status === "success" ? "completed" : "failed",
    reward: result.reward ?? 0,
    evaluation: result.reward >= 1 ? "passed" : "failed",
    toolCalls: result.toolCalls ?? 0,
    main: {
      calls: result.steps ?? 0,
      inputTokens: result.promptTokens ?? 0,
      outputTokens: result.completionTokens ?? 0,
      cacheReadTokens: 0,
    },
    worker: { calls: 0, inputTokens: 0, outputTokens: 0 },
    trims: result.trims ?? 0,
    wallMs: Date.now() - started,
  });
}

/** Tools the scripted offline agent may call: no required argument, and a name that reads rather than writes. */
/** Tools Prism's packages add to an arm (memory recall, tool search): never part of LOCA's environment. */
const PRISM_TOOLS = new Set(["recall", "search_tools"]);
const WRITES =
  /create|delete|update|send|write|move|edit|submit|publish|enroll|logout|login|import|forward|reply|mark|post|save|start|add|remove|claim|execute|run|upload|insert|drop|cancel|set_|reset|clear|download|export/;
export function locaReadTools(tools) {
  return tools
    .map((tool) => tool.function ?? tool)
    .filter((fn) => !PRISM_TOOLS.has(fn.name) && !WRITES.test(fn.name) && !(fn.parameters?.required ?? []).length)
    .map((fn) => fn.name)
    .sort();
}

/**
 * The offline agent: `steps` read-only calls over the instance's own tools (round robin), each with an outcome line the
 * offline STM worker records, then `claim_done`. It never answers the task; the evaluator still scores the end state.
 */
export function locaScriptedAgent({ steps = 40 } = {}) {
  let n = 0;
  return {
    id: "mock",
    async *generate(request) {
      const names = (request.tools ?? []).map((tool) => tool.name);
      const reads = locaReadTools(request.tools ?? []);
      const claim = names.find((name) => name.endsWith("claim_done"));
      n += 1;
      if (n <= steps && reads.length) {
        yield providerTextDelta(`Task 1 done: step ${n} read ${reads[(n - 1) % reads.length]}.`);
        yield providerToolCall(toolCallContent(`loca-${n}`, reads[(n - 1) % reads.length], {}));
      } else if (claim && n === steps + 1) {
        yield providerToolCall(toolCallContent(`loca-${n}`, claim, {}));
      } else yield providerTextDelta("Done.");
      yield providerDone();
    },
  };
}

/**
 * The offline stand-in for the model behind `loca-react`: an OpenAI Chat Completions endpoint on 127.0.0.1 that plays
 * the same script as `locaScriptedAgent` (read-only calls, then claim_done), counting steps from the conversation.
 */
export function startScriptedChat({ steps = 40 } = {}) {
  const counts = new Map();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "POST" || !url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 });
      const body = await req.json();
      // Steps are counted per instance here, not from the conversation: LOCA's trimming shortens the conversation,
      // and a count read from it would never reach claim_done. The instance is its first user message (kept by
      // the trimmer) and its tool list.
      const first = (body.messages ?? []).find((message) => message.role === "user");
      const key = JSON.stringify([first?.content ?? "", (body.tools ?? []).map((tool) => tool.function?.name)]);
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      const reads = locaReadTools(body.tools ?? []);
      const claim = (body.tools ?? []).map((tool) => tool.function?.name).find((name) => name?.endsWith("claim_done"));
      const call = n <= steps && reads.length ? reads[(n - 1) % reads.length] : n === steps + 1 ? claim : undefined;
      const message = call
        ? {
            role: "assistant",
            content: `Task 1 done: step ${n}.`,
            tool_calls: [{ id: `r${n}`, type: "function", function: { name: call, arguments: "{}" } }],
          }
        : { role: "assistant", content: "Done." };
      const promptTokens = Math.ceil(JSON.stringify(body.messages ?? []).length / 4);
      return Response.json({
        id: `scripted-${n}`,
        object: "chat.completion",
        model: body.model,
        choices: [{ index: 0, message, finish_reason: call ? "tool_calls" : "stop" }],
        usage: { prompt_tokens: promptTokens, completion_tokens: 20, total_tokens: promptTokens + 20 },
      });
    },
  });
  return { baseUrl: `http://127.0.0.1:${server.port}/v1`, stop: () => server.stop(true) };
}

export const locaWorkspaceExists = (workspace) => existsSync(workspace);
