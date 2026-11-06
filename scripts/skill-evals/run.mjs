#!/usr/bin/env bun
/**
 * Paired skill evaluations (plan 215 Task 11): each module skill against the same agent with the skill disabled.
 *
 *   bun scripts/skill-evals/run.mjs --offline                      # scripted provider, CI-safe
 *   bun scripts/skill-evals/run.mjs --register                     # write criteria.lock.json (then commit it)
 *   bun scripts/skill-evals/run.mjs --dry-run --providers hyper    # five items, one trial: the cost estimate
 *   bun scripts/skill-evals/run.mjs --live --providers hyper,opencode-go --skill web-research
 *
 * Runs use Hyper, OpenCode Go and the free models on OpenRouter, Kilo and Command Code (keys from ~/.config/prism/live.env), never a router alias.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { createAgent, providerDone, providerTextDelta, providerToolCall, redactSecrets } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { defineDataset, runExperiment } from "@arnilo/prism-evals";
import { parseEnvFile } from "../live-matrix.mjs";
import {
  ARM_INSTRUCTIONS,
  preloadInstruction,
  ARMS,
  EVIDENCE_DIR,
  LOCK_PATH,
  ROOT,
  combineProviders,
  createScorers,
  decideShip,
  applyRound,
  loadCriteria,
  sha256,
  toolMisuseTotal,
} from "./lib.mjs";

const REPO = resolve(ROOT, "../..");
const SECRET_ENV = ["HYPER_API_KEY", "OPENCODE_GO_API_KEY", "OPENCODE_API_KEY", "OPENROUTER_API_KEY", "KILO_API_KEY", "COMMAND_CODE_API_KEY"];

export function parseArgs(argv) {
  const options = { providers: [] };
  const flags = new Set(["providers", "skill", "round", "out-dir", "trials", "max-items", "items", "dump-dir"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--offline", "--live", "--dry-run", "--register", "--help", "--preload"].includes(arg)) {
      options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = true;
      continue;
    }
    if (!arg.startsWith("--") || !flags.has(arg.slice(2)) || argv[index + 1] === undefined || argv[index + 1].startsWith("--"))
      throw new TypeError(`SkillEvalArguments: unknown flag or missing value: ${arg}`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[key] = argv[++index];
  }
  options.providers = typeof options.providers === "string" ? options.providers.split(",").filter(Boolean) : [];
  for (const key of ["round", "trials", "maxItems"]) {
    if (options[key] === undefined) continue;
    options[key] = Number(options[key]);
    if (!Number.isSafeInteger(options[key]) || options[key] < 1) throw new TypeError(`SkillEvalArguments: ${key} must be a positive integer`);
  }
  const modes = ["offline", "live", "dryRun", "register"].filter((mode) => options[mode]);
  if (!options.help && modes.length !== 1) throw new TypeError("SkillEvalArguments: pick exactly one of --offline, --live, --dry-run, --register");
  if ((options.live || options.dryRun) && options.providers.length === 0) throw new TypeError("SkillEvalArguments: --providers is required for a paid run");
  return options;
}

// ── datasets ───────────────────────────────────────────────────────────────────

export async function loadSuite(only) {
  const { criteria, hash } = loadCriteria();
  const skills = [];
  for (const spec of criteria.skills) {
    if (only && spec.name !== only) continue;
    const module = await import(join(ROOT, spec.dataset));
    if (module.skill !== spec.name) throw new Error(`SkillEvalDataset: ${spec.dataset} declares skill ${module.skill}, criteria says ${spec.name}`);
    const dataset = defineDataset({
      id: `skill-eval-${spec.name}`,
      version: String(module.version),
      canary: `prism-skill-eval-canary-${spec.name}-7c1e`,
      items: module.items,
    });
    skills.push({ spec, module, dataset });
  }
  if (only && skills.length === 0) throw new Error(`SkillEvalDataset: unknown skill ${only}`);
  return { criteria, criteriaHash: hash, skills };
}

/** Counts per kind, checked against the pre-registered bounds. */
export function datasetShape(items) {
  return {
    trigger: items.filter((item) => item.expected.kind === "trigger").length,
    nonTrigger: items.filter((item) => item.expected.kind === "non_trigger").length,
  };
}

