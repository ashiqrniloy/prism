import { PassThrough, Readable, Writable } from "node:stream";
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

// Drives one server with sequential request/response turns so a later command can use a value
// (e.g. a leaf id) returned by an earlier command in the SAME session. Polls stdout for the
// response line matching the request id; only parses up to the last newline so a mid-chunk
// partial line never breaks JSON.parse.
async function interactive(create = createSession) {
  const stdin = new PassThrough();
  const stdout = new MemoryWritable();
  const done = runRpcServer({ stdin, stdout, createSession: create });
  const send = async (req: Record<string, unknown>): Promise<any> => {
    const id = req.id;
    stdin.write(`${JSON.stringify(req)}\n`);
    for (let i = 0; i < 400; i++) {
      // only parse up to the last newline so a mid-chunk partial line never breaks JSON.parse
      const raw = stdout.chunks.join("");
      const upto = raw.lastIndexOf("\n");
      if (upto !== -1) {
        const lines = raw.slice(0, upto + 1).split("\n").filter(Boolean).map((l) => JSON.parse(l));
        const resp = lines.find((l: any) => l?.id === id && (l.ok === true || l.ok === false));
        if (resp) return resp;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no response for ${String(id)}`);
  };
  return {
    stdout,
    async send(req: Record<string, unknown>) { return send(req); },
    async close() { stdin.end(); await done; },
  };
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

  it("rpc_fork_keeps_parent_handle_and_mints_branch_handle", async () => {
    const s = await interactive();
    await s.send({ id: "1", command: "prompt", params: { input: "Hi" } });
    const msgs = await s.send({ id: "2", command: "messages" });
    const entries = msgs.result.entries as Array<{ id: string }>;
    const earlierLeaf = entries[0]!.id;
    // fork at an explicit earlier leaf so the branch diverges from the parent tip deterministically
    const fork = await s.send({ id: "3", command: "forkSession", params: { leafId: earlierLeaf } });
    assert.equal(fork.ok, true);
    const sessionId = fork.result.sessionId;
    // fork reuses sessionId (branch, not copy) -> mints a distinct handle id, parent untouched.
    assert.equal(fork.result.handleId, `${sessionId}#2`);
    assert.equal(fork.result.leafId, earlierLeaf);
    const state = await s.send({ id: "4", command: "state" });
    const handles = state.result.handles as Array<{ handleId: string; sessionId: string; leafId?: string }>;
    assert.equal(handles.length, 2);
    assert.ok(handles.some((h) => h.handleId === sessionId), "parent handle survived the fork");
    assert.ok(handles.some((h) => h.handleId === `${sessionId}#2`), "fork handle registered");
    // both handles share sessionId but resolve to distinct leaves (branch model)
    const parent = handles.find((h) => h.handleId === sessionId)!;
    const child = handles.find((h) => h.handleId === `${sessionId}#2`)!;
    assert.equal(parent.sessionId, sessionId);
    assert.equal(child.sessionId, sessionId);
    assert.notEqual(parent.leafId, child.leafId);
    await s.close();
  });

  it("rpc_checkout_repoints_current_session_leaf", async () => {
    const s = await interactive();
    await s.send({ id: "1", command: "prompt", params: { input: "Hi" } });
    const msgs = await s.send({ id: "2", command: "messages" });
    const entries = msgs.result.entries as Array<{ id: string }>;
    const earlierLeaf = entries[0]!.id;
    const checkout = await s.send({ id: "3", command: "checkout", params: { leafId: earlierLeaf } });
    assert.equal(checkout.ok, true);
    assert.equal(checkout.result.leafId, earlierLeaf);
    // checkout does not change which handle is active
    const state = await s.send({ id: "4", command: "state" });
    assert.equal(state.result.handleId, state.result.sessionId);
    assert.equal(state.result.leafId, earlierLeaf);
    await s.close();
  });

  it("rpc_checkout_then_branch_messages_reflect_branched_history", async () => {
    // Task 6 checkout criterion: after checkout to an existing leaf, a subsequent append branches
    // and `messages` reflects the NEW branch path (the abandoned tip drops out).
    let n = 0;
    const counting = () => (id?: string) =>
      createAgent({
        model: { provider: "mock", model: "demo" },
        provider: { id: "mock", async *generate() { n++; yield providerTextDelta(`reply${n}`); yield providerDone(); } },
      }).createSession({ id });
    const s = await interactive(counting());

    await s.send({ id: "1", command: "prompt", params: { input: "one" } }); // reply1
    await s.send({ id: "2", command: "prompt", params: { input: "two" } }); // reply2 (tip)

    const before = await s.send({ id: "3", command: "messages" });
    type MsgEntry = { id: string; message?: { content: Array<{ type: string; text?: string }> } };
    const beforeEntries = before.result.entries as MsgEntry[];
    const earlierLeaf = beforeEntries.find((e) => e.message?.content?.some((c) => c.type === "text" && c.text === "reply1"))!.id;

    await s.send({ id: "4", command: "checkout", params: { leafId: earlierLeaf } });
    await s.send({ id: "5", command: "prompt", params: { input: "branch" } }); // reply3

    const after = await s.send({ id: "6", command: "messages" });
    const texts = (after.result.entries as MsgEntry[])
      .flatMap((e) => e.message?.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text);
    assert.ok(texts.includes("reply1"), "checked-out leaf stays on the active branch");
    assert.ok(texts.includes("reply3"), "post-checkout append is on the active branch");
    assert.equal(texts.includes("reply2"), false, "abandoned tip is not on the active branch path");
    await s.close();
  });

  it("rpc_switch_session_selects_handle_by_id_and_keeps_siblings", async () => {
    const s = await interactive();
    await s.send({ id: "1", command: "prompt", params: { input: "Hi" } });
    const fork = await s.send({ id: "2", command: "forkSession", params: {} });
    const parentHandle = fork.result.sessionId; // parent handle id == sessionId
    const forkHandle = fork.result.handleId;
    // switch back to the parent handle explicitly
    const sw = await s.send({ id: "3", command: "switchSession", params: { handleId: parentHandle } });
    assert.equal(sw.ok, true);
    assert.equal(sw.result.handleId, parentHandle);
    const state = await s.send({ id: "4", command: "state" });
    assert.equal(state.result.handleId, parentHandle);
    // the forked handle is still registered (not collapsed)
    assert.ok((state.result.handles as any[]).some((h) => h.handleId === forkHandle));
    await s.close();
  });
});
