import { type AgentIdentity, createMemoryCheckpointStore } from "@arnilo/prism";
import {
  createGoogleWorkspaceHttpAdapter,
  createMemoryIdempotencyStore,
  createMicrosoft365HttpAdapter,
  createWorkTools,
  normalizeMailPage,
  type WorkDraftApproval,
} from "@arnilo/prism-work/connectors";

const identity: AgentIdentity = {
  tenantId: "tenant-a",
  userId: "user-1",
  principal: { kind: "user", id: "user-1" },
  scopes: ["Mail.Read", "Mail.Send"],
  issuedAt: new Date().toISOString(),
  verified: true,
};

/** Network-free HTTP adapters; shared mail page shapes & durable draft lifecycle. */
export async function demo(): Promise<Record<string, unknown>> {
  // Shared durable checkpoint store survives process restart
  const checkpoints = createMemoryCheckpointStore();

  const microsoft365 = createMicrosoft365HttpAdapter({
    identity,
    checkpoints,
    tokenProvider: { tokenEnv: () => ({ M365_ACCESSTOKEN: "demo-token" }) },
    accessEnvVar: "M365_ACCESSTOKEN",
    fetch: async (input) => {
      const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
      return Response.json(url.pathname.includes("messages") ? { value: [{ id: "m1", bodyPreview: "hi" }] } : {});
    },
  });
  const googleWorkspace = createGoogleWorkspaceHttpAdapter({
    identity,
    checkpoints,
    tokenProvider: { tokenEnv: () => ({ GOOGLE_ACCESS_TOKEN: "demo-token" }) },
    accessEnvVar: "GOOGLE_ACCESS_TOKEN",
    fetch: async (input) => {
      const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
      return Response.json(url.hostname === "gmail.googleapis.com" ? { messages: [{ id: "m1", snippet: "hi" }] } : {});
    },
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
  const restartedM365 = createMicrosoft365HttpAdapter({
    identity,
    checkpoints,
    tokenProvider: { tokenEnv: () => ({ M365_ACCESSTOKEN: "demo-token" }) },
    accessEnvVar: "M365_ACCESSTOKEN",
    fetch: async (input) => {
      const url = new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
      return Response.json(url.pathname.includes("messages") ? { value: [{ id: "m1", bodyPreview: "hi" }] } : {});
    },
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
