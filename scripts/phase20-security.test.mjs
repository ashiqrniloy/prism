/**
 * Phase 20 security conformance (plan 020 Task 5).
 *
 * Exercises the three 0.1.7 review blockers through BUILT PUBLIC package
 * entrypoints (workspace dist via package exports), never private source
 * imports — the original resume defect passed TypeScript declarations and
 * existed only at runtime, so the regression must run against the shipped
 * JavaScript surface:
 *
 *   T1/T4 (roadmap regression items 1-2): unknown durable-resume decision
 *     ("sideways") fails closed with a stable AgentDecisionError, performs no
 *     checkpoint write and no tool call, and consumes no version.
 *   T4  (roadmap regression item 3): work-tool subprocess environments never
 *     inherit ambient host env; the late-bound per-identity token layer is
 *     present only in the child env; reserved keys (HOME, telemetry disable)
 *     are forced.
 *   T8/T10-T12: an un-attested Disposable-shaped sandbox can never report
 *     filesystem (or any) isolation; malformed custom capability metadata
 *     resolves every field false; explicit valid metadata is copied and
 *     frozen; host mode reports no isolation.
 *
 * Gate accounting: one final test asserts all three blocker IDs were executed
 * and none was skipped, so a deleted/renamed/skipped blocker test fails the
 * suite even when the remaining tests pass.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  AgentDecisionError,
  createAgent,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  providerDone,
  providerTextDelta,
  resumeAgentRun,
  toolCallContent,
} from "@arnilo/prism";
import { createCliRunner } from "@arnilo/prism-core/integrations/work";
import {
  createCodingApprovalPolicy,
  createSandboxCodingComposition,
  resolveSandboxCapabilities,
} from "../packages/prism-coding-tools/dist/security/index.js";

const BLOCKER_IDS = ["resume-validation", "work-tools-env", "sandbox-capabilities"];
const blockerIds = new Set();

/** Durable suspended-run fixture: one pending decision, zero tool executions. */
async function suspendedRun() {
  const executed = [];
  let turn = 0;
  const provider = {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1) {
        yield { type: "tool_call", call: toolCallContent("call-1", "write", { value: "a" }) };
        yield providerDone();
        return;
      }
      yield providerTextDelta("finished");
      yield providerDone();
    },
  };
  const agent = createAgent({
    id: "phase20-demo",
    model: { provider: "mock", model: "demo" },
    store: createMemorySessionStore(),
    provider,
    tools: [
      {
        name: "write",
        parameters: {},
        execute: (args, context) => {
          executed.push(`${context.toolCallId}:${JSON.stringify(args)}`);
          return { toolCallId: context.toolCallId, name: "write", value: "done" };
        },
      },
    ],
  });
  const checkpoints = createMemoryCheckpointStore();
  const first = await agent.createSession({ id: "phase20-run" }).run("go", {
    runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
  });
  return { agent, checkpoints, executed, first };
}

