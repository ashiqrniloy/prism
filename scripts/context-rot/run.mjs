#!/usr/bin/env bun
/**
 * Context-rot curve: 30 deterministic tasks after N tokens of pinned stale tool history, with and
 * without context-engineering fold batch mode. Live runs use the wire proxy for billed usage.
 *
 *   bun scripts/context-rot/run.mjs --provider opencode-go --model <id>
 *   bun scripts/context-rot/run.mjs --offline
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import {
  providerDone,
  providerTextDelta,
  resolveInputCap,
} from "@arnilo/prism";
import {
  foldToolResultHistory,
  planToolResultFoldBatch,
  resolveToolResultFold,
  truncateSummarize,
} from "@arnilo/prism-context-engineering";
import { collectProviderEvents } from "@arnilo/prism/provider-kit";
import { parseEnvFile } from "../live-matrix.mjs";
import { startWireProxy } from "../wire-proxy.mjs";
import {
  buildHistoryMessages,
  cloneHistory,
  extractSnapshot,
  lastHistoryMessageId,
  readSnapshotFiles,
  EXPRESS_PIN,
} from "./history.mjs";
import { gradeTask, prepareWorkspace } from "./grade.mjs";
import { aggregate, writeEvidence, updateSummary } from "./report.mjs";
import tasksData from "./tasks.json" with { type: "json" };

const ROOT = resolve(import.meta.dir);
const FIXTURE_ROOT = join(ROOT, "fixtures/repo");
const DEFAULT_LENGTHS = [0, 16_000, 32_000, 64_000, 96_000];
const PROVIDERS = {
  hyper: {
    module: "@arnilo/prism-provider-hyper",
    create: "createHyperProvider",
    list: "listHyperModels",
    secret: "HYPER_API_KEY",
    url: "https://hyper.charm.land/v1",
  },
  "opencode-go": {
    module: "@arnilo/prism-provider-opencode-go",
    create: "createOpenCodeGoProvider",
    list: "listOpenCodeGoModels",
    secret: "OPENCODE_GO_API_KEY",
    fallbackSecret: "OPENCODE_API_KEY",
    url: "https://opencode.ai/zen/go/v1",
  },
};

export class ContextRotCeiling extends Error {
  name = "ContextRotCeiling";
}

export function parseArgs(argv) {
  const options = {};
  const flags = new Set([
    "provider",
    "model",
    "lengths",
    "repeats",
    "max-input-tokens",
    "output-dir",
    "summary",
    "cache",
    "max-turns",
    "max-tasks",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--offline") {
      options.offline = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (!arg.startsWith("--") || !flags.has(arg.slice(2)) || argv[index + 1] === undefined || argv[index + 1].startsWith("--"))
      throw new TypeError(`ContextRotArguments: unknown flag or missing value: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[key] = argv[++index];
  }
  if (options.help) return options;
  for (const key of ["repeats", "maxInputTokens", "maxTurns", "maxTasks"]) {
    if (options[key] === undefined) continue;
    options[key] = Number(options[key]);
    if (!Number.isSafeInteger(options[key]) || options[key] < 1) throw new TypeError(`ContextRotArguments: ${key} must be a positive integer`);
  }
  if (options.lengths !== undefined) {
    const lengths = options.lengths.split(",").map((value) => Number(value));
    if (lengths.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new TypeError("ContextRotArguments: lengths must be non-negative integers");
    options.lengths = [...new Set(lengths)].sort((left, right) => left - right);
  }
  if (!options.offline && (!options.provider || !options.model)) throw new TypeError("ContextRotArguments: --provider and --model are required unless --offline");
  return options;
}

/** Round-robin by kind when a pilot limit is set, so a 3-task run covers coding, needle and tools. */
export function selectTasks(all, limit) {
  if (limit === undefined || limit >= all.length) return all;
  const buckets = [all.filter((task) => task.kind === "coding"), all.filter((task) => task.kind === "needle"), all.filter((task) => task.kind === "tools")];
  const selected = [];
  for (let index = 0; selected.length < limit; index += 1) {
    for (const bucket of buckets) {
      if (bucket[index]) selected.push(bucket[index]);
      if (selected.length === limit) break;
    }
  }
  return selected;
}

