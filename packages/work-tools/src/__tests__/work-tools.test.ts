import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentIdentity, ToolExecutionContext } from "@arnilo/prism";
import {
  assertSafeArgv,
  buildGoogleWorkspaceArgv,
  buildMicrosoft365Argv,
  createGoogleWorkspaceCliAdapter,
  createMemoryIdempotencyStore,
  createMicrosoft365CliAdapter,
  createWorkTools,
  normalizeMailPage,
  parseCliNdjson,
  WorkToolError,
} from "../index.js";
import type { WorkCliExecResult } from "../types.js";
import { resolveWorkLimits } from "../limits.js";

const identity: AgentIdentity = {
  tenantId: "tenant-1",
  userId: "user-1",
  principal: { kind: "user", id: "user-1" },
  scopes: ["Mail.Read", "Mail.Send", "Calendars.ReadWrite", "Files.ReadWrite"],
  issuedAt: new Date().toISOString(),
  verified: true,
};

function ctx(): ToolExecutionContext {
  return { sessionId: "s1", runId: "r1", toolCallId: "tc-1" };
}

function fakeRunner(handler: (argv: readonly string[]) => WorkCliExecResult | Promise<WorkCliExecResult>) {
  return {
    async exec(argv: readonly string[]) {
      return handler(argv);
    },
  };
}

describe("microsoft365 argv templates", () => {
  it("builds verified CLI command shapes and rejects forbidden tokens", () => {
    assert.deepEqual(buildMicrosoft365Argv("version", {}), ["version", "--output", "json"]);
    assert.deepEqual(
      buildMicrosoft365Argv("mail.list", { folderName: "inbox" }),
      ["outlook", "message", "list", "--output", "json", "--folderName", "inbox"],
    );
    assert.deepEqual(
      buildMicrosoft365Argv("mail.get", { id: "msg-1" }),
      ["outlook", "message", "get", "--output", "json", "--id", "msg-1"],
    );
    assert.deepEqual(
      buildMicrosoft365Argv("mail.send", { to: "a@contoso.com", subject: "Hi", bodyContents: "Body" }),
      ["outlook", "mail", "send", "--output", "json", "--to", "a@contoso.com", "--subject", "Hi", "--bodyContents", "Body"],
    );
    assert.deepEqual(
      buildMicrosoft365Argv("file.list", { webUrl: "https://contoso.sharepoint.com", folderUrl: "Shared Documents" }),
      ["file", "list", "--output", "json", "--webUrl", "https://contoso.sharepoint.com", "--folderUrl", "Shared Documents"],
    );
    assert.throws(() => assertSafeArgv(["login"]), /Forbidden/);
    assert.throws(() => assertSafeArgv(["outlook", "mail", "send", "--debug"]), /Forbidden/);
    assert.throws(() => buildMicrosoft365Argv("file.share", {
      webUrl: "https://contoso.sharepoint.com",
      fileId: "id",
      type: "view",
      scope: "anonymous",
    }), /Anonymous/);
  });
});

describe("createMicrosoft365CliAdapter", () => {
  it("validates version, isolates ops, and refuses ungated todo", async () => {
    const calls: string[][] = [];
    const adapter = createMicrosoft365CliAdapter({
      binary: "/usr/bin/m365",
      identity,
      configDir: "/tmp/prism-m365-test",
      runner: fakeRunner((argv) => {
        calls.push([...argv]);
        if (argv[0] === "version") return { exitCode: 0, stdout: '"v11.7.0"', stderr: "" };
        return { exitCode: 0, stdout: "[]", stderr: "" };
      }),
    });
    assert.equal(await adapter.ensureReady(), "v11.7.0");
    await adapter.runOp("mail.list", { folderName: "inbox" });
    assert.ok(calls.some((c) => c[0] === "outlook" && c[1] === "message" && c[2] === "list"));
    await assert.rejects(() => adapter.runOp("todo.list", { listName: "Tasks" }), /not allowed/);
  });

  it("kills path: oversized stdout rejected by runner seam", async () => {
    let n = 0;
    const adapter = createMicrosoft365CliAdapter({
      binary: "/usr/bin/m365",
      identity,
      configDir: "/tmp/prism-m365-test",
      limits: { maxStdoutBytes: 16 },
      runner: {
        async exec(argv) {
          n += 1;
          if (argv[0] === "version") return { exitCode: 0, stdout: '"v11.7.0"', stderr: "" };
          throw new WorkToolError("ERR_PRISM_WORK_LIMIT", "CLI stdout exceeds byte limit");
        },
      },
    });
    await assert.rejects(() => adapter.runOp("mail.list", {}), /stdout/);
    assert.equal(n, 2);
  });
});

