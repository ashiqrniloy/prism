import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AgentIdentity,
  createAgent,
  createMemoryCheckpointStore,
  createMemoryLeaseStore,
  createMemorySessionStore,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import { createMessagingRuntime } from "../index.js";
import { createChannelStateStore } from "../state.js";
import type { TelegramAdapterOptions } from "../telegram.js";
import { createTelegramAdapter, createTelegramWebhookHandler } from "../telegram.js";
import type { ChannelAdmission, ChannelAuthorization, ChannelInboundEvent, ChannelReply } from "../types.js";

const CONNECTION = "telegram-main";
const OWNER = { tenantId: "telegram-service" };
const TOKEN = "123456:secret-token";
type TelegramFetch = NonNullable<TelegramAdapterOptions["fetch"]>;

function ok(result: unknown): Response {
  return Response.json({ ok: true, result });
}

function error(status: number, retryAfter?: number): Response {
  return Response.json(
    { ok: false, error_code: status, ...(retryAfter === undefined ? {} : { parameters: { retry_after: retryAfter } }) },
    { status },
  );
}

function message(updateId: number, text = "hello", overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

function webhookRequest(body: unknown, secret = "webhook-secret"): Request {
  return new Request("https://host.example/telegram", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(body),
  });
}

function never(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for Telegram adapter");
}

function pollingOptions(fetch: TelegramFetch, overrides: Partial<TelegramAdapterOptions> = {}): TelegramAdapterOptions {
  return {
    connectionId: CONNECTION,
    botToken: TOKEN,
    checkpoints: createMemoryCheckpointStore(),
    leases: createMemoryLeaseStore(),
    cursorOwnership: OWNER,
    apiOrigin: "https://telegram.test",
    fetch,
    ...overrides,
  };
}

function method(url: string | URL | Request): string {
  return new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).pathname.split("/").at(-1) ?? "";
}

function responseForPoll(updates: readonly unknown[], sent: Array<Record<string, unknown>> = []): TelegramFetch {
  let polls = 0;
  return async (url, init) => {
    switch (method(url)) {
      case "getMe":
        return ok({ id: 1 });
      case "getWebhookInfo":
        return ok({ url: "" });
      case "getUpdates":
        polls += 1;
        return polls === 1 ? ok(updates) : never(init?.signal);
      case "sendMessage":
        sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return ok({ message_id: sent.length });
      case "answerCallbackQuery":
        return ok(true);
      default:
        throw new Error(`unexpected method ${method(url)}`);
    }
  };
}