export function assertShape(criteria, name, items) {
  const shape = datasetShape(items);
  const { triggerItems, nonTriggerItems } = criteria.dataset;
  if (shape.trigger < triggerItems.min || shape.trigger > triggerItems.max) throw new Error(`SkillEvalDataset: ${name} has ${shape.trigger} trigger items, expected ${triggerItems.min}-${triggerItems.max}`);
  if (shape.nonTrigger < nonTriggerItems.min || shape.nonTrigger > nonTriggerItems.max) throw new Error(`SkillEvalDataset: ${name} has ${shape.nonTrigger} non-trigger items, expected ${nonTriggerItems.min}-${nonTriggerItems.max}`);
}

/** A stable revision of the skill text under test: path and bytes of every file in its directory. */
export function skillsRevision(skillDir) {
  const root = resolve(REPO, skillDir);
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(root);
  return `sha256:${sha256(files.sort().map((path) => `${relative(root, path)}\n${readFileSync(path, "utf8")}`).join("\n--\n"))}`;
}

// ── agents ─────────────────────────────────────────────────────────────────────

const hasCall = (request, name) =>
  request.messages.some((message) => message.role === "assistant" && (message.content ?? []).some((block) => block.type === "tool_call" && block.name === name));

/**
 * The scripted provider: per request it either loads the skill (trigger items, when the catalog offers
 * `load_skill`), makes the environment's scripted tool calls, or answers. It exercises dataset wiring,
 * arm construction and the scorers; it says nothing about model behavior.
 */
export function offlineProvider({ skill, item, env }) {
  return {
    id: "skill-eval-offline",
    async *generate(request) {
      const names = (request.tools ?? []).map((tool) => tool.name);
      if (item.expected.kind === "trigger" && names.includes("load_skill") && !hasCall(request, "load_skill")) {
        yield providerToolCall({ type: "tool_call", id: "offline_load", name: "load_skill", arguments: { name: skill } });
        yield providerDone();
        return;
      }
      const pending = (env.offlineCalls ?? []).filter((call) => !hasCall(request, call.tool));
      if (pending.length > 0 && names.includes(pending[0].tool)) {
        yield providerToolCall({ type: "tool_call", id: `offline_${pending[0].tool}`, name: pending[0].tool, arguments: pending[0].args });
        yield providerDone();
        return;
      }
      const text = pending.length > 0 && env.offlineChild ? env.offlineChild() : await env.applyOffline(item);
      yield providerTextDelta(text);
      yield providerDone();
    },
  };
}

export async function loadEnv() {
  const path = process.env.PRISM_LIVE_ENV_FILE ?? join(homedir(), ".config/prism/live.env");
  if (existsSync(path)) {
    for (const [name, value] of Object.entries(parseEnvFile(path))) if (process.env[name] === undefined) process.env[name] = value;
  } else if (process.env.PRISM_LIVE_ENV_FILE) throw new Error("SkillEvalCredentials: explicit live env file missing");
  if (process.env.OPENCODE_GO_API_KEY === undefined && process.env.OPENCODE_API_KEY !== undefined) process.env.OPENCODE_GO_API_KEY = process.env.OPENCODE_API_KEY;
}

const PROVIDER_TABLE = {
  hyper: { module: "@arnilo/prism-provider-hyper", factory: "hyper", key: "HYPER_API_KEY" },
  "opencode-go": { module: "@arnilo/prism-provider-opencode-go", factory: "opencodeGo", key: "OPENCODE_GO_API_KEY" },
  openrouter: { module: "@arnilo/prism-provider-openrouter", factory: "openrouter", key: "OPENROUTER_API_KEY" },
  kilo: { module: "@arnilo/prism-provider-kilo", factory: "kilo", key: "KILO_API_KEY" },
  commandcode: { module: "@arnilo/prism-provider-commandcode", factory: "commandcode", key: "COMMAND_CODE_API_KEY" },
};

