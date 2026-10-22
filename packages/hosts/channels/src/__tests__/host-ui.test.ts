import { afterEach, it } from "bun:test";
import assert from "node:assert/strict";
import { createAgent, providerDone, providerTextDelta } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { channelHostUi, connectTelegram, createChannelPairingStore, createMemoryCheckpointStore } from "../index.js";
import type { ChannelAuthorization, ChannelConnectionHandle } from "../types.js";

const ownership = { tenantId: "ops", userId: "operator" };
const identity = {
  ...ownership,
  principal: { kind: "user" as const, id: "operator" },
  verified: true as const,
  scopes: ["chat"],
  issuedAt: new Date(0).toISOString(),
};
const handles: ChannelConnectionHandle[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close();
});

function replyToken(text: string): string {
  const match = /\/answer ([A-Za-z0-9_-]{43})/.exec(text);
  assert.ok(match);
  return match[1];
}

async function harness(
  options: {
    authorize?: boolean;
    consumed?: boolean;
    deliveryFailure?: boolean;
    authorizeWait?: Promise<void>;
    limits?: { approvalTtlMs?: number; maxPendingPerProcess?: number; maxPendingPerBinding?: number };
  } = {},
) {
  let modelCalls = 0;
  let authorization: ChannelAuthorization | false = { identity, grantRevision: "grant-1" };
  const agent = await createAgent({
    id: "channel-ui-test",
    model: { provider: "mock", model: "demo" },
    packages: [
      providerPackage("test", [
        {
          id: "mock",
          async *generate() {
            modelCalls++;
            yield providerTextDelta("unexpected");
            yield providerDone();
          },
        },
      ]),
    ],
  });
  const checkpoints = createMemoryCheckpointStore();
  const pairing = createChannelPairingStore({ checkpoints });
  const grant = await pairing.create({
    ...ownership,
    connectionId: "telegram-default",
    externalConversationId: "101",
    externalActorId: "202",
    grantRevision: "grant-1",
  });
  if (options.consumed !== false)
    assert.equal((await pairing.consume({ ...ownership, connectionId: "telegram-default", token: grant.token })).status, "consumed");
  const sent: Record<string, any>[] = [];
  process.env.CHANNEL_UI_TEST_TOKEN = "123456:test-bot-secret";
  const connection = await connectTelegram(agent, {
    token: "env:CHANNEL_UI_TEST_TOKEN",
    checkpoints,
    limits: options.limits,
    authorize:
      options.authorize === false
        ? undefined
        : async (event) => {
            await options.authorizeWait;
            return event.externalActorId === "202" && event.externalConversationId === "101" ? authorization : false;
          },
    fetch: async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return options.deliveryFailure
        ? Response.json({ ok: false, error_code: 400, description: "scripted failure" }, { status: 400 })
        : Response.json({ ok: true, result: { message_id: sent.length } });
    },
  });
  handles.push(connection);
  const ui = channelHostUi({ connection, chat: `pair:${grant.token}`, ownership });
  let id = 0;
  const reply = (text: string, extra = {}) =>
    connection.handle({
      connectionId: "telegram-default",
      externalConversationId: "101",
      externalActorId: "202",
      eventId: String(++id),
      text,
      ...extra,
    });
  const callback = (data: string, from = 202) =>
    connection.handle({
      update_id: ++id,
      callback_query: {
        id: `cb-${id}`,
        from: { id: from, is_bot: false },
        message: { message_id: 1, chat: { id: 101, type: "private" } },
        data,
      },
    });
  const ready = async (count = 1) => {
    for (let n = 0; sent.length < count && n < 100; n++) await new Promise((r) => setTimeout(r, 1));
    assert.equal(sent.length, count);
  };
  return {
    ui,
    connection,
    sent,
    checkpoints,
    agent,
    chat: `pair:${grant.token}`,
    reply,
    callback,
    ready,
    modelCalls: () => modelCalls,
    authorize: (value: ChannelAuthorization | false) => {
      authorization = value;
    },
  };
}

