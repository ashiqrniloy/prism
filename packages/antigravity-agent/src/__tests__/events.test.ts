import assert from "node:assert/strict";
import { test } from "node:test";
import { createSecretRedactor } from "@arnilo/prism";
import { createAgUiEventMapper } from "@arnilo/prism-ag-ui";
import { createAntigravityEventProjector, mapAntigravityUsage } from "../index.js";

test("mapAntigravityUsage: normalizes snake_case and camelCase token counters", () => {
  const usage = mapAntigravityUsage({
    input_tokens: 150,
    output_tokens: 45,
    thinking_tokens: 12,
    cache_read_tokens: 30,
    cache_write_tokens: 5,
    total_tokens: 242,
  });

  assert.deepEqual(usage, {
    inputTokens: 150,
    outputTokens: 45,
    thinkingTokens: 12,
    cacheReadTokens: 30,
    cacheWriteTokens: 5,
    totalTokens: 242,
  });

  assert.equal(mapAntigravityUsage(null), undefined);
  assert.equal(mapAntigravityUsage({}), undefined);
});

test("AntigravityEventProjector: projects init, steps, tools, subagents, checkpoints, and result in sequence", async () => {
  const projector = createAntigravityEventProjector({
    sessionId: "sess-100",
    runId: "run-100",
  });

  // 1. Init event
  const initEvents = projector.projectRecord({
    type: "init",
    cwd: "/workspace",
    conversation_id: "conv-100",
    tools: ["prism:read_file", "view_file"],
  });

  assert.equal(initEvents.length, 1);
  assert.equal(initEvents[0].type, "delegated_agent_step");
  if (initEvents[0].type === "delegated_agent_step") {
    assert.equal(initEvents[0].sessionId, "sess-100");
    assert.equal(initEvents[0].runId, "run-100");
    assert.equal(initEvents[0].adapterId, "antigravity");
    assert.equal(initEvents[0].externalConversationId, "conv-100");
    assert.equal(initEvents[0].stepIndex, 0);
    assert.equal(initEvents[0].state, "active");
    assert.equal(initEvents[0].kind, "assistant");
  }

  // 2. Assistant step with text_delta
  const textEvents = projector.projectRecord({
    type: "step_update",
    conversation_id: "conv-100",
    step_index: 1,
    step_type: "assistant",
    state: "ACTIVE",
    text_delta: "Thinking about the task...",
  });

  assert.equal(textEvents.length, 3);
  assert.equal(textEvents[0].type, "message_started");
  assert.equal(textEvents[1].type, "message_delta");
  assert.equal(textEvents[2].type, "delegated_agent_step");
  if (textEvents[1].type === "message_delta") {
    assert.deepEqual(textEvents[1].content, { type: "text", text: "Thinking about the task..." });
  }

  // 3. Prism Tool step with thinking tokens
  const prismToolEvents = projector.projectRecord({
    type: "step_update",
    conversation_id: "conv-100",
    step_index: 2,
    step_type: "tool",
    state: "DONE",
    duration_ms: 84,
    tool_info: {
      name: "prism:repo_search",
    },
    usage: {
      inputTokens: 200,
      outputTokens: 30,
      thinkingTokens: 551,
      totalTokens: 781,
    },
  });

  assert.equal(prismToolEvents.length, 1);
  assert.equal(prismToolEvents[0].type, "delegated_agent_step");
  if (prismToolEvents[0].type === "delegated_agent_step") {
    assert.equal(prismToolEvents[0].kind, "tool");
    assert.equal(prismToolEvents[0].state, "done");
    assert.equal(prismToolEvents[0].toolName, "prism:repo_search");
    assert.equal(prismToolEvents[0].durationMs, 84);
    assert.equal(prismToolEvents[0].detail?.label, "Prism tool: prism:repo_search");
    assert.deepEqual(prismToolEvents[0].usage, {
      inputTokens: 200,
      outputTokens: 30,
      thinkingTokens: 551,
      totalTokens: 781,
    });
  }

  // 4. Delegated built-in tool step
  const builtinToolEvents = projector.projectRecord({
    type: "step_update",
    conversation_id: "conv-100",
    step_index: 3,
    step_type: "tool",
    state: "DONE",
    duration_ms: 25,
    tool_info: {
      name: "view_file",
    },
  });

  assert.equal(builtinToolEvents.length, 1);
  if (builtinToolEvents[0].type === "delegated_agent_step") {
    assert.equal(builtinToolEvents[0].kind, "tool");
    assert.equal(builtinToolEvents[0].toolName, "view_file");
    assert.equal(builtinToolEvents[0].detail?.label, "Delegated tool: view_file");
  }

  // 5. Subagent step
  const subagentEvents = projector.projectRecord({
    type: "step_update",
    conversation_id: "conv-100",
    step_index: 4,
    step_type: "subagent",
    state: "ACTIVE",
    subagent_info: {
      type: "reviewer",
      role: "code reviewer",
      conversation_id: "conv-sub-1",
    },
  });

  assert.equal(subagentEvents.length, 1);
  if (subagentEvents[0].type === "delegated_agent_step") {
    assert.equal(subagentEvents[0].kind, "subagent");
    assert.equal(subagentEvents[0].subagentType, "reviewer");
    assert.equal(subagentEvents[0].detail?.label, "code reviewer");
    assert.equal(subagentEvents[0].detail?.referenceId, "conv-sub-1");
  }

  // 6. Checkpoint step
  const checkpointEvents = projector.projectRecord({
    type: "step_update",
    conversation_id: "conv-100",
    step_index: 5,
    step_type: "checkpoint",
    state: "DONE",
  });

  assert.equal(checkpointEvents.length, 1);
  if (checkpointEvents[0].type === "delegated_agent_step") {
    assert.equal(checkpointEvents[0].kind, "checkpoint");
    assert.equal(checkpointEvents[0].detail?.label, "Checkpoint saved");
  }

  // 7. Terminal result event
  const resultEvents = projector.projectRecord({
    type: "result",
    status: "SUCCESS",
    conversation_id: "conv-100",
    response: "Thinking about the task... Task completed successfully.",
    duration_ms: 3200,
    usage: {
      inputTokens: 300,
      outputTokens: 80,
      thinkingTokens: 551,
      totalTokens: 931,
    },
  });

  assert.equal(resultEvents.length, 2);
  assert.equal(resultEvents[0].type, "message_finished");
  assert.equal(resultEvents[1].type, "delegated_agent_step");
  if (resultEvents[1].type === "delegated_agent_step") {
    assert.equal(resultEvents[1].state, "done");
    assert.equal(resultEvents[1].durationMs, 3200);
    assert.equal(resultEvents[1].detail?.label, "Execution completed");
  }

  // Verify AG-UI projection conformance across all mapped events
  const agUiMapper = createAgUiEventMapper({ includeCustomEvents: true });
  const allEvents = [
    ...initEvents,
    ...textEvents,
    ...prismToolEvents,
    ...builtinToolEvents,
    ...subagentEvents,
    ...checkpointEvents,
    ...resultEvents,
  ];

  for (const ev of allEvents) {
    const mapped = await agUiMapper.map(ev);
    assert.ok(Array.isArray(mapped));
    if (ev.type === "delegated_agent_step") {
      const snapshot = mapped.find((item) => item.type === "ACTIVITY_SNAPSHOT" || item.type === "activity_snapshot");
      assert.ok(snapshot, "Expected AG-UI activity snapshot for delegated step");
    }
  }
});