describe("plan 079 Telegram adapter", () => {
  it("routes an authorized private text DM through the runtime and replies to its fixed chat", async () => {
    const outgoing: Array<Record<string, unknown>> = [];
    const checkpoints = createMemoryCheckpointStore();
    const leases = createMemoryLeaseStore();
    const adapter = createTelegramAdapter(pollingOptions(responseForPoll([message(1, "hello Prism")], outgoing), { checkpoints, leases }));
    const agent = createAgent({
      id: "telegram-agent",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("final answer");
          yield providerDone();
        },
      },
    });
    const runtime = createMessagingRuntime({
      checkpoints,
      leases,
      authorize: () => ({
        identity: {
          tenantId: "tenant-1",
          userId: "user-1",
          principal: { kind: "user", id: "user-1" },
          scopes: ["chat"],
          issuedAt: new Date(0).toISOString(),
          verified: true,
        },
        agentAliases: ["primary"],
        grantRevision: "grant-1",
      }),
      resolveAgent: () => agent,
      deliver: (reply) => adapter.send(reply),
    });

    await adapter.start((event) => runtime.admit(event));
    await waitFor(() => outgoing.length === 1);
    await runtime.drain();
    await adapter.stop();
    await runtime.stop();

    assert.deepEqual(outgoing[0], { chat_id: "101", text: "final answer" });
  });

  it("admits sorted private text updates before advancing its durable polling cursor", async () => {
    const received: string[] = [];
    const options = pollingOptions(responseForPoll([message(2, "second"), message(1, "first"), message(2, "duplicate")]));
    const adapter = createTelegramAdapter(options);

    await adapter.start(async (event) => {
      received.push(`${event.eventId}:${event.text}`);
      return { status: "accepted", operationId: event.eventId };
    });
    await waitFor(() => received.length === 2);
    await adapter.stop();

    assert.deepEqual(received, ["1:first", "2:second"]);
    const cursor = await createChannelStateStore({ checkpoints: options.checkpoints, maxJournalRecordBytes: 1024 }).loadCursor({
      ownership: OWNER,
      connectionId: CONNECTION,
    });
    assert.equal(cursor?.record.lastEventId, "2");
    assert.equal(adapter.capabilities.acknowledgement, "telegram_offset");
  });

  it("accepts a post-gap update while dropping only cursor-confirmed older updates", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const state = createChannelStateStore({ checkpoints, maxJournalRecordBytes: 1024 });
    await state.advanceCursor({ ownership: OWNER, connectionId: CONNECTION }, "5");
    const received: string[] = [];
    const options = pollingOptions(responseForPoll([message(4, "old"), message(900_001, "week gap")]), { checkpoints });
    const adapter = createTelegramAdapter(options);

    await adapter.start(async (event) => {
      received.push(event.text);
      return { status: "accepted" };
    });
    await waitFor(() => received.length === 1);
    await adapter.stop();

    assert.deepEqual(received, ["week gap"]);
    assert.equal((await state.loadCursor({ ownership: OWNER, connectionId: CONNECTION }))?.record.lastEventId, "900001");
  });

  it("keeps the offset uncommitted when durable admission is unavailable", async () => {
    const options = pollingOptions(responseForPoll([message(1)]));
    const adapter = createTelegramAdapter(options);

    await adapter.start(async () => ({ status: "denied", reason: "unavailable" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await adapter.stop();

    const cursor = await createChannelStateStore({ checkpoints: options.checkpoints, maxJournalRecordBytes: 1024 }).loadCursor({
      ownership: OWNER,
      connectionId: CONNECTION,
    });
    assert.equal(cursor, null);
  });

  it("refuses polling when Telegram has an existing webhook", async () => {
    const fetch: TelegramFetch = async (url) => {
      if (method(url) === "getMe") return ok({ id: 1 });
      if (method(url) === "getWebhookInfo") return ok({ url: "https://existing.example/hook" });
      throw new Error("getUpdates must not run");
    };
    const adapter = createTelegramAdapter(pollingOptions(fetch));
    await assert.rejects(
      adapter.start(async () => ({ status: "accepted" })),
      /webhook is active/,
    );
    await adapter.stop();
  });

  it("chunks Unicode replies safely and honors retry_after before retrying a known-unsent send", async () => {
    const payloads: Record<string, unknown>[] = [];
    let sends = 0;
    const fetch: TelegramFetch = async (url, init) => {
      switch (method(url)) {
        case "sendMessage":
          sends += 1;
          payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return sends === 1 ? error(429, 1) : ok({ message_id: sends });
        default:
          return ok(method(url) === "getWebhookInfo" ? { url: "" } : { id: 1 });
      }
    };
    const adapter = createTelegramAdapter(pollingOptions(fetch));
    const result = await adapter.send({ connectionId: CONNECTION, externalConversationId: "101", kind: "final", text: "😀".repeat(1800) });

    assert.equal(result.delivered, true);
    assert.equal(payloads.length, 3, "one rate-limited retry plus two Unicode-safe chunks");
    for (const payload of payloads.slice(1)) {
      const text = String(payload.text);
      assert.ok(text.length <= 3500);
      assert.doesNotMatch(text, /[\uD800-\uDBFF]$/);
    }
  });

  it("never leaks token URLs and marks network send outcomes ambiguous", async () => {
    const adapter = createTelegramAdapter(
      pollingOptions(async (url) => {
        throw new Error(String(url));
      }),
    );
    await assert.rejects(
      adapter.send({ connectionId: CONNECTION, externalConversationId: "101", kind: "final", text: "answer" }),
      (error: unknown) => error instanceof Error && error.message === "Telegram delivery outcome unknown" && !error.message.includes(TOKEN),
    );
  });

  it("validates webhook secrets, bounded JSON, and durable admission before returning success", async () => {
    const leases = createMemoryLeaseStore();
    const received: ChannelAdmission[] = [];
    const handler = createTelegramWebhookHandler({
      connectionId: CONNECTION,
      botToken: TOKEN,
      webhookSecret: "webhook-secret",
      leases,
      cursorOwnership: OWNER,
      apiOrigin: "https://telegram.test",
      maxRequestBytes: 1024,
      fetch: async () => ok(true),
      admit: async (event) => {
        received.push({ status: "accepted", operationId: event.eventId });
        return received.at(-1);
      },
    });

    assert.equal((await handler(webhookRequest(message(1), "wrong"))).status, 401);
    assert.equal(
      (
        await handler(
          new Request("https://host.example/telegram", {
            method: "POST",
            headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "webhook-secret" },
            body: "{",
          }),
        )
      ).status,
      400,
    );
    assert.equal((await handler(webhookRequest({ update_id: 2, padding: "x".repeat(2000) }))).status, 413);
    assert.equal((await handler(webhookRequest(message(3)))).status, 204);
    assert.equal(received.length, 1);
  });

  it("does not acknowledge webhook overload and ignores bot/group/media traffic", async () => {
    const leases = createMemoryLeaseStore();
    const handler = createTelegramWebhookHandler({
      connectionId: CONNECTION,
      botToken: TOKEN,
      webhookSecret: "webhook-secret",
      leases,
      cursorOwnership: OWNER,
      apiOrigin: "https://telegram.test",
      fetch: async () => ok(true),
      admit: async () => ({ status: "denied", reason: "capacity" }),
    });

    assert.equal((await handler(webhookRequest(message(1)))).status, 503);
    const ignored = createTelegramWebhookHandler({
      connectionId: CONNECTION,
      botToken: TOKEN,
      webhookSecret: "webhook-secret",
      leases,
      cursorOwnership: OWNER,
      apiOrigin: "https://telegram.test",
      fetch: async () => ok(true),
      admit: async () => {
        throw new Error("unsupported updates must not admit");
      },
    });
    const group = message(2, "x", { message: { chat: { id: 1, type: "group" }, from: { id: 2 }, text: "x" } });
    const bot = message(3, "x", { message: { chat: { id: 1, type: "private" }, from: { id: 2, is_bot: true }, text: "x" } });
    const media = { update_id: 4, message: { chat: { id: 1, type: "private" }, from: { id: 2 }, photo: [{}] } };
    assert.equal((await ignored(webhookRequest(group))).status, 204);
    assert.equal((await ignored(webhookRequest(bot))).status, 204);
    assert.equal((await ignored(webhookRequest(media))).status, 204);
  });

  it("uses the receiver lease to prevent a webhook and poller from running together", async () => {
    const checkpoints = createMemoryCheckpointStore();
    const leases = createMemoryLeaseStore();
    const adapter = createTelegramAdapter(pollingOptions(responseForPoll([]), { checkpoints, leases }));
    await adapter.start(async () => ({ status: "accepted" }));
    const handler = createTelegramWebhookHandler({
      connectionId: CONNECTION,
      botToken: TOKEN,
      webhookSecret: "webhook-secret",
      leases,
      cursorOwnership: OWNER,
      apiOrigin: "https://telegram.test",
      fetch: async () => ok(true),
      admit: async () => ({ status: "accepted" }),
    });
    assert.equal((await handler(webhookRequest(message(1)))).status, 503);
    await adapter.stop();
  });

  it("acknowledges and admits only server-shaped approval callbacks", async () => {
    const calls: string[] = [];
    const sent: Array<Record<string, unknown>> = [];
    const token = "a".repeat(43);
    const originalFetch = responseForPoll(
      [
        {
          update_id: 1,
          callback_query: { id: "callback-1", data: `p:a:${token}`, from: { id: 202 }, message: { chat: { id: 101, type: "private" } } },
        },
      ],
      sent,
    );
    const options = pollingOptions(async (url, init) => {
      calls.push(method(url));
      return originalFetch(url, init);
    });
    const adapter = createTelegramAdapter(options);
    let received: ChannelInboundEvent | undefined;
    await adapter.start(async (event) => {
      received = event;
      return { status: "accepted" };
    });
    await waitFor(() => calls.includes("answerCallbackQuery") && received !== undefined);
    assert.deepEqual(
      await adapter.send({
        connectionId: CONNECTION,
        externalConversationId: "101",
        text: "Approval required",
        kind: "notice",
        controls: [{ label: "Allow once", value: `p:a:${token}` }],
      }),
      { delivered: true, messageId: "1" },
    );
    await adapter.stop();
    assert.ok(calls.includes("answerCallbackQuery"));
    assert.deepEqual(sent[0]?.reply_markup, { inline_keyboard: [[{ text: "Allow once", callback_data: `p:a:${token}` }]] });
    assert.deepEqual(received?.approval, { token, outcome: "allow_once" });
    assert.equal(received?.text, "");
  });

  it("keeps group traffic denied by default and threads opted-in forum topics end to end", async () => {
    const token = "b".repeat(43);
    const groupMessage = (updateId: number, messageOverrides: Record<string, unknown> = {}) =>
      message(updateId, "topic question", {
        message: {
          message_id: updateId,
          text: "topic question",
          message_thread_id: 77,
          chat: { id: -100123, type: "supergroup", is_forum: true },
          from: { id: 202, is_bot: false },
          ...messageOverrides,
        },
      });

    const ignored: ChannelInboundEvent[] = [];
    const defaultAdapter = createTelegramAdapter(pollingOptions(responseForPoll([groupMessage(1)])));
    await defaultAdapter.start(async (event) => {
      ignored.push(event);
      return { status: "accepted" };
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await defaultAdapter.stop();
    assert.deepEqual(ignored, []);

    const sent: Array<Record<string, unknown>> = [];
    const events: ChannelInboundEvent[] = [];
    const adapter = createTelegramAdapter(
      pollingOptions(
        responseForPoll(
          [
            groupMessage(2),
            groupMessage(3, { forward_origin: { type: "user", date: 1, sender_user: { id: 9 } } }),
            groupMessage(4, { from: { id: -100123, is_bot: false }, sender_chat: { id: -100123, type: "supergroup" } }),
            {
              update_id: 5,
              callback_query: {
                id: "callback-group",
                data: `p:a:${token}`,
                from: { id: 202, is_bot: false },
                message: { message_thread_id: 77, chat: { id: -100123, type: "supergroup", is_forum: true } },
              },
            },
          ],
          sent,
        ),
        { allowGroups: true },
      ),
    );
    await adapter.start(async (event) => {
      events.push(event);
      return { status: "accepted" };
    });
    await waitFor(() => events.length === 3);

    assert.deepEqual(
      events.map((event) => [event.eventId, event.externalConversationId, event.externalActorId, event.threadId, event.claims?.chatType]),
      [
        ["2", "-100123", "202", "77", "supergroup"],
        ["3", "-100123", "202", "77", "supergroup"],
        ["5", "-100123", "202", "77", "supergroup"],
      ],
    );
    assert.equal(events[0]?.claims?.isForum, true);
    assert.equal(events[0]?.claims?.forwarded, undefined);
    assert.equal(events[1]?.claims?.forwarded, true);
    assert.deepEqual(events[2]?.approval, { token, outcome: "allow_once" });

    assert.deepEqual(
      await adapter.send({ connectionId: CONNECTION, externalConversationId: "-100123", text: "answer", kind: "final", threadId: "77" }),
      { delivered: true, messageId: "1" },
    );
    await adapter.stop();
    assert.deepEqual(sent[0], { chat_id: "-100123", text: "answer", message_thread_id: "77" });
  });
});

describe("plan 080 Telegram draft streaming", () => {
  const PRIVATE: ChannelAuthorization = { identity: identity("user-1"), agentAliases: ["primary"], grantRevision: "grant-1" };
  function identity(userId: string): AgentIdentity {
    return {
      tenantId: "tenant-1",
      userId,
      principal: { kind: "user" as const, id: userId },
      scopes: ["chat"],
      issuedAt: new Date(0).toISOString(),
      verified: true,
    };
  }

  /** Bot API fake that records drafts, then channel sends; drafts are slow on purpose. */
  function draftFetch(
    updates: readonly unknown[],
    drafts: Array<Record<string, unknown>>,
    sent: Array<Record<string, unknown>>,
  ): TelegramFetch {
    let polls = 0;
    return async (url, init) => {
      switch (method(url)) {
        case "getMe":
          return ok({ id: 1 });
        case "getWebhookInfo":
          return ok({ url: "" });
        case "getUpdates":
          polls += 1;
          return polls === 1 ? ok(updates) : never(init?.signal);
        case "sendMessageDraft":
          drafts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          await new Promise((resolve) => setTimeout(resolve, 20));
          return ok(true);
        case "sendMessage":
          sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return ok({ message_id: sent.length });
        default:
          throw new Error(`unexpected method ${method(url)}`);
      }
    };
  }

  function streamingAgent(): ReturnType<typeof createAgent> {
    return createAgent({
      id: "draft-agent",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("first ");
          yield providerTextDelta("second ");
          yield providerTextDelta("third");
          yield providerDone();
        },
      },
    });
  }

  async function runTurn(options: {
    readonly updates: readonly unknown[];
    readonly telegram?: Partial<TelegramAdapterOptions>;
    readonly drafts: Array<Record<string, unknown>>;
    readonly sent: Array<Record<string, unknown>>;
    readonly checkpoints: ReturnType<typeof createMemoryCheckpointStore>;
  }) {
    const adapter = createTelegramAdapter(
      pollingOptions(draftFetch(options.updates, options.drafts, options.sent), {
        checkpoints: options.checkpoints,
        ...options.telegram,
      }),
    );
    const runtime = createMessagingRuntime({
      checkpoints: options.checkpoints,
      authorize: () => PRIVATE,
      resolveAgent: streamingAgent,
      deliver: (reply) => adapter.send(reply),
      onAssistantDelta: (delta) => adapter.sendDraft(delta),
    });
    await adapter.start((event) => runtime.admit(event));
    return { adapter, runtime };
  }

  it("coalesces private-chat drafts and still journals exactly one final reply", async () => {
    const drafts: Array<Record<string, unknown>> = [];
    const sent: Array<Record<string, unknown>> = [];
    const checkpoints = createMemoryCheckpointStore();
    const { adapter, runtime } = await runTurn({
      updates: [message(1, "hello Prism")],
      telegram: { sendDrafts: true },
      drafts,
      sent,
      checkpoints,
    });

    await waitFor(() => sent.length === 1 && drafts.length === 2);
    await runtime.drain();
    await adapter.stop();
    await runtime.stop();

    assert.equal(drafts.length, 2, "one request in flight: four deltas coalesce into the latest partial");
    assert.equal(drafts[0]?.text, "first ");
    assert.deepEqual(
      drafts.map((draft) => [draft.chat_id, draft.draft_id, draft.text]),
      [
        ["101", 1, "first "],
        ["101", 1, "first second third"],
      ],
    );
    assert.deepEqual(
      sent.map((body) => body.text),
      ["first second third"],
    );
    const replies = await checkpoints.listCheckpoints({ namespace: "prism.channels.v1.reply" });
    const journaled = replies.items[0];
    assert.equal(replies.items.length, 1, "drafts are ephemeral: no reply row is ever staged for them");
    assert.equal((journaled?.value as { kind?: string } | undefined)?.kind, "final");
  });

  it("never previews a group chat even with drafts and group admission enabled", async () => {
    const drafts: Array<Record<string, unknown>> = [];
    const sent: Array<Record<string, unknown>> = [];
    const checkpoints = createMemoryCheckpointStore();
    const { adapter, runtime } = await runTurn({
      updates: [
        message(1, "topic question", {
          message: {
            message_id: 1,
            text: "topic question",
            message_thread_id: 77,
            chat: { id: -100123, type: "supergroup", is_forum: true },
            from: { id: 202, is_bot: false },
          },
        }),
      ],
      telegram: { sendDrafts: true, allowGroups: true },
      drafts,
      sent,
      checkpoints,
    });

    await waitFor(() => sent.length === 1);
    await runtime.drain();
    await adapter.stop();
    await runtime.stop();

    assert.deepEqual(drafts, [], "Bot API drafts are private-chat only");
    assert.deepEqual(sent[0], { chat_id: "-100123", text: "first second third", message_thread_id: "77" });
  });

  it("sends no drafts unless the adapter opts in", async () => {
    const drafts: Array<Record<string, unknown>> = [];
    const sent: Array<Record<string, unknown>> = [];
    const { adapter, runtime } = await runTurn({
      updates: [message(1, "hello Prism")],
      drafts,
      sent,
      checkpoints: createMemoryCheckpointStore(),
    });

    await waitFor(() => sent.length === 1);
    await runtime.drain();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await adapter.stop();
    await runtime.stop();

    assert.deepEqual(drafts, [], "streaming is opt-in per adapter");
    assert.deepEqual(
      sent.map((body) => body.text),
      ["first second third"],
    );
  });

  it("caps a preview to the tail of the outbound budget and drops previews after stop", async () => {
    const drafts: Array<Record<string, unknown>> = [];
    const adapter = createTelegramAdapter(
      pollingOptions(
        async (url, init) => {
          if (method(url) !== "sendMessageDraft") throw new Error(`unexpected method ${method(url)}`);
          drafts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return ok(true);
        },
        { sendDrafts: true },
      ),
    );

    adapter.sendDraft({
      connectionId: CONNECTION,
      externalConversationId: "101",
      threadId: "77",
      text: `${"x".repeat(4_000)}tail`,
    });
    await waitFor(() => drafts.length === 1);
    assert.equal(String(drafts[0]?.text).length, 3_500);
    assert.ok(String(drafts[0]?.text).endsWith("tail"));
    assert.equal(drafts[0]?.message_thread_id, "77");
    assert.equal(drafts[0]?.draft_id, 1);

    adapter.sendDraft({ connectionId: "other-connection", externalConversationId: "101", text: "foreign" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(drafts.length, 1, "a foreign connection never drafts");

    await adapter.stop();
    adapter.sendDraft({ connectionId: CONNECTION, externalConversationId: "101", text: "after stop" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(drafts.length, 1, "stop ends further previews");
  });
});

describe("plan 080 bounded attachments and voice", () => {
  const AUDIO = new Uint8Array([9, 8, 7, 6, 5]);
  const AUDIO_BASE64 = Buffer.from(AUDIO).toString("base64");

  function urlPath(url: Parameters<TelegramFetch>[0]): string {
    return new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url).pathname;
  }

  /** Fake Bot API serving one update batch, `getFile` and one bounded file download. */
  function mediaBot(options: {
    updates: readonly unknown[];
    calls: string[];
    fileSize?: number;
    bytes?: Uint8Array;
    filePath?: string;
  }): TelegramFetch {
    let polls = 0;
    return async (url, init) => {
      if (urlPath(url).includes("/file/bot")) {
        options.calls.push("download");
        const body = options.bytes ?? AUDIO;
        const copy = new Uint8Array(body.byteLength);
        copy.set(body);
        return new Response(copy);
      }
      const name = method(url);
      options.calls.push(name);
      switch (name) {
        case "getMe":
          return ok({ id: 1 });
        case "getWebhookInfo":
          return ok({ url: "" });
        case "getUpdates":
          polls += 1;
          return polls === 1 ? ok(options.updates) : never(init?.signal);
        case "getFile":
          return ok({
            file_id: "telegram-file-1",
            file_size: options.fileSize ?? AUDIO.byteLength,
            file_path: options.filePath ?? "voice/file_1.oga",
          });
        case "sendMessage":
        case "sendVoice":
          return ok({ message_id: 1 });
        default:
          throw new Error(`unexpected method ${name}`);
      }
    };
  }

  function photo(size: number): Record<string, unknown> {
    return {
      update_id: 1,
      message: {
        chat: { id: 101, type: "private" },
        from: { id: 202, is_bot: false },
        caption: "look",
        photo: [
          { file_id: "small", file_size: 10, width: 1, height: 1 },
          { file_id: "large", file_size: size, width: 9, height: 9 },
        ],
      },
    };
  }

  function voice(updateId = 7, declaredSize = AUDIO.byteLength): Record<string, unknown> {
    return {
      update_id: updateId,
      message: {
        chat: { id: 101, type: "private" },
        from: { id: 202, is_bot: false },
        voice: { file_id: "telegram-file-1", file_size: declaredSize, mime_type: "audio/ogg" },
      },
    };
  }

  it("parses a photo into one bounded ref of its largest size and keeps the caption", async () => {
    const received: ChannelInboundEvent[] = [];
    const calls: string[] = [];
    const adapter = createTelegramAdapter(pollingOptions(mediaBot({ updates: [photo(900)], calls })));

    await adapter.start(async (event) => {
      received.push(event);
      return { status: "accepted" };
    });
    await waitFor(() => received.length === 1);
    await adapter.stop();

    assert.equal(received[0]?.text, "look");
    assert.deepEqual(received[0]?.attachments, [{ kind: "image", transportFileId: "large", byteLength: 900 }]);
    assert.ok(!calls.includes("getFile"), "a photo is fetched lazily by the runtime's model-input gate");
  });

  it("transcribes a voice note before admission and never journals the audio", async () => {
    const calls: string[] = [];
    const checkpoints = createMemoryCheckpointStore();
    const leases = createMemoryLeaseStore();
    const transcribed: string[] = [];
    const delivered: ChannelReply[] = [];
    const adapter = createTelegramAdapter(
      pollingOptions(mediaBot({ updates: [voice()], calls }), {
        checkpoints,
        leases,
        transcribe: async (audio, format) => {
          transcribed.push(`${format}:${Buffer.from(audio).toString("base64")}`);
          return "spoken words";
        },
      }),
    );
    const agent = createAgent({
      id: "telegram-agent",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("heard you");
          yield providerDone();
        },
      },
    });
    const runtime = createMessagingRuntime({
      checkpoints,
      leases,
      authorize: () => ({
        identity: {
          tenantId: "tenant-1",
          userId: "user-1",
          principal: { kind: "user", id: "user-1" },
          scopes: ["chat"],
          issuedAt: new Date(0).toISOString(),
          verified: true,
        },
        agentAliases: ["primary"],
        grantRevision: "grant-1",
      }),
      resolveAgent: () => agent,
      deliver: (reply) => {
        delivered.push(reply);
        return { delivered: true };
      },
    });

    await adapter.start((event) => runtime.admit(event));
    await waitFor(() => delivered.length === 1);
    await runtime.drain();
    await adapter.stop();
    await runtime.stop();

    assert.deepEqual(transcribed, [`audio/ogg:${AUDIO_BASE64}`]);
    assert.equal(delivered[0]?.text, "heard you");
    for (const namespace of ["prism.channels.v1.operation", "prism.channels.v1.reply"]) {
      const journal = await checkpoints.listCheckpoints({ namespace });
      assert.ok(!JSON.stringify(journal.items).includes(AUDIO_BASE64), `${namespace} never holds audio`);
      assert.ok(journal.items.length > 0, `${namespace} was written`);
    }
  });

  it("fails closed before downloading when the declared attachment size exceeds the cap", async () => {
    const calls: string[] = [];
    const received: ChannelInboundEvent[] = [];
    const adapter = createTelegramAdapter(
      pollingOptions(mediaBot({ updates: [voice(7, 4096)], calls, fileSize: 4096 }), {
        maxAttachmentBytes: 1024,
        transcribe: async () => "never",
      }),
    );

    await adapter.start(async (event) => {
      received.push(event);
      return { status: "accepted" };
    });
    await waitFor(() => received.length === 1);
    await adapter.stop();

    assert.ok(calls.includes("getFile"), "the declared size is read from getFile");
    assert.ok(!calls.includes("download"), "an oversize body is never fetched");
    assert.equal(received[0]?.text, "");
    assert.equal(received[0]?.attachments?.[0]?.byteLength, 4096);
  });

  it("keeps a document inert without a host extractor and extracts it when wired", async () => {
    const document = (updateId: number): Record<string, unknown> => ({
      update_id: updateId,
      message: {
        chat: { id: 101, type: "private" },
        from: { id: 202, is_bot: false },
        document: { file_id: "telegram-file-1", file_name: "notes.txt", mime_type: "text/plain", file_size: 5 },
      },
    });
    const inert: ChannelInboundEvent[] = [];
    const calls: string[] = [];
    const withoutHook = createTelegramAdapter(pollingOptions(mediaBot({ updates: [document(7)], calls })));
    await withoutHook.start(async (event) => {
      inert.push(event);
      return { status: "accepted" };
    });
    await waitFor(() => inert.length === 1);
    await withoutHook.stop();

    const extracted: ChannelInboundEvent[] = [];
    const hookCalls: string[] = [];
    const withHook = createTelegramAdapter(
      pollingOptions(mediaBot({ updates: [document(8)], calls: hookCalls }), {
        extractDocumentText: async (bytes, mimeType) => `${mimeType}:${Buffer.from(bytes).toString("utf8")}`,
      }),
    );
    await withHook.start(async (event) => {
      extracted.push(event);
      return { status: "accepted" };
    });
    await waitFor(() => extracted.length === 1);
    await withHook.stop();

    assert.equal(inert[0]?.text, "", "no silent dump without the host extractor");
    assert.ok(!calls.includes("getFile"));
    assert.deepEqual(extracted[0]?.attachments, [
      { kind: "document", transportFileId: "telegram-file-1", mimeType: "text/plain", byteLength: 5, fileName: "notes.txt" },
    ]);
    assert.equal(extracted[0]?.text, "text/plain:\t\b\u0007\u0006\u0005");
    assert.deepEqual(
      hookCalls.filter((call) => call !== "getUpdates" && call !== "getMe" && call !== "getWebhookInfo"),
      ["getFile", "download"],
    );
  });

  it("resolves voice text on the mounted webhook path too", async () => {
    const leases = createMemoryLeaseStore();
    const received: ChannelInboundEvent[] = [];
    const handler = createTelegramWebhookHandler({
      connectionId: CONNECTION,
      botToken: TOKEN,
      webhookSecret: "webhook-secret",
      leases,
      cursorOwnership: OWNER,
      apiOrigin: "https://telegram.test",
      fetch: mediaBot({ updates: [], calls: [], bytes: AUDIO }),
      transcribe: async () => "webhook transcript",
      admit: async (event) => {
        received.push(event);
        return { status: "accepted" };
      },
    });

    assert.equal((await handler(webhookRequest(voice(9, AUDIO.byteLength)))).status, 204);
    assert.equal(received[0]?.text, "webhook transcript");
    assert.equal(received[0]?.attachments?.[0]?.kind, "voice");
  });

  it("fetches bytes for a well-formed ref only, and not at all once stopped", async () => {
    const calls: string[] = [];
    const adapter = createTelegramAdapter(pollingOptions(mediaBot({ updates: [], calls })));

    const fetched = await adapter.fetchAttachment({ kind: "image", transportFileId: "telegram-file-1", mimeType: "image/png" });
    assert.equal(Buffer.from(fetched?.bytes ?? new Uint8Array()).toString("hex"), Buffer.from(AUDIO).toString("hex"));
    assert.equal(fetched?.mimeType, "image/png");
    assert.equal(await adapter.fetchAttachment({ kind: "image", transportFileId: "" }), undefined);
    assert.equal(await adapter.fetchAttachment({ kind: "sticker", transportFileId: "x" } as never), undefined);
    assert.equal(await adapter.fetchAttachment({ kind: "image", transportFileId: "telegram-file-1", byteLength: -1 }), undefined);
    assert.equal(calls.filter((call) => call === "getFile").length, 1);

    await adapter.stop();
    assert.equal(await adapter.fetchAttachment({ kind: "image", transportFileId: "telegram-file-1" }), undefined);
  });

  it("sends synthesized voice alongside the text and never fails the reply on voice errors", async () => {
    const sentText: Array<Record<string, unknown>> = [];
    const sentVoice: FormData[] = [];
    const calls: string[] = [];
    let synthesize = true;
    const adapter = createTelegramAdapter(
      pollingOptions(
        async (url, init) => {
          const name = method(url);
          calls.push(name);
          if (name === "sendMessage") {
            sentText.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
            return ok({ message_id: 1 });
          }
          if (name === "sendVoice") {
            sentVoice.push(init?.body as FormData);
            return ok({ message_id: 2 });
          }
          throw new Error(`unexpected method ${name}`);
        },
        {
          synthesize: async () => {
            if (!synthesize) throw new Error("tts down");
            return { audio: AUDIO, format: "audio/ogg" };
          },
        },
      ),
    );

    const delivered = await adapter.send({
      connectionId: CONNECTION,
      externalConversationId: "101",
      threadId: "77",
      kind: "final",
      text: "spoken answer",
    });
    assert.equal(delivered.delivered, true);
    assert.equal(sentText.length, 1);
    assert.equal(sentVoice.length, 1);
    const form = sentVoice[0];
    assert.equal(form?.get("chat_id"), "101");
    assert.equal(form?.get("message_thread_id"), "77");
    const audio = form?.get("voice");
    assert.ok(audio instanceof Blob);
    assert.equal(audio.type, "audio/ogg");
    assert.equal(audio.size, AUDIO.byteLength);

    synthesize = false;
    const failed = await adapter.send({ connectionId: CONNECTION, externalConversationId: "101", kind: "final", text: "still text" });
    assert.equal(failed.delivered, true, "a voice failure never fails a delivered text reply");
    assert.equal(sentVoice.length, 1);

    const notice = await adapter.send({ connectionId: CONNECTION, externalConversationId: "101", kind: "notice", text: "notice" });
    assert.equal(notice.delivered, true);
    assert.equal(sentVoice.length, 1, "notices stay text-only");
  });

  it("skips voice for formats the Bot API does not accept", async () => {
    const calls: string[] = [];
    const adapter = createTelegramAdapter(
      pollingOptions(
        async (url) => {
          const name = method(url);
          calls.push(name);
          if (name === "sendMessage") return ok({ message_id: 1 });
          if (name === "sendVoice") throw new Error("sendVoice must not run for wav");
          throw new Error(`unexpected method ${name}`);
        },
        {
          synthesize: async () => ({ audio: AUDIO, format: "wav" }),
        },
      ),
    );

    assert.equal(
      (await adapter.send({ connectionId: CONNECTION, externalConversationId: "101", kind: "final", text: "text" })).delivered,
      true,
    );
    assert.deepEqual(calls, ["sendMessage"]);
  });
});
