import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  type Agent,
  type AgentEventRecord,
  type AgentIdentity,
  type AgentRunResult,
  type AIProvider,
  createAgent,
  createMemoryAgentEventSource,
  createMockProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
} from "@arnilo/prism";
import {
  createApprovalBeforeEffectScorer,
  createCitationIntegrityScorer,
  createErrorClassScorer,
  createToolCallMatchScorer,
  defineDataset,
  defineScorer,
  runExperiment,
  runScenario,
  validateEvalManifest,
  validateReleaseEvalManifest,
  wrapAgentWithFailureInjection,
} from "@arnilo/prism-core/governance/evals";
import { createMemoryWorkDraftStore, validateApproval } from "@arnilo/prism-core/integrations/work";
import type { ExecutionStep, ExecutionTimeline } from "@arnilo/prism-core/governance/observability";
import { summarizeTimeline } from "@arnilo/prism-core/governance/observability";
import { compareInspectorRuns, createPrismDevInspector, parseInspectorCompareBody } from "../index.js";

const OWNERSHIP = { tenantId: "local", userId: "local" } as const;
const here = dirname(fileURLToPath(import.meta.url));

function result(text = "Great answer.") {
  return { sessionId: "s", runId: "r", status: "succeeded" as const, text, content: [] };
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
        aggregate: { meanScore: 0.99, invariantsPassed: false },
      },
      {
        summary: { durationMs: 80, errorCount: 0, toolCallCount: 0, status: "succeeded", cost: { amount: 0.2, currency: "USD" } },
        aggregate: { meanScore: 0.4, invariantsPassed: true },
      },
    );
    assert.equal(comparison.qualityWinner, "invariant_blocked");
    assert.equal(comparison.latencyWinner, "left");
    assert.equal(comparison.costWinner, "right");
  });

  it("POST /compare is metadata-safe and GET /runs/:id/summary uses summarizeTimeline", async () => {
    const events = createMemoryAgentEventSource() as ReturnType<typeof createMemoryAgentEventSource> & { close(): void };
    const secret = "sk-live-secret-token";
    const base = { sessionId: "session-1", runId: "stored-run", redacted: true, ...OWNERSHIP };
    const records: AgentEventRecord[] = [
      {
        ...base,
        id: "event-1",
        type: "agent_started",
        timestamp: "2026-09-05T00:00:00.000Z",
        event: { type: "agent_started", sessionId: "session-1", runId: "stored-run" },
      },
      {
        ...base,
        id: "event-2",
        type: "message_delta",
        timestamp: "2026-09-05T00:00:01.000Z",
        event: {
          type: "message_delta",
          sessionId: "session-1",
          runId: "stored-run",
          content: { type: "text", text: secret },
        },
      },
      {
        ...base,
        id: "event-3",
        type: "agent_finished",
        timestamp: "2026-09-05T00:00:02.000Z",
        event: {
          type: "agent_finished",
          sessionId: "session-1",
          runId: "stored-run",
          usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8, cost: 0.25, currency: "USD" },
        },
      },
    ];
    for (const record of records) await events.append(record);
    const inspector = createPrismDevInspector({
      agent: createAgent({
        model: { provider: "mock", model: "offline" },
        provider: createMockProvider([providerTextDelta("ok"), providerDone()]),
      }),
      port: 0,
      eventSource: events,
      resolveRun: (input) => (input.runId === "public-run" ? { sessionId: "session-1", runId: "stored-run" } : undefined),
    });
    await inspector.listen();
    const root = inspector.url.replace(/\/prism$/, "");
    try {
      const summaryRes = await fetch(`${root}/runs/public-run/summary`);
      assert.equal(summaryRes.status, 200);
      const summary = (await summaryRes.json()) as {
        durationMs: number;
        errorCount: number;
        toolCallCount: number;
        status: string;
        cost?: { amount: number };
      };
      assert.equal(typeof summary.durationMs, "number");
      assert.equal(summary.errorCount, 0);
      const dumped = JSON.stringify(summary);
      assert.equal(dumped.includes(secret), false);

      const compared = await fetch(`${root}/compare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          left: { summary, aggregate: { meanScore: 0.2, invariantsPassed: true } },
          right: {
            summary: {
              durationMs: summary.durationMs + 10,
              errorCount: 0,
              toolCallCount: 0,
              status: "succeeded",
              cost: { amount: 0.01, currency: "USD" },
            },
            aggregate: { meanScore: 0.9, invariantsPassed: false },
          },
        }),
      });
      assert.equal(compared.status, 200);
      const body = (await compared.json()) as { qualityWinner: string };
      assert.equal(body.qualityWinner, "invariant_blocked");

      const missing = await fetch(`${root}/runs/nope/summary`);
      assert.equal(missing.status, 404);
    } finally {
      await inspector.close();
      events.close();
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
    assert.equal(scored.metadata?.invariant, true);
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
          timeline: timeline([
            { id: "h", kind: "hitl", name: "approve", order: 0, status: "succeeded", startedAt: "2026-01-01T00:00:00.000Z" },
            tool(1, "write_record"),
          ]),
        })
      ).score,
      1,
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
      createSession() {
        return {
          id: "s",
          async run() {
            const text = replies[turn++] ?? "";
            return { sessionId: "s", runId: `r${turn}`, status: "succeeded", text, content: [] };
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

    const real = createAgent({
      model: { provider: "mock", model: "offline" },
      provider: createMockProvider([providerTextDelta("ok"), providerDone()]),
    });
    const injected = wrapAgentWithFailureInjection(real, { failStore: true }).createSession();
    await assert.rejects(() => injected.run("ok"), /injected store failure/);

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

function oneShotToolProvider(name: string): AIProvider {
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
    createSession() {
      return {
        id: "s",
        async run() {
          onRun();
          return { sessionId: "s", runId: "r", status: "succeeded", text: "ok", content: [] } as AgentRunResult;
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
    assert.equal(report.trials?.uncertaintyMethod, "standard_error");
  });

  it("denyTools skips execute; unknownEffect is not success", async () => {
    let deniedRan = 0;
    const denied = await runExperiment({
      agent: wrapAgentWithFailureInjection(
        createAgent({
          model: { provider: "mock", model: "demo" },
          provider: oneShotToolProvider("drop_database"),
          tools: [
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
        }),
        { denyTools: ["drop_database"] },
      ),
      dataset: defineDataset({ id: "deny", items: [{ id: "i", input: "drop" }] }),
      scorers: [
        defineScorer({
          id: "drop-not-succeeded",
          score: ({ timeline }) => {
            const steps = timeline?.steps.filter((s) => s.kind === "tool" && s.name === "drop_database") ?? [];
            const ok = steps.length > 0 && steps.every((s) => s.status !== "succeeded");
            return { score: ok ? 1 : 0, metadata: { invariant: true } };
          },
        }),
      ],
      timeline: "metadata",
    });
    assert.equal(deniedRan, 0);
    assert.equal(denied.aggregate.invariantsPassed, true);

    let unknownRan = 0;
    const unknown = await runExperiment({
      agent: wrapAgentWithFailureInjection(
        createAgent({
          model: { provider: "mock", model: "demo" },
          provider: oneShotToolProvider("write_record"),
          tools: [
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
        }),
        { unknownEffect: true },
      ),
      dataset: defineDataset({ id: "unk", items: [{ id: "i", input: "write" }] }),
      scorers: [
        defineScorer({
          id: "effect-success",
          score: ({ timeline }) => {
            const tools = timeline?.steps.filter((s) => s.kind === "tool") ?? [];
            return { score: tools.some((s) => s.status === "succeeded") ? 1 : 0, metadata: { invariant: true } };
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
              status: "succeeded",
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
              status: "succeeded",
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
        score: ({ environment }) => ({
          score: (environment as { testsPassed?: boolean } | undefined)?.testsPassed ? 1 : 0,
          metadata: { invariant: true },
        }),
      });
      const agent = createAgent({
        model: { provider: "mock", model: "offline" },
        provider: createMockProvider([providerTextDelta("ok"), providerDone()]),
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
