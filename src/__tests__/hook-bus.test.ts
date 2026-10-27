import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { AgentEvent, Message, ProviderEvent, ProviderRequest, ToolResult } from "../contracts.js";
import type { HookBus, HookName, HookRegistrar } from "../hooks/index.js";
import { createHookBus, HOOK_CATALOG, HookError, HookRejectedError, UnknownHookError } from "../hooks/index.js";

/** A bus whose `on` registers under `owner`, so tests read like a single-owner registrar. */
const bus = (owner = "host", onEvent?: (event: AgentEvent) => void, secrets?: readonly (string | undefined)[]): HookBus & HookRegistrar => {
  const real = createHookBus({ onEvent, secrets });
  const registrar = real.registrar(owner);
  return { ...real, on: (name, handler, options) => registrar.on(name, handler, options) };
};

const userMessage = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
const request = {} as ProviderRequest;
const toolResult = { toolCallId: "c1", name: "t", result: null } as unknown as ToolResult;
const events = async function* (): AsyncIterable<ProviderEvent> {};

describe("hook bus", () => {
  it("orders by priority then load order", async () => {
    const seen: string[] = [];
    const hooks = bus();
    hooks.on(
      "message.append",
      (message) => {
        seen.push("low");
        return message;
      },
      { priority: 0 },
    );
    hooks.on(
      "message.append",
      (message) => {
        seen.push("high-1");
        return message;
      },
      { priority: 10 },
    );
    hooks.on(
      "message.append",
      (message) => {
        seen.push("high-2");
        return message;
      },
      { priority: 10 },
    );
    await hooks.transform("message.append", userMessage("hi"));
    assert.deepEqual(seen, ["high-1", "high-2", "low"]);
  });

  it("observe throw emits hook.error and never fails", () => {
    const emitted: AgentEvent[] = [];
    const hooks = bus("pkg", (event) => emitted.push(event));
    hooks.on("run.started", () => {
      throw new Error("observer boom");
    });
    hooks.on("run.started", () => {});
    hooks.observe("run.started", { type: "run.started", sessionId: "s1", runId: "r1" });
    assert.equal(emitted.length, 1);
    const event = emitted[0];
    assert.equal(event?.type, "hook.error");
    if (event?.type === "hook.error") {
      assert.equal(event.owner, "pkg");
      assert.equal(event.hook, "run.started");
      assert.equal(event.error.message, "observer boom");
    }
  });

  it("observe is synchronous and not awaited", () => {
    const hooks = bus();
    let started = false;
    hooks.on("message.delta", () => {
      started = true;
      return new Promise<void>(() => {});
    });
    const before = Date.now();
    hooks.observe("message.delta", {
      type: "message.delta",
      sessionId: "s1",
      runId: "r1",
      content: { type: "text", text: "x" },
    });
    assert.equal(started, true);
    assert.ok(Date.now() - before < 100);
  });

  it("transform: undefined keeps value, reject stops chain", async () => {
    const hooks = bus();
    hooks.on("context.build", () => undefined);
    hooks.on("context.build", (_draft, ctx) => ctx.reject("blocked"));
    await assert.rejects(
      () => hooks.transform("context.build", { messages: [userMessage("hi")] }),
      (error: unknown) => {
        assert.ok(error instanceof HookRejectedError);
        assert.equal(error.reason, "blocked");
        assert.equal(error.owner, "host");
        assert.equal(error.hook, "context.build");
        return true;
      },
    );
  });

  it("transform throw fails closed naming owner and hook", async () => {
    const hooks = bus("acme");
    hooks.on("context.build", () => {
      throw new Error("kaboom");
    });
    await assert.rejects(
      () => hooks.transform("context.build", { messages: [] }),
      (error: unknown) => {
        assert.ok(error instanceof HookError);
        assert.equal(error.owner, "acme");
        assert.equal(error.hook, "context.build");
        assert.equal(error.message, "kaboom");
        return true;
      },
    );
  });

  it("transform onError ignore keeps value and emits hook.error", async () => {
    const emitted: AgentEvent[] = [];
    const hooks = bus("acme", (event) => emitted.push(event));
    hooks.on(
      "context.build",
      () => {
        throw new Error("soft");
      },
      { onError: "ignore" },
    );
    const draft = { messages: [] };
    assert.deepEqual(await hooks.transform("context.build", draft), draft);
    assert.equal(emitted[0]?.type, "hook.error");
  });

  it("decide tool.call: deny wins over ask and allow", async () => {
    const hooks = bus();
    hooks.on("tool.call", () => ({ ask: "confirm?" }), { priority: 10 });
    hooks.on("tool.call", () => ({ deny: "nope" }));
    const decision = await hooks.decide("tool.call", {
      name: "t",
      args: {},
      effects: [],
      callId: "c1",
      sessionId: "s1",
      runId: "r1",
    });
    assert.deepEqual(decision, { deny: "nope" });
  });

  it("decide tool.call: throw is a deny naming owner and hook", async () => {
    const hooks = bus("acme");
    hooks.on("tool.call", () => {
      throw new Error("boom");
    });
    const decision = await hooks.decide("tool.call", {
      name: "t",
      args: {},
      effects: [],
      callId: "c1",
      sessionId: "s1",
      runId: "r1",
    });
    assert.ok(decision !== undefined && typeof decision === "object" && "deny" in decision);
    if (typeof decision === "object" && decision !== null && "deny" in decision) {
      assert.match(String(decision.deny), /^acme:tool\.call: boom$/);
    }
  });

  it("decide tool.call: rewrites apply in order, then first respond", async () => {
    const hooks = bus();
    hooks.on("tool.call", () => ({ rewrite: { a: 1 } }));
    hooks.on("tool.call", () => ({ rewrite: { b: 2 } }));
    const merged = await hooks.decide("tool.call", {
      name: "t",
      args: {},
      effects: [],
      callId: "c1",
      sessionId: "s1",
      runId: "r1",
    });
    assert.deepEqual(merged, { rewrite: { a: 1, b: 2 } });

    const respond = bus();
    respond.on("tool.call", () => ({ respond: toolResult }));
    assert.deepEqual(await respond.decide("tool.call", { name: "t", args: {}, effects: [], callId: "c1", sessionId: "s1", runId: "r1" }), {
      respond: toolResult,
    });
  });

  it("decide tool.call: a changed rewrite wins over ask, a conflicting rewrite denies, a no-op rewrite is dropped", async () => {
    const payload = (path: string) => ({ name: "t", args: { path }, effects: [], callId: "c1", sessionId: "s1", runId: "r1" });

    const round1 = bus();
    round1.on("tool.call", () => ({ ask: "approve?" }));
    round1.on("tool.call", () => ({ rewrite: { path: "b" } }));
    assert.deepEqual(await round1.decide("tool.call", payload("a")), { rewrite: { path: "b" } });

    const conflict = bus();
    conflict.on("tool.call", () => ({ rewrite: { path: "b" } }));
    conflict.on("tool.call", () => ({ rewrite: { path: "c" } }));
    const denied = await conflict.decide("tool.call", payload("a"));
    assert.ok(typeof denied === "object" && denied !== null && "deny" in denied);
    if (typeof denied === "object" && denied !== null && "deny" in denied) assert.match(String(denied.deny), /rewrite_conflict/);

    // Round 2: the same rewrite now equals its input, so it is dropped and the ask surfaces.
    const noop = bus();
    noop.on("tool.call", () => ({ rewrite: { path: "b" } }));
    noop.on("tool.call", () => ({ ask: "approve?" }));
    assert.deepEqual(await noop.decide("tool.call", payload("b")), { ask: "approve?" });
  });

  it("decide run.end: first continue wins", async () => {
    const hooks = bus();
    hooks.on("run.end", () => ({ continue: { reason: "first" } }), { priority: 10 });
    hooks.on("run.end", () => ({ continue: { reason: "second" } }));
    assert.deepEqual(await hooks.decide("run.end", { sessionId: "s1", runId: "r1", history: [], turn: 1, continuations: 0 }), {
      continue: { reason: "first" },
    });
  });

  it("decide turn.before: any stop stops", async () => {
    const hooks = bus();
    hooks.on("turn.before", () => undefined);
    hooks.on("turn.before", () => ({ stop: "budget" }));
    assert.deepEqual(await hooks.decide("turn.before", { sessionId: "s1", runId: "r1", turn: 1 }), { stop: "budget" });
  });

  it("decide compaction.when: any compact triggers", async () => {
    const hooks = bus();
    hooks.on("compaction.when", () => undefined);
    hooks.on("compaction.when", () => ({ compact: true }));
    assert.deepEqual(await hooks.decide("compaction.when", { sessionId: "s1", runId: "r1", messages: [], entryCount: 0 }), {
      compact: true,
    });
  });

  it("decide compaction.when: any veto wins when nobody asks to compact", async () => {
    const hooks = bus();
    hooks.on("compaction.when", () => undefined);
    hooks.on("compaction.when", () => ({ compact: false }));
    assert.deepEqual(await hooks.decide("compaction.when", { sessionId: "s1", runId: "r1", messages: [], entryCount: 0 }), {
      compact: false,
    });
  });

  it("decide compaction.when: every abstention yields no decision", async () => {
    const hooks = bus();
    hooks.on("compaction.when", () => undefined);
    hooks.on("compaction.when", () => undefined);
    assert.equal(await hooks.decide("compaction.when", { sessionId: "s1", runId: "r1", messages: [], entryCount: 0 }), undefined);
  });

  it("decide compaction.when: true beats false regardless of order", async () => {
    const hooks = bus();
    hooks.on("compaction.when", () => ({ compact: true }));
    hooks.on("compaction.when", () => ({ compact: false }));
    assert.deepEqual(await hooks.decide("compaction.when", { sessionId: "s1", runId: "r1", messages: [], entryCount: 0 }), {
      compact: true,
    });
  });

  it("around nests highest priority outermost", async () => {
    const order: string[] = [];
    const hooks = bus();
    hooks.on(
      "model.call",
      async (_request, next) => {
        order.push("a-before");
        const result = await next(request);
        order.push("a-after");
        return result;
      },
      { priority: 10 },
    );
    hooks.on("model.call", async (_request, next) => {
      order.push("b-before");
      const result = await next(request);
      order.push("b-after");
      return result;
    });
    await hooks.around("model.call", request, async () => {
      order.push("terminal");
      return events();
    });
    assert.deepEqual(order, ["a-before", "b-before", "terminal", "b-after", "a-after"]);
  });

  it("around may skip next", async () => {
    let terminalRan = false;
    const hooks = bus();
    hooks.on("model.call", async () => events());
    await hooks.around("model.call", request, async () => {
      terminalRan = true;
      return events();
    });
    assert.equal(terminalRan, false);
  });

  it("around next twice throws", async () => {
    const hooks = bus("acme");
    hooks.on("model.call", async (_request, next) => {
      await next(request);
      return next(request);
    });
    await assert.rejects(
      () => hooks.around("model.call", request, async () => events()),
      (error: unknown) => {
        assert.ok(error instanceof HookError);
        assert.equal(error.code, "ERR_PRISM_HOOK_NEXT_REENTRY");
        return true;
      },
    );
  });

  it("unknown hook and bad options fail closed", () => {
    const hooks = bus();
    assert.throws(() => hooks.on("nope" as unknown as HookName, () => {}), UnknownHookError);
    hooks.on("message.append", (message) => message, { id: "dup" });
    assert.throws(
      () => hooks.on("message.append", (message) => message, { id: "dup" }),
      (error: unknown) => {
        assert.ok(error instanceof HookError);
        assert.equal(error.code, "ERR_PRISM_HOOK_DUPLICATE_ID");
        return true;
      },
    );
    assert.throws(
      () => hooks.on("tool.call", () => ({ deny: "x" }), { onError: "ignore" }),
      (error: unknown) => {
        assert.ok(error instanceof HookError);
        assert.equal(error.code, "ERR_PRISM_HOOK_OPTION");
        return true;
      },
    );
    assert.throws(
      () => hooks.on("message.append", undefined as unknown as () => Message),
      (error: unknown) => {
        assert.ok(error instanceof HookError);
        assert.equal(error.code, "ERR_PRISM_HOOK_OPTION");
        return true;
      },
    );
    assert.throws(
      () => hooks.on("message.append", (message) => message, { priority: Number.NaN }),
      (error: unknown) => {
        assert.ok(error instanceof HookError);
        assert.equal(error.code, "ERR_PRISM_HOOK_OPTION");
        return true;
      },
    );
  });

  it("hook error text is redacted", async () => {
    const emitted: AgentEvent[] = [];
    const hooks = bus("acme", (event) => emitted.push(event), ["token-123"]);
    hooks.on("run.started", () => {
      throw new Error("leaked token-123");
    });
    hooks.observe("run.started", { type: "run.started", sessionId: "s1", runId: "r1" });
    const event = emitted[0];
    assert.ok(event?.type === "hook.error");
    assert.equal(JSON.stringify(event).includes("token-123"), false);
    assert.equal(event.error.message.includes("[REDACTED]"), true);

    hooks.on("context.build", () => {
      throw new Error("leaked token-123");
    });
    await assert.rejects(
      () => hooks.transform("context.build", { messages: [] }),
      (error: unknown) => {
        assert.ok(error instanceof HookError);
        assert.equal(error.message.includes("token-123"), false);
        return true;
      },
    );
  });

  it("registration_ids_are_owner_scoped", () => {
    const real = createHookBus();
    real.registrar("pkg-a").on("message.append", (message) => message, { id: "x" });
    // The same explicit id under another owner is a different registration.
    real.registrar("pkg-b").on("message.append", (message) => message, { id: "x" });
    assert.deepEqual(
      real.registrations().map((registration) => registration.id),
      ["pkg-a:message.append#x", "pkg-b:message.append#x"],
    );
    // Under one owner and hook it still fails closed, and a second registrar() call shares that owner.
    assert.throws(
      () => real.registrar("pkg-a").on("message.append", (message) => message, { id: "x" }),
      (error: unknown) => error instanceof HookError && error.code === "ERR_PRISM_HOOK_DUPLICATE_ID" && error.owner === "pkg-a",
    );
    // The owner is the registrar's, never an option: an `owner` smuggled into options changes nothing.
    real.registrar("pkg-a").on("turn.before", () => undefined, { owner: "pkg-b" } as never);
    assert.equal(real.registrations().find((registration) => registration.name === "turn.before")?.id, "pkg-a:turn.before");
    assert.throws(() => real.registrar(""), HookError);
  });

  it("hook_error_names_registering_owner", async () => {
    const emitted: AgentEvent[] = [];
    const real = createHookBus({ onEvent: (event) => emitted.push(event) });
    real.registrar("pkg-a").on("context.build", () => {
      throw new Error("kaboom");
    });
    real.registrar("pkg-b").on("tool.call", () => {
      throw new Error("boom");
    });
    real.registrar("pkg-c").on("run.started", () => {
      throw new Error("observer");
    });
    await assert.rejects(
      () => real.transform("context.build", { messages: [] }),
      (error: unknown) => error instanceof HookError && error.owner === "pkg-a" && error.hook === "context.build",
    );
    const decision = await real.decide("tool.call", { name: "t", args: {}, effects: [], callId: "c", sessionId: "s", runId: "r" });
    assert.deepEqual(decision, { deny: "pkg-b:tool.call: boom" });
    real.observe("run.started", { type: "run.started", sessionId: "s", runId: "r" });
    const event = emitted[0];
    assert.ok(event?.type === "hook.error");
    assert.equal(event.owner, "pkg-c");
  });

  it("registrations_listed_in_execution_order", async () => {
    const real = createHookBus();
    const seen: string[] = [];
    const record = (label: string) => (message: Message) => {
      seen.push(label);
      return message;
    };
    // Load order: pkg-a, pkg-b, host. Priority wins first; ties run in registration order.
    real.registrar("pkg-a").on("message.append", record("a-low"), { priority: 0 });
    real.registrar("pkg-a").on("message.append", record("a-high"), { priority: 5 });
    real.registrar("pkg-b").on("message.append", record("b-high"), { priority: 5 });
    real.registrar("host").on("message.append", record("host-low"), { priority: 0 });
    await real.transform("message.append", userMessage("hi"));
    const listed = real.registrations().filter((registration) => registration.name === "message.append");
    assert.deepEqual(seen, ["a-high", "b-high", "a-low", "host-low"]);
    assert.deepEqual(
      listed.map((registration) => [registration.owner, registration.priority]),
      [
        ["pkg-a", 5],
        ["pkg-b", 5],
        ["pkg-a", 0],
        ["host", 0],
      ],
    );
  });

  it("remove_unregisters_one_id", async () => {
    const real = createHookBus();
    let fired = 0;
    real.registrar("host").on(
      "tool.call",
      () => {
        fired += 1;
        return undefined;
      },
      { id: "net" },
    );
    real.registrar("host").on("tool.call", () => undefined, { id: "keep" });
    const payload = { name: "t", args: {}, effects: [], callId: "c", sessionId: "s", runId: "r" };
    await real.decide("tool.call", payload);
    assert.equal(fired, 1);
    assert.equal(real.remove("host:tool.call#net"), true);
    await real.decide("tool.call", payload);
    assert.equal(fired, 1);
    assert.equal(real.remove("host:tool.call#net"), false);
    assert.deepEqual(
      real.registrations().map((registration) => registration.id),
      ["host:tool.call#keep"],
    );
    // The removed id is free again, and removing the last registration clears `has`.
    real.registrar("host").on("tool.call", () => undefined, { id: "net" });
    assert.equal(real.remove("host:tool.call#net"), true);
    assert.equal(real.remove("host:tool.call#keep"), true);
    assert.equal(real.has("tool.call"), false);
  });

  it("catalog marks kinds", () => {
    assert.equal(HOOK_CATALOG["run.input"]?.kind, "transform");
    assert.equal(HOOK_CATALOG["tool.call"]?.kind, "decide");
    assert.equal(HOOK_CATALOG["model.call"]?.kind, "around");
    assert.equal(HOOK_CATALOG["message.delta"]?.kind, "observe");
    assert.equal(HOOK_CATALOG["hook.error"]?.kind, "observe");
    assert.equal(HOOK_CATALOG["package.event"]?.kind, "observe");
  });
});
