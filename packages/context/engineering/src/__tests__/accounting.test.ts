/**
 * Per-request context accounting and the injected-block share cap (plan 194 Task 5).
 */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";

import {
  type AgentEvent,
  type ContextDraft,
  type ModelConfig,
  type PackageInstance,
  type ProviderEvent,
  type ProviderRequest,
  createAgent,
  definePackage,
  estimateAssemblyTokens,
  providerDone,
  providerTextDelta,
  withContextBlocks,
} from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";

import { type ContextEngineeringConfig, type ContextAccountEvent, resolveContextEngineeringConfig } from "../index.js";
import contextEngineering from "../index.js";

const PACKAGE = "@arnilo/prism-context-engineering";
const reply = (text = "ok"): readonly ProviderEvent[] => [providerTextDelta(text), providerDone()];

interface HarnessOptions {
  readonly config?: ContextEngineeringConfig;
  readonly extraPackages?: readonly PackageInstance[];
  readonly model?: ModelConfig;
  readonly systemPrompt?: { readonly id: string; readonly mode: "replace"; readonly text: string };
  readonly events?: AgentEvent[];
}

async function harness(options: HarnessOptions = {}) {
  const requests: ProviderRequest[] = [];
  const provider = mockProvider([reply()], { onRequest: (request) => requests.push(request) });
  const agent = await createAgent({
    model: options.model ?? { provider: "mock", model: "main", limits: { contextWindow: 10_000, maxOutputTokens: 0 } },
    packages: [provider, contextEngineering(options.config ?? {}), ...(options.extraPackages ?? [])],
    ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
    ...(options.events
      ? {
          hooks: (hooks: { on: (name: "package.event", handler: (payload: unknown) => void) => void }) =>
            hooks.on("package.event", (payload) => options.events!.push(payload as AgentEvent)),
        }
      : {}),
  });
  return { agent, requests };
}

function accounted(events: readonly AgentEvent[]): ContextAccountEvent {
  const event = events.find(
    (entry) => entry.type === "package.event" && (entry as { name?: string }).name === "context.accounted",
  ) as unknown as { data: ContextAccountEvent } | undefined;
  assert.ok(event, "one context.accounted event");
  return event.data;
}

/** A package that adds prefix blocks (and optionally a tail message) the way memory packages do. */
function memoryPackage(sentinel: string, options: { readonly tail?: boolean } = {}): PackageInstance {
  return definePackage({
    name: "@acme/memory",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.hooks.on("context.build", (draft: ContextDraft) => {
        const next = withContextBlocks(draft, [
          {
            title: "Retrieved",
            content: `${sentinel} ${"x".repeat(80_000)}`,
            priority: 1,
            metadata: { source: "acme-rag" },
          },
        ]);
        if (!options.tail) return next;
        const tail = {
          role: "system" as const,
          content: [{ type: "text" as const, text: `Semantic memory:\n${sentinel} TAIL` }],
          metadata: {
            contextBlocks: [{ title: "Semantic memory", source: "fabric-semantic", tokens: 12 }],
          },
        };
        const messages = next!.messages;
        return { ...next!, messages: [...messages.slice(0, -1), tail, ...messages.slice(-1)] };
      });
    },
  })();
}

/** Two prefix blocks with distinct priorities, each large enough to matter against a small share. */
function priorityPackage(): PackageInstance {
  return definePackage({
    name: "@acme/priority-blocks",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.hooks.on("context.build", (draft: ContextDraft) =>
        withContextBlocks(draft, [
          { title: "High", content: `HIGH-SENTINEL ${"h".repeat(8_000)}`, priority: 10, metadata: { source: "high" } },
          { title: "Low", content: `LOW-SENTINEL ${"l".repeat(8_000)}`, priority: 1, metadata: { source: "low" } },
        ]),
      );
    },
  })();
}

/** One tail message with two blocks of distinct priority, so a tail drop can be observed. */
function tailPriorityPackage(): PackageInstance {
  return definePackage({
    name: "@acme/tail-priority",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.hooks.on("context.build", (draft: ContextDraft) => {
        const tail = {
          role: "system" as const,
          content: [
            { type: "text" as const, text: `HIGH-TAIL ${"h".repeat(8_000)}` },
            { type: "text" as const, text: "\n\n" },
            { type: "text" as const, text: `LOW-TAIL ${"l".repeat(8_000)}` },
          ],
          metadata: {
            contextBlocks: [
              { title: "High tail", source: "high-tail", priority: 10, tokens: 2_000 },
              { title: "Low tail", source: "low-tail", priority: 1, tokens: 2_000 },
            ],
          },
        };
        return { ...draft, messages: [...draft.messages.slice(0, -1), tail, ...draft.messages.slice(-1)] };
      });
    },
  })();
}

function instructionPackage(): PackageInstance {
  return definePackage({
    name: "@acme/instructions",
    version: "0.0.0",
    requires: { api: 1 },
    setup(prism) {
      prism.hooks.on("context.build", (draft: ContextDraft) => ({
        ...draft,
        messages: [
          ...draft.messages,
          {
            role: "system" as const,
            content: [{ type: "text" as const, text: "INSTRUCTION-SENTINEL" }],
            metadata: { source: "context-files-nested" },
          },
        ],
      }));
    },
  })();
}

