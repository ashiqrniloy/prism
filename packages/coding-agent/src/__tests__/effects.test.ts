import assert from "node:assert/strict";
import { mkdtemp, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { JsonObject, ToolDefinition } from "@arnilo/prism";
import { createCodingTools, createGitTools, reconcileCodingToolEffect } from "../index.js";

function effect(tool: ToolDefinition, args: JsonObject = {}) {
  return typeof tool.effect === "function" ? tool.effect(args, { sessionId: "s", runId: "r", toolCallId: "c" }) : tool.effect;
}

function record(toolName: string) {
  return { toolCallId: "call-1", toolName };
}

test("coding and Git tools declare conservative effect metadata", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "coding-effects-"));
  try {
    const tools = new Map(createCodingTools(cwd).map((tool) => [tool.name, tool]));
    for (const name of ["read", "repo_list", "repo_search", "glob"]) {
      assert.deepEqual(effect(tools.get(name)!), { kind: "none", idempotency: "none" });
    }
    for (const name of ["write", "edit", "delete", "move"]) {
      assert.deepEqual(effect(tools.get(name)!), { kind: "local_mutation", idempotency: "optional" });
    }
    assert.deepEqual(effect(tools.get("shell")!), { kind: "external_mutation", idempotency: "unsupported" });

    const git = new Map(createGitTools(cwd).map((tool) => [tool.name, tool]));
    assert.deepEqual(effect(git.get("git_branch")!, { action: "list" }), { kind: "none", idempotency: "none" });
    assert.deepEqual(effect(git.get("git_branch")!, { action: "create" }), { kind: "local_mutation", idempotency: "optional" });
    assert.deepEqual(effect(git.get("git_apply")!, { action: "check" }), { kind: "none", idempotency: "none" });
    assert.deepEqual(effect(git.get("git_apply")!, { action: "apply" }), { kind: "local_mutation", idempotency: "optional" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("coding reconciliation proves only exact write/delete/move postconditions", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "coding-reconcile-"));
  try {
    await writeFile(join(cwd, "write.txt"), "exact");
    const write = await reconcileCodingToolEffect({ cwd, record: record("write"), args: { path: "write.txt", content: "exact" } });
    assert.equal(write.status, "completed");
    assert.equal(write.status === "completed" && write.result.value && (write.result.value as { reconciled?: boolean }).reconciled, true);
    assert.deepEqual(await reconcileCodingToolEffect({ cwd, record: record("write"), args: { path: "write.txt", content: "different" } }), {
      status: "unknown",
    });

    const deleted = join(cwd, "deleted.txt");
    await writeFile(deleted, "gone");
    await unlink(deleted);
    assert.equal((await reconcileCodingToolEffect({ cwd, record: record("delete"), args: { path: "deleted.txt" } })).status, "completed");

    const from = join(cwd, "from.txt");
    const to = join(cwd, "to.txt");
    await writeFile(from, "moved");
    await rename(from, to);
    assert.equal(
      (await reconcileCodingToolEffect({ cwd, record: record("move"), args: { from: "from.txt", to: "to.txt" } })).status,
      "completed",
    );
    assert.deepEqual(await reconcileCodingToolEffect({ cwd, record: record("edit"), args: { path: "to.txt", edits: [] } }), {
      status: "unknown",
    });
    assert.deepEqual(await reconcileCodingToolEffect({ cwd, record: record("write"), args: { path: "../escape.txt", content: "x" } }), {
      status: "unknown",
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
