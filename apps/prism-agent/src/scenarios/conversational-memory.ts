import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentEvent, Decision, PendingDecision, ProviderEvent, Session, ToolResult } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import type { HostConfig } from "../host/config.js";
import { createResearchWorker } from "../host/research.js";

export const MEMORY_FACT = "teal-0427";

export interface ConversationalMemoryResult {
  /** The `memory.recall` tool output from the second session. */
  readonly recalled: string;
  /** The `memory.forget` tool value. */
  readonly forgetFound: boolean;
  /** The `memory.recall` tool output from the third session. */
  readonly afterForget: string;
}

function textOf(result: ToolResult): string {
  return (result.content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("\n");
}

function hitId(value: unknown): string {
  const hits = (value as { hits?: readonly { id?: unknown }[] } | undefined)?.hits;
  const id = hits?.[0]?.id;
  if (typeof id !== "string") throw new Error("memory.recall returned no note id");
  return id;
}

async function runTurn(session: Session, text: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  const pump = (async () => {
    for await (const event of session.subscribe()) events.push(event);
  })();
  const result = await session.run(text);
  await pump;
  // The forget is a write, so the research worker's approval policy asks. This scenario is its approver.
  let pending: readonly PendingDecision[] | undefined = result.pending;
  while (pending !== undefined && pending.length > 0) {
    const decisions: Decision[] = pending.map((item) => ({ approvalId: item.approvalId, outcome: "allow_once" }));
    let next: readonly PendingDecision[] | undefined;
    for await (const event of session.resume(decisions)) {
      events.push(event);
      if (event.type === "run.suspended") next = event.interruption.pendingDecisions;
    }
    pending = next;
  }
  return events;
}

/** The exchange write is a background task; wait for the note to exist before the next session recalls it. */
async function waitForArchivedExchange(root: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (
      readdirSync(root, { recursive: true }).some((entry) => {
        if (typeof entry !== "string" || !entry.endsWith(".md")) return false;
        return readFileSync(join(root, entry), "utf8").includes(MEMORY_FACT);
      })
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the exchange archive did not write the first session's turn");
}

/** Session A states a fact; B recalls it; C forgets it; D recalls nothing (plan 188.11 Task 7). */
export async function conversationalMemory(config: HostConfig): Promise<ConversationalMemoryResult> {
  const script: ProviderEvent[][] = [[providerTextDelta("Noted."), providerDone()]];
  const agent = await createResearchWorker({ ...config, memory: "conversational" }, { packages: [mockProvider(script)] });
  const memoryRoot = join(dirname(config.storePath), "memory");
  try {
    const first = await agent.session({ create: true });
    await runTurn(first, `My favourite colour is ${MEMORY_FACT}. Remember it.`);
    await first.close();
    await waitForArchivedExchange(memoryRoot);

    script.push([
      providerToolCall(toolCallContent("recall-1", "memory.recall", { query: MEMORY_FACT, kinds: ["exchange"] })),
      providerDone(),
    ]);
    script.push([providerTextDelta("It is recorded."), providerDone()]);
    const second = await agent.session({ create: true });
    const recallEvents = await runTurn(second, "What is my favourite colour?");
    const recalled = recallEvents.find((event) => event.type === "tool.completed" && event.name === "memory.recall");
    if (recalled?.type !== "tool.completed") {
      throw new Error(
        `the scripted memory.recall did not run: ${recallEvents.map((event) => event.type + ("name" in event ? `:${event.name}` : "")).join(",")}`,
      );
    }
    const id = hitId(recalled.result.value);

    script.push([providerToolCall(toolCallContent("forget-1", "memory.forget", { id })), providerDone()]);
    script.push([providerTextDelta("Forgotten."), providerDone()]);
    const third = await agent.session({ create: true });
    const forgetEvents = await runTurn(third, "Forget my favourite colour.");
    const forgot = forgetEvents.find((event) => event.type === "tool.completed" && event.name === "memory.forget");
    if (forgot?.type !== "tool.completed") throw new Error("the scripted memory.forget did not run");
    await third.close();

    script.push([
      providerToolCall(toolCallContent("recall-2", "memory.recall", { query: MEMORY_FACT, kinds: ["exchange"] })),
      providerDone(),
    ]);
    script.push([providerTextDelta("I do not know."), providerDone()]);
    const fourth = await agent.session({ create: true });
    const afterEvents = await runTurn(fourth, "What is my favourite colour now?");
    const after = afterEvents.find((event) => event.type === "tool.completed" && event.name === "memory.recall");
    if (after?.type !== "tool.completed") throw new Error("the second scripted memory.recall did not run");

    return {
      recalled: textOf(recalled.result),
      forgetFound: (forgot.result.value as { found?: unknown } | undefined)?.found === true,
      afterForget: textOf(after.result),
    };
  } finally {
    await agent.dispose();
  }
}
