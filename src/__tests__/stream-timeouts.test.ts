import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { ProviderEvent, ProviderRequest } from "../contracts.js";
import { createAgent } from "../index.js";
import { createRoutedProvider, fetchWithStreamTimeouts, mergeProviderRequestOptions, providerPackage } from "../provider-kit/index.js";

const encoder = new TextEncoder();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const STOP = JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] });
const HELLO = JSON.stringify({ choices: [{ delta: { content: "hello" } }] });

/** An SSE body that sends `frames` (each `{ at, text }` after `at` ms) and then closes. */
function timedSse(frames: readonly { readonly at: number; readonly text: string }[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let elapsed = 0;
      for (const frame of frames) {
        await sleep(frame.at - elapsed);
        elapsed = frame.at;
        controller.enqueue(encoder.encode(frame.text));
      }
      controller.close();
    },
  });
}

/** A body that never sends a byte and never closes. */
const silentBody = (): ReadableStream<Uint8Array> => new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) });

/** A fetch that never answers until its signal aborts. */
const hangingFetch = ((_input: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })) as unknown as typeof fetch;

function routed(fetchImpl: typeof fetch) {
  return createRoutedProvider({
    id: "mock",
    baseUrl: "https://provider.test/v1",
    apiKey: async () => "sk-timeout-canary",
    fetch: fetchImpl,
    routes: { chat: { format: "openai-chat", path: "/chat/completions" } },
  });
}

const request = (extra: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model: { provider: "mock", model: "m" },
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  ...extra,
});

