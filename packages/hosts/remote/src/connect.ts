import type {
  Agent,
  AgentEvent,
  AgentInspection,
  HostUi,
  HostUiResponse,
  JsonObject,
  JsonValue,
  OwnershipScope,
  RunResult,
  SessionStore,
} from "@arnilo/prism";
import { attribute } from "./attribution.js";
import { createChannel } from "./channel.js";
import { createDispatcher, type Dispatcher } from "./dispatcher.js";
import { RemoteError } from "./errors.js";
import type { RemoteLimitOptions } from "./limits.js";
import { createSessionMirror } from "./mirror.js";
import type { HostUiRequestParams, InitializeResult, RemoteCapabilities } from "./protocol.js";
import { createSessionProxy, type SessionHandle } from "./session-proxy.js";
import { type SpawnedTransport, type StdioEndpoint, spawnStdioTransport } from "./stdio-client.js";
import type { RemoteTransport } from "./transport.js";

import { connectNetwork, type NetworkEndpoint } from "./transports/client.js";

export type ConnectEndpoint = NetworkEndpoint | StdioEndpoint | { readonly kind: "memory"; readonly transport: RemoteTransport };

export interface ConnectAgentOptions {
  /** `host.ui` answers the remote's `hostUi.request`s. Without it they answer `unavailable` and the remote run suspends. */
  readonly host?: { readonly ui?: HostUi };
  /** Archives each remote session into this store: a links entry, then one entry per completed message. */
  readonly mirror?: SessionStore;
  /** Stamped on mirrored entries. */
  readonly ownership?: OwnershipScope;
  /** `origin.remote` for forwarded events. Defaults to the server's `endpointId`. */
  readonly endpointId?: string;
  readonly limits?: RemoteLimitOptions;
}

const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const unsupported = (what: string): RemoteError => new RemoteError("remote_unsupported", `${what} is not supported on a remote agent`);

/**
 * Connects to a served agent and returns an `Agent` proxy. Forwarded events keep their catalog type and gain
 * `origin.remote`; tool events carry `executedBy: "external"`; the remote's `HostUi` requests go to
 * `options.host.ui`. The remote's own hooks and gates run its tools, so no local `tool.call` fires for them.
 */
