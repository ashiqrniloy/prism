export type EventOverflowPolicy = "close" | "drop_oldest" | "drop_newest";

export const EVENT_MULTIPLEXER_SINGLE_CONSUMER_CODE = "ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER";

/** Thrown when a second consumer subscribes while one is active (single-consumer contract). */
export class EventMultiplexerError extends Error {
  readonly code = EVENT_MULTIPLEXER_SINGLE_CONSUMER_CODE;
  constructor(message = "Event multiplexer already has an active subscriber") {
    super(message);
    this.name = "EventMultiplexerError";
  }
}

export interface EventOverflowInfo {
  readonly droppedEvents: number;
  readonly maxQueuedEvents: number;
  readonly policy: EventOverflowPolicy;
}

export interface EventMultiplexerOptions<T> {
  readonly maxQueuedEvents?: number;
  readonly overflow?: EventOverflowPolicy;
  readonly overflowEvent?: (info: EventOverflowInfo) => T;
  readonly compare?: (a: T, b: T) => number;
  readonly signal?: AbortSignal;
}

export interface EventMultiplexer<T> {
  publish(event: T): void;
  observe<S>(source: AsyncIterable<S>, map: (event: S) => T): () => void;
  /**
   * Single-consumer subscription. A second concurrent subscriber is rejected with
   * `EventMultiplexerError` (ERR_PRISM_EVENT_MULTIPLEXER_SINGLE_CONSUMER); the slot
   * frees when the active consumer's iterator completes or is `return()`ed at a
   * yield, or when the multiplexer closes. A consumer parked awaiting an event is
   * released by the next `publish`/`close` — `return()` while parked waits for it.
   */
  subscribe(): AsyncIterable<T>;
  close(): void;
  readonly droppedEvents: number;
  readonly closed: boolean;
}

/** Bounded single-consumer fan-in for arbitrary async event sources. */
export function createEventMultiplexer<T>(options: EventMultiplexerOptions<T> = {}): EventMultiplexer<T> {
  const maxQueuedEvents = Math.max(1, options.maxQueuedEvents ?? 1024);
  const overflow = options.overflow ?? "close";
  const queue: T[] = [];
  const stops = new Set<() => void>();
  let waiter: ((result: IteratorResult<T>) => void) | undefined;
  let isClosed = false;
  let droppedEvents = 0;
  let overflowNotified = false;
  // Single-consumer contract: the parked-waiter design corrupts the queue when two
  // consumers iterate concurrently, so a second active consumer is rejected instead.
  let activeConsumer = false;

  const abort = () => close();
  if (options.signal?.aborted) isClosed = true;
  else options.signal?.addEventListener("abort", abort, { once: true });

  // With compare set, publish always enqueues and the parked consumer is woken with
  // this token instead of a value, so every event drains through the sorted queue —
  // delivery order follows the comparator even when the consumer is caught up.
  const WAKE = Symbol("wake");
  const wakeWaiter = () => {
    if (!waiter) return;
    const resolve = waiter;
    waiter = undefined;
    resolve({ value: WAKE as T, done: false });
  };

  function publish(event: T): void {
    if (isClosed) return;
    if (!options.compare && waiter) {
      const resolve = waiter;
      waiter = undefined;
      resolve({ value: event, done: false });
      return;
    }
    if (queue.length < maxQueuedEvents) {
      queue.push(event);
      wakeWaiter();
      return;
    }

    droppedEvents += 1;
    const notice =
      !overflowNotified && options.overflowEvent ? options.overflowEvent({ droppedEvents, maxQueuedEvents, policy: overflow }) : undefined;
    overflowNotified = true;

    if (overflow === "close") {
      queue.length = 0;
      if (notice !== undefined) queue.push(notice);
      options.signal?.removeEventListener("abort", abort);
      finishSources();
      isClosed = true;
      return;
    }
    if (overflow === "drop_newest") {
      if (notice !== undefined) queue[queue.length - 1] = notice;
      wakeWaiter();
      return;
    }

    queue.shift();
    if (notice !== undefined) {
      queue.push(notice);
      if (queue.length >= maxQueuedEvents) queue.shift();
    }
    queue.push(event);
    wakeWaiter();
  }

  function observe<S>(source: AsyncIterable<S>, map: (event: S) => T): () => void {
    if (isClosed) return () => undefined;
    const iterator = source[Symbol.asyncIterator]();
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      stops.delete(stop);
      void iterator.return?.();
    };
    stops.add(stop);
    void (async () => {
      try {
        while (!stopped && !isClosed) {
          const next = await iterator.next();
          if (next.done) break;
          publish(map(next.value));
        }
      } catch {
        // Source failure ends that source; owners surface source errors separately.
      } finally {
        stop();
      }
    })();
    return stop;
  }

  function finishSources(): void {
    for (const stop of [...stops]) stop();
    stops.clear();
  }

  function close(): void {
    if (isClosed) return;
    isClosed = true;
    options.signal?.removeEventListener("abort", abort);
    finishSources();
    if (waiter) {
      const resolve = waiter;
      waiter = undefined;
      resolve({ value: undefined as never, done: true });
    }
  }

  async function* subscribe(): AsyncGenerator<T> {
    if (activeConsumer) throw new EventMultiplexerError();
    activeConsumer = true;
    try {
      while (true) {
        if (queue.length > 0) {
          if (options.compare) queue.sort(options.compare);
          yield queue.shift()!;
          continue;
        }
        if (isClosed) return;
        const next = await new Promise<IteratorResult<T>>((resolve) => {
          waiter = resolve;
        });
        if (next.done) return;
        if (next.value === (WAKE as T)) continue;
        yield next.value;
      }
    } finally {
      activeConsumer = false;
    }
  }

  return {
    publish,
    observe,
    subscribe,
    close,
    get droppedEvents() {
      return droppedEvents;
    },
    get closed() {
      return isClosed;
    },
  };
}
