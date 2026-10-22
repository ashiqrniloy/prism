import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  createAgent,
  definePackage,
  type JsonObject,
  type ToolCallHookPayload,
  type ToolDefinition,
  type ToolExecutionContext,
} from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";

import { createCodingTools } from "../../agent/index.js";
import { createCodingCheckTool } from "../../agent/checks.js";
import { createGitTools } from "../../agent/git-tools.js";
import { createHardDenyHook } from "../../hard-deny.js";
import toolsCoding from "../../index.js";
import { createCodingTargets } from "../../targets.js";
import { WorkspaceServiceError } from "../errors.js";
import { createWorktreeRouting } from "../routing.js";
import { createWorkspaceService, type WorkspaceService } from "../service.js";

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

interface Fixture {
  readonly repo: string;
  readonly worktreeRoot: string;
}

async function fixture(): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "prism-routing-"));
  bases.push(base);
  const repo = join(base, "repo");
  const worktreeRoot = join(base, "worktrees");
  await mkdir(repo, { recursive: true });
  await git(repo, ["init", "-q", "-b", "main", "."]);
  await git(repo, ["config", "user.name", "Prism Test"]);
  await git(repo, ["config", "user.email", "prism@test.local"]);
  await writeFile(join(repo, "a.txt"), "one\n");
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-qm", "seed"]);
  return { repo, worktreeRoot };
}

async function service(fx: Fixture, options: Partial<Parameters<typeof createWorkspaceService>[0]> = {}) {
  return await createWorkspaceService({ root: fx.repo, worktreeRoot: fx.worktreeRoot, ...options });
}

function context(sessionId: string): ToolExecutionContext {
  return { sessionId, runId: "run-1", toolCallId: "call-1" };
}

function tool(tools: readonly ToolDefinition[], name: string): ToolDefinition {
  const found = tools.find((candidate) => candidate.name === name);
  assert.ok(found !== undefined, `expected a ${name} tool`);
  return found;
}

function payload(sessionId: string, name: string, args: JsonObject): ToolCallHookPayload {
  return { name, args, effects: ["write"], callId: "call-1", sessionId, runId: "run-1" };
}

/** A probe package that reads the `workspace` service the tools package provided. */
function workspaceProbe() {
  let read: (() => WorkspaceService | undefined) | undefined;
  const probe = definePackage({
    name: "@prism-test/routing-probe",
    version: "0.0.0",
    requires: { api: 1 },
    setup: ({ services }) => {
      read = () => services.consume<WorkspaceService>("workspace");
    },
  });
  return { probe, service: () => read?.() };
}

/** Routing over the real tool factories, counting how many times a cwd-specific set is built. */
function routing(workspace: WorkspaceService, root: string) {
  let built = 0;
  const create = (cwd: string): readonly ToolDefinition[] => {
    built += 1;
    // Shell-less: the set carries `delete`/`move`, which is what the containment checks below exercise.
    return createCodingTools(cwd, { shellAvailable: false });
  };
  const instance = createWorktreeRouting({ base: createCodingTools(root, { shellAvailable: false }), create, workspace });
  return { instance, built: () => built };
}

