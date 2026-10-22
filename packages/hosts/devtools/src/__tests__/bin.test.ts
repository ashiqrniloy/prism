import { describe, it, test } from "bun:test";
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { install } from "@arnilo/prism/manifest";
import { buildAgent, main } from "../../bin/prism-devtools.js";
import { DevtoolsArgsError, parseDevtoolsArgs } from "../index.js";

const FIXTURE = join(import.meta.dirname, "fixtures/mock-provider-package");
const BIN = join(import.meta.dirname, "../../bin/prism-devtools.ts");

function tmp(label: string): string {
  return mkdtempSync(join(tmpdir(), `prism-devtools-${label}-`));
}

function exitCode(child: ChildProcess): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    child.on("exit", (code) => resolve(code));
    child.on("error", reject);
  });
}

describe("parseDevtoolsArgs", () => {
  it("parses root, provider/model, trust, and port, with the loopback default port", () => {
    assert.deepEqual(parseDevtoolsArgs(["--model", "anthropic/claude-sonnet-4-5", "--trust-project"]), {
      model: { provider: "anthropic", model: "claude-sonnet-4-5" },
      trustProject: true,
      port: 4311,
    });
    assert.deepEqual(parseDevtoolsArgs(["--root", "/tmp/x", "--model", "openrouter/meta-llama/llama-3", "--port", "0"]), {
      root: "/tmp/x",
      model: { provider: "openrouter", model: "meta-llama/llama-3" },
      trustProject: false,
      port: 0,
    });
  });

  it("refuses a missing or malformed model and a bad port", () => {
    assert.throws(() => parseDevtoolsArgs([]), DevtoolsArgsError);
    assert.throws(() => parseDevtoolsArgs(["--model", "no-slash"]), DevtoolsArgsError);
    assert.throws(() => parseDevtoolsArgs(["--model", "mock/demo", "--port", "70000"]), DevtoolsArgsError);
    assert.throws(() => parseDevtoolsArgs(["--model", "mock/demo", "--bogus"]), DevtoolsArgsError);
  });
});

describe("prism-devtools bin", () => {
  test("devtools_bin_serves_manifest_agent", async () => {
    const home = tmp("serve-home");
    const root = tmp("serve-root");
    try {
      await install(`file:${FIXTURE}`, { scope: "user", home });
      const child = spawn(process.execPath, [BIN, "--root", root, "--model", "mock/demo", "--port", "0"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PRISM_HOME: home },
      });
      let stdout = "";
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const url = await new Promise<string>((resolve, reject) => {
        child.stdout.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
          const match = /→ (http:\/\/\S+)/.exec(stdout);
          if (match) resolve(match[1]!);
        });
        child.on("exit", () => reject(new Error(`bin exited before serving; stderr: ${stderr}`)));
      });
      try {
        const inspection = (await (await fetch(`${url}/api/inspect`)).json()) as { packages: Array<{ name: string }> };
        assert.ok(
          inspection.packages.some((entry) => entry.name === "@acme/mock-provider"),
          `the manifest package must load: ${JSON.stringify(inspection.packages)}`,
        );
        assert.equal((await fetch(`${url}/`)).status, 200);
      } finally {
        child.kill("SIGINT");
      }
      assert.equal(await exitCode(child), 0, `bin exited nonzero; stderr: ${stderr}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("devtools_project_scope_requires_trust", async () => {
    const home = tmp("trust-home");
    const root = tmp("trust-root");
    try {
      await install(`file:${FIXTURE}`, { scope: "project", root });
      const model = { provider: "mock", model: "demo" } as const;

      const untrusted = await buildAgent({ root, model, trustProject: false, port: 0 });
      assert.equal(untrusted.inspect().packages.length, 0, "an untrusted project manifest loads nothing");
      await untrusted.dispose();

      const trusted = await buildAgent({ root, model, trustProject: true, port: 0 });
      assert.deepEqual(
        trusted.inspect().packages.map((entry) => entry.name),
        ["@acme/mock-provider"],
      );
      await trusted.dispose();
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exits 1 on bad arguments", async () => {
    assert.equal(await main([]), 1);
  });
});
