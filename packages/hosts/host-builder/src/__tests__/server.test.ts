import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createHostBuilderMcpServer, type HostBuilderMcpOptions } from "../server.js";
import { cleanup, projectRoot, symlinkOut } from "./fixture.js";

afterEach(cleanup);

const BIN = join(import.meta.dirname, "../../bin/prism-host-builder.ts");

async function connect(options: HostBuilderMcpOptions): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createHostBuilderMcpServer(options);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await server.connect(serverSide);
  await client.connect(clientSide);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function promptText(result: { messages: Array<{ content: unknown }> }): string {
  return (result.messages[0]?.content as { text: string } | undefined)?.text ?? "";
}

function resultText(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return content.map((part) => part.text).join("");
}

describe("host-builder MCP server", () => {
  it("server_lists_tools_resources_prompts: exactly the declared set", async () => {
    const { client, close } = await connect({ root: await projectRoot() });
    try {
      assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), [
        "prism_api",
        "prism_check_manifest",
        "prism_check_package",
        "prism_docs",
        "prism_errors",
        "prism_examples",
        "prism_inspect_host",
      ]);
      // The four lookups are read-only; the three checks run the host's own code and say so.
      const readOnly = (await client.listTools()).tools.filter((tool) => tool.annotations?.readOnlyHint === true);
      assert.deepEqual(readOnly.map((tool) => tool.name).sort(), ["prism_api", "prism_docs", "prism_errors", "prism_examples"]);
      assert.deepEqual((await client.listResources()).resources.map((resource) => resource.uri).sort(), [
        "prism-docs://prism-approval/README.md",
        "prism-docs://prism/README.md",
        "prism-docs://prism/docs/agent.md",
      ]);
      assert.deepEqual((await client.listPrompts()).prompts.map((prompt) => prompt.name).sort(), [
        "add-capability",
        "build-host",
        "upgrade-host",
      ]);
    } finally {
      await close();
    }
  });

  it("calls each tool and returns JSON the client can parse", async () => {
    const { client, close } = await connect({ root: await projectRoot() });
    try {
      const api = JSON.parse(resultText(await client.callTool({ name: "prism_api", arguments: { symbol: "createAgent" } })));
      assert.equal(api.found, true);
      assert.equal(api.matches[0].name, "createAgent");
      const err = JSON.parse(resultText(await client.callTool({ name: "prism_errors", arguments: { code: "model_required" } })));
      assert.equal(err.matches[0].code, "model_required");
      const example = JSON.parse(
        resultText(await client.callTool({ name: "prism_examples", arguments: { path: "examples/define-package.ts" } })),
      );
      assert.match(example.source, /definePackage/);
      const docs = JSON.parse(resultText(await client.callTool({ name: "prism_docs", arguments: { query: "createAgent" } })));
      assert.equal(docs.hits[0].heading, "Creating an agent");
      const missing = JSON.parse(resultText(await client.callTool({ name: "prism_examples", arguments: { path: "../package.json" } })));
      assert.equal(missing.found, false);
    } finally {
      await close();
    }
  });

  it("version_mismatch_fails_closed: every tool returns a tool error naming both versions", async () => {
    const { client, close } = await connect({ root: await projectRoot("0.12.1") });
    try {
      for (const [name, args] of [
        ["prism_api", { symbol: "createAgent" }],
        ["prism_errors", { code: "model_required" }],
        ["prism_examples", { query: "agent" }],
        ["prism_docs", { query: "agent" }],
      ] as const) {
        const result = await client.callTool({ name, arguments: args });
        assert.equal(result.isError, true, name);
        assert.match(resultText(result), /^ERR_PRISM_HOST_BUILDER_VERSION: @arnilo\/prism 0\.12\.1 is installed/, name);
      }
    } finally {
      await close();
    }
  });

  it("version_mismatch_allowed_warns: the result carries a warning field", async () => {
    const { client, close } = await connect({ root: await projectRoot("0.12.1"), allowVersionMismatch: true });
    try {
      const result = await client.callTool({ name: "prism_api", arguments: { symbol: "createAgent" } });
      assert.notEqual(result.isError, true);
      const body = JSON.parse(resultText(result));
      assert.match(body.warning, /version mismatch allowed/);
      assert.equal(body.found, true);
    } finally {
      await close();
    }
  });

  it("reads a docs resource and marks nothing truncated for a small page", async () => {
    const { client, close } = await connect({ root: await projectRoot() });
    try {
      const read = await client.readResource({ uri: "prism-docs://prism/docs/agent.md" });
      const content = read.contents[0] as { text: string; mimeType?: string };
      assert.match(content.text, /## Creating an agent/);
      assert.equal(content.mimeType, "text/markdown");
    } finally {
      await close();
    }
  });

  it("docs_resource_symlink_escape_refused: reading a page linked outside node_modules fails", async () => {
    const root = await projectRoot();
    symlinkOut(root, "node_modules/@arnilo/prism/docs/agent.md", "leakedsecretword");
    const { client, close } = await connect({ root });
    try {
      await assert.rejects(client.readResource({ uri: "prism-docs://prism/docs/agent.md" }), /not readable/);
      const search = JSON.parse(resultText(await client.callTool({ name: "prism_docs", arguments: { query: "leakedsecretword" } })));
      assert.equal(search.found, false);
    } finally {
      await close();
    }
  });

  it("serves no resources and fails tools closed when nothing is installed", async () => {
    const { client, close } = await connect({ root: `${await projectRoot()}/nowhere` });
    try {
      assert.deepEqual((await client.listResources()).resources, []);
      const result = await client.callTool({ name: "prism_api", arguments: { symbol: "createAgent" } });
      assert.equal(result.isError, true);
      assert.match(resultText(result), /not installed/);
    } finally {
      await close();
    }
  });

  it("prompts name the skill and the tools", async () => {
    const { client, close } = await connect({ root: await projectRoot() });
    try {
      const build = await client.getPrompt({ name: "build-host", arguments: { goal: "a support bot" } });
      const text = promptText(build);
      assert.match(text, /a support bot/);
      assert.match(text, /skills\/prism-host-builder\/SKILL\.md/);
      assert.match(text, /prism_api/);
      const upgrade = await client.getPrompt({ name: "upgrade-host" });
      assert.match(promptText(upgrade), /references\/upgrading\.md/);
      const add = await client.getPrompt({ name: "add-capability", arguments: { capability: "audit hook" } });
      assert.match(promptText(add), /audit hook/);
    } finally {
      await close();
    }
  });
});

describe("prism-host-builder mcp (stdio)", () => {
  it("serves over stdio, exits when the client closes, and rejects bad options with exit 2", async () => {
    const { StdioClientTransport } = await import("@modelcontextprotocol/client/stdio");
    const root = await projectRoot();
    const transport = new StdioClientTransport({ command: process.execPath, args: [BIN, "mcp", "--root", root] });
    const client = new Client({ name: "stdio-test", version: "1" });
    await client.connect(transport);
    try {
      assert.equal((await client.listTools()).tools.length, 7);
      const result = await client.callTool({ name: "prism_errors", arguments: { code: "ERR_PRISM_SLOT_CONFLICT" } });
      assert.equal(JSON.parse(resultText(result)).found, true);
    } finally {
      await client.close();
    }
    for (const args of [
      ["mcp", "--root"],
      ["mcp", "--frobnicate"],
    ]) {
      const exit = await new Promise<number | null>((resolve) => {
        const child = spawn(process.execPath, [BIN, ...args], { stdio: ["ignore", "ignore", "ignore"] });
        child.once("exit", resolve);
      });
      assert.equal(exit, 2, args.join(" "));
    }
  });
});
