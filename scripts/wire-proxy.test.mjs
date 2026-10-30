import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLoopbackHost, normalizeUsageMetrics, parseRawUpstreamUsage, startWireProxy } from "./wire-proxy.mjs";

describe("wire-proxy", () => {
  it("proxy_refuses_non_loopback_listen", () => {
    assert.equal(isLoopbackHost("127.0.0.1"), true);
    assert.equal(isLoopbackHost("127.0.0.2"), true);
    assert.equal(isLoopbackHost("localhost"), true);
    assert.equal(isLoopbackHost("::1"), true);
    assert.equal(isLoopbackHost("[::1]"), true);

    assert.equal(isLoopbackHost("0.0.0.0"), false);
    assert.equal(isLoopbackHost("192.168.1.1"), false);
    assert.equal(isLoopbackHost("10.0.0.1"), false);
    assert.equal(isLoopbackHost("example.com"), false);

    const proc = spawnSync("bun", ["scripts/wire-proxy.mjs", "--upstream", "http://127.0.0.1:9000", "--listen", "0.0.0.0:8787"], {
      encoding: "utf8",
    });
    assert.notEqual(proc.status, 0, "Non-loopback listen must exit with non-zero status");
  });

  it("proxy_requires_secret_env_when_recording", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "proxy-secret-req-"));
    try {
      const proc = spawnSync(
        "bun",
        ["scripts/wire-proxy.mjs", "--upstream", "http://127.0.0.1:9000", "--listen", "127.0.0.1:8787", "--record", tempDir],
        { encoding: "utf8" },
      );
      assert.equal(proc.status, 2, "Recording without --secret-env must exit 2");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("proxy_records_body_and_content_type_only", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "proxy-record-"));
    let upstreamServer;
    let proxy;

    try {
      upstreamServer = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
          const resBody = 'event: message_start\ndata: {"type":"message_start"}\n\n';
          return new Response(resBody, {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
              "x-request-id": "req-secret-12345",
              server: "mock-vendor-server",
              "set-cookie": "session=abc",
            },
          });
        },
      });

      proxy = await startWireProxy({
        upstream: `http://127.0.0.1:${upstreamServer.port}`,
        listen: "127.0.0.1:0",
        record: tempDir,
        secretEnv: ["DUMMY_SECRET_KEY"],
        env: { DUMMY_SECRET_KEY: "unused-secret" },
      });

      const clientRes = await fetch(`${proxy.url}/v1/messages?beta=true`, {
        method: "POST",
        headers: {
          authorization: "Bearer mock-token",
          "x-caller-trace": "trace-987",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "test-model", max_tokens: 100 }),
      });

      assert.equal(clientRes.status, 200);
      assert.equal(clientRes.headers.get("content-type"), "text/event-stream");
      const clientText = await clientRes.text();
      assert.match(clientText, /message_start/);

      await proxy.drain();

      const recordPath = join(tempDir, "1.json");
      assert.equal(existsSync(recordPath), true, "1.json must be recorded");

      const recorded = JSON.parse(readFileSync(recordPath, "utf8"));
      assert.equal(recorded.method, "POST");
      assert.equal(recorded.path, "/v1/messages?beta=true");
      assert.equal(recorded.status, 200);
      assert.equal(recorded.contentType, "text/event-stream");
      assert.deepEqual(recorded.requestBody, { model: "test-model", max_tokens: 100 });
      assert.equal(recorded.responseBody, 'event: message_start\ndata: {"type":"message_start"}\n\n');

      // Verify NO other headers are written
      assert.deepEqual(recorded.headers, { "content-type": "text/event-stream" });
      const recordKeys = Object.keys(recorded).sort();
      assert.deepEqual(recordKeys, ["contentType", "headers", "method", "path", "requestBody", "responseBody", "status"].sort());

      const fileText = readFileSync(recordPath, "utf8");
      assert.equal(fileText.includes("mock-token"), false, "Authorization header must never be recorded");
      assert.equal(fileText.includes("mock-vendor-server"), false, "Server header must not be recorded");
      assert.equal(fileText.includes("trace-987"), false, "Caller headers must not be recorded");
      assert.equal(fileText.includes("set-cookie"), false, "Cookies must not be recorded");
    } finally {
      if (proxy) proxy.stop();
      if (upstreamServer) upstreamServer.stop(true);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("proxy_survives_upstream_stream_reset_and_leaves_a_partial_record", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "proxy-reset-"));
    let upstreamServer;
    let proxy;
    try {
      let pulls = 0;
      upstreamServer = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
          return new Response(
            new ReadableStream({
              async pull(controller) {
                if (pulls++ === 0) controller.enqueue(new TextEncoder().encode('data: {"type":"content_block_delta"}\n\n'));
                else {
                  await new Promise((resolve) => setTimeout(resolve, 20));
                  controller.error(new Error("upstream reset"));
                }
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        },
      });
      const usageLog = join(tempDir, "usage.jsonl");
      proxy = await startWireProxy({
        upstream: `http://127.0.0.1:${upstreamServer.port}`,
        listen: "127.0.0.1:0",
        record: tempDir,
        usageLog,
        secretEnv: ["DUMMY_SECRET_KEY"],
        env: { DUMMY_SECRET_KEY: "unused-secret" },
      });
      const clientRes = await fetch(`${proxy.url}/v1/messages`, { method: "POST", body: JSON.stringify({ model: "m" }) });
      await clientRes.text().catch(() => {});
      await proxy.drain();
      const recorded = JSON.parse(readFileSync(join(tempDir, "1.json"), "utf8"));
      assert.match(recorded.responseBody, /content_block_delta/);
      const usage = JSON.parse(readFileSync(usageLog, "utf8").trim().split("\n")[0]);
      assert.equal(usage.rawUsage ?? null, null, "a reset stream leaves usage unknown, never zero");
    } finally {
      if (proxy) proxy.stop();
      if (upstreamServer) upstreamServer.stop(true);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("proxy_aborts_write_on_secret_hit", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "proxy-secret-abort-"));
    const secret = "sk-super-secret-key-999";

    try {
      const proc = spawnSync(
        "bun",
        [
          "-e",
          `
          import { startWireProxy } from "./scripts/wire-proxy.mjs";
          const secret = ${JSON.stringify(secret)};
          const upstream = Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch() {
              return new Response(JSON.stringify({ error: \`Unauthorized with key \${secret}\` }), {
                status: 401,
                headers: { "content-type": "application/json" },
              });
            },
          });

          const proxy = await startWireProxy({
            upstream: \`http://127.0.0.1:\${upstream.port}\`,
            listen: "127.0.0.1:0",
            record: ${JSON.stringify(tempDir)},
            secretEnv: ["LEAKED_API_KEY"],
            env: { LEAKED_API_KEY: secret },
          });

          const res = await fetch(\`\${proxy.url}/v1/chat\`, { method: "POST", body: "{}" });
          await res.text();
          await proxy.drain();
          `,
        ],
        { encoding: "utf8" },
      );

      assert.equal(proc.status, 3, "Secret hit must abort write and exit 3");
      assert.equal(existsSync(join(tempDir, "1.json")), false, "Recording file must NOT be written when secret leaks");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("proxy_usage_log_reads_both_formats", async () => {
    // 1. Anthropic format tests (SSE & JSON)
    const anthropicSse = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":12,"cache_read_input_tokens":500,"cache_creation_input_tokens":50}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":35}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join("");

    const parsedAnthropicSse = parseRawUpstreamUsage(anthropicSse, "text/event-stream");
    assert.deepEqual(parsedAnthropicSse, {
      input_tokens: 12,
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 50,
      output_tokens: 35,
    });

    const normalizedAnthropic = normalizeUsageMetrics(parsedAnthropicSse);
    assert.deepEqual(normalizedAnthropic, {
      inputTokens: 562, // 12 + 500 + 50 (inclusive rule)
      outputTokens: 35,
      cacheReadTokens: 500,
      cacheWriteTokens: 50,
      totalTokens: 597,
    });

    const anthropicJson = JSON.stringify({
      id: "msg_2",
      type: "message",
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 20,
        output_tokens: 15,
      },
    });
    const parsedAnthropicJson = parseRawUpstreamUsage(anthropicJson, "application/json");
    assert.equal(parsedAnthropicJson.input_tokens, 10);
    assert.equal(parsedAnthropicJson.cache_read_input_tokens, 200);

    // 2. OpenAI format tests (SSE & JSON)
    const openAiSse = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"}}],"usage":null}\n\n',
      'data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":25,"total_tokens":125,"prompt_tokens_details":{"cached_tokens":40,"cache_creation_input_tokens":10}}}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    const parsedOpenAiSse = parseRawUpstreamUsage(openAiSse, "text/event-stream");
    assert.deepEqual(parsedOpenAiSse, {
      prompt_tokens: 100,
      completion_tokens: 25,
      total_tokens: 125,
      prompt_tokens_details: { cached_tokens: 40, cache_creation_input_tokens: 10 },
    });

    const normalizedOpenAi = normalizeUsageMetrics(parsedOpenAiSse);
    assert.deepEqual(normalizedOpenAi, {
      inputTokens: 100, // prompt_tokens is inclusive
      outputTokens: 25,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
      totalTokens: 125,
    });

    const openAiJson = JSON.stringify({
      id: "chatcmpl-2",
      usage: {
        prompt_tokens: 50,
        completion_tokens: 10,
        total_tokens: 60,
      },
    });
    const parsedOpenAiJson = parseRawUpstreamUsage(openAiJson, "application/json");
    assert.equal(parsedOpenAiJson.prompt_tokens, 50);

    // 3. End-to-end integration with --usage-log
    const tempLog = join(tmpdir(), `usage-log-${Date.now()}.jsonl`);
    let upstreamServer;
    let proxy;

    try {
      let turn = 0;
      upstreamServer = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
          turn++;
          if (turn === 1) {
            return new Response(anthropicSse, {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            });
          }
          return new Response(openAiSse, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          });
        },
      });

      proxy = await startWireProxy({
        upstream: `http://127.0.0.1:${upstreamServer.port}`,
        listen: "127.0.0.1:0",
        usageLog: tempLog,
      });

      // Call 1: Anthropic
      const res1 = await fetch(`${proxy.url}/v1/messages`, { method: "POST" });
      await res1.text();

      // Call 2: OpenAI
      const res2 = await fetch(`${proxy.url}/v1/chat/completions`, { method: "POST" });
      await res2.text();

      await proxy.drain();

      const logLines = readFileSync(tempLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(logLines.length, 2);

      // Line 1: Anthropic
      assert.equal(logLines[0].exchange, 1);
      assert.equal(logLines[0].path, "/v1/messages");
      assert.equal(logLines[0].rawUsage.input_tokens, 12);
      assert.equal(logLines[0].inputTokens, 562);
      assert.equal(logLines[0].cacheReadTokens, 500);
      assert.equal(logLines[0].cacheWriteTokens, 50);
      assert.equal(logLines[0].outputTokens, 35);
      assert.equal(logLines[0].totalTokens, 597);

      // Line 2: OpenAI
      assert.equal(logLines[1].exchange, 2);
      assert.equal(logLines[1].path, "/v1/chat/completions");
      assert.equal(logLines[1].rawUsage.prompt_tokens, 100);
      assert.equal(logLines[1].inputTokens, 100);
      assert.equal(logLines[1].cacheReadTokens, 40);
      assert.equal(logLines[1].cacheWriteTokens, 10);
      assert.equal(logLines[1].outputTokens, 25);
      assert.equal(logLines[1].totalTokens, 125);
    } finally {
      if (proxy) proxy.stop();
      if (upstreamServer) upstreamServer.stop(true);
      rmSync(tempLog, { force: true });
    }
  });
});

