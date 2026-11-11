/**
 * Plan 188.5 Task 2: a path-scoped note is shown once, in the tail, when a file tool touches a file
 * its `applies_to` globs match. It makes no model call and a turn with no new path does no work.
 */

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { ContextDraft, HookContext, SessionEntry } from "@arnilo/prism";
import { createMemoryVectorStore, type VectorStore } from "@arnilo/prism-memory-system/core";
import type { MemoryFabricInjectConfig } from "../../config.js";
import { createFabricCitationTracker, createFabricContext } from "../../context.js";
import { createMemory, createLongTermMemory } from "../../../index.js";
import { type MemoryNoteHit, type MemoryNoteMetadata } from "../../types.js";
import { createFabricRules, type ResolvedFabricRulesOptions, resolveFabricRulesOptions } from "../rules.js";
import {
  createFabricCues,
  type FabricCueSessionState,
  type FabricCues,
  type MemoryFabricCuesConfig,
  resolveFabricCuesOptions,
} from "../cues.js";

const TENANT = "t";
const PROJECT = "projects/prism--11111111";
const GLOB = "packages/memory/**";
const FILE = "packages/memory/fabric/src/index.ts";

const draft: ContextDraft = { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };

const user = (id: string): SessionEntry => ({
  id,
  sessionId: "s",
  kind: "message",
  timestamp: "2026-10-17T12:00:00Z",
  message: { role: "user", content: [{ type: "text", text: "question" }] },
});

/** Storage strength from an explicit promotion signal, so S ordering is testable without a clock. */
const explicit = (value: number): MemoryNoteMetadata["promotion"] => ({ score: 0.9, signals: { explicit: value, outcome: 0 }, pass: "p1" });

interface HarnessOptions {
  readonly cues?: false | MemoryFabricCuesConfig;
  readonly inject?: false | MemoryFabricInjectConfig;
  readonly recall?: (query: string) => Promise<{ hits: readonly MemoryNoteHit[]; explain: readonly never[] }>;
  readonly rules?: boolean;
}

function sessionState(): FabricCueSessionState & { peek(): unknown } {
  let value: unknown;
  return {
    get: () => value,
    async set(_session, next) {
      value = next;
    },
    peek: () => value,
  };
}

function harness(input: HarnessOptions = {}) {
  const vectorStore: VectorStore = createMemoryVectorStore();
  const project = createMemory({ tenantId: TENANT, resourceId: PROJECT, threadId: "default", vectorStore });
  const fabric = createLongTermMemory({ memory: project, consolidate: false });
  const state = sessionState();
  const resolved = resolveFabricCuesOptions(input.cues ?? true, true);
  let scans = 0;
  const scanMetadata = vectorStore.scanMetadata!.bind(vectorStore);
  const makeCues = (): FabricCues | undefined =>
    resolved === false
      ? undefined
      : createFabricCues({
          memory: project,
          options: resolved,
          scanMetadata: (query) => {
            scans += 1;
            return scanMetadata(query);
          },
          state,
          clock: () => 0,
        });
  const cues = makeCues();
  const core =
    input.rules === true
      ? createFabricRules({
          scopes: [{ level: "project", memory: project }],
          options: resolveFabricRulesOptions({ maxTokens: 20 }, true) as ResolvedFabricRulesOptions,
          scanMetadata: (query) => {
            scans += 1;
            return scanMetadata(query);
          },
        })
      : undefined;
  let entries: SessionEntry[] = [user("u1")];
  const context = {
    runId: "",
    sessionId: "s",
    session: { id: "s", entries: async () => entries },
    emit() {},
    reject() {},
  } as unknown as HookContext;
  const tracker = createFabricCitationTracker();
  const touched: string[] = [];
  let touchedCalls = 0;
  const makeProjection = (handle: FabricCues | undefined = cues) =>
    createFabricContext(
      project,
      input.recall ?? fabric.recall,
      input.inject ?? false,
      {},
      undefined,
      tracker,
      () => {
        touchedCalls += 1;
        return touched;
      },
      core,
      handle,
    );
  return {
    project,
    fabric,
    vectorStore,
    state,
    makeCues,
    coreHandle: core,
    makeProjection,
    projection: makeProjection(),
    tracker,
    context,
    touched,
    setEntries(next: SessionEntry[]) {
      entries = next;
    },
    scans: () => scans,
    touchedCalls: () => touchedCalls,
    rememberPath(
      content: string,
      options: {
        kind?: "fact" | "file";
        path?: string;
        glob?: string;
        promotion?: MemoryNoteMetadata["promotion"];
        status?: "candidate";
      } = {},
    ) {
      return fabric.remember(
        {
          kind: options.kind ?? "fact",
          content,
          scope: "path",
          appliesTo: [options.glob ?? GLOB],
          ...(options.path === undefined ? {} : { path: options.path }),
          ...(options.promotion === undefined ? {} : { promotion: options.promotion }),
        },
        options.status === undefined ? {} : { status: options.status },
      );
    },
  };
}

