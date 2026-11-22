import manifest from "../../package.json" with { type: "json" };
import { type Capability, definePackage, type HostUi, type PackageInstance, PackageLoadError } from "@arnilo/prism";
import { isLoopbackHostname } from "@arnilo/prism/net";
import type { Transport } from "@modelcontextprotocol/client";
import type { McpClientAuth, McpOAuthRegistrationStrategy } from "./auth.js";
import { McpOAuthError } from "./auth.js";
import { connectMcpTools } from "./bridge.js";
import {
  createMcpCloseCommand,
  createMcpLoginCommand,
  createMcpLogoutCommand,
  createMcpReconnectCommand,
  createMcpStatusCommand,
} from "./commands.js";
import { type McpHttpServerConfig, type McpOAuthConfig, type McpPackageConfig, type McpServerConfig, mcpConfigSchema } from "./config.js";
import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_MAX_CALL_TIME_MS } from "./constants.js";
import {
  callbackParamsFromUrl,
  loopbackRedirectPort,
  loopbackRedirectUri,
  MCP_OAUTH_SIGN_IN_TIMEOUT_MS,
  type McpOAuthCallbackListener,
  openMcpOAuthCallbackListener,
  reserveLoopbackPort,
} from "./oauth-callback.js";
import { loadMcpOAuthSessionState, type McpOAuthCredentialSlot, type McpOAuthSessionState } from "./oauth-state.js";
import { currentServerTools, type InternalServerEntry, redactMcpError, toServerStatus } from "./status.js";
import { createMcpOAuthTransport } from "./transport.js";
import { checkServerTrust, isServerAllowed } from "./trust.js";
import type { McpStreamableHttpTransport, McpToolBridge, McpTransportConfig } from "./types.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 15000;
const DEFAULT_RECONNECT = { attempts: 5, baseDelayMs: 1000, maxDelayMs: 30_000 } as const;

/** Waits `ms`; resolves false at once when `signal` aborts. */
function delay(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** The one mapping from package config (server value, then plane value) to bridge time limits. */
function mcpServerTimeouts(
  config: Pick<McpPackageConfig, "connectTimeoutMs" | "callTimeoutMs" | "maxCallTimeMs">,
  server: Pick<McpServerConfig, "connectTimeoutMs" | "callTimeoutMs" | "maxCallTimeMs">,
): { readonly connectTimeoutMs: number; readonly callTimeoutMs: number; readonly maxCallTimeMs: number } {
  const callTimeoutMs = server.callTimeoutMs ?? config.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  return {
    connectTimeoutMs: server.connectTimeoutMs ?? config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    callTimeoutMs,
    maxCallTimeMs: server.maxCallTimeMs ?? config.maxCallTimeMs ?? Math.max(DEFAULT_MAX_CALL_TIME_MS, callTimeoutMs),
  };
}

const PACKAGE_NAME = "@arnilo/prism-extensions/mcp";
const CAPABILITIES: readonly Capability[] = ["host-ui", "credentials", "credentials:write"];

/** A server that needs a person to sign in; reported as `failed` with `reason: "auth_required"`. */
class McpAuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpAuthRequiredError";
  }
}

function oauthOf(server: McpServerConfig): McpOAuthConfig | undefined {
  return server.transport === "http" || server.transport === "streamable-http" || server.transport === "sse" ? server.auth : undefined;
}

/** `clientId` as an https URL is a CIMD client; any other value is static; none registers dynamically. */
function mcpOAuthStrategy(auth: McpOAuthConfig, redirectUri: () => string): McpOAuthRegistrationStrategy {
  if (auth.clientId?.startsWith("https://")) return { kind: "cimd", clientMetadataUrl: auth.clientId };
  if (auth.clientId !== undefined) return { kind: "static", clientId: auth.clientId };
  return {
    kind: "dcr",
    // A getter, so a registration after a port change carries the new redirect URI.
    get clientMetadata() {
      return {
        client_name: "prism-mcp",
        redirect_uris: [redirectUri()],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        ...(auth.scopes?.length ? { scope: auth.scopes.join(" ") } : {}),
      };
    },
  };
}