it("proxy_usage_log_reads_responses_terminal_usage", () => {
  const usage = { input_tokens: 123, output_tokens: 17, input_tokens_details: { cached_tokens: 20 } };
  const stream = `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1", usage } })}\n\n`;
  assert.deepEqual(parseRawUpstreamUsage(stream, "text/event-stream"), usage);
});

it("proxy_records_transport_failures_as_unknown_usage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proxy-transport-"));
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("unused") });
  const port = upstream.port;
  upstream.stop(true);
  const proxy = await startWireProxy({ upstream: `http://127.0.0.1:${port}`, listen: "127.0.0.1:0", usageLog: join(dir, "usage.jsonl") });
  try {
    const response = await fetch(proxy.url, { method: "POST", body: JSON.stringify({ model: "free" }) });
    assert.equal(response.status, 502);
    await proxy.drain();
    const row = JSON.parse(readFileSync(join(dir, "usage.jsonl"), "utf8"));
    assert.equal(row.status, 502);
    assert.equal(row.rawUsage, null);
  } finally {
    proxy.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("wire_metadata_retains_generation_ids_without_response_text", async () => {
  const { parseRawResponseId } = await import("./wire-proxy.mjs");
  assert.equal(parseRawResponseId('data: {"id":"gen-test","choices":[]}\n\ndata: [DONE]\n'), "gen-test");
  assert.equal(parseRawResponseId('{"id":"resp-test","output":[]}'), "resp-test");
  assert.equal(parseRawResponseId('data: {"type":"response.completed","response":{"id":"resp-sse"}}\n'), "resp-sse");
  assert.equal(parseRawResponseId('data: {"error":"no id"}\n'), undefined);
});

it("proxy_allows_model_prefill_longer_than_the_server_idle_default", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proxy-quiet-"));
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode("data: first\n\n"));
            await new Promise((resolve) => setTimeout(resolve, 11000));
            controller.enqueue(new TextEncoder().encode("data: last\n\n"));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const proxy = await startWireProxy({
    upstream: `http://127.0.0.1:${upstream.port}`,
    listen: "127.0.0.1:0",
    usageLog: join(dir, "usage.jsonl"),
  });
  try {
    const response = await fetch(proxy.url, { signal: AbortSignal.timeout(14000) });
    assert.match(await response.text(), /data: last/);
  } finally {
    proxy.stop();
    upstream.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
}, 16000);

