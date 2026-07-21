import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_MAX_BUFFER_BYTES,
  DEFAULT_MAX_EVENT_BYTES,
  DEFAULT_MAX_RESPONSE_BODY_BYTES,
  ProviderTransportError,
  parseJsonObjectArguments,
  tryParseJsonObjectArguments,
  readBoundedResponseText,
  readSseData,
  readSseEvents,
} from "../providers/transport.js";

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
  it("parses CRLF and LF delimited events with multiline data", async () => {
    const body = stream([
      "data: line1\r\n",
      "data: line2\r\n\r\ndata: ok\n\n",
    ]);
    const events = await collectEvents(body);
    assert.equal(events.length, 2);
    assert.equal(events[0]!.data, "line1\nline2");
    assert.equal(events[1]!.data, "ok");
  });

  it("reconstructs UTF-8 split across chunks", async () => {
    const emoji = "😀";
    const bytes = new TextEncoder().encode(`data: ${emoji}\n\n`);
    const body = stream([bytes.slice(0, 3), bytes.slice(3)]);
    const data = await collectData(body);
    assert.deepEqual(data, [emoji]);
  });

  it("surfaces SSE comment lines on events", async () => {
    const body = stream([": energy {\"energy_joules\":1}\n\ndata: {\"ok\":true}\n\n"]);
    const events = await collectEvents(body);
    assert.equal(events.length, 2);
    assert.deepEqual(events[0]!.comments, ["energy {\"energy_joules\":1}"]);
    assert.equal(events[0]!.data, "");
    assert.equal(events[1]!.data, "{\"ok\":true}");
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
    const body = stream(["data: " + "x".repeat(32)]);
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
    assert.deepEqual(parseJsonObjectArguments("{\"a\":1}"), { a: 1 });
    assert.throws(
      () => parseJsonObjectArguments("[]", { toolName: "echo" }),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "invalid_json_arguments",
    );
    assert.throws(
      () => parseJsonObjectArguments("{", { toolName: "echo" }),
      /Invalid tool arguments JSON for tool echo/,
    );
    assert.throws(
      () => parseJsonObjectArguments("x".repeat(20), { maxBytes: 8 }),
      (error: unknown) => error instanceof ProviderTransportError && error.code === "invalid_json_arguments",
    );
    const ok = tryParseJsonObjectArguments("{\"a\":1}");
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
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const info = statSync(path);
        if (info.isDirectory()) {
          if (entry === "__tests__" || entry === "dist") continue;
          walk(path);
          continue;
        }
        if (!entry.endsWith(".ts")) continue;
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
