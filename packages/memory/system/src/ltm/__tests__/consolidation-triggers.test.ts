/**
 * Plan 188.3 Task 5: triggers, cursor, command, host API, and status.
 *
 * The pass is exercised with a scripted provider: no live model call ever runs in the suite. The
 * package tests use the same provider for the main turn, the observational-memory workers, and the
 * extractor, picked by the tool names the request exposes.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createAgent,
  createMemorySessionStore,
  createSessionEntry,
  type ModelClient,
  type ModelProvider,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type SessionEntry,
  toolCallContent,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import memorySystem, { foldObservationalMemoryLedger, type MemoryFabricConfig, WM_RECORDED } from "@arnilo/prism-memory-system";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-system/core";
import { createLongTermMemory, createMemory, encodeMemoryNoteMetadata, parseMemoryNoteMetadata } from "../../index.js";
import { resolvePromoteConfig } from "../promote.js";
import { MEMORY_NOTE_METADATA_KEY } from "../types.js";

const TIMESTAMP = "2026-01-01T00:00:00.000Z";
const USER_TEXT = "Please keep the retry budget small.";
const NOTE = {
  text: "Keep the retry budget small.",
  kind: "fact",
  scope: "project",
  keywords: ["retry"],
  aliases: [],
  evidence: ["c1"],
  explicit: true,
  correction: false,
  generality: 1,
  ephemerality: 0,
  derivable: false,
};

function userEntry(id: string, text = "Always run bun with a timeout."): SessionEntry {
  return createSessionEntry({
    id,
    sessionId: "s1",
    timestamp: TIMESTAMP,
    kind: "message",
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

function fabricFor(
  entries: readonly SessionEntry[],
  options: { readonly promote?: ReturnType<typeof resolvePromoteConfig>; readonly client?: ModelClient } = {},
) {
  const memory = createMemory({
    tenantId: "t1",
    resourceId: "projects/demo--01234567",
    threadId: "s1",
    vectorStore: createMemoryVectorStore(),
    embedder: createHashEmbedder({ dimensions: 8 }),
  });
  const fabric = createLongTermMemory({
    memory,
    promote: options.promote ?? resolvePromoteConfig({ minTurnsBetween: 1 }),
    promoteRoot: "/nonexistent-prism-promote-root",
    ...(options.client === undefined ? {} : { resolveModelClient: () => options.client! }),
  });
  return { memory, fabric, session: { id: "s1", entries: async () => entries } };
}

/** Serves main turns, both OM workers, and the extractor, chosen by the tools each request exposes. */
function scriptedProvider(counts: { recordNotes: number }): ModelProvider {
  return {
    id: "scripted",
    async *generate(request: ProviderRequest) {
      const names = new Set(request.tools?.map((tool) => tool.name) ?? []);
      const alreadyCalled = request.messages.some((message) => message.role === "tool");
      const prompt = request.messages
        .filter((message) => message.role === "user")
        .flatMap((message) => message.content.filter((block) => block.type === "text").map((block) => block.text))
        .join("\n");
      const ids = [...prompt.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]!);
      if (!alreadyCalled && names.has("record_event") && ids.length > 0) {
        yield providerToolCall(
          toolCallContent("o1", "record_event", { kind: "statement", description: USER_TEXT, relevance: "high", sourceEntryIds: ids }),
        );
      } else if (!alreadyCalled && names.has("summarize") && ids.length > 0) {
        const stmIds = [...prompt.matchAll(/^- \[([a-f0-9]{12})\] \d{4}-/gm)].map((match) => match[1]!);
        yield providerToolCall(toolCallContent("r1", "summarize", { stmIds, text: USER_TEXT, relevance: "high" }));
      } else if (!alreadyCalled && names.has("record_notes") && prompt.includes("c1")) {
        counts.recordNotes += 1;
        yield providerToolCall(toolCallContent("n1", "record_notes", { notes: [NOTE] }));
      } else if (!names.has("record_event") && !names.has("summarize") && !names.has("record_notes")) {
        yield providerTextDelta("ok");
      }
      yield providerDone();
    },
  };
}

async function tick(ms = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => Promise<boolean>, attempts = 200): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return;
    await tick();
  }
  throw new Error("condition not met");
}

/** The session-tier half of the one `memorySystem` entry (the tiers and LTM are one package since plan 216 Task 5). */
const SESSION_TIERS = {
  stm: { model: "scripted/om", triggerTokens: 1 },
  wm: { model: "scripted/om", triggerTokens: 1 },
  context: { compactAt: { maxTokens: 999_999 } },
  worker: { maxTurns: 1 },
} as const;

