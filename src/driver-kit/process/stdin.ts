import type { Writable } from "node:stream";
import type { JsonValue } from "../../contracts.js";

export interface StdinWriter {
  /** Writes one JSON line, waiting for `drain` when the stream applies backpressure. */
  write(message: JsonValue | string): Promise<void>;
  close(): Promise<void>;
}

export function createStdinWriter(writable: Writable): StdinWriter {
  let chain: Promise<void> = Promise.resolve();
  const writeOne = (text: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      writable.once("error", onError);
      const done = (): void => {
        writable.off("error", onError);
        resolve();
      };
      if (writable.write(text)) done();
      else writable.once("drain", done);
    });
  return {
    write(message) {
      const text = typeof message === "string" ? message : JSON.stringify(message);
      const next = chain.then(() => writeOne(text.endsWith("\n") ? text : `${text}\n`));
      chain = next.catch(() => undefined);
      return next;
    },
    async close() {
      if (writable.destroyed || writable.writableFinished) return;
      await chain;
      if (writable.destroyed || writable.writableFinished) return;
      await new Promise<void>((resolve) => writable.end(resolve));
    },
  };
}
