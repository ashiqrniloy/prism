import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServerSpec } from "@arnilo/prism-agent-sdk";
import type { McpClientAuthOptions, McpClientAuthState, McpOAuthRegistrationStrategy } from "@arnilo/prism-mcp";
import type { PrismCodeMcpServer } from "./config.js";
import type { PrismCodeCredentialManager } from "./credentials.js";
import { ensureHomeDir, resolvePrismHome } from "./home.js";

/** Where an MCP server declaration came from: `~/.prism/config.json` is trusted, anything else is not. */
export type McpServerOrigin = "global" | "project";

/** How project-declared servers are gated: interactive TUI prompt, skipped, or trusted for this run. */
export type McpProjectTrustMode = "prompt" | "skip" | "allow";

/** Per-repo trust decisions live in `<home>/trust.json` (0600), keyed by canonical workspace root. */
export interface McpTrustFile {
  readonly version: 1;
  readonly repos: Record<string, Record<string, string>>;
}

export interface McpTrustContext {
  readonly origins: ReadonlyMap<string, McpServerOrigin>;
  readonly mode: McpProjectTrustMode;
  /** Prism home holding `trust.json`; defaults to `PRISM_HOME`/`~/.prism`. */
  readonly home?: string;
  /** TUI trust prompt; absent in headless mode. */
  readonly promptTrust?: (server: PrismCodeMcpServer) => Promise<boolean>;
  /** Receives skip/trust notes for user-visible surfaces. */
  readonly notify?: (text: string) => void;
}

export interface ResolveMcpServersOptions {
  readonly servers: readonly PrismCodeMcpServer[] | undefined;
  readonly origins?: ReadonlyMap<string, McpServerOrigin>;
  readonly mode?: McpProjectTrustMode;
  readonly home?: string;
  readonly workspaceRoot: string;
  readonly promptTrust?: (server: PrismCodeMcpServer) => Promise<boolean>;
  readonly credentialManager: PrismCodeCredentialManager;
  readonly env?: NodeJS.ProcessEnv;
}

export interface ResolvedMcpServers {
  /** SDK-ready specs, in declaration order; disabled/untrusted/preflight-failed servers included as stubs. */
  readonly servers: readonly McpServerSpec[];
  /** Human-readable skip/trust notes for the caller's user-facing surface. */
  readonly notes: readonly string[];
}

const EMPTY_TRUST: McpTrustFile = { version: 1, repos: {} };
const MCP_AUTH_CHUNK = "prismMcp";
const MCP_HEADER_REFERENCE = /\$\{(env|credential):([A-Za-z_][A-Za-z0-9_.-]*)\}/g;
/** Loopback redirect for the MCP OAuth code flow; no listener is started (Task 6). */
export const MCP_OAUTH_REDIRECT_URI = "http://127.0.0.1:1456/oauth/callback";
export const MCP_OAUTH_REDIRECT_URI_ENV = "PRISM_MCP_OAUTH_REDIRECT_URI";

// ---------------------------------------------------------------------------
// Header references
// ---------------------------------------------------------------------------

export type McpHeaderReference = { readonly kind: "literal" } | { readonly kind: "references" } | { readonly kind: "malformed" };

/** Classifies a header value: plain literal, at least one `${env:...}`/`${credential:...}` reference, or broken. */
export function parseMcpHeaderReference(value: string): McpHeaderReference {
  if (!value.includes("${")) return { kind: "literal" };
  const remainder = value.replace(MCP_HEADER_REFERENCE, "");
  if (remainder === value || remainder.includes("${") || remainder.includes("}")) return { kind: "malformed" };
  return { kind: "references" };
}

/** Resolves the `${env:NAME}`/`${credential:NAME}` tokens in one header value; never throws. */
export function resolveMcpHeaderValue(
  value: string,
  resolve: (kind: "env" | "credential", name: string) => string | undefined,
): { readonly value: string } | { readonly error: string } {
  if (parseMcpHeaderReference(value).kind === "malformed") return { error: "header value has a malformed reference" };
  let missing: string | undefined;
  const resolvedValue = value.replace(MCP_HEADER_REFERENCE, (_token, kind: "env" | "credential", name: string) => {
    const resolved = resolve(kind, name);
    if (resolved === undefined || resolved.length === 0) {
      missing ??= `\${${kind}:${name}}`;
      return "";
    }
    return resolved;
  });
  return missing !== undefined ? { error: `${missing} did not resolve` } : { value: resolvedValue };
}

