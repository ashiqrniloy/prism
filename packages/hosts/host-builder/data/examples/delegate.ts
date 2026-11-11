/**
 * Delegate Demo (plan 160 Task 4, plan 191 Task 5).
 *
 * `@arnilo/prism-extensions/delegate` adds a `delegate` tool. The parent model calls `delegate { child: "reviewer" }`;
 * the reviewer runs as its own agent that inherits only `@arnilo/prism-tools/coding` (read-only here), so it
 * never sees the parent's `parent_note` tool or `delegate` itself. The parent gets the child's answer as the
 * tool result, and `delegate.step` package events record start and finish.
 *
 * The reviewer is configured with `context: { lastTurns: 2 }`, so it also sees the last two turns of the
 * parent's conversation; its answer reports whether it did.
 *
 * The second demo is a coding child with `isolation: "worktree"` in a throwaway repository: it sees only its
 * own worktree, and its commit lands on the parent's `main` when it completes. A conflict would keep the
 * child's branch instead; the status line says which happened.
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
  await session.close();
  await agent.dispose();
  return { status: result.status, text: result.text, childTools, sawParent, steps };
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
          // The child has no store of its own: the scope it appends under is the host's to name.
          ownership: { tenantId: "demo" },
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

if (import.meta.main) console.log(JSON.stringify({ delegated: await demo(), isolated: await demoIsolated() }, null, 2));
