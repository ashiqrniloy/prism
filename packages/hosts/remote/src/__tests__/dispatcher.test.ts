import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import {
  CLIENT_METHODS,
  createDispatcher,
  createMemoryTransportPair,
  REMOTE_PROTOCOL,
  RemoteError,
  readJsonlFrames,
  stdioTransport,
} from "../index.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const info = { endpointId: "ep", agent: { id: "a", name: "a", tools: [], skills: [], inspection: {} as never } };

function pair(
  serverOptions: Partial<Parameters<typeof createDispatcher>[0]> = {},
  clientOptions: Partial<Parameters<typeof createDispatcher>[0]> = {},
) {
  const [a, b] = createMemoryTransportPair();
  const server = createDispatcher({
    transport: a,
    role: "server",
    capabilities: { hostUi: true },
    onInitialize: () => info,
    ...serverOptions,
  });
  const client = createDispatcher({ transport: b, role: "client", capabilities: { hostUi: true }, ...clientOptions });
  return { server, client, a, b };
}

describe("dispatcher", () => {
  test("dispatcher_correlates_requests_both_directions", async () => {
    const { server: s2, client: c2 } = pair(
      { requests: { run: async (p) => ({ from: "server", n: p.n as number }) } },
      { requests: { "hostUi.request": (p) => ({ from: "client", n: p.n as number }) } },
    );
    await c2.initialize();
    const [r1, r2, r3] = await Promise.all([
      c2.request("run", { n: 1 }),
      s2.request("hostUi.request", { n: 2 }),
      c2.request("run", { n: 3 }),
    ]);
    expect(r1).toEqual({ from: "server", n: 1 });
    expect(r2).toEqual({ from: "client", n: 2 });
    expect(r3).toEqual({ from: "server", n: 3 });
    await c2.close();
  });

  test("dispatcher_rejects_before_initialize", async () => {
    let called = 0;
    const { client } = pair({ requests: { run: () => void called++ } });
    await expect(client.request("run")).rejects.toMatchObject({ code: "not_initialized" });
    expect(called).toBe(0);
    await client.initialize();
    await client.request("run");
    expect(called).toBe(1);
  });

  test("dispatcher_rejects_unknown_major_version", async () => {
    const { client } = pair();
    await expect(client.request("initialize", { protocol: "prism.remote/2" })).rejects.toMatchObject({ code: "protocol_unsupported" });
    const ok = (await client.request("initialize", {
      protocol: REMOTE_PROTOCOL,
      capabilities: { hostUi: true, "future.thing": true },
    })) as { capabilities: Record<string, boolean>; protocol: string };
    expect(ok.protocol).toBe(REMOTE_PROTOCOL);
    expect(ok.capabilities).toEqual({ hostUi: true });
  });

  test("dispatcher_caps_frame_size_and_concurrency", async () => {
    const release: Array<() => void> = [];
    const [a, b] = createMemoryTransportPair();
    createDispatcher({
      transport: a,
      role: "server",
      limits: { maxFrameBytes: 1024, maxConcurrentRequests: 1 },
      onInitialize: () => info,
      requests: { run: () => new Promise((resolve) => release.push(() => resolve(null))) },
    });
    const client = createDispatcher({ transport: b, role: "client" });
    await client.initialize();
    // An oversized frame has no answerable id: it is refused and the connection stays usable.
    pushRaw(a, JSON.stringify({ jsonrpc: "2.0", id: 99, method: "run", params: { blob: "x".repeat(2000) } }));
    await sleep(10);
    const first = client.request("run");
    await sleep(5);
    await expect(client.request("run")).rejects.toMatchObject({ code: "busy" });
    release[0]?.();
    await first;
    const again = client.request("run");
    await sleep(5);
    release[1]?.();
    expect(await again).toBeNull();
    expect(release.length).toBe(2);
  });

  test("dispatcher_malformed_frame_is_invalid_frame", async () => {
    const [a, b] = createMemoryTransportPair();
    createDispatcher({ transport: a, role: "server", onInitialize: () => info });
    const replies: Array<{ error: { code: number; data: { code: string; bytes?: number } } }> = [];
    const reader = (async () => {
      for await (const frame of b.frames()) replies.push(JSON.parse(frame as string));
    })();
    const secret = "TOP-SECRET-PAYLOAD";
    // push raw text through the peer's inbound channel
    const sendRaw = (text: string) => (a as unknown as { frames(): { push?: never } }).frames && pushRaw(a, text);
    sendRaw(`not json ${secret}`);
    sendRaw(JSON.stringify([1, 2]));
    sendRaw(JSON.stringify({ jsonrpc: "1.0", method: "x" }));
    await sleep(10);
    expect(replies.map((r) => r.error.code)).toEqual([-32700, -32600, -32600]);
    expect(replies.every((r) => r.error.data.code === "invalid_frame")).toBe(true);
    expect(JSON.stringify(replies)).not.toContain(secret);
    await b.close();
    await reader;
  });

  test("stdio_transport_frames_jsonl", async () => {
    const aIn = new PassThrough();
    const bIn = new PassThrough();
    const a = stdioTransport({ input: aIn, output: bIn, limits: { maxFrameBytes: 1024 } });
    const b = stdioTransport({ input: bIn, output: aIn, limits: { maxFrameBytes: 1024 } });
    const seen: string[] = [];
    const read = (async () => {
      for await (const frame of b.frames()) seen.push(typeof frame === "string" ? frame : "OVERSIZE");
    })();
    await a.send({ jsonrpc: "2.0", method: "ping", params: { n: 1 } });
    await expect(a.send({ jsonrpc: "2.0", method: "big", params: { blob: "x".repeat(2000) } })).rejects.toMatchObject({
      code: "frame_too_large",
    });
    aIn.write("");
    bIn.write(`${"y".repeat(2000)}\n`);
    bIn.write(`${JSON.stringify({ jsonrpc: "2.0", method: "after" })}\n`);
    await a.send({ jsonrpc: "2.0", method: "pong" });
    await sleep(10);
    await a.close();
    await read;
    expect(seen.map((s) => (s === "OVERSIZE" ? s : (JSON.parse(s) as { method: string }).method))).toEqual([
      "ping",
      "OVERSIZE",
      "after",
      "pong",
    ]);
  });

  test("jsonl_reader_splits_chunks_and_caps_without_buffering", async () => {
    async function* chunks() {
      yield '{"a":1}\n{"b"';
      yield ":2}\r\n\n";
      yield "z".repeat(5000);
      yield "\n{}";
    }
    const out: unknown[] = [];
    for await (const frame of readJsonlFrames(chunks(), 100)) out.push(frame);
    expect(out).toEqual(['{"a":1}', '{"b":2}', { oversize: true }, "{}"]);
  });

  test("protocol_table_includes_sessions_messages", () => {
    expect(CLIENT_METHODS).toContain("sessions.messages");
    expect(CLIENT_METHODS).toContain("initialize");
  });

  test("disconnect_rejects_pending_requests", async () => {
    const { client, server } = pair({ requests: { run: () => new Promise(() => {}) } });
    await client.initialize();
    const pending = client.request("run");
    await sleep(5);
    await server.close();
    await expect(pending).rejects.toBeInstanceOf(RemoteError);
    await expect(pending).rejects.toMatchObject({ code: "disconnected" });
  });
});

/** Injects a raw inbound text frame into a memory transport's own channel. */
function pushRaw(transport: unknown, text: string): void {
  const iterable = (transport as { frames(): unknown }).frames() as { push(value: string): void };
  iterable.push(text);
}
