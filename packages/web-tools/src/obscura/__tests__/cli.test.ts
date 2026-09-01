import assert from "node:assert/strict";
import test from "node:test";
import { runObscuraCli, validateObscuraWebUrl } from "../cli.js";
import { ObscuraError } from "../errors.js";
import { resolveObscuraWebLimits } from "../limits.js";
import { fakeObscuraCliPath } from "./fake-cli.js";

const EXEC = process.execPath;
const FAKE = fakeObscuraCliPath();
const BASE = { command: EXEC, argsBefore: [FAKE] } as const;

test("runs a bounded CLI operation and captures capped output", async () => {
  const result = await runObscuraCli({ ...BASE, args: ["fetch", "https://example.com", "--dump", "markdown"] });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /# Example/);
  assert.equal(result.truncated, false);
});

test("nonzero exit fails closed with redacted diagnostics (no argv echo)", async () => {
  await assert.rejects(
    runObscuraCli({ ...BASE, args: ["fetch", "https://example.com"], env: { OBSCURA_FAKE: "exit" } }),
    (error: ObscuraError) => {
      assert.equal(error.code, "ERR_OBSCURA_CLI");
      assert.match(error.message, /code 3/);
      assert.match(error.message, /simulated failure/);
      assert.ok(!error.message.includes("fetch"), "argv must never appear in diagnostics");
      return true;
    },
  );
});

test("timeout kills the child", async () => {
  await assert.rejects(
    runObscuraCli({ ...BASE, args: ["fetch", "https://example.com"], env: { OBSCURA_FAKE: "hang" }, timeoutMs: 150 }),
    (error: ObscuraError) => {
      assert.equal(error.code, "ERR_OBSCURA_TIMEOUT");
      return true;
    },
  );
});

test("abort kills the child", async () => {
  const controller = new AbortController();
  const pending = runObscuraCli({
    ...BASE,
    args: ["fetch", "https://example.com"],
    env: { OBSCURA_FAKE: "hang" },
    signal: controller.signal,
    timeoutMs: 5000,
  });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, (error: ObscuraError) => error.code === "ERR_OBSCURA_ABORTED");
});

test("oversize stdout is flagged truncated", async () => {
  const result = await runObscuraCli({
    ...BASE,
    args: ["fetch", "https://example.com"],
    env: { OBSCURA_FAKE: "oversize" },
    maxOutputBytes: 1024,
  });
  assert.equal(result.truncated, true);
  assert.equal(result.stdout.length, 1024);
});

test("spawn failure fails closed", async () => {
  await assert.rejects(
    runObscuraCli({ command: "/nonexistent/obscura-binary-path", args: ["fetch", "https://example.com"] }),
    (error: ObscuraError) => error.code === "ERR_OBSCURA_SPAWN",
  );
});

test("url validation rejects private, credentialed, and non-HTTP targets; allows public https", () => {
  assert.throws(() => validateObscuraWebUrl("http://127.0.0.1:9222/x"), /ssrf|denied/i);
  assert.throws(() => validateObscuraWebUrl("http://user:pass@example.com/"), /public HTTP/);
  assert.throws(() => validateObscuraWebUrl("file:///etc/passwd"), /public HTTP/);
  assert.equal(validateObscuraWebUrl("https://example.com/page"), "https://example.com/page");
});

test("web limits resolve within hard ceilings and reject out-of-range values", () => {
  const limits = resolveObscuraWebLimits({ maxResults: 5, timeoutMs: 5000 });
  assert.equal(limits.maxResults, 5);
  assert.equal(limits.maxConcurrency, 5);
  assert.throws(() => resolveObscuraWebLimits({ maxResults: 0 }), /out of range/);
  assert.throws(() => resolveObscuraWebLimits({ timeoutMs: 999_000 }), /out of range/);
  assert.throws(() => resolveObscuraWebLimits({ maxConcurrency: 999 }), /out of range/);
});
