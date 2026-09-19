import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { PromptBuildRequest, Skill } from "../contracts.js";
import { runPrefixStabilityConformance, type PrefixStabilityConformanceOptions } from "../testing/prefix-stability-conformance.js";

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

describe("prefix stability conformance", () => {
  it("passes against the default cache-aware assembly with staggered skill loads", async () => {
    const result = await runPrefixStabilityConformance({ host: host(), skills: [firstSkill, secondSkill] });

    assert.equal(result.requests, 4);
    assert.ok(result.minContinuity >= 0.95, `expected ≥95% shared prefix, got ${result.minContinuity}`);
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
});
