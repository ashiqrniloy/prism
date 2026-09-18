// Plan 079 Task 2: executable evidence for the channel contracts, authorization and Prism
// execution adapter. Run explicitly (the nested-suite glob caveat recorded in the Task 1
// review):
//   node --test "packages/prism-core/dist/integrations/channels/__tests__/runtime.test.js"
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  type Agent,
  type AgentIdentity,
  type AIProvider,
  createAgent,
  createMemoryCheckpointStore,
  createMemoryLeaseStore,
  createMemorySessionStore,
  createSecretRedactor,
  createSecureAgent,
  createStaticPermissionPolicy,
  createStaticTrustPolicy,
  type LeaseStore,
  type Message,
  type OwnershipScope,
  ownershipFromIdentity,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type SessionStore,
  toolCallContent,
} from "@arnilo/prism";
import { createChannelStateStore, createMessagingRuntime } from "../index.js";
import type {
  ChannelAdmission,
  ChannelAttachmentRef,
  ChannelAuthorization,
  ChannelInboundEvent,
  ChannelReply,
  MessagingRuntime,
  MessagingRuntimeOptions,
} from "../types.js";

const CONNECTION = "tg-1";
const CHAT = "chat-1";
const ACTOR = "user-1";

function identity(userId = "user-1", tenantId = "tenant-1"): AgentIdentity {
  return {
    tenantId,
    userId,
    principal: { kind: "user", id: userId },
    scopes: ["chat"],
    issuedAt: new Date(0).toISOString(),
    verified: true,
  };
}

function authorization(overrides: Partial<ChannelAuthorization> = {}): ChannelAuthorization {
  return { identity: identity(), agentAliases: ["primary"], grantRevision: "rev-1", ...overrides };
}

function event(overrides: Partial<ChannelInboundEvent> = {}): ChannelInboundEvent {
  return {
    connectionId: CONNECTION,
    externalConversationId: CHAT,
    externalActorId: ACTOR,
    eventId: "1",
    text: "hello",
    ...overrides,
  };
}

function textProvider(calls: { count: number }, text: (turn: number) => string): AIProvider {
  return {
    id: "mock",
    async *generate() {
      calls.count += 1;
      yield providerTextDelta(text(calls.count));
      yield providerDone();
    },
  };
}

/** Session store wrapper that records every session id the runtime binds to. */
function trackingStore(ids: Set<string>): SessionStore {
  const inner = createMemorySessionStore();
  return {
    append: async (entry, options) => {
      ids.add(entry.sessionId);
      await inner.append(entry, options);
    },
    list: (sessionId) => inner.list(sessionId),
  };
}

function agentWith(provider: AIProvider, store: SessionStore, tools: Parameters<typeof createAgent>[0]["tools"] = []): Agent {
  return createAgent({
    id: "channel-agent",
    model: { provider: "mock", model: "demo" },
    provider,
    store,
    ...(tools === undefined ? {} : { tools }),
  });
}

interface Harness {
  readonly runtime: MessagingRuntime;
  readonly delivered: ChannelReply[];
  readonly resolvedAliases: string[];
}

function harness(options: Partial<MessagingRuntimeOptions> & { agent: Agent; authorization?: ChannelAuthorization | false }): Harness {
  const delivered: ChannelReply[] = [];
  const resolvedAliases: string[] = [];
  const runtime = createMessagingRuntime({
    authorize: () => options.authorization ?? authorization(),
    resolveAgent: ({ agentAlias }) => {
      resolvedAliases.push(agentAlias);
      return options.agent;
    },
    deliver: (reply) => {
      delivered.push(reply);
      return { delivered: true };
    },
    ...options,
  });
  return { runtime, delivered, resolvedAliases };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("plan 080 group and topic ownership", () => {
  it("admits only the exactly granted (chat, thread, sender) tuple and rejects forwarded claims", async () => {
    const calls = { count: 0 };
    const ids = new Set<string>();
    const store = trackingStore(ids);
    const grants = new Set(["chat-g|77|user-1", "chat-g|88|user-1"]);
    const { runtime, delivered } = harness({
      agent: agentWith(
        textProvider(calls, () => "group answer"),
        store,
      ),
      authorize: (input) =>
        input.claims?.forwarded === true || !grants.has(`${input.externalConversationId}|${input.threadId ?? "-"}|${input.externalActorId}`)
          ? false
          : authorization(),
    });
    const group = (overrides: Partial<ChannelInboundEvent>): ChannelInboundEvent =>
      event({ externalConversationId: "chat-g", threadId: "77", ...overrides });

    assert.equal((await runtime.admit(group({ eventId: "1" }))).status, "accepted");
    assert.deepEqual(await runtime.admit(group({ eventId: "2", externalActorId: "user-2" })), {
      status: "denied",
      reason: "rejected",
    });
    assert.deepEqual(await runtime.admit(event({ eventId: "3", externalConversationId: "chat-other", threadId: "77" })), {
      status: "denied",
      reason: "rejected",
    });
    assert.deepEqual(await runtime.admit(event({ eventId: "4", externalConversationId: "chat-g" })), {
      status: "denied",
      reason: "rejected",
    });
    assert.deepEqual(await runtime.admit(group({ eventId: "5", threadId: "78" })), { status: "denied", reason: "rejected" });
    assert.deepEqual(
      await runtime.admit(group({ eventId: "6", claims: { platform: "telegram", chatType: "supergroup", forwarded: true } })),
      { status: "denied", reason: "rejected" },
    );
    assert.equal((await runtime.admit(group({ eventId: "7", threadId: "88" }))).status, "accepted");
    await runtime.drain();

    assert.equal(calls.count, 2);
    assert.equal(ids.size, 2);
    assert.deepEqual(
      delivered
        .map((reply) => [reply.externalConversationId, reply.threadId, reply.text])
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
      [
        ["chat-g", "77", "group answer"],
        ["chat-g", "88", "group answer"],
      ],
    );
    await runtime.stop();
  });
});

describe("plan 080 Telegram draft streaming", () => {
  it("forwards redacted cumulative previews while journaling only the terminal reply", async () => {
    const previews: Array<{ text: string; chat: string; threadId?: string }> = [];
    const checkpoints = createMemoryCheckpointStore();
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        yield providerTextDelta("answer ");
        await delay(5);
        yield providerTextDelta("sk-live-secret");
        await delay(5);
        yield providerTextDelta(" done");
        yield providerDone();
      },
    };
    const { runtime, delivered } = harness({
      agent: agentWith(provider, createMemorySessionStore()),
      checkpoints,
      redactor: createSecretRedactor(["sk-live-secret"]),
      onAssistantDelta: (delta) => {
        previews.push({
          text: delta.text,
          chat: delta.externalConversationId,
          ...(delta.threadId === undefined ? {} : { threadId: delta.threadId }),
        });
      },
    });

    assert.equal((await runtime.admit(event({ threadId: "77" }))).status, "accepted");
    await runtime.drain();

    assert.ok(previews.length >= 3, "a preview is forwarded while the answer is produced");
    assert.deepEqual(previews.at(-1), { text: "answer [REDACTED] done", chat: CHAT, threadId: "77" });
    assert.ok(
      previews.every((preview) => !preview.text.includes("sk-live-secret")),
      "previews use the reply redactor",
    );
    assert.deepEqual(
      delivered.map((reply) => [reply.kind, reply.text]),
      [["final", "answer [REDACTED] done"]],
    );
    const replies = await checkpoints.listCheckpoints({ namespace: "prism.channels.v1.reply" });
    const journaled = replies.items[0];
    assert.equal(replies.items.length, 1, "a preview is never a journaled reply");
    assert.equal((journaled?.value as { kind?: string } | undefined)?.kind, "final");
    await runtime.stop();
  });

  it("stops previewing after cancellation and never delivers a final reply for an aborted run", async () => {
    const previews: string[] = [];
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        yield providerTextDelta("partial");
        await new Promise<void>((resolve) => {
          if (request.signal?.aborted) {
            resolve();
            return;
          }
          request.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        yield providerTextDelta(" after abort");
        throw new Error("aborted by user");
      },
    };
    const { runtime, delivered } = harness({
      agent: agentWith(provider, createMemorySessionStore()),
      onAssistantDelta: (delta) => previews.push(delta.text),
    });

    assert.equal((await runtime.admit(event({ eventId: "1" }))).status, "accepted");
    await delay(5);
    assert.equal((await runtime.admit(event({ eventId: "2", text: "/cancel" }))).status, "accepted");
    await runtime.drain();

    assert.deepEqual(previews, ["partial"], "cancellation stops previews immediately");
    assert.equal(delivered.filter((reply) => reply.kind === "final").length, 0, "an aborted run never becomes a terminal channel reply");
    await runtime.stop();
  });
});

