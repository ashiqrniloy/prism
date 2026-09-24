import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createAgent } from "../agent-session/create-agent.js";
import type { AgentSession, Message, PromptBuildRequest, ProviderRequest, Skill } from "../contracts.js";
import { createMiddlewareRegistry, type MiddlewareRegistry } from "../middleware.js";
import { providerDone, toolCallContent } from "../provider-events.js";
import { createLoadSkillTool } from "../skill-load.js";
import { createSkillRegistry } from "../skills.js";
import {
  type PrefixStabilityConformanceOptions,
  runPrefixStabilityConformance,
  scorePrefixStability,
} from "../testing/prefix-stability-conformance.js";

type Host = PrefixStabilityConformanceOptions["host"];

const firstSkill: Skill = {
  name: "alpha",
  description: "Alpha catalog entry",
  instructions: "Alpha body: measure twice, cut once.",
};
const secondSkill: Skill = {
  name: "beta",
  description: "Beta catalog entry",
  instructions: "Beta body: prefer deletion over addition.",
};

/** Host assembly with a padded stable prefix so the fixture is representative of a real prompt. */
function host(overrides: Partial<Host> = {}): Host {
  return {
    model: { provider: "mock", model: "demo", capabilities: { tools: true } },
    instructions: `Stable rules. ${"Keep the prefix byte-stable. ".repeat(120)}`,
    context: [{ name: "project", resolve: () => [{ title: "Project", content: "Stable project context." }] }],
    ...overrides,
  };
}

/**
 * Host assembly whose attention compiler folds once, at the opening round of a run whose carried
 * request is already over `floor` — the fixture's turn-2 transcript grew past it, so the run-2
 * opening assembly strips turn-1 reasoning.
 *
 * The predicate must settle under its own stages: the compiler fails closed when a predicate still
 * fires after folding. `state.turn` is the round index *within a run*, not the session turn, so the
 * plan's bare `shouldFold: (state) => state.turn === 2` fires on every post-tool round and throws
 * `AttentionBudgetError` (round 1 of run 1 strips nothing at all).
 */
function foldingHost(floor = 1_350): Host {
  return host({
    attentionCompiler: {
      maxInputTokens: 4_000,
      thinkingKeepTurns: 0,
      keepLast: 0,
      trigger: { kind: "predicate", shouldFold: (state) => state.turn === 1 && state.estimatedInputTokens >= floor },
    },
  });
}

