/**
 * Phase 10 smoke fixture: the host side of the real-transport ACP smoke
 * (scripts/acp-client-smoke.mjs). Serves `createPrismAcpAgent` over stdio
 * ndJsonStream. Policy is never disabled: authorize gates every call, the
 * edit tool goes through the four-outcome approval path, and the review mode
 * narrows the host tool set (the mode apply hook rejects edits).
 */

import { Readable, Writable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { createCodingLifecycleEmitter } from "@arnilo/prism-coding-agent";
import { createPrismAcpAgent } from "../../packages/ag-ui/dist/acp/index.js";

// Host state: session store + mode overlay. The review mode narrows behavior:
// the host's apply hook marks the session read-only; the durable loop refuses
// tool calls in review mode (deny-closed), which the smoke observes as the
// approval path never firing for edits after the switch.
const store = new Map(); // sessionId -> { cwd, modeId }
// Pre-seeded stored session: a replica-change reconnect target that this connection never created.
store.set("smoke-stored", { cwd: "/workspace", modeId: "review" });
let counter = 0;

const lifecycle = createCodingLifecycleEmitter();
const agent = createPrismAcpAgent({
  authorize: ({ sessionId }) => {
    if (sessionId && !store.has(sessionId)) return false;
    return { ownership: { userId: "smoke-user" } };
  },
  sessionFactory: (input) => {
    counter += 1;
    const id = input.sessionId ?? `smoke-${counter}`;
    store.set(id, { cwd: input.cwd, modeId: "edit" });
    return {
      session: {
        id,
        async *stream(message) {
          const text = typeof message === "string" ? message : (message?.content?.[0]?.text ?? "");
          yield { type: "message_delta", sessionId: id, runId: `run-${counter}`, content: { type: "text", text: "smoke turn" } };
          if (store.get(id)?.modeId === "edit" && text.includes("edit")) {
            yield {
              type: "agent_suspended",
              sessionId: id,
              runId: `run-${counter}`,
              version: 1,
              interruption: {
                kind: "tool_approval",
                reason: "edit the file",
                toolCallId: "tool-1",
                pendingDecisions: [
                  {
                    approvalId: "appr-1",
                    kind: "tool_approval",
                    toolCallId: "tool-1",
                    scope: { toolName: "write" },
                    reason: "edit the file",
                  },
                ],
              },
            };
          }
          yield { type: "agent_done", sessionId: id, runId: `run-${counter}`, reason: "end_turn" };
        },
      },
    };
  },
  lifecycle: {
    async *resumeStream(ref, resume, _options) {
      const entry = store.get(ref.sessionId);
      const decision = (resume.decisions ?? [])[0];
      if (entry?.modeId === "edit" && (decision?.outcome === "allow_once" || decision?.outcome === "allow_for_run")) {
        yield {
          type: "tool_call",
          sessionId: ref.sessionId,
          runId: ref.runId,
          call: { id: decision.approvalId, name: "write", arguments: { path: "/workspace/a.txt", content: "ok" } },
        };
        yield {
          type: "tool_result",
          sessionId: ref.sessionId,
          runId: ref.runId,
          result: { toolCallId: decision.approvalId, name: "write", content: "wrote" },
        };
      } else {
        yield {
          type: "tool_call",
          sessionId: ref.sessionId,
          runId: ref.runId,
          call: { id: decision?.approvalId ?? "denied", name: "write", arguments: {} },
        };
        yield {
          type: "tool_call_update",
          sessionId: ref.sessionId,
          runId: ref.runId,
          update: { id: decision?.approvalId ?? "denied", name: "write", status: "error", error: "denied in review mode" },
        };
      }
      yield { type: "agent_done", sessionId: ref.sessionId, runId: ref.runId, reason: "end_turn" };
    },
  },
  sessions: {
    async load({ sessionId, _cwd }) {
      const entry = store.get(sessionId);
      if (!entry) throw new Error(`no session ${sessionId}`);
      return {
        session: {
          id: sessionId,
          async *stream() {
            yield { type: "message_delta", sessionId, runId: "run-load", content: { type: "text", text: "reloaded" } };
            yield { type: "agent_done", sessionId, runId: "run-load", reason: "end_turn" };
          },
        },
      };
    },
  },
  coding: { lifecycle },
  modes: {
    modes: [
      {
        id: "edit",
        name: "Edit",
        apply: async () => {},
      },
      {
        id: "review",
        name: "Review",
        apply: async ({ sessionId }) => {
          const entry = store.get(sessionId);
          if (entry) entry.modeId = "review";
        },
      },
    ],
    defaultModeId: "edit",
  },
  configOptions: {
    options: [{ type: "boolean", id: "verbose", name: "Verbose", defaultValue: false }],
  },
  capabilities: {
    prompt: { media: async () => true, embedded: async () => true },
  },
});

agent.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
process.stdout.on("error", () => process.exit(0));