async function harness(options: {
  readonly promote?: MemoryFabricConfig["promote"];
  readonly withObservational?: boolean;
  readonly counts: { recordNotes: number };
}) {
  const agent = await createAgent({
    model: { provider: "scripted", model: "main" },
    packages: [
      providerPackage("scripted", [scriptedProvider(options.counts)]),
      memorySystem({
        ...(options.withObservational === true ? SESSION_TIERS : {}),
        ltm: { consolidate: false, ...(options.promote === undefined ? {} : { promote: options.promote }) },
      }),
    ],
    slots: { store: createMemorySessionStore() },
  });
  const events: string[] = [];
  const subscription = collect(agent.subscribe(), events);
  const session = await agent.session({ id: "s1", create: true });
  if (options.withObservational === true) await agent.commands.run("memory:session", {}, { session });
  return { agent, session, counts: options.counts, events, subscription };
}

async function collect(events: AsyncIterable<{ type: string; package?: string; name?: string }>, sink: string[]): Promise<void> {
  for await (const event of events) {
    if (event.type === "background.started" && event.name !== undefined) sink.push(`started:${event.name}`);
    if (event.type === "background.completed" && event.name !== undefined) sink.push(`completed:${event.name}`);
    if (event.type === "background.failed" && event.name !== undefined) sink.push(`failed:${event.name}`);
  }
}

