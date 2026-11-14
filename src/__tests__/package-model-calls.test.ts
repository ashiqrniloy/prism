/**
 * Plan 225 Task 5: a model call a package makes through `models.client(...)` runs on the hook plane and is charged to
 * the run it belongs to (evaluation probe `p8-sidecall`: seven provider calls, `model.call` fired twice, a run under a
 * 5,000-token cap finished after spending 14,000 and reported 4,000).
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type Agent,
  type AgentConfig,
  type AgentEvent,
  type ModelClient,
  type ModelProvider,
  type ProviderRequest,
  type RunLedger,
  type RunLimits,
  type RunResult,
  type SessionContext,
  type Usage,
  type UsageRecord,
  createAgent,
  createMemorySessionStore,
  definePackage,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "../index.js";
import { providerPackage } from "../provider-kit/index.js";

const model = { provider: "mock", model: "demo" } as const;
const TURN_USAGE: Usage = { inputTokens: 100, outputTokens: 100, totalTokens: 200 };
const SIDE_USAGE: Usage = { inputTokens: 2_000, outputTokens: 2_000, totalTokens: 4_000 };
const SECRET = "sk-package-call-secret-1234567890";

interface Harness {
  readonly agent: Agent;
  readonly seen: ProviderRequest[];
  readonly usageRows: UsageRecord[];
  readonly clientFor: (ref?: string) => ModelClient;
}

interface HarnessOptions {
  readonly sideCalls?: number;
  readonly limits?: RunLimits;
  readonly hooks?: AgentConfig["hooks"];
  readonly sideUsage?: Usage;
  readonly sideModel?: string;
  readonly config?: Partial<AgentConfig>;
  readonly secretInRequest?: boolean;
}

/** A run whose first turn asks for the `side` tool; the tool makes `sideCalls` package calls with its own session. */
async function harness(options: HarnessOptions = {}): Promise<Harness & { readonly runSide: (input?: string) => Promise<RunResult> }> {
  const seen: ProviderRequest[] = [];
  const usageRows: UsageRecord[] = [];
  let turn = 0;
  const provider: ModelProvider = {
    id: "mock",
    async *generate(request) {
      seen.push(request);
      if (request.origin) {
        yield providerTextDelta("side");
        yield providerDone(options.sideUsage ?? SIDE_USAGE);
        return;
      }
      turn += 1;
      if (turn === 1) {
        yield { type: "tool_call" as const, call: toolCallContent("c1", "side", {}) };
        yield providerDone(TURN_USAGE);
        return;
      }
      yield providerTextDelta("done");
      yield providerDone(TURN_USAGE);
    },
  };
  let client: ModelClient | undefined;
  let clients: ((ref?: string) => ModelClient) | undefined;
  const side = definePackage<any>({
    name: "@acme/side",
    version: "1.0.0",
    requires: { api: 1 },
    capabilities: ["models"],
    setup: ({ models, tools }: any) => {
      client = models.client(options.sideModel);
      clients = (ref) => models.client(ref);
      tools.register({
        name: "side",
        parameters: {},
        execute: async (_args: unknown, context: { toolCallId: string; session?: SessionContext }) => {
          for (let n = 0; n < (options.sideCalls ?? 1); n += 1) {
            const messages = [
              {
                id: `m${n}`,
                role: "user" as const,
                content: [{ type: "text" as const, text: options.secretInRequest ? `key ${SECRET}` : "summarize" }],
              },
            ];
            for await (const _event of client!.generate({ messages }, { session: context.session }));
          }
          return { toolCallId: context.toolCallId, name: "side", value: "ok" };
        },
      });
    },
  });
  const ledger: RunLedger = {
    appendRun: async () => undefined,
    appendEvent: async () => undefined,
    appendToolCall: async () => undefined,
    appendUsage: async (record) => {
      usageRows.push(record);
    },
  };
  const agent = await createAgent({
    model,
    packages: [providerPackage("mock-provider", [provider]), side],
    slots: { store: createMemorySessionStore() },
    runLedger: ledger,
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.hooks ? { hooks: options.hooks } : {}),
    ...options.config,
  });
  const session = await agent.session({ id: "s", create: true });
  return { agent, seen, usageRows, clientFor: (ref) => clients!(ref), runSide: (input = "go") => session.run(input) };
}

const packageEvents = (events: readonly AgentEvent[]) =>
  events.filter(
    (event): event is Extract<AgentEvent, { type: "package.event" }> => event.type === "package.event" && event.name === "model.call",
  );