describe("createWorkTools", () => {
  it("draft-then-approve mail send with idempotent retry", async () => {
    const store = createMemoryIdempotencyStore();
    let approved = false;
    const sent: string[][] = [];
    const adapter = createMicrosoft365CliAdapter({
      binary: "/usr/bin/m365",
      identity,
      configDir: "/tmp/prism-m365-test",
      runner: fakeRunner((argv) => {
        if (argv[0] === "version") return { exitCode: 0, stdout: '"v11.7.0"', stderr: "" };
        sent.push([...argv]);
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
    });
    const tools = createWorkTools({
      microsoft365: adapter,
      idempotencyStore: store,
      approval: { isApproved: () => approved },
      externalRecipients: { allow: (address) => address.endsWith("@contoso.com") },
    });
    const send = tools.find((tool) => tool.name === "m365_mail_draft_send")!;
    const pending = await send.execute({
      to: "a@contoso.com",
      subject: "Hi",
      bodyContents: "Body",
      idempotencyKey: "op-1",
    }, ctx());
    assert.equal((pending.value as { status: string }).status, "pending_approval");
    assert.equal(sent.filter((c) => c.includes("send")).length, 0);

    approved = true;
    const first = await send.execute({
      to: "a@contoso.com",
      subject: "Hi",
      bodyContents: "Body",
      idempotencyKey: "op-1",
    }, ctx());
    assert.equal((first.value as { status: string }).status, "executed");
    const second = await send.execute({
      to: "a@contoso.com",
      subject: "Hi",
      bodyContents: "Body",
      idempotencyKey: "op-1",
    }, ctx());
    assert.equal((second.value as { status: string }).status, "duplicate");
    assert.equal(sent.filter((c) => c[1] === "mail" && c[2] === "send").length, 1);

    await assert.rejects(
      async () => send.execute({ to: "evil@external.test", subject: "x", bodyContents: "y" }, ctx()),
      /External recipient denied/,
    );
  });

  it("does not expose model-controlled command surface", () => {
    const adapter = createMicrosoft365CliAdapter({
      binary: "/usr/bin/m365",
      identity,
      configDir: "/tmp/prism-m365-test",
      runner: fakeRunner(() => ({ exitCode: 0, stdout: '"v1"', stderr: "" })),
    });
    const names = createWorkTools({ microsoft365: adapter }).map((tool) => tool.name);
    assert.ok(!names.some((name) => name.includes("exec") || name.includes("cli") || name.includes("raw")));
  });
});

describe("google-workspace argv templates", () => {
  it("builds verified gws command shapes and rejects auth/schema/anyone", () => {
    assert.deepEqual(buildGoogleWorkspaceArgv("version", {}), ["--version"]);
    assert.deepEqual(
      buildGoogleWorkspaceArgv("mail.list", { q: "is:unread" }),
      [
        "gmail", "users", "messages", "list",
        "--params", '{"userId":"me","q":"is:unread"}',
        "--fields", "messages(id,threadId,snippet)",
      ],
    );
    assert.deepEqual(
      buildGoogleWorkspaceArgv("mail.send", { to: "a@example.com", subject: "Hi", body: "Body" }),
      ["gmail", "+send", "--to", "a@example.com", "--subject", "Hi", "--body", "Body"],
    );
    assert.deepEqual(
      buildGoogleWorkspaceArgv("calendar.add", {
        summary: "Standup",
        start: "2026-06-17T09:00:00Z",
        end: "2026-06-17T09:30:00Z",
      }),
      [
        "calendar", "events", "insert",
        "--params", '{"calendarId":"primary"}',
        "--json", '{"summary":"Standup","start":{"dateTime":"2026-06-17T09:00:00Z"},"end":{"dateTime":"2026-06-17T09:30:00Z"}}',
      ],
    );
    assert.ok(buildGoogleWorkspaceArgv("file.list", { pageAll: "true" }).includes("--page-all"));
    assert.throws(() => assertSafeArgv(["auth", "login"]), /Forbidden/);
    assert.throws(() => assertSafeArgv(["schema", "drive.files.list"]), /Forbidden/);
    assert.throws(() => buildGoogleWorkspaceArgv("file.share", {
      fileId: "f1",
      type: "anyone",
    }), /Anonymous/);
  });
});

describe("createGoogleWorkspaceCliAdapter", () => {
  it("validates version, isolates ops, refuses ungated docs, parses NDJSON", async () => {
    const calls: string[][] = [];
    const adapter = createGoogleWorkspaceCliAdapter({
      binary: "/usr/bin/gws",
      identity,
      configDir: "/tmp/prism-gws-test",
      runner: fakeRunner((argv) => {
        calls.push([...argv]);
        if (argv[0] === "--version") return { exitCode: 0, stdout: "0.22.5\n", stderr: "" };
        if (argv.includes("--page-all")) {
          return {
            exitCode: 0,
            stdout: '{"files":[{"id":"a","name":"A"}]}\n{"files":[{"id":"b","name":"B"}]}\n',
            stderr: "",
          };
        }
        return { exitCode: 0, stdout: '{"messages":[{"id":"m1","snippet":"hi"}]}', stderr: "" };
      }),
    });
    assert.equal(await adapter.ensureReady(), "0.22.5");
    await adapter.runOp("mail.list", { q: "is:unread" });
    assert.ok(calls.some((c) => c[0] === "gmail" && c[2] === "messages" && c[3] === "list"));
    await assert.rejects(() => adapter.runOp("docs.create", { title: "x" }), /not allowed/);
    const pages = await adapter.runOp("file.list", { pageAll: "true" });
    assert.equal(Array.isArray(pages) && pages.length, 2);
  });
});

describe("shared result parity", () => {
  it("normalizes M365 and GWS mail pages to the same shape keys", () => {
    const m365 = normalizeMailPage("microsoft365", { value: [{ id: "1", subject: "A", bodyPreview: "p" }] });
    const gws = normalizeMailPage("google-workspace", { messages: [{ id: "2", snippet: "p" }] });
    assert.equal(m365.untrusted, true);
    assert.equal(gws.untrusted, true);
    assert.equal(m365.items[0]?.subject, "A");
    assert.equal(gws.items[0]?.preview, "p");
    assert.equal(m365.items[0]?.provider, "microsoft365");
    assert.equal(gws.items[0]?.provider, "google-workspace");
  });

  it("gws draft-then-approve mail send with shared idempotency store", async () => {
    const store = createMemoryIdempotencyStore();
    let approved = false;
    const sent: string[][] = [];
    const adapter = createGoogleWorkspaceCliAdapter({
      binary: "/usr/bin/gws",
      identity,
      configDir: "/tmp/prism-gws-test",
      runner: fakeRunner((argv) => {
        if (argv[0] === "--version") return { exitCode: 0, stdout: "0.22.5", stderr: "" };
        sent.push([...argv]);
        return { exitCode: 0, stdout: '{"id":"msg-1"}', stderr: "" };
      }),
    });
    const tools = createWorkTools({
      googleWorkspace: adapter,
      idempotencyStore: store,
      approval: { isApproved: () => approved },
      externalRecipients: { allow: (address) => address.endsWith("@example.com") },
    });
    const send = tools.find((tool) => tool.name === "gws_mail_draft_send")!;
    const pending = await send.execute({
      to: "a@example.com",
      subject: "Hi",
      body: "Body",
      idempotencyKey: "gws-1",
    }, ctx());
    assert.equal((pending.value as { status: string }).status, "pending_approval");
    approved = true;
    const first = await send.execute({
      to: "a@example.com",
      subject: "Hi",
      body: "Body",
      idempotencyKey: "gws-1",
    }, ctx());
    assert.equal((first.value as { status: string }).status, "executed");
    const second = await send.execute({
      to: "a@example.com",
      subject: "Hi",
      body: "Body",
      idempotencyKey: "gws-1",
    }, ctx());
    assert.equal((second.value as { status: string }).status, "duplicate");
    assert.equal(sent.filter((c) => c[1] === "+send").length, 1);
  });

  it("parseCliNdjson rejects oversize page streams", () => {
    const limits = resolveWorkLimits({ maxPaginationPages: 2 });
    assert.throws(() => parseCliNdjson("1\n2\n3\n", limits), /pagination/);
  });
});
