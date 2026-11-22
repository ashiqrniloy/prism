import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Agent, Message, ModelProvider, ProviderRequest, SessionLimitsStatus } from "@arnilo/prism";
import { definePackage } from "@arnilo/prism";
import { providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { createSqlitePersistence } from "@arnilo/prism-extensions/store-sqlite";
import {
  type AgentJobResult,
  type AgentJobSpec,
  createWorkflowCheckpoints,
  resumeAgentJob,
  runAgentJob,
} from "@arnilo/prism-extensions/workflows";
import { createCodingWorker } from "../host/coding.js";
import type { HostConfig } from "../host/config.js";

const SESSION = "long-job";
const JOB = "long-job-1";
/** Runs the job takes to finish. */
export const LONG_JOB_RUNS = 30;
/** The run in flight when the first process dies, after its tool round. */
export const LONG_JOB_CRASH_RUN = 12;
const USAGE = { inputTokens: 40, outputTokens: 10 };

export interface LongJobResult {
  /** The first process's job had not returned when the process died. */
  readonly crashedMidRun: boolean;
  readonly result: AgentJobResult;
  readonly limits: SessionLimitsStatus;
  /** Model requests the restarted process made. */
  readonly requestsAfterCrash: number;
  readonly userMessages: number;
  readonly toolResults: number;
  readonly files: readonly string[];
  readonly finalText: string | undefined;
}

const userCount = (request: ProviderRequest) => request.messages.filter((message) => message.role === "user").length;
const afterToolRound = (request: ProviderRequest) => request.messages.at(-1)?.content.some((part) => part.type === "tool_result") === true;

/**
 * Run N writes `progress/step-N.txt`, then reports. The run number is the count of user messages, so a continued run
 * keeps its number. `crashAt` makes the provider hang on that run's second turn (after the write), as a dead process.
 */
function jobProvider(requests: ProviderRequest[], crashAt?: { run: number; reached: () => void }): ModelProvider {
  return {
    id: "mock",
    async *generate(request) {
      requests.push(request);
      const run = userCount(request);
      if (!afterToolRound(request)) {
        yield providerToolCall(toolCallContent(`w${run}`, "write", { path: `progress/step-${run}.txt`, content: `step ${run}` }));
        yield providerDone(USAGE);
        return;
      }
      if (crashAt?.run === run) {
        crashAt.reached();
        await new Promise((_resolve, reject) => request.signal?.addEventListener("abort", () => reject(request.signal?.reason)));
        return;
      }
      yield providerTextDelta(run === LONG_JOB_RUNS ? `step ${run} of ${LONG_JOB_RUNS}: ALL DONE` : `step ${run} of ${LONG_JOB_RUNS}`);
      yield providerDone(USAGE);
    },
  };
}

function providerPackage(provider: ModelProvider) {
  return definePackage({
    name: "@prism-agent/long-job-provider",
    version: "0.0.0",
    requires: { api: 2 },
    setup(prism) {
      prism.providers.register(provider);
    },
  })();
}

/** The host's job spec. Run limits and the stall axis stay at the host's and the kernel's defaults. */
function jobSpec(storePath: string): Omit<AgentJobSpec, "jobId"> {
  return {
    input: `Write progress/step-N.txt for each step until ${LONG_JOB_RUNS} steps are done.`,
    next: () => "Next step.",
    done: ({ lastRunResult }) => lastRunResult?.text.includes("ALL DONE") === true,
    maxRuns: LONG_JOB_RUNS + 10,
    retry: { baseMs: 0, maxMs: 0 },
    checkpoints: createWorkflowCheckpoints({ store: createSqlitePersistence({ filename: storePath }).checkpoints }),
  };
}

/**
 * A 30-run coding job through `runAgentJob`. The first process dies inside run 12, after its tool round; a fresh coding
 * worker over the same SQLite file resumes the job with `resumeAgentJob`, continues the in-flight run without
 * running its tool again, and runs to `done`. The host's `sessionLimits` bound the job across both processes.
 */
export async function longJob(config: HostConfig): Promise<LongJobResult> {
  mkdirSync(config.workspace, { recursive: true });
  let reached!: () => void;
  const crashed = new Promise<void>((resolve) => (reached = resolve));

  // Process A: runs 1–11 finish; run 12 writes its file, then the process "dies" waiting on the model.
  const agentA: Agent = await createCodingWorker(config, {
    packages: [providerPackage(jobProvider([], { run: LONG_JOB_CRASH_RUN, reached }))],
  });
  const sessionA = await agentA.session({ id: SESSION, create: true });
  const abortA = new AbortController();
  let returnedA = false;
  const jobA = runAgentJob(sessionA, { ...jobSpec(config.storePath), jobId: JOB, signal: abortA.signal }).finally(() => {
    returnedA = true;
  });
  await crashed;
  const crashedMidRun = !returnedA;

  // Process B: a fresh worker over the same store and checkpoints.
  const requestsB: ProviderRequest[] = [];
  const agentB = await createCodingWorker(config, { packages: [providerPackage(jobProvider(requestsB))] });
  try {
    const sessionB = await agentB.session({ id: SESSION });
    const result = await resumeAgentJob(sessionB, jobSpec(config.storePath), JOB);
    const limits = await sessionB.limits();
    const messages: readonly Message[] = await sessionB.messages();
    const last = messages.at(-1)?.content.find((part) => part.type === "text");
    const progress = join(config.workspace, "progress");
    return {
      crashedMidRun,
      result,
      limits,
      requestsAfterCrash: requestsB.length,
      userMessages: messages.filter((message) => message.role === "user").length,
      toolResults: messages.filter((message) => message.content.some((part) => part.type === "tool_result")).length,
      files: existsSync(progress) ? readdirSync(progress).sort() : [],
      finalText: last?.type === "text" ? last.text : undefined,
    };
  } finally {
    // Process A is gone: its abandoned run is released only after B has finished the job.
    abortA.abort("process A is gone");
    await jobA.catch(() => undefined);
    await agentA.dispose();
    await agentB.dispose();
  }
}
