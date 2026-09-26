import assert from "node:assert/strict";
import {
  type AgentDefinition,
  type AIProvider,
  createAgentSession,
  providerDone,
  providerTextDelta,
  resolveAgentDefinition,
} from "@arnilo/prism";
import {
  agentNode,
  createMemoryWorkflowCheckpoints,
  defineWorkflow,
  functionNode,
  routeNode,
  runWorkflow,
  WorkflowSuperstepLimitError,
  type WorkflowEvent,
} from "@arnilo/prism-core/runtime/workflows";

/**
 * Cyclic Reflection + Dynamic Routing Demo (Plan 130 Task 7).
 *
 * Demonstrates:
 * 1. Cyclic workflow execution: worker drafts, reviewer evaluates, and a conditional back-edge
 *    iteratively revises the draft until quality criteria are met.
 * 2. Structured state updates: agent outputs are validated and written to workflow state.
 * 3. Dynamic routing via routeNode: inspects agent-written state and dispatches to either
 *    the revision back-edge or terminal exit branches (publish / escalate).
 * 4. Superstep engine limits: deterministic termination with observable budget breach fail-closed.
 *
 * Network-free; offline mock providers only.
 */

export interface ReflectionState {
  readonly round: number;
  readonly draft: string;
  readonly feedback?: string;
  readonly score: number;
  readonly decision?: "approve" | "revise" | "escalate";
  readonly status: "drafting" | "revising" | "approved" | "escalated";
}

export interface ReviewCritique {
  readonly score: number;
  readonly decision: "approve" | "revise" | "escalate";
  readonly critique: string;
}

export interface Deliverable {
  readonly title: string;
  readonly finalDraft: string;
  readonly qualityScore: number;
  readonly totalRounds: number;
  readonly approved: boolean;
  readonly publishedAt: string;
}

export interface CyclicReflectionDemoResult {
  readonly status: string;
  readonly rounds: number;
  readonly finalScore: number;
  readonly finalDeliverable: Deliverable;
  readonly budgetBreachObserved: boolean;
  readonly breachErrorCode: string;
  readonly wavesExecuted: number;
}

export function parseReviewCritique(text: string): { ok: true; value: ReviewCritique } | { ok: false; error: string } {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ok: false, error: "No JSON object found in review output" };
    const parsed = JSON.parse(jsonMatch[0]) as ReviewCritique;
    if (typeof parsed.score !== "number" || !parsed.decision || !parsed.critique) {
      return { ok: false, error: "Missing required review fields (score, decision, critique)" };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid JSON" };
  }
}

export function draftContent(round: number, feedback?: string): string {
  if (round === 1) {
    return "Prism 0.12.0 is released. It includes performance updates and workflow features.";
  }
  if (round === 2) {
    return (
      "Prism 0.12.0 introduces cyclic workflow graphs with an opt-in wave-based superstep scheduler, " +
      "checkpoint schema v2 for durable cycles, and LangGraph-equivalent dynamic routeNode routing. " +
      `(Addressed feedback: ${feedback ?? "none"})`
    );
  }
  return (
    "Prism 0.12.0 introduces cyclic workflow graphs with an opt-in wave-based superstep scheduler, " +
    "checkpoint schema v2 for durable cycles, and LangGraph-equivalent dynamic routeNode routing. " +
    "Install via `bun add @arnilo/prism` and read the docs at https://prism.dev/docs/workflows. " +
    `(Refined with feedback: ${feedback ?? "none"})`
  );
}

export function createMockReviewerProvider(): AIProvider {
  let turn = 0;
  return {
    id: "mock-reviewer",
    async *generate() {
      turn += 1;
      let critique: ReviewCritique;
      if (turn === 1) {
        critique = {
          score: 65,
          decision: "revise",
          critique: "Draft lacks technical depth. Mention cyclic workflow graphs, supersteps, and checkpoint v2.",
        };
      } else if (turn === 2) {
        critique = {
          score: 82,
          decision: "revise",
          critique: "Great technical coverage. Add install instructions and documentation link.",
        };
      } else {
        critique = {
          score: 96,
          decision: "approve",
          critique: "Excellent announcement. Clear, complete technical summary, and strong call to action.",
        };
      }
      yield providerTextDelta(JSON.stringify(critique));
      yield providerDone();
    },
  };
}

