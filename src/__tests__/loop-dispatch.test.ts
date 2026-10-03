import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { dispatchToolCallsInOrder } from "../loop/dispatch.js";
import type { Message, ToolCallContent, ToolResult } from "../index.js";
import { toolCallContent } from "../index.js";

function result(call: ToolCallContent): ToolResult {
  return { toolCallId: call.id, name: call.name, value: call.id };
}

function stubCtx(overrides: Partial<Parameters<typeof dispatchToolCallsInOrder>[1]> = {}) {
  const appended: Message[] = [];
  const ctx = {
    signal: new AbortController().signal,
    toolConcurrency: 1,
    dispatchToolCall: async (call: ToolCallContent) => result(call),
    appendMessage: async (message: Message) => {
      appended.push(message);
    },
    ...overrides,
  };
  return { ctx, appended };
}

function toolCallIds(appended: readonly Message[]): (string | undefined)[] {
  return appended.map((message) => (message.content[0]?.type === "tool_result" ? message.content[0].toolCallId : undefined));
}

describe("dispatchToolCallsInOrder", () => {
  it("defaults to sequential dispatch and appends in call order", async () => {
    const order: string[] = [];
    const { ctx, appended } = stubCtx({
      dispatchToolCall: async (call) => {
        order.push(call.id);
        return result(call);
      },
    });
    await dispatchToolCallsInOrder([toolCallContent("c1", "a", {}), toolCallContent("c2", "b", {})], ctx);
    assert.deepEqual(order, ["c1", "c2"]);
    assert.deepEqual(toolCallIds(appended), ["c1", "c2"]);
  });

  it("dispatches concurrently but appends tool results in call order", async () => {
    const active = new Set<string>();
    let maxActive = 0;
    const { ctx, appended } = stubCtx({
      toolConcurrency: 2,
      dispatchToolCall: async (call) => {
        active.add(call.id);
        maxActive = Math.max(maxActive, active.size);
        await new Promise((resolve) => setTimeout(resolve, call.id === "c1" ? 40 : 5));
        active.delete(call.id);
        return result(call);
      },
    });
    await dispatchToolCallsInOrder([toolCallContent("c1", "slow", {}), toolCallContent("c2", "fast", {})], ctx);
    assert.equal(maxActive, 2);
    assert.deepEqual(toolCallIds(appended), ["c1", "c2"]);
  });

  it("serializes an exclusive turn without lowering later non-exclusive concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const runBatch = async (exclusiveName?: string) => {
      maxActive = 0;
      const { ctx } = stubCtx({
        toolConcurrency: 2,
        isToolCallExclusive: (call) => call.name === exclusiveName,
        dispatchToolCall: async (call) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active -= 1;
          return result(call);
        },
      });
      await dispatchToolCallsInOrder([toolCallContent("c1", exclusiveName ?? "read", {}), toolCallContent("c2", "read", {})], ctx);
      return maxActive;
    };

    assert.equal(await runBatch("shell"), 1);
    assert.equal(await runBatch(), 2);
  });

  it("caps concurrency at the number of calls in the turn", async () => {
    let maxActive = 0;
    let active = 0;
    const { ctx } = stubCtx({
      toolConcurrency: 8,
      dispatchToolCall: async (call) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return result(call);
      },
    });
    await dispatchToolCallsInOrder([toolCallContent("c1", "a", {}), toolCallContent("c2", "b", {})], ctx);
    assert.equal(maxActive, 2);
  });

  it("waits for in-flight parallel dispatches, persists completed rows, then surfaces abort", async () => {
    const controller = new AbortController();
    let started = 0;
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    let firstSettled = false;
    const { ctx, appended } = stubCtx({
      toolConcurrency: 2,
      signal: controller.signal,
      dispatchToolCall: async (call) => {
        started += 1;
        if (call.id === "c1") {
          firstStarted();
          controller.abort(new Error("aborted run"));
          await inFlight;
          firstSettled = true;
        }
        return result(call);
      },
    });
    const dispatch = dispatchToolCallsInOrder([toolCallContent("c1", "a", {}), toolCallContent("c2", "b", {})], ctx);
    let completed = false;
    const observed = dispatch.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      },
    );
    await firstStartedPromise;
    await Promise.resolve();
    assert.equal(completed, false);
    assert.equal(started, 1);
    release();
    await assert.rejects(dispatch, /aborted run/);
    await observed;
    assert.equal(firstSettled, true);
    assert.deepEqual(
      appended.map((message) => {
        const block = message.content[0];
        return block?.type === "tool_result" ? [block.toolCallId, block.error?.code] : undefined;
      }),
      [
        ["c1", undefined],
        ["c2", "tool_call_not_dispatched"],
      ],
    );
  });

  it("waits for in-flight workers, persists answered rows, and stops unclaimed calls after the first failure", async () => {
    let releaseSecond!: () => void;
    const secondDone = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let secondStarted!: () => void;
    const secondStartedPromise = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    let secondSettled = false;
    const started: string[] = [];
    const { ctx, appended } = stubCtx({
      toolConcurrency: 2,
      dispatchToolCall: async (call) => {
        started.push(call.id);
        if (call.id === "c1") throw new Error("first failure");
        if (call.id === "c2") {
          secondStarted();
          await secondDone;
          secondSettled = true;
          return result(call);
        }
        throw new Error("c3 must not start");
      },
    });
    const dispatch = dispatchToolCallsInOrder(
      [toolCallContent("c1", "a", {}), toolCallContent("c2", "b", {}), toolCallContent("c3", "c", {})],
      ctx,
    );
    let completed = false;
    const observed = dispatch.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      },
    );
    await secondStartedPromise;
    await Promise.resolve();
    assert.equal(completed, false);
    assert.deepEqual(started, ["c1", "c2"]);
    releaseSecond();
    await assert.rejects(dispatch, /first failure/);
    await observed;
    assert.equal(secondSettled, true);
    assert.deepEqual(started, ["c1", "c2"]);
    assert.deepEqual(
      appended.map((message) => {
        const block = message.content[0];
        return block?.type === "tool_result" ? [block.toolCallId, block.error?.message] : undefined;
      }),
      [
        ["c1", "first failure"],
        ["c2", undefined],
        ["c3", "Tool call was not dispatched: the batch stopped after an earlier call failed or the run was aborted."],
      ],
    );
  });

  it("appends no synthetic row for a suspended call the resume machinery will answer", async () => {
    const suspended = Object.assign(new Error("delegated run suspended"), { code: "ERR_PRISM_DELEGATION_SUSPENDED" });
    const { ctx, appended } = stubCtx({
      toolConcurrency: 2,
      dispatchToolCall: async (call) => {
        if (call.id === "c1") throw suspended;
        return result(call);
      },
    });

    await assert.rejects(
      dispatchToolCallsInOrder([toolCallContent("c1", "agent", {}), toolCallContent("c2", "read", {})], ctx),
      /delegated run suspended/,
    );
    assert.deepEqual(toolCallIds(appended), ["c2"]);
  });
});