it("wire_usage_log_retains_the_prompt_cache_key", async () => {
  const { requestCacheKey } = await import("./wire-proxy.mjs");
  assert.equal(requestCacheKey(new Headers({ "x-session-id": "prism-fabric-extract:default" }), null), "prism-fabric-extract:default");
  assert.equal(requestCacheKey(new Headers({ session_id: "s" }), null), "s");
  assert.equal(requestCacheKey(new Headers(), { prompt_cache_key: "k" }), "k");
  assert.equal(requestCacheKey(new Headers(), "text body"), undefined);
  const dir = mkdtempSync(join(tmpdir(), "proxy-cache-key-"));
  const upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ id: "g", usage: { prompt_tokens: 3, completion_tokens: 1 } }),
  });
  const usageLog = join(dir, "usage.jsonl");
  const proxy = await startWireProxy({ upstream: `http://127.0.0.1:${upstream.port}`, listen: "127.0.0.1:0", usageLog });
  try {
    for (const headers of [{ "x-session-id": "prism-fabric-extract:project" }, {}])
      await fetch(`${proxy.url}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model: "m" }) });
    await proxy.drain();
    const rows = readFileSync(usageLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(rows[0].cacheKey, "prism-fabric-extract:project");
    assert.equal("cacheKey" in rows[1], false);
  } finally {
    proxy.stop();
    upstream.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
