import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { runRelay } from "../../cli-relay.js";
import { createAgent, type RunController, type ToolDefinition } from "../../index.js";
import {
  bridgeTools,
  type CallbackBroker,
  createCallbackBroker,
  createProfiles,
  type DriverDescriptor,
  DriverError,
  type DriverRunContext,
  defineDriver,
  driverPackage,
  type HookCodec,
} from "../index.js";

const descriptor: DriverDescriptor = {
  vendor: "example",
  usesModel: false,
  models: "passthrough",
  controls: {
    systemPrompt: ["append"],
    builtinTools: "partial",
    clientTools: "mcp",
    skills: true,
    subagents: false,
    permissionCallback: true,
    rewrite: false,
    continueOnStop: true,
    steer: "next-turn",
    resume: "store",
    isolation: "flags",
  },
  capture: {
    textDeltas: true,
    thinking: "final",
    skillActivation: "tool",
    toolCalls: true,
    fileDiffs: false,
    subagents: "none",
    usage: "tokens",
  },
  auth: { modes: [{ name: "key", kind: "api-key", deployments: ["local"], protected: { paths: [], env: [] } }] },
};

const FAIL = { exitCode: 2, stdout: '{"fail":true}' };

/** A codec that speaks JSON: `{kind, ...}` in, the answer's JSON out. */
const codec: HookCodec = {
  decode(stdin) {
    const value = JSON.parse(stdin) as { kind: string; id?: string; name?: string };
    if (value.kind === "pre-tool") {
      return { kind: "pre-tool", request: { toolCallId: value.id ?? "t", name: value.name ?? "read", args: {}, effects: ["read"] } };
    }
    if (value.kind === "stop") return { kind: "stop" };
    return { kind: "observe", activity: { kind: "notice", level: "info", code: "seen", message: "hi" } };
  },
  encode(answer) {
    const allowed = "allow" in answer && answer.allow === true;
    return { exitCode: allowed ? 0 : 2, stdout: JSON.stringify(answer) };
  },
};

/** Drives `prism relay` in-process with the given payload and returns what it printed. */
async function relay(runDir: string, mode: "hook" | "mcp", input: string) {
  let stdout = "";
  let stderr = "";
  const code = await runRelay([mode, "--run", runDir], {
    stdin: Readable.from([input]),
    stdout: { write: (chunk: string) => (stdout += chunk) },
    stderr: { write: (chunk: string) => (stderr += chunk) },
  });
  return { code, stdout, stderr };
}

/** Runs a driver whose `start.run` is `body`, so the broker lives inside a real run. */
async function inRun(
  body: (ctx: DriverRunContext, tools: readonly ToolDefinition[]) => Promise<void>,
  tools: readonly ToolDefinition[] = [],
) {
  const driver = defineDriver({
    name: "broker-driver",
    vendor: "example",
    revision: "1",
    descriptor,
    start: {
      probe: async () => ({ path: "/bin/example", version: "1.0.0" }),
      run: (ctx) => body(ctx, tools),
    },
  });
  const profilesRoot = mkdtempSync(join(tmpdir(), "broker-"));
  await createProfiles({ root: profilesRoot, driver }).create("me");
  const agent = await createAgent({
    packages: [driverPackage(driver)],
    packageConfig: { "broker-driver": { name: "planner", profile: "me", profilesRoot } },
    ...(tools.length > 0 ? { tools: { add: tools } } : {}),
  });
  const session = await agent.session({ id: "s", create: true });
  const result = await session.run("go");
  await session.close();
  return { result, agent };
}

const runDirOf = () => mkdtempSync(join(tmpdir(), "run-"));

const externalOrigin = { kind: "external" as const, agent: "planner", agentId: "a", vendor: "example", depth: 0 };

