import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAgent } from "../agent-session/create-agent.js";
import { withContextBlocks } from "../context-build.js";
import type { Message, ProviderRequest, Session, Skill } from "../contracts.js";
import type { HookRegistrar } from "../hooks/index.js";
import { providerDone, toolCallContent } from "../models/events.js";
import { providerPackage } from "../provider-kit/index.js";
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
    hooks: (hooks) =>
      hooks.on("context.build", (draft) => withContextBlocks(draft, [{ title: "Project", content: "Stable project context." }]), {
        id: "project",
      }),
    ...overrides,
  };
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
    const eagerHost = host({ instructions: "Stable rules." });
    const eagerSkills: [Skill, Skill] = [
      { name: "alpha", description: "Alpha catalog entry", instructions: eagerBody },
      { name: "beta", description: "Beta catalog entry", instructions: eagerBody },
    ];

    const dipped = await runPrefixStabilityConformance({
      host: eagerHost,
      skillsDisclosure: "eager" as const,
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
      skillsDisclosure: "eager" as const,
      skills: eagerSkills,
      assertOn: "cacheablePrefix",
    });
    assert.equal(result.cacheableContinuity, 1);
    assert.ok(result.minContinuity < 0.95, `expected the eager tail to break the provider prefix, got ${result.minContinuity}`);

    await assert.rejects(
      () => runPrefixStabilityConformance({ host: eagerHost, skillsDisclosure: "eager", skills: eagerSkills }),
      /request \d+ → \d+ kept .*of the previous provider prefix/,
    );
  });

  it("classifies cloned tail messages by serialized equality", async () => {
    const cloning = host({
      hooks: (hooks) =>
        hooks.on(
          "context.build",
          (draft) => ({
            ...draft,
            messages: draft.messages.map((message) => ({ ...message, content: message.content.map((block) => ({ ...block })) })),
          }),
          { id: "clone-each" },
        ),
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
      hooks: (hooks) =>
        hooks.on(
          "context.build",
          (draft) => ({
            ...draft,
            messages: [
              {
                role: "user" as const,
                content: [{ type: "text" as const, text: draft.messages.map((message) => JSON.stringify(message)).join("\n") }],
              },
            ],
          }),
          { id: "merged" },
        ),
    });

    const result = await runPrefixStabilityConformance({ host: merged, skills: [firstSkill, secondSkill] });

    assert.equal(result.cacheableContinuity, result.minContinuity);
  });

  it("rejects a host that recomposes a leading context block per request", async () => {
    let turn = 0;
    const volatile = host({
      hooks: (hooks) =>
        hooks.on("context.build", (draft) => withContextBlocks(draft, [{ title: "Project", content: `recomposed-${(turn += 1)}` }]), {
          id: "volatile",
        }),
    });

    await assert.rejects(
      () => runPrefixStabilityConformance({ host: volatile, skills: [firstSkill, secondSkill] }),
      /request \d+ → \d+ kept .*of the previous provider prefix/,
    );
  });

  it("lowers both fractions for a volatile context provider, so the cacheable metric masks no regression", async () => {
    let turn = 0;
    const volatile = host({
      hooks: (hooks) =>
        hooks.on("context.build", (draft) => withContextBlocks(draft, [{ title: "Project", content: `recomposed-${(turn += 1)}` }]), {
          id: "volatile",
        }),
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
      /request \d+ → \d+ kept .*of the previous cacheable prefix \(tail segments excluded\)/,
    );
  });

  it("rejects a host whose context.build handler drops the loaded skill bodies", async () => {
    const dropping = host({
      hooks: (hooks) =>
        hooks.on(
          "context.build",
          (draft) => ({
            ...draft,
            messages: draft.messages.filter(
              (message) => !message.content.some((block) => block.type === "text" && block.text.includes("Alpha body")),
            ),
          }),
          { id: "catalog-only" },
        ),
    });

    await assert.rejects(
      () => runPrefixStabilityConformance({ host: dropping, skills: [firstSkill, secondSkill] }),
      /skill alpha body never reached the provider request/,
    );
  });

  it("fails on a failed fixture run, naming the run's own error", async () => {
    const boom = host({
      hooks: (hooks) =>
        hooks.on(
          "context.build",
          () => {
            throw new Error("prefix fixture boom");
          },
          { id: "boom" },
        ),
    });

    await assert.rejects(
      () => runPrefixStabilityConformance({ host: boom, skills: [firstSkill, secondSkill] }),
      /the first fixture run did not succeed \(failed\): prefix fixture boom/,
    );
  });

  it("testing/prefix-stability-conformance subpath is exported", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.ok(pkg.exports["./testing/prefix-stability-conformance"]);
  });
});

/** Same fixture the runner installs, so a scored capture can be compared to a runner result. */
async function captureFixture(hostConfig: Host, skills: readonly [Skill, Skill], disclosure?: "eager" | "progressive") {
  const requests: ProviderRequest[] = [];
  const registry = createSkillRegistry([...skills]);
  const hostTools = hostConfig.tools?.add ?? [];
  let call = 0;
  const agent = await createAgent({
    ...hostConfig,
    skills: { add: registry.list(), disclosure },
    // No `createLoadSkillTool`: progressive disclosure already registers the kernel's built-in
    // `load_skill`, and a second one fails the run with "Duplicate tool: load_skill".
    tools: { add: [...hostTools] },
    packages: [
      providerPackage("test-provider", [
        {
          id: "mock",
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
      ]),
    ],
  });
  const session = (await agent.session()) as Session & { readonly tailSegments: ReadonlyMap<string, Message> };
  // `limits.maxToolRounds` is the only run option the kernel reads; `activeSkills` is session state
  // (`assemble.ts` derives it), so passing it was dead.
  const runOptions = { limits: { maxToolRounds: 1 } } as const;
  for (const [index, input] of ["Prefix stability turn one", "Prefix stability turn two"].entries()) {
    const result = await session.run(input, runOptions);
    assert.equal(
      result.status,
      "completed",
      `fixture run ${index + 1}: ${result.status}${result.error === undefined ? "" : `: ${result.error.message}`}`,
    );
  }
  return { requests, tailSegments: session.tailSegments };
}

const model = { provider: "mock", model: "demo" } as const;

function text(role: Message["role"], value: string): Message {
  return { role, content: [{ type: "text", text: value }] };
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
    const captured = await captureFixture(host({ instructions: "Stable rules." }), eagerSkills, "eager");
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

/** Captures the runner's own wire requests through the existing `model.request` hook. */
function captureRequests(): { hooks: (registrar: HookRegistrar) => void; captured: ProviderRequest[] } {
  const captured: ProviderRequest[] = [];
  const hooks = (registrar: HookRegistrar) => {
    registrar.on("model.request", (request) => {
      captured.push(request);
      return undefined;
    });
  };
  return { hooks, captured };
}

describe("bulk tool-result fixture (plan 110 Task 4)", () => {
  it("keeps the default capture unchanged: four requests, no bulk tool, no bulk call", async () => {
    const { hooks, captured } = captureRequests();
    const result = await runPrefixStabilityConformance({ host: host({ hooks }), skills: [firstSkill, secondSkill] });

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
          host: host(),
          skills: [firstSkill, secondSkill],
          foldableToolResultBytes: 0,
        }),
      /foldableToolResultBytes must be a positive safe integer/,
    );
  });
});
