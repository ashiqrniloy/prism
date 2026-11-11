/**
 * Plan 162 Task 4 — `prism dev` is retired from the kernel CLI. The dev inspector is the
 * `@arnilo/prism-hosts/devtools` host library and its own bin; the kernel names no host package.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import { manifestUsage, runManifestCommand } from "../cli-manifest.js";

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

describe("kernel_cli_has_no_dev_command (plan 162 Task 4)", () => {
  it("rejects `prism dev` as an unknown argument with exit 2 and the usage text", async () => {
    const io = streams();
    const code = await runManifestCommand(["dev", "--port", "4311"], io);
    assert.equal(code, 2);
    assert.match(io.stderr.text(), /Unknown command: dev/);
    assert.equal(io.stdout.text(), "");
  });

  it("does not document a dev subcommand in the usage text", () => {
    assert.doesNotMatch(manifestUsage, /prism dev/);
    assert.doesNotMatch(manifestUsage, /prism-dev|prism-devtools/);
  });
});