describe("package model calls (plan 225 Task 5)", () => {
  it("package_call_fires_model_request_and_model_call", async () => {
    const fired: string[] = [];
    const h = await harness({
      hooks: (hooks) => {
        hooks.on("model.request", (request) => {
          fired.push(`request:${request.origin?.package ?? "-"}`);
          return undefined;
        });
        hooks.on("model.call", async (request, next) => {
          fired.push(`call:${request.origin?.package ?? "-"}`);
          return next(request);
        });
      },
    });
    await h.runSide();
    // The run's own two turns have no origin; the one package call names its package.
    assert.deepEqual(fired, ["request:-", "call:-", "request:@acme/side", "call:@acme/side", "request:-", "call:-"]);
    await h.agent.dispose();
  });

  it("package_call_does_not_fire_context_build", async () => {
    let builds = 0;
    const h = await harness({
      hooks: (hooks) => {
        hooks.on("context.build", () => {
          builds += 1;
          return undefined;
        });
      },
    });
    await h.runSide();
    assert.equal(builds, 2, "the run's two turns build context; the side call does not");
    await h.agent.dispose();
  });

  it("package_call_is_charged_to_the_active_run", async () => {
    // The probe's shape: three 4,000-token side calls under a 5,000-token cap.
    const h = await harness({ sideCalls: 3, limits: { maxTotalTokens: 5_000 } });
    const result = await h.runSide();
    assert.equal(result.status, "failed");
    assert.equal(result.limit?.limit, "maxTotalTokens");
    assert.equal(h.seen.filter((request) => request.origin).length, 2, "the breach stops the tool's second call from being its last");
    await h.agent.dispose();
  });

  it("package_call_usage_is_in_the_run_result_and_the_ledger", async () => {
    const h = await harness({ sideCalls: 2 });
    const result = await h.runSide();
    assert.equal(result.status, "completed");
    assert.equal(result.usage?.totalTokens, 200 + 200 + 4_000 * 2, "two run turns and two side calls");
    const rows = h.usageRows.filter((row) => row.scope === "package_call");
    assert.equal(rows.length, 2);
    assert.equal(h.usageRows.filter((row) => row.scope === "provider_turn").length, 2, "turn rows are unchanged");
    const turnSum = h.usageRows.filter((row) => row.scope === "provider_turn").reduce((sum, row) => sum + (row.usage.totalTokens ?? 0), 0);
    assert.equal(turnSum, 400, "a host summing only provider_turn rows is unchanged by package_call rows");
    await h.agent.dispose();
  });

  it("package_call_without_session_charges_no_run_and_still_emits", async () => {
    const h = await harness({ limits: { maxTotalTokens: 5_000 } });
    const events: AgentEvent[] = [];
    void (async () => {
      for await (const event of h.agent.subscribe()) events.push(event);
    })().catch(() => undefined);
    for await (const _event of h.clientFor().generate({ messages: [] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(h.usageRows.length, 0, "no run, no ledger row");
    assert.equal(packageEvents(events).length, 1, "agent subscribers see the kernel event");
    await h.agent.dispose();
  });

  it("package_call_with_no_session_reaches_agent_subscribers", async () => {
    const h = await harness();
    const session = await h.agent.session({ id: "other", create: true });
    const sessionEvents: AgentEvent[] = [];
    void (async () => {
      for await (const event of session.subscribe({ acrossRuns: true })) sessionEvents.push(event);
    })().catch(() => undefined);
    const agentEvents: AgentEvent[] = [];
    void (async () => {
      for await (const event of h.agent.subscribe()) agentEvents.push(event);
    })().catch(() => undefined);
    for await (const _event of h.clientFor().generate({ messages: [] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const [event] = packageEvents(agentEvents);
    assert.equal(event?.package, "kernel");
    assert.equal((event?.data as { package?: string } | undefined)?.package, "@acme/side");
    assert.equal(packageEvents(sessionEvents).length, 0, "no open session receives a sessionless event");
    await h.agent.dispose();
  });

  it("origin_cannot_be_forged", async () => {
    const h = await harness();
    for await (const _event of h.clientFor().generate({ messages: [], origin: { kind: "package", package: "@evil/forged" } } as never));
    assert.deepEqual(h.seen.at(-1)?.origin, { kind: "package", package: "@acme/side" });
    await h.agent.dispose();
  });

  it("model_request_transform_cannot_forge_origin", async () => {
    const h = await harness({
      hooks: (hooks) => {
        hooks.on("model.request", (request) => ({ ...request, origin: { kind: "package" as const, package: "@evil/forged" } }));
      },
    });
    for await (const _event of h.clientFor().generate({ messages: [] }));
    assert.equal(h.seen.at(-1)?.origin?.package, "@acme/side");
    await h.agent.dispose();
  });

  it("throwing_model_request_fails_the_package_call_closed", async () => {
    const h = await harness({
      hooks: (hooks) => {
        hooks.on("model.request", () => {
          throw new Error("policy says no");
        });
      },
    });
    await assert.rejects(
      async () => {
        for await (const _event of h.clientFor().generate({ messages: [] }));
      },
      (error: Error & { owner?: string; hook?: string }) =>
        error.name === "HookError" && error.owner === "host" && error.hook === "model.request",
    );
    assert.equal(h.seen.length, 0, "no provider call");
    await h.agent.dispose();
  });

  it("throwing_model_call_fails_the_package_call_closed", async () => {
    const h = await harness({
      hooks: (hooks) => {
        hooks.on("model.call", () => {
          throw new Error("gate down");
        });
      },
    });
    await assert.rejects(
      async () => {
        for await (const _event of h.clientFor().generate({ messages: [] }));
      },
      (error: Error & { hook?: string }) => error.name === "HookError" && error.hook === "model.call",
    );
    assert.equal(h.seen.length, 0);
    await h.agent.dispose();
  });

  it("model_call_handlers_see_session_and_run_ids", async () => {
    const ids: { readonly origin: string; readonly sessionId: string; readonly runId: string }[] = [];
    const h = await harness({
      hooks: (hooks) => {
        hooks.on("model.call", async (request, next, context) => {
          ids.push({ origin: request.origin?.package ?? "run", sessionId: context.sessionId, runId: context.runId });
          return next(request);
        });
      },
    });
    await h.runSide();
    const turnIds = ids.filter((entry) => entry.origin === "run");
    const sideIds = ids.filter((entry) => entry.origin !== "run");
    assert.equal(turnIds.length, 2);
    assert.equal(sideIds.length, 1);
    for (const entry of ids) {
      assert.equal(entry.sessionId, "s");
      assert.match(entry.runId, /^run_|.+/);
      assert.notEqual(entry.runId, "");
    }
    assert.equal(sideIds[0]?.runId, turnIds[0]?.runId, "the package call joins the run it belongs to");
    await h.agent.dispose();
  });

  it("model_call_context_call_reaches_any_model_without_reentering_hooks", async () => {
    let handlerCalls = 0;
    const h = await harness({
      hooks: (hooks) => {
        hooks.on("model.call", async (request, _next, context) => {
          handlerCalls += 1;
          assert.ok(context.call, "present on model.call dispatches");
          return context.call!(request);
        });
        hooks.on("model.request", (_request, context) => {
          assert.equal(context.call, undefined, "absent on every other hook");
          return undefined;
        });
      },
    });
    for await (const _event of h.clientFor().generate({ messages: [] }));
    assert.equal(handlerCalls, 1);
    assert.equal(h.seen.length, 1, "the onward call reached the provider once and fired no hook");
    await h.agent.dispose();
  });

  it("package_call_event_carries_no_content_or_secret", async () => {
    const h = await harness({
      secretInRequest: true,
      config: { redactor: { redact: (value) => JSON.parse(JSON.stringify(value).replaceAll(SECRET, "[REDACTED]")) } },
    });
    const session = await h.agent.session({ id: "events", create: true });
    const events: AgentEvent[] = [];
    void (async () => {
      for await (const event of session.subscribe({ acrossRuns: true })) events.push(event);
    })().catch(() => undefined);
    await session.run("go");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const reported = packageEvents(events);
    assert.equal(reported.length, 1);
    const text = JSON.stringify(reported[0]);
    assert.ok(!text.includes(SECRET));
    assert.ok(!text.includes("summarize"));
    assert.deepEqual(Object.keys((reported[0]?.data ?? {}) as object).sort(), [
      "latencyMs",
      "model",
      "outcome",
      "package",
      "provider",
      "usage",
    ]);
    assert.ok(!h.seen.some((request) => JSON.stringify(request.messages).includes(SECRET)), "the provider saw the redacted request");
    await h.agent.dispose();
  });

  it("package_call_to_another_model_is_priced_with_its_own_model", async () => {
    const quotes: string[] = [];
    const h = await harness({
      sideModel: "mock/pricey",
      config: {
        costCatalog: {
          get: async (id: string) => {
            quotes.push(id);
            return { input: 1, output: 1, currency: "USD", unit: "per_million_tokens" };
          },
        },
      },
    });
    await h.runSide();
    assert.ok(quotes.includes("pricey"), "the side call was priced by its own model id");
    const row = h.usageRows.find((entry) => entry.scope === "package_call");
    assert.ok(row?.usage.cost !== undefined && row.usage.cost > 0);
    await h.agent.dispose();
  });
});
