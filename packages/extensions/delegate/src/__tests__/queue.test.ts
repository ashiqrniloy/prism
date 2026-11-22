import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type Agent,
  createAgent,
  createMemorySessionStore,
  definePackage,
  type ModelProvider,
  type ProviderEvent,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  type SessionContext,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import delegate, { createSlotQueue, DELEGATE_SERVICE, type DelegateService } from "../index.js";

const refused = (reason: string) => new Error(`refused:${reason}`);

describe("slot queue", () => {
  it("grants_in_call_order_and_never_lets_a_new_caller_overtake", async () => {
    const queue = createSlotQueue({ limit: 1, timeoutMs: 1_000, onRefused: refused });
    await queue.acquire();
    const order: string[] = [];
    const b = queue.acquire().then(() => order.push("b"));
    const c = queue.acquire().then(() => order.push("c"));
    assert.equal(queue.waiting, 2);
    queue.release();
    await b;
    // A new caller arriving while `c` waits queues behind it.
    const d = queue.acquire().then(() => order.push("d"));
    queue.release();
    await c;
    queue.release();
    await d;
    assert.deepEqual(order, ["b", "c", "d"]);
    assert.equal(queue.active, 1);
  });

  it("zero_timeout_refuses_at_once", async () => {
    const queue = createSlotQueue({ limit: 1, timeoutMs: 0, onRefused: refused });
    await queue.acquire();
    await assert.rejects(queue.acquire(), /refused:full/);
    assert.equal(queue.waiting, 0);
  });

  it("timeout_and_abort_leave_the_queue_without_a_slot", async () => {
    const queue = createSlotQueue({ limit: 1, timeoutMs: 20, onRefused: refused });
    await queue.acquire();
    await assert.rejects(queue.acquire(), /refused:timeout/);
    const controller = new AbortController();
    const waiting = queue.acquire({ signal: controller.signal });
    controller.abort();
    await assert.rejects(waiting, /refused:aborted/);
    assert.equal(queue.waiting, 0);
    queue.release();
    assert.equal(queue.active, 0, "neither refused caller took the slot");
    await assert.rejects(queue.acquire({ signal: AbortSignal.abort() }), /refused:aborted/);
  });

  it("force_takes_a_slot_over_the_limit_and_release_hands_it_on", async () => {
    const queue = createSlotQueue({ limit: 1, timeoutMs: 1_000, onRefused: refused });
    await queue.acquire();
    queue.force();
    assert.equal(queue.active, 2);
    let granted = false;
    const next = queue.acquire().then(() => {
      granted = true;
    });
    queue.release();
    await Promise.resolve();
    assert.equal(granted, false, "still at the limit after one release");
    queue.release();
    await next;
    assert.equal(granted, true);
  });
});

// --- through the delegate service --------------------------------------------------------------------------------

const agents: Agent[] = [];
afterEach(async () => {
  for (const agent of agents.splice(0)) await agent.dispose();
});

/** Each child turn waits for its gate to open, recording the brief it started from. */
function gatedProvider(started: string[], gates: Map<string, () => void>): ModelProvider {
  return {
    id: "mock",
    async *generate(request: ProviderRequest): AsyncIterable<ProviderEvent> {
      const brief = JSON.stringify(request.messages.find((message) => message.role === "user")?.content ?? "");
      const name = /brief (\w)/.exec(brief)?.[1] ?? "?";
      started.push(name);
      await new Promise<void>((resolve) => {
        gates.set(name, resolve);
        request.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      yield providerTextDelta(`answer ${name}`);
      yield providerDone({ inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    },
  };
}

let captured: DelegateService | undefined;
let view: SessionContext | undefined;
const consumer = definePackage({
  name: "queue-consumer",
  version: "0.0.0",
  requires: { api: 2 },
  setup(prism) {
    captured = prism.services.consume<DelegateService>(DELEGATE_SERVICE);
    prism.commands.register({
      name: "capture-session",
      description: "test only",
      run: (_args, context) => {
        view = context.session;
      },
    });
  },
});

async function build(provider: ModelProvider, queueTimeoutMs: number) {
  const agent = await createAgent({
    id: "queue-parent",
    model: { provider: "mock", model: "m" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("mock-provider", [provider]),
      delegate({ maxConcurrent: 1, queueTimeoutMs, announceAsync: false, children: { worker: { inherit: [] } } }),
      consumer,
    ],
  });
  agents.push(agent);
  const session = await agent.session();
  view = undefined;
  await agent.commands.run("capture-session", {}, { session });
  assert.ok(view);
  return { service: captured as DelegateService, context: view };
}

const until = async (check: () => boolean): Promise<void> => {
  for (let index = 0; index < 200 && !check(); index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(check(), "condition reached");
};

describe("delegate queueing", () => {
  it("call_over_limit_waits_for_a_slot_in_order", async () => {
    const started: string[] = [];
    const gates = new Map<string, () => void>();
    const { service, context } = await build(gatedProvider(started, gates), 5_000);
    const a = service.start({ child: "worker", input: "brief a", mode: "sync", session: context });
    await until(() => gates.has("a"));
    const b = service.start({ child: "worker", input: "brief b", mode: "sync", session: context });
    const c = service.start({ child: "worker", input: "brief c", mode: "sync", session: context });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(started, ["a"], "b and c wait; neither holds a model call");
    gates.get("a")?.();
    await until(() => gates.has("b"));
    assert.deepEqual(started, ["a", "b"], "b got the slot before c");
    gates.get("b")?.();
    await until(() => gates.has("c"));
    gates.get("c")?.();
    const outcomes = await Promise.all([a, b, c]);
    assert.deepEqual(
      outcomes.map((outcome) => ("text" in outcome ? outcome.text : "")),
      ["answer a", "answer b", "answer c"],
    );
  });

  it("queued_call_times_out_and_aborts_cleanly", async () => {
    const started: string[] = [];
    const gates = new Map<string, () => void>();
    const { service, context } = await build(gatedProvider(started, gates), 30);
    const a = service.start({ child: "worker", input: "brief a", mode: "sync", session: context });
    await until(() => gates.has("a"));
    await assert.rejects(
      service.start({ child: "worker", input: "brief b", mode: "sync", session: context }),
      /At most 1 delegations may run at once, and no slot freed within 30 ms/,
    );
    const controller = new AbortController();
    const waiting = service.start({ child: "worker", input: "brief c", mode: "async", session: context, signal: controller.signal });
    controller.abort();
    await assert.rejects(waiting, /aborted while it waited for a slot/);
    gates.get("a")?.();
    await a;
    assert.deepEqual(started, ["a"], "neither refused call started a child");
    // The slot came back: a new call runs at once.
    const d = service.start({ child: "worker", input: "brief d", mode: "sync", session: context });
    await until(() => gates.has("d"));
    gates.get("d")?.();
    const outcome = await d;
    assert.ok("text" in outcome && outcome.text === "answer d");
  });
});
