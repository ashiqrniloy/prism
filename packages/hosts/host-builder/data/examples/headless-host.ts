import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Agent, createAgent, definePackage, type HostUi } from "@arnilo/prism";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import approval from "@arnilo/prism-approval";
import { type ChannelConnectionHandle, channelHostUi, connectTelegram, createChannelPairingStore } from "@arnilo/prism-channels";
import { createResumeAuthority, createScheduler, policyDefault, routeHostUi, type SchedulerClock } from "@arnilo/prism-headless";
import { createSqlitePersistence } from "@arnilo/prism-store-sqlite";
import workflows, { agentNode, defineWorkflow, workflowCommand } from "@arnilo/prism-workflows";

// Keep Bun transport declarations out of the examples compiler, as in remote-agent.ts.
const remoteModule = "@arnilo/prism-remote";
const remoteHostUi: () => HostUi = (await import(remoteModule)).remoteHostUi;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`headless_host_example_output: ${message}`);
}

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 2000;
  while (!(await check())) {
    assert(Date.now() < deadline, "scripted host did not settle");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

// Offline: bun examples/headless-host.ts. All channel traffic stays in the scripted fetch.
export async function demo() {
  const root = mkdtempSync(join(tmpdir(), "prism-headless-"));
  const store = createSqlitePersistence({ filename: join(root, "host.db") });
  const agents: Agent[] = [];
  let connection: ChannelConnectionHandle | undefined;
  let scheduler: ReturnType<typeof createScheduler> | undefined;
  const previousToken = process.env.HEADLESS_DEMO_TOKEN;
  process.env.HEADLESS_DEMO_TOKEN = "123456:headless-demo-dummy";
  try {
    const ownership = { tenantId: "demo", userId: "operator" };
    const model = { provider: "mock", model: "demo" };
    const channelAgent = await createAgent({ model, ownership, slots: { store }, packages: [mockProvider([])] });
    agents.push(channelAgent);
    const pairing = createChannelPairingStore({ checkpoints: store.checkpoints });
    const grant = await pairing.create({
      ...ownership,
      connectionId: "telegram-default",
      externalConversationId: "101",
      externalActorId: "202",
      grantRevision: "demo-1",
    });
    assert(
      (await pairing.consume({ ...ownership, connectionId: "telegram-default", token: grant.token })).status === "consumed",
      "pairing",
    );
    const sent: { reply_markup?: { inline_keyboard: { callback_data: string }[][] } }[] = [];
    connection = await connectTelegram(channelAgent, {
      token: "env:HEADLESS_DEMO_TOKEN",
      checkpoints: store.checkpoints,
      authorize: (event) =>
        event.externalActorId === "202" && event.externalConversationId === "101"
          ? {
              identity: {
                ...ownership,
                principal: { kind: "user", id: "operator" },
                verified: true,
                scopes: ["chat"],
                issuedAt: new Date(0).toISOString(),
              },
              grantRevision: "demo-1",
            }
          : false,
      fetch: async (_url, init) => {
        sent.push(JSON.parse(String(init?.body)));
        return Response.json({ ok: true, result: { message_id: sent.length } });
      },
    });
    const routes = [
      { name: "client", ui: remoteHostUi() },
      {
        name: "channel",
        ui: channelHostUi({ connection, chat: `pair:${grant.token}`, ownership }),
        kinds: ["confirm"] as const,
        timeoutMs: 50,
      },
      policyDefault(),
    ];
    let writes = 0;
    const agent = await createAgent({
      id: "headless-worker",
      model,
      ownership,
      slots: { store },
      host: { ui: routeHostUi(routes, { answerLog: store.checkpoints, ownership }) },
      packages: [
        approval({ mode: "ask" }),
        mockProvider([
          [providerToolCall(toolCallContent("write-1", "write", {})), providerDone()],
          [providerTextDelta("Approved"), providerDone()],
          [providerTextDelta("Scheduled report"), providerDone()],
        ]),
      ],
      tools: {
        add: [
          {
            name: "write",
            parameters: { type: "object", properties: {} },
            effects: ["write"],
            execute: (_args, ctx) => ({ toolCallId: ctx.toolCallId, name: "write", value: ++writes }),
          },
        ],
      },
    });
    agents.push(agent);
    const router = routeHostUi(routes, { resumeAuthority: createResumeAuthority(agent), answerLog: store.checkpoints, ownership });

    // 1. No client or timely channel reply: persist the suspension, then offer it again.
    const session = await agent.session();
    const suspended = await session.run("Write the report");
    assert(suspended.status === "suspended" && writes === 0, "tool must wait for approval");
    const inline = await router.answers();
    // Durable log timestamps can tie; their read order does not distinguish same-ms attempts.
    for (const sessionId of [undefined, session.id]) {
      const attempts = inline.filter((row) => row.sessionId === sessionId);
      assert(
        attempts
          .map((row) => row.route)
          .sort()
          .join(",") === "channel,client,policy",
        "all routes attempted",
      );
      const at = (route: string) => attempts.find((row) => row.route === route)!.at;
      assert(at("client") <= at("channel") && at("channel") <= at("policy"), "route order");
    }
    assert(
      inline.every((row) => row.status === "unavailable"),
      "inline timeout",
    );
    const resuming = router.resumeWhenAnswered(session, undefined, { signal: AbortSignal.timeout(2000) });
    await until(() => sent.length === 3);
    const callbackData = sent[2].reply_markup?.inline_keyboard[0][0].callback_data;
    assert(callbackData, "fresh channel prompt");
    const reply = await connection.handle({
      update_id: 1,
      callback_query: {
        id: "reply-1",
        from: { id: 202, is_bot: false },
        message: { message_id: 3, chat: { id: 101, type: "private" } },
        data: callbackData,
      },
    });
    assert(reply && typeof reply === "object" && "status" in reply && reply.status === "accepted", "paired channel reply");
    const resumed = await resuming;
    assert(resumed.status === "resumed", "resume status");
    let completed = false;
    for await (const event of resumed.events) if (event.type === "run.completed") completed = true;
    assert(completed && Number(writes) === 1, "resume must execute the tool once");
    console.log(JSON.stringify({ half: "routing", status: resumed.status }));

    // 2. One cron occurrence runs a registered workflow, with an indexed agent child.
    let now = Date.parse("2026-10-13T00:00:00Z");
    let wake = () => {};
    const clock: SchedulerClock = {
      now: () => now,
      sleep: (_ms, signal) =>
        new Promise<void>((resolve) => {
          const done = () => {
            signal.removeEventListener("abort", done);
            resolve();
          };
          wake = done;
          signal.addEventListener("abort", done, { once: true });
          if (signal.aborted) done();
        }),
    };
    const flow = defineWorkflow({
      id: "report",
      revision: "1",
      nodes: { report: agentNode({ agent, input: () => "Summarize the report" }) },
    });
    const host = await createAgent({
      model,
      ownership,
      slots: { store },
      packages: [
        mockProvider([]),
        workflows,
        definePackage({
          name: "@example/headless",
          version: "1.0.0",
          requires: { api: 1 },
          capabilities: ["session-state"],
          setup(prism) {
            prism.commands.register(workflowCommand(prism, "report", flow, { args: { type: "object", properties: {} } }));
          },
        }),
      ],
    });
    agents.push(host);
    scheduler = createScheduler({
      checkpoints: store.checkpoints,
      ownership,
      clock,
      targets: { report: { kind: "workflow", agent: host, command: "report", input: {} } },
    });
    const schedule = await scheduler.schedule({ id: "minute-report", target: "report", cron: "* * * * *" });
    scheduler.start();
    now += 60000;
    wake();
    await until(async () => (await scheduler!.list())[0].lastFiring?.status === "succeeded");
    await scheduler.stop();
    const state = (await scheduler.list())[0];
    const children = await host.sessions.list({ parentSessionId: schedule.scheduleSessionId });
    assert(children.items.length === 1, "one scheduled workflow child");
    assert(
      state.nextRunAt === "2026-10-13T00:02:00.000Z" && state.lastFiring?.workflowRunId,
      "one cron firing and persisted next deadline",
    );
    const answers = await router.answers();
    assert(
      answers.some((row) => row.route === "channel" && row.status === "answered" && row.approvalId),
      "route: channel answer metadata",
    );
    console.log(JSON.stringify({ half: "scheduling", scheduledFirings: 1, children: children.items.length }));
    await session.close();
    return { status: "resumed", scheduledFirings: 1, answers };
  } finally {
    try {
      await scheduler?.stop();
    } finally {
      try {
        await connection?.close();
      } finally {
        try {
          for (const agent of agents.reverse()) await agent.dispose();
        } finally {
          store.close();
          rmSync(root, { recursive: true, force: true });
          if (previousToken === undefined) delete process.env.HEADLESS_DEMO_TOKEN;
          else process.env.HEADLESS_DEMO_TOKEN = previousToken;
        }
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
