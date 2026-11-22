import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "bun:test";
import {
  classifyProviderFailure,
  DEFAULT_MAX_BUFFER_BYTES,
  DEFAULT_MAX_EVENT_BYTES,
  DEFAULT_MAX_RESPONSE_BODY_BYTES,
  httpStatusError,
  ProviderTransportError,
  parseJsonObjectArguments,
  parseRetryAfterMs,
  readBoundedResponseJson,
  readBoundedResponseText,
  readSseData,
  readSseEvents,
  tryParseJsonObjectArguments,
} from "../provider-kit/transport.js";

function stream(chunks: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

async function collectEvents(body: ReadableStream<Uint8Array>, options?: Parameters<typeof readSseEvents>[1]) {
  const events = [];
  for await (const event of readSseEvents(body, options)) events.push(event);
  return events;
}

async function collectData(body: ReadableStream<Uint8Array>, options?: Parameters<typeof readSseData>[1]) {
  const data = [];
  for await (const chunk of readSseData(body, options)) data.push(chunk);
  return data;
}

describe("provider transport primitives", () => {
  it("httpStatusError carries status code and Retry-After hint", () => {
    const response = new Response("slow down", { status: 429, headers: { "retry-after": "2" } });
    const error = httpStatusError("OpenAI request failed", response, "slow down") as Error & { code?: number; retryAfterMs?: number };
    assert.equal(error.message, "OpenAI request failed: 429 slow down");
    assert.equal(error.code, 429);
    assert.equal(error.retryAfterMs, 2000);

    const plain = httpStatusError("X request failed", new Response("bad", { status: 400 }), "bad") as Error & { retryAfterMs?: number };
    assert.equal(plain.retryAfterMs, undefined);
  });

  it("classifies quota, auth, rate, transient, permanent, and unknown provider failures", () => {
    for (const [error, expected] of [
      [Object.assign(new Error('{"error":{"code":"GoUsageLimitError"}}'), { code: 429 }), "quota"],
      [Object.assign(new Error("weekly limit reached for this plan"), { code: 429 }), "quota"],
      [Object.assign(new Error("session limit reached for this plan"), { code: 429 }), "quota"],
      [Object.assign(new Error("unauthorized"), { code: 401 }), "auth"],
      [Object.assign(new Error("slow down"), { code: 429 }), "rate_limited"],
      [Object.assign(new Error("connection reset"), { code: "ECONNRESET" }), "transient"],
      [Object.assign(new Error("bad request"), { code: 400 }), "permanent"],
      [new Error("unclassified"), "unknown"],
    ] as const) {
      assert.equal(classifyProviderFailure(error), expected);
    }
  });

  it("parseRetryAfterMs handles delay-seconds, HTTP-date, and garbage", () => {
    assert.equal(parseRetryAfterMs(null), undefined);
    assert.equal(parseRetryAfterMs("5"), 5000);
    assert.equal(parseRetryAfterMs("nonsense"), undefined);
    const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
    assert.equal(parseRetryAfterMs("Wed, 21 Oct 2015 07:28:10 GMT", undefined, now), 10_000);
    assert.equal(parseRetryAfterMs("Wed, 21 Oct 2015 07:27:00 GMT", undefined, now), 0);
  });

  it("parses CRLF and LF delimited events with multiline data", async () => {
    const body = stream(["data: line1\r\n", "data: line2\r\n\r\ndata: ok\n\n"]);
    const events = await collectEvents(body);
    assert.equal(events.length, 2);
    assert.equal(events[0]?.data, "line1\nline2");
    assert.equal(events[1]?.data, "ok");
  });

  it("reconstructs UTF-8 split across chunks", async () => {
    const emoji = "😀";
    const bytes = new TextEncoder().encode(`data: ${emoji}\n\n`);
    const body = stream([bytes.slice(0, 3), bytes.slice(3)]);
    const data = await collectData(body);
    assert.deepEqual(data, [emoji]);
  });

  it("surfaces SSE comment lines on events", async () => {
    const body = stream([': energy {"energy_joules":1}\n\ndata: {"ok":true}\n\n']);
    const events = await collectEvents(body);
    assert.equal(events.length, 2);
    assert.deepEqual(events[0]?.comments, ['energy {"energy_joules":1}']);
    assert.equal(events[0]!.data, "");
    assert.equal(events[1]?.data, '{"ok":true}');
  });

  it("flushes a final partial event without trailing blank line", async () => {
    const body = stream(["data: tail"]);
    const data = await collectData(body);
    assert.deepEqual(data, ["tail"]);
  });

  it("aborts in-flight SSE reads", async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode("data: partial\n"));
        controller.abort();
      },
    });
    await assert.rejects(
      async () => collectEvents(body, { signal: controller.signal }),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "aborted",
    );
  });

  it("rejects oversized incomplete SSE buffers", async () => {
    const body = stream([`data: ${"x".repeat(32)}`]);
    await assert.rejects(
      () => collectEvents(body, { maxBufferBytes: 16 }),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "sse_buffer_overflow",
    );
  });

  it("rejects oversized completed SSE events", async () => {
    const body = stream([`data: ${"x".repeat(40)}\n\n`]);
    await assert.rejects(
      () => collectEvents(body, { maxEventBytes: 20 }),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "sse_event_overflow",
    );
  });

  it("reads bounded response text and redacts secrets", async () => {
    const secret = "secret-token";
    const response = new Response(`error ${secret}`, { status: 500 });
    const text = await readBoundedResponseText(response, { secrets: [secret], maxResponseBodyBytes: DEFAULT_MAX_RESPONSE_BODY_BYTES });
    assert.equal(text.includes(secret), false);
    assert.equal(text.includes("[REDACTED]"), true);
  });

  it("rejects oversized response bodies", async () => {
    const response = new Response("x".repeat(100));
    await assert.rejects(
      () => readBoundedResponseText(response, { maxResponseBodyBytes: 16 }),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "response_body_overflow",
    );
  });

  it("parses JSON object arguments and rejects invalid shapes", () => {
    assert.deepEqual(parseJsonObjectArguments(""), {});
    assert.deepEqual(parseJsonObjectArguments('{"a":1}'), { a: 1 });
    assert.throws(
      () => parseJsonObjectArguments("[]", { toolName: "echo" }),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "invalid_json_arguments",
    );
    assert.throws(() => parseJsonObjectArguments("{", { toolName: "echo" }), /Invalid tool arguments JSON for tool echo/);
    assert.throws(
      () => parseJsonObjectArguments("x".repeat(20), { maxBytes: 8 }),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "invalid_json_arguments",
    );
    const ok = tryParseJsonObjectArguments('{"a":1}');
    assert.equal(ok.ok, true);
    if (ok.ok) assert.deepEqual(ok.value, { a: 1 });
    const bad = tryParseJsonObjectArguments("{", { toolName: "echo" });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error.code, "invalid_json_arguments");
  });

  it("exports documented default limits", () => {
    assert.equal(DEFAULT_MAX_EVENT_BYTES, 262_144);
    assert.equal(DEFAULT_MAX_BUFFER_BYTES, 524_288);
    assert.equal(DEFAULT_MAX_RESPONSE_BODY_BYTES, 65_536);
  });

  it("keeps shared transport authoritative across first-party providers", () => {
    const packagesRoot = join(process.cwd(), "packages");
    const providerDirs = readdirSync(packagesRoot)
      .filter((name) => name.startsWith("provider-"))
      .map((name) => join(packagesRoot, name, "src"));

    const forbidden = [
      /function\s+safeText\s*\(/,
      /async\s+function\*?\s+readSse(?:Data|Events|Frames)?\s*\(/,
      /export\s+async\s+function\*?\s+readSse(?:Data|Events|Frames)?\s*\(/,
    ];
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      // withFileTypes: directory info comes from the readdir entry, no statSync
      // then readFileSync pair (CodeQL js/file-system-race, alert 75).
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__" || entry.name === "dist") continue;
          walk(path);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
        const source = readFileSync(path, "utf8");
        for (const pattern of forbidden) {
          if (pattern.test(source)) offenders.push(`${path} matches ${pattern}`);
        }
      }
    };

    for (const dir of providerDirs) walk(dir);
    assert.deepEqual(offenders, [], offenders.join("\n"));
  });
});

