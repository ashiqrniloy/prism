import { client, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { AgentRunLifecycle, AgentRunRef, AgentRunResume, AgentSession } from "@arnilo/prism";
import { createPrismAcpAgent } from "@arnilo/prism-ag-ui/acp";
import { createCodingLifecycleEmitter } from "@arnilo/prism-coding-agent";

/**
 * Phase 10 ACP coding-host example (plan 010 Task 8).
 * Demonstrates `createPrismAcpAgent` with the full host seam set: session
 * store, MCP select gate, modes, config options, prompt media policy, and the
 * coding seams (client fs/terminal adapters + lifecycle emitter). The host
 * keeps its own session state and policy — the agent is a thin protocol
 * adapter, never a second policy engine.
 *
 * Run: node --input-type=module -e "$(cat examples/acp-coding-host.ts | sed 's/^import.*$//')"
 * (Typechecked by `npm run typecheck`; the in-process client round trip below
 * also runs standalone.)
 */

// Host-owned state: every ACP session maps to a real host session that streams
// Prism events. Policy lives here, not in the agent.
const hostSessions = new Map<string, { cwd: string; modeId: string }>();
const lifecycle = createCodingLifecycleEmitter();
const approvals = new Set<string>();

const acpAgent = createPrismAcpAgent({
  // One gate for every inbound call: ownership is always asserted; the
  // session id scopes it, so a client can never act outside its sessions.
  authorize: ({ sessionId }) => {
    if (sessionId && !hostSessions.has(sessionId)) return false;
    return { ownership: { userId: "host-user" } };
  },

  // The host session factory receives the policy-checked ACP inputs and the
  // built client adapters (fs/terminal) when the client advertised them.
  sessionFactory: async (input) => {
    const sessionId = input.sessionId ?? `host-${hostSessions.size + 1}`;
    hostSessions.set(sessionId, { cwd: input.cwd, modeId: "edit" });
    // A real host returns a full Prism AgentSession (durable run, prompt, steer,
    // cancel). This example only streams events, so it narrows to the interface.
    const binding = {
      session: {
        id: sessionId,
        async *stream() {
          if (input.coding?.filesystem) {
            const read = await input.coding.filesystem.readTextFile({ path: `${input.cwd}/README.md` });
            yield { type: "message_delta", sessionId, runId: "run", content: { type: "text", text: `README: ${read.text}` } };
          }
          yield { type: "agent_done", sessionId, runId: "run", reason: "end_turn" };
        },
      },
    } as unknown as { session: AgentSession };
    return binding;
  },

  // Durable resume: approvals for the run flow back through the decisions. A real
  // host returns its durable AgentRunLifecycle (status/resume/resumeStream); the
  // example narrows to the stream seam.
  lifecycle: {
    async *resumeStream(ref: AgentRunRef, resume: AgentRunResume) {
      for (const decision of resume.decisions ?? []) {
        if (decision.outcome === "allow_once" || decision.outcome === "allow_for_run") approvals.add(decision.approvalId);
      }
      yield { type: "agent_finished", sessionId: ref.sessionId, runId: ref.runId, reason: "end_turn" };
    },
  } as unknown as AgentRunLifecycle,

  // Session store seams: presence advertises the matching session capability.
  sessions: {
    async load({ sessionId }) {
      if (!sessionId) throw new Error("sessionId required");
      const entry = hostSessions.get(sessionId);
      if (!entry) throw new Error(`unknown session ${sessionId}`);
      return { session: { id: sessionId, async *stream() {} } } as unknown as { session: AgentSession };
    },
    async list() {
      return [...hostSessions.entries()].map(([sessionId, entry]) => ({ sessionId, cwd: entry.cwd }));
    },
    async delete({ sessionId }) {
      hostSessions.delete(sessionId);
    },
    async additionalDirectories({ directories }) {
      // Host policy: only paths under /workspace are ever opened.
      return directories.filter((directory) => directory.startsWith("/workspace"));
    },
  },

  // MCP servers are only bridged after the host approves the full config.
  mcp: {
    transports: ["http", "sse"],
    async select({ servers }) {
      // Stdio servers are untagged in the schema; only http/sse carry a url.
      return servers.every((server) => !("type" in server) || (server.type === "http" && server.url.startsWith("https://")));
    },
  },

  // Modes are a pure host overlay: apply() narrows the host's own behavior.
  modes: {
    modes: [
      { id: "edit", name: "Edit" },
      {
        id: "review",
        name: "Review",
        apply: async ({ sessionId }) => {
          const entry = sessionId ? hostSessions.get(sessionId) : undefined;
          if (entry) entry.modeId = "review";
        },
      },
    ],
    defaultModeId: "edit",
  },

  configOptions: {
    options: [{ type: "boolean", id: "verbose", name: "Verbose", defaultValue: false }],
  },

  // Prompt media policy: re-checked live on every prompt, not just at initialize.
  capabilities: {
    prompt: {
      media: async () => true,
      embedded: async () => false,
    },
  },

  coding: {
    lifecycle,
    // Client-backed editor buffer: the host's tools read/write through ACP fs.
    filesystem: async (client, sessionId) => ({
      async readTextFile({ path }) {
        const response = await client.request(methods.client.fs.readTextFile, { sessionId, path });
        return { text: response.content };
      },
      async writeTextFile({ path, content }) {
        await client.request(methods.client.fs.writeTextFile, { sessionId, path, content });
      },
    }),
  },
});

// In-process round trip: a client advertises fs + config options, creates a
// session, and receives the streamed README content through the coding seam.
const acpClient = client({ name: "example-client" })
  .onNotification(methods.client.session.update, ({ params }) => {
    if (params.update.sessionUpdate === "agent_message_chunk" && params.update.content.type === "text") {
      console.log(`[update] ${params.update.content.text}`);
    }
  })
  .onRequest(methods.client.fs.readTextFile, ({ params }) => {
    console.log(`[client fs] read ${params.path}`);
    return { content: "# Prism\n" };
  });

await acpClient.connectWith(acpAgent, async (connection) => {
  await connection.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: true } },
  });
  const created = await connection.request(methods.agent.session.new, {
    cwd: "/workspace",
    additionalDirectories: ["/workspace/shared"],
    mcpServers: [],
  });
  console.log(`[session] ${created.sessionId} mode=${created.modes?.currentModeId}`);
  await connection.request(methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "show the README" }],
  });
});