async function liveProvider(entry) {
  await loadEnv();
  const spec = PROVIDER_TABLE[entry.id];
  if (!spec) throw new Error(`SkillEvalProvider: ${entry.id} has no provider wiring`);
  const model = process.env[entry.modelEnv] ?? entry.defaultModel;
  if (!process.env[spec.key]) throw new Error(`SkillEvalCredentials: ${spec.key} unavailable`);
  const module = await import(spec.module);
  return { id: entry.id, model, packages: [module[spec.factory]({ apiKey: `env:${spec.key}` })] };
}

/** The registered providers only; a router alias that picks a model per request is refused. */
export function allowedProviders(criteria, requested) {
  return requested.map((id) => {
    const entry = criteria.providers.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`SkillEvalProvider: ${id} is not allowed (allowed: ${criteria.providers.map((candidate) => candidate.id).join(", ")})`);
    const ref = `${id}/${process.env[entry.modelEnv] ?? entry.defaultModel}`;
    for (const forbidden of criteria.forbiddenProviders) if (ref === forbidden || id === forbidden) throw new Error(`SkillEvalProvider: ${forbidden} is not allowed`);
    return entry;
  });
}

/**
 * Build the agent for one trial of one item in one arm. Both arms get the same packages, tools, skill
 * directories, model and instructions; the no-skill arm only adds `disable.skills`.
 */
export async function buildAgent({ skill, arm, mode, item, provider, criteria, module, preload = false }) {
  const env = await module.createEnvironment({ mode, item });
  const base = env.instructions ? `${ARM_INSTRUCTIONS}\n${env.instructions}` : ARM_INSTRUCTIONS;
  const instructions = preload && arm === "skill" ? `${base}\n${preloadInstruction(skill)}` : base;
  const providerPackages = mode === "offline" ? [providerPackage("skill-eval-offline", [offlineProvider({ skill, item, env })])] : provider.packages;
  const model = mode === "offline" ? { provider: "skill-eval-offline", model: "oracle" } : { provider: provider.id, model: provider.model };
  const agent = await createAgent({
    model,
    instructions,
    packages: [...providerPackages, ...env.packages],
    tools: { add: env.tools },
    skills: { dirs: env.skillDirs },
    limits: { ...criteria.limits, ...(criteria.skills.find((entry) => entry.name === skill)?.limits ?? {}) },
    ownership: { tenantId: "skill-eval" },
    principal: { kind: "user", id: "skill-eval" },
    ...(arm === "no-skill" ? { disable: { skills: [skill] } } : {}),
  });
  return { agent, env, model };
}

// ── one skill, one provider, both arms ──────────────────────────────────────────

/** Diagnostic only (`--dump-dir`): the tool-by-tool transcript of each trial, outside the evidence directory. */
const dumpCounts = new Map();
async function dumpTrial(directory, { skill, arm, item, result, timeline, snapshot }) {
  const key = `${skill}.${arm}.${item.id}`;
  const trial = (dumpCounts.get(key) ?? 0) + 1;
  dumpCounts.set(key, trial);
  await mkdir(resolve(directory), { recursive: true });
  const body = { item: item.id, arm, trial, status: result?.status, stopReason: result?.stopReason, limit: result?.limit, error: result?.error?.message, answer: snapshot?.answer, steps: timeline?.steps };
  await writeFile(join(resolve(directory), `${key}.${trial}.json`), `${JSON.stringify(body, null, 1)}\n`);
}

