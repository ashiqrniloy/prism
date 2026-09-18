import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AgentIdentity, ArtifactBodyStore, ToolExecutionContext } from "@arnilo/prism";
import { createWorkHttpClient } from "../http.js";
import {
  createGoogleWorkspaceHttpAdapter,
  createMemoryIdempotencyStore,
  createWorkTools,
  resolveWorkLimits,
  WorkToolError,
} from "../index.js";

const identity: AgentIdentity = {
  tenantId: "tenant-1",
  userId: "user-1",
  principal: { kind: "user", id: "user-1" },
  scopes: ["Mail.Read", "Mail.Send", "Calendars.ReadWrite", "Files.ReadWrite"],
  issuedAt: new Date().toISOString(),
  verified: true,
};

const tokenProvider = { tokenEnv: () => ({ GOOGLE_ACCESS_TOKEN: "test-token" }) };

function context(idempotencyKey = "work-http-test"): ToolExecutionContext {
  return { sessionId: "s1", runId: "r1", toolCallId: "tc1", idempotencyKey };
}

function requireTool<T extends { readonly name: string }>(tools: readonly T[], name: string): T {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `tool ${name} is not registered`);
  return tool;
}

function urlOf(input: RequestInfo | URL): URL {
  return new URL(input instanceof URL ? input.href : typeof input === "string" ? input : input.url);
}

