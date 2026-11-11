import {
  type Agent,
  type AgentEvent,
  type Decision,
  type HostUi,
  type HostUiResponse,
  isSessionNotFound,
  type JsonObject,
  type JsonValue,
  type Message,
  type OwnershipScope,
  OwnershipScopeError,
  type PendingDecision,
  type Principal,
  type RunOptions,
  type RunResult,
  type Session,
} from "@arnilo/prism";
import { createDispatcher, type Dispatcher, type RemoteHandler } from "./dispatcher.js";
import { RemoteError } from "./errors.js";
import { bindRemoteHostUi, bindRemoteHostUiOwner, decisionFromAnswer, requestForPending } from "./host-ui.js";
import { type RemoteLimitOptions, type ResolvedRemoteLimits, resolveRemoteLimits } from "./limits.js";
import { pendingDecisionsOf } from "./pending.js";
import type { HostUiRequestParams, InitializeResult, RemoteCapabilities } from "./protocol.js";
import { type RemoteTransport, stdioTransport } from "./transport.js";

import { type Authenticate, type NetworkTransport, serveNetwork } from "./transports/network.js";
import {
  invalid,
  isObject,
  parseDecisions,
  parseInput,
  parseRunOptions,
  parseSessionListQuery,
  parseSessionParentLink,
  parseSteerOptions,
  str,
} from "./wire.js";

export type ServeTransport =
  | NetworkTransport
  | RemoteTransport
  | {
      readonly kind: "stdio";
      readonly input?: AsyncIterable<Uint8Array | string>;
      readonly output?: { write(chunk: string, cb?: (error?: Error | null) => void): unknown; end?(): unknown };
    };

/** Optional host-owned authority shared with other resume entry points. */
export interface RemoteResumeAuthority {
  resume(id: string, decisions: readonly Decision[], options?: RunOptions): AsyncIterable<AgentEvent>;
}

export interface ServeAgentOptions {
  readonly resumeAuthority?: RemoteResumeAuthority;
  readonly transport: ServeTransport;
  readonly authenticate?: Authenticate;
  /** Derives the kernel `OwnershipScope` for an authenticated connection. */
  readonly ownershipFor?: (principal: Principal) => OwnershipScope;
  /** Marks a principal as an operator allowed to receive agent-scoped events and host-UI requests. */
  readonly operator?: (principal: Principal) => boolean;
  /** Allows clients to send `Decision.modifiedArguments` in `sessions.resume` (re-gated by the kernel). Defaults to `false`. */
  readonly allowModifiedArguments?: boolean;
  /** The `remoteHostUi()` the agent was created with. The connected client is bound to it. */
  readonly hostUi?: HostUi;
  readonly limits?: RemoteLimitOptions;
  /** Id reported to clients as `origin.remote`. Defaults to a random id. */
  readonly endpointId?: string;
}

