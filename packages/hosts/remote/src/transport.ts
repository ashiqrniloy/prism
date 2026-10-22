import type { JsonObject } from "@arnilo/prism";
import { RemoteError } from "./errors.js";
import { type OversizeFrame, readJsonlFrames } from "./jsonl.js";
import { type RemoteLimitOptions, resolveRemoteLimits } from "./limits.js";

/**
 * A message-framed duplex. `frames()` yields each inbound frame as raw text, or
 * `OVERSIZE` for a frame the transport refused to buffer. The dispatcher parses,
 * so every transport reports malformed input the same way.
 */
export interface RemoteTransport {
  send(frame: JsonObject): Promise<void>;
  frames(): AsyncIterable<string | OversizeFrame>;
  close(reason?: string): Promise<void>;
  readonly closed: Promise<void>;
}

const MEMORY_QUEUE_CAP = 10_000;

class Channel {
  readonly #queue: Array<string | OversizeFrame> = [];
  #waiter: ((value: IteratorResult<string | OversizeFrame>) => void) | undefined;
  #ended = false;

  push(value: string | OversizeFrame): void {
    if (this.#ended) return;
    if (this.#waiter) {
      const resolve = this.#waiter;
      this.#waiter = undefined;
      resolve({ value, done: false });
      return;
    }
    if (this.#queue.length >= MEMORY_QUEUE_CAP) throw new RemoteError("busy", "memory transport queue is full");
    this.#queue.push(value);
  }

  end(): void {
    this.#ended = true;
    const resolve = this.#waiter;
    this.#waiter = undefined;
    resolve?.({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<string | OversizeFrame> {
    return {
      next: () => {
        const value = this.#queue.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.#ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.#waiter = resolve;
        });
      },
    };
  }
}

/** Two in-process endpoints wired back to back. Closing either side ends both. */
export function createMemoryTransportPair(): [RemoteTransport, RemoteTransport] {
  const toA = new Channel();
  const toB = new Channel();
  let closedResolve!: () => void;
  const closed = new Promise<void>((resolve) => {
    closedResolve = resolve;
  });
  let isClosed = false;
  const close = async () => {
    if (isClosed) return;
    isClosed = true;
    toA.end();
    toB.end();
    closedResolve();
  };
  const side = (inbound: Channel, outbound: Channel): RemoteTransport => ({
    async send(frame) {
      if (isClosed) throw new RemoteError("disconnected", "transport is closed");
      outbound.push(JSON.stringify(frame));
    },
    frames: () => inbound,
    close,
    closed,
  });
  return [side(toA, toB), side(toB, toA)];
}

export interface WritableLike {
  write(chunk: string, callback?: (error?: Error | null) => void): unknown;
  end?(): unknown;
}

export interface StdioTransportOptions {
  /** Defaults to `process.stdin`. */
  readonly input?: AsyncIterable<Uint8Array | string>;
  /** Defaults to `process.stdout`. */
  readonly output?: WritableLike;
  readonly limits?: RemoteLimitOptions;
}

/** Newline-delimited JSON over a byte stream pair. One frame per line, capped by `maxFrameBytes`. */
export function stdioTransport(options: StdioTransportOptions = {}): RemoteTransport {
  const { maxFrameBytes } = resolveRemoteLimits(options.limits);
  const input = options.input ?? (process.stdin as AsyncIterable<Uint8Array | string>);
  const output = options.output ?? (process.stdout as WritableLike);
  let closedResolve!: () => void;
  const closed = new Promise<void>((resolve) => {
    closedResolve = resolve;
  });
  let isClosed = false;
  const markClosed = () => {
    if (isClosed) return;
    isClosed = true;
    closedResolve();
  };
  async function* frames(): AsyncGenerator<string | OversizeFrame> {
    try {
      yield* readJsonlFrames(input, maxFrameBytes);
    } finally {
      markClosed();
    }
  }
  return {
    send(frame) {
      if (isClosed) return Promise.reject(new RemoteError("disconnected", "transport is closed"));
      const line = `${JSON.stringify(frame)}\n`;
      if (new TextEncoder().encode(line).length > maxFrameBytes + 1) {
        return Promise.reject(new RemoteError("frame_too_large", `outbound frame exceeds maxFrameBytes (${maxFrameBytes})`));
      }
      return new Promise<void>((resolve, reject) => {
        output.write(line, (error) => (error ? reject(new RemoteError("disconnected", "write failed")) : resolve()));
      });
    },
    frames,
    async close() {
      if (!isClosed) output.end?.();
      markClosed();
    },
    closed,
  };
}