/** The authorization URL is opened by the host, so it must be https (or loopback when the server is). */
function assertOpenableAuthorizationUrl(url: URL, allowLoopback: boolean): void {
  if (url.protocol === "https:" && !url.username && !url.password) return;
  if (url.protocol === "http:" && allowLoopback && isLoopbackHostname(url.hostname)) return;
  throw new McpOAuthError("ERR_PRISM_MCP_OAUTH_SSRF", "authorization URL must use https");
}

/** Bounds the wait for the person (`signInTimeoutMs`, default 5 minutes); `signal` (dispose, or `mcp:login` replacing it) ends it sooner. */
function withSignInTimeout<T>(promise: Promise<T>, signal?: AbortSignal, timeoutMs: number = MCP_OAUTH_SIGN_IN_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new McpAuthRequiredError(`sign-in timed out after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    onAbort = () => reject(new McpAuthRequiredError("sign-in was cancelled"));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  });
}

/** Sign-in is needed and runs in the background (setup): the connect attempt that asked for it travels along. */
class McpSignInDeferred extends Error {
  constructor(readonly attempt: OAuthAttempt) {
    super("sign-in started; waiting for the person to finish it");
    this.name = "McpSignInDeferred";
  }
}

/** One OAuth connect attempt: a fresh transport over the stored record, and the URL the flow asked to open. */
interface OAuthAttempt {
  readonly transport: Transport;
  readonly auth: McpClientAuth;
  readonly session: McpOAuthSessionState;
  readonly strategy: McpOAuthRegistrationStrategy;
  readonly pending: { url?: URL };
  redirectUri(): string;
  setRedirectUri(next: string): void;
}

export const mcpPackageDefinition = definePackage<McpPackageConfig>({
  name: PACKAGE_NAME,
  version: manifest.version,
  description: "Bounded MCP tools, resources, prompts, client callbacks, and authorized Streamable HTTP sessions.",
  requires: { api: 1 },
  capabilities: CAPABILITIES,
  // `credentials:write` only when a server signs in with OAuth: the record is written back.
  capabilitiesFor: (config) =>
    (config.servers ?? []).some((server) => oauthOf(server) !== undefined)
      ? CAPABILITIES
      : CAPABILITIES.filter((capability) => capability !== "credentials:write"),
  config: mcpConfigSchema,
  setup: async (prism) => {
    const config = prism.config;
    const servers = config.servers ?? [];

    if (servers.length === 0) {
      return;
    }

    // Config validation
    const seenIds = new Set<string>();
    for (const server of servers) {
      if (seenIds.has(server.id)) {
        throw new PackageLoadError("config_invalid", `MCP server: duplicate id "${server.id}"`, {
          package: "@arnilo/prism-extensions/mcp",
        });
      }
      seenIds.add(server.id);

      const timeouts = mcpServerTimeouts(config, server);
      if (timeouts.maxCallTimeMs < timeouts.callTimeoutMs) {
        throw new PackageLoadError(
          "config_invalid",
          `MCP server "${server.id}": maxCallTimeMs (${timeouts.maxCallTimeMs}) must be >= callTimeoutMs (${timeouts.callTimeoutMs})`,
          { package: "@arnilo/prism-extensions/mcp" },
        );
      }

      if (server.allow === undefined && config.allow === undefined) {
        throw new PackageLoadError("config_invalid", `MCP server "${server.id}": missing explicit allow specification`, {
          package: "@arnilo/prism-extensions/mcp",
        });
      }

      if ("auth" in server && server.auth !== undefined && oauthOf(server) === undefined) {
        throw new PackageLoadError("config_invalid", `MCP server "${server.id}": auth applies only to HTTP transports`, {
          package: PACKAGE_NAME,
        });
      }
      if (oauthOf(server) !== undefined && (prism.credentials.store === undefined || prism.credentials.delete === undefined)) {
        throw new PackageLoadError(
          "capability_missing",
          `MCP server "${server.id}": OAuth sign-in stores its tokens and needs the "credentials:write" capability`,
          { package: PACKAGE_NAME },
        );
      }
    }

    try {
      await import("@modelcontextprotocol/client");
      await import("zod");
    } catch {
      prism.status.note("warn", "Install @modelcontextprotocol/client and zod to use MCP; no tools or commands registered.");
      return;
    }

    // Provenance of trusted fingerprints
    const knownTrustedServers = new Set<string>();
    let trustedFingerprints = new Set<string>();
    const trustedSource = prism.configSources.trusted;

    if (trustedSource === "project") {
      prism.status.note("warn", "trusted MCP fingerprints from project manifest are ignored");
    } else if (config.trusted && (trustedSource === "code" || trustedSource === "host")) {
      trustedFingerprints = new Set(config.trusted);
    }

    const entries = prism.state.agent<InternalServerEntry[]>("servers", []).get();
    entries.push(
      ...servers.map((srv) => ({
        config: srv,
        state: "disabled" as const,
      })),
    );

    const activeListeners = new Set<McpOAuthCallbackListener>();
    /** Sign-ins started during setup, per server; aborted by dispose or by `mcp:login`. */
    const backgroundSignIns = new Map<InternalServerEntry, { readonly abort: AbortController; readonly done: Promise<void> }>();
    const disposal = new AbortController();
    const credentialSlot = (): McpOAuthCredentialSlot => {
      const { store, delete: remove } = prism.credentials;
      if (!store || !remove) throw new McpOAuthError("ERR_PRISM_MCP_OAUTH_TOKEN_STORE", "credentials:write is not granted");
      return { resolve: (ref) => prism.credentials.resolve(ref), store, delete: remove };
    };

    /** Builds a transport over the stored record. The record is read again on every attempt. */
    const prepareOAuth = async (auth: McpOAuthConfig, base: McpStreamableHttpTransport): Promise<OAuthAttempt> => {
      const session = await loadMcpOAuthSessionState(auth.tokens, credentialSlot());
      let redirectUri =
        loopbackRedirectPort(session.savedRedirectUri) !== undefined
          ? (session.savedRedirectUri as string)
          : loopbackRedirectUri(await reserveLoopbackPort());
      session.setRedirectUri(redirectUri);
      const pending: { url?: URL } = {};
      const strategy = mcpOAuthStrategy(auth, () => redirectUri);
      const { transport, auth: handle } = createMcpOAuthTransport({
        ...base,
        auth: {
          state: session.state,
          strategy,
          ...(auth.scopes?.length ? { scopes: auth.scopes } : {}),
          // A getter, so the flow uses the redirect URI of the listener actually bound.
          get redirectUri() {
            return redirectUri;
          },
          onRedirectRequired: (url) => {
            pending.url = url;
          },
        },
      });
      return {
        transport,
        auth: handle,
        session,
        strategy,
        pending,
        redirectUri: () => redirectUri,
        setRedirectUri(next) {
          redirectUri = next;
          session.setRedirectUri(next);
        },
      };
    };

    /**
     * Runs the interactive part of the flow: open the authorization URL through `host.ui`, wait for the
     * loopback callback or a pasted callback URL, and redeem the code. Runs outside the connect timer.
     */
    const signIn = async (
      server: McpHttpServerConfig,
      auth: McpOAuthConfig,
      attempt: OAuthAttempt,
      signal?: AbortSignal,
    ): Promise<void> => {
      const ui: HostUi | undefined = prism.host.ui;
      if (!ui) throw new McpAuthRequiredError("sign-in needs host.ui");
      const allowLoopback = isLoopbackHostname(new URL(server.url).hostname);
      let listener: McpOAuthCallbackListener | undefined;
      try {
        let url = attempt.pending.url;
        if ((auth.callback ?? "listen") === "listen") {
          listener = await openMcpOAuthCallbackListener(loopbackRedirectPort(attempt.redirectUri()));
          activeListeners.add(listener);
          if (listener.redirectUri !== attempt.redirectUri()) {
            // The saved port is busy: a registered client holds the old redirect URI, so register again.
            attempt.setRedirectUri(listener.redirectUri);
            if (attempt.strategy.kind === "dcr") await attempt.session.state.clear("client");
            attempt.pending.url = undefined;
            if ((await attempt.auth.ensureAuthorized()) === "AUTHORIZED") return;
            url = attempt.pending.url;
          }
        }
        if (!url) throw new McpOAuthError("ERR_PRISM_MCP_OAUTH_STATE", "the server did not start an authorization");
        assertOpenableAuthorizationUrl(url, allowLoopback);
        const state = url.searchParams.get("state");
        if (!state) throw new McpOAuthError("ERR_PRISM_MCP_OAUTH_STATE", "the authorization URL carries no state");
        listener?.expect(state);
        if (signal?.aborted) throw new McpAuthRequiredError("sign-in was cancelled");
        // The open-url answer is bounded too, so a host that never answers cannot hold dispose or `mcp:login`.
        const opened = await withSignInTimeout(
          ui.request({ kind: "open-url", title: `Sign in to MCP server "${server.id}"`, url: url.href }),
          signal,
          config.signInTimeoutMs,
        );
        if (opened.status !== "answered") throw new McpAuthRequiredError(`sign-in was ${opened.status}`);
        const redirectUri = attempt.redirectUri();
        const callback = listener
          ? listener.result
          : ui
              .request({
                kind: "input",
                title: `Paste the callback URL for MCP server "${server.id}"`,
                detail: "After signing in, the browser ends at a page that will not load. Copy its full address and paste it here.",
                placeholder: redirectUri,
              })
              .then((answer) => {
                if (answer.status !== "answered") throw new McpAuthRequiredError(`sign-in was ${answer.status}`);
                return callbackParamsFromUrl(answer.value, redirectUri, state);
              });
        await attempt.auth.finishAuth(await withSignInTimeout(callback, signal, config.signInTimeoutMs));
      } finally {
        if (listener) {
          listener.close();
          activeListeners.delete(listener);
        }
      }
    };

    /** A connected bridge: count what a reconnect added (the tools reach the next run through the source). */
    const markConnected = (entry: InternalServerEntry, bridge: McpToolBridge, isReconnect: boolean): void => {
      entry.bridge = bridge;
      entry.state = "connected";
      entry.mapped = undefined;
      const names = currentServerTools(entry).map((tool) => tool.name);
      if (isReconnect) {
        const previous = new Set(entry.connectedNames ?? []);
        entry.added = names.filter((name) => !previous.has(name)).length;
      }
      entry.connectedNames = names;
      entry.error = undefined;
      entry.reason = undefined;
      prism.events.emit("mcp.status", toServerStatus(entry));
    };

    /** `retrying`: a reconnect attempt failed and another follows, so a plain connect error is not reported yet. */
    const markFailed = (entry: InternalServerEntry, error: unknown, retrying = false): void => {
      entry.state = "failed";
      entry.error = redactMcpError(entry.config, error);
      const authRequired = error instanceof McpAuthRequiredError || error instanceof McpSignInDeferred;
      if (retrying && !authRequired) {
        entry.reason = undefined;
        return;
      }
      if (authRequired) {
        entry.reason = "auth_required";
        if (!(error instanceof McpSignInDeferred)) {
          prism.status.note("warn", `MCP server "${entry.config.id}" needs sign-in (${entry.error}); run mcp:login`);
        }
      } else {
        entry.reason = undefined;
        prism.status.note("warn", `MCP server "${entry.config.id}" failed: ${entry.error}`);
        if (oauthOf(entry.config) === undefined && /\b401\b|unauthori[sz]ed|www-authenticate/i.test(entry.error)) {
          prism.status.note(
            "warn",
            `MCP server "${entry.config.id}" requires OAuth; configure auth: { kind: "oauth", tokens: "keyring:<name>" }`,
          );
        }
      }
      prism.events.emit("mcp.status", toServerStatus(entry));
    };

    /** Cancels a sign-in started during setup and waits for it to settle, so two flows never share a server. */
    const cancelBackgroundSignIn = async (entry: InternalServerEntry): Promise<void> => {
      const pending = backgroundSignIns.get(entry);
      if (!pending) return;
      pending.abort.abort();
      await pending.done;
    };

    /**
     * `interactive: "background"` (setup): a server that needs sign-in is reported `auth_required` at once and the
     * sign-in continues in a tracked task, so `createAgent` does not wait for the person. Its tools reach the next
     * run through the server's tool source. `"inline"` (the commands) waits for the sign-in.
     */
    const connectServer = async (
      entry: InternalServerEntry,
      options: {
        readonly reconnect?: boolean;
        readonly signIn?: boolean;
        /** `"never"` (automatic reconnect): a server that asks for sign-in is `auth_required`; nothing is opened. */
        readonly interactive?: "inline" | "background" | "never";
        /** Ends the connect attempt early (dispose, or a command taking over a reconnect). */
        readonly signal?: AbortSignal;
        /** Another reconnect attempt follows a plain connect failure. */
        readonly retrying?: boolean;
      } = {},
    ): Promise<void> => {
      const isReconnect = options.reconnect === true;
      if (entry.config.enabled === false) {
        entry.state = "disabled";
        entry.reason = "disabled";
        return;
      }

      const allowCheck = isServerAllowed(entry.config, config.allow);
      if (!allowCheck.allowed) {
        entry.state = "disabled";
        entry.reason = allowCheck.reason ?? "outside_allow";
        return;
      }

      const trusted = await checkServerTrust(entry.config, prism, trustedFingerprints, knownTrustedServers);
      if (!trusted) {
        entry.state = "disabled";
        entry.reason = "untrusted";
        return;
      }

      // Resolve credentials
      let transportConfig: McpTransportConfig;

      if (entry.config.transport === "stdio") {
        const resolvedEnv: Record<string, string> = {};
        if (entry.config.env) {
          for (const [key, val] of Object.entries(entry.config.env)) {
            if (typeof val === "object" && val !== null && "ref" in val) {
              const secret = await prism.credentials.resolve(val.ref);
              if (!secret?.value) {
                entry.state = "failed";
                entry.reason = "credential_unavailable";
                entry.error = `Credential ref "${val.ref}" could not be resolved`;
                prism.status.note("warn", `MCP server "${entry.config.id}": credential ref "${val.ref}" could not be resolved`);
                prism.events.emit("mcp.status", toServerStatus(entry));
                return;
              }
              resolvedEnv[key] = secret.value;
            } else if (typeof val === "string") {
              resolvedEnv[key] = val;
            }
          }
        }
        transportConfig = {
          type: "stdio",
          command: entry.config.command,
          args: entry.config.args,
          cwd: entry.config.cwd,
          env: Object.keys(resolvedEnv).length > 0 ? resolvedEnv : undefined,
        };
      } else if (entry.config.transport === "raw") {
        const transportService = prism.services.consume<Record<string, Transport>>("mcp.transport");
        const rawTransport = transportService?.[entry.config.id];
        if (!rawTransport) {
          entry.state = "failed";
          entry.reason = "missing_transport_service";
          entry.error = `mcp.transport service is missing or does not provide transport for server "${entry.config.id}"`;
          prism.status.note("warn", entry.error);
          prism.events.emit("mcp.status", toServerStatus(entry));
          return;
        }
        transportConfig = {
          type: "raw",
          transport: rawTransport,
        };
      } else {
        // http, streamable-http, sse
        let origin: string;
        try {
          origin = new URL(entry.config.url).origin;
        } catch {
          entry.state = "failed";
          entry.error = `invalid server URL "${entry.config.url}"`;
          prism.status.note("warn", entry.error);
          prism.events.emit("mcp.status", toServerStatus(entry));
          return;
        }

        const resolvedHeaders: Record<string, string> = {};
        if (entry.config.headers) {
          for (const [key, refObj] of Object.entries(entry.config.headers)) {
            const secret = await prism.credentials.resolve(refObj.ref);
            if (!secret?.value) {
              entry.state = "failed";
              entry.reason = "credential_unavailable";
              entry.error = `Credential ref "${refObj.ref}" could not be resolved`;
              prism.status.note("warn", `MCP server "${entry.config.id}": credential ref "${refObj.ref}" could not be resolved`);
              prism.events.emit("mcp.status", toServerStatus(entry));
              return;
            }
            resolvedHeaders[key] = (refObj.prefix ?? "") + secret.value;
          }
        }

        transportConfig = {
          type: "streamable-http",
          url: entry.config.url,
          allowedOrigins: entry.config.allowedOrigins ?? [origin],
          // Plaintext and loopback OAuth endpoints only when the server itself is on loopback.
          allowLoopbackHttp: isLoopbackHostname(new URL(entry.config.url).hostname),
          requestInit: Object.keys(resolvedHeaders).length > 0 ? { headers: resolvedHeaders } : undefined,
        };
      }

      const timeouts = mcpServerTimeouts(config, entry.config);
      /** One connect under its own connect timer. */
      const connectOnce = async (transport: McpTransportConfig): Promise<McpToolBridge> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeouts.connectTimeoutMs);
        const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
        let bridge: McpToolBridge | undefined;
        try {
          bridge = await connectMcpTools({
            serverId: entry.config.id,
            transport,
            namePrefix: entry.config.namePrefix,
            signal,
            ...timeouts,
            ...config.limits,
            // Only the bridge this entry holds may start a reconnect; a stale one is ignored.
            onConnectionLost: (error) => {
              if (bridge !== undefined && entry.bridge === bridge) onConnectionLost(entry, error);
            },
          });
        } finally {
          clearTimeout(timer);
        }
        if (bridge.isClosed) throw new Error(`MCP server "${entry.config.id}" closed the connection during connect`);
        return bridge;
      };

      /** Connect with the stored tokens; sign in when the server asks for it, then connect again on a fresh transport. */
      /** Sign in (outside the connect timer), then connect again on a fresh transport that re-reads the record. */
      const finishSignIn = async (
        server: McpHttpServerConfig,
        auth: McpOAuthConfig,
        base: McpStreamableHttpTransport,
        attempt: OAuthAttempt,
        signal?: AbortSignal,
      ): Promise<McpToolBridge> => {
        await signIn(server, auth, attempt, signal);
        const next = await prepareOAuth(auth, base);
        return connectOnce({ type: "raw", transport: next.transport });
      };

      /** Connect with the stored tokens; sign in when the server asks for it. */
      const connectWithOAuth = async (
        server: McpHttpServerConfig,
        auth: McpOAuthConfig,
        base: McpStreamableHttpTransport,
      ): Promise<McpToolBridge> => {
        const first = await prepareOAuth(auth, base);
        if (options.signIn === true) await first.session.state.clear("tokens");
        try {
          return await connectOnce({ type: "raw", transport: first.transport });
        } catch (error) {
          if (!first.pending.url) throw error;
        }
        if (options.interactive === "never") throw new McpAuthRequiredError("the server asks for sign-in; run mcp:login");
        if (options.interactive === "background") throw new McpSignInDeferred(first);
        return finishSignIn(server, auth, base, first);
      };

      const oauth = oauthOf(entry.config);
      try {
        const bridge =
          oauth !== undefined && transportConfig.type === "streamable-http"
            ? await connectWithOAuth(entry.config as McpHttpServerConfig, oauth, transportConfig)
            : await connectOnce(transportConfig);
        markConnected(entry, bridge, isReconnect);
      } catch (error) {
        if (!(error instanceof McpSignInDeferred) || oauth === undefined || transportConfig.type !== "streamable-http") {
          markFailed(entry, error, options.retrying === true);
          return;
        }
        // Report `auth_required` now; the sign-in continues in a tracked task.
        const base = transportConfig;
        const abort = new AbortController();
        const signal = AbortSignal.any([abort.signal, disposal.signal]);
        entry.signingIn = true;
        markFailed(entry, error);
        const done = (async () => {
          try {
            const bridge = await finishSignIn(entry.config as McpHttpServerConfig, oauth, base, error.attempt, signal);
            if (signal.aborted) {
              await bridge.close().catch(() => undefined);
              return;
            }
            entry.signingIn = false;
            markConnected(entry, bridge, isReconnect);
          } catch (failure) {
            entry.signingIn = false;
            if (!disposal.signal.aborted) markFailed(entry, failure);
          } finally {
            entry.signingIn = false;
            backgroundSignIns.delete(entry);
          }
        })();
        backgroundSignIns.set(entry, { abort, done });
      }
    };

    const reconnect = {
      attempts: config.reconnect?.attempts ?? DEFAULT_RECONNECT.attempts,
      baseDelayMs: config.reconnect?.baseDelayMs ?? DEFAULT_RECONNECT.baseDelayMs,
      maxDelayMs: config.reconnect?.maxDelayMs ?? DEFAULT_RECONNECT.maxDelayMs,
    };
    /** A plain connect failure; `auth_required`, untrusted, or a missing credential is not retried. */
    const retryable = (entry: InternalServerEntry): boolean => entry.state === "failed" && entry.reason === undefined;
    const isDisabled = (entry: InternalServerEntry): boolean => entry.state === "disabled";
    /** Automatic reconnect loops in progress, per server; aborted by dispose or by a command that takes over. */
    const pendingReconnects = new Map<InternalServerEntry, { readonly abort: AbortController; readonly done: Promise<void> }>();

    const closeEntryBridge = async (entry: InternalServerEntry): Promise<void> => {
      const bridge = entry.bridge;
      entry.bridge = undefined;
      if (bridge) await bridge.close().catch(() => undefined);
    };

    /** Stops an automatic reconnect and a background sign-in, so a command or dispose owns the server alone. */
    const cancelPending = async (entry: InternalServerEntry): Promise<void> => {
      const pending = pendingReconnects.get(entry);
      if (pending) {
        pending.abort.abort();
        await pending.done;
      }
      await cancelBackgroundSignIn(entry);
    };

    /**
     * The one reconnect path. A command (`automatic: false`) makes one interactive attempt now. A drop
     * (`automatic: true`) retries with doubling backoff, never opens a sign-in, and stops at a failure that a
     * retry cannot fix (`auth_required`, untrusted, a missing credential).
     */
    const reconnectServer = async (
      entry: InternalServerEntry,
      mode: { readonly automatic: boolean; readonly signIn?: boolean },
    ): Promise<void> => {
      await cancelPending(entry);
      await closeEntryBridge(entry);
      if (!mode.automatic) {
        await connectServer(entry, { reconnect: true, interactive: "inline", ...(mode.signIn ? { signIn: true } : {}) });
        return;
      }
      if (reconnect.attempts === 0) {
        entry.state = "failed";
        entry.reason = "connection_lost";
        prism.status.note("warn", `MCP server "${entry.config.id}" disconnected; reconnect is disabled, run mcp:reconnect`);
        prism.events.emit("mcp.status", toServerStatus(entry));
        return;
      }
      const abort = new AbortController();
      const signal = AbortSignal.any([abort.signal, disposal.signal]);
      const done = (async () => {
        for (let attempt = 1; attempt <= reconnect.attempts; attempt += 1) {
          entry.state = "reconnecting";
          entry.attempt = attempt;
          entry.attempts = reconnect.attempts;
          entry.reason = undefined;
          prism.events.emit("mcp.status", toServerStatus(entry));
          const wait = Math.min(reconnect.maxDelayMs, reconnect.baseDelayMs * 2 ** (attempt - 1));
          if (!(await delay(wait, signal))) return;
          await connectServer(entry, { reconnect: true, interactive: "never", signal, retrying: attempt < reconnect.attempts });
          if (signal.aborted) return;
          // connectServer moved the state; only a plain connect failure is retried.
          if (!retryable(entry)) {
            // markConnected and markFailed report themselves; a server that is now disabled (untrusted) does not.
            if (isDisabled(entry)) prism.events.emit("mcp.status", toServerStatus(entry));
            return;
          }
        }
      })().finally(() => {
        entry.attempt = undefined;
        entry.attempts = undefined;
        pendingReconnects.delete(entry);
      });
      pendingReconnects.set(entry, { abort, done });
      await done;
    };

    /** A bridge reported a drop: its tools leave new runs at once, and the reconnect starts. */
    function onConnectionLost(entry: InternalServerEntry, error: unknown): void {
      if (disposal.signal.aborted) return;
      entry.bridge = undefined;
      entry.error = redactMcpError(entry.config, error);
      void reconnectServer(entry, { automatic: true });
    }

    // Connect allowed, trusted servers concurrently. A sign-in continues in the background.
    await Promise.all(entries.map((entry) => connectServer(entry, { interactive: "background" })));

    // One tool source per server: the kernel reads the server's current tools at each run start, so a
    // `tools/list_changed`, a reconnect, or a late sign-in reaches the next run, and a run keeps its set.
    for (const entry of entries) prism.tools.source(() => currentServerTools(entry));

    // Register package commands
    prism.commands.register(createMcpStatusCommand(entries, (data) => prism.events.emit("mcp.status", data)));
    prism.commands.register(
      createMcpReconnectCommand(
        entries,
        (entry) => reconnectServer(entry, { automatic: false }),
        (data) => prism.events.emit("mcp.status", data),
      ),
    );
    prism.commands.register(
      createMcpCloseCommand(
        entries,
        async (entry) => {
          await cancelPending(entry);
          await closeEntryBridge(entry);
          entry.state = "closed";
        },
        (data) => prism.events.emit("mcp.status", data),
      ),
    );
    if (entries.some((entry) => oauthOf(entry.config) !== undefined)) {
      prism.commands.register(
        createMcpLoginCommand(
          entries,
          async (entry) => {
            if (oauthOf(entry.config) === undefined) throw new Error(`MCP server "${entry.config.id}" has no auth config`);
            await reconnectServer(entry, { automatic: false, signIn: true });
          },
          (data) => prism.events.emit("mcp.status", data),
        ),
      );
      prism.commands.register(
        createMcpLogoutCommand(
          entries,
          async (entry) => {
            const auth = oauthOf(entry.config);
            if (auth === undefined) throw new Error(`MCP server "${entry.config.id}" has no auth config`);
            await cancelPending(entry);
            await closeEntryBridge(entry);
            await credentialSlot().delete(auth.tokens);
            entry.state = "closed";
            entry.reason = "signed_out";
            entry.error = undefined;
          },
          (data) => prism.events.emit("mcp.status", data),
        ),
      );
    }

    // On dispose, close all bridges
    prism.onDispose(async () => {
      disposal.abort();
      for (const listener of activeListeners) listener.close();
      activeListeners.clear();
      await Promise.all([...backgroundSignIns.values(), ...pendingReconnects.values()].map((pending) => pending.done));
      await Promise.all(
        entries.map(async (entry) => {
          await closeEntryBridge(entry);
          entry.state = "closed";
        }),
      );
    });
  },
});

export default mcpPackageDefinition;

export function mcp(config?: McpPackageConfig): PackageInstance {
  return mcpPackageDefinition(config);
}