describe("phase20 security conformance (plan 020 Task 5, built public entrypoints)", () => {
  it("T1/T4 blocker: unknown durable-resume decision 'sideways' fails closed with no write and no tool call", async () => {
    const { agent, checkpoints, executed, first } = await suspendedRun();
    assert.equal(first.status, "suspended");
    const pending = first.interruption.pendingDecisions;
    assert.equal(pending.length, 1);
    const version = first.runState.version;
    const ref = { runId: first.runId, sessionId: first.sessionId };

    await assert.rejects(
      resumeAgentRun(agent, ref, { expectedVersion: version, decision: "sideways" }, { checkpoints, definitionRevision: "1" }),
      (error) => error instanceof AgentDecisionError && error.code === "ERR_PRISM_DECISION_INVALID",
    );
    // No side effect, no version consumed, still suspended.
    assert.deepEqual(executed, []);
    assert.equal(first.runState.version, version);

    // The original expectedVersion still resumes: the rejected attempt wrote nothing.
    const approved = await resumeAgentRun(
      agent,
      ref,
      { expectedVersion: version, decisions: [{ approvalId: pending[0].approvalId, outcome: "allow_once" }] },
      { checkpoints, definitionRevision: "1" },
    );
    assert.equal(approved.status, "succeeded");
    assert.deepEqual(executed, ['call-1:{"value":"a"}']);
    blockerIds.add("resume-validation");
  });

  it("T4 blocker: work-tool child env never inherits ambient host env; token layer isolated; reserved keys forced", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "phase20-work-"));
    const runner = createCliRunner({ binary: process.execPath, configDir });
    const probe =
      "console.log(JSON.stringify({secret: process.env.PRISM_PROOF_SECRET, home: process.env.HOME, telemetry: process.env.CLIMICROSOFT365_DISABLETELEMETRY, token: process.env.M365_ACCESSTOKEN, path: process.env.PATH === undefined ? 'unset' : 'set'}))";
    process.env.PRISM_PROOF_SECRET = "phase20-ambient-canary";

    const result = await runner.exec(["-e", probe], { env: { M365_ACCESSTOKEN: "phase20-token" } });
    assert.equal(result.exitCode, 0, result.stderr);
    const child = JSON.parse(result.stdout);
    assert.equal(child.secret, undefined, "ambient host env leaked into the work-tool child");
    assert.equal(child.home, configDir, "HOME must be forced to the isolated configDir");
    assert.equal(child.telemetry, "1", "telemetry disable flag must be forced");
    assert.equal(child.token, "phase20-token", "late-bound per-identity token must reach the child env");
    assert.equal(child.path, "set", "minimal PATH base must be present");

    delete process.env.PRISM_PROOF_SECRET;
    blockerIds.add("work-tools-env");
  });

  it("T8/T10-T12 blocker: un-attested sandbox cannot claim isolation; malformed metadata fails closed; host mode reports none", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "phase20-sandbox-"));
    const unattested = {
      execFile: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      close: async () => {},
    };
    const policy = createCodingApprovalPolicy({ roots: [cwd], approve: async () => true });

    // Un-attested Disposable-shaped adapter: workspace coherence yes, isolation no.
    const { composition } = createSandboxCodingComposition(cwd, {
      workspaceMode: "sandbox",
      sandbox: unattested,
      executionPolicy: policy,
    });
    assert.equal(composition.capabilities.workspaceCoherent, true);
    for (const field of ["filesystemIsolated", "networkIsolated", "processIsolated", "privilegeIsolated", "egressRestricted"]) {
      assert.equal(composition.capabilities[field], false, `${field} must be false for an un-attested sandbox`);
    }
    assert.equal(composition.containmentClaim, false, "deprecated projection must stay conservative");

    // Malformed custom metadata resolves every field false.
    const malformed = resolveSandboxCapabilities({ ...unattested, capabilities: { filesystemIsolated: "yes" } });
    assert.equal(malformed.filesystemIsolated, false);
    assert.equal(malformed.networkIsolated, false);

    // Valid explicit metadata is host attestation: copied, validated, frozen.
    const attested = {
      workspaceCoherent: true,
      filesystemIsolated: true,
      networkIsolated: false,
      processIsolated: true,
      privilegeIsolated: false,
      egressRestricted: true,
    };
    const resolved = resolveSandboxCapabilities({ ...unattested, capabilities: attested });
    assert.deepEqual(resolved, attested);
    assert.ok(Object.isFrozen(resolved), "resolved capabilities must be frozen");

    // Host mode reports workspace coherence but no isolation.
    const host = createSandboxCodingComposition(cwd, { workspaceMode: "host", executionPolicy: policy });
    assert.equal(host.composition.capabilities.workspaceCoherent, true);
    assert.equal(host.composition.capabilities.filesystemIsolated, false);
    assert.equal(host.composition.capabilities.egressRestricted, false);
    blockerIds.add("sandbox-capabilities");
  });

  it("gate accounting: all three blocker IDs executed; none skipped or renamed away", () => {
    assert.deepEqual(
      [...blockerIds].sort(),
      [...BLOCKER_IDS].sort(),
      `blocker coverage incomplete; ran: ${[...blockerIds].sort().join(", ")}`,
    );
  });
});
