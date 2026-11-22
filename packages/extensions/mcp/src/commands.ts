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

/** `closeServer` closes the bridge and cancels a pending reconnect or sign-in, so a closed server stays closed. */
export function createMcpCloseCommand(
  entries: InternalServerEntry[],
  closeServer: (entry: InternalServerEntry) => Promise<void>,
  emitStatus: (data: JsonObject) => void,
): PackageCommand {
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
        await closeServer(entry);
        const status = toServerStatus(entry);
        emitStatus(status);
        return status;
      }

      await Promise.all(entries.map(closeServer));
      const servers = entries.map(toServerStatus);
      emitStatus({ servers });
      return { servers };
    },
  };
}

function createMcpServerCommand(
  name: string,
  description: string,
  entries: InternalServerEntry[],
  action: (entry: InternalServerEntry) => Promise<void>,
  emitStatus: (data: JsonObject) => void,
): PackageCommand {
  return {
    name,
    description,
    args: {
      type: "object",
      properties: { id: { type: "string", minLength: 1 } },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (args: JsonObject) => {
      const id = String(args.id);
      const entry = entries.find((e) => e.config.id === id);
      if (!entry) {
        throw new Error(`MCP server "${id}" is not configured`);
      }
      await action(entry);
      const status = toServerStatus(entry);
      emitStatus(status);
      return status;
    },
  };
}

/** Signs in to an OAuth server through `host.ui` (dropping stored tokens first), then reconnects it. */
export function createMcpLoginCommand(
  entries: InternalServerEntry[],
  login: (entry: InternalServerEntry) => Promise<void>,
  emitStatus: (data: JsonObject) => void,
): PackageCommand {
  return createMcpServerCommand("mcp:login", "Sign in to an OAuth-protected MCP server", entries, login, emitStatus);
}

/** Deletes an OAuth server's stored sign-in record and closes its bridge. */
export function createMcpLogoutCommand(
  entries: InternalServerEntry[],
  logout: (entry: InternalServerEntry) => Promise<void>,
  emitStatus: (data: JsonObject) => void,
): PackageCommand {
  return createMcpServerCommand("mcp:logout", "Sign out of an OAuth-protected MCP server", entries, logout, emitStatus);
}