describe("prefix stability conformance", () => {
  it("passes against the default cache-aware assembly with staggered skill loads", async () => {
    const result = await runPrefixStabilityConformance({ host: host(), skills: [firstSkill, secondSkill] });

    assert.equal(result.requests, 4);
    assert.ok(result.minContinuity >= 0.95, `expected ≥95% shared prefix, got ${result.minContinuity}`);
    assert.deepEqual(result.resets, []);
    assert.deepEqual(result.resetDetails, []);
  });

  it("splits the provider-visible prefix from the tail-aware cacheable prefix", async () => {
    const result = await runPrefixStabilityConformance({ host: host(), skills: [firstSkill, secondSkill] });

    // The tail body sits after the turn-2 transcript insert, so the provider-visible fraction of
    // the turn-1 request dips below 1; dropping the tail recovers the append-only prefix.
    assert.ok(result.minContinuity < 1, `expected a tail-sized dip, got ${result.minContinuity}`);
    assert.equal(result.cacheableContinuity, 1);
  });

  it("gates on the cacheable prefix when asked, so an eager body-heavy host passes there and fails the default", async () => {
    const eagerBody = "Eager tail body: keep it byte-stable. ".repeat(40);
    const eagerHost = host({ instructions: "Stable rules.", skillsDisclosure: "eager" });
    const eagerSkills: [Skill, Skill] = [
      { name: "alpha", description: "Alpha catalog entry", instructions: eagerBody },
      { name: "beta", description: "Beta catalog entry", instructions: eagerBody },
    ];

    const dipped = await runPrefixStabilityConformance({
      host: eagerHost,
      skills: eagerSkills,
      allowedResets: 3,
    });
    assert.deepEqual(
      dipped.resetDetails.map((row) => row.request),
      dipped.resets,
    );
    assert.ok(dipped.resetDetails.length > 0);
    for (const row of dipped.resetDetails) {
      assert.ok(row.fraction < 0.95);
      assert.equal(row.cacheableFraction, 1);
    }

    const result = await runPrefixStabilityConformance({
      host: eagerHost,
      skills: eagerSkills,
      assertOn: "cacheablePrefix",
    });
    assert.equal(result.cacheableContinuity, 1);
    assert.ok(result.minContinuity < 0.95, `expected the eager tail to break the provider prefix, got ${result.minContinuity}`);

    await assert.rejects(
      () => runPrefixStabilityConformance({ host: eagerHost, skills: eagerSkills }),
      /request 1 → 2 kept .*of the previous provider prefix/,
    );
  });

  it("classifies cloned tail messages by serialized equality", async () => {
    const cloning = host({
      promptBuilder: {
        name: "clone-each",
        build: (request: PromptBuildRequest) =>
          request.messages.map((message) => ({ ...message, content: message.content.map((block) => ({ ...block })) })),
      },
    });

    const result = await runPrefixStabilityConformance({ host: cloning, skills: [firstSkill, secondSkill] });

    // Identity is lost to the clone; a `1` here proves the value-equality fallback matched the tail
    // (without it the cacheable fraction would equal the tail-sized provider-visible dip).
    assert.equal(result.cacheableContinuity, 1);
    assert.ok(result.minContinuity < 1, `expected a tail-sized dip, got ${result.minContinuity}`);
  });

  it("reports no tail segment when the builder renders bodies outside the tail", async () => {
    // One merged message: the tail objects never reach the captured request, so both metrics are
    // the same measurement of the merged text.
    const merged = host({
      promptBuilder: {
        name: "merged",
        build: (request: PromptBuildRequest) => [
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: request.messages.map((message) => JSON.stringify(message)).join("\n") }],
          },
        ],
      },
    });

    const result = await runPrefixStabilityConformance({ host: merged, skills: [firstSkill, secondSkill] });

    assert.equal(result.cacheableContinuity, result.minContinuity);
  });

  it("rejects a host that recomposes a leading context block per request", async () => {
    let turn = 0;
    const volatile = host({
      context: [{ name: "volatile", resolve: () => [{ title: "Project", content: `recomposed-${(turn += 1)}` }] }],
    });

    await assert.rejects(
      () => runPrefixStabilityConformance({ host: volatile, skills: [firstSkill, secondSkill] }),
      /request 1 → 2 kept .*of the previous provider prefix/,
    );
  });

  it("lowers both fractions for a volatile context provider, so the cacheable metric masks no regression", async () => {
    let turn = 0;
    const volatile = host({
      context: [{ name: "volatile", resolve: () => [{ title: "Project", content: `recomposed-${(turn += 1)}` }] }],
    });

    const result = await runPrefixStabilityConformance({
      host: volatile,
      skills: [firstSkill, secondSkill],
      assertOn: "cacheablePrefix",
      minContinuity: 0,
    });
    assert.ok(result.cacheableContinuity < 1, `expected a context dip, got ${result.cacheableContinuity}`);
    assert.ok(result.minContinuity < 1, `expected a context dip, got ${result.minContinuity}`);

    await assert.rejects(
      () => runPrefixStabilityConformance({ host: volatile, skills: [firstSkill, secondSkill], assertOn: "cacheablePrefix" }),
      /request 1 → 2 kept .*of the previous cacheable prefix \(tail segments excluded\)/,
    );
  });

  it("rejects a host whose prompt builder never renders loaded bodies", async () => {
    const dropping = host({
      promptBuilder: {
        name: "catalog-only",
        build: (request: PromptBuildRequest) =>
          request.messages.filter(
            (message) => !message.content.some((block) => block.type === "text" && block.text.includes("Alpha body")),
          ),
      },
    });

    await assert.rejects(
      () => runPrefixStabilityConformance({ host: dropping, skills: [firstSkill, secondSkill] }),
      /skill alpha body never reached the provider request/,
    );
  });

  it("testing/prefix-stability-conformance subpath is exported", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.ok(pkg.exports["./testing/prefix-stability-conformance"]);
  });

  it("reports the attention-compiler fold as one reset and passes when that reset is allowed", async () => {
    const result = await runPrefixStabilityConformance({
      host: foldingHost(),
      skills: [firstSkill, secondSkill],
      allowedResets: 1,
    });

    assert.equal(result.requests, 4);
    // The run-2 opening assembly folded the carried reasoning block, so request 2 → 3 broke.
    assert.deepEqual(result.resets, [3]);
    assert.equal(result.resetDetails.length, 1);
    assert.deepEqual(
      result.resetDetails.map((row) => row.request),
      result.resets,
    );
    assert.ok((result.resetDetails[0]?.fraction ?? 1) < 0.95);
    assert.ok((result.resetDetails[0]?.cacheableFraction ?? 1) < 0.95);
    // A real invalidation, not a tail re-send: the tail-aware fraction dips too.
    assert.ok(result.cacheableContinuity < 0.95, `expected a folded prefix, got ${result.cacheableContinuity}`);
    // Every other gap kept ≥ minContinuity: a second sub-threshold pair would be a second reset.
  });

  it("rejects the fold when no reset is allowed, naming the gap and the observed resets", async () => {
    await assert.rejects(
      () => runPrefixStabilityConformance({ host: foldingHost(), skills: [firstSkill, secondSkill] }),
      /request 2 → 3 kept .*of the previous provider prefix .*resets \[3\] of 3 request pairs, allowedResets 0/,
    );
  });

  it("fails when the declared reset never happens", async () => {
    await assert.rejects(
      () =>
        runPrefixStabilityConformance({ host: host(), skills: [firstSkill, secondSkill], assertOn: "cacheablePrefix", allowedResets: 1 }),
      /allowedResets is 1 but only 0 pair\(s\) broke below the minimum .*resets \[\] of 3 request pairs/,
    );
  });

  it("keeps the prefix append-only when the compiler is configured but its gate never opens", async () => {
    const never = await runPrefixStabilityConformance({
      host: host({
        attentionCompiler: {
          maxInputTokens: 4_000,
          thinkingKeepTurns: 0,
          keepLast: 0,
          trigger: { kind: "predicate", shouldFold: () => false },
        },
      }),
      skills: [firstSkill, secondSkill],
    });

    assert.deepEqual(never.resets, []);
    assert.equal(never.cacheableContinuity, 1);
    assert.ok(never.minContinuity >= 0.95, `expected a stable prefix, got ${never.minContinuity}`);
  });

  it("counts a post-fold rewrite as a second reset and still rejects when only one is allowed", async () => {
    // Fresh counter per run: the context block changes on the fourth assembly only, after the fold.
    const rewritingHost = (): Host => {
      let assembly = 0;
      return {
        ...foldingHost(),
        context: [
          {
            name: "rewritten",
            resolve: () => {
              assembly += 1;
              return [{ title: "Project", content: assembly >= 4 ? "rewritten after the fold" : "Stable project context." }];
            },
          },
        ],
      };
    };

    const allowed = await runPrefixStabilityConformance({
      host: rewritingHost(),
      skills: [firstSkill, secondSkill],
      allowedResets: 2,
    });
    assert.deepEqual(allowed.resets, [3, 4]);

    await assert.rejects(
      () =>
        runPrefixStabilityConformance({
          host: rewritingHost(),
          skills: [firstSkill, secondSkill],
          allowedResets: 1,
        }),
      /request 2 → 3 kept .*resets \[3, 4\] of 3 request pairs, allowedResets 1/,
    );
  });
});

