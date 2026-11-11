#!/usr/bin/env bun
/**
 * Host-builder evaluation (plan 215 Task 20): a Prism builder agent on fixture tasks in three arms (`none`, `skill`,
 * `skill+mcp`), graded by hidden tests and checks the builder never sees.
 *
 *   bun scripts/host-builder-evals/run.mjs --offline                      # scripted oracle, CI-safe
 *   bun scripts/host-builder-evals/run.mjs --register                     # write criteria.lock.json (then commit it)
 *   bun scripts/host-builder-evals/run.mjs --dry-run --providers hyper    # three tasks, one trial: the cost estimate
 *   bun scripts/host-builder-evals/run.mjs --live --providers hyper,opencode-go
 *
 * Paid runs use the providers in criteria.json only, with keys from ~/.config/prism/live.env.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createAgent, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { defineDataset, runExperiment } from "@arnilo/prism-hosts/evals";
import { contextFiles } from "@arnilo/prism-extensions/context-files";
import { mcp } from "@arnilo/prism-extensions/mcp";
import { toolsCoding } from "@arnilo/prism-tools/coding";
import {
  allowedProviders,
  assertNoSecret,
  fullRunEstimate,
  gitHead,
  liveProvider,
  liveSecrets,
  sealEvidence,
} from "../skill-evals/run.mjs";
import {
  ARMS,
  applyRound,
  BIN,
  buildWorkspace,
  checkWorkspace,
  createScorers,
  decideClaims,
  disposeStaged,
  EVIDENCE_DIR,
  installRateLimitedFetch,
  LIVE_MIN_INTERVAL_MS,
  LOCK_PATH,
  loadCriteria,
  REPO,
  registeredInputs,
  SOLUTIONS,
} from "./lib.mjs";

export const SKILL_NAME = "prism-host-builder";
export const MCP_SERVER_ID = "prism-host-builder";

export function parseArgs(argv) {
  const options = { providers: [] };
  const flags = new Set(["providers", "round", "out-dir", "trials", "tasks", "dump-dir"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--offline", "--live", "--dry-run", "--register", "--help", "--preload"].includes(arg)) {
      options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = true;
      continue;
    }
    if (!arg.startsWith("--") || !flags.has(arg.slice(2)) || argv[index + 1] === undefined || argv[index + 1].startsWith("--"))
      throw new TypeError(`HostBuilderEvalArguments: unknown flag or missing value: ${arg}`);
    options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++index];
  }
  options.providers = typeof options.providers === "string" ? options.providers.split(",").filter(Boolean) : [];
  for (const key of ["round", "trials"]) {
    if (options[key] === undefined) continue;
    options[key] = Number(options[key]);
    if (!Number.isSafeInteger(options[key]) || options[key] < 1)
      throw new TypeError(`HostBuilderEvalArguments: ${key} must be a positive integer`);
  }
  const modes = ["offline", "live", "dryRun", "register"].filter((mode) => options[mode]);
  if (!options.help && modes.length !== 1)
    throw new TypeError("HostBuilderEvalArguments: pick exactly one of --offline, --live, --dry-run, --register");
  if ((options.live || options.dryRun) && options.providers.length === 0)
    throw new TypeError("HostBuilderEvalArguments: --providers is required for a paid run");
  return options;
}

// ── dataset ────────────────────────────────────────────────────────────────────

export function loadSuite() {
  const { criteria, hash } = loadCriteria();
  const items = criteria.tasks.map((task) => ({ id: task.id, input: task.prompt, expected: { task: task.id } }));
  const dataset = defineDataset({
    id: "host-builder-eval",
    version: String(criteria.version),
    canary: "prism-host-builder-eval-canary-9b2e",
    items,
  });
  return { criteria, criteriaHash: hash, dataset, tasks: criteria.tasks };
}

/** Every solution file of a task, as `{ path, content }`: the oracle the offline provider writes. */
export function solutionFiles(task) {
  const root = join(SOLUTIONS, task);
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push({ path: relative(root, path), content: readFileSync(path, "utf8") });
    }
  };
  walk(root);
  return files;
}

// ── the builder ────────────────────────────────────────────────────────────────

const hasCall = (request, name) =>
  request.messages.some(
    (message) => message.role === "assistant" && (message.content ?? []).some((block) => block.type === "tool_call" && block.name === name),
  );

