import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type AgentEvent,
  createAgent,
  type LoopStrategy,
  type ModelConfig,
  type ProviderRequest,
  type ProviderRequestOptions,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type Skill,
  toolCallContent,
} from "../index.js";
import {
  assertStructuredOutputRequestSupported,
  modelSupportsStructuredOutput,
  parseStructuredOutput,
  resolveRunProviderOptions,
  resolveStructuredOutputRun,
  StructuredOutputError,
  structuredOutputInstruction,
  validateStructuredOutputOptions,
} from "../provider-kit/structured-output.js";
import { assertStructuredOutputRepair, echoTool, mockProvider } from "../testing/index.js";
import { runPrefixStabilityConformance } from "../testing/prefix-stability-conformance.js";

const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };

describe("structured output", () => {
  it("validates schema size and prototype-pollution keys", () => {
    assert.throws(
      () => validateStructuredOutputOptions({ name: "answer", schema: { type: "object", constructor: "evil" } }),
      (error: Error) => error instanceof StructuredOutputError && error.code === "invalid_schema",
    );
    const large = "x".repeat(70_000);
    assert.throws(
      () => validateStructuredOutputOptions({ name: "answer", schema: { blob: large } }),
      (error: Error) => error instanceof StructuredOutputError && error.code === "schema_too_large",
    );
  });

  it("rejects unsupported models before provider fetch", () => {
    assert.throws(
      () =>
        assertStructuredOutputRequestSupported(
          { provider: "demo", model: "plain", capabilities: { output: ["text"] } },
          { structuredOutput: { name: "answer", schema } },
        ),
      (error: Error) => error instanceof StructuredOutputError && error.code === "unsupported_model",
    );
    assert.ok(modelSupportsStructuredOutput({ structuredOutput: "json_schema" }));
  });

  it("merges agent and run provider options", () => {
    const merged = resolveRunProviderOptions(
      { providerOptions: { structuredOutput: { name: "answer", schema, strict: true } } },
      { providerOptions: { sessionId: "s1" } },
    );
    assert.deepEqual(merged?.structuredOutput, { name: "answer", schema, strict: true });
    assert.equal(merged?.sessionId, "s1");
  });

  it("unsupported_model_message_names_no_missing_option", () => {
    try {
      assertStructuredOutputRequestSupported({ provider: "demo", model: "plain" }, { structuredOutput: { name: "answer", schema } });
      assert.fail("expected unsupported_model");
    } catch (error) {
      assert.ok(error instanceof StructuredOutputError && error.code === "unsupported_model");
      assert.doesNotMatch(error.message, /structuredOutputMode|artifact-loop/);
      assert.match(error.message, /does not declare the structuredOutput capability/);
    }
  });
});

const CAPABLE = { provider: "mock", model: "json", capabilities: { structuredOutput: "json_schema" as const } };
const STRUCTURED: ProviderRequestOptions = { structuredOutput: { name: "answer", schema } };

async function runWith(reply: string, providerOptions?: ProviderRequestOptions) {
  const agent = await createAgent({ model: CAPABLE, packages: [mockProvider([[providerTextDelta(reply), providerDone()]])] });
  const session = await agent.session({ id: "s", create: true });
  const events: AgentEvent[] = [];
  for await (const event of session.stream("go", providerOptions ? { providerOptions } : {})) events.push(event);
  const completed = events.find((event) => event.type === "run.completed") as Extract<AgentEvent, { type: "run.completed" }>;
  const result = await session.run("again", providerOptions ? { providerOptions } : {});
  return { result, completed };
}