const model = { provider: "mock", model: "demo" } as const;

function text(role: Message["role"], value: string): Message {
  return { role, content: [{ type: "text", text: value }] };
}

/** Same fixture the runner installs, so a scored capture can be compared to a runner result. */
async function captureFixture(hostConfig: Host, skills: readonly [Skill, Skill]) {
  const requests: ProviderRequest[] = [];
  const registry = createSkillRegistry([...skills]);
  const hostTools = hostConfig.tools && "list" in hostConfig.tools ? hostConfig.tools.list() : (hostConfig.tools ?? []);
  let call = 0;
  const agent = createAgent({
    ...hostConfig,
    skills: registry,
    tools: [...hostTools, createLoadSkillTool({ registry })],
    provider: {
      id: "prefix-stability-fixture",
      async *generate(request) {
        requests.push(request);
        const index = call;
        call += 1;
        const skillName = skills[index >> 1]?.name;
        if (index % 2 === 0 && skillName !== undefined) {
          yield { type: "tool_call" as const, call: toolCallContent(`prefix-stability-${index}`, "load_skill", { name: skillName }) };
          return;
        }
        yield providerDone();
      },
    },
  });
  const session = agent.createSession() as AgentSession & { readonly tailSegments: ReadonlyMap<string, Message> };
  const runOptions = { activeSkills: [skills[0].name, skills[1].name], limits: { maxToolRounds: 1 } } as const;
  await session.run("Prefix stability turn one", runOptions);
  await session.run("Prefix stability turn two", runOptions);
  return { requests, tailSegments: session.tailSegments };
}

