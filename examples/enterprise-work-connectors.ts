import { type AgentIdentity, createMemoryCheckpointStore } from "@arnilo/prism";
import {
  createGoogleWorkspaceCliAdapter,
  createMemoryIdempotencyStore,
  createMicrosoft365CliAdapter,
  createWorkTools,
  normalizeMailPage,
  type WorkDraftApproval,
} from "@arnilo/prism-core/integrations/work";

const identity: AgentIdentity = {
  tenantId: "tenant-a",
  userId: "user-1",
  principal: { kind: "user", id: "user-1" },
  scopes: ["Mail.Read", "Mail.Send"],
  issuedAt: new Date().toISOString(),
  verified: true,
};

/** Network-free M365 + GWS fake CLI adapters; shared mail page shapes & durable draft lifecycle. */
export async function demo(): Promise<Record<string, unknown>> {
  const runner = {
    async exec(argv: readonly string[]) {
      if (argv[0] === "version" || argv[0] === "--version") {
        return { exitCode: 0, stdout: argv[0] === "--version" ? "0.22.5\n" : '"v11.7.0"', stderr: "" };
      }
      if (argv.includes("send")) {
        return { exitCode: 0, stdout: JSON.stringify({ id: "sent_msg_001" }), stderr: "" };
      }
      return {
        exitCode: 0,
        stdout: argv.includes("messages") || argv.includes("message") ? '{"messages":[{"id":"m1","snippet":"hi"}]}' : "[]",
        stderr: "",
      };
    },
  };

  // Shared durable checkpoint store survives process restart
  const checkpoints = createMemoryCheckpointStore();

  const microsoft365 = createMicrosoft365CliAdapter({
    binary: "/usr/bin/m365",
    configDir: "/tmp/prism-m365-demo",
    identity,
    checkpoints,
    runner,
  });
  const googleWorkspace = createGoogleWorkspaceCliAdapter({
    binary: "/usr/bin/gws",
    configDir: "/tmp/prism-gws-demo",
    identity,
    checkpoints,
    runner,
  });

  // 1. Create a draft in Microsoft 365
  const draft = await microsoft365.createDraft("mail.send", {
    to: "alice@contoso.com",
    subject: "Q4 Summary",
    bodyContents: "Here is the summary.",
  });

  // 2. Approve draft bound to exact (draftId, revision, payloadDigest)
  const approval: WorkDraftApproval = {
    draftId: draft.draftId,
    revision: draft.revision,
    payloadDigest: draft.payloadDigest,
    identityKey: draft.identityKey,
    approvedAt: new Date().toISOString(),
  };
  await microsoft365.approveDraft!(approval);

  // 3. Process restart: new adapter instance with same checkpoints resumes approved draft
  const restartedM365 = createMicrosoft365CliAdapter({
    binary: "/usr/bin/m365",
    configDir: "/tmp/prism-m365-demo",
    identity,
    checkpoints,
    runner,
  });

  const tools = createWorkTools({
    microsoft365: restartedM365,
    googleWorkspace,
    idempotencyStore: createMemoryIdempotencyStore(),
    approval: { isApproved: () => approval },
    externalRecipients: { allow: () => true },
  });

  const sendTool = tools.find((t) => t.name === "m365_mail_draft_send")!;
  const resumedResult = await sendTool.execute(
    { draftId: draft.draftId, revision: draft.revision },
    { sessionId: "demo", runId: "r1", toolCallId: "tc1", idempotencyKey: "demo-resume-1" },
  );

  const m365Raw = await restartedM365.runOp("mail.list", { folderName: "inbox" });
  const gwsRaw = await googleWorkspace.runOp("mail.list", { q: "is:unread" });
  return {
    toolCount: tools.length,
    m365Items: normalizeMailPage("microsoft365", m365Raw).items.length,
    gwsItems: normalizeMailPage("google-workspace", gwsRaw).items.length,
    resumedDraftId: draft.draftId,
    resumedStatus: (resumedResult.value as { status: string }).status,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await demo()));
}