async function collect(events: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

function terminalError(events: readonly ProviderEvent[]) {
  const terminal = events.at(-1);
  assert.equal(terminal?.type, "error", JSON.stringify(terminal));
  return (terminal as Extract<ProviderEvent, { type: "error" }>).error;
}

describe("provider stream timeouts (plan 227 Task 3)", () => {
  it("no_headers_within_connect_timeout_is_etimedout", async () => {
    const started = performance.now();
    const events = await collect(routed(hangingFetch).generate(request({ options: { timeouts: { connectMs: 40 } } })));
    const error = terminalError(events);
    assert.equal(error.code, "ETIMEDOUT");
    assert.equal(error.failureClass, "transient");
    assert.match(error.message, /connect timeout/);
    assert.match(error.message, /40 ms/);
    assert.ok(performance.now() - started < 2_000);
    assert.doesNotMatch(JSON.stringify(events), /sk-timeout-canary/);
  });

  it("connect_timeout_wins_against_a_transport_that_ignores_its_signal", async () => {
    const deaf = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const error = terminalError(await collect(routed(deaf).generate(request({ options: { timeouts: { connectMs: 30 } } }))));
    assert.equal(error.code, "ETIMEDOUT");
  });

  it("stalled_stream_fails_after_idle_timeout", async () => {
    // Output began, then the body went silent: the turn fails as a transient idle timeout.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${HELLO}\n\n`));
      },
      pull: () => new Promise<void>(() => {}),
    });
    const fetchImpl = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    const events = await collect(routed(fetchImpl).generate(request({ options: { timeouts: { idleMs: 40 } } })));
    assert.ok(events.some((event) => event.type === "content_delta"));
    const error = terminalError(events);
    assert.equal(error.code, "ETIMEDOUT");
    assert.equal(error.failureClass, "transient");
    assert.match(error.message, /idle timeout/);
  });

  it("ping_frames_keep_the_stream_alive", async () => {
    // Every gap (30 ms) is under the idle timeout (60 ms); the whole stream (150 ms) is not.
    const frames = [
      { at: 30, text: ": keep-alive\n\n" },
      { at: 60, text: "event: ping\ndata: {}\n\n" },
      { at: 90, text: ": keep-alive\n\n" },
      { at: 120, text: `data: ${HELLO}\n\n` },
      { at: 150, text: `data: ${STOP}\n\ndata: [DONE]\n\n` },
    ];
    const fetchImpl = (async () => new Response(timedSse(frames), { status: 200 })) as unknown as typeof fetch;
    const events = await collect(routed(fetchImpl).generate(request({ options: { timeouts: { idleMs: 60 } } })));
    assert.equal(events.at(-1)?.type, "done", JSON.stringify(events.at(-1)));
  });

  it("slow_consumer_is_not_an_idle_stream", async () => {
    // The idle timer runs only while a read is pending, so a consumer that pauses longer than idleMs is fine.
    const response = await fetchWithStreamTimeouts(
      "https://provider.test",
      {},
      {
        fetch: (async () =>
          new Response(
            timedSse([
              { at: 0, text: "a" },
              { at: 1, text: "b" },
            ]),
          )) as unknown as typeof fetch,
        timeouts: { idleMs: 20 },
      },
    );
    const reader = response.body!.getReader();
    await sleep(60);
    const chunks: string[] = [];
    for (let read = await reader.read(); !read.done; read = await reader.read()) chunks.push(new TextDecoder().decode(read.value));
    assert.equal(chunks.join(""), "ab");
  });

  it("timeouts_null_disable", async () => {
    // With both timeouts disabled the stalled request is still waiting after 120 ms; the caller's abort ends it.
    const controller = new AbortController();
    const pending = collect(
      routed(hangingFetch).generate(request({ signal: controller.signal, options: { timeouts: { connectMs: null, idleMs: null } } })),
    );
    const outcome = await Promise.race([pending.then(() => "settled"), sleep(120).then(() => "waiting")]);
    assert.equal(outcome, "waiting");
    controller.abort();
    const error = terminalError(await pending);
    assert.notEqual(error.code, "ETIMEDOUT");
  });

  it("invalid_timeout_fails_before_fetch", async () => {
    let fetched = false;
    const fetchImpl = (async () => {
      fetched = true;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const error = terminalError(await collect(routed(fetchImpl).generate(request({ options: { timeouts: { idleMs: -1 } } }))));
    assert.match(error.message, /timeouts\.idleMs must be a positive number/);
    assert.equal(fetched, false);
  });

  it("run_abort_is_reported_as_abort_not_timeout", async () => {
    // Before headers.
    const beforeHeaders = new AbortController();
    const first = collect(
      routed(hangingFetch).generate(request({ signal: beforeHeaders.signal, options: { timeouts: { connectMs: 200 } } })),
    );
    setTimeout(() => beforeHeaders.abort(), 20);
    const connectError = terminalError(await first);
    assert.notEqual(connectError.code, "ETIMEDOUT");
    assert.equal(connectError.name, "AbortError");

    // While the body is read.
    const whileReading = new AbortController();
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason), { once: true });
        },
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const second = collect(routed(fetchImpl).generate(request({ signal: whileReading.signal, options: { timeouts: { idleMs: 200 } } })));
    setTimeout(() => whileReading.abort(), 20);
    const idleError = terminalError(await second);
    assert.notEqual(idleError.code, "ETIMEDOUT");
    assert.notEqual(idleError.failureClass, "transient");
  });

  it("stream_timeout_is_retried_by_default_policy", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return new Response(silentBody(), { status: 200 });
      return new Response(timedSse([{ at: 0, text: `data: ${HELLO}\n\ndata: ${STOP}\n\ndata: [DONE]\n\n` }]), { status: 200 });
    }) as unknown as typeof fetch;
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [providerPackage("test-provider", [routed(fetchImpl)])],
      providerOptions: { timeouts: { idleMs: 30 } },
      // Default policy (no `retry` set) apart from a short base delay to keep the test fast.
      retry: { baseDelayMs: 1 },
    });
    const result = await (await agent.session()).run("hi");
    assert.equal(result.status, "completed", JSON.stringify(result.error));
    assert.equal(result.text, "hello");
    assert.equal(calls, 2);
  });

  it("timeouts_merge_per_field_across_agent_and_run", () => {
    const merged = mergeProviderRequestOptions({ timeouts: { connectMs: 1_000, idleMs: 2_000 } }, { timeouts: { idleMs: null } });
    assert.deepEqual(merged?.timeouts, { connectMs: 1_000, idleMs: null });
    assert.equal("timeouts" in (mergeProviderRequestOptions({ sessionId: "a" }, { cacheKey: "b" }) ?? {}), false);
  });
});
