/** Opt-in wiring (plan 074 Task 5): `AgentConfig` / `AgentDefinition` / `RunOptions.attentionCompiler`,
 *  the narrowing run overlay, and the session-owned sticky frontier. */
import assert from "node:assert/strict";
import { describe, it } from "bun:test";
import { asSessionHost } from "../agent-session/session/types.js";
import {
  type AgentConfig,
  type AIProvider,
  createAgent,
  withContextBlocks,
  estimateAssemblyTokens,
  type Message,
  type ModelConfig,
  type ProviderRequest,
  providerDone,
  providerTextDelta,
  providerToolCall,
  resolveAgentDefinition,
  resolveRunAttentionCompiler,
  type ToolDefinition,
  toolCallContent,
} from "../index.js";
import { failedRun } from "./run-result-helpers.js";

const model: ModelConfig = { provider: "mock", model: "demo" };
/** 2000 window − 0 output − 1024 default reserve → input cap 976. */
const cappedModel: ModelConfig = { provider: "mock", model: "demo", limits: { contextWindow: 2_000, maxOutputTokens: 0 } };
const payload = `payload ${"y".repeat(4_000)}`;
const STUB = /omitted \d+ bytes \(sha256 [0-9a-f]{32}\)/;

const bigTool: ToolDefinition = {
  name: "echo",
  parameters: { type: "object", properties: {} },
  execute: (_args, context) => ({ toolCallId: context.toolCallId, name: "echo", value: payload }),
};

/** First provider call asks for the tool, every later call answers in text. */
function toolThenReply(): { provider: AIProvider; requests: ProviderRequest[] } {
  const requests: ProviderRequest[] = [];
  return {
    requests,
    provider: {
      id: "mock",
      async *generate(request) {
        requests.push(request);
        if (requests.length === 1) yield providerToolCall(toolCallContent("call-1", "echo", {}));
        else yield providerTextDelta(`reply ${requests.length}`);
        yield providerDone();
      },
    },
  };
}

const agentWith = async (provider: AIProvider, config: Partial<AgentConfig> = {}) =>
  await createAgent({ model, provider, tools: { add: [bigTool] }, ...config });

function requestAt(requests: readonly ProviderRequest[], index: number): ProviderRequest {
  const request = requests[index];
  assert.ok(request, `missing provider request at index ${index}`);
  return request;
}

function textOf(request: ProviderRequest): string {
  return request.messages
    .flatMap((message) => message.content)
    .map((block) => {
      if (block.type === "text" || block.type === "thinking") return block.text;
      return block.type === "tool_result" ? JSON.stringify(block.result) : "";
    })
    .join("\n");
}

const requestText = (requests: readonly ProviderRequest[], index: number) => textOf(requestAt(requests, index));

