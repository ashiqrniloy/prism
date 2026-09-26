import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { WorkflowDefinitionError } from "../errors.js";
import { functionNode } from "../nodes.js";
import { runWorkflow } from "../run.js";
import { withNodeScope } from "../scoped.js";
import {
  clearSwarmEvents,
  defineSwarmWorkflow,
  findSwarmEvent,
  getActiveSwarmEvents,
  getSwarmEvents,
  matchSwarmTopic,
  publishSwarmEvent,
} from "../swarm.js";
import type { WorkflowEvent } from "../types.js";

describe("Declarative Event-Driven Swarm Topology", () => {
  describe("matchSwarmTopic", () => {
    it("matches exact topics correctly", () => {
      assert.equal(matchSwarmTopic("ticket:billing", "ticket:billing"), true);
      assert.equal(matchSwarmTopic("ticket:billing", "ticket:technical"), false);
    });

    it("matches wildcard prefix topics", () => {
      assert.equal(matchSwarmTopic("ticket:*", "ticket:billing"), true);
      assert.equal(matchSwarmTopic("ticket:*", "ticket:technical"), true);
      assert.equal(matchSwarmTopic("ticket:*", "escalation:billing"), false);
    });

    it("matches universal wildcard", () => {
      assert.equal(matchSwarmTopic("*", "anything"), true);
      assert.equal(matchSwarmTopic("*", ""), true);
    });
  });

  describe("publishSwarmEvent & getSwarmEvents & clearSwarmEvents", () => {
    it("validates event fields and throws on invalid topic or sender", async () => {
      const mockCtx = {
        state: {},
        updateState: async () => ({}),
      } as unknown as import("../types.js").WorkflowNodeContext;

      await assert.rejects(() => publishSwarmEvent(mockCtx, { topic: "", sender: "a" }), WorkflowDefinitionError);
      await assert.rejects(() => publishSwarmEvent(mockCtx, { topic: "t", sender: "" }), WorkflowDefinitionError);
    });

    it("publishes to root state from a scoped context", async () => {
      let rootState: Record<string, unknown> = {
        worker1: { localVal: 1 },
      };

      const mockCtx: import("../scoped.js").ScopedWorkflowNodeContext = {
        workflowId: "test-wf",
        runId: "run-1",
        nodeId: "worker1",
        workflowInput: null,
        upstream: {},
        get state() {
          return rootState.worker1 as import("@arnilo/prism").JsonObject;
        },
        get rootState() {
          return rootState as import("@arnilo/prism").JsonObject;
        },
        stateVersion: 1,
        updateState: async (patch) => {
          rootState.worker1 = { ...(rootState.worker1 as object), ...patch };
          return rootState.worker1 as import("@arnilo/prism").JsonObject;
        },
        updateRootState: async (patch) => {
          rootState = { ...rootState, ...patch };
          return rootState as import("@arnilo/prism").JsonObject;
        },
      };

      await publishSwarmEvent(mockCtx, {
        topic: "order:completed",
        sender: "worker1",
        payload: { orderId: 42 },
      });

      const events = getSwarmEvents(mockCtx);
      assert.equal(events.length, 1);
      assert.equal(events[0].topic, "order:completed");
      assert.equal(events[0].sender, "worker1");
      assert.deepEqual(events[0].payload, { orderId: 42 });
      assert.ok(events[0].timestamp);

      // Ensure local scoped state wasn't polluted with __swarmEvents
      assert.deepEqual(rootState.worker1, { localVal: 1 });

      await clearSwarmEvents(mockCtx);
      assert.deepEqual(getSwarmEvents(mockCtx), []);
    });

    it("accesses active wave swarm events and finds events by topic", async () => {
      const mockCtx = {
        state: {
          __swarmActiveEvents: [
            { topic: "billing:invoice", sender: "billing", payload: { invoiceId: "INV-101" }, timestamp: 100 },
            { topic: "support:ticket", sender: "triage", payload: { ticketId: "TCK-202" }, timestamp: 101 },
          ],
        },
        updateState: async () => ({}),
      } as unknown as import("../types.js").WorkflowNodeContext;

      const activeEvents = getActiveSwarmEvents(mockCtx);
      assert.equal(activeEvents.length, 2);
      assert.equal(activeEvents[0].topic, "billing:invoice");

      const foundBilling = findSwarmEvent<{ invoiceId: string }>(mockCtx, "billing:*");
      assert.ok(foundBilling);
      assert.equal(foundBilling?.payload?.invoiceId, "INV-101");

      const notFound = findSwarmEvent(mockCtx, "security:*");
      assert.equal(notFound, undefined);
    });
  });

  describe("defineSwarmWorkflow validation", () => {
    it("rejects missing id or invalid maxSupersteps", () => {
      assert.throws(
        () =>
          defineSwarmWorkflow({
            id: "",
            maxSupersteps: 10,
            agents: { a: functionNode({ execute: () => "ok" }) },
            subscriptions: {},
          }),
        WorkflowDefinitionError,
      );

      assert.throws(
        () =>
          defineSwarmWorkflow({
            id: "swarm-1",
            maxSupersteps: 0,
            agents: { a: functionNode({ execute: () => "ok" }) },
            subscriptions: {},
          }),
        WorkflowDefinitionError,
      );
    });

    it("rejects unknown subscription targets", () => {
      assert.throws(
        () =>
          defineSwarmWorkflow({
            id: "swarm-1",
            maxSupersteps: 10,
            agents: { worker: functionNode({ execute: () => "ok" }) },
            subscriptions: {
              "task:*": ["nonexistent_agent"],
            },
          }),
        WorkflowDefinitionError,
      );
    });

    it("rejects agent name collision with routerId", () => {
      assert.throws(
        () =>
          defineSwarmWorkflow({
            id: "swarm-1",
            maxSupersteps: 10,
            agents: { router: functionNode({ execute: () => "ok" }) },
            subscriptions: {},
          }),
        WorkflowDefinitionError,
      );
    });
  });

  describe("End-to-end swarm execution", () => {
    it("routes events through multi-agent cycle with scoped state and terminates on idle drain", async () => {
      const recordedEvents: WorkflowEvent[] = [];

      // Agent 1: Triage agent (inspects new ticket and dispatches to billing or tech)
      const triage = withNodeScope(
        "triage",
        functionNode({
          execute: async (ctx) => {
            const events = getSwarmEvents(ctx);
            const ticketEvent = events.find((e) => e.topic === "ticket:new");
            const payload = ticketEvent?.payload as { category?: string; id?: string } | undefined;

            await ctx.updateState({
              processedTicket: payload?.id ?? "UNKNOWN",
              routedTo: payload?.category ?? "UNKNOWN",
            });

            if (payload?.category === "billing") {
              await publishSwarmEvent(ctx, {
                topic: "ticket:billing",
                sender: "triage",
                payload: { ticketId: payload.id, amount: 250 },
              });
            } else {
              await publishSwarmEvent(ctx, {
                topic: "ticket:tech",
                sender: "triage",
                payload: { ticketId: payload?.id, issue: "server down" },
              });
            }

            return "triage_done";
          },
        }),
      );

      // Agent 2: Billing specialist
      const billingSpecialist = withNodeScope(
        "billing",
        functionNode({
          execute: async (ctx) => {
            const events = getSwarmEvents(ctx);
            const billingEvent = events.find((e) => e.topic === "ticket:billing");
            const payload = billingEvent?.payload as { ticketId?: string; amount?: number } | undefined;

            await ctx.updateState({
              refundedAmount: payload?.amount ?? 0,
              status: "resolved",
            });

            // Notify completion
            await publishSwarmEvent(ctx, {
              topic: "ticket:resolved",
              sender: "billing",
              payload: { ticketId: payload?.ticketId, refundStatus: "success" },
            });

            return "billing_resolved";
          },
        }),
      );

      // Agent 3: Customer notifier
      const customerNotifier = withNodeScope(
        "notifier",
        functionNode({
          execute: async (ctx) => {
            const events = getSwarmEvents(ctx);
            const resolvedEvent = events.find((e) => e.topic === "ticket:resolved");
            const payload = resolvedEvent?.payload as { ticketId?: string } | undefined;

            await ctx.updateState({
              notifiedTicket: payload?.ticketId ?? "UNKNOWN",
              sent: true,
            });
            // Does not publish further events -> concludes the chain
            return "notification_sent";
          },
        }),
      );

      const swarm = defineSwarmWorkflow({
        id: "support-ticket-swarm",
        revision: "1",
        maxSupersteps: 10,
        agents: {
          triage,
          billingSpecialist,
          customerNotifier,
        },
        subscriptions: {
          "ticket:new": ["triage"],
          "ticket:billing": ["billingSpecialist"],
          "ticket:resolved": ["customerNotifier"],
        },
        initialState: {
          __swarmEvents: [
            {
              topic: "ticket:new",
              sender: "customer_portal",
              payload: { id: "TCK-1001", category: "billing" },
            },
          ],
        },
      });

      const result = await runWorkflow(swarm, null, {
        onEvent: (e) => recordedEvents.push(e),
      });

      assert.equal(result.status, "succeeded");

      // Verify scoped state isolation across all agents
      const state = result.state as Record<string, unknown>;
      assert.deepEqual(state.triage, {
        processedTicket: "TCK-1001",
        routedTo: "billing",
      });
      assert.deepEqual(state.billing, {
        refundedAmount: 250,
        status: "resolved",
      });
      assert.deepEqual(state.notifier, {
        notifiedTicket: "TCK-1001",
        sent: true,
      });

      // Verify node outputs
      assert.equal(result.outputs.triage, "triage_done");
      assert.equal(result.outputs.billingSpecialist, "billing_resolved");
      assert.equal(result.outputs.customerNotifier, "notification_sent");

      // Verify that all published events were cleared and swarm drained to empty
      assert.deepEqual(getSwarmEvents({ state: result.state } as import("../types.js").WorkflowNodeContext), []);
    });

    it("activates multiple agents when wildcard subscription matches", async () => {
      const auditLog: string[] = [];

      const worker = functionNode({
        execute: async (ctx) => {
          await publishSwarmEvent(ctx, {
            topic: "system:alert:high",
            sender: "worker",
            payload: { message: "Disk full" },
          });
          return "worker_done";
        },
      });

      const alertManager = functionNode({
        execute: () => {
          auditLog.push("alertManager:handled");
          return "alert_managed";
        },
      });

      const auditLogger = functionNode({
        execute: () => {
          auditLog.push("auditLogger:logged");
          return "audit_logged";
        },
      });

      const swarm = defineSwarmWorkflow({
        id: "fanout-swarm",
        revision: "1",
        maxSupersteps: 8,
        defaultTargets: ["worker"],
        agents: {
          worker,
          alertManager,
          auditLogger,
        },
        subscriptions: {
          "system:alert:*": ["alertManager", "auditLogger"],
        },
      });

      const result = await runWorkflow(swarm, null);
      assert.equal(result.status, "succeeded");
      assert.equal(result.outputs.worker, "worker_done");
      assert.equal(result.outputs.alertManager, "alert_managed");
      assert.equal(result.outputs.auditLogger, "audit_logged");
      assert.ok(auditLog.includes("alertManager:handled"));
      assert.ok(auditLog.includes("auditLogger:logged"));
    });
  });
});