describe("plan 079 channel runtime", () => {
  it("runs an authorized turn through the owned session and delivers only the current answer", async () => {
    const calls = { count: 0 };
    const ids = new Set<string>();
    const store = trackingStore(ids);
    const { runtime, delivered } = harness({
      agent: agentWith(
        textProvider(calls, (turn) => `answer ${turn}`),
        store,
      ),
    });

    const first = await runtime.admit(event());
    assert.equal(first.status, "accepted");
    assert.ok(first.operationId?.startsWith("chan-op-"));
    const drained = await runtime.drain();
    assert.equal(drained.settled, true);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0]?.kind, "final");
    assert.equal(delivered[0]?.text, "answer 1");
    assert.equal(delivered[0]?.connectionId, CONNECTION);
    assert.equal(delivered[0]?.inReplyTo, "1");
    assert.equal(ids.size, 1);
    const sessionId = [...ids][0];
    assert.ok(sessionId !== undefined);
    assert.equal((await store.list(sessionId)).length, 2);

    // Exact transport retry: acknowledged as a duplicate, no second provider turn.
    const retry = await runtime.admit(event());
    assert.equal(retry.status, "accepted");
    assert.equal(retry.duplicate, true);
    await runtime.drain();
    assert.equal(calls.count, 1);
    assert.equal(delivered.length, 1);
    assert.equal(runtime.diagnostics().duplicates, 1);
    await runtime.stop();
  });

  it("denies unknown, malformed, oversized and ungranted-alias events with zero provider calls", async () => {
    const calls = { count: 0 };
    const toolCalls = { count: 0 };
    const store = createMemorySessionStore();
    const agent = agentWith(
      textProvider(calls, () => "never"),
      store,
      [{ name: "write", parameters: { type: "object" }, execute: () => ({ toolCallId: "c", name: "write", value: ++toolCalls.count }) }],
    );
    let authorizeCalls = 0;
    const denied = createMessagingRuntime({
      authorize: () => {
        authorizeCalls += 1;
        return false;
      },
      resolveAgent: () => agent,
      deliver: () => ({ delivered: true }),
    });
    assert.deepEqual(await denied.admit(event()), { status: "denied", reason: "rejected" });
    assert.equal(authorizeCalls, 1);

    const { runtime, delivered } = harness({ agent });
    assert.deepEqual(await runtime.admit(event({ connectionId: "" })), { status: "denied", reason: "malformed" });
    assert.deepEqual(await runtime.admit(event({ text: "x".repeat(64 * 1024 + 1) })), { status: "denied", reason: "oversized" });
    assert.equal(authorizeCalls, 1, "malformed and oversized events never reach host authorization");

    const ungranted = harness({
      agent,
      authorization: authorization({ agentAliases: ["primary"], defaultAgentAlias: "primary" }),
    });
    assert.deepEqual(await ungranted.runtime.admit(event({ text: "/agent secondary" })), {
      status: "unsupported",
      reason: "unknown_alias",
    });
    const noAlias = harness({ agent, authorization: authorization({ agentAliases: [] }) });
    assert.deepEqual(await noAlias.runtime.admit(event()), { status: "denied", reason: "rejected" });

    // Partial or malformed host grants fail closed instead of throwing inside admit.
    for (const grant of [
      { identity: identity() },
      { identity: identity(), agentAliases: ["primary"], grantRevision: "" },
      { identity: identity(), agentAliases: "primary" as unknown as string[], grantRevision: "rev-1" },
    ]) {
      const partial = harness({ agent, authorization: grant as ChannelAuthorization });
      assert.equal((await partial.runtime.admit(event())).status, "denied");
      await partial.runtime.drain();
      assert.equal(partial.delivered.length, 0);
    }
    assert.deepEqual(await runtime.admit(event({ threadId: 5 as unknown as string })), { status: "denied", reason: "malformed" });

    await denied.drain();
    await runtime.drain();
    await ungranted.runtime.drain();
    await noAlias.runtime.drain();
    assert.equal(calls.count, 0);
    assert.equal(toolCalls.count, 0);
    assert.equal(delivered.length, 0);
  });

  it("ignores event-claimed ownership and binds the run to the host-verified identity", async () => {
    const calls = { count: 0 };
    const secureIdentity = identity();
    const agent = createSecureAgent({
      id: "channel-secure",
      model: { provider: "mock", model: "demo" },
      provider: textProvider(calls, () => "secure answer"),
      store: createMemorySessionStore(),
      tools: [],
      toolArgumentValidator: { validate: () => ({ ok: true }) },
      redactor: createSecretRedactor(["secret"]),
      permission: createStaticPermissionPolicy({ allow: [] }),
      trust: createStaticTrustPolicy(true),
      ownership: { tenantId: "tenant-1", userId: "user-1" },
      identity: secureIdentity,
      limits: { maxTurns: 2 },
      definitionRevision: "1",
      runState: { checkpoints: createMemoryCheckpointStore() },
    });
    const { runtime, delivered } = harness({
      agent,
      authorization: authorization({ identity: secureIdentity }),
    });
    const admitted = await runtime.admit(event({ claims: { tenantId: "tenant-evil", userId: "user-evil", agentAlias: "root" } }));
    assert.equal(admitted.status, "accepted");
    await runtime.drain();
    assert.equal(calls.count, 1, "a forged claim cannot prevent or redirect the verified run");
    assert.equal(delivered[0]?.text, "secure answer");
    await runtime.stop();
  });

  it("isolates tenants with identical external ids and the same actor across connections", async () => {
    const calls = { count: 0 };
    const ids = new Set<string>();
    const store = trackingStore(ids);
    const agent = agentWith(
      textProvider(calls, () => "ok"),
      store,
    );
    const { runtime } = harness({
      agent,
      authorize: (input) => authorization({ identity: identity("user-1", input.connectionId === "tg-b" ? "tenant-2" : "tenant-1") }),
    });
    assert.equal((await runtime.admit(event({ connectionId: "tg-a", eventId: "1" }))).status, "accepted");
    assert.equal((await runtime.admit(event({ connectionId: "tg-b", eventId: "1" }))).status, "accepted");
    // Same connection, tenant and actor: the next turn continues the first binding.
    assert.equal((await runtime.admit(event({ connectionId: "tg-a", eventId: "2" }))).status, "accepted");
    // Same tenant and actor on another connection: a separate binding.
    assert.equal((await runtime.admit(event({ connectionId: "tg-c", eventId: "1" }))).status, "accepted");
    await runtime.drain();

    assert.equal(ids.size, 3, "tenant and connection scoping keep the derived session ids distinct");
    const lengths: number[] = [];
    for (const sessionId of ids) lengths.push((await store.list(sessionId)).length);
    assert.deepEqual(
      lengths.sort((left, right) => left - right),
      [2, 2, 4],
      "each binding owns only its own turns",
    );
    assert.equal(calls.count, 4);
    await runtime.stop();
  });

  it("serializes turns per logical session and carries the branch leaf forward", async () => {
    const calls = { count: 0 };
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let concurrent = 0;
    let peak = 0;
    const ids = new Set<string>();
    const store = trackingStore(ids);
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        calls.count += 1;
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        if (calls.count === 1) await gate;
        yield providerTextDelta(`answer ${calls.count}`);
        concurrent -= 1;
        yield providerDone();
      },
    };
    const { runtime, delivered } = harness({ agent: agentWith(provider, store) });
    assert.equal((await runtime.admit(event({ eventId: "1" }))).status, "accepted");
    assert.equal((await runtime.admit(event({ eventId: "2", text: "second" }))).status, "accepted");
    await delay(10);
    assert.equal(calls.count, 1, "the second turn waits for the first on the same logical session");
    release?.();
    await runtime.drain();
    assert.equal(calls.count, 2);
    assert.equal(peak, 1);
    assert.deepEqual(
      delivered.map((reply) => reply.text),
      ["answer 1", "answer 2"],
    );
    const sessionId = [...ids][0];
    assert.ok(sessionId !== undefined);
    assert.equal(ids.size, 1);
    assert.equal((await store.list(sessionId)).length, 4, "the second turn continued the same branch");
    await runtime.stop();
  });

  it("cancels queued work and active work through control commands", async () => {
    const calls = { count: 0 };
    const store = createMemorySessionStore();
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        calls.count += 1;
        yield providerTextDelta("partial answer");
        await new Promise<void>((resolve) => {
          if (request.signal?.aborted) {
            resolve();
            return;
          }
          request.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new Error("aborted by user");
      },
    };
    const { runtime, delivered } = harness({ agent: agentWith(provider, store) });
    assert.equal((await runtime.admit(event({ eventId: "1" }))).status, "accepted");
    await delay(5);
    assert.equal((await runtime.admit(event({ eventId: "2" }))).status, "accepted");
    assert.equal((await runtime.admit(event({ eventId: "3", text: "/cancel" }))).status, "accepted");
    await runtime.drain();
    assert.equal(calls.count, 1, "a queued turn cancelled before its slot never reaches the provider");
    assert.equal(runtime.diagnostics().cancelled, 2, "the active turn and the queued turn are both cancelled");
    assert.equal(
      delivered.some((reply) => reply.text === "Cancelling the current request and 1 queued request."),
      true,
    );
    assert.equal(
      delivered.some((reply) => reply.text === "Request cancelled."),
      true,
    );
    assert.equal(
      delivered.some((reply) => reply.text === "Request cancelled before it started."),
      true,
    );
    assert.equal(
      delivered.some((reply) => reply.text.includes("partial answer")),
      false,
      "partial deltas are never delivered as a final answer",
    );

    // Idle binding: /cancel is a bounded no-op, not a deadlock or a model call.
    const idle = harness({
      agent: agentWith(
        textProvider({ count: 0 }, () => "never"),
        createMemorySessionStore(),
      ),
    });
    assert.equal((await idle.runtime.admit(event({ text: "/cancel" }))).status, "accepted");
    await idle.runtime.drain();
    assert.equal(idle.delivered[0]?.text, "Nothing to cancel.");
    await runtime.stop();
    await idle.runtime.stop();
  });

  it("never reuses a previous turn's text on failure and redacts the failure notice", async () => {
    const store = createMemorySessionStore();
    let turn = 0;
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        turn += 1;
        if (turn === 2) throw new Error("provider failed with secret-token");
        yield providerTextDelta(`answer ${turn}`);
        yield providerDone();
      },
    };
    const { runtime, delivered } = harness({
      agent: agentWith(provider, store),
      redactor: createSecretRedactor(["secret-token"]),
    });
    assert.equal((await runtime.admit(event({ eventId: "1" }))).status, "accepted");
    await runtime.drain();
    assert.equal((await runtime.admit(event({ eventId: "2", text: "again" }))).status, "accepted");
    await runtime.drain();

    const failed = delivered.filter((reply) => reply.kind === "notice");
    assert.equal(failed.length, 1);
    assert.equal(failed[0]?.text.includes("answer 1"), false, "a failed run never resends the previous answer");
    assert.equal(failed[0]?.text.includes("secret-token"), false, "failure notices are redacted");
    assert.match(failed[0]?.text ?? "", /^Request failed:/);
    assert.equal(runtime.diagnostics().failed, 1);
    assert.equal(runtime.diagnostics().completed, 1);
    await runtime.stop();
  });

  it("denies revoked identities before work and re-checks before sending", async () => {
    const calls = { count: 0 };
    const store = createMemorySessionStore();
    const revoked = identity();
    const revokedIdentity: AgentIdentity = { ...revoked, revokedAt: new Date(1).toISOString() };
    const revokedHarness = harness({
      agent: agentWith(
        textProvider(calls, () => "never"),
        store,
      ),
      authorization: authorization({ identity: revokedIdentity }),
    });
    assert.deepEqual(await revokedHarness.runtime.admit(event()), { status: "denied", reason: "revoked" });
    assert.equal(calls.count, 0);
    assert.equal(revokedHarness.delivered.length, 0);

    // Revocation between provider start and delivery: the answer is not sent.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const revocation: { revokedAt?: string } = {};
    const live: AgentIdentity = {
      ...identity(),
      get revokedAt() {
        return revocation.revokedAt;
      },
    };
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        calls.count += 1;
        yield providerTextDelta("answer before revocation");
        await gate;
        yield providerDone();
      },
    };
    const liveHarness = harness({ agent: agentWith(provider, store), authorization: authorization({ identity: live }) });
    assert.equal((await liveHarness.runtime.admit(event())).status, "accepted");
    await delay(5);
    revocation.revokedAt = new Date(1).toISOString();
    await release?.();
    await liveHarness.runtime.drain();
    assert.equal(liveHarness.delivered.length, 0, "no reply is sent after the grant is revoked");
    assert.equal(liveHarness.runtime.diagnostics().failed, 1);
    await revokedHarness.runtime.stop();
    await liveHarness.runtime.stop();
  });

  it("composes with a secure agent and contains an identity mismatch as a bounded failure", async () => {
    const calls = { count: 0 };
    const toolCalls = { count: 0 };
    const secure = createSecureAgent({
      id: "channel-secure",
      model: { provider: "mock", model: "demo" },
      provider: textProvider(calls, () => "secure answer"),
      store: createMemorySessionStore(),
      tools: [
        { name: "write", parameters: { type: "object" }, execute: () => ({ toolCallId: "c", name: "write", value: ++toolCalls.count }) },
      ],
      toolArgumentValidator: { validate: () => ({ ok: true }) },
      redactor: createSecretRedactor(["secret"]),
      permission: createStaticPermissionPolicy({ allow: ["write"] }),
      trust: createStaticTrustPolicy(true),
      ownership: { tenantId: "tenant-1", userId: "user-1" },
      identity: identity(),
      limits: { maxTurns: 2 },
      definitionRevision: "1",
      runState: { checkpoints: createMemoryCheckpointStore() },
    });

    const matching = harness({ agent: secure });
    assert.equal((await matching.runtime.admit(event())).status, "accepted");
    await matching.runtime.drain();
    assert.equal(calls.count, 1);
    assert.equal(matching.delivered[0]?.text, "secure answer");

    const mismatched = harness({ agent: secure, authorization: authorization({ identity: identity("user-9", "tenant-9") }) });
    assert.equal((await mismatched.runtime.admit(event({ eventId: "2" }))).status, "accepted");
    await mismatched.runtime.drain();
    assert.equal(calls.count, 1, "the mismatched identity never reaches the provider");
    assert.equal(toolCalls.count, 0);
    assert.match(mismatched.delivered[0]?.text ?? "", /^Request failed:/);
    assert.equal(mismatched.runtime.diagnostics().failed, 1);
    await matching.runtime.stop();
    await mismatched.runtime.stop();
  });

  it("keeps controls responsive while the run queue is busy and keeps arbitrary slash input inert", async () => {
    const calls = { count: 0 };
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        calls.count += 1;
        await gate;
        yield providerTextDelta("answer");
        yield providerDone();
      },
    };
    const { runtime, delivered } = harness({ agent: agentWith(provider, createMemorySessionStore()) });
    assert.equal((await runtime.admit(event({ eventId: "1" }))).status, "accepted");
    await delay(5);

    const raced = await Promise.race([runtime.admit(event({ eventId: "2", text: "/status" })), delay(50).then(() => "timeout" as const)]);
    assert.notEqual(raced, "timeout", "controls answer while the binding has an active run");
    assert.equal((await runtime.admit(event({ eventId: "3", text: "/config set model gpt" }))).status, "unsupported");
    assert.equal((await runtime.admit(event({ eventId: "4", text: "/model gpt" }))).status, "unsupported");
    assert.equal((await runtime.admit(event({ eventId: "5", text: "/" }))).status, "unsupported");
    assert.equal((await runtime.admit(event({ eventId: "6", text: "/new" }))).status, "accepted");
    release?.();
    await runtime.drain();
    assert.equal(calls.count, 1, "no slash/config input invoked a model");
    assert.equal(
      delivered.some((reply) => reply.text.includes("state: running")),
      true,
    );
    assert.equal(
      delivered.some((reply) => reply.text.includes("Finish or cancel")),
      true,
    );
    assert.equal(runtime.diagnostics().unsupported, 3);
    await runtime.stop();
  });

  it("applies /new and alias selection to future bindings", async () => {
    const calls = { count: 0 };
    const ids = new Set<string>();
    const store = trackingStore(ids);
    const agent = agentWith(
      textProvider(calls, (turn) => `answer ${turn}`),
      store,
    );
    const { runtime, resolvedAliases } = harness({
      agent,
      authorization: authorization({ agentAliases: ["primary", "research"], defaultAgentAlias: "primary" }),
    });
    assert.equal((await runtime.admit(event({ eventId: "1" }))).status, "accepted");
    await runtime.drain();
    assert.equal((await runtime.admit(event({ eventId: "2", text: "/new" }))).status, "accepted");
    assert.equal((await runtime.admit(event({ eventId: "3", text: "after new" }))).status, "accepted");
    await runtime.drain();
    assert.equal(ids.size, 2, "/new binds the next turn to a fresh session");
    for (const sessionId of ids) assert.equal((await store.list(sessionId)).length, 2);

    assert.equal((await runtime.admit(event({ eventId: "4", text: "/agent research" }))).status, "accepted");
    assert.equal((await runtime.admit(event({ eventId: "5", text: "for research" }))).status, "accepted");
    await runtime.drain();
    assert.deepEqual(resolvedAliases, ["primary", "primary", "research"]);
    assert.equal(calls.count, 3);
    await runtime.stop();
  });

  it("fails closed on capacity without evicting accepted work", async () => {
    const calls = { count: 0 };
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: AIProvider = {
      id: "mock",
      async *generate() {
        calls.count += 1;
        await gate;
        yield providerTextDelta("answer");
        yield providerDone();
      },
    };
    const { runtime, delivered } = harness({
      agent: agentWith(provider, createMemorySessionStore()),
      limits: { maxPendingPerBinding: 1, maxRoutes: 1 },
    });
    assert.equal((await runtime.admit(event({ eventId: "1" }))).status, "accepted");
    await delay(5);
    assert.equal((await runtime.admit(event({ eventId: "2" }))).status, "accepted");
    assert.deepEqual(await runtime.admit(event({ eventId: "3" })), { status: "denied", reason: "capacity" });
    assert.deepEqual(await runtime.admit(event({ eventId: "4", externalActorId: "other" })), {
      status: "denied",
      reason: "capacity",
    });
    release?.();
    await runtime.drain();
    assert.equal(calls.count, 2, "previously accepted work still ran after the capacity denials");
    assert.equal(delivered.filter((reply) => reply.kind === "final").length, 2);
    await runtime.stop();
  });

  it("stops bounded with an active run and queued or slot-waiting work", async () => {
    const calls = { count: 0 };
    const provider: AIProvider = {
      id: "mock",
      async *generate(request) {
        calls.count += 1;
        await new Promise<void>((resolve) => {
          if (request.signal?.aborted) {
            resolve();
            return;
          }
          request.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        throw new Error("aborted by host shutdown");
      },
    };
    const { runtime } = harness({ agent: agentWith(provider, createMemorySessionStore()), limits: { maxActiveSessions: 1 } });
    // Binding A holds the single active slot; binding B waits for it; binding A also has a queued turn.
    assert.equal((await runtime.admit(event({ eventId: "a1", externalActorId: "actor-a" }))).status, "accepted");
    assert.equal((await runtime.admit(event({ eventId: "a2", externalActorId: "actor-a" }))).status, "accepted");
    assert.equal((await runtime.admit(event({ eventId: "b1", externalActorId: "actor-b" }))).status, "accepted");
    await delay(5);
    assert.equal(runtime.diagnostics().queued, 1);
    assert.equal(runtime.diagnostics().active, 1);

    await runtime.stop();
    assert.equal(runtime.diagnostics().queued, 0);
    assert.equal(calls.count, 1, "slot-waiting work never reaches the provider after stop");
    assert.equal(runtime.diagnostics().cancelled, 3, "active, queued and slot-waiting turns are all cancelled");
    assert.deepEqual(await runtime.admit(event({ eventId: "a3" })), { status: "denied", reason: "stopped" });
  });

  it("binds one short-lived approval control through restart and resumes exactly once", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const resumedPreviews: string[] = [];
    const calls = { model: 0, tool: 0 };
    const agent = createAgent({
      id: "channel-approval-agent",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
      provider: {
        id: "mock",
        async *generate() {
          calls.model += 1;
          if (calls.model === 1) {
            yield providerToolCall(toolCallContent("approval-call", "write", {}));
            yield providerDone();
            return;
          }
          yield providerTextDelta("resumed answer");
          yield providerDone();
        },
      },
      tools: [
        {
          name: "write",
          parameters: { type: "object" },
          execute: () => ({ toolCallId: "approval-call", name: "write", value: ++calls.tool }),
        },
      ],
    });
    let currentGrant = authorization();
    const first = harness({ agent, checkpoints, authorize: () => currentGrant });
    assert.equal((await first.runtime.admit(event())).status, "accepted");
    await first.runtime.drain();
    const control = first.delivered[0]?.controls?.find((entry) => entry.label === "Allow once");
    assert.ok(control !== undefined);
    const token = control.value.split(":")[2];
    assert.ok(token !== undefined);

    // A forwarded or revoked button cannot select a decision, and stopping does not discard durable state.
    currentGrant = authorization({ identity: { ...identity(), revokedAt: new Date().toISOString() } });
    assert.deepEqual(await first.runtime.admit(event({ eventId: "revoked", text: "", approval: { token, outcome: "allow_once" } })), {
      status: "denied",
      reason: "revoked",
    });
    currentGrant = authorization();
    assert.deepEqual(
      await first.runtime.admit(
        event({ eventId: "forwarded", externalActorId: "other", text: "", approval: { token, outcome: "allow_once" } }),
      ),
      { status: "denied", reason: "rejected" },
    );
    await first.runtime.stop();

    const second = harness({
      agent,
      checkpoints,
      onAssistantDelta: (delta) => resumedPreviews.push(delta.text),
    });
    assert.equal((await second.runtime.admit(event({ eventId: "status", text: "/status" }))).status, "accepted");
    await second.runtime.drain();
    assert.match(second.delivered[0]?.text ?? "", /awaiting decision/);
    assert.equal(
      (await second.runtime.admit(event({ eventId: "approved", text: "", approval: { token, outcome: "allow_once" } }))).status,
      "accepted",
    );
    assert.deepEqual(await second.runtime.admit(event({ eventId: "replayed", text: "", approval: { token, outcome: "allow_once" } })), {
      status: "denied",
      reason: "rejected",
    });
    await second.runtime.drain();
    assert.equal(calls.tool, 1);
    assert.equal(calls.model, 2, "duplicate/forwarded controls never resume a second provider turn");
    assert.equal(second.delivered.at(-1)?.text, "resumed answer");
    assert.ok(
      resumedPreviews.some((preview) => preview.includes("resumed answer")),
      "an approved resume previews the answer it produces",
    );
    await second.runtime.stop();
  });

  it("cancels a suspended durable run through core denial without running its tool", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const calls = { model: 0, tool: 0 };
    const agent = createAgent({
      id: "channel-denial-agent",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
      provider: {
        id: "mock",
        async *generate() {
          calls.model += 1;
          yield providerToolCall(toolCallContent("deny-call", "write", {}));
          yield providerDone();
        },
      },
      tools: [
        {
          name: "write",
          parameters: { type: "object" },
          execute: () => ({ toolCallId: "deny-call", name: "write", value: ++calls.tool }),
        },
      ],
    });
    const { runtime, delivered } = harness({ agent, checkpoints });
    assert.equal((await runtime.admit(event())).status, "accepted");
    await runtime.drain();
    assert.equal((await runtime.admit(event({ eventId: "cancel", text: "/cancel" }))).status, "accepted");
    await runtime.drain();
    assert.equal(calls.tool, 0);
    assert.equal(calls.model, 1);
    assert.equal(delivered.at(-1)?.text, "Approval denied. The request will not continue.");
    await runtime.stop();
  });

  it("propagates /cancel into an approved resume without pretending dispatched work rolled back", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let turns = 0;
    let startResume: (() => void) | undefined;
    const resumed = new Promise<void>((resolve) => {
      startResume = resolve;
    });
    let providerAborted = false;
    const agent = createAgent({
      id: "channel-abort-resume-agent",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      runState: { checkpoints, definitionRevision: "1", interruptBeforeTool: true },
      provider: {
        id: "mock",
        async *generate(request) {
          turns += 1;
          if (turns === 1) {
            yield providerToolCall(toolCallContent("abort-call", "write", {}));
            yield providerDone();
            return;
          }
          startResume?.();
          await new Promise<void>((resolve) => {
            request.signal?.addEventListener(
              "abort",
              () => {
                providerAborted = true;
                resolve();
              },
              { once: true },
            );
          });
          throw new Error("provider observed cancellation");
        },
      },
      tools: [
        { name: "write", parameters: { type: "object" }, execute: () => ({ toolCallId: "abort-call", name: "write", value: "done" }) },
      ],
    });
    const { runtime, delivered } = harness({ agent, checkpoints });
    assert.equal((await runtime.admit(event())).status, "accepted");
    await runtime.drain();
    const token = delivered[0]?.controls?.find((control) => control.label === "Allow once")?.value.split(":")[2];
    assert.ok(token !== undefined);
    assert.equal(
      (await runtime.admit(event({ eventId: "approve", text: "", approval: { token, outcome: "allow_once" } }))).status,
      "accepted",
    );
    await resumed;
    assert.equal((await runtime.admit(event({ eventId: "cancel-resume", text: "/cancel" }))).status, "accepted");
    await runtime.drain();
    assert.equal(providerAborted, true);
    assert.equal(turns, 2);
    await runtime.stop();
  });

  it("keeps a failed release lease until stop retries the same token", async () => {
    const store = createMemoryLeaseStore();
    const acquired: string[] = [];
    const released: string[] = [];
    const leases: LeaseStore = {
      ...store,
      async tryAcquireLease(input) {
        const lease = await store.tryAcquireLease(input);
        if (lease !== null) acquired.push(lease.token);
        return lease;
      },
      async releaseLease(input) {
        released.push(input.token);
        if (released.length === 1) throw new Error("release unavailable");
        return store.releaseLease(input);
      },
    };
    const checkpoints = createMemoryCheckpointStore();
    const first = harness({
      agent: agentWith(
        textProvider({ count: 0 }, () => "first"),
        createMemorySessionStore(),
      ),
      checkpoints,
      leases,
    }).runtime;

    assert.equal((await first.admit(event())).status, "accepted");
    await first.drain();
    assert.equal(first.diagnostics().storageFailures, 1);
    const [token] = released;
    assert.ok(token);
    await first.stop();
    assert.deepEqual(released, [token, token]);

    const second = harness({
      agent: agentWith(
        textProvider({ count: 0 }, () => "second"),
        createMemorySessionStore(),
      ),
      checkpoints,
      leases,
    }).runtime;
    assert.equal((await second.admit(event({ eventId: "2" }))).status, "accepted");
    await second.drain();
    assert.equal(acquired.length, 2);
    assert.notEqual(acquired[0], acquired[1]);
    assert.equal(second.diagnostics().storageFailures, 0);
    await second.stop();
  });

  it("does no I/O at construction and reports bounded diagnostics", async () => {
    let touched = 0;
    const runtime = createMessagingRuntime({
      authorize: () => {
        touched += 1;
        throw new Error("authorize must not run");
      },
      resolveAgent: () => {
        touched += 1;
        throw new Error("resolveAgent must not run");
      },
      deliver: () => {
        touched += 1;
        throw new Error("deliver must not run");
      },
    });
    assert.equal(touched, 0, "factory construction resolves no callbacks");
    assert.deepEqual(runtime.diagnostics(), {
      admitted: 0,
      denied: 0,
      unsupported: 0,
      duplicates: 0,
      queued: 0,
      active: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      suspended: 0,
      storageFailures: 0,
      leaseLosses: 0,
      deliveries: 0,
      deliveryFailures: 0,
      truncated: 0,
    });
    assert.deepEqual(await runtime.admit(event({ eventId: "" })), { status: "denied", reason: "malformed" });
    assert.deepEqual(await runtime.admit(event({ text: "x".repeat(32 * 1024 + 1) })), { status: "denied", reason: "oversized" });
    assert.equal(touched, 0);
    await runtime.stop();
    assert.deepEqual(await runtime.admit(event()), { status: "denied", reason: "stopped" });
    assert.deepEqual(runtime.diagnostics(), {
      admitted: 0,
      denied: 3,
      unsupported: 0,
      duplicates: 0,
      queued: 0,
      active: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      suspended: 0,
      storageFailures: 0,
      leaseLosses: 0,
      deliveries: 0,
      deliveryFailures: 0,
      truncated: 0,
    });
  });
});

