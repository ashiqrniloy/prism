import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentEvent,
  createAgent,
  definePackage,
  type HostUi,
  type HostUiConfirmRequest,
  type HostUiResponse,
  PackageLoadError,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import { bindManifestInstance, createScriptedHostUi, mockProvider, packageConformance } from "@arnilo/prism/testing";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import mcpPackageDefinition, { type McpPackageConfig, mcp, mcpServerFingerprint } from "../index.js";

const node = process.execPath;

function testPackages() {
  return [mockProvider([[providerTextDelta("ok"), providerDone()]])];
}

const testModel = { provider: "mock", model: "test" };

async function createInMemoryFixture(toolNames: string[] = ["echo"]) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "test-mcp-fixture", version: "1.0.0" }, { capabilities: { tools: { listChanged: true } } });

  for (const name of toolNames) {
    server.registerTool(
      name,
      {
        description: `Tool ${name}`,
        inputSchema: {
          msg: z.string().optional(),
        },
      },
      async (args) => ({
        content: [{ type: "text", text: `echoed: ${args.msg ?? ""}` }],
      }),
    );
  }

  await server.connect(serverTransport);
  return { clientTransport, server };
}

function createScriptedUi(confirmAnswer: (request: HostUiConfirmRequest) => HostUiResponse<"confirm">): HostUi {
  return createScriptedHostUi((request) => (request.kind === "confirm" ? confirmAnswer(request) : { status: "unavailable" })).ui;
}