export function clampLengths(lengths, cap) {
  const clamped = [...new Set(lengths.map((length) => Math.min(length, cap)))].sort((left, right) => left - right);
  if (!clamped.includes(0)) clamped.unshift(0);
  return clamped;
}

export function loadEnv() {
  const path = process.env.PRISM_LIVE_ENV_FILE ?? join(homedir(), ".config/prism/live.env");
  if (existsSync(path)) {
    for (const [name, value] of Object.entries(parseEnvFile(path))) if (process.env[name] === undefined) process.env[name] = value;
  } else if (process.env.PRISM_LIVE_ENV_FILE) throw new Error("ContextRotCredentials: explicit live env file missing");
}

async function liveProvider(providerId, modelId, cache) {
  loadEnv();
  const spec = PROVIDERS[providerId];
  if (!spec) throw new Error(`ContextRotProvider: supported providers are ${Object.keys(PROVIDERS).join(", ")}`);
  const key = process.env[spec.secret] ?? (spec.fallbackSecret ? process.env[spec.fallbackSecret] : undefined);
  if (!key) throw new Error("ContextRotCredentials: provider credential unavailable");
  const module = await import(spec.module);
  const catalog = await module[spec.list]({ apiKey: () => key, signal: AbortSignal.timeout(30_000) });
  const model = catalog.find((entry) => entry.model === modelId);
  if (!model) throw new Error("ContextRotModel: model not found in provider catalog");
  const usageLog = join(cache, `${providerId}-${modelId.replace(/[^a-zA-Z0-9_.-]/g, "_")}-usage.jsonl`);
  await mkdir(dirname(usageLog), { recursive: true });
  await writeFile(usageLog, "");
  const proxy = await startWireProxy({
    upstream: spec.url,
    listen: "127.0.0.1:0",
    usageLog,
    secretEnv: [spec.secret, ...(spec.fallbackSecret ? [spec.fallbackSecret] : [])],
  });
  const provider = module[spec.create]({ apiKey: () => key, baseUrl: proxy.url });
  const maxOutput = Math.min(4096, model.limits?.maxOutputTokens && model.limits.maxOutputTokens > 0 ? model.limits.maxOutputTokens : 4096);
  const resolved = {
    ...model,
    parameters: { ...model.parameters, maxTokens: maxOutput, temperature: 0 },
  };
  return { provider, model: resolved, proxy, usageLog, spec };
}

function toolDefinitions(workspace, task) {
  const pathArg = { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false };
  return [
    {
      name: "read_file",
      kind: "read",
      description: "Read a UTF-8 text file from the workspace. Paths are relative to the workspace root.",
      parameters: pathArg,
      execute: async (args, context) => toolResult(context, await readWorkspaceFile(workspace, args.path)),
    },
    {
      name: "write_file",
      kind: "edit",
      description: "Write a complete UTF-8 text file in the workspace. Creates parent directories.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
        additionalProperties: false,
      },
      execute: async (args, context) => toolResult(context, await writeWorkspaceFile(workspace, args.path, args.content)),
    },
    {
      name: "list_files",
      kind: "read",
      description: "List files under a workspace directory, recursively.",
      parameters: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false },
      execute: async (args, context) => toolResult(context, await listWorkspaceFiles(workspace, args.path ?? ".")),
    },
    {
      name: "grep",
      kind: "search",
      description: "Search a workspace file for a literal string and return matching lines.",
      parameters: {
        type: "object",
        properties: { pattern: { type: "string" }, path: { type: "string" } },
        required: ["pattern", "path"],
        additionalProperties: false,
      },
      execute: async (args, context) => toolResult(context, await grepWorkspaceFile(workspace, args.path, args.pattern)),
    },
    {
      name: "run_tests",
      kind: "execute",
      description: "Run the fixture test for this task and return the pass/fail output. Do not edit tests.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async (_args, context) => toolResult(context, runFixtureTest(workspace, task)),
    },
  ];
}

