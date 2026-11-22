import { createHmac } from "node:crypto";
import {
  askEveryTool,
  createAgent,
  createMemorySessionStore,
  type JsonObject,
  providerDone,
  providerTextDelta,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { connectSlack } from "@arnilo/prism-hosts/channels/slack";

/**
 * Binds one approval-gated agent to a Slack app over the Events API, offline: a scripted `fetch`
 * stands in for the Web API and requests are signed with a demo signing secret. A mention runs a
 * turn that asks for approval; the Allow button resumes it in the same thread. In a real host,
 * mount `slack.handle` with `Bun.serve({ fetch: (request) => slack.handle(request) })`.
 */
export async function demo() {
  process.env.DEMO_SLACK_BOT_TOKEN ??= "demo-slack-bot-token";
  process.env.DEMO_SLACK_SIGNING_SECRET ??= "demo-signing-secret";
  const signingSecret = process.env.DEMO_SLACK_SIGNING_SECRET;
  const executed: string[] = [];
  let turn = 0;
  const agent = await createAgent({
    id: "slack-publisher",
    model: { provider: "mock", model: "mock" },
    slots: { store: createMemorySessionStore() },
    hooks: askEveryTool(),
    packages: [
      providerPackage("demo-provider", [
        {
          id: "mock",
          async *generate() {
            turn += 1;
            if (turn === 1) {
              yield { type: "tool_call" as const, call: toolCallContent("call-1", "publish_draft", { title: "Release notes" }) };
              yield providerDone();
              return;
            }
            yield providerTextDelta("Published the release notes.");
            yield providerDone();
          },
        },
      ]),
    ],
    tools: {
      add: [
        {
          name: "publish_draft",
          parameters: { type: "object" },
          execute: (args: JsonObject, context: { toolCallId: string }) => {
            executed.push(JSON.stringify(args));
            return { toolCallId: context.toolCallId, name: "publish_draft", value: "published" };
          },
        },
      ],
    },
  });

  // Scripted Slack Web API: every chat.postMessage succeeds and is recorded.
  const posted: Array<Record<string, unknown>> = [];
  const fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    posted.push(body);
    return Response.json({ ok: true, channel: body.channel, ts: `1700000000.00${posted.length}` });
  }) as typeof globalThis.fetch;

  const slack = await connectSlack(agent, {
    token: "env:DEMO_SLACK_BOT_TOKEN",
    signingSecret: "env:DEMO_SLACK_SIGNING_SECRET",
    // Deny by default: only this workspace member may talk to the agent.
    authorize: (input) =>
      input.externalActorId === "T1:U1" && {
        identity: {
          tenantId: "acme",
          userId: "U1",
          principal: { kind: "user", id: "U1" },
          scopes: ["chat"],
          issuedAt: new Date(0).toISOString(),
          verified: true,
        },
        grantRevision: "1",
      },
    fetch,
  });

  function signed(payload: unknown, form = false): Request {
    const json = JSON.stringify(payload);
    const body = form ? `payload=${encodeURIComponent(json)}` : json;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
    return new Request("https://bot.example.test/slack/events", {
      method: "POST",
      headers: {
        "content-type": form ? "application/x-www-form-urlencoded" : "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      body,
    });
  }

  const thread = "1700000000.000100";
  const mention = {
    type: "event_callback",
    team_id: "T1",
    event_id: "Ev1",
    event: { type: "app_mention", user: "U1", channel: "C1", ts: thread, text: "<@UBOT> publish the release notes" },
  };
  const mentionStatus = ((await slack.handle(signed(mention))) as Response).status;
  await slack.drain();
  const prompt = posted[0];
  const blocks = prompt?.blocks as Array<{ type: string; elements?: Array<{ text: { text: string }; value: string }> }>;
  const allow = blocks.find((block) => block.type === "actions")?.elements?.find((button) => button.text.text === "Allow once");
  const click = {
    type: "block_actions",
    team: { id: "T1" },
    user: { id: "U1", team_id: "T1" },
    channel: { id: "C1" },
    container: { type: "message", message_ts: String(prompt?.ts ?? "1700000000.001"), channel_id: "C1", thread_ts: thread },
    message: { ts: "1700000000.001", thread_ts: thread },
    actions: [{ action_id: "prism_0", type: "button", value: allow?.value, action_ts: "1700000001.000001" }],
  };
  const unsignedStatus = (
    (await slack.handle(
      new Request("https://bot.example.test/slack/events", { method: "POST", body: JSON.stringify(mention) }),
    )) as Response
  ).status;
  const clickStatus = ((await slack.handle(signed(click, true))) as Response).status;
  await slack.drain();
  await slack.close();

  return {
    mentionStatus,
    unsignedStatus,
    clickStatus,
    approvalPrompt: prompt?.text,
    replyInThread: posted.at(-1)?.thread_ts === thread,
    finalReply: posted.at(-1)?.text,
    toolRuns: executed.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
