import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { attachMcpCapabilities, createMcpCapabilityClient } from "../capabilities.js";
import { McpUnsupportedCapabilityError } from "../types.js";

const open: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

async function fixture(withCapabilities = true) {
  const seen: string[] = [];
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  if (withCapabilities) {
    server.registerResource("guide", "file:///guide.md", { mimeType: "text/markdown" }, async (uri) => {
      seen.push("resource:guide");
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: "safe" }],
      };
    });
    server.registerPrompt("review", { argsSchema: z.object({ topic: z.string() }) }, async ({ topic }) => {
      seen.push("prompt:review");
      return {
        messages: [{ role: "user", content: { type: "text", text: `Review ${topic}` } }],
      };
    });
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1" }, { capabilities: {} });
  await client.connect(clientTransport);
  const bridge = await attachMcpCapabilities(client, clientTransport, { serverId: "test", maxCapabilityBytes: 4096 });
  open.push({
    close: async () => {
      await bridge.close();
      await server.close();
    },
  });
  return { bridge, seen };
}

describe("MCP capability bridge", () => {
  it("serves explicitly selected roots, sampling, and elicitation callbacks", async () => {
    const events: string[] = [];
    const client = createMcpCapabilityClient({
      serverId: "host",
      transport: { type: "stdio", command: "unused" },
      roots: () => [{ uri: "file:///workspace", name: "workspace" }],
      sampling: ({ params }) => {
        events.push("sampling");
        return {
          model: "host-model",
          role: "assistant",
          content: { type: "text", text: String((params as any).messages[0].content.text) },
        };
      },
      elicitation: ({ params }) => {
        events.push(`elicitation:${(params as any).mode}`);
        return (params as any).mode === "form" ? { action: "accept", content: {} } : { action: "decline" };
      },
      maxCapabilityBytes: 4096,
    });
    const server = new McpServer({ name: "empty-server", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    open.push({
      close: async () => {
        await client.close();
        await server.close();
      },
    });
    assert.deepEqual(await server.server.listRoots(), { roots: [{ uri: "file:///workspace", name: "workspace" }] });
    assert.match(
      JSON.stringify(
        await server.server.createMessage({ maxTokens: 10, messages: [{ role: "user", content: { type: "text", text: "hello" } }] }),
      ),
      /hello/,
    );
    await assert.rejects(
      server.server.elicitInput({ mode: "form", message: "Approve", requestedSchema: { type: "object", properties: {} } }),
      /human interaction/,
    );
    assert.equal(
      (
        await server.server.elicitInput({
          mode: "url",
          message: "Approve in browser",
          url: "https://example.test/consent",
          elicitationId: "e1",
        })
      ).action,
      "decline",
    );
    assert.deepEqual(events, ["sampling", "elicitation:form", "elicitation:url"]);
  });

  it("keeps resources and prompts bounded, authorized, and outside tool definitions", async () => {
    const { bridge, seen } = await fixture();
    assert.equal(bridge.tools.length, 0);
    assert.deepEqual(
      (await bridge.listResources()).map((item: any) => item.name),
      ["guide"],
    );
    assert.match(JSON.stringify(await bridge.readResource("file:///guide.md")), /safe/);
    assert.deepEqual(
      (await bridge.listPrompts()).map((item: any) => item.name),
      ["review"],
    );
    assert.match(JSON.stringify(await bridge.getPrompt("review", { topic: "security" })), /security/);
    assert.deepEqual(seen, ["resource:guide", "prompt:review"]);
  });

  it("fails unsupported surfaces with a stable explicit error", async () => {
    const { bridge } = await fixture(false);
    await assert.rejects(
      bridge.listResources(),
      (error: unknown) => error instanceof McpUnsupportedCapabilityError && error.code === "ERR_PRISM_MCP_UNSUPPORTED_CAPABILITY",
    );
    await assert.rejects(bridge.getPrompt("missing"), McpUnsupportedCapabilityError);
  });
});
