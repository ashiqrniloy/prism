import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import {
  type AuthMode,
  agentEventGuards,
  buildChildEnv,
  createJsonRpcPeer,
  createStdinWriter,
  EXTERNAL_ACTIVITY_EVENTS,
  effectsTable,
  isAgentEventName,
  type JsonlItem,
  mapDiff,
  mapPlan,
  mapUsage,
  readJsonl,
  redactedStderr,
  signalLadder,
  subagentScopes,
} from "../index.js";

const first = async (it: AsyncIterable<JsonlItem>): Promise<{ value: Record<string, any> }> => {
  const { value } = await it[Symbol.asyncIterator]().next();
  return value as { value: Record<string, any> };
};

const collect = async <T>(it: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const item of it) out.push(item);
  return out;
};

describe("process helpers", () => {
  test("jsonl_bounds_and_invalid_lines", async () => {
    const items = await collect(
      readJsonl(['{"a":1}\n{bad sk-secret\n', '\n{"b"', ":2}"], { maxLineBytes: 64, redact: (t) => t.replace("sk-secret", "[redacted]") }),
    );
    expect(items).toEqual([
      { kind: "value", value: { a: 1 } },
      { kind: "invalid", raw: "{bad [redacted]" },
      { kind: "value", value: { b: 2 } },
    ]);
    await expect(collect(readJsonl(["x".repeat(100)], { maxLineBytes: 10 }))).rejects.toThrow("jsonl_line_too_long");
  });

  test("json_rpc_server_to_client_request_answered", async () => {
    const toPeer = new PassThrough();
    const fromPeer = new PassThrough();
    createJsonRpcPeer({ readable: toPeer, writable: fromPeer, onRequest: async (method) => ({ echoed: method }) });
    toPeer.write('{"jsonrpc":"2.0","id":7,"method":"approve","params":{}}\n');
    const reply = await first(readJsonl(fromPeer, { maxLineBytes: 1024 }));
    expect(reply.value).toEqual({ jsonrpc: "2.0", id: 7, result: { echoed: "approve" } });
  });

  test("json_rpc_client_request_resolves", async () => {
    const a = new PassThrough();
    const b = new PassThrough();
    const client = createJsonRpcPeer({ readable: a, writable: b });
    const pending = client.request("session.start", { x: 1 });
    const sent = await first(readJsonl(b, { maxLineBytes: 1024 }));
    expect(sent.value.method).toBe("session.start");
    a.write(`{"jsonrpc":"2.0","id":${sent.value.id},"result":"ok"}\n`);
    expect(await pending).toBe("ok");
  });

  test("json_rpc_unhandled_request_errors", async () => {
    const toPeer = new PassThrough();
    const fromPeer = new PassThrough();
    const unhandled: string[] = [];
    createJsonRpcPeer({ readable: toPeer, writable: fromPeer, onUnhandled: (m) => unhandled.push(m) });
    toPeer.write('{"jsonrpc":"2.0","id":1,"method":"mystery"}\n');
    const reply = await first(readJsonl(fromPeer, { maxLineBytes: 1024 }));
    expect(reply.value.error.code).toBe(-32601);
    expect(unhandled).toEqual(["mystery"]);
  });

  test("stdin_writer_waits_for_drain", async () => {
    const sink = new PassThrough({ highWaterMark: 4 });
    const writer = createStdinWriter(sink);
    let done = false;
    const write = writer.write("0123456789").then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);
    sink.resume();
    await write;
    expect(done).toBe(true);
  });

  test("signal_ladder_escalates", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>{},1000);console.log('ready')"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    await new Promise((r) => child.stdout.once("data", r));
    const started = Date.now();
    const exit = await signalLadder(child, { graceMs: 100 });
    expect(exit.signal).toBe("SIGKILL");
    expect(Date.now() - started).toBeLessThan(1500);
  });

  test("stderr_is_redacted_and_bounded", async () => {
    const stream = new PassThrough();
    const ring = redactedStderr(stream, { redact: (v) => (v as string).replaceAll("sk-1", "***") as never }, { maxBytes: 10 });
    stream.end("lots of text sk-1 end");
    await ring.done;
    expect(ring.text()).toBe("xt *** end");
    expect(ring.text().length).toBeLessThanOrEqual(10);
  });

  test("child_env_excludes_protected_and_parent_secrets", () => {
    const mode: AuthMode = { name: "acct", kind: "account", deployments: ["local"], protected: { paths: [], env: ["ACCOUNT_TOKEN"] } };
    const env = buildChildEnv({
      base: { PATH: "/bin", HOME: "/h", ACCOUNT_TOKEN: "t", OTHER_SECRET: "s" },
      paths: { PROFILE_HOME: "/p" },
      apiKeys: { ACCOUNT_TOKEN: "sneaky", API_KEY: "k" },
      modes: [mode],
    });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", PROFILE_HOME: "/p", API_KEY: "k" });
  });
});

