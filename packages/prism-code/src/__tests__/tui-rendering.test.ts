import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { AgentEvent } from "@arnilo/prism";
import { BoxRenderable } from "@opentui/core";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { ApprovalPromptComponent } from "../tui/components/approval.js";
import { InputEditorComponent } from "../tui/components/input.js";
import { createPrismSyntaxStyle } from "../tui/components/markdown-message.js";
import { MessageStreamComponent } from "../tui/components/stream.js";
import {
  collapsedOutputText,
  expandedOutputText,
  MAX_EXPANDED_OUTPUT_LINES,
  registerToolRenderer,
  resolveToolRenderer,
  ToolCardComponent,
} from "../tui/components/tool-card.js";
import { createInitialTuiState, MAX_TOOL_OUTPUT_BYTES, type TuiState, tuiReducer, type UiToolCallEntry } from "../tui/reducer.js";

/** Keyword color from the Prism syntax palette (#c586c0). */
const KEYWORD_FG = "197,134,192,255";

function apply(state: TuiState, event: AgentEvent): TuiState {
  return tuiReducer(state, { type: "session_event", event });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSpanColor(env: TestRendererSetup, fg: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await env.renderOnce();
    const found = env
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .some((span) => span.fg.toInts().join(",") === fg);
    if (found) return true;
    await sleep(25);
  }
  return false;
}

async function renderSettled(env: TestRendererSetup): Promise<string> {
  // Markdown block parsing and re-layout are async; give them a couple of frames to settle.
  await sleep(200);
  await env.renderOnce();
  await sleep(50);
  await env.renderOnce();
  return env.captureCharFrame();
}

/** Polls frames until the pattern shows up; markdown layout can settle a frame late under load. */
async function waitForFrameText(env: TestRendererSetup, pattern: RegExp, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let frame = "";
  while (Date.now() < deadline) {
    await env.renderOnce();
    frame = env.captureCharFrame();
    if (pattern.test(frame)) return frame;
    await sleep(25);
  }
  return frame;
}

function editStartedEvent(): AgentEvent {
  return {
    type: "tool_execution_started",
    sessionId: "s",
    runId: "r",
    call: {
      type: "tool_call",
      id: "call_1",
      name: "edit",
      arguments: { path: "src/app.ts", edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }] },
    },
  };
}

function editStarted(): UiToolCallEntry {
  const entry = apply(createInitialTuiState(), editStartedEvent()).entries[0];
  assert.equal(entry.type, "tool_call");
  assert.ok(entry.type === "tool_call");
  return entry;
}