export function createAlwaysRevisingProvider(): AIProvider {
  return {
    id: "mock-always-revising",
    async *generate() {
      const critique: ReviewCritique = {
        score: 50,
        decision: "revise",
        critique: "Still needs revision (budget breach test).",
      };
      yield providerTextDelta(JSON.stringify(critique));
      yield providerDone();
    },
  };
}

export function createCyclicReflectionWorkflow(maxSupersteps = 16) {
  const worker = functionNode({
    activation: "any",
    execute: async (ctx) => {
      const state = ctx.state as Partial<ReflectionState>;
      const round = (state.round ?? 0) + 1;
      const draft = draftContent(round, state.feedback);
      await ctx.updateState({
        round,
        draft,
        status: "drafting",
      });
      return { round, draft };
    },
  });

  const reviewer = agentNode({
    agent: "reviewer",
    input: (ctx) => {
      const state = ctx.state as unknown as ReflectionState;
      return JSON.stringify({
        goal: (ctx.workflowInput as { goal?: string })?.goal ?? "Review announcement draft",
        currentDraft: state.draft,
        round: state.round,
        previousFeedback: state.feedback,
      });
    },
    output: async (ctx) => {
      const entries = await ctx.session.entries();
      const lastAssistant = [...entries].reverse().find((e) => e.message?.role === "assistant");
      const text = lastAssistant?.message?.content.map((b) => (b.type === "text" ? b.text : "")).join("") ?? "";
      const parsed = parseReviewCritique(text);
      if (!parsed.ok) {
        throw new Error(`Reviewer agent emitted invalid critique: ${parsed.error}`);
      }
      const review = parsed.value;
      await ctx.updateState({
        score: review.score,
        decision: review.decision,
        feedback: review.critique,
        status: review.decision === "approve" ? "approved" : "revising",
      });
      return review;
    },
  });

  const router = routeNode({
    select: async (ctx) => {
      const state = ctx.state as unknown as ReflectionState;
      if (state.decision === "approve") {
        return ["publish"];
      }
      if (state.decision === "escalate") {
        return ["escalate"];
      }
      // Conditional back-edge revises until approval or budget
      return ["worker"];
    },
  });

  const publish = functionNode({
    execute: (ctx) => {
      const state = ctx.state as unknown as ReflectionState;
      const deliverable: Deliverable = {
        title: "Prism 0.12.0 Release Announcement",
        finalDraft: state.draft,
        qualityScore: state.score,
        totalRounds: state.round,
        approved: true,
        publishedAt: new Date().toISOString(),
      };
      return deliverable;
    },
  });

  const escalate = functionNode({
    execute: (ctx) => {
      const state = ctx.state as unknown as ReflectionState;
      return {
        escalated: true,
        lastDraft: state.draft,
        lastScore: state.score,
        reason: "Quality threshold not met within revision budget",
      };
    },
  });

  return defineWorkflow({
    id: "cyclic-reflection-demo",
    revision: "1",
    limits: { maxSupersteps },
    state: {
      initial: {
        round: 0,
        draft: "",
        score: 0,
        status: "drafting",
      },
    },
    nodes: {
      worker,
      reviewer,
      router,
      publish,
      escalate,
    },
    edges: [
      ["worker", "reviewer"],
      ["reviewer", "router"],
      ["router", "worker"], // Cyclic back-edge
      ["router", "publish"], // Terminal success branch
      ["router", "escalate"], // Terminal escalation branch
    ],
  });
}

