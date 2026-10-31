#!/usr/bin/env bun
// Reconciles Prism's own cost record against LiteLLM's spend log (plan 214 Task 3).
//
//   LITELLM_API_KEY=... bun scripts/litellm/reconcile.mjs --report <report.json|usage.jsonl> [--base-url URL] [--tolerance 1e-6]
//
// The key is read from the environment by name only: there is no flag that accepts a key value, so it
// cannot land in a shell history or a process list. See scripts/litellm/README.md. Zero model calls are made — one indexed read per
// call id (or up to 50 pages of a date range) and no prompt or response content is read or written.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { litellmSpendLogs } from "@arnilo/prism-provider-litellm";

const USAGE = "usage: reconcile.mjs --report <report.json|usage.jsonl> [--base-url URL] [--tolerance 1e-6] [--wait-ms N] [--out PREFIX]";

/** A call id and the cost Prism recorded for it. */
function entryOf(raw) {
  if (typeof raw !== "object" || raw === null) return undefined;
  const callId = [raw.callId, raw.litellmCallId, raw.requestId, raw.id].find((value) => typeof value === "string" && value.trim() !== "");
  if (!callId) return undefined;
  const cost = ["cost", "costUsd", "usd", "prismCost", "spend"]
    .map((key) => raw[key])
    .find((value) => typeof value === "number" && Number.isFinite(value));
  return { callId: String(callId).trim(), prismCost: cost ?? 0 };
}

/**
 * Reads `{callId, cost}` pairs from a bench report (JSON, or JSON with a `calls`/`rows`/`usage`/`results`
 * array) or from a usage log (one JSON object per line). Duplicate ids keep the first occurrence.
 */
export function readSignal(name, text) {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  const parse = (fragment, index) => {
    try {
      return JSON.parse(fragment);
    } catch (error) {
      throw new Error(`${name}: line ${index} is not JSON (${error.message})`);
    }
  };
  let entries;
  const lineMode = /\.(jsonl|ndjson)$/i.test(name) || (!trimmed.startsWith("[") && trimmed.includes("\n{"));
  if (lineMode) {
    entries = trimmed.split("\n").map((line, index) => (line.trim() === "" || line.trim().startsWith("#") ? {} : parse(line, index + 1)));
  } else {
    const payload = parse(trimmed, 1);
    if (Array.isArray(payload)) entries = payload;
    else {
      const list = ["calls", "rows", "usage", "results", "records"].map((key) => payload[key]).find(Array.isArray);
      if (!list) throw new Error(`${name}: no calls/rows/usage array and not a JSON list`);
      entries = list;
    }
  }
  const byId = new Map();
  for (const raw of entries) {
    const entry = entryOf(raw);
    if (entry && !byId.has(entry.callId)) byId.set(entry.callId, entry);
  }
  return [...byId.values()];
}

/** Builds the reconciliation rows, totals, and the pass/fail verdict. */
export function reconcile(signal, spend, tolerance = 1e-6) {
  const byId = new Map(spend.rows.map((row) => [row.callId, row]));
  const rows = signal.map((entry) => {
    const row = byId.get(entry.callId);
    const litellmSpend = row ? row.spend : undefined;
    return {
      callId: entry.callId,
      modelId: row?.modelId ?? null,
      prismCost: entry.prismCost,
      litellmSpend: litellmSpend ?? null,
      delta: litellmSpend === undefined ? null : litellmSpend - entry.prismCost,
    };
  });
  const prismCost = rows.reduce((sum, row) => sum + row.prismCost, 0);
  const litellmSpend = rows.reduce((sum, row) => sum + (row.litellmSpend ?? 0), 0);
  const totalDelta = litellmSpend - prismCost;
  const missing = [...spend.missing];
  return {
    rows,
    totals: { prismCost, litellmSpend, totalDelta },
    missing,
    ok: missing.length === 0 && Math.abs(totalDelta) <= tolerance,
  };
}

const money = (value) => (value === null ? "-" : value.toFixed(8));

export function markdownTable(report) {
  const lines = [
    "| callId | modelId | prismCost | litellmSpend | delta |",
    "| --- | --- | --- | --- | --- |",
    ...report.rows.map(
      (row) => `| \`${row.callId}\` | ${row.modelId ?? "-"} | ${money(row.prismCost)} | ${money(row.litellmSpend)} | ${money(row.delta)} |`,
    ),
    "",
    `Totals: prism ${money(report.totals.prismCost)} USD, litellm ${money(report.totals.litellmSpend)} USD, delta ${money(report.totals.totalDelta)} USD.`,
    `Missing rows: ${report.missing.length === 0 ? "none" : report.missing.map((id) => `\`${id}\``).join(", ")}.`,
    `Verdict: ${report.ok ? "reconciled" : "FAILED"}.`,
  ];
  return lines.join("\n");
}

/** Runs the read and returns the report; used by both the CLI and the test. */
export async function runReconcile({ reportPath, baseUrl, tolerance = 1e-6, waitMs, fetch, env = process.env }) {
  const signal = readSignal(reportPath, readFileSync(resolve(reportPath), "utf8"));
  if (signal.length === 0) throw new Error(`${reportPath}: no call ids found`);
  const apiKey = env.LITELLM_API_KEY;
  if (!apiKey) throw new Error("LITELLM_API_KEY is not set; export the provider's virtual key (the spend log is readable by that key)");
  const spend = await litellmSpendLogs({
    ...(baseUrl ? { baseUrl } : {}),
    ...(waitMs === undefined ? {} : { waitMs }),
    apiKey: async () => apiKey,
    callIds: signal.map((entry) => entry.callId),
    ...(fetch ? { fetch } : {}),
  });
  return { report: reconcile(signal, spend, tolerance), signal };
}

function parseArgs(argv) {
  const options = { tolerance: 1e-6 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--report") options.reportPath = argv[++index];
    else if (arg === "--base-url") options.baseUrl = argv[++index];
    else if (arg === "--tolerance") options.tolerance = Number(argv[++index]);
    else if (arg === "--wait-ms") options.waitMs = Number(argv[++index]);
    else if (arg === "--out") options.out = argv[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}\n${USAGE}`);
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (!options.reportPath) throw new Error(USAGE);
  if (!Number.isFinite(options.tolerance) || options.tolerance < 0) throw new Error("--tolerance must be a non-negative number");
  const { report, signal } = await runReconcile(options);
  const markdown = markdownTable(report);
  console.log(markdown);
  if (options.out) {
    writeFileSync(`${options.out}.md`, `${markdown}\n`);
    writeFileSync(`${options.out}.json`, `${JSON.stringify({ ...report, calls: signal }, null, 2)}\n`);
  }
  return report.ok ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
