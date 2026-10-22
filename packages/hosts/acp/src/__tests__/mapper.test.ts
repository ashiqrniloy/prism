import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createSecretRedactor, toolCallContent } from "@arnilo/prism";
import { createAcpEventMapper } from "../index.js";

describe("createAcpEventMapper", () => {
  it("maps stable text, tool, usage, and error updates without raw paths or payloads", async () => {
    const mapper = createAcpEventMapper({ redactor: createSecretRedactor(["SECRET"]) });
    const call = toolCallContent("tool-1", "write_file", { path: "/private/SECRET.txt", contents: "SECRET" });
    const output = [
      ...(await mapper.map({
        type: "message.delta",
        sessionId: "session-1",
        runId: "run-1",
        content: { type: "text", text: "hello SECRET" },
      })),
      ...(await mapper.map({ type: "tool.started", sessionId: "session-1", runId: "run-1", call })),
      ...(await mapper.map({
        type: "tool.completed",
        status: "finished",
        sessionId: "session-1",
        runId: "run-1",
        result: { toolCallId: "tool-1", name: "write_file", value: { path: "/private/SECRET.txt" } },
        metadata: { durationMs: 1, status: "finished" },
      })),
      ...(await mapper.map({
        type: "turn.completed",
        sessionId: "session-1",
        runId: "run-1",
        turn: 1,
        metadata: { providerId: "mock", model: { provider: "mock", model: "mock" } },
        usage: { inputTokens: 2, outputTokens: 3 },
      })),
      ...(await mapper.map({ type: "run.failed", sessionId: "session-1", runId: "run-1", error: { message: "SECRET failed" } })),
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
      type: "turn.completed" as const,
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
    const delta = (
      content:
        | { type: "thinking"; text: string }
        | { type: "text"; text: string }
        | { type: "image" }
        | { type: "tool_call_delta"; index: number },
    ) => ({
      type: "message.delta" as const,
      sessionId: "s",
      runId: "run-1",
      content,
    });
    const updates = [
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
    const finish = (blocks: readonly ({ type: "thinking"; text: string } | { type: "text"; text: string })[]) => ({
      type: "message.completed" as const,
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
    await mapper.map({ type: "message.delta", sessionId: "s", runId: "run-1", content: { type: "text", text: "streamed" } });
    const afterTextDelta = await mapper.map(
      finish([
        { type: "thinking", text: "hidden" },
        { type: "text", text: "visible" },
      ]),
    );
    assert.deepEqual(afterTextDelta, [
      { sessionUpdate: "agent_thought_chunk", messageId: "run-1:message", content: { type: "text", text: "hidden" } },
    ]);
  });

  it("F1: thinking text passes the shared redactor and byte cap", async () => {
    const mapper = createAcpEventMapper({ redactor: createSecretRedactor(["SECRET"]), limits: { maxTextBytes: 16 } });
    const [update] = await mapper.map({
      type: "message.delta",
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
      const [update] = await mapper.map({ type: "tool.started", sessionId: "s", runId: "r", call });
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
    const updates = await mapper.map({
      type: "tool.completed",
      sessionId: "session-1",
      runId: "run-1",
      toolCallId: "tool-1",
      name: "write",
      status: "error",
      result: { toolCallId: "tool-1", name: "write", error: { message: "boom" } },
      error: { message: "boom" },
      metadata: { durationMs: 1, status: "error" },
    });
    assert.deepEqual(updates, [{ sessionUpdate: "tool_call_update", toolCallId: "tool-1", title: "write", status: "failed" as const }]);
  });

  it("uses only an explicit safe projector for displayable tool content", async () => {
    const mapper = createAcpEventMapper({ projection: { toolArguments: () => "safe input", toolResult: () => "safe output" } });
    const call = toolCallContent("tool-1", "write", { secret: "hidden" });
    const started = (await mapper.map({ type: "tool.started", sessionId: "session-1", runId: "run-1", call }))[0]!;
    const finished = (
      await mapper.map({
        type: "tool.completed",
        status: "finished",
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

  it("F8: projected image emits a content/image block; oversize and absent projection drop", async () => {
    const image = { type: "image" as const, data: "iVBORw0KGgo=", mimeType: "image/png" };
    const emitted = (
      await createAcpEventMapper({
        projection: { toolResult: () => image },
      }).map({
        type: "tool.completed",
        status: "finished",
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
        type: "tool.completed",
        status: "finished",
        sessionId: "session-1",
        runId: "run-1",
        result: { toolCallId: "tool-1", name: "read" },
        metadata: { durationMs: 1, status: "finished" },
      })
    )[0]!;
    assert.equal((dropped as { content?: unknown }).content, undefined, "oversize image dropped");

    const denied = (
      await createAcpEventMapper({}).map({
        type: "tool.completed",
        status: "finished",
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
        type: "tool.completed",
        status: "finished",
        sessionId: "session-1",
        runId: "run-1",
        result: { toolCallId: "tool-1", name: "read" },
        metadata: { durationMs: 1, status: "finished" },
      })
    )[0]!;
    assert.deepEqual((texted as { content: unknown }).content, [{ type: "content", content: { type: "text", text: "ok" } }]);
  });
});

describe("ACP mapper diff and locations (Task 6)", () => {
  const finished = (result: unknown) => {
    const tool = result as { toolCallId?: string; name?: string };
    return {
      type: "tool.completed" as const,
      sessionId: "session-1",
      runId: "run-1",
      toolCallId: tool.toolCallId ?? "tool-1",
      name: tool.name ?? "edit",
      status: "finished" as const,
      result: result as never,
      metadata: { durationMs: 1, status: "finished" as const },
    };
  };

  it("attaches locations from the projection allow-list, capped at acpLocationsPerUpdate", async () => {
    const mapper = createAcpEventMapper({
      limits: { acpLocationsPerUpdate: 2 },
      projection: {
        toolLocations: () => [{ path: "/a.ts", line: 1 }, { path: "/b.ts" }, { path: "/c.ts" }],
      },
    });
    const output = await mapper.map(finished({ toolCallId: "tool-1", name: "edit", value: {} }));
    const update = output[0] as { sessionUpdate: string; locations: Array<{ path: string; line?: number }> };
    assert.equal(update.sessionUpdate, "tool_call_update");
    assert.deepEqual(update.locations, [{ path: "/a.ts", line: 1 }, { path: "/b.ts" }]);
  });

  it("drops invalid location entries and keeps no locations when the hook is absent", async () => {
    const mapper = createAcpEventMapper({
      projection: {
        toolLocations: () => [{ path: "" }, { path: "/ok.ts", line: -1 }, { path: "/ok2.ts", line: 3 }],
      },
    });
    const output = await mapper.map(finished({ toolCallId: "tool-1", name: "edit", value: {} }));
    assert.deepEqual((output[0] as { locations?: unknown }).locations, [{ path: "/ok2.ts", line: 3 }]);

    const plain = createAcpEventMapper();
    const without = await plain.map(finished({ toolCallId: "tool-1", name: "edit", value: {} }));
    assert.equal((without[0] as { locations?: unknown }).locations, undefined);
    assert.equal((without[0] as { content?: unknown }).content, undefined);
  });

  it("attaches one projected diff, redacted and capped at acpDiffBytes", async () => {
    const mapper = createAcpEventMapper({
      redactor: createSecretRedactor(["TOKEN"]),
      limits: { acpDiffBytes: 1024 },
      projection: {
        toolResult: () => "done",
        toolDiff: () => ({ path: "/a.ts", oldText: "old TOKEN", newText: "new TOKEN" }),
      },
    });
    const output = await mapper.map(finished({ toolCallId: "tool-1", name: "edit", value: {} }));
    const update = output[0] as {
      content: Array<{ type: string; path?: string; oldText?: string; newText?: string; content?: { text?: string } }>;
    };
    assert.equal(update.content[0].type, "content");
    assert.equal(update.content[0].content?.text, "done");
    assert.deepEqual(update.content[1], { type: "diff", path: "/a.ts", oldText: "old [REDACTED]", newText: "new [REDACTED]" });
  });

  it("drops an oversized diff and malformed projections fail closed", async () => {
    const mapper = createAcpEventMapper({
      limits: { acpDiffBytes: 1024 },
      projection: {
        toolDiff: () => ({ path: "/a.ts", newText: "y".repeat(5000) }),
      },
    });
    const output = await mapper.map(finished({ toolCallId: "tool-1", name: "edit", value: {} }));
    const update = output[0] as { content?: unknown };
    assert.equal(update.content, undefined);

    const throwing = createAcpEventMapper({
      projection: {
        toolLocations: () => {
          throw new Error("boom");
        },
        toolDiff: () => ({ path: "", newText: "" }),
      },
    });
    const safe = await throwing.map(finished({ toolCallId: "tool-1", name: "edit", value: {} }));
    assert.equal((safe[0] as { locations?: unknown }).locations, undefined);
    assert.equal((safe[0] as { content?: unknown }).content, undefined);
  });

  it("combines locations with the existing stable text update flow", async () => {
    const mapper = createAcpEventMapper({
      projection: {
        toolResult: (result) => String((result as { value?: number }).value),
        toolLocations: () => [{ path: "/x.ts" }],
      },
    });
    const output = await mapper.map(finished({ toolCallId: "tool-1", name: "write", value: 7 }));
    const update = output[0] as { sessionUpdate: string; locations?: unknown; content?: Array<{ content?: { text?: string } }> };
    assert.equal(update.sessionUpdate, "tool_call_update");
    assert.deepEqual(update.locations, [{ path: "/x.ts" }]);
    assert.equal(update.content![0]!.content!.text, "7");
  });
});
