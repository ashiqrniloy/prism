/**
 * Packed-install compatibility contract (plan 122 Task 8).
 *
 * This script is the Synapta-shaped consumer contract: it runs *only* against
 * whatever `@arnilo/prism*` packages resolve from its own `node_modules`, so the
 * companion test can copy it into a packed-install consumer (current release or
 * a pinned old family) and diff the check results instead of asserting on the
 * workspace. Run directly after `npm run build:core` for the workspace leg.
 *
 * Six checks, each a dynamic import so a missing export in an older pin becomes
 * a named delta instead of a load-time crash:
 *
 *  1. `host-tools-only` — the model sees host tools and nothing else.
 *  2. `policy-chain-snapshot` — `snapshotRunBundle` records agent+run policy
 *     names in execution order.
 *  3. `step-boundaries-and-trace-fields` — per-turn stop reasons plus usage and
 *     attention-compiler fields in the projection.
 *  4. `om-coverage-admission-retention` — the coverage-aware strategy keeps an
 *     unscanned message tail out of the fold (Task 2 admission).
 *  5. `typed-decisions-injected-transport` — `askSystemOneDecisions` preserves
 *     ids/probabilities/model/usage/timing over an injected fetch and fails
 *     typed, never neutral.
 *  6. `legacy-adapter-safety` — the legacy `@arnilo/prism-providers/typesafe`
 *     adapter resolves one credential under the configured provider id, rejects
 *     malformed answers instead of rendering them, and keeps a `__proto__`
 *     choice label as an own wire option and rendered value.
 *
 * Offline by default: mock providers, in-memory stores, injected transports.
 * Exit code is 0 when every check passes; `PRISM_COMPAT_REPORT_ONLY=1` forces 0
 * so the compatibility harness can read the delta report of an old pin.
 *
 * Run: npm run build:core && node examples/host-composition-compat.ts
 */
import assert from "node:assert/strict";
import type { AIProvider, ProviderEvent, ProviderRequest, ProviderRequestPolicy } from "@arnilo/prism";

interface CompatCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: unknown;
  readonly delta?: string;
}

const checks: CompatCheck[] = [];

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function check(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    checks.push({ name, ok: true, detail: await run() });
  } catch (error) {
    checks.push({ name, ok: false, delta: describeError(error) });
  }
}

/** Turn-indexed provider: each generate call consumes the next scripted turn. */
function scriptedProvider(turns: ProviderEvent[][], onRequest?: (request: ProviderRequest) => void): AIProvider {
  let turn = 0;
  return {
    id: "compat-scripted",
    async *generate(request) {
      onRequest?.(request);
      const events = turns[turn++] ?? [{ type: "done" }];
      for (const event of events) yield event;
    },
  };
}

const hostLookup = {
  name: "host_lookup",
  description: "Look up a host record",
  execute: async (args: Record<string, unknown>, context: { readonly toolCallId: string }) => ({
    toolCallId: context.toolCallId,
    name: "host_lookup",
    value: { found: true, recordId: String(args.recordId ?? "unknown") },
  }),
};

await check("host-tools-only", async () => {
  const prism = await import("@arnilo/prism");
  const requests: ProviderRequest[] = [];
  const provider = scriptedProvider(
    [
      [
        prism.providerToolCall({ type: "tool_call", id: "call-1", name: "host_lookup", arguments: { recordId: "r-1" } }),
        prism.providerDone(),
      ],
      [prism.providerTextDelta("handled"), prism.providerDone()],
    ],
    (request) => requests.push(request),
  );
  const agent = prism.createAgent({
    model: { provider: "mock", model: "compat" },
    provider,
    tools: prism.createToolRegistry([hostLookup]),
  });
  const result = await agent.createSession().run("look up the record");
  const names = (requests[0]?.tools ?? []).map((tool) => tool.name);
  assert.deepEqual(names, ["host_lookup"], "the request exposes host tools only");
  assert.ok(
    names.every((name) => !/memory|fabric|recall|observation/i.test(name)),
    `memory-shaped tools must not be model-visible: ${names.join(", ")}`,
  );
  assert.equal(result.status, "succeeded");
  return { turns: requests.length, toolNames: names };
});

await check("policy-chain-snapshot", async () => {
  const prism = await import("@arnilo/prism");
  const applied: string[] = [];
  const policy = (name: string): ProviderRequestPolicy => ({
    name,
    apply: ({ request }) => {
      applied.push(name);
      return request;
    },
  });
  const agent = prism.createAgent({
    model: { provider: "mock", model: "compat" },
    provider: prism.createMockProvider([prism.providerTextDelta("ok"), prism.providerDone()]),
    providerRequestPolicies: [policy("agent-first"), policy("agent-second")],
  });
  const run = { providerRequestPolicies: policy("run-last") };
  await agent.createSession().run("test", run);
  const bundle = prism.snapshotRunBundle({ agent, run });
  assert.deepEqual(applied, ["agent-first", "agent-second", "run-last"], "execution order");
  assert.deepEqual(bundle.requestPolicies, applied, "the snapshot records the executed chain");
  assert.equal(bundle.digest.startsWith("sha256:"), true);
  return { requestPolicies: bundle.requestPolicies, digest: bundle.digest };
});

