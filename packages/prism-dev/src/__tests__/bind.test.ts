/**
 * Plan 040 Task 1 — bind policy: loopback by default, non-loopback refused
 * unless an explicit remoteAuthorize callback opts in.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgent, createMockProvider, providerDone, providerTextDelta } from "@arnilo/prism";
import { createPrismDevInspector, DevInspectorError } from "../index.js";

function mockAgent(): ReturnType<typeof createAgent> {
  return createAgent({
    model: { provider: "mock", model: "demo" },
    provider: createMockProvider([providerTextDelta("ok"), providerDone()]),
  });
}

function nonLoopbackAuthorize(): { ownership: { userId: string } } {
  return { ownership: { userId: "host-user" } };
}

describe("loopback bind policy (plan 040 Task 1)", () => {
  it("default bind is loopback and listens", async () => {
    const inspector = createPrismDevInspector({ agent: mockAgent(), port: 0 });
    await inspector.listen();
    try {
      assert.equal(inspector.host, "127.0.0.1");
      assert.ok(inspector.url.startsWith("http://127.0.0.1:"));
      assert.equal(new URL(inspector.url).hostname, "127.0.0.1");
      // the served page is only reachable on the loopback interface
      assert.ok(
        new URL(inspector.url).hostname === "127.0.0.1" || new URL(inspector.url).hostname === "[::1]",
        "inspector must never expose a non-loopback default",
      );
      assert.ok(inspector.url.includes("/prism"), "server base path is preserved in the inspector URL");
    } finally {
      await inspector.close();
    }
  });

  it("refuses non-loopback host without remoteAuthorize (fail closed) and without real authorize", () => {
    assert.throws(
      () => createPrismDevInspector({ agent: mockAgent(), host: "0.0.0.0" }),
      (error: unknown) => error instanceof DevInspectorError && error.code === "ERR_PRISM_DEV_REMOTE_BIND",
    );
    assert.throws(
      () => createPrismDevInspector({ agent: mockAgent(), host: "192.168.1.10", remoteAuthorize: () => true }),
      (error: unknown) => error instanceof DevInspectorError && error.code === "ERR_PRISM_DEV_REMOTE_BIND",
      "non-loopback bind also requires a real authorize callback",
    );
  });

  it("non-loopback opt-in requires remoteAuthorize to resolve true at listen()", async () => {
    const refused = createPrismDevInspector({
      agent: mockAgent(),
      host: "0.0.0.0",
      port: 0,
      remoteAuthorize: () => false,
      authorize: nonLoopbackAuthorize,
    });
    await assert.rejects(() => refused.listen(), DevInspectorError);

    const allowed = createPrismDevInspector({
      agent: mockAgent(),
      host: "0.0.0.0",
      port: 0,
      remoteAuthorize: () => true,
      authorize: nonLoopbackAuthorize,
    });
    try {
      await allowed.listen();
      assert.ok(allowed.url.startsWith("http://0.0.0.0:"));
    } finally {
      await allowed.close();
    }
  });
});
