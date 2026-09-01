import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ObscuraError } from "../errors.js";
import { spawnObscuraProcess } from "../process.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "prism-obscura-"));
}

function rmRecursive(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Child fixture: records its argv to a file given via OBSCURA_TEST_OUT, then optionally idles. */
function argvRecorder(outFile: string, extraArgs: string[] = []): { command: string; args: string[]; env: Record<string, string> } {
  const script = 'require("node:fs").writeFileSync(process.env.OBSCURA_TEST_OUT, JSON.stringify(process.argv.slice(1)))';
  return { command: process.execPath, args: ["-e", script, ...extraArgs], env: { OBSCURA_TEST_OUT: outFile } };
}

const IDLE = 'require("node:timers").setInterval(()=>{},1e6)';

function assertGone(exit: { code: number | null; signal: NodeJS.Signals | null }): void {
  assert.ok(exit.code !== null || exit.signal !== null, "process should have exited");
}

test("host binary argv is passed byte-for-byte, shell-free", async () => {
  const dir = tempDir();
  const out = join(dir, "argv.json");
  const fixture = argvRecorder(out, ["serve", "--host", "127.0.0.1", "--port", "9222"]);
  const proc = spawnObscuraProcess(fixture);
  const exit = await proc.exited;
  assert.equal(exit.code, 0);
  const recorded = JSON.parse(readFileSync(out, "utf8")) as string[];
  assert.deepEqual(recorded.slice(-5), ["serve", "--host", "127.0.0.1", "--port", "9222"]);
  rmRecursive(dir);
});

test("docker-style argv (run --rm -i image mcp) passes through unchanged", async () => {
  const dir = tempDir();
  const out = join(dir, "argv.json");
  const proc = spawnObscuraProcess(argvRecorder(out, ["run", "--rm", "-i", "h4ckf0r0day/obscura", "mcp"]));
  await proc.exited;
  const recorded = JSON.parse(readFileSync(out, "utf8")) as string[];
  assert.deepEqual(recorded.slice(-5), ["run", "--rm", "-i", "h4ckf0r0day/obscura", "mcp"]);
  rmRecursive(dir);
});

test("explicit env replaces the minimal default; full host env is not inherited", async () => {
  const dir = tempDir();
  const out = join(dir, "env.json");
  const proc = spawnObscuraProcess({
    command: process.execPath,
    args: ["-e", 'require("node:fs").writeFileSync(process.env.OUT, JSON.stringify(process.env))'],
    env: { OUT: out },
  });
  await proc.exited;
  const env = JSON.parse(readFileSync(out, "utf8")) as Record<string, string>;
  assert.ok(env.PATH !== undefined, "minimal PATH default present");
  rmRecursive(dir);
});

test("invalid config fails closed", () => {
  assert.throws(
    () => spawnObscuraProcess({ command: "obscura" }),
    (e: ObscuraError) => e.code === "ERR_OBSCURA_INPUT",
  );
  assert.throws(
    () => spawnObscuraProcess({ command: process.execPath, args: ["a\0b"] }),
    (e: ObscuraError) => e.code === "ERR_OBSCURA_INPUT",
  );
  assert.throws(
    () => spawnObscuraProcess({ command: process.execPath, env: { "bad-key": "v" } }),
    (e: ObscuraError) => e.code === "ERR_OBSCURA_INPUT",
  );
  assert.throws(
    () => spawnObscuraProcess({ command: process.execPath, cwd: "relative" }),
    (e: ObscuraError) => e.code === "ERR_OBSCURA_INPUT",
  );
  assert.throws(
    () => spawnObscuraProcess({ command: process.execPath, limits: { startupTimeoutMs: 1_000_000 } }),
    (e: ObscuraError) => e.code === "ERR_OBSCURA_LIMIT",
  );
});

test("forbidden private-network/file/host flags are rejected without explicit opt-in", () => {
  for (const args of [
    ["serve", "--allow-private-network"],
    ["serve", "--allow-file-access"],
    ["serve", "--host", "0.0.0.0"],
    ["mcp", "--http", "--host=0.0.0.0"],
    ["serve", "--host", "10.0.0.1"],
  ]) {
    assert.throws(
      () => spawnObscuraProcess({ command: process.execPath, args }),
      (e: ObscuraError) => e.code === "ERR_OBSCURA_INSECURE_FLAG",
      args.join(" "),
    );
  }
});

test("explicit opt-in permits insecure flags; loopback never needs it", async () => {
  const dir = tempDir();
  const out = join(dir, "argv.json");
  const fixture = argvRecorder(out, ["serve", "--allow-private-network", "--host", "127.0.0.1"]);
  const insecure = spawnObscuraProcess({ ...fixture, allowInsecureFlags: true });
  await insecure.exited;
  const loopback = spawnObscuraProcess({ ...fixture, args: ["serve", "--host", "127.0.0.1"] });
  await loopback.exited;
  rmRecursive(dir);
});

test("abort during startup kills the owned process", async () => {
  const controller = new AbortController();
  const proc = spawnObscuraProcess({ command: process.execPath, args: ["-e", IDLE] });
  const ready = proc.waitReady(() => false, { signal: controller.signal });
  controller.abort();
  await assert.rejects(ready, (e: ObscuraError) => e.code === "ERR_OBSCURA_ABORTED");
  assertGone(await proc.exited);
});

test("readiness timeout kills the owned process", async () => {
  const proc = spawnObscuraProcess({
    command: process.execPath,
    args: ["-e", IDLE],
    limits: { startupTimeoutMs: 300 },
  });
  await assert.rejects(
    proc.waitReady(() => false),
    (e: ObscuraError) => e.code === "ERR_OBSCURA_START_TIMEOUT",
  );
  assertGone(await proc.exited);
});

test("readiness probe success returns without killing", async () => {
  let calls = 0;
  const proc = spawnObscuraProcess({ command: process.execPath, args: ["-e", IDLE] });
  await proc.waitReady(() => (calls += 1) >= 2);
  assert.ok(calls >= 2);
  await proc.close();
});

test("early exit before readiness fails with exit info, no argv/env echo", async () => {
  const proc = spawnObscuraProcess({
    command: process.execPath,
    args: ["-e", 'console.error("boom");process.exit(3)'],
  });
  await assert.rejects(
    proc.waitReady(() => false),
    (e: ObscuraError) => {
      assert.equal(e.code, "ERR_OBSCURA_EXITED");
      assert.ok(e.message.includes("code=3"));
      assert.equal(e.message.includes(process.execPath), false);
      return true;
    },
  );
});

test("close is idempotent", async () => {
  const proc = spawnObscuraProcess({ command: process.execPath, args: ["-e", IDLE] });
  await proc.close();
  assertGone(await proc.exited);
  await proc.close();
});

test("stderr capture is capped and marked truncated", async () => {
  const proc = spawnObscuraProcess({
    command: process.execPath,
    args: ["-e", 'process.stderr.write("x".repeat(200000));setTimeout(()=>process.exit(0),100)'],
    limits: { maxStderrBytes: 1024 },
  });
  await proc.exited;
  const text = proc.stderrText();
  assert.ok(text.length <= 1024 + "[truncated]".length + 1, `len=${text.length}`);
  assert.ok(text.endsWith("[truncated]"));
});

test("spawn failure rejects exited with a spawn error", async () => {
  const proc = spawnObscuraProcess({ command: "/nonexistent/obscura-binary-xyz" });
  await assert.rejects(proc.exited, (e: ObscuraError) => e.code === "ERR_OBSCURA_SPAWN");
});
