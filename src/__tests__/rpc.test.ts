import { Readable, Writable } from "node:stream";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "../index.js";
import { parseRpcRequest, runRpcServer } from "../rpc.js";

class MemoryWritable extends Writable {
  chunks: string[] = [];
  _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }
  lines(): unknown[] { return this.chunks.join("").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
}

function createSession(id?: string) {
  return createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerTextDelta("Hello"), providerDone()]),
  }).createSession({ id });
}

async function run(input: string, commands: any[] = []) {
  const stdout = new MemoryWritable();
  await runRpcServer({ stdin: Readable.from(input), stdout, createSession, commands });
  return stdout.lines();
}

describe("rpc", () => {
  it("parseRpcRequest validates object shape", () => {
    assert.deepEqual(parseRpcRequest({ id: "1", command: "state" }), { id: "1", command: "state", params: undefined });
    assert.throws(() => parseRpcRequest({ command: "state" }), /id/);
    assert.throws(() => parseRpcRequest({ id: "1", command: "wat" }), /Unknown RPC command/);
  });

  it("rpc_prompt_correlates_response_and_async_events_by_id", async () => {
    const lines = await run(`${JSON.stringify({ id: "1", command: "prompt", params: { input: "Hi" } })}\n`);
    assert.ok(lines.some((line: any) => line.type === "event" && line.id === "1" && line.event.type === "message_delta" && line.sessionId));
    assert.ok(lines.some((line: any) => line.id === "1" && line.ok === true && line.result.sessionId));
  });

  it("rpc_invalid_json_and_unknown_command_fail_closed", async () => {
    const lines = await run(`not-json\n${JSON.stringify({ id: "2", command: "wat" })}\n`);
    assert.equal((lines[0] as any).ok, false);
    assert.equal((lines[1] as any).id, "2");
    assert.equal((lines[1] as any).ok, false);
  });

  it("rpc_abort_calls_session_abort", async () => {
    const lines = await run(`${JSON.stringify({ id: "1", command: "abort", params: { reason: "stop" } })}\n`);
    assert.deepEqual(lines.at(-1), { id: "1", ok: true, result: { sessionId: (lines.at(-1) as any).result.sessionId } });
  });

  it("rpc_compact_and_session_branch_commands_use_session_api", async () => {
    const lines = await run([
      { id: "1", command: "prompt", params: { input: "Hi" } },
      { id: "2", command: "compact" },
      { id: "3", command: "messages" },
      { id: "4", command: "cloneSession", params: { id: "s2" } },
      { id: "5", command: "switchSession", params: { sessionId: "s3" } },
    ].map((line) => JSON.stringify(line)).join("\n") + "\n");
    assert.ok(lines.some((line: any) => line.id === "2" && line.ok === true && typeof line.result.summary === "string"));
    assert.ok(lines.some((line: any) => line.id === "3" && line.ok === true && Array.isArray(line.result.entries)));
    assert.ok(lines.some((line: any) => line.id === "4" && line.ok === true && line.result.sessionId === "s2"));
    assert.ok(lines.some((line: any) => line.id === "5" && line.ok === true && line.result.sessionId === "s3"));
  });

  it("rpc_command_executes_only_registered_commands", async () => {
    const lines = await run([
      { id: "1", command: "command", params: { name: "echo", args: { ok: true } } },
      { id: "2", command: "command", params: { name: "missing" } },
    ].map((line) => JSON.stringify(line)).join("\n") + "\n", [{ name: "echo", execute: (args: any) => ({ name: "echo", value: args }) }]);
    assert.ok(lines.some((line: any) => line.id === "1" && line.ok === true && line.result.value.ok === true));
    assert.ok(lines.some((line: any) => line.id === "2" && line.ok === false));
  });
});
