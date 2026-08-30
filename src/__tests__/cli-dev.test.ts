/**
 * Plan 040 Task 4 — `prism dev` subcommand wiring in `runCli`: delegation
 * into @arnilo/prism-dev (argv passthrough), the install hint + exit code
 * when the package is absent, and the usage entry.
 */
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { describe, it } from "node:test";
import { runCli, usage } from "../cli-runner.js";

class MemoryWritable extends Writable {
  chunks: string[] = [];
  _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }
  text(): string {
    return this.chunks.join("");
  }
}

function streams() {
  return { stdin: Readable.from(""), stdout: new MemoryWritable(), stderr: new MemoryWritable() };
}

describe("prism dev subcommand (plan 040 Task 4)", () => {
  it("delegates argv to the resolved @arnilo/prism-dev cli module", async () => {
    const io = streams();
    const delegated: Array<{ argv: string[]; cwd: string | undefined }> = [];
    const code = await runCli(["dev", "--port", "4311"], {
      ...io,
      loadDevCli: async () => ({
        runDevCli: async (argv: readonly string[], runtime: { stdout: unknown; stderr: unknown; cwd?: string }) => {
          delegated.push({ argv: [...argv], cwd: runtime.cwd });
          return 7;
        },
      }),
    });
    assert.equal(code, 7);
    assert.deepEqual(delegated, [{ argv: ["--port", "4311"], cwd: undefined }]);
  });

  it("fails with the install hint when the dev package is not resolvable", async () => {
    const io = streams();
    const code = await runCli(["dev"], {
      ...io,
      loadDevCli: async () => undefined,
    });
    assert.equal(code, 2);
    assert.match(io.stderr.text(), /npm install --save-dev \S*prism-dev/);
    assert.equal(io.stdout.text(), "");
  });

  it("documents the subcommand in the usage text", () => {
    assert.match(usage, /prism dev \[--port <n>\] \[--host <addr>\]/);
  });
});
