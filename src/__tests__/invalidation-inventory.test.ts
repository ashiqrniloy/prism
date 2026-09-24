// Executable version of plan 088 Task 1's assembly invalidation inventory. One fixture per row
// that is not a plan-088 tail segment asserts the documented outcome *at the documented boundary*:
// the message index (and, for schemas, the tool index) where the leading byte-identical prefix
// ends — so a later change to the cache-aware layout fails here instead of silently relocating an
// invalidation boundary. The layout claims are owned by docs/input-and-prompt-assembly.md,
// docs/context-and-skills.md, and docs/provider-caching.md; the pinned table is in
// docs/prefix-stability-conformance.md. Fixtures call `assembleProviderInput` directly — no
// session, no provider, one assembly pair each (the injector rows vary the assembly `turn`).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AssembleProviderInputOptions,
  assembleProviderInput,
  type ContextBlock,
  type ContextProvider,
  getContextBudgetReport,
  type InstructionInjector,
  type Message,
  type ProviderRequest,
  type Skill,
  type ToolDefinition,
  type ToolResult,
} from "../index.js";

/** Tool-capable fixture model: schemas travel on `request.tools`, so messages stay schema-independent. */
const model = { provider: "mock", model: "demo", capabilities: { tools: true } } as const;

const textOf = (message: Message) => message.content.find((part) => part.type === "text")?.text;
/** Flattened text per message; a tool-result message has no text part and reads as `""`. */
const textsOf = (request: ProviderRequest) => request.messages.map((message) => textOf(message) ?? "");
const namesOf = (request: ProviderRequest) => (request.tools ?? []).map((tool) => tool.name);
const messagesOf = (request: ProviderRequest) => JSON.stringify(request.messages);

/** One JSON fragment per message and per tool schema — the shape the conformance runner measures. */
const fragments = (items: readonly unknown[]) => items.map((item) => JSON.stringify(item));
const schemaFragments = (request: ProviderRequest) =>
  fragments((request.tools ?? []).map(({ name, description, parameters }) => ({ name, description, parameters })));

/** Leading byte-identical fragments: also the index of the first fragment that differs. */
function sharedFragments(before: readonly string[], after: readonly string[]): number {
  let shared = 0;
  while (shared < before.length && shared < after.length && before[shared] === after[shared]) shared += 1;
  return shared;
}

/** Byte-shared prefix as a fraction of the earlier payload: a shrink is a cache miss. */
function sharedPrefixFraction(previous: string, next: string): number {
  const before = Buffer.from(previous, "utf8");
  const after = Buffer.from(next, "utf8");
  if (before.length === 0) return 1;
  const limit = Math.min(before.length, after.length);
  let shared = 0;
  while (shared < limit && before[shared] === after[shared]) shared += 1;
  return shared / before.length;
}

interface AssemblyPair {
  readonly before: ProviderRequest;
  readonly after: ProviderRequest;
  /**
   * Longest common prefix of the serialized payload, reported per region as the index of the first
   * fragment that differs. `boundary.messageIndex === before.messages.length` means the later
   * assembly kept every earlier message byte-identical (a pure append or an identical re-render);
   * a smaller index is the message where the invalidation starts. Same reading for `toolIndex`:
   * `=== before.tools.length` means no selected schema was invalidated.
   */
  readonly boundary: { readonly messageIndex: number; readonly toolIndex: number };
  /** Shared byte fraction of the earlier request, computed exactly like the conformance runner. */
  readonly continuity: number;
}

/**
 * Assemble one pair of provider inputs and report where they diverge: the longest common prefix of
 * the serialized payload as the first differing message and tool schema, plus the byte-shared
 * fraction. One JSON fragment per message and per schema keeps a structural array boundary from
 * reading as a divergence, so an appended list stays an exact prefix.
 */
async function assembleTwice(before: AssembleProviderInputOptions, after: AssembleProviderInputOptions): Promise<AssemblyPair> {
  const first = await assembleProviderInput(before);
  const second = await assembleProviderInput(after);
  const beforeSchemas = schemaFragments(first);
  const afterSchemas = schemaFragments(second);
  const beforeMessages = fragments(first.messages);
  const afterMessages = fragments(second.messages);
  return {
    before: first,
    after: second,
    boundary: {
      messageIndex: sharedFragments(beforeMessages, afterMessages),
      toolIndex: sharedFragments(beforeSchemas, afterSchemas),
    },
    continuity: sharedPrefixFraction([...beforeSchemas, ...beforeMessages].join("\n"), [...afterSchemas, ...afterMessages].join("\n")),
  };
}