/**
 * The scripted provider: load the skill and look one name up when the arm offers them, write the task's solution
 * files through the real write tool, then answer. It exercises the arms, the workspaces, the hidden checks and the
 * scorers; it says nothing about model behavior.
 */
export function offlineProvider({ task }) {
  return {
    id: "host-builder-eval-offline",
    async *generate(request) {
      const names = (request.tools ?? []).map((tool) => tool.name);
      const lookup = `mcp:${MCP_SERVER_ID}:prism_api`;
      if (names.includes("load_skill") && !hasCall(request, "load_skill")) {
        yield providerToolCall(toolCallContent("offline_skill", "load_skill", { name: SKILL_NAME }));
        yield providerDone();
        return;
      }
      if (names.includes(lookup) && !hasCall(request, lookup)) {
        yield providerToolCall(toolCallContent("offline_lookup", lookup, { symbol: "createAgent" }));
        yield providerDone();
        return;
      }
      if (!hasCall(request, "write")) {
        for (const [index, file] of solutionFiles(task).entries())
          yield providerToolCall(toolCallContent(`offline_write_${index}`, "write", { path: file.path, content: file.content }));
        yield providerDone();
        return;
      }
      yield providerTextDelta("Wrote the solution files.");
      yield providerDone();
    },
  };
}

/** The packages one arm adds on top of the shared builder: nothing for `none`, the MCP server for `skill+mcp`. */
export function armPackages(arm, dir) {
  const packages = [toolsCoding({ root: dir }), contextFiles({ root: dir })];
  if (arm === "skill+mcp") {
    packages.push(
      mcp({
        servers: [
          {
            id: MCP_SERVER_ID,
            transport: "stdio",
            command: process.execPath,
            args: [BIN, "mcp", "--root", dir],
            allow: "stdio",
            connectTimeoutMs: 30_000,
          },
        ],
      }),
    );
  }
  return packages;
}

export async function buildBuilder({ task, arm, mode, provider, criteria, preload = false }) {
  const workspace = buildWorkspace({ task, arm });
  try {
    const providerPackages =
      mode === "offline" ? [providerPackage("host-builder-eval-offline", [offlineProvider({ task })])] : provider.packages;
    const model =
      mode === "offline" ? { provider: "host-builder-eval-offline", model: "oracle" } : { provider: provider.id, model: provider.model };
    const agent = await createAgent({
      model,
      instructions:
        preload && arm !== "none"
          ? `${criteria.builder.instructions}\n${criteria.builder.preloadInstruction}`
          : criteria.builder.instructions,
      packages: [...providerPackages, ...armPackages(arm, workspace.dir)],
      limits: { ...criteria.builder.limits },
      ownership: { tenantId: "host-builder-eval" },
      principal: { kind: "user", id: "host-builder-eval" },
    });
    return { agent, workspace };
  } catch (error) {
    workspace.dispose();
    throw error;
  }
}

// ── one arm on one provider ────────────────────────────────────────────────────

async function dumpTrial(directory, { arm, item, result, timeline, checks }) {
  await mkdir(resolve(directory), { recursive: true });
  const body = {
    item: item.id,
    arm,
    status: result?.status,
    stopReason: result?.stopReason,
    limit: result?.limit,
    error: result?.error?.message,
    steps: timeline?.steps,
    checks,
  };
  await writeFile(join(resolve(directory), `${arm.replace("+", "-")}.${item.id}.${Date.now()}.json`), `${JSON.stringify(body, null, 1)}\n`);
}