describe("scorePrefixStability", () => {
  it("scores a hand-built capture: tail dip is a reset, cacheable prefix stays intact", () => {
    const stable = text("system", "S".repeat(80));
    const tail = text("system", "T".repeat(2000));
    const inserted = text("user", "inserted");
    const requests: ProviderRequest[] = [
      { model, messages: [stable, tail] },
      { model, messages: [stable, inserted, tail] },
      { model, messages: [stable, inserted, tail, text("user", "more")] },
    ];
    const sample = scorePrefixStability(requests, { tailSegments: new Map([["t", tail]]) });

    assert.ok(sample.cacheableContinuity > 0.95, `cacheable ${sample.cacheableContinuity}`);
    assert.ok(sample.minContinuity < 0.95, `provider ${sample.minContinuity}`);
    assert.deepEqual(sample.resets, [2]);
    assert.equal(sample.resetDetails.length, sample.resets.length);
    assert.equal(sample.resetDetails[0]?.request, sample.resets[0]);
    assert.equal(sample.resetDetails[0]?.cacheableFraction, 1);
    assert.ok((sample.resetDetails[0]?.fraction ?? 1) < 0.95);
  });

  it("matches the runner on the same host capture and tail map", async () => {
    const captured = await captureFixture(host(), [firstSkill, secondSkill]);
    const result = await runPrefixStabilityConformance({ host: host(), skills: [firstSkill, secondSkill] });
    const sample = scorePrefixStability(captured.requests, { tailSegments: captured.tailSegments });

    assert.equal(sample.minContinuity, result.minContinuity);
    assert.equal(sample.cacheableContinuity, result.cacheableContinuity);
    assert.deepEqual(sample.resets, result.resets);
  });

  it("keeps both fractions equal when no tail map is passed, including an eager body-heavy capture", async () => {
    const eagerBody = "Eager tail body: keep it byte-stable. ".repeat(40);
    const eagerSkills: [Skill, Skill] = [
      { name: "alpha", description: "Alpha catalog entry", instructions: eagerBody },
      { name: "beta", description: "Beta catalog entry", instructions: eagerBody },
    ];
    const captured = await captureFixture(host({ instructions: "Stable rules.", skillsDisclosure: "eager" }), eagerSkills);
    const sample = scorePrefixStability(captured.requests);

    assert.equal(sample.cacheableContinuity, sample.minContinuity);
    assert.ok(sample.minContinuity < 1, "a tail re-send must count when the map is omitted");
  });

  it("does not fabricate 1 when the tail map matches nothing", async () => {
    const captured = await captureFixture(host(), [firstSkill, secondSkill]);
    const unrelated = new Map<string, Message>([["nope", text("user", "not a tail")]]);
    const sample = scorePrefixStability(captured.requests, { tailSegments: unrelated });

    assert.equal(sample.cacheableContinuity, sample.minContinuity);
    assert.notEqual(sample.cacheableContinuity, 1);
  });

  it("throws a plain Error naming the count when fewer than two requests are captured", () => {
    const one: ProviderRequest = { model, messages: [text("user", "only")] };
    for (const requests of [[], [one]] as const) {
      assert.throws(
        () => scorePrefixStability(requests),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.constructor, Error);
          assert.match(error.message, new RegExp(`got ${requests.length}`));
          return true;
        },
      );
    }
  });
});

