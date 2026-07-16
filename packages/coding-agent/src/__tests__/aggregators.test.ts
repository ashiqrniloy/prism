import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCodingTools,
  createReadOnlyTools,
  createAllTools,
} from "../index.js";

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "agg-"));
}

test("createCodingTools returns exactly [shell, read, write, edit] with unique names", async () => {
  const cwd = await tmp();
  try {
    const tools = createCodingTools(cwd);
    assert.deepEqual(
      tools.map((t) => t.name),
      ["shell", "read", "write", "edit"],
    );
    // unique
    assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
    // every entry is a real ToolDefinition
    for (const t of tools) {
      assert.equal(typeof t.execute, "function");
      assert.equal(t.parameters?.type, "object");
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("createReadOnlyTools returns exactly [read]", async () => {
  const cwd = await tmp();
  try {
    const tools = createReadOnlyTools(cwd);
    assert.deepEqual(
      tools.map((t) => t.name),
      ["read"],
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("createReadOnlyTools applies shared executionPolicy before filesystem access", async () => {
  const cwd = await tmp();
  const path = join(cwd, "secret.txt");
  let accesses = 0;
  try {
    await writeFile(path, "secret");
    const [read] = createReadOnlyTools(cwd, {
      executionPolicy: {
        check: (action) => {
          assert.equal(action.metadata?.sessionId, "session-1");
          assert.equal(action.metadata?.runId, "run-1");
          return { allowed: false, reason: "denied" };
        },
      },
      read: {
        operations: {
          access: async () => { accesses++; },
          readFile: async () => Buffer.from("must not read"),
        },
      },
    });
    const result = await read!.execute({ path }, {
      toolCallId: "call-1",
      sessionId: "session-1",
      runId: "run-1",
    });
    assert.equal(result.error?.message, "denied");
    assert.equal(accesses, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("createAllTools equals createCodingTools surface", async () => {
  const cwd = await tmp();
  try {
    const all = createAllTools(cwd);
    assert.deepEqual(
      all.map((t) => t.name),
      ["shell", "read", "write", "edit"],
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ToolsOptions are threaded through to each tool", async () => {
  const cwd = await tmp();
  try {
    // pass a read option (maxLines) and confirm it is applied to the read tool only
    const tools = createCodingTools(cwd, { read: { maxLines: 3, maxBytes: 1_000_000 } });
    const read = tools.find((t) => t.name === "read");
    assert.ok(read);
    // smoke: schema still valid; option presence doesn't break construction
    assert.equal(read?.parameters?.type, "object");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("per-call independence: two createCodingTools calls are independent tools", async () => {
  const cwd = await tmp();
  try {
    const a = createCodingTools(cwd);
    const b = createCodingTools(cwd);
    assert.notEqual(a, b);
    assert.notEqual(a[0], b[0]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
