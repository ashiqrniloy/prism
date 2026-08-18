import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSecretRedactor, toolCallContent } from "@arnilo/prism";
import { createAcpEventMapper, createCodingToolProjection } from "../acp/index.js";

describe("createAcpEventMapper", () => {
  it("maps stable text, tool, usage, and error updates without raw paths or payloads", async () => {
    const mapper = createAcpEventMapper({ redactor: createSecretRedactor(["SECRET"]) });
    const call = toolCallContent("tool-1", "write_file", { path: "/private/SECRET.txt", contents: "SECRET" });
    const output = [
      ...(await mapper.map({
        type: "message_started",
        sessionId: "session-1",
        runId: "run-1",
        message: { id: "message-1", role: "assistant", content: [] },
      })),
      ...(await mapper.map({
        type: "message_delta",
        sessionId: "session-1",
        runId: "run-1",
        content: { type: "text", text: "hello SECRET" },
      })),
      ...(await mapper.map({ type: "tool_execution_started", sessionId: "session-1", runId: "run-1", call })),
      ...(await mapper.map({
        type: "tool_execution_finished",
        sessionId: "session-1",
        runId: "run-1",
        result: { toolCallId: "tool-1", name: "write_file", value: { path: "/private/SECRET.txt" } },
        metadata: { durationMs: 1, status: "finished" },
      })),
      ...(await mapper.map({
        type: "provider_turn_finished",
        sessionId: "session-1",
        runId: "run-1",
        turn: 1,
        metadata: { providerId: "mock", model: { provider: "mock", model: "mock" } },
        usage: { inputTokens: 2, outputTokens: 3 },
      })),
      ...(await mapper.map({ type: "error", sessionId: "session-1", runId: "run-1", error: { message: "SECRET failed" } })),
    ];

    assert.deepEqual(
      output.map((update) => update.sessionUpdate),
      ["agent_message_chunk", "tool_call", "tool_call_update"],
    );
    const textUpdate = output[0]!;
    assert.equal(textUpdate.sessionUpdate, "agent_message_chunk");
    if (textUpdate.sessionUpdate === "agent_message_chunk" && textUpdate.content.type === "text")
      assert.doesNotMatch(textUpdate.content.text, /SECRET/);
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
    // B1: without a context-window seam the usage update is omitted entirely (never `size = used`).
    // B2: the terminal run-level error maps to nothing — forward() rejects the request instead.
    assert.equal(output.length, 3);
    assert.doesNotMatch(JSON.stringify(output), /SECRET|\/private/);
  });

  it("B1: emits usage_update with the host-reported context window; omits it when the seam is absent, throws, or returns an invalid size", async () => {
    const turn = {
      type: "provider_turn_finished" as const,
      sessionId: "session-1",
      runId: "run-1",
      turn: 1,
      metadata: { providerId: "mock", model: { provider: "mock", model: "gpt-4o" } },
      usage: { inputTokens: 2, outputTokens: 3 },
    };
    const seen: (string | undefined)[] = [];
    const mapper = createAcpEventMapper({
      usage: {
        contextWindow: ({ model }) => {
          seen.push(model);
          return model === "gpt-4o" ? 128_000 : undefined;
        },
      },
    });
    const withSeam = await mapper.map(turn);
    assert.deepEqual(withSeam, [{ sessionUpdate: "usage_update", used: 5, size: 128_000 }]);
    assert.deepEqual(seen, ["gpt-4o"]);

    const withoutSeam = await createAcpEventMapper({}).map(turn);
    assert.deepEqual(withoutSeam, []);

    const throwing = await createAcpEventMapper({ usage: { contextWindow: () => Promise.reject(new Error("boom")) } }).map(turn);
    assert.deepEqual(throwing, []);

    for (const invalid of [undefined, NaN, 0, -1, Number.POSITIVE_INFINITY, "128000"]) {
      const bad = await createAcpEventMapper({ usage: { contextWindow: () => invalid as never } }).map(turn);
      assert.deepEqual(bad, [], `invalid size ${String(invalid)} must omit the update`);
    }
  });

  it("F1: thinking deltas and blocks map to agent_thought_chunk; other non-text deltas stay dropped", async () => {
    const mapper = createAcpEventMapper({ redactor: createSecretRedactor(["SECRET"]) });
    const start = {
      type: "message_started" as const,
      sessionId: "s",
      runId: "run-1",
      message: { id: "m1", role: "assistant" as const, content: [] },
    };
    const delta = (
      content:
        | { type: "thinking"; text: string }
        | { type: "text"; text: string }
        | { type: "image" }
        | { type: "tool_call_delta"; index: number },
    ) => ({
      type: "message_delta" as const,
      sessionId: "s",
      runId: "run-1",
      content,
    });
    const updates = [
      ...(await mapper.map(start)),
      ...(await mapper.map(delta({ type: "thinking", text: "think SECRET" }))),
      ...(await mapper.map(delta({ type: "text", text: "plain" }))),
      ...(await mapper.map(delta({ type: "image" }))),
      ...(await mapper.map(delta({ type: "tool_call_delta", index: 0 }))),
    ];
    assert.deepEqual(
      updates.map((u) => u.sessionUpdate),
      ["agent_thought_chunk", "agent_message_chunk"],
    );
    const thought = updates[0]!;
    assert.equal(thought.sessionUpdate, "agent_thought_chunk");
    assert.equal((thought as { content: { type: string; text: string } }).content.text, "think [REDACTED]");
    const text = updates[1]!;
    assert.equal(text.sessionUpdate, "agent_message_chunk");
    assert.equal((text as { content: { type: string; text: string } }).content.text, "plain");
  });

  it("F1: message_finished emits thinking/text blocks that had no live delta, sharing one messageId", async () => {
    const mapper = createAcpEventMapper({});
    const start = {
      type: "message_started" as const,
      sessionId: "s",
      runId: "run-1",
      message: { id: "m1", role: "assistant" as const, content: [] },
    };
    const finish = (blocks: readonly ({ type: "thinking"; text: string } | { type: "text"; text: string })[]) => ({
      type: "message_finished" as const,
      sessionId: "s",
      runId: "run-1",
      message: { id: "m1", role: "assistant" as const, content: blocks },
    });
    // No live deltas: both the thinking block and the text block are emitted, same messageId.
    const both = await mapper.map(
      finish([
        { type: "thinking", text: "hidden" },
        { type: "text", text: "visible" },
      ]),
    );
    assert.deepEqual(both, [
      { sessionUpdate: "agent_thought_chunk", messageId: "m1", content: { type: "text", text: "hidden" } },
      { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "visible" } },
    ]);
    // A text delta suppresses only the text block; the thinking block still arrives.
    await mapper.map(start);
    await mapper.map({ type: "message_delta", sessionId: "s", runId: "run-1", content: { type: "text", text: "streamed" } });
    const afterTextDelta = await mapper.map(
      finish([
        { type: "thinking", text: "hidden" },
        { type: "text", text: "visible" },
      ]),
    );
    assert.deepEqual(afterTextDelta, [
      { sessionUpdate: "agent_thought_chunk", messageId: "m1", content: { type: "text", text: "hidden" } },
    ]);
  });

  it("F1: thinking text passes the shared redactor and byte cap", async () => {
    const mapper = createAcpEventMapper({ redactor: createSecretRedactor(["SECRET"]), limits: { maxTextBytes: 16 } });
    const [update] = await mapper.map({
      type: "message_delta",
      sessionId: "s",
      runId: "run-1",
      content: { type: "thinking", text: "SECRET long-thinking" },
    });
    assert.equal(update.sessionUpdate, "agent_thought_chunk");
    const content = (update as { content: { type: string; text: string } }).content;
    assert.ok(content.text.length <= 16);
    assert.doesNotMatch(content.text, /SECRET/);
  });

  it("B4: explicit toolKinds win over the heuristic; unknown names fall back to other", async () => {
    const mapper = createAcpEventMapper({
      toolKinds: new Map([
        ["write_file", "execute"], // explicit kind beats the write→edit heuristic
        ["host_thing", "other"],
      ]),
    });
    const started = async (name: string) => {
      const call = toolCallContent("tool-1", name, {});
      const [update] = await mapper.map({ type: "tool_execution_started", sessionId: "s", runId: "r", call });
      return update as { kind: string };
    };
    assert.equal((await started("write_file")).kind, "execute");
    assert.equal((await started("host_thing")).kind, "other");
    // Heuristic fallback unchanged when the map has no entry.
    assert.equal((await started("read_file")).kind, "read");
    assert.equal((await started("mystery")).kind, "other");
  });

  it("B2: tool-level failures still map to tool_call_update status failed (only run-level errors reject)", async () => {
    const mapper = createAcpEventMapper({});
    const call = toolCallContent("tool-1", "write", { path: "/host/x.txt" });
    const updates = await mapper.map({
      type: "tool_execution_error",
      sessionId: "session-1",
      runId: "run-1",
      call,
      error: { message: "boom" },
      metadata: { durationMs: 1, status: "error" },
    });
    assert.deepEqual(updates, [{ sessionUpdate: "tool_call_update", toolCallId: "tool-1", title: "write", status: "failed" as const }]);
  });

  it("uses only an explicit safe projector for displayable tool content", async () => {
    const mapper = createAcpEventMapper({ projection: { toolArguments: () => "safe input", toolResult: () => "safe output" } });
    const call = toolCallContent("tool-1", "write", { secret: "hidden" });
    const started = (await mapper.map({ type: "tool_execution_started", sessionId: "session-1", runId: "run-1", call }))[0]!;
    const finished = (
      await mapper.map({
        type: "tool_execution_finished",
        sessionId: "session-1",
        runId: "run-1",
        result: { toolCallId: "tool-1", name: "write", value: "hidden" },
        metadata: { durationMs: 1, status: "finished" },
      })
    )[0]!;
    assert.deepEqual(started, {
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      title: "write",
      kind: "edit",
      status: "in_progress",
      content: [{ type: "content", content: { type: "text", text: "safe input" } }],
    });
    assert.deepEqual(finished, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      title: "write",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "safe output" } }],
    });
  });

  it("F7: createCodingToolProjection maps edit patch+path and write path; default still denies", async () => {
    const withProjection = createAcpEventMapper({
      projection: createCodingToolProjection(),
      redactor: createSecretRedactor(["SECRET"]),
    });
    const editFinished = (
      await withProjection.map({
        type: "tool_execution_finished",
        sessionId: "session-1",
        runId: "run-1",
        result: {
          toolCallId: "tool-1",
          name: "edit",
          metadata: {
            path: "/w/src/a.ts",
            patch: "--- a\n+++ b\n-SECRET\n+safe",
            firstChangedLine: 3,
          },
        },
        metadata: { durationMs: 1, status: "finished" },
      })
    )[0]!;
    assert.deepEqual(editFinished, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      title: "edit",
      status: "completed",
      content: [
        {
          type: "diff",
          path: "/w/src/a.ts",
          newText: "--- a\n+++ b\n-[REDACTED]\n+safe",
        },
      ],
      locations: [{ path: "/w/src/a.ts", line: 3 }],
    });

    const writeFinished = (
      await withProjection.map({
        type: "tool_execution_finished",
        sessionId: "session-1",
        runId: "run-1",
        result: {
          toolCallId: "tool-2",
          name: "write",
          metadata: { path: "/w/out.txt", bytes: 4, lines: 1 },
        },
        metadata: { durationMs: 1, status: "finished" },
      })
    )[0]!;
    assert.deepEqual(writeFinished, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-2",
      title: "write",
      status: "completed",
      locations: [{ path: "/w/out.txt" }],
    });

    // Non-coding tool + coding projector: no diff/locations.
    const other = (
      await withProjection.map({
        type: "tool_execution_finished",
        sessionId: "session-1",
        runId: "run-1",
        result: { toolCallId: "tool-3", name: "shell", metadata: { path: "/w/nope" } },
        metadata: { durationMs: 1, status: "finished" },
      })
    )[0]!;
    assert.equal((other as { content?: unknown }).content, undefined);
    assert.equal((other as { locations?: unknown }).locations, undefined);

    // Default (no projection): still deny-by-default.
    const denied = (
      await createAcpEventMapper({}).map({
        type: "tool_execution_finished",
        sessionId: "session-1",
        runId: "run-1",
        result: {
          toolCallId: "tool-1",
          name: "edit",
          metadata: { path: "/w/a.ts", patch: "--- a\n+++ b\n+x", firstChangedLine: 1 },
        },
        metadata: { durationMs: 1, status: "finished" },
      })
    )[0]!;
    assert.equal((denied as { content?: unknown }).content, undefined);
    assert.equal((denied as { locations?: unknown }).locations, undefined);
  });

  it("F7: oversize coding diffs are dropped by acpDiffBytes; maxDiffBytes pre-truncates", async () => {
    // acpDiffBytes floor is 1024; pad the patch so the serialized diff exceeds it.
    const patch = `--- a\n+++ b\n+${"x".repeat(2048)}`;
    const dropped = (
      await createAcpEventMapper({
        projection: createCodingToolProjection(),
        limits: { acpDiffBytes: 1024 },
      }).map({
        type: "tool_execution_finished",
        sessionId: "session-1",
        runId: "run-1",
        result: { toolCallId: "tool-1", name: "edit", metadata: { path: "/w/a.ts", patch } },
        metadata: { durationMs: 1, status: "finished" },
      })
    )[0]!;
    assert.equal((dropped as { content?: unknown }).content, undefined, "oversize diff dropped");

    const truncated = (
      await createAcpEventMapper({
        projection: createCodingToolProjection({ maxDiffBytes: 32 }),
        limits: { acpDiffBytes: 1024 },
      }).map({
        type: "tool_execution_finished",
        sessionId: "session-1",
        runId: "run-1",
        result: { toolCallId: "tool-1", name: "edit", metadata: { path: "/w/a.ts", patch } },
        metadata: { durationMs: 1, status: "finished" },
      })
    )[0]! as { content: Array<{ type: string; newText: string }> };
    assert.equal(truncated.content?.[0]?.type, "diff");
    assert.ok(Buffer.byteLength(truncated.content[0]!.newText, "utf8") <= 32);
  });

  it("F8: projected image emits a content/image block; oversize and absent projection drop", async () => {
    const image = { type: "image" as const, data: "iVBORw0KGgo=", mimeType: "image/png" };
    const emitted = (
      await createAcpEventMapper({
        projection: { toolResult: () => image },
      }).map({
        type: "tool_execution_finished",
        sessionId: "session-1",
        runId: "run-1",
        result: { toolCallId: "tool-1", name: "read", value: "/w/shot.png" },
        metadata: { durationMs: 1, status: "finished" },
      })
    )[0]!;
    assert.deepEqual(emitted, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      title: "read",
      status: "completed",
      content: [{ type: "content", content: { type: "image", data: image.data, mimeType: "image/png" } }],
    });

    const dropped = (
      await createAcpEventMapper({
        projection: { toolResult: () => ({ type: "image", data: "x".repeat(2048), mimeType: "image/png" }) },
        limits: { acpImageBytes: 1024 },
      }).map({
        type: "tool_execution_finished",
        sessionId: "session-1",
        runId: "run-1",
        result: { toolCallId: "tool-1", name: "read" },
        metadata: { durationMs: 1, status: "finished" },
      })
    )[0]!;
    assert.equal((dropped as { content?: unknown }).content, undefined, "oversize image dropped");

    const denied = (
      await createAcpEventMapper({}).map({
        type: "tool_execution_finished",
        sessionId: "session-1",
        runId: "run-1",
        result: { toolCallId: "tool-1", name: "read" },
        metadata: { durationMs: 1, status: "finished" },
      })
    )[0]!;
    assert.equal((denied as { content?: unknown }).content, undefined, "no projection ⇒ no image");

    // Text toolResult still emits a content/text block (widening is additive).
    const texted = (
      await createAcpEventMapper({
        projection: { toolResult: () => "ok" },
      }).map({
        type: "tool_execution_finished",
        sessionId: "session-1",
        runId: "run-1",
        result: { toolCallId: "tool-1", name: "read" },
        metadata: { durationMs: 1, status: "finished" },
      })
    )[0]!;
    assert.deepEqual((texted as { content: unknown }).content, [{ type: "content", content: { type: "text", text: "ok" } }]);
  });
});