describe("context accounting and block share (plan 194 Task 5)", () => {
  it("accounting_event_sums_to_request_estimate", async () => {
    const events: AgentEvent[] = [];
    const { agent, requests } = await harness({ config: { accounting: true }, events });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("measure me");

    const data = accounted(events);
    assert.equal(data.turn, 1);
    assert.equal(data.totalTokens, estimateAssemblyTokens(requests.at(-1)!.messages), "messages plus no tools");
    assert.equal(data.bySource.input > 0, true);
    assert.equal(data.inputCapTokens, 8_976);
    await agent.dispose();
  });

  it("accounting_keys_blocks_by_source_including_tail_metadata", async () => {
    const events: AgentEvent[] = [];
    const { agent } = await harness({
      config: { accounting: true },
      extraPackages: [memoryPackage("RAG-SENTINEL", { tail: true })],
      events,
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("go");

    const data = accounted(events);
    assert.ok((data.bySource.blocks["acme-rag"] ?? 0) > 10_000, "the prefix block is keyed by its source");
    assert.equal(data.bySource.tail["fabric-semantic"], 12, "the tail block uses its metadata.tokens");
    await agent.dispose();
  });

  it("block_share_cap_drops_lowest_priority_whole_block_and_reports", async () => {
    const events: AgentEvent[] = [];
    const { agent, requests } = await harness({
      config: { blocks: { maxShare: 0.3 } },
      extraPackages: [priorityPackage()],
      events,
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("go");

    const sent = JSON.stringify(requests.at(-1)!.messages);
    assert.equal(sent.includes("HIGH-SENTINEL"), true, "the higher-priority block stays");
    assert.equal(sent.includes("LOW-SENTINEL"), false, "the whole lowest-priority block is dropped");
    const data = accounted(events);
    assert.deepEqual(
      data.dropped.map((entry) => entry.source),
      ["low"],
    );
    assert.ok((data.dropped[0]?.tokens ?? 0) > 1_000);
    await agent.dispose();
  });

  it("block_share_cap_drops_a_whole_tail_block", async () => {
    const events: AgentEvent[] = [];
    const { agent, requests } = await harness({
      config: { blocks: { maxShare: 0.3 } },
      extraPackages: [tailPriorityPackage()],
      events,
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("go");

    const sent = JSON.stringify(requests.at(-1)!.messages);
    assert.equal(sent.includes("HIGH-TAIL"), true, "the higher-priority tail block stays");
    assert.equal(sent.includes("LOW-TAIL"), false, "the whole lowest-priority tail block is dropped");
    const data = accounted(events);
    assert.deepEqual(
      data.dropped.map((entry) => entry.source),
      ["low-tail"],
    );
    assert.equal(data.bySource.tail["high-tail"], 2_000);
    assert.equal(data.bySource.tail["low-tail"], undefined);
    await agent.dispose();
  });

  it("block_share_never_drops_system_or_instructions", async () => {
    const events: AgentEvent[] = [];
    const { agent, requests } = await harness({
      config: { blocks: { maxShare: 0.001 } },
      extraPackages: [memoryPackage("RAG-SENTINEL"), instructionPackage()],
      systemPrompt: { id: "policy", mode: "replace", text: "SYSTEM-SENTINEL policy" },
      events,
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("go");

    const sent = JSON.stringify(requests.at(-1)!.messages);
    assert.equal(sent.includes("SYSTEM-SENTINEL"), true, "the system prompt is never counted or dropped");
    assert.equal(sent.includes("INSTRUCTION-SENTINEL"), true, "an instruction layer is never counted or dropped");
    assert.equal(sent.includes("RAG-SENTINEL"), false, "the injected block alone is dropped");
    const data = accounted(events);
    assert.deepEqual(
      data.dropped.map((entry) => entry.source),
      ["acme-rag"],
    );
    await agent.dispose();
  });

  it("blocks_and_budget_are_mutually_exclusive", () => {
    assert.throws(
      () => resolveContextEngineeringConfig({ blocks: { maxShare: 0.2 }, budget: { maxInputTokens: 1_000 } }),
      /budget and blocks are mutually exclusive/,
    );
    assert.throws(() => resolveContextEngineeringConfig({ blocks: { maxShare: 0 } }), /blocks\.maxShare/);
    assert.throws(() => resolveContextEngineeringConfig({ blocks: { maxShare: 1.5 } }), /blocks\.maxShare/);
  });

  it("no_config_registers_no_accounting_handler", async () => {
    const { agent } = await harness({ config: {} });
    const inspection = agent.inspect();
    assert.deepEqual(
      (inspection.hooks["model.request"] ?? []).filter((hook) => hook.owner === PACKAGE),
      [],
      "no model.request handler is registered",
    );
    await agent.dispose();
  });

  it("accounting_event_contains_no_text", async () => {
    const events: AgentEvent[] = [];
    const { agent } = await harness({
      config: { accounting: true },
      extraPackages: [memoryPackage("SECRET-TEXT-SENTINEL")],
      events,
    });
    const session = await agent.session({ id: "s1", create: true });
    await session.run("SECRET-INPUT-SENTINEL");

    const serialized = JSON.stringify(accounted(events));
    assert.equal(serialized.includes("SECRET-TEXT-SENTINEL"), false);
    assert.equal(serialized.includes("SECRET-INPUT-SENTINEL"), false);
    await agent.dispose();
  });
});
