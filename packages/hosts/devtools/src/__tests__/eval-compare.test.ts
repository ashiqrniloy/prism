import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Agent,
  createAgent,
  createSecretRedactor,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type RunResult,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { mockProvider } from "@arnilo/prism/testing";
import {
  createApprovalBeforeEffectScorer,
  createCitationIntegrityScorer,
  createErrorClassScorer,
  createToolCallMatchScorer,
  defineDataset,
  defineScorer,
  failingStore,
  failureInjection,
  runExperiment,
  runScenario,
  validateEvalManifest,
  validateReleaseEvalManifest,
} from "@arnilo/prism-hosts/evals";
import { type AgentIdentity } from "@arnilo/prism-extensions/governance";
import type { ExecutionStep, ExecutionTimeline } from "@arnilo/prism-extensions/observability";
import { summarizeTimeline } from "@arnilo/prism-extensions/observability";
import { createMemoryWorkDraftStore, validateApproval } from "@arnilo/prism-tools/work/connectors";
import { compareInspectorRuns, parseInspectorCompareBody, serveDevtools } from "../index.js";

const _OWNERSHIP = { tenantId: "local", userId: "local" } as const;
const here = dirname(fileURLToPath(import.meta.url));

function result(text = "Great answer.") {
  return { sessionId: "s", runId: "r", status: "completed" as const, text, content: [], messages: [] };
}

function timeline(steps: ExecutionStep[]): ExecutionTimeline {
  return {
    schemaVersion: 1,
    runId: "r",
    status: "succeeded",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:02.000Z",
    steps,
    redacted: true,
    content: "metadata",
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, cost: 0.4, currency: "USD" },
  };
}

