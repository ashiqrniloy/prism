import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { createAcpHost } from "../src/acp.ts";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hbe-acp-"));
  writeFileSync(join(root, "note.txt"), "before\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function session(answer: "allow_once" | "reject_once") {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  const host = await createAcpHost({
    model: { provider: "mock", model: "demo" },
    root,
    stream: ndJsonStream(agentToClient.writable, clientToAgent.readable),
    providers: [
      mockProvider([
        [
          providerToolCall(toolCallContent("c1", "edit", { path: "note.txt", edits: [{ oldText: "before", newText: "after" }] })),
          providerDone(),
        ],
        [providerTextDelta("Edited."), providerDone()],
      ]),
    ],
  });
  const asked: unknown[] = [];
  const client = new ClientSideConnection(
    () => ({
      sessionUpdate: async () => undefined,
      requestPermission: async (request: unknown) => {
        asked.push(request);
        return { outcome: { outcome: "selected", optionId: answer } };
      },
    }),
    ndJsonStream(clientToAgent.writable, agentToClient.readable),
  );
  try {
    const initialized = await client.initialize({ protocolVersion: PROTOCOL_VERSION });
    const created = await client.newSession({ cwd: root, mcpServers: [] });
    const prompt = await client.prompt({ sessionId: created.sessionId, prompt: [{ type: "text", text: "Edit note.txt" }] });
    return { initialized, prompt, asked };
  } finally {
    await host.close();
  }
}

test("an ACP client approves an edit through session/request_permission", async () => {
  const { initialized, prompt, asked } = await session("allow_once");
  expect(initialized.agentCapabilities?.loadSession).toBe(true);
  expect(prompt.stopReason).toBe("end_turn");
  expect(asked.length).toBe(1);
  expect(readFileSync(join(root, "note.txt"), "utf8").trim()).toBe("after");
});

test("an ACP client can refuse, and the file stays", async () => {
  const { asked } = await session("reject_once");
  expect(asked.length).toBe(1);
  expect(readFileSync(join(root, "note.txt"), "utf8").trim()).toBe("before");
});
