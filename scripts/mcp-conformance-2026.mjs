#!/usr/bin/env node
// Deterministic local conformance runner (plan 063 task 7).
//
// The official `@modelcontextprotocol/conformance` CLI publishes scenarios only
// up to spec version 2025-11-25 — no 2026-07-28 scenarios exist upstream yet
// (recorded as an explicit upstream gap in docs + plan 063, not a waiver).
// This runner starts the real dual-era `createPrismMcpWebHandler` +
// `createPrismMcpServer` stack on a loopback port with the suite's well-known
// fixture surface for everything Prism can express, runs the official server
// suite, and exits with the CLI's status code. Scenarios that require surface
// Prism deliberately does not expose (server-initiated sampling/elicitation/
// logging/progress from tool callbacks, resources/subscribe, completion
// capability, session-based SSE polling, non-text tool content blocks) are
// recorded in scripts/mcp-conformance-2026-baseline.yaml.
//
// Usage: node scripts/mcp-conformance-2026.mjs [--suite all|active] [--spec-version 2025-11-25]
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createPrismMcpServer, createPrismMcpWebHandler } from "../packages/mcp/dist/server.js";

const suite = process.argv.includes("--suite") ? process.argv[process.argv.indexOf("--suite") + 1] : "all";
const specVersion = process.argv.includes("--spec-version")
  ? process.argv[process.argv.indexOf("--spec-version") + 1]
  : "2025-11-25";
const passthrough = ["-o", ".conformance-out", "--expected-failures", "scripts/mcp-conformance-2026-baseline.yaml"];

// 1x1 red pixel PNG (67 bytes).
const RED_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
// Minimal silent WAV header + one frame.
const TINY_WAV =
  "UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIrYAACABAAZAZ0AAAAAAA==";

const tool = (name, description, result) => ({
  name,
  description,
  parameters: { type: "object", properties: {} },
  execute: () => result,
});