describe("RunResult.output", () => {
  it("valid_reply_sets_output", async () => {
    const { result, completed } = await runWith('{"title":"hi"}', STRUCTURED);
    assert.equal(result.status, "completed");
    assert.deepEqual(result.output, { title: "hi" });
    assert.equal(result.outputError, undefined);
    assert.equal(result.text, '{"title":"hi"}');
    assert.deepEqual(completed.output, { title: "hi" });
    assert.equal(completed.outputError, undefined);
  });

  it("fenced_json_reply_is_parsed", async () => {
    const { result } = await runWith('```json\n{"title":"fenced"}\n```', STRUCTURED);
    assert.deepEqual(result.output, { title: "fenced" });
    assert.deepEqual(parseStructuredOutput('  ```\n{"title":"x"}```  ', { name: "a", schema }), { output: { title: "x" } });
  });

  it("schema_mismatch_sets_output_error_with_paths", async () => {
    const { result, completed } = await runWith('{"title":42}', STRUCTURED);
    assert.equal(result.status, "completed", "an invalid reply does not change the status");
    assert.equal(result.output, undefined);
    assert.equal(result.outputError?.code, "schema_mismatch");
    assert.deepEqual(
      result.outputError?.errors.map((error) => error.path),
      ["/title"],
    );
    assert.deepEqual(completed.outputError, result.outputError);
    const many = { type: "object", required: Array.from({ length: 12 }, (_, i) => `k${i}`) };
    const capped = parseStructuredOutput("{}", { name: "a", schema: many });
    assert.ok("outputError" in capped && capped.outputError.errors.length === 8);
  });

  it("unparsable_reply_sets_invalid_json", async () => {
    const { result } = await runWith("Sure! here is the answer: {title", STRUCTURED);
    assert.equal(result.output, undefined);
    assert.equal(result.outputError?.code, "invalid_json");
    assert.equal(result.outputError?.errors.length, 1);
  });

  it("run_without_structured_output_has_neither_field", async () => {
    const { result, completed } = await runWith('{"title":"hi"}');
    assert.equal("output" in result, false);
    assert.equal("outputError" in result, false);
    assert.equal("output" in completed, false);
    assert.equal("outputError" in completed, false);
  });

  it("output_error_contains_no_reply_content", async () => {
    const marker = "LEAKMARKER";
    const bad = await runWith(`{"title":"x","${marker}":1, ${marker}`, STRUCTURED);
    assert.equal(JSON.stringify(bad.result.outputError).includes(marker), false);
    const strict = { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false };
    const mismatch = parseStructuredOutput(`{"title":"${marker}","${marker}x":"${marker}"}`, { name: "a", schema: strict });
    assert.ok("outputError" in mismatch);
    assert.equal(mismatch.outputError.code, "schema_mismatch");
    const typed = parseStructuredOutput(`{"title":["${marker}"]}`, { name: "a", schema });
    assert.ok("outputError" in typed);
    assert.equal(JSON.stringify(typed.outputError).includes(marker), false);
  });
});

const PLAIN: ModelConfig = { provider: "mock", model: "plain", capabilities: { tools: true } };

/** One session run on a scripted mock provider; returns the result and every captured request. */
async function scripted(
  replies: readonly string[],
  structuredOutput: NonNullable<ProviderRequestOptions["structuredOutput"]>,
  options: { readonly model?: ModelConfig; readonly loop?: LoopStrategy; readonly limits?: { readonly maxContinuations?: number } } = {},
) {
  const requests: ProviderRequest[] = [];
  const agent = await createAgent({
    model: options.model ?? PLAIN,
    packages: [
      mockProvider(
        replies.map((reply) => [providerTextDelta(reply), providerDone()]),
        { onRequest: (r) => requests.push(r) },
      ),
    ],
    ...(options.loop ? { slots: { loop: options.loop } } : {}),
    ...(options.limits ? { limits: options.limits } : {}),
  });
  const session = await agent.session({ id: "s", create: true });
  const result = await session.run("go", { providerOptions: { structuredOutput } });
  const messages = await session.messages();
  await agent.dispose();
  return { result, requests, messages };
}

