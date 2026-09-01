/**
 * Plan 040 Task 4 — `prism-dev` bin / `runDevCli`: boots the inspector over
 * the current prism-init scaffold's agent (dist/agent.js → createAppAgent),
 * prints the loopback URL, stays start-to-listen under 1s, refuses
 * non-loopback hosts (fail-closed), and closes on abort/SIGINT.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runDevCli } from "../cli.js";

const SCRATCH_ROOT = join(dirname(fileURLToPath(import.meta.url)), ".tmp-cli-scratch");

function scratchProject(): { cwd: string; entry: string } {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  const cwd = mkdtempSync(join(SCRATCH_ROOT, "scaffold-"));
  // Mimic the prism-init scaffold contract: dist/agent.js → createAppAgent().
  mkdirSync(join(cwd, "dist"), { recursive: true });
  const entry = join(cwd, "dist", "agent.js");
  writeFileSync(
    entry,
    `import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
export function createAppAgent() {
  return createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerTextDelta("Hi from dev"), providerDone()]),
  });
}
`,
  );
  return { cwd, entry };
}

class Capture extends Writable {
  chunks: string[] = [];
  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }
  get text(): string {
    return this.chunks.join("");
  }
  waitFor(predicate: (text: string) => boolean, timeoutMs = 2000): Promise<string> {
    if (predicate(this.text)) return Promise.resolve(this.text);
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (predicate(this.text)) {
          clearInterval(timer);
          resolve(this.text);
        } else if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          reject(new Error(`timeout waiting for output: ${this.text}`));
        }
      }, 10);
    });
  }
}

describe("prism dev CLI (plan 040 Task 4)", () => {
  const scratchDirs: string[] = [];
  after(() => {
    rmSync(SCRATCH_ROOT, { recursive: true, force: true });
  });

  function project(): string {
    const { cwd } = scratchProject();
    scratchDirs.push(cwd);
    return cwd;
  }

  it("boots the scaffold agent, prints a loopback URL under 1s, and closes on abort", async () => {
    const cwd = project();
    const stdout = new Capture();
    const stderr = new Capture();
    const controller = new AbortController();
    const started = performance.now();
    const exit = runDevCli(["--port", "0"], { stdout, stderr, cwd, signal: controller.signal });
    const banner = await stdout.waitFor((text) => /prism dev → http:\/\/127\.0\.0\.1:\d+\//.test(text));
    const listenMs = performance.now() - started;
    assert.ok(listenMs < 1000, `start-to-listen took ${listenMs}ms`);

    const url = banner.match(/prism dev → (http:\/\/127\.0\.0\.1:\d+)\//)?.[1];
    assert.ok(url, `no URL printed: ${banner}`);
    const config = await fetch(`${url}/config`);
    assert.equal(config.status, 200);
    assert.deepEqual(await config.json(), { basePath: "/prism", agentId: "default" });

    controller.abort();
    const code = await exit;
    assert.ok(performance.now() - started < 2000, "abort did not close the inspector in bounded time");
    assert.equal(code, 0, stderr.text);
    await assert.rejects(fetch(`${url}/config`), "inspector still listening after abort");
  });

  it("refuses a non-loopback host before binding (fail closed, exits 1)", async () => {
    const cwd = project();
    const stdout = new Capture();
    const stderr = new Capture();
    const code = await runDevCli(["--host", "0.0.0.0", "--port", "0"], { stdout, stderr, cwd });
    assert.equal(code, 1);
    assert.match(stderr.text, /non-loopback|loopback/i);
    assert.doesNotMatch(stdout.text, /prism dev →/);
  });

  it("fails fast with guidance when the scaffold is missing or not built", async () => {
    const cwd = project();
    rmSync(join(cwd, "dist"), { recursive: true, force: true });
    const stdout = new Capture();
    const stderr = new Capture();
    const code = await runDevCli([], { stdout, stderr, cwd });
    assert.equal(code, 2);
    assert.match(stderr.text, /cannot load .*dist[\\/]agent\.js.*build/i);
  });

  it("arg validation: help, unknown flags, bad ports", async () => {
    const stdout = new Capture();
    const stderr = new Capture();
    const cwd = project();
    assert.equal(await runDevCli(["--help"], { stdout, stderr, cwd }), 0);
    assert.match(stdout.text, /Usage: prism-dev/);

    assert.equal(await runDevCli(["--wat"], { stdout: new Capture(), stderr, cwd }), 2);
    assert.match(stderr.text, /unknown argument --wat/);

    assert.equal(await runDevCli(["--port", "99999"], { stdout: new Capture(), stderr, cwd }), 2);
    assert.match(stderr.text, /--port requires an integer/);
  });
});
