import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { createMockProvider, providerDone, providerTextDelta, type ToolDefinition, type ToolRegistry } from "@arnilo/prism";
import type { ConnectMcpToolsOptions, McpClientAuthOptions, McpStreamableHttpTransport, McpToolBridge } from "@arnilo/prism-mcp";
import { AgentSdkConfigError, assembleMcpPlane, buildConnectOptions, defineAgent, McpConnectError, parseAgentSdkConfig } from "../index.js";

function stubTool(name: string): ToolDefinition {
  return {
    name,
    description: `stub:${name}`,
    execute: () => ({ toolCallId: "1", name, value: "done" }),
  };
}

function makeBridge(toolNames: readonly string[], onClose?: () => void): McpToolBridge {
  return {
    tools: toolNames.map(stubTool),
    refresh: async () => {},
    close: async () => {
      onClose?.();
    },
  };
}

function bridgeFor(options: ConnectMcpToolsOptions, onClose?: () => void): McpToolBridge {
  return makeBridge([`${options.serverId}_tool`], onClose);
}

describe("mcp plane", () => {
  it("reports host-disabled and preflight-failed servers without validating or connecting them", async () => {
    const connectorCalls: string[] = [];
    const plane = await assembleMcpPlane({
      servers: [
        // The malformed allow spec must not abort assembly: the server is disabled by the host.
        { serverId: "off", command: "stub", allow: "not-a-destination", disabledReason: "disabled in configuration" },
        {
          serverId: "preflight",
          url: "https://example.com/mcp",
          allow: "https://example.com",
          preflightError: "header TOKEN did not resolve",
        },
        { serverId: "on", command: "stub", allow: "stdio" },
      ],
      connector: async (options) => {
        connectorCalls.push(options.serverId);
        return bridgeFor(options);
      },
    });

    assert.deepStrictEqual(connectorCalls, ["on"]);
    assert.deepStrictEqual(
      plane.status.map((status) => status.state),
      ["disabled", "failed", "connected"],
    );
    assert.equal(plane.status[0]?.reason, "disabled in configuration");
    assert.equal(plane.status[1]?.error, "header TOKEN did not resolve");
    assert.deepStrictEqual(plane.connectedServerIds, ["on"]);

    await assert.rejects(
      () => plane.reconnect("off"),
      (error: unknown) => error instanceof AgentSdkConfigError,
    );
    await plane.close();
  });

  it("keeps the plane assembled when one server fails and reports per-server status", async () => {
    const plane = await assembleMcpPlane({
      servers: [
        { serverId: "alpha", command: "stub", allow: "stdio" },
        { serverId: "broken", command: "stub", allow: "stdio" },
        { serverId: "gamma", command: "stub", allow: "stdio" },
      ],
      connector: async (options) => {
        if (options.serverId === "broken") throw new Error("connection refused");
        return bridgeFor(options);
      },
    });

    assert.deepStrictEqual(
      plane.status.map((status) => status.state),
      ["connected", "failed", "connected"],
    );
    assert.deepStrictEqual(plane.connectedServerIds, ["alpha", "gamma"]);
    assert.strictEqual(plane.tools.length, 2);
    assert.equal(plane.status[1]?.error, "connection refused");

    await plane.close();
  });

  it("times out a hanging server at connectTimeoutMs and still connects the rest", async () => {
    const started = Date.now();
    const plane = await assembleMcpPlane({
      connectTimeoutMs: 40,
      servers: [
        { serverId: "slow", command: "stub", allow: "stdio" },
        { serverId: "fast", command: "stub", allow: "stdio" },
      ],
      connector: async (options) => {
        if (options.serverId === "slow") return new Promise<never>(() => {});
        return bridgeFor(options);
      },
    });
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 2_000, `expected a bounded startup, took ${elapsed}ms`);
    assert.deepStrictEqual(plane.connectedServerIds, ["fast"]);
    assert.equal(plane.status[0]?.state, "failed");
    assert.match(plane.status[0]?.error ?? "", /timed out/);

    await plane.close();
  });

  it("disables servers outside the host allow-list without connecting them", async () => {
    let connected = 0;
    const plane = await assembleMcpPlane({
      allow: ["stdio", "https://allowed.example.com/api"],
      servers: [
        { serverId: "local", command: "stub", allow: "stdio" },
        { serverId: "allowed", url: "https://allowed.example.com/api/mcp", allow: "https://allowed.example.com/api" },
        { serverId: "blocked", url: "https://blocked.example.com/mcp", allow: "https://blocked.example.com" },
      ],
      connector: async (options) => {
        connected++;
        return bridgeFor(options);
      },
    });

    assert.strictEqual(connected, 2);
    assert.deepStrictEqual(
      plane.status.map((status) => status.state),
      ["connected", "connected", "disabled"],
    );
    assert.match(plane.status[2]?.reason ?? "", /mcp\.allow/);
    assert.deepStrictEqual(plane.connectedServerIds, ["local", "allowed"]);

    await plane.close();
  });

  it("fails closed on malformed host allow entries and on invalid server allow specs", async () => {
    const servers = [{ serverId: "local", command: "stub", allow: "stdio" }] as const;

    await assert.rejects(
      () => assembleMcpPlane({ servers, allow: ["ftp://example.com"] }),
      (error: unknown) => error instanceof AgentSdkConfigError && /mcp\.allow/.test(error.message),
    );

    await assert.rejects(
      () => assembleMcpPlane({ servers: [{ serverId: "bad", command: "stub", allow: "https://example.com" }] }),
      (error: unknown) => error instanceof AgentSdkConfigError && /stdio transport requires/.test(error.message),
    );

    await assert.rejects(
      () => assembleMcpPlane({ servers: [{ serverId: "a", command: "stub", allow: "stdio" }], connectTimeoutMs: 0 }),
      (error: unknown) => error instanceof AgentSdkConfigError && /connectTimeoutMs/.test(error.message),
    );
  });

  it("redacts header values from failure status and reconnect errors", async () => {
    const secret = "super-secret-token-value";
    const server = {
      serverId: "auth",
      url: "https://api.example.com/mcp",
      allow: "https://api.example.com",
      headers: { Authorization: `Bearer ${secret}` },
    };
    let attempts = 0;
    const plane = await assembleMcpPlane({
      servers: [server],
      connector: async () => {
        attempts++;
        throw new Error(`401 Unauthorized for Bearer ${secret}`);
      },
    });

    const first = plane.status[0];
    assert.equal(first?.state, "failed");
    assert.ok(!(first?.error ?? "").includes(secret), "secret must not appear in status");
    assert.match(first?.error ?? "", /\[redacted\]/);

    await assert.rejects(
      () => plane.reconnect("auth"),
      (error: unknown) => {
        assert.ok(error instanceof McpConnectError);
        assert.equal(error.serverId, "auth");
        assert.ok(!error.message.includes(secret));
        return true;
      },
    );
    assert.strictEqual(attempts, 2);

    await plane.close();
  });

  it("reconnect re-registers bridged tools on the agent registry and drops stale names", async () => {
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    const variants: string[][] = [["first_tool"], ["second_tool"]];
    let calls = 0;
    let closes = 0;
    const app = await defineAgent({
      model: { provider: "mock", model: "mock-model" },
      provider,
      mcp: {
        servers: [{ serverId: "flaky", command: "stub", allow: "stdio" }],
        connector: async () => {
          const names = variants[Math.min(calls, variants.length - 1)] ?? [];
          calls++;
          return makeBridge(names, () => {
            closes++;
          });
        },
      },
    });

    const registry = app.agent.config.tools as ToolRegistry;
    assert.deepStrictEqual(
      registry.list().map((tool) => tool.name),
      ["first_tool"],
    );

    const status = await app.mcp.reconnect("flaky");
    assert.equal(status.state, "connected");
    assert.deepStrictEqual(
      app.mcp.getServerTools("flaky").map((tool) => tool.name),
      ["second_tool"],
    );
    assert.deepStrictEqual(app.mcp.getServerTools("missing"), []);
    assert.deepStrictEqual(
      registry.list().map((tool) => tool.name),
      ["second_tool"],
    );
    assert.strictEqual(closes, 1);
    assert.deepStrictEqual(app.connectedMcpServerIds, ["flaky"]);

    await app.dispose();
  });

  it("reconnect surfaces a failing server as a failed status and recovers after the fix", async () => {
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    let healthy = false;
    const app = await defineAgent({
      model: { provider: "mock", model: "mock-model" },
      provider,
      mcp: {
        servers: [{ serverId: "remote", command: "stub", allow: "stdio" }],
        connector: async (options) => {
          if (!healthy) throw new Error("ECONNREFUSED");
          return bridgeFor(options);
        },
      },
    });

    const registry = app.agent.config.tools as ToolRegistry;
    assert.deepStrictEqual(
      app.mcp.status.map((status) => status.state),
      ["failed"],
    );
    assert.strictEqual(registry.list().length, 0);
    assert.deepStrictEqual(app.connectedMcpServerIds, []);

    healthy = true;
    const status = await app.mcp.reconnect("remote");
    assert.equal(status.state, "connected");
    assert.deepStrictEqual(
      registry.list().map((tool) => tool.name),
      ["remote_tool"],
    );

    await app.dispose();

    // dispose() is idempotent and reconnect fails closed afterwards.
    await app.dispose();
    await assert.rejects(
      () => app.mcp.reconnect("remote"),
      (error: unknown) => error instanceof AgentSdkConfigError && /closed/.test(error.message),
    );
  });

  it("reconnect rejects unknown and disabled servers without touching bridges", async () => {
    let closes = 0;
    const plane = await assembleMcpPlane({
      allow: ["stdio"],
      servers: [
        { serverId: "local", command: "stub", allow: "stdio" },
        { serverId: "remote", url: "https://api.example.com/mcp", allow: "https://api.example.com" },
      ],
      connector: async (options) => bridgeFor(options, () => closes++),
    });

    await assert.rejects(
      () => plane.reconnect("missing"),
      (error: unknown) => error instanceof AgentSdkConfigError && /not configured/.test(error.message),
    );
    await assert.rejects(
      () => plane.reconnect("remote"),
      (error: unknown) => error instanceof AgentSdkConfigError && /disabled/.test(error.message),
    );
    assert.strictEqual(closes, 0);

    await plane.close();
    await plane.close();
    assert.strictEqual(closes, 1);
  });

  it("buildConnectOptions maps headers and OAuth auth onto the HTTP transport", () => {
    const auth = { state: {}, strategy: "dynamic" } as unknown as McpClientAuthOptions;
    const options = buildConnectOptions({
      serverId: "github",
      url: "https://api.githubcopilot.com/mcp/",
      allow: "https://api.githubcopilot.com",
      headers: { Authorization: "Bearer secret", "X-Trace": "1" },
      auth,
    });

    const transport = options.transport as McpStreamableHttpTransport;
    assert.deepStrictEqual(
      { ...(transport.requestInit?.headers as Record<string, string>) },
      {
        Authorization: "Bearer secret",
        "X-Trace": "1",
      },
    );
    assert.strictEqual(transport.auth, auth);
    assert.deepStrictEqual(transport.allowedOrigins, ["https://api.githubcopilot.com"]);
  });

  it("parses JSON mcp allow/connectTimeoutMs/headers and rejects unknown server keys", () => {
    const parsed = parseAgentSdkConfig({
      mcp: {
        allow: ["stdio"],
        connectTimeoutMs: 5_000,
        servers: [{ serverId: "local", command: "stub", allow: "stdio", connectTimeoutMs: 1_000, headers: { "X-Trace": "1" } }],
      },
    });
    assert.deepStrictEqual(parsed.mcp?.allow, ["stdio"]);
    assert.strictEqual(parsed.mcp?.connectTimeoutMs, 5_000);

    assert.throws(
      () =>
        parseAgentSdkConfig({
          mcp: { servers: [{ serverId: "local", command: "stub", allow: "stdio", auth: "oauth" }] },
        }),
      (error: unknown) => error instanceof AgentSdkConfigError && /auth/.test(error.message),
    );
    assert.throws(
      () => parseAgentSdkConfig({ mcp: { servers: [{ serverId: "local", command: "stub", allow: "stdio", connectTimeoutMs: -1 }] } }),
      (error: unknown) => error instanceof AgentSdkConfigError && /connectTimeoutMs/.test(error.message),
    );
  });
});
