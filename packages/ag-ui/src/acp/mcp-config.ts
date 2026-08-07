/**
 * Phase 10 Task 4 — MCP server configuration validation.
 *
 * Client-supplied MCP servers are untrusted. `validateMcpServers` enforces
 * the frozen caps (count, per-config bytes, header-value bytes), rejects the
 * experimental `acp` transport unconditionally, requires http/sse transports
 * to be advertised (`mcp.transports`), and runs every server through the
 * host's `mcp.select` approval gate before the agent forwards anything to the
 * host bridge. Fail closed on every rule; nothing reaches the host unvetted.
 */
import type { McpServer } from "@agentclientprotocol/sdk";
import type { ResolvedAgUiLimits } from "../limits.js";
import type { AcpMcpSeams } from "./capabilities.js";
import { AcpError } from "./errors.js";

/** Validates and gates client-supplied MCP servers; returns the approved (unmodified) configs. */
export async function validateMcpServers(
  servers: readonly McpServer[],
  seams: AcpMcpSeams | undefined,
  limits: ResolvedAgUiLimits,
  signal: AbortSignal,
): Promise<readonly McpServer[]> {
  if (servers.length === 0) return servers;
  if (!seams?.select) {
    throw new AcpError("ERR_PRISM_ACP_POLICY", "mcpServers rejected: no mcp.select seam wired");
  }
  if (servers.length > limits.acpMcpServersPerSession) {
    throw new AcpError("ERR_PRISM_ACP_LIMIT", `mcpServers exceeds ${limits.acpMcpServersPerSession} servers`);
  }
  for (const server of servers) {
    const bytes = Buffer.byteLength(JSON.stringify(server), "utf8");
    if (bytes > limits.acpMcpServerConfigBytes) {
      throw new AcpError("ERR_PRISM_ACP_LIMIT", `mcp server config exceeds ${limits.acpMcpServerConfigBytes} bytes`);
    }
    // McpServerStdio is untagged; http/sse/acp carry a `type` discriminant.
    if ("type" in server) {
      if (server.type === "acp") {
        throw new AcpError("ERR_PRISM_ACP_POLICY", "mcp server transport 'acp' is UNSTABLE and rejected");
      }
      if (!seams.transports?.includes(server.type)) {
        throw new AcpError("ERR_PRISM_ACP_POLICY", `mcp server transport '${server.type}' is not advertised`);
      }
      for (const header of server.headers) {
        if (Buffer.byteLength(header.value, "utf8") > limits.acpMcpHeaderValueBytes) {
          throw new AcpError("ERR_PRISM_ACP_LIMIT", `mcp header value exceeds ${limits.acpMcpHeaderValueBytes} bytes`);
        }
      }
    }
    // else: untagged stdio — no advertisement concept; host select gates it.
  }
  const approved = await seams.select({ servers, signal });
  if (!approved) throw new AcpError("ERR_PRISM_ACP_POLICY", "mcpServers rejected by host policy");
  return servers;
}
