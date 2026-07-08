import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { expandPath, pathExists, resolveReadPath, resolveToCwd } from "../path-utils.js";

test("expandPath: ~ expands to homedir, @ stripped", () => {
  assert.equal(expandPath("~"), homedir());
  assert.equal(expandPath("~/x"), join(homedir(), "x"));
  assert.equal(expandPath("@foo"), "foo");
});

test("resolveToCwd: relative joins cwd, absolute preserved", () => {
  const cwd = "/tmp/somecwd";
  assert.equal(resolveToCwd("a/b", cwd), join(cwd, "a/b"));
  const abs = resolveToCwd("/abs/path", cwd);
  assert.equal(abs, "/abs/path");
  assert.ok(isAbsolute(abs));
});

test("resolveToCwd: ~/ resolves under homedir", () => {
  const cwd = "/tmp";
  assert.equal(resolveToCwd("~/proj", cwd), join(homedir(), "proj"));
});

test("pathExists: existing vs missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pu-"));
  try {
    const f = join(dir, "exists.txt");
    await writeFile(f, "x", "utf-8");
    assert.equal(await pathExists(f), true);
    assert.equal(await pathExists(join(dir, "missing.txt")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveReadPath: returns resolved path for existing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pu-"));
  try {
    const f = join(dir, "read.txt");
    await writeFile(f, "x", "utf-8");
    assert.equal(resolveReadPath("read.txt", dir), f);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