const hUser: Message = { role: "user", content: [{ type: "text", text: "h1" }] };
const hAssistant: Message = { role: "assistant", content: [{ type: "text", text: "h2" }] };
const pendingResult: ToolResult = { toolCallId: "c1", name: "echo", content: [{ type: "text", text: "tool out" }] };
const briefSkill: Skill = { name: "brief", description: "Be brief", instructions: "Full body" };
const hostContext: ContextProvider = { name: "project", resolve: () => [{ title: "Project", content: "stable" }] };

type InputLayoutName = "cache_aware" | "legacy";

/**
 * The injector-context fixture, shared by the shipped `cache_aware` row and the Task 6 layout
 * parity rows: the same builder produces both layouts, so the two expectations cannot drift.
 */
const contextBlockInjector = (blocks: readonly ContextBlock[] | undefined): InstructionInjector => ({
  name: "now",
  apply: () => ({ contextBlocks: blocks, when: "every_turn" }),
});

const contextSlotAssembly = (blocks?: readonly ContextBlock[], layout: InputLayoutName = "cache_aware"): AssembleProviderInputOptions => ({
  model,
  systemInstructions: "Base rules.",
  contextProviders: [hostContext],
  instructionInjectors: [contextBlockInjector(blocks)],
  skills: [briefSkill],
  skillsDisclosure: "progressive",
  input: "Ask",
  inputLayout: layout,
});

const nowBlock: ContextBlock = { title: "Now", content: "turn two" };

/** Summary fixture with context and a skill, where the hoist difference between layouts is visible. */
const summaryWithContextAssembly = (summary: string, layout: InputLayoutName): AssembleProviderInputOptions => ({
  model,
  systemInstructions: "Base rules.",
  summaries: [summary],
  history: [hUser, hAssistant],
  contextProviders: [hostContext],
  skills: [briefSkill],
  skillsDisclosure: "progressive",
  input: "Ask B",
  inputLayout: layout,
});

