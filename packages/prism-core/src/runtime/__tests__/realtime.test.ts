import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type RealtimeEvent, type RealtimeSession, resolveDevicePolicy, type ToolCallContent, type ToolResult } from "@arnilo/prism";
import { defineScorer } from "../../governance/evals/scorer.js";
import { createRealtimeVoiceBridge, type RealtimeVoiceSnapshot } from "../realtime.js";

const policy = resolveDevicePolicy(
  { kind: "voice", enabled: true, requireApproval: true, sandbox: "voice-sandbox" },
  { runLimits: { maxTurns: 4, maxToolCalls: 8 } },
);
const admit = { approved: true, activeSessions: 0 };

function call(id: string, name = "refund", extra: Partial<ToolCallContent> = {}): ToolCallContent {
  return { type: "tool_call", id, name, arguments: {}, ...extra };
}

function fakeSession(initial: RealtimeEvent[] = []) {
  const queue: RealtimeEvent[] = [...initial];
  const sent: string[] = [];
  let wait: ((event: RealtimeEvent | undefined) => void) | undefined;
  let closed = false;
  const deliver = (event: RealtimeEvent) => {
    if (wait) {
      wait(event);
      wait = undefined;
      return;
    }
    queue.push(event);
  };
  const session: RealtimeSession & { push(event: RealtimeEvent): void; sent: string[] } = {
    id: "rt-1",
    provider: "mock",
    sent,
    push: deliver,
    async sendAudio() {
      if (closed) throw new Error("closed");
    },
    events() {
      return (async function* () {
        for (;;) {
          const event =
            queue.shift() ??
            (closed
              ? undefined
              : await new Promise<RealtimeEvent | undefined>((resolve) => {
                  wait = resolve;
                }));
          if (!event) break;
          yield event;
          if (event.type === "session_closed") break;
        }
      })();
    },
    async interrupt() {
      deliver({ type: "interrupted" });
    },
    async close(reason) {
      if (closed) return;
      closed = true;
      deliver({ type: "session_closed", reason });
    },
    async completeTool(callId, output) {
      sent.push(JSON.stringify({ callId, output }));
    },
  };
  return session;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("createRealtimeVoiceBridge", () => {
  it("dispatches host tools and completes them", async () => {
    const session = fakeSession([{ type: "session_started", sessionId: "s" }]);
    const executed: string[] = [];
    const bridge = createRealtimeVoiceBridge({
      session,
      policy,
      admit,
      execute: async (item) => {
        executed.push(item.name);
        return { toolCallId: item.id, name: item.name, value: { ok: true } };
      },
    });
    const running = bridge.run();
    session.push({ type: "tool_call", call: call("c1", "lookup") });
    await flush();
    session.push({ type: "session_closed" });
    const snap = await running;
    assert.deepEqual(executed, ["lookup"]);
    assert.deepEqual(snap.completedCallIds, ["c1"]);
    assert.equal(session.sent.length, 1);
  });

  it("barge-in cancels in-flight delivery before effect", async () => {
    const session = fakeSession();
    let ran = false;
    let entered!: () => void;
    const sawEnter = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bridge = createRealtimeVoiceBridge({
      session,
      policy,
      admit,
      execute: async (item, ctx) => {
        entered();
        await Promise.race([
          gate,
          new Promise<never>((_, reject) => {
            ctx.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
        ]);
        ran = true;
        return { toolCallId: item.id, name: item.name, value: { ok: true } };
      },
    });
    const running = bridge.run();
    session.push({ type: "tool_call", call: call("mut-1") });
    await sawEnter;
    await bridge.interrupt();
    session.push({ type: "session_closed" });
    const snap = await running;
    release();
    assert.equal(ran, false);
    assert.equal(snap.effectAfterInterrupt, false);
    assert.ok(snap.unknownCallIds.includes("mut-1") || snap.cancelledCallIds.includes("mut-1"));
  });

  it("effect after interrupt is unknown and fails the 072 barge-in invariant", async () => {
    const session = fakeSession();
    const bridge = createRealtimeVoiceBridge({
      session,
      policy,
      admit,
      execute: async (item) => ({ toolCallId: item.id, name: item.name, value: { charged: true } }),
    });
    const running = bridge.run();
    await bridge.interrupt();
    session.push({ type: "tool_call", call: call("late-1") });
    await flush();
    session.push({ type: "session_closed" });
    const snap = await running;
    assert.equal(snap.completedCallIds.includes("late-1"), false);
    const scorer = bargeInScorer();
    const bad = await scorer.score({
      result: { sessionId: "s", runId: "r", status: "succeeded", text: "", content: [] },
      environment: { effectAfterInterrupt: true, cancelledBeforeEffect: false },
    });
    assert.equal(bad.score, 0);
    assert.equal(bad.metadata?.invariant, true);
    const good = await scorer.score({
      result: { sessionId: "s", runId: "r", status: "succeeded", text: "", content: [] },
      environment: { effectAfterInterrupt: snap.effectAfterInterrupt, cancelledBeforeEffect: true },
    });
    assert.equal(good.score, 1);
  });

  it("reconnect skips seen call ids and does not replay", async () => {
    const session = fakeSession();
    const executed: string[] = [];
    const bridge = createRealtimeVoiceBridge({
      session,
      policy,
      admit,
      seenCallIds: new Set(["old-1"]),
      execute: async (item) => {
        executed.push(item.id);
        return { toolCallId: item.id, name: item.name, value: {} };
      },
    });
    const running = bridge.run();
    session.push({ type: "tool_call", call: call("old-1") });
    session.push({ type: "tool_call", call: call("new-1", "lookup") });
    await flush();
    session.push({ type: "session_closed" });
    await running;
    assert.deepEqual(executed, ["new-1"]);
  });

  it("duplicate call ids execute once", async () => {
    const session = fakeSession();
    let n = 0;
    const bridge = createRealtimeVoiceBridge({
      session,
      policy,
      admit,
      execute: async (item) => {
        n += 1;
        return { toolCallId: item.id, name: item.name, value: {} };
      },
    });
    const running = bridge.run();
    const item = call("dup-1", "lookup");
    session.push({ type: "tool_call", call: item });
    session.push({ type: "tool_call", call: item });
    await flush();
    session.push({ type: "session_closed" });
    await running;
    assert.equal(n, 1);
  });

  it("strict governance withholds provider-hosted tools", async () => {
    const session = fakeSession();
    const executed: string[] = [];
    const bridge = createRealtimeVoiceBridge({
      session,
      policy,
      admit,
      strictGovernance: true,
      execute: async (item) => {
        executed.push(item.name);
        return { toolCallId: item.id, name: item.name, value: {} };
      },
    });
    const running = bridge.run();
    session.push({
      type: "tool_call",
      call: call("h1", "web_search_call", { authority: "provider-hosted" }),
    });
    await flush();
    session.push({ type: "session_closed" });
    const snap = await running;
    assert.deepEqual(executed, []);
    assert.deepEqual(snap.unknownCallIds, ["h1"]);
  });

  it("toolNames empty denies host tools", async () => {
    const session = fakeSession();
    const executed: string[] = [];
    const bridge = createRealtimeVoiceBridge({
      session,
      policy,
      admit,
      toolNames: [],
      execute: async (item) => {
        executed.push(item.name);
        return { toolCallId: item.id, name: item.name, value: {} } satisfies ToolResult;
      },
    });
    const running = bridge.run();
    session.push({ type: "tool_call", call: call("c1", "lookup") });
    await flush();
    session.push({ type: "session_closed" });
    await running;
    assert.deepEqual(executed, []);
  });

  it("does not retain transcripts unless asked; records usage; drops audio after interrupt", async () => {
    const session = fakeSession();
    const transcripts: string[] = [];
    const usages: number[] = [];
    const seen: string[] = [];
    const bridge = createRealtimeVoiceBridge({
      session,
      policy,
      admit,
      execute: async (item) => ({ toolCallId: item.id, name: item.name, value: {} }),
      onTranscript: (text) => {
        transcripts.push(text);
      },
      recordUsage: (usage) => {
        usages.push(usage.totalTokens ?? 0);
      },
      onEvent: (event) => {
        seen.push(event.type);
      },
    });
    const running = bridge.run();
    session.push({ type: "transcript_delta", text: "secret utterance", role: "user" });
    await bridge.interrupt();
    session.push({ type: "audio_delta", audio: new Uint8Array([1]) });
    session.push({ type: "usage", usage: { totalTokens: 9, inputTokens: 4, outputTokens: 5 } });
    session.push({ type: "session_closed" });
    const snap = await running;
    assert.deepEqual(transcripts, []);
    assert.deepEqual(usages, [9]);
    assert.equal(snap.usageMissing, false);
    assert.ok(!seen.includes("audio_delta"));
  });

  it("consent revoke blocks sendAudio and is not session-wide tool approval", async () => {
    const session = fakeSession();
    const bridge = createRealtimeVoiceBridge({
      session,
      policy,
      admit,
      execute: async (item) => ({ toolCallId: item.id, name: item.name, value: {} }),
    });
    const running = bridge.run();
    await bridge.revokeConsent();
    await assert.rejects(() => bridge.sendAudio(new Uint8Array([1])), /consent/);
    const snap = await running;
    assert.equal(snap.consent, false);
  });

  it("oversize device chunks are not forwarded", async () => {
    const session = fakeSession();
    let sent = 0;
    session.sendAudio = async () => {
      sent += 1;
    };
    const tight = resolveDevicePolicy(
      { kind: "voice", enabled: true, requireApproval: true, sandbox: "s", limits: { maxChunkBytes: 4 } },
      { runLimits: { maxTurns: 1 } },
    );
    const bridge = createRealtimeVoiceBridge({
      session,
      policy: tight,
      admit,
      execute: async (item) => ({ toolCallId: item.id, name: item.name, value: {} }),
    });
    const running = bridge.run();
    await bridge.sendAudio(new Uint8Array([1, 2, 3, 4, 5]));
    assert.equal(sent, 0);
    await bridge.close();
    await running;
  });
});

function bargeInScorer() {
  return defineScorer({
    id: "voice_barge_in",
    score: ({ environment }) => {
      const env = environment as RealtimeVoiceSnapshot & { cancelledBeforeEffect?: boolean };
      if (env.effectAfterInterrupt) {
        return { score: 0, reason: "effect after interrupt", metadata: { invariant: true } };
      }
      return { score: env.cancelledBeforeEffect ? 1 : 0, metadata: { invariant: true } };
    },
  });
}
