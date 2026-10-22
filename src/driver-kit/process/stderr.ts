export interface StderrRing {
  /** The redacted tail, at most `maxBytes` characters. */
  text(): string;
  /** Resolves when the stream ends. */
  readonly done: Promise<void>;
}

/** Keeps a bounded, redacted tail of a stderr stream for error reports. Redaction runs before storage. */
export function redactedStderr(
  stream: AsyncIterable<Uint8Array | string>,
  redactor: { redact<T>(value: T): T },
  options: { readonly maxBytes: number },
): StderrRing {
  const decoder = new TextDecoder();
  let tail = "";
  const done = (async () => {
    try {
      for await (const chunk of stream) {
        const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
        tail = (tail + redactor.redact(text)).slice(-options.maxBytes);
      }
    } catch {
      // A broken pipe ends capture; the tail so far is still useful.
    }
  })();
  return { text: () => tail, done };
}