function toolResult(context, text) {
  return {
    toolCallId: context.toolCallId,
    name: context.name ?? "tool",
    content: [{ type: "text", text: String(text).slice(0, 64_000) }],
  };
}

function safePath(workspace, path) {
  const target = resolve(workspace, String(path ?? ""));
  if (target !== workspace && !target.startsWith(`${workspace}${sep}`)) throw new Error("path escapes the workspace");
  return target;
}

async function readWorkspaceFile(workspace, path) {
  try {
    const content = await readFile(safePath(workspace, path), "utf8");
    return content.length > 60_000 ? `${content.slice(0, 60_000)}\n… [truncated]` : content;
  } catch {
    return "ERROR: file not found";
  }
}

async function writeWorkspaceFile(workspace, path, content) {
  try {
    const target = safePath(workspace, path);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, String(content ?? ""));
    return `Wrote ${path} (${String(content ?? "").length} bytes).`;
  } catch {
    return "ERROR: cannot write that path";
  }
}

async function listWorkspaceFiles(workspace, path) {
  try {
    const base = safePath(workspace, path);
    const names = [];
    async function walk(directory, prefix = "") {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (names.length >= 200) return;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        names.push(entry.isDirectory() ? `${relative}/` : relative);
        if (entry.isDirectory()) await walk(join(directory, entry.name), relative);
      }
    }
    await walk(base);
    return names.length ? names.sort().join("\n") : "(empty)";
  } catch {
    return "ERROR: cannot list that path";
  }
}

async function grepWorkspaceFile(workspace, path, pattern) {
  try {
    const content = await readFile(safePath(workspace, path), "utf8");
    const needle = String(pattern ?? "");
    const hits = [];
    for (const [index, line] of content.split("\n").entries()) {
      if (line.includes(needle)) hits.push(`${path}:${index + 1}:${line}`);
      if (hits.length >= 80) break;
    }
    return hits.length ? hits.join("\n") : "(no matches)";
  } catch {
    return "ERROR: cannot search that file";
  }
}

function runFixtureTest(workspace, task) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "test/bugs.test.js", "-t", task.testName],
    cwd: workspace,
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = `${result.stdout.toString()}\n${result.stderr.toString()}`.trim();
  return `exit ${result.exitCode}\n${text.slice(-4_000)}`;
}

function messageFromEvents(events) {
  const completed = [...events].reverse().find((event) => event.type === "message.completed");
  if (completed) return completed.message;
  const content = [];
  const calls = new Map();
  for (const event of events) {
    if (event.type === "content_delta") content.push(event.content);
    if (event.type === "tool_call") calls.set(event.call.index ?? calls.size, { type: "tool_call", ...event.call });
    if (event.type === "tool_call_delta") {
      const call = calls.get(event.index) ?? { type: "tool_call", id: "", name: "", arguments: {}, argumentsText: "" };
      call.id = event.id ?? call.id;
      call.name = event.name ?? call.name;
      call.argumentsText = `${call.argumentsText ?? ""}${event.argumentsText ?? ""}`;
      calls.set(event.index, call);
    }
  }
  for (const call of calls.values()) {
    if (call.argumentsText) {
      try {
        call.arguments = JSON.parse(call.argumentsText);
      } catch {
        call.arguments = {};
      }
    }
    content.push(call);
  }
  return { role: "assistant", content };
}

function usageFromEvents(events) {
  const done = [...events].reverse().find((event) => event.type === "done" && event.usage);
  if (done?.usage) return done.usage;
  const usage = [...events].reverse().find((event) => event.type === "usage");
  return usage?.usage ?? {};
}