describe("normalization helpers", () => {
  test("effects_table_unknown_gets_every_effect", () => {
    const effects = effectsTable({ read_file: ["read"] });
    expect(effects("read_file")).toEqual(["read"]);
    expect(effects("unknown_tool")).toEqual(["read", "write", "execute", "network", "external"]);
  });

  test("diff_usage_plan_subagent_mappers", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1 +1 @@",
      "-x",
      "+y",
      "diff --git a/n.ts b/n.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/n.ts",
      "+z",
    ].join("\n");
    expect(mapDiff(diff).map((f) => [f.path, f.change, f.source])).toEqual([
      ["a.ts", "modified", "diff"],
      ["n.ts", "created", "diff"],
    ]);
    expect(mapUsage({ input: 3, output: 4, cost: 0.5, currency: "USD", cacheRead: -1 })).toEqual({
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
      cost: 0.5,
      currency: "USD",
    });
    expect(mapPlan([{ title: "a", status: "done" }, { title: " " }, { title: "b" }]).entries).toEqual([
      { title: "a", status: "done" },
      { title: "b", status: "pending" },
    ]);
    const scopes = subagentScopes();
    expect(scopes.open("s1", "t1", "n")).toEqual({ kind: "subagent", phase: "started", id: "s1", name: "n", parentToolCallId: "t1" });
    scopes.open("s2");
    expect(scopes.active()).toEqual(["s1", "s2"]);
    expect(scopes.close("s1", "done")).toEqual({ kind: "subagent", phase: "completed", id: "s1", result: "done" });
    expect(scopes.active()).toEqual([]);
  });
});

describe("agent.* events", () => {
  test("re_exports_kernel_names_with_guards", () => {
    expect(EXTERNAL_ACTIVITY_EVENTS.skill).toBe("agent.skill");
    expect(isAgentEventName("agent.plan")).toBe(true);
    expect(isAgentEventName("agent.nope")).toBe(false);
    expect(agentEventGuards.isFileEvent("agent.file")).toBe(true);
    expect(agentEventGuards.isFileEvent("agent.plan")).toBe(false);
  });
});

test("json_rpc_concurrent_handlers_do_not_block_responses", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let count = 0;
  const peer = createJsonRpcPeer({
    readable: input,
    writable: output,
    maxConcurrentRequests: 2,
    onRequest: async () => {
      count++;
      await gate;
      return "allowed";
    },
  });
  output.resume();
  input.write('{"jsonrpc":"2.0","id":10,"method":"slow"}\n{"jsonrpc":"2.0","id":11,"method":"slow"}\n');
  const request = peer.request("initialize");
  input.write('{"jsonrpc":"2.0","id":1,"result":"ready"}\n');
  expect(await request).toBe("ready");
  expect(count).toBe(2);
  release();
  input.end();
  await peer.closed;
});

test("json_rpc_error_callback_runs_after_response_and_enforces_bound", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const written: string[] = [],
    failures: string[] = [];
  output.on("data", (chunk) => written.push(String(chunk)));
  const peer = createJsonRpcPeer({
    readable: input,
    writable: output,
    maxConcurrentRequests: 2,
    onRequest: async () => {
      await gate;
      return null;
    },
    onRequestError: (method) => {
      expect(written.join("")).toContain("too many concurrent requests");
      failures.push(method);
    },
  });
  input.write(`${[1, 2, 3].map((id) => JSON.stringify({ jsonrpc: "2.0", id, method: "slow" })).join("\n")}\n`);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(failures).toEqual(["slow"]);
  release();
  input.end();
  await peer.closed;
});

test("json_rpc_handler_error_response_precedes_failure_callback", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  const written: string[] = [];
  output.on("data", (chunk) => written.push(String(chunk)));
  let notifyFailure: () => void = () => {};
  const failed = new Promise<void>((resolve) => {
    notifyFailure = resolve;
  });
  const peer = createJsonRpcPeer({
    readable: input,
    writable: output,
    onRequest: () => {
      throw Error("handler failed");
    },
    onRequestError: () => {
      expect(JSON.parse(written.join("")).error).toEqual({ code: -32603, message: "handler failed" });
      notifyFailure();
    },
  });
  input.write('{"jsonrpc":"2.0","id":1,"method":"bad"}\n');
  await failed;
  input.end();
  await peer.closed;
});

test("stdin_writer_close_is_idempotent_after_stream_destruction", async () => {
  const sink = new PassThrough();
  sink.resume();
  const writer = createStdinWriter(sink);
  await writer.write("hello");
  sink.destroy();
  await writer.close();
  await writer.close();
  expect(sink.destroyed).toBe(true);
});