async function runArm({ arm, mode, provider, suite, options, dataset }) {
  const { criteria } = suite;
  const live = new Map();
  const cleanup = async (itemId) => {
    const entry = live.get(itemId);
    if (!entry) return;
    live.delete(itemId);
    await entry.agent.dispose().catch(() => undefined);
    entry.workspace.dispose();
  };
  try {
    return await runExperiment({
      dataset,
      agent: async ({ item }) => {
        await cleanup(item.id);
        const built = await buildBuilder({ task: item.id, arm, mode, provider, criteria, preload: options.preload === true });
        live.set(item.id, built);
        return built.agent;
      },
      scorers: createScorers(),
      toAgentInput: (input) => String(input),
      timeline: "redacted_io",
      toEnvironment: async (item, result, timeline) => {
        const entry = live.get(item.id);
        if (!entry) return undefined;
        const spec = suite.tasks.find((task) => task.id === item.id)?.checks ?? {};
        const checks = checkWorkspace({ dir: entry.workspace.dir, task: item.id, spec });
        if (options.dumpDir) await dumpTrial(options.dumpDir, { arm, item, result, timeline, checks });
        await cleanup(item.id);
        return {
          checks,
          __run: {
            status: result?.status,
            limited: result?.limit !== undefined || result?.stopReason === "turn_limit",
            stopReason: result?.stopReason,
            error: result?.error?.message?.slice(0, 200),
          },
        };
      },
      trials: options.trials ?? (mode === "dryRun" ? criteria.costGate.dryRunTrials : mode === "offline" ? 1 : criteria.trials),
      seed: criteria.seed,
      concurrency: mode === "offline" ? 3 : criteria.concurrency,
      manifest: {
        runtimeRevision: gitHead(),
        datasetVersion: dataset.version ?? "1",
        datasetContentHash: dataset.contentHash,
        skillsRevision: registeredInputs().skill,
        model: mode === "offline" ? "host-builder-eval-offline/oracle" : `${provider.id}/${provider.model}`,
      },
      metadata: { arm, mode },
    });
  } finally {
    for (const id of [...live.keys()]) await cleanup(id);
  }
}

export async function evaluate({ suite, mode, providers, options, dataset = suite.dataset }) {
  const results = [];
  for (const provider of providers) {
    const reports = {};
    for (const arm of ARMS) reports[arm] = await runArm({ arm, mode, provider, suite, options, dataset });
    results.push({ provider, reports, decision: decideClaims({ reports, criteria: suite.criteria }) });
  }
  return results;
}

// ── evidence ───────────────────────────────────────────────────────────────────

const SCORER_IDS = ["typecheck_passes", "acceptance_tests_pass", "public_surface_only", "no_retired_names"];
const records = (report, id) => report.evaluations.filter((record) => record.scorerId === id && record.status === "scored");

function armSummary(report) {
  const accept = records(report, "acceptance_tests_pass");
  const sum = (key) => accept.reduce((total, record) => total + Number(record.metadata?.[key] ?? 0), 0);
  const cost = report.aggregate.cost ?? {};
  const loaded = accept.filter((record) => record.metadata?.loadedSkill === true);
  const unloaded = accept.filter((record) => record.metadata?.loadedSkill !== true);
  const pass = (list) => list.filter((record) => record.score === 1).length;
  return {
    status: report.status,
    scorers: Object.fromEntries(
      SCORER_IDS.map((id) => [
        id,
        report.aggregate.scorers[id]
          ? {
              mean: report.aggregate.scorers[id].mean,
              ci95: report.aggregate.scorers[id].ci95,
              records: report.aggregate.scorers[id].records,
            }
          : null,
      ]),
    ),
    failedCount: report.aggregate.failedCount,
    scoredRuns: accept.length,
    limitedRuns: accept.filter((record) => record.metadata?.limited).length,
    toolCalls: sum("toolCalls"),
    skillLoadedRuns: loaded.length,
    mcpUsedRuns: accept.filter((record) => record.metadata?.usedMcp === true).length,
    acceptanceByLoading: {
      loaded: { runs: loaded.length, passed: pass(loaded) },
      notLoaded: { runs: unloaded.length, passed: pass(unloaded) },
    },
    inputTokens: cost.inputTokens ?? 0,
    cacheReadTokens: cost.cacheReadTokens ?? 0,
    uncachedInputTokens: Math.max(0, (cost.inputTokens ?? 0) - (cost.cacheReadTokens ?? 0)),
    outputTokens: cost.outputTokens ?? 0,
    cost: cost.cost,
    currency: cost.currency,
    costComplete: cost.costComplete ?? false,
    meanDurationMs: cost.meanPerItem?.durationMs,
    durationMs: cost.durationMs,
  };
}

