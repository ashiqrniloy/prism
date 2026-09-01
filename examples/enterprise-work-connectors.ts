import type { AgentIdentity } from "@arnilo/prism";
import {
  createGoogleWorkspaceCliAdapter,
  createMemoryIdempotencyStore,
  createMicrosoft365CliAdapter,
  createWorkTools,
  normalizeMailPage,
} from "@arnilo/prism-core/integrations/work";

const identity: AgentIdentity = {
  tenantId: "tenant-a",
  userId: "user-1",
  principal: { kind: "user", id: "user-1" },
  scopes: ["Mail.Read", "Mail.Send"],
  issuedAt: new Date().toISOString(),
  verified: true,
};

/** Network-free M365 + GWS fake CLI adapters; shared mail page shapes. */
export async function demo(): Promise<Record<string, unknown>> {
  const runner = {
    async exec(argv: readonly string[]) {
      if (argv[0] === "version" || argv[0] === "--version") {
        return { exitCode: 0, stdout: argv[0] === "--version" ? "0.22.5\n" : '"v11.7.0"', stderr: "" };
      }
      return {
        exitCode: 0,
        stdout: argv.includes("messages") || argv.includes("message") ? '{"messages":[{"id":"m1","snippet":"hi"}]}' : "[]",
        stderr: "",
      };
    },
  };
  const microsoft365 = createMicrosoft365CliAdapter({
    binary: "/usr/bin/m365",
    configDir: "/tmp/prism-m365-demo",
    identity,
    runner,
  });
  const googleWorkspace = createGoogleWorkspaceCliAdapter({
    binary: "/usr/bin/gws",
    configDir: "/tmp/prism-gws-demo",
    identity,
    runner,
  });
  const tools = createWorkTools({
    microsoft365,
    googleWorkspace,
    idempotencyStore: createMemoryIdempotencyStore(),
    approval: { isApproved: () => false },
    externalRecipients: { allow: () => true },
  });
  const m365Raw = await microsoft365.runOp("mail.list", { folderName: "inbox" });
  const gwsRaw = await googleWorkspace.runOp("mail.list", { q: "is:unread" });
  return {
    toolCount: tools.length,
    m365Items: normalizeMailPage("microsoft365", m365Raw).items.length,
    gwsItems: normalizeMailPage("google-workspace", gwsRaw).items.length,
    draftTool: tools.find((t) => t.name === "m365_mail_draft_send")?.name,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await demo()));
}