describe("callback broker", () => {
  it("broker_routes_pre_tool_to_ask_and_stop_to_end", async () => {
    const seen: unknown[] = [];
    await inRun(async (ctx) => {
      const runDir = runDirOf();
      const broker = await createCallbackBroker(ctx.run, { runDir, hookCodec: codec, failClosed: FAIL, timeoutMs: 5_000 });
      try {
        const allowed = await relay(runDir, "hook", JSON.stringify({ kind: "pre-tool", id: "c1", name: "read" }));
        seen.push(["pre-tool", allowed.code, JSON.parse(allowed.stdout)]);
        const stopped = await relay(runDir, "hook", JSON.stringify({ kind: "stop" }));
        seen.push(["stop", stopped.code, JSON.parse(stopped.stdout)]);
        const observed = await relay(runDir, "hook", JSON.stringify({ kind: "observe" }));
        seen.push(["observe", observed.code, JSON.parse(observed.stdout)]);
      } finally {
        await broker.close();
      }
    });
    const [pre, stop, observe] = seen as [
      [string, number, { allow: boolean }],
      [string, number, { end: { continue: boolean } }],
      [string, number, { observed: boolean }],
    ];
    assert.equal(pre[0], "pre-tool");
    assert.equal(pre[1], 0);
    assert.equal(pre[2].allow, true);
    assert.equal(stop[2].end.continue, false);
    assert.equal(observe[2].observed, true);
  });

  it("broker_concurrent_callbacks_fire_tool_call", async () => {
    const timeline: string[] = [];
    const slow: ToolDefinition = {
      name: "slow",
      parameters: { type: "object", properties: {} },
      effects: ["read"],
      async execute(_args, context) {
        timeline.push(`start:${context.toolCallId}`);
        await new Promise((resolve) => setTimeout(resolve, 150));
        timeline.push(`end:${context.toolCallId}`);
        return { toolCallId: context.toolCallId, name: "slow", value: "ok" };
      },
    };
    const { result } = await inRun(
      async (ctx, tools) => {
        const bridge = bridgeTools(ctx.run, ["slow"], { origin: externalOrigin, tools });
        const broker = await createCallbackBroker(ctx.run, { runDir: runDirOf(), hookCodec: codec, failClosed: FAIL, timeoutMs: 5_000 });
        broker.route("mcp", async (request) => {
          const message = (await request.json()) as { id: string };
          const call = { type: "tool_call" as const, id: message.id, name: "slow", arguments: {} };
          const outcome = await bridge.invoke(call);
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { value: outcome.value } }), {
            headers: { "content-type": "application/json" },
          });
        });
        try {
          const post = (id: string) =>
            fetch(`${broker.url}/mcp`, {
              method: "POST",
              headers: { authorization: `Bearer ${broker.token}`, "content-type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call" }),
            });
          const responses = await Promise.all([post("a"), post("b")]);
          timeline.push(`statuses:${responses.map((r) => r.status).join(",")}`);
        } finally {
          await broker.close();
        }
      },
      [slow],
    );
    assert.equal(result.error, undefined);
    const firstTwo = timeline.slice(0, 2).map((entry) => entry.split(":")[0]);
    assert.deepEqual(firstTwo, ["start", "start"], `calls did not overlap: ${timeline.join(" ")}`);
    assert.equal(timeline.at(-1), "statuses:200,200");
  });

  it("broker_mcp_route_stub", async () => {
    let answered = 0;
    await inRun(async (ctx) => {
      const runDir = runDirOf();
      const broker = await createCallbackBroker(ctx.run, { runDir, hookCodec: codec, failClosed: FAIL, timeoutMs: 5_000 });
      broker.route("mcp", async (request) => {
        answered += 1;
        const message = (await request.json()) as { id: number; method: string };
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { method: message.method } }), {
          headers: { "content-type": "application/json" },
        });
      });
      try {
        const input =
          `${[
            JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
            JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
          ].join("\n")}\n`;
        const out = await relay(runDir, "mcp", input);
        assert.equal(out.code, 0);
        const lines = out.stdout.trim().split("\n");
        assert.equal(lines.length, 1, "a notification writes no frame");
        assert.deepEqual(JSON.parse(lines[0] ?? ""), { jsonrpc: "2.0", id: 1, result: { method: "tools/list" } });
      } finally {
        await broker.close();
      }
    });
    // The handler sees the notification too, and decides what it means; the broker only withholds the reply.
    assert.equal(answered, 2);
  });

  it("broker_http_rejects_wrong_token_and_origin", async () => {
    await inRun(async (ctx) => {
      const broker = await createCallbackBroker(ctx.run, { runDir: runDirOf(), hookCodec: codec, failClosed: FAIL, timeoutMs: 5_000 });
      try {
        const body = JSON.stringify({ kind: "stop" });
        const wrong = await fetch(`${broker.url}/hook`, { method: "POST", headers: { authorization: "Bearer nope" }, body });
        assert.equal(wrong.status, 401);
        const origin = await fetch(`${broker.url}/hook`, {
          method: "POST",
          headers: { authorization: `Bearer ${broker.token}`, origin: "https://evil.example" },
          body,
        });
        assert.equal(origin.status, 403);
        const ok = await fetch(`${broker.url}/hook`, { method: "POST", headers: { authorization: `Bearer ${broker.token}` }, body });
        assert.equal(ok.status, 200);
      } finally {
        await broker.close();
      }
    });
  });

  it("broker_refuses_after_close", async () => {
    await inRun(async (ctx) => {
      const runDir = runDirOf();
      const broker = await createCallbackBroker(ctx.run, { runDir, hookCodec: codec, failClosed: FAIL, timeoutMs: 5_000 });
      await broker.close();
      const refused = await relay(runDir, "hook", JSON.stringify({ kind: "pre-tool", id: "late" }));
      assert.equal(refused.code, FAIL.exitCode);
      assert.equal(refused.stdout, FAIL.stdout);
      await assert.rejects(
        fetch(`${broker.url}/hook`, { method: "POST", headers: { authorization: `Bearer ${broker.token}` }, body: "{}" }),
      );
    });
  });

  it("broker_malformed_codec_answer_fails_closed", async () => {
    const broken: HookCodec = { decode: codec.decode, encode: () => ({ exitCode: 999, stdout: "x" }) };
    await inRun(async (ctx) => {
      const runDir = runDirOf();
      const broker = await createCallbackBroker(ctx.run, { runDir, hookCodec: broken, failClosed: FAIL, timeoutMs: 5_000 });
      try {
        const out = await relay(runDir, "hook", JSON.stringify({ kind: "stop" }));
        assert.equal(out.code, FAIL.exitCode);
        assert.equal(out.stdout, FAIL.stdout);
      } finally {
        await broker.close();
      }
    });
  });

  it("broker_token_never_in_events_or_inspect", async () => {
    let token = "";
    let runDir = "";
    let broker: CallbackBroker | undefined;
    const { agent } = await inRun(async (ctx) => {
      runDir = runDirOf();
      broker = await createCallbackBroker(ctx.run, { runDir, hookCodec: codec, failClosed: FAIL, timeoutMs: 5_000 });
      token = broker.token;
      const bad = await fetch(`${broker.url}/hook`, { method: "POST", headers: { authorization: "Bearer nope" }, body: "{}" });
      assert.equal(bad.status, 401);
    });
    assert.ok(token.length >= 64);
    assert.equal(readFileSync(join(runDir, "relay.json"), "utf8").includes(token), false);
    assert.equal(JSON.stringify(agent.inspect()).includes(token), false);
    await broker?.close();
  });

  it("broker_refuses_when_run_directory_path_is_too_long", async () => {
    await inRun(async (ctx) => {
      const long = join(runDirOf(), "x".repeat(120));
      await assert.rejects(
        createCallbackBroker(ctx.run, { runDir: long, hookCodec: codec, failClosed: FAIL, timeoutMs: 5_000 }),
        (error: unknown) => {
          assert.ok(error instanceof DriverError);
          assert.equal(error.code, "broker_unavailable");
          return true;
        },
      );
    });
  });
});

