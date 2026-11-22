/**
 * Delegate Demo (plan 160 Task 4, plan 191 Task 5, plan 232 Tasks 4–5).
 *
 * `@arnilo/prism-extensions/delegate` adds a `delegate` tool. The parent model calls `delegate { child: "reviewer" }`;
 * the reviewer runs as a session of the same agent, linked to the parent session, with only the tools of
 * `@arnilo/prism-tools/coding` (read-only here), so it never sees the parent's `parent_note` tool or `delegate`
 * itself. The parent gets the child's answer as the tool result, `delegate.step` package events record start and
 * finish, and the child's transcript stays in the agent's store, listed under the parent session.
 *
 * The reviewer is configured with `context: { lastTurns: 2 }`, so it also sees the last two turns of the
 * parent's conversation; its answer reports whether it did.
 *
 * The second demo is a coding child with `isolation: "worktree"` in a throwaway repository: it sees only its
 * own worktree, and its commit lands on the parent's `main` when it completes. A conflict would keep the
 * child's branch instead; the status line says which happened.
 *
 * The third demo is a two-level tree (`maxDepth: 2`) under `report: "stream"`: the `lead` child may delegate once more
 * to a `worker` grandchild, which may not. Each level's tool calls and text arrive as bounded `delegate.activity`
 * events, and the root run's usage holds all three levels' turns.
 *
 * Run: bun examples/delegate.ts
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
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
import delegate from "@arnilo/prism-extensions/delegate";
import toolsCoding from "@arnilo/prism-tools/coding";

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
        const sawParent = JSON.stringify(request.messages).includes("Please get the diff reviewed.");
        yield providerTextDelta(`reviewer tools: ${tools.sort().join(", ")}; saw parent: ${sawParent ? "yes" : "no"}`);
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
        if (event.name !== "delegate") return;
        // The result is text (plan 191 Task 2): the answer, then a status line.
        const block = event.result.content?.[0];
        childText = block?.type === "text" ? (block.text.split("\n")[0] ?? "") : "";
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
        children: {
          reviewer: {
            inherit: ["@arnilo/prism-tools/coding"],
            instructions: "Review the diff.",
            report: "milestones",
            context: { lastTurns: 2 },
          },
        },
      }),
    ],
  });
  const session = await agent.session();
  const result = await session.run("Please get the diff reviewed.");
  const childTools = childText.replace("reviewer tools: ", "").split(", ");
  const sawParent = childTools.splice(-1)[0]?.endsWith("yes") === true;
  // The child is a linked session in the same store, kept after the delegation.
  const childSessions = (await agent.sessions.list({ parentSessionId: session.id })).items.length;
  await session.close();
  await agent.dispose();
  return { status: result.status, text: result.text, childTools, sawParent, steps, childSessions };
}

const execFileAsync = promisify(execFile);

const git = (cwd: string, args: readonly string[]) => execFileAsync("/usr/bin/git", [...args], { cwd });

/** The child writes one file in its worktree; the delegate merges the branch into the parent's `main`. */
function isolationProvider(): ModelProvider {
  let parentCalls = 0;
  let childCalls = 0;
  return {
    id: "mock",
    async *generate(request) {
      const tools = (request.tools ?? []).map((tool) => tool.name);
      if (tools.includes("delegate")) {
        parentCalls += 1;
        if (parentCalls === 1) {
          yield providerToolCall(toolCallContent("call_coder", "delegate", { child: "coder", input: "Write notes.txt." }));
        } else {
          yield providerTextDelta("Coder finished; see the tool result.");
        }
      } else {
        childCalls += 1;
        if (childCalls === 1) {
          yield providerToolCall(toolCallContent("call_write", "write", { path: "notes.txt", content: "written by the coder\n" }));
        } else {
          yield providerTextDelta("Wrote notes.txt in my worktree.");
        }
      }
      yield providerDone({ inputTokens: 5, outputTokens: 3 });
    },
  };
}

/** A throwaway repository: the demo never touches this repository. */
async function demoRepo(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "prism-delegate-demo-"));
  await git(base, ["init", "-q", "-b", "main", "."]);
  await git(base, ["config", "user.name", "Prism Demo"]);
  await git(base, ["config", "user.email", "demo@prism.local"]);
  await writeFile(join(base, "README.md"), "seed\n");
  await git(base, ["add", "-A"]);
  await git(base, ["commit", "-qm", "seed"]);
  return base;
}