describe("SSE reader byte accounting (plan 228 Task 4)", () => {
  it("sse_buffer_limit_holds_without_reencoding", async () => {
    const encoder = new TextEncoder();
    // 10 × "😀" = 40 bytes after "data: " (6), split mid-character across chunks.
    const bytes = encoder.encode(`data: ${"😀".repeat(10)}`);
    const chunks = [bytes.slice(0, 7), bytes.slice(7, 9), bytes.slice(9, 23), bytes.slice(23)];
    await assert.rejects(
      () => collectEvents(stream(chunks), { maxBufferBytes: 45 }),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "sse_buffer_overflow",
    );
    // Exactly at the limit is allowed, and the frame decodes intact.
    const events = await collectEvents(stream([...chunks, "\n\n"]), { maxBufferBytes: 48 });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.data, "😀".repeat(10));
    // Consumed frames release their bytes: many frames through a small buffer never overflow.
    const many = Array.from({ length: 200 }, (_, i) => `data: é${i}\n\n`);
    const out = await collectEvents(stream(many), { maxBufferBytes: 32 });
    assert.equal(out.length, 200);
    assert.equal(out[199]?.data, "é199");
  });

  it("sse_large_frame_in_small_chunks_is_linear", async () => {
    const payload = "a".repeat(240_000);
    const frame = `data: ${payload}\r\n\r\ndata: next\n\n`;
    const chunked = (text: string, size: number) => {
      const out: string[] = [];
      for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
      return out;
    };
    // The \r\n\r\n delimiter is split across chunk boundaries at every offset.
    for (const cut of [1, 2, 3]) {
      const at = 6 + payload.length + cut;
      const events = await collectEvents(stream([frame.slice(0, at), frame.slice(at)]));
      assert.deepEqual(
        events.map((event) => event.data.length),
        [240_000, 4],
        `split at delimiter offset ${cut}`,
      );
    }
    const time = async (text: string) => {
      const chunks = chunked(text, 256);
      const started = performance.now();
      const events = await collectEvents(stream(chunks), { maxEventBytes: 4 * 1024 * 1024, maxBufferBytes: 4 * 1024 * 1024 });
      assert.equal(events.length, 2);
      return performance.now() - started;
    };
    await time(frame); // warm-up
    const small = Math.min(await time(frame), await time(frame));
    const bigFrame = `data: ${"a".repeat(960_000)}\n\ndata: next\n\n`;
    const big = Math.min(await time(bigFrame), await time(bigFrame));
    // Linear: 4× the frame costs ~4× (quadratic would be ~16×). Loose bound for loaded machines.
    assert.ok(big < small * 9 + 20, `240 KB ${small.toFixed(1)} ms vs 960 KB ${big.toFixed(1)} ms`);
  });
});

