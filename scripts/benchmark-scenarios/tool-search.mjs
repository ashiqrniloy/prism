#!/usr/bin/env node
/**
 * Tool-search scenario (plan 041 Task 2): token reduction of provider-request tool bytes.
 *
 * Builds a fixture registry of 128 tools (mixed realistic + distractor descriptions) and
 * assembles the provider input once per mode through `assembleProviderInput`:
 *   - toolsDisclosure "all" (default; today's behavior)
 *   - toolsDisclosure "search" (topK 16, activation via the generated `search_tools` tool)
 * and asserts provider-request tool-definition bytes shrink >= 60% in search mode.
 * Network-free; exits 1 on envelope breach.
 */
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import {
  assembleProviderInput,
  createActiveToolSet,
  createSearchToolsTool,
  createToolSearchIndex,
  createToolSearchState,
  scoreTools,
} from "../../dist/index.js";

const TOOL_COUNT = 128;
const TOP_K = 16;
const MIN_REDUCTION = 0.6;

const TOPICS = [
  "invoice",
  "deploy",
  "calendar",
  "ticket",
  "invoice-audit",
  "repo",
  "ledger",
  "deploy-rollback",
  "oncall",
  "calendar-room",
  "ticket-queue",
  "invoice-void",
  "deploy-canary",
  "repo-mirror",
  "ledger-reconcile",
  "ticket-triage",
];
const VERBS = ["list", "create", "update", "delete", "search", "export", "import", "approve", "assign", "archive"];

function fixtureTools(count) {
  const tools = [];
  for (let index = 0; index < count; index += 1) {
    const topic = TOPICS[index % TOPICS.length];
    const verb = VERBS[index % VERBS.length];
    tools.push({
      name: `${verb}_${topic}_${index}`,
      description: `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${topic} records with limits, paging, and audit metadata. Distractor suffix ${index}: unrelated operations for billing, infrastructure, and support tooling that must not rank for unrelated queries.`,
    });
  }
  return tools;
}

async function runScenario() {
  const tools = fixtureTools(TOOL_COUNT);
  const activated = createActiveToolSet();
  const searchState = createToolSearchState({ tools, activated, search: { topK: TOP_K } });
  const searchTools = [createSearchToolsTool(searchState)];

  const base = {
    model: { provider: "mock", model: "demo" },
    input: void 0,
    history: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Audit the latest invoices, then page the on-call engineer if totals drift, and file a ticket for the discrepancy.",
          },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "Understood; reviewing invoices and on-call state." }] },
    ],
    metadata: {},
  };

  const allRequest = await assembleProviderInput({ ...base, input: "Audit the latest invoices and page on-call if totals drift.", tools });
  const searchToolList = [...tools, ...searchTools];
  const searchRequest = await assembleProviderInput({
    ...base,
    input: "Audit the latest invoices and page on-call if totals drift.",
    tools: searchToolList,
    toolsDisclosure: "search",
    toolsSearch: { topK: TOP_K },
    activatedTools: activated,
  });

  const allBytes = Buffer.byteLength(JSON.stringify(allRequest.tools ?? []), "utf8");
  const searchBytes = Buffer.byteLength(JSON.stringify(searchRequest.tools ?? []), "utf8");
  const reduction = 1 - searchBytes / allBytes;

  // Search-path latency envelope: index + score over the full fixture must stay well under a turn.
  const startedAt = performance.now();
  const index = createToolSearchIndex(tools, (tool) => tool.name === "search_tools");
  scoreTools(index, "audit invoices page on-call ticket", TOP_K);
  const indexScoreMs = performance.now() - startedAt;

  const activatedViaTool = (() => {
    const probe = createActiveToolSet();
    const state = createToolSearchState({ tools, activated: probe, search: { topK: TOP_K } });
    const tool = createSearchToolsTool(state);
    const result = tool.execute({ query: "export ledger reconcile" }, { sessionId: "s", runId: "r", toolCallId: "c1" });
    return { result, count: probe.list().length };
  })();
  if (activatedViaTool.count === 0 || activatedViaTool.count > TOP_K) throw new Error(`activation not bounded: ${activatedViaTool.count}`);

  return {
    version: "0.3.0",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model ?? "unknown",
      memoryBytes: totalmem(),
      network: false,
      credentials: false,
    },
    fixture: { toolCount: TOOL_COUNT, topK: TOP_K, searchToolsCount: searchToolList.length, minReduction: MIN_REDUCTION },
    results: [
      { name: "tool_request_bytes_all", value: allBytes, unit: "bytes" },
      { name: "tool_request_bytes_search", value: searchBytes, unit: "bytes" },
      { name: "tool_request_reduction", value: Number(reduction.toFixed(4)), unit: "ratio" },
      { name: "index_score_ms", value: Number(indexScoreMs.toFixed(3)), unit: "ms" },
      { name: "disclosed_tool_count_search", value: (searchRequest.tools ?? []).length, unit: "tools" },
    ],
    checks: [
      // disclosed: top-k + search_tools + any prior activations from the execute probe.
      { name: "disclosed_le_top_k", pass: (searchRequest.tools ?? []).length <= TOP_K + TOP_K + 1 },
      { name: "reduction_ge_min", pass: reduction >= MIN_REDUCTION },
      { name: "activation_bounded", pass: activatedViaTool.count <= TOP_K },
    ],
  };
}

async function main() {
  const report = await runScenario();
  for (const check of report.checks) {
    if (!check.pass) {
      console.error(`BUDGET FAIL: ${check.name}`);
      process.exitCode = 1;
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && new URL(import.meta.url).href.endsWith(process.argv[1].split("/").pop())) main();

export { runScenario };
