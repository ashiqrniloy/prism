import manifest from "../package.json" with { type: "json" };
import { definePackage, type PackageInstance, PackageLoadError } from "@arnilo/prism";
import type { Transport } from "@modelcontextprotocol/client";
import { connectMcpTools } from "./bridge.js";
import { createMcpCloseCommand, createMcpReconnectCommand, createMcpStatusCommand } from "./commands.js";
import { type McpPackageConfig, mcpConfigSchema } from "./config.js";
import { type InternalServerEntry, redactMcpError, toServerStatus } from "./status.js";
import { checkServerTrust, isServerAllowed } from "./trust.js";
import type { McpTransportConfig } from "./types.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 15000;

export const mcpPackageDefinition = definePackage<McpPackageConfig>({
  name: "@arnilo/prism-mcp",
  version: manifest.version,
  description: "Bounded MCP tools, resources, prompts, client callbacks, and authorized Streamable HTTP sessions.",
  requires: { api: 1 },
  capabilities: ["host-ui", "credentials"],
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
        throw new PackageLoadError("config_invalid", `MCP server: duplicate id "${server.id}"`, { package: "@arnilo/prism-mcp" });
      }
      seenIds.add(server.id);

      if (server.allow === undefined && config.allow === undefined) {
        throw new PackageLoadError("config_invalid", `MCP server "${server.id}": missing explicit allow specification`, {
          package: "@arnilo/prism-mcp",
        });
      }
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
        tools: [],
      })),
    );

    const connectServer = async (entry: InternalServerEntry, isReconnect = false): Promise<void> => {
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
          allowLoopbackHttp: true,
          requestInit: Object.keys(resolvedHeaders).length > 0 ? { headers: resolvedHeaders } : undefined,
        };
      }

      const timeoutMs = entry.config.connectTimeoutMs ?? config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const bridge = await connectMcpTools({
          serverId: entry.config.id,
          transport: transportConfig,
          namePrefix: entry.config.namePrefix,
          signal: controller.signal,
          callTimeoutMs: timeoutMs,
        });

        entry.bridge = bridge;
        entry.state = "connected";
        const mappedTools = bridge.tools.map((t) => ({
          ...t,
          effects: entry.config.readOnly ? (["read"] as const) : (["external"] as const),
        }));

        if (isReconnect) {
          const existingNames = new Set(entry.tools.map((t) => t.name));
          const added = mappedTools.filter((t) => !existingNames.has(t.name)).length;
          entry.added = added;
          if (added > 0) {
            prism.status.note(
              "warn",
              `MCP server "${entry.config.id}" added ${added} new tools after reconnect; recreate the agent to register them`,
            );
          }
        }

        entry.tools = mappedTools;
        entry.error = undefined;
        entry.reason = undefined;
        prism.events.emit("mcp.status", toServerStatus(entry));
      } catch (error) {
        entry.state = "failed";
        entry.error = redactMcpError(entry.config, error);
        prism.status.note("warn", `MCP server "${entry.config.id}" failed: ${entry.error}`);
        // MCP OAuth is not offered (plan 159 Task 1 (f)); say so when a server asks for it.
        if (/\b401\b|unauthori[sz]ed|www-authenticate/i.test(entry.error)) {
          prism.status.note("warn", `MCP server "${entry.config.id}" requires OAuth; this package does not run the OAuth flow`);
        }
        prism.events.emit("mcp.status", toServerStatus(entry));
      } finally {
        clearTimeout(timer);
      }
    };

    // Connect allowed, trusted servers concurrently
    await Promise.all(entries.map((entry) => connectServer(entry)));

    // Register discovered tools once
    for (const entry of entries) {
      for (const tool of entry.tools) {
        prism.tools.register(tool, {
          when: () => entry.state === "connected",
        });
      }
    }

    // Register package commands
    prism.commands.register(createMcpStatusCommand(entries, (data) => prism.events.emit("mcp.status", data)));
    prism.commands.register(
      createMcpReconnectCommand(
        entries,
        async (entry) => {
          if (entry.bridge) {
            try {
              await entry.bridge.close();
            } catch {}
            entry.bridge = undefined;
          }
          await connectServer(entry, true);
        },
        (data) => prism.events.emit("mcp.status", data),
      ),
    );
    prism.commands.register(createMcpCloseCommand(entries, (data) => prism.events.emit("mcp.status", data)));

    // On dispose, close all bridges
    prism.onDispose(async () => {
      await Promise.all(
        entries.map(async (entry) => {
          if (entry.bridge) {
            try {
              await entry.bridge.close();
            } catch {}
            entry.bridge = undefined;
          }
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