function taskTable(reports) {
  return reports.none.items.map((entry) => {
    const row = { id: entry.item.id, arms: {} };
    for (const arm of ARMS) {
      const item = reports[arm].items.find((candidate) => candidate.item.id === entry.item.id);
      const counts = {};
      let firstFailure;
      for (const id of SCORER_IDS) {
        const scored = (item?.evaluations ?? []).filter((record) => record.scorerId === id && record.status === "scored");
        counts[id] = `${scored.filter((record) => record.score === 1).length}/${scored.length}`;
        firstFailure ??= scored.find((record) => record.score !== 1)?.reason;
      }
      const unscored = (item?.evaluations ?? []).filter(
        (record) => record.scorerId === "acceptance_tests_pass" && record.status !== "scored",
      );
      const firstError = unscored
        .find((record) => record.error?.message)
        ?.error?.message?.replace(/\s+/g, " ")
        .slice(0, 240);
      row.arms[arm] = { ...counts, firstFailure, unscored: unscored.length, firstError };
    }
    return row;
  });
}

export function evidenceFor({ results, round, mode, suite, startedAt, lock, fullTasks, dataset, loading = "natural" }) {
  const providers = results.map(({ provider, reports, decision }) => ({
    provider: provider.id,
    model: mode === "offline" ? "oracle" : provider.model,
    arms: Object.fromEntries(ARMS.map((arm) => [arm, armSummary(reports[arm])])),
    decision: {
      verdict: decision.verdict,
      roundVerdict: applyRound(decision, round),
      reason: decision.reason,
      comparisons: decision.comparisons,
      claims: decision.claims,
      regressions: decision.regressions,
    },
    tasks: taskTable(reports),
    ...(mode === "dryRun"
      ? { fullRunEstimate: Object.fromEntries(ARMS.map((arm) => [arm, fullRunEstimate(reports[arm], fullTasks, suite.criteria.trials)])) }
      : {}),
  }));
  const verdicts = results.map(({ decision }) => applyRound(decision, round));
  const verdict = verdicts.includes("owner-decision")
    ? "owner-decision"
    : verdicts.includes("fix-and-remeasure")
      ? "fix-and-remeasure"
      : verdicts.includes("inconclusive")
        ? "inconclusive"
        : verdicts.every((value) => value === "claims")
          ? "claims"
          : "no-claims";
  return {
    plan: "215 Task 20",
    round,
    mode,
    loading,
    startedAt,
    finishedAt: new Date().toISOString(),
    criteriaHash: suite.criteriaHash,
    criteriaLockedAt: lock?.registeredAt ?? null,
    datasetContentHash: dataset.contentHash,
    inputs: registeredInputs(),
    runtimeRevision: gitHead(),
    trials: results[0]?.reports.none.trials?.count ?? 1,
    providers,
    verdict,
  };
}

const num = (value) => (value === null || value === undefined ? "n/a" : Number(value).toFixed(3));

