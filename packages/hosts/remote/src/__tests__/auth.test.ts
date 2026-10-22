import { expect, test } from "bun:test";
import { bearerMatches, resolveToken } from "../auth.js";

test("tokens are random 32 bytes, env refs resolve once, literals and missing refs fail closed", () => {
  const token = resolveToken() as string;
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(resolveToken()).not.toBe(token);
  process.env.PRISM_REMOTE_TEST_TOKEN = "test-token-value";
  try {
    const value = resolveToken("env:PRISM_REMOTE_TEST_TOKEN") as string;
    process.env.PRISM_REMOTE_TEST_TOKEN = "changed";
    expect(value).toBe("test-token-value");
    expect(bearerMatches(new Request("http://local", { headers: { authorization: `Bearer ${value}` } }), value)).toBe(true);
    expect(bearerMatches(new Request("http://local?token=test-token-value"), value)).toBe(false);
  } finally {
    delete process.env.PRISM_REMOTE_TEST_TOKEN;
  }
  expect(() => resolveToken("env:PRISM_REMOTE_TEST_TOKEN")).toThrow("unavailable");
  expect(() => resolveToken("literal-value")).toThrow("literal_secret");
});

test("keyring resolves once before binding and failure leaves no listener", async () => {
  const { spyOn } = await import("bun:test");
  const { secrets } = await import("bun");
  const { serveAgent } = await import("../serve.js");
  const { gatedAgent } = await import("./helpers.js");
  const agent = await gatedAgent({ gate: false }).build();
  const lookup = spyOn(secrets, "get").mockResolvedValue("keyring-test-value");
  try {
    const served = serveAgent(agent, { transport: { kind: "http", port: 0, token: "keyring:remote" } });
    try {
      expect(served.url).toBeUndefined();
      await served.ready;
      expect(served.token).toBe("keyring-test-value");
      expect(served.url).toStartWith("http://127.0.0.1:");
      expect(lookup).toHaveBeenCalledWith({ service: "prism", name: "remote" });
      expect(lookup).toHaveBeenCalledTimes(1);
    } finally {
      await served.close();
    }
    lookup.mockRejectedValue(new Error("private backend diagnostic"));
    const failed = serveAgent(agent, { transport: { kind: "http", port: 0, token: "keyring:missing" } });
    try {
      await expect(failed.ready).rejects.toThrow("token reference unavailable");
      expect(failed.url).toBeUndefined();
    } finally {
      await failed.close();
    }
  } finally {
    lookup.mockRestore();
    await agent.dispose();
  }
});