describe("plan 080 primitive review", () => {
  it("derives different session ids when threadId differs", async () => {
    const ids = new Set<string>();
    const store = trackingStore(ids);
    const { runtime } = harness({
      agent: agentWith(
        textProvider({ count: 0 }, () => "ok"),
        store,
      ),
    });
    assert.equal((await runtime.admit(event({ eventId: "1", threadId: "topic-a", text: "one" }))).status, "accepted");
    assert.equal((await runtime.admit(event({ eventId: "2", threadId: "topic-b", text: "two" }))).status, "accepted");
    await runtime.drain();
    assert.equal(ids.size, 2);
    await runtime.stop();
  });

  it("does not journal a draft reply kind", () => {
    type DraftKind = Extract<ChannelReply["kind"], "draft">;
    const noDraft: [DraftKind] extends [never] ? true : false = true;
    assert.equal(noDraft, true);
    const kinds: ChannelReply["kind"][] = ["final", "notice"];
    assert.deepEqual(kinds, ["final", "notice"]);
  });
});

describe("plan 080 bounded attachments and voice", () => {
  const IMAGE: ChannelAttachmentRef = { kind: "image", transportFileId: "telegram-file-1", byteLength: 4 };

  /** Provider that records the messages it was asked to answer. */
  function capturingProvider(captured: Array<readonly Message[]>, answer = "answer"): AIProvider {
    return {
      id: "mock",
      async *generate(request: ProviderRequest) {
        captured.push(request.messages);
        yield providerTextDelta(answer);
        yield providerDone();
      },
    };
  }

  function visionAgent(provider: AIProvider, imageInput: boolean): Agent {
    return createAgent({
      id: "channel-agent",
      model: {
        provider: "mock",
        model: imageInput ? "vision" : "text-only",
        capabilities: { input: imageInput ? ["text", "image"] : ["text"] },
      },
      provider,
      store: createMemorySessionStore(),
    });
  }

  it("passes an event image to a model that declares image input, from the event ref only", async () => {
    const captured: Array<readonly Message[]> = [];
    const fetched: ChannelAttachmentRef[] = [];
    const { runtime, delivered } = harness({
      agent: visionAgent(capturingProvider(captured, "answer about model-chosen-file-999"), true),
      fetchAttachment: (ref) => {
        fetched.push(ref);
        return Promise.resolve({ bytes: new Uint8Array([1, 2, 3, 4]), mimeType: "image/png" });
      },
    });

    const admission = await runtime.admit(event({ text: "what is this?", attachments: [IMAGE] }));
    await runtime.drain();
    await runtime.stop();

    assert.equal(admission.status, "accepted");
    assert.deepEqual(fetched, [IMAGE], "only the event's own ref is ever fetched, never a model-named id");
    const turn = captured[0]?.at(-1);
    assert.equal(turn?.role, "user");
    assert.deepEqual(turn?.content[0], { type: "text", text: "what is this?" });
    assert.deepEqual(turn?.content[1], { type: "image", mimeType: "image/png", data: Buffer.from([1, 2, 3, 4]).toString("base64") });
    assert.equal(delivered.at(-1)?.text, "answer about model-chosen-file-999");
  });

  it("refuses an image with a bounded notice and no model call when the model declares no image input", async () => {
    const captured: Array<readonly Message[]> = [];
    let fetches = 0;
    const { runtime, delivered } = harness({
      agent: visionAgent(capturingProvider(captured), false),
      fetchAttachment: () => {
        fetches += 1;
        return Promise.resolve({ bytes: new Uint8Array([1]) });
      },
    });

    assert.equal((await runtime.admit(event({ text: "what is this?", attachments: [IMAGE] }))).status, "accepted");
    await runtime.drain();
    const diagnostics = runtime.diagnostics();
    await runtime.stop();

    assert.equal(captured.length, 0);
    assert.equal(fetches, 0);
    assert.equal(diagnostics.unsupported, 1);
    assert.equal(delivered.at(-1)?.kind, "notice");
    assert.match(delivered.at(-1)?.text ?? "", /cannot be processed/);
  });

  it("turns an attachment the adapter could not resolve into a bounded notice without a model call", async () => {
    const captured: Array<readonly Message[]> = [];
    const { runtime, delivered } = harness({
      agent: visionAgent(capturingProvider(captured), true),
      fetchAttachment: () => Promise.resolve(undefined),
    });

    await runtime.admit(event({ text: "", attachments: [IMAGE] }));
    await runtime.drain();
    await runtime.stop();

    assert.equal(captured.length, 0);
    assert.equal(delivered.at(-1)?.kind, "notice");
  });

  it("denies declared attachment bytes above the channel cap before any fetch or model call", async () => {
    const captured: Array<readonly Message[]> = [];
    let fetches = 0;
    const { runtime, delivered } = harness({
      agent: visionAgent(capturingProvider(captured), true),
      fetchAttachment: () => {
        fetches += 1;
        return Promise.resolve({ bytes: new Uint8Array([1]) });
      },
    });

    const admission = await runtime.admit(
      event({ text: "big", attachments: [{ kind: "image", transportFileId: "telegram-file-2", byteLength: 2 * 1024 * 1024 }] }),
    );
    await runtime.drain();
    await runtime.stop();

    assert.deepEqual(admission, { status: "denied", reason: "oversized" });
    assert.equal(fetches, 0);
    assert.equal(captured.length, 0);
    assert.equal(delivered.length, 0);
  });

  it("runs transcribed or extracted attachment text as an ordinary text turn", async () => {
    const captured: Array<readonly Message[]> = [];
    let fetches = 0;
    const { runtime, delivered } = harness({
      agent: visionAgent(capturingProvider(captured), false),
      fetchAttachment: () => {
        fetches += 1;
        return Promise.resolve(undefined);
      },
    });

    await runtime.admit(
      event({
        text: "please summarize this\n\nspoken words",
        attachments: [{ kind: "voice", transportFileId: "telegram-voice-1", mimeType: "audio/ogg", byteLength: 2048 }],
      }),
    );
    await runtime.drain();
    await runtime.stop();

    assert.equal(fetches, 0, "adapter text never re-fetches the attachment");
    assert.equal(captured[0]?.at(-1)?.content[0]?.type, "text");
    assert.equal(delivered.at(-1)?.text, "answer");
  });

  it("rejects malformed attachment refs as malformed without touching media", async () => {
    let fetches = 0;
    const { runtime } = harness({
      agent: visionAgent(capturingProvider([]), true),
      fetchAttachment: () => {
        fetches += 1;
        return Promise.resolve({ bytes: new Uint8Array([1]) });
      },
    });
    const tooMany = Array.from({ length: 9 }, (_, index) => ({
      kind: "image" as const,
      transportFileId: `file-${index}`,
    }));
    const badKind = [{ kind: "video", transportFileId: "file-1" }] as unknown as readonly ChannelAttachmentRef[];

    const declared = await runtime.admit(event({ eventId: "1", attachments: tooMany }));
    const unknown = await runtime.admit(event({ eventId: "2", attachments: badKind }));
    await runtime.stop();

    assert.deepEqual(declared, { status: "denied", reason: "malformed" });
    assert.deepEqual(unknown, { status: "denied", reason: "malformed" });
    assert.equal(fetches, 0);
  });
});