export function evidenceMarkdown(evidence) {
  const lines = [
    "# Host-builder evaluation",
    "",
    `Round ${evidence.round}, ${evidence.mode} run, ${evidence.loading ?? "natural"} loading, started ${evidence.startedAt}. Verdict: **${evidence.verdict}**.`,
    "",
    `- Pre-registered criteria hash \`${evidence.criteriaHash.slice(0, 16)}…\`, locked at ${evidence.criteriaLockedAt ?? "(not locked: offline wiring run)"}.`,
    `- Trials per task: ${evidence.trials}. Runtime revision \`${evidence.runtimeRevision.slice(0, 12)}\`. Skill \`${evidence.inputs.skill.slice(0, 19)}…\`, indexes \`${evidence.inputs.indexes.slice(0, 19)}…\`.`,
    "",
  ];
  for (const entry of evidence.providers) {
    lines.push(`## ${entry.provider} (${entry.model})`, "", `Decision: **${entry.decision.verdict}** (${entry.decision.reason}).`, "");
    lines.push(
      "| Arm | " +
        SCORER_IDS.join(" | ") +
        " | Tool calls/run | Skill loaded | MCP used | Limit hits | Input tokens (uncached) | Output tokens | Cost | Mean wall |",
      `| --- |${" --- |".repeat(SCORER_IDS.length + 8)}`,
    );
    for (const arm of ARMS) {
      const a = entry.arms[arm];
      const perRun = a.scoredRuns ? (a.toolCalls / a.scoredRuns).toFixed(1) : "n/a";
      lines.push(
        `| ${arm} | ${SCORER_IDS.map((id) => num(a.scorers[id]?.mean)).join(" | ")} | ${perRun} | ${a.skillLoadedRuns}/${a.scoredRuns} | ${a.mcpUsedRuns}/${a.scoredRuns} | ${a.limitedRuns}/${a.scoredRuns} | ${a.inputTokens} (${a.uncachedInputTokens}) | ${a.outputTokens} | ${a.cost === undefined ? "n/a" : `${a.cost.toFixed(4)} ${a.currency ?? ""}${a.costComplete ? "" : " (incomplete)"}`} | ${a.meanDurationMs === undefined ? "n/a" : `${Math.round(a.meanDurationMs)} ms`} |`,
      );
    }
    lines.push("");
    for (const comparison of entry.decision.comparisons ?? []) {
      lines.push(
        `**${comparison.candidate} − ${comparison.baseline}**`,
        "",
        "| Scorer | Difference | 95% CI | q | Verdict |",
        "| --- | --- | --- | --- | --- |",
      );
      for (const [id, value] of Object.entries(comparison.scorers)) {
        lines.push(
          `| ${id} | ${num(value.difference)} | [${num(value.ci95?.low)}, ${num(value.ci95?.high)}] | ${num(value.qValue)} | ${value.improved ? "improved" : value.regressed ? "regressed" : value.significant ? "significant" : "not significant"} |`,
        );
      }
      lines.push("");
    }
    if (entry.decision.claims?.length)
      lines.push(
        "Claims that passed:",
        "",
        ...entry.decision.claims.map((claim) => `- ${claim.text} (${claim.scorer}, +${num(claim.difference)}, ${claim.comparison})`),
        "",
      );
    if (entry.fullRunEstimate) {
      lines.push(
        "Full-run estimate (tasks x trials x arm, scaled from this dry run):",
        "",
        "| Arm | Runs | Input tokens | Uncached input | Output tokens | Cost |",
        "| --- | --- | --- | --- | --- | --- |",
      );
      for (const [name, estimate] of Object.entries(entry.fullRunEstimate))
        lines.push(
          `| ${name} | ${estimate.fullRuns} | ${estimate.inputTokens} | ${estimate.uncachedInputTokens} | ${estimate.outputTokens} | ${estimate.cost === undefined ? "n/a" : estimate.cost} |`,
        );
      lines.push("");
    }
    lines.push(
      "| Task | Arm | typecheck | acceptance | surface | retired | First failure |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const row of entry.tasks)
      for (const arm of ARMS)
        lines.push(
          `| ${row.id} | ${arm} | ${SCORER_IDS.map((id) => row.arms[arm][id]).join(" | ")} | ${(row.arms[arm].unscored ? `UNSCORED x${row.arms[arm].unscored}: ${row.arms[arm].firstError ?? "no error text"}` : String(row.arms[arm].firstFailure ?? "").replace(/\s+/g, " ")).slice(0, 200)} |`,
        );
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

// ── pre-registration ───────────────────────────────────────────────────────────

export function registrationFor(suite) {
  return { criteriaHash: suite.criteriaHash, inputs: registeredInputs(), registeredAt: new Date().toISOString(), gitHead: gitHead() };
}

export function readLock() {
  return existsSync(LOCK_PATH) ? JSON.parse(readFileSync(LOCK_PATH, "utf8")) : undefined;
}

const REGISTERED_PATHS = ["scripts/host-builder-evals", "packages/hosts/host-builder/skills", "packages/hosts/host-builder/data"];

/**
 * A paid run needs a lock whose criteria hash and input hashes match the files now on disk. A scored (`--live`) run
 * also needs those files committed, so no decision rule, fixture or hidden test can change after the lock.
 */
export function assertPreregistered(suite, lock, { requireCommitted }) {
  if (!lock) throw new Error("HostBuilderEvalPrereg: criteria.lock.json is missing; run --register first");
  if (lock.criteriaHash !== suite.criteriaHash) throw new Error("HostBuilderEvalPrereg: criteria.json changed after it was locked");
  const now = registeredInputs();
  for (const [name, hash] of Object.entries(lock.inputs ?? {}))
    if (now[name] !== hash) throw new Error(`HostBuilderEvalPrereg: ${name} changed after the lock`);
  if (requireCommitted) {
    const status = execFileSync("git", ["status", "--porcelain", "--", ...REGISTERED_PATHS], {
      cwd: REPO,
      encoding: "utf8",
      timeout: 10_000,
    });
    if (status.trim() !== "")
      throw new Error("HostBuilderEvalPrereg: the evaluation files, the skill and the indexes must be committed before a scored run");
  }
}

// ── main ───────────────────────────────────────────────────────────────────────

export async function run(argv = process.argv.slice(2)) {
  const options = Array.isArray(argv) ? parseArgs(argv) : argv;
  if (options.help) {
    console.log(
      "bun scripts/host-builder-evals/run.mjs --offline | --register | --dry-run --providers a,b | --live --providers a,b [--round 1|2] [--tasks a,b] [--trials n] [--preload]",
    );
    return undefined;
  }
  const suite = loadSuite();
  if (options.register) {
    const registration = registrationFor(suite);
    await writeFile(LOCK_PATH, `${JSON.stringify(registration, null, 2)}\n`);
    console.log(
      `locked criteria ${registration.criteriaHash.slice(0, 16)}… for ${suite.tasks.length} tasks; commit scripts/host-builder-evals before a scored run`,
    );
    return registration;
  }
  const mode = options.offline ? "offline" : options.dryRun ? "dryRun" : "live";
  const lock = readLock();
  if (mode !== "offline") assertPreregistered(suite, lock, { requireCommitted: mode === "live" });
  const providers =
    mode === "offline"
      ? [{ id: "offline", model: "oracle", packages: [] }]
      : await Promise.all(allowedProviders(suite.criteria, options.providers).map(liveProvider));
  const round = options.round ?? 1;
  const outDir = options.outDir ? resolve(options.outDir) : mode === "offline" ? undefined : EVIDENCE_DIR;
  const secrets = liveSecrets();
  let items = suite.dataset.items;
  if (mode === "dryRun") items = items.filter((item) => suite.criteria.costGate.dryRunTaskIds.includes(item.id));
  if (options.tasks) {
    const wanted = new Set(options.tasks.split(","));
    items = items.filter((item) => wanted.has(item.id));
    if (items.length === 0) throw new Error(`HostBuilderEvalTasks: no task matches --tasks ${options.tasks}`);
  }
  const dataset =
    items.length === suite.dataset.items.length
      ? suite.dataset
      : defineDataset({ id: suite.dataset.id, version: suite.dataset.version, items });
  const startedAt = new Date().toISOString();
  const restoreFetch = mode === "offline" ? undefined : installRateLimitedFetch({ minIntervalMs: LIVE_MIN_INTERVAL_MS });
  try {
    const results = await evaluate({
      suite,
      mode: mode === "dryRun" ? "live" : mode,
      providers,
      options: { ...options, trials: mode === "dryRun" ? suite.criteria.costGate.dryRunTrials : options.trials },
      dataset,
    });
    const evidence = sealEvidence(
      evidenceFor({
        results,
        round,
        mode,
        suite,
        startedAt,
        lock,
        fullTasks: suite.tasks.length,
        dataset,
        loading: options.preload ? "preload" : "natural",
      }),
      secrets,
    );
    if (outDir) {
      await mkdir(outDir, { recursive: true });
      const markdown = evidenceMarkdown(evidence);
      assertNoSecret(markdown, secrets);
      const suffix = `${mode === "dryRun" ? ".dry-run" : round > 1 ? `.round${round}` : ""}${options.preload ? ".preload" : ""}`;
      const name = `${options.providers.join("+") || "run"}${suffix}`;
      await writeFile(join(outDir, `${name}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
      await writeFile(join(outDir, `${name}.md`), markdown);
    }
    console.log(`host-builder-evals: ${evidence.verdict}`);
    return { mode, round, evidence };
  } finally {
    restoreFetch?.();
    disposeStaged();
  }
}

if (import.meta.main) {
  run()
    .then((result) => {
      if (result?.evidence)
        console.log(
          JSON.stringify(
            {
              verdict: result.evidence.verdict,
              providers: result.evidence.providers.map((entry) => ({ provider: entry.provider, verdict: entry.decision.verdict })),
            },
            null,
            2,
          ),
        );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
