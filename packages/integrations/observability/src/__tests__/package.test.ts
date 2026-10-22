import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "bun:test";
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  type LoopStrategy,
  type PackageInput,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { packageConformance } from "@arnilo/prism/testing";
import observability, { createInMemoryTelemetry, createObservabilityDefinition, type OpenTelemetryApiModule } from "../index.js";

const SECRET = "sk-live-0123456789abcdef";

/** A stand-in for `@opentelemetry/api` that records into the in-memory telemetry. */
function fakeApi(memory = createInMemoryTelemetry(), tracerOverride?: unknown): { api: OpenTelemetryApiModule; memory: typeof memory } {
  const toStatus = (code: number) => (code === 1 ? "ok" : "error");
  const api: OpenTelemetryApiModule = {
    trace: {
      getTracer: () =>
        tracerOverride ?? {
          startSpan(name: string, options: { attributes?: Record<string, never>; kind?: number } = {}, parent?: unknown) {
            const span = memory.tracer.startSpan(name, {
              attributes: options.attributes,
              kind: options.kind === 2 ? "client" : "internal",
              parent: parent as never,
            });
            return {
              setAttribute: span.setAttribute.bind(span),
              setStatus: (status: { code: number; message?: string }) => span.setStatus(toStatus(status.code), status.message),
              addEvent: span.addEvent?.bind(span),
              spanContext: () => span.spanContext?.(),
              end: span.end.bind(span),
              prism: span,
            };
          },
        },
      setSpan: (_context, span) => (span as { prism: unknown }).prism,
    },
    metrics: { getMeter: () => memory.meter },
    context: { active: () => undefined },
  };
  return { api, memory };
}

function provider(text = "done", withTool = false): ModelProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (withTool && turn === 1) yield providerToolCall(toolCallContent("call_1", "echo", { text: SECRET }));
      else yield providerTextDelta(text);
      yield providerDone({ inputTokens: 3, outputTokens: 4 });
    },
  };
}

const echoTool = {
  name: "echo",
  execute(_args: unknown, ctx: { toolCallId: string }) {
    return { toolCallId: ctx.toolCallId, name: "echo" };
  },
};

async function runWith(
  pkg: PackageInput,
  options: { loop?: LoopStrategy; prompt?: string; tool?: boolean } = {},
) {
  const events: AgentEvent[] = [];
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    slots: { store: createMemorySessionStore(), ...(options.loop ? { loop: options.loop } : {}) },
    packages: [providerPackage("test-provider", [provider("done", options.tool)]), pkg],
    ...(options.tool ? { tools: { add: [echoTool as never] } } : {}),
  });
  const session = await agent.session({ id: "s1", create: true });
  const sub = session.subscribe();
  const collect = (async () => {
    for await (const event of sub) events.push(event);
  })();
  const run = await session.run(options.prompt ?? "hello", { limits: { maxToolRounds: 2 } });
  await agent.dispose();
  await collect;
  return { agent, run, events };
}