it("channel_confirm_answered_by_paired_reply", async () => {
  const h = await harness();
  const answer = h.ui.request({ kind: "confirm", title: "Deploy?" });
  await h.ready();
  const buttons = h.sent[0].reply_markup.inline_keyboard.flat();
  assert.deepEqual(await h.callback(buttons[0].callback_data), { status: "accepted" });
  assert.deepEqual(await answer, { status: "answered", value: true });
  assert.equal(h.modelCalls(), 0);
});
it("unpaired_reply_is_ignored", async () => {
  const h = await harness();
  let settled = false;
  const answer = h.ui.request({ kind: "confirm", title: "Deploy?" }).then((v) => {
    settled = true;
    return v;
  });
  await h.ready();
  const data = h.sent[0].reply_markup.inline_keyboard[0][0].callback_data;
  assert.deepEqual(await h.callback(data, 999), { status: "denied", reason: "rejected" });
  assert.deepEqual(await h.reply(`/answer ${data.split(":")[1]} 0`, { externalConversationId: "foreign" }), {
    status: "denied",
    reason: "rejected",
  });
  assert.deepEqual(await h.reply(`/answer ${data.split(":")[1]} 0`, { threadId: "foreign-thread" }), {
    status: "denied",
    reason: "rejected",
  });
  assert.equal(settled, false);
  await h.callback(data);
  assert.equal((await answer).status, "answered");
});
it("late_reply_after_settle_is_expired", async () => {
  const h = await harness();
  const answer = h.ui.request({ kind: "confirm", title: "Deploy?" });
  await h.ready();
  const data = h.sent[0].reply_markup.inline_keyboard[0][1].callback_data;
  await h.callback(data);
  assert.deepEqual(await answer, { status: "answered", value: false });
  await h.callback(data);
  assert.equal(h.sent[1].text, "This request has expired.");
  assert.equal(h.modelCalls(), 0);
});
it("unsupported_kinds_are_unavailable", async () => {
  const h = await harness();
  for (const request of [
    { kind: "secret", title: "secret", ref: "env:X" },
    { kind: "terminal", title: "terminal", command: ["echo"] },
    { kind: "open-url", title: "url", url: "https://example.com" },
  ] as const)
    assert.deepEqual(await h.ui.request(request), { status: "unavailable" });
  assert.equal(h.sent.length, 0);
});
it("request_text_is_plain_and_notify_is_acknowledged", async () => {
  const h = await harness();
  assert.deepEqual(await h.ui.request({ kind: "notify", level: "info", message: "<b>hello</b> *world*" }), {
    status: "answered",
    value: undefined,
  });
  assert.equal(h.sent[0].text, "<b>hello</b> *world*");
  assert.equal(h.sent[0].parse_mode, undefined);
  const answer = h.ui.request({ kind: "select", title: "<title>", detail: "*detail*", options: [{ value: "chosen", label: "<label>" }] });
  await h.ready(2);
  assert.equal(h.sent[1].reply_markup.inline_keyboard[0][0].text, "<label>");
  await h.callback(h.sent[1].reply_markup.inline_keyboard[0][0].callback_data);
  assert.deepEqual(await answer, { status: "answered", value: "chosen" });
});
it("input_value_not_logged_and_overlapping_requests_are_correlated", async () => {
  const h = await harness();
  const first = h.ui.request({ kind: "input", title: "First" });
  const second = h.ui.request({ kind: "input", title: "Second" });
  await h.ready(2);
  const tokens = h.sent.map((s) => replyToken(s.text));
  await h.reply(`/answer ${tokens[1]} private second value`);
  assert.deepEqual(await second, { status: "answered", value: "private second value" });
  await h.reply(`/answer ${tokens[0]} private first value`);
  assert.deepEqual(await first, { status: "answered", value: "private first value" });
  const records = JSON.stringify((await h.checkpoints.listCheckpoints()).items);
  assert.equal(records.includes("private second value"), false);
  assert.equal(records.includes("private first value"), false);
  assert.equal(h.modelCalls(), 0);
});
it("multi_select_validates_indexes_before_consuming", async () => {
  const h = await harness();
  const answer = h.ui.request({ kind: "select", title: "Choose", multiple: true, options: [{ value: "a" }, { value: "b" }] });
  await h.ready();
  const token = replyToken(h.sent[0].text);
  assert.deepEqual(await h.reply(`/answer ${token} 9`), { status: "denied", reason: "rejected" });
  await h.reply(`/answer ${token} 0,1`);
  assert.deepEqual(await answer, { status: "answered", value: ["a", "b"] });
  assert.equal(h.modelCalls(), 0);
});
it("no_authorizer_unconsumed_pairing_foreign_scope_and_filtered_kinds_fail_closed", async () => {
  for (const options of [{ authorize: false }, { consumed: false }]) {
    const h = await harness(options);
    assert.deepEqual(await h.ui.request({ kind: "confirm", title: "No" }), { status: "unavailable" });
    assert.equal(h.sent.length, 0);
  }
  const h = await harness();
  const ui = channelHostUi({ connection: h.connection, chat: h.chat, ownership: { tenantId: "foreign" } });
  assert.deepEqual(await ui.request({ kind: "notify", message: "no", level: "info" }), { status: "unavailable" });
  const filtered = channelHostUi({ connection: h.connection, chat: "pair:missing", ownership, kinds: ["notify"] });
  assert.deepEqual(await filtered.request({ kind: "confirm", title: "No" }), { status: "unavailable" });
});
it("changed_grant_or_principal_cannot_answer", async () => {
  const h = await harness();
  const answer = h.ui.request({ kind: "confirm", title: "Deploy?" });
  await h.ready();
  const data = h.sent[0].reply_markup.inline_keyboard[0][0].callback_data;
  for (const auth of [
    { identity, grantRevision: "changed" },
    { identity: { ...identity, principal: { kind: "user" as const, id: "foreign" } }, grantRevision: "grant-1" },
  ]) {
    h.authorize(auth);
    assert.deepEqual(await h.callback(data), { status: "denied", reason: "rejected" });
  }
  h.authorize({ identity, grantRevision: "grant-1" });
  await h.callback(data);
  assert.equal((await answer).status, "answered");
});
it("expiry_close_and_capacity_resolve_unavailable", async () => {
  const h = await harness({ limits: { approvalTtlMs: 20, maxPendingPerProcess: 1 } });
  const answer = h.ui.request({ kind: "input", title: "Expire" });
  await h.ready();
  assert.deepEqual(await h.ui.request({ kind: "confirm", title: "Too many" }), { status: "unavailable" });
  assert.deepEqual(await answer, { status: "unavailable" });
  const token = replyToken(h.sent[0].text);
  await h.reply(`/answer ${token} late`);
  assert.equal(h.sent[1].text, "This request has expired.");
  const pending = h.ui.request({ kind: "confirm", title: "Close" });
  await h.ready(3);
  await h.connection.close();
  assert.deepEqual(await pending, { status: "unavailable" });
  assert.deepEqual(await h.ui.request({ kind: "confirm", title: "Closed" }), { status: "unavailable" });
  assert.equal(h.modelCalls(), 0);
});
it("reserved_malformed_and_unknown_answers_never_start_agent_turns", async () => {
  const h = await harness();
  await h.reply("/answer malformed");
  await h.reply(`/answer ${"x".repeat(43)} hello`);
  await h.connection.drain();
  assert.equal(h.modelCalls(), 0);
});

