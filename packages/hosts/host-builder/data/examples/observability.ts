/**
 * Observability Demo (plan 160 Task 3).
 *
 * The host owns OpenTelemetry: it registers a tracer provider (here an in-memory recorder standing in for
 * an SDK + exporter) through `@opentelemetry/api`. `@arnilo/prism-observability` only reads the global
 * tracer and meter, so it sends nothing anywhere itself.
 *
 * Runs a two-turn mock run with one tool call and prints the span tree:
 * invoke_agent > chat > execute_tool.
 *
 * Run: bun examples/observability.ts
 */
import { trace } from "@opentelemetry/api";
import {
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import observability from "@arnilo/prism-observability";
import { providerPackage } from "@arnilo/prism/provider-kit";

interface Recorded {
  readonly name: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
}

/** Host code: a minimal global tracer provider that records spans (a real host registers its SDK here). */
function registerRecorder(): Recorded[] {
  const recorded: Recorded[] = [];
  let next = 0;
  const tracer = {
    startSpan(name: string, _options?: unknown, parentContext?: unknown) {
      const parent = parentContext ? trace.getSpan(parentContext as never)?.spanContext().spanId : undefined;
      const spanContext = {
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: (++next).toString(16).padStart(16, "0"),
        traceFlags: 1,
      };
      recorded.push({ name, spanId: spanContext.spanId, parentSpanId: parent });
      return {
        spanContext: () => spanContext,
        setAttribute() {},
        setAttributes() {},
        setStatus() {},
        addEvent() {},
        updateName() {},
        end() {},
        isRecording: () => true,
        recordException() {},
      };
    },
    startActiveSpan() {
      throw new Error("not used");
    },
  };
  trace.setGlobalTracerProvider({ getTracer: () => tracer as never });
  return recorded;
}

function mockProvider(): ModelProvider {
  let turn = 0;
  return {
    id: "mock",
    async *generate() {
      turn += 1;
      if (turn === 1) yield providerToolCall(toolCallContent("call_1", "echo", { text: "hi" }));
      else yield providerTextDelta("Done.");
      yield providerDone({ inputTokens: 5, outputTokens: 3 });
    },
  };
}

export async function demo() {
  const recorded = registerRecorder();
  const events: AgentEvent[] = [];
  const agent = await createAgent({
    id: "observability-demo-agent",
    model: { provider: "mock", model: "demo" },
    slots: { store: createMemorySessionStore() },
    packages: [providerPackage("mock-provider", [mockProvider()]), observability({ serviceName: "demo-agent" })],
    tools: {
      add: [
        {
          name: "echo",
          execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "echo" }),
        },
      ],
    },
  });
  const session = await agent.session({ id: "obs-session", create: true });
  const sub = session.subscribe();
  const reader = (async () => {
    for await (const event of sub) events.push(event);
  })();
  const run = await session.run("use echo", { limits: { maxToolRounds: 2 } });
  await agent.dispose();
  await reader;

  const print = (parent: string | undefined, depth: number) => {
    for (const span of recorded.filter((s) => s.parentSpanId === parent)) {
      console.log(`${"  ".repeat(depth)}${span.name}`);
      print(span.spanId, depth + 1);
    }
  };
  print(undefined, 0);
  console.log(`run status: ${run.status}`);
  return { recorded, run };
}

if (import.meta.main) await demo();
