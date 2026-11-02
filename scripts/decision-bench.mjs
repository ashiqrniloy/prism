#!/usr/bin/env node
/**
 * Decision-model bench (plan 196 Task 3) — live, never in `release:gate`.
 *
 * Runs the checked-in `scripts/fixtures/decision-bench.jsonl` set (200 labelled
 * Prism-shaped items: tool choice, route choice, "did this tool result fail",
 * approval-risk score) through the public `prism.models.decisions()` contract,
 * once per model, plus one option-reversed repeat for choice items.
 *
 * Reports accuracy, ECE (10 equal-width bins), Brier, p50/p95 latency, the
 * flip rate under reversed option order, hosted input-token cost, and the
 * hosted-vs-local agreement rate over shared items. Writes
 * `docs/_evidence/decision-bench-<date>.md`.
 *
 * Usage:
 *   bun scripts/decision-bench.mjs                     # default model list
 *   bun scripts/decision-bench.mjs --check             # validate + print the request plan, no network
 *   bun scripts/decision-bench.mjs --models liquid/d1.1 --limit 20 --no-flip
 *   bun scripts/decision-bench.mjs --memory --models liquid-local/d1-3B@Q4_K_M
 *   bun scripts/decision-bench.mjs --models "liquid-local/d1-3B@Q4_K_M" --out /tmp/bench.md
 *
 * Credentials: only from the environment or the live env file
 * ($PRISM_LIVE_ENV_FILE, default ~/.config/prism/live.env).
 * Values are never printed. A model whose credential/server is missing is skipped
 * with a reason; nothing is fabricated.
 *
 * Quant selection: `liquid-local/d1-3B@Q8_0` / `@Q4_K_M` pick
 * `PRISM_LIVE_LLAMA_SERVER_Q8_URL` / `_Q4_URL` when set, else the shared
 * `PRISM_LIVE_LLAMA_SERVER_URL`; the report records which quant answered.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgent, definePackage } from "@arnilo/prism";
import { LAYA_DEFAULT_BASE_URL, laya } from "@arnilo/prism-provider-laya";
import { liquid } from "@arnilo/prism-provider-liquid";
import { typesafe } from "@arnilo/prism-provider-typesafe";
import { parseEnvFile } from "./live-matrix.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "scripts/fixtures/decision-bench.jsonl");
const MEMORY_FIXTURES = join(ROOT, "scripts/fixtures/decision-bench-memory.jsonl");
const MEMORY_POINTS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
const MIN_MEMORY_ITEMS_PER_POINT = 100;
const EVIDENCE_DIR = join(ROOT, "docs/_evidence");

/** USD per million input tokens, from the vendor pages recorded in provider READMEs. */
const PRICES = { "liquid/d1": 0.02, "liquid/d1.1": 0.02, "liquid/d1-ultra": 0.042 };
const DEFAULT_MODELS = [
  "liquid-local/d1-3B@Q8_0",
  "liquid-local/d1-3B@Q4_K_M",
  "laya/laya",
  "liquid/d1.1",
  "liquid/d1-ultra",
  "liquid/d1",
  "typesafe/jev-latest",
];
const MIN_ITEMS = 150;
const MAX_ITEMS = 300;

export function loadItems(path = FIXTURES) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      const item = JSON.parse(line);
      return { ...item, line: index + 1 };
    });
}

/** The plan 202 Task 12 memory-gate set: >=100 labelled items per decision point. */
export function loadMemoryItems(path = MEMORY_FIXTURES) {
  return loadItems(path);
}