/** A `RunController` stand-in for the gate mapping, where a real run cannot reach `approval_pending`. */
function fakeRun(decision: unknown) {
  const controller = new AbortController();
  const calls: { executeTools: unknown[] } = { executeTools: [] };
  const run = {
    signal: controller.signal,
    ask: async () => decision,
    end: async () => ({ continue: false as const }),
    observe: async () => undefined,
    executeTools: async (calls2: unknown) => {
      calls.executeTools.push(calls2);
      return [{ toolCallId: "c1", name: "read", value: "x" }];
    },
  };
  return { run: run as unknown as RunController, calls };
}

describe("callback broker gating", () => {
  it("approval_pending_reaches_encode_as_a_pending_deny_and_closes", async () => {
    const encoded: unknown[] = [];
    const recording: HookCodec = {
      decode: codec.decode,
      encode(answer) {
        encoded.push(answer);
        return { exitCode: 2, stdout: "denied" };
      },
    };
    const { run } = fakeRun({ allow: false, reason: "approval_pending" });
    const runDir = runDirOf();
    const broker = await createCallbackBroker(run, { runDir, hookCodec: recording, failClosed: FAIL, timeoutMs: 5_000 });
    try {
      const first = await relay(runDir, "hook", JSON.stringify({ kind: "pre-tool", id: "c1", name: "write" }));
      assert.equal(first.stdout, "denied");
      const answer = encoded[0] as { allow: boolean; reason: string; message: string };
      assert.equal(answer.allow, false);
      assert.equal(answer.reason, "approval_pending");
      assert.match(answer.message, /approval is pending/);
      const later = await relay(runDir, "hook", JSON.stringify({ kind: "stop" }));
      assert.equal(later.stdout, FAIL.stdout, "a suspended run refuses later callbacks");
    } finally {
      await broker.close();
    }
  });

  it("bridge_tools_unknown_name_fails", () => {
    const { run } = fakeRun({});
    const echo: ToolDefinition = { name: "echo", execute: () => ({ toolCallId: "e", name: "echo" }) };
    assert.throws(
      () => bridgeTools(run, ["echo", "missing"], { origin: externalOrigin, tools: [echo] }),
      (error: unknown) => {
        assert.ok(error instanceof DriverError);
        assert.equal(error.code, "unknown_tool");
        assert.match(error.message, /missing/);
        return true;
      },
    );
  });

  it("bridge_tools_invoke_goes_through_tool_call", async () => {
    const { run, calls } = fakeRun({});
    const read: ToolDefinition = {
      name: "read",
      description: "reads",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      effects: ["read"],
      execute: () => ({ toolCallId: "c1", name: "read" }),
    };
    const bridge = bridgeTools(run, ["read"], { origin: externalOrigin, tools: [read] });
    assert.deepEqual(bridge.tools, [{ name: "read", description: "reads", schema: read.parameters, effects: ["read"] }]);
    const result = await bridge.invoke({ type: "tool_call", id: "c1", name: "read", arguments: { path: "a" } });
    assert.equal(result.value, "x");
    assert.equal(calls.executeTools.length, 1);
    assert.deepEqual(calls.executeTools[0], [{ type: "tool_call", id: "c1", name: "read", arguments: { path: "a" } }]);
    await assert.rejects(
      bridge.invoke({ type: "tool_call", id: "c2", name: "write", arguments: {} }),
      (error: unknown) => (error as DriverError).code === "unknown_tool",
    );
    assert.equal(calls.executeTools.length, 1, "a call outside the bridge never reaches executeTools");
  });
});