// ---------------------------------------------------------------------------
// Trust store
// ---------------------------------------------------------------------------

export function mcpTrustPath(home: string = resolvePrismHome()): string {
  return join(home, "trust.json");
}

/** Stable per-server fingerprint: URL for HTTP servers, command + args + env keys for stdio. */
export function mcpServerFingerprint(server: PrismCodeMcpServer): string {
  const parts =
    server.url !== undefined
      ? ["url", server.url]
      : ["stdio", server.command ?? "", ...(server.args ?? []), ...Object.keys(server.env ?? {}).sort()];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Reads `trust.json`; a missing or corrupt file yields an empty (untrusted) set plus a notice. */
export function readMcpTrust(home: string = resolvePrismHome()): { readonly trust: McpTrustFile; readonly notice?: string } {
  const path = mcpTrustPath(home);
  if (!existsSync(path)) return { trust: EMPTY_TRUST };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("trust file must be an object");
    const repos = (parsed as { repos?: unknown }).repos;
    if (typeof repos !== "object" || repos === null || Array.isArray(repos)) throw new Error("trust file has no repo map");
    return { trust: { version: 1, repos: repos as Record<string, Record<string, string>> } };
  } catch (error) {
    return {
      trust: EMPTY_TRUST,
      notice: `cannot read MCP trust file ${path} (${error instanceof Error ? error.message : String(error)}); treating project servers as untrusted`,
    };
  }
}

export function isMcpServerTrusted(trust: McpTrustFile, workspaceRoot: string, server: PrismCodeMcpServer): boolean {
  return trust.repos[workspaceRoot]?.[server.serverId] === mcpServerFingerprint(server);
}

/** Records a trust decision in `trust.json` (0600). Best-effort: a write failure only loses the memory. */
export function writeMcpTrustDecision(home: string, workspaceRoot: string, server: PrismCodeMcpServer): { readonly notice?: string } {
  const path = mcpTrustPath(home);
  try {
    ensureHomeDir(home);
    const { trust } = readMcpTrust(home);
    const repos = { ...trust.repos, [workspaceRoot]: { ...trust.repos[workspaceRoot], [server.serverId]: mcpServerFingerprint(server) } };
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, repos }, null, 2)}\n`, { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    return {};
  } catch (error) {
    return { notice: `could not record MCP trust for "${server.serverId}": ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ---------------------------------------------------------------------------
// Server resolution
// ---------------------------------------------------------------------------

function disabledSpec(server: PrismCodeMcpServer, reason: string): McpServerSpec {
  if (server.url !== undefined) {
    return { serverId: server.serverId, url: server.url, allow: server.allow ?? new URL(server.url).origin, disabledReason: reason };
  }
  return { serverId: server.serverId, command: server.command ?? server.serverId, allow: "stdio", disabledReason: reason };
}

async function resolveHeaders(
  server: PrismCodeMcpServer,
  credentials: PrismCodeCredentialManager,
  env: NodeJS.ProcessEnv,
): Promise<{ readonly headers?: Record<string, string>; readonly error?: string; readonly values: Record<string, string> }> {
  const values: Record<string, string> = {};
  const credentialKeys = new Map<string, string | undefined>();
  for (const [name, raw] of Object.entries(server.headers ?? {})) {
    for (const match of raw.matchAll(MCP_HEADER_REFERENCE)) {
      const [, kind, refName] = match;
      if (kind === "credential" && refName !== undefined && !credentialKeys.has(refName)) {
        credentialKeys.set(refName, await credentials.getApiKey(refName).catch(() => undefined));
      }
    }
    const resolved = resolveMcpHeaderValue(raw, (kind, refName) => (kind === "env" ? env[refName] : credentialKeys.get(refName)));
    if ("error" in resolved) return { error: `${name}: ${resolved.error}`, values };
    values[name] = resolved.value;
  }
  return { headers: values, values };
}