/** Structural checks specific to the per-point memory set. */
export function validateMemoryItems(items) {
  const problems = [];
  const seen = new Set();
  const counts = Object.fromEntries(MEMORY_POINTS.map((point) => [point, 0]));
  for (const item of items) {
    if (seen.has(item.id)) problems.push(`duplicate id ${item.id}`);
    seen.add(item.id);
    if (!MEMORY_POINTS.includes(item.point)) problems.push(`${item.id}: unknown point ${JSON.stringify(item.point)}`);
    else counts[item.point] += 1;
    const q = item.question;
    if (!q || typeof q.instructions !== "string" || !q.instructions.trim()) problems.push(`${item.id}: missing instructions`);
    if (q?.type === "choice") {
      const options = Object.keys(q.criteria ?? {});
      if (options.length < 2 || options.length > 255) problems.push(`${item.id}: choice needs 2-255 options`);
      if (!options.includes(item.label)) problems.push(`${item.id}: label ${JSON.stringify(item.label)} is not one of its options`);
    } else if (q?.type === "noul") {
      if (typeof item.label !== "boolean") problems.push(`${item.id}: noul label must be boolean`);
    } else {
      problems.push(`${item.id}: unsupported question type ${JSON.stringify(q?.type)}`);
    }
  }
  for (const point of MEMORY_POINTS) {
    if (counts[point] < MIN_MEMORY_ITEMS_PER_POINT)
      problems.push(`${point}: expected >= ${MIN_MEMORY_ITEMS_PER_POINT} items, got ${counts[point]}`);
  }
  const p2 = items.filter((item) => item.point === "P2");
  if (!p2.some((item) => item.reversed === true)) problems.push("P2: option-order-reversed repeats are missing");
  return problems;
}

/** Structural + labelling checks on the checked-in set. Returns a list of problems. */
export function validateItems(items) {
  const problems = [];
  if (items.length < MIN_ITEMS || items.length > MAX_ITEMS) problems.push(`expected ${MIN_ITEMS}-${MAX_ITEMS} items, got ${items.length}`);
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) problems.push(`duplicate id ${item.id}`);
    seen.add(item.id);
    const q = item.question;
    if (!q || typeof q.instructions !== "string" || !q.instructions.trim()) problems.push(`${item.id}: missing instructions`);
    if (q?.type === "choice") {
      const options = Object.keys(q.criteria ?? {});
      if (options.length < 2 || options.length > 255) problems.push(`${item.id}: choice needs 2-255 options`);
      if (!options.includes(item.label)) problems.push(`${item.id}: label ${JSON.stringify(item.label)} is not one of its options`);
    } else if (q?.type === "noul") {
      if (typeof item.label !== "boolean") problems.push(`${item.id}: noul label must be boolean`);
    } else if (q?.type === "score") {
      const levels = q.criteria ?? [];
      if (levels.length < 2 || levels.length > 10) problems.push(`${item.id}: score needs 2-10 levels`);
      if (!levels.includes(item.label)) problems.push(`${item.id}: label ${JSON.stringify(item.label)} is not one of its levels`);
    } else {
      problems.push(`${item.id}: unknown question type ${JSON.stringify(q?.type)}`);
    }
  }
  return problems;
}

/** Nearest-rank percentile; `values` is not mutated. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** Expected calibration error over `bins` equal-width buckets. Pairs are [p, y] with p, y in 0..1. */
export function ece(pairs, bins = 10) {
  if (pairs.length === 0) return null;
  const buckets = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 }));
  for (const [p, y] of pairs) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor(p * bins)));
    const bucket = buckets[index];
    bucket.n += 1;
    bucket.p += p;
    bucket.y += y;
  }
  let total = 0;
  for (const bucket of buckets) {
    if (bucket.n === 0) continue;
    total += (bucket.n / pairs.length) * Math.abs(bucket.p / bucket.n - bucket.y / bucket.n);
  }
  return total;
}

/** Brier score for probability/label pairs. */
export function brier(pairs) {
  if (pairs.length === 0) return null;
  return pairs.reduce((sum, [p, y]) => sum + (p - y) ** 2, 0) / pairs.length;
}

/**
 * Turn one answer into { correct, p, y } or null when the answer is unusable.
 * - noul:  p = noul, y = label. Correct = thresholded noul matches the label.
 * - choice: correct = `choice` matches; p = probabilities[label] when present, otherwise
 *   confidence-as-correctness (documented in the evidence file).
 * - score: correct = round(score) is the label's level (1-based); calibration uses confidence.
 */
