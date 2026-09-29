import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentEvent,
  type AgentSession,
  type AIProvider,
  type Message,
  type ModelConfig,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type ToolRegistry,
  type ToolResult,
  toolCallContent,
} from "@arnilo/prism";
import { createTodoWriteTool, type TodoContinuationStopHook, type TodoItem } from "@arnilo/prism-coding-tools/agent";
import { type PrismCodeConfig, validatePrismCodeConfigLayer } from "../config.js";
import { assembleAppAgent } from "../headless.js";
import { resolveContinueOnOpenTodos } from "../limits.js";
import { formatTodoPanel } from "../tui/components/todo.js";
import { createInitialTuiState, tuiReducer } from "../tui/reducer.js";

const testModel: ModelConfig = {
  provider: "mock",
  model: "test-model",
  limits: { contextWindow: 200_000, maxOutputTokens: 2_000 },
};

type ScriptStep = { readonly text: string } | { readonly toolCall: { readonly name: string; readonly args: Record<string, unknown> } };

function todoStep(todos: readonly TodoItem[]): ScriptStep {
  return { toolCall: { name: "todo_write", args: { todos } } };
}

function scriptedProvider(
  steps: readonly ScriptStep[],
  options?: { readonly onMainTurn?: (index: number) => void },
): { provider: AIProvider; requests: ProviderRequest[] } {
  const requests: ProviderRequest[] = [];
  let turn = 0;
  return {
    requests,
    provider: {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        if ((request.tools ?? []).length === 0) {
          // Compaction summarizer request.
          yield providerTextDelta("Summary of previous work");
          yield providerDone();
          return;
        }
        const index = turn++;
        options?.onMainTurn?.(index);
        const step = steps[index];
        if (step === undefined) {
          yield providerTextDelta("script exhausted");
          yield providerDone();
          return;
        }
        if ("toolCall" in step) {
          yield providerToolCall(toolCallContent(`call_${index}`, step.toolCall.name, step.toolCall.args as never));
        } else {
          yield providerTextDelta(step.text);
        }
        yield providerDone();
      },
    },
  };
}

async function collectSessionEvents(session: AgentSession): Promise<{ readonly events: AgentEvent[]; readonly done: Promise<void> }> {
  const events: AgentEvent[] = [];
  const done = (async () => {
    for await (const event of session.subscribe()) {
      events.push(event);
    }
  })();
  return { events, done };
}

function mainRequests(requests: readonly ProviderRequest[]): readonly ProviderRequest[] {
  return requests.filter((request) => (request.tools ?? []).length > 0);
}

function messageTexts(messages: readonly Message[]): string {
  return messages
    .flatMap((message) => message.content)
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "tool_result" && typeof block.result === "string") return block.result;
      return "";
    })
    .join("\n");
}