describe("resolveRunAttentionCompiler", () => {
  it("stays off unless the agent enables it", () => {
    assert.equal(resolveRunAttentionCompiler(undefined, undefined, model), undefined);
    assert.equal(resolveRunAttentionCompiler(false, undefined, model), undefined);
    assert.equal(resolveRunAttentionCompiler(undefined, false, model), undefined);
    assert.throws(() => resolveRunAttentionCompiler(undefined, {}, model), /never enable it/);
    assert.throws(() => resolveRunAttentionCompiler(false, true, model), /never enable it/);
  });

  it("resolves `true` to the documented defaults and the cap from the model", () => {
    const defaults = resolveRunAttentionCompiler(true, undefined, cappedModel);
    assert.ok(defaults);
    assert.deepEqual(defaults, {
      inputCap: 976,
      reserveTokens: 1_024,
      triggerRatio: 0.75,
      compactRatio: 0.9,
      thinkingKeepTurns: 1,
      keepLast: 3,
      excludeTools: [],
      // Plan 086 T2: no `trigger` configured leaves the single legacy ratio axis.
      trigger: [{ kind: "input_ratio", ratio: 0.75 }],
      // Plan 086 T3: durable folding is opt-in.
      durable: false,
    });

    assert.equal(
      resolveRunAttentionCompiler({ maxInputTokens: 500 }, undefined, cappedModel)?.inputCap,
      500,
      "an explicit cap wins over the window",
    );
    assert.throws(() => resolveRunAttentionCompiler(true, undefined, model), /requires maxInputTokens or model.limits.contextWindow/);
  });

  it("treats a run object as a narrowing overlay: gates up, depth down, exclusions added", () => {
    const relaxed = resolveRunAttentionCompiler(
      { maxInputTokens: 100, keepLast: 3, thinkingKeepTurns: 2, excludeTools: ["a"] },
      { triggerRatio: 0.9, compactRatio: 0.95, keepLast: 1, thinkingKeepTurns: 0, excludeTools: ["b", "a"] },
      model,
    );
    assert.ok(relaxed);
    assert.equal(relaxed.triggerRatio, 0.9);
    assert.equal(relaxed.compactRatio, 0.95);
    assert.equal(relaxed.keepLast, 1);
    assert.equal(relaxed.thinkingKeepTurns, 0);
    assert.deepEqual([...relaxed.excludeTools].sort(), ["a", "b"]);
    assert.equal(
      resolveRunAttentionCompiler({ maxInputTokens: 100 }, { triggerRatio: 0.75 }, cappedModel)?.triggerRatio,
      0.75,
      "equal values are allowed",
    );
  });

  it("treats `false` as off and `true` as a no-op", () => {
    assert.equal(resolveRunAttentionCompiler(true, false, cappedModel), undefined);
    const agent = { maxInputTokens: 100, keepLast: 1 };
    assert.equal(resolveRunAttentionCompiler(agent, true, cappedModel)?.keepLast, 1);
    assert.equal(resolveRunAttentionCompiler(agent, undefined, cappedModel)?.keepLast, 1);
  });

  it("rejects run overlays that would move the gate or protect more", () => {
    const base = { triggerRatio: 0.75, compactRatio: 0.9, keepLast: 3, thinkingKeepTurns: 1, maxInputTokens: 100 };
    const widening = [
      [{ triggerRatio: 0.7 }, /triggerRatio \(0.7\) must not be more aggressive/],
      [{ compactRatio: 0.85 }, /compactRatio \(0.85\) must not be more aggressive/],
      [{ keepLast: 4 }, /keepLast \(4\) must not protect more/],
      [{ thinkingKeepTurns: 2 }, /thinkingKeepTurns \(2\) must not protect more/],
      [{ maxInputTokens: 1 }, /must not set maxInputTokens, reserveTokens, trigger, or durable/],
      [{ reserveTokens: 1 }, /must not set maxInputTokens, reserveTokens, trigger, or durable/],
      [{ trigger: { kind: "token_floor", tokens: 1 } }, /must not set maxInputTokens, reserveTokens, trigger, or durable/],
      [{ durable: true }, /must not set maxInputTokens, reserveTokens, trigger, or durable/],
    ] as const;
    for (const [overlay, pattern] of widening) {
      assert.throws(() => resolveRunAttentionCompiler(base, overlay, model), pattern);
    }
    assert.throws(() => resolveRunAttentionCompiler(true, "wider" as never, model), /must be false or an options object/);
  });
});

