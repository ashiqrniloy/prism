/** coding (0.2.5 plan 025 Task 1 split). Moved verbatim from agent.ts; public surface unchanged behind the barrel. */
import type { AgentContext } from "@agentclientprotocol/sdk";
import type { ResolvedAcpClientCapabilities } from "../capabilities.js";
import type { AcpCodingContext, AcpCodingSeams } from "./types.js";

export async function buildAcpCoding(
  seams: AcpCodingSeams | undefined,
  capabilities: ResolvedAcpClientCapabilities,
  client: AgentContext,
  sessionId: string | undefined,
): Promise<AcpCodingContext | undefined> {
  if (!seams) return undefined;
  const filesystem =
    capabilities.fsReadTextFile || capabilities.fsWriteTextFile ? await seams.filesystem?.(client, sessionId ?? "") : undefined;
  const processes = capabilities.terminal && sessionId ? await seams.processes?.(client, sessionId) : undefined;
  return {
    ...(filesystem ? { filesystem } : {}),
    ...(processes ? { processes } : {}),
  };
}

/** Cap-checked registry insert: duplicate id or a full registry fail closed. */
