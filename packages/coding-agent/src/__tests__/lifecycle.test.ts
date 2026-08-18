/**
 * Phase 10 Task 1 — consumer-gated coding lifecycle events.
 * Covers emitter delivery/caps, producer wiring (write/edit/move/delete/
 * git_worktree), process passthrough, and the frozen deferred-kind guard.
 * Frozen shapes mirror scripts/phase10-freeze-manifest.json lifecycle module.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExecutionPolicy, ToolExecutionContext } from "@arnilo/prism";
import { SAFE_GIT_CONFIG_ARGS, SAFE_GIT_ENV } from "../git-exec.js";
import {
  CodingLifecycleError,
  type CodingLifecycleEvent,
  createCodingLifecycleEmitter,
  createDeleteTool,
  createEditTool,
  createGitWorktreeTool,
  createMoveTool,
  createWriteTool,
} from "../index.js";

let counter = 0;
function ctx(signal?: AbortSignal): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}`, signal };
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "prism-lifecycle-"));
}

const denyPolicy: ExecutionPolicy = {
  check: () => ({ allowed: false, reason: "blocked by test policy" }),
};

function collect(): { events: CodingLifecycleEvent[]; emitter: ReturnType<typeof createCodingLifecycleEmitter> } {
  const events: CodingLifecycleEvent[] = [];
  const emitter = createCodingLifecycleEmitter({ onEvent: (event) => events.push(event) });
  return { events, emitter };
}

test("emitter delivers to listeners and returns false without listeners", () => {
  const emitter = createCodingLifecycleEmitter();
  assert.equal(emitter.emit({ type: "permission_denied", reason: "r", toolName: "write", toolCallId: "tc" }), false);
  const seen: CodingLifecycleEvent[] = [];
  const off = emitter.on((event) => seen.push(event));
  const event: CodingLifecycleEvent = { type: "configuration_changed", keys: ["mode"] };
  assert.equal(emitter.emit(event), true);
  off();
  assert.equal(emitter.emit(event), false);
  assert.deepEqual(seen, [event]);
});

test("emitter drops unknown (deferred) kinds and oversized events without throwing", () => {
  const { events, emitter } = collect();
  // Deferred kinds must be dropped at runtime: check_started/finished, task_*,
  // compaction_*, subagent_* (scripts/phase10-freeze-manifest.json deferredEvents).
  for (const type of [
    "check_started",
    "check_finished",
    "task_created",
    "task_completed",
    "compaction_started",
    "compaction_finished",
    "subagent_started",
    "subagent_stopped",
  ]) {
    assert.equal(emitter.emit({ type } as CodingLifecycleEvent), false, type);
  }
  assert.equal(
    emitter.emit({ type: "file_changed", path: "x".repeat(17 * 1024), op: "write" } as CodingLifecycleEvent),
    false,
    "oversized path",
  );
  assert.equal(
    emitter.emit({ type: "permission_denied", reason: "x".repeat(2 * 1024), toolName: "write" } as CodingLifecycleEvent),
    false,
    "oversized reason",
  );
  assert.equal(
    emitter.emit({ type: "configuration_changed", keys: Array.from({ length: 65 }, (_, i) => `k${i}`) } as CodingLifecycleEvent),
    false,
    "oversized config keys",
  );
  assert.equal(
    emitter.emit({ type: "file_changed", path: "ok", op: "write", toolCallId: "x".repeat(20 * 1024) } as CodingLifecycleEvent),
    false,
    "oversized event",
  );
  assert.equal(events.length, 0);
});

test("invalid limits fail closed with ERR_PRISM_LIFECYCLE_LIMIT", () => {
  for (const limits of [{ maxEventBytes: 0 }, { maxPathBytes: 10 ** 9 }, { maxConfigKeys: -1 }]) {
    assert.throws(
      () => createCodingLifecycleEmitter({ limits }),
      (error: unknown) => {
        assert.ok(error instanceof CodingLifecycleError);
        assert.equal((error as CodingLifecycleError).code, "ERR_PRISM_LIFECYCLE_LIMIT");
        return true;
      },
    );
  }
});

test("process events pass through the emitter (reused CodingProcessEvent union)", () => {
  const { events, emitter } = collect();
  const event: CodingLifecycleEvent = {
    type: "process_started",
    sessionId: "s1",
    processId: "p1",
    owner: "tenant:user",
    at: new Date().toISOString(),
  };
  assert.equal(emitter.emit(event), true);
  assert.deepEqual(events, [event]);
});

test("plan_changed and plan_removed pass through the emitter (F5)", () => {
  const { events, emitter } = collect();
  const changed: CodingLifecycleEvent = {
    type: "plan_changed",
    planPath: "plans/task-1.md",
    todos: [{ id: "check-1", text: "run check-1", done: true }],
  };
  const removed: CodingLifecycleEvent = { type: "plan_removed", planPath: "plans/task-1.md" };
  assert.equal(emitter.emit(changed), true);
  assert.equal(emitter.emit(removed), true);
  assert.deepEqual(events, [changed, removed]);
});

test("write tool emits file_changed on success and permission_denied on policy denial", async () => {
  const cwd = await tmp();
  try {
    const { events, emitter } = collect();
    const writeId = `tc-${counter}`;
    const tool = createWriteTool(cwd, { onEvent: (e) => emitter.emit(e) });
    const result = await tool.execute({ path: "out.txt", content: "hello" }, ctx());
    assert.equal(result.error, undefined);
    assert.deepEqual(events, [{ type: "file_changed", path: join(cwd, "out.txt"), op: "write", toolCallId: writeId }]);

    const deniedId = `tc-${counter}`;
    const denied = createWriteTool(cwd, { executionPolicy: denyPolicy, onEvent: (e) => emitter.emit(e) });
    const deniedResult = await denied.execute({ path: "no.txt", content: "x" }, ctx());
    assert.ok(deniedResult.error);
    assert.deepEqual(events.at(-1), {
      type: "permission_denied",
      toolCallId: deniedId,
      toolName: "write",
      reason: "blocked by test policy",
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("edit tool emits file_changed with op edit", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "a.txt"), "one\ntwo\n");
    const { events, emitter } = collect();
    const editId = `tc-${counter}`;
    const tool = createEditTool(cwd, { onEvent: (e) => emitter.emit(e) });
    const result = await tool.execute({ path: "a.txt", edits: [{ oldText: "one", newText: "uno" }] }, ctx());
    assert.equal(result.error, undefined);
    assert.deepEqual(events, [{ type: "file_changed", path: join(cwd, "a.txt"), op: "edit", toolCallId: editId }]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("move tool emits file_changed with op move at destination path", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "from.txt"), "x");
    const { events, emitter } = collect();
    const moveId = `tc-${counter}`;
    const tool = createMoveTool(cwd, { onEvent: (e) => emitter.emit(e) });
    const result = await tool.execute({ from: "from.txt", to: "to.txt" }, ctx());
    assert.equal(result.error, undefined);
    assert.deepEqual(events, [{ type: "file_changed", path: join(cwd, "to.txt"), op: "move", toolCallId: moveId }]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("delete tool emits file_changed with op delete", async () => {
  const cwd = await tmp();
  try {
    await writeFile(join(cwd, "gone.txt"), "x");
    const { events, emitter } = collect();
    const deleteId = `tc-${counter}`;
    const tool = createDeleteTool(cwd, { onEvent: (e) => emitter.emit(e) });
    const result = await tool.execute({ path: "gone.txt" }, ctx());
    assert.equal(result.error, undefined);
    assert.deepEqual(events, [{ type: "file_changed", path: join(cwd, "gone.txt"), op: "delete", toolCallId: deleteId }]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("git_worktree emits worktree_changed on add and remove, list emits nothing", async () => {
  const cwd = await tmp();
  try {
    const run = (args: string[]): string => {
      const result = spawnSync("/usr/bin/git", [...SAFE_GIT_CONFIG_ARGS, ...args], {
        cwd,
        env: {
          ...SAFE_GIT_ENV,
          GIT_AUTHOR_NAME: "Prism",
          GIT_AUTHOR_EMAIL: "prism@example.com",
          GIT_COMMITTER_NAME: "Prism",
          GIT_COMMITTER_EMAIL: "prism@example.com",
        },
        encoding: "utf8",
      });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
      return result.stdout;
    };
    run(["init"]);
    run(["checkout", "-b", "main"]);
    await writeFile(join(cwd, "README.md"), "# root\n");
    run(["add", "--", "README.md"]);
    run(["commit", "-m", "initial"]);

    const { events, emitter } = collect();
    const tool = createGitWorktreeTool(cwd, { onEvent: (e) => emitter.emit(e) });

    const listed = await tool.execute({ action: "list" }, ctx());
    assert.equal(listed.error, undefined);
    assert.equal(events.length, 0, "list must not emit");

    const addId = `tc-${counter}`;
    const added = await tool.execute({ action: "add", path: join(cwd, "wt") }, ctx());
    assert.equal(added.error, undefined);
    assert.deepEqual(events.at(-1), { type: "worktree_changed", action: "add", path: join(cwd, "wt"), toolCallId: addId });

    const removeId = `tc-${counter}`;
    const removed = await tool.execute({ action: "remove", path: join(cwd, "wt") }, ctx());
    assert.equal(removed.error, undefined);
    assert.deepEqual(events.at(-1), { type: "worktree_changed", action: "remove", path: join(cwd, "wt"), toolCallId: removeId });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("permission_denied events never carry raw tool arguments", async () => {
  const cwd = await tmp();
  try {
    const { events, emitter } = collect();
    const tool = createWriteTool(cwd, { executionPolicy: denyPolicy, onEvent: (e) => emitter.emit(e) });
    await tool.execute({ path: "secret.txt", content: "TOP-SECRET-BODY" }, ctx());
    const denied = events.at(-1) as { type: string };
    assert.equal(denied?.type, "permission_denied");
    const json = JSON.stringify(denied);
    assert.ok(!json.includes("TOP-SECRET-BODY"), "content must not leak");
    for (const key of ["args", "content", "metadata", "path"]) {
      assert.ok(!(key in denied), `${key} must not appear on permission_denied`);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("frozen shipped event kinds match the freeze manifest lifecycle list", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(new URL("../../../../scripts/phase10-freeze-manifest.json", import.meta.url), "utf8"));
  const frozen = new Set(manifest.packages["@arnilo/prism-coding-agent"].modules.lifecycle.events as string[]);
  // The emitter accepts the six CodingProcessEvent kinds (reused union) plus the six shipped kinds.
  const accepted = [
    "process_started",
    "process_exited",
    "process_killed",
    "process_released",
    "process_expired",
    "process_unknown",
    "file_changed",
    "worktree_changed",
    "permission_denied",
    "configuration_changed",
    "plan_changed",
    "plan_removed",
  ];
  assert.ok(
    [...frozen].every((t) => accepted.includes(t)),
    "every frozen event must be accepted by the emitter",
  );
  // Deferred kinds stay out of the shipped set.
  for (const deferred of manifest.packages["@arnilo/prism-coding-agent"].modules.lifecycle.deferredEvents as string[]) {
    assert.ok(!frozen.has(deferred), deferred);
  }
});
