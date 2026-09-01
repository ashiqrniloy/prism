/**
 * Managed/external CDP connectivity and Playwright composition for Obscura.
 *
 * `obscura serve` exposes a CDP endpoint (default ws://127.0.0.1:9222); hosts connect
 * with their own Playwright via chromium.connectOverCDP — never connect() or launch.
 * The resulting browser plugs straight into `@arnilo/prism-web-tools/browser`'s
 * createBrowserTools/createBrowserManager; raw CDP (screenshots, PDF, screencast)
 * stays available through Playwright's own CDP session APIs. No command allow-list
 * is added here and Puppeteer is out of scope.
 */
import { isIP } from "node:net";
import type { PlaywrightBrowser } from "../browser/index.js";
import { ObscuraError } from "./errors.js";
import { spawnObscuraProcess } from "./process.js";
import type { ObscuraProcessOptions, OwnedObscuraProcess } from "./types.js";

/** Structural chromium surface this package needs — only `connectOverCDP`, never `connect` or `launch`. */
export interface ObscuraChromium {
  connectOverCDP(endpoint: string, options?: { timeout?: number }): Promise<PlaywrightBrowser>;
}

export interface ObscuraPlaywright {
  readonly chromium: ObscuraChromium;
}

export interface ConnectObscuraCdpOptions
  extends Omit<Pick<ObscuraProcessOptions, "command" | "args" | "env" | "cwd" | "stderr" | "allowInsecureFlags" | "limits">, "command"> {
  /** Managed mode: absolute command to spawn (e.g. the obscura binary, or /usr/bin/docker). */
  readonly command?: string;
  /**
   * External mode: attach to an already-running CDP endpoint (ws://, wss://, http://,
   * https://). Loopback-only unless `allowRemoteEndpoint` is set. Remote endpoints have
   * no authentication — front them with an authenticated tunnel/proxy.
   */
  readonly endpoint?: string;
  /** Explicit opt-in for non-loopback CDP endpoints. Off by default; rejected otherwise. */
  readonly allowRemoteEndpoint?: boolean;
  /**
   * Host-supplied Playwright. When omitted, the optional `playwright-core` peer
   * (exact 1.61.0) is imported. Prism never launches browsers.
   */
  readonly playwright?: ObscuraPlaywright;
  readonly signal?: AbortSignal;
}

export interface ObscuraCdpSession {
  /** Pass to `createBrowserTools({ browser })` / `createBrowserManager({ browser })`. */
  readonly browser: PlaywrightBrowser;
  readonly endpoint: string;
  /** Defined only when this session spawned the server; close() terminates it. */
  readonly process: OwnedObscuraProcess | undefined;
  /** Close the Playwright browser first, then any owned process. Idempotent. */
  close(): Promise<void>;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === "localhost") return true;
  if (isIP(normalized) === 4) return normalized.startsWith("127.");
  return normalized === "::1";
}

/** Loopback-only, credential-free, ws(s)/http(s)-only endpoint validation. */
export function validateObscuraEndpoint(raw: string, allowRemote: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ObscuraError("ERR_OBSCURA_INPUT", "endpoint must be an absolute URL");
  }
  if (!["ws:", "wss:", "http:", "https:"].includes(url.protocol)) {
    throw new ObscuraError("ERR_OBSCURA_INPUT", "endpoint scheme must be ws(s) or http(s)");
  }
  if (url.username || url.password) {
    throw new ObscuraError("ERR_OBSCURA_INPUT", "endpoint must not carry credentials; use an authenticated tunnel/proxy");
  }
  if (!isLoopbackHost(url.hostname)) {
    if (!allowRemote) {
      throw new ObscuraError(
        "ERR_OBSCURA_INSECURE_FLAG",
        `non-loopback endpoint ${JSON.stringify(url.hostname)} requires allowRemoteEndpoint`,
      );
    }
    if (url.protocol === "ws:" || url.protocol === "http:") {
      throw new ObscuraError("ERR_OBSCURA_INSECURE_FLAG", "remote CDP has no authentication; require an authenticated wss/https tunnel");
    }
  }
  return url;
}