it("restart_expires_orphaned_tokens_and_accepts_a_fresh_offer", async () => {
  const h = await harness();
  const old = h.ui.request({ kind: "input", title: "Before restart" });
  await h.ready();
  const oldToken = replyToken(h.sent[0].text);
  await h.connection.close();
  await old;
  const sent: Record<string, any>[] = [];
  const connection = await connectTelegram(h.agent, {
    token: "env:CHANNEL_UI_TEST_TOKEN",
    checkpoints: h.checkpoints,
    authorize: () => ({ identity, grantRevision: "grant-1" }),
    fetch: async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true, result: { message_id: sent.length } });
    },
  });
  handles.push(connection);
  const reply = (id: string, text: string) =>
    connection.handle({ connectionId: "telegram-default", externalConversationId: "101", externalActorId: "202", eventId: id, text });
  await reply("old", `/answer ${oldToken} discarded answer`);
  assert.equal(sent[0].text, "This request has expired.");
  const ui = channelHostUi({ connection, chat: h.chat, ownership });
  const fresh = ui.request({ kind: "input", title: "After restart" });
  for (let n = 0; sent.length < 2 && n < 100; n++) await new Promise((r) => setTimeout(r, 1));
  const token = replyToken(sent[1].text);
  assert.notEqual(token, oldToken);
  await reply("fresh", `/answer ${token} fresh answer`);
  assert.deepEqual(await fresh, { status: "answered", value: "fresh answer" });
  assert.equal(h.modelCalls(), 0);
});
it("concurrent_replies_settle_once_and_per_binding_capacity_is_shared", async () => {
  const h = await harness({ limits: { maxPendingPerBinding: 1 } });
  const answer = h.ui.request({ kind: "confirm", title: "One" });
  await h.ready();
  const other = channelHostUi({ connection: h.connection, chat: h.chat, ownership });
  assert.deepEqual(await other.request({ kind: "input", title: "Two" }), { status: "unavailable" });
  const buttons = h.sent[0].reply_markup.inline_keyboard[0];
  await Promise.all([h.callback(buttons[0].callback_data), h.callback(buttons[1].callback_data)]);
  assert.equal((await answer).status, "answered");
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].text, "This request has expired.");
  assert.equal(h.modelCalls(), 0);
});
it("oversized_requests_and_invalid_selects_fail_without_delivery", async () => {
  const h = await harness();
  assert.deepEqual(await h.ui.request({ kind: "input", title: "x".repeat(3000) }), { status: "unavailable" });
  assert.deepEqual(
    await h.ui.request({ kind: "select", title: "Many", options: Array.from({ length: 9 }, (_, i) => ({ value: String(i) })) }),
    { status: "unavailable" },
  );
  assert.deepEqual(await h.ui.request({ kind: "select", title: "Duplicate", options: [{ value: "a" }, { value: "a" }] }), {
    status: "unavailable",
  });
  assert.equal(h.sent.length, 0);
});

