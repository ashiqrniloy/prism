/**
 * Phase 10 Task 3 — client filesystem and terminal adapters.
 * Covers round trips through the ACP wire, per-method capability gating,
 * frozen byte caps, and the sessionId handoff contract.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AgentContext, client, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { AgentRunLifecycle, AgentSession } from "@arnilo/prism";
import {
  type AcpClientFilesystem,
  type AcpClientTerminals,
  type AcpCodingContext,
  createAcpClientFilesystem,
  createAcpClientTerminals,
  createPrismAcpAgent,
} from "../acp/index.js";

const authorization = { ownership: { userId: "user-1" } };

interface Captured {
  coding?: AcpCodingContext;
  sessionId?: string;
  reads: unknown[];
  writes: unknown[];
  creates: unknown[];
  outputs: unknown[];
  waits: unknown[];
  kills: number;
  releases: number;
}

function wire(seams?: {
  filesystem?: (client: AgentContext, sessionId: string) => AcpClientFilesystem;
  processes?: (client: AgentContext, sessionId: string) => AcpClientTerminals;
  capabilities?: { readTextFile?: boolean; writeTextFile?: boolean };
}): { acpAgent: ReturnType<typeof createPrismAcpAgent>; acpClient: ReturnType<typeof client>; captured: Captured } {
  const captured: Captured = { reads: [], writes: [], creates: [], outputs: [], waits: [], kills: 0, releases: 0 };
  const acpAgent = createPrismAcpAgent({
    authorize: () => authorization,
    sessionFactory: (input) => {
      captured.coding = input.coding;
      captured.sessionId = input.sessionId;
      return { session: { id: input.sessionId ?? "host-session", async *stream() {} } as unknown as AgentSession };
    },
    lifecycle: {} as AgentRunLifecycle,
    coding: seams
      ? {
          filesystem: seams.filesystem ?? ((client, sessionId) => createAcpClientFilesystem(client, sessionId, seams.capabilities)),
          processes: seams.processes ?? ((client, sessionId) => createAcpClientTerminals(client, sessionId)),
        }
      : undefined,
  });
  const acpClient = client({ name: "test-client" })
    .onRequest(methods.client.fs.readTextFile, ({ params }) => {
      captured.reads.push(params);
      return { content: "hello" };
    })
    .onRequest(methods.client.fs.writeTextFile, ({ params }) => {
      captured.writes.push(params);
      return {};
    })
    .onRequest(methods.client.terminal.create, ({ params }) => {
      captured.creates.push(params);
      return { terminalId: "t-1" };
    })
    .onRequest(methods.client.terminal.output, ({ params }) => {
      captured.outputs.push(params);
      return { output: "chunk", truncated: false, exitStatus: null };
    })
    .onRequest(methods.client.terminal.waitForExit, ({ params }) => {
      captured.waits.push(params);
      return { exitCode: 0 };
    })
    .onRequest(methods.client.terminal.kill, () => {
      captured.kills += 1;
      return {};
    })
    .onRequest(methods.client.terminal.release, () => {
      captured.releases += 1;
      return {};
    });
  return { acpAgent, acpClient, captured };
}

describe("createPrismAcpAgent coding seams", () => {
  it("builds fs + terminal adapters only for advertised client capabilities and round-trips them", async () => {
    const { acpAgent, acpClient, captured } = wire({});
    await acpClient.connectWith(acpAgent, async (connection) => {
      await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      });
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });

      assert.equal(created.sessionId, captured.sessionId, "agent-generated session id must round-trip");
      const filesystem = captured.coding?.filesystem;
      const terminals = captured.coding?.processes;
      assert.ok(filesystem, "fs adapter built when client advertised fs");
      assert.ok(terminals, "terminal adapter built when client advertised terminal");

      const text = await filesystem!.readTextFile({ path: "/buf.ts", line: 3, limit: 10 });
      assert.equal(text.text, "hello");
      await filesystem!.writeTextFile({ path: "/buf.ts", content: "x" });
      assert.deepEqual(captured.reads[0], { sessionId: created.sessionId, path: "/buf.ts", line: 3, limit: 10 });
      assert.deepEqual(captured.writes[0], { sessionId: created.sessionId, path: "/buf.ts", content: "x" });

      const terminal = await terminals!.create({ command: "npm", args: ["test"], cwd: "/w", env: [{ name: "A", value: "1" }] });
      assert.equal(terminal.id, "t-1");
      assert.equal((await terminal.output()).output, "chunk");
      assert.equal((await terminal.waitForExit()).exitCode, 0);
      await terminal.kill();
      await terminal.release();
      assert.deepEqual(captured.creates[0], {
        sessionId: created.sessionId,
        command: "npm",
        args: ["test"],
        cwd: "/w",
        env: [{ name: "A", value: "1" }],
        outputByteLimit: 51200,
      });
      assert.deepEqual(captured.outputs[0], { sessionId: created.sessionId, terminalId: "t-1" });
      assert.deepEqual(captured.waits[0], { sessionId: created.sessionId, terminalId: "t-1" });
      assert.equal(captured.kills, 1);
      assert.equal(captured.releases, 1);
    });
  });

  it("omits adapters for unadvertised capabilities and never calls the seams", async () => {
    let filesystemCalls = 0;
    let processesCalls = 0;
    const acpAgent = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: ({ sessionId, coding }) => {
        assert.equal(coding?.filesystem, undefined);
        assert.equal(coding?.processes, undefined);
        return { session: { id: sessionId ?? "host-session", async *stream() {} } as unknown as AgentSession };
      },
      lifecycle: {} as AgentRunLifecycle,
      coding: {
        filesystem: () => {
          filesystemCalls += 1;
          throw new Error("must not be called");
        },
        processes: () => {
          processesCalls += 1;
          throw new Error("must not be called");
        },
      },
    });
    const acpClient = client();
    await acpClient.connectWith(acpAgent, async (connection) => {
      await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
    });
    assert.equal(filesystemCalls, 0);
    assert.equal(processesCalls, 0);
  });

  it("builds only the fs adapter when the client advertised only fs.readTextFile", async () => {
    const { acpAgent, acpClient, captured } = wire({});
    await acpClient.connectWith(acpAgent, async (connection) => {
      await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true } },
      });
      await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      assert.ok(captured.coding?.filesystem);
      assert.equal(captured.coding?.processes, undefined);
      await captured.coding!.filesystem!.readTextFile({ path: "/buf.ts" });
    });
  });

  it("fails closed when a masked client method is called", async () => {
    const { acpAgent, acpClient, captured } = wire({ capabilities: { readTextFile: true, writeTextFile: false } });
    await acpClient.connectWith(acpAgent, async (connection) => {
      await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      await assert.rejects(
        captured.coding!.filesystem!.writeTextFile({ path: "/buf.ts", content: "x" }),
        (error: unknown) => (error as { code: string }).code === "ERR_PRISM_ACP_CAPABILITY",
      );
      assert.equal(captured.writes.length, 0, "client method must not be called");
    });
  });

  it("bounds fs and terminal payloads before and after client calls", async () => {
    const { acpAgent, captured } = wire({});
    const acpClientWithLimits = client({ name: "test-client" })
      .onRequest(methods.client.fs.readTextFile, () => ({ content: "y".repeat(70_000) }))
      .onRequest(methods.client.fs.writeTextFile, ({ params }) => {
        captured.writes.push(params);
        return {};
      })
      .onRequest(methods.client.terminal.create, () => ({ terminalId: "t-1" }))
      .onRequest(methods.client.terminal.output, () => ({ output: "z".repeat(60_000), truncated: false, exitStatus: null }));
    await acpClientWithLimits.connectWith(acpAgent, async (connection) => {
      await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      });
      await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      const filesystem = captured.coding!.filesystem!;
      const terminals = captured.coding!.processes!;

      await assert.rejects(filesystem.readTextFile({ path: "/big" }), (error: unknown) => {
        assert.equal((error as { code: string }).code, "ERR_PRISM_ACP_LIMIT");
        return true;
      });
      await assert.rejects(
        filesystem.writeTextFile({ path: "/big", content: "x".repeat(70_000) }),
        (error: unknown) => (error as { code: string }).code === "ERR_PRISM_ACP_LIMIT",
      );
      assert.equal(captured.writes.length, 0, "oversized write must fail before the client call");

      const terminal = await terminals.create({ command: "ls" });
      await assert.rejects(terminal.output(), (error: unknown) => (error as { code: string }).code === "ERR_PRISM_ACP_LIMIT");
    });
  });

  it("rejects malformed input with ERR_PRISM_ACP_INPUT", async () => {
    const { acpAgent, acpClient, captured } = wire({});
    await acpClient.connectWith(acpAgent, async (connection) => {
      await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true }, terminal: true },
      });
      await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      const filesystem = captured.coding!.filesystem!;
      const terminals = captured.coding!.processes!;
      const input = (error: unknown) => (error as { code: string }).code === "ERR_PRISM_ACP_INPUT";

      await assert.rejects(filesystem.readTextFile({ path: "/x", line: 0 }), input);
      await assert.rejects(filesystem.readTextFile({ path: "/x", limit: -1 }), input);
      await assert.rejects(filesystem.readTextFile({ path: "" }), input);
      await assert.rejects(terminals.create({ command: "" }), input);
      await assert.rejects(terminals.create({ command: "ls", outputByteLimit: 0 }), input);
    });
  });

  it("rejects a sessionFactory that ignores the provided session id", async () => {
    const acpAgent = createPrismAcpAgent({
      authorize: () => authorization,
      sessionFactory: () => ({ session: { id: "other-id", async *stream() {} } as unknown as AgentSession }),
      lifecycle: {} as AgentRunLifecycle,
      coding: { processes: (client, sessionId) => createAcpClientTerminals(client, sessionId) },
    });
    const acpClient = client();
    await acpClient.connectWith(acpAgent, async (connection) => {
      await connection.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { terminal: true },
      });
      await assert.rejects(
        connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] }),
        (error: unknown) =>
          (error as { code: number }).code === -32603 &&
          String((error as { data?: { details?: unknown } }).data?.details).includes("sessionFactory must return"),
      );
    });
  });
});
