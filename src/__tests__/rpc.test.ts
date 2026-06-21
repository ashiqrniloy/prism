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

function createBlockingSession(id?: string) {
  return createAgent({
    model: { provider: "blocking", model: "demo" },
    provider: {
      id: "blocking",
      async *generate(request: any) {
        yield providerTextDelta("working");
        while (!request.signal?.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw request.signal.reason;
      },
    },
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
      { id: "1", command: "compact" },
      { id: "2", command: "prompt", params: { input: "Hi" } },
      { id: "3", command: "messages" },
      { id: "4", command: "cloneSession", params: { id: "s2" } },
      { id: "5", command: "switchSession", params: { sessionId: "s3" } },
    ].map((line) => JSON.stringify(line)).join("\n") + "\n");
    assert.ok(lines.some((line: any) => line.id === "1" && line.ok === true && typeof line.result.summary === "string"));
    assert.ok(lines.some((line: any) => line.id === "3" && line.ok === true && Array.isArray(line.result.entries)));
    assert.ok(lines.some((line: any) => line.id === "4" && line.ok === true && line.result.sessionId === "s2"));
    assert.ok(lines.some((line: any) => line.id === "5" && line.ok === true && line.result.sessionId === "s3"));
  });

  it("rpc_compact_fails_closed_during_active_prompt", async () => {
    const stdout = new MemoryWritable();
    const server = runRpcServer({
      stdin: Readable.from([
        JSON.stringify({ id: "run-1", command: "prompt", params: { input: "Hi" } }),
        JSON.stringify({ id: "compact-1", command: "compact" }),
        JSON.stringify({ id: "abort-1", command: "abort", params: { reason: "stop" } }),
      ].join("\n") + "\n"),
      stdout,
      createSession: createBlockingSession,
    });
    const lines = await server.then(() => stdout.lines());

    const compactResponse = lines.find((line: any) => line.id === "compact-1") as any;
    assert.ok(compactResponse && compactResponse.ok === false);
    assert.ok(compactResponse?.error?.message.includes("active run"));
  });

  it("rpc_command_executes_only_registered_commands", async () => {
    const lines = await run([
      { id: "1", command: "command", params: { name: "echo", args: { ok: true } } },
      { id: "2", command: "command", params: { name: "missing" } },
    ].map((line) => JSON.stringify(line)).join("\n") + "\n", [{ name: "echo", execute: (args: any) => ({ name: "echo", value: args }) }]);
    assert.ok(lines.some((line: any) => line.id === "1" && line.ok === true && line.result.value.ok === true));
    assert.ok(lines.some((line: any) => line.id === "2" && line.ok === false));
  });

  it("rpc_abort_cancels_active_provider_stream_before_stdin_closes", async () => {
    const stdout = new MemoryWritable();
    const server = runRpcServer({
      stdin: Readable.from([
        JSON.stringify({ id: "run-1", command: "prompt", params: { input: "Hi" } }),
        JSON.stringify({ id: "abort-1", command: "abort", params: { reason: "stop" } }),
      ].join("\n") + "\n"),
      stdout,
      createSession: createBlockingSession,
    });
    const lines = await server.then(() => stdout.lines());

    const abortResponse = lines.find((line: any) => line.id === "abort-1") as any;
    assert.ok(abortResponse && abortResponse.ok === true);

    const promptResponse = lines.find((line: any) => line.id === "run-1" && line.ok === false) as any;
    assert.ok(promptResponse);

    assert.ok(!lines.some((line: any) => line.type === "event" && line.id === "abort-1"));
    assert.ok(lines.some((line: any) => line.type === "event" && line.id === "run-1" && line.event.type === "error"));
  });

  it("rpc_state_responds_while_prompt_is_running", async () => {
    const stdout = new MemoryWritable();
    const server = runRpcServer({
      stdin: Readable.from([
        JSON.stringify({ id: "run-1", command: "prompt", params: { input: "Hi" } }),
        JSON.stringify({ id: "state-1", command: "state" }),
        JSON.stringify({ id: "abort-1", command: "abort", params: { reason: "stop" } }),
      ].join("\n") + "\n"),
      stdout,
      createSession: createBlockingSession,
    });
    const lines = await server.then(() => stdout.lines());

    const stateResponse = lines.find((line: any) => line.id === "state-1") as any;
    assert.ok(stateResponse && stateResponse.ok === true);

    const stateIndex = lines.findIndex((line: any) => line.id === "state-1");
    const promptCompletionIndex = lines.findIndex((line: any) => line.id === "run-1" && (line.ok === true || line.ok === false));
    assert.ok(stateIndex < promptCompletionIndex);
  });

  it("rpc_followup_during_active_prompt_is_processed_without_blocking", async () => {
    const stdout = new MemoryWritable();
    const server = runRpcServer({
      stdin: Readable.from([
        JSON.stringify({ id: "run-1", command: "prompt", params: { input: "Hi" } }),
        JSON.stringify({ id: "run-2", command: "followUp", params: { input: "Again" } }),
        JSON.stringify({ id: "abort-1", command: "abort", params: { reason: "stop" } }),
      ].join("\n") + "\n"),
      stdout,
      createSession: createBlockingSession,
    });
    const lines = await server.then(() => stdout.lines());

    const followUpResponse = lines.find((line: any) => line.id === "run-2") as any;
    assert.ok(followUpResponse && followUpResponse.ok === false);
    assert.ok(followUpResponse?.error?.message.includes("already has an active run"));

    const abortResponse = lines.find((line: any) => line.id === "abort-1") as any;
    assert.ok(abortResponse && abortResponse.ok === true);
  });

  it("rpc_events_remain_correlated_to_prompt_request_id_after_abort", async () => {
    const stdout = new MemoryWritable();
    const server = runRpcServer({
      stdin: Readable.from([
        JSON.stringify({ id: "run-1", command: "prompt", params: { input: "Hi" } }),
        JSON.stringify({ id: "abort-1", command: "abort", params: { reason: "stop" } }),
      ].join("\n") + "\n"),
      stdout,
      createSession: createBlockingSession,
    });
    const lines = await server.then(() => stdout.lines());

    const events = lines.filter((line: any) => line.type === "event");
    assert.ok(events.every((line: any) => line.id === "run-1"));
    assert.ok(events.some((line: any) => line.event.type === "agent_started" || line.event.type === "turn_started"));
    assert.ok(events.some((line: any) => line.event.type === "error"));
  });
});
