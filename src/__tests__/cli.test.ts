import { Readable, Writable } from "node:stream";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAgent, createMockProvider, providerDone, providerError, providerTextDelta } from "../index.js";
import { parseCliArgs, runCli } from "../cli-runner.js";
import type { CliOptions } from "../cli-runner.js";

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

function session(text = "Hello") {
  return createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerTextDelta(text), providerDone()]),
  }).createSession();
}

describe("cli", () => {
  it("cli_parser_accepts_prompt_mode_and_core_flags", () => {
    const parsed = parseCliArgs(["-p", "Hi", "--mode", "json", "--provider", "mock", "--model", "demo", "--session", "s1", "--config", "c.json", "--resource", "r", "--extension", "e", "--tool", "t", "--system", "sys", "--context", "ctx", "--compact", "3", "--max-tool-rounds", "2"]);
    assert.equal(parsed.prompt, "Hi");
    assert.equal(parsed.mode, "json");
    assert.equal(parsed.provider, "mock");
    assert.equal(parsed.model, "demo");
    assert.deepEqual(parsed.config, ["c.json"]);
    assert.deepEqual(parsed.resources, ["r"]);
    assert.deepEqual(parsed.extensions, ["e"]);
    assert.deepEqual(parsed.tools, ["t"]);
    assert.equal(parsed.compact, 3);
    assert.equal(parsed.maxToolRounds, 2);
  });

  it("cli_parser_rejects_unknown_or_missing_flag_values", async () => {
    assert.throws(() => parseCliArgs(["--wat"]), /Unknown flag/);
    assert.throws(() => parseCliArgs(["--mode"]), /Missing value/);
    const io = streams();
    const code = await runCli(["--wat"], io);
    assert.equal(code, 2);
    assert.match(io.stderr.text(), /Usage: prism/);
  });

  it("cli_bootstrap_fails_without_explicit_provider", async () => {
    const io = streams();
    const code = await runCli(["-p", "Hi"], io);
    assert.equal(code, 2);
    assert.match(io.stderr.text(), /No provider configured/);
  });

  it("print_mode_streams_text_deltas_from_mock_provider", async () => {
    const io = streams();
    const code = await runCli(["-p", "Hi"], { ...io, createSession: (_options: CliOptions) => session("Hello") });
    assert.equal(code, 0);
    assert.equal(io.stdout.text(), "Hello");
  });

  it("json_mode_writes_one_event_per_line", async () => {
    const io = streams();
    const code = await runCli(["--mode", "json", "-p", "Hi"], { ...io, createSession: () => session("Hi") });
    assert.equal(code, 0);
    const lines = io.stdout.text().trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(lines.some((line) => line.type === "event" && line.event.type === "message_delta"));
    assert.ok(lines.every((line) => line.sessionId));
  });

  it("print_mode_returns_nonzero_on_runtime_error", async () => {
    const io = streams();
    const failing = createAgent({
      model: { provider: "mock", model: "demo" },
      provider: createMockProvider([providerError(new Error("boom"))]),
    }).createSession();
    const code = await runCli(["-p", "Hi"], { ...io, createSession: () => failing });
    assert.equal(code, 1);
    assert.match(io.stderr.text(), /boom/);
  });
});
