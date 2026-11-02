/**
 * Plan 188.10 Task 5: the extractor's output budget, reasoning level, truncation repair, failure
 * reasons, and prompt overhead.
 *
 * No live call: every client is scripted, and the truncation cases are ordinary `done` events with
 * `stopReason: "max_output_tokens"`.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createSessionEntry,
  type JsonSchema,
  type ModelClient,
  type ModelSpec,
  type ProviderRequestOptions,
  providerDone,
  providerToolCall,
  type SessionEntry,
  toolCallContent,
  validateJsonSchema,
} from "@arnilo/prism";
import { createHashEmbedder, createMemoryVectorStore } from "@arnilo/prism-memory-core";
import { buildConsolidationExtractPrompt, CONSOLIDATION_EXTRACT_SYSTEM, consolidationExtractSchema } from "../consolidation/prompts.js";
import { createMemory, createMemoryFabric, createMemoryWorkingStore } from "../index.js";
import { memoryFabricPromoteSchema, readPromoteState, resolvePromoteConfig } from "../promote.js";

const TIMESTAMP = "2026-01-01T00:00:00.000Z";
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

function userEntry(id: string): SessionEntry {
  return createSessionEntry({
    id,
    sessionId: "s1",
    timestamp: TIMESTAMP,
    kind: "message",
    message: { role: "user", content: [{ type: "text", text: "Always run bun with a timeout." }] },
  });
}

function fabricFor(options: {
  readonly promote?: ReturnType<typeof resolvePromoteConfig>;
  readonly resolveModelClient?: (ref?: ModelSpec | string) => ModelClient;
}) {
  const memory = createMemory({
    tenantId: "t1",
    resourceId: "projects/demo--01234567",
    threadId: "s1",
    vectorStore: createMemoryVectorStore(),
    workingStore: createMemoryWorkingStore(),
    embedder: createHashEmbedder({ dimensions: 8 }),
  });
  const fabric = createMemoryFabric({
    memory,
    promote: options.promote ?? resolvePromoteConfig({ minTurnsBetween: 1 }),
    promoteRoot: "/nonexistent-prism-promote-root",
    ...(options.resolveModelClient === undefined ? {} : { resolveModelClient: options.resolveModelClient }),
  });
  const session = { id: "s1", entries: async () => [userEntry("e1")] };
  return { fabric, session };
}

/** A client whose model declares a 4,096-token output limit, as a real extractor model does. */
function extractorClient(
  script: (call: number) => readonly import("@arnilo/prism").ProviderEvent[],
  seen: { readonly options: ProviderRequestOptions[]; readonly prompts: string[] } = { options: [], prompts: [] },
): ModelClient {
  let call = 0;
  return {
    model: {
      provider: "test",
      model: "extractor",
      capabilities: { reasoning: true },
      compat: { thinkingFamily: "reasoning_effort" },
      limits: { maxOutputTokens: 4096 },
    },
    async *generate(request) {
      call += 1;
      if (request.options !== undefined) seen.options.push(request.options);
      const prompt = request.messages
        .filter((message) => message.role === "user")
        .flatMap((message) => message.content.filter((block) => block.type === "text").map((block) => block.text))
        .join("\n");
      seen.prompts.push(prompt);
      for (const event of script(call)) yield event;
    },
  };
}

