#!/usr/bin/env bun
// The maintained list of free models reachable through LiteLLM (plan 214 Task 5).
//
//   bun scripts/litellm/free-models.mjs            # rewrite docs/free-models.md
//   bun scripts/litellm/free-models.mjs --json     # print the same data as JSON
//
// Every provider is read with the key already in the live env file, from that provider's own catalogue,
// because that is the only place the free/paid line is stated: OpenRouter publishes a price, Google
// publishes a model list and gates the free tier by family, Cloudflare and Groq gate it by plan. A
// provider with no key is reported as skipped, never guessed. No model is called, so a refresh costs
// no quota; `--probe` is deliberately not offered (that is `up.mjs` plus a bench run).
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DEPLOYMENTS } from "./free-pool.mjs";

const OUT = resolve(import.meta.dir, "..", "..", "docs", "free-models.md");
const MAX_BODY = 8 * 1024 * 1024;

export const PROVIDERS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    keyEnv: "OPENROUTER_API_KEY",
    url: "https://openrouter.ai/api/v1/models",
    headers: (key) => ({ authorization: `Bearer ${key}` }),
    // The catalogue states a price per token; zero on both sides is the definition of free here.
    classify: (body) =>
      (body.data ?? []).map((model) => {
        const zero = (value) => Number(value) === 0;
        const free = zero(model.pricing?.prompt) && zero(model.pricing?.completion);
        return { model: model.id, free, evidence: free ? "catalog price 0" : "paid" };
      }),
  },
  {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    keyEnv: "CLOUDFLARE_API_KEY",
    extraEnv: ["CLOUDFLARE_ACCOUNT_ID"],
    url: (_key, env) =>
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/models/search?per_page=100&task=Text%20Generation`,
    headers: (key) => ({ authorization: `Bearer ${key}` }),
    // The free plan is a neuron allowance, not a per-model price: every text model is usable until the
    // allowance runs out, and a model the plan does not include answers 403 (measured 2026-10-31).
    classify: (body) =>
      (body.result ?? []).map((model) => ({
        model: model.name,
        free: true,
        evidence: "free-plan allowance (403 when not included)",
      })),
  },
  {
    id: "groq",
    label: "Groq",
    keyEnv: "GROQ_API_KEY",
    url: "https://api.groq.com/openai/v1/models",
    headers: (key) => ({ authorization: `Bearer ${key}` }),
    // Every listed model is served on the free tier, bounded by the published rate limits. Speech,
    // guard and embedding entries are dropped: the pool needs chat models, and a TTS id in the list
    // would read as a chat route.
    classify: (body) =>
      (body.data ?? [])
        .filter((model) => !/whisper|tts|orpheus|guard|embedding/i.test(model.id))
        .map((model) => ({ model: model.id, free: true, evidence: "free-tier quota" })),
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    keyEnv: "NVIDIA_NIM_API_KEY",
    url: "https://integrate.api.nvidia.com/v1/models",
    headers: (key) => ({ authorization: `Bearer ${key}` }),
    classify: (body) => (body.data ?? []).map((model) => ({ model: model.id, free: true, evidence: "free-tier quota" })),
  },
  {
    id: "gemini",
    label: "Google AI Studio",
    keyEnv: "GEMINI_API_KEY",
    url: (key) => `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`,
    headers: () => ({}),
    // Only the Flash family is on the free tier, and only for generateContent.
    classify: (body) =>
      (body.models ?? [])
        .filter((model) => !/tts|image|embedding/i.test(String(model.name)))
        .map((model) => {
          const id = String(model.name).replace(/^models\//, "");
          const free = /flash/i.test(id) && (model.supportedGenerationMethods ?? []).includes("generateContent");
          return { model: id, free, evidence: free ? "free tier (Flash family)" : "paid tier" };
        }),
  },
];

/**
 * `cloudflare/@cf/openai/gpt-oss-120b`, `@cf/openai/gpt-oss-120b` and `openai/gpt-oss-120b:free` are
 * one model. Only LiteLLM *provider* prefixes are removed — `nvidia/…` or `google/…` are vendor ids
 * and stay, otherwise two different vendors' models would collide.
 */
const PROVIDER_PREFIXES = ["cloudflare", "openrouter", "groq", "gemini", "vertex_ai", "dashscope", "cohere", "zai", "ollama", "vllm"];
export const stripUpstream = (model) => {
  let rest = String(model).replace(/:free$/, "");
  for (const prefix of PROVIDER_PREFIXES) rest = rest.replace(new RegExp(`^${prefix}/`), "");
  return rest.replace(/^@cf\//, "").replace(/^openai\//, "");
};

/** The LiteLLM model string a deployment would need, and whether a pool group already carries it. */
function poolRows(deployments) {
  return deployments.map((deployment) => ({
    group: deployment.group,
    host: deployment.host.name ?? deployment.host.id ?? "",
    model: deployment.model,
  }));
}

/** Fetches one catalogue with a bounded body and a timeout; a failure is data, not a crash. */
async function fetchCatalogue(provider, env, fetchImpl) {
  const key = env[provider.keyEnv];
  const missing = [provider.keyEnv, ...(provider.extraEnv ?? [])].filter((name) => !env[name]);
  if (missing.length > 0) return { id: provider.id, label: provider.label, status: "skipped", reason: `no ${missing.join(", ")}` };
  const url = typeof provider.url === "function" ? provider.url(key, env) : provider.url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(url, { headers: provider.headers(key), signal: controller.signal });
    const text = await response.text();
    if (!response.ok)
      return { id: provider.id, label: provider.label, status: "error", reason: `${response.status} ${text.slice(0, 200)}` };
    if (text.length > MAX_BODY)
      return { id: provider.id, label: provider.label, status: "error", reason: `catalogue exceeds ${MAX_BODY} bytes` };
    const rows = provider.classify(JSON.parse(text));
    return {
      id: provider.id,
      label: provider.label,
      status: "ok",
      free: rows.filter((row) => row.free).length,
      total: rows.length,
      rows,
    };
  } catch (error) {
    return { id: provider.id, label: provider.label, status: "error", reason: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Reads every configured provider's catalogue. Providers without a key are reported, not omitted. */
export async function discoverFreeModels(env, fetchImpl = fetch, deployments = DEPLOYMENTS) {
  const results = [];
  for (const provider of PROVIDERS) results.push(await fetchCatalogue(provider, env, fetchImpl));
  return { checkedAt: new Date().toISOString().slice(0, 10), results, pool: poolRows(deployments) };
}

/**
 * Provider ids and pool host names are spelled for different readers (`nvidia` vs `nvidia_nim`), so a
 * match is on letters and digits only, with either name allowed to be the longer one.
 */
const normHost = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export const sameHost = (left, right) => {
  const a = normHost(left);
  const b = normHost(right);
  return a !== "" && b !== "" && (a === b || a.startsWith(b) || b.startsWith(a));
};

/** Does a pool deployment's upstream model appear in a provider's free list? */
export function poolMatch(host, model, report) {
  const row = report.results.find((result) => sameHost(result.id, host));
  if (row?.status !== "ok") return undefined;
  return row.rows.find((candidate) => stripUpstream(candidate.model) === stripUpstream(model));
}

const cell = (value) => String(value).replace(/\|/g, "\\|");

/** The committed page. Every table is generated; the prose around it is not. */
export function renderMarkdown(report) {
  const lines = [
    "<!-- Generated by `bun scripts/litellm/free-models.mjs`; edit the script, not this file. -->",
    "",
    "# Free models through LiteLLM",
    "",
    `Checked **${report.checkedAt}** against each provider's own catalogue. A provider with no key in the`,
    "live env file is listed as skipped rather than guessed at; rerun with the key to fill it in. No model",
    "was called, so a refresh spends no quota.",
    "",
    "`in pool` marks a deployment `scripts/litellm/free-pool.mjs` already renders into a",
    "`prism-free/*` group, i.e. one a test can reach through the proxy today.",
    "",
  ];
  for (const result of report.results) {
    lines.push(`## ${result.label}`, "");
    if (result.status !== "ok") {
      // A skipped provider still lists the deployments the pool already carries for it, so the page
      // never hides a model just because this machine lacks the key.
      lines.push(`- status: **${result.status}** — ${result.reason}`);
      const carried = report.pool.filter((deployment) => sameHost(result.id, deployment.host));
      if (carried.length > 0) {
        lines.push("", "| model | evidence | in pool |", "| --- | --- | --- |");
        for (const deployment of carried) {
          lines.push(
            `| \`${cell(stripUpstream(deployment.model))}\` | not checked (${cell(result.reason)}) | \`${cell(deployment.group)}\` |`,
          );
        }
      }
      lines.push("");
      continue;
    }
    lines.push(`${result.free} free of ${result.total} catalogued.`, "");
    lines.push("| model | evidence | in pool |", "| --- | --- | --- |");
    for (const row of result.rows.filter((candidate) => candidate.free)) {
      const pools = report.pool.filter(
        (deployment) => sameHost(result.id, deployment.host) && stripUpstream(deployment.model) === stripUpstream(row.model),
      );
      lines.push(
        `| \`${cell(row.model)}\` | ${cell(row.evidence)} | ${pools.length > 0 ? pools.map((p) => `\`${p.group}\``).join(", ") : "—"} |`,
      );
    }
    lines.push("");
  }
  lines.push(
    "## Reading this list",
    "",
    "- A catalogue says what *can* be free, not what is reachable now: a free plan can refuse a model at",
    "  call time (Cloudflare answers 403 for a model its plan excludes), and a rate limit can refuse it",
    "  for the rest of the day.",
    "- Free tiers are not neutral about data. Google's free tier states that content is used to improve",
    "  its products; the others may log or train on prompts. Quotas are recorded in",
    "  `scripts/litellm/README.md` with their sources and reading dates.",
    "- Add a provider by adding an entry to `PROVIDERS` in the script, then rerun it with that key set.",
    "",
  );
  return lines.join("\n");
}

function readEnvFile() {
  const explicit = process.env.PRISM_LIVE_ENV_FILE;
  const path = explicit ? resolve(explicit) : join(homedir(), ".config", "prism", "live.env");
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { path, env: {} };
  }
  const env = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2];
  }
  return { path, env };
}

async function main(argv) {
  const { env } = readEnvFile();
  const merged = { ...env, ...process.env };
  const report = await discoverFreeModels(merged);
  if (argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  const outIndex = argv.indexOf("--out");
  const out = outIndex >= 0 ? resolve(argv[outIndex + 1]) : OUT;
  writeFileSync(out, `${renderMarkdown(report)}\n`);
  const skipped = report.results.filter((result) => result.status !== "ok");
  for (const result of report.results) {
    if (result.status === "ok") console.log(`${result.id}: ${result.free}/${result.total} free`);
    else console.log(`${result.id}: ${result.status} (${result.reason})`);
  }
  console.log(`wrote ${out}`);
  return skipped.length === report.results.length ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