function textFromMessage(message) {
  return message.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

async function foldedView(messages, foldOptions, state, turn, runId) {
  if (!foldOptions) return messages;
  const plan = planToolResultFoldBatch(messages, foldOptions, { turn, clearedToolCallIds: state.cleared });
  for (const id of plan.advance) state.cleared.add(id);
  return foldToolResultHistory(messages, foldOptions, {
    sessionId: state.sessionId,
    runId,
    turn,
    restrictToToolCallIds: plan.foldToolCallIds,
  });
}

async function runTask({ provider, model, task, history, fold, maxTurns, cacheAnchor, cacheKey, runId }) {
  const messages = cloneHistory(history);
  if (task.kind === "needle") {
    messages.unshift({ id: "session-fact", role: "user", content: [{ type: "text", text: task.fact }] });
    messages.push({ id: `${runId}-task`, role: "user", content: [{ type: "text", text: task.question }] });
  } else {
    messages.push({ id: `${runId}-task`, role: "user", content: [{ type: "text", text: task.prompt ?? task.question }] });
  }
  const workspace = task.kind === "needle" ? undefined : await prepareWorkspace(FIXTURE_ROOT, join(ROOT, ".work"), task);
  const tools = workspace ? toolDefinitions(workspace, task) : undefined;
  const foldOptions = fold === "fold"
    ? resolveToolResultFold({ minAgeTurns: 2, minBytes: 4096, keepLast: 3, clearAtLeastTokens: 4096, summarize: truncateSummarize })
    : undefined;
  const foldState = { cleared: new Set(), sessionId: runId };
  const historyTurns = history.filter((message) => message.role === "assistant").length;
  let turn = historyTurns + 1;
  let answer = "";
  let usage = {};
  let calls = 0;
  for (let step = 0; step < maxTurns; step += 1) {
    const view = await foldedView(messages, foldOptions, foldState, turn, runId);
    const options = {
      sessionId: cacheKey,
      cacheKey,
      ...(cacheAnchor ? { cache: { mode: "on", breakpoints: [{ location: "message_id", messageId: cacheAnchor }] } } : {}),
    };
    const events = await collectProviderEvents(provider, { model, messages: view, ...(tools ? { tools } : {}), options });
    const error = [...events].reverse().find((event) => event.type === "error");
    if (error) throw new Error(`provider error: ${error.error.message}`);
    usage = mergeUsage(usage, usageFromEvents(events));
    calls += 1;
    const message = messageFromEvents(events);
    messages.push({ ...message, id: `${runId}-assistant-${step + 1}` });
    const toolCalls = message.content.filter((block) => block.type === "tool_call" && block.authority !== "provider-hosted");
    answer = textFromMessage(message) || answer;
    if (process.env.PRISM_CONTEXT_ROT_DEBUG)
      console.log(`[debug] turn=${step + 1} text=${JSON.stringify(answer.slice(0, 200))} calls=${toolCalls.map((call) => `${call.name}(${JSON.stringify(call.arguments)})`).join(" ")}`);
    if (toolCalls.length === 0) break;
    for (const call of toolCalls) {
      const tool = tools?.find((entry) => entry.name === call.name);
      const result = tool
        ? await tool.execute(call.arguments ?? {}, { toolCallId: call.id, name: call.name })
        : { toolCallId: call.id, name: call.name, content: [{ type: "text", text: "ERROR: unknown tool" }] };
      if (process.env.PRISM_CONTEXT_ROT_DEBUG) console.log(`[debug] result=${JSON.stringify((result.content ?? []).map((block) => block.text).join("\n").slice(0, 300))}`);
      messages.push({
        role: "tool",
        content: [{ type: "tool_result", toolCallId: call.id, name: call.name, result: result.content?.map((block) => block.text).join("\n") ?? "" }],
        metadata: { prismToolResultTurn: turn + 1 },
      });
    }
    turn += 1;
  }
  const grade = task.kind === "needle" || !workspace
    ? await gradeTask(task, { answer })
    : await gradeTask(task, { workspace, answer });
  if (workspace && !process.env.PRISM_CONTEXT_ROT_DEBUG) await rm(workspace, { recursive: true, force: true });
  return { score: grade.score, answer, usage, calls };
}

function mergeUsage(total, next) {
  return {
    inputTokens: (total.inputTokens ?? 0) + (next.inputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (next.outputTokens ?? 0),
    cacheReadTokens: (total.cacheReadTokens ?? 0) + (next.cacheReadTokens ?? 0),
    cacheWriteTokens: (total.cacheWriteTokens ?? 0) + (next.cacheWriteTokens ?? 0),
    calls: (total.calls ?? 0) + 1,
  };
}

function offlineProvider() {
  return {
    id: "mock",
    async *generate() {
      yield providerTextDelta("offline smoke");
      yield providerDone({ inputTokens: 32, outputTokens: 4 });
    },
  };
}

async function usageDelta(runtime, startIndex) {
  await runtime.proxy.drain();
  if (!existsSync(runtime.usageLog)) return { rows: [], nextIndex: startIndex, complete: false };
  const all = (await readFile(runtime.usageLog, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const rows = all.slice(startIndex);
  return {
    rows,
    nextIndex: all.length,
    complete: rows.every((row) => Number.isSafeInteger(row.inputTokens) && row.inputTokens >= 0),
  };
}

export async function run(options = {}) {
  const offline = options.offline === true;
  const repeats = options.repeats ?? (offline ? 1 : 3);
  const maxInputTokens = options.maxInputTokens ?? 50_000_000;
  const maxTurns = options.maxTurns ?? 8;
  const generatedAt = new Date().toISOString();
  const cache = options.cache ?? join(process.env.PRISM_CACHE_DIR ?? join(homedir(), ".cache/prism"), "context-rot");
  await mkdir(cache, { recursive: true });
  const tasks = offline
    ? [tasksData.coding[0], tasksData.needle[0], tasksData.tools[0]]
    : selectTasks([...tasksData.coding, ...tasksData.needle, ...tasksData.tools], options.maxTasks);
  const targetLengths = options.lengths ?? (offline ? [0, 4000] : DEFAULT_LENGTHS);
  let runtime;
  let modelWindow = 128_000;
  let provider = offlineProvider();
  let model = { provider: "mock", model: "offline", limits: { contextWindow: modelWindow, maxOutputTokens: 1024 } };
  let root;
  try {
    if (offline) {
      root = FIXTURE_ROOT;
    } else {
      runtime = await liveProvider(options.provider, options.model, cache);
      provider = runtime.provider;
      model = runtime.model;
      modelWindow = model.limits?.contextWindow ?? 0;
      root = await extractSnapshot(EXPRESS_PIN, { cache });
    }
    const files = await readSnapshotFiles(root);
    const cap = offline ? modelWindow : resolveInputCap(undefined, model);
    const lengths = clampLengths(targetLengths, cap);
    const histories = new Map(lengths.map((length) => [length, buildHistoryMessages(files, length)]));
    const results = [];
    const usageTotals = { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, calls: 0, complete: true };
    let usageIndex = 0;
    let status = "completed";
    let providerErrors = 0;
    for (const length of lengths) {
      const history = histories.get(length);
      const cacheAnchor = lastHistoryMessageId(history);
      const cacheKey = `context-rot-${offline ? "mock" : options.provider}-${model.model}-${length}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
      for (const task of tasks) {
        for (const fold of ["none", "fold"]) {
          for (let repeat = 0; repeat < repeats; repeat += 1) {
            if (usageTotals.inputTokens >= maxInputTokens) {
              status = "ceiling";
              break;
            }
            const runId = `${length}-${task.id}-${fold}-${repeat}`;
            let outcome;
            try {
              outcome = await runTask({ provider, model, task, history, fold, maxTurns, cacheAnchor, cacheKey, runId });
            } catch (error) {
              if (error instanceof ContextRotCeiling) throw error;
              providerErrors += 1;
              outcome = { score: 0, answer: "", usage: {}, calls: 0, reason: "provider_error" };
            }
            if (runtime) {
              const delta = await usageDelta(runtime, usageIndex);
              usageIndex = delta.nextIndex;
              usageTotals.complete &&= delta.complete;
              const rows = delta.rows.length > 0 ? delta.rows : [];
              const wire = {
                inputTokens: rows.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
                cacheReadTokens: rows.reduce((sum, row) => sum + (row.cacheReadTokens ?? 0), 0),
                outputTokens: rows.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
                calls: rows.length,
              };
              outcome.usage = rows.length > 0 ? wire : outcome.usage;
            }
            const usage = {
              inputTokens: outcome.usage?.inputTokens ?? 0,
              cacheReadTokens: outcome.usage?.cacheReadTokens ?? 0,
              outputTokens: outcome.usage?.outputTokens ?? 0,
              calls: outcome.usage?.calls ?? outcome.calls,
            };
            usageTotals.inputTokens += usage.inputTokens;
            usageTotals.cacheReadTokens += usage.cacheReadTokens;
            usageTotals.outputTokens += usage.outputTokens;
            usageTotals.calls += usage.calls;
            const row = {
              id: task.id,
              kind: task.kind,
              length,
              fold,
              repeat,
              score: offline ? (outcome.answer ? 1 : 0) : outcome.score,
              usage,
              ...(outcome.reason ? { reason: outcome.reason } : {}),
            };
            results.push(row);
            if (!offline)
              console.log(
                `[context-rot] ${status} length=${length} fold=${fold} task=${task.id} run=${repeat + 1}/${repeats} score=${row.score} calls=${usage.calls} input=${usage.inputTokens}`,
              );
            if (status === "ceiling") break;
          }
          if (status === "ceiling") break;
        }
        if (status === "ceiling") break;
      }
      if (status === "ceiling") break;
    }
    const report = aggregate({
      provider: offline ? "mock" : options.provider,
      model: offline ? "offline" : options.model,
      mode: offline ? "offline" : "live",
      lengths,
      repeats,
      results,
      usage: usageTotals,
      generatedAt,
      modelWindow: offline ? modelWindow : modelWindow,
      cost: offline ? undefined : model.cost,
    });
    report.status = status;
    report.history = {
      source: offline ? "fixture" : "expressjs/express",
      commit: offline ? null : EXPRESS_PIN.commit,
      sha256: offline ? null : EXPRESS_PIN.sha256,
      files: files.length,
    };
    if (providerErrors > 0) report.limitations.push(`Provider errors: ${providerErrors} task run(s) scored zero and the run continued.`);
    const outputDir = options.outputDir ?? (offline ? join(cache, "offline") : join(resolve("docs/_evidence/context-rot")));
    const evidence = await writeEvidence(report, outputDir);
    report.evidence = evidence;
    if (!offline) await updateSummary(report, evidence.base, options.summary ?? resolve("docs/_evidence/context-rot-0.13.0.md"));
    return report;
  } finally {
    runtime?.proxy.stop();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("usage: bun scripts/context-rot/run.mjs --provider <id> --model <id> [--lengths 0,16000,...] [--repeats 3] [--max-input-tokens 50000000] [--offline]");
    return;
  }
  const report = await run(options);
  console.log(
    `${report.provider}/${report.model}: ${report.status}; ${report.taskCount} tasks; effective budget ${report.effectiveInputBudget}; fold ${report.foldEffectiveInputBudget}; ${report.usage.inputTokens} input tokens; evidence ${report.evidence.jsonPath}`,
  );
  if (report.status !== "completed") process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`[context-rot] ${error.message}`);
    process.exitCode = 2;
  });
}
