import assert from "node:assert/strict";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
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
import { providerPackage } from "@arnilo/prism/provider-kit";
import { ChannelTokenLiteralError, CHANNEL_TOKEN_LITERAL_CODE, createChannelRuntime } from "../index.js";
import { createMemoryCheckpointStore } from "../memory-stores.js";
import { chunkDiscordText, connectDiscord, createDiscordAdapter, DISCORD_GATEWAY_INTENTS, parseDiscordMessage } from "../discord.js";
import type { DiscordSocket } from "../discord-gateway.js";
import type { ChannelAuthorizeInput, ChannelAuthorization } from "../types.js";

const BOT = "discord-bot-token-0123456789abcdef";
process.env.TEST_DISCORD_BOT = BOT;
const APP_ID = "999";
const keys = generateKeyPairSync("ed25519");
const PUBLIC_KEY_HEX = Buffer.from(String(keys.publicKey.export({ format: "jwk" }).x), "base64url").toString("hex");
process.env.TEST_DISCORD_PUBLIC_KEY = PUBLIC_KEY_HEX;

interface ApiCall {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown>;
  readonly auth: string | null;
  readonly at: number;
}

type Responder = (call: ApiCall, index: number) => Response | Promise<Response> | undefined;

function fakeDiscord(responder?: Responder) {
  const calls: ApiCall[] = [];
  let id = 5000;
  const fetch = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const call = {
      method: String(init?.method ?? "GET"),
      path: url.pathname.replace(/^\/api\/v10/, ""),
      body: init?.body === undefined ? {} : (JSON.parse(String(init.body)) as Record<string, unknown>),
      auth: new Headers(init?.headers).get("authorization"),
      at: Date.now(),
    };
    calls.push(call);
    const custom = await responder?.(call, calls.length - 1);
    if (custom !== undefined) return custom;
    if (call.path === "/gateway/bot") return Response.json({ url: "wss://gateway.discord.test" });
    if (call.method === "DELETE" || call.path.startsWith("/interactions/")) return new Response(null, { status: 204 });
    id += 1;
    return Response.json({ id: String(id), channel_id: call.path.split("/")[2] });
  }) as typeof globalThis.fetch;
  const posts = () => calls.filter((call) => call.method === "POST" && /^\/channels\/\d+\/messages$/.test(call.path));
  return { calls, fetch, posts };
}

function identityFor(input: ChannelAuthorizeInput): ChannelAuthorization {
  const userId = input.externalActorId;
  return {
    identity: {
      tenantId: "acme",
      userId,
      principal: { kind: "user", id: userId },
      scopes: ["chat"],
      issuedAt: new Date(0).toISOString(),
      verified: true,
    },
    grantRevision: "1",
  };
}

const allowList = new Set(["1", "2"]);
const authorize = (input: ChannelAuthorizeInput) => allowList.has(input.externalActorId) && identityFor(input);

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

async function textAgent(calls = { count: 0 }, ids = new Set<string>(), answer?: (n: number) => string) {
  return await createAgent({
    id: "discord-agent",
    model: { provider: "mock", model: "demo" },
    slots: { store: trackingStore(ids) },
    packages: [providerPackage("test-provider", [textProvider(calls, answer)])],
  });
}

