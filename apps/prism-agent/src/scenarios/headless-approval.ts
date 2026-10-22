import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Agent, createAgent, type HostUi } from "@arnilo/prism";
import { channelHostUi, type ChannelConnectionHandle, connectTelegram, createChannelPairingStore } from "@arnilo/prism-channels";
import { createResumeAuthority, type RoutedAnswer } from "@arnilo/prism-headless";
import { createSqlitePersistence } from "@arnilo/prism-store-sqlite";
import { createScriptedHostUi, mockProvider, providerDone, providerTextDelta } from "@arnilo/prism/testing";
import type { CheckpointStore } from "@arnilo/prism-workflows";
import { buildHostUi, createCodingWorker, type HostConfig, loadHostConfig } from "../host/index.js";
import { exitCode } from "../cli/exit-codes.js";
import { mockPackages } from "./mock-seam.js";

const CONNECTION_ID = "telegram-default";
/** The coding worker's own scope; the pairing, the answer log, and the routes all use it. */
const OWNERSHIP: { readonly tenantId: string; readonly userId: string } = { tenantId: "prism-agent", userId: "prism-agent" };
const GRANT = "grant-1";
const PAIRED_ACTOR = "202";
const PAIRED_FROM = 202;
const CONVERSATION = "101";
const CHAT_ID = 101;
const TOKEN_ENV = "PRISM_AGENT_HEADLESS_CHANNEL_TOKEN";
/** Long enough to deliver, short enough that the route times out inside the run. */
const SILENT_TIMEOUT_MS = 25;

interface ScriptedChannel {
  /** Counts calls that actually reached the channel route, for the `secret` limit. */
  readonly ui: HostUi;
  readonly connection: ChannelConnectionHandle;
  readonly sent: Record<string, any>[];
  readonly requests: { current: number };
  callback(data: string, from?: number): Promise<unknown>;
  close(): Promise<void>;
}

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("headless-approval: the scripted channel did not settle");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** A real paired channel over a scripted Telegram transport. The reply is driven by the test. */
async function scriptedChannel(agent: Agent, checkpoints: CheckpointStore): Promise<ScriptedChannel> {
  process.env[TOKEN_ENV] ??= "123456:headless-approval-dummy";
  const pairing = createChannelPairingStore({ checkpoints });
  const grant = await pairing.create({
    ...OWNERSHIP,
    connectionId: CONNECTION_ID,
    externalConversationId: CONVERSATION,
    externalActorId: PAIRED_ACTOR,
    grantRevision: GRANT,
  });
  const consumed = await pairing.consume({ ...OWNERSHIP, connectionId: CONNECTION_ID, token: grant.token });
  if (consumed.status !== "consumed") throw new Error(`headless-approval pairing: ${consumed.status}`);
  const sent: Record<string, any>[] = [];
  let id = 0;
  const connection = await connectTelegram(agent, {
    token: `env:${TOKEN_ENV}`,
    checkpoints,
    authorize: (event) =>
      event.externalActorId === PAIRED_ACTOR && event.externalConversationId === CONVERSATION
        ? {
            identity: {
              ...OWNERSHIP,
              principal: { kind: "user", id: "operator" },
              verified: true,
              scopes: ["chat"],
              issuedAt: new Date(0).toISOString(),
            },
            grantRevision: GRANT,
          }
        : false,
    fetch: async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, any>);
      return Response.json({ ok: true, result: { message_id: sent.length } });
    },
  });
  const raw = channelHostUi({ connection, chat: `pair:${grant.token}`, ownership: OWNERSHIP });
  const requests = { current: 0 };
  const ui = {
    request: async (request: never) => {
      requests.current += 1;
      return raw.request(request);
    },
  } as HostUi;
  return {
    ui,
    connection,
    sent,
    requests,
    callback: (data, from = PAIRED_FROM) =>
      connection.handle({
        update_id: ++id,
        callback_query: {
          id: `cb-${id}`,
          from: { id: from, is_bot: false },
          message: { message_id: 1, chat: { id: CHAT_ID, type: "private" } },
          data,
        },
      }),
    close: () => connection.close(),
  };
}

/**
 * Phase 1, in a fresh process: the coding worker asks for approval. The detached client answers
 * `unavailable`, the channel route times out, and the policy default cannot approve, so the run
 * suspends durably. Exit code 3 is the CLI's one-shot suspension code.
 */
