import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "bun:test";
import { createAgent, type HostUi, type HostUiResponse } from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import approval from "@arnilo/prism-extensions/approval";
import { policyDefault, routeHostUi } from "../index.js";

const ui = (answer: HostUiResponse): HostUi => ({
  async request() {
    return answer as never;
  },
});
const confirm = { kind: "confirm", title: "Deploy?" } as const;

test("route_order_client_then_channel_then_default", async () => {
  for (const available of ["client", "channel", "none"]) {
    const router = routeHostUi([
      ...["client", "channel"].map((name) => ({
        name,
        ui: ui(name === available ? { status: "answered", value: false } : { status: "unavailable" }),
      })),
      policyDefault(),
    ]);
    expect((await router.request(confirm)).status).toBe(available === "none" ? "unavailable" : "answered");
    expect((await router.answers()).map((row) => row.route)).toEqual(
      available === "client" ? ["client"] : available === "channel" ? ["client", "channel"] : ["client", "channel", "policy"],
    );
  }
});

test("route_kind_limits_are_honored", async () => {
  const router = routeHostUi([
    { name: "channel", kinds: ["confirm"], ui: ui({ status: "dismissed" }) },
    { name: "client", kinds: ["terminal"], ui: ui({ status: "answered", value: { exitCode: 0 } }) },
  ]);
  expect(await router.request({ kind: "terminal", title: "Login", command: ["login"] })).toEqual({
    status: "answered",
    value: { exitCode: 0 },
  });
  expect((await router.answers()).map((row) => row.route)).toEqual(["client"]);
});

test("secret_and_terminal_need_explicit_kinds", async () => {
  const router = routeHostUi([
    {
      name: "ordinary",
      ui: {
        async request() {
          throw new Error("must not be asked");
        },
      },
    },
  ]);
  expect(await router.request({ kind: "secret", title: "Key", ref: "env:KEY" })).toEqual({ status: "unavailable" });
  expect(await router.request({ kind: "terminal", title: "Login", command: ["login"] })).toEqual({ status: "unavailable" });
  expect(await router.answers()).toEqual([]);
});

test("route_timeout_moves_on_and_records_late", async () => {
  let finish!: (answer: HostUiResponse) => void;
  const router = routeHostUi([
    {
      name: "slow",
      timeoutMs: 1,
      ui: {
        request: () =>
          new Promise((resolve) => {
            finish = resolve as typeof finish;
          }),
      },
    },
    policyDefault({ confirm: "dismiss" }),
  ]);
  expect(await router.request(confirm)).toEqual({ status: "dismissed" });
  finish({ status: "answered", value: true });
  await sleep(5);
  expect((await router.answers()).map((row) => row.status)).toEqual(["unavailable", "dismissed", "late"]);
});

test("route_throw_is_not_an_answer", async () => {
  const router = routeHostUi([
    {
      name: "broken",
      ui: {
        async request() {
          throw new Error("sensitive error");
        },
      },
    },
    policyDefault(),
  ]);
  expect(await router.request(confirm)).toEqual({ status: "unavailable" });
  expect((await router.answers())[0]?.status).toBe("error");
  expect(JSON.stringify(await router.answers())).not.toContain("sensitive");
});

test("policy_default_refuses_allow", () => {
  expect(() => policyDefault({ confirm: "allow" } as never)).toThrow("policy_allow_refused");
  expect(() => policyDefault({ input: "ack" } as never)).toThrow("invalid_policy");
});

test("policy_defaults_dismiss_and_ack", async () => {
  const route = policyDefault({ confirm: "dismiss", notify: "ack" });
  expect(await route.ui.request(confirm)).toEqual({ status: "dismissed" });
  expect(await route.ui.request({ kind: "notify", level: "info", message: "Done" })).toEqual({ status: "answered", value: undefined });
  expect(await route.ui.request({ kind: "input", title: "Name" })).toEqual({ status: "unavailable" });
});

test("router_rejects_bad_config", () => {
  expect(() => routeHostUi([])).toThrow("no_routes");
  expect(() => routeHostUi([policyDefault(), policyDefault()])).toThrow("duplicate_route");
  expect(() => routeHostUi([{ name: "bad", ui: ui({ status: "unavailable" }), kinds: ["bogus"] as never }])).toThrow("unknown_kind");
  for (const timeoutMs of [0, -1, 600001, NaN, Infinity, 1.5])
    expect(() => routeHostUi([{ ...policyDefault(), timeoutMs }])).toThrow("invalid_timeout");
  for (const maxAnswers of [0, 100001, NaN, 1.5])
    expect(() => routeHostUi([policyDefault()], { limits: { maxAnswers } })).toThrow("invalid_limit");
});

test("no_route_answers_kernel_suspends", async () => {
  const router = routeHostUi([policyDefault()]);
  const agent = await createAgent({
    model: { provider: "mock", model: "test" },
    host: { ui: router },
    packages: [
      mockProvider([[{ type: "tool_call", call: { type: "tool_call", id: "call", name: "deploy", arguments: {} } }, { type: "done" }]]),
      approval({ mode: "ask" }),
    ],
    tools: {
      add: [
        {
          name: "deploy",
          parameters: { type: "object", properties: {} },
          execute(_args, context) {
            throw new Error(`must not execute ${context.toolCallId}`);
          },
        },
      ],
    },
  });
  const session = await agent.session();
  const events = [];
  for await (const event of session.stream("deploy", { interactive: true })) events.push(event);
  expect(events.some((event) => event.type === "run.suspended")).toBe(true);
  expect((await session.entries()).some((entry) => entry.kind === "suspended_run")).toBe(true);
  await agent.dispose();
});

test("malformed_answers_cannot_approve", async () => {
  for (const response of [null, { status: "answered", value: "yes" }, { status: "unknown" }]) {
    const router = routeHostUi([{ name: "invalid", ui: ui(response as never) }, policyDefault()]);
    expect(await router.request(confirm)).toEqual({ status: "unavailable" });
    expect((await router.answers())[0]?.status).toBe("unavailable");
  }
});

test("late_rejection_is_observed_without_changing_the_winner", async () => {
  let reject!: (error: Error) => void;
  const router = routeHostUi([
    {
      name: "slow",
      timeoutMs: 1,
      ui: {
        request: () =>
          new Promise((_resolve, fail) => {
            reject = fail;
          }),
      },
    },
    policyDefault({ confirm: "dismiss" }),
  ]);
  expect(await router.request(confirm)).toEqual({ status: "dismissed" });
  reject(new Error("sensitive late error"));
  await sleep(5);
  expect((await router.answers()).map((row) => row.status)).toEqual(["unavailable", "dismissed", "error"]);
});
