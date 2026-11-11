import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { type ServeAcpOptions, serveAcp } from "@arnilo/prism-hosts/acp";
import { createCodingWorker, type HostConfig } from "../host/index.js";

const MODEL = { provider: "mock", model: "m", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };

type Stream = NonNullable<ServeAcpOptions["stream"]>;
type Wire = Stream extends { readable: ReadableStream<infer Message> } ? Message : never;

function pair(): {
  agent: Stream;
  write: (message: Wire) => Promise<void>;
  read: () => Promise<Wire | undefined>;
  close: () => Promise<void>;
} {
  const toAgent = new TransformStream<Wire, Wire>();
  const toClient = new TransformStream<Wire, Wire>();
  const writer = toAgent.writable.getWriter();
  const reader = toClient.readable.getReader();
  return {
    agent: { writable: toClient.writable, readable: toAgent.readable },
    write: (message) => writer.write(message),
    read: async () => {
      const next = await reader.read();
      return next.done ? undefined : next.value;
    },
    close: async () => {
      await writer.close().catch(() => undefined);
      await reader.cancel().catch(() => undefined);
    },
  };
}

test("acp_prompt_and_permission_round_trip", async () => {
  const root = mkdtempSync(join(tmpdir(), "prism-agent-acp-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  spawnSync("git", ["init"], { cwd: workspace });
  const config: HostConfig = {
    models: { orchestrator: MODEL, coding: MODEL, research: MODEL },
    storePath: join(root, "sessions.db"),
    workspace,
    approval: "ask",
    web: { backend: "obscura" },
  };
  writeFileSync(join(root, "prism-agent.json"), JSON.stringify(config));
  const agent = await createCodingWorker(config, {
    packages: [
      mockProvider([
        [providerToolCall(toolCallContent("w1", "write", { path: "note.txt", content: "approved" })), providerDone()],
        [providerTextDelta("done"), providerDone()],
      ]),
    ],
  });
  const link = pair();
  const server = serveAcp(agent, { stream: link.agent });
  const asked: string[] = [];
  let next = 1;
  let outgoing: Promise<void> = Promise.resolve();
  const send = (message: Wire): Promise<void> => {
    const done = outgoing.then(() => link.write(message));
    outgoing = done.then(
      () => undefined,
      () => undefined,
    );
    return done;
  };
  const waiters = new Map<number, (value: Wire) => void>();
  const pump = (async () => {
    for (;;) {
      const message = await link.read();
      if (message === undefined) return;
      if ("method" in message && "id" in message && message.id != null) {
        if (message.method === "session/request_permission") {
          const params = "params" in message ? message.params : undefined;
          const toolCall = params && typeof params === "object" && "toolCall" in params ? params.toolCall : undefined;
          const toolCallId = toolCall && typeof toolCall === "object" && "toolCallId" in toolCall ? toolCall.toolCallId : "";
          asked.push(typeof toolCallId === "string" ? toolCallId : "");
          void send({ jsonrpc: "2.0", id: message.id, result: { outcome: { outcome: "selected", optionId: "allow_once" } } });
        } else {
          void send({ jsonrpc: "2.0", id: message.id, result: {} });
        }
        continue;
      }
      if ("id" in message && message.id != null && !("method" in message)) waiters.get(Number(message.id))?.(message);
    }
  })();
  const request = async (method: string, params: unknown): Promise<Wire> => {
    const id = next;
    next += 1;
    const done = new Promise<Wire>((resolve) => waiters.set(id, resolve));
    await send({ jsonrpc: "2.0", id, method, params });
    return done;
  };
  try {
    const init = await request("initialize", { protocolVersion: 1 });
    const initResult = "result" in init ? init.result : undefined;
    const capabilities =
      initResult && typeof initResult === "object" && "agentCapabilities" in initResult ? initResult.agentCapabilities : undefined;
    assert.equal(
      capabilities && typeof capabilities === "object" && "loadSession" in capabilities ? capabilities.loadSession : undefined,
      true,
    );
    const created = await request("session/new", { cwd: workspace, mcpServers: [] });
    const createdResult = "result" in created ? created.result : undefined;
    const sessionId =
      createdResult && typeof createdResult === "object" && "sessionId" in createdResult ? createdResult.sessionId : undefined;
    assert.equal(typeof sessionId, "string");
    const prompt = await request("session/prompt", { sessionId, prompt: [{ type: "text", text: "write the note" }] });
    const promptResult = "result" in prompt ? prompt.result : undefined;
    assert.equal(
      promptResult && typeof promptResult === "object" && "stopReason" in promptResult ? promptResult.stopReason : undefined,
      "end_turn",
    );
    assert.equal(asked.length, 1);
    assert.equal(existsSync(join(workspace, "note.txt")), true);
  } finally {
    await link.close();
    await server.close();
    await pump.catch(() => undefined);
    await agent.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