function promptedBlocks(request: ProviderRequest): string[] {
  return request.messages
    .filter((message) => message.role === "system")
    .flatMap((message) => message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])))
    .filter((text) => text.includes('Structured output "answer"'));
}

describe("structured output modes and repair", () => {
  it("auto_uses_native_for_a_capable_model_and_prompted_otherwise", async () => {
    const native = await scripted(['{"title":"n"}'], { name: "answer", schema }, { model: CAPABLE });
    assert.deepEqual(native.requests[0]?.options?.structuredOutput, { name: "answer", schema });
    assert.equal(promptedBlocks(native.requests[0]!).length, 0);
    assert.deepEqual(native.result.output, { title: "n" });

    const prompted = await scripted(['{"title":"p"}'], { name: "answer", schema });
    assert.equal(prompted.requests[0]?.options?.structuredOutput, undefined, "prompted mode sends no native option");
    assert.deepEqual(promptedBlocks(prompted.requests[0]!).length, 1);
    assert.ok(promptedBlocks(prompted.requests[0]!)[0]!.includes(structuredOutputInstruction({ name: "answer", schema })));
    assert.deepEqual(prompted.result.output, { title: "p" }, "the result is validated in prompted mode too");

    const forced = await scripted(['{"title":"f"}'], { name: "answer", schema, mode: "prompted" }, { model: CAPABLE });
    assert.equal(forced.requests[0]?.options?.structuredOutput, undefined);
    assert.equal(promptedBlocks(forced.requests[0]!).length, 1);
    assert.deepEqual(resolveStructuredOutputRun(CAPABLE, { structuredOutput: { name: "a", schema } }).mode, "native");
    assert.deepEqual(resolveStructuredOutputRun(PLAIN, { structuredOutput: { name: "a", schema } }).mode, "prompted");
  });

  it("explicit_native_on_incapable_model_fails_closed_naming_mode", async () => {
    let calls = 0;
    const agent = await createAgent({
      model: PLAIN,
      packages: [mockProvider([[providerTextDelta("x"), providerDone()]], { onRequest: () => calls++ })],
    });
    const session = await agent.session({ id: "s", create: true });
    let caught: unknown;
    try {
      const result = await session.run("go", { providerOptions: { structuredOutput: { name: "answer", schema, mode: "native" } } });
      caught = result.error;
    } catch (error) {
      caught = error;
    }
    await agent.dispose();
    assert.equal(calls, 0, "no provider call");
    assert.match(String((caught as { message?: string })?.message), /does not declare the structuredOutput capability/);
    assert.match(String((caught as { message?: string })?.message), /mode/);
    assert.match(String((caught as { message?: string })?.message), /"prompted"/);
    assert.throws(
      () => validateStructuredOutputOptions({ name: "a", schema, repair: 4 }),
      (error: Error) => error instanceof StructuredOutputError && error.code === "invalid_option",
    );
    assert.throws(
      () => validateStructuredOutputOptions({ name: "a", schema, mode: "bogus" as "auto" }),
      (error: Error) => error instanceof StructuredOutputError && error.code === "invalid_option",
    );
  });

  it("prompted_block_is_byte_identical_across_turns", async () => {
    const requests: ProviderRequest[] = [];
    const agent = await createAgent({
      model: PLAIN,
      tools: { add: [echoTool()] },
      packages: [
        mockProvider(
          [
            [providerToolCall(toolCallContent("c1", "echo", {})), providerDone()],
            [providerToolCall(toolCallContent("c2", "echo", {})), providerDone()],
            [providerTextDelta('{"title":"t"}'), providerDone()],
          ],
          { onRequest: (r) => requests.push(r) },
        ),
      ],
    });
    const session = await agent.session({ id: "s", create: true });
    const result = await session.run("go", { providerOptions: { structuredOutput: { name: "answer", schema } } });
    await agent.dispose();
    assert.equal(requests.length, 3, JSON.stringify(result.error));
    const first = promptedBlocks(requests[0]!);
    assert.equal(first.length, 1);
    for (const request of requests) assert.deepEqual(promptedBlocks(request), first);
    const index = requests[0]!.messages.findIndex((message) => promptedBlocks({ ...requests[0]!, messages: [message] }).length > 0);
    assert.ok(
      requests[0]!.messages.slice(0, index + 1).every((message) => message.role === "system"),
      "the block sits in the stable prefix",
    );
    assert.deepEqual(result.output, { title: "t" });

    const skill = (name: string): Skill => ({ name, description: `${name} entry`, instructions: `${name} body.` });
    const conformance = await runPrefixStabilityConformance({
      host: {
        model: { provider: "mock", model: "demo", capabilities: { tools: true } },
        instructions: `Stable rules. ${"Keep the prefix byte-stable. ".repeat(60)}`,
        providerOptions: { structuredOutput: { name: "answer", schema, mode: "prompted", repair: 0 } },
      },
      skills: [skill("alpha"), skill("beta")],
    });
    assert.deepEqual(conformance.resets, []);
  });

  it("invalid_reply_is_repaired_once_by_default", async () => {
    const run = await scripted(["not json", '{"title":"fixed"}'], { name: "answer", schema });
    assert.equal(run.requests.length, 2);
    assert.equal(run.result.status, "completed");
    assert.deepEqual(run.result.output, { title: "fixed" });
    assert.equal(run.result.outputError, undefined);
    const repair = run.messages.filter((message) => message.role === "user").at(-1);
    const text = repair?.content.map((block) => (block.type === "text" ? block.text : "")).join("") ?? "";
    assert.match(text, /was not valid JSON/);
  });

  it("repair_zero_never_continues", async () => {
    const run = await scripted(["not json", '{"title":"fixed"}'], { name: "answer", schema, repair: 0 });
    assert.equal(run.requests.length, 1);
    assert.equal(run.result.outputError?.code, "invalid_json");
  });

  it("repair_is_bounded_and_ends_with_output_error", async () => {
    const run = await scripted(['{"title":1}'], { name: "answer", schema, repair: 2 });
    assert.equal(run.requests.length, 3, "one reply plus two repairs");
    assert.equal(run.result.status, "completed");
    assert.equal(run.result.outputError?.code, "schema_mismatch");
    assert.equal(run.result.output, undefined);
  });

  it("repair_message_carries_no_reply_content", async () => {
    const marker = "LEAKMARKER";
    const run = await scripted([`{"title":["${marker}"],"${marker}":1}`, '{"title":"ok"}'], { name: "answer", schema });
    const users = run.messages.filter((message) => message.role === "user");
    const repair = users
      .at(-1)!
      .content.map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    assert.match(repair, /\/title/);
    assert.equal(repair.includes(marker), false);
    assert.deepEqual(run.result.output, { title: "ok" });
  });

  it("repair_fires_on_a_custom_loop_through_run_end", async () => {
    const custom: LoopStrategy = {
      name: "turn-then-end",
      async run(run) {
        for (;;) {
          const turn = await run.turn();
          if (turn.stopped) return;
          if (!(await run.end()).continue) return;
        }
      },
    };
    await assertStructuredOutputRepair(custom);
    const run = await scripted(["nope", '{"title":"c"}'], { name: "answer", schema }, { loop: custom });
    assert.equal(run.requests.length, 2);
    assert.deepEqual(run.result.output, { title: "c" });
  });

  it("repairs_do_not_consume_max_continuations", async () => {
    const run = await scripted(["nope", '{"title":"m"}'], { name: "answer", schema }, { limits: { maxContinuations: 0 } });
    assert.equal(run.requests.length, 2);
    assert.equal(run.result.status, "completed", "no hook_limit stop");
    assert.equal(run.result.stopReason, undefined);
    assert.deepEqual(run.result.output, { title: "m" });
  });
});