export function scoreAnswer(item, answer) {
  if (!answer) return null;
  const q = item.question;
  if (q.type === "noul" && answer.type === "noul" && Number.isFinite(answer.noul)) {
    return { correct: answer.noul >= 0.5 === item.label, p: answer.noul, y: item.label ? 1 : 0 };
  }
  if (q.type === "choice" && answer.type === "choice" && typeof answer.choice === "string") {
    const correct = answer.choice === item.label;
    const labelled = answer.probabilities?.[item.label];
    const p = Number.isFinite(labelled) ? labelled : correct ? (answer.confidence ?? 1) : 1 - (answer.confidence ?? 1);
    return { correct, p: Math.min(1, Math.max(0, p)), y: correct ? 1 : 0 };
  }
  if (q.type === "score" && answer.type === "score" && Number.isFinite(answer.score)) {
    const level = Math.round(answer.score);
    const correct = level === q.criteria.indexOf(item.label) + 1;
    const confidence = answer.confidence ?? 1;
    const p = correct ? confidence : 1 - confidence;
    return { correct, p: Math.min(1, Math.max(0, p)), y: correct ? 1 : 0 };
  }
  return null;
}

/** Per-model metrics over collected records. */
export function summarise(items, records) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const pairs = [];
  let answered = 0;
  let correct = 0;
  const timings = [];
  let inputTokens = 0;
  let flipEligible = 0;
  let flipped = 0;
  for (const record of records) {
    const item = byId.get(record.id);
    if (!item) continue;
    if (record.timingMs !== undefined) timings.push(record.timingMs);
    inputTokens += record.usage?.inputTokens ?? 0;
    if (record.error) continue;
    const scored = scoreAnswer(item, record.answer);
    if (!scored) continue;
    answered += 1;
    if (scored.correct) correct += 1;
    pairs.push([scored.p, scored.y]);
    if (item.question.type === "choice" && record.flippedChoice !== undefined && record.answer?.type === "choice") {
      flipEligible += 1;
      if (record.flippedChoice !== record.answer.choice) flipped += 1;
    }
  }
  return {
    items: records.length,
    answered,
    errors: records.filter((record) => record.error).length,
    accuracy: answered === 0 ? null : correct / answered,
    ece: ece(pairs),
    brier: brier(pairs),
    p50: percentile(timings, 50),
    p95: percentile(timings, 95),
    flipEligible,
    flipRate: flipEligible === 0 ? null : flipped / flipEligible,
    inputTokens,
  };
}

/** Share of items where two per-model answer maps agree (choice label, noul threshold, score level). */
export function agreement(items, left, right) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const rightById = new Map(right.map((record) => [record.id, record]));
  let shared = 0;
  let agree = 0;
  for (const record of left) {
    const other = rightById.get(record.id);
    const item = byId.get(record.id);
    if (!other || !item || record.error || other.error) continue;
    const a = comparable(item, record.answer);
    const b = comparable(item, other.answer);
    if (a === undefined || b === undefined) continue;
    shared += 1;
    if (a === b) agree += 1;
  }
  return { shared, agree, rate: shared === 0 ? null : agree / shared };
}

function comparable(item, answer) {
  if (!answer) return undefined;
  if (item.question.type === "choice") return answer.type === "choice" ? answer.choice : undefined;
  if (item.question.type === "noul") return answer.type === "noul" ? String(answer.noul >= 0.5) : undefined;
  return answer.type === "score" ? String(Math.round(answer.score)) : undefined;
}

/** Live env: process env wins; missing keys come from the owner's live env file. Never printed. */
export function loadCredentials() {
  // Out-of-repo only: a credential file inside the checkout is one git accident from a leak.
  const candidates = [process.env.PRISM_LIVE_ENV_FILE, join(process.env.HOME ?? "", ".config/prism/live.env")].filter(Boolean);
  const path = candidates.find((candidate) => existsSync(candidate));
  return path ? { ...parseEnvFile(path), ...process.env } : { ...process.env };
}

