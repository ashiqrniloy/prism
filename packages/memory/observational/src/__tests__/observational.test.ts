import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import type { AgentEvent, Compactor, LoopStrategy, ModelProvider, ProviderRequest } from "@arnilo/prism";
import {
  SlotConflictError,
  createAgent,
  createMemorySessionStore,
  createSecretRedactor,
  definePackage,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { packageConformance } from "@arnilo/prism/testing";
import memoryObservational, { type MemoryObservationalConfig } from "../index.js";

const MODEL = { provider: "main", model: "main-model", limits: { contextWindow: 64_000, maxOutputTokens: 0 } };
const SECRET = "om-secret-value";
/** Observer runs on every non-empty tail; the reflector threshold is out of reach unless a test lowers it. */
const CONFIG: MemoryObservationalConfig = { observer: { model: "observer/om-model", messageTokens: 1 } };

interface WorkerState {
  calls: number;
  models: string[];
}

function mainProvider(requests: ProviderRequest[]): ModelProvider {
  return {
    id: "main",
    async *generate(request) {
      requests.push(request);
      yield providerTextDelta("ok");
      yield providerDone();
    },
  };
}

/** Records one observation sourced from the prompt's first entry id, then answers done. */
function observerProvider(state: WorkerState, options: { id?: string; fail?: boolean; gate?: Promise<void> } = {}): ModelProvider {
  return {
    id: options.id ?? "observer",
    async *generate(request) {
      state.calls += 1;
      state.models.push(request.model.model);
      if (options.gate) await options.gate;
      if (options.fail) throw new Error(`observer failed: ${SECRET}`);
      const alreadyCalled = request.messages.some((message) => message.role === "tool");
      const prompt = request.messages.find((message) => message.role === "user")?.content[0];
      const text = prompt?.type === "text" ? prompt.text : "";
      const sourceId = /\[[^\]]+\] \[([^\]]+)\] message:/.exec(text)?.[1];
      if (!alreadyCalled && sourceId) {
        yield providerToolCall(
          toolCallContent("c1", "record_observation", { content: `Observed ${sourceId}`, relevance: "high", sourceEntryIds: [sourceId] }),
        );
      }
      yield providerDone();
    },
  };
}

interface HarnessOptions {
  readonly config?: MemoryObservationalConfig;
  readonly enabled?: boolean;
  readonly redactor?: ReturnType<typeof createSecretRedactor>;
  readonly observer?: { fail?: boolean; gate?: Promise<void> };
  readonly loop?: LoopStrategy;
  readonly compaction?: Compactor;
  /** Observe-hook sink: package events and background tasks, as a host sees them. */
  readonly events?: AgentEvent[];
}

async function harness(options: HarnessOptions = {}) {
  const store = createMemorySessionStore();
  const requests: ProviderRequest[] = [];
  const state: WorkerState = { calls: 0, models: [] };
  const agent = await createAgent({
    model: MODEL,
    packages: [
      providerPackage("main-provider", [mainProvider(requests)]),
      providerPackage("observer-provider", [observerProvider(state, options.observer ?? {})]),
      memoryObservational({ ...CONFIG, ...options.config, ...(options.enabled === undefined ? {} : { enabled: options.enabled }) }),
    ],
    slots: { store, ...(options.compaction ? { compaction: options.compaction } : {}), ...(options.loop ? { loop: options.loop } : {}) },
    ...(options.redactor ? { redactor: options.redactor } : {}),
    ...(options.events
      ? {
          hooks: (hooks: {
            on: (
              name: "package.event" | "background.started" | "background.completed" | "background.failed",
              handler: (payload: unknown) => void,
            ) => void;
          }) => {
            for (const name of ["package.event", "background.started", "background.completed", "background.failed"] as const) {
              hooks.on(name, (payload) => options.events!.push(payload as AgentEvent));
            }
          },
        }
      : {}),
  });
  const session = await agent.session({ id: "s", create: true });
  return { agent, session, store, requests, state };
}

