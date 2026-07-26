import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createSecretRedactor,
  providerDone,
  providerTextDelta,
  toolCallContent,
  type AIProvider,
} from "@arnilo/prism";
import { createSqlitePersistence, type SqlitePersistence } from "@arnilo/prism-session-store-sqlite";
import { createConversationHandler, createConversationService, type ConversationService } from "../conversations.js";

const ownership = { tenantId: "tenant-1", userId: "user-1" };
const otherOwnership = { tenantId: "tenant-1", userId: "user-2" };
const SECRET = "conv-secret-value";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function tempDbPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "prism-conv-"));
  tempDirs.push(dir);
  return join(dir, `${name}.db`);
}

function textProvider(): AIProvider {
  return {
    id: "mock",
    async *generate() {
      yield providerTextDelta("ok");
      yield providerDone();
    },
  };
}

function toolOnceProvider(state: { turns: number }): AIProvider {
  return {
    id: "mock",
    async *generate() {
      if (++state.turns === 1) {
        yield { type: "tool_call" as const, call: toolCallContent("call-1", "note", { value: SECRET }) };
        yield providerDone();
        return;
      }
      yield providerTextDelta("done");
      yield providerDone();
    },
  };
}

function makeService(options: {
  provider?: AIProvider;
  limits?: Parameters<typeof createConversationService>[1]["limits"];
  onTool?: () => void;
} = {}): { persistence: SqlitePersistence; service: ConversationService } {
  const persistence = createSqlitePersistence({ filename: tempDbPath("conv") });
  const agent = createAgent({
    model: { provider: "mock", model: "offline" },
    provider: options.provider ?? textProvider(),
    redactor: createSecretRedactor([SECRET]),
    store: persistence,
    runLedger: persistence,
    tools: [{
      name: "note",
      parameters: {},
      execute: () => {
        options.onTool?.();
        return { toolCallId: "call-1", name: "note", value: "noted" };
      },
    }],
  });
  const service = createConversationService(persistence, {
    redactor: createSecretRedactor([SECRET]),
    sessionFactory: ({ thread, leafId }) => agent.createSession({ id: thread.id, ...(leafId === undefined ? {} : { leafId }) }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  return { persistence, service };
}

async function lastEntryId(persistence: SqlitePersistence, sessionId: string): Promise<string> {
  const entries = await persistence.list(sessionId);
  const last = entries.at(-1);
  assert.ok(last, "expected at least one session entry");
  return last.id;
}

describe("createConversationService", () => {
  it("creates, lists, and gets ownership-scoped conversation threads", async () => {
    const { persistence, service } = makeService();
    const one = await service.create({ ownership, title: "first" });
    assert.equal(one.state, "active");
    assert.equal(one.title, "first");
    assert.equal(one.tenantId, "tenant-1");
    const two = await service.create({ ownership, title: "second" });

    // Non-conversation sessions on the same store/ownership stay invisible.
    await persistence.appendSession!({ id: "plain-session", ...ownership, createdAt: one.createdAt, updatedAt: one.updatedAt });

    const page = await service.list({ ownership });
    assert.deepEqual(page.items.map((thread) => thread.id).sort(), [one.id, two.id].sort());

    const fetched = await service.get({ ownership, threadId: one.id });
    assert.equal(fetched.id, one.id);

    await assert.rejects(() => service.get({ ownership: otherOwnership, threadId: one.id }), /not found/);
    const foreign = await service.list({ ownership: otherOwnership });
    assert.equal(foreign.items.length, 0);
    persistence.close();
  });

  it("makes create idempotent for explicit ids and enforces frozen field limits", async () => {
    const { persistence, service } = makeService();
    const first = await service.create({ ownership, id: "conv-fixed", title: "a", requestId: "req-1" });
    const second = await service.create({ ownership, id: "conv-fixed", title: "b" });
    assert.equal(second.id, "conv-fixed");
    assert.equal(second.title, "a", "get-or-create must return the existing thread");
    assert.equal(first.id, second.id);

    await assert.rejects(
      () => service.create({ ownership, title: "x".repeat(257) }),
      (error: Error) => error.message.includes("bytes"),
    );
    await assert.rejects(() => service.create({ ownership, id: "../escape" }), /invalid/);
    await assert.rejects(() => service.create({ ownership, requestId: "r".repeat(257) }), /bytes/);
    persistence.close();
  });

  it("continues threads durably and records request ids on runs", async () => {
    const { persistence, service } = makeService();
    const thread = await service.create({ ownership, title: "chat" });
    const first = await service.continue({ ownership, threadId: thread.id, message: "first question", requestId: "req-1" });
    assert.equal(first.status, "succeeded");
    const second = await service.continue({ ownership, threadId: thread.id, message: "second question" });
    assert.equal(second.status, "succeeded");

    // Durable history: both user turns and both assistant replies live in the thread session.
    const entries = await persistence.list(thread.id);
    const userTexts = entries
      .filter((entry) => entry.kind === "message" && entry.message?.role === "user")
      .map((entry) => JSON.stringify(entry.message?.content));
    assert.equal(userTexts.length, 2);
    assert.match(userTexts[0] ?? "", /first question/);
    assert.match(userTexts[1] ?? "", /second question/);

    const runs = await persistence.queryRuns({ sessionId: thread.id, ...ownership });
    assert.equal(runs.items.length, 2);
    assert.ok(runs.items.some((run) => run.idempotencyKey === "req-1"));
    persistence.close();
  });

  it("replays bounded redacted events without rerunning completed work", async () => {
    let toolCalls = 0;
    const turns = { turns: 0 };
    const { persistence, service } = makeService({ provider: toolOnceProvider(turns), onTool: () => { toolCalls += 1; } });
    const thread = await service.create({ ownership });
    await service.continue({ ownership, threadId: thread.id, message: "do the thing" });
    assert.equal(toolCalls, 1);

    const seen = new Set<string>();
    let cursor: string | undefined;
    let terminal = false;
    do {
      const page = await service.replay({ ownership, threadId: thread.id, ...(cursor === undefined ? {} : { cursor }) });
      for (const record of page.records) {
        assert.equal(record.redacted, true);
        seen.add(record.id);
      }
      terminal = page.terminal;
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    assert.ok(terminal, "replay must reach a terminal event");
    assert.ok(seen.size >= 3, "replay should include tool and finish events");
    assert.equal(toolCalls, 1, "replay must never rerun tools");

    // Cross-thread cursor reuse fails closed.
    const other = await service.create({ ownership });
    await service.continue({ ownership, threadId: other.id, message: "other" });
    const otherPage = await service.replay({ ownership, threadId: other.id });
    if (otherPage.nextCursor) {
      await assert.rejects(
        () => service.replay({ ownership, threadId: thread.id, cursor: otherPage.nextCursor }),
        /another thread/,
      );
    }
    persistence.close();
  });

  it("records branches, enforces the active-branch cap, and rejects unknown leaves", async () => {
    const { persistence, service } = makeService({ limits: { maxActiveBranches: 2 } });
    const thread = await service.create({ ownership });
    await service.continue({ ownership, threadId: thread.id, message: "seed" });
    const leaf = await lastEntryId(persistence, thread.id);

    const branched = await service.branch({ ownership, threadId: thread.id, leafId: leaf });
    assert.equal(branched.branches.length, 1);
    assert.equal(branched.branches[0]?.leafId, leaf);
    const again = await service.branch({ ownership, threadId: thread.id, leafId: leaf });
    assert.equal(again.branches.length, 1, "branch must be idempotent per leaf");

    await service.branch({ ownership, threadId: thread.id, leafId: "leaf-2" });
    await assert.rejects(
      () => service.branch({ ownership, threadId: thread.id, leafId: "leaf-3" }),
      /Too many active branches/,
    );

    await assert.rejects(
      () => service.continue({ ownership, threadId: thread.id, message: "fork", leafId: "leaf-9" }),
      /not a recorded branch/,
    );
    const forked = await service.continue({ ownership, threadId: thread.id, message: "fork", leafId: leaf });
    assert.equal(forked.status, "succeeded");
    persistence.close();
  });

  it("archives threads and refuses continues on archived threads", async () => {
    const { persistence, service } = makeService();
    const thread = await service.create({ ownership });
    const archived = await service.archive({ ownership, threadId: thread.id });
    assert.equal(archived.state, "archived");
    const again = await service.archive({ ownership, threadId: thread.id });
    assert.equal(again.state, "archived");
    await assert.rejects(
      () => service.continue({ ownership, threadId: thread.id, message: "still there?" }),
      /archived/,
    );
    const page = await service.list({ ownership });
    assert.equal(page.items[0]?.state, "archived");
    persistence.close();
  });

  it("exports redacted events with byte caps and resumable cursors", async () => {
    const { persistence, service } = makeService({ limits: { exportBytes: 1400, replayPageLimit: 2 } });
    const thread = await service.create({ ownership });
    await service.continue({ ownership, threadId: thread.id, message: `one ${SECRET}` });
    await service.continue({ ownership, threadId: thread.id, message: "two" });

    const full = await createConversationService(persistence, {
      redactor: createSecretRedactor([SECRET]),
      sessionFactory: () => { throw new Error("not used"); },
    }).export({ ownership, threadId: thread.id });
    assert.ok(full.events.length >= 4);
    assert.equal(full.truncated, false);
    assert.doesNotMatch(JSON.stringify(full), new RegExp(SECRET));

    const collected = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await service.export({ ownership, threadId: thread.id, ...(cursor === undefined ? {} : { cursor }) });
      for (const event of page.events) collected.add(event.id);
      cursor = page.nextCursor;
      pages += 1;
      assert.ok(pages <= 10, "export must converge");
    } while (cursor !== undefined);

    assert.deepEqual([...collected].sort(), full.events.map((event) => event.id).sort());
    persistence.close();
  });

  it("deletes threads through lifecycle and honors legal holds", async () => {
    const { persistence, service } = makeService();
    const thread = await service.create({ ownership });
    await service.continue({ ownership, threadId: thread.id, message: "to be deleted" });

    const result = await service.delete({ ownership, threadId: thread.id });
    assert.deepEqual(result, { deleted: true, held: false });
    await assert.rejects(() => service.get({ ownership, threadId: thread.id }), /not found/);
    assert.equal((await persistence.list(thread.id)).length, 0);

    const held = await service.create({ ownership });
    await persistence.lifecycle.putLegalHold({
      ...ownership,
      resourceKind: "session",
      resourceId: held.id,
      reason: "investigation",
    });
    const heldResult = await service.delete({ ownership, threadId: held.id });
    assert.deepEqual(heldResult, { deleted: false, held: true });
    assert.equal((await service.get({ ownership, threadId: held.id })).id, held.id);
    persistence.close();
  });
});

describe("createConversationHandler", () => {
  function jsonRequest(path: string, body?: unknown, method = "POST"): Request {
    return new Request(`https://example.test${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("serves conversation routes behind authorization with redacted responses", async () => {
    const { persistence, service } = makeService();
    const handler = createConversationHandler({
      service,
      authorize: () => ({ ownership }),
      redactor: createSecretRedactor([SECRET]),
    });

    const created = await handler(jsonRequest("/prism/conversations", { title: SECRET }));
    assert.equal(created.status, 201);
    const createdBody = await created.text();
    assert.doesNotMatch(createdBody, new RegExp(SECRET), "handler redactor must scrub responses");
    const thread = JSON.parse(createdBody) as { id: string };

    const list = await handler(jsonRequest("/prism/conversations", undefined, "GET"));
    assert.equal(list.status, 200);
    assert.equal((JSON.parse(await list.text()) as { items: unknown[] }).items.length, 1);

    const continued = await handler(jsonRequest(`/prism/conversations/${thread.id}/continue`, { message: "hi", requestId: "req-h" }));
    assert.equal(continued.status, 200, await continued.clone().text());
    assert.equal((JSON.parse(await continued.text()) as { status: string }).status, "succeeded");

    const events = await handler(jsonRequest(`/prism/conversations/${thread.id}/events`, undefined, "GET"));
    assert.equal(events.status, 200);
    const replay = JSON.parse(await events.text()) as { records: unknown[]; terminal: boolean };
    assert.ok(replay.records.length >= 2);
    assert.equal(replay.terminal, true);

    const archived = await handler(jsonRequest(`/prism/conversations/${thread.id}/archive`, {}));
    assert.equal(archived.status, 200);
    assert.equal((JSON.parse(await archived.text()) as { state: string }).state, "archived");

    const deleted = await handler(jsonRequest(`/prism/conversations/${thread.id}`, undefined, "DELETE"));
    assert.equal(deleted.status, 200);
    assert.equal((JSON.parse(await deleted.text()) as { deleted: boolean }).deleted, true);

    persistence.close();
  });

  it("fails closed on authorization, unknown threads, and unknown routes", async () => {
    const { persistence, service } = makeService();
    const denying = createConversationHandler({ service, authorize: () => false });
    assert.equal((await denying(jsonRequest("/prism/conversations", { title: "x" }))).status, 403);

    const handler = createConversationHandler({ service, authorize: () => ({ ownership }) });
    assert.equal((await handler(jsonRequest("/prism/conversations/conv-missing", undefined, "GET"))).status, 404);
    assert.equal((await handler(jsonRequest("/prism/conversations/conv-missing/bogus", {}))).status, 404);
    assert.equal((await handler(jsonRequest("/prism/conversations/../agents", undefined, "GET"))).status, 404);

    const thread = await service.create({ ownership });
    const foreign = createConversationHandler({ service, authorize: () => ({ ownership: otherOwnership }) });
    assert.equal((await foreign(jsonRequest(`/prism/conversations/${thread.id}`, undefined, "GET"))).status, 404);
    persistence.close();
  });
});