/** Resolve one `provider/model[@QUANT]` spec into a package factory, env needs, and price. */
export function resolveSpec(spec, env) {
  const at = spec.lastIndexOf("@");
  const ref = at > 0 ? spec.slice(0, at) : spec;
  const quant = at > 0 ? spec.slice(at + 1) : undefined;
  const [provider, model] = ref.split("/");
  const credentials = { env, query: spec, ref, quant, model, provider };
  if (provider === "liquid") {
    return {
      ...credentials,
      price: PRICES[ref] ?? null,
      missing: env.LIQUID_API_KEY ? null : "set LIQUID_API_KEY",
      package: () => liquid({ hosted: true, apiKey: "env:LIQUID_API_KEY", baseUrl: env.PRISM_LIVE_LIQUID_BASE_URL }),
    };
  }
  if (provider === "liquid-local") {
    const byQuant = quant === "Q4_K_M" ? env.PRISM_LIVE_LLAMA_SERVER_Q4_URL : env.PRISM_LIVE_LLAMA_SERVER_Q8_URL;
    const baseUrl = byQuant ?? env.PRISM_LIVE_LLAMA_SERVER_URL;
    return {
      ...credentials,
      baseUrl,
      price: 0,
      missing: baseUrl ? null : "set PRISM_LIVE_LLAMA_SERVER_URL (or PRISM_LIVE_LLAMA_SERVER_Q4_URL / _Q8_URL)",
      package: () => liquid({ hosted: false, localBaseUrl: baseUrl }),
    };
  }
  if (provider === "laya") {
    const baseUrl = env.PRISM_LIVE_LAYA_SERVE_URL ?? LAYA_DEFAULT_BASE_URL;
    return { ...credentials, baseUrl, price: 0, missing: null, package: () => laya({ baseUrl }) };
  }
  if (provider === "typesafe") {
    return {
      ...credentials,
      price: null,
      missing: env.TYPESAFE_API_KEY ? null : "set TYPESAFE_API_KEY",
      package: () => typesafe({ apiKey: "env:TYPESAFE_API_KEY" }),
    };
  }
  throw new Error(`unknown model spec ${spec}`);
}

/** Cheap liveness probe for the local quant rows. */
async function llamaServerReachable(baseUrl) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok ? null : `llama-server answered ${response.status} at ${baseUrl}`;
  } catch {
    return `nothing answers at ${baseUrl}/health`;
  }
}

/** Any HTTP answer counts as reachable; only a transport failure is a skip. */
async function endpointReachable(baseUrl) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    await fetch(baseUrl, { signal: controller.signal });
    clearTimeout(timer);
    return null;
  } catch {
    return `nothing answers at ${baseUrl}`;
  }
}

/** Bare JSON copy of the question with the choice options reversed. */
function reversedQuestion(question) {
  if (question.type !== "choice") return null;
  return { ...question, criteria: Object.fromEntries(Object.entries(question.criteria).reverse()) };
}

async function runModel(spec, items, options) {
  let captured;
  const runner = definePackage({
    name: "@arnilo/prism-decision-bench",
    version: "1.0.0",
    requires: { api: 1 },
    capabilities: ["models"],
    setup(prism) {
      captured = prism;
    },
  });
  const agent = await createAgent({ id: "decision-bench", model: spec.ref, packages: [spec.package(), runner] });
  const decisions = captured.models.decisions(spec.ref);
  const records = [];
  const reportedModels = new Set();
  try {
    for (const item of items) {
      const request = { state: item.state, questions: { [item.id]: item.question } };
      const base = { id: item.id, timingMs: undefined, usage: undefined, answer: undefined, error: undefined };
      try {
        const started = performance.now();
        const result = await decisions.decide(request);
        base.timingMs = performance.now() - started;
        base.usage = result.usage;
        base.answer = result.answers[item.id];
        reportedModels.add(result.model);
        const reversed = options.flip ? reversedQuestion(item.question) : null;
        if (reversed) {
          const flipStarted = performance.now();
          const flipped = await decisions.decide({ state: item.state, questions: { [item.id]: reversed } });
          base.timingMs += performance.now() - flipStarted;
          const answer = flipped.answers[item.id];
          base.flippedChoice = answer?.type === "choice" ? answer.choice : undefined;
          base.usage = sumUsage(base.usage, flipped.usage);
        }
      } catch (error) {
        base.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }
      records.push(base);
    }
  } finally {
    await agent.dispose();
  }
  return { spec, records, reportedModels: [...reportedModels] };
}