export async function connectAgent(endpoint: ConnectEndpoint, options: ConnectAgentOptions = {}): Promise<Agent> {
  let spawned: SpawnedTransport | undefined;
  let transport: RemoteTransport;
  if (endpoint.kind === "stdio") {
    spawned = spawnStdioTransport(endpoint, options.limits);
    transport = spawned.transport;
  } else if (endpoint.kind === "memory") {
    transport = endpoint.transport;
  } else if (endpoint.kind === "websocket" || endpoint.kind === "http") {
    transport = await connectNetwork(endpoint, options.limits);
  } else {
    throw unsupported(`endpoint kind ${String((endpoint as { kind?: unknown }).kind)}`);
  }

  const ui = options.host?.ui;
  const handles = new Map<string, SessionHandle>();
  const agentSubscribers = new Set<ReturnType<typeof createChannel<AgentEvent>>>();
  let source = { agent: "", agentId: "", endpointId: options.endpointId ?? "" };

  const offered: RemoteCapabilities = { agentEvents: true, ...(ui ? { hostUi: true, "hostUi.secret": true } : {}) };
  const dispatcher: Dispatcher = createDispatcher({
    transport,
    role: "client",
    capabilities: offered,
    ...(options.limits ? { limits: options.limits } : {}),
    requests: {
      async "hostUi.request"(params): Promise<JsonValue> {
        const request = (params as unknown as HostUiRequestParams).request;
        if (!ui || !isObject(request)) return { status: "unavailable" };
        try {
          return (await ui.request(request as never)) as unknown as JsonValue;
        } catch {
          return { status: "unavailable" } satisfies HostUiResponse as JsonValue;
        }
      },
    },
    notifications: {
      "run.event"(params) {
        if (typeof params.sessionId === "string" && isObject(params.event))
          handles.get(params.sessionId)?.event(params.event as unknown as AgentEvent);
      },
      "run.settled"(params) {
        if (typeof params.sessionId === "string" && isObject(params.result))
          handles.get(params.sessionId)?.settled(params.result as unknown as RunResult);
      },
      "agent.event"(params) {
        if (!isObject(params.event)) return;
        const event = attribute(params.event as unknown as AgentEvent, source);
        for (const channel of agentSubscribers) channel.push(event);
      },
    },
  });

  let init: InitializeResult;
  let commands: Agent["commands"];
  try {
    init = await dispatcher.initialize();
    source = { agent: init.agent.name, agentId: init.agent.id, endpointId: options.endpointId ?? init.endpointId };
    const listed = (await dispatcher.request("commands.list")) as unknown as ReturnType<Agent["commands"]["list"]>;
    commands = {
      list: () => listed,
      run: (name, args, runOptions) =>
        dispatcher.request("commands.run", {
          name,
          ...(args ? { args } : {}),
          ...(runOptions?.session ? { sessionId: runOptions.session.id } : {}),
        }),
    };
  } catch (error) {
    await dispatcher.close().catch(() => {});
    spawned?.kill();
    throw error;
  }

  let disposed = false;
  void dispatcher.closed.then(() => {
    const gone = new RemoteError("disconnected", "connection closed");
    for (const handle of handles.values()) handle.disconnected(gone);
    for (const channel of agentSubscribers) channel.end();
    agentSubscribers.clear();
  });

  const tools = Object.freeze([...init.agent.tools]) as unknown as Agent["tools"];
  const skills = Object.freeze([...init.agent.skills]) as unknown as Agent["skills"];
  const config = Object.freeze({ id: init.agent.id, name: init.agent.name }) as unknown as Agent["config"];
  const remoteBlock = Object.freeze({
    endpointId: source.endpointId,
    protocol: init.protocol,
    capabilities: Object.freeze({ ...init.capabilities }),
  });
  const inspection = init.agent.inspection;

  const agent: Agent = {
    id: init.agent.id,
    config,
    commands,
    get tools() {
      return disposed ? [] : tools;
    },
    get skills() {
      return disposed ? [] : skills;
    },
    sessions: {
      async list(query) {
        const { signal: _signal, ...rest } = query ?? {};
        return (await dispatcher.request("sessions.list", { query: rest as JsonObject })) as never;
      },
      async get() {
        throw unsupported("sessions.get()");
      },
      async delete() {
        throw unsupported("sessions.delete()");
      },
      async search() {
        throw unsupported("sessions.search()");
      },
    },
    models: {
      list: async () => (await dispatcher.request("models.list")) as never,
      resolve() {
        throw unsupported("models.resolve()");
      },
    },
    async session(sessionOptions = {}) {
      const opened = (await dispatcher.request("sessions.open", {
        ...(sessionOptions.id !== undefined ? { id: sessionOptions.id } : {}),
        ...(sessionOptions.create !== undefined ? { create: sessionOptions.create } : {}),
        ...(sessionOptions.parent ? { parent: { ...sessionOptions.parent } } : {}),
      })) as unknown as { sessionId: string; leafId?: string };
      const mirror = options.mirror
        ? createSessionMirror({
            store: options.mirror,
            sessionId: opened.sessionId,
            endpointId: source.endpointId,
            agent: source.agent,
            ...(sessionOptions.parent ? { parent: sessionOptions.parent } : {}),
            ...(options.ownership ? { ownership: options.ownership } : {}),
          })
        : undefined;
      await mirror?.open();
      const proxy = createSessionProxy({ dispatcher, source }, opened.sessionId, opened.leafId, mirror);
      handles.set(opened.sessionId, proxy.handle);
      return proxy.session;
    },
    subscribe(subscribeOptions) {
      const channel = createChannel<AgentEvent>(subscribeOptions?.maxQueuedEvents ?? 1024, subscribeOptions?.overflow ?? "close", () => {
        agentSubscribers.delete(channel);
      });
      agentSubscribers.add(channel);
      return channel;
    },
    async dispose() {
      disposed = true;
      await dispatcher.close("dispose");
      spawned?.kill();
    },
    inspect() {
      return { ...inspection, remote: remoteBlock } as AgentInspection;
    },
  };
  return agent;
}
