import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type AIProvider,
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  createSessionEntry,
  providerDone,
  providerTextDelta,
  rebuildSessionContext,
  type SessionEntry,
} from "@arnilo/prism";
import {
  buildObservationalMemoryContextBlocks,
  createObservationalMemory,
  createObservationalMemoryCompactionStrategy,
  type MemoryObservation,
  OBSERVATIONS_DROPPED,
  OBSERVATIONS_RECORDED,
  renderObservationalMemory,
} from "../index.js";

const model = { provider: "mock", model: "demo" };
const workerModel = { provider: "mock", model: "memory" };
const now = "2026-06-20T00:00:00.000Z";

function message(id: string, text: string, parentId?: string): SessionEntry {
  return createSessionEntry({
    id,
    sessionId: "s1",
    parentId,
    timestamp: now,
    kind: "message",
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

function observation(id: string, content: string, sourceEntryIds: readonly string[]): MemoryObservation {
  return { id, content, timestamp: now, relevance: "high", sourceEntryIds, tokenCount: 4 };
}

function observationsRecorded(
  id: string,
  observations: readonly MemoryObservation[],
  parentId?: string,
  coversUpToId?: string,
): SessionEntry {
  return createSessionEntry({
    id,
    sessionId: "s1",
    parentId,
    timestamp: now,
    kind: "custom",
    data: { type: OBSERVATIONS_RECORDED, observations, ...(coversUpToId === undefined ? {} : { coversUpToId }) },
  });
}

function observationsDropped(id: string, observationIds: readonly string[], parentId?: string): SessionEntry {
  return createSessionEntry({
    id,
    sessionId: "s1",
    parentId,
    timestamp: now,
    kind: "custom",
    data: { type: OBSERVATIONS_DROPPED, observationIds },
  });
}

function attachFixture(options: {
  readonly initial?: readonly SessionEntry[];
  readonly create?: Parameters<typeof createObservationalMemory>[0];
  readonly onRequest?: (messagesJson: string) => void;
}) {
  const store = createMemorySessionStore(options.initial ?? []);
  const provider = createMockProvider([providerTextDelta("ok"), providerDone()], {
    ...(options.onRequest ? { onRequest: (request) => options.onRequest?.(JSON.stringify(request.messages)) } : {}),
  });
  const agent = createAgent({ model, provider, store });
  const leafId = options.initial?.at(-1)?.id;
  const baseSession = agent.createSession({ id: "s1", ...(leafId === undefined ? {} : { leafId }) });
  const attached = createObservationalMemory(options.create ?? {}).attach(baseSession, {
    appendEntry: (entry, entryOptions) => store.append(entry, entryOptions),
    sessionModel: model,
  });
  return { attached, store };
}

describe("observational memory coverage-safe admission", () => {
  it("workerless_render_only_compaction_retains_uncovered_sentinel", async () => {
    const sentinel = message("m1", "EVIDENCE-SENTINEL 42");
    const recent = message("m2", "recent reply", "m1");
    const strategy = createObservationalMemoryCompactionStrategy({ keepRecentEntries: 1 });
    const result = await strategy.compact({ sessionId: "s1", entries: [sentinel, recent], trigger: "auto" });
    const compaction = result.entries?.[0];
    assert.ok(compaction);
    const data = compaction.data as { readonly keepEntryIds?: readonly string[]; readonly throughEntryId?: string };
    assert.deepEqual(data.keepEntryIds, ["m1", "m2"], "no observed entry may be folded without coverage");
    assert.equal(data.throughEntryId, undefined, "nothing is safe to fold without coverage");

    const context = rebuildSessionContext([sentinel, recent, compaction]);
    assert.match(JSON.stringify(context.messages), /EVIDENCE-SENTINEL 42/);
    assert.match(context.summaries.join("\n"), /Observational Memory/);
  });

  it("partial_coverage_folds_covered_prefix_and_keeps_uncovered_tail", async () => {
    const covered = message("m1", "covered evidence");
    const recorded = observationsRecorded("om1", [observation("aaaaaaaaaaaa", "covered fact", ["m1"])], "m1", "m1");
    const uncovered = message("m2", "uncovered evidence", "om1");
    const strategy = createObservationalMemoryCompactionStrategy({ keepRecentEntries: 0 });
    const result = await strategy.compact({ sessionId: "s1", entries: [covered, recorded, uncovered], trigger: "auto" });
    const compaction = result.entries?.[0];
    assert.ok(compaction);
    const data = compaction.data as { readonly keepEntryIds?: readonly string[]; readonly throughEntryId?: string };
    assert.deepEqual(data.keepEntryIds, ["m2"]);
    assert.equal(data.throughEntryId, "om1");

    const context = rebuildSessionContext([covered, recorded, uncovered, compaction]);
    const text = JSON.stringify(context.messages);
    assert.match(text, /uncovered evidence/);
    assert.doesNotMatch(text, /"covered evidence"/);
    assert.match(result.summary, /covered fact/);
  });

  it("workerless_attach_defers_automatic_compaction_and_keeps_sentinel_in_next_request", async () => {
    const debug: { readonly message: string; readonly data?: unknown }[] = [];
    const requests: string[] = [];
    const { attached } = attachFixture({
      create: {
        context: { compactAfterTokens: 1 },
        overrides: { observation: { messageTokens: 1 }, agentMaxTurns: 1 },
        debug: (message, data) => debug.push({ message, data }),
      },
      onRequest: (messages) => requests.push(messages),
    });

    await attached.session.run("EVIDENCE-SENTINEL anterior");
    const entries = await attached.session.entries();
    assert.equal(
      entries.some((entry) => entry.kind === "compaction"),
      false,
      "a skipped observer pass with no coverage must defer, not fold",
    );
    assert.ok(
      debug.some(
        (entry) =>
          entry.message === "observational-memory:compaction-deferred" && (entry.data as { skipped?: string }).skipped === "missing_model",
      ),
      "deferral reports the typed skip reason",
    );
    assert.equal((await attached.runtime.flush()).skipped, "missing_model");

    requests.length = 0;
    await attached.session.run("second turn");
    const context = rebuildSessionContext(await attached.session.entries());
    assert.match(JSON.stringify(context.messages), /EVIDENCE-SENTINEL anterior/);
    assert.match(requests.at(-1) ?? "", /EVIDENCE-SENTINEL anterior/);
  });

  it("successful_empty_observation_pass_compacts_while_missing_worker_defers", async () => {
    const worker: AIProvider = {
      id: "memory",
      async *generate() {
        yield providerDone();
      },
    };
    const observed = attachFixture({
      create: {
        observation: { provider: worker, model: workerModel },
        context: { compactAfterTokens: 1 },
        overrides: {
          observation: { messageTokens: 1 },
          reflection: { observationTokens: 999_999 },
          agentMaxTurns: 1,
        },
      },
    });
    await observed.attached.session.run("hello");
    const entries = await observed.attached.session.entries();
    assert.equal(
      entries.some((entry) => entry.kind === "compaction"),
      true,
      "a successful pass (even with zero observations) still compacts",
    );
    const recorded = entries.find((entry) => entry.kind === "custom" && (entry.data as { type?: string }).type === OBSERVATIONS_RECORDED);
    assert.ok(recorded);
    assert.deepEqual((recorded.data as { observations: readonly unknown[] }).observations, []);
    assert.equal((await observed.attached.runtime.flush()).skipped, undefined);

    const missing = attachFixture({
      create: {
        context: { compactAfterTokens: 1 },
        overrides: { observation: { messageTokens: 1 }, agentMaxTurns: 1 },
      },
    });
    await missing.attached.session.run("hello");
    assert.equal(
      (await missing.attached.session.entries()).some((entry) => entry.kind === "compaction"),
      false,
    );
  });

  it("skipped_and_errored_flushes_defer_without_coverage", async () => {
    const debug: { readonly message: string; readonly data?: unknown }[] = [];
    const gated = attachFixture({
      create: {
        observation: { provider: createMockProvider([providerDone()]), model: workerModel },
        credentialRequest: { provider: "mock", name: "apiKey" },
        context: { compactAfterTokens: 1 },
        overrides: { observation: { messageTokens: 1 }, agentMaxTurns: 1 },
        debug: (message, data) => debug.push({ message, data }),
      },
    });
    await gated.attached.session.run("hello");
    assert.equal(
      (await gated.attached.session.entries()).some((entry) => entry.kind === "compaction"),
      false,
    );
    assert.ok(
      debug.some(
        (entry) =>
          entry.message === "observational-memory:compaction-deferred" &&
          (entry.data as { skipped?: string }).skipped === "missing_credentials",
      ),
    );

    const failing = attachFixture({
      create: {
        observation: {
          provider: {
            id: "memory",
            async *generate() {
              throw new Error("worker boom");
            },
          },
          model: workerModel,
        },
        context: { compactAfterTokens: 1 },
        overrides: { observation: { messageTokens: 1 }, agentMaxTurns: 1 },
        debug: (message, data) => debug.push({ message, data }),
      },
    });
    await failing.attached.session.run("hello");
    assert.equal(
      (await failing.attached.session.entries()).some((entry) => entry.kind === "compaction"),
      false,
    );
    assert.ok(
      debug.some(
        (entry) => entry.message === "observational-memory:compaction-deferred" && (entry.data as { skipped?: string }).skipped === "error",
      ),
    );

    const passive = attachFixture({
      create: {
        context: { compactAfterTokens: 1 },
        overrides: { passive: true, observation: { messageTokens: 1 }, agentMaxTurns: 1 },
      },
    });
    await passive.attached.session.run("hello");
    assert.equal(
      (await passive.attached.session.entries()).some((entry) => entry.kind === "compaction"),
      false,
    );
  });

  it("recall_guidance_follows_capability_and_pool_content", async () => {
    const fact = observation("aaaaaaaaaaaa", "package-only preference", ["m1"]);
    assert.doesNotMatch(renderObservationalMemory([], []), /call recall/, "an empty pool never advertises recall");
    assert.match(renderObservationalMemory([], [fact]), /call recall/);
    assert.doesNotMatch(
      renderObservationalMemory([], [fact], { advertiseRecall: false }),
      /call recall/,
      "hosts without a recall capability suppress the instruction",
    );

    const strategyEntries = [message("m1", "hello"), observationsRecorded("om1", [fact], "m1", "m1"), message("m2", "recent", "om1")];
    const strategy = createObservationalMemoryCompactionStrategy({ advertiseRecall: false, keepRecentEntries: 1 });
    const result = await strategy.compact({ sessionId: "s1", entries: strategyEntries });
    assert.doesNotMatch(result.summary, /call recall/);
    const advertisedSummary = await createObservationalMemoryCompactionStrategy({ keepRecentEntries: 1 }).compact({
      sessionId: "s1",
      entries: strategyEntries,
    });
    assert.match(advertisedSummary.summary, /call recall/);

    const initial = [message("m1", "hello"), observationsRecorded("om1", [fact], "m1", "m1")];
    const blocks = await buildObservationalMemoryContextBlocks(initial, { advertiseRecall: false, keepRecentEntries: 0 });
    assert.doesNotMatch(String(blocks.find((block) => block.title === "observational-memory")?.content ?? ""), /call recall/);
    const advertised = await buildObservationalMemoryContextBlocks(initial, { keepRecentEntries: 0 });
    assert.match(String(advertised.find((block) => block.title === "observational-memory")?.content ?? ""), /call recall/);
  });

  it("revoked_observation_is_not_resurrected_by_retention", async () => {
    const covered = message("m1", "revoked source origin");
    const revoked = observation("aaaaaaaaaaaa", "REVOKED-FACT", ["m1"]);
    const entries = [
      covered,
      observationsRecorded("om1", [revoked], "m1", "m1"),
      observationsDropped("om2", [revoked.id], "om1"),
      message("m2", "uncovered tail", "om2"),
    ];
    const strategy = createObservationalMemoryCompactionStrategy({ keepRecentEntries: 0 });
    const result = await strategy.compact({ sessionId: "s1", entries, trigger: "auto" });
    const compaction = result.entries?.[0];
    assert.ok(compaction);
    assert.doesNotMatch(result.summary, /REVOKED-FACT/);
    assert.deepEqual((compaction.data as { readonly memory: { observations: readonly unknown[] } }).memory.observations, []);
    assert.deepEqual((compaction.data as { readonly keepEntryIds?: readonly string[] }).keepEntryIds, ["m2"]);
  });

  it("retained_uncovered_entries_never_leak_secrets_into_the_compaction_payload", async () => {
    const secret = "retained-secret-token";
    const entries = [
      message("m1", "covered origin"),
      observationsRecorded("om1", [observation("aaaaaaaaaaaa", `observed ${secret}`, ["m1"])], "m1", "m1"),
      message("m2", `uncovered evidence ${secret}`, "om1"),
      message("m3", "recent", "m2"),
    ];
    const result = await createObservationalMemoryCompactionStrategy({ keepRecentEntries: 1, secrets: [secret] }).compact({
      sessionId: "s1",
      entries,
      trigger: "auto",
    });
    const text = JSON.stringify(result);
    assert.equal(text.includes(secret), false);
    assert.match(text, /\[REDACTED\]/);
    const compaction = result.entries?.[0];
    assert.ok(compaction);
    assert.deepEqual(
      (compaction.data as { readonly keepEntryIds?: readonly string[] }).keepEntryIds,
      ["m2", "m3"],
      "retention keeps the uncovered tail without folding it",
    );
  });
});