async function approvalAgent(calls: { model: number; tool: number }) {
  return await createAgent({
    hooks: askEveryTool(),
    id: "discord-approval-agent",
    model: { provider: "mock", model: "demo" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("test-provider", [
        {
          id: "mock",
          async *generate(request) {
            calls.model += 1;
            if (request.messages.at(-1)?.role === "user") {
              yield providerToolCall(toolCallContent(`call-${calls.model}`, "write", {}));
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
          execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "write", value: ++calls.tool }),
        },
      ],
    },
  });
}

let counter = 0;

function message(
  content: string,
  options: { guild?: string | null; channel?: string; author?: string; mention?: boolean; bot?: boolean; webhook?: boolean } = {},
) {
  counter += 1;
  const guild = options.guild === undefined ? "100" : options.guild;
  const mention = options.mention ?? guild !== null;
  return {
    t: "MESSAGE_CREATE",
    d: {
      id: String(10_000 + counter),
      type: 0,
      channel_id: options.channel ?? (guild === null ? "300" : "200"),
      ...(guild === null ? {} : { guild_id: guild }),
      author: { id: options.author ?? "1", ...(options.bot ? { bot: true } : {}) },
      ...(options.webhook ? { webhook_id: "77" } : {}),
      content: mention ? `<@${APP_ID}> ${content}` : content,
      mentions: mention ? [{ id: APP_ID }] : [],
    },
  };
}

function interaction(customId: string, user = "1", options: { guild?: string | null; channel?: string } = {}) {
  counter += 1;
  const guild = options.guild === undefined ? "100" : options.guild;
  return {
    id: String(20_000 + counter),
    application_id: APP_ID,
    type: 3,
    token: `itoken-${counter}`,
    channel_id: options.channel ?? (guild === null ? "300" : "200"),
    ...(guild === null ? { user: { id: user } } : { guild_id: guild, member: { user: { id: user } } }),
    data: { component_type: 2, custom_id: customId },
    message: { id: "4242" },
  };
}

function signedRequest(payload: unknown, options: { timestamp?: number; signature?: string | null; tamper?: boolean } = {}): Request {
  const body = JSON.stringify(payload);
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "content-type": "application/json", "x-signature-timestamp": timestamp };
  const signature =
    options.signature === undefined ? edSign(null, Buffer.from(timestamp + body), keys.privateKey).toString("hex") : options.signature;
  if (signature !== null) headers["x-signature-ed25519"] = signature;
  return new Request("https://bot.example.test/discord/interactions", {
    method: "POST",
    headers,
    body: options.tamper ? body.replace("200", "201") : body,
  });
}

function buttonsOf(call: ApiCall | undefined): Array<{ label: string; custom_id: string }> {
  const rows = call?.body.components as Array<{ components: Array<{ label: string; custom_id: string }> }> | undefined;
  return rows?.flatMap((row) => row.components) ?? [];
}

class FakeSocket implements DiscordSocket {
  readonly sent: Array<{ op: number; d: unknown }> = [];
  readonly listeners = new Map<string, Array<(event: { data?: unknown; code?: number }) => void>>();
  closed: number | undefined;

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (event: { data?: unknown; code?: number }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, event: { data?: unknown; code?: number }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  frame(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as { op: number; d: unknown });
  }

  close(code = 1000): void {
    if (this.closed !== undefined) return;
    this.closed = code;
    this.emit("close", { code });
  }

  ops(): number[] {
    return this.sent.map((frame) => frame.op);
  }
}

async function until(condition: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

function socketFactory() {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    webSocket: (url: string) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  };
}

