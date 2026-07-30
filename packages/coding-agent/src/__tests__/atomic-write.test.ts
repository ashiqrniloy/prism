import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { atomicWriteUtf8File } from "../atomic-write.js";

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "atomic-write-"));
}

test("atomicWriteUtf8File replaces target and leaves no temp file", async () => {
  const cwd = await tmp();
  try {
    const target = join(cwd, "f.txt");
    await writeFile(target, "old");
    await atomicWriteUtf8File(target, "new");
    assert.equal(await readFile(target, "utf-8"), "new");
    const names = await readdir(cwd);
    assert.ok(!names.some((n) => n.startsWith(".prism-write-")));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("atomicWriteUtf8File cleans up temp when rename fails", async () => {
  const cwd = await tmp();
  try {
    const target = join(cwd, "f.txt");
    await mkdir(target, { recursive: true });
    await assert.rejects(() => atomicWriteUtf8File(target, "new"));
    const names = await readdir(cwd);
    assert.ok(!names.some((n) => n.startsWith(".prism-write-")));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("atomicWriteUtf8File abort before rename leaves target unchanged", async () => {
  const cwd = await tmp();
  try {
    const target = join(cwd, "f.txt");
    await writeFile(target, "original");
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(() => atomicWriteUtf8File(target, "new", { signal: ac.signal }), /aborted/i);
    assert.equal(await readFile(target, "utf-8"), "original");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