/** Derive ws://host:port from managed `serve` args (--port, optional --host). */
export function endpointFromServeArgs(args: readonly string[]): string {
  let port: number | undefined;
  let host = "127.0.0.1";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const value = arg === "--port" ? args[i + 1] : arg.startsWith("--port=") ? arg.slice("--port=".length) : undefined;
    if (value !== undefined) {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new ObscuraError("ERR_OBSCURA_INPUT", `invalid --port ${JSON.stringify(value)}`);
      }
      port = parsed;
    }
    const hostValue = arg === "--host" ? args[i + 1] : arg.startsWith("--host=") ? arg.slice("--host=".length) : undefined;
    if (hostValue !== undefined) host = hostValue;
  }
  if (port === undefined) {
    throw new ObscuraError("ERR_OBSCURA_INPUT", "managed mode needs --port in args or an explicit endpoint");
  }
  return `ws://${host}:${port}`;
}

async function loadPlaywright(): Promise<ObscuraPlaywright> {
  try {
    const mod = (await import("playwright-core")) as unknown as { default?: unknown } & Partial<ObscuraPlaywright>;
    const playwright = (mod.default ?? mod) as ObscuraPlaywright;
    if (typeof playwright.chromium?.connectOverCDP !== "function") {
      throw new ObscuraError("ERR_OBSCURA_INPUT", "installed playwright-core does not expose chromium.connectOverCDP");
    }
    return playwright;
  } catch (error) {
    if (error instanceof ObscuraError) throw error;
    throw new ObscuraError(
      "ERR_OBSCURA_INPUT",
      "optional peer playwright-core@1.61.0 is not installed; install it or supply connectObscuraCdp({ playwright })",
    );
  }
}

/** HTTP readiness probe against the CDP endpoint's /json/version. */
function makeProbe(endpoint: URL): () => Promise<boolean> {
  const httpUrl = new URL(endpoint.toString());
  httpUrl.protocol = endpoint.protocol === "wss:" ? "https:" : "http:";
  httpUrl.pathname = "/json/version";
  return async () => {
    try {
      const response = await fetch(httpUrl, { signal: AbortSignal.timeout(1000) });
      await response.arrayBuffer();
      return response.ok;
    } catch {
      return false;
    }
  };
}

/**
 * Attach to an external CDP endpoint, or spawn `obscura serve` and attach once it
 * is ready (bounded, abortable readiness — no fixed post-start sleep). Exactly one
 * connectOverCDP call is made and its browser is returned for @arnilo/prism-web-tools/browser.
 */
export async function connectObscuraCdp(options: ConnectObscuraCdpOptions): Promise<ObscuraCdpSession> {
  let endpointRaw: string | undefined = options.endpoint;
  let process: OwnedObscuraProcess | undefined;

  if (options.command !== undefined) {
    if (endpointRaw === undefined) endpointRaw = endpointFromServeArgs(options.args ?? []);
    process = spawnObscuraProcess({
      command: options.command,
      ...(options.args === undefined ? {} : { args: options.args }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.stderr === undefined ? {} : { stderr: options.stderr }),
      ...(options.allowInsecureFlags === undefined ? {} : { allowInsecureFlags: options.allowInsecureFlags }),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
    });
  } else if (endpointRaw === undefined) {
    throw new ObscuraError("ERR_OBSCURA_INPUT", "connectObscuraCdp requires endpoint or command");
  }

  const endpoint = validateObscuraEndpoint(endpointRaw, options.allowRemoteEndpoint ?? false);

  try {
    if (process !== undefined) {
      await process.waitReady(makeProbe(endpoint), { signal: options.signal });
    } else if (options.signal?.aborted) {
      throw new ObscuraError("ERR_OBSCURA_ABORTED", "connect aborted");
    }
    const endpointString = endpoint.toString().replace(/\/$/, "");
    const playwright = options.playwright ?? (await loadPlaywright());
    const browser = await playwright.chromium.connectOverCDP(endpointString);
    return {
      browser,
      endpoint: endpointString,
      process,
      close: async () => {
        try {
          await browser.close?.();
        } catch {
          // already disconnected
        }
        await process?.close();
      },
    };
  } catch (error) {
    // Only resources this call created are terminated; external servers stay alive.
    await process?.close();
    throw error;
  }
}