describe("plan 236 Discord channel", () => {
  it("gateway_identifies_heartbeats_and_resumes_after_a_drop", async () => {
    const calls = { count: 0 };
    const discord = fakeDiscord();
    const { sockets, webSocket } = socketFactory();
    const handle = await connectDiscord(await textAgent(calls), {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      authorize,
      fetch: discord.fetch,
      webSocket,
      reconnectBaseMs: 5,
      random: () => 0.5,
    });
    const started = handle.start();
    await until(() => sockets.length === 1);
    const first = sockets[0] as FakeSocket;
    assert.equal(first.url, "wss://gateway.discord.test/?v=10&encoding=json");
    assert.equal(discord.calls[0]?.path, "/gateway/bot");
    assert.equal(discord.calls[0]?.auth, `Bot ${BOT}`);
    first.frame({ op: 10, d: { heartbeat_interval: 40 } });
    await until(() => first.ops().includes(2));
    const identify = first.sent.find((frame) => frame.op === 2)?.d as { token: string; intents: number };
    assert.equal(identify.token, BOT);
    assert.equal(identify.intents, DISCORD_GATEWAY_INTENTS);
    assert.equal(DISCORD_GATEWAY_INTENTS, (1 << 9) | (1 << 12) | (1 << 15));
    first.frame({
      op: 0,
      t: "READY",
      s: 1,
      d: { session_id: "sess-1", resume_gateway_url: "wss://resume.discord.test", user: { id: "888" } },
    });
    await started;
    // The first heartbeat waits interval × jitter (20 ms), then carries the last sequence.
    await until(() => first.ops().includes(1));
    assert.deepEqual(
      first.sent.find((frame) => frame.op === 1),
      { op: 1, d: 1 },
    );
    first.frame({ op: 11 });

    // A message over the Gateway is admitted; the READY user id is now the bot id.
    first.frame({ op: 0, t: "MESSAGE_CREATE", s: 2, d: { ...message("hi").d, content: "<@888> hi", mentions: [{ id: "888" }] } });
    await until(() => calls.count === 1);
    await handle.drain();
    assert.equal(discord.posts()[0]?.body.content, "answer 1");

    // No ACK for the next beat: the zombie connection is dropped and resumed on resume_gateway_url.
    await until(() => first.closed !== undefined, 1000);
    assert.equal(first.closed, 4000, "a resumable close code keeps the session");
    await until(() => sockets.length === 2);
    const second = sockets[1] as FakeSocket;
    assert.equal(second.url, "wss://resume.discord.test/?v=10&encoding=json");
    second.frame({ op: 10, d: { heartbeat_interval: 1000 } });
    await until(() => second.ops().includes(6));
    assert.deepEqual(second.sent.find((frame) => frame.op === 6)?.d, { token: BOT, session_id: "sess-1", seq: 2 });
    second.frame({ op: 0, t: "RESUMED", s: 3, d: {} });

    // op 7 Reconnect resumes; op 9 with d:false identifies afresh on the /gateway/bot URL.
    second.frame({ op: 7, d: null });
    await until(() => sockets.length === 3);
    const third = sockets[2] as FakeSocket;
    assert.equal(third.url, "wss://resume.discord.test/?v=10&encoding=json");
    third.frame({ op: 10, d: { heartbeat_interval: 1000 } });
    await until(() => third.ops().includes(6));
    third.frame({ op: 9, d: false });
    await until(() => sockets.length === 4);
    const fourth = sockets[3] as FakeSocket;
    assert.equal(fourth.url, "wss://gateway.discord.test/?v=10&encoding=json");
    fourth.frame({ op: 10, d: { heartbeat_interval: 1000 } });
    await until(() => fourth.ops().includes(2));
    assert.equal(fourth.ops().includes(6), false);
    // A server heartbeat request is answered at once.
    fourth.frame({ op: 1, d: null });
    assert.equal(fourth.ops().at(-1), 1);

    // A fatal close (4004 authentication failed) never reconnects.
    fourth.close(4004);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(sockets.length, 4);
    await handle.close();
  });

  it("gateway_start_fails_on_a_fatal_close_before_ready", async () => {
    const { sockets, webSocket } = socketFactory();
    const handle = await connectDiscord(await textAgent(), {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      authorize,
      fetch: fakeDiscord().fetch,
      webSocket,
    });
    const started = handle.start();
    await until(() => sockets.length === 1);
    (sockets[0] as FakeSocket).close(4014);
    await assert.rejects(started, /close 4014/);
    await handle.close();
  });

  it("bad_interaction_signature_is_rejected", async () => {
    const calls = { model: 0, tool: 0 };
    const discord = fakeDiscord();
    const handle = await connectDiscord(await approvalAgent(calls), {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      publicKey: "env:TEST_DISCORD_PUBLIC_KEY",
      authorize,
      fetch: discord.fetch,
    });
    const ping = { id: "1", type: 1, token: "ping-token", application_id: APP_ID };
    const pong = (await handle.handle(signedRequest(ping))) as Response;
    assert.equal(pong.status, 200);
    assert.deepEqual(await pong.json(), { type: 1 });
    const stale = Math.floor(Date.now() / 1000) - 10 * 60;
    const refused = (await Promise.all([
      handle.handle(signedRequest(ping, { signature: null })),
      handle.handle(signedRequest(ping, { signature: "ab".repeat(64) })),
      handle.handle(signedRequest(ping, { timestamp: stale })),
      handle.handle(signedRequest(interaction("p:a:".padEnd(47, "x")), { tamper: true })),
    ])) as Response[];
    assert.deepEqual(
      refused.map((response) => response.status),
      [401, 401, 401, 401],
    );
    // A signed click is admitted and acknowledged in the HTTP response, with no REST callback.
    await handle.handle(message("write it"));
    await handle.drain();
    const allow = buttonsOf(discord.posts()[0]).find((button) => button.label === "Allow once");
    assert.ok(allow);
    const ack = (await handle.handle(signedRequest(interaction(allow.custom_id)))) as Response;
    assert.deepEqual(await ack.json(), { type: 6 });
    await handle.drain();
    assert.equal(calls.tool, 1);
    assert.equal(
      discord.calls.some((call) => call.path.startsWith("/interactions/")),
      false,
    );
    // Without a public key the endpoint refuses everything.
    const gatewayOnly = await connectDiscord(await textAgent(), {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      authorize,
      fetch: discord.fetch,
    });
    assert.equal(((await gatewayOnly.handle(signedRequest(ping))) as Response).status, 401);
    await assert.rejects(
      connectDiscord(await textAgent(), { token: "env:TEST_DISCORD_BOT", applicationId: APP_ID, publicKey: "not-hex", authorize }),
      /64-character hex/,
    );
    await handle.close();
    await gatewayOnly.close();
  });

  it("own_and_bot_messages_are_ignored", async () => {
    const calls = { count: 0 };
    const discord = fakeDiscord();
    const handle = await connectDiscord(await textAgent(calls), {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      authorize,
      fetch: discord.fetch,
    });
    for (const payload of [
      message("echo", { author: APP_ID }),
      message("other bot", { bot: true }),
      message("webhook", { webhook: true }),
      message("chatter without a mention", { mention: false }),
      { t: "MESSAGE_CREATE", d: { ...message("system").d, type: 7 } },
    ]) {
      assert.equal(await handle.handle(payload), undefined);
    }
    await handle.drain();
    assert.equal(calls.count, 0);
    assert.equal(discord.calls.length, 0);
    await handle.close();
    // A host may admit other bots, never its own messages.
    const parse = (data: unknown, allowBots: boolean) => parseDiscordMessage("d", data, { botUserId: APP_ID, allowBots });
    assert.ok(parse(message("other bot", { bot: true, author: "5" }).d, true));
    assert.equal(parse(message("echo", { author: APP_ID }).d, true), undefined);
    // A DM needs no mention.
    assert.equal(parse(message("dm", { guild: null }).d, false)?.externalConversationId, "dm:300");
  });

  it("unauthorized_sender_starts_no_session_work", async () => {
    const calls = { count: 0 };
    const ids = new Set<string>();
    const discord = fakeDiscord();
    const handle = await connectDiscord(await textAgent(calls, ids), {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      authorize,
      fetch: discord.fetch,
    });
    const denied = (await handle.handle(message("let me in", { author: "9" }))) as { status: string };
    await handle.drain();
    assert.equal(denied.status, "denied");
    assert.equal(calls.count, 0);
    assert.equal(ids.size, 0);
    assert.equal(discord.calls.length, 0);
    const open = await connectDiscord(await textAgent(calls, ids), {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      fetch: discord.fetch,
    } as unknown as Parameters<typeof connectDiscord>[1]);
    const admission = (await open.handle(message("hello"))) as { status: string };
    await open.drain();
    assert.equal(admission.status, "denied", "no authorize is deny-all, never the runtime's open default");
    assert.equal(calls.count, 0);
    assert.equal(ids.size, 0);
    await handle.close();
    await open.close();
  });

  it("thread_binds_to_one_session", async () => {
    const calls = { count: 0 };
    const ids = new Set<string>();
    const discord = fakeDiscord();
    const handle = await connectDiscord(await textAgent(calls, ids), {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      authorize,
      fetch: discord.fetch,
    });
    // A thread is its own channel id: two mentions in thread 700 continue one session.
    await handle.handle(message("first", { channel: "700" }));
    await handle.drain();
    await handle.handle(message("second", { channel: "700" }));
    await handle.drain();
    assert.equal(calls.count, 2);
    assert.equal(ids.size, 1);
    assert.deepEqual(
      discord.posts().map((call) => call.path),
      ["/channels/700/messages", "/channels/700/messages"],
    );
    // Another thread, and the same channel id in another guild, are other sessions.
    await handle.handle(message("elsewhere", { channel: "701" }));
    await handle.drain();
    await handle.handle(message("other guild", { channel: "700", guild: "101" }));
    await handle.drain();
    assert.equal(ids.size, 3);
    // `!new` starts a new generation in thread 700.
    await handle.handle(message("!new", { channel: "700" }));
    await handle.drain();
    await handle.handle(message("after new", { channel: "700" }));
    await handle.drain();
    assert.equal(ids.size, 4);
    await handle.close();
  });

  it("long_reply_is_split_at_the_platform_limit", async () => {
    const long = `${"a".repeat(1_999)}😀${"b".repeat(100)} @everyone`;
    const discord = fakeDiscord();
    const handle = await connectDiscord(await textAgent({ count: 0 }, new Set(), () => long), {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      authorize,
      fetch: discord.fetch,
    });
    await handle.handle(message("long please", { guild: null }));
    await handle.drain();
    const posts = discord.posts();
    assert.equal(posts.length, 2);
    for (const post of posts) assert.ok(String(post.body.content).length <= 2_000);
    assert.equal(posts[0]?.body.content, "a".repeat(1_999), "a surrogate pair is never split");
    assert.deepEqual(posts[0]?.body.allowed_mentions, { parse: [] }, "model text never pings");
    assert.equal(posts[0]?.body.flags, 4);
    assert.deepEqual(chunkDiscordText("x".repeat(4_001)).length, 3);
    await handle.close();
  });

  it("approval_component_is_sender_bound_one_use_and_expires", async () => {
    const calls = { model: 0, tool: 0 };
    const discord = fakeDiscord();
    const handle = await connectDiscord(await approvalAgent(calls), {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      authorize,
      fetch: discord.fetch,
    });
    await handle.handle(message("write it", { channel: "700" }));
    await handle.drain();
    const prompt = discord.posts()[0];
    assert.equal(prompt?.path, "/channels/700/messages");
    const allow = buttonsOf(prompt).find((button) => button.label === "Allow once");
    assert.ok(allow);
    // User 2 may talk to the bot, but the control is bound to user 1.
    await handle.handle({ t: "INTERACTION_CREATE", d: interaction(allow.custom_id, "2", { channel: "700" }) });
    await handle.drain();
    assert.equal(calls.tool, 0);
    // Every click is acknowledged with DEFERRED_UPDATE_MESSAGE on the unauthenticated callback route.
    const acks = discord.calls.filter((call) => call.path.startsWith("/interactions/"));
    assert.equal(acks.length, 1);
    assert.deepEqual(acks[0]?.body, { type: 6 });
    assert.equal(acks[0]?.auth, null);
    const click = interaction(allow.custom_id, "1", { channel: "700" });
    await handle.handle({ t: "INTERACTION_CREATE", d: click });
    await handle.drain();
    assert.equal(calls.tool, 1);
    assert.equal(discord.posts().at(-1)?.body.content, "resumed after approval");
    const replay = (await handle.handle({ t: "INTERACTION_CREATE", d: { ...click, id: "29999" } })) as { status: string };
    await handle.drain();
    assert.equal(replay.status, "denied", "a consumed control is refused");
    assert.equal(calls.tool, 1);
    await handle.close();

    const expiring = { model: 0, tool: 0 };
    const discord2 = fakeDiscord();
    const short = await connectDiscord(await approvalAgent(expiring), {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      authorize,
      fetch: discord2.fetch,
      limits: { approvalTtlMs: 30 },
    });
    await short.handle(message("write it", { guild: null }));
    await short.drain();
    const late = buttonsOf(discord2.posts()[0]).find((button) => button.label === "Allow once");
    assert.ok(late);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const expired = (await short.handle({ t: "INTERACTION_CREATE", d: interaction(late.custom_id, "1", { guild: null }) })) as {
      status: string;
    };
    await short.drain();
    assert.equal(expired.status, "denied");
    assert.equal(expiring.tool, 0);
    await short.close();
  });

  it("rate_limit_bucket_is_honored", async () => {
    // The first chunk exhausts its bucket for 300 ms; the second chunk waits for the reset.
    const long = "a".repeat(2_500);
    let first = true;
    const discord = fakeDiscord((call) => {
      if (call.method !== "POST" || !call.path.endsWith("/messages") || !first) return undefined;
      first = false;
      return Response.json(
        { id: "6001" },
        { headers: { "x-ratelimit-bucket": "b1", "x-ratelimit-remaining": "0", "x-ratelimit-reset-after": "0.3" } },
      );
    });
    const handle = await connectDiscord(await textAgent({ count: 0 }, new Set(), () => long), {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      authorize,
      fetch: discord.fetch,
    });
    await handle.handle(message("long", { guild: null }));
    await handle.drain();
    const posts = discord.posts();
    assert.equal(posts.length, 2);
    assert.ok((posts[1]?.at ?? 0) - (posts[0]?.at ?? 0) >= 280, "an exhausted bucket blocks its route until reset");
    await handle.close();

    // A 429 blocks the route for retry_after, then the send is retried and journaled as delivered.
    let limited = true;
    const discord2 = fakeDiscord((call) => {
      if (call.method !== "POST" || !limited) return undefined;
      limited = false;
      return Response.json({ message: "You are being rate limited.", retry_after: 0.25, global: false }, { status: 429 });
    });
    const handle2 = await connectDiscord(await textAgent(), {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      authorize,
      fetch: discord2.fetch,
    });
    await handle2.handle(message("hello", { guild: null }));
    await handle2.drain();
    const retried = discord2.posts();
    assert.equal(retried.length, 2);
    assert.ok((retried[1]?.at ?? 0) - (retried[0]?.at ?? 0) >= 230);
    assert.equal(retried[1]?.body.content, "answer 1");
    await handle2.close();

    // A send whose outcome is unknown stays in the journal until a reconcile resends it.
    let failNext = true;
    const flaky = fakeDiscord((call) => {
      if (call.method !== "POST" || !failNext) return undefined;
      failNext = false;
      throw new TypeError("socket hang up");
    });
    const adapter = createDiscordAdapter({
      connectionId: "discord-1",
      botToken: async () => BOT,
      applicationId: APP_ID,
      fetch: flaky.fetch,
    });
    const runtime = createChannelRuntime(await textAgent(), {
      deliver: (reply) => adapter.send(reply),
      checkpoints: createMemoryCheckpointStore(),
      authorize,
    });
    const event = { connectionId: "discord-1", externalConversationId: "dm:300", externalActorId: "1", eventId: "m:1", text: "hello" };
    const admitted = await runtime.admit(event);
    await runtime.drain();
    const identity = identityFor({ ...event, action: "message", receivedAt: new Date().toISOString() }).identity;
    const unresolved = await runtime.listUnresolved({ identity });
    assert.equal(unresolved[0]?.replyState, "delivery_unknown");
    const resolved = await runtime.reconcile({
      identity,
      connectionId: "discord-1",
      operationId: admitted.operationId ?? "",
      expectedVersion: unresolved[0]?.version ?? 0,
      acknowledgeDuplicateRisk: true,
    });
    assert.equal(resolved.outcome, "reply_delivered");
    await runtime.stop();
    await adapter.stop();
  });

  it("draft_preview_is_rate_bounded_and_deleted_after_final", async () => {
    const discord = fakeDiscord();
    const agent = await createAgent({
      id: "discord-draft-agent",
      model: { provider: "mock", model: "demo" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate() {
              for (let index = 0; index < 10; index += 1) {
                yield providerTextDelta(`part${index} `);
                await new Promise((resolve) => setTimeout(resolve, 40));
              }
              yield providerDone();
            },
          },
        ]),
      ],
    });
    const handle = await connectDiscord(agent, {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      authorize,
      sendDrafts: true,
      draftIntervalMs: 100,
      fetch: discord.fetch,
    });
    await handle.handle(message("stream please", { guild: null }));
    await handle.drain();
    const full = "part0 part1 part2 part3 part4 part5 part6 part7 part8 part9";
    const writes = discord.calls.filter(
      (call) => call.method === "PATCH" || (call.method === "POST" && String(call.body.content).trim() !== full),
    );
    assert.ok(writes.length >= 2, "the preview was posted and edited");
    for (let index = 1; index < writes.length; index += 1) {
      assert.ok((writes[index]?.at ?? 0) - (writes[index - 1]?.at ?? 0) >= 90, "preview writes stay at least one interval apart");
    }
    const finalIndex = discord.calls.findIndex((call) => call.method === "POST" && String(call.body.content).trim() === full);
    const deleteIndex = discord.calls.findIndex((call) => call.method === "DELETE");
    assert.ok(finalIndex >= 0 && deleteIndex > finalIndex, "the preview is deleted after the final reply landed");
    assert.equal(discord.calls[deleteIndex]?.path, discord.calls.find((call) => call.method === "PATCH")?.path);
    assert.equal(discord.calls.slice(deleteIndex + 1).length, 0);
    await handle.close();
  });

  it("literal_token_fails_with_channel_token_literal_error", async () => {
    await assert.rejects(
      connectDiscord(await textAgent(), { token: BOT, applicationId: APP_ID, authorize }),
      (error: unknown) => error instanceof ChannelTokenLiteralError && error.code === CHANNEL_TOKEN_LITERAL_CODE,
    );
  });

  it("no_token_in_events_errors_or_journal", async () => {
    const saved: unknown[] = [];
    const inner = createMemoryCheckpointStore();
    const checkpoints = {
      ...inner,
      saveCheckpoint: (input: Parameters<typeof inner.saveCheckpoint>[0]) => {
        saved.push(input);
        return inner.saveCheckpoint(input);
      },
    };
    const discord = fakeDiscord((call) =>
      call.method === "POST" && String(call.body.content).includes("second")
        ? Response.json({ message: "401: Unauthorized", code: 0 }, { status: 401 })
        : undefined,
    );
    const agent = await createAgent({
      id: "discord-leak-agent",
      model: { provider: "mock", model: "demo" },
      slots: { store: createMemorySessionStore() },
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate(request) {
              const last = JSON.stringify(request.messages.at(-1));
              yield providerTextDelta(last.includes("again") ? `second ${BOT}` : `token ${BOT}`);
              yield providerDone();
            },
          },
        ]),
      ],
    });
    const events: unknown[] = [];
    const handle = await connectDiscord(agent, {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      authorize,
      checkpoints,
      fetch: discord.fetch,
    });
    events.push(await handle.handle(message("leak", { guild: null })));
    await handle.drain();
    events.push(await handle.handle(message("again", { guild: null })));
    await handle.drain();
    const sent = JSON.stringify(discord.calls.map((call) => call.body));
    assert.ok(JSON.stringify(saved).includes("discord_unauthorized"), "the refused send is journaled by a bounded reason only");
    assert.equal(sent.includes(BOT), false, "sent");
    assert.equal(JSON.stringify(saved).includes(BOT), false, "journal");
    assert.equal(JSON.stringify(events).includes(BOT), false, "admissions");
    assert.ok(sent.includes("[REDACTED]"));
    await handle.close();
    // A failing Gateway start reports no token either.
    const failing = await connectDiscord(agent, {
      token: "env:TEST_DISCORD_BOT",
      applicationId: APP_ID,
      authorize,
      fetch: fakeDiscord((call) => (call.path === "/gateway/bot" ? new Response("{}", { status: 401 }) : undefined)).fetch,
      webSocket: socketFactory().webSocket,
    });
    await assert.rejects(failing.start(), (error: unknown) => error instanceof Error && !error.message.includes(BOT));
    await failing.close();
  });

  it("import_is_inert_and_capabilities_declare_a_deadline_ack", () => {
    const adapter = createDiscordAdapter({ connectionId: "discord-inert", botToken: async () => BOT, applicationId: APP_ID });
    assert.deepEqual(adapter.capabilities, { acknowledgement: "deadline", controls: "callback", maxTextCodeUnits: 2_000 });
    assert.deepEqual(adapter.gatewayState(), { botUserId: APP_ID, sequence: null, connected: false });
    assert.throws(() => createDiscordAdapter({ connectionId: "x", botToken: BOT as never, applicationId: APP_ID }), /secret source/);
    assert.throws(() => createDiscordAdapter({ connectionId: "x", botToken: async () => BOT, applicationId: "app" }), /snowflake/);
    assert.throws(
      () => createDiscordAdapter({ connectionId: "x", botToken: async () => BOT, applicationId: APP_ID, apiOrigin: "http://discord.com" }),
      /HTTPS origin/,
    );
  });
});