describe("invalidation inventory (plan 088 Task 1)", () => {
  it("stable rows: base instructions plus ordinary transcript growth keep the prefix at 1", async () => {
    const askB: Message = { role: "user", content: [{ type: "text", text: "Ask B" }] };
    const replyB: Message = { role: "assistant", content: [{ type: "text", text: "Reply B" }] };
    const first: AssembleProviderInputOptions = {
      model,
      systemInstructions: "Base rules.",
      summaries: ["Summary"],
      history: [hUser, hAssistant],
      input: "Ask B",
    };

    const grown = await assembleTwice(first, { ...first, history: [hUser, hAssistant, askB, replyB], input: "Ask C" });
    assert.equal(grown.continuity, 1, "an appended turn keeps 100% of the provider-visible prefix");
    assert.equal(grown.boundary.messageIndex, grown.before.messages.length, "every earlier message was kept byte-identical");
    assert.deepEqual(textsOf(grown.before), ["System instruction:\nBase rules.", "Summary:\nSummary", "h1", "h2", "Ask B"]);
    assert.deepEqual(textsOf(grown.after).slice(0, grown.before.messages.length), textsOf(grown.before));

    // Pending tool results are the suffix: a result lands immediately before the current input, so
    // the boundary is that input (re-sent for this round), not the transcript before it.
    const pending = await assembleTwice({ ...first, toolResults: [] }, { ...first, toolResults: [pendingResult] });
    assert.equal(pending.boundary.messageIndex, pending.before.messages.length - 1, "the result inserts right before the current input");
    assert.equal(pending.after.messages.at(-2)?.role, "tool");
    assert.equal(pending.after.messages.at(-1)?.role, "user");
    assert.equal(textsOf(pending.after).at(-1), "Ask B");
  });

  it("per-turn instruction-injector text: a changed leading system prompt is the boundary", async () => {
    // `when: "on_input"` with a turn predicate: turn 1 contributes nothing, turn 2+ contributes text.
    const turnRules: InstructionInjector = {
      name: "turn-rules",
      apply: (ctx) => ({ instructions: `Turn ${ctx.turn} rules.`, when: "on_input", predicate: (context) => context.turn >= 2 }),
    };
    const leadingPromptAssembly = (turn: number): AssembleProviderInputOptions => ({
      model,
      systemInstructions: "Base rules.",
      instructionInjectors: [turnRules],
      turn,
      input: "Ask",
    });

    const appeared = await assembleTwice(leadingPromptAssembly(1), leadingPromptAssembly(2));
    assert.equal(appeared.boundary.messageIndex, 0, "injector instructions merge into the leading system prompt");
    const leadingBefore = textsOf(appeared.before)[0] ?? "";
    const leadingAfter = textsOf(appeared.after)[0] ?? "";
    assert.equal(leadingBefore, "System instruction:\nBase rules.");
    assert.equal(leadingAfter, "System instruction:\nBase rules.\n\nTurn 2 rules.");
    assert.ok(leadingAfter.startsWith(leadingBefore), "the base prompt bytes survive: only the appended injector layer differs");
    assert.ok(appeared.continuity < 1, "a changed injector layer invalidates the leading message rather than appending to the prompt");

    const changed = await assembleTwice(leadingPromptAssembly(2), leadingPromptAssembly(3));
    assert.equal(changed.boundary.messageIndex, 0, "turn-dependent text keeps the same boundary");
    assert.match(
      textsOf(changed.after)[0] ?? "",
      /Turn 3 rules\.$/,
      "the injector layer stays inside the leading system prompt, never behind the transcript",
    );
  });

  it("injector context blocks: appearing or vanishing resets at the injector context position", async () => {
    const appeared = await assembleTwice(contextSlotAssembly(), contextSlotAssembly([nowBlock]));
    assert.equal(appeared.boundary.messageIndex, 2, "after the hoisted system prompt (0) and host context (1), before skills (3)");
    assert.deepEqual(textsOf(appeared.before), ["System instruction:\nBase rules.", "Project:\nstable", "Skill brief: Be brief", "Ask"]);
    assert.deepEqual(textsOf(appeared.after), [
      "System instruction:\nBase rules.",
      "Project:\nstable",
      "Now:\nturn two",
      "Skill brief: Be brief",
      "Ask",
    ]);

    const vanished = await assembleTwice(contextSlotAssembly([nowBlock]), contextSlotAssembly());
    assert.equal(vanished.boundary.messageIndex, 2, "vanishing blocks reset the same position: nothing before it moved");
    assert.deepEqual(textsOf(vanished.after), textsOf(appeared.before));
  });

  it("layout parity: the injector-context boundary moves from 2 (cache_aware) to 1 (legacy)", async () => {
    const cacheAware = await assembleTwice(contextSlotAssembly(undefined, "cache_aware"), contextSlotAssembly([nowBlock], "cache_aware"));
    const legacy = await assembleTwice(contextSlotAssembly(undefined, "legacy"), contextSlotAssembly([nowBlock], "legacy"));

    assert.equal(
      cacheAware.boundary.messageIndex,
      2,
      "cache_aware keeps the leading system prompt and host context ahead of the injector block",
    );
    assert.equal(legacy.boundary.messageIndex, 1, "legacy leads with the context/skill slots; the host context at 0 survives");
    assert.notEqual(cacheAware.boundary.messageIndex, legacy.boundary.messageIndex, "the layout switch alone moves the boundary");
    assert.deepEqual(textsOf(cacheAware.before), ["System instruction:\nBase rules.", "Project:\nstable", "Skill brief: Be brief", "Ask"]);
    assert.deepEqual(textsOf(legacy.before), ["Project:\nstable", "Skill brief: Be brief", "System instruction:\nBase rules.", "Ask"]);
    assert.deepEqual(textsOf(cacheAware.after).slice(0, 4), [
      "System instruction:\nBase rules.",
      "Project:\nstable",
      "Now:\nturn two",
      "Skill brief: Be brief",
    ]);
    assert.deepEqual(textsOf(legacy.after).slice(0, 4), [
      "Project:\nstable",
      "Now:\nturn two",
      "Skill brief: Be brief",
      "System instruction:\nBase rules.",
    ]);
    assert.ok(cacheAware.continuity < 1 && legacy.continuity < 1, "the appearing injector block invalidates both layouts");
  });

  it("layout parity: the hoisted summary moves from 1 (cache_aware) to 3 (legacy) once context and a skill lead", async () => {
    const cacheAware = await assembleTwice(
      summaryWithContextAssembly("Summary one", "cache_aware"),
      summaryWithContextAssembly("Summary two", "cache_aware"),
    );
    const legacy = await assembleTwice(
      summaryWithContextAssembly("Summary one", "legacy"),
      summaryWithContextAssembly("Summary two", "legacy"),
    );

    assert.equal(cacheAware.boundary.messageIndex, 1, "cache_aware hoists the summary right after the leading system prompt");
    assert.equal(legacy.boundary.messageIndex, 3, "legacy puts context, skill, and the system prompt ahead of the summary");
    assert.notEqual(cacheAware.boundary.messageIndex, legacy.boundary.messageIndex, "the layout switch alone moves the boundary");
    assert.deepEqual(textsOf(cacheAware.before).slice(0, 4), [
      "System instruction:\nBase rules.",
      "Summary:\nSummary one",
      "Project:\nstable",
      "Skill brief: Be brief",
    ]);
    assert.deepEqual(textsOf(legacy.before).slice(0, 4), [
      "Project:\nstable",
      "Skill brief: Be brief",
      "System instruction:\nBase rules.",
      "Summary:\nSummary one",
    ]);
    assert.deepEqual(
      textsOf(legacy.after).slice(0, 3),
      textsOf(legacy.before).slice(0, 3),
      "everything before the summary is byte-identical",
    );
    assert.ok(cacheAware.continuity < 1 && legacy.continuity < 1);
  });

  it("observational-memory blocks: recompose-changed resets at the early context position, recompose-equal is byte-identical", async () => {
    const observationalMemory = (version: string): ContextProvider => ({
      name: "observational-memory",
      resolve: () => [
        { title: "observational-memory", content: `observation ${version}` },
        { title: "recent-messages", content: `recent window ${version}` },
      ],
    });
    // Host provider first, OM provider second: the OM blocks occupy the same context slot the
    // injector row pins (index 2), before the skill catalog.
    const memoryAssembly = (version: string): AssembleProviderInputOptions => ({
      model,
      systemInstructions: "Base rules.",
      contextProviders: [hostContext, observationalMemory(version)],
      skills: [briefSkill],
      skillsDisclosure: "progressive",
      input: "Ask",
    });

    const changed = await assembleTwice(memoryAssembly("v1"), memoryAssembly("v2"));
    assert.equal(changed.boundary.messageIndex, 2, "the first OM block is the boundary; the leading prompt and host context are untouched");
    assert.deepEqual(textsOf(changed.before), [
      "System instruction:\nBase rules.",
      "Project:\nstable",
      "observational-memory:\nobservation v1",
      "recent-messages:\nrecent window v1",
      "Skill brief: Be brief",
      "Ask",
    ]);
    assert.deepEqual(
      textsOf(changed.after).slice(2, 4),
      ["observational-memory:\nobservation v2", "recent-messages:\nrecent window v2"],
      "a moved window or a dropped observation rewrites both OM blocks",
    );
    assert.ok(changed.continuity < 1);

    const identical = await assembleTwice(memoryAssembly("v1"), memoryAssembly("v1"));
    assert.equal(identical.continuity, 1, "re-rendering the identical blocks keeps the prefix byte-identical");
    assert.equal(identical.boundary.messageIndex, identical.before.messages.length, "no message was invalidated");
  });

  it("compaction summaries: a replaced summary resets at the summary position, growth does not", async () => {
    const askB: Message = { role: "user", content: [{ type: "text", text: "Ask B" }] };
    const replyB: Message = { role: "assistant", content: [{ type: "text", text: "Reply B" }] };
    const summaryAssembly = (summary: string): AssembleProviderInputOptions => ({
      model,
      systemInstructions: "Base rules.",
      summaries: [summary],
      history: [hUser, hAssistant],
      input: "Ask B",
    });

    const replaced = await assembleTwice(summaryAssembly("Summary one"), summaryAssembly("Summary two"));
    assert.equal(
      replaced.boundary.messageIndex,
      1,
      "with no leading attachment the summary is hoisted: it is the boundary, right after the system prompt",
    );
    assert.deepEqual(textsOf(replaced.before), ["System instruction:\nBase rules.", "Summary:\nSummary one", "h1", "h2", "Ask B"]);
    assert.deepEqual(textsOf(replaced.after), ["System instruction:\nBase rules.", "Summary:\nSummary two", "h1", "h2", "Ask B"]);

    const grown = await assembleTwice(summaryAssembly("Summary one"), {
      ...summaryAssembly("Summary one"),
      history: [hUser, hAssistant, askB, replyB],
      input: "Ask C",
    });
    assert.equal(grown.continuity, 1, "an appended user message keeps the earlier bytes intact, summary included");
    assert.equal(grown.boundary.messageIndex, grown.before.messages.length);
    assert.equal(textsOf(grown.before)[1], "Summary:\nSummary one");

    // The hoist boundary is role-sensitive: a leading user attachment moves the summary behind
    // context/skills, so adding one changes this boundary too (documented in the layout table).
    const attached = await assembleTwice(summaryAssembly("Summary one"), {
      ...summaryAssembly("Summary one"),
      attachments: [{ name: "notes.md", text: "attached" }],
    });
    assert.equal(attached.boundary.messageIndex, 1, "the attachment lands where the summary used to sit");
    assert.deepEqual(textsOf(attached.after), [
      "System instruction:\nBase rules.",
      "Attachment notes.md:\nattached",
      "Summary:\nSummary one",
      "h1",
      "h2",
      "Ask B",
    ]);
  });

  it("context-budget eviction: the reset starts at the first evicted group, earlier bytes identical", async () => {
    const host: AssembleProviderInputOptions = {
      model,
      systemInstructions: "Base rules.",
      summaries: ["Summary"],
      history: [hUser, hAssistant],
      toolResults: [pendingResult],
      input: "Ask",
    };
    const calibrated = await assembleProviderInput({ ...host, contextBudget: { maxInputBytes: 1_000_000, reportOmissions: true } });
    const report = getContextBudgetReport(calibrated);
    assert.ok(report, "reportOmissions attaches the eviction report");
    assert.equal(report.omitted.length, 0, "the calibration cap keeps everything");
    assert.deepEqual(textsOf(calibrated), ["System instruction:\nBase rules.", "Summary:\nSummary", "h1", "h2", "", "Ask"]);

    // One byte below the measured cost is the smallest cap that evicts, so exactly one group drops.
    const one = await assembleTwice(
      { ...host, contextBudget: { maxInputBytes: report.keptBytes } },
      { ...host, contextBudget: { maxInputBytes: report.keptBytes - 1, reportOmissions: true } },
    );
    const oneReport = getContextBudgetReport(one.after);
    assert.deepEqual(
      oneReport?.omitted.map((omission) => [omission.kind, omission.id]),
      [["tool_results", "c1"]],
      "tool results drop first",
    );
    assert.equal(one.boundary.messageIndex, 4, "the evicted tool result was message 4; every earlier byte is identical");
    assert.deepEqual(textsOf(one.after), ["System instruction:\nBase rules.", "Summary:\nSummary", "h1", "h2", "Ask"]);
    assert.ok(one.continuity < 1);

    // One byte below what the first eviction itself was worth forces the next group in order.
    const oneByteLength = oneReport?.omitted[0]?.byteLength ?? 0;
    const two = await assembleTwice(
      { ...host, contextBudget: { maxInputBytes: report.keptBytes } },
      { ...host, contextBudget: { maxInputBytes: report.keptBytes - oneByteLength - 1, reportOmissions: true } },
    );
    const twoReport = getContextBudgetReport(two.after);
    assert.deepEqual(
      twoReport?.omitted.map((omission) => [omission.kind, omission.id]),
      [
        ["tool_results", "c1"],
        ["history", undefined],
      ],
      "history drops oldest-first after tool results",
    );
    assert.equal(two.boundary.messageIndex, 2, "with two groups evicted the boundary is the earlier one: the first history message");
    assert.deepEqual(textsOf(two.after), ["System instruction:\nBase rules.", "Summary:\nSummary", "h2", "Ask"]);
  });

  it("context eviction: the lowest-priority block is the boundary, higher-priority bytes survive", async () => {
    const low = "l".repeat(120);
    const high = "h".repeat(120);
    const host: AssembleProviderInputOptions = {
      model,
      systemInstructions: "Base rules.",
      contextProviders: [
        {
          name: "priority",
          resolve: () => [
            { id: "low", title: "Low", content: low, priority: 0 },
            { id: "high", title: "High", content: high, priority: 100 },
          ],
        },
      ],
      input: "Ask",
    };
    const calibrated = await assembleProviderInput({ ...host, contextBudget: { maxInputBytes: 1_000_000, reportOmissions: true } });
    const report = getContextBudgetReport(calibrated);
    assert.ok(report, "reportOmissions attaches the eviction report");
    assert.equal(report.omitted.length, 0, "the calibration cap keeps everything");
    assert.deepEqual(textsOf(calibrated), ["System instruction:\nBase rules.", `Low:\n${low}`, `High:\n${high}`, "Ask"]);

    // One byte below the measured cost drops exactly the lowest-priority block.
    const evicted = await assembleTwice(
      { ...host, contextBudget: { maxInputBytes: report.keptBytes } },
      { ...host, contextBudget: { maxInputBytes: report.keptBytes - 1, reportOmissions: true } },
    );
    const evictedReport = getContextBudgetReport(evicted.after);
    assert.deepEqual(
      evictedReport?.omitted.map((row) => [row.kind, row.id]),
      [["context", "low"]],
      "the lower-priority block drops first",
    );
    assert.equal(evicted.boundary.messageIndex, 1, "the low block was message 1; the high block's bytes survive at message 2");
    assert.deepEqual(textsOf(evicted.after), ["System instruction:\nBase rules.", `High:\n${high}`, "Ask"]);
    assert.ok(evicted.continuity < 1);
  });

  it("skills eviction: the skill body demotes to its catalog form at the catalog message index", async () => {
    const body = "i".repeat(400);
    const catalogText = "Skill big: short desc";
    const host: AssembleProviderInputOptions = {
      model,
      systemInstructions: "Base rules.",
      skills: [{ name: "big", description: "short desc", instructions: body }],
      skillsDisclosure: "eager",
      input: "Ask",
    };
    const calibrated = await assembleProviderInput({ ...host, contextBudget: { maxInputBytes: 1_000_000, reportOmissions: true } });
    const report = getContextBudgetReport(calibrated);
    assert.ok(report, "reportOmissions attaches the eviction report");
    assert.equal(report.omitted.length, 0, "the calibration cap keeps everything");
    assert.equal(textsOf(calibrated)[1], `Skill big:\n${body}`, "the eager body renders inline before any budget pressure");

    // One byte below the measured cost demotes the body instead of dropping the catalog row.
    const evicted = await assembleTwice(
      { ...host, contextBudget: { maxInputBytes: report.keptBytes } },
      { ...host, contextBudget: { maxInputBytes: report.keptBytes - 1, reportOmissions: true } },
    );
    const evictedReport = getContextBudgetReport(evicted.after);
    assert.deepEqual(
      evictedReport?.omitted.map((row) => [row.kind, row.id]),
      [["skill_body", "big"]],
      "the body demotes before a full skill drop",
    );
    assert.equal(evicted.boundary.messageIndex, 1, "the catalog message is 1; name and description bytes survive");
    assert.equal(textsOf(evicted.after)[1], catalogText);
    assert.ok(evicted.continuity < 1);
  });

  it("attachments eviction: the newest attachment drops first, older bytes survive", async () => {
    const host: AssembleProviderInputOptions = {
      model,
      systemInstructions: "Base rules.",
      attachments: [
        { name: "older.md", text: "older attachment" },
        { name: "newer.md", text: "newer attachment" },
      ],
      input: "Ask",
    };
    const calibrated = await assembleProviderInput({ ...host, contextBudget: { maxInputBytes: 1_000_000, reportOmissions: true } });
    const report = getContextBudgetReport(calibrated);
    assert.ok(report, "reportOmissions attaches the eviction report");
    assert.equal(report.omitted.length, 0, "the calibration cap keeps everything");
    assert.deepEqual(textsOf(calibrated), [
      "System instruction:\nBase rules.",
      "Attachment older.md:\nolder attachment",
      "Attachment newer.md:\nnewer attachment",
      "Ask",
    ]);

    // One byte below the measured cost pops the newest attachment (LIFO).
    const evicted = await assembleTwice(
      { ...host, contextBudget: { maxInputBytes: report.keptBytes } },
      { ...host, contextBudget: { maxInputBytes: report.keptBytes - 1, reportOmissions: true } },
    );
    const evictedReport = getContextBudgetReport(evicted.after);
    assert.deepEqual(
      evictedReport?.omitted.map((row) => [row.kind, row.id]),
      [["attachments", undefined]],
      "attachments drop LIFO",
    );
    assert.equal(evicted.boundary.messageIndex, 2, "the newer attachment was message 2; the older bytes survive at message 1");
    assert.deepEqual(textsOf(evicted.after), ["System instruction:\nBase rules.", "Attachment older.md:\nolder attachment", "Ask"]);
    assert.ok(evicted.continuity < 1);
  });

  it("tool-schema selection: gaining or losing a schema never touches the message prefix", async () => {
    const echo: ToolDefinition = { name: "echo", description: "Echo the value", execute: () => ({ toolCallId: "c", name: "echo" }) };
    const lookup: ToolDefinition = {
      name: "lookup",
      description: "Look something up",
      execute: () => ({ toolCallId: "c", name: "lookup" }),
    };
    const zap: ToolDefinition = { name: "zap", description: "Zap a thing", execute: () => ({ toolCallId: "c", name: "zap" }) };
    const schemaAssembly = (tools: readonly ToolDefinition[], activated: readonly string[]): AssembleProviderInputOptions => ({
      model,
      systemInstructions: "Base rules.",
      tools,
      toolsDisclosure: "search",
      toolsSearch: { topK: 1 },
      activatedTools: new Set(activated),
      input: "echo the value",
    });
    const all = [echo, lookup, zap];

    const gained = await assembleTwice(schemaAssembly(all, ["echo"]), schemaAssembly(all, ["echo", "lookup"]));
    assert.deepEqual(namesOf(gained.before), ["echo"]);
    assert.deepEqual(namesOf(gained.after), ["echo", "lookup"]);
    assert.equal(messagesOf(gained.after), messagesOf(gained.before), "schema selection leaves every message byte-identical");
    assert.equal(gained.boundary.messageIndex, gained.before.messages.length, "no message was invalidated");
    assert.equal(
      gained.boundary.toolIndex,
      gained.before.tools?.length,
      "the new schema appends after the selected ones: the cache anchor holds",
    );

    const lost = await assembleTwice(schemaAssembly(all, ["echo", "lookup"]), schemaAssembly([echo, zap], ["echo"]));
    assert.deepEqual(namesOf(lost.before), ["echo", "lookup"]);
    assert.deepEqual(namesOf(lost.after), ["echo"]);
    assert.equal(messagesOf(lost.after), messagesOf(lost.before));
    assert.equal(lost.boundary.toolIndex, lost.after.tools?.length, "the surviving schemas keep their positions");

    // Negative control: the boundary covers schema fields, not just names.
    const reworded = await assembleTwice(
      schemaAssembly(all, ["echo", "lookup"]),
      schemaAssembly([echo, { ...lookup, description: "Changed description" }, zap], ["echo", "lookup"]),
    );
    assert.deepEqual(namesOf(reworded.after), namesOf(reworded.before), "the schema names are unchanged");
    assert.notEqual(JSON.stringify(reworded.after.tools), JSON.stringify(reworded.before.tools));
    assert.equal(reworded.boundary.toolIndex, 1, "the second schema is the boundary — its description changed in place");
    assert.equal(messagesOf(reworded.after), messagesOf(reworded.before));
  });
});