/** One macrotask plus slack, so a background pass that will run has run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const names = (request: ProviderRequest | undefined): readonly string[] => request?.tools?.map((tool) => tool.name) ?? [];

describe("observational memory package", () => {
  it("om_package_conformance", async () => {
    const result = await packageConformance(memoryObservational({}));
    assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
  });

  it("om_off_by_default_adds_no_calls", async () => {
    const { session, store, requests, state, agent } = await harness();
    for (const input of ["one", "two", "three"]) await session.run(input);
    await settle();
    assert.equal(state.calls, 0, "no observer call while the toggle is off");
    assert.equal(
      (await store.list("s")).filter((entry) => entry.kind === "package_state").length,
      0,
      "no ledger write while the toggle is off",
    );
    assert.equal(names(requests.at(-1)).includes("recall"), false, "recall stays hidden");
    assert.equal((await agent.inspect()).slots.compaction, "@arnilo/prism-memory-observational");
    await session.close();
  });

  it("om_toggle_per_session", async () => {
    const { agent, session, requests, state } = await harness();
    const other = await agent.session({ id: "other", create: true });
    const toggled = await agent.commands.run("om", {}, { session });
    assert.deepEqual(toggled, { ok: true, enabled: true, text: "Observational memory on for this session." });

    await session.run("one");
    await other.run("one");
    await settle();
    const on = requests.filter((request) => request.options?.sessionId === "s").at(-1);
    const off = requests.filter((request) => request.options?.sessionId === "other").at(-1);
    assert.equal(names(on).includes("recall"), true, "the toggled session sees recall");
    assert.equal(names(off).includes("recall"), false, "the other session does not");
    // One pass is two provider calls: the turn that records, then the turn that ends the worker loop.
    assert.equal(state.calls, 2, "only the toggled session observed");
    await session.close();
    await other.close();
  });

  it("om_observer_runs_on_own_model", async () => {
    const { agent, session, requests, state } = await harness();
    await agent.commands.run("om", {}, { session });
    await session.run("one");
    await settle();
    assert.deepEqual(state.models, ["om-model", "om-model"], "the observer answers on its own model");
    assert.deepEqual(
      requests.at(-1)?.model,
      { provider: "main", model: "main-model", limits: { contextWindow: 64_000, maxOutputTokens: 0 } },
      "the run stays on the session model",
    );
    await session.close();
  });

  it("om_model_command_switches_observer", async () => {
    const store = createMemorySessionStore();
    const requests: ProviderRequest[] = [];
    const first: WorkerState = { calls: 0, models: [] };
    const second: WorkerState = { calls: 0, models: [] };
    const agent = await createAgent({
      model: MODEL,
      packages: [
        providerPackage("main-provider", [mainProvider(requests)]),
        providerPackage("observer-provider", [observerProvider(first, { id: "observer" })]),
        providerPackage("observer2-provider", [observerProvider(second, { id: "observer2" })]),
        memoryObservational(CONFIG),
      ],
      slots: { store },
    });
    const session = await agent.session({ id: "s", create: true });
    await agent.commands.run("om", {}, { session });
    await session.run("one");
    await settle();
    assert.equal(first.calls, 2);

    const switched = (await agent.commands.run("om:model", { observer: "observer2/other-model" }, { session })) as {
      observer: unknown;
    };
    assert.equal(switched.observer, "observer2/other-model");
    await session.run("two");
    await settle();
    assert.deepEqual(second.models, ["other-model", "other-model"], "the next pass uses the new model");

    await assert.rejects(agent.commands.run("om:model", { observer: "nope/model" }, { session }), /Unknown provider: nope/);
    await session.run("three");
    await settle();
    assert.equal(second.models.length, 4, "the failed command left the stored ref unchanged");
    assert.equal(second.models.filter((model) => model === "other-model").length, 4);
    await session.close();
  });

  it("om_context_block_empty_before_first_compaction", async () => {
    const { agent, session, store, requests } = await harness();
    await agent.commands.run("om", {}, { session });
    await session.run("one");
    await settle();
    assert.match(JSON.stringify(await store.list("s")), /Observed/);

    await session.run("two");
    const messages = JSON.stringify(requests.at(-1)?.messages ?? []);
    assert.doesNotMatch(messages, /observational-memory|Observed/);
    const persisted = await store.list("s");
    assert.equal(persisted.filter((entry) => entry.kind === "message").length, 4, "the block is never a message entry");
    assert.equal(persisted.filter((entry) => entry.kind === "package_state").length >= 1, true);
    await session.close();
  });

  it("om_compaction_uses_ledger", async () => {
    const { agent, session, store } = await harness();
    await agent.commands.run("om", {}, { session });
    await session.run("one");
    await settle();
    await session.compact();
    const compaction = (await store.list("s")).filter((entry) => entry.kind === "compaction").at(-1);
    assert.ok(compaction, "compaction appended an entry");
    assert.match(compaction.summary ?? "", /Observed/, "the summary comes from the ledger");
    assert.equal((compaction.data as { strategy?: string }).strategy, "observational-memory");
    assert.equal((compaction.data as { memory?: { type?: string } }).memory?.type, "om.folded");
    await session.close();
  });

  it("om_compaction_delegates_when_off", async () => {
    const { session, store } = await harness();
    await session.run("one");
    await session.compact();
    const compaction = (await store.list("s")).filter((entry) => entry.kind === "compaction").at(-1);
    assert.equal((compaction?.data as { strategy?: string })?.strategy, "default-compaction");
    await session.close();
  });

  it("om_flush_in_flight_skipped", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const events: AgentEvent[] = [];
    const { agent, session, state } = await harness({ observer: { gate }, events });
    await agent.commands.run("om", {}, { session });
    await session.run("one");
    await session.run("two");
    await settle();
    assert.equal(state.calls, 1, "the second request was skipped, not queued: the first pass is still in its model call");
    release();
    await settle();
    assert.equal(state.calls, 2, "the released pass finished its own worker loop");
    const started = events.filter((event) => event.type === "background.started" && event.name === "om.observe");
    assert.equal(started.length, 2, "each turn started a tracked pass");
    // The skipped pass reports no start/end status of its own: the one running pass stays `inFlight`,
    // and the second turn's pass returned `skipped: "in_flight"` without touching the observer.
    const statuses = events
      .filter((event) => event.type === "package.event" && event.name === "om.status")
      .map((event) => (event.type === "package.event" ? (event.data as { inFlight?: boolean }) : {}));
    assert.equal(statuses.filter((status) => status.inFlight === true).length, 1, "one pass reported a start");
    assert.equal(statuses.filter((status) => status.inFlight === false).length, 2, "the toggle and the pass end");
    await session.close();
  });

  it("om_observer_failure_is_background_only", async () => {
    const events: AgentEvent[] = [];
    const { session, store, agent } = await harness({
      observer: { fail: true },
      redactor: createSecretRedactor([SECRET]),
      events,
    });
    await agent.commands.run("om", {}, { session });
    const result = await session.run("one");
    await settle();
    assert.ok(result, "the run completes");
    const failed = events.find((event) => event.type === "background.failed");
    assert.ok(failed, "the pass fails as a background task");
    assert.equal(failed.type === "background.failed" ? failed.name : undefined, "om.observe");
    assert.equal(failed.type === "background.failed" ? failed.error?.message.includes(SECRET) : true, false, "the error is redacted");

    const status = (await agent.commands.run("om:status", {}, { session })) as { inFlight: boolean; lastError?: string };
    assert.equal(status.inFlight, false);
    assert.match(status.lastError ?? "", /observer failed/);
    const ledgerRecords = (await store.list("s")).filter(
      (entry) => entry.kind === "package_state" && (entry.data as { key?: string }).key === "ledger",
    );
    assert.equal(ledgerRecords.length, 0, "a failed pass leaves the ledger unchanged");
    await session.close();
  });

  // Plan 210 Task 2: the inspectability role of `om`, `om:model`, `om:status` and `om:view` rests on this test.
  it("om_commands_expose_session_state_for_inspection", async () => {
    const { agent, session } = await harness();
    const before = (await agent.commands.run("om:status", {}, { session })) as {
      enabled: boolean;
      observations: { recorded: number; active: number };
      inFlight: boolean;
      text: string;
    };
    assert.equal(before.enabled, false, "status reports the toggle before it is flipped");
    assert.equal(before.observations.recorded, 0);
    await agent.commands.run("om", {}, { session });
    await session.run("one");
    await settle();
    const after = (await agent.commands.run("om:status", {}, { session })) as typeof before;
    assert.equal(after.enabled, true, "status reports the per-session toggle");
    assert.equal(after.observations.recorded, 1, "status counts the ledger's recorded observations");
    assert.equal(after.observations.active, 1);
    assert.equal(after.inFlight, false);
    assert.match(after.text, /1 active \/ 1 recorded observations/);
    const view = (await agent.commands.run("om:view", {}, { session })) as { observations: number; reflections: number; text: string };
    assert.equal(view.observations, 1, "view renders the same ledger status counted");
    assert.equal(view.reflections, 0);
    assert.ok(view.text.length > 0, "view renders the observation text a person can read");
    const model = (await agent.commands.run("om:model", { observer: "observer/om-model" }, { session })) as { observer: string };
    assert.equal(model.observer, "observer/om-model", "om:model reports the observer it switched to");
    const reported = (await agent.commands.run("om:status", {}, { session })) as { observer: string };
    assert.equal(reported.observer, "observer/om-model", "status reports the switched observer");
    await session.close();
  });

  it("om_status_events", async () => {
    const events: AgentEvent[] = [];
    const { agent, session } = await harness({ events });
    await agent.commands.run("om", {}, { session });
    await session.run("one");
    await settle();
    const statuses = events
      .filter((event) => event.type === "package.event" && event.name === "om.status")
      .map(
        (event) =>
          (event.type === "package.event" ? (event.data as { inFlight?: boolean; enabled?: boolean; observations?: number }) : {}) as {
            inFlight?: boolean;
            enabled?: boolean;
            observations?: number;
          },
      );
    assert.deepEqual(statuses[0], {
      enabled: true,
      contextMode: "none",
      observations: 0,
      reflections: 0,
      inFlight: false,
    });
    assert.equal(
      statuses.some((status) => status.inFlight === true),
      true,
      "a flush start was reported",
    );
    assert.equal(statuses.at(-1)?.inFlight, false, "a flush end was reported");
    assert.equal(statuses.at(-1)?.observations, 1);
    await session.close();
  });

  it("om_secret_never_in_ledger_or_events", async () => {
    const events: AgentEvent[] = [];
    const { session, store, agent, requests } = await harness({ redactor: createSecretRedactor([SECRET]), events });
    await agent.commands.run("om", {}, { session });
    await session.run(`remember the token ${SECRET}`);
    await settle();
    assert.equal(JSON.stringify(await store.list("s")).includes(SECRET), false, "no secret in the branch");
    assert.equal(JSON.stringify(events).includes(SECRET), false, "no secret in events");
    assert.equal(JSON.stringify(requests).includes(SECRET), false, "the observer prompt is redacted");
    const view = (await agent.commands.run("om:view", {}, { session })) as { text: string };
    assert.equal(view.text.includes(SECRET), false, "no secret in the rendered ledger");
    assert.match(view.text, /Observational Memory/);
    await session.close();
  });

  it("om_slot_conflict_fails_closed", async () => {
    // A second package provider for the same slot, so the conflict is real and independent of the
    // sibling memory package (no cross-package test dependency).
    const other = definePackage({
      name: "@acme/other-compactor",
      version: "1.0.0",
      description: "A second package provider for the compaction slot.",
      requires: { api: 1 },
      capabilities: ["slot:compaction"],
      setup(prism) {
        prism.slots.compaction.provide({ name: "other-compaction", compact: () => ({ summary: "", entries: [] }) });
      },
    })();
    const packages = [other, memoryObservational({})];
    await assert.rejects(
      createAgent({ model: MODEL, packages }),
      (error: unknown) =>
        error instanceof SlotConflictError &&
        error.code === "ERR_PRISM_SLOT_CONFLICT" &&
        [...error.owners].sort().join(",") === "@acme/other-compactor,@arnilo/prism-memory-observational",
    );
    const agent = await createAgent({
      model: MODEL,
      packages,
      slots: { store: createMemorySessionStore(), compaction: "@arnilo/prism-memory-observational" },
    });
    assert.equal((await agent.inspect()).slots.compaction, "@arnilo/prism-memory-observational");
    await agent.dispose();
  });

  it("om_from_custom_loop", async () => {
    const loop: LoopStrategy = {
      name: "custom-om-loop",
      revision: "1",
      async run(run) {
        const turn = await run.turn();
        if (turn.toolCalls.length) await run.executeTools(turn.toolCalls);
        await run.end();
      },
    };
    const { agent, session, requests } = await harness({ loop });
    await agent.commands.run("om", {}, { session });
    await session.run("one");
    await settle();
    await session.run("two");
    assert.doesNotMatch(JSON.stringify(requests.at(-1)?.messages ?? []), /observational-memory/);
    await session.close();
  });
});


it("om_context_block_pinned_after_foreign_compaction_and_foreign_owner_keeps_gate", async () => {
  let compactions = 0;
  const { session, agent, requests } = await harness({ enabled: true, compaction: {
    name: "foreign", compact: () => { compactions++; return { summary: "foreign summary" }; },
  } });
  await session.run("one");
  await settle();
  await session.compact();
  await session.run("two");
  const first = requests.at(-1)!.messages.filter((message) => JSON.stringify(message).includes("observational-memory"));
  assert.match(JSON.stringify(first), /Observed/);
  await settle();
  await session.run("three");
  assert.deepEqual(requests.at(-1)!.messages.filter((message) => JSON.stringify(message).includes("observational-memory")), first);
  assert.equal(compactions, 1, "foreign owner is never forced by advancing observation coverage");
  assert.equal((await agent.commands.run("om:status", {}, { session }) as any).contextMode, "pinned");
  await agent.dispose();
});
it("om_requests_compaction_when_coverage_advances_after_own_compaction", async () => {
  const { session, agent, store, requests } = await harness({ enabled: true });
  await session.run("one");
  await settle();
  await session.compact();
  await session.run("two");
  assert.doesNotMatch(JSON.stringify(requests.at(-1)!.messages), /observational-memory/);
  await settle();
  const before = (await store.list("s")).filter((entry) => entry.kind === "compaction").length;
  await session.run("three");
  assert.equal((await store.list("s")).filter((entry) => entry.kind === "compaction").length, before + 1);
  assert.equal((await agent.commands.run("om:status", {}, { session }) as any).contextMode, "own-compaction");
  await agent.dispose();
});
it("om_prefix_stable_between_compactions", async () => {
  const { session, agent, requests, store } = await harness({ enabled: true, observer: { fail: true } });
  await session.run("one");
  await settle();
  await session.compact();
  await session.run("two");
  const first = requests.at(-1)!;
  await settle();
  await session.run("three");
  const second = requests.at(-1)!;
  assert.equal(JSON.stringify(second.messages.slice(0, first.messages.length)), JSON.stringify(first.messages));
  assert.deepEqual(second.tools, first.tools);
  assert.equal((await store.list("s")).filter((entry) => entry.kind === "compaction").length, 1);
  await agent.dispose();
});
it("failed_compaction_does_not_pin", async () => {
  const { session, agent, store } = await harness({ enabled: true, compaction: { name: "broken", compact() { throw new Error("broken"); } } });
  await assert.rejects(session.compact(), /broken/);
  assert.doesNotMatch(JSON.stringify(await store.list("s")), /om.context.pinned/);
  await agent.dispose();
});

it("om_prefix_stability_conformance", async () => {
  const { runPrefixStabilityConformance } = await import("@arnilo/prism/testing/prefix-stability-conformance");
  const result = await runPrefixStabilityConformance({
    host: { model: MODEL, instructions: "Stable rules. ".repeat(300), packages: [memoryObservational({ enabled: true })] },
    skills: [
      { name: "alpha", description: "Alpha", instructions: "Alpha body" },
      { name: "beta", description: "Beta", instructions: "Beta body" },
    ],
    assertOn: "cacheablePrefix",
  });
  assert.equal(result.cacheableContinuity, 1);
});