async function withTempDir<T>(prefix: string, run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("Prism Code task-completion continuation", () => {
  it("resolveContinueOnOpenTodos defaults on and only false disables it", () => {
    assert.equal(resolveContinueOnOpenTodos(undefined), true);
    assert.equal(resolveContinueOnOpenTodos("single-shot"), true);
    assert.equal(resolveContinueOnOpenTodos({ strategy: "single-shot" }), true);
    assert.equal(resolveContinueOnOpenTodos({ strategy: "single-shot", continueOnOpenTodos: true }), true);
    assert.equal(resolveContinueOnOpenTodos({ continueOnOpenTodos: false }), false);
  });

  it("validates loop.continueOnOpenTodos as a boolean", () => {
    assert.deepEqual(validatePrismCodeConfigLayer({ loop: { continueOnOpenTodos: false } }).loop, {
      strategy: "single-shot",
      continueOnOpenTodos: false,
    });
    assert.throws(() => validatePrismCodeConfigLayer({ loop: { continueOnOpenTodos: "no" } }), /continueOnOpenTodos/);
  });

  it("registers todo_write and continues the run after a premature text-only turn", async () => {
    await withTempDir("prism-todo-continuation-", async (cwd) => {
      const { provider, requests } = scriptedProvider([
        todoStep([{ id: "1", content: "step one", status: "pending" }]),
        { text: "I am done." },
        todoStep([{ id: "1", content: "step one", status: "completed" }]),
        { text: "All done." },
      ]);
      const config: PrismCodeConfig = { cwd, model: testModel, tools: { planes: { coding: false } }, compaction: false };
      const definition = await assembleAppAgent(config, provider);
      const names = (definition.agent.config.tools as ToolRegistry).list().map((tool) => tool.name);
      assert.equal(names.includes("todo_write"), true);

      const session = definition.createSession();
      const { done } = await collectSessionEvents(session);
      const result = await session.run("Do the task");
      await done;

      assert.equal(result.status, "succeeded");
      assert.equal(result.text, "All done.");
      const turns = mainRequests(requests);
      assert.equal(turns.length, 4, "two model turns plus two continuation turns");

      // The continuation steer rides the first request of the continuation leg.
      const continuationRequest = messageTexts(turns[2]?.messages ?? []);
      assert.match(continuationRequest, /Open todo items \(1\)/);
      assert.match(continuationRequest, /\[pending\] 1: step one/);
      assert.match(continuationRequest, /mark them completed\/cancelled/);

      // The list survives in history and closes the loop when completed.
      const finalRequest = messageTexts(turns[3]?.messages ?? []);
      assert.match(finalRequest, /\[x\] 1: step one/);
    });
  });

  it("stops after maxNoProgress continuations with no progress and reports the note", async () => {
    await withTempDir("prism-todo-noprogress-", async (cwd) => {
      const { provider, requests } = scriptedProvider([
        todoStep([{ id: "1", content: "step one", status: "pending" }]),
        { text: "thinking 1" },
        { text: "thinking 2" },
        { text: "thinking 3" },
      ]);
      const config: PrismCodeConfig = { cwd, model: testModel, tools: { planes: { coding: false } }, compaction: false };
      const definition = await assembleAppAgent(config, provider);

      const hook = (definition as unknown as { todoStopHook?: TodoContinuationStopHook }).todoStopHook;
      assert.ok(hook);
      const notes: string[] = [];
      if (hook) hook.onNoProgressStop = () => notes.push("Stopped: no progress on open todos");

      const session = definition.createSession();
      const { done } = await collectSessionEvents(session);
      const result = await session.run("Do the task");
      await done;

      assert.equal(result.status, "succeeded");
      assert.equal(mainRequests(requests).length, 4, "initial turn + 2 progress-free continuations + stop turn");
      assert.deepEqual(notes, ["Stopped: no progress on open todos"]);
    });
  });

  it("loop.continueOnOpenTodos: false removes the tool and never continues", async () => {
    await withTempDir("prism-todo-disabled-", async (cwd) => {
      const { provider, requests } = scriptedProvider([{ text: "Only turn" }]);
      const config: PrismCodeConfig = {
        cwd,
        model: testModel,
        tools: { planes: { coding: false } },
        loop: { continueOnOpenTodos: false },
        compaction: false,
      };
      const definition = await assembleAppAgent(config, provider);
      assert.equal((definition as unknown as { todoStopHook?: unknown }).todoStopHook, undefined);
      const names = (definition.agent.config.tools as ToolRegistry).list().map((tool) => tool.name);
      assert.equal(names.includes("todo_write"), false);

      const session = definition.createSession();
      const { done } = await collectSessionEvents(session);
      const result = await session.run("Do the task");
      await done;

      assert.equal(result.status, "succeeded");
      assert.equal(mainRequests(requests).length, 1);
    });
  });

  it("a user abort during a continuation stops the run", async () => {
    await withTempDir("prism-todo-abort-", async (cwd) => {
      const controller = new AbortController();
      const { provider, requests } = scriptedProvider(
        [todoStep([{ id: "1", content: "step one", status: "pending" }]), { text: "premature stop" }],
        { onMainTurn: (index) => (index === 1 ? controller.abort("Run cancelled by user via Escape") : undefined) },
      );
      const config: PrismCodeConfig = { cwd, model: testModel, tools: { planes: { coding: false } }, compaction: false };
      const definition = await assembleAppAgent(config, provider);
      const session = definition.createSession();
      const { done } = await collectSessionEvents(session);
      let abortedStatus: string | undefined;
      try {
        const result = await session.run("Do the task", { signal: controller.signal });
        abortedStatus = result.status;
      } catch (error) {
        abortedStatus = (error as { result?: { status?: string } }).result?.status;
      }
      await done;

      assert.equal(abortedStatus, "aborted");
      assert.equal(mainRequests(requests).length, 2, "no continuation turn runs after the abort");
    });
  });

  it("a later run on the same session restores the list from history", async () => {
    await withTempDir("prism-todo-resume-", async (cwd) => {
      // Run 1 ends after the no-progress guard; run 2's history still carries run 1's open list.
      const { provider, requests } = scriptedProvider([
        todoStep([{ id: "1", content: "step one", status: "pending" }]),
        { text: "thinking 1" },
        { text: "thinking 2" },
        { text: "thinking 3" },
        { text: "premature stop" },
        todoStep([{ id: "1", content: "step one", status: "completed" }]),
        { text: "All done." },
      ]);
      const config: PrismCodeConfig = { cwd, model: testModel, tools: { planes: { coding: false } }, compaction: false };
      const definition = await assembleAppAgent(config, provider);
      const session = definition.createSession();
      const { done } = await collectSessionEvents(session);

      const first = await session.run("Do the task");
      assert.equal(first.status, "succeeded");
      assert.equal(mainRequests(requests).length, 4);

      const second = await session.run("Continue the task");
      await done;
      assert.equal(second.status, "succeeded");
      assert.equal(second.text, "All done.");

      // The second run's first continuation request still lists the restored open item.
      const secondRunRequests = mainRequests(requests).slice(4);
      assert.equal(secondRunRequests.length, 3);
      assert.match(messageTexts(secondRunRequests[1]?.messages ?? []), /\[pending\] 1: step one/);
    });
  });

  it("TUI reducer tracks the latest todo list and clears it on session reset", () => {
    const todos: readonly TodoItem[] = [{ id: "1", content: "step one", status: "pending" }];
    const result = createTodoWriteTool().execute({ todos } as never, { sessionId: "s", runId: "r", toolCallId: "call_1" }) as ToolResult;
    const withTodos = tuiReducer(createInitialTuiState(), {
      type: "session_event",
      event: {
        type: "tool_execution_finished",
        sessionId: "s",
        runId: "call_1",
        result: { ...result, toolCallId: "call_1", name: "todo_write" },
        metadata: { durationMs: 1, status: "finished" },
      },
    });
    assert.deepEqual(withTodos.todos, todos);
    assert.equal(formatTodoPanel(todos), "Todos (1 open / 1): [ ] step one");

    const afterCompleted = tuiReducer(withTodos, {
      type: "session_event",
      event: {
        type: "tool_execution_finished",
        sessionId: "s",
        runId: "call_2",
        result: {
          toolCallId: "call_2",
          name: "todo_write",
          metadata: { todos: [{ id: "1", content: "step one", status: "completed" }] },
        },
        metadata: { durationMs: 1, status: "finished" },
      },
    });
    assert.equal(formatTodoPanel(afterCompleted.todos ?? []), "Todos (0 open / 1): [x] step one");

    const reset = tuiReducer(afterCompleted, { type: "reset_session", sessionId: "new" });
    assert.equal(reset.todos, undefined);
  });
});
