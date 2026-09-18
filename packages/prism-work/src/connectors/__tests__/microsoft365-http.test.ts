import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type { AgentIdentity, ArtifactBodyStore, ToolExecutionContext } from "@arnilo/prism";
import { createMemoryIdempotencyStore, createMicrosoft365HttpAdapter, createWorkTools, WorkToolError } from "../index.js";

const identity: AgentIdentity = {
  tenantId: "tenant-1",
  userId: "user-1",
  principal: { kind: "user", id: "user-1" },
  scopes: ["Mail.Read", "Mail.Send", "Calendars.ReadWrite", "Files.ReadWrite"],
  issuedAt: new Date().toISOString(),
  verified: true,
};

const tokenProvider = { tokenEnv: () => ({ M365_ACCESSTOKEN: "test-token" }) };

function context(): ToolExecutionContext {
  return { sessionId: "s1", runId: "r1", toolCallId: "tc1", idempotencyKey: "m365-http-test" };
}

function requireTool<T extends { readonly name: string }>(tools: readonly T[], name: string): T {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `tool ${name} is not registered`);
  return tool;
}

function urlOf(input: RequestInfo | URL): URL {
  return new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
}

describe("createMicrosoft365HttpAdapter", () => {
  it("fails closed on a missing token before fetch", async () => {
    let calls = 0;
    const adapter = createMicrosoft365HttpAdapter({
      identity,
      tokenProvider: { tokenEnv: () => undefined },
      accessEnvVar: "M365_ACCESSTOKEN",
      fetch: async () => {
        calls += 1;
        return Response.json({});
      },
    });

    await assert.rejects(
      () => adapter.runOp("mail.list", {}),
      (error: WorkToolError) => error.code === "ERR_PRISM_WORK_CREDENTIAL",
    );
    assert.equal(calls, 0);
  });

  it("uses Graph mail endpoints and shared normalizers", async () => {
    let url: URL | undefined;
    const adapter = createMicrosoft365HttpAdapter({
      identity,
      tokenProvider,
      accessEnvVar: "M365_ACCESSTOKEN",
      allowedOps: ["mail.list"],
      fetch: async (input) => {
        url = urlOf(input);
        return Response.json({ value: [{ id: "m1", subject: "Hello", bodyPreview: "preview" }] });
      },
    });
    const list = requireTool(createWorkTools({ microsoft365: adapter }), "m365_mail_list");
    const result = await list.execute({}, context());
    const page = result.value as { items: readonly { resourceId?: string; preview?: string; provider: string }[]; untrusted: boolean };

    assert.equal(url?.origin, "https://graph.microsoft.com");
    assert.equal(url?.pathname, "/v1.0/me/mailFolders/inbox/messages");
    assert.equal(url?.searchParams.get("$top"), "50");
    assert.equal(page.untrusted, true);
    assert.equal(page.items[0]?.provider, "microsoft365");
    assert.equal(page.items[0]?.resourceId, "m1");
    assert.equal(page.items[0]?.preview, "preview");
  });

  it("keeps Graph mail sends in the existing draft approval lifecycle", async () => {
    let url: URL | undefined;
    let authorization: string | null = null;
    let body: Record<string, unknown> | undefined;
    const adapter = createMicrosoft365HttpAdapter({
      identity,
      tokenProvider,
      accessEnvVar: "M365_ACCESSTOKEN",
      allowedOps: ["mail.send"],
      fetch: async (input, init) => {
        url = urlOf(input);
        authorization = new Headers(init?.headers).get("authorization");
        body = JSON.parse(String(init?.body));
        return new Response(null, { status: 202 });
      },
    });
    const send = requireTool(
      createWorkTools({
        microsoft365: adapter,
        idempotencyStore: createMemoryIdempotencyStore(),
        approval: { isApproved: () => true },
        externalRecipients: { allow: () => true },
      }),
      "m365_mail_draft_send",
    );

    const result = await send.execute(
      { to: "a@contoso.com,b@contoso.com", cc: "c@contoso.com", subject: "Hi", bodyContents: "Body", bodyContentType: "HTML" },
      context(),
    );

    assert.equal((result.value as { status: string }).status, "executed");
    assert.equal(url?.href, "https://graph.microsoft.com/v1.0/me/sendMail");
    assert.equal(authorization, "Bearer test-token");
    assert.deepEqual(body, {
      message: {
        subject: "Hi",
        body: { contentType: "HTML", content: "Body" },
        toRecipients: [{ emailAddress: { address: "a@contoso.com" } }, { emailAddress: { address: "b@contoso.com" } }],
        ccRecipients: [{ emailAddress: { address: "c@contoso.com" } }],
      },
      saveToSentItems: true,
    });
  });

  it("uses one cached Graph profile request for readiness", async () => {
    let calls = 0;
    const adapter = createMicrosoft365HttpAdapter({
      identity,
      tokenProvider,
      accessEnvVar: "M365_ACCESSTOKEN",
      fetch: async (input) => {
        calls += 1;
        assert.equal(urlOf(input).pathname, "/v1.0/me");
        return Response.json({ userPrincipalName: "worker@contoso.com" });
      },
    });

    assert.equal(await adapter.ensureReady(), "worker@contoso.com");
    assert.equal(await adapter.ensureReady(), "worker@contoso.com");
    assert.equal(calls, 1);
  });

  it("downloads hard-coded Graph content into an artifact without returning bytes", async () => {
    const bytes = Buffer.from("one drive document");
    let written: { path: string; bytes: Uint8Array } | undefined;
    const stored = new Map<string, Buffer>();
    const bodies: ArtifactBodyStore = {
      async put(ref, body) {
        if (!(body instanceof Uint8Array)) throw new Error("test expects bytes");
        stored.set(ref.hash, Buffer.from(body));
      },
      async get(ref) {
        const body = stored.get(ref.hash) ?? Buffer.alloc(0);
        return new ReadableStream({
          start(controller) {
            controller.enqueue(body);
            controller.close();
          },
        });
      },
      async delete(ref) {
        stored.delete(ref.hash);
      },
      async presign() {
        return "https://artifacts.example/download";
      },
    };
    let url: URL | undefined;
    const adapter = createMicrosoft365HttpAdapter({
      identity,
      tokenProvider,
      accessEnvVar: "M365_ACCESSTOKEN",
      allowedOps: ["file.get"],
      fetch: async (input) => {
        url = urlOf(input);
        return new Response(bytes, { headers: { "content-length": String(bytes.byteLength) } });
      },
    });
    const get = requireTool(
      createWorkTools({
        microsoft365: adapter,
        scanAttachment: () => undefined,
        filesystem: {
          root: "/sandbox",
          async readFile() {
            return Buffer.alloc(0);
          },
          async writeFile(path, file) {
            written = { path, bytes: file };
          },
        },
        artifacts: {
          bodies,
          createRef: ({ byteLength, contentHash }) => ({
            tenantId: identity.tenantId,
            userId: identity.userId,
            artifactId: "artifact-1",
            threadId: "thread-1",
            version: 1,
            mime: "application/octet-stream",
            size: byteLength,
            hash: contentHash,
          }),
        },
      }),
      "m365_file_get",
    );

    const output = await get.execute({ id: "item 1", destPath: "downloads/file.docx" }, context());
    const value = output.value as { contentHash: string; byteLength: number; artifact: { hash: string } };
    const expectedHash = createHash("sha256").update(bytes).digest("hex");

    assert.equal(url?.href, "https://graph.microsoft.com/v1.0/me/drive/items/item%201/content");
    assert.equal(value.contentHash, expectedHash);
    assert.equal(value.artifact.hash, expectedHash);
    assert.equal(value.byteLength, bytes.byteLength);
    assert.deepEqual(stored.get(expectedHash), bytes);
    assert.equal(written?.path, "/sandbox/downloads/file.docx");
    assert.deepEqual(Buffer.from(written?.bytes ?? []), bytes);
    assert.equal(JSON.stringify(output.value).includes(bytes.toString("utf8")), false);
  });

  it("creates organization links only and rejects private web URLs before fetch", async () => {
    let calls = 0;
    let body = "";
    const adapter = createMicrosoft365HttpAdapter({
      identity,
      tokenProvider,
      accessEnvVar: "M365_ACCESSTOKEN",
      allowedOps: ["file.share"],
      fetch: async (_input, init) => {
        calls += 1;
        body = String(init?.body);
        return Response.json({ link: { webUrl: "https://contoso.sharepoint.com/link" } });
      },
    });

    await assert.rejects(
      () => adapter.runOp("file.share", { webUrl: "https://127.0.0.1", fileId: "f1", type: "view" }),
      (error: WorkToolError) => error.code === "ERR_PRISM_WORK_POLICY",
    );
    await assert.rejects(
      () => adapter.runOp("file.share", { webUrl: "https://contoso.sharepoint.com", fileId: "f1", type: "view", scope: "anonymous" }),
      (error: WorkToolError) => error.code === "ERR_PRISM_WORK_POLICY",
    );
    await adapter.runOp("file.share", { webUrl: "https://contoso.sharepoint.com", fileId: "f1", type: "edit" });

    assert.equal(calls, 1);
    assert.equal(body, '{"type":"edit","scope":"organization"}');
  });

  it("keeps file copy in the draft approval lifecycle", async () => {
    let approved = false;
    let calls = 0;
    let url: URL | undefined;
    let body = "";
    const adapter = createMicrosoft365HttpAdapter({
      identity,
      tokenProvider,
      accessEnvVar: "M365_ACCESSTOKEN",
      allowedOps: ["file.copy"],
      fetch: async (input, init) => {
        calls += 1;
        url = urlOf(input);
        body = String(init?.body);
        return new Response(null, { status: 202 });
      },
    });
    const copy = requireTool(
      createWorkTools({
        microsoft365: adapter,
        idempotencyStore: createMemoryIdempotencyStore(),
        approval: { isApproved: () => approved },
      }),
      "m365_file_draft_copy",
    );
    const args = {
      webUrl: "https://contoso.sharepoint.com",
      sourceUrl: "https://graph.microsoft.com/v1.0/drives/source/items/source-item",
      targetUrl: "https://graph.microsoft.com/v1.0/drives/target/items/target-item",
    };
    const pending = await copy.execute(args, context());
    assert.equal((pending.value as { status: string }).status, "pending_approval");
    assert.equal(calls, 0);

    approved = true;
    await copy.execute(
      { draftId: (pending.value as { draftId: string }).draftId, revision: (pending.value as { revision: number }).revision },
      context(),
    );
    assert.equal(url?.href, "https://graph.microsoft.com/v1.0/drives/source/items/source-item/copy");
    assert.equal(body, '{"parentReference":{"driveId":"target","id":"target-item"}}');
  });
});
