import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ToolExecutionContext } from "@arnilo/prism";
import { createEditTool } from "../edit.js";
import { createReadTool } from "../read.js";
import { createReadPathSet } from "../read-path-set.js";
import { createWriteTool } from "../write.js";

let counter = 0;
function ctx(): ToolExecutionContext {
  return { sessionId: "s", runId: "r", toolCallId: `tc-${counter++}` };
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "rbw-"));
}

const rbw = { requireReadBeforeWrite: true } as const;

test("write refuses unread path when requireReadBeforeWrite is enabled", async () => {
  const cwd = await tmp();
  const readPaths = createReadPathSet();
  try {
    const write = createWriteTool(cwd, { ...rbw, readPathSet: readPaths });
    const result = await write.execute({ path: "new.txt", content: "hi" }, ctx());
    assert.equal(result.error?.message, "Refusing write to new.txt: not read in this session. Read first or pass force=true.");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("write allowed after read records path", async () => {
  const cwd = await tmp();
  const readPaths = createReadPathSet();
  try {
    const path = "note.txt";
    await writeFile(join(cwd, path), "old\n");
    const read = createReadTool(cwd, { readPathSet: readPaths });
    const write = createWriteTool(cwd, { ...rbw, readPathSet: readPaths });

    const readResult = await read.execute({ path }, ctx());
    assert.equal(readResult.error, undefined);

    const writeResult = await write.execute({ path, content: "new\n" }, ctx());
    assert.equal(writeResult.error, undefined);
    assert.match(
      String(writeResult.content?.[0] && writeResult.content[0].type === "text" ? writeResult.content[0].text : ""),
      /Successfully wrote/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("write force bypasses read-before-write guard", async () => {
  const cwd = await tmp();
  const readPaths = createReadPathSet();
  try {
    const write = createWriteTool(cwd, { ...rbw, readPathSet: readPaths });
    const result = await write.execute({ path: "forced.txt", content: "ok", force: true }, ctx());
    assert.equal(result.error, undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("edit refuses unread path when requireReadBeforeWrite is enabled", async () => {
  const cwd = await tmp();
  const readPaths = createReadPathSet();
  try {
    await writeFile(join(cwd, "a.txt"), "alpha\n");
    const edit = createEditTool(cwd, { ...rbw, readPathSet: readPaths });
    const result = await edit.execute({ path: "a.txt", edits: [{ oldText: "alpha", newText: "beta" }] }, ctx());
    assert.equal(result.error?.message, "Refusing edit to a.txt: not read in this session. Read first or pass force=true.");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("edit allowed after read", async () => {
  const cwd = await tmp();
  const readPaths = createReadPathSet();
  try {
    const path = "a.txt";
    await writeFile(join(cwd, path), "alpha\n");
    const read = createReadTool(cwd, { readPathSet: readPaths });
    const edit = createEditTool(cwd, { ...rbw, readPathSet: readPaths });

    assert.equal((await read.execute({ path }, ctx())).error, undefined);
    const result = await edit.execute({ path, edits: [{ oldText: "alpha", newText: "beta" }] }, ctx());
    assert.equal(result.error, undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("separate ReadPathSet instances do not share state", async () => {
  const cwd = await tmp();
  const setA = createReadPathSet();
  const setB = createReadPathSet();
  try {
    const path = "shared.txt";
    await writeFile(join(cwd, path), "x\n");
    const read = createReadTool(cwd, { readPathSet: setA });
    const write = createWriteTool(cwd, { ...rbw, readPathSet: setB });

    assert.equal((await read.execute({ path }, ctx())).error, undefined);
    const result = await write.execute({ path, content: "y\n" }, ctx());
    assert.ok(result.error?.message?.includes("not read in this session"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("requireReadBeforeWrite disabled skips guard", async () => {
  const cwd = await tmp();
  const readPaths = createReadPathSet();
  try {
    const write = createWriteTool(cwd, { readPathSet: readPaths });
    const result = await write.execute({ path: "free.txt", content: "ok" }, ctx());
    assert.equal(result.error, undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("failed read does not mark path", async () => {
  const cwd = await tmp();
  const readPaths = createReadPathSet();
  try {
    const read = createReadTool(cwd, { readPathSet: readPaths });
    const write = createWriteTool(cwd, { ...rbw, readPathSet: readPaths });

    const readResult = await read.execute({ path: "missing.txt" }, ctx());
    assert.ok(readResult.error);

    const writeResult = await write.execute({ path: "missing.txt", content: "new" }, ctx());
    assert.ok(writeResult.error?.message?.includes("not read in this session"));
    assert.deepEqual(readPaths.list(), []);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("policy-denied read does not mark path", async () => {
  const cwd = await tmp();
  const readPaths = createReadPathSet();
  try {
    await writeFile(join(cwd, "secret.txt"), "secret\n");
    const read = createReadTool(cwd, {
      readPathSet: readPaths,
      executionPolicy: { check: () => ({ allowed: false, reason: "denied" }) },
    });
    const write = createWriteTool(cwd, { ...rbw, readPathSet: readPaths });

    const readResult = await read.execute({ path: "secret.txt" }, ctx());
    assert.equal(readResult.error?.message, "denied");

    const writeResult = await write.execute({ path: "secret.txt", content: "x" }, ctx());
    assert.ok(writeResult.error?.message?.includes("not read in this session"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("image read marks path for write", async () => {
  const cwd = await tmp();
  const readPaths = createReadPathSet();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  try {
    await writeFile(join(cwd, "pixel.png"), png);
    const read = createReadTool(cwd, { readPathSet: readPaths });
    const write = createWriteTool(cwd, { ...rbw, readPathSet: readPaths });

    const readResult = await read.execute({ path: "pixel.png" }, ctx());
    assert.equal(readResult.error, undefined);

    const writeResult = await write.execute({ path: "pixel.png", content: "not a png" }, ctx());
    assert.equal(writeResult.error, undefined);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
