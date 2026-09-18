import { assertIdentityActive, type AgentIdentity, type ToolDefinition } from "@arnilo/prism";
import { connectMcpTools } from "./bridge.js";
import { HARD_MAX_TOOLS, HARD_MAX_TOOL_NAME_BYTES } from "./limits.js";
import { assertValidServerId, defaultMcpNamePrefix, formatMcpToolName } from "./names.js";
import { McpBridgeError } from "./types.js";
import type { ConnectedAppBinding, ConnectedAppSession, CreateConnectedAppSessionOptions, McpToolBridge } from "./types.js";

const DEFAULT_MAX_APPS = 8;
const HARD_MAX_APPS = 32;

interface BoundApp {
  readonly appId: string;
  readonly serverId: string;
  readonly bridge: McpToolBridge;
  readonly allowedNames?: ReadonlySet<string>;
}

/** Creates an identity-bound collection of host-selected MCP tool bridges. */
export function createConnectedAppSession(options: CreateConnectedAppSessionOptions): ConnectedAppSession {
  if (!options || typeof options.select !== "function") throw new McpBridgeError("Connected app select is required");
  if (options.connect !== undefined && typeof options.connect !== "function")
    throw new McpBridgeError("Connected app connect must be a function");
  assertIdentityActive(options.identity);
  const maxApps = validateMaxApps(options.maxApps);
  const apps = new Map<string, BoundApp>();
  const pendingAppIds = new Set<string>();
  const pendingServerIds = new Set<string>();
  let closed = false;

  return {
    async bind(binding) {
      assertOpen(closed);
      assertBinding(binding);
      assertIdentityActive(options.identity);
      assertBindingIdentity(options.identity, binding.identity);
      if (apps.has(binding.appId) || pendingAppIds.has(binding.appId))
        throw new McpBridgeError(`Connected app "${binding.appId}" is already bound`);
      if (serverBound(apps, binding.serverId) || pendingServerIds.has(binding.serverId))
        throw new McpBridgeError(`Connected app serverId "${binding.serverId}" is already bound`);
      if (apps.size + pendingAppIds.size >= maxApps) throw new McpBridgeError(`Connected app limit (${maxApps}) reached`);

      pendingAppIds.add(binding.appId);
      pendingServerIds.add(binding.serverId);
      try {
        const selected = await options.select({ ...binding, identity: options.identity });
        if (selected !== true) throw new McpBridgeError(`Connected app "${binding.appId}" was not selected`);
        assertOpen(closed);
        const prefix = defaultMcpNamePrefix(binding.serverId);
        const bridge = await (options.connect ?? connectMcpTools)({
          serverId: binding.serverId,
          transport: binding.transport,
          namePrefix: prefix,
          ...((binding.effect ?? options.effect) ? { effect: binding.effect ?? options.effect } : {}),
        });
        if (closed) {
          await bridge.close();
          throw new McpBridgeError("Connected app session is closed");
        }
        apps.set(binding.appId, {
          appId: binding.appId,
          serverId: binding.serverId,
          bridge,
          ...(binding.allowTools === undefined ? {} : { allowedNames: allowedNames(binding.allowTools, prefix) }),
        });
      } finally {
        pendingAppIds.delete(binding.appId);
        pendingServerIds.delete(binding.serverId);
      }
    },

    async unbind(appId) {
      assertOpen(closed);
      assertValidServerId(appId);
      const app = apps.get(appId);
      if (!app) return;
      apps.delete(appId);
      await app.bridge.close();
    },

    list() {
      assertOpen(closed);
      return [...apps.values()].map((app) => ({
        appId: app.appId,
        serverId: app.serverId,
        tools: visibleTools(app).map((tool) => tool.name),
      }));
    },

    tools() {
      assertOpen(closed);
      return [...apps.values()].flatMap(visibleTools);
    },

    async refresh() {
      assertOpen(closed);
      await Promise.all([...apps.values()].map((app) => app.bridge.refresh()));
    },

    async close() {
      if (closed) return;
      closed = true;
      const bound = [...apps.values()];
      apps.clear();
      await Promise.all(bound.map((app) => app.bridge.close()));
    },
  };
}

function assertBinding(binding: ConnectedAppBinding): void {
  if (!binding || typeof binding !== "object") throw new McpBridgeError("Connected app binding is required");
  assertValidServerId(binding.appId);
  assertValidServerId(binding.serverId);
  if (binding.allowTools === undefined) return;
  if (!Array.isArray(binding.allowTools)) throw new McpBridgeError("allowTools must be an array");
  if (binding.allowTools.length > HARD_MAX_TOOLS) throw new McpBridgeError(`allowTools exceeds ${HARD_MAX_TOOLS} entries`);
  for (const name of binding.allowTools) {
    if (typeof name !== "string" || !name || Buffer.byteLength(name, "utf8") > HARD_MAX_TOOL_NAME_BYTES)
      throw new McpBridgeError(`allowTools entries must be non-empty strings <= ${HARD_MAX_TOOL_NAME_BYTES} bytes`);
  }
}

function assertBindingIdentity(session: AgentIdentity, binding?: AgentIdentity): void {
  if (!binding) return;
  assertIdentityActive(binding);
  if (
    binding.tenantId !== session.tenantId ||
    binding.accountId !== session.accountId ||
    binding.userId !== session.userId ||
    binding.principal.kind !== session.principal.kind ||
    binding.principal.id !== session.principal.id
  ) {
    throw new McpBridgeError("Connected app binding identity does not match session identity");
  }
}

function allowedNames(names: readonly string[], prefix: string): ReadonlySet<string> {
  return new Set(names.map((name) => formatMcpToolName(prefix, name)));
}

function visibleTools(app: BoundApp): readonly ToolDefinition[] {
  const allowed = app.allowedNames;
  return allowed ? app.bridge.tools.filter((tool) => allowed.has(tool.name)) : app.bridge.tools;
}

function serverBound(apps: ReadonlyMap<string, BoundApp>, serverId: string): boolean {
  return [...apps.values()].some((app) => app.serverId === serverId);
}

function validateMaxApps(maxApps: number | undefined): number {
  const value = maxApps ?? DEFAULT_MAX_APPS;
  if (!Number.isSafeInteger(value) || value < 1 || value > HARD_MAX_APPS)
    throw new McpBridgeError(`maxApps must be a positive safe integer <= ${HARD_MAX_APPS}`);
  return value;
}

function assertOpen(closed: boolean): void {
  if (closed) throw new McpBridgeError("Connected app session is closed");
}
