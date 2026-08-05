import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_MCP_ELICITATION_MESSAGE_BYTES, mcpElicitationDecision, mcpElicitationResultFromDecision } from "../elicitation.js";
import { McpBridgeError } from "../types.js";

test("maps an untrusted ElicitRequest onto a shared elicitation pending decision", () => {
  const decision = mcpElicitationDecision(
    "a1",
    {
      message: "Which region?",
      requestedSchema: { type: "object", required: ["region"], properties: { region: { type: "string" } } },
    },
    { toolName: "deploy" },
  );
  assert.equal(decision.kind, "elicitation");
  assert.equal(decision.reason, "Which region?");
  assert.equal(decision.scope.toolName, "deploy");
  assert.deepEqual(decision.elicitationSchema?.required, ["region"]);
});

test("rejects malformed or oversized elicitation requests closed", () => {
  assert.throws(() => mcpElicitationDecision("a1", null), McpBridgeError);
  assert.throws(() => mcpElicitationDecision("a1", { message: 42 }), McpBridgeError);
  assert.throws(() => mcpElicitationDecision("a1", { message: "x".repeat(MAX_MCP_ELICITATION_MESSAGE_BYTES + 1) }), McpBridgeError);
  assert.throws(() => mcpElicitationDecision("a1", { message: "m", requestedSchema: { pad: "x".repeat(17 * 1024) } }), McpBridgeError);
});

test("maps decisions back to protocol results with the human-interaction marker enforced", () => {
  // Reject outcomes decline without any marker requirement.
  assert.deepEqual(mcpElicitationResultFromDecision({ approvalId: "a1", outcome: "reject_once" }), { action: "decline" });
  assert.deepEqual(mcpElicitationResultFromDecision({ approvalId: "a1", outcome: "reject_for_run" }), { action: "decline" });
  // Accept without a payload or without the marker fails closed.
  assert.throws(() => mcpElicitationResultFromDecision({ approvalId: "a1", outcome: "allow_once" }), /payload/);
  assert.throws(
    () => mcpElicitationResultFromDecision({ approvalId: "a1", outcome: "allow_once", elicitation: { region: "eu" } }),
    /explicit human interaction/,
  );
  const accepted = mcpElicitationResultFromDecision(
    { approvalId: "a1", outcome: "allow_once", elicitation: { region: "eu" } },
    { humanInteraction: true },
  );
  assert.equal(accepted.action, "accept");
  assert.deepEqual(accepted.content, { region: "eu" });
  assert.equal(accepted.humanInteraction, true);
});
