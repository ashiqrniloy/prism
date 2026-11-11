import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  type Agent,
  createAgent,
  createMemorySessionStore,
  type ModelProvider,
  type ProviderEvent,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { packageConformance } from "@arnilo/prism/testing";
import advisor, { HARD_CONTEXT_MAX_CHARS, resolveContext, resolveLimits } from "../index.js";

const agents: Agent[] = [];
afterEach(async () => {
  for (const agent of agents.splice(0)) await agent.dispose();
});

const mock: ModelProvider = {
  id: "mock",
  async *generate(): AsyncIterable<ProviderEvent> {
    yield providerTextDelta("advice");
    yield providerDone({ totalTokens: 2 });
  },
};

async function build(config: Record<string, unknown>): Promise<Agent> {
  const agent = await createAgent({
    id: "advisor-package",
    model: { provider: "mock", model: "m" },
    slots: { store: createMemorySessionStore() },
    packages: [providerPackage("mock-provider", [mock]), advisor(config as never)],
  });
  agents.push(agent);
  return agent;
}

describe("advisor package", () => {
  it("advisor_package_conformance", async () => {
    const result = await packageConformance(advisor, { config: { model: { provider: "mock", model: "m" } } });
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("missing_model_fails_setup_naming_field", async () => {
    await assert.rejects(
      () => build({}),
      (error: unknown) => /model/.test(error instanceof Error ? error.message : String(error)),
    );
  });

  it("unresolvable_model_notes_warn_and_registers_nothing", async () => {
    const agent = await build({ model: "sonnet" });
    const notes = agent.inspect().statusNotes;
    assert.ok(notes.some((note) => note.level === "warn" && /model/.test(note.message)));
    assert.ok(!agent.tools.some((tool) => tool.name === "advise"));
    const hooks = Object.values(agent.inspect().hooks).flat();
    assert.equal(hooks.filter((hook) => hook.owner === "@arnilo/prism-extensions/advisor").length, 0);
  });

  it("unknown_keys_fail_config_validation", async () => {
    await assert.rejects(() => build({ model: { provider: "mock", model: "m" }, nonsense: true }), /nonsense/);
  });

  it("before_finish_and_validate_together_fail_config", async () => {
    await assert.rejects(
      () => build({ model: { provider: "mock", model: "m" }, triggers: { beforeFinish: true }, validate: {} }),
      (error: unknown) =>
        /validate/.test(error instanceof Error ? error.message : String(error)) &&
        /beforeFinish/.test(error instanceof Error ? error.message : String(error)),
    );
  });

  it("out_of_range_values_are_clamped_with_one_note", async () => {
    const agent = await build({
      model: { provider: "mock", model: "m" },
      adviceMaxChars: 999_999,
      maxConsultsPerRun: 999,
      context: { lastTurns: 500, maxChars: 999_999 },
      validate: { maxRounds: 99 },
    });
    const notes = agent.inspect().statusNotes.filter((note) => note.level === "info" && /clamped/.test(note.message));
    assert.equal(notes.length, 1);
    assert.ok(notes[0]);
    for (const field of ["adviceMaxChars", "maxConsultsPerRun", "maxRounds", "lastTurns"])
      assert.match(notes[0].message, new RegExp(field));
    assert.deepEqual(resolveContext({ lastTurns: 500, maxChars: 999_999 }), {
      lastTurns: 50,
      maxChars: HARD_CONTEXT_MAX_CHARS,
      clamped: true,
    });
    assert.equal(resolveLimits({ model: "mock/m", validate: { maxRounds: 99 } }).maxRounds, 10);
  });
});
