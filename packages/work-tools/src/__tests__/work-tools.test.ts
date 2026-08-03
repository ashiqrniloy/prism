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
import { resolveWorkLimits } from "../limits.js";
import type { WorkCliExecResult } from "../types.js";

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
    assert.deepEqual(buildMicrosoft365Argv("mail.list", { folderName: "inbox" }), [
      "outlook",
      "message",
      "list",
      "--output",
      "json",
      "--folderName",
      "inbox",
    ]);
    assert.deepEqual(buildMicrosoft365Argv("mail.get", { id: "msg-1" }), [
      "outlook",
      "message",
      "get",
      "--output",
      "json",
      "--id",
      "msg-1",
    ]);
    assert.deepEqual(buildMicrosoft365Argv("mail.send", { to: "a@contoso.com", subject: "Hi", bodyContents: "Body" }), [
      "outlook",
      "mail",
      "send",
      "--output",
      "json",
      "--to",
      "a@contoso.com",
      "--subject",
      "Hi",
      "--bodyContents",
      "Body",
    ]);
    assert.deepEqual(buildMicrosoft365Argv("file.list", { webUrl: "https://contoso.sharepoint.com", folderUrl: "Shared Documents" }), [
      "file",
      "list",
      "--output",
      "json",
      "--webUrl",
      "https://contoso.sharepoint.com",
      "--folderUrl",
      "Shared Documents",
    ]);
    assert.throws(() => assertSafeArgv(["login"]), /Forbidden/);
    assert.throws(() => assertSafeArgv(["outlook", "mail", "send", "--debug"]), /Forbidden/);
    assert.throws(
      () =>
        buildMicrosoft365Argv("file.share", {
          webUrl: "https://contoso.sharepoint.com",
          fileId: "id",
          type: "view",
          scope: "anonymous",
        }),
      /Anonymous/,
    );
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
    const pending = await send.execute(
      {
        to: "a@contoso.com",
        subject: "Hi",
        bodyContents: "Body",
        idempotencyKey: "op-1",
      },
      ctx(),
    );
    assert.equal((pending.value as { status: string }).status, "pending_approval");
    assert.equal(sent.filter((c) => c.includes("send")).length, 0);

    approved = true;
    const first = await send.execute(
      {
        to: "a@contoso.com",
        subject: "Hi",
        bodyContents: "Body",
        idempotencyKey: "op-1",
      },
      ctx(),
    );
    assert.equal((first.value as { status: string }).status, "executed");
    const second = await send.execute(
      {
        to: "a@contoso.com",
        subject: "Hi",
        bodyContents: "Body",
        idempotencyKey: "op-1",
      },
      ctx(),
    );
    assert.equal((second.value as { status: string }).status, "duplicate");
    assert.equal(sent.filter((c) => c[1] === "mail" && c[2] === "send").length, 1);

    await assert.rejects(
      async () => send.execute({ to: "evil@external.test", subject: "x", bodyContents: "y" }, ctx()),
      /External recipient denied/,
    );
  });

  it("claims before dispatch and leaves ambiguous connector failures unknown", async () => {
    const store = createMemoryIdempotencyStore();
    let release: (() => void) | undefined;
    let calls = 0;
    const adapter = createMicrosoft365CliAdapter({
      binary: "/usr/bin/m365",
      identity,
      configDir: "/tmp/prism-m365-test",
      runner: fakeRunner(async (argv) => {
        if (argv[0] === "version") return { exitCode: 0, stdout: '"v11.7.0"', stderr: "" };
        calls += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { exitCode: 0, stdout: "", stderr: "" };
      }),
    });
    const send = createWorkTools({
      microsoft365: adapter,
      idempotencyStore: store,
      approval: { isApproved: () => true },
      externalRecipients: { allow: () => true },
    }).find((tool) => tool.name === "m365_mail_draft_send")!;
    const args = { to: "a@contoso.com", subject: "Hi", bodyContents: "Body", idempotencyKey: "concurrent-1" };
    const first = send.execute(args, ctx());
    await Promise.resolve();
    await assert.rejects(async () => send.execute(args, ctx()), /not available for replay/);
    release?.();
    await first;
    assert.equal(calls, 1);
  });

  it("marks ambiguous connector failures unknown instead of replaying", async () => {
    const store = createMemoryIdempotencyStore();
    const adapter = createMicrosoft365CliAdapter({
      binary: "/usr/bin/m365",
      identity,
      configDir: "/tmp/prism-m365-test",
      runner: fakeRunner((argv) => {
        if (argv[0] === "version") return { exitCode: 0, stdout: '"v11.7.0"', stderr: "" };
        throw new Error("transport lost");
      }),
    });
    const send = createWorkTools({
      microsoft365: adapter,
      idempotencyStore: store,
      approval: { isApproved: () => true },
      externalRecipients: { allow: () => true },
    }).find((tool) => tool.name === "m365_mail_draft_send")!;
    const args = { to: "a@contoso.com", subject: "Hi", bodyContents: "Body", idempotencyKey: "unknown-1" };
    await assert.rejects(async () => send.execute(args, ctx()), /transport lost/);
    assert.equal((await store.get({ identity, key: "unknown-1", op: "mail.send" }))?.status, "unknown");
    await assert.rejects(async () => send.execute(args, ctx()), /requires reconciliation/);
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

describe("idempotency claim state", () => {
  it("claims once, enforces CAS, caps retries, and isolates owners", async () => {
    const clock = { t: 1_000 };
    const store = createMemoryIdempotencyStore({ now: () => clock.t });
    const input = { identity, key: "mutation-1", op: "mail.send" };
    const [first, second] = await Promise.all([store.begin(input), store.begin(input)]);
    const claim = first.outcome === "acquired" ? first : second;
    assert.equal(claim.outcome, "acquired");
    assert.ok(claim.record.claimToken);
    assert.equal(first.outcome === "acquired" ? second.outcome : first.outcome, "existing");

    await assert.rejects(
      () =>
        store.complete({
          ...input,
          claimToken: "stale",
          expectedVersion: claim.record.version,
          result: { draftId: "draft-1" },
        }),
      (error: WorkToolError) => error.code === "ERR_PRISM_WORK_IDEMPOTENCY_CONFLICT",
    );
    const completed = await store.complete({
      ...input,
      claimToken: claim.record.claimToken!,
      expectedVersion: claim.record.version,
      result: { draftId: "draft-1", resourceId: "resource-1" },
    });
    assert.equal(completed.status, "completed");
    assert.equal(Object.isFrozen(completed), true);
    assert.equal((await store.begin(input)).outcome, "existing");
    assert.equal(await store.get({ ...input, identity: { ...identity, tenantId: "other-tenant" } }), undefined);

    const retry = await store.begin({ ...input, key: "retry-1", maxAttempts: 2 });
    await store.fail({
      ...input,
      key: "retry-1",
      claimToken: retry.record.claimToken!,
      expectedVersion: retry.record.version,
      status: "failed_retryable",
      failure: { code: "ERR_PRISM_WORK_CREDENTIAL" },
    });
    const retryClaim = await store.begin({ ...input, key: "retry-1", maxAttempts: 2 });
    assert.equal(retryClaim.outcome, "acquired");
    await store.fail({
      ...input,
      key: "retry-1",
      claimToken: retryClaim.record.claimToken!,
      expectedVersion: retryClaim.record.version,
      status: "failed_retryable",
      failure: { code: "ERR_PRISM_WORK_CREDENTIAL" },
    });
    assert.equal((await store.begin({ ...input, key: "retry-1", maxAttempts: 2 })).outcome, "existing");
  });

  it("turns expired claims into unknown until explicit reconciliation", async () => {
    const clock = { t: 1_000 };
    const store = createMemoryIdempotencyStore({ now: () => clock.t });
    const input = { identity, key: "expired-1", op: "mail.send", claimTtlMs: 10 };
    await store.begin(input);
    clock.t += 10;
    const unknown = await store.get(input);
    assert.equal(unknown?.status, "unknown");
    assert.equal((await store.begin(input)).outcome, "existing");
    const resolved = await store.resolveUnknown({ ...input, expectedVersion: unknown!.version, status: "failed_terminal" });
    assert.equal(resolved.status, "failed_terminal");
    await assert.rejects(() => store.begin({ ...input, key: "x".repeat(2_049) }), /bounded/);
  });
});

describe("google-workspace argv templates", () => {
  it("builds verified gws command shapes and rejects auth/schema/anyone", () => {
    assert.deepEqual(buildGoogleWorkspaceArgv("version", {}), ["--version"]);
    assert.deepEqual(buildGoogleWorkspaceArgv("mail.list", { q: "is:unread" }), [
      "gmail",
      "users",
      "messages",
      "list",
      "--params",
      '{"userId":"me","q":"is:unread"}',
      "--fields",
      "messages(id,threadId,snippet)",
    ]);
    assert.deepEqual(buildGoogleWorkspaceArgv("mail.send", { to: "a@example.com", subject: "Hi", body: "Body" }), [
      "gmail",
      "+send",
      "--to",
      "a@example.com",
      "--subject",
      "Hi",
      "--body",
      "Body",
    ]);
    assert.deepEqual(
      buildGoogleWorkspaceArgv("calendar.add", {
        summary: "Standup",
        start: "2026-06-17T09:00:00Z",
        end: "2026-06-17T09:30:00Z",
      }),
      [
        "calendar",
        "events",
        "insert",
        "--params",
        '{"calendarId":"primary"}',
        "--json",
        '{"summary":"Standup","start":{"dateTime":"2026-06-17T09:00:00Z"},"end":{"dateTime":"2026-06-17T09:30:00Z"}}',
      ],
    );
    assert.ok(buildGoogleWorkspaceArgv("file.list", { pageAll: "true" }).includes("--page-all"));
    assert.throws(() => assertSafeArgv(["auth", "login"]), /Forbidden/);
    assert.throws(() => assertSafeArgv(["schema", "drive.files.list"]), /Forbidden/);
    assert.throws(
      () =>
        buildGoogleWorkspaceArgv("file.share", {
          fileId: "f1",
          type: "anyone",
        }),
      /Anonymous/,
    );
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
    const pending = await send.execute(
      {
        to: "a@example.com",
        subject: "Hi",
        body: "Body",
        idempotencyKey: "gws-1",
      },
      ctx(),
    );
    assert.equal((pending.value as { status: string }).status, "pending_approval");
    approved = true;
    const first = await send.execute(
      {
        to: "a@example.com",
        subject: "Hi",
        body: "Body",
        idempotencyKey: "gws-1",
      },
      ctx(),
    );
    assert.equal((first.value as { status: string }).status, "executed");
    const second = await send.execute(
      {
        to: "a@example.com",
        subject: "Hi",
        body: "Body",
        idempotencyKey: "gws-1",
      },
      ctx(),
    );
    assert.equal((second.value as { status: string }).status, "duplicate");
    assert.equal(sent.filter((c) => c[1] === "+send").length, 1);
  });

  it("parseCliNdjson rejects oversize page streams", () => {
    const limits = resolveWorkLimits({ maxPaginationPages: 2 });
    assert.throws(() => parseCliNdjson("1\n2\n3\n", limits), /pagination/);
  });
});

describe("connector token wiring (per-identity, fail-closed)", () => {
  function capturingRunner(captured: { argv: readonly string[]; env?: Readonly<Record<string, string>> }[]) {
    return {
      async exec(argv: readonly string[], options?: { env?: Readonly<Record<string, string>> }) {
        captured.push({ argv, env: options?.env });
        return { exitCode: 0, stdout: JSON.stringify({ value: ["ok"] }), stderr: "" };
      },
    };
  }

  it("injects the per-identity token into env, never argv", async () => {
    const captured: { argv: readonly string[]; env?: Readonly<Record<string, string>> }[] = [];
    let seenIdentity: AgentIdentity | undefined;
    const adapter = createMicrosoft365CliAdapter({
      binary: "/usr/bin/m365",
      identity,
      configDir: "/tmp/cfg",
      runner: capturingRunner(captured),
      tokenProvider: {
        tokenEnv(id) {
          seenIdentity = id;
          return { M365_ACCESSTOKEN: "secret-token" };
        },
      },
    });
    await adapter.runOp("mail.list", { folderName: "inbox" });
    assert.equal(seenIdentity?.userId, "user-1");
    const opCall = captured.at(-1)!;
    assert.equal(opCall.env?.M365_ACCESSTOKEN, "secret-token");
    // Token must never appear in argv (nor model context).
    assert.ok(captured.every(({ argv }) => !argv.includes("secret-token")));
  });

  it("fails closed when the token is revoked/unavailable, before any exec", async () => {
    const captured: { argv: readonly string[]; env?: Readonly<Record<string, string>> }[] = [];
    const adapter = createMicrosoft365CliAdapter({
      binary: "/usr/bin/m365",
      identity,
      configDir: "/tmp/cfg",
      runner: capturingRunner(captured),
      tokenProvider: { tokenEnv: () => undefined },
    });
    await assert.rejects(
      () => adapter.runOp("mail.list", {}),
      (error: WorkToolError) => error.code === "ERR_PRISM_WORK_CREDENTIAL",
    );
    assert.equal(captured.length, 0);
  });

  it("runs without a token provider when the host uses another auth seam", async () => {
    const captured: { argv: readonly string[]; env?: Readonly<Record<string, string>> }[] = [];
    const adapter = createGoogleWorkspaceCliAdapter({
      binary: "/usr/bin/gws",
      identity,
      configDir: "/tmp/cfg",
      runner: capturingRunner(captured),
    });
    await adapter.runOp("mail.list", {});
    assert.ok(captured.length > 0);
    assert.equal(captured.at(-1)!.env, undefined);
  });
});
