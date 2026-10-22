import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { ModelProvider, ProviderEvent, ProviderRequest } from "../contracts.js";
import { assertRecordedStreamConforms, replayFetch } from "../provider-kit/wire-replay.js";

const sampleRequest: ProviderRequest = {
  model: { model: "test-model", provider: "mock" },
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
};

describe("wire-replay", () => {
  it("replay_fetch_fails_on_unexpected_path", async () => {
    const fetchFn = replayFetch({
      method: "POST",
      path: "/v1/messages",
      responseBody: "event: message_start\ndata: {}\n\n",
      status: 200,
    });

    await assert.rejects(
      async () => {
        await fetchFn("http://127.0.0.1/v1/unexpected", { method: "POST" });
      },
      (err: Error) => {
        assert.match(err.message, /unexpected path: expected \/v1\/messages, got \/v1\/unexpected/);
        return true;
      },
    );
  });

  it("replay_fetch_serves_recorded_exchanges_in_order", async () => {
    const fetchFn = replayFetch([
      {
        method: "POST",
        path: "/v1/messages",
        responseBody: "chunk-one",
        status: 200,
        contentType: "text/plain",
      },
      {
        method: "POST",
        path: "/v1/messages",
        responseBody: "chunk-two",
        status: 200,
        contentType: "text/plain",
      },
    ]);

    const res1 = await fetchFn("http://127.0.0.1/v1/messages", { method: "POST" });
    assert.equal(res1.status, 200);
    assert.equal(res1.headers.get("content-type"), "text/plain");
    assert.equal(await res1.text(), "chunk-one");

    const res2 = await fetchFn("/v1/messages", { method: "POST" });
    assert.equal(res2.status, 200);
    assert.equal(await res2.text(), "chunk-two");

    await assert.rejects(
      async () => {
        await fetchFn("/v1/messages", { method: "POST" });
      },
      (err: Error) => {
        assert.match(err.message, /no more recorded exchanges/);
        return true;
      },
    );
  });

  it("replay_fetch_fails_on_unexpected_method", async () => {
    const fetchFn = replayFetch({
      method: "POST",
      path: "/v1/chat",
      responseBody: "{}",
      status: 200,
    });

    await assert.rejects(
      async () => {
        await fetchFn("http://127.0.0.1/v1/chat", { method: "GET" });
      },
      (err: Error) => {
        assert.match(err.message, /unexpected method: expected POST, got GET/);
        return true;
      },
    );
  });

  it("recorded_stream_conforms_helper_reports_mismatch", async () => {
    const provider: ModelProvider = {
      id: "mock",
      async *generate(): AsyncGenerator<ProviderEvent> {
        yield { type: "content_delta", content: { type: "text", text: "Actual provider response" } };
        yield {
          type: "done",
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      },
    };

    // 1. Text mismatch
    await assert.rejects(
      async () => {
        await assertRecordedStreamConforms({
          provider,
          request: sampleRequest,
          recording: {
            path: "/v1/messages",
            responseBody: "data: ...",
            status: 200,
          },
          expect: {
            text: "Expected different text",
          },
        });
      },
      (err: Error) => {
        assert.match(err.message, /Provider text mismatch/);
        return true;
      },
    );

    // 2. Usage mismatch
    await assert.rejects(
      async () => {
        await assertRecordedStreamConforms({
          provider,
          request: sampleRequest,
          recording: {
            path: "/v1/messages",
            responseBody: "data: ...",
            status: 200,
          },
          expect: {
            usage: { inputTokens: 999, outputTokens: 5, totalTokens: 1004 },
          },
        });
      },
      (err: Error) => {
        assert.match(err.message, /Usage inputTokens mismatch/);
        return true;
      },
    );

    // 3. Error status mismatch: recording has 400 but provider completed with 'done'
    await assert.rejects(
      async () => {
        await assertRecordedStreamConforms({
          provider,
          request: sampleRequest,
          recording: {
            path: "/v1/messages",
            responseBody: '{"error":"bad_request"}',
            status: 400,
          },
        });
      },
      (err: Error) => {
        assert.match(err.message, /Provider stream expected to end with error event for recorded status 400/);
        return true;
      },
    );
  });

  it("recorded_stream_conforms_succeeds_when_expectations_match", async () => {
    const provider: ModelProvider = {
      id: "mock",
      async *generate(): AsyncGenerator<ProviderEvent> {
        yield { type: "content_delta", content: { type: "text", text: "conforming text" } };
        yield {
          type: "done",
          stopReason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      },
    };

    const events = await assertRecordedStreamConforms({
      provider,
      request: sampleRequest,
      recording: {
        path: "/v1/messages",
        responseBody: "data: ...",
        status: 200,
      },
      expect: {
        text: "conforming text",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    });

    assert.equal(events.length, 2);
    assert.equal(events[0].type, "content_delta");
    assert.equal(events[1].type, "done");
  });
});
