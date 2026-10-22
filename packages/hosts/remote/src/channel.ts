import { RemoteError } from "./errors.js";

export type Overflow = "close" | "drop_oldest" | "drop_newest";

/** A bounded single-consumer async queue. A full queue follows `overflow`; `close` ends the stream with a `limit` error. */
export interface Channel<T> extends AsyncIterable<T> {
  push(value: T): void;
  /** Ends the stream after the queued values drain. A given error surfaces once the queue is empty. */
  end(error?: Error): void;
  readonly ended: boolean;
}

export function createChannel<T>(maxQueued: number, overflow: Overflow = "close", onReturn?: () => void): Channel<T> {
  const queue: T[] = [];
  let waiter: { resolve: (result: IteratorResult<T>) => void; reject: (error: Error) => void } | undefined;
  let ended = false;
  let failure: Error | undefined;

  const settle = () => {
    const pending = waiter;
    if (!pending) return;
    if (queue.length > 0) {
      waiter = undefined;
      pending.resolve({ value: queue.shift() as T, done: false });
    } else if (ended) {
      waiter = undefined;
      if (failure) {
        const error = failure;
        failure = undefined;
        pending.reject(error);
      } else pending.resolve({ value: undefined, done: true });
    }
  };

  return {
    push(value) {
      if (ended) return;
      if (queue.length >= maxQueued) {
        if (overflow === "drop_newest") return;
        if (overflow === "drop_oldest") queue.shift();
        else {
          queue.length = 0;
          ended = true;
          failure = new RemoteError("limit", `subscriber exceeded ${maxQueued} queued events`);
          settle();
          return;
        }
      }
      queue.push(value);
      settle();
    },
    end(error) {
      if (ended) return;
      ended = true;
      if (error) failure = error;
      settle();
    },
    get ended() {
      return ended;
    },
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift() as T, done: false });
          if (ended) {
            if (failure) {
              const error = failure;
              failure = undefined;
              return Promise.reject(error);
            }
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise<IteratorResult<T>>((resolve, reject) => {
            waiter = { resolve, reject };
          });
        },
        return: () => {
          ended = true;
          queue.length = 0;
          onReturn?.();
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}
