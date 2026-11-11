import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type ModelProvider,
  type PackageInput,
  type ProviderRequest,
  type Usage,
  createAgent,
  createMemorySessionStore,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import {
  createInMemoryTelemetry,
  createObservabilityDefinition,
  createOpenTelemetryInstrumentation,
  formatTraceparent,
  injectTraceContext,
  type OpenTelemetryApiModule,
  rawOpenTelemetrySpan,
  TRACE_CONTEXT_HEADERS,
  wrapOpenTelemetryApi,
} from "../index.js";

const CUSTOM_TRACEPARENT = "00-11111111111111111111111111111111-2222222222222222-01";

/**
 * A stand-in for `@opentelemetry/api`: spans go to the in-memory tracer, and `propagation.inject`
 * reads the span out of the context the API set (the wrapped in-memory span), like the W3C propagator
 * reads `traceparent` off a real span. `inject` calls are counted so a test can prove the seam is used.
 */
function fakeApi(memory = createInMemoryTelemetry()) {
  const injected: Record<string, string>[] = [];
  const api: OpenTelemetryApiModule = {
    trace: {
      getTracer: () => ({
        startSpan(name: string, options: { attributes?: Record<string, string | number | boolean>; kind?: number } = {}, parent?: unknown) {
          const span = memory.tracer.startSpan(name, {
            attributes: options.attributes,
            kind: options.kind === 2 ? "client" : "internal",
            parent: parent as never,
          });
          return {
            setAttribute: span.setAttribute.bind(span),
            setStatus: (status: { code: number; message?: string }) => span.setStatus(status.code === 1 ? "ok" : "error", status.message),
            addEvent: span.addEvent?.bind(span),
            spanContext: () => span.spanContext?.(),
            end: span.end.bind(span),
            prism: span,
          };
        },
      }),
      setSpan: (_context, span) => (span as { prism: unknown }).prism,
    },
    metrics: { getMeter: () => memory.meter },
    context: { active: () => undefined },
    propagation: {
      inject(context, carrier) {
        injected.push(carrier);
        const traceparent = formatTraceparent((context as ReturnType<typeof memory.tracer.startSpan>).spanContext?.());
        if (traceparent) carrier.traceparent = traceparent;
        carrier.tracestate = "prism=probe";
      },
    },
  };
  return { api, memory, injected };
}

/** A provider that records what Prism sent and reports the usage a test asks for. */
function recordingProvider(usage: Usage = { inputTokens: 3, outputTokens: 4 }) {
  const requests: ProviderRequest[] = [];
  const provider: ModelProvider = {
    id: "mock",
    async *generate(request) {
      requests.push(request);
      yield providerTextDelta("done");
      yield providerDone(usage);
    },
  };
  return { provider, requests };
}

async function runWith(pkg: PackageInput, provider: ModelProvider) {
  const agent = await createAgent({
    model: { provider: "mock", model: "demo" },
    slots: { store: createMemorySessionStore() },
    packages: [providerPackage("test-provider", [provider]), pkg],
  });
  const session = await agent.session({ id: "s1", create: true });
  const run = await session.run("hello", { limits: { maxToolRounds: 1 } });
  await agent.dispose();
  return run;
}

