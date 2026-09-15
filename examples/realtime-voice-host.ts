import { type RealtimeEvent, type RealtimeSession, resolveDevicePolicy, type ToolCallContent } from "@arnilo/prism";
import { createRealtimeVoiceBridge } from "@arnilo/prism-core/runtime/realtime";

const policy = resolveDevicePolicy(
  { kind: "voice", enabled: true, requireApproval: true, sandbox: "voice-demo" },
  { runLimits: { maxTurns: 4, maxToolCalls: 8 } },
);

const queue: RealtimeEvent[] = [{ type: "session_started", sessionId: "demo" }];
let wait: ((event: RealtimeEvent | undefined) => void) | undefined;
const push = (event: RealtimeEvent) => {
  if (wait) {
    wait(event);
    wait = undefined;
    return;
  }
  queue.push(event);
};

const session: RealtimeSession = {
  id: "demo",
  provider: "mock",
  async sendAudio() {},
  events: () =>
    (async function* () {
      for (;;) {
        const event =
          queue.shift() ??
          (await new Promise<RealtimeEvent | undefined>((resolve) => {
            wait = resolve;
          }));
        if (!event) break;
        yield event;
        if (event.type === "session_closed") break;
      }
    })(),
  async interrupt() {
    push({ type: "interrupted" });
  },
  async close(reason) {
    push({ type: "session_closed", reason });
  },
  async completeTool() {},
};

const executed: string[] = [];
const bridge = createRealtimeVoiceBridge({
  session,
  policy,
  admit: { approved: true, activeSessions: 0 },
  toolNames: ["lookup"],
  strictGovernance: true,
  execute: async (call: ToolCallContent, ctx) => {
    if (ctx.signal.aborted) throw new Error("aborted");
    executed.push(call.name);
    return { toolCallId: call.id, name: call.name, value: { ok: true } };
  },
});

const running = bridge.run();
push({ type: "tool_call", call: { type: "tool_call", id: "c1", name: "lookup", arguments: { q: "ok" } } });
await bridge.interrupt();
push({ type: "session_closed", reason: "demo" });
const snap = await running;
console.log(JSON.stringify({ executed, interrupted: snap.interrupted, effectAfterInterrupt: snap.effectAfterInterrupt }));
