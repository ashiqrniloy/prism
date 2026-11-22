/**
 * Plan 218.3 Task 5: one output larger than the model's window fails the run with `context_overflow` (the session-memory
 * compactor declines the overflow compaction, so no retry sends a request known not to fit); the next run's between-loop
 * compaction has STM record the output from a bounded view, removes it, and `recall` pages it. A sum overflow (no single
 * entry over the cap) still compacts and retries once, and a session without session memory's compaction keeps the
 * kernel's compact-once-and-retry.
 */
import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type AgentEvent,
  createAgent,
  definePackage,
  type ModelProvider,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type SessionEntry,
  type ToolExecutionContext,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import memorySystem, { type MemorySystemConfig } from "../../index.js";
import { originalEntryText } from "../original.js";
import { createObservationalRecallTool } from "../recall-tool.js";

/** Window 2,000, output 100: the input cap is well under the oversized output below (~12,000 tokens). */
const MODEL = { provider: "scripted", model: "main", limits: { contextWindow: 2_000, maxOutputTokens: 100 } };
const HUGE_OUTPUT = `HUGE-LOG-START\n${"build log line with detail ".repeat(1_800)}\nHUGE-LOG-END`;
const SMALL_OUTPUT = "SMALL-OK";
/** What the scripted provider treats as "does not fit": a request this many characters or more. */
const REJECT_AT_CHARS = 20_000;

const overflowInfo = {
  name: "ProviderHttpError",
  message: "provider request failed: 400 This endpoint's maximum context length is 2000 tokens",
  code: 400,
  failureClass: "context_overflow" as const,
};

const isWorker = (request: ProviderRequest) => request.tools?.some((tool) => tool.name === "record_event") === true;
const lastUserText = (request: ProviderRequest): string =>
  request.messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.content)
    .map((part) => (part.type === "text" ? part.text : ""))
    .at(-1) ?? "";

interface Live {
  readonly session: Awaited<ReturnType<Awaited<ReturnType<typeof createAgent>>["session"]>>;
  readonly main: ProviderRequest[];
  readonly rejected: ProviderRequest[];
  readonly workerBatches: string[];
  readonly events: AgentEvent[];
  dispose(): Promise<void>;
}

/**
 * A live agent. The main model calls `fetch_log` on "fetch the log" and `fetch_small` on "fetch small"; a request of
 * {@link REJECT_AT_CHARS} or more is rejected as a context overflow, and `rejectOnce` rejects the next request once
 * whatever its size (a sum overflow). The STM worker records every batch it sees.
 */
async function live(memory: MemorySystemConfig, options: { rejectOnce?: () => boolean } = {}): Promise<Live> {
  const main: ProviderRequest[] = [];
  const rejected: ProviderRequest[] = [];
  const workerBatches: string[] = [];
  const provider: ModelProvider = {
    id: "scripted",
    async *generate(request) {
      if (isWorker(request)) {
        if (!request.messages.some((message) => message.role === "tool")) {
          const batch = request.messages
            .flatMap((message) => message.content)
            .map((part) => (part.type === "text" ? part.text : ""))
            .join("\n");
          workerBatches.push(batch);
          const ids = [...batch.matchAll(/^\[[^\]]+\] \[([^\]]+)\]/gm)].map((match) => match[1] ?? "");
          const description = batch.includes("HUGE-LOG-START") ? "Fetched the huge build log" : "Chatted";
          yield providerToolCall(toolCallContent("o0", "record_event", { kind: "result", description, sourceEntryIds: ids } as never));
        }
        yield providerDone();
        return;
      }
      if (JSON.stringify(request).length >= REJECT_AT_CHARS || options.rejectOnce?.()) {
        rejected.push(request);
        yield { type: "error" as const, error: overflowInfo };
        return;
      }
      main.push(request);
      const answered = request.messages.at(-1)?.role === "tool";
      const last = lastUserText(request);
      if (!answered && last.includes("fetch the log")) yield providerToolCall(toolCallContent("c1", "fetch_log", {}));
      else if (!answered && last.includes("fetch small")) yield providerToolCall(toolCallContent("c2", "fetch_small", {}));
      else yield providerTextDelta("ok");
      yield providerDone();
    },
  };
  const tools = definePackage({
    name: "@test/overflow-tools",
    version: "0.0.0",
    requires: { api: 2 },
    setup(prism) {
      for (const [name, output] of [
        ["fetch_log", HUGE_OUTPUT],
        ["fetch_small", SMALL_OUTPUT],
      ] as const)
        prism.tools.register({
          name,
          parameters: { type: "object", properties: {} },
          execute: (_args, context) => ({ toolCallId: context.toolCallId, name, content: [{ type: "text", text: output }] }),
        });
    },
  })();
  const agent = await createAgent({
    model: MODEL,
    packages: [providerPackage("scripted", [provider]), tools, memorySystem(memory)],
  });
  const session = await agent.session({ id: `overflow-${Math.random()}`, create: true });
  const events: AgentEvent[] = [];
  void (async () => {
    for await (const event of session.subscribe()) events.push(event);
  })();
  return { session, main, rejected, workerBatches, events, dispose: () => agent.dispose() };
}

