import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AIProvider,
  createMockProvider,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type ToolRegistry,
} from "@arnilo/prism";
import { createTestRenderer } from "@opentui/core/testing";
import { parsePrismCodeConfigLayer } from "../config.js";
import { MemoryStoredCredentialStore, PrismCodeCredentialManager } from "../credentials.js";
import { assembleAppAgent, runHeadless, type WritableSink } from "../headless.js";
import { type CommandContext, handleSlashCommand } from "../tui/commands.js";
import { createPrismCodeTui, type PrismCodeTui } from "../tui/index.js";
import { createInitialTuiState } from "../tui/reducer.js";

const READY_ENV = "PRISM_MCP_FIXTURE_READY";

/** Real stdio MCP server: exits 1 until the ready marker exists, then serves an `echo` tool. */
function echoServerScript(delayMs = 0): string {
  return `
import { existsSync } from "node:fs";
import { createPrismMcpServer, servePrismMcpStdio } from "@arnilo/prism-mcp";
const ready = process.env.${READY_ENV};
if (ready) {
  if (!existsSync(ready)) process.exit(1);
  ${delayMs > 0 ? `await new Promise((resolve) => setTimeout(resolve, ${delayMs}));` : ""}
}
const echo = {
  name: "echo",
  description: "Echoes text back",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  execute: (args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: { echo: args.text } }),
};
servePrismMcpStdio(() => createPrismMcpServer({ tools: [echo], authorize: async () => ({ allowed: true, ownership: { tenantId: "t" } }) }));
`;
}

function stdioServer(serverId: string, options: { delayMs?: number; env?: Record<string, string> } = {}) {
  return {
    serverId,
    command: process.execPath,
    args: ["--input-type=module", "-e", echoServerScript(options.delayMs ?? 0)],
    allow: "stdio",
    ...(options.env ? { env: options.env } : {}),
  };
}

function textSink(): WritableSink & { content(): string } {
  let content = "";
  return {
    write: (chunk: string) => {
      content += chunk;
      return true;
    },
    content: () => content,
  };
}

/** Replays one event list per provider request (the mock provider replays its list on every call). */
function turnProvider(
  turns: readonly Parameters<typeof createMockProvider>[0][],
  onRequest?: (request: ProviderRequest) => void,
): AIProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate(request) {
      onRequest?.(request);
      const events = turns[Math.min(turn, turns.length - 1)] ?? [];
      turn += 1;
      for (const event of events) {
        if (request.signal?.aborted) throw request.signal.reason;
        yield event;
      }
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for condition");
}

async function captureContext(tui: PrismCodeTui): Promise<{
  readonly context: CommandContext;
  readonly entries: Array<Record<string, any>>;
  readonly footerRefreshes: () => number;
}> {
  const context = (await (tui as any).buildCommandContext()) as CommandContext;
  const entries: Array<Record<string, any>> = [];
  const original = context.stream.appendOrUpdate.bind(context.stream);
  context.stream.appendOrUpdate = (entry: any) => {
    entries.push(entry);
    return original(entry);
  };
  let refreshes = 0;
  const realRefresh = context.refreshMcpFooter;
  context.refreshMcpFooter = () => {
    refreshes++;
    realRefresh?.();
  };
  return { context, entries, footerRefreshes: () => refreshes };
}

