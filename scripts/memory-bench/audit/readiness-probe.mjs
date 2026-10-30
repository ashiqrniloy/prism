#!/usr/bin/env bun
/** Fixed owner-selected route readiness probes. No benchmark, held-out or user text reaches these calls. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createAgent, resolveInputCap } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { BASELINE_BILLING, BASELINE_JUDGES, BASELINE_MODELS } from "../baseline.mjs";
import { scoreAnswer } from "../judge.mjs";
import { askJudge, isFreeBenchmarkModel } from "../run.mjs";
import { openDiagnostic } from "./zero-score.mjs";

const root = ".cache/memory-bench/audit/4.8-operations";
const output = "docs/_evidence/memory-bench/202/readiness-operations.json";
const limits = { wireAttempts: 40, inputTokens: 20_000_000, outputTokens: 200_000, wallMs: 900_000, retries429: 0 };
const quota = JSON.parse(await readFile("docs/_evidence/memory-bench/202/muse-judge-quota.json", "utf8"));
const unavailableFreePool =
  BASELINE_MODELS.some((m) => m.provider === "openrouter") &&
  quota.dailyRequests?.remaining === 0 &&
  Date.now() - Date.parse(quota.checkedAt) < 60_000;
const refs = [...BASELINE_MODELS.map((m) => `${m.provider}/${m.model}`), ...BASELINE_JUDGES];
const session = await openDiagnostic({ root, refs, limits, freeOnly: false });
const report = {
  kind: "202-readiness-operations",
  generatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 6 * 3_600_000).toISOString(),
  limits,
  generation: { temperature: 0, maxTokens: 8192, reasoning: "provider default; no override" },
  quota: unavailableFreePool ? { ...quota.dailyRequests, observedAt: quota.checkedAt, source: quota.source } : null,
  models: [],
  judges: [],
  usage: null,
  quotaPolicy:
    "Successful probes establish admission now, not a reserved future free allowance. Serial campaign stops on quota; no reset is assumed or awaited. Recheck expired readiness before resuming.",
  billing: "Owner-selected 25-cell screen: Muse 1.3 Contributor and MiniMax/GLM judges only; no other answer route",
  calibration: "owner-waived; controls are model assisted, not human calibration",
};
const agents = [];
try {
  for (const ref of refs) {
    const model = { ...session.live.models.get(ref), parameters: { temperature: 0, maxTokens: 8192 } };
    if (!BASELINE_BILLING.paidModels.includes(ref) && !isFreeBenchmarkModel(model))
      throw new Error("Readiness model is not an authorized route");
    if (unavailableFreePool && ref.startsWith("openrouter/")) {
      report.models.push({
        ref,
        limits: model.limits,
        parameters: model.parameters,
        compat: model.compat,
        inputCap: resolveInputCap(undefined, model),
        free: true,
        status: "quota-unavailable",
        evidence: "Fresh read-only account check; no model request sent",
      });
      console.log(`${ref}: quota-unavailable (read-only check)`);
      continue;
    }
    let calls = 0;
    const judge = BASELINE_JUDGES.includes(ref);
    const agent = await createAgent({
      model,
      compaction: false,
      retry: false,
      packages: [providerPackage(`readiness-${agents.length}`, session.live.providers)],
      ...(judge
        ? {}
        : {
            tools: {
              add: [
                {
                  name: "readiness_echo",
                  description: "Return the supplied value.",
                  parameters: {
                    type: "object",
                    properties: { value: { type: "string" } },
                    required: ["value"],
                    additionalProperties: false,
                  },
                  execute: async ({ value }, context) => {
                    calls++;
                    return { toolCallId: context.toolCallId, name: "readiness_echo", content: [{ type: "text", text: value }] };
                  },
                },
              ],
            },
          }),
      limits: { maxTurns: judge ? 1 : 3, maxWallTimeMs: 120_000 },
    });
    agents.push(agent);
    const row = {
      ref,
      limits: model.limits,
      parameters: model.parameters,
      compat: model.compat,
      inputCap: resolveInputCap(undefined, model),
      free: isFreeBenchmarkModel(model),
      status: "failed",
    };
    if (judge) {
      const question = { id: "readiness-control", question: "What is two plus two?", answers: ["4"], ability: "information_extraction" };
      const generate = (prompt, options) =>
        askJudge({
          agent,
          prompt,
          ...options,
          textMode: true,
          account: session.account,
          ceilingReached: session.ceilingReached,
          calls: { judge: 0, judgeAttempts: 0 },
          timeoutMs: 120_000,
        });
      row.positive = (await scoreAnswer(question, "4", "beam-100k", generate)).correct;
      row.negative = (await scoreAnswer(question, "93", "beam-100k", generate)).correct;
      if (row.positive === true && row.negative === false) row.status = "passed";
      report.judges.push(row);
    } else {
      const turn = await agent.session();
      try {
        const result = await turn.run("Call readiness_echo once with value ok, then reply OK.");
        row.outcome = result.status;
        row.errorCode = result.error?.code ?? result.status;
        row.toolCalls = calls;
        row.nonempty = !!result.text?.trim();
        if (result.status === "completed" && row.nonempty && calls > 0) row.status = "passed";
      } finally {
        await turn.close();
      }
      report.models.push(row);
    }
    await session.account();
    console.log(`${ref}: ${row.status}`);
  }
} finally {
  for (const agent of agents) await agent.dispose();
  await session.account();
  report.usage = session.usage();
  report.allocations = session.allocations();
  report.finishedAt = new Date().toISOString();
  await mkdir("docs/_evidence/memory-bench/202", { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  session.close();
}
if (
  report.models.length !== BASELINE_MODELS.length ||
  report.judges.length !== BASELINE_JUDGES.length ||
  [...report.models, ...report.judges].some((r) => r.status !== "passed")
)
  process.exitCode = 1;
