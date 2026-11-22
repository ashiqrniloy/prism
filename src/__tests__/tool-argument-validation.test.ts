/**
 * Plan 226 Task 2: a call whose arguments do not satisfy the tool's `parameters` is blocked before
 * the tool runs (evaluation probe `p3-validate`: `{ path: 123, bogus: true }` against a schema that
 * requires a string and forbids extra keys ran the tool).
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  createAgent,
  createMemorySessionStore,
  dispatchToolCall,
  type AgentEvent,
  type ErrorInfo,
  type JsonObject,
  type LoopStrategy,
  type SessionEntry,
  type ToolCallContent,
  type ToolDefinition,
  type ToolValidator,
} from "../index.js";
import { compileToolSchema } from "../packages/schema.js";
import { providerPackage } from "../provider-kit/index.js";
import { twoTurnProvider } from "../testing/index.js";

const PROBE_SCHEMA = {
  type: "object",
  properties: { path: { type: "string" }, count: { type: "integer", minimum: 1 } },
  required: ["path"],
  additionalProperties: false,
} as JsonObject;

interface Probe {
  readonly tool: ToolDefinition;
  readonly executed: JsonObject[];
}

function probeTool(parameters: JsonObject | undefined, extra: Partial<ToolDefinition> = {}): Probe {
  const executed: JsonObject[] = [];
  const tool: ToolDefinition = {
    name: "probe",
    ...(parameters ? { parameters } : {}),
    execute(args, context) {
      executed.push(args);
      return { toolCallId: context.toolCallId, name: "probe", value: "ok" };
    },
    ...extra,
  };
  return { tool, executed };
}

async function dispatch(
  tool: ToolDefinition,
  args: unknown,
  options: { readonly validate?: ToolValidator; readonly validation?: "schema" | "off" } = {},
): Promise<{ readonly events: AgentEvent[]; readonly error?: ErrorInfo }> {
  const events: AgentEvent[] = [];
  const call: ToolCallContent = { type: "tool_call", id: "call-1", name: tool.name, arguments: args as JsonObject };
  const result = await dispatchToolCall({
    call,
    registry: { register() {}, get: (name) => (name === tool.name ? tool : undefined), resolve: () => tool, list: () => [tool] },
    context: { sessionId: "s", runId: "r", toolCallId: "call-1" },
    emit: (event) => {
      events.push(event);
    },
    ...options,
  });
  return { events, error: result.error };
}

function blockedReason(events: readonly AgentEvent[]): string | undefined {
  const done = events.find((event) => event.type === "tool.completed");
  return done?.type === "tool.completed" && done.status === "blocked" ? done.reason : undefined;
}

describe("tool argument validation", () => {
  it("schema_invalid_arguments_block_the_call", async () => {
    const { tool, executed } = probeTool(PROBE_SCHEMA);
    const { events, error } = await dispatch(tool, { path: 123, bogus: true });
    assert.equal(executed.length, 0);
    assert.equal(blockedReason(events), "invalid_arguments");
    assert.equal(error?.code, "invalid_arguments");
    assert.match(error?.message ?? "", /\/path: must be of type string/);
    assert.match(error?.message ?? "", /\/bogus: is not allowed/);
    assert.equal(
      events.some((event) => event.type === "tool.started"),
      false,
    );
  });

  it("a valid call still runs", async () => {
    const { tool, executed } = probeTool(PROBE_SCHEMA);
    const { error } = await dispatch(tool, { path: "a", count: 2 });
    assert.equal(error, undefined);
    assert.equal(executed.length, 1);
  });

  it("caps the report at 8 paths and 1 KiB", async () => {
    const properties = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`k${index}`, { type: "string" }]));
    const { tool } = probeTool({ type: "object", properties } as JsonObject);
    const args = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`k${index}`, index]));
    const { error } = await dispatch(tool, args);
    assert.equal(error?.message.split("; ").length, 8);
    assert.ok((error?.message.length ?? 0) <= 1024);
  });

  it("validation_reports_paths_not_values", async () => {
    const { tool } = probeTool(PROBE_SCHEMA);
    const secret = "sk-live-SUPERSECRET-0123456789";
    const { events, error } = await dispatch(tool, { path: secret, count: secret, bogus: secret });
    assert.ok(error);
    assert.match(error?.message ?? "", /\/count: must be of type integer/);
    const reported = JSON.stringify({
      error,
      events: events.map((event) => (event.type === "tool.completed" ? { error: event.error, result: event.result } : event.type)),
    });
    assert.equal(reported.includes("SUPERSECRET"), false);
  });

  it("tool_without_parameters_accepts_any_object", async () => {
    const { tool, executed } = probeTool(undefined);
    const { error } = await dispatch(tool, { anything: [1, { nested: true }] });
    assert.equal(error, undefined);
    assert.equal(executed.length, 1);
  });

  it("unsupported_keyword_is_ignored_and_noted", async () => {
    const schema = {
      type: "object",
      $ref: "#/definitions/x",
      format: "uri",
      required: ["id"],
      properties: { id: { type: "string" } },
    } as JsonObject;
    const compiled = compileToolSchema(schema);
    assert.deepEqual(compiled.skipped, ['keyword "format" is not supported']);
    assert.equal(compiled.validate({}).length, 1);

    const { tool, executed } = probeTool(schema);
    const { error } = await dispatch(tool, {});
    assert.equal(error?.code, "invalid_arguments");
    assert.equal(executed.length, 0);

    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      tools: { add: [tool] },
      slots: { store: createMemorySessionStore() },
    });
    const notes = agent.inspect().statusNotes;
    const note = notes.find((entry) => entry.message.includes("probe"));
    assert.equal(note?.level, "info");
    assert.equal(note?.package, "kernel");
    assert.match(note?.message ?? "", /format/);
  });

  it("a schema the subset understands emits no note", async () => {
    const { tool } = probeTool(PROBE_SCHEMA);
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      tools: { add: [tool] },
      slots: { store: createMemorySessionStore() },
    });
    assert.equal(agent.inspect().statusNotes.filter((entry) => entry.message.includes("probe")).length, 0);
  });

  it("mcp_style_schema_is_tolerated", async () => {
    const mcp = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        name: { type: ["string", "null"] },
        url: { type: "string", format: "uri", "x-mcp-header": 123 },
        n: { type: "integer", minItems: -1, minimum: 0 },
        tag: { type: "string", pattern: "(" },
      },
      required: ["url"],
      additionalProperties: false,
    } as JsonObject;
    const compiled = compileToolSchema(mcp);
    assert.ok(compiled.skipped.length > 0);
    // Unreadable subschemas accept anything; the readable parts still reject.
    assert.deepEqual(compiled.validate({ url: "https://x", name: 5, tag: 9, n: "five" }), []);
    const errors = compiled.validate({ nope: 1 });
    assert.deepEqual(errors.map((error) => error.path).sort(), ["/nope", "/url"]);

    for (const junk of [undefined, null, "string", 7, [], { value: "long" }, { a: 1, b: 2 }]) {
      assert.deepEqual(compileToolSchema(junk).validate({ any: "thing" }), []);
    }
  });

  it("validation_does_not_rewrite_arguments", async () => {
    const { tool, executed } = probeTool({
      type: "object",
      properties: { mode: { type: "string", default: "fast" } },
    } as JsonObject);
    const args = { other: 1 };
    const { error } = await dispatch(tool, args);
    assert.equal(error, undefined);
    assert.equal(executed[0], args);
    assert.deepEqual(executed[0], { other: 1 });
  });

  it("additionalProperties absent means allowed", async () => {
    const { tool, executed } = probeTool({ type: "object", properties: { a: { type: "string" } } } as JsonObject);
    const { error } = await dispatch(tool, { a: "x", extra: 1 });
    assert.equal(error, undefined);
    assert.equal(executed.length, 1);
  });

  it("x-prism-secret is ignored for tool arguments", async () => {
    const { tool } = probeTool({ type: "object", properties: { token: { type: "string", "x-prism-secret": true } } } as JsonObject);
    const { error } = await dispatch(tool, { token: "literal-value" });
    assert.equal(error, undefined);
  });

  it("validation_off_restores_previous_behavior", async () => {
    const { tool, executed } = probeTool(PROBE_SCHEMA);
    const { error } = await dispatch(tool, { path: 123, bogus: true }, { validation: "off" });
    assert.equal(error, undefined);
    assert.equal(executed.length, 1);
  });

  it("tool_can_opt_out", async () => {
    const { tool, executed } = probeTool(PROBE_SCHEMA, { validateArguments: false });
    const { error } = await dispatch(tool, { path: 123 });
    assert.equal(error, undefined);
    assert.equal(executed.length, 1);
  });

  it("host_validator_runs_after_the_builtin_check", async () => {
    const { tool, executed } = probeTool(PROBE_SCHEMA);
    let calls = 0;
    const validate: ToolValidator = () => {
      calls += 1;
      return "host says no";
    };
    const invalid = await dispatch(tool, { path: 1 }, { validate });
    assert.equal(blockedReason(invalid.events), "invalid_arguments");
    assert.equal(calls, 0);
    const valid = await dispatch(tool, { path: "a" }, { validate });
    assert.equal(blockedReason(valid.events), "validation_failed");
    assert.equal(calls, 1);
    assert.equal(executed.length, 0);
  });

  it("a non-object argument value carries the invalid_arguments code", async () => {
    const { tool } = probeTool(PROBE_SCHEMA);
    const { error } = await dispatch(tool, "text");
    assert.equal(error?.code, "invalid_arguments");
  });

  it("validates a large argument object quickly", () => {
    const compiled = compileToolSchema({
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "object", properties: { id: { type: "integer" }, text: { type: "string" } }, required: ["id"] },
        },
      },
    });
    const items = Array.from({ length: 5000 }, (_, id) => ({ id, text: "x".repeat(40) }));
    const args = { items };
    assert.ok(JSON.stringify(args).length > 256 * 1024);
    const started = performance.now();
    assert.deepEqual(compiled.validate(args), []);
    assert.ok(performance.now() - started < 50, "256 KiB validates well under the budget");
  });

  it("custom_loop_gets_the_same_validation", async () => {
    const { tool, executed } = probeTool(PROBE_SCHEMA);
    const loop: LoopStrategy = {
      name: "plan-then-act",
      revision: "1",
      async run(run) {
        for (;;) {
          for (;;) {
            const turn = await run.turn();
            if (turn.stopped) return;
            if (turn.toolCalls.length === 0) {
              if (turn.steered) continue;
              break;
            }
            await run.executeTools(turn.toolCalls);
          }
          const end = await run.end();
          if (!end.continue) return;
        }
      },
    };
    const provider = twoTurnProvider({ id: "call-1", name: "probe", args: { path: 123, bogus: true } });
    const agent = await createAgent({
      model: { provider: provider.id, model: "demo" },
      packages: [providerPackage("validation-provider", [provider])],
      tools: { add: [tool] },
      slots: { store: createMemorySessionStore(), loop },
    });
    const session = await agent.session({ id: "validation", create: true });
    await session.run("go");
    const entries: readonly SessionEntry[] = await session.entries();
    const errors = entries.flatMap((entry) =>
      entry.kind === "message" && entry.message
        ? entry.message.content.flatMap((block) => (block.type === "tool_result" && block.error ? [block.error] : []))
        : [],
    );
    await session.close();
    assert.equal(executed.length, 0);
    assert.equal(errors[0]?.code, "invalid_arguments");
  });

  it("agent tools.validation off lets the call through", async () => {
    const { tool, executed } = probeTool(PROBE_SCHEMA);
    const provider = twoTurnProvider({ id: "call-1", name: "probe", args: { path: 123 } });
    const agent = await createAgent({
      model: { provider: provider.id, model: "demo" },
      packages: [providerPackage("validation-off-provider", [provider])],
      tools: { add: [tool], validation: "off" },
      slots: { store: createMemorySessionStore() },
    });
    const session = await agent.session({ id: "validation-off", create: true });
    await session.run("go");
    await session.close();
    assert.equal(executed.length, 1);
  });
});