describe("plan 080 proactive opt-in notifications", () => {
  interface NotifyHarness {
    readonly runtime: MessagingRuntime;
    readonly delivered: ChannelReply[];
    readonly calls: { count: number };
    readonly actions: string[];
  }

  /** Runtime whose grant can opt into notifications; `deliver` and the provider are counted. */
  function notifyHarness(options: {
    readonly authorization?: ChannelAuthorization;
    readonly redactor?: MessagingRuntimeOptions["redactor"];
    readonly checkpoints?: MessagingRuntimeOptions["checkpoints"];
    readonly authorize?: MessagingRuntimeOptions["authorize"];
  }): NotifyHarness {
    const delivered: ChannelReply[] = [];
    const calls = { count: 0 };
    const actions: string[] = [];
    const store = createMemorySessionStore();
    const runtime = createMessagingRuntime({
      authorize:
        options.authorize ??
        ((input) => {
          actions.push(input.action);
          return options.authorization ?? authorization();
        }),
      resolveAgent: () =>
        agentWith(
          textProvider(calls, () => "answer"),
          store,
        ),
      deliver: (reply) => {
        delivered.push(reply);
        return { delivered: true };
      },
      ...(options.redactor === undefined ? {} : { redactor: options.redactor }),
      ...(options.checkpoints === undefined ? {} : { checkpoints: options.checkpoints }),
    });
    return { runtime, delivered, calls, actions };
  }

  const notifyInput = (overrides: Partial<Parameters<MessagingRuntime["notify"]>[0]> = {}) => ({
    identity: identity(),
    connectionId: CONNECTION,
    externalConversationId: CHAT,
    notifyId: "job-1",
    text: "The job finished.",
    ...overrides,
  });

  /** Bind the (connection, chat, actor) pair by admitting one ordinary turn. */
  async function bind(runtime: MessagingRuntime): Promise<void> {
    assert.equal((await runtime.admit(event({ eventId: "1" }))).status, "accepted");
    await runtime.drain();
  }

  /** The durable operation record behind a notify outcome (proves what was journaled). */
  async function operationRecord(
    checkpoints: ReturnType<typeof createMemoryCheckpointStore>,
    outcome: ChannelAdmission,
    ownership: OwnershipScope,
  ) {
    const journal = createChannelStateStore({ checkpoints, maxJournalRecordBytes: 128 * 1024 });
    return journal.loadOperation({
      ownership,
      connectionId: CONNECTION,
      operationId: outcome.status === "accepted" ? (outcome.operationId ?? "") : "",
    });
  }

  it("denies a notify the grant did not opt into, without a run or a delivery", async () => {
    const { runtime, delivered, calls, actions } = notifyHarness({ authorization: authorization() });
    await bind(runtime);
    const before = delivered.length;

    assert.deepEqual(await runtime.notify(notifyInput()), { status: "denied", reason: "rejected" });
    await runtime.drain();

    assert.equal(delivered.length, before);
    assert.equal(calls.count, 1, "notify never starts an agent run");
    assert.deepEqual(actions, ["message", "notify"], "notify is authorized as its own action");
  });

  it("delivers one journaled, redacted notice and dedups a repeated notifyId", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const { runtime, delivered, calls } = notifyHarness({
      authorization: authorization({ notifications: true }),
      redactor: createSecretRedactor(["hunter2"]),
      checkpoints,
    });
    await bind(runtime);

    const first = await runtime.notify(notifyInput({ text: "Deploy done: hunter2 is live." }));
    const duplicate = await runtime.notify(notifyInput({ text: "Deploy done: hunter2 is live." }));
    await runtime.drain();

    assert.equal(first.status, "accepted");
    assert.equal(duplicate.status, "accepted");
    assert.equal(duplicate.status === "accepted" ? duplicate.duplicate : false, true);
    assert.equal(delivered.length, 2, "one answer plus exactly one notice");
    const notice = delivered[1];
    assert.equal(notice?.kind, "notice");
    assert.equal(notice?.connectionId, CONNECTION);
    assert.equal(notice?.externalConversationId, CHAT);
    assert.equal(notice?.text.includes("hunter2"), false, "notify text is redacted");
    assert.equal(notice?.inReplyTo, "notify-job-1");
    assert.equal(calls.count, 1, "a notice never runs the agent");
    assert.equal(runtime.diagnostics().queued, 0);

    const stored = await operationRecord(checkpoints, first, ownershipFromIdentity(identity()));
    assert.equal(stored?.record.kind, "notify");
    assert.equal(stored?.record.state, "succeeded");
  });

  it("refuses a notify from a foreign principal or another tenant", async () => {
    const { runtime, delivered } = notifyHarness({ authorization: authorization({ notifications: true }) });
    await bind(runtime);
    const before = delivered.length;

    assert.deepEqual(
      await runtime.notify(notifyInput({ identity: identity("user-2") })),
      { status: "denied", reason: "rejected" },
      "another user in the same tenant is not the bound principal",
    );
    assert.deepEqual(
      await runtime.notify(notifyInput({ identity: identity("user-1", "tenant-9") })),
      { status: "denied", reason: "rejected" },
      "another tenant cannot address this binding",
    );
    await runtime.drain();

    assert.equal(delivered.length, before);
  });

  it("refuses an unbound conversation, a revoked identity and a foreign actor's binding", async () => {
    const { runtime } = notifyHarness({ authorization: authorization({ notifications: true }) });
    const revoked: AgentIdentity = { ...identity(), revokedAt: new Date(0).toISOString() };

    assert.deepEqual(
      await runtime.notify(notifyInput({ externalConversationId: "chat-unbound" })),
      { status: "denied", reason: "rejected" },
      "notify never allocates a binding",
    );
    assert.deepEqual(await runtime.notify(notifyInput({ identity: revoked })), { status: "denied", reason: "revoked" });

    await bind(runtime);
    assert.deepEqual(
      await runtime.notify(notifyInput({ identity: revoked })),
      { status: "denied", reason: "revoked" },
      "a revoked identity neither notifies nor sends",
    );

    // Same destination, different binding: the grant names another principal than the caller claims.
    const other = notifyHarness({
      authorize: ({ externalActorId }) => authorization({ notifications: true, identity: identity(externalActorId) }),
    });
    await bind(other.runtime);
    assert.deepEqual(
      await other.runtime.notify(notifyInput({ identity: identity("user-2") })),
      { status: "denied", reason: "rejected" },
      "notify cannot address another actor's binding",
    );
  });

  it("addresses the current alias binding, not a stale one", async () => {
    const checkpoints = createMemoryCheckpointStore();
    let selected: string = "primary";
    const { runtime, delivered } = notifyHarness({
      checkpoints,
      authorize: () => authorization({ notifications: true, agentAliases: [selected], defaultAgentAlias: selected }),
    });
    await bind(runtime);
    selected = "secondary";
    assert.equal((await runtime.admit(event({ eventId: "2" }))).status, "accepted");
    await runtime.drain();
    const before = delivered.length;

    const outcome = await runtime.notify(notifyInput({ notifyId: "job-2" }));
    await runtime.drain();

    assert.equal(outcome.status, "accepted");
    assert.equal(delivered.length, before + 1, "the host is notified after the conversation moved alias");
    const stored = await operationRecord(checkpoints, outcome, ownershipFromIdentity(identity()));
    assert.equal(stored?.record.agentAlias, "secondary", "notify follows the current selection, never a stale binding");
  });

  it("notifies only the addressed actor of a shared thread", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const { runtime, delivered } = notifyHarness({
      checkpoints,
      authorize: ({ externalActorId }) => authorization({ notifications: true, identity: identity(externalActorId) }),
    });
    const group = { externalConversationId: "chat-g", threadId: "77" };
    assert.equal((await runtime.admit(event({ eventId: "1", externalActorId: "user-1", ...group }))).status, "accepted");
    await runtime.drain();
    assert.equal((await runtime.admit(event({ eventId: "2", externalActorId: "user-2", ...group }))).status, "accepted");
    await runtime.drain();
    const before = delivered.length;

    const outcome = await runtime.notify(notifyInput({ identity: identity("user-1"), notifyId: "job-3", ...group }));
    await runtime.drain();

    assert.equal(outcome.status, "accepted");
    assert.equal(delivered.length, before + 1, "exactly one of the two bound actors is notified");
    const notice = delivered.at(-1);
    assert.equal(notice?.externalConversationId, "chat-g");
    assert.equal(notice?.threadId, "77");
    const stored = await operationRecord(checkpoints, outcome, ownershipFromIdentity(identity("user-1")));
    assert.equal(stored?.record.externalActorId, "user-1");
  });
});

describe("plan 085 channel runtime split", () => {
  it("keeps every runtime sibling below 800 lines", async () => {
    const sourceDirectory = new URL("../../src/", import.meta.url);
    const runtimeFiles = (await readdir(sourceDirectory)).filter((file) => /^runtime(?:-[a-z]+)?\.ts$/.test(file));
    assert.ok(runtimeFiles.length >= 6);
    for (const file of runtimeFiles) {
      const lines = (await readFile(new URL(file, sourceDirectory), "utf8")).split("\n").length;
      assert.ok(lines <= 800, `${file} has ${lines} lines`);
    }
  });
});