describe("extractor budget, reasoning level and truncation (plan 188.10 Task 5)", () => {
  it("extractor_output_budget_caps_at_model_limit", async () => {
    const refs: (ModelSpec | string | undefined)[] = [];
    const client = extractorClient(() => [providerToolCall(toolCallContent("n1", "record_notes", { notes: [NOTE] })), providerDone()]);
    const budgeted = fabricFor({
      promote: resolvePromoteConfig({ minTurnsBetween: 1, maxOutputTokens: 8192 }),
      resolveModelClient: (ref) => {
        refs.push(ref);
        return client;
      },
    });
    assert.equal((await budgeted.fabric.consolidate(budgeted.session)).report?.written, 1);
    // Resolved twice: the host's model first, then the same model with the capped `maxTokens`.
    assert.equal(refs.length, 2);
    const spec = refs[1] as ModelSpec;
    assert.equal(spec.provider, "test");
    assert.equal(spec.model, "extractor");
    assert.equal(spec.parameters?.maxTokens, 4096, "the model's own limit caps the requested 8,192");

    const unbudgetedRefs: (ModelSpec | string | undefined)[] = [];
    const unbudgeted = fabricFor({
      resolveModelClient: (ref) => {
        unbudgetedRefs.push(ref);
        return client;
      },
    });
    assert.equal((await unbudgeted.fabric.consolidate(unbudgeted.session)).report?.written, 1);
    assert.deepEqual(unbudgetedRefs, [undefined], "no budget means the host's client, resolved once and untouched");
  });

  it("thinking_level_reaches_worker_loop", async () => {
    const seen = { options: [] as ProviderRequestOptions[], prompts: [] as string[] };
    const client = extractorClient(
      () => [providerToolCall(toolCallContent("n1", "record_notes", { notes: [NOTE] })), providerDone()],
      seen,
    );
    const h = fabricFor({
      promote: resolvePromoteConfig({ minTurnsBetween: 1, thinkingLevel: "low" }),
      resolveModelClient: () => client,
    });
    await h.fabric.consolidate(h.session);
    assert.equal((seen.options.at(-1)?.compat as Record<string, unknown> | undefined)?.reasoning_effort, "low");
  });

  it("truncated_answer_is_repaired_once_with_fewer_notes", async () => {
    const seen = { options: [] as ProviderRequestOptions[], prompts: [] as string[] };
    // First call stops on the output limit before any tool call; the repair succeeds.
    const client = extractorClient(
      (call) =>
        call === 1
          ? [providerDone(undefined, "max_output_tokens")]
          : [providerToolCall(toolCallContent("n2", "record_notes", { notes: [NOTE] })), providerDone()],
      seen,
    );
    const h = fabricFor({ resolveModelClient: () => client });
    const result = await h.fabric.consolidate(h.session);
    assert.equal(result.ran, true);
    assert.equal(result.report?.modelCalls, 2);
    assert.equal(result.report?.correctionCalls, 1);
    assert.equal(result.report?.outputLimited, 1, "the truncated call is counted");
    assert.equal(result.report?.written, 1);
    assert.match(seen.prompts[1]!, /hit the output limit/);
    assert.match(seen.prompts[1]!, /fewer, shorter notes/);
    assert.match(seen.prompts[1]!, /same shown evidence/);
  });

  it("second_truncation_fails_with_output_truncated", async () => {
    const client = extractorClient(() => [providerDone(undefined, "max_output_tokens")]);
    const h = fabricFor({ resolveModelClient: () => client });
    const result = await h.fabric.consolidate(h.session);
    assert.equal(result.ran, false);
    assert.equal(result.reason, "failed");
    assert.equal(result.reasonCode, "output_truncated");
    assert.equal(result.report?.modelCalls, 2, "one repair call, then fail closed");
    assert.deepEqual(result.report?.failures, { output_truncated: 1 });
    assert.equal(result.report?.written, 0);
    assert.equal((await h.fabric.recall(NOTE.text, { minSimilarity: 0 })).hits.length, 0, "no partial write");
  });

  it("consolidation_report_counts_failures_by_reason", async () => {
    const { fabric, session } = fabricFor({
      resolveModelClient: () =>
        extractorClient(() => [providerToolCall(toolCallContent("n1", "record_notes", { notes: [{ ...NOTE, kind: "bogus" }] }))]),
    });
    const failed = await fabric.consolidate(session);
    assert.deepEqual(failed.report?.failures, { note_kind: 1 });
    // The tally is a fail-closed pass-through: `memory:status` reads it back unchanged.
    const state = readPromoteState({ refused: 0, last: failed.report });
    assert.deepEqual(state.last?.failures, { note_kind: 1 });
    assert.equal(state.last?.at, failed.report?.at);
    // A tally naming an unknown code, or a count that is not positive, is dropped, not trusted.
    const unknown = readPromoteState({ refused: 0, last: { ...failed.report, failures: { invented: 1 } } });
    assert.equal(unknown.last?.failures, undefined);
    assert.equal(unknown.last?.at, failed.report?.at, "the rest of the report survives a malformed tally");
    assert.equal(readPromoteState({ refused: 0, last: { ...failed.report, failures: { note_kind: 0 } } }).last?.failures, undefined);
  });

  it("promote_schema_rejects_out_of_range_budget", () => {
    const schema = memoryFabricPromoteSchema as unknown as JsonSchema;
    for (const maxOutputTokens of [0, 255, 32_769, 8192.5]) {
      assert.equal(validateJsonSchema(schema, { maxOutputTokens }).ok, false, "the schema bounds the budget");
      assert.throws(() => resolvePromoteConfig({ maxOutputTokens }), /promote.maxOutputTokens/);
    }
    assert.equal(validateJsonSchema(schema, { thinkingLevel: "very-high" }).ok, false, "an unknown level is a config error");
    assert.throws(() => resolvePromoteConfig({ thinkingLevel: "very-high" }), /promote.thinkingLevel/);
    assert.deepEqual(
      { ...resolvePromoteConfig({ maxOutputTokens: 4096, thinkingLevel: "low" }) },
      {
        enabled: true,
        minScore: 0.5,
        maxCandidates: 48,
        minTurnsBetween: 8,
        derivableFrom: ["AGENTS.md", "README.md", "package.json", "CLAUDE.md"],
        maxOutputTokens: 4096,
        thinkingLevel: "low",
      },
    );
  });

  /**
   * The overhead breakdown (plan 188.10 Task 5): the bounded parts are pinned here so a later prompt
   * growth of the harness — not of the session's own input — is visible as a failing test.
   *
   * Measured on 5 development multi-session haystacks with the real prompt builder (2026-10-23):
   * system 3,464 B, schema 1,785 B, candidates 39,179 B, existing ~2 B (empty store), segments ~2 B;
   * and in the worst case the constants allow (48 existing notes at the 240-character cap, one
   * segment): system 3,464, schema 2,156, existing 13,383, candidates 39,179, segments 437. The
   * session's candidates dominate (88% of the empty-store prompt), the harness parts are 4.8–19.0 kB,
   * no part is unbounded, and no trim is justified by that breakdown. Task 6's instance, key and
   * keyword rules grew the system part by 619 B (≈155 tokens), inside its 250-token budget. Plan 207 Task 3's optional
   * `subject` field grew the schema by 43 B (≈11 tokens); the system part is unchanged and the subject list itself
   * travels in the per-call prompt only when an ontology has subjects.
   */
  it("extractor_prompt_size_breakdown_matches_fixture", () => {
    const candidates = Array.from({ length: 3 }, (_, index) => ({
      source: "exchange" as const,
      text: `exchange ${index + 1}`,
      evidenceIds: [`x${index}`],
      signals: {},
    }));
    const existing = [{ id: "a1", scope: "project" as const, text: "Existing note." }];
    const segments = [{ id: "s1", goal: "Ship the extractor budget.", decision: "Cap at the model limit." }];
    const prompt = buildConsolidationExtractPrompt({ candidates, existing, segments, maxNotes: 48 });
    const schema = consolidationExtractSchema({ maxNotes: 48 });
    const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
    assert.deepEqual(
      {
        system: bytes(CONSOLIDATION_EXTRACT_SYSTEM),
        schema: bytes(schema),
        existing: bytes(prompt.existing),
        candidates: bytes(prompt.candidates),
        segments: bytes(prompt.segments),
      },
      { system: 3464, schema: 1610, existing: 55, candidates: 196, segments: 86 },
    );
  });
});