describe("bounded success-body reader", () => {
  const isDataArray = (v: unknown): boolean => typeof v === "object" && v !== null && Array.isArray((v as { data?: unknown }).data);

  // The thirteen success-body shapes the reader replaces: ten model-discovery responses,
  // NeuralWatt quota, Alibaba embeddings, OpenAI uploads (task6 migrates the uploads site
  // to the same reader; conformance covers its shape here).
  const shapes = [
    { name: "alibaba models", payload: { data: [{ id: "qwen-max" }] } },
    { name: "anthropic models", payload: { data: [{ id: "claude" }] } },
    { name: "google models", payload: { models: [{ name: "gemini" }] } },
    { name: "kimi models", payload: { data: [{ id: "moonshot" }] } },
    { name: "neuralwatt models", payload: { data: [{ id: "nw-model" }] } },
    { name: "ollama models", payload: { data: [{ id: "llama" }] } },
    { name: "openai models", payload: { data: [{ id: "gpt" }] } },
    { name: "opencode-go models", payload: { data: [{ id: "og" }] } },
    { name: "openrouter models", payload: { data: [{ id: "or" }] } },
    { name: "zai models", payload: { data: [{ id: "zai" }] } },
    { name: "neuralwatt quota", payload: { balance: { balance_usd: 1.5 }, usage: { lifetime: { tokens: 100 } } } },
    { name: "alibaba embeddings", payload: { data: [{ embedding: [0.1, 0.2], index: 0 }], model: "m" } },
    { name: "openai uploads", payload: { id: "file-123", bytes: 10, created_at: 0 } },
  ] as const;

  for (const { name, payload } of shapes) {
    it(`parses normal ${name} payloads identically`, async () => {
      const response = new Response(JSON.stringify(payload), { status: 200 });
      const parsed = await readBoundedResponseJson(response, {
        shape: (v): v is typeof payload => deepEqualShape(v, payload),
      });
      assert.deepEqual(parsed, payload);
    });

    it(`rejects oversized chunked ${name} bodies before full buffering`, async () => {
      let pulls = 0;
      const total = 40;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulls >= total) {
            controller.close();
            return;
          }
          pulls += 1;
          controller.enqueue(new TextEncoder().encode(JSON.stringify(payload)));
        },
      });
      await assert.rejects(
        () => readBoundedResponseJson(new Response(body), { maxResponseBodyBytes: 16 }),
        (error: unknown) => error instanceof ProviderTransportError && error.code === "response_body_overflow",
      );
      assert.ok(pulls < total, `body fully buffered before overflow (pulls=${pulls}/${total})`);
    });
  }

  it("rejects malformed JSON with the shape error", async () => {
    await assert.rejects(
      () => readBoundedResponseJson(new Response("{ not json")),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "response_body_shape",
    );
    await assert.rejects(
      () => readBoundedResponseJson(new Response("")),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "response_body_shape",
    );
  });

  it("rejects over-deep JSON", async () => {
    const deep = JSON.parse("[1,[2,[3,[4,[5,[6]]]]]]") as unknown;
    await assert.rejects(
      () => readBoundedResponseJson(new Response(JSON.stringify(deep)), { maxDepth: 3 }),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "response_body_shape",
    );
    const ok = await readBoundedResponseJson(new Response(JSON.stringify(deep)), { maxDepth: 32 });
    assert.deepEqual(ok, deep);
  });

  it("rejects over-wide objects and arrays", async () => {
    await assert.rejects(
      () => readBoundedResponseJson(new Response(JSON.stringify({ a: 1, b: 2, c: 3 })), { maxProperties: 2 }),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "response_body_shape",
    );
    await assert.rejects(
      () => readBoundedResponseJson(new Response(JSON.stringify([1, 2, 3])), { maxProperties: 2 }),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "response_body_shape",
    );
  });

  it("shape gate failures fail closed; passing gates return the parsed value", async () => {
    await assert.rejects(
      () => readBoundedResponseJson<{ data: unknown[] }>(new Response(JSON.stringify({ models: [] })), { shape: isDataArray }),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "response_body_shape",
    );
    const parsed = await readBoundedResponseJson<{ data: unknown[] }>(new Response(JSON.stringify({ data: [] })), {
      shape: isDataArray,
    });
    assert.deepEqual(parsed, { data: [] });
  });

  it("honors aborts and never leaks secrets in errors", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => readBoundedResponseJson(new Response("ignored"), { signal: controller.signal, secrets: ["hunter2"] }),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "aborted",
    );
    await assert.rejects(
      () => readBoundedResponseJson(new Response("body contains hunter2 secret but malformed"), { secrets: ["hunter2"] }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderTransportError);
        assert.equal(error.message.includes("hunter2"), false);
        return error.code === "response_body_shape";
      },
    );
  });
});

function deepEqualShape(actual: unknown, expected: unknown): boolean {
  if (typeof expected !== "object" || expected === null) return typeof actual === typeof expected;
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((entry, i) => deepEqualShape((actual as unknown[])[i], entry))
    );
  }
  if (Array.isArray(actual) || actual === null) return false;
  return Object.keys(expected).every((key) =>
    deepEqualShape((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key]),
  );
}