export interface ServedAgent {
  readonly endpointId: string;
  readonly url?: string;
  readonly token?: string;
  /** Await before using a keyring-backed token. */
  readonly ready?: Promise<void>;
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

/** Canonical collision-free partition key for a connection's `Principal` (`""` for single-principal connections). */
export function principalKeyOf(principal: Principal | undefined): string {
  return principal ? `${principal.kind.length}:${principal.kind}:${principal.id}` : "";
}

/** State shared by every connection to one served agent: the open sessions and the one-resume-at-a-time guard. */
export interface ServerState {
  readonly agent: Agent;
  readonly endpointId: string;
  /** Open sessions partitioned by `principalKeyOf(principal)` -> `sessionId` -> `Session`. */
  readonly sessions: Map<string, Map<string, Session>>;
  /** Session owner index (`sessionId` -> `principalKeyOf(principal)`) for constant-time routing and isolation checks. */
  readonly sessionOwners: Map<string, string>;
  readonly ownershipFor?: (principal: Principal) => OwnershipScope;
  readonly operator?: (principal: Principal) => boolean;
  readonly allowModifiedArguments?: boolean;
  readonly resumeAuthority?: RemoteResumeAuthority;
  readonly resuming: Set<string>;
  readonly active: Set<string>;
  readonly limits: ResolvedRemoteLimits;
  readonly hostUi?: HostUi;
}

interface EventRouter {
  readonly pendingOpens: Set<Promise<void>>;
  readonly byPrincipal: Map<string, Set<(event: AgentEvent) => Promise<void>>>;
  readonly operators: Set<(event: AgentEvent) => Promise<void>>;
  subscriberCount: number;
  stopPump?: () => void;
}

const eventRouters = new WeakMap<ServerState, EventRouter>();

function routerOf(state: ServerState): EventRouter {
  let router = eventRouters.get(state);
  if (!router) {
    router = {
      pendingOpens: new Set(),
      byPrincipal: new Map(),
      operators: new Set(),
      subscriberCount: 0,
    };
    eventRouters.set(state, router);
  }
  return router;
}

export function createServerState(
  agent: Agent,
  options: Pick<ServeAgentOptions, "hostUi" | "limits" | "endpointId" | "resumeAuthority">,
): ServerState {
  const full = options as Partial<ServeAgentOptions>;
  const sessionOwners = new Map<string, string>();
  const state: ServerState = {
    agent,
    resumeAuthority: options.resumeAuthority,
    endpointId: options.endpointId ?? `remote-${crypto.randomUUID()}`,
    sessions: new Map(),
    sessionOwners,
    ...(full.ownershipFor ? { ownershipFor: full.ownershipFor } : {}),
    ...(full.operator ? { operator: full.operator } : {}),
    ...(full.allowModifiedArguments !== undefined ? { allowModifiedArguments: full.allowModifiedArguments } : {}),
    resuming: new Set(),
    active: new Set(),
    limits: resolveRemoteLimits(options.limits),
    ...(options.hostUi ? { hostUi: options.hostUi } : {}),
  };
  if (options.hostUi) {
    try {
      bindRemoteHostUiOwner(options.hostUi, (sessionId) => state.sessionOwners.get(sessionId));
    } catch {
      // Validated when a connection negotiates hostUi.
    }
  }
  return state;
}

/** Serves an `Agent` to one client over `prism.remote/1`. */
export function serveAgent(agent: Agent, options: ServeAgentOptions): ServedAgent {
  const state = createServerState(agent, options);
  if ("kind" in options.transport && options.transport.kind !== "stdio")
    return serveNetwork(state, options.transport, options.authenticate);
  const transport = "kind" in options.transport ? stdioTransport({ ...options.transport, limits: options.limits }) : options.transport;
  const connection = serveConnection(state, transport, {});
  return { endpointId: state.endpointId, closed: connection.closed, close: () => connection.close() };
}

const textOf = (message: Message | undefined): string =>
  message
    ? (message.content as readonly { type: string; text?: string }[])
        .flatMap((block) => (block.type === "text" && block.text ? [block.text] : []))
        .join("")
    : "";

/** `run.settled` result, projected from the events of one run or resume. */
function projectResult(session: Session, runId: string, events: readonly AgentEvent[]): RunResult {
  const messages = events.flatMap((event) => (event.type === "message.completed" ? [event.message] : []));
  const final = [...messages].reverse().find((message) => message.role === "assistant");
  let status: RunResult["status"] = "failed";
  let extra: Partial<Mutable<RunResult>> = {};
  for (const event of events) {
    if (event.type === "run.completed") {
      status = event.status;
      extra = {
        ...(event.usage ? { usage: event.usage } : {}),
        ...(event.stopReason ? { stopReason: event.stopReason } : {}),
        ...(event.stopDetail ? { stopDetail: event.stopDetail } : {}),
      };
    } else if (event.type === "run.failed") {
      status = /abort/i.test(`${event.error.code ?? ""} ${event.error.name ?? ""}`) ? "aborted" : "failed";
      extra = { error: event.error, ...(event.limit ? { limit: event.limit } : {}) };
    } else if (event.type === "run.suspended") {
      status = "suspended";
      extra = { pending: event.interruption.pendingDecisions ?? [] };
    }
  }
  return {
    sessionId: session.id,
    runId,
    status,
    ...(session.leafId !== undefined ? { leafId: session.leafId } : {}),
    text: textOf(final),
    content: final?.content ?? [],
    ...(final ? { message: final } : {}),
    messages,
    ...extra,
  } as RunResult;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const TERMINAL = new Set(["run.completed", "run.failed", "run.suspended"]);

export interface ConnectionOptions {
  /** The principal `authenticate` returned for this connection (Task 5). Carried on every run and resume. */
  readonly principal?: Principal;
}

function mapOwnershipError(error: unknown): unknown {
  if (isSessionNotFound(error) || error instanceof OwnershipScopeError) {
    return new RemoteError("session_not_found", "session not found");
  }
  return error;
}

function subscribeAgentEvents(
  state: ServerState,
  principalKey: string,
  isOperator: boolean,
  send: (event: AgentEvent) => Promise<void>,
): () => void {
  const router = routerOf(state);
  let bucket = router.byPrincipal.get(principalKey);
  if (!bucket) {
    bucket = new Set();
    router.byPrincipal.set(principalKey, bucket);
  }
  bucket.add(send);
  if (isOperator) router.operators.add(send);
  router.subscriberCount += 1;
  if (router.subscriberCount === 1) {
    const events = state.agent
      .subscribe({ maxQueuedEvents: state.limits.maxQueuedEvents, overflow: "drop_oldest" })
      [Symbol.asyncIterator]();
    router.stopPump = () => void events.return?.();
    void (async () => {
      try {
        for (let next = await events.next(); !next.done; next = await events.next()) {
          const event = next.value;
          const sessionId = "sessionId" in event && typeof event.sessionId === "string" ? event.sessionId : "";
          if (sessionId !== "") {
            let ownerKey = state.sessionOwners.get(sessionId);
            while (ownerKey === undefined && router.pendingOpens.size > 0) {
              await Promise.all([...router.pendingOpens]);
              ownerKey = state.sessionOwners.get(sessionId);
            }
            const targets = ownerKey !== undefined ? router.byPrincipal.get(ownerKey) : router.operators;
            if (targets) {
              for (const fn of targets) await fn(event);
            }
          } else {
            for (const fn of router.operators) await fn(event);
          }
        }
      } catch {
        // Subscription ended.
      }
    })();
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const currentBucket = router.byPrincipal.get(principalKey);
    if (currentBucket) {
      currentBucket.delete(send);
      if (currentBucket.size === 0) router.byPrincipal.delete(principalKey);
    }
    if (isOperator) router.operators.delete(send);
    router.subscriberCount -= 1;
    if (router.subscriberCount <= 0) {
      router.subscriberCount = 0;
      router.stopPump?.();
      router.stopPump = undefined;
    }
  };
}

/** One client connection to a served agent. */
export function serveConnection(state: ServerState, transport: RemoteTransport, options: ConnectionOptions): Dispatcher {
  const { agent, limits } = state;
  const principal = options.principal;
  const principalKey = principalKeyOf(principal);
  const isOperator = principal === undefined ? true : state.operator?.(principal) === true;
  const ownership = principal && state.ownershipFor ? state.ownershipFor(principal) : undefined;
  let detach: (() => void) | undefined;
  let canHostUi = false;
  const delivering = new Set<string>();
  let dispatcher!: Dispatcher;
  let stopAgentEvents: (() => void) | undefined;

  const session = (id: string): Session => {
    const ownerKey = state.sessionOwners.get(id);
    if (ownerKey !== principalKey) throw new RemoteError("session_not_found", "session is not open");
    const found = state.sessions.get(principalKey)?.get(id);
    if (!found) throw new RemoteError("session_not_found", "session is not open");
    return found;
  };

  const forward = async (
    target: Session,
    events: AsyncIterable<AgentEvent>,
    started: (runId: string) => void,
    failed: (error: unknown) => void,
  ) => {
    const seen: AgentEvent[] = [];
    let runId = "";
    let terminal = false;
    let gone = false;
    try {
      for await (const event of events) {
        if ("runId" in event && typeof event.runId === "string" && runId === "") {
          runId = event.runId;
          started(runId);
        }
        if (TERMINAL.has(event.type)) terminal = true;
        seen.push(event);
        // A gone client must not abort the run: keep draining so it can suspend at its next ask.
        if (!gone)
          await dispatcher
            .notify("run.event", { sessionId: target.id, runId, event: event as unknown as JsonValue })
            .catch(() => void (gone = true));
      }
      if (gone) return;
      if (runId === "") throw new RemoteError("internal_error", "run produced no events");
      if (!terminal) {
        // The kernel closed this subscriber: the client could not keep up.
        await dispatcher.close("slow_consumer");
        return;
      }
      await dispatcher.notify("run.settled", {
        sessionId: target.id,
        runId,
        result: projectResult(target, runId, seen) as unknown as JsonValue,
      });
    } catch (error) {
      if (runId === "") failed(mapOwnershipError(error));
    } finally {
      state.active.delete(target.id);
      state.resuming.delete(target.id);
    }
  };

  /** Starts `events`, resolves with the run id once the run announced itself. Events keep streaming afterwards. */
  const startRun = (target: Session, events: AsyncIterable<AgentEvent>): Promise<JsonObject> =>
    new Promise((resolve, reject) => {
      void forward(target, events, (runId) => resolve({ runId }), reject);
    });

  const resume = async (target: Session, decisions: readonly Decision[], runOptions: RunOptions): Promise<JsonObject> => {
    if (state.resuming.has(target.id) || state.active.has(target.id))
      throw new RemoteError("busy", "session already has a run or resume in progress");
    state.resuming.add(target.id);
    state.active.add(target.id);
    try {
      const options = { ...runOptions, maxQueuedEvents: limits.maxQueuedEvents };
      const events = state.resumeAuthority
        ? state.resumeAuthority.resume(target.id, decisions, options)
        : target.resume(decisions, options);
      return await startRun(target, events);
    } catch (error) {
      state.resuming.delete(target.id);
      state.active.delete(target.id);
      throw mapOwnershipError(error);
    }
  };

  async function deliverPending(target: Session): Promise<void> {
    if (!canHostUi || delivering.has(target.id)) return;
    if (state.resuming.has(target.id) || state.active.has(target.id)) return;
    delivering.add(target.id);
    try {
      const pending: readonly PendingDecision[] = pendingDecisionsOf(await target.entries());
      if (pending.length === 0) return;
      const decisions: Decision[] = [];
      for (const item of pending) {
        const params: HostUiRequestParams = {
          sessionId: target.id,
          approvalId: item.approvalId,
          request: requestForPending(target.id, item),
        };
        const answer = (await dispatcher.request("hostUi.request", params as unknown as JsonObject)) as unknown as HostUiResponse;
        const decision = decisionFromAnswer(item, answer);
        if (!decision) return;
        decisions.push(decision);
      }
      await resume(target, decisions, {
        ...(principal ? { principal } : {}),
        ...(ownership ? { ownership } : {}),
      });
    } catch {
      // A disconnect or a lost resume race leaves the suspension pending for the next client.
    } finally {
      delivering.delete(target.id);
    }
  }

  const requests: Record<string, RemoteHandler> = {
    async "sessions.open"(params) {
      if (params.id !== undefined && typeof params.id !== "string") throw invalid("id must be a string");
      if (params.create !== undefined && typeof params.create !== "boolean") throw invalid("create must be a boolean");
      const parent = parseSessionParentLink(params.parent);
      if (params.id !== undefined) {
        const existingOwner = state.sessionOwners.get(params.id);
        if (existingOwner !== undefined && existingOwner !== principalKey) {
          throw new RemoteError("session_not_found", "session not found");
        }
      }
      const router = routerOf(state);
      let finishOpen!: () => void;
      const openGate = new Promise<void>((resolve) => {
        finishOpen = resolve;
      });
      router.pendingOpens.add(openGate);
      let current: Session;
      try {
        let opened: Session;
        try {
          opened = await agent.session({
            ...(params.id !== undefined ? { id: params.id as string } : {}),
            ...(params.create !== undefined ? { create: params.create as boolean } : {}),
            ...(parent ? { parent } : {}),
            ...(ownership ? { ownership } : {}),
          });
        } catch (error) {
          throw mapOwnershipError(error);
        }
        const existingOwner = state.sessionOwners.get(opened.id);
        if (existingOwner !== undefined && existingOwner !== principalKey) {
          throw new RemoteError("session_not_found", "session not found");
        }
        state.sessionOwners.set(opened.id, principalKey);
        let principalSessions = state.sessions.get(principalKey);
        if (!principalSessions) {
          principalSessions = new Map();
          state.sessions.set(principalKey, principalSessions);
        }
        const known = principalSessions.get(opened.id);
        current = known ?? opened;
        principalSessions.set(current.id, current);
      } finally {
        router.pendingOpens.delete(openGate);
        finishOpen();
      }
      void deliverPending(current);
      return { sessionId: current.id, ...(current.leafId !== undefined ? { leafId: current.leafId } : {}) };
    },
    async "sessions.list"(params) {
      const listQuery = parseSessionListQuery(params.query, ownership);
      return (await agent.sessions.list(listQuery)) as unknown as JsonValue;
    },
    async "sessions.messages"(params) {
      return { messages: (await session(str(params, "sessionId")).messages()) as unknown as JsonValue[] };
    },
    async "sessions.resume"(params) {
      const target = session(str(params, "sessionId"));
      const pending = typeof target.entries === "function" ? pendingDecisionsOf(await target.entries()) : [];
      return resume(
        target,
        parseDecisions(params.decisions, {
          allowModifiedArguments: state.allowModifiedArguments === true,
          pending,
        }),
        parseRunOptions(params.options, principal, ownership),
      );
    },
    async run(params) {
      const target = session(str(params, "sessionId"));
      const input = parseInput(params.input);
      const runOptions = parseRunOptions(params.options, principal, ownership);
      if (state.resuming.has(target.id) || state.active.has(target.id))
        throw new RemoteError("busy", "session already has a run in progress");
      state.active.add(target.id);
      try {
        return await startRun(target, target.stream(input, { ...runOptions, maxQueuedEvents: limits.maxQueuedEvents }));
      } catch (error) {
        state.active.delete(target.id);
        throw mapOwnershipError(error);
      }
    },
    steer(params) {
      session(str(params, "sessionId")).steer(parseInput(params.input), parseSteerOptions(params.options));
      return null;
    },
    abort(params) {
      session(str(params, "sessionId")).abort(typeof params.reason === "string" ? params.reason : undefined);
      return null;
    },
    "commands.list": () => agent.commands.list() as unknown as JsonValue,
    async "commands.run"(params) {
      if (params.args !== undefined && !isObject(params.args)) throw invalid("args must be an object");
      const target = typeof params.sessionId === "string" ? session(params.sessionId) : undefined;
      const result = await agent.commands.run(
        str(params, "name"),
        params.args as JsonObject | undefined,
        target ? { session: target } : undefined,
      );
      return (result === undefined ? null : result) as JsonValue;
    },
    inspect: () => agent.inspect() as unknown as JsonValue,
    async "models.list"() {
      return (await agent.models.list()) as unknown as JsonValue;
    },
  };

  const offered: RemoteCapabilities = { hostUi: true, "hostUi.secret": true, agentEvents: true };
  dispatcher = createDispatcher({
    transport,
    role: "server",
    capabilities: offered,
    limits,
    requests,
    onInitialize: (_params, negotiated): Omit<InitializeResult, "protocol" | "capabilities"> => {
      canHostUi = negotiated.hostUi === true;
      if (negotiated.hostUi && state.hostUi) {
        bindRemoteHostUiOwner(state.hostUi, (sessionId) => state.sessionOwners.get(sessionId));
        detach = bindRemoteHostUi(state.hostUi, {
          canSecret: negotiated["hostUi.secret"] === true,
          principalKey,
          operator: isOperator,
          ask: async (params) => (await dispatcher.request("hostUi.request", params as unknown as JsonObject)) as unknown as HostUiResponse,
        });
        const owned = state.sessions.get(principalKey);
        if (owned) {
          for (const open of owned.values()) void deliverPending(open);
        }
      }
      if (negotiated.agentEvents) {
        stopAgentEvents = subscribeAgentEvents(state, principalKey, isOperator, async (event) => {
          await dispatcher.notify("agent.event", { event: event as unknown as JsonValue }).catch(() => undefined);
        });
      }
      return {
        endpointId: state.endpointId,
        agent: {
          id: agent.id,
          name: agent.config.name ?? agent.id,
          tools: agent.tools as unknown as JsonObject[],
          skills: agent.skills as unknown as JsonObject[],
          inspection: agent.inspect(),
        },
      };
    },
  });
  void dispatcher.closed.then(() => {
    detach?.();
    stopAgentEvents?.();
  });
  return dispatcher;
}