async function runArm({ skill, arm, mode, provider, criteria, module, dataset, options, split }) {
  const live = new Map();
  const cleanup = async (itemId) => {
    const entry = live.get(itemId);
    if (!entry) return;
    live.delete(itemId);
    await entry.env.dispose().catch(() => undefined);
    await entry.agent.dispose().catch(() => undefined);
  };
  try {
    const report = await runExperiment({
      dataset,
      agent: async ({ item }) => {
        await cleanup(item.id);
        const built = await buildAgent({ skill, arm, mode, item, provider, criteria, module, preload: options.preload === true });
        live.set(item.id, built);
        return built.agent;
      },
      scorers: createScorers({ skill, arm, grade: module.grade }),
      toAgentInput: (input) => String(input),
      timeline: "redacted_io",
      toEnvironment: async (item, result, timeline) => {
        const entry = live.get(item.id);
        if (!entry) return undefined;
        const snapshot = await entry.env.snapshot(result, timeline);
        await cleanup(item.id);
        if (options.dumpDir) await dumpTrial(options.dumpDir, { skill, arm, item, result, timeline, snapshot });
        return { ...snapshot, __run: { status: result?.status, limited: result?.limit !== undefined || result?.stopReason === "turn_limit", stopReason: result?.stopReason, error: result?.error?.message?.slice(0, 200) } };
      },
      trials: options.trials ?? (mode === "dryRun" ? 1 : mode === "offline" ? 1 : criteria.trials),
      seed: criteria.seed,
      concurrency: mode === "offline" ? 4 : criteria.concurrency,
      split,
      manifest: {
        runtimeRevision: gitHead(),
        datasetVersion: dataset.version ?? "1",
        datasetContentHash: dataset.contentHash,
        skillsRevision: skillsRevision(criteria.skills.find((entry) => entry.name === skill).skillDir),
        model: mode === "offline" ? "skill-eval-offline/oracle" : `${provider.id}/${provider.model}`,
      },
      metadata: { skill, arm, mode },
    });
    return report;
  } finally {
    for (const id of [...live.keys()]) await cleanup(id);
  }
}

export function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8", timeout: 10_000 }).trim();
  } catch {
    return "unknown";
  }
}

function costOf(report) {
  const cost = report.aggregate.cost ?? {};
  const mean = cost.meanPerItem ?? {};
  return {
    inputTokens: cost.inputTokens ?? 0,
    cacheReadTokens: cost.cacheReadTokens ?? 0,
    uncachedInputTokens: Math.max(0, (cost.inputTokens ?? 0) - (cost.cacheReadTokens ?? 0)),
    outputTokens: cost.outputTokens ?? 0,
    cost: cost.cost,
    currency: cost.currency,
    costComplete: cost.costComplete ?? false,
    meanDurationMs: mean.durationMs,
    durationMs: cost.durationMs,
  };
}

/** Scored task_success records of one report, with the metadata the scorer attached. */
const taskRecords = (report) => report.evaluations.filter((record) => record.scorerId === "task_success" && record.status === "scored");

/** How many scored runs ended on a run limit, and (skill arm) task success split by whether the skill was loaded. */
function limitAndLoadStats(report, arm) {
  const records = taskRecords(report);
  const sum = (key) => records.reduce((total, record) => total + Number(record.metadata?.[key] ?? 0), 0);
  const stats = { limitedRuns: records.filter((record) => record.metadata?.limited).length, scoredRuns: records.length, toolCalls: sum("toolCalls"), failedCalls: sum("failedCalls") };
  if (arm === "skill") {
    const pass = (list) => list.filter((record) => record.score === 1).length;
    const loaded = records.filter((record) => record.metadata?.loaded === true);
    const unloaded = records.filter((record) => record.metadata?.loaded !== true);
    stats.byLoading = { loaded: { runs: loaded.length, passed: pass(loaded) }, notLoaded: { runs: unloaded.length, passed: pass(unloaded) } };
  }
  return stats;
}

function armSummary(report, arm) {
  const stats = report.aggregate.scorers.task_success;
  return {
    status: report.status,
    taskSuccess: stats ? { mean: stats.mean, ci95: stats.ci95, items: stats.items, records: stats.records } : null,
    failedCount: report.aggregate.failedCount,
    ...limitAndLoadStats(report, arm),
    toolMisuse: toolMisuseTotal(report),
    ...costOf(report),
  };
}

