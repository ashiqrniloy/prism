import assert from "node:assert/strict";
import {
  defineSwarmWorkflow,
  functionNode,
  getSwarmEvents,
  publishSwarmEvent,
  runWorkflow,
  withNodeScope,
  type SwarmEvent,
  type WorkflowEvent,
} from "@arnilo/prism-core/runtime/workflows";

/**
 * Event-Driven Swarm Topology Demo (Plan 131 Task 4).
 *
 * Demonstrates:
 * 1. Declarative swarm workflow: agents dynamically collaborate by publishing typed topic events.
 * 2. Scoped per-node state: withNodeScope isolates each agent's working memory under its own namespace.
 * 3. Dynamic topic matching: swarmRouterNode dispatches events to subscribed specialist agents.
 * 4. Cyclic event progression: triage -> research -> verification -> completion, terminating cleanly
 *    on idle drain when no more events are published.
 *
 * Standalone, network-free, zero secrets required.
 */

export interface SwarmDemoResult {
  readonly status: string;
  readonly incidentId: string;
  readonly triageCategory: string;
  readonly findingsCount: number;
  readonly verified: boolean;
  readonly totalWaves: number;
  readonly finalState: Record<string, unknown>;
}

export async function demo(): Promise<SwarmDemoResult> {
  console.log("=== Prism Event-Driven Swarm Topology Demo ===\n");

  const recordedEvents: WorkflowEvent[] = [];

  // Agent 1: Triage specialist - inspects new incident ticket and triggers specialized research
  const triageAgent = withNodeScope(
    "triage",
    functionNode({
      execute: async (ctx) => {
        const events = getSwarmEvents(ctx);
        const ticketEvent = events.find((e) => e.topic === "incident:new");
        const payload = ticketEvent?.payload as { incidentId: string; description: string; severity: string } | undefined;

        console.log(`[Triage] Received ticket ${payload?.incidentId} (Severity: ${payload?.severity})`);

        await ctx.updateState({
          incidentId: payload?.incidentId ?? "INC-8802",
          severity: payload?.severity ?? "P1",
          categorizedAt: new Date().toISOString(),
          assignedTrack: "security_vulnerability",
        });

        // Publish event requesting security research
        await publishSwarmEvent(ctx, {
          topic: "research:security",
          sender: "triage",
          payload: {
            incidentId: payload?.incidentId,
            query: "Analyze CVE-2026-9912 memory safety impact",
          },
        });

        return { status: "triaged", target: "research" };
      },
    }),
  );

  // Agent 2: Security Researcher specialist - gathers mitigation strategies
  const researchAgent = withNodeScope(
    "researcher",
    functionNode({
      execute: async (ctx) => {
        const events = getSwarmEvents(ctx);
        const researchEvent = events.find((e) => e.topic === "research:security");
        const payload = researchEvent?.payload as { incidentId: string; query: string } | undefined;

        console.log(`[Researcher] Investigating: "${payload?.query}" for incident ${payload?.incidentId}`);

        const findings = ["Identified bounds check bypass in legacy C extension", "Formulated Rust rewrite patch for input parser"];

        await ctx.updateState({
          query: payload?.query ?? "",
          findings,
          confidence: 0.98,
        });

        // Forward to verification agent
        await publishSwarmEvent(ctx, {
          topic: "verify:patch",
          sender: "researcher",
          payload: {
            incidentId: payload?.incidentId,
            proposedFix: "Rust parser migration",
            findingsCount: findings.length,
          },
        });

        return { status: "research_complete", findingsCount: findings.length };
      },
    }),
  );

  // Agent 3: Verifier specialist - tests and certifies the proposed fix
  const verifierAgent = withNodeScope(
    "verifier",
    functionNode({
      execute: async (ctx) => {
        const events = getSwarmEvents(ctx);
        const verifyEvent = events.find((e) => e.topic === "verify:patch");
        const payload = verifyEvent?.payload as { incidentId: string; proposedFix: string } | undefined;

        console.log(`[Verifier] Testing proposed fix "${payload?.proposedFix}"...`);

        await ctx.updateState({
          certified: true,
          verificationSuite: "148 tests passed (0 failures)",
          signedOffAt: new Date().toISOString(),
        });

        console.log(`[Verifier] Certified incident ${payload?.incidentId} fix. Concluding swarm workflow.`);
        // Publishes no further events -> swarm router drains and finishes
        return { status: "verified", passed: true };
      },
    }),
  );

  // Define the multi-agent swarm workflow with cyclic topic subscriptions
  const swarm = defineSwarmWorkflow({
    id: "incident-response-swarm",
    revision: "1",
    maxSupersteps: 12,
    agents: {
      triage: triageAgent,
      researcher: researchAgent,
      verifier: verifierAgent,
    },
    subscriptions: {
      "incident:new": ["triage"],
      "research:security": ["researcher"],
      "verify:patch": ["verifier"],
    },
    initialState: {
      __swarmEvents: [
        {
          topic: "incident:new",
          sender: "telemetry_probe",
          payload: {
            incidentId: "INC-8802",
            description: "High latency spike in authentication gateway",
            severity: "P1",
          },
        } satisfies SwarmEvent,
      ],
    },
  });

  const result = await runWorkflow(swarm, null, {
    onEvent: (e) => recordedEvents.push(e),
  });

  console.log(`\nSwarm workflow execution finished with status: ${result.status}`);

  assert.equal(result.status, "succeeded");

  const rootState = result.state as Record<string, unknown>;
  const triageState = rootState.triage as { incidentId: string; assignedTrack: string };
  const researcherState = rootState.researcher as { findings: string[]; confidence: number };
  const verifierState = rootState.verifier as { certified: boolean; verificationSuite: string };

  assert.equal(triageState.incidentId, "INC-8802");
  assert.equal(triageState.assignedTrack, "security_vulnerability");

  assert.equal(researcherState.findings.length, 2);
  assert.equal(researcherState.confidence, 0.98);

  assert.equal(verifierState.certified, true);

  const totalFinishedNodes = recordedEvents.filter((e) => e.type === "node_finished").length;

  console.log("\n[Demo Complete] Verified all stages of the event-driven swarm cycle.");

  return {
    status: result.status,
    incidentId: triageState.incidentId,
    triageCategory: triageState.assignedTrack,
    findingsCount: researcherState.findings.length,
    verified: verifierState.certified,
    totalWaves: totalFinishedNodes,
    finalState: rootState,
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