describe("consolidation triggers, command and host API (plan 188.3 Task 5)", () => {
  it("no_new_om_material_starts_no_task", async () => {
    const h = await harness({
      promote: { minTurnsBetween: 1, derivableFrom: [] },
      counts: { recordNotes: 0 },
    });
    await h.session.run("Always answer briefly.");
    await tick(50);
    assert.equal(
      h.events.some((event) => event === "started:fabric.consolidate"),
      false,
    );
    assert.equal(h.counts.recordNotes, 0);
    await h.agent.dispose();
  });

  it("pass_runs_after_min_turns_with_new_reflection", async () => {
    const h = await harness({
      promote: { minTurnsBetween: 1, derivableFrom: [] },
      withObservational: true,
      counts: { recordNotes: 0 },
    });
    await h.session.run(USER_TEXT);
    await waitFor(async () => foldObservationalMemoryLedger(await h.session.entries()).wmItems.length > 0);
    await h.session.run("continue");
    await waitFor(async () => {
      const status = await h.agent.commands.run("memory:status", {}, { session: h.session });
      return (status as { last?: { written: number } }).last !== undefined;
    });
    const status = (await h.agent.commands.run("memory:status", {}, { session: h.session })) as {
      last: { accepted: number; written: number; modelCalls: number };
    };
    assert.equal(status.last.modelCalls, 1);
    assert.equal(status.last.written, 1);
    assert.equal(h.counts.recordNotes, 1);
    await h.agent.dispose();
  });

  it("concurrent_trigger_is_dropped_by_lease", async () => {
    const calls = { count: 0 };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client: ModelClient = {
      model: { provider: "test", model: "extractor" },
      async *generate() {
        calls.count += 1;
        await gate;
        yield providerToolCall(toolCallContent("n1", "record_notes", { notes: [NOTE] }));
        yield providerDone();
      },
    };
    const { fabric, session } = fabricFor([userEntry("e1")], { client });
    const first = fabric.consolidate(session);
    const second = await fabric.consolidate(session);
    assert.deepEqual(second, { ran: false, reason: "busy" });
    release();
    const done = await first;
    assert.equal(done.report?.written, 1);
    assert.equal(calls.count, 1);
  });

  it("failed_pass_keeps_cursor_and_retries", async () => {
    let calls = 0;
    const client: ModelClient = {
      model: { provider: "test", model: "extractor" },
      async *generate() {
        calls += 1;
        if (calls === 1) throw new Error("provider down");
        yield providerToolCall(toolCallContent("n2", "record_notes", { notes: [NOTE] }));
        yield providerDone();
      },
    };
    const { fabric, session } = fabricFor([userEntry("e1")], { client });
    const failed = await fabric.consolidate(session);
    assert.equal(failed.ran, false);
    assert.equal(failed.reason, "failed");
    assert.equal(failed.reasonCode, "model_call_failed");
    assert.deepEqual(failed.report?.failures, { model_call_failed: 1 }, "the failure is counted, not thrown away");
    assert.equal(failed.cursor, undefined, "a failed pass reports no cursor");
    const retried = await fabric.consolidate(session);
    assert.equal(retried.ran, true);
    assert.equal(retried.cursor, "e1");
    assert.equal(retried.report?.written, 1);
    assert.equal(calls, 2);
  });

  it("valid_pass_costs_one_call_and_empty_pass_zero", async () => {
    let calls = 0;
    const client: ModelClient = {
      model: { provider: "test", model: "extractor" },
      async *generate() {
        calls += 1;
        yield providerToolCall(toolCallContent("n1", "record_notes", { notes: [NOTE] }));
        yield providerDone();
      },
    };
    const valid = fabricFor([userEntry("e1")], { client });
    const first = await valid.fabric.consolidate(valid.session);
    assert.equal(first.report?.modelCalls, 1);
    assert.equal(first.report?.correctionCalls, 0);
    assert.equal(calls, 1);

    const empty = fabricFor([], { client });
    const second = await empty.fabric.consolidate(empty.session);
    assert.equal(second.ran, false);
    assert.equal(second.report?.modelCalls, 0);
    assert.equal(second.report?.correctionCalls, 0);
    assert.equal(calls, 1, "an empty pass makes no model call");
  });

  it("second_invalid_answer_fails_without_new_writes_or_cursor_advance", async () => {
    let calls = 0;
    const client: ModelClient = {
      model: { provider: "test", model: "extractor" },
      async *generate() {
        calls += 1;
        yield providerToolCall(
          toolCallContent(`n${calls}`, "record_notes", {
            notes: calls <= 2 ? [{ ...NOTE, kind: "bogus" }] : [NOTE],
          }),
        );
        yield providerDone();
      },
    };
    const { fabric, session } = fabricFor([userEntry("e1")], { client });
    const failed = await fabric.consolidate(session);
    assert.equal(failed.reason, "failed");
    assert.equal(failed.reasonCode, "note_kind");
    assert.equal(failed.report?.modelCalls, 2);
    assert.deepEqual(failed.report?.failures, { note_kind: 1 });
    assert.equal(calls, 2, "one repair call, then fail closed");
    assert.equal((await fabric.recall(NOTE.text, { minSimilarity: 0 })).hits.length, 0, "no partial write");

    const retried = await fabric.consolidate(session);
    assert.equal(calls, 3);
    assert.equal(retried.cursor, "e1", "the failed pass did not advance the cursor");
    assert.equal(retried.report?.written, 1);
    assert.equal(retried.report?.modelCalls, 1);
  });

  it("failed_extraction_preserves_supersession_and_reconsolidation_invariants", async () => {
    const reflectionId = "a".repeat(12);
    const entry = createSessionEntry({
      id: "om1",
      sessionId: "s1",
      timestamp: TIMESTAMP,
      kind: "custom",
      data: {
        type: WM_RECORDED,
        items: [{ id: reflectionId, kind: "summary", text: "Retry budget", relevance: "medium", citedIds: [], tokenCount: 1 }],
        supersededReflectionIds: [reflectionId],
      },
    });
    const client: ModelClient = {
      model: { provider: "test", model: "extractor" },
      async *generate() {
        throw new Error("malformed answer");
      },
    };
    const { fabric, memory, session } = fabricFor([entry, userEntry("e1")], { client });
    const superseded = await fabric.remember(
      { kind: "fact", content: "Keep retries at three.", key: "retry.budget" },
      { status: "candidate" },
    );
    const reopened = await fabric.remember({ kind: "fact", content: "Reopened note.", key: "retry.reopened" }, { status: "candidate" });
    await memory.patchMetadata(reopened.id, (current) => {
      const note = parseMemoryNoteMetadata(current);
      assert.ok(note);
      return {
        ...current,
        [MEMORY_NOTE_METADATA_KEY]: encodeMemoryNoteMetadata({
          ...note,
          promotedFrom: { reflectionId },
          reconsolidate: true,
        }),
      };
    });

    const failed = await fabric.consolidate(session);
    assert.equal(failed.reason, "failed");
    assert.equal(failed.reasonCode, "model_call_failed");
    const supersededRow = await memory.getEntry(superseded.id);
    const reopenedRow = await memory.getEntry(reopened.id);
    assert.equal(parseMemoryNoteMetadata(supersededRow?.metadata)?.validTo, undefined, "nothing is retired before extraction succeeds");
    assert.equal(parseMemoryNoteMetadata(reopenedRow?.metadata)?.reconsolidate, true, "the reopened note waits for a successful pass");
    assert.equal(parseMemoryNoteMetadata(reopenedRow?.metadata)?.validTo, undefined);
    assert.equal((await fabric.recall("retries", { minSimilarity: 0 })).hits.length, 2, "no partial write");
  });

  it("corrected_pass_does_not_duplicate_notes_on_next_trigger", async () => {
    let calls = 0;
    const client: ModelClient = {
      model: { provider: "test", model: "extractor" },
      async *generate() {
        calls += 1;
        yield providerToolCall(
          toolCallContent(`n${calls}`, "record_notes", {
            notes: calls === 1 ? [{ ...NOTE, kind: "bogus" }] : [NOTE],
          }),
        );
        yield providerDone();
      },
    };
    const { fabric, session } = fabricFor([userEntry("e1")], { client });
    const first = await fabric.consolidate(session);
    assert.equal(first.report?.modelCalls, 2);
    assert.equal(first.report?.correctionCalls, 1);
    assert.equal(first.report?.written, 1);
    assert.equal(first.cursor, "e1");
    assert.equal((await fabric.recall(NOTE.text, { minSimilarity: 0 })).hits.length, 1);

    const second = await fabric.consolidate(session, { cursor: first.cursor });
    assert.equal(second.ran, false, "the corrected answer advanced the cursor once");
    assert.equal(second.report?.modelCalls, 0);
    assert.equal(second.report?.written, 0);
    assert.equal(second.cursor, "e1");
    assert.equal(calls, 2, "no re-extraction of an already accepted tail");
    assert.equal((await fabric.recall(NOTE.text, { minSimilarity: 0 })).hits.length, 1);
  });

  it("consolidate_command_runs_now_and_reports_counts", async () => {
    const h = await harness({
      promote: { minTurnsBetween: 99, derivableFrom: [] },
      counts: { recordNotes: 0 },
    });
    await h.session.run("Always answer briefly.");
    const result = (await h.agent.commands.run("memory:consolidate", {}, { session: h.session })) as {
      ok: boolean;
      accepted: number;
      modelCalls: number;
      correctionCalls: number;
      rejected: { score: number };
    };
    assert.equal(result.ok, true);
    assert.equal(result.accepted, 1);
    assert.equal(result.modelCalls, 1);
    assert.equal(result.correctionCalls, 0);
    assert.equal(result.rejected.score, 0);
    const status = (await h.agent.commands.run("memory:status", {}, { session: h.session })) as {
      last: { candidates: number; accepted: number; rejected: { ephemeral: number } };
    };
    assert.equal(status.last.candidates > 0, true);
    assert.equal(status.last.accepted, 1);
    assert.equal(status.last.rejected.ephemeral, 0);
    await h.agent.dispose();
  });

  it("restored_session_catches_up_once", async () => {
    const counts = { recordNotes: 0 };
    const agent = await createAgent({
      model: { provider: "scripted", model: "main" },
      packages: [
        providerPackage("scripted", [scriptedProvider(counts)]),
        memorySystem({ ...SESSION_TIERS, ltm: { consolidate: false, promote: { minTurnsBetween: 99, derivableFrom: [] } } }),
      ],
      slots: { store: createMemorySessionStore() },
    });
    const session = await agent.session({ id: "s1", create: true });
    await agent.commands.run("memory:session", {}, { session });
    await session.run(USER_TEXT);
    await waitFor(async () => foldObservationalMemoryLedger(await session.entries()).wmItems.length > 0);
    await session.close();

    const reopened = await agent.session({ id: "s1", create: true });
    await waitFor(() => Promise.resolve(counts.recordNotes === 1));
    await tick(100);
    assert.equal(counts.recordNotes, 1, "the restore pass covers the tail exactly once");
    await reopened.close();

    const again = await agent.session({ id: "s1", create: true });
    await tick(100);
    assert.equal(counts.recordNotes, 1, "a cursor past the material starts no second pass");
    await again.close();
    await agent.dispose();
  });

  it("promote_false_makes_no_model_call", async () => {
    const h = await harness({ counts: { recordNotes: 0 } });
    await h.session.run("Always answer briefly.");
    const result = (await h.agent.commands.run("memory:consolidate", {}, { session: h.session })) as { ok: boolean; reason?: string };
    assert.equal(result.ok, false);
    assert.equal(result.reason, "disabled");
    assert.equal(h.counts.recordNotes, 0);
    await h.agent.dispose();
  });
});