/** Runner-owned bulk tool name (plan 110 Task 4). */
const BULK_TOOL_NAME = "prefix_stability_bulk";

/**
 * Floor measured for the 8 KiB fixture (plan 110 Task 4): the run-2 opening estimate is over 3,500
 * tokens with the bulk row and 1,841 after the compiler stubs it, so 2,500 settles; the run-1
 * opening assembly is under 1,000 tokens, so the predicate cannot fire before a row exists to fold.
 */
const BULK_FOLD_FLOOR = 2_500;

/** Folds the bulk tool result only: `thinkingKeepTurns: 1` leaves stage 1 nothing to strip. */
function bulkFoldingHost(middleware: MiddlewareRegistry): Host {
  return host({
    middleware,
    attentionCompiler: {
      maxInputTokens: 4_000,
      thinkingKeepTurns: 1,
      keepLast: 0,
      trigger: { kind: "predicate", shouldFold: (state) => state.turn === 1 && state.estimatedInputTokens >= BULK_FOLD_FLOOR },
    },
  });
}

/** Captures the runner's own wire requests through the existing `provider_request` hook. */
function captureRequests(): { middleware: MiddlewareRegistry; captured: ProviderRequest[] } {
  const captured: ProviderRequest[] = [];
  const middleware = createMiddlewareRegistry();
  middleware.use<ProviderRequest>("provider_request", (request) => {
    captured.push(request);
    return request;
  });
  return { middleware, captured };
}

function toolResultMessage(request: ProviderRequest, toolCallId: string): Message | undefined {
  return request.messages.find((message) => message.content.some((part) => part.type === "tool_result" && part.toolCallId === toolCallId));
}

function toolResultText(request: ProviderRequest, toolCallId: string): string {
  for (const message of request.messages) {
    for (const part of message.content) {
      if (part.type === "tool_result" && part.toolCallId === toolCallId) return String(part.result);
    }
  }
  return "";
}

function thinkingTexts(request: ProviderRequest): readonly string[] {
  const out: string[] = [];
  for (const message of request.messages) {
    for (const part of message.content) {
      if (part.type === "thinking") out.push(part.text);
    }
  }
  return out;
}

