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
import { connectDiscord, type DiscordSocket } from "@arnilo/prism-hosts/channels/discord";

/**
 * Binds one approval-gated agent to a Discord bot, offline: a scripted Gateway socket and a scripted
 * `fetch` stand in for Discord. The client identifies and becomes ready, a guild mention runs a turn
 * that asks for approval, another user's click is refused, and the bound user's click resumes the run.
 * In a real host, `await discord.start()` opens the Gateway through the global `WebSocket`.
 */
export async function demo() {
  process.env.DEMO_DISCORD_BOT_TOKEN ??= "demo-discord-bot-token";
  const executed: string[] = [];
  let turn = 0;
  const agent = await createAgent({
    id: "discord-publisher",
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

  // Scripted REST API: the Gateway URL, message creation, and interaction callbacks.
  const posted: Array<{ path: string; body: Record<string, unknown> }> = [];
  let nextId = 9000;
  const fetch = (async (input: unknown, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace("/api/v10", "");
    if (path === "/gateway/bot") return Response.json({ url: "wss://gateway.discord.example" });
    posted.push({ path, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    if (path.startsWith("/interactions/")) return new Response(null, { status: 204 });
    nextId += 1;
    return Response.json({ id: String(nextId) });
  }) as typeof globalThis.fetch;

  // Scripted Gateway: Hello on connect, READY after Identify.
  const sent: Array<{ op: number; d: unknown }> = [];
  let gateway: { emit(frame: unknown): void } | undefined;
  const webSocket = (_url: string): DiscordSocket => {
    const listeners = new Map<string, Array<(event: { data?: unknown; code?: number }) => void>>();
    const emit = (frame: unknown) => {
      for (const listener of listeners.get("message") ?? []) listener({ data: JSON.stringify(frame) });
    };
    gateway = { emit };
    queueMicrotask(() => emit({ op: 10, d: { heartbeat_interval: 41_250 } }));
    return {
      addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
      send(data) {
        const frame = JSON.parse(data) as { op: number; d: unknown };
        sent.push(frame);
        if (frame.op === 2)
          queueMicrotask(() =>
            emit({
              op: 0,
              t: "READY",
              s: 1,
              d: { session_id: "demo-session", resume_gateway_url: "wss://resume.discord.example", user: { id: "999" } },
            }),
          );
      },
      close: (code) => {
        for (const listener of listeners.get("close") ?? []) listener({ code: code ?? 1000 });
      },
    };
  };

  const discord = await connectDiscord(agent, {
    token: "env:DEMO_DISCORD_BOT_TOKEN",
    applicationId: "999",
    // Deny by default: only these two server members may talk to the agent.
    authorize: (input) =>
      ["1", "2"].includes(input.externalActorId) && {
        identity: {
          tenantId: "acme",
          userId: input.externalActorId,
          principal: { kind: "user", id: input.externalActorId },
          scopes: ["chat"],
          issuedAt: new Date(0).toISOString(),
          verified: true,
        },
        grantRevision: "1",
      },
    fetch,
    webSocket,
  });
  await discord.start();
  const identify = sent.find((frame) => frame.op === 2)?.d as { intents?: number } | undefined;

  gateway?.emit({
    op: 0,
    t: "MESSAGE_CREATE",
    s: 2,
    d: {
      id: "5001",
      type: 0,
      guild_id: "100",
      channel_id: "200",
      author: { id: "1" },
      content: "<@999> publish the release notes",
      mentions: [{ id: "999" }],
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await discord.drain();
  const prompt = posted.find((call) => call.path === "/channels/200/messages");
  const rows = prompt?.body.components as Array<{ components: Array<{ label: string; custom_id: string }> }> | undefined;
  const allow = rows?.flatMap((row) => row.components).find((button) => button.label === "Allow once");
  const click = (id: string, user: string) => ({
    op: 0,
    t: "INTERACTION_CREATE",
    d: {
      id,
      type: 3,
      token: `demo-interaction-${id}`,
      guild_id: "100",
      channel_id: "200",
      member: { user: { id: user } },
      data: { component_type: 2, custom_id: allow?.custom_id },
    },
  });
  gateway?.emit(click("6001", "2"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await discord.drain();
  const foreignClickRuns = executed.length;
  gateway?.emit(click("6002", "1"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await discord.drain();
  await discord.close();

  const replies = posted.filter((call) => call.path === "/channels/200/messages");
  return {
    identified: identify?.intents === ((1 << 9) | (1 << 12) | (1 << 15)),
    approvalPrompt: prompt?.body.content,
    foreignClickRuns,
    acknowledgements: posted.filter((call) => call.path.startsWith("/interactions/")).length,
    finalReply: replies.at(-1)?.body.content,
    toolRuns: executed.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