describe("attentionCompiler session wiring", () => {
  it("keeps today's request bytes when omitted, disabled, or under the ratio", async () => {
    const runs: string[] = [];
    for (const attentionCompiler of [undefined, false, { maxInputTokens: 500_000 }] as const) {
      const { provider, requests } = toolThenReply();
      const session = await (await agentWith(provider, { attentionCompiler })).session({ id: `s-${runs.length}`, create: true });
      await session.run("plain question");
      runs.push(requestText(requests, 0));
    }
    assert.equal(runs[1], runs[0], "explicit false matches an omitted setting");
    assert.equal(runs[2], runs[0], "an under-ratio run mutates nothing");
    assert.ok(runs[0]?.includes("plain question"));
  });

  it("mutates the provider view when over the ratio and leaves the store intact", async () => {
    const { provider, requests } = toolThenReply();
    const session = await (await agentWith(provider, { attentionCompiler: { maxInputTokens: 120, keepLast: 0 } })).session({
      id: "s",
      create: true,
    });
    await session.run("seed: use the tool");

    const compiled = requestText(requests, 1);
    assert.match(compiled, STUB, "the compiled request carries the deterministic stub");
    assert.equal(compiled.includes(payload), false, "the payload is absent from the provider view");
    assert.equal(
      (await session.entries()).some((entry) => JSON.stringify(entry).includes("payload y")),
      true,
      "the session store still holds the full payload",
    );
  });

  it("lets a run disable an enabled compiler and rejects widening overlays before any turn", async () => {
    const { provider, requests } = toolThenReply();
    const agent = await agentWith(provider, { attentionCompiler: { maxInputTokens: 120, keepLast: 0 } });
    const session = await agent.session({ id: "s", create: true });
    await session.run("seed: use the tool", { attentionCompiler: false });
    assert.equal(requestText(requests, 1).includes(payload), true, "a disabled run never mutates");

    const rejected = await agent.session({ id: "rejected", create: true });
    await failedRun(rejected.run("go", { attentionCompiler: { triggerRatio: 0.5 } }), /must not be more aggressive/);
    await failedRun(rejected.run("go", { attentionCompiler: { maxInputTokens: 10 } }), /must not set maxInputTokens/);
    assert.equal(requests.length, 2, "a rejected overlay never reaches a provider turn");
  });

  it("enables compilation through an AgentDefinition and leaves scope alone", async () => {
    const definition = await resolveAgentDefinition(
      { name: "research", model: cappedModel, attentionCompiler: { maxInputTokens: 120, keepLast: 0 } },
      { providerSource: () => undefined },
    );
    assert.deepEqual(definition.config.attentionCompiler, { maxInputTokens: 120, keepLast: 0 });

    const plain = await resolveAgentDefinition({ name: "other", model: cappedModel }, { providerSource: () => undefined });
    assert.equal(plain.config.attentionCompiler, undefined, "the field is per definition, not global");

    const scoped = await resolveAgentDefinition(
      { name: "research", model: cappedModel, attentionCompiler: true },
      { providerSource: () => undefined, overrides: { ownership: { tenantId: "t1" } } },
    );
    assert.deepEqual(scoped.config.ownership, { tenantId: "t1" }, "copying the field leaves ownership untouched");
  });

  it("runs the context.build handler exactly once per turn with the compiler on", async () => {
    const { provider, requests } = toolThenReply();
    let builds = 0;
    const agent = await agentWith(provider, {
      attentionCompiler: { maxInputTokens: 120, keepLast: 0 },
      hooks: (hooks) =>
        hooks.on(
          "context.build",
          (draft) => {
            builds += 1;
            return withContextBlocks(draft, [{ id: "injected", title: "Rules", content: "injected rules" }]);
          },
          { id: "spy" },
        ),
    });
    await (await agent.session()).run("seed: use the tool");

    // Two provider rounds (tool call, then reply), each assembled exactly once: the compiler
    // replaces the message list, it does not re-run the context.build handler.
    assert.equal(requests.length, 2);
    assert.equal(builds, requests.length, "one context.build dispatch per provider turn");
    assert.match(requestText(requests, 1), /injected rules/);
  });

  it("unions run excludeTools with the agent setting", async () => {
    const { provider, requests } = toolThenReply();
    const session = await (await agentWith(provider, { attentionCompiler: { maxInputTokens: 120, keepLast: 0 } })).session({
      id: "s",
      create: true,
    });
    await session.run("seed: use the tool");
    assert.match(requestText(requests, 1), STUB, "without an overlay the aged row is stub-eligible");

    // The exclusion covers the only stub-eligible row, so the compiler cannot get back under the
    // ratio: it fails closed instead of sending an over-cap request (had the union been ignored,
    // the row would have been stubbed and the run would have compiled, as it did above).
    await failedRun(session.run("second", { attentionCompiler: { excludeTools: ["echo"] } }), /attention budget exceeded/);
    assert.equal(requests.length, 2, "the refused assembly never reached a provider turn");
  });

  it("keeps mutations sticky for the life of a session leaf, across runs", async () => {
    // Size the cap from a compiler-free request so the seeding turn sits above the base gate
    // (0.75) and the relaxed run overlay (0.99) sits above every request. If token estimation
    // changes, one of the assertions below fails loudly and the 0.85 divisor is re-tuned.
    const probe = toolThenReply();
    await (await (await agentWith(probe.provider, { model: cappedModel })).session({ id: "probe", create: true })).run(
      "seed: use the tool",
    );
    const cap = Math.ceil(estimateAssemblyTokens(requestAt(probe.requests, 1).messages) / 0.85);

    const strict = toolThenReply();
    const strictSession = await (
      await agentWith(strict.provider, {
        model: cappedModel,
        attentionCompiler: { maxInputTokens: cap, triggerRatio: 0.75, compactRatio: 0.999, keepLast: 0 },
      })
    ).session({ id: "strict", create: true });
    await strictSession.run("seed: use the tool");
    assert.match(requestText(strict.requests, 1), STUB, "the seeding turn is over the base ratio");
    await strictSession.run("second question", { attentionCompiler: { triggerRatio: 0.99 } });
    assert.equal(requestText(strict.requests, 2).includes(payload), false, "the run-1 stub survives a later under-ratio turn");

    const relaxed = toolThenReply();
    const relaxedSession = await (
      await agentWith(relaxed.provider, {
        model: cappedModel,
        attentionCompiler: { maxInputTokens: cap, triggerRatio: 0.99, compactRatio: 0.999, keepLast: 0 },
      })
    ).session({ id: "relaxed", create: true });
    await relaxedSession.run("seed: use the tool");
    await relaxedSession.run("second question");
    assert.equal(
      requestText(relaxed.requests, 2).includes(payload),
      true,
      "the same request without the sticky frontier keeps the payload",
    );
  });

  it("owns one lazily created frontier per session", async () => {
    const agent = await createAgent({ model, provider: toolThenReply().provider });
    const host = asSessionHost(await agent.session({ id: "s", create: true }));
    const first = host.attentionStickyFor();
    assert.equal(host.attentionStickyFor(), first, "the same session reuses its frontier across turns and runs");
    assert.notEqual(
      asSessionHost(await agent.session({ id: "other", create: true })).attentionStickyFor(),
      first,
      "sessions never share mutations",
    );
  });
});
