import {
  type Agent,
  createAgent,
  createMemorySessionStore,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type RunResult,
  type SessionStore,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { mockProvider } from "@arnilo/prism/testing";
import {
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  resumeWorkflow,
  runWorkflow,
  suspend,
} from "@arnilo/prism-extensions/workflows";
import memorySystem from "@arnilo/prism-memory-system";
import {
  ASK_USER_DECISION_SUSPEND_REASON,
  askUserDecisionResumeSchema,
  resolveAskUserDecisionAnswer,
  toAskUserDecisionSuspendData,
} from "@arnilo/prism-tools/coding";

/**
 * Conformance reference: goal → roadmap → per-task execute/validate with
 * supervisor children, observational memory, a human gate, and a host-side
 * bounded iterate-until-done loop. Mock providers only — no network, no creds.
 *
 * Docs mapped in comments: workflows.md (Bounded iterate-until-done host-loop
 * pattern), coding-agent-tools.md,
 * compaction-observational-memory.md, compaction-and-retry.md.
 */

const GOAL = "Fix parser";
const MAX_ITERATIONS = 3;
const MAX_TOKENS = 8_000;
const MAX_TOOL_CALLS = 8;
const WORKSPACE_SESSION_ID = "workspace";
const OWNERSHIP = { tenantId: "demo", userId: "coder" } as const;

/** The durable human gate (plan 154 Task 5): a workflow `suspend` carrying the answer schema. */
const GATE_DATA = toAskUserDecisionSuspendData({
  question: "Continue the coding loop?",
  selectionMode: "single",
  allowCustom: false,
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

/**
 * The observer worker. The package's prompt lists the eligible entries it was shown as `[id]`, so the
 * mock records one observation per entry it can see, exactly like a real worker would.
 */
function memoryWorkerProvider(): ModelProvider {
  return {
    id: "memory",
    async *generate(request) {
      const alreadyCalled = request.messages.some((message) => message.role === "tool");
      const prompt = request.messages.find((message) => message.role === "user")?.content[0];
      const text = prompt?.type === "text" ? prompt.text : "";
      const sourceEntryIds = [...text.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1] as string);
      if (!alreadyCalled && sourceEntryIds.length > 0) {
        yield providerToolCall(
          toolCallContent("c1", "record_event", {
            kind: "statement",
            description: "Coding loop recorded a child or parent turn.",
            relevance: "high",
            sourceEntryIds,
          }),
        );
      }
      yield providerDone();
    },
  };
}

async function childAgent(model: string, text: string, store: SessionStore): Promise<Agent> {
  return await createAgent({
    model: { provider: "mock", model },
    packages: [mockProvider([[providerTextDelta(text), providerDone()]])],
    slots: { store },
  });
}

function requireSucceeded(result: RunResult, childId: string): string {
  if (result.status !== "completed") throw new Error(`${childId} ${result.status}`);
  return result.text;
}

async function buildRuntime(store: SessionStore) {
  // Each child is a bounded one-shot agent (limits only narrow); `@arnilo/prism-extensions/delegate` is the model-facing form.
  const children: Record<string, () => Promise<Agent>> = {
    implementer: async () => await childAgent("implementer", "patched parser.ts", store),
    validator: async () => await childAgent("validator", "named checks ran", store),
  };
  const supervisor = {
    async delegate(request: { childId: string; input: string }): Promise<RunResult> {
      const agent = await children[request.childId]!();
      const childSession = await agent.session();
      try {
        return await childSession.run(request.input, {
          limits: { maxTotalTokens: MAX_TOKENS, maxToolCalls: MAX_TOOL_CALLS, maxWallTimeMs: 15_000 },
        });
      } finally {
        await childSession.close();
        await agent.dispose();
      }
    },
  };
  const parent = await createAgent({
    model: { provider: "mock", model: "parent" },
    packages: [
      mockProvider([[providerTextDelta("ack"), providerDone()]]),
      // The observer's model resolves through the agent's own providers, like any other model call.
      providerPackage("memory", [memoryWorkerProvider()]),
      // Roadmap §2.11: the package owns the toggle, the ledger, the context block, the recall tool,
      // the om* commands, and the `compaction` slot. It is off until `om` turns it on for a session.
      memorySystem({
        stm: { model: { provider: "memory", model: "worker" }, triggerTokens: 1 },
        // This demo records session events only; WM and rehearsal need no work here.
        wm: false,
        rehearsal: false,
        context: { recentMessages: 4, compactAt: { maxTokens: 999_999 } },
        worker: { maxTurns: 1 },
      }),
    ],
    slots: { store },
  });
  const leafId = (await store.list(WORKSPACE_SESSION_ID)).at(-1)?.id;
  // Recreate from the store leaf so the ledger survives the simulated restart.
  const session = await parent.session({ id: WORKSPACE_SESSION_ID, ...(leafId ? { leafId } : {}), create: true });
  // The 0.12 `om.attach()` call is now the package's per-session toggle.
  await parent.commands.run("memory:session", {}, { session });

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
          });
          // untrusted child text: record only, never eval
          await session.run(`implementer: ${requireSucceeded(result, "implementer")}`);
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
          });
          const summary = requireSucceeded(result, "validator");
          await session.run(`validator: ${summary}`);
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
          return suspend({
            reason: ASK_USER_DECISION_SUSPEND_REASON,
            data: GATE_DATA,
            resumeSchema: askUserDecisionResumeSchema(GATE_DATA),
          });
        },
      }),
      compact: functionNode({
        execute: async () => {
          // docs/compaction-and-retry.md — compact at task boundary, never during a run.
          // Roadmap §2.5: the implementation is the agent's `compaction` slot, so this only sizes it.
          await session.compact();
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

  return { workflow, session, parent, supervisor };
}

function validationPassed(outputs: Readonly<Record<string, unknown>>): boolean {
  const row = outputs.validate as { passed?: boolean } | undefined;
  return row?.passed === true;
}

export async function demo() {
  const checkpoints = createMemoryWorkflowCheckpoints();
  const store = createMemorySessionStore();

  let runtime = await buildRuntime(store);
  await runtime.session.run(`goal: ${GOAL}`);

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
      validateResume: (input) => {
        if (input.value === undefined || input.value === null) return;
        resolveAskUserDecisionAnswer(input.value as never, GATE_DATA.selectionMode, GATE_DATA.options, {
          allowCustom: GATE_DATA.allowCustom,
          maxCustomTextBytes: 2_048,
        });
      },
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

  // The ledger lives in package state, so the host reads it through the package's own commands.
  const status = (await runtime.parent.commands.run("memory:session:status", {}, { session: runtime.session })) as {
    observations?: { recorded?: number; active?: number };
  };
  const view = (await runtime.parent.commands.run("memory:session:view", {}, { session: runtime.session })) as { text?: string };

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
    omViewRendered: (view.text ?? "").length > 0,
    observationCount: status.observations?.recorded ?? 0,
    activeObservations: status.observations?.active ?? 0,
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
