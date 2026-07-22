import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSecretRedactor, toolCallContent } from "@arnilo/prism";
import { createAcpEventMapper } from "../acp/index.js";

describe("createAcpEventMapper", () => {
  it("maps stable text, tool, usage, and error updates without raw paths or payloads", () => {
    const mapper = createAcpEventMapper({ redactor: createSecretRedactor(["SECRET"]) });
    const call = toolCallContent("tool-1", "write_file", { path: "/private/SECRET.txt", contents: "SECRET" });
    const output = [
      ...mapper.map({ type: "message_started", sessionId: "session-1", runId: "run-1", message: { id: "message-1", role: "assistant", content: [] } }),
      ...mapper.map({ type: "message_delta", sessionId: "session-1", runId: "run-1", content: { type: "text", text: "hello SECRET" } }),
      ...mapper.map({ type: "tool_execution_started", sessionId: "session-1", runId: "run-1", call }),
      ...mapper.map({ type: "tool_execution_finished", sessionId: "session-1", runId: "run-1", result: { toolCallId: "tool-1", name: "write_file", value: { path: "/private/SECRET.txt" } }, metadata: { durationMs: 1, status: "finished" } }),
      ...mapper.map({ type: "provider_turn_finished", sessionId: "session-1", runId: "run-1", turn: 1, metadata: { providerId: "mock", model: { provider: "mock", model: "mock" } }, usage: { inputTokens: 2, outputTokens: 3 } }),
      ...mapper.map({ type: "error", sessionId: "session-1", runId: "run-1", error: { message: "SECRET failed" } }),
    ];

    assert.deepEqual(output.map((update) => update.sessionUpdate), ["agent_message_chunk", "tool_call", "tool_call_update", "usage_update", "agent_message_chunk"]);
    const textUpdate = output[0]!;
    assert.equal(textUpdate.sessionUpdate, "agent_message_chunk");
    if (textUpdate.sessionUpdate === "agent_message_chunk" && textUpdate.content.type === "text") assert.doesNotMatch(textUpdate.content.text, /SECRET/);
    const started = output[1]!;
    assert.equal(started.sessionUpdate, "tool_call");
    if (started.sessionUpdate === "tool_call") {
      assert.equal(started.rawInput, undefined);
      assert.equal(started.locations, undefined);
      assert.equal(started.content, undefined);
    }
    const finished = output[2]!;
    assert.equal(finished.sessionUpdate, "tool_call_update");
    if (finished.sessionUpdate === "tool_call_update") {
      assert.equal(finished.rawOutput, undefined);
      assert.equal(finished.content, undefined);
    }
    assert.deepEqual(output[3], { sessionUpdate: "usage_update", used: 5, size: 5 });
    assert.doesNotMatch(JSON.stringify(output), /SECRET|\/private/);
  });

  it("uses only an explicit safe projector for displayable tool content", () => {
    const mapper = createAcpEventMapper({ projection: { toolArguments: () => "safe input", toolResult: () => "safe output" } });
    const call = toolCallContent("tool-1", "write", { secret: "hidden" });
    const started = mapper.map({ type: "tool_execution_started", sessionId: "session-1", runId: "run-1", call })[0]!;
    const finished = mapper.map({ type: "tool_execution_finished", sessionId: "session-1", runId: "run-1", result: { toolCallId: "tool-1", name: "write", value: "hidden" }, metadata: { durationMs: 1, status: "finished" } })[0]!;
    assert.deepEqual(started, { sessionUpdate: "tool_call", toolCallId: "tool-1", title: "write", kind: "edit", status: "in_progress", content: [{ type: "content", content: { type: "text", text: "safe input" } }] });
    assert.deepEqual(finished, { sessionUpdate: "tool_call_update", toolCallId: "tool-1", title: "write", status: "completed", content: [{ type: "content", content: { type: "text", text: "safe output" } }] });
  });
});