describe("tool-result fold fixture (plan 110 Task 4)", () => {
  it("stubs the bulk result at the reset and leaves the sibling confirmation byte-identical", async () => {
    const { middleware, captured } = captureRequests();
    const result = await runPrefixStabilityConformance({
      host: bulkFoldingHost(middleware),
      skills: [firstSkill, secondSkill],
      allowedResets: 1,
      foldableToolResultBytes: 8_192,
    });

    assert.equal(result.requests, 4);
    assert.deepEqual(result.resets, [3]);
    assert.equal(result.resetDetails.length, 1);
    assert.equal(result.resetDetails[0]?.request, 3);

    const before = captured[1];
    const after = captured[2];
    assert.ok(before && after);
    // Request 2 carries the generated payload; request 3 carries the compiler's stub for that id.
    assert.equal(toolResultText(before, "prefix-stability-bulk-0"), "x".repeat(8_192));
    assert.match(
      toolResultText(after, "prefix-stability-bulk-0"),
      /^Tool result prefix_stability_bulk \[prefix-stability-bulk-0\]: omitted 8194 bytes \(sha256 [0-9a-f]{32}\)$/,
    );
    // The sibling load_skill confirmation is byte-unchanged: the shrink guard left the small row alone.
    assert.equal(
      JSON.stringify(toolResultMessage(after, "prefix-stability-0")),
      JSON.stringify(toolResultMessage(before, "prefix-stability-0")),
    );
    assert.ok(JSON.stringify(toolResultMessage(after, "prefix-stability-0")).includes("Loaded skill alpha for this session."));
  });

  it("isolates the tool-result stage: every pre-fold message survives except the stubbed row, thinking included", async () => {
    const { middleware, captured } = captureRequests();
    await runPrefixStabilityConformance({
      host: bulkFoldingHost(middleware),
      skills: [firstSkill, secondSkill],
      allowedResets: 1,
      foldableToolResultBytes: 8_192,
    });

    const before = captured[1];
    const after = captured[2];
    assert.ok(before && after);
    const beforeMessages = before.messages.map((message) => JSON.stringify(message));
    const afterMessages = after.messages.map((message) => JSON.stringify(message));
    const beforeSet = new Set(beforeMessages);
    const afterSet = new Set(afterMessages);
    const stubRow = JSON.stringify(toolResultMessage(after, "prefix-stability-bulk-0"));

    // Exactly one pre-fold message changed: the stubbed bulk row.
    assert.deepEqual(
      beforeMessages.filter((message) => !afterSet.has(message)),
      [JSON.stringify(toolResultMessage(before, "prefix-stability-bulk-0"))],
    );
    // The additions are the stub and the turn-2 input — no other rewrite.
    const added = afterMessages.filter((message) => !beforeSet.has(message));
    assert.equal(added.length, 2);
    assert.ok(added.includes(stubRow));
    assert.ok(added.some((message) => message.includes("Prefix stability turn two")));
    // Stage 1 stripped nothing: every thinking block survives, byte-identical.
    const thinkingBefore = thinkingTexts(before);
    assert.ok(thinkingBefore.length > 0);
    assert.deepEqual(thinkingTexts(after), thinkingBefore);
    // The tail segment is re-rendered byte-identically.
    assert.equal(afterMessages.at(-1), beforeMessages.at(-1));
  });

  it("cannot pass by accident: no option, or a payload the stub would enlarge, breaks no pair", async () => {
    const expected = /allowedResets is 1 but only 0 pair\(s\) broke below the minimum/;
    await assert.rejects(
      () =>
        runPrefixStabilityConformance({
          host: bulkFoldingHost(createMiddlewareRegistry()),
          skills: [firstSkill, secondSkill],
          allowedResets: 1,
        }),
      expected,
    );
    await assert.rejects(
      () =>
        runPrefixStabilityConformance({
          host: bulkFoldingHost(createMiddlewareRegistry()),
          skills: [firstSkill, secondSkill],
          allowedResets: 1,
          foldableToolResultBytes: 8,
        }),
      expected,
    );
  });

  it("keeps the default capture unchanged: four requests, no bulk tool, no bulk call", async () => {
    const { middleware, captured } = captureRequests();
    const result = await runPrefixStabilityConformance({ host: host({ middleware }), skills: [firstSkill, secondSkill] });

    assert.equal(result.requests, 4);
    assert.deepEqual(result.resets, []);
    assert.deepEqual(result.resetDetails, []);
    assert.ok(result.minContinuity >= 0.95);
    assert.equal(captured.length, 4);
    for (const request of captured) {
      assert.ok(!(request.tools ?? []).some((tool) => tool.name === BULK_TOOL_NAME));
      assert.ok(!JSON.stringify(request.messages).includes("prefix-stability-bulk-"));
    }
  });

  it("rejects a non-positive foldableToolResultBytes before running anything", async () => {
    await assert.rejects(
      () =>
        runPrefixStabilityConformance({
          host: bulkFoldingHost(createMiddlewareRegistry()),
          skills: [firstSkill, secondSkill],
          foldableToolResultBytes: 0,
        }),
      /foldableToolResultBytes must be a positive safe integer/,
    );
  });
});