describe("observability package", () => {
  it("observability_package_conformance", async () => {
    const result = await packageConformance(observability);
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  }, 60_000);

  it("observability_spans_for_run_turn_tool", async () => {
    const { api, memory } = fakeApi();
    const { run } = await runWith(createObservabilityDefinition(async () => api)({}), { tool: true });
    assert.equal(run.status, "completed");
    const root = memory.spans.find((span) => span.name === "invoke_agent prism");
    const chats = memory.spans.filter((span) => span.name === "chat demo");
    const tool = memory.spans.find((span) => span.name === "execute_tool echo");
    assert.ok(root && tool);
    assert.equal(chats.length, 2);
    for (const span of [...chats, tool]) {
      assert.equal(span.parentSpanId, root.spanId);
      assert.equal(span.ended, true);
      assert.equal(span.status?.code, "ok");
    }
    assert.equal(root.ended, true);
  });

  it("observability_no_api_is_status_note", async () => {
    const pkg = createObservabilityDefinition(async () => {
      throw new Error("Cannot find module '@opentelemetry/api'");
    })({});
    const { run, agent } = await runWith(pkg);
    assert.equal(run.status, "completed");
    const info = JSON.stringify(agent.inspect());
    assert.match(info, /@opentelemetry\/api is not installed/);
  });

  it("observability_no_phone_home", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
    const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));
    assert.ok(files.length >= 3);
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      assert.doesNotMatch(source, /from "node:(net|http|https|http2|tls|dgram|dns)"/, file);
      assert.doesNotMatch(source, /\bfetch\(|process\.env|OTEL_|OTLP|BatchSpanProcessor|Exporter\(/, file);
    }
    const manifest = JSON.parse(readFileSync(join(dir, "..", "package.json"), "utf8"));
    assert.deepEqual(Object.keys(manifest.dependencies ?? {}), []);
    assert.ok(!Object.keys(manifest.peerDependencies).some((name) => name.includes("sdk") || name.includes("exporter")));
  });

  it("observability_content_none_omits_text", async () => {
    const { api, memory } = fakeApi();
    await runWith(createObservabilityDefinition(async () => api)({ content: "none" }));
    const chat = memory.spans.find((span) => span.name === "chat demo");
    assert.ok(chat);
    assert.equal(chat.attributes["gen_ai.usage.input_tokens"], undefined);
    const metadata = fakeApi();
    await runWith(createObservabilityDefinition(async () => metadata.api)({ content: "metadata" }));
    const withUsage = metadata.memory.spans.find((span) => span.name === "chat demo");
    assert.equal(withUsage?.attributes["gen_ai.usage.input_tokens"], 3);
    assert.equal(withUsage?.attributes["gen_ai.usage.output_tokens"], 4);
  });

  it("observability_secret_never_in_span", async () => {
    for (const content of ["none", "metadata"] as const) {
      const { api, memory } = fakeApi();
      await runWith(createObservabilityDefinition(async () => api)({ content }), { prompt: `my key is ${SECRET}`, tool: true });
      assert.ok(memory.spans.length >= 3);
      const dump = JSON.stringify([memory.spans, memory.metrics]);
      assert.equal(dump.includes(SECRET), false, content);
    }
  });

  it("observability_field_policy_drops_and_hashes", async () => {
    const { api, memory } = fakeApi();
    await runWith(createObservabilityDefinition(async () => api)({ fieldPolicy: { drop: ["prism.session_id"], hash: ["gen_ai.tool.*"] } }), { tool: true });
    const tool = memory.spans.find((span) => span.name === "execute_tool echo");
    assert.equal(tool?.attributes["gen_ai.tool.name"]?.toString().startsWith("tok_"), true);
  });

  it("observability_handler_throw_never_fails_run", async () => {
    const throwing = {
      startSpan() {
        throw new Error("exporter down");
      },
    };
    const { api } = fakeApi(undefined, throwing);
    const { run } = await runWith(createObservabilityDefinition(async () => api)({}), { tool: true });
    assert.equal(run.status, "completed");
  });

  it("observability_not_loaded_unless_listed", async () => {
    let loads = 0;
    const pkg = createObservabilityDefinition(async () => {
      loads += 1;
      return fakeApi().api;
    });
    const agent = await createAgent({
      model: { provider: "mock", model: "demo" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackage("test-provider", [provider()])],
    });
    await (await agent.session({ id: "s", create: true })).run("hi");
    await agent.dispose();
    assert.equal(loads, 0);
    await runWith(pkg({}));
    assert.equal(loads, 1);
  });

  it("observability_disabled_registers_nothing", async () => {
    const { api, memory } = fakeApi();
    await runWith(createObservabilityDefinition(async () => api)({ enabled: false }));
    assert.equal(memory.spans.length, 0);
  });

  it("observability_from_custom_loop", async () => {
    const { api, memory } = fakeApi();
    const loop: LoopStrategy = {
      name: "custom-loop",
      async run(run) {
        await run.turn();
      },
    };
    const { run } = await runWith(createObservabilityDefinition(async () => api)({}), { loop });
    assert.equal(run.status, "completed");
    assert.ok(memory.spans.some((span) => span.name === "invoke_agent prism"));
    assert.ok(memory.spans.some((span) => span.name === "chat demo"));
  });
});
