import {
  type Agent,
  type AgentRunResult,
  type AIProvider,
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type SessionStore,
  toolCallContent,
} from "@arnilo/prism";
import { createAskUserDecisionResumeValidator, suspendAskUserDecision } from "@arnilo/prism-coding-agent";
import {
  buildObservationalMemoryProjection,
  createObservationalMemory,
  createObservationalMemoryCompactionStrategy,
  recallObservationalMemory,
} from "@arnilo/prism-compaction-observational-memory";
import { createSupervisor } from "@arnilo/prism-supervisor";
import { createMemoryWorkflowCheckpoints, defineWorkflow, functionNode, resumeWorkflow, runWorkflow } from "@arnilo/prism-workflows";

/**
 * Conformance reference: goal → roadmap → per-task execute/validate with
 * supervisor children, observational memory, a human gate, and a host-side
 * bounded iterate-until-done loop. Mock providers only — no network, no creds.
 *
 * Docs mapped in comments: workflows.md (Bounded iterate-until-done host-loop
 * pattern), supervisors.md, coding-agent-tools.md,
 * compaction-observational-memory.md, compaction-and-retry.md.
 */

const GOAL = "Fix parser";
const MAX_ITERATIONS = 3;
const MAX_TOKENS = 8_000;
const MAX_TOOL_CALLS = 8;
const WORKSPACE_SESSION_ID = "workspace";
const OWNERSHIP = { tenantId: "demo", userId: "coder" } as const;

export class BudgetExhaustedError extends Error {
  readonly code = "budget_exhausted";
  readonly iterations: number;
  constructor(iterations: number) {
    super(`bounded iterate-until-done exhausted after ${iterations} iterations`);
    this.name = "BudgetExhaustedError";
    this.iterations = iterations;
  }
}

interface LoopInput {
  readonly goal: string;
  readonly iteration: number;
  readonly neverPass?: boolean;
}

function memoryWorkerProvider(store: SessionStore, sessionId: string): AIProvider {
  return {
    id: "memory",
    async *generate() {
      const entries = (await store.list(sessionId)).filter((entry) => entry.kind === "message" && entry.message?.role === "user");
      yield providerToolCall(
        toolCallContent("c1", "record_observation", {
          content: "Coding loop recorded a child or parent turn.",
          relevance: "high",
          sourceEntryIds: entries.map((entry) => entry.id),
        }),
      );
      yield providerDone();
    },
  };
}

function childAgent(model: string, text: string, store: SessionStore): Agent {
  // docs/supervisors.md — factory must return Agent, not a session (BUG-2)
  return createAgent({
    model: { provider: "mock", model },
    provider: createMockProvider([providerTextDelta(text), providerDone()]),
    store,
  });
}

function requireSucceeded(result: AgentRunResult, childId: string): string {
  if (result.status !== "succeeded") throw new Error(`${childId} ${result.status}`);
  return result.text;
}

async function buildRuntime(store: SessionStore) {
  const supervisor = createSupervisor({
    ownership: OWNERSHIP,
    limits: { maxTokens: MAX_TOKENS, maxToolCalls: MAX_TOOL_CALLS, timeoutMs: 15_000 },
    children: {
      implementer: { createAgent: () => childAgent("implementer", "patched parser.ts", store) },
      validator: { createAgent: () => childAgent("validator", "named checks ran", store) },
    },
  });
  const parent = createAgent({
    model: { provider: "mock", model: "parent" },
    provider: createMockProvider([providerTextDelta("ack"), providerDone()]),
    store,
  });
  const leafId = (await store.list(WORKSPACE_SESSION_ID)).at(-1)?.id;
  // Recreate from the store leaf so OM entries survive the simulated restart.
  const session = parent.createSession({ id: WORKSPACE_SESSION_ID, ...(leafId ? { leafId } : {}) });
  const om = createObservationalMemory({
    observation: { provider: memoryWorkerProvider(store, WORKSPACE_SESSION_ID), model: { provider: "mock", model: "memory" } },
    context: { recentMessages: 4, compactAfterTokens: 999_999 },
    overrides: { observation: { messageTokens: 1 }, reflection: { observationTokens: 999_999 }, agentMaxTurns: 1 },
  });
  const attached = om.attach(session, {
    appendEntry: (entry, options) => store.append(entry, options),
    sessionModel: { provider: "mock", model: "parent" },
  });
  const compaction = createObservationalMemoryCompactionStrategy({ keepRecentEntries: 4 });

  const workflow = defineWorkflow({
    id: "autonomous-coding-loop",
    revision: "1",
    nodes: {
      roadmap: functionNode({
        execute: async (ctx) => {
          // docs/workflows.md — iteration state lives in workflow inputs
          const input = ctx.workflowInput as LoopInput;
          if (input.iteration > 0) return { phases: ["phase-1: parser"] };
          return { phases: ["phase-1: parser", "phase-2: tests"] };
        },
      }),
      execute: functionNode({
        execute: async (ctx) => {
          const input = ctx.workflowInput as LoopInput;
          const result = await supervisor.delegate({
            childId: "implementer",
            input: `${input.goal} task ${input.iteration}`,
            limits: { maxTokens: 4_000, maxToolCalls: 4 },
          });
          // untrusted child text: record only, never eval
          await attached.session.run(`implementer: ${requireSucceeded(result, "implementer")}`);
          return { patch: result.text };
        },
      }),
      validate: functionNode({
        execute: async (ctx) => {
          // docs/coding-agent-tools.md — runCodingGoalVerify-style check summary
          const input = ctx.workflowInput as LoopInput;
          const result = await supervisor.delegate({
            childId: "validator",
            input: String((ctx.upstream.execute as { patch?: string } | undefined)?.patch ?? ""),
            limits: { maxTokens: 4_000, maxToolCalls: 4 },
          });
          const summary = requireSucceeded(result, "validator");
          await attached.session.run(`validator: ${summary}`);
          const passed = input.neverPass !== true && input.iteration >= 1;
          return { summary, passed };
        },
      }),
      gate: functionNode({
        execute: async (ctx) => {
          // docs/workflows.md — resume-aware: ctx.resume ? handle : suspend
          const input = ctx.workflowInput as LoopInput;
          if (input.iteration > 0 || input.neverPass) return { continued: true };
          if (ctx.resume) {
            const selectedId = (ctx.resume.input as { selectedId?: string } | undefined)?.selectedId;
            if (selectedId !== "continue") throw new Error(`gate rejected ${selectedId}`);
            return { continued: true, selectedId };
          }
          return suspendAskUserDecision({
            question: "Continue the coding loop?",
            selectionMode: "single",
            options: [
              {
                id: "continue",
                label: "Continue",
                pros: ["Keeps momentum", "Uses remaining budget", "Human still in the loop"],
                cons: ["More tool calls", "More tokens", "Another compaction"],
              },
              {
                id: "stop",
                label: "Stop",
                pros: ["Saves budget", "Stops now", "No extra child runs"],
                cons: ["Goal unfinished", "Drops context", "Needs a later restart"],
              },
            ],
          });
        },
      }),
      compact: functionNode({
        execute: async () => {
          // docs/compaction-and-retry.md — compact at task boundary, never during a run
          await attached.session.compact({ strategy: compaction });
          return { compacted: true };
        },
      }),
    },
    edges: [
      ["roadmap", "execute"],
      ["execute", "validate"],
      ["validate", "gate"],
      ["gate", "compact"],
    ],
  });

  return { workflow, attached, supervisor };
}

