import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CompactionContext,
  type CompactionResult,
  createAgent,
  createMiddlewareRegistry,
  createMockProvider,
  type ExtensionEvent,
  providerDone,
} from "../index.js";

const model = { provider: "mock", model: "demo" };

function recordingStrategy(): {
  readonly contexts: CompactionContext[];
  readonly strategy: { readonly name: string; compact(context: CompactionContext): CompactionResult };
} {
  const contexts: CompactionContext[] = [];
  return {
    contexts,
    strategy: {
      name: "recording",
      compact(context) {
        contexts.push(context);
        return { summary: `summarized ${context.entries.length} entries` };
      },
    },
  };
}

describe("compaction_request middleware", () => {
  it("hands the rewritten context to the strategy and to the post-compaction hook", async () => {
    const middleware = createMiddlewareRegistry();
    const seen: CompactionContext[] = [];
    const { contexts, strategy } = recordingStrategy();
    middleware.use("compaction_request", (context: CompactionContext, next) =>
      next({ ...context, entries: context.entries.slice(0, 1), metadata: { ...context.metadata, rewritten: true } }),
    );
    middleware.use("compaction", (payload: { readonly context: CompactionContext }, next) => {
      seen.push(payload.context);
      return next(payload);
    });
    const provider = createMockProvider([providerDone()]);
    const session = createAgent({ model, provider, middleware }).createSession({ id: "s1" });
    await session.run("old");

    await session.compact({ strategy, keepRecentEntries: 0 });

    assert.equal(contexts.length, 1);
    assert.equal(contexts[0]?.entries.length, 1);
    assert.equal(contexts[0]?.metadata?.rewritten, true);
    // Post-strategy hook observes the strategy's actual input, not the pre-rewrite context.
    assert.deepEqual(seen, contexts);
  });

  it("passes an identical context when no handler is registered", async () => {
    const { contexts, strategy } = recordingStrategy();
    const provider = createMockProvider([providerDone()]);
    const session = createAgent({ model, provider }).createSession({ id: "s1" });
    await session.run("old");

    await session.compact({ strategy, keepRecentEntries: 0, metadata: { tag: "manual" } });

    const context = contexts[0];
    assert.ok(context);
    assert.equal(context.sessionId, "s1");
    assert.equal(context.keepRecentEntries, 0);
    assert.equal(context.trigger, "manual");
    assert.deepEqual(context.metadata, { tag: "manual" });
    assert.equal(context.entries.length > 0, true);
    assert.equal(
      context.entries.every((entry) => entry.kind === "message"),
      true,
    );
  });

  it("dispatches on the auto-compaction route too", async () => {
    const middleware = createMiddlewareRegistry();
    const { contexts, strategy } = recordingStrategy();
    let requests = 0;
    middleware.use("compaction_request", (context: CompactionContext, next) => {
      requests += 1;
      return next(context);
    });
    const provider = createMockProvider([providerDone(), providerDone()]);
    const session = createAgent({
      model,
      provider,
      middleware,
      compaction: { thresholdEntries: 0, strategy, keepRecentEntries: 0 },
    }).createSession({ id: "s1" });

    await session.run("old");
    await session.run("new");

    assert.equal(requests >= 1, true);
    assert.equal(contexts.length, requests);
    assert.equal(
      contexts.some((context) => context.trigger === "auto"),
      true,
    );
  });

  it("is not dispatched on ordinary turns without a compaction", async () => {
    const middleware = createMiddlewareRegistry();
    let requests = 0;
    middleware.use("compaction_request", (context: CompactionContext, next) => {
      requests += 1;
      return next(context);
    });
    const provider = createMockProvider([providerDone(), providerDone()]);
    const session = createAgent({ model, provider, middleware, compaction: { thresholdEntries: 50 } }).createSession({ id: "s1" });

    await session.run("hi");
    await session.run("again");

    assert.equal(requests, 0);
    assert.equal(
      (await session.entries()).some((entry) => entry.kind === "compaction"),
      false,
    );
  });

  it("honors the event error policy: a throwing handler is reported and compaction proceeds", async () => {
    const errors: ExtensionEvent[] = [];
    const middleware = createMiddlewareRegistry({ onError: (event) => void errors.push(event) });
    const { contexts, strategy } = recordingStrategy();
    middleware.use("compaction_request", () => {
      throw new Error("hook boom");
    });
    const provider = createMockProvider([providerDone()]);
    const session = createAgent({ model, provider, middleware }).createSession({ id: "s1" });
    await session.run("old");

    const result = await session.compact({ strategy, keepRecentEntries: 0 });

    assert.equal(result.summary, `summarized ${contexts[0]?.entries.length} entries`);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.type, "extension_error");
  });

  it("honors the throw error policy: compaction fails instead of silently skipping the rewrite", async () => {
    const middleware = createMiddlewareRegistry({ errorPolicy: "throw" });
    const { contexts, strategy } = recordingStrategy();
    middleware.use("compaction_request", () => {
      throw new Error("hook boom");
    });
    const provider = createMockProvider([providerDone()]);
    const session = createAgent({ model, provider, middleware }).createSession({ id: "s1" });
    await session.run("old");

    await assert.rejects(() => session.compact({ strategy, keepRecentEntries: 0 }), /hook boom/);
    assert.equal(contexts.length, 0);
    assert.equal(
      (await session.entries()).some((entry) => entry.kind === "compaction"),
      false,
    );
  });

  it("a handler returning undefined without next() leaves the original context in place", async () => {
    const middleware = createMiddlewareRegistry();
    const { contexts, strategy } = recordingStrategy();
    middleware.use("compaction_request", (() => undefined) as unknown as Parameters<typeof middleware.use>[1]);
    const provider = createMockProvider([providerDone()]);
    const session = createAgent({ model, provider, middleware }).createSession({ id: "s1" });
    await session.run("old");

    await session.compact({ strategy, keepRecentEntries: 0 });

    assert.equal(contexts[0]?.keepRecentEntries, 0);
    assert.equal(contexts[0]?.trigger, "manual");
  });
});