function sumUsage(a, b) {
  if (!a && !b) return undefined;
  return {
    inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
    outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
    totalTokens: (a?.totalTokens ?? 0) + (b?.totalTokens ?? 0),
  };
}

function hardwareLine(env) {
  const build =
    env.PRISM_LIVE_LLAMA_SERVER_BUILD ??
    (() => {
      try {
        return execFileSync("llama-server", ["--version"], { encoding: "utf8", timeout: 5000 }).trim().split("\n")[0];
      } catch {
        return "not detected";
      }
    })();
  const hash = env.PRISM_LIVE_D1_GGUF_SHA256 ?? "not recorded (set PRISM_LIVE_D1_GGUF_SHA256)";
  return {
    cpu: cpus()[0]?.model ?? "unknown",
    arch: arch(),
    platform: platform(),
    memoryGB: Math.round(totalmem() / 1024 ** 3),
    build,
    hash,
  };
}

function percent(value) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function number(value, digits = 3) {
  return value === null || value === undefined ? "—" : Number(value).toFixed(digits);
}

function markdown({ date, env, rows, skipped, agreements, items, options }) {
  const hw = hardwareLine(env);
  const lines = [];
  lines.push(`# Decision bench — ${date}`, "");
  lines.push(
    `Live run of \`scripts/decision-bench.mjs\` over \`scripts/fixtures/${options.memory ? "decision-bench-memory" : "decision-bench"}.jsonl\`. `,
    "",
  );
  lines.push("## Environment", "");
  lines.push(`- Host: ${hw.cpu} (${hw.arch}, ${hw.platform}), ${hw.memoryGB} GB RAM`);
  lines.push(`- Bun ${process.versions.bun ?? "n/a"} on Node ${process.versions.node}`);
  lines.push(`- llama-server: ${hw.build}`);
  lines.push(`- d1-3B GGUF sha256: ${hw.hash}`);
  lines.push(`- Items: ${items} (${options.flip ? "with" : "without"} option-reversal repeats)`);
  lines.push(
    `- Request budget: ${rows.map((row) => `${row.spec.query}=${row.records.length * (options.flip ? 2 : 1)}`).join(", ") || "none run"}`,
  );
  lines.push("");
  lines.push("## Metrics", "");
  lines.push(
    "| model | echoed model | answered | errors | accuracy | ECE | Brier | p50 ms | p95 ms | flip rate | input tokens | cost USD |",
  );
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of rows) {
    const m = summarise(row.items, row.records);
    const cost = row.spec.price === null ? "n/a" : number((m.inputTokens * row.spec.price) / 1e6, 6);
    lines.push(
      `| ${row.spec.query} | ${row.reportedModels.join(", ") || "—"} | ${m.answered} | ${m.errors} | ${percent(m.accuracy)} | ${number(m.ece)} | ${number(m.brier)} | ${number(m.p50, 0)} | ${number(m.p95, 0)} | ${percent(m.flipRate)} | ${m.inputTokens} | ${cost} |`,
    );
  }
  lines.push("", "### By category", "");
  lines.push("| model | category | items | accuracy | ECE | Brier |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: |");
  const categories = [...new Set(rows.flatMap((row) => row.items.map((item) => item.category)))].sort();
  for (const row of rows) {
    for (const category of categories) {
      const categoryItems = row.items.filter((item) => item.category === category);
      if (categoryItems.length === 0) continue;
      const m = summarise(categoryItems, row.records);
      lines.push(`| ${row.spec.query} | ${category} | ${m.answered} | ${percent(m.accuracy)} | ${number(m.ece)} | ${number(m.brier)} |`);
    }
  }
  if (skipped.length > 0) {
    lines.push("", "### Skipped", "");
    for (const skip of skipped) lines.push(`- \`${skip.spec}\`: ${skip.reason}`);
  }
  lines.push("", "## Agreement between models", "");
  lines.push("Hosted-vs-local is the README-facing rate; quant-to-quant is the Q4_K_M vs Q8_0 drift.", "");
  if (agreements.length === 0) lines.push("Fewer than two models ran, so no agreement rate is recorded.");
  else {
    lines.push("| model A | model B | shared items | agreement |");
    lines.push("| --- | --- | ---: | ---: |");
    for (const agreementRow of agreements) {
      lines.push(`| ${agreementRow.a} | ${agreementRow.b} | ${agreementRow.shared} | ${percent(agreementRow.rate)} |`);
    }
  }
  lines.push("", "## Method", "");
  lines.push(
    "- Accuracy: noul thresholded at 0.5, choice label match, score rounded to its 1-based level.",
    "- ECE: 10 equal-width probability bins; Brier over the same probability/label pairs. Choice uses `probabilities[label]` when the answer carries it; score uses `confidence` against correctness.",
    "- Flip rate: choice items only, second request with the criteria order reversed; counted when the chosen label changes.",
    "- Agreement: same item, comparable answer (choice label / noul threshold / rounded score), no request errors.",
    "- Cost: `usage.input_tokens` × the vendor's per-MTok input price; output tokens are always 0 for decision models.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const options = {
    check: argv.includes("--check"),
    memory: argv.includes("--memory"),
    flip: !argv.includes("--no-flip") && !argv.includes("--memory"),
    limit: flag("--limit") ? Number(flag("--limit")) : undefined,
    out: flag("--out"),
    date: new Date().toISOString().slice(0, 10),
  };
  const items = options.memory ? loadMemoryItems() : loadItems();
  console.log(`decision-bench: fixture ok — ${items.length} labelled items${options.memory ? " (memory gates)" : ""}`);
  const problems = options.memory ? validateMemoryItems(items) : validateItems(items);
  if (problems.length > 0) {
    console.error(`decision-bench: fixture problems:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  const subset = options.limit ? items.slice(0, options.limit) : items;
  const env = loadCredentials();
  const specs = (flag("--models") ?? DEFAULT_MODELS.join(","))
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolveSpec(entry, env));

  console.log(`decision-bench: ${subset.length} items × ${options.flip ? 2 : 1} request(s) per model`);
  for (const spec of specs)
    console.log(`  ${spec.query}: ${spec.missing ? `skip (${spec.missing})` : `${subset.length * (options.flip ? 2 : 1)} requests`}`);
  if (options.check) return;

  const rows = [];
  const skipped = [];
  for (const spec of specs) {
    let missing = spec.missing;
    if (!missing && spec.provider === "liquid-local") missing = await llamaServerReachable(spec.baseUrl);
    if (!missing && spec.provider === "laya") missing = await endpointReachable(spec.baseUrl);
    if (missing) {
      skipped.push({ spec: spec.query, reason: missing });
      console.log(`skip ${spec.query}: ${missing}`);
      continue;
    }
    console.log(`run  ${spec.query} …`);
    const { records, reportedModels } = await runModel(spec, subset, options);
    rows.push({ spec, items: subset, records, reportedModels });
    const metrics = summarise(subset, records);
    console.log(
      `  ${spec.query}: answered ${metrics.answered}/${metrics.items}, errors ${metrics.errors}, accuracy ${percent(metrics.accuracy)}, echoed model ${reportedModels.join(", ") || "—"}`,
    );
  }

  if (rows.length === 0) {
    console.log("\nNo model ran. Nothing was written; set credentials/URLs and re-run.");
    process.exit(0);
  }

  const agreements = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      agreements.push({ a: rows[i].spec.query, b: rows[j].spec.query, ...agreement(subset, rows[i].records, rows[j].records) });
    }
  }

  const body = markdown({ date: options.date, env, rows, skipped, agreements, items: subset.length, options });
  const out = options.out ?? join(EVIDENCE_DIR, `decision-bench-${options.date}.md`);
  writeFileSync(out, body);
  console.log(`\nwrote ${out}`);
  console.log(
    "hosted models echoed:",
    rows
      .filter((row) => row.spec.provider === "liquid")
      .map((row) => `${row.spec.query}→${row.reportedModels.join("|") || "—"}`)
      .join(", "),
  );
}

if (import.meta.main) await main();