const memoryOn: MemorySystemConfig = {
  enabled: true,
  // The background STM pass never fires: only the compaction's own cover pass runs STM.
  stm: { model: "scripted/stm", triggerTokens: 1_000_000 },
  wm: false,
  // A 16 KiB worker message (an 8 KiB source budget) is smaller than the oversized output, so STM sees it cut.
  worker: { maxTurns: 2, maxMessageBytes: 16_384 },
};

async function recallPages(session: Live["session"], entryId: string): Promise<string> {
  const tool = createObservationalRecallTool({});
  const pages: string[] = [];
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const result = await tool.execute({ entry: entryId, offset } as never, { toolCallId: "t", session } as unknown as ToolExecutionContext);
    const value = result.value as { found: boolean; text: string; nextOffset?: number };
    assert.equal(value.found, true);
    pages.push(value.text.slice(value.text.indexOf("\n") + 1));
    offset = value.nextOffset;
  }
  return pages.join("");
}

describe("one output larger than the window (plan 218.3 Task 5)", () => {
  it("oversized_output_fails_the_run_with_context_overflow", async () => {
    const agent = await live(memoryOn);
    try {
      const result = await agent.session.run("fetch the log");
      assert.equal(result.status, "failed");
      assert.equal(result.error?.code, "context_overflow");
      assert.match(result.error?.message ?? "", /compaction could not shrink it/);
      assert.doesNotMatch(result.error?.message ?? "", /HUGE-LOG|build log line/, "counts only, never content");
      assert.equal(agent.rejected.length, 1, "no retry sends the request known not to fit");
      assert.equal(agent.workerBatches.length, 0, "the decline runs no STM pass");
      const entries = await agent.session.entries();
      assert.equal(entries.filter((entry) => entry.kind === "compaction").length, 0, "nothing was compacted");
      assert.ok(
        entries.some((entry) => entry.message?.role === "tool" && originalEntryText(entry).includes("HUGE-LOG-START")),
        "the output stays whole in the session",
      );
    } finally {
      await agent.dispose();
    }
  });

  it("next_run_compacts_the_oversized_output_away", async () => {
    const agent = await live(memoryOn);
    try {
      await agent.session.run("fetch the log");
      const toolEntry = (await agent.session.entries()).find(
        (entry: SessionEntry) => entry.message?.role === "tool" && originalEntryText(entry).includes("HUGE-LOG-START"),
      );
      assert.ok(toolEntry);
      const mainBefore = agent.main.length;

      const next = await agent.session.run("what did it say");
      assert.equal(next.status, "completed");
      assert.equal(agent.rejected.length, 1, "the next run's requests fit");
      const first = agent.main[mainBefore];
      assert.ok(first, "the next run reached the model");
      assert.doesNotMatch(JSON.stringify(first), /HUGE-LOG-START|build log line with detail build log line/, "the output left the window");

      // A between-loop compaction, after STM covered the output from a bounded view.
      const compaction = (await agent.session.entries()).find((entry) => entry.kind === "compaction");
      assert.ok(compaction, "the run start compacted");
      assert.equal((compaction.data as { point?: string }).point, "between-loops");
      const batch = agent.workerBatches.find((text) => text.includes("HUGE-LOG-START"));
      assert.ok(batch, "STM recorded the oversized output");
      assert.ok(batch.length < HUGE_OUTPUT.length, "the worker saw a bounded view, never the whole");
      assert.doesNotMatch(batch, /HUGE-LOG-END/, "the cut bytes never reach the worker");

      // The agent can still read the whole output, a page at a time.
      assert.equal(await recallPages(agent.session, toolEntry.id), originalEntryText(toolEntry));
    } finally {
      await agent.dispose();
    }
  });

  it("sum_overflow_still_compacts_and_retries_once", async () => {
    let reject = false;
    const agent = await live(
      { ...memoryOn, context: { keepRecentTokens: 1 } },
      {
        rejectOnce: () => {
          const now = reject;
          reject = false;
          return now;
        },
      },
    );
    try {
      await agent.session.run("hello");
      reject = true;
      const result = await agent.session.run("fetch small");
      assert.equal(result.status, "completed", "no single entry exceeds the cap: compact and retry");
      assert.equal(agent.rejected.length, 1);
      const compaction = (await agent.session.entries()).find((entry) => entry.kind === "compaction");
      assert.equal((compaction?.data as { trigger?: string } | undefined)?.trigger, "overflow");
    } finally {
      await agent.dispose();
    }
  });

  it("memory_off_keeps_overflow_retry", async () => {
    for (const config of [
      { ...memoryOn, enabled: false },
      { ...memoryOn, context: { compaction: false } },
    ] satisfies MemorySystemConfig[]) {
      let reject = false;
      const agent = await live(config, {
        rejectOnce: () => {
          const now = reject;
          reject = false;
          return now;
        },
      });
      try {
        await agent.session.run("hello");
        await agent.session.run("hello again");
        reject = true;
        const result = await agent.session.run("fetch small");
        assert.equal(result.status, "completed", "the kernel compacts once and retries");
        assert.equal(agent.rejected.length, 1);
        const compaction = (await agent.session.entries()).find((entry) => entry.kind === "compaction");
        assert.equal((compaction?.data as { trigger?: string } | undefined)?.trigger, "overflow");
      } finally {
        await agent.dispose();
      }
    }
  });
});
