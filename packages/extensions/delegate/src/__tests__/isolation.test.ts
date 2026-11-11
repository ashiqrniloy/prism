import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type Agent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import toolsCoding from "@arnilo/prism-tools/coding";

import delegate from "../index.js";

const execFileAsync = promisify(execFile);
const bases: string[] = [];

afterEach(async () => {
  while (bases.length > 0) await rm(bases.pop() as string, { recursive: true, force: true });
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("/usr/bin/git", [...args], {
    cwd,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}

/** A repository with one commit on `main` (the parent's branch). */
async function fixture(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "prism-delegate-isolation-"));
  bases.push(base);
  const repo = join(base, "repo");
  await mkdir(repo, { recursive: true });
  await git(repo, ["init", "-q", "-b", "main", "."]);
  await git(repo, ["config", "user.name", "Prism Test"]);
  await git(repo, ["config", "user.email", "prism@test.local"]);
  await writeFile(join(repo, "a.txt"), "one\n");
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-qm", "seed"]);
  return repo;
}

interface Step {
  /** Runs when the child asks for its second turn: the write has happened, the merge has not. */
  readonly duringChild?: () => Promise<void>;
}

interface HarnessOptions extends Step {
  readonly repo: string;
  readonly children?: Record<string, unknown>;
  readonly packages?: readonly unknown[];
  readonly parentScript?: "single" | "parallel";
  readonly childContent?: string;
  readonly childPath?: string;
  /** Set to `false` when the test replaces the coding package with its own `workspace` service. */
  readonly coding?: boolean;
}

interface Harness {
  readonly agent: Agent;
  readonly toolText: () => string;
  /** Every `delegate`/`delegate_wait` result text the parent model saw, in order. */
  readonly results: string[];
}

/** One provider plays both sides: a request that lists `delegate` is the parent's, the others the child's. */
async function harness(options: HarnessOptions): Promise<Harness> {
  const results: string[] = [];
  let parentCalls = 0;
  const childTurns = new Map<string, number>();
  const provider: ModelProvider = {
    id: "mock",
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const tools = (request.tools ?? []).map((tool) => tool.name);
      const last = JSON.stringify(request.messages.at(-1)?.content ?? "");
      if (tools.includes("delegate")) {
        parentCalls += 1;
        // Every async start's id is still in the transcript, so the list only grows across turns.
        const ids = [...JSON.stringify(request.messages).matchAll(/dlg_[\w]+/g)].map((match) => match[0]);
        if (options.parentScript === "parallel") {
          if (parentCalls === 1)
            yield providerToolCall(toolCallContent("call_a", "delegate", { child: "a", input: "write a", mode: "async" } as never));
          else if (parentCalls === 2)
            yield providerToolCall(toolCallContent("call_b", "delegate", { child: "b", input: "write b", mode: "async" } as never));
          else if (parentCalls === 3)
            yield providerToolCall(toolCallContent("call_w1", "delegate_wait", { delegationId: ids[0] ?? "missing" }));
          else if (parentCalls === 4)
            yield providerToolCall(toolCallContent("call_w2", "delegate_wait", { delegationId: ids[1] ?? "missing" }));
          else yield providerTextDelta("parent done");
        } else if (parentCalls === 1) {
          yield providerToolCall(toolCallContent("call_d", "delegate", { child: "coder", input: "write the file" } as never));
        } else {
          results.push(last);
          yield providerTextDelta("parent done");
        }
      } else {
        // A child is told apart by the call id we chose first, then by its own input.
        const mine = /call_w_([ab])/.exec(last)?.[1] ?? /write ([ab])/.exec(last)?.[1] ?? "coder";
        const turn = (childTurns.get(mine) ?? 0) + 1;
        childTurns.set(mine, turn);
        if (turn === 1) {
          yield providerToolCall(
            toolCallContent(`call_w_${mine}`, "write", {
              path: options.childPath ?? `${mine}.txt`,
              content: options.childContent ?? `from ${mine}\n`,
            } as never),
          );
        } else {
          await options.duringChild?.();
          yield providerTextDelta(`child ${mine} done`);
        }
      }
      yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    },
  };
  const agent = await createAgent({
    id: "isolation-parent",
    model: { provider: "mock", model: "m" },
    // A coding tool's durable write needs a principal and an ownership scope; the delegate forwards both.
    principal: { kind: "user", id: "tester" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("mock-provider", [provider]),
      ...(options.coding === false ? [] : [toolsCoding({ root: options.repo, workspace: { enabled: true } } as never)]),
      delegate({
        // The child appends under the parent's scope: a coding tool's durable effect (a write) needs one.
        ownership: { tenantId: "local" },
        children: (options.children ?? { coder: { inherit: ["@arnilo/prism-tools/coding"], isolation: "worktree" } }) as never,
      }),
      ...((options.packages ?? []) as never[]),
    ],
  });
  const session = await agent.session();
  await session.run("go");
  for (const entry of await session.entries()) {
    for (const block of entry.message?.content ?? []) {
      if (block.type !== "tool_result" || block.name === undefined || !block.name.startsWith("delegate")) continue;
      // The tools return text: `result` is the string the parent model saw.
      if (typeof block.result === "string") results.push(block.result);
      if (block.error !== undefined) results.push(`ERROR ${block.name}: ${block.error.message}`);
    }
  }
  await session.close();
  return { agent, results, toolText: () => results.at(-1) ?? "" };
}

