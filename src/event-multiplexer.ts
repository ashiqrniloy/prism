export type EventOverflowPolicy = "close" | "drop_oldest" | "drop_newest";

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
  subscribe(): AsyncIterable<T>;
  close(): void;
  readonly droppedEvents: number;
  readonly closed: boolean;
}

/** Bounded single-consumer fan-in for arbitrary async event sources. */
export function createEventMultiplexer<T>(
  options: EventMultiplexerOptions<T> = {},
): EventMultiplexer<T> {
  const maxQueuedEvents = Math.max(1, options.maxQueuedEvents ?? 1024);
  const overflow = options.overflow ?? "close";
  const queue: T[] = [];
  const stops = new Set<() => void>();
  let waiter: ((result: IteratorResult<T>) => void) | undefined;
  let isClosed = false;
  let droppedEvents = 0;
  let overflowNotified = false;

  const abort = () => close();
  if (options.signal?.aborted) isClosed = true;
  else options.signal?.addEventListener("abort", abort, { once: true });

  function publish(event: T): void {
    if (isClosed) return;
    if (waiter) {
      const resolve = waiter;
      waiter = undefined;
      resolve({ value: event, done: false });
      return;
    }
    if (queue.length < maxQueuedEvents) {
      queue.push(event);
      return;
    }

    droppedEvents += 1;
    const notice = !overflowNotified && options.overflowEvent
      ? options.overflowEvent({ droppedEvents, maxQueuedEvents, policy: overflow })
      : undefined;
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
      return;
    }

    queue.shift();
    if (notice !== undefined) {
      queue.push(notice);
      if (queue.length >= maxQueuedEvents) queue.shift();
    }
    queue.push(event);
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
    queue.length = 0;
    if (waiter) {
      const resolve = waiter;
      waiter = undefined;
      resolve({ value: undefined as never, done: true });
    }
  }

  async function *subscribe(): AsyncGenerator<T> {
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
      yield next.value;
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
