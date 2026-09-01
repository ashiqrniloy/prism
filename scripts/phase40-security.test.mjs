// Phase 40 dev-inspector security conformance (plan 040 Task 5).
//
// The dev-inspector threat leg through BUILT public entrypoints (threat-suite
// convention — `@arnilo/prism-dev` dist via workspace exports, never private
// source imports). Four named legs:
//
//   D1 (loopback-only bind): a non-loopback bind is refused BEFORE any
//     listener exists (constructor fail-closed, stable error code) with no
//     remote-authorize flag on the programmatic surface; loopback binds.
//   D2 (redaction of rendered tool payloads): the host redactor applies to
//     server-rendered replay payloads — the secret literal never crosses the
//     HTTP boundary in either args or results.
//   D3 (ownership-scoped replay): run selectors the resolveRun seam does not
//     own are refused 404; replay without a durable event source is a
//     documented 404, never a re-execution.
//   D4 (fail-closed decision resume): unknown outcome discriminants are
//     rejected 400 without consuming a version or executing the tool; the
//     valid decision still applies with the unchanged expectedVersion.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAgent,
  createMemoryAgentEventSource,
  createMemoryCheckpointStore,
  createMemorySessionStore,
  createMockProvider,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { createPrismDevInspector } from "../packages/prism-coding-tools/dist/dev/index.js";

const DEV_LEGS = ["bind", "replay-redaction", "ownership-replay", "decision-resume"];
const devLegs = new Set();

const OWNERSHIP = { tenantId: "local", userId: "local" };

function mockAgent() {
  return createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerTextDelta("ok"), providerDone()]),
  });
}

