import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "bun:test";
import type { ModelProvider } from "../contracts.js";
import { runManifestCommand } from "../cli-manifest.js";
import { providerDone, providerTextDelta, providerToolCallDelta, providerUsage } from "../index.js";
import { createMockProvider } from "../testing/index.js";
import {
  assertAbortIsObserved,
  assertCanonicalToolParameters,
  assertNoSecretLeak,
  assertProviderOwnedHeadersWin,
  assertProviderStreamConforms,
  assertSerializedRequestCoversContent,
  assertToolCallDeltasReconstruct,
  assertUsageAccounting,
  collectProviderEvents,
  providerConformance,
} from "../provider-kit/conformance.js";

const request = {
  model: { provider: "mock", model: "demo" },
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
} as const;

void describe("provider conformance", () => {
  it("conformance_collects_events_in_order", async () => {
    const events = [providerTextDelta("Hi"), providerDone()];
    assert.deepEqual(await collectProviderEvents(createMockProvider(events), request), events);
  });

  it("conformance_fails_missing_done_or_error", async () => {
    await assert.rejects(assertProviderStreamConforms({ provider: createMockProvider([providerTextDelta("Hi")]), request }), /must end/);
  });

  it("conformance_checks_abort_signal", async () => {
    await assertAbortIsObserved({ provider: createMockProvider([providerDone()]), request });
  });

  it("conformance_reconstructs_tool_call_deltas", () => {
    const calls = assertToolCallDeltasReconstruct(
      [
        providerToolCallDelta({ index: 0, id: "call_1", name: "lookup", argumentsText: '{"a":' }),
        providerToolCallDelta({ index: 0, argumentsText: "1}" }),
        providerDone(),
      ],
      [{ index: 0, id: "call_1", name: "lookup", arguments: { a: 1 } }],
    );

    assert.deepEqual(calls[0]?.arguments, { a: 1 });
  });

  it("conformance_marks_malformed_tool_call_delta_arguments_without_throwing", () => {
    const calls = assertToolCallDeltasReconstruct(
      [providerToolCallDelta({ index: 0, id: "call_1", name: "lookup", argumentsText: "not-json" }), providerDone()],
      [{ index: 0, id: "call_1", name: "lookup", arguments: {} }],
    );
    assert.equal(calls[0]?.argumentsError?.code, "invalid_json_arguments");
  });

  it("conformance_rejects_incomplete_tool_call_deltas", () => {
    assert.throws(
      () => assertToolCallDeltasReconstruct([providerToolCallDelta({ index: 0, argumentsText: '{"a":1}' })], []),
      /incomplete_delta|Incomplete tool call/,
    );
  });

  it("conformance_checks_cache_usage_fields", async () => {
    const events = await assertProviderStreamConforms({
      provider: createMockProvider([
        providerTextDelta("Hi"),
        providerUsage({ inputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 1 }),
        providerDone(),
      ]),
      request,
      expect: { text: "Hi", usage: { cacheReadTokens: 2, cacheWriteTokens: 1 } },
    });

    assert.equal(assertUsageAccounting(events, { inputTokens: 3 }).inputTokens, 3);
  });

  it("usage_accounting_rejects_cache_above_input", () => {
    const events = [providerUsage({ inputTokens: 5, cacheReadTokens: 4, cacheWriteTokens: 2 }), providerDone()];
    assert.throws(
      () => assertUsageAccounting(events, { inputTokens: 5 }),
      /Usage accounting invariant violated.*cacheReadTokens \(4\) \+ cacheWriteTokens \(2\) > inputTokens \(5\)/,
    );
  });

  it("conformance_requires_canonical_tool_parameters", () => {
    const original = { type: "object", required: ["z", "a"], properties: { z: {}, a: {} } };
    assertCanonicalToolParameters({ properties: { a: {}, z: {} }, required: ["a", "z"], type: "object" }, original);
    assert.throws(() => assertCanonicalToolParameters({ required: ["z", "a"], type: "object" }, original), /not canonicalized/);
  });

  it("conformance_ships_from_the_provider_kit_subpath", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.ok(pkg.exports["./provider-kit"]);
    assert.equal(pkg.exports["./testing/provider-conformance"], undefined);
  });

  it("conformance_serialized_request_covers_text_thinking_tool_result_and_images", () => {
    assertSerializedRequestCoversContent(
      {
        model: { provider: "mock", model: "demo" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Hello" },
              { type: "thinking", text: "think-deep" },
              { type: "image", url: "https://example.invalid/img.png" },
              { type: "tool_result", toolCallId: "call_1", name: "lookup", result: { id: "42" } },
            ],
          },
          { role: "assistant", content: [{ type: "tool_call", id: "call_2", name: "sum", arguments: { a: 1, b: 2 } }] },
        ],
      },
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Hello" },
              { type: "thinking", text: "think-deep" },
              { type: "image_url", image_url: { url: "https://example.invalid/img.png" } },
              { type: "tool_result", tool_call_id: "call_1", name: "lookup", content: JSON.stringify({ id: "42" }) },
            ],
          },
          {
            role: "assistant",
            tool_calls: [{ id: "call_2", type: "function", function: { name: "sum", arguments: JSON.stringify({ a: 1, b: 2 }) } }],
          },
        ],
      },
    );
  });

  it("conformance_serialized_request_fails_when_non_text_block_is_dropped", () => {
    assert.throws(
      () =>
        assertSerializedRequestCoversContent(
          {
            model: { provider: "mock", model: "demo" },
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: "hi" },
                  { type: "image", url: "https://example.invalid/img.png" },
                ],
              },
            ],
          },
          { messages: [{ role: "user", content: "hi" }] },
        ),
      /image.*dropped|missing canaries/i,
    );
  });

  it("conformance_serialized_request_allows_unsupported_blocks_to_be_absent", () => {
    assertSerializedRequestCoversContent(
      {
        model: { provider: "mock", model: "demo" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "hi" },
              { type: "image", url: "https://example.invalid/img.png" },
            ],
          },
        ],
      },
      { messages: [{ role: "user", content: "hi" }] },
      { unsupported: ["image"] },
    );
  });

  it("conformance_no_secret_leak_fails_on_known_secret", () => {
    assert.throws(() => assertNoSecretLeak([providerTextDelta("error: sk-fake-123")], ["sk-fake-123"]), /Secret leaked/);
  });

  it("conformance_owned_headers_win_passes_when_provider_keeps_owned_and_preserves_caller", () => {
    const captured = new Headers({
      authorization: "Bearer provider-key",
      "content-type": "application/json",
      "x-caller": "kept",
    });
    assertProviderOwnedHeadersWin(captured, {
      owned: { authorization: "Bearer provider-key", "content-type": "application/json" },
      caller: { authorization: "Bearer attacker", "content-type": "text/plain", "x-caller": "kept" },
    });
  });

  it("conformance_owned_headers_win_fails_when_caller_overrides_owned", () => {
    const captured = new Headers({ authorization: "Bearer attacker" });
    assert.throws(
      () =>
        assertProviderOwnedHeadersWin(captured, {
          owned: { authorization: "Bearer provider-key" },
          caller: { authorization: "Bearer attacker" },
        }),
      /overrode provider-owned/,
    );
  });

  it("conformance_owned_headers_win_fails_when_non_owned_caller_header_is_dropped", () => {
    const captured = new Headers({ authorization: "Bearer provider-key" });
    assert.throws(
      () =>
        assertProviderOwnedHeadersWin(captured, {
          owned: { authorization: "Bearer provider-key" },
          caller: { "x-caller": "kept" },
        }),
      /dropped non-owned caller header/,
    );
  });

  it("conformance_replays_recordings_and_reports_scenario", async () => {
    const hyperSpec = "../../packages/providers/hyper/src/index.js";
    const { createHyperProvider, hyperModels } = (await import(hyperSpec)) as {
      createHyperProvider: (opts: { apiKey: () => Promise<string> }) => ModelProvider;
      hyperModels: readonly { provider: string; model: string }[];
    };
    const result = await providerConformance(() => createHyperProvider({ apiKey: async () => "fake-hyper-key" }), {
      recordings: new URL("../../packages/providers/hyper/src/__tests__/wire/anthropic", import.meta.url),
      models: hyperModels,
    });
    assert.equal(result.ok, true);
    assert.ok(result.scenarios.length >= 5);
    const names = result.scenarios.map((s) => s.name);
    assert.ok(names.includes("text"));
    assert.ok(names.includes("tool-loop"));
    assert.ok(names.includes("thinking"));
    assert.ok(names.includes("cache"));
    assert.ok(names.includes("error"));
  });

  it("conformance_fails_on_usage_rule_break", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "wire-usage-break-"));
    try {
      const recording = {
        method: "POST",
        path: "/v1/messages",
        requestBody: {
          model: "test-model",
          messages: [{ role: "user", content: "hi" }],
        },
        status: 200,
        contentType: "text/event-stream",
        responseBody:
          'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
      };
      writeFileSync(join(tempDir, "bad-usage.json"), JSON.stringify(recording), "utf8");

      const brokenProvider: ModelProvider = {
        id: "broken",
        async *generate() {
          yield {
            type: "usage",
            usage: { inputTokens: 5, cacheReadTokens: 4, cacheWriteTokens: 3, outputTokens: 2, totalTokens: 7 },
          };
          yield {
            type: "done",
            stopReason: "end_turn",
            usage: { inputTokens: 5, cacheReadTokens: 4, cacheWriteTokens: 3, outputTokens: 2, totalTokens: 7 },
          };
        },
      };

      await assert.rejects(
        () =>
          providerConformance(() => brokenProvider, {
            recordings: tempDir,
            models: [{ provider: "broken", model: "test-model" }],
          }),
        /Usage accounting invariant violated.*cacheReadTokens \(4\) \+ cacheWriteTokens \(3\) > inputTokens \(5\)/,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("conformance_fails_on_unsigned_thinking_replay", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "wire-thinking-"));
    try {
      const recording = [
        {
          method: "POST",
          path: "/v1/messages",
          requestBody: {
            model: "test-model",
            messages: [{ role: "user", content: "think" }],
          },
          status: 200,
          contentType: "text/event-stream",
          responseBody:
            'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\nevent: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"thoughts"}}\n\nevent: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
        },
        {
          method: "POST",
          path: "/v1/messages",
          requestBody: {
            model: "test-model",
            messages: [
              { role: "user", content: "think" },
              { role: "assistant", content: [{ type: "thinking", thinking: "thoughts" }] },
              { role: "user", content: "next" },
            ],
          },
          status: 200,
          contentType: "text/event-stream",
          responseBody:
            'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
        },
      ];
      writeFileSync(join(tempDir, "unsigned-thinking.json"), JSON.stringify(recording), "utf8");

      const buggyProvider = (fetchImpl?: typeof fetch): ModelProvider => ({
        id: "buggy",
        async *generate(req) {
          await (fetchImpl ?? fetch)("http://127.0.0.1/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: req.model.model,
              messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "unsigned thought" }] }],
            }),
          });
          yield { type: "done", stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } };
        },
      });

      await assert.rejects(
        () =>
          providerConformance(buggyProvider, {
            recordings: tempDir,
            models: [{ provider: "buggy", model: "test-model" }],
          }),
        /assistant thinking block replayed on wire without signature/,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("scaffolded_provider_package_passes_its_own_tests", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "scaffold-provider-"));
    try {
      const runtime = { stdout: { write() {} }, stderr: { write() {} } } as any;
      const code = await runManifestCommand(["new", "package", "--provider", "@acme/prism-provider-sample", "--dir", tempDir], runtime);
      assert.equal(code, 0);

      assert.ok(existsSync(join(tempDir, "package.json")));
      assert.ok(existsSync(join(tempDir, "src", "index.ts")));
      assert.ok(existsSync(join(tempDir, "src", "models.ts")));
      assert.ok(existsSync(join(tempDir, "src", "provider.ts")));
      assert.ok(existsSync(join(tempDir, "src", "__tests__", "package.test.ts")));
      assert.ok(existsSync(join(tempDir, "src", "__tests__", "live.test.ts")));
      assert.ok(existsSync(join(tempDir, "src", "__tests__", "wire", "README.md")));

      await mkdir(join(tempDir, "node_modules", "@arnilo"), { recursive: true });
      await symlink(resolve("."), join(tempDir, "node_modules", "@arnilo", "prism"), "dir");

      const testResult = spawnSync(process.execPath, ["test"], { cwd: tempDir, encoding: "utf8" });
      assert.equal(testResult.status, 0, `${testResult.stdout}\n${testResult.stderr}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
