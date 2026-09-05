/**
 * Plans/064 Task 9 live OPA policy-evaluator probes against a real OPA
 * decision endpoint (e.g. https://opa:8181/v1/data/prism/allow).
 * Env-gated: skipped (never failed) unless PRISM_TEST_OPA_URL is set.
 * Bounded: ≤ 2 real requests. The fail-closed probe never touches the
 * operator endpoint (unroutable loopback socket).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AgentIdentity } from "@arnilo/prism";
import { createOpaPolicyEvaluator } from "../opa.js";

const OPA_URL = process.env.PRISM_TEST_OPA_URL;
const skip: string | false = !OPA_URL
  ? "set PRISM_TEST_OPA_URL (e.g. https://opa:8181/v1/data/prism/allow) to run live OPA evaluator probes"
  : false;

function identity(): AgentIdentity {
  return {
    tenantId: "live-opa-tenant",
    userId: "live-opa-user",
    principal: { kind: "agent", id: "live-opa-agent" },
    scopes: ["live.probe"],
    issuedAt: new Date().toISOString(),
    verified: true,
  };
}

describe("@arnilo/prism-core governance/policy/opa live tests", () => {
  it("live_real_endpoint_maps_decisions", { skip }, async () => {
    const evaluator = createOpaPolicyEvaluator({
      url: OPA_URL!,
      policyId: "live-opa-probe",
      policyVersion: "live",
      timeoutMs: 5_000,
    });
    const read = await evaluator.evaluate({ identity: identity(), action: "read", resource: { kind: "mailbox", id: "inbox" } });
    assert.ok(
      ["allow", "deny", "modify", "approval"].includes(read.outcome),
      `real endpoint must map to a valid outcome, got ${read.outcome}`,
    );
    const write = await evaluator.evaluate({ identity: identity(), action: "write", resource: { kind: "mailbox", id: "inbox" } });
    assert.ok(
      ["allow", "deny", "modify", "approval"].includes(write.outcome),
      `real endpoint must map to a valid outcome, got ${write.outcome}`,
    );
  });

  it("live_unreachable_endpoint_fails_closed_deny", { skip }, async () => {
    const evaluator = createOpaPolicyEvaluator({
      // Unroutable discard port: the fetch fails (or is SSRF-refused) and the
      // adapter must answer deny, never allow.
      url: "http://127.0.0.1:9/v1/data/prism/allow",
      policyId: "live-opa-fail-closed",
      policyVersion: "live",
      timeoutMs: 2_000,
      maxRetries: 0,
    });
    const result = await evaluator.evaluate({ identity: identity(), action: "read", resource: { kind: "mailbox", id: "inbox" } });
    assert.equal(result.outcome, "deny", "transport failure must fail closed to deny");
    assert.equal(result.reason, "OPA endpoint unavailable");
  });
});
