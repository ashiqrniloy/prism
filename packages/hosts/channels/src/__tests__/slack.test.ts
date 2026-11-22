import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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
import {
  channelHostUi,
  ChannelTokenLiteralError,
  CHANNEL_TOKEN_LITERAL_CODE,
  createChannelPairingStore,
  createChannelRuntime,
} from "../index.js";
import { createMemoryCheckpointStore } from "../memory-stores.js";
import { chunkSlackText, connectSlack, createSlackAdapter, parseSlackBlockActions, type SlackSocket } from "../slack.js";
import type { ChannelAuthorizeInput, ChannelAuthorization } from "../types.js";

const SIGNING = "slack-signing-secret-0123456789abcdef";
const BOT = "xoxb-slack-bot-token-0123456789";
const APP = "xapp-slack-app-token-0123456789";
process.env.TEST_SLACK_BOT = BOT;
process.env.TEST_SLACK_SIGNING = SIGNING;
process.env.TEST_SLACK_APP = APP;

interface ApiCall {
  readonly method: string;
  readonly body: Record<string, unknown>;
  readonly auth: string | null;
  readonly at: number;
}

type Responder = (call: ApiCall, index: number) => Response | Promise<Response> | undefined;

function fakeSlack(responder?: Responder) {
  const calls: ApiCall[] = [];
  let ts = 1000;
  const fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = url.slice(url.indexOf("/api/") + 5);
    const call = {
      method,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      auth: new Headers(init?.headers).get("authorization"),
      at: Date.now(),
    };
    calls.push(call);
    const custom = await responder?.(call, calls.length - 1);
    if (custom !== undefined) return custom;
    if (method === "apps.connections.open") return Response.json({ ok: true, url: "wss://wss.slack.test/link" });
    ts += 1;
    return Response.json({ ok: true, channel: call.body.channel, ts: `1700000000.${ts}` });
  }) as typeof globalThis.fetch;
  const posts = () => calls.filter((call) => call.method === "chat.postMessage");
  return { calls, fetch, posts };
}

function identityFor(input: ChannelAuthorizeInput): ChannelAuthorization {
  const userId = input.externalActorId.split(":")[1] ?? "unknown";
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

const allowList = new Set(["T1:U1", "T1:U2"]);
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
    id: "slack-agent",
    model: { provider: "mock", model: "demo" },
    slots: { store: trackingStore(ids) },
    packages: [providerPackage("test-provider", [textProvider(calls, answer)])],
  });
}

