import { randomBytes } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ToolDefinition, ToolRegistry } from "@arnilo/prism";
import {
  createPrismMcpServer,
  createPrismMcpWebHandler,
  type PrismMcpAuthorization,
  type PrismMcpAuthorizationInput,
} from "@arnilo/prism-mcp";
import {
  AntigravityMcpError,
  type AntigravityMcpExposure,
  type AntigravityMcpHttpServerHandle,
  type AntigravityMcpHttpServerOptions,
  type CreateAntigravityMcpExposureOptions,
  DEFAULT_ANTIGRAVITY_MCP_SERVER_NAME,
  DEFAULT_ANTIGRAVITY_MCP_SERVER_VERSION,
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_MCP_HTTP_HOSTNAME,
  DEFAULT_MCP_HTTP_PORT,
  MAX_CONCURRENT_CALLS,
  MAX_RUN_TOKEN_BYTES,
} from "./types.js";

function resolveTools(toolsInput?: readonly ToolDefinition[] | ToolRegistry): readonly ToolDefinition[] {
  if (!toolsInput) return [];
  if (typeof (toolsInput as ToolRegistry).list === "function") {
    return (toolsInput as ToolRegistry).list();
  }
  if (Array.isArray(toolsInput)) {
    return [...toolsInput];
  }
  return [];
}

export function createAntigravityMcpExposure(options: CreateAntigravityMcpExposureOptions): AntigravityMcpExposure {
  if (!options.runContext?.sessionId || !options.runContext?.runId) {
    throw new AntigravityMcpError("Run context requires sessionId and runId");
  }

  const runToken = options.runContext.runToken ?? randomBytes(32).toString("hex");
  if (!runToken || Buffer.byteLength(runToken, "utf8") > MAX_RUN_TOKEN_BYTES) {
    throw new AntigravityMcpError(`Run token must be non-empty and <= ${MAX_RUN_TOKEN_BYTES} bytes`);
  }

  const allTools = resolveTools(options.tools);
  let exposedTools: readonly ToolDefinition[];

  const toolSelection = options.toolSelection;
  if (toolSelection === undefined) {
    exposedTools = allTools;
  } else if (Array.isArray(toolSelection)) {
    const selectedNames = new Set(toolSelection);
    exposedTools = allTools.filter((tool) => selectedNames.has(tool.name));
  } else if (typeof toolSelection === "function") {
    exposedTools = allTools.filter((tool) => toolSelection(tool.name));
  } else {
    exposedTools = [];
  }

  const serverName = options.serverName ?? DEFAULT_ANTIGRAVITY_MCP_SERVER_NAME;
  const serverVersion = options.serverVersion ?? DEFAULT_ANTIGRAVITY_MCP_SERVER_VERSION;
  const disabledTools = options.disabledTools ?? [];

  const authorizer = async (input: PrismMcpAuthorizationInput): Promise<false | PrismMcpAuthorization> => {
    if (options.runContext.signal?.aborted) {
      return false;
    }

    if (input.kind !== "tool") {
      return false;
    }

    const isExposed = exposedTools.some((tool) => tool.name === input.name);
    if (!isExposed) {
      return false;
    }

    if (options.authorize) {
      let customDecision: false | PrismMcpAuthorization;
      try {
        customDecision = await options.authorize(input);
      } catch {
        return false;
      }
      if (!customDecision) return false;

      return {
        allowed: true,
        ownership: customDecision.ownership ?? options.runContext.ownership,
        identity: customDecision.identity ?? options.runContext.identity,
        metadata: {
          ...customDecision.metadata,
          sessionId: options.runContext.sessionId,
          runId: options.runContext.runId,
        },
      };
    }

    return {
      allowed: true,
      ownership: options.runContext.ownership,
      identity: options.runContext.identity,
      metadata: {
        sessionId: options.runContext.sessionId,
        runId: options.runContext.runId,
      },
    };
  };

  const createServer = () =>
    createPrismMcpServer({
      name: serverName,
      version: serverVersion,
      tools: exposedTools,
      authorize: authorizer,
      guardrails: options.guardrails,
      limits: options.limits,
      redactor: options.redactor,
      effectStore: options.effectStore,
      validate: options.validate,
      permission: options.permission,
      maxResultBytes: options.maxResultBytes,
      maxConcurrentCalls: options.maxConcurrentCalls ?? MAX_CONCURRENT_CALLS,
      callTimeoutMs: options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    });

  const server = createServer();

  const close = async () => {
    try {
      await server.close();
    } catch {
      // Ignore cleanup error
    }
  };

  if (options.runContext.signal) {
    options.runContext.signal.addEventListener(
      "abort",
      () => {
        void close();
      },
      { once: true },
    );
  }

  return {
    server,
    createServer,
    exposedTools,
    runToken,
    runContext: options.runContext,
    serverName,
    serverVersion,
    disabledTools,
    close,
  };
}

export async function createAntigravityMcpHttpServer(
  exposure: AntigravityMcpExposure,
  options: AntigravityMcpHttpServerOptions = {},
): Promise<AntigravityMcpHttpServerHandle> {
  const hostname = options.hostname ?? DEFAULT_MCP_HTTP_HOSTNAME;
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") {
    throw new AntigravityMcpError(`MCP HTTP server must bind to loopback address (got ${hostname})`);
  }

  const webHandler = await createPrismMcpWebHandler(exposure.createServer, {
    maxRequestBytes: options.maxRequestBytes,
    maxResponseBytes: options.maxResponseBytes,
    maxConcurrentRequests: options.maxConcurrentRequests,
    requestTimeoutMs: options.requestTimeoutMs,
  });

  const expectedAuthHeader = `Bearer ${exposure.runToken}`;

  const server: Server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // Validate Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== expectedAuthHeader) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Unauthorized: invalid or missing run token" } }));
        return;
      }

      // Convert Node IncomingMessage to Web Standard Request
      const protocol = "http";
      const host = req.headers.host ?? `${hostname}`;
      const url = `${protocol}://${host}${req.url ?? "/"}`;

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v);
        } else {
          headers.set(key, value);
        }
      }

      let body: Uint8Array[] | undefined;
      if (req.method !== "GET" && req.method !== "HEAD") {
        body = [];
        for await (const chunk of req) {
          body.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
      }

      const webRequest = new Request(url, {
        method: req.method,
        headers,
        body: body ? Buffer.concat(body) : undefined,
        // @ts-expect-error duplex required for streaming in Node Request
        duplex: body ? "half" : undefined,
      });

      const webResponse = await webHandler(webRequest);

      res.statusCode = webResponse.status;
      webResponse.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      if (webResponse.body) {
        const reader = webResponse.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } else {
        res.end();
      }
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Internal server error" } }));
      } else {
        res.end();
      }
    }
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(options.port ?? DEFAULT_MCP_HTTP_PORT, hostname, () => {
      server.removeListener("error", rejectPromise);
      resolvePromise();
    });
  });

  const address = server.address() as AddressInfo;
  const port = address.port;
  const serverUrl = `http://${hostname}:${port}/mcp`;
  const headers = { authorization: expectedAuthHeader } as const;

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
    });
    await exposure.close();
  };

  if (exposure.runContext.signal) {
    exposure.runContext.signal.addEventListener(
      "abort",
      () => {
        void close();
      },
      { once: true },
    );
  }

  return {
    serverUrl,
    port,
    hostname,
    headers,
    exposure,
    close,
  };
}
