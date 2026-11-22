import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type Agent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import delegate, { createActivityReporter, MAX_DELEGATE_ACTIVITY_TEXT_BYTES } from "../index.js";

const agents: Agent[] = [];
afterEach(async () => {
  for (const agent of agents.splice(0)) await agent.dispose();
});

const LONG_ANSWER = "x".repeat(10_000);

/** Root delegates; the child calls `secret_tool` with a secret argument, then streams a long answer in many deltas. */
function provider(mode: "sync" | "async", parentTexts: string[]): ModelProvider {
  return {
    id: "mock",
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const tools = (request.tools ?? []).map((tool) => tool.name);
      const last = request.messages.at(-1);
      const lastText = JSON.stringify(last?.content ?? "");
      if (tools.includes("delegate")) {
        parentTexts.push(lastText);
        if (lastText.includes('"go"'))
          yield providerToolCall(toolCallContent("call_d", "delegate", { child: "worker", input: "work", mode }));
        else yield providerTextDelta(`parent turn ${parentTexts.length}`);
      } else if (last?.role === "user") {
        yield providerTextDelta("looking ");
        yield providerToolCall(toolCallContent("call_s", "secret_tool", { token: "SECRET_ARG" }));
      } else {
        for (let index = 0; index < 100; index += 1) yield providerTextDelta(LONG_ANSWER.slice(index * 100, (index + 1) * 100));
      }
      yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    },
  };
}

const secretTools = definePackage({
  name: "secret-tools",
  version: "0.0.0",
  requires: { api: 2 },
  setup(prism) {
    prism.tools.register({
      name: "secret_tool",
      description: "test only",
      execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "secret_tool", content: [{ type: "text", text: "SECRET_RESULT" }] }),
    });
  },
});

async function build(options: { mode: "sync" | "async"; report?: string; announceAsync?: boolean }) {
  const activity: Record<string, unknown>[] = [];
  const parentTexts: string[] = [];
  const agent = await createAgent({
    id: "activity-parent",
    model: { provider: "mock", model: "m" },
    slots: { store: createMemorySessionStore() },
    hooks: (hooks) =>
      hooks.on("package.event", (event) => {
        if (event.name === "delegate.activity") activity.push(event.data as Record<string, unknown>);
      }),
    packages: [
      providerPackage("mock-provider", [provider(options.mode, parentTexts)]),
      secretTools(),
      delegate({
        ...(options.announceAsync === undefined ? {} : { announceAsync: options.announceAsync }),
        children: { worker: { inherit: ["secret-tools"], description: "Works.", report: options.report ?? "stream" } },
      } as never),
    ],
  });
  agents.push(agent);
  return { agent, activity, parentTexts };
}

describe("delegate.activity", () => {
  it("stream_report_emits_bounded_activity_events", async () => {
    const { agent, activity } = await build({ mode: "sync" });
    const root = await agent.session();
    const result = await root.run("go");
    assert.equal(result.status, "completed");
    const started = activity.find((event) => event.kind === "tool.started");
    const finished = activity.find((event) => event.kind === "tool.finished");
    assert.deepEqual(
      { tool: started?.tool, toolCallId: started?.toolCallId, status: started?.status },
      { tool: "secret_tool", toolCallId: "call_s", status: "started" },
    );
    assert.equal(finished?.status, "finished");
    assert.equal(typeof finished?.durationMs, "number");
    for (const event of activity) {
      assert.equal(event.parentSessionId, root.id, "routed to the delegating session");
      assert.equal((event.origin as { agent?: string }).agent, "worker");
      assert.equal((event.origin as { depth?: number }).depth, 1);
    }
    const texts = activity.filter((event) => event.kind === "text");
    assert.ok(texts.length >= 1);
    for (const event of texts) {
      assert.ok(new TextEncoder().encode(String(event.text)).byteLength <= MAX_DELEGATE_ACTIVITY_TEXT_BYTES);
    }
    // 10,000 chars streamed inside one flush window: one event's worth kept, the rest counted.
    const answer = texts.at(-1);
    assert.equal(String(answer?.text).length + Number(answer?.droppedChars ?? 0), 10_000);
    // The text flushed before the tool started went out first.
    assert.equal(texts[0]?.text, "looking ");
  });

  it("activity_events_carry_no_arguments_or_results", async () => {
    const { agent, activity } = await build({ mode: "sync" });
    await (await agent.session()).run("go");
    assert.ok(activity.length > 0);
    const all = JSON.stringify(activity);
    assert.doesNotMatch(all, /SECRET_ARG/);
    assert.doesNotMatch(all, /SECRET_RESULT/);
    for (const event of activity) {
      assert.deepEqual(
        Object.keys(event).filter(
          (key) =>
            !["origin", "parentSessionId", "kind", "tool", "toolCallId", "status", "durationMs", "text", "droppedChars"].includes(key),
        ),
        [],
      );
    }
  });

  it("other_reports_emit_no_activity", async () => {
    for (const report of ["on-complete", "milestones"]) {
      const { agent, activity } = await build({ mode: "sync", report });
      await (await agent.session()).run("go");
      assert.equal(activity.length, 0, report);
    }
  });

  it("text_is_flushed_at_most_once_per_window", async () => {
    const emitted: unknown[] = [];
    const reporter = createActivityReporter({
      origin: { kind: "prism", agent: "w", agentId: "delegate-w", depth: 1 },
      parentSessionId: "s1",
      emit: (data) => emitted.push(data),
      flushMs: 40,
    });
    const delta = (text: string) =>
      reporter.onEvent({ type: "message.delta", sessionId: "c", runId: "r", content: { type: "text", text } } as never);
    for (let index = 0; index < 50; index += 1) delta("a");
    assert.equal(emitted.length, 0, "buffered until the first timer fires");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(emitted.length, 1, "the first window flushes at once");
    for (let index = 0; index < 50; index += 1) delta("b");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(emitted.length, 1, "inside the window nothing more goes out");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(emitted.length, 2);
    reporter.end();
    assert.equal(emitted.length, 2, "nothing left to flush");
  });
});

describe("run.end announcement", () => {
  it("finished_async_child_is_announced_at_run_end_once", async () => {
    const { agent, parentTexts } = await build({ mode: "async", report: "on-complete" });
    const result = await (await agent.session()).run("go");
    assert.equal(result.status, "completed");
    const announcements = parentTexts.filter((text) => text.includes("Async delegations not read yet"));
    assert.equal(announcements.length, 1, "one continuation");
    assert.match(announcements[0] ?? "", /dlg_\w+ \(child worker, (running|finished, unread)\)/);
    assert.match(announcements[0] ?? "", /delegate_wait/);
    // go → delegate, tool result → answer, the announcement → answer; then the run ends.
    assert.equal(parentTexts.length, 3);
  });

  it("announce_async_false_adds_no_continuation", async () => {
    const { agent, parentTexts } = await build({ mode: "async", report: "on-complete", announceAsync: false });
    const result = await (await agent.session()).run("go");
    assert.equal(result.status, "completed");
    assert.equal(parentTexts.filter((text) => text.includes("not read yet")).length, 0);
    assert.equal(parentTexts.length, 2);
  });

  it("sync_delegations_are_never_announced", async () => {
    const { agent, parentTexts } = await build({ mode: "sync", report: "on-complete" });
    await (await agent.session()).run("go");
    assert.equal(parentTexts.filter((text) => text.includes("not read yet")).length, 0);
  });
});
