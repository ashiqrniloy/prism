import { Readable, Writable } from "node:stream";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAgent, createMockProvider, providerDone } from "../index.js";
import { parseCliArgs, runCli } from "../cli-runner.js";
import type { CliOptions } from "../cli-runner.js";
import type { AgentSession, ProviderRequest } from "../contracts.js";

class MemoryWritable extends Writable {
  chunks: string[] = [];
  _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }
  text(): string { return this.chunks.join(""); }
}
function streams(input = "") {
  return { stdin: Readable.from(input), stdout: new MemoryWritable(), stderr: new MemoryWritable() };
}
async function makeRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-cli-inj-${prefix}-`));
}
async function writeFileDeep(path: string, text: string): Promise<void> {
  await mkdir(path.split("/").slice(0, -1).join("/"), { recursive: true });
  await writeFile(path, text, "utf8");
}
function capturingSession(captured: ProviderRequest[]): (options: CliOptions) => AgentSession {
  return (_options) => {
    const provider = createMockProvider([{ type: "done" }], {
      onRequest: (req) => { captured.push(req); },
    });
    return createAgent({ model: { provider: "mock", model: "m" }, provider }).createSession();
  };
}
function textOf(request: ProviderRequest): string {
  return request.messages
    .flatMap((m) => (Array.isArray(m.content) ? m.content : [m.content]))
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

describe("cli instruction-injector flags (Phase 30 Task 8)", () => {
  it("parses --instruction and --injector-file (repeatable)", () => {
    const parsed = parseCliArgs(["--instruction", "json-always", "--instruction", "schema", "--injector-file", "/a.md", "-p", "Hi"]);
    assert.deepEqual([...parsed.instructions], ["json-always", "schema"]);
    assert.deepEqual([...parsed.injectorFiles], ["/a.md"]);
  });

  it("--instruction <name> with a discovered injector reaches the provider input", async () => {
    const root = await makeRoot("named");
    await writeFileDeep(`${root}/.agents/instructions/json-always/manifest.json`, JSON.stringify({ name: "json-always", resource: "./INSTRUCTIONS.md" }));
    await writeFileDeep(`${root}/.agents/instructions/json-always/INSTRUCTIONS.md`, "Always answer in JSON");
    const captured: ProviderRequest[] = [];
    const io = streams();

    const code = await runCli(["--discover", "--discover-kinds", "instructions", "--instruction", "json-always", "-p", "Hi", "--provider", "mock"], {
      ...io,
      workspaceRoot: root,
      createSession: capturingSession(captured),
    });

    assert.equal(code, 0);
    assert.ok(captured.length >= 1);
    assert.match(textOf(captured[0]), /Always answer in JSON/);
  });

  it("without --instruction the discovered injector is not applied", async () => {
    const root = await makeRoot("noinj");
    await writeFileDeep(`${root}/.agents/instructions/json-always/manifest.json`, JSON.stringify({ name: "json-always", resource: "./INSTRUCTIONS.md" }));
    await writeFileDeep(`${root}/.agents/instructions/json-always/INSTRUCTIONS.md`, "Always answer in JSON");
    const captured: ProviderRequest[] = [];
    const io = streams();

    const code = await runCli(["--discover", "--discover-kinds", "instructions", "-p", "Hi", "--provider", "mock"], {
      ...io,
      workspaceRoot: root,
      createSession: capturingSession(captured),
    });

    assert.equal(code, 0);
    assert.ok(captured.length >= 1);
    assert.doesNotMatch(textOf(captured[0]), /Always answer in JSON/);
  });

  it("--injector-file loads a markdown file as a static injector", async () => {
    const root = await makeRoot("file");
    const file = join(root, "rule.md");
    await writeFileDeep(file, "Be terse and use bullet points");
    const captured: ProviderRequest[] = [];
    const io = streams();

    const code = await runCli(["--injector-file", file, "-p", "Hi", "--provider", "mock"], {
      ...io,
      createSession: capturingSession(captured),
    });

    assert.equal(code, 0);
    assert.ok(captured.length >= 1);
    assert.match(textOf(captured[0]), /Be terse and use bullet points/);
  });

  it("--instruction false yields zero injectors (disables)", async () => {
    const root = await makeRoot("false");
    await writeFileDeep(`${root}/.agents/instructions/json-always/manifest.json`, JSON.stringify({ name: "json-always", resource: "./INSTRUCTIONS.md" }));
    await writeFileDeep(`${root}/.agents/instructions/json-always/INSTRUCTIONS.md`, "Always answer in JSON");
    const captured: ProviderRequest[] = [];
    const io = streams();

    const code = await runCli(["--discover", "--discover-kinds", "instructions", "--instruction", "false", "-p", "Hi", "--provider", "mock"], {
      ...io,
      workspaceRoot: root,
      createSession: capturingSession(captured),
    });

    assert.equal(code, 0);
    assert.ok(captured.length >= 1);
    assert.doesNotMatch(textOf(captured[0]), /Always answer in JSON/);
  });

  it("--instruction <unknown> fails closed (exit 1) without discovery", async () => {
    const io = streams();
    const code = await runCli(["--instruction", "nope", "-p", "Hi", "--provider", "mock"], {
      ...io,
      createSession: capturingSession([]),
    });
    assert.equal(code, 1);
    assert.match(io.stderr.text(), /Unknown instruction injector: nope/);
  });
});
