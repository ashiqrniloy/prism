/** registry (0.2.5 plan 025 Task 1 split). Moved verbatim from agent.ts; public surface unchanged behind the barrel. */
import { AcpError } from "../errors.js";
import type { AcpSessionSummary, ResolvedAcpClientCapabilities } from "../capabilities.js";
import type { McpServer, SessionConfigOption, SessionInfo, SessionModeState } from "@agentclientprotocol/sdk";
import { resolveAgUiLimits } from "../../limits.js";
import { toSessionConfigOptions, toSessionModeState } from "../modes.js";
import { validateMcpServers } from "../mcp-config.js";
import type { AcpAuthorization, ActiveSession, CreatePrismAcpAgentOptions } from "./types.js";

export function registerSession(
  sessions: Map<string, ActiveSession>,
  limits: ReturnType<typeof resolveAgUiLimits>,
  binding: ActiveSession,
): void {
  if (sessions.has(binding.session.id)) throw new AcpError("ERR_PRISM_ACP_INPUT", "ACP session already exists");
  if (sessions.size >= limits.acpSessions) {
    throw new AcpError("ERR_PRISM_ACP_LIMIT", `ACP session registry is full (${limits.acpSessions})`);
  }
  sessions.set(binding.session.id, binding);
}

/** modes/configOptions response fields for new/load/resume; config options gated on the client advertisement. */
export function sessionState<Authorization extends AcpAuthorization>(
  active: ActiveSession,
  options: CreatePrismAcpAgentOptions<Authorization>,
  clientCapabilities: ResolvedAcpClientCapabilities,
): { readonly modes?: SessionModeState; readonly configOptions?: SessionConfigOption[] } {
  return {
    ...(options.modes && active.modeId ? { modes: toSessionModeState(options.modes, active.modeId) } : {}),
    ...(options.configOptions && clientCapabilities.configOptionBoolean
      ? { configOptions: toSessionConfigOptions(options.configOptions, active.configValues) }
      : {}),
  };
}

/** Policy-checks and bounds the client-supplied session inputs shared by new/load/resume. */
export async function resolveSessionInputs<Authorization extends AcpAuthorization>(
  params: {
    readonly additionalDirectories?: readonly string[] | null;
    readonly mcpServers?: readonly McpServer[];
  },
  options: CreatePrismAcpAgentOptions<Authorization>,
  limits: ReturnType<typeof resolveAgUiLimits>,
  signal: AbortSignal,
): Promise<{ readonly additionalDirectories: readonly string[]; readonly mcpServers: readonly McpServer[] }> {
  const directories = params.additionalDirectories ?? [];
  let additionalDirectories: readonly string[] = [];
  if (directories.length > 0) {
    const seam = options.sessions?.additionalDirectories;
    if (!seam) throw new AcpError("ERR_PRISM_ACP_POLICY", "additionalDirectories rejected: capability not advertised");
    if (directories.length > limits.acpAdditionalDirectories) {
      throw new AcpError("ERR_PRISM_ACP_LIMIT", `additionalDirectories exceeds ${limits.acpAdditionalDirectories}`);
    }
    for (const path of directories) {
      if (!path || Buffer.byteLength(path, "utf8") > limits.acpAdditionalDirectoryPathBytes) {
        throw new AcpError(
          "ERR_PRISM_ACP_LIMIT",
          `additionalDirectories path invalid or exceeds ${limits.acpAdditionalDirectoryPathBytes} bytes`,
        );
      }
    }
    additionalDirectories = await seam({ directories, signal });
  }
  return { additionalDirectories, mcpServers: await validateMcpServers(params.mcpServers ?? [], options.mcp, limits, signal) };
}

/** Opaque cursor = decimal page offset into the host's ordered list. */
export function parseCursor(cursor: string | null | undefined): number {
  if (cursor == null || cursor === "") return 0;
  return /^[0-9]+$/.test(cursor) ? Number(cursor) : Number.NaN;
}

export function toSessionInfo(summary: AcpSessionSummary): SessionInfo {
  return {
    sessionId: summary.sessionId,
    cwd: summary.cwd,
    ...(summary.additionalDirectories ? { additionalDirectories: [...summary.additionalDirectories] } : {}),
    ...(summary.title ? { title: summary.title } : {}),
    ...(summary.updatedAt ? { updatedAt: summary.updatedAt } : {}),
  };
}

export function session(sessions: ReadonlyMap<string, ActiveSession>, id: string): ActiveSession {
  const value = sessions.get(id);
  if (!value) throw new Error("Unknown ACP session");
  return value;
}

/** Prism user message for the host session: text blocks plus forwarded media parts. */