/** Turns one trusted declaration into an SDK spec; resolve failures become preflight `failed` status. */
async function buildSpec(
  server: PrismCodeMcpServer,
  credentials: PrismCodeCredentialManager,
  env: NodeJS.ProcessEnv,
): Promise<McpServerSpec> {
  const common = {
    serverId: server.serverId,
    allow: server.allow ?? "stdio",
    ...(server.namePrefix !== undefined ? { namePrefix: server.namePrefix } : {}),
    ...(server.readOnly === true ? { readOnly: true } : {}),
    ...(server.connectTimeoutMs !== undefined ? { connectTimeoutMs: server.connectTimeoutMs } : {}),
  };
  if (server.url !== undefined) {
    const resolved = await resolveHeaders(server, credentials, env);
    const http = {
      ...common,
      allow: server.allow ?? new URL(server.url).origin,
      url: server.url,
      ...(server.transport !== undefined ? { transport: server.transport as "streamable-http" | "http" | "sse" } : {}),
    };
    if (resolved.error !== undefined) return { ...http, preflightError: resolved.error };
    const auth = server.auth === "oauth" ? createMcpAuthOptions(server, { credentials, env }) : undefined;
    return {
      ...http,
      ...(resolved.headers && Object.keys(resolved.headers).length > 0 ? { headers: resolved.headers } : {}),
      ...(auth ? { auth } : {}),
    };
  }
  return {
    ...common,
    ...(server.transport !== undefined ? { transport: "stdio" as const } : {}),
    command: server.command ?? server.serverId,
    ...(server.args ? { args: server.args } : {}),
    ...(server.env ? { env: server.env } : {}),
    ...(server.cwd !== undefined ? { cwd: server.cwd } : {}),
  };
}

/** Resolves config declarations into SDK specs, applies the per-repo trust gate, and resolves headers. */
export async function resolveMcpServers(options: ResolveMcpServersOptions): Promise<ResolvedMcpServers> {
  const declarations = options.servers ?? [];
  if (declarations.length === 0) return { servers: [], notes: [] };
  const mode = options.mode ?? "allow";
  const origins = options.origins ?? new Map<string, McpServerOrigin>();
  const home = options.home ?? resolvePrismHome();
  const env = options.env ?? process.env;
  const notes: string[] = [];
  const servers: McpServerSpec[] = [];

  let trust: McpTrustFile | undefined;
  if (declarations.some((server) => origins.get(server.serverId) !== "global")) {
    const read = readMcpTrust(home);
    if (read.notice) notes.push(read.notice);
    trust = read.trust;
  }

  for (const declaration of declarations) {
    if (declaration.enabled === false) {
      servers.push(disabledSpec(declaration, "disabled in configuration"));
      continue;
    }
    const origin: McpServerOrigin = origins.get(declaration.serverId) ?? "project";
    let trusted = origin === "global";
    if (!trusted && trust) {
      trusted = isMcpServerTrusted(trust, options.workspaceRoot, declaration);
    }
    if (!trusted && mode === "allow") {
      trusted = true;
    }
    if (!trusted && mode === "prompt") {
      trusted = (await options.promptTrust?.(declaration)) === true;
      if (trusted) {
        const written = writeMcpTrustDecision(home, options.workspaceRoot, declaration);
        if (written.notice) notes.push(written.notice);
        else notes.push(`trusted MCP server "${declaration.serverId}" for this repository`);
      }
    }
    if (!trusted) {
      const reason = `project MCP server "${declaration.serverId}" is not trusted for this repository; approve it in the TUI or pass --trust-project-mcp`;
      notes.push(`skipped ${reason}`);
      servers.push(disabledSpec(declaration, reason));
      continue;
    }
    servers.push(await buildSpec(declaration, options.credentialManager, env));
  }

  return { servers, notes };
}

// ---------------------------------------------------------------------------
// OAuth persistence and options
// ---------------------------------------------------------------------------

type StoredTokens = Parameters<McpClientAuthState["saveTokens"]>[0];
type DiscoveryState = Parameters<McpClientAuthState["saveDiscovery"]>[0];
type ClientInformation = Parameters<McpClientAuthState["saveClientInformation"]>[0];
type AuthorizationState = NonNullable<Parameters<NonNullable<McpClientAuthState["saveAuthorizationState"]>>[0]>;

interface McpAuthBlob {
  tokens?: StoredTokens;
  discovery?: DiscoveryState;
  clientInformation?: ClientInformation;
  codeVerifier?: string;
  authorizationState?: AuthorizationState;
}

