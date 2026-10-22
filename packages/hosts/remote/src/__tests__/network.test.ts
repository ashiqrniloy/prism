import { expect, test } from "bun:test";
import { connectAgent, remoteHostUi, serveAgent } from "../index.js";
import { gatedAgent } from "./helpers.js";

for (const kind of ["websocket", "http"] as const) {
  test(`${kind}: run and server HostUi round trip`, async () => {
    const ui = remoteHostUi();
    const agent = await gatedAgent({ ui }).build();
    const served = serveAgent(agent, { transport: { kind, port: 0 }, hostUi: ui });
    try {
      const proxy = await connectAgent(
        { kind, url: served.url ?? "", token: served.token ?? "" },
        {
          host: { ui: { request: async () => ({ status: "answered", value: true }) as never } },
        },
      );
      try {
        expect((await (await proxy.session()).run("go")).status).toBe("completed");
        expect(JSON.stringify(proxy.inspect())).not.toContain(served.token ?? "");
      } finally {
        await proxy.dispose();
      }
    } finally {
      await served.close();
      await agent.dispose();
    }
  });
}

test("HTTP gates reject before dispatch and never echo credentials", async () => {
  const agent = await gatedAgent({ gate: false }).build();
  const served = serveAgent(agent, { transport: { kind: "http", port: 0, maxRequestBytes: 1024, allowedOrigins: ["https://good.test"] } });
  try {
    const url = `${served.url}/rpc`;
    for (const [headers, status, code] of [
      [{}, 401, "unauthorized"],
      [{ authorization: "Bearer wrong" }, 401, "unauthorized"],
      [{ authorization: `Bearer ${served.token}`, host: "evil.test" }, 403, "forbidden_host"],
      [{ authorization: `Bearer ${served.token}`, origin: "https://evil.test" }, 403, "forbidden_origin"],
    ] as const) {
      const response = await fetch(url, { method: "POST", headers });
      expect(response.status).toBe(status);
      const body = await response.text();
      expect(body).toContain(code);
      expect(body).not.toContain(served.token ?? "");
    }
    expect((await fetch(`${url}?token=${served.token}`, { method: "POST" })).status).toBe(401);
    const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${served.token}` }, body: "x".repeat(1025) });
    expect(response.status).toBe(413);
    expect((await agent.sessions.list()).items).toHaveLength(0);
  } finally {
    await served.close();
    await agent.dispose();
  }
});

test("literal secrets and unauthenticated public binds fail closed", async () => {
  const agent = await gatedAgent({ gate: false }).build();
  try {
    expect(() => serveAgent(agent, { transport: { kind: "http", token: "abc" } })).toThrow("literal_secret");
    expect(() => serveAgent(agent, { transport: { kind: "http", hostname: "0.0.0.0" } })).toThrow("unauthenticated_bind");
  } finally {
    await agent.dispose();
  }
});

test("custom authenticate is fail closed and pins the HTTP principal", async () => {
  const agent = await gatedAgent({ gate: false }).build();
  const served = serveAgent(agent, {
    transport: { kind: "http", port: 0 },
    authenticate: (request) => {
      const id = request.headers.get("x-caller");
      if (id === "throw") throw new Error("private input");
      return id ? { principal: { kind: "user", id } } : undefined;
    },
  });
  try {
    const stream = await fetch(`${served.url}/events`, { headers: { "x-caller": "a" } });
    const connection = stream.headers.get("x-prism-connection") ?? "";
    const denied = await fetch(`${served.url}/rpc?connection=${connection}`, { method: "POST", headers: { "x-caller": "b" }, body: "{}" });
    expect(denied.status).toBe(401);
    const thrown = await fetch(`${served.url}/events`, { headers: { "x-caller": "throw" } });
    expect(thrown.status).toBe(401);
    expect(await thrown.text()).not.toContain("private input");
    await stream.body?.cancel();
  } finally {
    await served.close();
    await agent.dispose();
  }
});

test("connection cap releases after SSE cancellation", async () => {
  const agent = await gatedAgent({ gate: false }).build();
  const served = serveAgent(agent, { transport: { kind: "http", port: 0 }, limits: { maxConnections: 1, keepAliveMs: 20 } });
  const headers = { authorization: `Bearer ${served.token}` };
  try {
    const first = await fetch(`${served.url}/events`, { headers });
    expect((await fetch(`${served.url}/events`, { headers })).status).toBe(503);
    await first.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const next = await fetch(`${served.url}/events`, { headers });
    expect(next.status).toBe(200);
    await next.body?.cancel();
  } finally {
    await served.close();
    await agent.dispose();
  }
});

for (const kind of ["http", "websocket"] as const) {
  test(`${kind}: authenticate principal reaches run and resume`, async () => {
    const agent = await gatedAgent().build();
    const seen: unknown[] = [];
    const wrapped = {
      ...agent,
      session: async (...args: Parameters<typeof agent.session>) => {
        const session = await agent.session(...args);
        return {
          ...session,
          stream(input: Parameters<typeof session.stream>[0], options?: Parameters<typeof session.stream>[1]) {
            seen.push(options?.principal);
            return session.stream(input, options);
          },
          resume(decisions: Parameters<typeof session.resume>[0], options?: Parameters<typeof session.resume>[1]) {
            seen.push(options?.principal);
            return session.resume(decisions, options);
          },
        };
      },
    };
    const principal = { kind: "service", id: "verified" };
    const served = serveAgent(wrapped, { transport: { kind, port: 0 }, authenticate: () => ({ principal }) });
    try {
      const proxy = await connectAgent({ kind, url: served.url ?? "" });
      try {
        const session = await proxy.session();
        const result = await session.run("go", { principal: { kind: "user", id: "forged" } });
        expect(result.status).toBe("suspended");
        const decisions = (result.pending ?? []).map((item) => ({ approvalId: item.approvalId, outcome: "allow_once" as const }));
        for await (const _event of session.resume(decisions)) {
        }
        expect(seen).toEqual([principal, principal]);
      } finally {
        await proxy.dispose();
      }
    } finally {
      await served.close();
      await agent.dispose();
    }
  });
}

test("WebSocket upgrade rejects token, Host and Origin before creating sessions", async () => {
  const agent = await gatedAgent({ gate: false }).build();
  const served = serveAgent(agent, { transport: { kind: "websocket", port: 0 } });
  try {
    const url = (served.url ?? "").replace(/^ws:/, "http:");
    for (const [extra, status] of [
      [{ authorization: "Bearer wrong" }, 401],
      [{ authorization: `Bearer ${served.token}`, host: "evil.test" }, 403],
      [{ authorization: `Bearer ${served.token}`, origin: "https://evil.test" }, 403],
    ] as const) {
      const response = await fetch(url, {
        headers: {
          ...extra,
          upgrade: "websocket",
          connection: "Upgrade",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          "sec-websocket-version": "13",
        },
      });
      expect(response.status).toBe(status);
      expect(await response.text()).not.toContain(served.token ?? "");
    }
    expect((await agent.sessions.list()).items).toHaveLength(0);
  } finally {
    await served.close();
    await agent.dispose();
  }
});