await check("step-boundaries-and-trace-fields", async () => {
  const prism = await import("@arnilo/prism");
  const timelineModule = await import("@arnilo/prism-core/governance/observability");
  const provider = scriptedProvider([
    [
      prism.providerToolCall({ type: "tool_call", id: "call-1", name: "host_lookup", arguments: { recordId: "r-1" } }),
      prism.providerUsage({ inputTokens: 12, outputTokens: 3, totalTokens: 15 }),
      prism.providerDone(),
    ],
    [prism.providerTextDelta("done"), prism.providerUsage({ inputTokens: 20, outputTokens: 4, totalTokens: 24 }), prism.providerDone()],
  ]);
  const agent = prism.createAgent({
    model: { provider: "mock", model: "compat" },
    provider,
    tools: prism.createToolRegistry([hostLookup]),
    attentionCompiler: { maxInputTokens: 4096 },
  });
  const session = agent.createSession();
  const folder = timelineModule.createTimelineFolder({ content: "metadata" });
  const subscription = session.subscribe();
  const consume = (async () => {
    for await (const event of subscription) folder.push(event);
  })();
  const result = await session.run("handle the request", { limits: { maxInputTokens: 10_000 } });
  await consume;
  assert.equal(result.status, "succeeded");
  const timeline = folder.snapshot();
  const turns = timeline.turns ?? [];
  assert.equal(turns.length, 2, "one timeline turn per provider turn");
  assert.deepEqual(
    turns.map((turn) => turn.stopReason),
    ["tool_calls", "end_turn"],
    "per-step stop reasons",
  );
  const firstBudgets = turns[0]?.budgets;
  assert.equal(typeof firstBudgets?.runInputUsed, "number", "usage trace field");
  assert.equal(firstBudgets?.inputCap, 4096, "attention compiler cap reaches the trace");
  assert.equal(firstBudgets?.runInputBudget, 10_000, "run input budget reaches the trace");
  assert.equal(firstBudgets?.inputTokens, 12, "reported provider usage reaches the trace");
  assert.equal(firstBudgets?.inputTokensSource, "reported");
  return {
    turns: turns.length,
    stopReasons: turns.map((turn) => turn.stopReason),
    budgets: turns.map((turn) => turn.budgets),
  };
});

await check("om-coverage-admission-retention", async () => {
  const prism = await import("@arnilo/prism");
  const om = await import("@arnilo/prism-memory/compaction/observational-memory");
  const now = "2026-01-01T00:00:00.000Z";
  const message = (id: string, text: string, parentId?: string) =>
    prism.createSessionEntry({
      id,
      sessionId: "compat",
      parentId,
      timestamp: now,
      kind: "message",
      message: { role: "user", content: [{ type: "text", text }] },
    });
  const observation = {
    id: "obs000000001",
    content: "covered fact",
    timestamp: now,
    relevance: "high" as const,
    sourceEntryIds: ["m1"],
    tokenCount: 4,
  };
  const entries = [
    message("m1", "covered turn"),
    prism.createSessionEntry({
      id: "om1",
      sessionId: "compat",
      parentId: "m1",
      timestamp: now,
      kind: "custom",
      data: { type: om.OBSERVATIONS_RECORDED, observations: [observation], coversUpToId: "m1" },
    }),
    message("m2", "unscanned turn one", "om1"),
    message("m3", "unscanned turn two", "m2"),
  ];
  const strategy = om.createObservationalMemoryCompactionStrategy({ keepRecentEntries: 1 });
  const result = await strategy.compact({ sessionId: "compat", entries, trigger: "auto" });
  const data = result.entries?.[0]?.data as { readonly keepEntryIds?: readonly string[]; readonly throughEntryId?: string } | undefined;
  assert.deepEqual(
    data?.keepEntryIds,
    ["m2", "m3"],
    "every unscanned message after the coverage cursor is retained, not just the recent window",
  );
  assert.equal(data?.throughEntryId, "om1", "the fold boundary stays behind the unscanned tail");
  return { keepEntryIds: data?.keepEntryIds, throughEntryId: data?.throughEntryId };
});