describe("delegate worktree isolation", () => {
  it("isolated_child_edits_only_its_worktree", async () => {
    const repo = await fixture();
    let sawParentTree = true;
    const run = await harness({
      repo,
      duringChild: async () => {
        sawParentTree = existsSync(join(repo, "coder.txt"));
      },
    });
    const text = run.toolText();
    assert.equal(sawParentTree, false, "the child's file was not in the parent tree while the child ran");
    assert.equal(await readFile(join(repo, "coder.txt"), "utf8"), "from coder\n", "the merge landed the file");
    assert.match(text, /, merged [0-9a-f]{7} \(1 file\)/, text);
    assert.equal((await git(repo, ["status", "--porcelain"])).trim(), "", "the parent tree is clean after the merge");
    await run.agent.dispose();
  });

  it("isolated_child_clean_merge_lands_on_parent_branch", async () => {
    const repo = await fixture();
    const run = await harness({ repo });
    const text = run.toolText();
    assert.match(text, /\[child coder: completed, 2 turns, 4 tokens, merged [0-9a-f]{7} \(1 file\)\]/, text);
    assert.match((await git(repo, ["log", "-1", "--format=%s", "main"])).trim(), /^delegate\(coder\): write the file$/);
    assert.equal(await readFile(join(repo, "coder.txt"), "utf8"), "from coder\n");
    assert.equal((await git(repo, ["branch", "--list", "prism/*"])).trim(), "", "the merged branch was deleted");
    await run.agent.dispose();
  });

  it("isolated_child_conflict_keeps_branch_and_tree_unchanged", async () => {
    const repo = await fixture();
    const run = await harness({
      repo,
      childPath: "a.txt",
      childContent: "child\n",
      duringChild: async () => {
        // The parent's branch moves while the child works, so the merge cannot be clean.
        await writeFile(join(repo, "a.txt"), "main\n");
        await git(repo, ["commit", "-qam", "main change"]);
      },
    });
    // The child wrote `a.txt` in its worktree too: same lines, different content.
    const text = run.toolText();
    assert.match(text, /merge conflict: a\.txt \(branch prism\/[\w-]+ kept\)/, text);
    assert.equal(await readFile(join(repo, "a.txt"), "utf8"), "main\n", "the parent tree kept its own content");
    assert.equal(existsSync(join(repo, "coder.txt")), false, "the conflicted child's file is not in the parent tree");
    assert.notEqual((await git(repo, ["branch", "--list", "prism/*"])).trim(), "", "the unmerged branch is kept");
    await run.agent.dispose();
  });

  it("isolated_child_dirty_target_refused", async () => {
    const repo = await fixture();
    const run = await harness({
      repo,
      duringChild: async () => {
        await writeFile(join(repo, "a.txt"), "uncommitted\n");
      },
    });
    const text = run.toolText();
    assert.match(text, /merge refused: .*uncommitted changes.*\(branch prism\/[\w-]+ kept\)/, text);
    assert.equal(await readFile(join(repo, "a.txt"), "utf8"), "uncommitted\n", "the dirty parent tree was not touched");
    assert.notEqual((await git(repo, ["branch", "--list", "prism/*"])).trim(), "", "the branch is kept");
    await run.agent.dispose();
  });

  it("failed_child_skips_merge_keeps_branch", async () => {
    const repo = await fixture();
    const run = await harness({
      repo,
      children: { coder: { inherit: ["@arnilo/prism-tools/coding"], isolation: "worktree", limits: { maxTurns: 1 } } },
    });
    const text = run.toolText();
    assert.match(text, /branch prism\/[\w-]+ kept/, text);
    assert.equal(text.includes(", merged "), false, "nothing was merged");
    assert.equal(existsSync(join(repo, "coder.txt")), false, "the failed child's file is not in the parent tree");
    assert.notEqual((await git(repo, ["branch", "--list", "prism/*"])).trim(), "", "the branch is kept");
    await run.agent.dispose();
  });

  it("parallel_isolated_children_merge_in_completion_order", async () => {
    const repo = await fixture();
    const run = await harness({
      repo,
      parentScript: "parallel",
      children: {
        a: { inherit: ["@arnilo/prism-tools/coding"], isolation: "worktree", description: "Writes a." },
        b: { inherit: ["@arnilo/prism-tools/coding"], isolation: "worktree", description: "Writes b." },
      },
    });
    const text = run.results.join("\n");
    assert.equal((text.match(/, merged [0-9a-f]{7} \(1 file\)/g) ?? []).length, 2, text);
    assert.equal(await readFile(join(repo, "a.txt"), "utf8"), "from a\n");
    assert.equal(await readFile(join(repo, "b.txt"), "utf8"), "from b\n");
    const subjects = (await git(repo, ["log", "--format=%s", "main"])).trim().split("\n");
    // Both merges landed, and each is a commit on the other: one at a time, so neither compare-and-swap was lost.
    assert.deepEqual(subjects.slice(0, 2).sort(), ["delegate(a): write a", "delegate(b): write b"]);
    await run.agent.dispose();
  });

  it("isolation_without_workspace_service_fails_before_run", async () => {
    const repo = await fixture();
    const run = await harness({
      repo,
      children: { coder: { inherit: [], isolation: "worktree" } },
    });
    const text = run.toolText();
    assert.match(text, /isolation_unavailable: child coder has no "workspace" service/, text);
    assert.match(text, /@arnilo\/prism-tools\/coding/, "the error names a package that provides one");
    await run.agent.dispose();
  });

  it("isolation_under_sandbox_fails_closed", async () => {
    const repo = await fixture();
    let ranChild = false;
    // A service contract, not a tool package: `worktree.create` refuses a session binding the way a
    // sandboxed service does, so the mapping to `isolation_unavailable` is tested deterministically.
    const sandboxed = definePackage({
      name: "@prism-test/sandboxed-workspace",
      version: "0.0.0",
      requires: { api: 1 },
      setup: ({ services }) => {
        services.provide("workspace", {
          worktree: {
            async create() {
              const error = new Error("a sandboxed run cannot bind a worktree to a session");
              (error as { code?: string }).code = "workspace_sandbox_unsupported";
              throw error;
            },
          },
          async merge() {
            ranChild = true;
            return { status: "merged", commit: "0".repeat(40) };
          },
        });
      },
    });
    const run = await harness({
      repo,
      coding: false,
      packages: [sandboxed()],
      children: { coder: { inherit: ["@prism-test/sandboxed-workspace"], isolation: "worktree" } },
    });
    const text = run.toolText();
    assert.match(text, /isolation_unavailable: a sandboxed run cannot bind a worktree/, text);
    assert.equal(ranChild, false, "no merge ran, so the child never started");
    await run.agent.dispose();
  });
});
