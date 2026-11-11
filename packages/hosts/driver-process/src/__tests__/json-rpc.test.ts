import { expect, test } from "bun:test";
import { harness } from "./fixtures/harness.js";
import { rpcAdapter, rpcSource } from "./fixtures/rpc-adapter.js";

async function run(options: Parameters<typeof harness>[0], check: (h: Awaited<ReturnType<typeof harness>>, result: any) => void) {
  const h = await harness(options);
  try {
    check(h, await h.session.run("go"));
  } finally {
    await h.close();
  }
}

test("json_rpc_open_requests_run_before_prompt", async () => {
  await run(
    { adapter: rpcAdapter, source: rpcSource("notice('order',JSON.stringify({methods,params:m.params}));done();") },
    (h, result) => {
      expect(result.error).toBeUndefined();
      const event = h.events.find((event: any) => event.name === "agent.notice") as any;
      expect(JSON.parse(event.data.message)).toEqual({
        methods: ["initialize", "initialized", "thread.start", "turn.start"],
        params: { session: "thread-1" },
      });
    },
  );
});
for (const allow of [true, false])
  test(`json_rpc_approval_routes_to_ask_${allow}`, async () => {
    const calls: any[] = [];
    await run(
      {
        source: rpcSource("const answer=await request('approval.request');notice('answer',JSON.stringify(answer));done();"),
        adapter: (base) => ({
          ...rpcAdapter(base),
          requests: {
            "approval.request": async ({ ask }) => {
              const answer = await ask({ toolCallId: "t", name: "write", args: {}, effects: ["write"] });
              return { decision: "allow" in answer && answer.allow ? "allow" : "deny" };
            },
          },
        }),
        agent: {
          hooks: (hooks) => {
            hooks.on("tool.call", (event) => {
              calls.push(event);
              return allow ? "allow" : { deny: "blocked" };
            });
          },
        },
      },
      (h, result) => {
        expect(result.error).toBeUndefined();
        expect(JSON.stringify(h.events)).toContain(allow ? "allow" : "deny");
        expect(calls[0].origin.kind).toBe("external");
      },
    );
  });
for (const method of ["unknown", "toString", "__proto__"])
  test(`json_rpc_unknown_request_${method}_fails`, async () => {
    await run(
      { adapter: (base) => ({ ...rpcAdapter(base), requests: {} }), source: rpcSource(`await request('${method}');`) },
      (_, result) => {
        expect(result.error?.message).toContain("vendor_request_unhandled");
        expect(result.error?.message).toContain(method);
      },
    );
  });
test("json_rpc_handler_throw_fails_and_redacts", async () => {
  await run(
    {
      source: rpcSource("await request('bad');"),
      adapter: (base) => ({
        ...rpcAdapter(base),
        configure: () => ({ env: { SECRET: "canary-rpc-secret" } }),
        requests: {
          bad: () => {
            throw Error("canary-rpc-secret");
          },
        },
      }),
    },
    (_, result) => {
      expect(result.error?.message).toContain("vendor_request_failed");
      expect(result.error?.message).toContain("[REDACTED]");
      expect(JSON.stringify(result)).not.toContain("canary-rpc-secret");
    },
  );
});
test("json_rpc_client_tool_call_runs_through_execute_tools", async () => {
  const calls: any[] = [];
  await run(
    {
      config: { prismTools: ["lookup"] },
      agent: {
        tools: {
          add: [
            {
              name: "lookup",
              parameters: { type: "object", properties: {} },
              execute: async () => ({ toolCallId: "t", name: "lookup", value: "looked-up" }),
            },
          ],
        },
        hooks: (hooks) => {
          hooks.on("tool.call", (event) => {
            calls.push(event);
            return "allow";
          });
        },
      },
      source: rpcSource("const answer=await request('tool.call');notice('answer',JSON.stringify(answer));done();"),
      adapter: (base) => ({
        ...rpcAdapter(base),
        requests: {
          "tool.call": async ({ bridge }) =>
            String((await bridge.invoke({ type: "tool_call", id: "t", name: "lookup", arguments: {} })).value),
        },
      }),
    },
    (h, result) => {
      expect(result.error).toBeUndefined();
      expect(JSON.stringify(h.events)).toContain("looked-up");
      expect(calls[0].origin.kind).toBe("external");
    },
  );
});
test("json_rpc_question_routes_to_host_ui", async () => {
  let asked = false;
  await run(
    {
      agent: {
        host: {
          ui: {
            request: async () => {
              asked = true;
              return { status: "answered", value: "answer" } as any;
            },
          },
        },
      },
      source: rpcSource("const answer=await request('question');notice('answer',JSON.stringify(answer));done();"),
      adapter: (base) => ({
        ...rpcAdapter(base),
        requests: {
          question: async ({ host }) => {
            const answer = await host.ui?.request({ kind: "input", title: "Question" });
            return answer?.status === "answered" ? String(answer.value) : null;
          },
        },
      }),
    },
    (h, result) => {
      expect(result.error).toBeUndefined();
      expect(asked).toBe(true);
      expect(JSON.stringify(h.events)).toContain("answer");
    },
  );
});
test("json_rpc_notifications_observed_in_order", async () => {
  await run({ adapter: rpcAdapter, source: rpcSource("notice('first','one');notice('second','two');done();") }, (h, result) => {
    expect(result.error).toBeUndefined();
    const events = JSON.stringify(h.events);
    expect(events.indexOf("first")).toBeLessThan(events.indexOf("second"));
  });
});
test("json_rpc_no_ui_approval_suspends", async () => {
  await run(
    {
      source: rpcSource("const answer=await request('approval');notice('answer',JSON.stringify(answer));done();"),
      agent: {
        hooks: (hooks) => {
          hooks.on("tool.call", () => ({ ask: "Approve" }));
        },
      },
      adapter: (base) => ({
        ...rpcAdapter(base),
        requests: { approval: ({ ask }) => ask({ toolCallId: "t", name: "write", args: {}, effects: ["write"] }) },
      }),
    },
    (h, result) => {
      expect(result.error).toBeUndefined();
      expect(JSON.stringify(h.events)).toContain("approval_pending");
      expect(result.status).toBe("suspended");
    },
  );
});
test("json_rpc_failure_during_open_does_not_hang", async () => {
  await run(
    {
      adapter: rpcAdapter,
      source: `import {createInterface} from 'node:readline';createInterface({input:process.stdin}).once('line',()=>console.log(JSON.stringify({jsonrpc:'2.0',id:99,method:'unknown'})));`,
    },
    (_, result) => {
      expect(result.error?.message).toContain("vendor_request_unhandled");
    },
  );
});

