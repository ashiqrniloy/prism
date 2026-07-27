import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventSchemas, EventType } from "@ag-ui/core";
import { createAgent, createSecretRedactor, providerDone, providerTextDelta } from "@arnilo/prism";
import { createAcpEventMapper } from "../acp/index.js";
import {
  type CoWorkEvent,
  type CoWorkReplayPage,
  createAgUiEventMapper,
  createAgUiHandler,
  createCoWorkReplay,
  projectCoWorkEvent,
  resolveAgUiLimits,
} from "../index.js";

const authorization = { ownership: { userId: "user-1" } };

const events: Record<string, CoWorkEvent> = {
  progress: { kind: "artifact.progress", artifactId: "art-1", version: 2, status: "rendering", progress: 0.5 },
  approval: { kind: "artifact.approval.requested", artifactId: "art-1", version: 2, reviewer: "user:user-1", reason: "needs sign-off" },
  draft: { kind: "draft.connector.pending", connectorId: "conn-1", scope: "mail.read", status: "pending" },
  snapshot: { kind: "browser.snapshot", snapshotId: "snap-1", summary: "Inbox with 3 messages" },
  link: {
    kind: "artifact.download.link",
    artifactId: "art-1",
    version: 2,
    link: "https://cdn.example/dl?tok=abc",
    expiresAt: "2026-07-25T05:00:00.000Z",
  },
};

describe("co-work event projection", () => {
  it("maps every co-work kind to a schema-valid, named AG-UI CUSTOM event", () => {
    const mapper = createAgUiEventMapper();
    for (const [name, event] of Object.entries(events)) {
      const mapped = mapper.mapCoWork(event);
      assert.equal(mapped.length, 1, name);
      assert.equal(EventSchemas.safeParse(mapped[0]).success, true, name);
      assert.equal(mapped[0].type, EventType.CUSTOM, name);
      assert.equal(mapped[0].name, `prism.cowork.${event.kind}`, name);
      assert.equal(mapped[0].value.kind, event.kind, name);
    }
  });

  it("redacts secrets and never emits local filesystem paths", () => {
    const mapper = createAgUiEventMapper({ redactor: createSecretRedactor(["sekret", "/home/arn"]) });
    const leaked = mapper.mapCoWork({ kind: "browser.snapshot", snapshotId: "s", summary: "file at /home/arn/secret with sekret token" });
    const output = JSON.stringify(leaked);
    assert.ok(!output.includes("sekret"));
    assert.ok(!output.includes("/home/arn"));
  });

  it("fails closed on malformed co-work events (unknown kind, missing fields)", () => {
    const mapper = createAgUiEventMapper();
    assert.deepEqual(mapper.mapCoWork({ kind: "bogus" } as unknown as CoWorkEvent), []);
    assert.deepEqual(mapper.mapCoWork({ kind: "artifact.progress", artifactId: "", version: 1, status: "x" }), []);
    assert.deepEqual(mapper.mapCoWork({ kind: "artifact.progress", artifactId: "a", version: Number.NaN, status: "x" }), []);
    assert.deepEqual(mapper.mapCoWork({ kind: "browser.snapshot", snapshotId: "s" } as unknown as CoWorkEvent), []);
  });

  it("drops oversized co-work payloads instead of truncating into a leak", () => {
    const limits = resolveAgUiLimits({ maxTextBytes: 1024 });
    const payload = projectCoWorkEvent(
      { kind: "browser.snapshot", snapshotId: "s", summary: "x".repeat(64 * 1024) },
      { maxBytes: limits.maxTextBytes },
    );
    assert.equal(payload, undefined);
  });

  it("applies the host coWork projection hook before redaction", () => {
    const mapper = createAgUiEventMapper({ projection: { coWork: (event) => ({ kind: event.kind, curated: true }) } });
    const mapped = mapper.mapCoWork(events.snapshot);
    assert.equal(mapped[0].value.curated, true);
    assert.equal(mapped[0].value.summary, undefined);
  });

  it("ACP mapper projects co-work events to safe session updates (parity)", () => {
    const mapper = createAcpEventMapper({ redactor: createSecretRedactor(["sekret"]) });
    const mapped = mapper.mapCoWork({ kind: "artifact.approval.requested", artifactId: "art-1", version: 2, reason: "sekret reason" });
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].sessionUpdate, "agent_message_chunk");
    assert.ok(!JSON.stringify(mapped).includes("sekret"));
    assert.deepEqual(mapper.mapCoWork({ kind: "nope" } as unknown as CoWorkEvent), []);
  });
});

