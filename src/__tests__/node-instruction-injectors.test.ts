import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { discoverContributions } from "../node/contribution-discovery.js";
import {
  loadInstructionInjector,
  loadInstructionInjectors,
  registerDiscoveredInstructionInjectors,
} from "../node/instruction-injectors.js";
import { createContributionRegistries, resolveInstructionInjectors } from "../index.js";
import type { DiscoveredContribution, InstructionInjector } from "../contracts.js";

async function makeRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-inj-${prefix}-`));
}
async function writeFileDeep(path: string, text: string): Promise<void> {
  await mkdir(path.split("/").slice(0, -1).join("/"), { recursive: true });
  await writeFile(path, text, "utf8");
}
const signal = () => new AbortController().signal;
const applyCtx = { sessionId: "s", runId: "r", turn: 1, input: [], history: [], metadata: {}, signal: signal() };

describe("loadInstructionInjector (Phase 30 Task 7)", () => {
  it("loads a markdown-only discovered instructions contribution as a static every_turn injector", async () => {
    const root = await makeRoot("md");
    await writeFileDeep(
      `${root}/.agent/instructions/json-always/manifest.json`,
      JSON.stringify({ name: "json-always", resource: "./INSTRUCTIONS.md" }),
    );
    await writeFileDeep(`${root}/.agent/instructions/json-always/INSTRUCTIONS.md`, "Always answer in JSON");

    const [contribution] = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });
    assert.equal(contribution?.kind, "instructions");
    const injector = await loadInstructionInjector(contribution);
    assert.equal(injector?.name, "json-always");
    const out = injector!.apply(applyCtx);
    assert.equal(out.instructions, "Always answer in JSON");
    assert.equal(out.when, "every_turn");
  });

  it("loads a markdown injector selectable by name from the registry", async () => {
    const root = await makeRoot("reg");
    await writeFileDeep(
      `${root}/.agent/instructions/json-always/manifest.json`,
      JSON.stringify({ name: "json-always", resource: "./INSTRUCTIONS.md" }),
    );
    await writeFileDeep(`${root}/.agent/instructions/json-always/INSTRUCTIONS.md`, "Always answer in JSON");

    const contributions = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });
    const registries = createContributionRegistries();
    await registerDiscoveredInstructionInjectors(registries, contributions);

    const resolved = resolveInstructionInjectors({ registry: registries.instructionInjectors, names: ["json-always"] });
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.apply(applyCtx).instructions, "Always answer in JSON");
  });

  it("workspace same-name injector overrides global (Phase 29 merge order)", async () => {
    const ws = await makeRoot("ws-override");
    const global = await mkdtemp(join(tmpdir(), "prism-inj-global-"));
    await writeFileDeep(`${global}/.prism/agent/instructions/dup/manifest.json`, JSON.stringify({ name: "dup", resource: "./INSTRUCTIONS.md" }));
    await writeFileDeep(`${global}/.prism/agent/instructions/dup/INSTRUCTIONS.md`, "global text");
    await writeFileDeep(`${ws}/.agent/instructions/dup/manifest.json`, JSON.stringify({ name: "dup", resource: "./INSTRUCTIONS.md" }));
    await writeFileDeep(`${ws}/.agent/instructions/dup/INSTRUCTIONS.md`, "workspace text");

    const contributions = await discoverContributions({ kinds: ["instructions"], workspaceRoot: ws, globalRoot: global });
    // scanner dedupes: one entry, workspace wins
    assert.equal(contributions.length, 1);
    assert.equal(contributions[0]?.origin, "workspace");
    const injector = await loadInstructionInjector(contributions[0]);
    assert.equal(injector?.apply(applyCtx).instructions, "workspace text");
  });

  it("module-referenced declaration is not auto-imported by core (skipped without a host loader)", async () => {
    const root = await makeRoot("mod-noimport");
    await writeFileDeep(
      `${root}/.agent/instructions/code-inj/manifest.json`,
      JSON.stringify({ name: "code-inj", module: "./inj.js", exportName: "default" }),
    );
    const [contribution] = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });
    const injector = await loadInstructionInjector(contribution);
    assert.equal(injector, undefined, "core must not auto-import module injectors");
  });

  it("module-referenced injector runs when the host supplies a moduleLoader", async () => {
    const root = await makeRoot("mod-load");
    await writeFileDeep(
      `${root}/.agent/instructions/code-inj/manifest.json`,
      JSON.stringify({ name: "code-inj", module: "./inj.js", exportName: "schemaInjector" }),
    );
    const live: InstructionInjector = {
      name: "irrelevant", // overridden by contribution name
      apply: (ctx) => ({ instructions: `schema on turn ${ctx.turn}`, when: "on_input", predicate: (c) => c.turn === 1 }),
    };
    const [contribution] = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });
    const injector = await loadInstructionInjector(contribution, {
      moduleLoader: async () => live,
    });
    assert.equal(injector?.name, "code-inj", "adapter pins name to the contribution name");
    const out = injector!.apply({ ...applyCtx, turn: 1 });
    assert.equal(out.instructions, "schema on turn 1");
    assert.equal(out.when, "on_input");
  });

  it("in-memory SDK path (no loader) keeps registries.instructionInjectors empty; name resolution fails closed", () => {
    const registries = createContributionRegistries();
    assert.equal(registries.instructionInjectors.list().length, 0);
    assert.throws(
      () => resolveInstructionInjectors({ registry: registries.instructionInjectors, names: ["x"] }),
      /Unknown instruction injector: x/,
    );
  });

  it("loadInstructionInjectors ignores non-instructions contributions", async () => {
    const root = await makeRoot("mixed");
    await writeFileDeep(`${root}/.agent/skills/a-skill/SKILL.md`, "---\nname: a-skill\n---\nbody\n");
    await writeFileDeep(`${root}/.agent/instructions/md/manifest.json`, JSON.stringify({ name: "md", resource: "./INSTRUCTIONS.md" }));
    await writeFileDeep(`${root}/.agent/instructions/md/INSTRUCTIONS.md`, "rule");

    const contributions = await discoverContributions({ kinds: ["skill", "instructions"], workspaceRoot: root });
    const injectors = await loadInstructionInjectors(contributions);
    assert.equal(injectors.length, 1);
    assert.equal(injectors[0]?.name, "md");
  });

  it("returns undefined for a non-instructions contribution (type guard)", async () => {
    const fake = { kind: "skill", name: "x", origin: "workspace", path: "/x" } as unknown as DiscoveredContribution;
    const injector = await loadInstructionInjector(fake);
    assert.equal(injector, undefined);
  });
});