await check("typed-decisions-injected-transport", async () => {
  const decisions = await import("@arnilo/prism-providers/decisions");
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: { route: { type: "choice", choice: "ask", probabilities: { run: 0.12, ask: 0.71, reject: 0.17 }, confidence: 0.71 } },
        usage: { input_tokens: 96, output_tokens: 0 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  const body = {
    model: "jev-latest",
    state: "rm -rf ./build",
    questions: {
      route: { type: "choice", instructions: "How should this be handled?", criteria: { run: "run", ask: "ask", reject: "reject" } },
    },
  };
  const result = await decisions.askSystemOneDecisions(body as Parameters<typeof decisions.askSystemOneDecisions>[0], {
    provider: "TypeSafe Jev",
    baseUrl: "https://api.typesafe.ai/",
    apiKey: "sk-compat-fake",
    fetch: fetchImpl,
  });
  assert.equal(calls.length, 1, "one injected round trip");
  assert.equal(result.model, "jev-1.13.0");
  assert.equal(result.answers.route?.type, "choice");
  assert.equal(result.answers.route.probabilities?.ask, 0.71, "raw probabilities survive");
  assert.equal(result.usage?.inputTokens, 96);
  assert.equal(typeof result.timingMs, "number");
  return { model: result.model, answer: result.answers.route?.choice, usage: result.usage, timingMs: result.timingMs };
});

await check("legacy-adapter-safety", async () => {
  const { createTypeSafeProvider } = await import("@arnilo/prism-providers/typesafe");
  const resolveRequests: { readonly provider?: string; readonly name: string }[] = [];
  const bodies: string[] = [];
  let answers: unknown = JSON.parse('{"verdict":{"type":"choice","choice":"__proto__","confidence":0.7}}');
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(String(init?.body));
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 12, output_tokens: 0 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const provider = createTypeSafeProvider({
    id: "TypeSafe Jev",
    apiKey: {
      resolve: (request) => {
        resolveRequests.push(request);
        return { type: "api_key", value: "compat-dummy" };
      },
    },
    fetch: fetchImpl,
  });
  const request: ProviderRequest = {
    model: { provider: "typesafe", model: "jev-latest", capabilities: { structuredOutput: "json_schema" } },
    messages: [{ role: "user", content: [{ type: "text", text: "rm -rf ./build" }] }],
    options: {
      structuredOutput: {
        name: "decision",
        schema: {
          type: "object",
          properties: { verdict: { type: "string", enum: ["__proto__", "ask"], description: "How should this be handled?" } },
        },
      },
    },
  };
  const collect = async (input: ProviderRequest): Promise<ProviderEvent[]> => {
    const events: ProviderEvent[] = [];
    for await (const event of provider.generate(input)) events.push(event);
    return events;
  };

  // F2: exactly one credential resolution, under the configured provider id (the pre-fix adapter resolved again in the transport under the display label).
  const events = await collect(request);
  assert.equal(resolveRequests.length, 1, `credential resolved ${resolveRequests.length} time(s), expected exactly 1`);
  assert.deepEqual(resolveRequests[0], { provider: "TypeSafe Jev", name: "apiKey" });
  const resolutionsAfterFirstGenerate = resolveRequests.length;

  // F4: the `__proto__` choice label reaches the wire criteria as an own option and survives into the rendered output.
  const sent = JSON.parse(bodies[0] ?? "{}") as { questions?: { verdict?: { criteria?: Record<string, unknown> } } };
  const criteria = sent.questions?.verdict?.criteria;
  assert.ok(criteria && Object.hasOwn(criteria, "__proto__"), "the __proto__ choice label must be an own wire option");
  assert.equal(Object.getOwnPropertyDescriptor(criteria, "__proto__")?.value, "__proto__", "the wire option keeps the label");
  const textDelta = events.find((event) => event.type === "content_delta");
  assert.ok(textDelta && textDelta.type === "content_delta" && textDelta.content.type === "text", "one rendered text delta");
  const rendered = JSON.parse(textDelta.content.text) as { verdict?: unknown };
  assert.equal(rendered.verdict, "__proto__", "the label survives into the rendered structured output");

  // F3: a malformed answer (noul without a probability) is rejected, never coerced to a false success text.
  answers = { flag: { type: "noul" } };
  const malformed = await collect({
    ...request,
    options: {
      structuredOutput: {
        name: "decision",
        schema: { type: "object", properties: { flag: { type: "boolean", description: "Would running this destroy data?" } } },
      },
    },
  });
  assert.ok(!malformed.some((event) => event.type === "content_delta"), "a malformed answer must not render success text");
  assert.equal(malformed.at(-1)?.type, "error", "a malformed answer must surface as a providerError event");
  return {
    resolutions: resolutionsAfterFirstGenerate,
    wireOptions: Object.keys(criteria),
    rendered: { verdict: rendered.verdict },
    malformedEvents: malformed.map((event) => event.type),
  };
});

const ok = checks.every((entry) => entry.ok);
console.log(JSON.stringify({ scenario: "host-composition-compat", ok, checks }));
process.exitCode = ok || process.env.PRISM_COMPAT_REPORT_ONLY === "1" ? 0 : 1;
