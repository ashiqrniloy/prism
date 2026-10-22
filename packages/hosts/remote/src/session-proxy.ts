import type { AgentEvent, Decision, Message, RunOptions, RunResult, Session } from "@arnilo/prism";
import { type AttributionSource, attribute } from "./attribution.js";
import { type Channel, createChannel } from "./channel.js";
import type { Dispatcher } from "./dispatcher.js";
import { RemoteError } from "./errors.js";
import type { SessionMirror } from "./mirror.js";
import type { RemoteRunOptions } from "./protocol.js";

type Input = string | Message | readonly Message[];
type SubscribeArgs = NonNullable<Parameters<Session["subscribe"]>[0]>;

const DEFAULT_QUEUE = 1024;

export interface ProxyContext {
  readonly dispatcher: Dispatcher;
  readonly source: AttributionSource;
}

/** What the connection routes a session's notifications to. */
export interface SessionHandle {
  event(event: AgentEvent): void;
  settled(result: RunResult): void;
  disconnected(error: Error): void;
}

interface Deferred {
  readonly promise: Promise<RunResult>;
  readonly resolve: (value: RunResult) => void;
  readonly reject: (error: Error) => void;
}

function deferred(): Deferred {
  let resolve!: (value: RunResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<RunResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface ActiveRun {
  readonly events?: Channel<AgentEvent>;
  readonly settled: Deferred;
}

interface Subscriber {
  readonly channel: Channel<AgentEvent>;
  readonly acrossRuns: boolean;
}

const unsupported = (what: string): RemoteError => new RemoteError("remote_unsupported", `${what} is not supported on a remote session`);

/** Only the JSON-safe subset of `RunOptions` goes over the wire; `principal`, `ownership`, `signal`, … stay local. */
function wireOptions(options: RunOptions | undefined): RemoteRunOptions | undefined {
  if (!options) return undefined;
  const wire: { -readonly [K in keyof RemoteRunOptions]: RemoteRunOptions[K] } = {};
  if (options.metadata !== undefined) wire.metadata = options.metadata as RemoteRunOptions["metadata"];
  if (options.limits !== undefined) wire.limits = options.limits as RemoteRunOptions["limits"];
  if (options.interactive !== undefined) wire.interactive = options.interactive;
  return Object.keys(wire).length > 0 ? wire : undefined;
}

export interface SessionProxy {
  readonly session: Session;
  readonly handle: SessionHandle;
}

/** The proxy `Session`: every call goes over the connection, so the remote's own hooks and gates apply. */
export function createSessionProxy(
  context: ProxyContext,
  sessionId: string,
  initialLeafId: string | undefined,
  mirror: SessionMirror | undefined,
): SessionProxy {
  const { dispatcher, source } = context;
  let leafId = initialLeafId;
  let active: ActiveRun | undefined;
  const subscribers = new Set<Subscriber>();

  const closeSubscribers = (onlyRunScoped: boolean) => {
    for (const subscriber of [...subscribers]) {
      if (onlyRunScoped && subscriber.acrossRuns) continue;
      subscriber.channel.end();
      subscribers.delete(subscriber);
    }
  };

  const fail = (run: ActiveRun, error: Error) => {
    if (active === run) active = undefined;
    run.events?.end(error);
    run.settled.reject(error);
    closeSubscribers(true);
  };

  const handle: SessionHandle = {
    event(raw) {
      const event = attribute(raw, source);
      mirror?.record(event);
      active?.events?.push(event);
      for (const subscriber of subscribers) subscriber.channel.push(event);
    },
    settled(result) {
      const run = active;
      active = undefined;
      if (result.leafId !== undefined) leafId = result.leafId;
      void (async () => {
        let failure: Error | undefined;
        try {
          await mirror?.flush();
        } catch (error) {
          failure = new RemoteError(
            "internal_error",
            `mirror write failed: ${error instanceof Error ? error.message.slice(0, 200) : "error"}`,
          );
        }
        closeSubscribers(true);
        if (failure) {
          run?.events?.end(failure);
          run?.settled.reject(failure);
        } else {
          run?.events?.end();
          run?.settled.resolve(result);
        }
      })();
    },
    disconnected(error) {
      if (active) fail(active, error);
      closeSubscribers(false);
    },
  };

  /** Registers the run before the request goes out, so no early notification is lost. */
  const start = (
    method: "run" | "sessions.resume",
    body: Record<string, unknown>,
    options: RunOptions | undefined,
    withEvents: boolean,
  ) => {
    if (active) throw new RemoteError("busy", "session already has a run in progress");
    const queued = (options as { maxQueuedEvents?: number } | undefined)?.maxQueuedEvents ?? DEFAULT_QUEUE;
    const run: ActiveRun = {
      ...(withEvents ? { events: createChannel<AgentEvent>(queued, "close") } : {}),
      settled: deferred(),
    };
    run.settled.promise.catch(() => {});
    active = run;
    const signal = options?.signal;
    const abortRemote = () => void dispatcher.request("abort", { sessionId, reason: "aborted" }).catch(() => {});
    if (signal?.aborted) abortRemote();
    else signal?.addEventListener("abort", abortRemote, { once: true });
    const wire = wireOptions(options);
    void dispatcher
      .request(method, { sessionId, ...body, ...(wire ? { options: wire as never } : {}) } as never)
      .catch((error) => fail(run, error instanceof Error ? error : new RemoteError("internal_error", "request failed")));
    return run;
  };

  async function* streamOf(run: ActiveRun): AsyncGenerator<AgentEvent> {
    try {
      yield* run.events as Channel<AgentEvent>;
    } finally {
      if (active === run) void dispatcher.request("abort", { sessionId }).catch(() => {});
    }
  }

  const session: Session = {
    id: sessionId,
    get leafId() {
      return leafId;
    },
    async run(input: Input, options?: RunOptions) {
      return start("run", { input }, options, false).settled.promise;
    },
    stream: (input: Input, options) => streamOf(start("run", { input }, options, true)),
    resume: (decisions: readonly Decision[], options) => streamOf(start("sessions.resume", { decisions }, options, true)),
    steer(input: Input, options) {
      if (!active) throw new RemoteError("invalid_params", "no active run to steer");
      void dispatcher.request("steer", { sessionId, input, ...(options ? { options } : {}) } as never).catch(() => {});
    },
    abort() {
      if (active) void dispatcher.request("abort", { sessionId }).catch(() => {});
    },
    subscribe(options?: SubscribeArgs) {
      const subscriber: Subscriber = {
        channel: createChannel<AgentEvent>(options?.maxQueuedEvents ?? DEFAULT_QUEUE, options?.overflow ?? "close", () => {
          subscribers.delete(subscriber);
        }),
        acrossRuns: options?.acrossRuns === true,
      };
      subscribers.add(subscriber);
      return subscriber.channel;
    },
    async close() {
      closeSubscribers(false);
    },
    async messages() {
      const result = (await dispatcher.request("sessions.messages", { sessionId })) as unknown as { messages: readonly Message[] };
      return result.messages;
    },
    async entries() {
      if (!mirror) throw unsupported("entries() without a mirror");
      return mirror.entries();
    },
    async compact() {
      throw unsupported("compact()");
    },
    async checkout() {
      throw unsupported("checkout()");
    },
    async fork() {
      throw unsupported("fork()");
    },
    contextMeter() {
      throw unsupported("contextMeter()");
    },
  };
  return { session, handle };
}