describe("worktree tool routing", () => {
  it("bound_session_tools_run_in_worktree", async () => {
    const fx = await fixture();
    const workspace = await service(fx);
    const worktree = await workspace.worktree.create({ sessionId: "s1" });
    const { instance, built } = routing(workspace, fx.repo);

    const write = tool(instance.tools, "write");
    const result = await write.execute({ path: "new.txt", content: "delegated\n" }, context("s1"));
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    assert.equal(await readFile(join(worktree.path, "new.txt"), "utf8"), "delegated\n");
    assert.equal(existsSync(join(fx.repo, "new.txt")), false, "the package root is untouched");
    assert.equal(built(), 1, "the worktree's tool set is built once");

    await write.execute({ path: "second.txt", content: "delegated\n" }, context("s1"));
    assert.equal(built(), 1, "a second call reuses the built set");
    assert.equal(existsSync(join(worktree.path, "second.txt")), true);
  });

  it("other_sessions_do_not_see_worktree_root", async () => {
    const fx = await fixture();
    const workspace = await service(fx);
    const worktree = await workspace.worktree.create({ sessionId: "s1" });
    const { instance } = routing(workspace, fx.repo);
    const write = tool(instance.tools, "write");

    await write.execute({ path: "unbound.txt", content: "root\n" }, context("s2"));
    assert.equal(await readFile(join(fx.repo, "unbound.txt"), "utf8"), "root\n");
    assert.equal(existsSync(join(worktree.path, "unbound.txt")), false);

    const targets = createCodingTargets(fx.repo, [], workspace);
    assert.deepEqual(targets("write", { path: "a.txt" }, { sessionId: "s1" })?.roots, [resolve(worktree.path)]);
    assert.deepEqual(targets("write", { path: "a.txt" }, { sessionId: "s2" })?.roots, [resolve(fx.repo)]);
    assert.deepEqual(targets("write", { path: "a.txt" })?.roots, [resolve(fx.repo)]);
    assert.equal(
      targets("write", { path: "a.txt" }, { sessionId: "s1" })?.paths[0],
      join(resolve(worktree.path), "a.txt"),
      "a relative path resolves against the bound worktree",
    );
  });

  it("bound_session_cannot_write_main_root", async () => {
    const fx = await fixture();
    const workspace = await service(fx);
    const worktree = await workspace.worktree.create({ sessionId: "s1" });
    const { instance } = routing(workspace, fx.repo);
    const targets = createCodingTargets(fx.repo, [], workspace);
    const deny = createHardDenyHook({ targets, readOnly: false });

    // The tool's own containment: `delete` resolves its target under its cwd.
    const removed = await tool(instance.tools, "delete").execute({ path: join(fx.repo, "a.txt") }, context("s1"));
    assert.match(removed.error?.message ?? "", /escapes workspace root/);
    assert.equal(existsSync(join(fx.repo, "a.txt")), true, "the main root file survives");

    // The hard-deny hook: the main root is outside the bound session's roots.
    const boundDeny = await deny(payload("s1", "write", { path: join(fx.repo, "a.txt"), content: "x" }));
    assert.equal(typeof boundDeny === "object" && "deny" in boundDeny, true, JSON.stringify(boundDeny));
    // And the worktree is outside every other session's roots.
    const otherDeny = await deny(payload("s2", "delete", { path: join(worktree.path, "a.txt") }));
    assert.equal(typeof otherDeny === "object" && "deny" in otherDeny, true, JSON.stringify(otherDeny));
    // The bound session's own worktree is inside its roots.
    assert.equal(await deny(payload("s1", "write", { path: join(worktree.path, "ok.txt"), content: "x" })), undefined);
  });

  it("git_and_check_tools_follow_the_session", async () => {
    const fx = await fixture();
    const workspace = await service(fx);
    const worktree = await workspace.worktree.create({ sessionId: "s1" });
    const create = (cwd: string): readonly ToolDefinition[] => [
      ...createCodingTools(cwd),
      ...createGitTools(cwd),
      createCodingCheckTool(cwd, { checks: { noop: { file: "/bin/true", args: [] } } }),
    ];
    const instance = createWorktreeRouting({ base: create(fx.repo), create, workspace });

    assert.ok(
      instance.tools.some((tool) => tool.name === "git_status"),
      "git tools register",
    );
    assert.ok(
      instance.tools.some((tool) => tool.name === "coding_check"),
      "coding_check registers",
    );

    const status = await tool(instance.tools, "git_status").execute({}, context("s1"));
    assert.equal(status.error, undefined, JSON.stringify(status.error));
    const text = JSON.stringify(status.content);
    assert.ok(text.includes(worktree.branch), `git runs on the worktree's branch, got ${text.slice(0, 200)}`);
  });

  it("binding_dropped_on_dispose", async () => {
    const fx = await fixture();
    const workspace = await service(fx);
    const worktree = await workspace.worktree.create({ sessionId: "s1" });
    const { instance, built } = routing(workspace, fx.repo);
    const write = tool(instance.tools, "write");

    await write.execute({ path: "in.txt", content: "worktree\n" }, context("s1"));
    assert.equal(existsSync(join(worktree.path, "in.txt")), true);
    assert.equal(built(), 1);

    await worktree.dispose({ force: true });
    assert.equal(workspace.worktree.bound("s1"), undefined, "dispose drops the binding");

    await write.execute({ path: "in.txt", content: "root\n" }, context("s1"));
    assert.equal(await readFile(join(fx.repo, "in.txt"), "utf8"), "root\n", "the session falls back to the root");
    assert.equal(built(), 1, "an unbound call builds nothing");

    const second = await workspace.worktree.create({ sessionId: "s1" });
    await write.execute({ path: "again.txt", content: "worktree\n" }, context("s1"));
    assert.equal(existsSync(join(second.path, "again.txt")), true, "a rebound session gets the new worktree");
    assert.equal(built(), 2, "a rebound session rebuilds once");

    instance.forget("s1");
    await write.execute({ path: "third.txt", content: "worktree\n" }, context("s1"));
    assert.equal(built(), 3, "forget drops the cached set");
  });

  it("registered_tools_follow_the_bound_session", async () => {
    const fx = await fixture();
    const { probe, service: read } = workspaceProbe();
    const provider = mockProvider(
      [
        [providerToolCall(toolCallContent("c1", "write", { path: "routed.txt", content: "routed\n" })), providerDone()],
        [providerTextDelta("done"), providerDone()],
      ],
      { id: "mock" },
    );
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      principal: { kind: "user", id: "routing-test" },
      ownership: { tenantId: "local" },
      hooks: (hooks) => hooks.on("tool.call", () => "allow"),
      packages: [provider, toolsCoding({ root: fx.repo, workspace: { worktreeRoot: fx.worktreeRoot } }), probe()],
    });
    try {
      const workspace = read();
      assert.ok(workspace !== undefined, "the package provided the workspace service");
      const session = await agent.session({ id: "bound-session", create: true });
      const worktree = await workspace.worktree.create({ sessionId: session.id });

      const result = await session.run("write it");
      assert.equal(result.status, "completed");
      assert.equal(await readFile(join(worktree.path, "routed.txt"), "utf8"), "routed\n");
      assert.equal(existsSync(join(fx.repo, "routed.txt")), false, "the registered tool routed to the worktree");
      await session.close();
    } finally {
      await agent.dispose();
    }
  });

  it("sandbox_binding_is_refused", async () => {
    const fx = await fixture();
    const workspace = await service(fx, { sandboxed: true });

    await assert.rejects(
      async () => await workspace.worktree.create({ sessionId: "s1" }),
      (error: unknown) => error instanceof WorkspaceServiceError && error.code === "workspace_sandbox_unsupported",
    );
    const unbound = await workspace.worktree.create();
    assert.equal(existsSync(unbound.path), true, "a worktree without a session still works");
    await unbound.dispose({ force: true });
  });

  it("sandboxed_package_refuses_the_binding", async () => {
    const fx = await fixture();
    const { probe, service: read } = workspaceProbe();
    // `e2b` has no backend here, so the package warns and falls back to local tools — and still
    // refuses the binding, because the sandbox kind is what the service records.
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsCoding({ root: fx.repo, sandbox: "e2b", workspace: { worktreeRoot: fx.worktreeRoot } }), probe()],
    });
    try {
      const workspace = read();
      assert.ok(workspace !== undefined, "the package provided the workspace service");
      await assert.rejects(
        async () => await workspace.worktree.create({ sessionId: "s1" }),
        (error: unknown) => error instanceof WorkspaceServiceError && error.code === "workspace_sandbox_unsupported",
      );
      const unbound = await workspace.worktree.create();
      await unbound.dispose({ force: true });
    } finally {
      await agent.dispose();
    }
  });
});