/** `McpClientAuthState` over the Prism Code credential store, slot `mcp:<serverId>`. */
export function createMcpAuthState(credentials: PrismCodeCredentialManager, serverId: string): McpClientAuthState {
  const provider = `mcp:${serverId}`;
  const loadBlob = async (): Promise<McpAuthBlob> => {
    const stored = await credentials.getOAuth(provider).catch(() => undefined);
    const chunk = stored?.metadata?.[MCP_AUTH_CHUNK];
    return typeof chunk === "object" && chunk !== null ? (chunk as McpAuthBlob) : {};
  };
  const saveBlob = async (blob: McpAuthBlob): Promise<void> => {
    if (Object.keys(blob).length === 0) {
      await credentials.deleteOAuth(provider);
      return;
    }
    await credentials.setOAuth(provider, {
      ...(blob.tokens?.access_token ? { access: blob.tokens.access_token } : {}),
      ...(blob.tokens?.refresh_token ? { refresh: blob.tokens.refresh_token } : {}),
      metadata: { [MCP_AUTH_CHUNK]: blob },
    });
  };
  const mutate = async (patch: Partial<McpAuthBlob>, remove: readonly (keyof McpAuthBlob)[]): Promise<void> => {
    const blob = await loadBlob();
    for (const key of remove) delete blob[key];
    Object.assign(blob, patch);
    await saveBlob(blob);
  };
  return {
    async loadTokens(issuer) {
      const tokens = (await loadBlob()).tokens;
      if (!tokens) return undefined;
      return issuer !== undefined && tokens.issuer !== undefined && tokens.issuer !== issuer ? undefined : tokens;
    },
    saveTokens: (tokens) => mutate({ tokens }, []),
    loadDiscovery: async () => (await loadBlob()).discovery,
    saveDiscovery: (state) => mutate({ discovery: state }, []),
    loadClientInformation: async () => (await loadBlob()).clientInformation,
    saveClientInformation: (info) => mutate({ clientInformation: info }, []),
    loadCodeVerifier: async () => (await loadBlob()).codeVerifier,
    saveCodeVerifier: (verifier) => mutate({ codeVerifier: verifier }, []),
    saveAuthorizationState: (record) => mutate({ authorizationState: record }, []),
    loadAuthorizationState: async () => (await loadBlob()).authorizationState,
    async clear(scope) {
      if (scope === "all") {
        await credentials.deleteOAuth(provider);
        return;
      }
      const key: keyof McpAuthBlob =
        scope === "client"
          ? "clientInformation"
          : scope === "tokens"
            ? "tokens"
            : scope === "verifier"
              ? "codeVerifier"
              : scope === "discovery"
                ? "discovery"
                : "authorizationState";
      await mutate({}, [key]);
    },
  };
}

export function mcpOAuthRedirectUri(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[MCP_OAUTH_REDIRECT_URI_ENV];
  return override !== undefined && override.length > 0 ? override : MCP_OAUTH_REDIRECT_URI;
}

/** Builds SDK auth options for an `"oauth"` server. Without `onRedirectRequired`, a missing grant fails closed. */
export function createMcpAuthOptions(
  server: Pick<PrismCodeMcpServer, "serverId" | "url">,
  options: {
    readonly credentials: PrismCodeCredentialManager;
    readonly onRedirectRequired?: (authorizationUrl: URL) => void | Promise<void>;
    readonly redirectUri?: string;
    readonly scopes?: readonly string[];
    readonly env?: NodeJS.ProcessEnv;
  },
): McpClientAuthOptions {
  const strategy: McpOAuthRegistrationStrategy = {
    kind: "dcr",
    clientMetadata: {
      client_name: `prism-code (${server.serverId})`,
      application_type: "native",
      redirect_uris: [options.redirectUri ?? mcpOAuthRedirectUri(options.env)],
    },
  };
  return {
    state: createMcpAuthState(options.credentials, server.serverId),
    strategy,
    redirectUri: options.redirectUri ?? mcpOAuthRedirectUri(options.env),
    ...(options.scopes ? { scopes: options.scopes } : {}),
    ...(options.onRedirectRequired ? { onRedirectRequired: options.onRedirectRequired } : {}),
  };
}
