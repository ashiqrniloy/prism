import { expect, test } from "bun:test";
import type { DriverRunContext } from "@arnilo/prism/driver-kit";
import { createTurn } from "../turn.js";
import { testAdapter } from "./fixtures/test-adapter.js";

function setup(mode: "none" | "mid-turn" | "next-turn" = "none", capture = "mapped") {
  const observed: any[] = [],
    sent: any[] = [];
  const adapter = testAdapter(["unused"]);
  const ctx = {
    config: { capture },
    run: {
      observe: async (a: unknown) => {
        observed.push(a);
      },
      end: async () => ({ continue: true, reason: "again" }),
      state: () => ({ append: async () => {} }),
    },
    services: {
      consume: () => ({ guard: { noteLimit: (_: string, signal: any) => ({ action: "defer", deferUntil: signal.deferUntil }) } }),
    },
    lease: { profile: "me" },
  } as unknown as DriverRunContext;
  Object.assign(adapter.descriptor, { controls: { ...adapter.descriptor.controls, steer: mode } });
  const send = async (frame: unknown) => {
    sent.push(frame);
  };
  return { adapter, ctx, observed, sent, send, turn: () => createTurn(adapter, ctx, (value) => value) };
}
for (const capture of ["all", "mapped"])
  test(`capture_${capture}_includes_invalid_and_unmapped`, async () => {
    const h = setup("none", capture),
      turn = h.turn();
    await turn.frame({ kind: "invalid", raw: "bad json" }, h.send);
    await turn.frame({ kind: "value", value: { type: "unknown" } }, h.send);
    await turn.finish();
    expect(h.observed.length).toBe(capture === "all" ? 2 : 1);
    expect(JSON.stringify(h.observed)).toContain(capture === "all" ? "bad json" : "2 unmapped frames");
  });
for (const mode of ["none", "mid-turn", "next-turn"] as const)
  test(`steer_${mode}`, async () => {
    const h = setup(mode);
    Object.assign(h.adapter, {
      encode: { prompt: (input: unknown) => ({ prompt: JSON.stringify(input) }), steer: () => ({ steer: true }) },
    });
    const turn = h.turn();
    await turn.steer({ role: "user", content: [{ type: "text", text: "change" }] }, h.send);
    expect(h.sent.length).toBe(mode === "mid-turn" ? 1 : 0);
    const ended = await turn.frame({ kind: "value", value: { type: "turn.done" } }, h.send);
    expect(ended).toBe(mode !== "next-turn");
    if (mode === "none") expect(h.observed[0].code).toBe("steer_unsupported");
    else expect(h.sent.length).toBe(1);
  });
test("stop_obeys_descriptor_and_sends_continuation", async () => {
  const h = setup();
  h.adapter.decode = () => ({ activity: [], stop: true });
  Object.assign(h.adapter, { encode: { ...h.adapter.encode, continue: (reason: string) => ({ reason }) } });
  expect(await h.turn().frame({ kind: "value", value: {} }, h.send)).toBe(true);
  expect(h.sent).toEqual([]);
  Object.assign(h.adapter.descriptor, { controls: { ...h.adapter.descriptor.controls, continueOnStop: true } });
  expect(await h.turn().frame({ kind: "value", value: {} }, h.send)).toBe(false);
  expect(h.sent).toEqual([{ reason: "again" }]);
});
for (const code of ["rate_limit", "quota", "billing", "auth"] as const)
  test(`limit_${code}_is_not_retried`, async () => {
    const h = setup();
    h.adapter.decode = () => ({ activity: [{ kind: "notice", level: "error", code, message: "limit" }] });
    h.adapter.notices = () => ({ code, deferUntil: "2030-01-01T00:00:00Z" });
    try {
      await h.turn().frame({ kind: "value", value: {} }, h.send);
      throw Error("expected limit");
    } catch (e: any) {
      expect(e.code).toBe("vendor_limit");
      expect(e.deferUntil).toBe("2030-01-01T00:00:00Z");
    }
    expect(h.sent).toEqual([]);
  });
test("throwing_classifier_fails_closed", async () => {
  const h = setup();
  h.adapter.decode = () => ({ activity: [{ kind: "notice", level: "error", code: "bad", message: "bad" }] });
  h.adapter.notices = () => {
    throw Error("classifier failed");
  };
  await expect(h.turn().frame({ kind: "value", value: {} }, h.send)).rejects.toThrow("classifier failed");
});