describe("createGoogleWorkspaceHttpAdapter", () => {
  it("fails closed on a missing token before fetch", async () => {
    let calls = 0;
    const adapter = createGoogleWorkspaceHttpAdapter({
      identity,
      tokenProvider: { tokenEnv: () => undefined },
      accessEnvVar: "GOOGLE_ACCESS_TOKEN",
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

  it("uses the allowlisted Gmail endpoint and shared mail normalizer", async () => {
    let url: URL | undefined;
    let authorization: string | null = null;
    const adapter = createGoogleWorkspaceHttpAdapter({
      identity,
      tokenProvider,
      accessEnvVar: "GOOGLE_ACCESS_TOKEN",
      allowedOps: ["mail.list"],
      fetch: async (input, init) => {
        url = urlOf(input);
        authorization = new Headers(init?.headers).get("authorization");
        return Response.json({ messages: [{ id: "m1", snippet: "hello" }] });
      },
    });
    const tools = createWorkTools({ googleWorkspace: adapter });
    const list = requireTool(tools, "gws_mail_list");
    const result = await list.execute({ q: "is:unread", maxResults: "10" }, context());
    const page = result.value as { items: readonly { resourceId?: string; preview?: string; provider: string }[]; untrusted: boolean };

    assert.equal(url?.origin, "https://gmail.googleapis.com");
    assert.equal(url?.searchParams.get("q"), "is:unread");
    assert.equal(url?.searchParams.get("maxResults"), "10");
    assert.equal(authorization, "Bearer test-token");
    assert.equal(page.untrusted, true);
    assert.equal(page.items[0]?.provider, "google-workspace");
    assert.equal(page.items[0]?.resourceId, "m1");
    assert.equal(page.items[0]?.preview, "hello");

    await list.execute({}, context());
    assert.equal(url?.searchParams.get("maxResults"), "50");
  });

  it("keeps mail sends in the existing draft approval lifecycle", async () => {
    let calls = 0;
    const adapter = createGoogleWorkspaceHttpAdapter({
      identity,
      tokenProvider,
      accessEnvVar: "GOOGLE_ACCESS_TOKEN",
      allowedOps: ["mail.send"],
      fetch: async () => {
        calls += 1;
        return Response.json({ id: "sent" });
      },
    });
    const tools = createWorkTools({
      googleWorkspace: adapter,
      idempotencyStore: createMemoryIdempotencyStore(),
      externalRecipients: { allow: () => true },
    });
    const send = requireTool(tools, "gws_mail_draft_send");
    const pending = await send.execute({ to: "a@example.com", subject: "Hi", body: "Body" }, context());

    assert.equal((pending.value as { status: string }).status, "pending_approval");
    assert.equal(calls, 0);
  });

  it("uses one bounded profile request for cached readiness", async () => {
    let calls = 0;
    const adapter = createGoogleWorkspaceHttpAdapter({
      identity,
      tokenProvider,
      accessEnvVar: "GOOGLE_ACCESS_TOKEN",
      fetch: async (input) => {
        calls += 1;
        assert.equal(urlOf(input).pathname, "/gmail/v1/users/me/profile");
        return Response.json({ emailAddress: "worker@example.com" });
      },
    });

    assert.equal(await adapter.ensureReady(), "worker@example.com");
    assert.equal(await adapter.ensureReady(), "worker@example.com");
    assert.equal(calls, 1);
  });

  it("paginates Drive only when pageAll is enabled", async () => {
    const urls: URL[] = [];
    const adapter = createGoogleWorkspaceHttpAdapter({
      identity,
      tokenProvider,
      accessEnvVar: "GOOGLE_ACCESS_TOKEN",
      allowedOps: ["file.list"],
      fetch: async (input) => {
        const url = urlOf(input);
        urls.push(url);
        return Response.json(
          url.searchParams.has("pageToken")
            ? { files: [{ id: "f2", name: "second" }] }
            : { files: [{ id: "f1", name: "first" }], nextPageToken: "next" },
        );
      },
    });

    const pages = await adapter.runOp("file.list", { pageAll: "true" });
    assert.equal(Array.isArray(pages), true);
    assert.equal((pages as readonly unknown[]).length, 2);
    assert.equal(urls.length, 2);
    assert.equal(urls[1]?.searchParams.get("pageToken"), "next");
  });

  it("rejects non-allowlisted origins before invoking an injected fetch", async () => {
    let calls = 0;
    const request = createWorkHttpClient({
      identity,
      tokenProvider,
      accessEnvVar: "GOOGLE_ACCESS_TOKEN",
      allowedOrigins: ["https://gmail.googleapis.com"],
      limits: resolveWorkLimits(),
      fetch: async () => {
        calls += 1;
        return Response.json({});
      },
    });

    await assert.rejects(
      () => request({ url: new URL("https://evil.example/messages") }),
      (error: WorkToolError) => error.code === "ERR_PRISM_WORK_POLICY",
    );
    assert.equal(calls, 0);
  });

  it("downloads hard-coded Drive content and refuses an oversize response", async () => {
    const bytes = Buffer.from("drive file");
    let url: URL | undefined;
    const adapter = createGoogleWorkspaceHttpAdapter({
      identity,
      tokenProvider,
      accessEnvVar: "GOOGLE_ACCESS_TOKEN",
      allowedOps: ["file.get"],
      fetch: async (input) => {
        url = urlOf(input);
        return new Response(bytes, { headers: { "content-length": String(bytes.byteLength) } });
      },
    });
    assert.deepEqual(Buffer.from((await adapter.runOp("file.get", { id: "file 1" })) as Uint8Array), bytes);
    assert.equal(url?.href, "https://www.googleapis.com/drive/v3/files/file%201?alt=media");

    const oversized = createGoogleWorkspaceHttpAdapter({
      identity,
      tokenProvider,
      accessEnvVar: "GOOGLE_ACCESS_TOKEN",
      allowedOps: ["file.get"],
      limits: { maxFileBytes: 4 },
      fetch: async () => new Response(Buffer.alloc(5), { headers: { "content-length": "5" } }),
    });
    await assert.rejects(
      () => oversized.runOp("file.get", { id: "f1" }),
      (error: WorkToolError) => error.code === "ERR_PRISM_WORK_LIMIT",
    );
  });

  it("uploads a stored artifact with its content hash in the approval draft", async () => {
    const bytes = Buffer.from("artifact body");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const ref = {
      tenantId: identity.tenantId,
      userId: "user-1",
      artifactId: "artifact-1",
      threadId: "thread-1",
      version: 1,
      mime: "text/plain",
      size: bytes.byteLength,
      hash,
    };
    const bodies: ArtifactBodyStore = {
      async put() {},
      async get() {
        return new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        });
      },
      async delete() {},
      async presign() {
        return "https://artifacts.example/download";
      },
    };
    let body = "";
    const adapter = createGoogleWorkspaceHttpAdapter({
      identity,
      tokenProvider,
      accessEnvVar: "GOOGLE_ACCESS_TOKEN",
      allowedOps: ["file.add"],
      bodies,
      fetch: async (_input, init) => {
        body = Buffer.from(init?.body as Uint8Array).toString("utf8");
        return Response.json({ id: "uploaded" });
      },
    });
    const upload = requireTool(
      createWorkTools({
        googleWorkspace: adapter,
        idempotencyStore: createMemoryIdempotencyStore(),
        approval: { isApproved: () => true },
      }),
      "gws_file_draft_upload",
    );
    const output = await upload.execute({ name: "artifact.txt", artifact: ref }, context());
    const value = output.value as { draftId: string; status: string };
    const draft = await adapter.getDraft(value.draftId);
    const schema = upload.parameters as { additionalProperties?: boolean; properties?: Record<string, unknown> };

    assert.equal(value.status, "executed");
    assert.ok(body.includes("artifact body"));
    assert.equal(draft?.payload.contentHash, hash);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties?.url, undefined);
  });

  it("gates fixed Docs, Sheets, and Slides updates", async () => {
    const ungated = createGoogleWorkspaceHttpAdapter({ identity, tokenProvider, accessEnvVar: "GOOGLE_ACCESS_TOKEN" });
    const ungatedNames = createWorkTools({ googleWorkspace: ungated }).map((tool) => tool.name);
    assert.ok(!ungatedNames.includes("gws_docs_draft_update"));
    assert.ok(!ungatedNames.includes("gws_sheets_draft_update"));
    assert.ok(!ungatedNames.includes("gws_slides_draft_update"));

    let approved = false;
    const calls: { url: URL; method: string; body: string }[] = [];
    const adapter = createGoogleWorkspaceHttpAdapter({
      identity,
      tokenProvider,
      accessEnvVar: "GOOGLE_ACCESS_TOKEN",
      allowedOps: ["docs.update", "sheets.update", "slides.update"],
      fetch: async (input, init) => {
        calls.push({ url: urlOf(input), method: String(init?.method ?? "GET"), body: String(init?.body) });
        return Response.json({ id: "updated" });
      },
    });
    const tools = createWorkTools({
      googleWorkspace: adapter,
      idempotencyStore: createMemoryIdempotencyStore(),
      approval: { isApproved: () => approved },
    });
    const docs = requireTool(tools, "gws_docs_draft_update");
    const sheets = requireTool(tools, "gws_sheets_draft_update");
    const slides = requireTool(tools, "gws_slides_draft_update");
    const schema = docs.parameters as { additionalProperties?: boolean; properties?: Record<string, unknown> };
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties?.requests, undefined);

    const pending = await docs.execute(
      { documentId: "doc-1", replaceAllText: { containsText: "old", replaceText: "new" }, insertText: { locationIndex: 1, text: "intro" } },
      context(),
    );
    assert.equal((pending.value as { status: string }).status, "pending_approval");
    assert.equal(calls.length, 0);

    approved = true;
    await docs.execute(
      { draftId: (pending.value as { draftId: string }).draftId, revision: (pending.value as { revision: number }).revision },
      context("gws-docs-update"),
    );
    await sheets.execute({ spreadsheetId: "sheet-1", range: "Sheet1!A1", values: [["=1+1"]] }, context("gws-sheets-update"));
    await slides.execute({ presentationId: "slides-1", insertText: { objectId: "shape-1", text: "Hello" } }, context("gws-slides-update"));

    assert.equal(calls[0]?.url.href, "https://docs.googleapis.com/v1/documents/doc-1:batchUpdate");
    assert.equal(calls[0]?.method, "POST");
    assert.equal(
      calls[0]?.body,
      '{"requests":[{"replaceAllText":{"containsText":{"text":"old"},"replaceText":"new"}},{"insertText":{"location":{"index":1},"text":"intro"}}]}',
    );
    assert.equal(calls[1]?.url.href, "https://sheets.googleapis.com/v4/spreadsheets/sheet-1/values/Sheet1!A1?valueInputOption=RAW");
    assert.equal(calls[1]?.method, "PUT");
    assert.equal(calls[1]?.body, '{"values":[["=1+1"]]}');
    assert.equal(calls[2]?.url.href, "https://slides.googleapis.com/v1/presentations/slides-1:batchUpdate");
    assert.equal(calls[2]?.method, "POST");
    assert.equal(calls[2]?.body, '{"requests":[{"insertText":{"objectId":"shape-1","text":"Hello"}}]}');

    const count = calls.length;
    await assert.rejects(
      () => adapter.runOp("docs.update", { documentId: "doc-1", requests: [] }),
      (error: WorkToolError) => error.code === "ERR_PRISM_WORK_INPUT",
    );
    assert.equal(calls.length, count);
  });

  it("uploads a host-local file as bounded multipart content", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prism-gws-http-"));
    const filePath = join(dir, "note.txt");
    await writeFile(filePath, "host file");
    let body = "";
    try {
      const adapter = createGoogleWorkspaceHttpAdapter({
        identity,
        tokenProvider,
        accessEnvVar: "GOOGLE_ACCESS_TOKEN",
        allowedOps: ["file.add"],
        fetch: async (_input, init) => {
          body = Buffer.from(init?.body as Uint8Array).toString("utf8");
          return Response.json({ id: "f1" });
        },
      });

      assert.deepEqual(await adapter.runOp("file.add", { name: "note.txt", filePath }), { id: "f1" });
      assert.ok(body.includes("host file"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("denies anonymous Drive sharing and remote upload paths", async () => {
    let calls = 0;
    const adapter = createGoogleWorkspaceHttpAdapter({
      identity,
      tokenProvider,
      accessEnvVar: "GOOGLE_ACCESS_TOKEN",
      allowedOps: ["file.share", "file.add"],
      fetch: async () => {
        calls += 1;
        return Response.json({});
      },
    });

    await assert.rejects(
      () => adapter.runOp("file.share", { fileId: "f1", type: "anyone" }),
      (error: WorkToolError) => error.code === "ERR_PRISM_WORK_POLICY",
    );
    await assert.rejects(
      () => adapter.runOp("file.add", { name: "bad", filePath: "https://evil.example/file" }),
      (error: WorkToolError) => error.code === "ERR_PRISM_WORK_INPUT",
    );
    assert.equal(calls, 0);
  });
});