async function approvalAgent(calls: { model: number; tool: number }) {
  return await createAgent({
    hooks: askEveryTool(),
    id: "slack-approval-agent",
    model: { provider: "mock", model: "demo" },
    slots: { store: createMemorySessionStore() },
    packages: [
      providerPackage("test-provider", [
        {
          id: "mock",
          async *generate(request) {
            calls.model += 1;
            const last = request.messages.at(-1);
            if (last?.role === "user") {
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

let eventCounter = 0;

function mention(text: string, overrides: Record<string, unknown> = {}, event: Record<string, unknown> = {}) {
  eventCounter += 1;
  return {
    type: "event_callback",
    team_id: "T1",
    event_id: `Ev${eventCounter}`,
    event: { type: "app_mention", user: "U1", channel: "C1", ts: `1700000100.${100 + eventCounter}`, text: `<@UBOT> ${text}`, ...event },
    ...overrides,
  };
}

function direct(text: string, event: Record<string, unknown> = {}) {
  eventCounter += 1;
  return {
    type: "event_callback",
    team_id: "T1",
    event_id: `Ev${eventCounter}`,
    event: { type: "message", channel_type: "im", user: "U1", channel: "D1", ts: `1700000200.${100 + eventCounter}`, text, ...event },
  };
}

function blockAction(value: string, user = "U1", message: { ts: string; thread_ts?: string; channel?: string }) {
  eventCounter += 1;
  return {
    type: "block_actions",
    team: { id: "T1" },
    user: { id: user, team_id: "T1" },
    channel: { id: message.channel ?? "C1" },
    container: {
      type: "message",
      message_ts: message.ts,
      channel_id: message.channel ?? "C1",
      ...(message.thread_ts ? { thread_ts: message.thread_ts } : {}),
    },
    message: { ts: message.ts, ...(message.thread_ts ? { thread_ts: message.thread_ts } : {}) },
    actions: [{ action_id: "prism_0", type: "button", value, action_ts: `1700000300.${100 + eventCounter}` }],
  };
}

function sign(body: string, timestamp = Math.floor(Date.now() / 1000), secret = SIGNING): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

function signedRequest(
  payload: unknown,
  options: { timestamp?: number; secret?: string; form?: boolean; signature?: string | null; retry?: string } = {},
): Request {
  const json = JSON.stringify(payload);
  const body = options.form ? `payload=${encodeURIComponent(json)}` : json;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    "content-type": options.form ? "application/x-www-form-urlencoded" : "application/json",
    "x-slack-request-timestamp": String(timestamp),
  };
  const signature = options.signature === undefined ? sign(body, timestamp, options.secret) : options.signature;
  if (signature !== null) headers["x-slack-signature"] = signature;
  if (options.retry) headers["x-slack-retry-num"] = options.retry;
  return new Request("https://bot.example.test/slack/events", { method: "POST", headers, body });
}

function controlsOf(call: ApiCall | undefined): Array<{ text: { text: string }; value: string }> {
  const blocks = call?.body.blocks as Array<{ type: string; elements?: Array<{ text: { text: string }; value: string }> }> | undefined;
  return blocks?.find((block) => block.type === "actions")?.elements ?? [];
}

class FakeSocket implements SlackSocket {
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  closed = false;

  constructor(readonly url: string) {
    queueMicrotask(() => this.emit("open", {}));
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close", {});
  }
}

async function until(condition: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("plan 236 Slack channel", () => {
  it("unsigned_or_stale_request_is_dropped", async () => {
    const calls = { count: 0 };
    const slack = fakeSlack();
    const handle = await connectSlack(await textAgent(calls), {
      token: "env:TEST_SLACK_BOT",
      signingSecret: "env:TEST_SLACK_SIGNING",
      authorize,
      fetch: slack.fetch,
    });
    const stale = Math.floor(Date.now() / 1000) - 10 * 60;
    const responses = (await Promise.all([
      handle.handle(signedRequest(mention("hi"), { signature: null })),
      handle.handle(signedRequest(mention("hi"), { secret: "wrong-secret" })),
      handle.handle(signedRequest(mention("hi"), { timestamp: stale })),
      handle.handle(signedRequest(mention("hi"), { signature: "v0=deadbeef" })),
    ])) as Response[];
    assert.deepEqual(
      responses.map((response) => response.status),
      [401, 401, 401, 401],
    );
    await handle.drain();
    assert.equal(calls.count, 0);
    assert.equal(slack.calls.length, 0);
    // Without a signing secret the Events API path refuses everything.
    const socketOnly = await connectSlack(await textAgent(), {
      token: "env:TEST_SLACK_BOT",
      appToken: "env:TEST_SLACK_APP",
      authorize,
      fetch: slack.fetch,
    });
    assert.equal(((await socketOnly.handle(signedRequest(mention("hi")))) as Response).status, 401);
    await handle.close();
    await socketOnly.close();
  });

  it("url_verification_challenge_is_answered_only_when_signed", async () => {
    const handle = await connectSlack(await textAgent(), {
      token: "env:TEST_SLACK_BOT",
      signingSecret: "env:TEST_SLACK_SIGNING",
      authorize,
      fetch: fakeSlack().fetch,
    });
    const challenge = { type: "url_verification", token: "legacy", challenge: "chal-123" };
    const ok = (await handle.handle(signedRequest(challenge))) as Response;
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { challenge: "chal-123" });
    const unsigned = (await handle.handle(signedRequest(challenge, { signature: null }))) as Response;
    assert.equal(unsigned.status, 401);
    assert.equal((await unsigned.text()).includes("chal-123"), false);
    await handle.close();
  });

  it("duplicate_event_is_admitted_once", async () => {
    const calls = { count: 0 };
    const slack = fakeSlack();
    const handle = await connectSlack(await textAgent(calls), {
      token: "env:TEST_SLACK_BOT",
      signingSecret: "env:TEST_SLACK_SIGNING",
      authorize,
      fetch: slack.fetch,
    });
    const event = mention("hello");
    assert.equal(((await handle.handle(signedRequest(event))) as Response).status, 200);
    assert.equal(((await handle.handle(signedRequest(event, { retry: "1" }))) as Response).status, 200);
    await handle.drain();
    assert.equal(calls.count, 1, "a Slack retry with the same event_id runs once");
    assert.equal(slack.posts().length, 1);
    // Block actions dedupe on message ts + action ts + user.
    const action = blockAction(`p:a:${"x".repeat(43)}`, "U1", { ts: "1700000000.0001" });
    const parsed = parseSlackBlockActions("slack-default", action);
    assert.equal(parsed?.eventId, `1700000000.0001:${action.actions[0]?.action_ts}:U1`);
    assert.equal(
      parseSlackBlockActions("slack-default", blockAction(`p:a:${"x".repeat(43)}`, "U1", { ts: "1700000000.0001" }))?.eventId ===
        parsed?.eventId,
      false,
    );
    await handle.close();
  });

  it("bot_and_subtype_events_are_ignored", async () => {
    const calls = { count: 0 };
    const slack = fakeSlack();
    const handle = await connectSlack(await textAgent(calls), {
      token: "env:TEST_SLACK_BOT",
      signingSecret: "env:TEST_SLACK_SIGNING",
      authorize,
      fetch: slack.fetch,
    });
    const ignored = [
      direct("from a bot", { bot_id: "B1" }),
      direct("edited", { subtype: "message_changed" }),
      mention("bot mention", {}, { bot_id: "B2" }),
      direct("joined", { subtype: "channel_join" }),
      {
        type: "event_callback",
        team_id: "T1",
        event_id: "EvChannel",
        event: { type: "message", channel_type: "channel", user: "U1", channel: "C1", ts: "1700000000.1", text: "chatter" },
      },
    ];
    for (const payload of ignored) assert.equal(((await handle.handle(signedRequest(payload))) as Response).status, 200);
    await handle.drain();
    assert.equal(calls.count, 0);
    assert.equal(slack.calls.length, 0);
    await handle.close();
  });

  it("socket_mode_envelope_is_acknowledged_and_admitted", async () => {
    const calls = { count: 0 };
    const slack = fakeSlack();
    const sockets: FakeSocket[] = [];
    const handle = await connectSlack(await textAgent(calls), {
      token: "env:TEST_SLACK_BOT",
      appToken: "env:TEST_SLACK_APP",
      authorize,
      fetch: slack.fetch,
      webSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    await handle.start();
    assert.equal(slack.calls[0]?.method, "apps.connections.open");
    assert.equal(slack.calls[0]?.auth, `Bearer ${APP}`, "Socket Mode opens with the app-level token");
    const socket = sockets[0];
    assert.ok(socket);
    assert.equal(socket.url, "wss://wss.slack.test/link");
    socket.emit("message", { data: JSON.stringify({ type: "hello" }) });
    socket.emit("message", { data: JSON.stringify({ envelope_id: "env-1", type: "events_api", payload: direct("hello over socket") }) });
    await until(() => socket.sent.length === 1);
    assert.deepEqual(JSON.parse(socket.sent[0] ?? "{}"), { envelope_id: "env-1" });
    await handle.drain();
    assert.equal(calls.count, 1);
    const reply = slack.posts()[0];
    assert.equal(reply?.body.channel, "D1");
    assert.equal(reply?.body.text, "answer 1");
    assert.equal(reply?.auth, `Bearer ${BOT}`);
    assert.equal(reply?.body.thread_ts, undefined, "a top-level DM is answered top-level");
    // Ignored envelopes are still acknowledged so Slack does not redeliver them.
    socket.emit("message", { data: JSON.stringify({ envelope_id: "env-2", type: "slash_commands", payload: {} }) });
    await until(() => socket.sent.length === 2);
    await handle.close();
    assert.equal(socket.closed, true);
  });

  it("draft_preview_is_rate_bounded_and_deleted_after_final", async () => {
    const slack = fakeSlack();
    const agent = await createAgent({
      id: "slack-draft-agent",
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
    const handle = await connectSlack(agent, {
      token: "env:TEST_SLACK_BOT",
      signingSecret: "env:TEST_SLACK_SIGNING",
      authorize,
      sendDrafts: true,
      draftIntervalMs: 100,
      fetch: slack.fetch,
    });
    await handle.handle(signedRequest(mention("stream please")));
    await handle.drain();
    const writes = slack.calls.filter(
      (call) =>
        call.method === "chat.update" ||
        (call.method === "chat.postMessage" &&
          !String(call.body.text).startsWith("part0 part1 part2 part3 part4 part5 part6 part7 part8 part9")),
    );
    assert.ok(writes.length >= 2, "the preview was posted and updated");
    for (let index = 1; index < writes.length; index += 1) {
      assert.ok((writes[index]?.at ?? 0) - (writes[index - 1]?.at ?? 0) >= 90, "preview writes stay at least one interval apart");
    }
    const previewTs = slack.calls.find((call) => call.method === "chat.update")?.body.ts;
    assert.ok(previewTs);
    const methods = slack.calls.map((call) => call.method);
    const finalIndex = slack.calls.findIndex(
      (call) =>
        call.method === "chat.postMessage" &&
        String(call.body.text).trim() === "part0 part1 part2 part3 part4 part5 part6 part7 part8 part9",
    );
    const deleteIndex = methods.indexOf("chat.delete");
    assert.ok(finalIndex >= 0, "the final reply is a separate journaled message");
    assert.ok(deleteIndex > finalIndex, "the preview is deleted after the final reply landed");
    assert.equal(slack.calls[deleteIndex]?.body.ts, previewTs);
    assert.equal(methods.slice(deleteIndex + 1).length, 0, "no preview write follows the delete");
    await handle.close();
  });

  it("unauthorized_sender_starts_no_session_work", async () => {
    const calls = { count: 0 };
    const ids = new Set<string>();
    const slack = fakeSlack();
    const handle = await connectSlack(await textAgent(calls, ids), {
      token: "env:TEST_SLACK_BOT",
      signingSecret: "env:TEST_SLACK_SIGNING",
      authorize,
      fetch: slack.fetch,
    });
    await handle.handle(signedRequest(mention("let me in", {}, { user: "U9" })));
    await handle.drain();
    assert.equal(calls.count, 0);
    assert.equal(ids.size, 0);
    assert.equal(slack.calls.length, 0);
    // No authorize at all is deny-all, never the runtime's open default.
    const open = await connectSlack(await textAgent(calls, ids), {
      token: "env:TEST_SLACK_BOT",
      signingSecret: "env:TEST_SLACK_SIGNING",
      fetch: slack.fetch,
    } as unknown as Parameters<typeof connectSlack>[1]);
    const admission = (await open.handle(mention("hello"))) as { status: string };
    await open.drain();
    assert.equal(admission.status, "denied");
    assert.equal(calls.count, 0);
    assert.equal(ids.size, 0);
    await handle.close();
    await open.close();
  });

  it("thread_binds_to_one_session_and_new_starts_a_generation", async () => {
    const calls = { count: 0 };
    const ids = new Set<string>();
    const slack = fakeSlack();
    const handle = await connectSlack(await textAgent(calls, ids), {
      token: "env:TEST_SLACK_BOT",
      signingSecret: "env:TEST_SLACK_SIGNING",
      authorize,
      fetch: slack.fetch,
    });
    const root = "1700000500.000100";
    await handle.handle(signedRequest(mention("first", {}, { ts: root })));
    await handle.drain();
    await handle.handle(signedRequest(mention("second", {}, { ts: "1700000500.000200", thread_ts: root })));
    await handle.drain();
    assert.equal(calls.count, 2);
    assert.equal(ids.size, 1, "two mentions in one thread continue one session");
    assert.deepEqual(
      slack.posts().map((call) => call.body.thread_ts),
      [root, root],
    );
    // Another thread in the same channel is another session.
    await handle.handle(signedRequest(mention("elsewhere", {}, { ts: "1700000600.000100" })));
    await handle.drain();
    assert.equal(ids.size, 2);
    // `!new` (Slack intercepts a leading `/`) starts a new generation in the first thread.
    await handle.handle(signedRequest(mention("!new", {}, { ts: "1700000500.000300", thread_ts: root })));
    await handle.drain();
    await handle.handle(signedRequest(mention("after new", {}, { ts: "1700000500.000400", thread_ts: root })));
    await handle.drain();
    assert.equal(ids.size, 3, "the thread's next turn runs in a fresh session");
    await handle.close();
  });

  it("long_reply_is_split_at_the_platform_limit", async () => {
    const long = `${"a".repeat(39_999)}😀${"b".repeat(100)}<&>`;
    const slack = fakeSlack();
    const handle = await connectSlack(await textAgent({ count: 0 }, new Set(), () => long), {
      token: "env:TEST_SLACK_BOT",
      signingSecret: "env:TEST_SLACK_SIGNING",
      authorize,
      fetch: slack.fetch,
    });
    await handle.handle(signedRequest(direct("long please")));
    await handle.drain();
    const texts = slack.posts().map((call) => String(call.body.text));
    assert.equal(texts.length, 2);
    for (const text of texts) assert.ok(text.length <= 40_000);
    assert.equal(texts[0], "a".repeat(39_999), "a surrogate pair is never split");
    assert.ok(texts[1]?.endsWith("&lt;&amp;&gt;"), "mrkdwn control characters are escaped");
    assert.equal(slack.posts()[0]?.body.unfurl_links, false);
    assert.deepEqual(chunkSlackText("<!channel>", 40_000), ["&lt;!channel&gt;"]);
    await handle.close();
  });

  it("approval_button_from_another_user_is_refused", async () => {
    const calls = { model: 0, tool: 0 };
    const slack = fakeSlack();
    const handle = await connectSlack(await approvalAgent(calls), {
      token: "env:TEST_SLACK_BOT",
      signingSecret: "env:TEST_SLACK_SIGNING",
      authorize,
      fetch: slack.fetch,
    });
    const root = "1700000700.000100";
    await handle.handle(signedRequest(mention("write it", {}, { ts: root })));
    await handle.drain();
    const prompt = slack.posts()[0];
    assert.equal(prompt?.body.thread_ts, root);
    const allow = controlsOf(prompt).find((control) => control.text.text === "Allow once");
    assert.ok(allow);
    const message = { ts: "1700000700.000200", thread_ts: root };
    // U2 is allowed to talk to the bot, but the control is bound to U1.
    const foreign = (await handle.handle(signedRequest(blockAction(allow.value, "U2", message), { form: true }))) as Response;
    assert.equal(foreign.status, 200);
    await handle.drain();
    assert.equal(calls.tool, 0, "another user's click never resumes the run");
    const own = (await handle.handle(signedRequest(blockAction(allow.value, "U1", message), { form: true }))) as Response;
    assert.equal(own.status, 200);
    await handle.drain();
    assert.equal(calls.tool, 1);
    assert.equal(slack.posts().at(-1)?.body.text, "resumed after approval");
    assert.equal(slack.posts().at(-1)?.body.thread_ts, root);
    await handle.close();
  });

  it("approval_is_one_use_and_expires", async () => {
    const calls = { model: 0, tool: 0 };
    const slack = fakeSlack();
    const handle = await connectSlack(await approvalAgent(calls), {
      token: "env:TEST_SLACK_BOT",
      signingSecret: "env:TEST_SLACK_SIGNING",
      authorize,
      fetch: slack.fetch,
    });
    await handle.handle(direct("write it"));
    await handle.drain();
    const allow = controlsOf(slack.posts()[0]).find((control) => control.text.text === "Allow once");
    assert.ok(allow);
    const message = { ts: "1700000800.000200", channel: "D1" };
    await handle.handle(blockAction(allow.value, "U1", message));
    await handle.drain();
    assert.equal(calls.tool, 1);
    const replay = (await handle.handle(blockAction(allow.value, "U1", message))) as { status: string };
    await handle.drain();
    assert.equal(replay.status, "denied", "a consumed control is refused");
    assert.equal(calls.tool, 1);
    await handle.close();

    const expiring = { model: 0, tool: 0 };
    const slack2 = fakeSlack();
    const short = await connectSlack(await approvalAgent(expiring), {
      token: "env:TEST_SLACK_BOT",
      signingSecret: "env:TEST_SLACK_SIGNING",
      authorize,
      fetch: slack2.fetch,
      limits: { approvalTtlMs: 30 },
    });
    await short.handle(direct("write it"));
    await short.drain();
    const late = controlsOf(slack2.posts()[0]).find((control) => control.text.text === "Allow once");
    assert.ok(late);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const expired = (await short.handle(blockAction(late.value, "U1", { ts: "1700000900.000200", channel: "D1" }))) as { status: string };
    await short.drain();
    assert.equal(expired.status, "denied");
    assert.equal(expiring.tool, 0, "an expired control never resumes the run");
    await short.close();
  });

  it("rate_limited_delivery_waits_and_is_reconciled", async () => {
    // A 429 with Retry-After is waited out, and the reply is journaled as delivered.
    const slack = fakeSlack((call, index) =>
      call.method === "chat.postMessage" && index === 0 ? new Response("{}", { status: 429, headers: { "retry-after": "1" } }) : undefined,
    );
    const handle = await connectSlack(await textAgent(), {
      token: "env:TEST_SLACK_BOT",
      signingSecret: "env:TEST_SLACK_SIGNING",
      authorize,
      fetch: slack.fetch,
    });
    await handle.handle(direct("hello"));
    await handle.drain();
    const posts = slack.posts();
    assert.equal(posts.length, 2);
    assert.ok((posts[1]?.at ?? 0) - (posts[0]?.at ?? 0) >= 950, "the retry waited for Retry-After");
    assert.equal(posts[1]?.body.text, "answer 1");
    await handle.close();

    // A send whose outcome is unknown stays in the journal until a reconcile resends it.
    let failNext = true;
    const flaky = fakeSlack((call) => {
      if (call.method !== "chat.postMessage" || !failNext) return undefined;
      failNext = false;
      throw new TypeError("socket hang up");
    });
    const adapter = createSlackAdapter({ connectionId: "slack-1", botToken: async () => BOT, fetch: flaky.fetch });
    const runtime = createChannelRuntime(await textAgent(), {
      deliver: (reply) => adapter.send(reply),
      checkpoints: createMemoryCheckpointStore(),
      authorize,
    });
    const event = {
      connectionId: "slack-1",
      externalConversationId: "T1:D1",
      externalActorId: "T1:U1",
      eventId: "Ev-reconcile",
      text: "hello",
    };
    const admitted = await runtime.admit(event);
    await runtime.drain();
    const identity = identityFor({ ...event, action: "message", receivedAt: new Date().toISOString() }).identity;
    const unresolved = await runtime.listUnresolved({ identity });
    assert.equal(unresolved[0]?.replyState, "delivery_unknown");
    const resolved = await runtime.reconcile({
      identity,
      connectionId: "slack-1",
      operationId: admitted.operationId ?? "",
      expectedVersion: unresolved[0]?.version ?? 0,
      acknowledgeDuplicateRisk: true,
    });
    assert.equal(resolved.outcome, "reply_delivered");
    assert.equal((await runtime.listUnresolved({ identity })).length, 0);
    await runtime.stop();
    await adapter.stop();
  });

  it("literal_token_fails_with_channel_token_literal_error", async () => {
    const agent = await textAgent();
    for (const options of [
      { token: BOT, signingSecret: "env:TEST_SLACK_SIGNING" },
      { token: "env:TEST_SLACK_BOT", signingSecret: SIGNING },
      { token: "env:TEST_SLACK_BOT", appToken: APP },
    ]) {
      await assert.rejects(
        connectSlack(agent, { ...options, authorize }),
        (error: unknown) => error instanceof ChannelTokenLiteralError && error.code === CHANNEL_TOKEN_LITERAL_CODE,
      );
    }
    await assert.rejects(connectSlack(agent, { token: "env:TEST_SLACK_BOT", authorize }), /signingSecret .* or appToken/);
  });

  it("no_token_in_events_errors_or_journal", async () => {
    const saved: unknown[] = [];
    const innerCheckpoints = createMemoryCheckpointStore();
    const checkpoints = {
      ...innerCheckpoints,
      saveCheckpoint: (input: Parameters<typeof innerCheckpoints.saveCheckpoint>[0]) => {
        saved.push(input);
        return innerCheckpoints.saveCheckpoint(input);
      },
    };
    const entries: unknown[] = [];
    const innerStore = createMemorySessionStore();
    const store: SessionStore = {
      append: async (entry, options) => {
        entries.push(entry);
        await innerStore.append(entry, options);
      },
      list: (sessionId) => innerStore.list(sessionId),
    };
    const slack = fakeSlack((call) =>
      call.method === "chat.postMessage" && String(call.body.text).includes("second")
        ? Response.json({ ok: false, error: "invalid_auth" })
        : undefined,
    );
    const agent = await createAgent({
      id: "slack-leak-agent",
      model: { provider: "mock", model: "demo" },
      slots: { store },
      packages: [
        providerPackage("test-provider", [
          {
            id: "mock",
            async *generate(request) {
              const last = JSON.stringify(request.messages.at(-1));
              yield providerTextDelta(last.includes("again") ? `second ${BOT}` : `tokens ${BOT} ${SIGNING} ${APP}`);
              yield providerDone();
            },
          },
        ]),
      ],
    });
    const handle = await connectSlack(agent, {
      token: "env:TEST_SLACK_BOT",
      signingSecret: "env:TEST_SLACK_SIGNING",
      appToken: "env:TEST_SLACK_APP",
      authorize,
      checkpoints,
      fetch: slack.fetch,
    });
    await handle.handle(signedRequest(direct("leak")));
    await handle.drain();
    await handle.handle(signedRequest(direct("again")));
    await handle.drain();
    const sent = JSON.stringify(slack.calls.map((call) => call.body));
    // The model's own transcript is the agent redactor's concern; the channel owns what it sends and journals.
    assert.ok(saved.length > 0 && entries.length > 0);
    assert.ok(JSON.stringify(saved).includes("slack_unauthorized"), "the refused send is journaled by a bounded reason only");
    for (const secret of [BOT, SIGNING, APP]) {
      assert.equal(sent.includes(secret), false, "sent");
      assert.equal(JSON.stringify(saved).includes(secret), false, "journal");
    }
    assert.ok(sent.includes("[REDACTED]"));
    await handle.close();
  });

  it("channel_host_ui_renders_buttons_and_accepts_bang_answers", async () => {
    const calls = { count: 0 };
    const slack = fakeSlack();
    const checkpoints = createMemoryCheckpointStore();
    const ownership = { tenantId: "acme", userId: "U1" };
    const pairs = createChannelPairingStore({ checkpoints });
    const pair = await pairs.create({
      ...ownership,
      connectionId: "slack-default",
      externalConversationId: "T1:D1",
      externalActorId: "T1:U1",
      grantRevision: "1",
    });
    await pairs.consume({ ...ownership, connectionId: "slack-default", token: pair.token });
    const connection = await connectSlack(await textAgent(calls), {
      token: "env:TEST_SLACK_BOT",
      signingSecret: "env:TEST_SLACK_SIGNING",
      authorize,
      checkpoints,
      fetch: slack.fetch,
    });
    try {
      const ui = channelHostUi({ connection, chat: `pair:${pair.token}`, ownership });
      const confirm = ui.request({ kind: "confirm", title: "Deploy?" });
      await until(() => slack.posts().length === 1);
      const yes = controlsOf(slack.posts()[0]).find((control) => control.text.text === "Yes");
      assert.ok(yes);
      await connection.handle(signedRequest(blockAction(yes.value, "U1", { ts: "1700001000.000100", channel: "D1" }), { form: true }));
      assert.deepEqual(await confirm, { status: "answered", value: true });
      const input = ui.request({ kind: "input", title: "Name?" });
      await until(() => slack.posts().length === 2);
      const token = /\/answer ([A-Za-z0-9_-]{43})/.exec(String(slack.posts()[1]?.body.text))?.[1];
      assert.ok(token);
      await connection.handle(signedRequest(direct(`!answer ${token} prism`)));
      assert.deepEqual(await input, { status: "answered", value: "prism" });
      assert.equal(calls.count, 0, "host UI answers never start a model turn");
    } finally {
      await connection.close();
    }
  });

  it("import_is_inert_and_capabilities_declare_a_deadline_ack", () => {
    const adapter = createSlackAdapter({ connectionId: "slack-inert", botToken: async () => BOT });
    assert.deepEqual(adapter.capabilities, { acknowledgement: "deadline", controls: "callback", maxTextCodeUnits: 40_000 });
    assert.throws(() => createSlackAdapter({ connectionId: "x", botToken: BOT as never }), /secret source/);
    assert.throws(
      () => createSlackAdapter({ connectionId: "x", botToken: async () => BOT, apiOrigin: "http://slack.com" }),
      /HTTPS origin/,
    );
  });
});
