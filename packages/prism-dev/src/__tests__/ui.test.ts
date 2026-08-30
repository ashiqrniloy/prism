/**
 * Plan 040 Task 3 — inspector UI: static asset serving (strict CSP, offline
 * bundle, no external fetches, no eval/innerHTML) and the pure event→timeline
 * projection that backs the page (fixtures per normalized AgentEvent type,
 * windowing guard for 1k-event timelines).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AgentEvent, createAgent, toolCallContent } from "@arnilo/prism";
import { createPrismDevInspector } from "../index.js";
import { applyAgentEvent, createRunView, type RunView, visibleItems } from "../ui/inspector.js";

describe("inspector UI assets (plan 040 Task 3)", () => {
  it("serves the page, the module, and same-origin config with a strict CSP", async () => {
    const agent = createAgent({ id: "ui-agent", model: { provider: "mock", model: "offline" } });
    const inspector = createPrismDevInspector({ agent, port: 0 });
    await inspector.listen();
    try {
      const root = inspector.url.replace(/\/prism$/, "");
      const page = await fetch(`${root}/`);
      assert.equal(page.status, 200);
      assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
      const csp = page.headers.get("content-security-policy") ?? "";
      assert.match(csp, /default-src 'none'/);
      assert.match(csp, /script-src 'self'/);
      assert.match(csp, /connect-src 'self'/);
      assert.equal(page.headers.get("x-content-type-options"), "nosniff");
      assert.equal(page.headers.get("cache-control"), "no-store");
      const html = await page.text();
      assert.match(html, /<script type="module" src="\/assets\/inspector\.js"><\/script>/);
      assert.match(html, /<div id="app"><\/div>/);

      const script = await fetch(`${root}/assets/inspector.js`);
      assert.equal(script.status, 200);
      assert.match(script.headers.get("content-type") ?? "", /^text\/javascript/);
      const js = await script.text();
      assert.match(js, /applyAgentEvent|mountInspector/);

      const config = await fetch(`${root}/config`);
      assert.equal(config.status, 200);
      assert.deepEqual(await config.json(), { basePath: "/prism", agentId: "ui-agent" });

      // Offline-capable bundle: no external network references anywhere,
      // no eval, no HTML-assembly through innerHTML (CSP also enforces).
      for (const asset of [html, js]) {
        assert.equal(asset.includes("://"), false, "asset must not reference external origins");
        assert.equal(/\beval\(|new Function\(/.test(asset), false);
      }
      assert.equal(js.includes("innerHTML"), false);
    } finally {
      await inspector.close();
    }
  });
});

describe("event → timeline projection (plan 040 Task 3)", () => {
  const view = (): RunView => createRunView();

  it("merges text deltas into one assistant item and thinking separately", () => {
    const run = view();
    applyAgentEvent(run, { type: "agent_started", sessionId: "s", runId: "r" });
    applyAgentEvent(run, { type: "message_delta", sessionId: "s", runId: "r", content: { type: "text", text: "hel" } });
    applyAgentEvent(run, { type: "message_delta", sessionId: "s", runId: "r", content: { type: "text", text: "lo" } });
    applyAgentEvent(run, { type: "message_delta", sessionId: "s", runId: "r", content: { type: "thinking", text: "hmm" } });
    const messages = run.items.filter((item) => item.kind === "message");
    assert.deepEqual(
      messages.map((item) => (item.kind === "message" ? `${item.label}:${item.text}` : "")),
      ["text:hello", "thinking:hmm"],
    );
    assert.equal(run.status, "running");
  });

  it("tracks a tool call through start → finish with redacted args/result as-is", () => {
    const run = view();
    const call = toolCallContent("call-1", "write", { secret: "redacted-<b>" });
    applyAgentEvent(run, { type: "tool_execution_started", sessionId: "s", runId: "r", call });
    let item = run.items.find((candidate) => candidate.kind === "tool");
    assert.ok(item && item.kind === "tool");
    assert.equal(item.status, "running");
    assert.equal(item.name, "write");
    applyAgentEvent(run, {
      type: "tool_execution_finished",
      sessionId: "s",
      runId: "r",
      result: { toolCallId: "call-1", name: "write", value: { ok: 1 } },
      metadata: { durationMs: 3, status: "finished" },
    });
    item = run.items.find((candidate) => candidate.kind === "tool");
    assert.ok(item && item.kind === "tool" && item.status === "ok");
    assert.equal(item.resultText, '{\n  "ok": 1\n}');
    // Args stay a rendered string, never parsed as HTML by the UI.
    assert.equal(item.argsText?.includes("redacted-<b>"), true);
  });

  it("marks tool errors and blocks on the matching call", () => {
    const run = view();
    applyAgentEvent(run, {
      type: "tool_execution_error",
      sessionId: "s",
      runId: "r",
      call: toolCallContent("call-9", "boom", {}),
      error: { message: "exploded" },
      metadata: { durationMs: 1, status: "error" },
    });
    const item = run.items.find((candidate) => candidate.kind === "tool");
    assert.ok(item && item.kind === "tool" && item.status === "error" && item.resultText === "error: exploded");

    const blocked = view();
    applyAgentEvent(blocked, {
      type: "tool_execution_blocked",
      sessionId: "s",
      runId: "r",
      toolCallId: "call-2",
      name: "rm",
      reason: "guardrail",
      error: { message: "blocked" },
      metadata: { durationMs: 0, status: "blocked" },
    });
    const blockedItem = blocked.items.find((candidate) => candidate.kind === "tool");
    assert.ok(blockedItem && blockedItem.kind === "tool" && blockedItem.status === "blocked" && blockedItem.note === "guardrail");
  });

  it("sums per-run usage across provider turns and the terminal event", () => {
    const run = view();
    applyAgentEvent(run, { type: "agent_started", sessionId: "s", runId: "r" });
    for (const usage of [{ totalTokens: 10 }, { totalTokens: 15, inputTokens: 4, outputTokens: 11 }]) {
      applyAgentEvent(run, {
        type: "provider_turn_finished",
        sessionId: "s",
        runId: "r",
        turn: 1,
        metadata: { providerId: "m", model: { provider: "m", model: "x" } },
        usage,
      });
    }
    applyAgentEvent(run, { type: "agent_finished", sessionId: "s", runId: "r", usage: { totalTokens: 5, cost: 0.01 } });
    assert.deepEqual(run.usage, { inputTokens: 4, outputTokens: 11, totalTokens: 30, cost: 0.01 });
    assert.equal(run.status, "finished");
  });

  it("renders pending decisions on suspension and clears them on resume/deny", () => {
    const run = view();
    applyAgentEvent(run, {
      type: "agent_suspended",
      sessionId: "s",
      runId: "r",
      interruption: {
        kind: "tool_approval",
        reason: "needs approval",
        toolCallId: "call-1",
        toolName: "write",
        pendingDecisions: [
          { kind: "tool_approval", approvalId: "ap-1", toolCallId: "call-1", scope: { toolName: "write" }, reason: "needs approval" },
        ],
      },
      version: 2,
    });
    assert.equal(run.status, "suspended");
    assert.equal(run.expectedVersion, 2);
    assert.deepEqual(run.decisions, [{ approvalId: "ap-1", toolCallId: "call-1", toolName: "write", reason: "needs approval" }]);

    // Legacy single-approval state: decision derived from the interruption.
    const legacy = view();
    applyAgentEvent(legacy, {
      type: "agent_suspended",
      sessionId: "s",
      runId: "r",
      interruption: { kind: "tool_approval", reason: "needs approval", toolCallId: "call-7", toolName: "rm" },
      version: 5,
    });
    assert.deepEqual(legacy.decisions, [{ approvalId: "call-7", toolCallId: "call-7", toolName: "rm", reason: "needs approval" }]);

    applyAgentEvent(run, { type: "agent_resumed", sessionId: "s", runId: "r", version: 3 });
    assert.equal(run.status, "running");
    assert.deepEqual(run.decisions, []);

    const denied = view();
    applyAgentEvent(denied, {
      type: "agent_denied",
      sessionId: "s",
      runId: "r",
      interruption: { kind: "tool_approval", reason: "denied" },
      version: 4,
    });
    assert.equal(denied.status, "denied");
  });

  it("surfaces fatal run errors", () => {
    const run = view();
    applyAgentEvent(run, { type: "error", sessionId: "s", runId: "r", error: { message: "provider down" } });
    assert.equal(run.status, "failed");
    assert.ok(run.items.some((item) => item.kind === "note" && item.text.includes("provider down")));
  });

  it("shows finished assistant text when the run never streamed deltas", () => {
    const run = view();
    applyAgentEvent(run, {
      type: "message_finished",
      sessionId: "s",
      runId: "r",
      message: { role: "assistant", content: [{ type: "text", text: "final answer" }] },
    });
    assert.deepEqual(run.items, [{ kind: "message", label: "assistant", text: "final answer" }]);
    // With deltas already streamed, the finished copy is redundant.
    const streamed = view();
    applyAgentEvent(streamed, { type: "message_delta", sessionId: "s", runId: "r", content: { type: "text", text: "final answer" } });
    applyAgentEvent(streamed, {
      type: "message_finished",
      sessionId: "s",
      runId: "r",
      message: { role: "assistant", content: [{ type: "text", text: "final answer" }] },
    });
    assert.equal(streamed.items.filter((item) => item.kind === "message").length, 1);
  });

  it("windows 1k-event timelines without lockup (bounded render + fast fold)", () => {
    const run = view();
    const started = performance.now();
    for (let index = 0; index < 1200; index += 1) {
      applyAgentEvent(run, {
        type: "event_subscriber_overflow",
        sessionId: "s",
        runId: "r",
        droppedEvents: index,
        maxQueuedEvents: 64,
        overflow: "drop_oldest",
      });
    }
    const foldMs = performance.now() - started;
    assert.ok(foldMs < 250, `1200-event fold took ${foldMs}ms`);
    assert.equal(run.items.length, 1200);
    const windowed = visibleItems(run.items);
    assert.equal(windowed.visible.length, 400);
    assert.equal(windowed.hidden, 800);
  });

  it("renders unknown event types as visible notes instead of dropping them", () => {
    const run = view();
    applyAgentEvent(run, {
      type: "artifact_finished",
      sessionId: "s",
      runId: "r",
      turn: 1,
      attempt: 0,
      result: { artifactId: "a", status: "ok" } as never,
    });
    assert.ok(run.items.some((item) => item.kind === "note" && item.text === "artifact_finished"));
  });

  it("tolerates malformed fixture payloads (no throw, status untouched)", () => {
    const run = view();
    applyAgentEvent(run, {
      type: "tool_execution_error",
      sessionId: "s",
      runId: "r",
      error: {},
      metadata: { durationMs: 0, status: "error" },
    } as AgentEvent);
    const note = run.items.find((candidate) => candidate.kind === "note");
    assert.ok(note && note.kind === "note" && note.level === "error");
  });
});
