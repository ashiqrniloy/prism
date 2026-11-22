import { McpOAuthError } from "./auth.js";

/** The path every loopback redirect URI uses. */
export const MCP_OAUTH_CALLBACK_PATH = "/callback";
/** How long a sign-in waits for the browser callback or a pasted URL. */
export const MCP_OAUTH_SIGN_IN_TIMEOUT_MS = 5 * 60_000;

const HTML = { "content-type": "text/html; charset=utf-8" };

export function loopbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}${MCP_OAUTH_CALLBACK_PATH}`;
}

/** The port of a saved loopback redirect URI, or `undefined` when it is not one this package wrote. */
export function loopbackRedirectPort(redirectUri: string | undefined): number | undefined {
  if (redirectUri === undefined) return undefined;
  try {
    const url = new URL(redirectUri);
    const port = Number(url.port);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== MCP_OAUTH_CALLBACK_PATH) return undefined;
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
  } catch {
    return undefined;
  }
}

/** Picks a free loopback port for a redirect URI that has not been used yet. */
export async function reserveLoopbackPort(): Promise<number> {
  const { createServer } = await import("node:net");
  const server = createServer();
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error("no loopback port"))));
    });
  });
}

/**
 * Reads a callback URL: it must start with the redirect URI and carry the `state` this sign-in sent.
 * A bare code is refused, because `state` and `iss` can only be checked on the full callback.
 */
export function callbackParamsFromUrl(raw: string, redirectUri: string, state: string): URLSearchParams {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new McpOAuthError("ERR_PRISM_MCP_OAUTH_STATE", "paste the full callback URL from the browser, not the code alone");
  }
  const expected = new URL(redirectUri);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
    throw new McpOAuthError("ERR_PRISM_MCP_OAUTH_STATE", `the callback URL must start with ${expected.origin}${expected.pathname}`);
  }
  if (url.searchParams.get("state") !== state) {
    throw new McpOAuthError("ERR_PRISM_MCP_OAUTH_STATE", "OAuth callback state does not match this sign-in");
  }
  return url.searchParams;
}

export interface McpOAuthCallbackListener {
  readonly redirectUri: string;
  /** Settles on the first request to the callback path, then the listener closes. */
  readonly result: Promise<URLSearchParams>;
  /** Sets the `state` the callback must carry; a callback before this is refused. */
  expect(state: string): void;
  close(): void;
}

/**
 * A loopback listener on `127.0.0.1` that accepts one callback. The saved port is tried first so a
 * registered redirect URI keeps working; a busy port falls back to a random one, and the caller then
 * registers again. Answers are static: nothing from the query is echoed into the page.
 */
export async function openMcpOAuthCallbackListener(preferredPort: number | undefined): Promise<McpOAuthCallbackListener> {
  const { createServer } = await import("node:http");
  const server = createServer();
  const listen = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        const address = server.address();
        resolve(typeof address === "object" && address !== null ? address.port : port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
  let port: number;
  try {
    port = await listen(preferredPort ?? 0);
  } catch {
    port = await listen(0);
  }
  const redirectUri = loopbackRedirectUri(port);
  let expectedState: string | undefined;
  let settle: { resolve(value: URLSearchParams): void; reject(error: unknown): void } | undefined;
  const result = new Promise<URLSearchParams>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // A caller that closes before awaiting must not leave an unhandled rejection behind.
  result.catch(() => undefined);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    settle?.reject(new McpOAuthError("ERR_PRISM_MCP_OAUTH_STATE", "OAuth sign-in was cancelled"));
    settle = undefined;
    server.close();
    server.closeAllConnections?.();
  };
  server.on("request", (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname !== MCP_OAUTH_CALLBACK_PATH || settle === undefined) {
      response.writeHead(404, HTML).end("<p>Not found.</p>");
      return;
    }
    const current = settle;
    settle = undefined;
    try {
      if (expectedState === undefined)
        throw new McpOAuthError("ERR_PRISM_MCP_OAUTH_STATE", "OAuth callback arrived before sign-in started");
      const params = callbackParamsFromUrl(url.href, redirectUri, expectedState);
      response.writeHead(200, HTML).end("<p>Signed in. Close this tab and return to the host.</p>");
      current.resolve(params);
    } catch (error) {
      response.writeHead(400, HTML).end("<p>Sign-in did not complete. Return to the host.</p>");
      current.reject(error);
    }
    close();
  });
  return {
    redirectUri,
    result,
    expect(state) {
      expectedState = state;
    },
    close,
  };
}
