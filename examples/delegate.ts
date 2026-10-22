/**
 * Delegate Demo (plan 160 Task 4).
 *
 * `@arnilo/prism-delegate` adds a `delegate` tool. The parent model calls `delegate { child: "reviewer" }`;
 * the reviewer runs as its own agent that inherits only `@arnilo/prism-tools-coding` (read-only here), so it
 * never sees the parent's `parent_note` tool or `delegate` itself. The parent gets the child's answer as the
 * tool result, and `delegate.step` package events record start and finish.
 *
 * Run: bun examples/delegate.ts
 */
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import delegate from "@arnilo/prism-delegate";
import toolsCoding from "@arnilo/prism-tools-coding";

const parentOnly = definePackage({
  name: "parent-notes",
  version: "0.12.1",
  requires: { api: 1 },
  setup(prism) {
    prism.tools.register({
      name: "parent_note",
      description: "Parent-only note tool.",
      execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "parent_note", content: [] }),
    });
  },
});

/** Parent turns call `delegate` once and then answer; child turns report the tools they were given. */
function mockProvider(): ModelProvider {
  let parentCalls = 0;
  return {
    id: "mock",
    async *generate(request) {
      const tools = (request.tools ?? []).map((tool) => tool.name);
      if (tools.includes("delegate")) {
        parentCalls += 1;
        if (parentCalls === 1) {
          yield providerToolCall(toolCallContent("call_1", "delegate", { child: "reviewer", input: "Review the diff." }));
        } else {
          yield providerTextDelta("Reviewer finished; see the tool result.");
        }
      } else {
        yield providerTextDelta(`reviewer tools: ${tools.sort().join(", ")}`);
      }
      yield providerDone({ inputTokens: 5, outputTokens: 3 });
    },
  };
}

export async function demo() {
  const steps: unknown[] = [];
  let childText = "";
  const agent = await createAgent({
    id: "delegate-demo-agent",
    model: { provider: "mock", model: "demo" },
    slots: { store: createMemorySessionStore() },
    hooks: (hooks) => {
      hooks.on("tool.completed", (event) => {
        if (event.name === "delegate") childText = String((event.result.value as { text?: string } | undefined)?.text ?? "");
      });
      hooks.on("package.event", (event: Extract<AgentEvent, { type: "package.event" }>) => {
        if (event.name === "delegate.step") steps.push(event.data);
      });
    },
    packages: [
      providerPackage("mock-provider", [mockProvider()]),
      parentOnly,
      toolsCoding({ root: process.cwd(), readOnly: true }),
      delegate({
        children: { reviewer: { inherit: ["@arnilo/prism-tools-coding"], instructions: "Review the diff.", report: "milestones" } },
      }),
    ],
  });
  const session = await agent.session();
  const result = await session.run("Please get the diff reviewed.");
  const childTools = childText.replace("reviewer tools: ", "").split(", ");
  await session.close();
  await agent.dispose();
  return { status: result.status, text: result.text, childTools, steps };
}

if (import.meta.main) console.log(JSON.stringify(await demo(), null, 2));