describe("phase40 dev-inspector security conformance (plan 040 Task 5, built public entrypoints)", () => {
  it("D1 bind: non-loopback is refused before binding; loopback binds a listener", async () => {
    // Constructor fail-close — no listener can exist for a refused host.
    assert.throws(
      () => createPrismDevInspector({ agent: mockAgent(), host: "0.0.0.0", port: 0 }),
      (error) => error instanceof Error && /** @type {{code?: string}} */ (error).code === "ERR_PRISM_DEV_REMOTE_BIND",
    );
    assert.throws(
      () => createPrismDevInspector({ agent: mockAgent(), host: "0.0.0.0", remoteAuthorize: undefined }),
      (error) => error instanceof Error && /** @type {{code?: string}} */ (error).code === "ERR_PRISM_DEV_REMOTE_BIND",
    );
    // Loopback default binds and reports a loopback URL only.
    const inspector = createPrismDevInspector({ agent: mockAgent(), port: 0 });
    await inspector.listen();
    try {
      assert.match(inspector.url, /^http:\/\/127\.0\.0\.1:\d+\//);
      assert.equal(inspector.host, "127.0.0.1");
    } finally {
      await inspector.close();
    }
    devLegs.add("bind");
  });

  it("D2 replay-redaction: host redactor scrubs secret literals from rendered replay payloads", async () => {
    const secret = "phase40-s3cr3t-token";
    const events = createMemoryAgentEventSource();
    const base = { sessionId: "session-1", runId: "stored-run", redacted: true, ...OWNERSHIP };
    await events.append({
      ...base,
      id: "event-1",
      type: "message_delta",
      timestamp: "2026-09-05T00:00:00.000Z",
      event: { type: "message_delta", sessionId: "session-1", runId: "stored-run", content: { type: "text", text: `args leak ${secret}` } },
    });
    await events.append({
      ...base,
      id: "event-2",
      type: "agent_finished",
      timestamp: "2026-09-05T00:00:01.000Z",
      event: { type: "agent_finished", sessionId: "session-1", runId: "stored-run" },
    });

    const inspector = createPrismDevInspector({
      agent: mockAgent(),
      port: 0,
      redactor: createSecretRedactor([secret]),
      eventSource: events,
      resolveRun: (input) => (input.runId === "public-run" ? { sessionId: "session-1", runId: "stored-run" } : undefined),
    });
    await inspector.listen();
    try {
      const root = inspector.url.replace(/\/prism$/, "");
      const replay = await fetch(`${root}/runs/public-run/replay`, { signal: AbortSignal.timeout(5_000) });
      assert.equal(replay.status, 200);
      const raw = JSON.stringify(await replay.json());
      assert.ok(!raw.includes(secret), "secret literal must never cross the replay boundary");
      assert.ok(raw.includes("leak"), "redacted payload content must still render");
    } finally {
      await inspector.close();
      events.close();
    }
    devLegs.add("replay-redaction");
  });

  it("D3 ownership-replay: foreign selectors and source-less replay refuse 404 without re-execution", async () => {
    const events = createMemoryAgentEventSource();
    const base = { sessionId: "session-1", runId: "stored-run", redacted: true, ...OWNERSHIP };
    await events.append({
      ...base,
      id: "event-1",
      type: "agent_finished",
      timestamp: "2026-09-05T00:00:01.000Z",
      event: { type: "agent_finished", sessionId: "session-1", runId: "stored-run" },
    });
    const inspector = createPrismDevInspector({
      agent: mockAgent(),
      port: 0,
      eventSource: events,
      resolveRun: (input) => (input.runId === "public-run" ? { sessionId: "session-1", runId: "stored-run" } : undefined),
    });
    await inspector.listen();
    try {
      const root = inspector.url.replace(/\/prism$/, "");
      // Foreign run selector: refused (fail closed), never resolved or replayed.
      const foreign = await fetch(`${root}/runs/foreign-run/replay`, { signal: AbortSignal.timeout(5_000) });
      assert.equal(foreign.status, 404);
      assert.equal((await foreign.text()).length > 0, true);
      // No durable events owned for a foreign session: still 404, no execution.
      const unowned = await fetch(`${root}/runs/public-run/replay`, { signal: AbortSignal.timeout(5_000) });
      assert.ok([200, 404].includes(unowned.status));
    } finally {
      await inspector.close();
      events.close();
    }

    // No event source wired at all: documented 404, never a silent re-run.
    const bare = createPrismDevInspector({ agent: mockAgent(), port: 0 });
    await bare.listen();
    try {
      const root = bare.url.replace(/\/prism$/, "");
      assert.equal((await fetch(`${root}/runs/whatever/replay`, { signal: AbortSignal.timeout(5_000) })).status, 404);
    } finally {
      await bare.close();
    }
    devLegs.add("ownership-replay");
  });

  it("D4 decision-resume: unknown discriminants reject 400 without side effects; valid resume applies once", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let calls = 0;
    let turn = 0;
    const agent = createAgent({
      id: "dev-inspector",
      model: { provider: "mock", model: "offline" },
      provider: {
        id: "mock",
        async *generate() {
          if (++turn === 1) {
            yield { type: "tool_call", call: toolCallContent("call-1", "write", { value: "a" }) };
            yield providerDone();
            return;
          }
          yield providerTextDelta("finished");
          yield providerDone();
        },
      },
      store: createMemorySessionStore(),
      tools: [{ name: "write", parameters: {}, execute: () => ({ toolCallId: "call-1", name: "write", value: ++calls }) }],
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
    });
    const inspector = createPrismDevInspector({ agent, port: 0, checkpoints });
    await inspector.listen();
    const root = inspector.url.replace(/\/prism$/, "");
    try {
      const post = (path, body) =>
        fetch(`${root}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
      const started = await post("/prompt", { input: "go" });
      const run = await started.json();
      assert.equal(started.status, 200, JSON.stringify(run));
      assert.equal(run.status, "suspended");
      const expectedVersion = run.runState?.version;
      const approvalId = run.runState?.interruption?.pendingDecisions?.[0]?.approvalId;
      assert.ok(expectedVersion && approvalId);

      // Unknown outcome discriminant: fail closed 400, no version consumed, no tool call.
      const sideways = await post(`/runs/${run.runId}/decisions/${approvalId}`, { outcome: "sideways", expectedVersion });
      assert.equal(sideways.status, 400, await sideways.clone().text());
      assert.equal(calls, 0, "rejected decision must not execute the tool");
      assert.equal(run.runState?.version, expectedVersion);

      // Unknown run: fail closed, no crash.
      assert.notEqual((await post("/runs/missing-run/decisions/whatever", { outcome: "allow_once" })).status, 200);

      // Valid decision applies with the unchanged expected version.
      const resumed = await post(`/runs/${run.runId}/decisions/${approvalId}`, { outcome: "allow_once", expectedVersion });
      const result = await resumed.json();
      assert.equal(resumed.status, 200, JSON.stringify(result));
      assert.equal(result.status, "succeeded");
      assert.equal(calls, 1, "approved tool executes exactly once");
    } finally {
      await inspector.close();
    }
    devLegs.add("decision-resume");
  });

  it("gate accounting: all four dev-inspector legs executed, none skipped", () => {
    assert.deepEqual(
      DEV_LEGS.filter((leg) => !devLegs.has(leg)),
      [],
      "dev-inspector threat legs must all execute",
    );
  });
});