const factory = () =>
  createPrismMcpServer({
    tools: [
      tool("test_simple_text", "Returns simple text content", {
        toolCallId: "c1",
        name: "test_simple_text",
        value: "This is a simple text response for testing.",
      }),
      tool("test_error_handling", "Returns an error result", {
        toolCallId: "c2",
        name: "test_error_handling",
        error: { message: "This is a deliberate test error message" },
      }),
      // Server-initiated client requests (sampling/elicitation) and streamed
      // logging/progress notifications are not exposed to Prism tool
      // callbacks; these registrations exist so tools-list shape matches and
      // the scenarios fail with the recorded Prism boundary, not missing tools.
      tool("test_image_content", "Image content is flattened by Prism (baseline)", {
        toolCallId: "c3",
        name: "test_image_content",
        value: "image placeholder",
      }),
      tool("test_audio_content", "Audio content is flattened by Prism (baseline)", {
        toolCallId: "c4",
        name: "test_audio_content",
        value: "audio placeholder",
      }),
      tool("test_embedded_resource", "Embedded resource content is flattened by Prism (baseline)", {
        toolCallId: "c5",
        name: "test_embedded_resource",
        value: "resource placeholder",
      }),
      tool("test_multiple_content_types", "Mixed content is flattened by Prism (baseline)", {
        toolCallId: "c6",
        name: "test_multiple_content_types",
        value: "mixed placeholder",
      }),
      tool("test_tool_with_logging", "Tool-initiated logging is not exposed by Prism (baseline)", {
        toolCallId: "c7",
        name: "test_tool_with_logging",
        value: "ok",
      }),
      tool("test_tool_with_progress", "Tool-initiated progress is not exposed by Prism (baseline)", {
        toolCallId: "c8",
        name: "test_tool_with_progress",
        value: "ok",
      }),
      tool("test_sampling", "Server-initiated sampling is not exposed by Prism (baseline)", {
        toolCallId: "c9",
        name: "test_sampling",
        value: "ok",
      }),
      tool("test_elicitation", "Server-initiated elicitation is not exposed by Prism (baseline)", {
        toolCallId: "c10",
        name: "test_elicitation",
        value: "ok",
      }),
      tool("test_elicitation_sep1034_defaults", "SEP-1034 elicitation defaults (baseline)", {
        toolCallId: "c11",
        name: "test_elicitation_sep1034_defaults",
        value: "ok",
      }),
      tool("test_elicitation_sep1330_enums", "SEP-1330 elicitation enums (baseline)", {
        toolCallId: "c12",
        name: "test_elicitation_sep1330_enums",
        value: "ok",
      }),
      tool("test_reconnection", "SEP-1699 SSE reconnection requires sessions (baseline)", {
        toolCallId: "c13",
        name: "test_reconnection",
        value: "ok",
      }),
      {
        name: "json_schema_2020_12_tool",
        description: "SEP-1613 JSON Schema 2020-12 tool fixture",
        parameters: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          $defs: { address: { type: "object", properties: { street: { type: "string" }, city: { type: "string" } } } },
          properties: { name: { type: "string" }, address: { $ref: "#/$defs/address" } },
          additionalProperties: false,
        },
        execute: () => ({ toolCallId: "c14", name: "json_schema_2020_12_tool", value: { ok: true } }),
      },
    ],
    resources: [
      {
        name: "static-text",
        uri: "test://static-text",
        description: "Static text fixture",
        mimeType: "text/plain",
        read: async () => ({
          contents: [{ uri: "test://static-text", mimeType: "text/plain", text: "This is the static text resource content." }],
        }),
      },
      {
        name: "static-binary",
        uri: "test://static-binary",
        description: "Static binary fixture",
        mimeType: "application/octet-stream",
        read: async () => ({
          contents: [{ uri: "test://static-binary", mimeType: "application/octet-stream", blob: RED_PNG }],
        }),
      },
      {
        name: "template-123-data",
        uri: "test://template/123/data",
        description: "Template substitution fixture (literal URI)",
        mimeType: "text/plain",
        read: async () => ({
          contents: [{ uri: "test://template/123/data", mimeType: "text/plain", text: "Template data for id 123" }],
        }),
      },
      {
        name: "watched-resource",
        uri: "test://watched-resource",
        description: "Watched resource fixture (subscribe is a baseline gap)",
        mimeType: "text/plain",
        read: async () => ({
          contents: [{ uri: "test://watched-resource", mimeType: "text/plain", text: "watched" }],
        }),
      },
      {
        name: "example-resource",
        uri: "test://example-resource",
        description: "Example resource fixture",
        mimeType: "text/plain",
        read: async () => ({
          contents: [{ uri: "test://example-resource", mimeType: "text/plain", text: "example" }],
        }),
      },
    ],
    prompts: [
      {
        name: "test_simple_prompt",
        description: "Simple prompt fixture",
        get: async () => ({
          messages: [{ role: "user", content: { type: "text", text: "This is a simple prompt response for testing." } }],
        }),
      },
      {
        name: "test_prompt_with_arguments",
        description: "Prompt with argument substitution fixture",
        arguments: {
          arg1: { description: "first", required: true },
          arg2: { description: "second", required: false },
        },
        get: async ({ arguments: args }) => ({
          messages: [
            { role: "user", content: { type: "text", text: `Argument one is ${args.arg1} and argument two is ${args.arg2}.` } },
          ],
        }),
      },
      {
        name: "test_prompt_with_embedded_resource",
        description: "Prompt with embedded resource fixture",
        get: async () => ({
          messages: [
            {
              role: "user",
              content: {
                type: "resource",
                resource: { uri: "test://embedded-resource", mimeType: "text/plain", text: "embedded prompt resource" },
              },
            },
          ],
        }),
      },
      {
        name: "test_prompt_with_image",
        description: "Prompt with image fixture",
        get: async () => ({
          messages: [{ role: "user", content: { type: "image", data: RED_PNG, mimeType: "image/png" } }],
        }),
      },
      {
        name: "test_prompt_with_audio",
        description: "Prompt with audio fixture",
        get: async () => ({
          messages: [{ role: "user", content: { type: "audio", data: TINY_WAV, mimeType: "audio/wav" } }],
        }),
      },
    ],
    authorize: () => ({ allowed: true, ownership: { tenantId: "conformance", accountId: "conformance", userId: "conformance" } }),
  });

const http = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const webRequest = new Request(new URL(request.url ?? "/", "http://127.0.0.1"), {
      method: request.method,
      headers: request.headers,
      body: ["GET", "HEAD"].includes(request.method ?? "") ? undefined : Buffer.concat(chunks),
    });
    const webResponse = await handler(webRequest);
    response.writeHead(webResponse.status, Object.fromEntries(webResponse.headers));
    const reader = webResponse.body?.getReader();
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        response.write(Buffer.from(value));
      }
    response.end();
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: String(error) } }));
  }
});
http.listen(0, "127.0.0.1");
await new Promise((resolve) => http.on("listening", resolve));
const port = http.address().port;
const origin = `http://127.0.0.1:${port}`;

// DNS-rebinding scenario: exact Host allowlist covering the valid localhost
// forms the suite probes; everything else fails closed before body parsing.
const handler = await createPrismMcpWebHandler(factory, {
  allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, "127.0.0.1", "localhost", "[::1]"],
  allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
});

console.log(`[mcp-conformance-2026] fixture listening on ${origin}/mcp`);

const child = spawn(
  "npx",
  ["-y", "@modelcontextprotocol/conformance", "server", "--url", `${origin}/mcp`, "--suite", suite, "--spec-version", specVersion, ...passthrough],
  { stdio: "inherit" },
);
const code = await new Promise((resolve) => child.on("exit", resolve));
await handler.close();
http.close();
console.log(`[mcp-conformance-2026] conformance CLI exit=${code} (suite=${suite}, spec-version=${specVersion})`);
process.exit(code ?? 1);