/** Per item: how many scored trials passed in each arm, and the first failure reason, for the evidence table. */
function itemTable(skillReport, noSkillReport) {
  const rows = [];
  for (const entry of skillReport.items) {
    const other = noSkillReport.items.find((candidate) => candidate.item.id === entry.item.id);
    const tally = (item) => {
      const records = (item?.evaluations ?? []).filter((record) => record.scorerId === "task_success");
      return {
        pass: records.filter((record) => record.score === 1).length,
        trials: records.length,
        firstFailure: records.find((record) => record.score !== 1)?.reason,
        unscored: (item?.evaluations ?? []).filter((record) => record.scorerId === "task_success" && record.status !== "scored").length,
        firstError: (item?.evaluations ?? []).find((record) => record.scorerId === "task_success" && record.status !== "scored")?.error?.message?.slice(0, 160),
      };
    };
    const loads = (entry.evaluations ?? []).filter((record) => record.scorerId === "skill_triggered");
    rows.push({ id: entry.item.id, kind: entry.item.expected.kind, skill: tally(entry), noSkill: tally(other), loaded: loads.filter((record) => record.metadata?.loaded).length, loadTrials: loads.length });
  }
  return rows;
}

export async function evaluateSkill({ entry, suite, mode, providers, options }) {
  const { criteria } = suite;
  const { spec, module, dataset } = entry;
  if (!entry.dry) assertShape(criteria, spec.name, dataset.items);
  const split = undefined;
  const results = [];
  for (const provider of providers) {
    const reports = {};
    for (const arm of ARMS) reports[arm] = await runArm({ skill: spec.name, arm, mode, provider, criteria, module, dataset, options, split });
    const decision = decideShip({ skillReport: reports.skill, noSkillReport: reports["no-skill"], criteria });
    results.push({ provider, reports, decision });
  }
  return results;
}

// ── evidence ───────────────────────────────────────────────────────────────────

