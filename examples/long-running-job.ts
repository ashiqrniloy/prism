import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Agent,
  createAgent,
  type ModelProvider,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { jsonlStore } from "@arnilo/prism-extensions/store-jsonl";
import { type AgentJobSpec, createMemoryWorkflowCheckpoints, resumeAgentJob, runAgentJob } from "@arnilo/prism-extensions/workflows";

/**
 * Network-free demo (plan 239): a 30-run agent job on one session, with a process death in the middle.
 * - Process A runs the job with `runAgentJob`. Inside run 12, after its tool round, the model never answers: the
 *   process "dies".
 * - Process B is a fresh agent over the same JSONL session directory. `resumeAgentJob` reads the job's newest
 *   checkpoint, continues the in-flight run with `session.continue()` (its tool is not run again), and runs to `done`.
 * - Session limits bound the whole job, across both processes. Run limits and the stall axis stay at their defaults.
 * Run: bun examples/long-running-job.ts
 */

const RUNS = 30;
const CRASH_RUN = 12;

// Each run calls `record` with its step number, then reports. The step is the count of user messages, so a continued
// run keeps its number.
const stepOf = (request: ProviderRequest) => request.messages.filter((message) => message.role === "user").length;
const afterToolRound = (request: ProviderRequest) => request.messages.at(-1)?.content.some((part) => part.type === "tool_result") === true;

function provider(onCrash?: () => void): ModelProvider {
  return {
    id: "mock",
    async *generate(request) {
      const step = stepOf(request);
      if (!afterToolRound(request)) {
        yield { type: "tool_call" as const, call: toolCallContent(`record-${step}`, "record", { step }) };
        yield providerDone({ inputTokens: 40, outputTokens: 10 });
        return;
      }
      if (onCrash && step === CRASH_RUN) {
        onCrash();
        // The process is gone: this turn never answers.
        await new Promise((_resolve, reject) => request.signal?.addEventListener("abort", () => reject(request.signal?.reason)));
        return;
      }
      yield providerTextDelta(step === RUNS ? `step ${step} of ${RUNS}: ALL DONE` : `step ${step} of ${RUNS}`);
      yield providerDone({ inputTokens: 40, outputTokens: 10 });
    },
  };
}

export async function demo(): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "prism-long-job-"));
  const recorded: number[] = [];
  const record = {
    name: "record",
    parameters: { type: "object", properties: { step: { type: "integer" } }, required: ["step"] },
    execute: (args: { step?: unknown }, context: { readonly toolCallId: string }) => {
      recorded.push(Number(args.step));
      return { toolCallId: context.toolCallId, name: "record", value: `recorded step ${String(args.step)}` };
    },
  };
  const agentFor = (model: ModelProvider): Promise<Agent> =>
    createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [jsonlStore({ dir }), providerPackage("demo-provider", [model])],
      tools: { add: [record] },
      // The spend guard for the whole job: every run on the session counts, and the counters survive a restart.
      sessionLimits: { maxRuns: 40, maxTotalTokens: 100_000 },
    });

  // The job checkpoints. A real host keeps them in SQLite or Postgres:
  // `createWorkflowCheckpoints({ store: persistence.checkpoints })`.
  const checkpoints = createMemoryWorkflowCheckpoints();
  const spec: Omit<AgentJobSpec, "jobId"> = {
    input: `Record each step until ${RUNS} steps are done.`,
    next: () => "Next step.",
    done: ({ lastRunResult }) => lastRunResult?.text.includes("ALL DONE") === true,
    maxRuns: 50,
    maxIdenticalOutcomes: 3,
    retry: { baseMs: 0, maxMs: 0 },
    checkpoints,
  };

  try {
    // Process A: the job starts; run 12 is in flight when the process dies.
    let crashed!: () => void;
    const died = new Promise<void>((resolve) => (crashed = resolve));
    const agentA = await agentFor(provider(() => crashed()));
    const sessionA = await agentA.session({ id: "migration", create: true });
    const processA = new AbortController();
    const jobA = runAgentJob(sessionA, { ...spec, jobId: "migration-job", signal: processA.signal });
    await died;

    // Process B: a fresh agent over the same session directory resumes the job.
    const agentB = await agentFor(provider());
    const sessionB = await agentB.session({ id: "migration" });
    const result = await resumeAgentJob(sessionB, spec, "migration-job");
    const limits = await sessionB.limits();
    const messages = await sessionB.messages();

    // Release process A's abandoned run only now, so it cannot touch the finished job.
    processA.abort("process A is gone");
    await jobA.catch(() => undefined);
    await agentA.dispose();
    await agentB.dispose();

    return {
      status: result.status,
      reason: result.reason,
      runs: result.runs,
      usage: result.usage,
      lastText: result.lastRun?.text,
      sessionRuns: limits.counters.runs,
      remainingRuns: limits.remaining.runs,
      userMessages: messages.filter((message) => message.role === "user").length,
      toolRuns: recorded.length,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