describe("MCP integration", () => {
  it("runs a real stdio MCP tool call end-to-end in headless through the approval policy", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "prism-mcp-headless-"));
    try {
      let sawToolResult = false;
      let turns = 0;
      const provider = turnProvider(
        [
          [providerToolCall({ type: "tool_call", id: "call_1", name: "mcp:echo:echo", arguments: { text: "hello-mcp" } }), providerDone()],
          [providerTextDelta("tool finished"), providerDone()],
        ],
        (request) => {
          turns += 1;
          if (turns > 1) sawToolResult ||= JSON.stringify(request.messages).includes("hello-mcp");
        },
      );
      const stdout = textSink();
      const exitCode = await runHeadless({
        config: {
          cwd: tempDir,
          model: { provider: "mock", model: "default" },
          store: { type: "sqlite", path: join(tempDir, "sessions.db") },
          mcp: { servers: [stdioServer("echo")] },
        },
        prompt: "call echo",
        provider,
        approve: "all",
        home: join(tempDir, "home"),
        stdout,
      });
      assert.equal(exitCode, 0);
      assert.match(stdout.content(), /tool finished/);
      assert.equal(sawToolResult, true, "the model must see the MCP tool result");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("denies MCP tool calls when the approval policy denies them", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "prism-mcp-deny-"));
    try {
      const requests: ProviderRequest[] = [];
      const provider = turnProvider(
        [
          [providerToolCall({ type: "tool_call", id: "call_1", name: "mcp:echo:echo", arguments: { text: "hello-mcp" } }), providerDone()],
          [providerTextDelta("done"), providerDone()],
        ],
        (request) => requests.push(request),
      );
      await runHeadless({
        config: {
          cwd: tempDir,
          model: { provider: "mock", model: "default" },
          store: { type: "sqlite", path: join(tempDir, "sessions.db") },
          mcp: { servers: [stdioServer("echo")] },
        },
        prompt: "call echo",
        provider,
        approve: "deny",
        home: join(tempDir, "home"),
        stdout: textSink(),
      });
      assert.match(JSON.stringify(requests.at(-1)?.messages ?? []), /MCP tool mcp:echo:echo denied/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("renders the prefixed MCP tool call in the TUI and shows connected/total in the footer", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "prism-mcp-tui-"));
    const env = await createTestRenderer({ width: 80, height: 24 });
    try {
      const config = {
        cwd: tempDir,
        store: { type: "sqlite" as const, path: join(tempDir, "test.db") },
        tools: { planes: { coding: false } },
        mcp: { servers: [stdioServer("echo")] },
      };
      const definition = await assembleAppAgent(
        config,
        turnProvider([
          [providerToolCall({ type: "tool_call", id: "call_1", name: "mcp:echo:echo", arguments: { text: "tui" } }), providerDone()],
          [providerTextDelta("done"), providerDone()],
        ]),
      );
      const tui = createPrismCodeTui({ renderer: env.renderer, config });
      await tui.start(definition);
      await (tui as any).handlePromptSubmit("call echo");

      await waitFor(() => (tui as any).state.entries.some((entry: any) => entry.type === "tool_call"));
      const entries = (tui as any).state.entries as Array<{ type: string; name?: string; status?: string }>;
      assert.ok(entries.some((entry) => entry.type === "tool_call" && entry.name === "mcp:echo:echo"));
      const footer = (tui as any).state.footer as { connectedMcpCount: number; mcpTotalCount?: number; mcpFailedCount?: number };
      assert.equal(footer.connectedMcpCount, 1);
      assert.equal(footer.mcpTotalCount, 1);
      assert.equal(footer.mcpFailedCount, 0);

      await tui.close();
      await definition.dispose();
    } finally {
      env.renderer.destroy();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("/mcp lists connected/failed/disabled servers and toggles session tools", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "prism-mcp-command-"));
    const env = await createTestRenderer({ width: 80, height: 24 });
    try {
      const config = {
        cwd: tempDir,
        store: { type: "sqlite" as const, path: join(tempDir, "test.db") },
        tools: { planes: { coding: false } },
        mcp: {
          servers: [
            stdioServer("echo"),
            {
              serverId: "off",
              command: process.execPath,
              args: ["--input-type=module", "-e", "process.exit(0)"],
              allow: "stdio",
              enabled: false,
            },
            { serverId: "noauth", url: "http://127.0.0.1:9/mcp", allow: "http://127.0.0.1:9", enabled: false },
            { serverId: "broken", command: process.execPath, args: ["--input-type=module", "-e", "process.exit(3)"], allow: "stdio" },
          ],
        },
      };
      const definition = await assembleAppAgent(config, createMockProvider([providerDone()]));
      const tui = createPrismCodeTui({ renderer: env.renderer, config });
      await tui.start(definition);
      const { context, entries } = await captureContext(tui);
      const registry = definition.agent.config.tools as ToolRegistry;

      await handleSlashCommand("/mcp", context);
      const listing = entries.at(-1)?.text ?? "";
      assert.match(listing, /echo — connected, 1 tools, stdio/);
      assert.match(listing, /off — disabled/);
      assert.match(listing, /broken — failed/);

      await handleSlashCommand("/mcp tools echo", context);
      assert.match(entries.at(-1)?.text ?? "", /mcp:echo:echo/);

      assert.ok(registry.list().some((tool) => tool.name === "mcp:echo:echo"));
      await handleSlashCommand("/mcp disable echo", context);
      assert.ok(!registry.list().some((tool) => tool.name === "mcp:echo:echo"));
      await handleSlashCommand("/mcp", context);
      assert.match(entries.at(-1)?.text ?? "", /tools disabled for this session/);
      await handleSlashCommand("/mcp enable echo", context);
      assert.ok(registry.list().some((tool) => tool.name === "mcp:echo:echo"));

      await handleSlashCommand("/mcp login echo", context);
      assert.match(entries.at(-1)?.message ?? "", /is not an HTTP server/);
      await handleSlashCommand("/mcp login noauth", context);
      assert.match(entries.at(-1)?.message ?? "", /does not declare auth: "oauth"/);

      await tui.close();
      await definition.dispose();
    } finally {
      env.renderer.destroy();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reconnects a failed server in the background, refreshes the footer, and never leaks env values", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "prism-mcp-reconnect-"));
    const marker = join(tempDir, "ready");
    const env = await createTestRenderer({ width: 80, height: 24 });
    try {
      const config = {
        cwd: tempDir,
        store: { type: "sqlite" as const, path: join(tempDir, "test.db") },
        tools: { planes: { coding: false } },
        mcp: {
          servers: [stdioServer("gated", { delayMs: 800, env: { [READY_ENV]: marker, MCP_TEST_SECRET: "sekret-value" } })],
        },
      };
      const definition = await assembleAppAgent(config, createMockProvider([providerDone()]));
      assert.equal(definition.mcp.status.find((server) => server.serverId === "gated")?.state, "failed");

      const tui = createPrismCodeTui({ renderer: env.renderer, config });
      await tui.start(definition);
      const { context, entries, footerRefreshes } = await captureContext(tui);
      const registry = definition.agent.config.tools as ToolRegistry;

      await handleSlashCommand("/mcp", context);
      assert.match(entries.at(-1)?.text ?? "", /gated — failed/);
      assert.ok(!JSON.stringify(entries).includes("sekret-value"), "listing must never include env values");

      writeFileSync(marker, "ready");
      const started = Date.now();
      await handleSlashCommand("/mcp reconnect gated", context);
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 500, `reconnect must not block input (took ${elapsed}ms)`);

      await waitFor(() => definition.mcp.status.find((server) => server.serverId === "gated")?.state === "connected");
      assert.ok(footerRefreshes() >= 1, "the footer must refresh after reconnect");
      assert.ok(registry.list().some((tool) => tool.name === "mcp:gated:echo"));
      await handleSlashCommand("/mcp", context);
      assert.match(entries.at(-1)?.text ?? "", /gated — connected, 1 tools, stdio/);
      assert.ok(!JSON.stringify(entries).includes("sekret-value"));

      await tui.close();
      await definition.dispose();
    } finally {
      env.renderer.destroy();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("/mcp login completes an OAuth round trip and stores tokens under mcp:<id>", async () => {
    const authServer = await startFakeAuthServer();
    const tempDir = mkdtempSync(join(tmpdir(), "prism-mcp-login-"));
    try {
      const redirectUri = "http://127.0.0.1:1456/oauth/callback";
      const parsed = parsePrismCodeConfigLayer(
        JSON.stringify({
          mcp: { servers: [{ serverId: "linear", url: `${authServer.origin}/mcp`, auth: "oauth", allow: authServer.origin }] },
        }),
      );
      const credentials = new PrismCodeCredentialManager({ store: new MemoryStoredCredentialStore() });
      const entries: Array<Record<string, any>> = [];
      const context = {
        state: createInitialTuiState({ repo: tempDir }),
        picker: undefined as never,
        stream: { appendOrUpdate: (entry: any) => entries.push(entry) },
        status: { update: () => {} },
        credentialManager: credentials,
        currentModel: { provider: "mock", model: "default" },
        config: { ...parsed, cwd: tempDir },
        store: undefined as never,
        onUpdateState: () => {},
        onUpdateModel: () => {},
        promptSecret: async () => {
          const record = await credentials.getOAuth("mcp:linear");
          const blob = (record?.metadata as { prismMcp?: { authorizationState?: { state?: string } } } | undefined)?.prismMcp;
          return `${redirectUri}?code=test-code&state=${blob?.authorizationState?.state}&iss=${authServer.origin}`;
        },
      } as unknown as CommandContext;

      await handleSlashCommand("/mcp login linear", context);
      assert.ok(
        entries.some((entry) => entry.text?.includes("authorized")),
        `expected authorization, got ${JSON.stringify(entries)}`,
      );
      const stored = await credentials.getOAuth("mcp:linear");
      assert.equal(stored?.access, "at-1");
      assert.equal(stored?.refresh, "rt-1");
    } finally {
      await authServer.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

async function startFakeAuthServer(): Promise<{ readonly origin: string; readonly close: () => Promise<void> }> {
  let origin = "";
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const json = (body: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (path === "/.well-known/oauth-protected-resource") {
      return json({ authorization_servers: [origin], resource: `${origin}/mcp` });
    }
    if (path === "/.well-known/oauth-authorization-server") {
      return json({
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        code_challenge_methods_supported: ["S256"],
        response_types_supported: ["code"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (path === "/register") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => json({ ...JSON.parse(body || "{}"), client_id: "client-1" }));
      return;
    }
    if (path === "/token") {
      return json({ access_token: "at-1", refresh_token: "rt-1", token_type: "Bearer", expires_in: 3600 });
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return { origin, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