const pct = (value) => (value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(0)}%`);
const num = (value) => (value === null || value === undefined ? "n/a" : Number(value).toFixed(3));

/** Scale one dry-run arm to the registered full run: per-run tokens times items x trials. */
export function fullRunEstimate(report, fullItems, trials) {
  const runs = Math.max(1, report.items.length * (report.trials?.count ?? 1));
  const cost = report.aggregate.cost ?? {};
  const scale = (fullItems * trials) / runs;
  const round = (value) => Math.round((value ?? 0) * scale);
  return {
    dryRuns: runs,
    fullRuns: fullItems * trials,
    inputTokens: round(cost.inputTokens),
    uncachedInputTokens: round(Math.max(0, (cost.inputTokens ?? 0) - (cost.cacheReadTokens ?? 0))),
    outputTokens: round(cost.outputTokens),
    cost: cost.cost === undefined ? undefined : Number((cost.cost * scale).toFixed(4)),
  };
}

export function evidenceFor({ spec, dataset, results, round, mode, suite, startedAt, lock, fullItems, loading = "natural" }) {
  const providers = results.map(({ provider, reports, decision }) => ({
    provider: provider.id,
    model: mode === "offline" ? "oracle" : provider.model,
    arms: { skill: armSummary(reports.skill, "skill"), "no-skill": armSummary(reports["no-skill"], "no-skill") },
    decision: {
      verdict: decision.verdict,
      roundVerdict: applyRound(decision, round),
      reason: decision.reason,
      comparison: decision.comparison,
      trigger: decision.trigger,
    },
    items: itemTable(reports.skill, reports["no-skill"]),
    ...(mode === "dryRun"
      ? { fullRunEstimate: Object.fromEntries(ARMS.map((arm) => [arm, fullRunEstimate(reports[arm], fullItems, suite.criteria.trials)])) }
      : {}),
  }));
  const final = combineProviders(results, round);
  return {
    skill: spec.name,
    package: spec.package,
    plan: "215 Task 11",
    round,
    mode,
    loading,
    startedAt,
    finishedAt: new Date().toISOString(),
    criteriaHash: suite.criteriaHash,
    criteriaLockedAt: lock?.registeredAt ?? null,
    datasetContentHash: dataset.contentHash,
    datasetVersion: dataset.version,
    skillsRevision: skillsRevision(spec.skillDir),
    runtimeRevision: gitHead(),
    trials: results[0]?.reports.skill.trials?.count ?? 1,
    providers,
    verdict: final,
  };
}

export function evidenceMarkdown(evidence) {
  const lines = [
    `# Skill evaluation: ${evidence.skill}`,
    "",
    `Round ${evidence.round}, ${evidence.mode} run, ${evidence.loading ?? "natural"} loading, started ${evidence.startedAt}. Verdict: **${evidence.verdict}**.`,
    "",
    `- Package: \`${evidence.package}\`; skills revision \`${evidence.skillsRevision.slice(0, 19)}…\`; dataset \`${evidence.datasetContentHash.slice(0, 19)}…\`.`,
    `- Pre-registered criteria hash \`${evidence.criteriaHash.slice(0, 16)}…\`, locked at ${evidence.criteriaLockedAt ?? "(not locked: offline wiring run)"}.`,
    `- Trials per item: ${evidence.trials}. Runtime revision \`${evidence.runtimeRevision.slice(0, 12)}\`.`,
    "",
  ];
  for (const entry of evidence.providers) {
    const a = entry.arms.skill;
    const b = entry.arms["no-skill"];
    const c = entry.decision.comparison;
    lines.push(`## ${entry.provider} (${entry.model})`, "", `Decision: **${entry.decision.verdict}** (${entry.decision.reason}).`, "");
    lines.push("| Arm | task_success | tool_misuse (failed calls) | Input tokens (uncached) | Output tokens | Cost | Mean latency |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const [name, arm] of [["skill", a], ["no-skill", b]]) {
      lines.push(`| ${name} | ${num(arm.taskSuccess?.mean)} | ${arm.toolMisuse} | ${arm.inputTokens} (${arm.uncachedInputTokens}) | ${arm.outputTokens} | ${arm.cost === undefined ? "n/a" : `${arm.cost.toFixed(4)} ${arm.currency ?? ""}${arm.costComplete ? "" : " (incomplete)"}`} | ${arm.meanDurationMs === undefined ? "n/a" : `${Math.round(arm.meanDurationMs)} ms`} |`);
    }
    lines.push("");
    if (c) lines.push(`Paired difference (skill − no-skill) on task_success: ${num(c.difference)}, 95% CI [${num(c.ci95?.low)}, ${num(c.ci95?.high)}], q = ${num(c.qValue)}, ${c.significant ? "significant" : "not significant"}.`, "");
    lines.push(`Runs that ended on a run limit (turns, tool rounds, tool calls or time): skill ${a.limitedRuns}/${a.scoredRuns}, no-skill ${b.limitedRuns}/${b.scoredRuns}.`, "");
    const mean = (arm) => (arm.scoredRuns ? (arm.toolCalls / arm.scoredRuns).toFixed(1) : "n/a");
    lines.push(`Tool calls per run (load_skill excluded), mean: skill ${mean(a)}, no-skill ${mean(b)}.`, "");
    if (a.byLoading) lines.push(`Skill arm task success by loading: loaded ${a.byLoading.loaded.passed}/${a.byLoading.loaded.runs}, not loaded ${a.byLoading.notLoaded.passed}/${a.byLoading.notLoaded.runs}.`, "");
    lines.push(`Skill loading: recall ${pct(entry.decision.trigger.recall)} (${entry.decision.trigger.loadedOnTrigger}/${entry.decision.trigger.triggerTrials} trigger trials), precision ${pct(entry.decision.trigger.precision)}, loaded on ${entry.decision.trigger.loadedOnNonTrigger}/${entry.decision.trigger.nonTriggerTrials} non-trigger trials.`, "");
    if (entry.fullRunEstimate) {
      lines.push("Full-run estimate (items x trials x arm, scaled from this dry run):", "", "| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |", "| --- | --- | --- | --- | --- | --- |");
      for (const [name, estimate] of Object.entries(entry.fullRunEstimate)) lines.push(`| ${name} | ${estimate.fullRuns} | ${estimate.inputTokens} | ${estimate.uncachedInputTokens} | ${estimate.outputTokens} | ${estimate.cost === undefined ? "n/a" : estimate.cost} |`);
      lines.push("");
    }
    lines.push("| Item | Kind | Skill arm | No-skill arm | Loaded | First skill-arm failure |", "| --- | --- | --- | --- | --- | --- |");
    for (const row of entry.items) lines.push(`| ${row.id} | ${row.kind} | ${row.skill.pass}/${row.skill.trials} | ${row.noSkill.pass}/${row.noSkill.trials} | ${row.loaded}/${row.loadTrials} | ${row.skill.firstFailure ?? row.skill.firstError ?? ""} |`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/** Evidence passes `redactSecrets` and then an assertion that no secret value and no key-shaped token remains. */
export function sealEvidence(evidence, secrets) {
  const redacted = redactSecrets(evidence, secrets);
  assertNoSecret(JSON.stringify(redacted), secrets);
  return redacted;
}

export function assertNoSecret(text, secrets) {
  for (const secret of secrets) if (secret && secret.length >= 8 && text.includes(secret)) throw new Error("SkillEvalEvidence: a secret value reached the evidence");
  if (/\bsk-[A-Za-z0-9_-]{16,}/.test(text) || /\bBearer\s+[A-Za-z0-9._-]{20,}/.test(text)) throw new Error("SkillEvalEvidence: a key-shaped token reached the evidence");
}

export function liveSecrets() {
  return SECRET_ENV.map((name) => process.env[name]).filter((value) => typeof value === "string" && value.length > 0);
}

// ── pre-registration ───────────────────────────────────────────────────────────

export async function registrationFor(suite) {
  return {
    criteriaHash: suite.criteriaHash,
    datasets: Object.fromEntries(suite.skills.map((entry) => [entry.spec.name, entry.dataset.contentHash])),
    skills: Object.fromEntries(suite.skills.map((entry) => [entry.spec.name, skillsRevision(entry.spec.skillDir)])),
    registeredAt: new Date().toISOString(),
    gitHead: gitHead(),
  };
}

export function readLock() {
  return existsSync(LOCK_PATH) ? JSON.parse(readFileSync(LOCK_PATH, "utf8")) : undefined;
}

/**
 * A paid run needs a lock whose criteria hash and dataset hashes match the files now on disk. A scored
 * (`--live`) run also needs the criteria, datasets and lock committed, so no decision rule can change after.
 */
export function assertPreregistered(suite, lock, { requireCommitted }) {
  if (!lock) throw new Error("SkillEvalPrereg: criteria.lock.json is missing; run --register first");
  if (lock.criteriaHash !== suite.criteriaHash) throw new Error("SkillEvalPrereg: criteria.json changed after it was locked");
  for (const entry of suite.skills)
    if (lock.datasets[entry.spec.name] !== entry.dataset.contentHash) throw new Error(`SkillEvalPrereg: the ${entry.spec.name} dataset changed after the lock`);
  if (requireCommitted) {
    const status = execFileSync("git", ["status", "--porcelain", "--", "scripts/skill-evals/criteria.json", "scripts/skill-evals/criteria.lock.json", "scripts/skill-evals/datasets"], { cwd: REPO, encoding: "utf8", timeout: 10_000 });
    if (status.trim() !== "") throw new Error("SkillEvalPrereg: criteria, lock and datasets must be committed before a scored run");
  }
}

// ── main ───────────────────────────────────────────────────────────────────────

export async function run(argv = process.argv.slice(2)) {
  const options = Array.isArray(argv) ? parseArgs(argv) : argv;
  if (options.help) {
    console.log("bun scripts/skill-evals/run.mjs --offline | --register | --dry-run --providers a,b | --live --providers a,b [--skill name] [--round 1|2]");
    return undefined;
  }
  const suite = await loadSuite(options.skill);
  for (const entry of suite.skills) assertShape(suite.criteria, entry.spec.name, entry.dataset.items);
  if (options.register) {
    const registration = await registrationFor(suite);
    await writeFile(LOCK_PATH, `${JSON.stringify(registration, null, 2)}\n`);
    console.log(`locked criteria ${registration.criteriaHash.slice(0, 16)}… for ${suite.skills.length} skills; commit criteria.json, criteria.lock.json and datasets/ before a scored run`);
    return registration;
  }
  const mode = options.offline ? "offline" : options.dryRun ? "dryRun" : "live";
  const lock = readLock();
  if (mode !== "offline") assertPreregistered(suite, lock, { requireCommitted: mode === "live" });
  const providers = mode === "offline" ? [{ id: "offline", model: "oracle", packages: [] }] : await Promise.all(allowedProviders(suite.criteria, options.providers).map(liveProvider));
  const round = options.round ?? 1;
  const outDir = options.outDir ? resolve(options.outDir) : mode === "offline" ? undefined : EVIDENCE_DIR;
  const secrets = liveSecrets();
  const summaries = [];
  for (const entry of suite.skills) {
    const startedAt = new Date().toISOString();
    let runEntry = entry;
    if (options.items) {
      const wanted = new Set(options.items.split(","));
      const items = entry.module.items.filter((item) => wanted.has(item.id));
      if (items.length === 0) throw new Error(`SkillEvalDataset: no item of ${entry.spec.name} matches --items ${options.items}`);
      runEntry = { ...entry, dataset: defineDataset({ id: entry.dataset.id, version: entry.dataset.version, items }), dry: true };
    }
    if (mode === "dryRun") {
      const limit = Math.min(suite.criteria.costGate.dryRunItems, options.maxItems ?? 99);
      const triggers = entry.module.items.filter((item) => item.expected.kind === "trigger");
      const others = entry.module.items.filter((item) => item.expected.kind !== "trigger");
      const items = [...triggers.slice(0, Math.max(1, limit - 1)), ...others.slice(0, 1)].slice(0, limit);
      runEntry = { ...entry, dataset: defineDataset({ id: entry.dataset.id, version: entry.dataset.version, items }), dry: true };
    }
    const results = await evaluateSkill({ entry: { ...runEntry, spec: entry.spec }, suite, mode: mode === "dryRun" ? "live" : mode, providers, options: { ...options, trials: mode === "dryRun" ? 1 : options.trials } });
    const evidence = sealEvidence(evidenceFor({ spec: entry.spec, dataset: runEntry.dataset, results, round, mode, suite, startedAt, lock, fullItems: entry.dataset.items.length, loading: options.preload ? "preload" : "natural" }), secrets);
    summaries.push(evidence);
    if (outDir) {
      await mkdir(outDir, { recursive: true });
      const suffix = `${mode === "dryRun" ? ".dry-run" : round > 1 ? `.round${round}` : ""}${options.preload ? ".preload" : ""}`;
      await writeFile(join(outDir, `${entry.spec.name}${suffix}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
      const markdown = evidenceMarkdown(evidence);
      assertNoSecret(markdown, secrets);
      await writeFile(join(outDir, `${entry.spec.name}${suffix}.md`), markdown);
    }
    console.log(`${entry.spec.name}: ${evidence.verdict}`);
  }
  return { mode, round, summaries };
}

if (import.meta.main) {
  run().then((result) => {
    if (result?.summaries) console.log(JSON.stringify(result.summaries.map((summary) => ({ skill: summary.skill, verdict: summary.verdict })), null, 2));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