function validationPassed(outputs: Readonly<Record<string, unknown>>): boolean {
  const row = outputs.validate as { passed?: boolean } | undefined;
  return row?.passed === true;
}

export async function demo() {
  const checkpoints = createMemoryWorkflowCheckpoints();
  const store = createMemorySessionStore();

  let runtime = await buildRuntime(store);
  await runtime.attached.session.run(`goal: ${GOAL}`);

  const suspended = await runWorkflow(runtime.workflow, { goal: GOAL, iteration: 0 } satisfies LoopInput, {
    checkpoints,
    ownership: OWNERSHIP,
  });
  if (suspended.status !== "suspended") throw new Error(`expected suspended, got ${suspended.status}`);

  // Simulated restart: drop in-memory handles, rebuild, resume from the same checkpoints.
  runtime = await buildRuntime(store);
  const resumed = await resumeWorkflow(
    runtime.workflow,
    { runId: suspended.runId },
    {
      checkpoints,
      ownership: OWNERSHIP,
      validateResume: createAskUserDecisionResumeValidator(),
      resume: {
        decision: "approve",
        expectedVersion: suspended.version,
        input: { selectedId: "continue" },
      },
    },
  );
  if (resumed.status !== "succeeded") throw new Error(`expected resumed succeeded, got ${resumed.status}`);

  let iterations = 1;
  let last = resumed;
  // docs/workflows.md — Bounded iterate-until-done (host-loop pattern)
  while (!validationPassed(last.outputs) && iterations < MAX_ITERATIONS) {
    last = await runWorkflow(runtime.workflow, { goal: GOAL, iteration: iterations } satisfies LoopInput, {
      checkpoints,
      ownership: OWNERSHIP,
    });
    if (last.status !== "succeeded") throw new Error(`iteration ${iterations} ${last.status}`);
    iterations += 1;
  }
  if (!validationPassed(last.outputs)) throw new Error("happy path should pass before budget");

  const entries = await runtime.attached.session.entries();
  const projection = buildObservationalMemoryProjection(entries);
  const observationId = projection.observations[0]?.id ?? projection.full.observations[0]?.id;
  const recall = observationId ? recallObservationalMemory(entries, observationId) : { found: false as const };

  let budgetExhaustedIterations = 0;
  try {
    for (let i = 1; i <= MAX_ITERATIONS; i += 1) {
      budgetExhaustedIterations = i;
      const run = await runWorkflow(runtime.workflow, { goal: GOAL, iteration: i, neverPass: true } satisfies LoopInput, {
        checkpoints,
        ownership: OWNERSHIP,
      });
      if (run.status !== "succeeded") throw new Error(`exhaustion ${i} ${run.status}`);
      if (validationPassed(run.outputs)) throw new Error("exhaustion loop must not pass");
    }
    throw new BudgetExhaustedError(budgetExhaustedIterations);
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) throw error;
    budgetExhaustedIterations = error.iterations;
  }

  return {
    iterations,
    passed: true,
    suspendedRestart: true,
    budgetExhaustedIterations,
    budgetExhausted: budgetExhaustedIterations === MAX_ITERATIONS,
    recallFound: recall.found,
    observationCount: projection.full.observations.length,
    childModels: ["implementer", "validator"],
    validatorSummary: (last.outputs.validate as { summary?: string } | undefined)?.summary,
  };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