describe("rich TUI rendering", () => {
  it("resolves per-tool card renderers and accepts registrations", () => {
    assert.equal(resolveToolRenderer("edit"), "diff");
    assert.equal(resolveToolRenderer("git_apply"), "diff");
    assert.equal(resolveToolRenderer("shell"), "text");
    registerToolRenderer("custom_patch_tool", "diff");
    assert.equal(resolveToolRenderer("custom_patch_tool"), "diff");
  });

  it("renders assistant markdown with highlighted fenced code", async () => {
    const env = await createTestRenderer({ width: 80, height: 20 });
    try {
      const stream = new MessageStreamComponent(env.renderer, { syntaxStyle: createPrismSyntaxStyle() });
      env.renderer.root.add(stream.root);
      stream.appendOrUpdate({
        id: "m1",
        version: 1,
        type: "message",
        role: "assistant",
        finished: true,
        text: "Live **markdown** body\n\n```ts\nconst answer: number = 42;\n```\n",
      });
      const frame = await waitForFrameText(env, /Live markdown body/);
      assert.match(frame, /Live markdown body/);
      assert.match(frame, /const answer/);
      assert.match(frame, /42/);
      assert.ok(await waitForSpanColor(env, KEYWORD_FG), "expected tree-sitter keyword highlighting in the fenced block");
    } finally {
      env.renderer.destroy();
    }
  });

  it("updates a streaming assistant message in place", async () => {
    const env = await createTestRenderer({ width: 80, height: 20 });
    try {
      const stream = new MessageStreamComponent(env.renderer, { syntaxStyle: createPrismSyntaxStyle() });
      env.renderer.root.add(stream.root);
      stream.appendOrUpdate({ id: "m1", version: 1, type: "message", role: "assistant", text: "First half" });
      await renderSettled(env);
      stream.appendOrUpdate({ id: "m1", version: 2, type: "message", role: "assistant", text: "First half and the second half" });
      const frame = await renderSettled(env);
      assert.match(frame, /First half and the second half/);
      assert.doesNotMatch(frame, /Assistant:/);
    } finally {
      env.renderer.destroy();
    }
  });

  it("renders the proposed unified diff for an edit card and bounds long output", async () => {
    const env = await createTestRenderer({ width: 100, height: 40 });
    try {
      const entry = editStarted();
      assert.ok(entry.patch?.includes("@@ -1,1 +1,1 @@"));
      assert.ok(entry.patch?.includes("-const a = 1;"));
      assert.ok(entry.patch?.includes("+const a = 2;"));

      const card = new ToolCardComponent(env.renderer, entry, { syntaxStyle: createPrismSyntaxStyle() });
      env.renderer.root.add(card.root);
      let frame = await renderSettled(env);
      assert.match(frame, /- const a = 1;/);
      assert.match(frame, /\+ const a = 2;/);

      // Finishing replaces the proposal with the applied patch and reports duration plus output.
      const finished: AgentEvent = {
        type: "tool_execution_finished",
        sessionId: "s",
        runId: "r",
        result: { toolCallId: "call_1", name: "edit", value: "applied", metadata: { patch: entry.patch } },
        metadata: { durationMs: 1500, status: "finished" },
      };
      const done = apply(apply(createInitialTuiState(), editStartedEvent()), finished).entries[0] as UiToolCallEntry;
      card.update({
        ...done,
        output: `${`line 1\x1b[31mboom\x1b[0m`}\n${Array.from({ length: 11 }, (_, i) => `line ${i + 2}`).join("\n")}`,
      });
      frame = await renderSettled(env);
      assert.match(frame, /1\.5s/);
      assert.match(frame, /more lines \(Ctrl\+O to expand\)/);
      assert.match(frame, /boom/);
      assert.doesNotMatch(frame, /\x1b/);

      card.setExpanded(true);
      assert.equal(card.isExpanded, true);
      frame = await renderSettled(env);
      assert.match(frame, /line 12/);
    } finally {
      env.renderer.destroy();
    }
  });

  it("caps expanded tool output and drops oversized patches", () => {
    const long = Array.from({ length: MAX_EXPANDED_OUTPUT_LINES + 500 }, (_, i) => `line ${i}`).join("\n");
    assert.match(expandedOutputText(long), /… 500 lines omitted …/);
    assert.match(collapsedOutputText(long), /more lines \(Ctrl\+O to expand\)/);

    const started: AgentEvent = {
      type: "tool_execution_started",
      sessionId: "s",
      runId: "r",
      call: { type: "tool_call", id: "call_1", name: "shell", arguments: { command: "seq 50000" } },
    };
    const withoutCard = apply(createInitialTuiState(), {
      type: "tool_execution_finished",
      sessionId: "s",
      runId: "r",
      result: { toolCallId: "missing", name: "shell", value: "ignored" },
      metadata: { durationMs: 5, status: "finished" },
    });
    assert.equal(withoutCard.entries.length, 0);

    const bounded = apply(apply(createInitialTuiState(), started), {
      type: "tool_execution_finished",
      sessionId: "s",
      runId: "r",
      result: {
        toolCallId: "call_1",
        name: "shell",
        content: [{ type: "text", text: Array.from({ length: 50000 }, (_, i) => `out ${i}`).join("\n") }],
      },
      metadata: { durationMs: 5, status: "finished" },
    });
    const entry = bounded.entries[0] as UiToolCallEntry;
    assert.ok(entry.output?.includes("lines omitted"));
    assert.ok(Buffer.byteLength(entry.output ?? "", "utf8") <= MAX_TOOL_OUTPUT_BYTES + 256);

    // Oversized proposals are dropped whole: a truncated patch cannot be parsed by the diff renderer.
    const hugeWrite: AgentEvent = {
      type: "tool_execution_started",
      sessionId: "s",
      runId: "r",
      call: { type: "tool_call", id: "call_2", name: "write", arguments: { path: "big.txt", content: "x".repeat(128 * 1024) } },
    };
    assert.equal((apply(createInitialTuiState(), hugeWrite).entries[0] as UiToolCallEntry).patch, undefined);

    // Control sequences never reach a rendered patch.
    const sneaky: AgentEvent = {
      type: "tool_execution_started",
      sessionId: "s",
      runId: "r",
      call: {
        type: "tool_call",
        id: "call_3",
        name: "edit",
        arguments: { path: "app.ts", edits: [{ oldText: "a", newText: "b\x1b[31m" }] },
      },
    };
    assert.ok(!(apply(createInitialTuiState(), sneaky).entries[0] as UiToolCallEntry).patch?.includes("\x1b"));
  });

  it("shows the proposal diff in the approval prompt before the decision", async () => {
    const env = await createTestRenderer({ width: 100, height: 30 });
    try {
      const approval = new ApprovalPromptComponent(env.renderer, { syntaxStyle: createPrismSyntaxStyle() });
      env.renderer.root.add(approval.root);
      const decision = approval.prompt({
        toolName: "edit",
        actionKind: "edit",
        operation: "edit",
        summary: "edit: edit [src/app.ts]",
        patch: "--- src/app.ts\n+++ src/app.ts\n@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;",
      });
      const frame = await renderSettled(env);
      assert.match(frame, /Tool Execution Approval Required/);
      assert.match(frame, /- const a = 1;/);
      assert.match(frame, /\+ const a = 2;/);
      approval.resolve("deny");
      assert.equal(await decision, "deny");
    } finally {
      env.renderer.destroy();
    }
  });

  it("collapses thinking blocks behind Ctrl+T", async () => {
    const env = await createTestRenderer({ width: 100, height: 20 });
    try {
      const stream = new MessageStreamComponent(env.renderer, { syntaxStyle: createPrismSyntaxStyle() });
      env.renderer.root.add(stream.root);
      stream.appendOrUpdate({ id: "t1", version: 1, type: "thinking", text: "Weighing the two candidate approaches carefully." });
      let frame = await renderSettled(env);
      assert.match(frame, /▸ Thinking… \(Ctrl\+T to expand\)/);
      assert.doesNotMatch(frame, /▾ Thinking/);

      assert.equal(stream.toggleThinking(), true);
      frame = await renderSettled(env);
      assert.match(frame, /▾ Thinking/);
      assert.match(frame, /Weighing the two candidate approaches carefully\./);

      assert.equal(stream.toggleThinking(), false);
      frame = await renderSettled(env);
      assert.doesNotMatch(frame, /▾ Thinking/);
    } finally {
      env.renderer.destroy();
    }
  });

  it("streams markdown deltas without starving input (CI-tolerant threshold)", async () => {
    const env = await createTestRenderer({ width: 100, height: 30 });
    try {
      const style = createPrismSyntaxStyle();
      const stream = new MessageStreamComponent(env.renderer, { syntaxStyle: style });
      const input = new InputEditorComponent(env.renderer, {});
      const container = new BoxRenderable(env.renderer, { flexDirection: "column", width: "100%", height: "100%" });
      container.add(stream.root);
      container.add(input.root);
      env.renderer.root.add(container);
      input.focus();

      const startedAt = performance.now();
      let text = "";
      for (let index = 1; index <= 200; index++) {
        text += `delta ${index} `;
        stream.appendOrUpdate({ id: "m1", version: index, type: "message", role: "assistant", text });
      }
      await env.renderOnce();
      env.mockInput.pressKey("x");
      env.mockInput.pressKey("y");
      await sleep(100);
      await env.renderOnce();
      const elapsed = performance.now() - startedAt;
      const frame = env.captureCharFrame();
      assert.match(frame, /delta \d+ /);
      assert.match(frame, /xy/);
      assert.ok(elapsed < 5000, `200 streaming deltas took ${Math.round(elapsed)}ms`);
    } finally {
      env.renderer.destroy();
    }
  });
});