export async function demoIsolated() {
  const repo = await demoRepo();
  try {
    let statusLine = "";
    const agent = await createAgent({
      id: "delegate-isolation-demo",
      model: { provider: "mock", model: "demo" },
      principal: { kind: "user", id: "demo" },
      // A coding tool's durable write needs a scope; the child session inherits the parent's.
      ownership: { tenantId: "demo" },
      slots: { store: createMemorySessionStore() },
      hooks: (hooks) => {
        hooks.on("tool.completed", (event) => {
          if (event.name !== "delegate") return;
          const block = event.result.content?.[0];
          // The result is text: the child's answer, then a status line with the merge outcome.
          statusLine = block?.type === "text" ? (block.text.split("\n").find((line) => line.startsWith("[child ")) ?? "") : "";
        });
      },
      packages: [
        providerPackage("mock-provider", [isolationProvider()]),
        toolsCoding({ root: repo }),
        delegate({
          children: { coder: { inherit: ["@arnilo/prism-tools/coding"], isolation: "worktree", description: "Writes one file." } },
        }),
      ],
    });
    const session = await agent.session();
    const result = await session.run("Write notes.txt.");
    await session.close();
    await agent.dispose();
    const merged = await readFile(join(repo, "notes.txt"), "utf8").catch(() => "");
    const subjects = (await git(repo, ["log", "--format=%s", "main"])).stdout.trim().split("\n");
    return { status: result.status, statusLine, merged: merged.trim(), subject: subjects[0] ?? "" };
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

/** Root → `lead` (depth 1, may delegate) → `worker` (depth 2, may not); every turn is 5 tokens. */
function treeProvider(): ModelProvider {
  return {
    id: "mock",
    async *generate(request) {
      const tools = (request.tools ?? []).map((tool) => tool.name);
      const brief = JSON.stringify(request.messages.find((message) => message.role === "user")?.content ?? "");
      const last = request.messages.at(-1);
      if (last?.role === "tool") yield providerTextDelta(`Done (${brief.includes("Split") ? "lead" : "root"}).`);
      else if (brief.includes("Ship"))
        yield providerToolCall(toolCallContent("call_lead", "delegate", { child: "lead", input: "Split the work." }));
      else if (tools.includes("delegate"))
        yield providerToolCall(toolCallContent("call_worker", "delegate", { child: "worker", input: "Do part one." }));
      else yield providerTextDelta(`worker tools: ${tools.join(", ") || "none"}`);
      yield providerDone({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    },
  };
}

export async function demoTree() {
  const activity: { agent: string; depth: number; kind: string; tool?: string }[] = [];
  const agent = await createAgent({
    id: "delegate-tree-demo",
    model: { provider: "mock", model: "demo" },
    slots: { store: createMemorySessionStore() },
    hooks: (hooks) =>
      hooks.on("package.event", (event: Extract<AgentEvent, { type: "package.event" }>) => {
        if (event.name !== "delegate.activity") return;
        const data = event.data as { origin: { agent: string; depth: number }; kind: string; tool?: string };
        activity.push({
          agent: data.origin.agent,
          depth: data.origin.depth,
          kind: data.kind,
          ...(data.tool === undefined ? {} : { tool: data.tool }),
        });
      }),
    packages: [
      providerPackage("mock-provider", [treeProvider()]),
      delegate({
        maxDepth: 2,
        children: {
          lead: { inherit: [], description: "Splits work.", report: "stream" },
          worker: { inherit: [], description: "Does one part.", report: "stream" },
        },
      }),
    ],
  });
  const session = await agent.session();
  const result = await session.run("Ship it.");
  const [lead] = (await agent.sessions.list({ parentSessionId: session.id })).items;
  const grandchildren = lead === undefined ? 0 : (await agent.sessions.list({ parentSessionId: lead.sessionId })).items.length;
  await session.close();
  await agent.dispose();
  // Root 2 turns + lead 2 turns + worker 1 turn, all charged to the root run.
  return { status: result.status, totalTokens: result.usage?.totalTokens, grandchildren, activity };
}

if (import.meta.main)
  console.log(JSON.stringify({ delegated: await demo(), isolated: await demoIsolated(), tree: await demoTree() }, null, 2));