test("AntigravityEventProjector: redacts secrets from deltas and final response", () => {
  const secret = "SUPER_SECRET_TOKEN_XYZ";
  const redactor = createSecretRedactor([secret]);

  const projector = createAntigravityEventProjector({
    sessionId: "sess-redact",
    runId: "run-redact",
    redactor,
  });

  const textEvents = projector.projectRecord({
    type: "step_update",
    conversation_id: "conv-redact",
    step_index: 0,
    step_type: "assistant",
    state: "ACTIVE",
    text_delta: `Leaked token: ${secret}`,
  });

  const delta = textEvents.find((e) => e.type === "message_delta");
  assert.ok(delta && delta.type === "message_delta");
  assert.equal(delta.content.type, "text");
  assert.doesNotMatch((delta.content as { type: "text"; text: string }).text, new RegExp(secret));
  assert.match((delta.content as { type: "text"; text: string }).text, /\[REDACTED\]/);

  const resultEvents = projector.projectRecord({
    type: "result",
    conversation_id: "conv-redact",
    status: "SUCCESS",
    response: `Result contains token: ${secret}`,
  });

  const finished = resultEvents.find((e) => e.type === "message_finished");
  assert.ok(finished && finished.type === "message_finished");
  const block = finished.message.content[0] as { type: "text"; text: string };
  assert.doesNotMatch(block.text, new RegExp(secret));
  assert.match(block.text, /\[REDACTED\]/);
});

test("AntigravityEventProjector: error result maps to error step state", () => {
  const projector = createAntigravityEventProjector({
    sessionId: "sess-err",
    runId: "run-err",
  });

  const resultEvents = projector.projectRecord({
    type: "result",
    conversation_id: "conv-err",
    status: "ERROR",
    error: {
      message: "Model quota exhausted",
      code: "QUOTA_EXCEEDED",
    },
  });

  const step = resultEvents.find((e) => e.type === "delegated_agent_step");
  assert.ok(step && step.type === "delegated_agent_step");
  assert.equal(step.state, "error");
  assert.equal(step.detail?.label, "Model quota exhausted");
});
