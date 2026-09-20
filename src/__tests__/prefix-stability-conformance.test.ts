import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { PromptBuildRequest, Skill } from "../contracts.js";
import { type PrefixStabilityConformanceOptions, runPrefixStabilityConformance } from "../testing/prefix-stability-conformance.js";

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
