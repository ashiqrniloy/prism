import type { JsonObject, PackageCommand } from "@arnilo/prism";
import type { InternalServerEntry } from "./status.js";
import { toServerStatus } from "./status.js";

export function createMcpStatusCommand(entries: InternalServerEntry[], emitStatus: (data: JsonObject) => void): PackageCommand {
  return {
    name: "mcp:status",
    description: "Show status of configured MCP servers",
    args: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const servers = entries.map(toServerStatus);
      emitStatus({ servers });
      return { servers };
    },
  };
}

export function createMcpReconnectCommand(
  entries: InternalServerEntry[],
  reconnectServer: (entry: InternalServerEntry) => Promise<void>,
  emitStatus: (data: JsonObject) => void,
): PackageCommand {
  return {
    name: "mcp:reconnect",
    description: "Reconnect an MCP server",
    args: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1 },
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (args: JsonObject) => {
      const id = String(args.id);
      const entry = entries.find((e) => e.config.id === id);
      if (!entry) {
        throw new Error(`MCP server "${id}" is not configured`);
      }
      await reconnectServer(entry);
      const status = toServerStatus(entry);
      emitStatus(status);
      return status;
    },
  };
}

export function createMcpCloseCommand(entries: InternalServerEntry[], emitStatus: (data: JsonObject) => void): PackageCommand {
  return {
    name: "mcp:close",
    description: "Close one or all MCP servers",
    args: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      additionalProperties: false,
    },
    run: async (args: JsonObject) => {
      const id = args.id !== undefined ? String(args.id) : undefined;
      if (id !== undefined) {
        const entry = entries.find((e) => e.config.id === id);
        if (!entry) {
          throw new Error(`MCP server "${id}" is not configured`);
        }
        if (entry.bridge) {
          try {
            await entry.bridge.close();
          } catch {}
          entry.bridge = undefined;
        }
        entry.state = "closed";
        const status = toServerStatus(entry);
        emitStatus(status);
        return status;
      }

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
      const servers = entries.map(toServerStatus);
      emitStatus({ servers });
      return { servers };
    },
  };
}