test("json_rpc_turn_result_can_end_turn_without_notification", async () => {
  await run(
    {
      adapter: (base) => ({
        ...rpcAdapter(base),
        open: () => [],
        encode: { prompt: () => ({ method: "turn.start", onResult: () => ({ activity: [], turnEnd: true }) }) },
      }),
      source: `import {createInterface} from 'node:readline';createInterface({input:process.stdin}).once('line',line=>{const m=JSON.parse(line);console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{done:true}}));});`,
    },
    (_, result) => expect(result.error).toBeUndefined(),
  );
});
test("json_rpc_capture_includes_invalid_and_unknown_notifications", async () => {
  await run(
    {
      adapter: rpcAdapter,
      config: { capture: "all" },
      source: rpcSource("console.log('invalid json');write({jsonrpc:'2.0',method:'unknown.notification',params:{x:1}});done();"),
    },
    (h, result) => {
      expect(result.error).toBeUndefined();
      expect(JSON.stringify(h.events)).toContain("invalid json");
      expect(JSON.stringify(h.events)).toContain("unknown.notification");
    },
  );
});
test("json_rpc_open_frame_backlog_is_bounded", async () => {
  await run(
    {
      adapter: rpcAdapter,
      source: `import {createInterface} from 'node:readline';createInterface({input:process.stdin}).once('line',()=>{for(let i=0;i<257;i++)console.log(JSON.stringify({jsonrpc:'2.0',method:'activity',params:{kind:'notice',level:'info',code:'flood',message:'flood'}}));});`,
    },
    (_, result) => {
      expect(result.error?.message).toContain("pending frame limit exceeded");
    },
  );
});

test("json_rpc_open_notifications_precede_result_and_prompt", async () => {
  const decoded: string[] = [];
  await run(
    {
      adapter: (base) => ({
        ...rpcAdapter(base),
        open: () => [{ method: "initialize" }],
        decode(frame) {
          const item = frame as any;
          if (item.method === "session") {
            decoded.push("notification");
            return { activity: [], sessionId: "notify-session" };
          }
          if (item.initialized) {
            decoded.push("result");
            return { activity: [] };
          }
          return rpcAdapter(base).decode(frame);
        },
      }),
      source: `import {createInterface} from 'node:readline';createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); const write=x=>console.log(JSON.stringify(x));
 if(m.method==='initialize'){write({jsonrpc:'2.0',method:'session',params:{}});write({jsonrpc:'2.0',id:m.id,result:{initialized:true}});}
 if(m.method==='turn.start'){write({jsonrpc:'2.0',id:m.id,result:{}});write({jsonrpc:'2.0',method:'activity',params:{kind:'notice',level:'info',code:'session',message:m.params.session}});write({jsonrpc:'2.0',method:'turn.completed',params:{}});}
 });`,
    },
    (h, result) => {
      expect(result.error).toBeUndefined();
      expect(decoded).toEqual(["notification", "result"]);
      expect(JSON.stringify(h.events)).toContain("notify-session");
    },
  );
});

test("json_rpc_unmapped_on_result_retains_raw_value", async () => {
  await run(
    {
      config: { capture: "all" },
      adapter: (base) => ({
        ...rpcAdapter(base),
        open: () => [{ method: "initialize", onResult: () => ({ activity: [], unmapped: true }) }],
      }),
      source: rpcSource("done();"),
    },
    (h, result) => {
      expect(result.error).toBeUndefined();
      expect(JSON.stringify(h.events)).toContain("initialized");
      expect(JSON.stringify(h.events)).toContain("agent.raw");
    },
  );
});

test("json_rpc_request_failure_stops_accepting_new_handlers", async () => {
  let invoked = false;
  await run(
    {
      adapter: (base) => ({
        ...rpcAdapter(base),
        requests: {
          late: () => {
            invoked = true;
            return null;
          },
        },
      }),
      source: rpcSource("write({jsonrpc:'2.0',id:101,method:'unknown'});write({jsonrpc:'2.0',id:102,method:'late'});"),
    },
    (_, result) => {
      expect(result.error?.message).toContain("vendor_request_unhandled");
      expect(invoked).toBe(false);
    },
  );
});
