import { it } from "bun:test";
import assert from "node:assert/strict";
import { createTestRenderer } from "@opentui/core/testing";
import { MessageStreamComponent } from "../tui/components/stream.js";
import { sanitizeTerminalText } from "../tui/sanitize.js";

it("updates earlier keyed tool card, keeps consistent role labels, renders escapes inert", async () => {
  const env = await createTestRenderer({ width: 100, height: 30 });
  try {
    const stream = new MessageStreamComponent(env.renderer);
    env.renderer.root.add(stream.root);
    stream.appendOrUpdate({ id: "a", version: 1, type: "tool_call", toolCallId: "a", name: "shell", argsSummary: "{}", status: "running" });
    stream.appendOrUpdate({ id: "b", version: 1, type: "tool_call", toolCallId: "b", name: "shell", argsSummary: "{}", status: "running" });
    stream.appendOrUpdate({ id: "you", version: 1, type: "message", role: "user", text: "hi" });
    stream.appendOrUpdate({ id: "you", version: 2, type: "message", role: "user", text: "hello" });
    stream.appendOrUpdate({ id: "system", version: 1, type: "message", role: "system", text: "setup" });
    await env.renderOnce();
    stream.appendOrUpdate({
      id: "a",
      version: 2,
      type: "tool_call",
      toolCallId: "a",
      name: "shell",
      argsSummary: "{}",
      status: "failure",
      error: "\x1b]0;evil\x07failed\x1b[31m",
    });
    await env.renderOnce();
    const frame = env.captureCharFrame();
    assert.match(frame, /\[✖\] shell/);
    assert.match(frame, /\[●\] shell/);
    assert.match(frame, /You: hello/);
    assert.doesNotMatch(frame, /user:|You: hi\b|Assistant: setup|System: setup|evil|\x1b/);
    assert.match(frame, /Note: setup/);
    assert.strictEqual(stream.getItemCount(), 4);
  } finally {
    env.renderer.destroy();
  }
});

it("strips OSC, CSI, C1, DCS and C0 controls, preserving newline and tab", () => {
  assert.equal(sanitizeTerminalText("a\x1b]0;evil\x07b\x1b[31mc\u009b32md\x1bPprivate\x1b\\e\u009d0;x\u009cf\x00\r\ng\th"), "abcdef\ng\th");
  assert.equal(sanitizeTerminalText("safe\x1b]0;unfinished"), "safe");
});