export async function headlessApprovalOneShot(configPath: string, sessionId: string): Promise<number> {
  const config = loadHostConfig(configPath);
  const persistence = createSqlitePersistence({ filename: config.storePath });
  let coding: Agent | undefined;
  let channelAgent: Agent | undefined;
  let channel: ScriptedChannel | undefined;
  try {
    channelAgent = await createAgent({
      id: "channel",
      model: config.models.coding,
      ownership: OWNERSHIP,
      packages: [mockProvider([])],
    });
    channel = await scriptedChannel(channelAgent, persistence.checkpoints);
    const ui = buildHostUi({
      client: createScriptedHostUi({}).ui,
      channel: channel.ui,
      channelTimeoutMs: SILENT_TIMEOUT_MS,
      answerLog: persistence.checkpoints,
      ownership: OWNERSHIP,
    });
    coding = await createCodingWorker(config, { ui, packages: mockPackages("write-suspend") });
    const session = await coding.session({ id: sessionId, create: true });
    const status = (await session.run("write the note")).status;
    return status === "suspended" ? exitCode("suspended") : status === "completed" ? exitCode("completed") : exitCode("failed");
  } finally {
    await coding?.dispose();
    await channel?.close();
    await channelAgent?.dispose();
    persistence.close();
  }
}

export interface HeadlessApprovalResult {
  /** The one-shot process's exit code: 3 when the run suspended. */
  readonly firstExit: number;
  readonly resumed: string;
  readonly completed: boolean;
  readonly answers: readonly RoutedAnswer[];
  /** The child's run-phase routes, in offer order. */
  readonly runRoutes: readonly string[];
  readonly channelAnswered: number;
  readonly valuesLogged: number;
  readonly secretAnswer: string;
  readonly secretReachedChannel: number;
  readonly unpairedRefusal: unknown;
}

/** Phase 2: the host process reopens the same store, the channel answers, and the run completes. */
export async function headlessApprovalSuspendsThenChannelResumes(config: HostConfig): Promise<HeadlessApprovalResult> {
  const configPath = join(dirname(config.storePath), "prism-agent.json");
  writeFileSync(configPath, JSON.stringify(config));
  const sessionId = "session_headless_approval";
  const first = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "one-shot", configPath, sessionId], {
    encoding: "utf8",
    env: { ...process.env, [TOKEN_ENV]: "123456:headless-approval-dummy" },
  });
  const firstExit = first.status ?? -1;

  const persistence = createSqlitePersistence({ filename: config.storePath });
  let coding: Agent | undefined;
  let channelAgent: Agent | undefined;
  let channel: ScriptedChannel | undefined;
  try {
    channelAgent = await createAgent({
      id: "channel",
      model: config.models.coding,
      ownership: OWNERSHIP,
      packages: [mockProvider([])],
    });
    channel = await scriptedChannel(channelAgent, persistence.checkpoints);
    const wired = channel;
    coding = await createCodingWorker(config, { packages: [mockProvider([[providerTextDelta("approved"), providerDone()]])] });
    const routed = buildHostUi({
      client: createScriptedHostUi({}).ui,
      channel: channel.ui,
      channelTimeoutMs: SILENT_TIMEOUT_MS,
      answerLog: persistence.checkpoints,
      ownership: OWNERSHIP,
      resumeAuthority: createResumeAuthority(coding),
    });

    // A secret is never a routed request: no route sees it, so the channel is not asked.
    const secretAnswer = await routed.request({ kind: "secret", title: "token", ref: "env:HEADLESS_NOT_SET" });
    const secretReachedChannel = channel.requests.current;

    const session = await coding.session({ id: sessionId });
    const resuming = routed.resumeWhenAnswered(session);
    await until(() => wired.sent.length >= 1);
    const buttons = wired.sent[0]!.reply_markup!.inline_keyboard[0]!;
    // A reply from an unpaired actor is refused and the run stays suspended.
    const unpairedRefusal = await wired.callback(buttons[0]!.callback_data, 999);
    await wired.callback(buttons[0]!.callback_data);

    const resumed = await resuming;
    let completed = false;
    if (resumed.status === "resumed") {
      for await (const event of resumed.events) if (event.type === "run.completed") completed = true;
    }
    const answers = await routed.answers();
    const run = answers.filter((row) => row.sessionId === sessionId && row.status === "unavailable");
    return {
      firstExit,
      resumed: resumed.status,
      completed,
      answers,
      runRoutes: run.map((row) => row.route),
      channelAnswered: answers.filter((row) => row.route === "channel" && row.status === "answered").length,
      valuesLogged: answers.filter((row) => Object.hasOwn(row, "value")).length,
      secretAnswer: secretAnswer.status,
      secretReachedChannel,
      unpairedRefusal,
    };
  } finally {
    await coding?.dispose();
    await channel?.close();
    await channelAgent?.dispose();
    persistence.close();
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , mode, configPath, sessionId] = process.argv;
  if (mode === "one-shot" && configPath !== undefined && sessionId !== undefined) {
    process.exit(await headlessApprovalOneShot(configPath, sessionId));
  }
  process.exit(2);
}