function tool(
  order: number,
  name: string,
  status: ExecutionStep["status"] = "succeeded",
  extra: Partial<ExecutionStep> = {},
): ExecutionStep {
  return {
    id: `t${order}`,
    kind: "tool",
    name,
    order,
    status,
    startedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

describe("inspector eval comparison", () => {
  it("blocks quality winner when an invariant fails even if mean score is higher", () => {
    const comparison = compareInspectorRuns(
      {
        summary: { durationMs: 50, errorCount: 0, toolCallCount: 1, status: "succeeded", cost: { amount: 0.9, currency: "USD" } },
        aggregate: { macroMean: 0.99, invariantsPassed: false },
      },
      {
        summary: { durationMs: 80, errorCount: 0, toolCallCount: 0, status: "succeeded", cost: { amount: 0.2, currency: "USD" } },
        aggregate: { macroMean: 0.4, invariantsPassed: true },
      },
    );
    assert.equal(comparison.qualityWinner, "invariant_blocked");
    assert.equal(comparison.latencyWinner, "left");
    assert.equal(comparison.costWinner, "right");
  });

  it("POST /api/compare is metadata-safe over a served agent", async () => {
    const secret = "sk-live-secret-token";
    const agent = await createAgent({
      model: { provider: "mock", model: "offline" },
      packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])],
      redactor: createSecretRedactor([secret]),
    });
    const devtools = serveDevtools(agent, { port: 0 });
    try {
      const compared = await fetch(`${devtools.url}/api/compare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // `transcript` is not comparison metadata: the parser drops it, so the secret never echoes back.
          left: {
            summary: { durationMs: 100, errorCount: 0, toolCallCount: 1, status: "completed" },
            aggregate: { macroMean: 0.2, invariantsPassed: true },
            transcript: secret,
          },
          right: {
            summary: { durationMs: 110, errorCount: 0, toolCallCount: 0, status: "succeeded", cost: { amount: 0.01, currency: "USD" } },
            aggregate: { macroMean: 0.9, invariantsPassed: false },
          },
        }),
      });
      assert.equal(compared.status, 200);
      const text = await compared.text();
      assert.equal((JSON.parse(text) as { qualityWinner: string }).qualityWinner, "invariant_blocked");
      assert.equal(text.includes(secret), false);

      const malformed = await fetch(`${devtools.url}/api/compare`, { method: "POST", body: JSON.stringify({ left: {}, right: {} }) });
      assert.equal(malformed.status, 400);
    } finally {
      await devtools.close();
      await agent.dispose();
    }
  });

  it("rejects compare bodies that omit a summary", () => {
    assert.throws(() => parseInspectorCompareBody(JSON.stringify({ left: {}, right: {} })), /metadata summary/);
  });
});

describe("host-journey gates over plan 072 evals", () => {
  it("does not ship a second trajectory module", () => {
    assert.equal(existsSync(join(here, "..", "trajectory.ts")), false);
    assert.equal(existsSync(join(here, "..", "scenarios.ts")), false);
    assert.equal(typeof createToolCallMatchScorer, "function");
  });

  it("good answer after a forbidden tool fails the invariant, not the text", async () => {
    const forbidden = createToolCallMatchScorer({ mode: "superset", deny: ["drop_database"], invariant: true });
    const scored = await forbidden.score({
      result: result("Here is a thorough, high-quality answer."),
      timeline: timeline([tool(0, "drop_database")]),
    });
    assert.equal(scored.score, 0);
    assert.equal(forbidden.invariant, true, "the declaration, not returned metadata, marks the gate");
  });

  it("required ordering, missing approval, revoked ACL, and uncertain effect fail closed", async () => {
    const ordered = createToolCallMatchScorer({
      mode: "strict",
      expected: ["request_approval", "write_record"],
      invariant: true,
    });
    assert.equal(
      (
        await ordered.score({
          result: result(),
          timeline: timeline([tool(0, "write_record"), tool(1, "request_approval")]),
        })
      ).score,
      0,
    );

    const approval = createApprovalBeforeEffectScorer({ toolName: "write_record" });
    assert.equal((await approval.score({ result: result(), timeline: timeline([tool(0, "write_record")]) })).score, 0);
    assert.equal(
      (
        await approval.score({
          result: result(),
          timeline: timeline([tool(0, "write_record")]),
        })
      ).score,
      0,
      "a decision with no tool call id cannot approve a call",
    );
    // An `approved` step correlating on the call id passes; one for another call does not.
    assert.equal(
      (
        await approval.score({
          result: result(),
          timeline: timeline([
            {
              id: "h",
              kind: "hitl",
              name: "approve",
              order: 0,
              status: "approved",
              startedAt: "2026-01-01T00:00:00.000Z",
              metadata: { toolCallId: "c1", via: "inline" },
            },
            tool(1, "write_record", "succeeded", { id: "tool:c1", metadata: { toolCallId: "c1" } }),
          ]),
        })
      ).score,
      1,
    );
    assert.equal(
      (
        await approval.score({
          result: result(),
          timeline: timeline([
            {
              id: "h",
              kind: "hitl",
              name: "approve",
              order: 0,
              status: "approved",
              startedAt: "2026-01-01T00:00:00.000Z",
              metadata: { toolCallId: "c1" },
            },
            tool(1, "write_record", "succeeded", { id: "tool:c2", metadata: { toolCallId: "c2" } }),
          ]),
        })
      ).score,
      0,
      "approval of c1 does not cover c2",
    );

    const acl = createErrorClassScorer({ deny: ["acl_revoked"] });
    assert.equal(
      (
        await acl.score({
          result: result(),
          timeline: timeline([tool(0, "retrieve", "blocked", { error: { message: "revoked", code: "acl_revoked" } })]),
        })
      ).score,
      0,
    );

    const uncertain = createErrorClassScorer({ deny: ["ERR_PRISM_EFFECT_UNKNOWN"] });
    assert.equal(
      (
        await uncertain.score({
          result: result(),
          timeline: timeline([tool(0, "mail.send", "failed", { error: { message: "unknown", code: "ERR_PRISM_EFFECT_UNKNOWN" } })]),
        })
      ).score,
      0,
    );
  });

  it("clarify/refuse, store failure, and a bound manifest stay fail-closed", async () => {
    const replies = ["Could you clarify which account?", "I cannot transfer without verification."];
    let turn = 0;
    const agent = {
      config: {},
      async session() {
        return {
          id: "s",
          async run() {
            const text = replies[turn++] ?? "";
            return { sessionId: "s", runId: `r${turn}`, status: "completed", text, content: [], messages: [] };
          },
          subscribe() {
            return {
              async *[Symbol.asyncIterator]() {},
            };
          },
        };
      },
    } as unknown as import("@arnilo/prism").Agent;
    const scenario = await runScenario({
      agent,
      turns: [
        { user: "Transfer money", assertReply: (text) => assert.match(text, /clarify/i) },
        { user: "Account 9", assertReply: (text) => assert.match(text, /cannot/i) },
      ],
    });
    assert.equal(scenario.status, "succeeded");
    assert.equal(scenario.turnsCompleted, 2);

    const real = await createAgent({
      model: { provider: "mock", model: "offline" },
      packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])],
      slots: { store: failingStore() },
    });
    const injected = await real.session();
    const runRes = await injected.run("ok");
    assert.equal(runRes.status, "failed");
    assert.equal(runRes.error?.code, "ERR_PRISM_EVAL_STORE_FAILURE");

    validateEvalManifest({
      promptId: "prompt:personal-assistant:v1",
      promptVersion: "1",
      toolFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      skillsRevision: "skills-1",
      model: "mock:demo",
      policyRevision: "policy-1",
      runtimeRevision: "0.7.0",
      datasetVersion: "1.0.0",
    });
    validateReleaseEvalManifest({
      promptId: "prompt:personal-assistant:v1",
      promptVersion: "1",
      toolFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      model: "mock:demo",
      policyRevision: "policy-1",
      runtimeRevision: "0.7.0",
      datasetVersion: "1.0.0",
      datasetContentHash: defineDataset({ id: "manifest", items: [] }).contentHash,
    });
    assert.throws(() => validateEvalManifest({ runtimeRevision: "", datasetVersion: "1" }));
    assert.throws(() =>
      validateReleaseEvalManifest({
        runtimeRevision: "0.7.0",
        datasetVersion: "1.0.0",
      } as never),
    );

    const summary = summarizeTimeline(timeline([tool(0, "search")]));
    assert.equal(summary.toolCallCount, 1);
    assert.equal(JSON.stringify(summary).includes("Great answer"), false);
  });
});

function oneShotToolProvider(name: string): ModelProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1) {
        yield providerToolCall({ type: "tool_call", id: "c1", name, arguments: {} });
        yield providerDone();
        return;
      }
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
}

function countingAgent(onRun: () => void): Agent {
  return {
    config: {},
    async session() {
      return {
        id: "s",
        async *subscribe() {},
        async run() {
          onRun();
          return { sessionId: "s", runId: "r", status: "completed", text: "ok", content: [], messages: [] } as RunResult;
        },
      };
    },
  } as unknown as Agent;
}

const WORK_IDENTITY: AgentIdentity = {
  tenantId: "tenant-demo",
  userId: "worker-1",
  principal: { kind: "user", id: "worker-1" },
  scopes: ["Mail.Send"],
  issuedAt: new Date().toISOString(),
  verified: true,
};

describe("host-activity packs on true 072 primitives", () => {
  it("trials: 3 re-runs the item and reports sampleCount", async () => {
    let runs = 0;
    const report = await runExperiment({
      agent: countingAgent(() => {
        runs += 1;
      }),
      dataset: defineDataset({ id: "count", items: [{ id: "i", input: "x" }] }),
      scorers: [defineScorer({ id: "ok", score: () => ({ score: 1 }) })],
      trials: 3,
      seed: 1,
    });
    assert.equal(runs, 3);
    assert.equal(report.trials?.sampleCount, 3);
    assert.equal(report.items[0]?.trials.length, 3);
    assert.equal(report.aggregate.cost?.costComplete, false);
  });

  it("denyTools skips execute; unknownEffect is not success", async () => {
    let deniedRan = 0;
    const denied = await runExperiment({
      agent: await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [oneShotToolProvider("drop_database")])],
        hooks: failureInjection({ denyTools: ["drop_database"] }),
        tools: {
          add: [
            {
              name: "drop_database",
              description: "drop",
              parameters: { type: "object", properties: {} },
              async execute(_args, ctx) {
                deniedRan += 1;
                return { toolCallId: ctx.toolCallId, name: "drop_database", value: { dropped: true } };
              },
            },
          ],
        },
      }),
      dataset: defineDataset({ id: "deny", items: [{ id: "i", input: "drop" }] }),
      scorers: [
        defineScorer({
          id: "drop-not-succeeded",
          invariant: true,
          score: ({ timeline, result }) => {
            const steps = timeline?.steps.filter((s) => s.kind === "tool" && s.name === "drop_database") ?? [];
            const toolResults = result.messages.flatMap((m) => m.content).filter((b) => b.type === "tool_result");
            const ok =
              steps.length > 0
                ? steps.every((s) => s.status !== "succeeded")
                : toolResults.length > 0 && toolResults.some((r) => r.error !== undefined);
            return { score: ok ? 1 : 0 };
          },
        }),
      ],
      timeline: "metadata",
    });
    assert.equal(deniedRan, 0);
    assert.equal(denied.aggregate.invariantsPassed, true);

    let unknownRan = 0;
    const unknown = await runExperiment({
      agent: await createAgent({
        model: { provider: "mock", model: "demo" },
        packages: [providerPackage("test-provider", [oneShotToolProvider("write_record")])],
        hooks: failureInjection({ unknownEffect: true }),
        tools: {
          add: [
            {
              name: "write_record",
              description: "write",
              parameters: { type: "object", properties: {} },
              effect: { kind: "local_mutation", idempotency: "none" },
              async execute(_args, ctx) {
                unknownRan += 1;
                return { toolCallId: ctx.toolCallId, name: "write_record", value: { ok: true } };
              },
            },
          ],
        },
      }),
      dataset: defineDataset({ id: "unk", items: [{ id: "i", input: "write" }] }),
      scorers: [
        defineScorer({
          id: "effect-success",
          invariant: true,
          score: ({ timeline }) => {
            const tools = timeline?.steps.filter((s) => s.kind === "tool") ?? [];
            return { score: tools.some((s) => s.status === "succeeded") ? 1 : 0 };
          },
        }),
      ],
      timeline: "metadata",
    });
    assert.equal(unknownRan, 0);
    assert.equal(unknown.evaluations[0]?.score, 0);
  });

  it("stale Task 8 draft revision and revoked ACL citation fail closed", async () => {
    const store = createMemoryWorkDraftStore();
    const draft = store.createDraft({
      provider: "microsoft365",
      op: "mail.send",
      identity: WORK_IDENTITY,
      payload: { to: "a@contoso.com", subject: "v1" },
    });
    const approval = {
      draftId: draft.draftId,
      revision: draft.revision,
      payloadDigest: draft.payloadDigest,
    };
    const updated = store.updateDraft({
      draftId: draft.draftId,
      identity: WORK_IDENTITY,
      payload: { to: "a@contoso.com", subject: "v2" },
      expectedRevision: 1,
    });
    assert.throws(() => validateApproval(updated, approval), /does not match draft revision/);

    const bound = createApprovalBeforeEffectScorer({
      toolName: "mail.send",
      matchApproval: (step, effect) => step.kind === "hitl" && step.metadata?.draftRevision === effect.metadata?.draftRevision,
    });
    assert.equal(
      (
        await bound.score({
          result: result(),
          timeline: timeline([
            {
              id: "h",
              kind: "hitl",
              name: "approve",
              order: 0,
              status: "approved",
              startedAt: "2026-01-01T00:00:00.000Z",
              metadata: { draftRevision: 1 },
            },
            tool(1, "mail.send", "succeeded", { metadata: { draftRevision: 2 } }),
          ]),
        })
      ).score,
      0,
    );
    assert.equal(
      (
        await bound.score({
          result: result(),
          timeline: timeline([
            {
              id: "h",
              kind: "hitl",
              name: "approve",
              order: 0,
              status: "approved",
              startedAt: "2026-01-01T00:00:00.000Z",
              metadata: { draftRevision: 1 },
            },
            tool(1, "mail.send", "succeeded", { metadata: { draftRevision: 1 } }),
          ]),
        })
      ).score,
      1,
    );

    const integrity = createCitationIntegrityScorer();
    const revoked = await integrity.score({
      result: result(),
      environment: {
        citations: [
          {
            citation: { uri: "rag:s1", sourceId: "s1", revision: "1", contentHash: "aa".repeat(32) },
            live: { contentHash: "aa".repeat(32), revision: "1", authorized: false },
          },
        ],
      },
    });
    assert.equal(revoked.score, 0);
    assert.equal(revoked.reason, "revoked_acl");
  });

  it("coding test-oracle fails when the fixture hash is red", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prism-oracle-"));
    try {
      const fixture = join(dir, "oracle.txt");
      await writeFile(fixture, "ok\n");
      const oracle = defineScorer({
        id: "test-oracle",
        invariant: true,
        score: ({ environment }) => ({ score: (environment as { testsPassed?: boolean } | undefined)?.testsPassed ? 1 : 0 }),
      });
      const agent = await createAgent({
        model: { provider: "mock", model: "offline" },
        packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])],
      });
      const toEnvironment = async (item: { expected?: { hash?: string } }) => ({
        testsPassed:
          createHash("sha256")
            .update(await readFile(fixture))
            .digest("hex") === item.expected?.hash,
      });
      const red = await runExperiment({
        agent,
        dataset: defineDataset({
          id: "oracle-red",
          items: [{ id: "red", input: "x", expected: { hash: "00".repeat(32) } }],
        }),
        scorers: [oracle],
        toEnvironment,
      });
      assert.equal(red.aggregate.invariantsPassed, false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

it("devtools_quality_winner_uses_ci_overlap", () => {
  const side = (mean: number, low: number, high: number) => ({
    summary: { durationMs: 1, errorCount: 0, toolCallCount: 0, status: "succeeded" },
    aggregate: { macroMean: mean, scorers: { s: { mean, ci95: { low, high } } } },
  });
  const left = side(0.8, 0.6, 0.9),
    right = side(0.7, 0.5, 0.85);
  assert.equal(compareInspectorRuns(left, right).qualityWinner, "tie");
  assert.equal(parseInspectorCompareBody(JSON.stringify({ left, right })).qualityWinner, "tie");
  assert.equal(compareInspectorRuns(left, side(0.3, 0.2, 0.4)).qualityWinner, "left");
  assert.equal(compareInspectorRuns(side(0.3, 0.2, 0.4), left).qualityWinner, "right");
  assert.equal(compareInspectorRuns(left, { ...right, aggregate: { macroMean: 0.7 } }).qualityWinner, "left");
  assert.throws(() => parseInspectorCompareBody(JSON.stringify({ left, right: side(0.7, 0.9, 0.2) })));
});
