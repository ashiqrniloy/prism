// Executable version of plan 088 Task 1's assembly invalidation inventory. One fixture per row
// that is not a plan-088 tail segment asserts the documented outcome *at the documented boundary*:
// the message index where the leading byte-identical prefix ends — so a later change to the
// cache-aware layout fails here instead of silently relocating an invalidation boundary. The layout
// claims are owned by docs/input-and-prompt-assembly.md, docs/context-and-skills.md, and
// docs/provider-caching.md; the pinned table is in docs/prefix-stability-conformance.md. Fixtures
// call `assembleProviderInput` directly — no session, no provider, one assembly pair each (the
// injector rows vary the assembly `turn`).
//
// The eviction, fold, and tool-schema rows moved out with the stages (plan 158 Task 8): a budget
// eviction, a tool-result fold, and tool search are package `context.build` handlers now, and the
// package's own suites pin their boundaries.

import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import {
  type AssembleProviderInputOptions,
  assembleProviderInput,
  type ContextBlock,
  type Message,
  type ProviderRequest,
  type Skill,
  type ToolResult,
} from "../index.js";

/** Tool-capable fixture model: schemas travel on `request.tools`, so messages stay schema-independent. */
const model = { provider: "mock", model: "demo", capabilities: { tools: true } } as const;

const textOf = (message: Message) => message.content.find((part) => part.type === "text")?.text;
/** Flattened text per message; a tool-result message has no text part and reads as `""`. */
const textsOf = (request: ProviderRequest) => request.messages.map((message) => textOf(message) ?? "");
const _namesOf = (request: ProviderRequest) => (request.tools ?? []).map((tool) => tool.name);
const _messagesOf = (request: ProviderRequest) => JSON.stringify(request.messages);

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

type InputLayoutName = "cache_aware" | "legacy";

const _contextSlotAssembly = (
  _blocks?: readonly ContextBlock[],
  layout: InputLayoutName = "cache_aware",
): AssembleProviderInputOptions => ({
  model,
  systemInstructions: "Base rules.",
  skills: [briefSkill],
  skillsDisclosure: "progressive",
  input: "Ask",
  inputLayout: layout,
});

const _nowBlock: ContextBlock = { title: "Now", content: "turn two" };

/** Summary fixture with a skill, where the hoist difference between layouts is visible. */
const summaryWithContextAssembly = (summary: string, layout: InputLayoutName): AssembleProviderInputOptions => ({
  model,
  systemInstructions: "Base rules.",
  summaries: [summary],
  history: [hUser, hAssistant],
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
    assert.equal(legacy.boundary.messageIndex, 2, "legacy puts the skill and the system prompt ahead of the summary");
    assert.notEqual(cacheAware.boundary.messageIndex, legacy.boundary.messageIndex, "the layout switch alone moves the boundary");
    assert.deepEqual(textsOf(cacheAware.before).slice(0, 3), [
      "System instruction:\nBase rules.",
      "Summary:\nSummary one",
      "Skills are task-specific instructions. When a task matches a skill below, call load_skill with its name before starting.\n- brief: Be brief",
    ]);
    assert.deepEqual(textsOf(legacy.before).slice(0, 3), [
      "Skills are task-specific instructions. When a task matches a skill below, call load_skill with its name before starting.\n- brief: Be brief",
      "System instruction:\nBase rules.",
      "Summary:\nSummary one",
    ]);
    assert.deepEqual(
      textsOf(legacy.after).slice(0, 2),
      textsOf(legacy.before).slice(0, 2),
      "everything before the summary is byte-identical",
    );
    assert.ok(cacheAware.continuity < 1 && legacy.continuity < 1);
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
});
