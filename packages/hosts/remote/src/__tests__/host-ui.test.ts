import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@arnilo/prism";
import { bindRemoteHostUi, decisionFromAnswer } from "../host-ui.js";
import { pendingDecisionsOf, remoteHostUi } from "../index.js";
import { connectTestClient, gatedAgent } from "./helpers.js";

describe("remoteHostUi", () => {
  test("unbound_answers_unavailable", async () => {
    const ui = remoteHostUi();
    expect(await ui.request({ kind: "confirm", title: "x" })).toEqual({ status: "unavailable" });
  });

  test("wrong_answer_kind_is_unavailable", async () => {
    const ui = remoteHostUi();
    bindRemoteHostUi(ui, { canSecret: true, ask: async () => ({ status: "answered", value: true }) as never });
    expect(await ui.request({ kind: "input", title: "name" })).toEqual({ status: "unavailable" });
    expect(await ui.request({ kind: "confirm", title: "ok" })).toEqual({ status: "answered", value: true });
  });

  test("failed_ask_is_unavailable", async () => {
    const ui = remoteHostUi();
    bindRemoteHostUi(ui, { canSecret: true, ask: async () => Promise.reject(new Error("gone")) });
    expect(await ui.request({ kind: "confirm", title: "ok" })).toEqual({ status: "unavailable" });
  });

  test("detach_unbinds", async () => {
    const ui = remoteHostUi();
    const detach = bindRemoteHostUi(ui, { canSecret: true, ask: async () => ({ status: "answered", value: true }) });
    detach();
    expect(await ui.request({ kind: "confirm", title: "ok" })).toEqual({ status: "unavailable" });
  });

  test("bind_rejects_foreign_ui", () => {
    expect(() =>
      bindRemoteHostUi(
        { request: async () => ({ status: "unavailable" }) },
        { canSecret: false, ask: async () => ({ status: "unavailable" }) },
      ),
    ).toThrow();
  });

  test("secret_requires_capability", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui });
    const agent = await build();
    const asked: unknown[] = [];
    const { client, served } = await connectTestClient(agent, ui, (params) => {
      asked.push(params);
      return { status: "answered", value: "s3cret-value" };
    });
    expect(await ui.request({ kind: "secret", title: "key", ref: "keyring:k" })).toEqual({ status: "unavailable" });
    expect(asked).toHaveLength(0);
    expect(client.frames.join("\n")).not.toContain("keyring:k");
    await served.close();

    const ui2 = remoteHostUi();
    const agent2 = await gatedAgent({ gate: false, ui: ui2 }).build();
    const withSecret = await connectTestClient(agent2, ui2, () => ({ status: "answered" }), { hostUi: true, "hostUi.secret": true });
    expect(await ui2.request({ kind: "secret", title: "key", ref: "keyring:k" })).toEqual({ status: "answered" } as never);
    await withSecret.served.close();
  });
});

describe("pending decisions", () => {
  const suspended = (runId: string, ids: string[]): SessionEntry =>
    ({
      id: `s-${runId}`,
      sessionId: "s",
      runId,
      timestamp: "t",
      kind: "suspended_run",
      data: { malformed: true, ids },
    }) as never;

  test("pending_tip_rule_ignores_stale_suspension", async () => {
    const first = gatedAgent({});
    const agent = await first.build();
    const session = await agent.session();
    await session.run("go");
    const entries = await session.entries();
    expect(pendingDecisionsOf(entries)).toHaveLength(1);
    const later: SessionEntry = { id: "later", sessionId: session.id, timestamp: "t", kind: "message", data: {} } as never;
    expect(pendingDecisionsOf([...entries, later])).toEqual([]);
    const state: SessionEntry = { id: "ps", sessionId: session.id, timestamp: "t", kind: "package_state", data: {} } as never;
    expect(pendingDecisionsOf([...entries, state])).toHaveLength(1);
    expect(pendingDecisionsOf([suspended("r", ["a"])])).toEqual([]);
  });

  test("decision_mapping", () => {
    const approval = { approvalId: "a", kind: "tool_approval" as const, scope: {}, reason: "r" };
    expect(decisionFromAnswer(approval, { status: "answered", value: true })).toEqual({ approvalId: "a", outcome: "allow_once" });
    expect(decisionFromAnswer(approval, { status: "answered", value: false })?.outcome).toBe("reject_once");
    expect(decisionFromAnswer(approval, { status: "dismissed" })?.outcome).toBe("reject_once");
    expect(decisionFromAnswer(approval, { status: "unavailable" })).toBeUndefined();
    const ask = { approvalId: "e", kind: "elicitation" as const, scope: {}, reason: "q" };
    expect(decisionFromAnswer(ask, { status: "answered", value: '{"selectedId":"x"}' })?.elicitation).toEqual({ selectedId: "x" });
    expect(decisionFromAnswer(ask, { status: "answered", value: "not json" })).toBeUndefined();
    expect(decisionFromAnswer(ask, { status: "answered", value: "[1]" })).toBeUndefined();
  });
});