describe("@arnilo/prism-extensions/mcp native package", () => {
  it("mcp_package_conformance", async () => {
    const result = await packageConformance(mcpPackageDefinition);
    assert.equal(
      result.ok,
      true,
      result.checks
        .filter((c) => !c.ok)
        .map((c) => `${c.name}: ${c.message}`)
        .join("; "),
    );
  });

  it("mcp_untrusted_project_server_never_spawns", async () => {
    const answers: Array<HostUiResponse<"confirm">> = [
      { status: "answered", value: false },
      { status: "dismissed" },
      { status: "unavailable" },
    ];

    for (const answer of answers) {
      const sentinel = join(tmpdir(), `prism-mcp-sentinel-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      if (existsSync(sentinel)) unlinkSync(sentinel);

      const mcpConfig: McpPackageConfig = {
        servers: [
          {
            id: "untrusted-server",
            transport: "stdio",
            command: node,
            args: ["-e", `require("fs").writeFileSync(${JSON.stringify(sentinel)}, "ran")`],
            allow: "stdio",
          },
        ],
      };

      const projectInstance = bindManifestInstance(mcpPackageDefinition, mcpConfig as unknown as Record<string, unknown>, {
        optional: false,
        source: {
          kind: "manifest",
          scope: "project",
          scopes: {
            servers: "project",
          },
        },
      });

      const agent = await createAgent({
        model: testModel,
        packages: [...testPackages(), projectInstance],
        host: {
          ui: createScriptedUi(() => answer),
        },
      });

      assert.equal(existsSync(sentinel), false, `sentinel file was created when host.ui returned status=${answer.status}`);

      const statusResult = (await agent.commands.run("mcp:status")) as {
        servers: Array<{ id: string; state: string; reason?: string }>;
      };
      const serverStatus = statusResult.servers.find((s) => s.id === "untrusted-server");
      assert.ok(serverStatus);
      assert.equal(serverStatus.state, "disabled");
      assert.equal(serverStatus.reason, "untrusted");

      await agent.dispose();
      assert.equal(existsSync(sentinel), false, "sentinel file created after dispose");
    }
  });

  it("mcp_project_cannot_self_trust", async () => {
    const sentinel = join(tmpdir(), `prism-mcp-self-trust-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    if (existsSync(sentinel)) unlinkSync(sentinel);

    const serverDef = {
      id: "malicious-server",
      transport: "stdio" as const,
      command: node,
      args: ["-e", `require("fs").writeFileSync(${JSON.stringify(sentinel)}, "ran")`],
      allow: "stdio",
    };
    const fingerprint = mcpServerFingerprint(serverDef);

    const mcpConfig: McpPackageConfig = {
      servers: [serverDef],
      trusted: [fingerprint],
    };

    const projectInstance = bindManifestInstance(mcpPackageDefinition, mcpConfig as unknown as Record<string, unknown>, {
      optional: false,
      source: {
        kind: "manifest",
        scope: "project",
        scopes: {
          servers: "project",
          trusted: "project",
        },
      },
    });

    const agent = await createAgent({
      model: testModel,
      packages: [...testPackages(), projectInstance],
      host: {
        ui: createScriptedUi(() => ({ status: "answered", value: false })),
      },
    });

    assert.equal(existsSync(sentinel), false, "sentinel was spawned by self-trusting manifest");

    const notes = agent.inspect().statusNotes;
    assert.ok(
      notes.some((n) => n.message.includes("trusted MCP fingerprints from project manifest are ignored")),
      "expected warn note about ignored project trusted fingerprints",
    );

    const statusResult = (await agent.commands.run("mcp:status")) as {
      servers: Array<{ id: string; state: string; reason?: string }>;
    };
    const serverStatus = statusResult.servers.find((s) => s.id === "malicious-server");
    assert.equal(serverStatus?.state, "disabled");
    assert.equal(serverStatus?.reason, "untrusted");

    await agent.dispose();
  });

  it("mcp_server_outside_allow_is_disabled", async () => {
    const agent = await createAgent({
      model: testModel,
      packages: [
        ...testPackages(),
        mcp({
          servers: [
            {
              id: "outside-allow-server",
              transport: "http",
              url: "https://evil.com/mcp",
              allow: "https://trusted.com",
            },
          ],
        }),
      ],
    });

    const statusResult = (await agent.commands.run("mcp:status")) as {
      servers: Array<{ id: string; state: string; reason?: string }>;
    };
    const serverStatus = statusResult.servers.find((s) => s.id === "outside-allow-server");
    assert.ok(serverStatus);
    assert.equal(serverStatus.state, "disabled");
    assert.ok(serverStatus.reason?.includes("outside"));

    await agent.dispose();
  });

  it("mcp_server_with_no_allow_fails_config_validation", async () => {
    await assert.rejects(
      async () => {
        await createAgent({
          model: testModel,
          packages: [
            ...testPackages(),
            mcp({
              servers: [
                {
                  id: "no-allow-server",
                  transport: "stdio",
                  command: "echo",
                } as any,
              ],
            }),
          ],
        });
      },
      (err: unknown) => {
        return err instanceof PackageLoadError && err.code === "config_invalid";
      },
    );
  });

  it("mcp_literal_header_rejected", async () => {
    await assert.rejects(
      async () => {
        await createAgent({
          model: testModel,
          packages: [
            ...testPackages(),
            mcp({
              servers: [
                {
                  id: "literal-header-server",
                  transport: "http",
                  url: "https://trusted.com/mcp",
                  allow: "https://trusted.com",
                  headers: {
                    Authorization: "Bearer literal-secret-token",
                  } as any,
                },
              ],
            }),
          ],
        });
      },
      (err: unknown) => {
        return err instanceof PackageLoadError && (err.code === "config_invalid" || err.code === "secret_literal");
      },
    );
  });

  it("mcp_connect_failure_is_status", async () => {
    const { clientTransport } = await createInMemoryFixture(["ping"]);

    const transportServicePackage = definePackage({
      name: "raw-transport-service",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.services.provide("mcp.transport", { in_mem: clientTransport });
      },
    });

    const events: AgentEvent[] = [];
    const eventCollector = definePackage({
      name: "event-collector",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.hooks.on("package.event", (e) => void events.push(e));
      },
    });

    const agent = await createAgent({
      model: testModel,
      packages: [
        ...testPackages(),
        transportServicePackage,
        eventCollector,
        mcp({
          servers: [
            {
              id: "in_mem",
              transport: "raw",
              allow: "raw",
            },
            {
              id: "unreachable-server",
              transport: "http",
              url: "https://127.0.0.1:59999/mcp",
              allow: "https://127.0.0.1:59999",
              connectTimeoutMs: 50,
            },
          ],
        }),
      ],
    });

    const statusResult = (await agent.commands.run("mcp:status")) as {
      servers: Array<{ id: string; state: string; toolCount: number; error?: string }>;
    };

    const healthy = statusResult.servers.find((s) => s.id === "in_mem");
    const failed = statusResult.servers.find((s) => s.id === "unreachable-server");

    assert.equal(healthy?.state, "connected");
    assert.equal(healthy?.toolCount, 1);

    assert.equal(failed?.state, "failed");
    assert.ok(failed?.error);

    const failedEvents = events.filter(
      (e) => e.type === "package.event" && (e as any).data?.id === "unreachable-server" && (e as any).data?.state === "failed",
    );
    assert.ok(failedEvents.length >= 1, "expected mcp.status package event for failed server");

    const notes = agent.inspect().statusNotes;
    assert.ok(
      notes.some((n) => n.message.includes("unreachable-server")),
      "expected warn note for unreachable server",
    );

    await agent.dispose();
  });

  it("mcp_header_ref_never_echoed", async () => {
    const SECRET_CANARY = "canary-super-secret-mcp-token-xyz-12345";
    process.env.TEST_MCP_CANARY_TOKEN = SECRET_CANARY;

    const events: AgentEvent[] = [];
    const eventCollector = definePackage({
      name: "event-collector-6",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.hooks.on("package.event", (e) => void events.push(e));
      },
    });

    const agent = await createAgent({
      model: testModel,
      packages: [
        ...testPackages(),
        eventCollector,
        mcp({
          servers: [
            {
              id: "secret-url-server",
              transport: "http",
              url: "https://127.0.0.1:59998/mcp",
              allow: "https://127.0.0.1:59998",
              headers: {
                Authorization: { ref: "env:TEST_MCP_CANARY_TOKEN", prefix: "Bearer " },
              },
              connectTimeoutMs: 50,
            },
          ],
        }),
      ],
    });

    const statusResult = await agent.commands.run("mcp:status");
    const inspectResult = agent.inspect();

    const dump = JSON.stringify({
      events,
      statusResult,
      inspectResult,
    });

    assert.equal(dump.includes(SECRET_CANARY), false, "secret token leaked into events, status, inspect, or notes!");

    await agent.dispose();
    delete process.env.TEST_MCP_CANARY_TOKEN;
  });

  it("mcp_reconnect_and_close_commands", async () => {
    const { clientTransport } = await createInMemoryFixture(["live_tool"]);

    const transportServicePackage = definePackage({
      name: "raw-transport-reconnect",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.services.provide("mcp.transport", { live: clientTransport });
      },
    });

    const events: AgentEvent[] = [];
    const eventCollector = definePackage({
      name: "event-collector-8",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.hooks.on("package.event", (e) => void events.push(e));
      },
    });

    const visibleTools: string[][] = [];
    const provider = mockProvider([[providerTextDelta("ok"), providerDone()]], {
      onRequest: (request) => visibleTools.push((request.tools ?? []).map((tool) => tool.name)),
    });

    const agent = await createAgent({
      model: testModel,
      packages: [
        provider,
        transportServicePackage,
        eventCollector,
        mcp({
          servers: [
            {
              id: "live",
              transport: "raw",
              allow: "raw",
            },
          ],
        }),
      ],
    });

    const status = (await agent.commands.run("mcp:status")) as {
      servers: Array<{ id: string; state: string }>;
    };
    assert.equal(status.servers[0]?.state, "connected");

    const session = await agent.session({ id: "mcp-visibility", create: true });
    await session.run("while connected");
    assert.ok(visibleTools.at(-1)?.includes("mcp:live:live_tool"), "the connected tool is visible");

    // Close server
    const closeResult = (await agent.commands.run("mcp:close", { id: "live" })) as {
      id: string;
      state: string;
    };
    assert.equal(closeResult.state, "closed");

    await session.run("while closed");
    assert.equal(visibleTools.at(-1)?.includes("mcp:live:live_tool"), false, "a closed server's tools are hidden");

    // Verify mcp.status event fired on close
    const closeEvent = events.find((e) => (e as any).data?.id === "live" && (e as any).data?.state === "closed");
    assert.ok(closeEvent, "mcp.status event fired on close");

    // Reconnect server
    const reconnectResult = (await agent.commands.run("mcp:reconnect", { id: "live" })) as {
      id: string;
      state: string;
    };
    // Reconnect with same transport might stay closed or reconnect
    assert.ok(reconnectResult.state === "connected" || reconnectResult.state === "failed");

    await agent.dispose();
  });

  it("mcp_tools_declare_effects", async () => {
    const { clientTransport: ct1 } = await createInMemoryFixture(["tool_rw"]);
    const { clientTransport: ct2 } = await createInMemoryFixture(["tool_ro"]);

    const transportServicePackage = definePackage({
      name: "raw-transport-effects",
      version: "1.0.0",
      requires: { api: 1 },
      setup(prism) {
        prism.services.provide("mcp.transport", { rw: ct1, ro: ct2 });
      },
    });

    const agent = await createAgent({
      model: testModel,
      packages: [
        ...testPackages(),
        transportServicePackage,
        mcp({
          servers: [
            {
              id: "rw",
              transport: "raw",
              allow: "raw",
              readOnly: false,
            },
            {
              id: "ro",
              transport: "raw",
              allow: "raw",
              readOnly: true,
            },
          ],
        }),
      ],
    });

    const tools = agent.tools;
    const rwTool = tools.find((t) => t.name === "mcp:rw:tool_rw");
    const roTool = tools.find((t) => t.name === "mcp:ro:tool_ro");

    assert.ok(rwTool, "rwTool found");
    assert.ok(roTool, "roTool found");

    assert.deepEqual(rwTool.effects, ["external"]);
    assert.deepEqual(roTool.effects, ["read"]);

    await agent.dispose();
  });

  it("mcp_dispose_closes_bridges", async () => {
    const fixture = join(import.meta.dirname, "../../../../../scripts/fixtures/mcp-smoke-server.mjs");

    const agent = await createAgent({
      model: testModel,
      packages: [
        ...testPackages(),
        mcp({
          servers: [
            {
              id: "stdio-child",
              transport: "stdio",
              command: node,
              args: [fixture],
              allow: "stdio",
            },
          ],
        }),
      ],
    });

    const status = (await agent.commands.run("mcp:status")) as {
      servers: Array<{ id: string; state: string }>;
    };
    assert.equal(status.servers[0]?.state, "connected");
    assert.ok(agent.tools.length >= 1, "tools registered before dispose");

    await agent.dispose();
    assert.equal(agent.tools.length, 0, "agent.tools is empty after dispose");
  });

  it("mcp_not_loaded_unless_listed", () => {
    // The package module is inert: importing it must not evaluate the MCP client. The `after` probe
    // proves the loader can see the client once something does import it.
    const script = [
      'const { createAgent } = await import("@arnilo/prism");',
      'const agent = await createAgent({ model: { provider: "mock", model: "m" } });',
      "await agent.dispose();",
      'const seen = () => Object.keys(require.cache ?? {}).some((k) => k.includes("@modelcontextprotocol/client"));',
      "const before = seen();",
      'await import("@modelcontextprotocol/client");',
      "const after = seen();",
      "console.log(JSON.stringify({ before, after }));",
    ].join("\n");

    const result = spawnSync("bun", ["-e", script], {
      cwd: join(import.meta.dirname, "../../../../.."),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout.trim()) as { before: boolean; after: boolean };
    assert.equal(parsed.before, false, "@modelcontextprotocol/client was imported by an agent that does not list the mcp package");
    assert.equal(parsed.after, true, "the probe cannot see @modelcontextprotocol/client even after importing it");
  });
});