it("delivery_or_storage_failure_fails_closed_without_an_agent_turn", async () => {
  const h = await harness({ deliveryFailure: true });
  assert.deepEqual(await h.ui.request({ kind: "confirm", title: "Cannot deliver" }), { status: "unavailable" });
  const stored = JSON.stringify((await h.checkpoints.listCheckpoints()).items);
  assert.equal(stored.includes("delivery_failed"), true);
  assert.equal(h.modelCalls(), 0);
  const broken = await harness();
  broken.checkpoints.saveCheckpoint = async () => {
    throw new Error("private storage failure");
  };
  assert.deepEqual(await broken.ui.request({ kind: "input", title: "Cannot save" }), { status: "unavailable" });
  assert.equal(broken.sent.length, 0);
});
it("request_options_are_snapshotted_and_bot_secrets_are_redacted", async () => {
  const h = await harness();
  const options = [{ value: "original", label: "123456:test-bot-secret" }];
  const answer = h.ui.request({ kind: "select", title: "123456:test-bot-secret", options });
  options[0].value = "mutated";
  await h.ready();
  const button = h.sent[0].reply_markup.inline_keyboard[0][0];
  assert.equal(JSON.stringify(h.sent).includes("123456:test-bot-secret"), false);
  await h.callback(button.callback_data);
  assert.deepEqual(await answer, { status: "answered", value: "original" });
});

it("authorization_wait_is_bounded_and_a_late_grant_cannot_send", async () => {
  let release = () => {};
  const authorizeWait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = await harness({ authorizeWait, limits: { approvalTtlMs: 15 } });
  assert.deepEqual(await h.ui.request({ kind: "confirm", title: "Wait" }), { status: "unavailable" });
  release();
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(h.sent.length, 0);
});

it("close_resolves_requests_still_waiting_for_authorization", async () => {
  let release = () => {};
  const authorizeWait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const h = await harness({ authorizeWait });
  const answer = h.ui.request({ kind: "confirm", title: "Close during authorization" });
  await h.connection.close();
  assert.deepEqual(await Promise.race([answer, new Promise((resolve) => setTimeout(() => resolve("still pending"), 30))]), {
    status: "unavailable",
  });
  release();
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(h.sent.length, 0);
});
