import assert from "node:assert/strict";
import { Duplex } from "node:stream";
import { describe, it } from "bun:test";
import {
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  type ModelProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type SessionStore,
  toolCallContent,
} from "@arnilo/prism";
import { createMemoryCheckpointStore, createMemoryLeaseStore } from "../memory-stores.js";
import { providerPackage } from "@arnilo/prism/provider-kit";
import {
  ChannelTokenLiteralError,
  CHANNEL_TOKEN_LITERAL_CODE,
  channelHostUi,
  createChannelPairingStore,
  connectTelegram,
  connectSignal,
  resolveChannelSecretRef,
} from "../index.js";
import { createTelegramWebhookHandler, type TelegramAdapterOptions, type TelegramWebhookHandlerOptions } from "../telegram.js";

function textProvider(calls: { count: number }, answer = (n: number) => `answer ${n}`): ModelProvider {
  return {
    id: "mock",
    async *generate() {
      calls.count += 1;
      yield providerTextDelta(answer(calls.count));
      yield providerDone();
    },
  };
}

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

function telegramMessage(updateId: number, text = "hello", overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      text,
      chat: { id: 101, type: "private" },
      from: { id: 202, is_bot: false },
    },
    ...overrides,
  };
}

function telegramCallbackQuery(updateId: number, data: string, fromId = 202): Record<string, unknown> {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb-${updateId}`,
      from: { id: fromId, is_bot: false },
      message: { message_id: 1, chat: { id: 101, type: "private" } },
      data,
    },
  };
}

type RpcRequest = { readonly id?: string; readonly method?: string; readonly params?: Record<string, unknown> };

class FakeSignalSocket extends Duplex {
  readonly requests: RpcRequest[] = [];

  constructor(private readonly handle: (request: RpcRequest, socket: FakeSignalSocket) => void = defaultSignalHandler) {
    super();
  }

  connect(): void {
    queueMicrotask(() => this.emit("connect"));
  }

  respond(response: Record<string, unknown>): void {
    this.push(Buffer.from(`${JSON.stringify(response)}\n`, "utf8"));
  }

  _read(): void {}

  _write(chunk: Buffer, _: BufferEncoding, callback: (error?: Error | null) => void): void {
    for (const line of chunk.toString("utf8").trim().split("\n")) {
      if (line.length === 0) continue;
      const request = JSON.parse(line) as RpcRequest;
      this.requests.push(request);
      this.handle(request, this);
    }
    callback();
  }
}

function defaultSignalHandler(request: RpcRequest, socket: FakeSignalSocket): void {
  if (request.id === undefined) return;
  if (request.method === "subscribeReceive") socket.respond({ jsonrpc: "2.0", id: request.id, result: 0 });
  else if (request.method === "unsubscribeReceive") socket.respond({ jsonrpc: "2.0", id: request.id, result: 0 });
  else if (request.method === "send") socket.respond({ jsonrpc: "2.0", id: request.id, result: { timestamp: 123 } });
}

const SIGNAL_ACCOUNT = "+15550001111";
const SIGNAL_SENDER_UUID = "11111111-2222-4333-8444-555555555555";

let signalTimestamp = 1693064367769;

function signalDirectMessage(text = "hello Prism", overrides: Record<string, unknown> = {}): Record<string, unknown> {
  signalTimestamp += 1000;
  const ts = signalTimestamp;
  return {
    jsonrpc: "2.0",
    method: "receive",
    params: {
      subscription: 0,
      result: {
        account: SIGNAL_ACCOUNT,
        envelope: {
          sourceUuid: SIGNAL_SENDER_UUID,
          sourceDevice: 2,
          timestamp: ts,
          dataMessage: { timestamp: ts, message: text, attachments: [] },
        },
      },
    },
    ...overrides,
  };
}

describe("connectTelegram and connectSignal host bindings", () => {
  it("connect_telegram_turn_runs_bound_session: two messages in one chat continue one session", async () => {
    process.env.TEST_TG_TOKEN_1 = "123456:secret-token-1";
    const calls = { count: 0 };
    const sessionIds = new Set<string>();
    const store = trackingStore(sessionIds);
    const agent = await createAgent({
      id: "bound-session-agent",
      model: { provider: "mock", model: "demo" },
      slots: { store },
      packages: [providerPackage("test-provider", [textProvider(calls)])],
    });

    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    const mockFetch = (async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const body = init?.body ? JSON.parse(init.body as string) : {};
      sent.push({ url, body });
      return Response.json({ ok: true, result: { message_id: sent.length } });
    }) as NonNullable<TelegramAdapterOptions["fetch"]>;

    const handle = await connectTelegram(agent, {
      token: "env:TEST_TG_TOKEN_1",
      fetch: mockFetch,
    });

    const adm1 = await handle.handle(telegramMessage(1, "message 1"));
    assert.ok(adm1);
    await handle.drain();
    const adm2 = await handle.handle(telegramMessage(2, "message 2"));
    assert.ok(adm2);
    await handle.drain();

    assert.equal(calls.count, 2);
    assert.equal(sessionIds.size, 1, "two messages in one chat continue the same session");
    assert.equal(sent.length, 2);
    assert.equal(sent[0]?.body.text, "answer 1");
    assert.equal(sent[1]?.body.text, "answer 2");

    await handle.close();
  });

  it("connect_telegram_approval_reply_resumes: approve reply runs gated tool once, deny reply does not", async () => {
    process.env.TEST_TG_TOKEN_2 = "123456:secret-token-2";
    const calls = { model: 0, tool: 0 };
    const agent = await createAgent({
      hooks: askEveryTool(),
      id: "approval-agent",
      model: { provider: "mock", model: "demo" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              calls.model += 1;
              if (calls.model === 1) {
                yield providerToolCall(toolCallContent("tool-call-1", "write", {}));
                yield providerDone();
                return;
              }
              yield providerTextDelta("resumed after approval");
              yield providerDone();
            },
          },
        ]),
      ],
      tools: {
        add: [
          {
            name: "write",
            parameters: { type: "object" },
            execute: () => ({ toolCallId: "tool-call-1", name: "write", value: ++calls.tool }),
          },
        ],
      },
    });

    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    const mockFetch = (async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const body = init?.body ? JSON.parse(init.body as string) : {};
      sent.push({ url, body });
      return Response.json({ ok: true, result: { message_id: sent.length } });
    }) as NonNullable<TelegramAdapterOptions["fetch"]>;

    const handle = await connectTelegram(agent, {
      token: "env:TEST_TG_TOKEN_2",
      fetch: mockFetch,
    });

    await handle.handle(telegramMessage(1, "trigger tool"));
    await handle.drain();
    assert.equal(calls.tool, 0, "gated tool did not execute yet");
    assert.equal(sent.length, 1);

    // Verify approval controls were delivered in inline keyboard
    const replyMarkup = sent[0]?.body.reply_markup as
      | { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> }
      | undefined;
    assert.ok(replyMarkup?.inline_keyboard);
    const allowBtn = replyMarkup.inline_keyboard.flat().find((btn) => btn.text === "Allow once");
    assert.ok(allowBtn);
    const allowData = allowBtn.callback_data;

    // Send allow callback query
    await handle.handle(telegramCallbackQuery(2, allowData, 202));
    await handle.drain();
    assert.equal(calls.tool, 1, "tool executed exactly once upon approval");
    assert.equal(sent.length, 2);
    assert.equal(sent[1]?.body.text, "resumed after approval");

    await handle.close();
  });

  it("channels_approval_survives_restart: suspend, rebuild agent + connection over same stores, reply, tool runs once", async () => {
    const checkpoints = createMemoryCheckpointStore();
    process.env.TEST_TG_TOKEN_3 = "123456:secret-token-3";
    const leases = createMemoryLeaseStore();
    const sessionStore = createMemorySessionStore();
    const calls = { model: 0, tool: 0 };

    async function buildAgent(): Promise<any> {
      return await createAgent({
        hooks: askEveryTool(),
        id: "survives-restart-agent",
        model: { provider: "mock", model: "demo" },
        slots: { store: sessionStore },
        packages: [
          providerPackage("test-provider", [
            {
              id: "mock",
              async *generate() {
                calls.model += 1;
                if (calls.model === 1) {
                  yield providerToolCall(toolCallContent("tool-restart", "write", {}));
                  yield providerDone();
                  return;
                }
                yield providerTextDelta("answer after restart");
                yield providerDone();
              },
            },
          ]),
        ],
        tools: {
          add: [
            {
              name: "write",
              parameters: { type: "object" },
              execute: () => ({ toolCallId: "tool-restart", name: "write", value: ++calls.tool }),
            },
          ],
        },
      });
    }

    const sent1: Array<{ url: string; body: Record<string, unknown> }> = [];
    const mockFetch1 = (async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const body = init?.body ? JSON.parse(init.body as string) : {};
      sent1.push({ url, body });
      return Response.json({ ok: true, result: { message_id: sent1.length } });
    }) as NonNullable<TelegramAdapterOptions["fetch"]>;

    const agent1 = await buildAgent();
    const handle1 = await connectTelegram(agent1, {
      token: "env:TEST_TG_TOKEN_3",
      checkpoints,
      leases,
      fetch: mockFetch1,
    });

    await handle1.handle(telegramMessage(1, "trigger tool"));
    await handle1.drain();
    const replyMarkup = sent1[0]?.body.reply_markup as
      | { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> }
      | undefined;
    assert.ok(replyMarkup?.inline_keyboard);
    const allowBtn = replyMarkup.inline_keyboard.flat().find((btn) => btn.text === "Allow once");
    assert.ok(allowBtn);
    const allowData = allowBtn.callback_data;

    // Shutdown connection 1
    await handle1.close();

    // Rebuild connection 2 over same stores
    const sent2: Array<{ url: string; body: Record<string, unknown> }> = [];
    const mockFetch2 = (async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const body = init?.body ? JSON.parse(init.body as string) : {};
      sent2.push({ url, body });
      return Response.json({ ok: true, result: { message_id: sent2.length } });
    }) as NonNullable<TelegramAdapterOptions["fetch"]>;

    const agent2 = await buildAgent();
    const handle2 = await connectTelegram(agent2, {
      token: "env:TEST_TG_TOKEN_3",
      checkpoints,
      leases,
      fetch: mockFetch2,
    });

    // Deliver approval to rebuilt connection
    await handle2.handle(telegramCallbackQuery(2, allowData, 202));
    await handle2.drain();
    assert.equal(calls.tool, 1, "tool runs once after restart");
    assert.equal(sent2[0]?.body.text, "answer after restart");

    await handle2.close();
  });

  it("channels_approval_foreign_user_rejected: reply from different externalActorId or principalId is denied", async () => {
    process.env.TEST_TG_TOKEN_4 = "123456:secret-token-4";
    const calls = { model: 0, tool: 0 };
    const agent = await createAgent({
      hooks: askEveryTool(),
      id: "foreign-user-agent",
      model: { provider: "mock", model: "demo" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              calls.model += 1;
              yield providerToolCall(toolCallContent("tool-auth", "write", {}));
              yield providerDone();
            },
          },
        ]),
      ],
      tools: {
        add: [
          {
            name: "write",
            parameters: { type: "object" },
            execute: () => ({ toolCallId: "tool-auth", name: "write", value: ++calls.tool }),
          },
        ],
      },
    });

    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    const mockFetch = (async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const body = init?.body ? JSON.parse(init.body as string) : {};
      sent.push({ url, body });
      return Response.json({ ok: true, result: { message_id: sent.length } });
    }) as NonNullable<TelegramAdapterOptions["fetch"]>;

    const handle = await connectTelegram(agent, {
      token: "env:TEST_TG_TOKEN_4",
      fetch: mockFetch,
    });

    await handle.handle(telegramMessage(1, "trigger tool"));
    await handle.drain();
    const replyMarkup = sent[0]?.body.reply_markup as
      | { inline_keyboard?: Array<Array<{ text: string; callback_data: string }>> }
      | undefined;
    assert.ok(replyMarkup?.inline_keyboard);
    const allowBtn = replyMarkup.inline_keyboard.flat().find((btn) => btn.text === "Allow once");
    assert.ok(allowBtn);
    const allowData = allowBtn.callback_data;

    // Foreign user (999 instead of 202) attempts approval
    const result = await handle.handle(telegramCallbackQuery(2, allowData, 999));
    await handle.drain();
    assert.deepEqual(result, { status: "denied", reason: "rejected" });
    assert.equal(calls.tool, 0, "foreign user decision is rejected and tool never runs");

    await handle.close();
  });

  it("connect_rejects_literal_token: literal string token throws ChannelTokenLiteralError on connectTelegram and connectSignal", async () => {
    const dummyAgent = await createAgent({
      id: "dummy-agent",
      model: { provider: "mock", model: "demo" },
      slots: { store: createMemorySessionStore() },
      packages: [providerPackage("test-provider", [textProvider({ count: 0 })])],
    });

    await assert.rejects(
      async () => {
        await connectTelegram(dummyAgent, {
          token: "123456:literal-raw-token",
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ChannelTokenLiteralError);
        assert.equal((err as ChannelTokenLiteralError).code, CHANNEL_TOKEN_LITERAL_CODE);
        return true;
      },
    );

    await assert.rejects(
      async () => {
        await connectSignal(dummyAgent, {
          account: "+15551234567",
          socketPath: "/tmp/fake.sock",
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ChannelTokenLiteralError);
        assert.equal((err as ChannelTokenLiteralError).code, CHANNEL_TOKEN_LITERAL_CODE);
        return true;
      },
    );
  });

  it("channels_secret_fields_are_ref_only: webhookSecret and bot token reject literals and resolve refs through the credentials slot", async () => {
    const keyring = new Map([
      ["keyring:telegram-webhook", "hook-secret-from-keyring"],
      ["keyring:telegram-token", "123456:keyring-token"],
    ]);
    const agent = await createAgent({
      id: "ref-only-agent",
      model: { provider: "mock", model: "demo" },
      slots: {
        store: createMemorySessionStore(),
        credentials: {
          resolve: (ref) => {
            const value = keyring.get(ref);
            return value === undefined ? undefined : { type: "api_key", value };
          },
        },
      },
      packages: [providerPackage("test-provider", [textProvider({ count: 0 })])],
    });
    process.env.TEST_TG_REF_ONLY_TOKEN = "123456:env-token";
    try {
      await assert.rejects(
        connectTelegram(agent, { token: "keyring:telegram-token", webhookSecret: "literal-webhook-secret" }),
        (err: unknown) => err instanceof ChannelTokenLiteralError && err.code === CHANNEL_TOKEN_LITERAL_CODE,
      );
      // An assigned slot owns every ref: it answers keyring refs (`Secret.value`), and an env ref it does not know fails closed.
      assert.equal(await resolveChannelSecretRef(agent, "keyring:telegram-webhook"), "hook-secret-from-keyring");
      await assert.rejects(resolveChannelSecretRef(agent, "env:TEST_TG_REF_ONLY_TOKEN"), /Failed to resolve/);
      await assert.rejects(resolveChannelSecretRef(agent, "keyring:missing"), /Failed to resolve/);
    } finally {
      delete process.env.TEST_TG_REF_ONLY_TOKEN;
    }
    const literal = { webhookSecret: "literal" } as unknown as Pick<TelegramWebhookHandlerOptions, "webhookSecret">;
    assert.throws(
      () =>
        createTelegramWebhookHandler({
          connectionId: "c",
          botToken: async () => "t",
          ...literal,
          admit: async () => ({ status: "duplicate" }) as never,
          leases: createMemoryLeaseStore(),
          cursorOwnership: { tenantId: "t", accountId: "a", userId: "u" },
        }),
      /secret source, not a literal/,
    );
  });

  it("channels_never_emit_token: token is asserted absent in replies, errors, diagnostics", async () => {
    const SECRET_TOKEN = "super-secret-token-xyz-123456";
    process.env.TEST_TG_SECRET_NEVER_LEAK = SECRET_TOKEN;

    const agent = await createAgent({
      id: "token-leak-check-agent",
      model: { provider: "mock", model: "demo" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              // Try to leak token through model output
              yield providerTextDelta(`Here is the token: ${SECRET_TOKEN}`);
              yield providerDone();
            },
          },
        ]),
      ],
    });

    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    const mockFetch = (async (input: unknown, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
      const body = init?.body ? JSON.parse(init.body as string) : {};
      sent.push({ url, body });
      return Response.json({ ok: true, result: { message_id: sent.length } });
    }) as NonNullable<TelegramAdapterOptions["fetch"]>;

    const handle = await connectTelegram(agent, {
      token: "env:TEST_TG_SECRET_NEVER_LEAK",
      fetch: mockFetch,
    });

    await handle.handle(telegramMessage(1, "trigger"));
    await handle.drain();
    assert.equal(sent.length, 1);
    const replyText = String(sent[0]?.body.text);
    assert.equal(replyText.includes(SECRET_TOKEN), false, "token must never appear in delivered text");
    assert.ok(replyText.includes("[REDACTED]"), "secret token was redacted");

    await handle.close();
  });

  it("connect_signal_turn_and_approval: turn and approval over Signal fixture", async () => {
    process.env.TEST_SIGNAL_ACCOUNT = SIGNAL_ACCOUNT;
    const socket = new FakeSignalSocket();
    const calls = { model: 0, tool: 0 };
    const agent = await createAgent({
      hooks: askEveryTool(),
      id: "signal-turn-agent",
      model: { provider: "mock", model: "demo" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              calls.model += 1;
              if (calls.model === 1) {
                yield providerTextDelta("first signal answer");
                yield providerDone();
                return;
              }
              if (calls.model === 2) {
                yield providerToolCall(toolCallContent("sig-tool-1", "write", {}));
                yield providerDone();
                return;
              }
              yield providerTextDelta("signal final answer");
              yield providerDone();
            },
          },
        ]),
      ],
      tools: {
        add: [
          {
            name: "write",
            parameters: { type: "object" },
            execute: () => ({ toolCallId: "sig-tool-1", name: "write", value: ++calls.tool }),
          },
        ],
      },
    });

    const handle = await connectSignal(agent, {
      account: "env:TEST_SIGNAL_ACCOUNT",
      socketPath: "/run/prism/signal.sock",
      connect: () => {
        socket.connect();
        return socket as never;
      },
    });

    await handle.start();

    // Turn 1: normal turn
    await handle.handle(signalDirectMessage("hello turn 1"));
    await handle.drain();
    const sends1 = socket.requests.filter((r) => r.method === "send");
    assert.equal(sends1.length, 1);
    assert.equal(sends1[0]?.params?.message, "first signal answer");

    // Turn 2: gated tool turn
    await handle.handle(signalDirectMessage("trigger gated tool"));
    await handle.drain();
    const sends2 = socket.requests.filter((r) => r.method === "send");
    assert.equal(sends2.length, 2);
    const noticeText = String(sends2[1]?.params?.message);
    assert.match(noticeText, /Reply \/approve ([A-Za-z0-9_-]{32,64}) to allow once/);
    const match = /Reply \/approve ([A-Za-z0-9_-]{32,64}) to allow once/.exec(noticeText);
    assert.ok(match?.[1]);
    const token = match[1];

    // Approve the gated tool
    await handle.handle(signalDirectMessage(`/approve ${token}`));
    await handle.drain();
    assert.equal(calls.tool, 1, "tool runs once upon /approve in Signal");
    const sends3 = socket.requests.filter((r) => r.method === "send");
    assert.equal(sends3.length, 3);
    assert.equal(sends3[2]?.params?.message, "signal final answer");

    await handle.close();
  });
});

it("signal_host_ui_confirm_select_input_notify_use_paired_replies_without_model_turns", async () => {
  process.env.TEST_SIGNAL_UI_ACCOUNT = SIGNAL_ACCOUNT;
  const socket = new FakeSignalSocket();
  const calls = { count: 0 };
  const agent = await createAgent({
    id: "signal-ui",
    model: { provider: "mock", model: "demo" },
    packages: [providerPackage("test-provider", [textProvider(calls)])],
  });
  const checkpoints = createMemoryCheckpointStore();
  const ownership = { tenantId: "ops", userId: "operator" };
  const identity = {
    ...ownership,
    principal: { kind: "user" as const, id: "operator" },
    scopes: ["chat"],
    verified: true as const,
    issuedAt: new Date(0).toISOString(),
  };
  const pairs = createChannelPairingStore({ checkpoints });
  const pair = await pairs.create({
    ...ownership,
    connectionId: "signal-default",
    externalConversationId: SIGNAL_SENDER_UUID,
    externalActorId: SIGNAL_SENDER_UUID,
    grantRevision: "1",
  });
  await pairs.consume({ ...ownership, connectionId: "signal-default", token: pair.token });
  const connection = await connectSignal(agent, {
    account: "env:TEST_SIGNAL_UI_ACCOUNT",
    socketPath: "/run/prism/signal.sock",
    checkpoints,
    authorize: (input) =>
      input.externalActorId === SIGNAL_SENDER_UUID && input.externalConversationId === SIGNAL_SENDER_UUID
        ? { identity, grantRevision: "1" }
        : false,
    connect: () => {
      socket.connect();
      return socket as never;
    },
  });
  try {
    await connection.start();
    const ui = channelHostUi({ connection, chat: `pair:${pair.token}`, ownership });
    const latest = () => String(socket.requests.filter((r) => r.method === "send").at(-1)?.params?.message);
    const ready = async (count: number) => {
      for (let n = 0; socket.requests.filter((r) => r.method === "send").length < count && n < 100; n++)
        await new Promise((r) => setTimeout(r, 1));
      assert.equal(socket.requests.filter((r) => r.method === "send").length, count);
    };
    const confirm = ui.request({ kind: "confirm", title: "Deploy?" });
    await ready(1);
    const command = /Reply (\/answer [A-Za-z0-9_-]{43} 0)/.exec(latest())?.[1];
    assert.ok(command);
    assert.deepEqual(await connection.handle(signalDirectMessage(command)), { status: "accepted" });
    assert.deepEqual(await confirm, { status: "answered", value: true });
    const select = ui.request({
      kind: "select",
      title: "Choose",
      options: [
        { value: "a", label: "<A>" },
        { value: "b", label: "B" },
      ],
    });
    await ready(2);
    const selectToken = /\/answer ([A-Za-z0-9_-]{43})/.exec(latest())?.[1];
    await connection.handle(signalDirectMessage(`/answer ${selectToken} 1`));
    assert.deepEqual(await select, { status: "answered", value: "b" });
    const input = ui.request({ kind: "input", title: "Enter text" });
    await ready(3);
    const inputToken = /\/answer ([A-Za-z0-9_-]{43})/.exec(latest())?.[1];
    await connection.handle(signalDirectMessage(`/answer ${inputToken} private signal answer`));
    assert.deepEqual(await input, { status: "answered", value: "private signal answer" });
    assert.deepEqual(await ui.request({ kind: "notify", level: "info", message: "<b>plain</b>" }), {
      status: "answered",
      value: undefined,
    });
    await ready(4);
    assert.equal(latest(), "<b>plain</b>");
    const commands = `Reply /answer ${"x".repeat(43)} 0 (Yes)\nReply /answer ${"x".repeat(43)} 1 (No)`;
    const title = "x".repeat(2000 - 2 - commands.length);
    const boundary = ui.request({ kind: "confirm", title });
    await ready(5);
    assert.equal(latest().length, 2000, "a full-sized request is one Signal message");
    const boundaryToken = /\/answer ([A-Za-z0-9_-]{43})/.exec(latest())?.[1];
    assert.ok(boundaryToken);
    await connection.handle(signalDirectMessage(`/answer ${boundaryToken} 0`));
    assert.equal((await boundary).status, "answered");
    assert.deepEqual(await ui.request({ kind: "confirm", title: `${title}x` }), { status: "unavailable" });
    await ready(5);
    assert.equal(JSON.stringify((await checkpoints.listCheckpoints()).items).includes("private signal answer"), false);
    assert.equal(calls.count, 0);
  } finally {
    await connection.close();
  }
});
