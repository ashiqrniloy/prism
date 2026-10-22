import { expect, test } from "bun:test";
import { hostOriginRejection, readBody } from "../http-gate.js";
import { readSseFrames } from "../sse.js";

test("Host/Origin matching parity: exact, case insensitive, optional Origin, empty lists disable", () => {
  const options = { allowedHosts: ["LOCALHOST:123"], allowedOrigins: ["HTTPS://GOOD.TEST"] };
  for (const [host, origin, status] of [
    ["localhost:123", undefined, undefined],
    ["localhost:123", "https://good.test", undefined],
    ["localhost", undefined, 403],
    ["localhost:123.evil", undefined, 403],
    ["localhost:123", "null", 403],
    ["localhost:123", "https://good.test.evil", 403],
  ] as const) {
    const request = new Request("http://local", { headers: { host, ...(origin ? { origin } : {}) } });
    expect(hostOriginRejection(request, options)?.status).toBe(status);
    expect(hostOriginRejection(request, { allowedHosts: [], allowedOrigins: [] })).toBeUndefined();
  }
});

test("body reader cancels an oversized streaming body without reading its tail", async () => {
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array(600));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  await expect(readBody(new Request("http://local", { method: "POST", body }), 1024)).rejects.toThrow("body_too_large");
  expect(reads).toBe(2);
  expect(cancelled).toBe(true);
});

test("SSE handles fragmented UTF-8 and CRLF, and caps unterminated events", async () => {
  const bytes = new TextEncoder().encode(': comment\r\ndata: {"x":"🌱"}\r\n\r\n');
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
      c.close();
    },
  });
  const frames = [];
  for await (const frame of readSseFrames(body, 1024)) frames.push(frame);
  expect(frames).toEqual(['{"x":"🌱"}']);
  const huge = new Response("x".repeat(1100)).body as ReadableStream<Uint8Array>;
  await expect(readSseFrames(huge, 1024).next()).rejects.toThrow("SSE frame exceeds limit");
});
