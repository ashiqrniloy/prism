/**
 * Truthful ACP capability negotiation (Phase 10 Task 2 freeze).
 *
 * `resolveAcpAgentCapabilities` is a pure function of host-wired seams: an
 * absent seam omits the matching capability key — never an empty stub that
 * implies support. Client capabilities are read from the initialize request
 * and gate later client-method use (`resolveAcpClientCapabilities`).
 *
 * Frozen never-cells (scripts/phase10-freeze-manifest.json capabilityMatrix):
 * mcpCapabilities.acp, sessionCapabilities.fork, auth, providers, nes,
 * positionEncoding — all UNSTABLE v2 surface, never advertised in 0.0.27.
 */
import type { AgentCapabilities, ClientCapabilities, McpServer } from "@agentclientprotocol/sdk";
import type { AcpSessionBinding } from "./agent.js";

/** One row of `session/list`; maps onto SDK `SessionInfo` (cwd is schema-required). */
export interface AcpSessionSummary {
  readonly sessionId: string;
  /** Absolute working directory. */
  readonly cwd: string;
  /** Complete ordered additional-root list, when the session has any. */
  readonly additionalDirectories?: readonly string[];
  readonly title?: string;
  /** ISO 8601 timestamp of last activity. */
  readonly updatedAt?: string;
}

/** Host-owned session store seams. Presence of a seam advertises the matching capability. */
export interface AcpSessionStoreSeams {
  /** `session/load`: reconstruct a stored session. `sessionId` omitted means "most recent" (ACP spec). */
  readonly load?: (input: {
    readonly sessionId?: string;
    readonly cwd: string;
    readonly signal: AbortSignal;
  }) => AcpSessionBinding | Promise<AcpSessionBinding>;
  /** `session/list`: ordered known sessions; the agent pages by cursor. */
  readonly list?: (input: {
    readonly cwd?: string;
    readonly signal: AbortSignal;
  }) => readonly AcpSessionSummary[] | Promise<readonly AcpSessionSummary[]>;
  /** `session/delete`: remove a stored session. */
  readonly delete?: (input: { readonly sessionId: string; readonly signal: AbortSignal }) => void | Promise<void>;
  /** `session/resume`: resume a session's durable run. */
  readonly resume?: (input: {
    readonly sessionId: string;
    readonly cwd: string;
    readonly signal: AbortSignal;
  }) => AcpSessionBinding | Promise<AcpSessionBinding>;
  /** Policy seam: returns the allowed subset of requested additional directories (order preserved). */
  readonly additionalDirectories?: (input: {
    readonly directories: readonly string[];
    readonly signal: AbortSignal;
  }) => readonly string[] | Promise<readonly string[]>;
}

/** MCP seams. `mcpCapabilities.{http,sse}` are advertised per transport only when `select` is present. */
export interface AcpMcpSeams {
  /** Host approval gate for client-supplied MCP servers; runs before any bridge connect. */
  readonly select?: (input: { readonly servers: readonly McpServer[]; readonly signal: AbortSignal }) => boolean | Promise<boolean>;
  /** Transports the host bridge supports (http/sse). Absent or empty => no MCP advertisement. */
  readonly transports?: readonly ("http" | "sse")[];
}

/** Capability policy seams that do not own protocol handlers. */
export interface AcpCapabilitiesOptions {
  readonly prompt?: {
    /** Present => `promptCapabilities.image` and `promptCapabilities.audio` are advertised. */
    readonly media?: (input: { readonly signal: AbortSignal }) => boolean | Promise<boolean>;
    /** Present => `promptCapabilities.embeddedContext` is advertised. */
    readonly embedded?: (input: { readonly signal: AbortSignal }) => boolean | Promise<boolean>;
  };
}

/** The subset of agent options that drives capability advertisement. */
export interface AcpCapabilitiesSource {
  readonly sessions?: AcpSessionStoreSeams;
  readonly mcp?: AcpMcpSeams;
  readonly capabilities?: AcpCapabilitiesOptions;
}

/** O(1) over the frozen capability field count; never touches I/O. */
export function resolveAcpAgentCapabilities(options: AcpCapabilitiesSource): AgentCapabilities {
  const sessionCapabilities: NonNullable<AgentCapabilities["sessionCapabilities"]> = { close: {} };
  if (options.sessions?.list) sessionCapabilities.list = {};
  if (options.sessions?.delete) sessionCapabilities.delete = {};
  if (options.sessions?.resume) sessionCapabilities.resume = {};
  if (options.sessions?.additionalDirectories) sessionCapabilities.additionalDirectories = {};

  const capabilities: AgentCapabilities = { sessionCapabilities };
  if (options.sessions?.load) capabilities.loadSession = true;

  const prompt = options.capabilities?.prompt;
  if (prompt?.media || prompt?.embedded) {
    capabilities.promptCapabilities = {};
    if (prompt.media) {
      capabilities.promptCapabilities.image = true;
      capabilities.promptCapabilities.audio = true;
    }
    if (prompt.embedded) capabilities.promptCapabilities.embeddedContext = true;
  }

  const transports = options.mcp?.select ? options.mcp.transports : undefined;
  if (transports?.length) {
    capabilities.mcpCapabilities = {};
    if (transports.includes("http")) capabilities.mcpCapabilities.http = true;
    if (transports.includes("sse")) capabilities.mcpCapabilities.sse = true;
  }
  return capabilities;
}

/** Client-side advertisements read from the initialize request; every flag defaults closed. */
export interface ResolvedAcpClientCapabilities {
  readonly fsReadTextFile: boolean;
  readonly fsWriteTextFile: boolean;
  readonly terminal: boolean;
  readonly configOptionBoolean: boolean;
  readonly elicitation: boolean;
}

export function resolveAcpClientCapabilities(client?: ClientCapabilities): ResolvedAcpClientCapabilities {
  return {
    fsReadTextFile: client?.fs?.readTextFile ?? false,
    fsWriteTextFile: client?.fs?.writeTextFile ?? false,
    terminal: client?.terminal ?? false,
    configOptionBoolean: client?.session?.configOptions?.boolean != null,
    elicitation: client?.elicitation != null,
  };
}
