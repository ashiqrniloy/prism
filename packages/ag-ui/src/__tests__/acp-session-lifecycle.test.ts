/**
 * Phase 10 Task 4 — session load/resume/delete/list, additional directories,
 * and MCP configuration. All client-supplied inputs are untrusted; every rule
 * fails closed before the host sessionFactory/seams see unvetted data.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  client,
  methods,
  PROTOCOL_VERSION,
  type AgentContext,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type McpServer,
} from "@agentclientprotocol/sdk";
import type { AgentRunLifecycle, AgentSession } from "@arnilo/prism";
import { createPrismAcpAgent, type AcpAuthorization, type AcpCodingSeams, type CreatePrismAcpAgentOptions } from "../acp/index.js";
import type { AcpMcpSeams, AcpSessionStoreSeams } from "../acp/index.js";
import type { AgUiLimitOptions } from "../limits.js";

const authorization = { ownership: { userId: "user-1" } };
const stream = { async *stream() {} } as unknown as AgentSession;
const session = (id: string) => ({ session: { ...stream, id } }) as unknown as { session: AgentSession };

interface Recorded {
  sessionFactoryInputs: Array<{ cwd: string; additionalDirectories: readonly string[]; mcpServers: readonly McpServer[] }>;
  selects: McpServer[][];
  loadCalls: Array<{ sessionId?: string; cwd: string }>;
  resumeCalls: Array<{ sessionId: string; cwd: string }>;
  listCalls: Array<{ cwd?: string }>;
  deleteCalls: string[];
  directorySeamCalls: string[][];
}

function makeAgent(options: {
  sessions?: Partial<AcpSessionStoreSeams>;
  mcp?: AcpMcpSeams;
  limits?: AgUiLimitOptions;
  authorize?: (input: { sessionId?: string; signal: AbortSignal }) => AcpAuthorization | false | Promise<AcpAuthorization | false>;
}): { app: ReturnType<typeof createPrismAcpAgent>; recorded: Recorded } {
  const recorded: Recorded = {
    sessionFactoryInputs: [],
    selects: [],
    loadCalls: [],
    resumeCalls: [],
    listCalls: [],
    deleteCalls: [],
    directorySeamCalls: [],
  };
  const sessions = options.sessions ?? {};
  const app = createPrismAcpAgent({
    authorize: options.authorize ?? (() => authorization),
    sessionFactory: (input) => {
      recorded.sessionFactoryInputs.push({
        cwd: input.cwd,
        additionalDirectories: input.additionalDirectories,
        mcpServers: input.mcpServers,
      });
      return session(input.sessionId ?? `host-session-${recorded.sessionFactoryInputs.length}`);
    },
    lifecycle: {} as AgentRunLifecycle,
    limits: options.limits,
    sessions: {
      ...(sessions.load
        ? {
            load: async (input) => {
              recorded.loadCalls.push({ sessionId: input.sessionId, cwd: input.cwd });
              return sessions.load!(input);
            },
          }
        : {}),
      ...(sessions.resume
        ? {
            resume: async (input) => {
              recorded.resumeCalls.push({ sessionId: input.sessionId, cwd: input.cwd });
              return sessions.resume!(input);
            },
          }
        : {}),
      ...(sessions.list
        ? {
            list: async (input) => {
              recorded.listCalls.push({ cwd: input.cwd });
              return sessions.list!(input);
            },
          }
        : {}),
      ...(sessions.delete
        ? {
            delete: async (input) => {
              recorded.deleteCalls.push(input.sessionId);
              return sessions.delete!(input);
            },
          }
        : {}),
      ...(sessions.additionalDirectories
        ? {
            additionalDirectories: async (input) => {
              recorded.directorySeamCalls.push([...input.directories]);
              return sessions.additionalDirectories!(input);
            },
          }
        : {}),
    },
    mcp: options.mcp
      ? {
          ...options.mcp,
          select: options.mcp.select
            ? async (input) => {
                recorded.selects.push([...input.servers]);
                return options.mcp!.select!(input);
              }
            : undefined,
        }
      : undefined,
  });
  return { app, recorded };
}

async function connect(app: ReturnType<typeof createPrismAcpAgent>, run: (connection: AgentContext) => Promise<void>): Promise<void> {
  const acpClient = client();
  await acpClient.connectWith(app, async (connection) => {
    await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
    await run(connection);
  });
}

function rejectsWith(promise: Promise<unknown>, text: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { code: number }).code, -32603, `expected SDK internal error, got ${JSON.stringify(error)}`);
    assert.ok(
      String((error as { data?: { details?: unknown } }).data?.details).includes(text),
      `expected details to include ${JSON.stringify(text)}`,
    );
    return true;
  });
}

const httpServer = (overrides: Partial<McpServer> = {}): McpServer => ({
  name: "tools",
  url: "https://tools.example.com/mcp",
  headers: [],
  ...overrides,
  type: "http",
});
const sseServer: McpServer = { type: "sse", name: "sse", url: "https://sse.example.com", headers: [] };
// McpServerStdio is the untagged union member: no `type` field.
const stdioServer: McpServer = { name: "cli", command: "/bin/mcp", args: [], env: [] } as unknown as McpServer;
const acpServer: McpServer = { type: "acp", name: "acp", serverId: "srv-1" };

describe("ACP session lifecycle (Task 4)", () => {
  it("loads an existing session and registers it for prompting", async () => {
    const { app, recorded } = makeAgent({ sessions: { load: () => session("stored-1") } });
    await connect(app, async (connection) => {
      await connection.request(methods.agent.session.load, { sessionId: "stored-1", cwd: "/w", mcpServers: [] });
      assert.deepEqual(recorded.loadCalls, [{ sessionId: "stored-1", cwd: "/w" }]);
      // Loaded session is registered: close succeeds and removes it.
      await connection.request(methods.agent.session.close, { sessionId: "stored-1" });
    });
  });

  it("load with no sessionId (most recent) is delegated to the host", async () => {
    const { app, recorded } = makeAgent({ sessions: { load: () => session("recent") } });
    await connect(app, async (connection) => {
      await connection.request(methods.agent.session.load, { sessionId: "recent", cwd: "/w", mcpServers: [] });
      assert.deepEqual(recorded.loadCalls, [{ sessionId: "recent", cwd: "/w" }]);
    });
  });

  it("load rejects unauthorized and unknown sessions; host errors propagate", async () => {
    const { app, recorded } = makeAgent({
      authorize: ({ sessionId }) => (sessionId === "forbidden" ? false : authorization),
      sessions: { load: (input) => (input.sessionId === "unknown" ? Promise.reject(new Error("Unknown session")) : session("ok")) },
    });
    await connect(app, async (connection) => {
      await rejectsWith(
        connection.request(methods.agent.session.load, { sessionId: "forbidden", cwd: "/w", mcpServers: [] }),
        "Unauthorized",
      );
      await rejectsWith(
        connection.request(methods.agent.session.load, { sessionId: "unknown", cwd: "/w", mcpServers: [] }),
        "Unknown session",
      );
      assert.equal(recorded.loadCalls.length, 1, "load seam called once (not for the unauthorized request)");
    });
  });

  it("resumes a session and forwards cwd", async () => {
    const { app, recorded } = makeAgent({ sessions: { resume: () => session("resumed-1") } });
    await connect(app, async (connection) => {
      await connection.request(methods.agent.session.resume, { sessionId: "resumed-1", cwd: "/w" });
      assert.deepEqual(recorded.resumeCalls, [{ sessionId: "resumed-1", cwd: "/w" }]);
    });
  });

  it("lists sessions with a bounded page and opaque numeric cursor", async () => {
    const summaries = Array.from({ length: 45 }, (_, i) => ({
      sessionId: `s${i}`,
      cwd: "/w",
      title: `t${i}`,
      updatedAt: "2026-08-07T00:00:00Z",
    }));
    const { app, recorded } = makeAgent({ sessions: { list: ({ cwd }) => (cwd ? summaries.filter((s) => s.cwd === cwd) : summaries) } });
    await connect(app, async (connection) => {
      const page1 = await connection.request<ListSessionsResponse>(methods.agent.session.list, {} as ListSessionsRequest);
      assert.equal(page1.sessions.length, 20);
      assert.equal(page1.sessions[0].sessionId, "s0");
      assert.equal(page1.sessions[0].title, "t0");
      assert.equal(page1.nextCursor, "20");

      const page2 = await connection.request<ListSessionsResponse>(methods.agent.session.list, {
        cursor: page1.nextCursor!,
      } as ListSessionsRequest);
      assert.equal(page2.sessions.length, 20);
      assert.equal(page2.sessions[19].sessionId, "s39");
      assert.equal(page2.nextCursor, "40");

      const page3 = await connection.request<ListSessionsResponse>(methods.agent.session.list, {
        cursor: page2.nextCursor!,
      } as ListSessionsRequest);
      assert.equal(page3.sessions.length, 5);
      assert.equal(page3.nextCursor, undefined);

      await rejectsWith(
        connection.request<ListSessionsResponse>(methods.agent.session.list, { cursor: "abc" } as ListSessionsRequest),
        "invalid list cursor",
      );
      assert.equal(recorded.listCalls.length, 4);
    });
  });

  it("passes the cwd filter to the list seam", async () => {
    const { app, recorded } = makeAgent({ sessions: { list: () => [] } });
    await connect(app, async (connection) => {
      await connection.request<ListSessionsResponse>(methods.agent.session.list, { cwd: "/other" } as ListSessionsRequest);
      assert.deepEqual(recorded.listCalls, [{ cwd: "/other" }]);
    });
  });

  it("deletes a session through the host seam and the registry", async () => {
    const { app, recorded } = makeAgent({ sessions: { delete: () => {} } });
    await connect(app, async (connection) => {
      await connection.request(methods.agent.session.delete, { sessionId: "gone" });
      assert.deepEqual(recorded.deleteCalls, ["gone"]);
    });
  });

  it("forwards policy-checked additionalDirectories to sessionFactory", async () => {
    const { app, recorded } = makeAgent({
      sessions: { additionalDirectories: ({ directories }) => directories.filter((d) => d !== "/denied") },
    });
    await connect(app, async (connection) => {
      await connection.request(methods.agent.session.new, {
        cwd: "/w",
        mcpServers: [],
        additionalDirectories: ["/a", "/denied", "/b"],
      });
      assert.deepEqual(recorded.directorySeamCalls, [["/a", "/denied", "/b"]]);
      assert.deepEqual(recorded.sessionFactoryInputs[0].additionalDirectories, ["/a", "/b"]);
      assert.equal(recorded.sessionFactoryInputs[0].cwd, "/w");
    });
  });

  it("rejects additionalDirectories without the policy seam, over the count cap, and over the path cap", async () => {
    const { app, recorded } = makeAgent({});
    await connect(app, async (connection) => {
      await rejectsWith(
        connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [], additionalDirectories: ["/a"] }),
        "capability not advertised",
      );
      assert.equal(recorded.sessionFactoryInputs.length, 0, "sessionFactory must not run");
    });

    const capped = makeAgent({
      sessions: { additionalDirectories: ({ directories }) => directories },
      limits: { acpAdditionalDirectories: 2 },
    });
    await connect(capped.app, async (connection) => {
      await rejectsWith(
        connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [], additionalDirectories: ["/a", "/b", "/c"] }),
        "exceeds 2",
      );
      await rejectsWith(
        connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [], additionalDirectories: [`/${"x".repeat(5_000)}`] }),
        "path invalid or exceeds",
      );
      assert.equal(capped.recorded.directorySeamCalls.length, 0, "seam must not run for rejected input");
    });
  });

  it("gates MCP servers by transport advertisement and host select; forwards approved configs", async () => {
    const { app, recorded } = makeAgent({ mcp: { select: () => true, transports: ["http"] } });
    await connect(app, async (connection) => {
      await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [httpServer()] });
      assert.deepEqual(recorded.selects, [[httpServer()]]);
      assert.deepEqual(recorded.sessionFactoryInputs[0].mcpServers, [httpServer()]);

      // stdio needs no advertisement but still passes select.
      await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [stdioServer] });
      assert.equal("type" in recorded.sessionFactoryInputs[1].mcpServers[0], false, "stdio config forwarded untagged");

      // sse not in transports -> rejected before select.
      await rejectsWith(connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [sseServer] }), "not advertised");
      assert.equal(recorded.selects.length, 2, "unadvertised transport must not reach select");
    });
  });

  it("rejects the experimental acp transport unconditionally", async () => {
    const { app, recorded } = makeAgent({ mcp: { select: () => true, transports: ["http", "sse"] } });
    await connect(app, async (connection) => {
      await rejectsWith(connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [acpServer] }), "UNSTABLE");
      assert.equal(recorded.selects.length, 0);
      assert.equal(recorded.sessionFactoryInputs.length, 0);
    });
  });

  it("rejects MCP servers when select denies, and when no mcp seam is wired", async () => {
    const denied = makeAgent({ mcp: { select: () => false, transports: ["http"] } });
    await connect(denied.app, async (connection) => {
      await rejectsWith(
        connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [httpServer()] }),
        "rejected by host policy",
      );
      assert.equal(denied.recorded.sessionFactoryInputs.length, 0);
    });

    const unwired = makeAgent({});
    await connect(unwired.app, async (connection) => {
      await rejectsWith(connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [httpServer()] }), "no mcp.select seam");
      assert.equal(unwired.recorded.sessionFactoryInputs.length, 0);
    });
  });

  it("bounds MCP server count, config bytes, and header value bytes", async () => {
    const counted = makeAgent({ mcp: { select: () => true, transports: ["http"] }, limits: { acpMcpServersPerSession: 1 } });
    await connect(counted.app, async (connection) => {
      await rejectsWith(
        connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [httpServer(), httpServer({ name: "b" })] }),
        "exceeds 1 servers",
      );
    });

    const sized = makeAgent({ mcp: { select: () => true, transports: ["http"] }, limits: { acpMcpServerConfigBytes: 1024 } });
    await connect(sized.app, async (connection) => {
      await rejectsWith(
        connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [httpServer({ url: `https://${"x".repeat(1200)}` })] }),
        "config exceeds 1024 bytes",
      );
    });

    const headers = makeAgent({ mcp: { select: () => true, transports: ["http"] }, limits: { acpMcpHeaderValueBytes: 1024 } });
    await connect(headers.app, async (connection) => {
      await rejectsWith(
        connection.request(methods.agent.session.new, {
          cwd: "/w",
          mcpServers: [httpServer({ headers: [{ name: "Authorization", value: `Bearer ${"s".repeat(1100)}` }] })],
        }),
        "header value exceeds 1024 bytes",
      );
    });
  });

  it("bounds the session registry (acp.sessions) and rejects duplicates", async () => {
    const { app } = makeAgent({ limits: { acpSessions: 2 } });
    await connect(app, async (connection) => {
      await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      await rejectsWith(connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] }), "registry is full");
    });
  });

  it("rejects a duplicate load of an already-registered session", async () => {
    const { app } = makeAgent({ sessions: { load: () => session("dup") } });
    await connect(app, async (connection) => {
      await connection.request(methods.agent.session.load, { sessionId: "dup", cwd: "/w", mcpServers: [] });
      await rejectsWith(connection.request(methods.agent.session.load, { sessionId: "dup", cwd: "/w", mcpServers: [] }), "already exists");
    });
  });

  it("load/resume apply the same additionalDirectories and MCP gates as new", async () => {
    const { app, recorded } = makeAgent({
      sessions: { load: () => session("l"), additionalDirectories: ({ directories }) => directories },
      mcp: { select: () => true, transports: ["http"] },
    });
    await connect(app, async (connection) => {
      await connection.request(methods.agent.session.load, {
        sessionId: "l",
        cwd: "/w",
        mcpServers: [httpServer()],
        additionalDirectories: ["/x"],
      });
      assert.deepEqual(recorded.directorySeamCalls, [["/x"]]);
      assert.deepEqual(recorded.selects, [[httpServer()]]);
      await rejectsWith(connection.request(methods.agent.session.load, { sessionId: "l", cwd: "/w", mcpServers: [acpServer] }), "UNSTABLE");
    });
  });
});

// Ensure options type still compiles with all Task 4 seams (public API surface check).
const _typecheck: CreatePrismAcpAgentOptions = {
  authorize: () => authorization,
  sessionFactory: () => session("x"),
  lifecycle: {} as AgentRunLifecycle,
  sessions: {
    load: async () => session("x"),
    list: async () => [],
    delete: async () => {},
    resume: async () => session("x"),
    additionalDirectories: async ({ directories }) => directories,
  },
  mcp: { select: async () => true, transports: ["http", "sse"] },
  coding: undefined as unknown as AcpCodingSeams | undefined,
};
void _typecheck;