/** The fabric tail block a build produced, its text, and the ids it says it shows. */
function tail(built: ContextDraft): { text: string; ids: readonly string[]; blocks: readonly { itemIds?: readonly string[] }[] } {
  const carrying = built.messages.filter((message) => Array.isArray(message.metadata?.contextBlocks));
  // `withTailContext` flattens each block's metadata into the carried entry, so `itemIds` is a top-level field there.
  const blocks = carrying.flatMap((message) => (message.metadata!.contextBlocks ?? []) as readonly { itemIds?: readonly string[] }[]);
  const ids = blocks.flatMap((block) => (Array.isArray(block.itemIds) ? (block.itemIds as string[]) : []));
  return { text: JSON.stringify(carrying), ids, blocks };
}

describe("path cues (plan 188.5 Task 2)", () => {
  it("reading_matching_path_injects_path_note_once_per_session", async () => {
    const h = harness();
    const note = await h.rememberPath("run memory suites with --timeout=0");
    h.touched.push(FILE);
    const first = await h.projection.build(draft, h.context);
    assert.match(tail(first).text, new RegExp(`\\[${note.id}\\] path fact \\(for packages/memory/\\*\\*\\) run memory suites`));
    const afterToolRound = await h.projection.build(
      { messages: [...draft.messages, { role: "assistant", content: [{ type: "text", text: "reading" }] }] },
      h.context,
    );
    assert.equal(tail(afterToolRound).text, tail(first).text, "a rebuild of the same turn is identical");
    h.setEntries([user("u2")]);
    const nextTurn = await h.projection.build(draft, h.context);
    assert.doesNotMatch(tail(nextTurn).text, new RegExp(note.id), "a cue shows once per session");
    assert.equal(h.scans(), 1, "one metadata scan for the session");
  });

  it("non_matching_or_outside_root_path_injects_nothing", async () => {
    const h = harness();
    const note = await h.rememberPath("run memory suites");
    h.touched.push("apps/web/src/page.ts", "/etc/passwd", "../outside.ts", "packages\\memory\\x.ts");
    const built = await h.projection.build(draft, h.context);
    assert.equal(tail(built).blocks.length, 0);
    assert.doesNotMatch(tail(built).text, new RegExp(note.id));
  });

  it("cue_dedups_against_topic_inject_and_visible_read_and_path_rules_stay_out_of_the_block", async () => {
    const core = harness({ inject: { topK: 3, budgetTokens: 1200 }, rules: true });
    const strong = await core.rememberPath("strong note", { promotion: explicit(1) });
    const topic = await core.rememberPath("topic note");
    const visible = await core.rememberPath("read note", { kind: "file", path: FILE });
    const cue = await core.rememberPath(`cue note ${"x".repeat(200)}`, { glob: "packages/memory/fabric/**" });
    core.touched.push(FILE);
    const readDraft: ContextDraft = {
      messages: [
        ...draft.messages,
        { role: "assistant", content: [{ type: "tool_call", id: "r1", name: "read", arguments: { path: FILE } }] },
        { role: "tool", content: [{ type: "tool_result", toolCallId: "r1", name: "read", result: { path: FILE, text: "file body" } }] },
      ],
    };
    const recallHit = (hit: MemoryNoteHit) => async () => ({ hits: [hit], explain: [] as never[] });
    const projection = createFabricContext(
      core.project,
      recallHit({ ...topic, score: 1 }),
      { topK: 3, budgetTokens: 1200 },
      {},
      undefined,
      core.tracker,
      () => core.touched,
      core.coreHandle,
      core.makeCues(),
    );
    const built = await projection.build(readDraft, core.context);
    const rendered = tail(built);
    // A path-scoped rule never rides in the always-loaded block (plan 209 Task 3): it loads as a cue when a
    // touched path matches. Topic injection shows B; the visible read hides C; A and D cue.
    assert.doesNotMatch(String(JSON.stringify(built.context)), new RegExp(strong.id), "a path rule is not in the rules block");
    assert.deepEqual([...rendered.ids].sort(), [strong.id, topic.id, cue.id].sort(), "the block shows the topic hit and the cues");
    assert.doesNotMatch(rendered.text, new RegExp(`\\[${visible.id}\\] path`), "text is in a visible read");
    assert.match(rendered.text, new RegExp(`\\[${cue.id}\\] path fact \\(for packages/memory/fabric/\\*\\*\\)`));
  });

  it("candidate_shows_only_when_no_verified_note_matches", async () => {
    const onlyCandidate = harness();
    const candidate = await onlyCandidate.rememberPath("candidate hint", { glob: "docs/**", status: "candidate" });
    onlyCandidate.touched.push("docs/guide.md");
    const marked = await onlyCandidate.projection.build(draft, onlyCandidate.context);
    assert.match(tail(marked).text, new RegExp(`\\[${candidate.id}\\] path fact \\(for docs/\\*\\*\\) \\(candidate\\) candidate hint`));

    const withVerified = harness();
    const weaker = await withVerified.rememberPath("candidate hint", { glob: "docs/**", status: "candidate" });
    const verified = await withVerified.rememberPath("verified hint", { glob: "docs/**" });
    withVerified.touched.push("docs/guide.md");
    const built = await withVerified.projection.build(draft, withVerified.context);
    assert.deepEqual(tail(built).ids, [verified.id], "a verified note covers the path, so the candidate is not shown");
    assert.doesNotMatch(tail(built).text, new RegExp(weaker.id));
  });

  it("cited_cue_counts_as_use", async () => {
    const h = harness();
    const note = await h.rememberPath("run memory suites");
    h.touched.push(FILE);
    await h.projection.build(draft, h.context);
    h.projection.observe({ type: "text", text: `used [${note.id}]` }, h.context);
    assert.deepEqual(h.projection.cited(h.context), [note.id]);
  });

  it("restore_does_not_reinject_cues", async () => {
    const h = harness();
    const note = await h.rememberPath("run memory suites");
    h.touched.push(FILE);
    const first = await h.projection.build(draft, h.context);
    assert.match(tail(first).text, new RegExp(note.id));
    assert.deepEqual(h.state.peek(), { injected: [note.id] });
    // A restored session keeps the persisted injected set but loses the in-memory path bookkeeping.
    const restored = createFabricContext(
      h.project,
      h.fabric.recall,
      false,
      {},
      undefined,
      h.tracker,
      () => h.touched,
      undefined,
      h.makeCues(),
    );
    const rebuilt = await restored.build(draft, h.context);
    assert.equal(tail(rebuilt).blocks.length, 0, "nothing is shown twice after a restore");
  });

  it("turn_without_new_path_does_no_work", async () => {
    const h = harness();
    await h.rememberPath("run memory suites");
    const empty = await h.projection.build(draft, h.context);
    assert.equal(h.scans(), 0, "no touched path, no scan");
    assert.equal(tail(empty).blocks.length, 0);
    h.touched.push("docs/readme.md");
    await h.projection.build(draft, h.context);
    assert.equal(h.scans(), 1);
    await h.projection.build(draft, h.context);
    assert.equal(h.scans(), 1, "the same path is not looked up twice");
  });

  it("cues_false_makes_no_query", async () => {
    const h = harness({ cues: false, inject: { topK: 3 } });
    h.touched.push(FILE);
    const built = await h.projection.build(draft, h.context);
    assert.equal(tail(built).blocks.length, 0);
    assert.equal(h.scans(), 0);
    assert.equal(resolveFabricCuesOptions(false, true), false);
    assert.throws(() => resolveFabricCuesOptions({ budgetTokens: 0 }, true), /cues\.budgetTokens/);
    assert.throws(() => resolveFabricCuesOptions({ maxPerTurn: 99 }, true), /cues\.maxPerTurn/);
  });
});