describe("trace-context propagation", () => {
  it("observability_propagates_traceparent_when_enabled", async () => {
    const { api, memory, injected } = fakeApi();
    const { provider, requests } = recordingProvider();
    const run = await runWith(createObservabilityDefinition(async () => api)({ propagateTraceContext: true }), provider);
    assert.equal(run.status, "completed");

    const headers = requests[0]?.options?.headers ?? {};
    const traceparent = headers.traceparent;
    assert.match(traceparent ?? "", /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    // The first `model.request` fires before the chat span opens, so the run span is the parent.
    assert.equal(traceparent?.split("-")[1], memory.spans[0]?.traceId);
    assert.equal(headers.tracestate, "prism=probe");
    // Only the two trace-context headers are written, through the API's propagator.
    assert.deepEqual(
      Object.keys(headers)
        .filter((name) => /trace/i.test(name))
        .sort(),
      [...TRACE_CONTEXT_HEADERS].sort(),
    );
    assert.equal(injected.length, requests.length);
  });

  it("observability_propagation_is_off_by_default", async () => {
    const { api, injected } = fakeApi();
    const { provider, requests } = recordingProvider();
    await runWith(createObservabilityDefinition(async () => api)({}), provider);
    assert.equal(requests[0]?.options?.headers?.traceparent, undefined);
    assert.equal(injected.length, 0);
  });

  it("observability_does_not_overwrite_caller_traceparent", async () => {
    const request: ProviderRequest = {
      model: { provider: "mock", model: "demo" } as never,
      messages: [],
      options: { headers: { traceparent: CUSTOM_TRACEPARENT } },
    };
    const span = createInMemoryTelemetry().tracer.startSpan("chat demo");
    const { api } = fakeApi();
    assert.equal(injectTraceContext(request, { span, api }), undefined);
    // Nothing to propagate: no span means the request passes through untouched.
    assert.equal(injectTraceContext(request, { span: undefined, api }), undefined);
  });

  it("observability_propagates_without_a_propagator", () => {
    const memory = createInMemoryTelemetry();
    const span = memory.tracer.startSpan("chat demo");
    const api: OpenTelemetryApiModule = {
      trace: { getTracer: () => ({}), setSpan: () => undefined },
      metrics: { getMeter: () => ({}) },
      context: { active: () => undefined },
    };
    const request: ProviderRequest = {
      model: { provider: "mock", model: "demo" } as never,
      messages: [],
      options: { headers: { authorization: "Bearer keep-me" } },
    };
    const next = injectTraceContext(request, { span, api });
    assert.match(next?.options?.headers?.traceparent ?? "", /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    assert.equal(next?.options?.headers?.tracestate, undefined);
    assert.equal(next?.options?.headers?.authorization, "Bearer keep-me");
    // A throwing propagator degrades to the span's own ids instead of failing the run. This span is a
    // real wrapped OpenTelemetry span, so the propagator seam (not the id fallback) is what throws.
    const otelSpan = {
      setAttribute() {},
      setStatus() {},
      spanContext: () => ({ traceId: "33333333333333333333333333333333", spanId: "4444444444444444" }),
      end() {},
    };
    const wrapped = wrapOpenTelemetryApi({ startSpan: () => otelSpan }).tracer.startSpan("chat demo");
    assert.equal(rawOpenTelemetrySpan(wrapped), otelSpan);
    const broken: OpenTelemetryApiModule = {
      ...api,
      propagation: {
        inject() {
          throw new Error("propagator exploded");
        },
      },
    };
    assert.equal(
      injectTraceContext(request, { span: wrapped, api: broken })?.options?.headers?.traceparent,
      "00-33333333333333333333333333333333-4444444444444444-01",
    );
    // A span with unusable ids is never propagated.
    assert.equal(
      injectTraceContext(request, {
        span: { setAttribute() {}, setStatus() {}, end() {}, spanContext: () => ({ traceId: "", spanId: "" }) },
        api,
      }),
      undefined,
    );
  });
});

describe("usage metadata allowlist", () => {
  const usage: Usage = {
    inputTokens: 3,
    outputTokens: 4,
    metadata: { litellm: { callId: "call-123", modelId: "chat-scout", detail: { nested: 1 } }, openrouter: { generationId: "gen-7" } },
  };

  it("observability_usage_metadata_allowlist exports only scalars at allowed paths", async () => {
    const { api, memory } = fakeApi();
    const { provider } = recordingProvider(usage);
    await runWith(
      createObservabilityDefinition(async () => api)({
        content: "metadata",
        usageMetadata: ["litellm.callId", "litellm.modelId", "litellm.detail", "litellm.absent", "openrouter.generationId"],
      }),
      provider,
    );
    const chat = memory.spans.find((span) => span.name === "chat demo");
    assert.ok(chat);
    assert.equal(chat.attributes["prism.usage.litellm.callId"], "call-123");
    assert.equal(chat.attributes["prism.usage.litellm.modelId"], "chat-scout");
    assert.equal(chat.attributes["prism.usage.openrouter.generationId"], "gen-7");
    // An object path and an absent path add nothing.
    assert.equal(chat.attributes["prism.usage.litellm.detail"], undefined);
    assert.equal(chat.attributes["prism.usage.litellm.absent"], undefined);
    // The existing usage attributes are untouched.
    assert.equal(chat.attributes["gen_ai.usage.input_tokens"], 3);
  });

  it("observability_usage_metadata_respects_content_and_fieldPolicy", async () => {
    const off = fakeApi();
    await runWith(
      createObservabilityDefinition(async () => off.api)({ content: "none", usageMetadata: ["litellm.callId"] }),
      recordingProvider(usage).provider,
    );
    const chat = off.memory.spans.find((span) => span.name === "chat demo");
    assert.equal(chat?.attributes["prism.usage.litellm.callId"], undefined);

    const hashed = fakeApi();
    await runWith(
      createObservabilityDefinition(async () => hashed.api)({
        content: "metadata",
        usageMetadata: ["litellm.callId"],
        fieldPolicy: { hash: ["prism.usage.*"] },
      }),
      recordingProvider(usage).provider,
    );
    const tokenized = hashed.memory.spans.find((span) => span.name === "chat demo")?.attributes["prism.usage.litellm.callId"];
    assert.match(String(tokenized), /^tok_[0-9a-f]+/);
    assert.equal(String(tokenized).includes("call-123"), false);
  });

  it("observability_usage_metadata_ignores_overlong_paths", async () => {
    // The schema refuses an overlong path outright, so a host cannot ship one by accident.
    await assert.rejects(
      runWith(
        createObservabilityDefinition(async () => fakeApi().api)({
          content: "metadata",
          usageMetadata: [`litellm.${"x".repeat(130)}`, ""],
        }),
        recordingProvider({ inputTokens: 1, metadata: { litellm: {} } }).provider,
      ),
      /usageMetadata/,
    );

    // The instrumentation option is the second line of defense: a long path is skipped, never exported.
    const memory = createInMemoryTelemetry();
    const instrumentation = createOpenTelemetryInstrumentation({
      tracer: memory.tracer,
      includeUsage: true,
      usageMetadata: [`litellm.${"x".repeat(130)}`, "litellm.callId", "litellm.deep.object"],
    });
    const event = (type: string, extra: Record<string, unknown>) => ({ type, sessionId: "s1", runId: "r1", ...extra }) as never;
    instrumentation.handleAgentEvent(event("run.started", { metadata: {} }));
    instrumentation.handleAgentEvent(
      event("turn.started", { turn: 1, metadata: { providerId: "mock", model: { provider: "mock", model: "demo" } } }),
    );
    instrumentation.handleAgentEvent(
      event("turn.completed", { turn: 1, metadata: { providerId: "mock", attempt: 1, latencyMs: 5 }, usage }),
    );
    const chat = memory.spans.find((span) => span.name === "chat demo");
    assert.ok(chat);
    assert.equal(chat.attributes["prism.usage.litellm.callId"], "call-123");
    assert.equal(chat.attributes["prism.usage.litellm.deep.object"], undefined);
    assert.equal(Object.keys(chat.attributes).filter((name) => name.includes("xxxx")).length, 0);
  });

  it("observability_handles_usage_without_metadata", async () => {
    const { api, memory } = fakeApi();
    await runWith(
      createObservabilityDefinition(async () => api)({ content: "metadata", usageMetadata: ["litellm.callId"] }),
      recordingProvider({ inputTokens: 1 }).provider,
    );
    const chat = memory.spans.find((span) => span.name === "chat demo");
    assert.equal(chat?.attributes["prism.usage.litellm.callId"], undefined);
    assert.equal(chat?.attributes["gen_ai.usage.input_tokens"], 1);
  });
});
