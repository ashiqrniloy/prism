import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AgentIdentity } from "@arnilo/prism";
import {
  assertNoUnrestrictedPayload,
  createFilePolicyDecisionStore,
  createMemoryPolicyDecisionStore,
  createPolicyEvaluator,
  evaluateAndAppend,
  exportPolicyDecisions,
  HARD_POLICY_LIMITS,
  PolicyError,
  preparePolicyDecision,
  recordGuardrailDecision,
  recordPermissionDecision,
  recordToolApprovalDecision,
  resolvePolicyLimits,
} from "../index.js";

function identity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    principal: { kind: "agent", id: "agent-1" },
    sponsor: { kind: "user", id: "sponsor-1" },
    scopes: ["mail.read"],
    issuedAt: "2026-07-23T00:00:00.000Z",
    verified: true,
    ...overrides,
  };
}

describe("../index.js", () => {
  it("evaluates allow/deny/modify/approval with attribution and version pin", async () => {
    const evaluator = createPolicyEvaluator({
      policyId: "mail",
      policyVersion: "v1",
      evaluate: ({ action }) => {
        if (action === "mail.send") return { outcome: "approval", reason: "needs human", evidenceRefs: ["rule:send"] };
        if (action === "mail.draft") return { outcome: "modify", reason: "strip html", evidenceRefs: ["rule:sanitize"] };
        if (action === "mail.delete") return { outcome: "deny", reason: "forbidden" };
        return { outcome: "allow" };
      },
    });
    const store = createMemoryPolicyDecisionStore({ requirePolicyVersion: "v1" });
    const id = identity();
    const allow = await evaluateAndAppend(
      { identity: id, action: "mail.read", resource: { kind: "mailbox", id: "inbox" } },
      { store, evaluator, id: "d1" },
    );
    assert.equal(allow.outcome, "allow");
    assert.equal(allow.actor.principalId, "agent-1");
    assert.equal(allow.policyVersion, "v1");

    const deny = await evaluateAndAppend(
      { identity: id, action: "mail.delete", resource: { kind: "mailbox", id: "inbox" } },
      { store, evaluator, id: "d2" },
    );
    assert.equal(deny.outcome, "deny");

    const modify = await evaluateAndAppend(
      { identity: id, action: "mail.draft", resource: { kind: "draft", id: "1" } },
      { store, evaluator, id: "d3" },
    );
    assert.equal(modify.outcome, "modify");

    const approval = await evaluateAndAppend(
      { identity: id, action: "mail.send", resource: { kind: "draft", id: "1" } },
      { store, evaluator, id: "d4" },
    );
    assert.equal(approval.outcome, "approval");
    assert.deepEqual(approval.evidenceRefs, ["rule:send"]);

    await assert.rejects(
      () =>
        store.append({
          id: "bad-ver",
          policyId: "mail",
          policyVersion: "v2",
          outcome: "allow",
          identity: id,
          target: { kind: "mailbox", id: "inbox" },
          tenantId: "tenant-1",
          userId: "user-1",
        }),
      (error: unknown) => error instanceof PolicyError && error.code === "ERR_PRISM_POLICY_VERSION",
    );
  });

  it("rejects unrestricted payloads and missing identity evidence", () => {
    assert.throws(() => assertNoUnrestrictedPayload({ id: "1", payload: { prompt: "x" } }), /unrestricted payload/);
    assert.throws(
      () =>
        preparePolicyDecision({
          id: "1",
          policyId: "p",
          policyVersion: "1",
          outcome: "allow",
          identity: identity({ verified: true, expiresAt: "2000-01-01T00:00:00.000Z" }),
          target: { kind: "t", id: "1" },
          tenantId: "tenant-1",
          userId: "user-1",
        }),
      /expired|Identity/i,
    );
    assert.throws(
      () =>
        preparePolicyDecision({
          id: "1",
          policyId: "p",
          policyVersion: "1",
          outcome: "allow",
          identity: identity(),
          target: { kind: "t", id: "1" },
          tenantId: "tenant-1",
          userId: "user-1",
          reason: "x".repeat(HARD_POLICY_LIMITS.maxReasonBytes + 1),
        } as never),
      /reason exceeds/,
    );
  });

  it("memory and file ledgers are append-only; export is cursor-paginated", async () => {
    const id = identity();
    const store = createMemoryPolicyDecisionStore({ limits: { maxExportPageSize: 2 } });
    for (let i = 0; i < 5; i++) {
      await store.append({
        id: `m${i}`,
        policyId: "mail",
        policyVersion: "v1",
        outcome: i % 2 === 0 ? "allow" : "deny",
        identity: id,
        target: { kind: "mailbox", id: "inbox" },
        createdAt: `2026-07-23T00:00:0${i}.000Z`,
        tenantId: "tenant-1",
        userId: "user-1",
      });
    }
    const pages: number[] = [];
    const exported: string[] = [];
    for await (const page of exportPolicyDecisions({
      store,
      tenantId: "tenant-1",
      userId: "user-1",
      limits: { maxExportPageSize: 2 },
      sink: {
        async write(records) {
          exported.push(...records.map((r) => r.id));
        },
      },
    })) {
      pages.push(page.items.length);
      assert.ok(page.items.length <= 2);
    }
    assert.deepEqual(pages, [2, 2, 1]);
    assert.deepEqual(exported, ["m0", "m1", "m2", "m3", "m4"]);

    const dir = await mkdtemp(join(tmpdir(), "prism-policy-"));
    try {
      const path = join(dir, "decisions.jsonl");
      const fileStore = createFilePolicyDecisionStore({ path });
      await fileStore.append({
        id: "f1",
        policyId: "mail",
        policyVersion: "v1",
        outcome: "allow",
        identity: id,
        target: { kind: "mailbox", id: "inbox" },
        tenantId: "tenant-1",
        userId: "user-1",
      });
      const reopened = createFilePolicyDecisionStore({ path });
      const page = await reopened.query({ tenantId: "tenant-1", userId: "user-1" });
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0]?.id, "f1");
      const text = await readFile(path, "utf8");
      assert.match(text, /"id":"f1"/);
      assert.doesNotMatch(text, /prompt|sk-/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records guardrail, permission, and tool-approval decisions with verified identity", async () => {
    const store = createMemoryPolicyDecisionStore();
    const evaluator = { policyId: "secure", policyVersion: "1" };
    const id = identity();
    const g = await recordGuardrailDecision({
      store,
      evaluator,
      id: "g1",
      identity: id,
      record: { guardrail: "pii", stage: "input", action: "tripwire", reason: "ssn" },
    });
    assert.equal(g.outcome, "deny");
    assert.equal(g.target.kind, "guardrail:input");

    const p = await recordPermissionDecision({
      store,
      evaluator,
      id: "p1",
      identity: id,
      request: { kind: "tool", action: "execute", target: "mail.send" },
      decision: { allowed: false, reason: "denied" },
    });
    assert.equal(p.outcome, "deny");

    const a = await recordToolApprovalDecision({
      store,
      evaluator,
      id: "a1",
      identity: id,
      toolName: "mail.send",
      toolCallId: "call-9",
    });
    assert.equal(a.outcome, "approval");
    assert.deepEqual(a.evidenceRefs, ["tool_call:call-9"]);
  });

  it("enforces frozen default/hard limit caps", () => {
    const resolved = resolvePolicyLimits();
    assert.equal(resolved.maxDecisionBytes, 8 * 1024);
    assert.equal(resolved.maxExportPageSize, 100);
    assert.throws(() => resolvePolicyLimits({ maxExportPageSize: HARD_POLICY_LIMITS.maxExportPageSize + 1 }), /maxExportPageSize/);
  });
});
