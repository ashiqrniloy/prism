import { RemoteError } from "./errors.js";

/** Incremental SSE parsing with a byte cap on each event, including unterminated input. */
export async function* readSseFrames(body: ReadableStream<Uint8Array>, cap: number): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const buffer = new Uint8Array(cap + 64);
  let length = 0;
  let eventBytes = 0;
  let data: string[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return;
      for (const byte of chunk.value) {
        if (++eventBytes > buffer.length) throw new RemoteError("frame_too_large", "SSE frame exceeds limit");
        if (byte !== 10) {
          buffer[length++] = byte;
          continue;
        }
        const line = decoder.decode(buffer.subarray(0, length)).replace(/\r$/, "");
        length = 0;
        if (line === "") {
          if (data.length) {
            const frame = data.join("\n");
            if (Buffer.byteLength(frame) > cap) throw new RemoteError("frame_too_large", "SSE frame exceeds limit");
            yield frame;
          }
          data = [];
          eventBytes = 0;
        } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