export async function demo(): Promise<CyclicReflectionDemoResult> {
  const checkpoints = createMemoryWorkflowCheckpoints();
  const reviewerDef: AgentDefinition = {
    name: "reviewer",
    model: { provider: "mock-reviewer", model: "reviewer-v1" },
    instructions: "Evaluate release announcement drafts and return JSON critique with score, decision, and feedback.",
  };

  // ── Run 1: Happy Path — Reflection Loop with Dynamic Routing ─────────────────
  console.log("=== Prism 0.12.0: Cyclic Reflection & Dynamic Routing Demo ===");
  console.log("\n[Run 1] Starting cyclic reflection workflow with maxSupersteps: 16...");

  const reviewerAgent = await resolveAgentDefinition(reviewerDef, {
    overrides: { provider: createMockReviewerProvider() },
  });

  const events: WorkflowEvent[] = [];
  const wf = createCyclicReflectionWorkflow(16);

  const result1 = await runWorkflow(
    wf,
    { goal: "Draft and polish the Prism 0.12.0 release announcement." },
    {
      checkpoints,
      runId: "cyclic-run-happy",
      ownership: { tenantId: "demo-tenant" },
      agentFactory: (name) => {
        if (name === "reviewer") return createAgentSession({ agent: reviewerAgent });
        throw new Error(`Unknown agent: ${name}`);
      },
      onEvent: (event) => {
        events.push(event);
        if (event.type === "node_started") {
          const iterStr = event.iteration !== undefined ? ` (round ${event.iteration + 1})` : "";
          console.log(`  [Wave ${event.sequence}] node_started:  ${event.nodeId}${iterStr}`);
        } else if (event.type === "node_finished") {
          console.log(`  [Wave ${event.sequence}] node_finished: ${event.nodeId}`);
        }
      },
    },
  );

  assert.equal(result1.status, "succeeded");
  const deliverable = result1.outputs.publish as Deliverable;
  assert.ok(deliverable);
  assert.equal(deliverable.approved, true);
  assert.ok(deliverable.qualityScore >= 90);
  assert.equal(deliverable.totalRounds, 3);

  console.log("\n[Run 1 Deliverable Published]");
  console.log(`  Title:         ${deliverable.title}`);
  console.log(`  Quality Score: ${deliverable.qualityScore} / 100`);
  console.log(`  Revisions:     ${deliverable.totalRounds} rounds`);
  console.log(`  Final Draft:   "${deliverable.finalDraft.slice(0, 100)}..."`);

  // ── Run 2: Fail-Closed Budget Breach Demonstration ───────────────────────────
  console.log("\n[Run 2] Demonstrating limits.maxSupersteps fail-closed budget breach...");
  const breachWf = createCyclicReflectionWorkflow(4); // Tight superstep budget
  const alwaysRevisingAgent = await resolveAgentDefinition(reviewerDef, {
    overrides: { provider: createAlwaysRevisingProvider() },
  });

  let budgetBreachObserved = false;
  let breachErrorCode = "";

  try {
    await runWorkflow(
      breachWf,
      { goal: "Draft announcement under strict 4-superstep budget." },
      {
        checkpoints,
        runId: "cyclic-run-budget-breach",
        ownership: { tenantId: "demo-tenant" },
        agentFactory: () => createAgentSession({ agent: alwaysRevisingAgent }),
      },
    );
  } catch (error) {
    if (error instanceof WorkflowSuperstepLimitError) {
      budgetBreachObserved = true;
      breachErrorCode = String(error.code);
      console.log(`  Caught expected budget breach: ${error.name} (code: ${error.code})`);
      console.log(`  Supersteps: ${error.supersteps} reached maxSupersteps limit of ${error.maxSupersteps}`);
    } else {
      throw error;
    }
  }

  assert.equal(budgetBreachObserved, true);
  assert.equal(breachErrorCode, "ERR_PRISM_WORKFLOW_SUPERSTEP_LIMIT");

  console.log("\n[Demo Complete] All assertions passed with zero network and mock providers.");

  return {
    status: result1.status,
    rounds: deliverable.totalRounds,
    finalScore: deliverable.qualityScore,
    finalDeliverable: deliverable,
    budgetBreachObserved,
    breachErrorCode,
    wavesExecuted: events.filter((e) => e.type === "node_finished").length,
  };
}

export async function main(): Promise<void> {
  const result = await demo();
  console.log("\nResult JSON:");
  console.log(JSON.stringify(result));
}

if (import.meta.main || import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