describe("createCoWorkReplay", () => {
  const context = { threadId: "thread-1", artifactId: "art-1" };

  it("pages durable co-work state behind frozen caps (pure, no side effects)", async () => {
    let calls = 0;
    const replay = createCoWorkReplay({
      source: {
        async page(): Promise<CoWorkReplayPage> {
          calls += 1;
          return { events: [events.progress, events.approval], nextCursor: undefined };
        },
      },
    });
    const page = await replay.page({ context, authorization });
    assert.equal(page.events.length, 2);
    assert.equal(calls, 1);
    // Replaying the same cursor re-reads identically (idempotent projection).
    const again = await replay.page({ context, authorization });
    assert.deepEqual(again.events, page.events);
  });

  it("rejects oversized cursors and over-limit pages fail-closed", async () => {
    const replay = createCoWorkReplay({
      source: { page: async () => ({ events: [events.progress] }) },
      limits: { maxCursorBytes: 1024, maxReplayEvents: 100 },
    });
    await assert.rejects(() => replay.page({ context, cursor: "c".repeat(2048), authorization }), /maxCursorBytes/);

    const tooMany = createCoWorkReplay({
      source: { page: async () => ({ events: new Array(101).fill(events.progress) }) },
      limits: { maxCursorBytes: 1024, maxReplayEvents: 100 },
    });
    await assert.rejects(() => tooMany.page({ context, authorization }), /unavailable/);
  });
});

describe("createAgUiHandler co-work context", () => {
  function body() {
    return JSON.stringify({
      threadId: "thread-1",
      runId: "run-1",
      state: {},
      messages: [{ id: "user-1", role: "user", content: "hello" }],
      tools: [],
      context: [],
      forwardedProps: {},
    });
  }
  const request = (value: string) =>
    new Request("https://example.test/ag-ui", { method: "POST", headers: { "content-type": "application/json" }, body: value });
  const parse = async (response: Response) =>
    (await response.text())
      .trim()
      .split("\n\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line.slice(6)));

  it("threads thread/artifact/identity context and appends redacted co-work events after the run", async () => {
    let seenContext: unknown;
    const agent = createAgent({
      model: { provider: "mock", model: "mock" },
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("done");
          yield providerDone();
        },
      },
    });
    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: () => agent.createSession({ id: "session-1" }),
      redactor: createSecretRedactor(["sekret"]),
      coWorkContext: (input) => {
        seenContext = { threadId: input.threadId, artifactId: "art-1", identity: "user:user-1" };
        return { threadId: input.threadId, artifactId: "art-1", identity: "user:user-1" };
      },
      coWork: { page: async () => ({ events: [events.progress, { kind: "browser.snapshot", snapshotId: "s", summary: "sekret view" }] }) },
    });

    const output = await parse(await handler(request(body())));
    assert.deepEqual(seenContext, { threadId: "thread-1", artifactId: "art-1", identity: "user:user-1" });
    const cowork = output.filter((item) => item.type === EventType.CUSTOM && String(item.name).startsWith("prism.cowork."));
    assert.deepEqual(
      cowork.map((item) => item.name),
      ["prism.cowork.artifact.progress", "prism.cowork.browser.snapshot"],
    );
    // Co-work events follow the terminal RUN_FINISHED.
    const runFinishedAt = output.map((item) => item.type).lastIndexOf(EventType.RUN_FINISHED);
    const firstCoWorkAt = output.findIndex((item) => item.name === "prism.cowork.artifact.progress");
    assert.equal(runFinishedAt < firstCoWorkAt, true);
    assert.ok(!JSON.stringify(output).includes("sekret"));
  });

  it("emits no co-work events when the source yields only malformed entries", async () => {
    const agent = createAgent({
      model: { provider: "mock", model: "mock" },
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("done");
          yield providerDone();
        },
      },
    });
    const handler = createAgUiHandler({
      authorize: () => authorization,
      sessionFactory: () => agent.createSession({ id: "session-1" }),
      coWork: { page: async () => ({ events: [{ kind: "bogus" } as unknown as CoWorkEvent] }) },
    });
    const output = await parse(await handler(request(body())));
    assert.equal(
      output.some((item) => String(item.name ?? "").startsWith("prism.cowork.")),
      false,
    );
  });
});
