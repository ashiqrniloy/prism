import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
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
      `${root}/.agents/instructions/json-always/manifest.json`,
      JSON.stringify({ name: "json-always", resource: "./INSTRUCTIONS.md" }),
    );
    await writeFileDeep(`${root}/.agents/instructions/json-always/INSTRUCTIONS.md`, "Always answer in JSON");

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
      `${root}/.agents/instructions/json-always/manifest.json`,
      JSON.stringify({ name: "json-always", resource: "./INSTRUCTIONS.md" }),
    );
    await writeFileDeep(`${root}/.agents/instructions/json-always/INSTRUCTIONS.md`, "Always answer in JSON");

    const contributions = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });
    const registries = createContributionRegistries();
    await registerDiscoveredInstructionInjectors(registries, contributions);

    const resolved = resolveInstructionInjectors({ registry: registries.instructionInjectors, names: ["json-always"] });
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]?.apply(applyCtx).instructions, "Always answer in JSON");
  });

  it("module-referenced declaration is not auto-imported by core (skipped without a host loader)", async () => {
    const root = await makeRoot("mod-noimport");
    await writeFileDeep(
      `${root}/.agents/instructions/code-inj/manifest.json`,
      JSON.stringify({ name: "code-inj", module: "./inj.js", exportName: "default" }),
    );
    const [contribution] = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });
    const injector = await loadInstructionInjector(contribution);
    assert.equal(injector, undefined, "core must not auto-import module injectors");
  });

  it("module-referenced injector runs when the host supplies a moduleLoader", async () => {
    const root = await makeRoot("mod-load");
    await writeFileDeep(
      `${root}/.agents/instructions/code-inj/manifest.json`,
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

  it("rejects a markdown resource escaping its contribution directory", async () => {
    const root = await makeRoot("escape");
    await writeFileDeep(
      `${root}/.agents/instructions/escape/manifest.json`,
      JSON.stringify({ name: "escape", resource: "../outside.md" }),
    );
    await writeFileDeep(`${root}/.agents/instructions/outside.md`, "outside");

    const [contribution] = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });

    await assert.rejects(() => loadInstructionInjector(contribution), /escapes contribution directory/);
  });

  it("rejects a markdown resource symlink escaping its contribution directory", async () => {
    const root = await makeRoot("resource-link");
    const outside = await mkdtemp(join(tmpdir(), "prism-outside-inj-"));
    await writeFileDeep(`${outside}/outside.md`, "outside");
    await writeFileDeep(
      `${root}/.agents/instructions/link/manifest.json`,
      JSON.stringify({ name: "link", resource: "./INSTRUCTIONS.md" }),
    );
    await symlink(`${outside}/outside.md`, `${root}/.agents/instructions/link/INSTRUCTIONS.md`);

    const [contribution] = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });

    await assert.rejects(() => loadInstructionInjector(contribution), /escapes contribution directory/);
  });

  it("checks resource permission before reading markdown text", async () => {
    const root = await makeRoot("resource-permission");
    await writeFileDeep(
      `${root}/.agents/instructions/blocked/manifest.json`,
      JSON.stringify({ name: "blocked", resource: "./missing.md" }),
    );
    const [contribution] = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });

    await assert.rejects(
      () => loadInstructionInjector(contribution, { permission: { check: () => ({ allowed: false, reason: "blocked" }) } }),
      /blocked/,
    );
  });

  it("loads an escaping markdown resource only when host trust allows it and permission passes", async () => {
    const root = await makeRoot("resource-trusted");
    const outside = await mkdtemp(join(tmpdir(), "prism-trusted-inj-"));
    await writeFileDeep(`${outside}/shared.md`, "trusted outside");
    await writeFileDeep(
      `${root}/.agents/instructions/trusted/manifest.json`,
      JSON.stringify({ name: "trusted", resource: `${outside}/shared.md` }),
    );
    const checked: string[] = [];
    const [contribution] = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });

    const injector = await loadInstructionInjector(contribution, {
      resourceTrust: { check: (req) => ({ trusted: req.target === `${outside}/shared.md` }) },
      permission: { check: (req) => { checked.push(`${req.kind}:${req.action}:${req.target}`); return { allowed: true }; } },
    });

    assert.equal(injector?.apply(applyCtx).instructions, "trusted outside");
    assert.deepEqual(checked, [`resource:load:${outside}/shared.md`]);
  });

  it("loadInstructionInjectors ignores non-instructions contributions", async () => {
    const root = await makeRoot("mixed");
    await writeFileDeep(`${root}/.agents/skills/a-skill/SKILL.md`, "---\nname: a-skill\n---\nbody\n");
    await writeFileDeep(`${root}/.agents/instructions/md/manifest.json`, JSON.stringify({ name: "md", resource: "./INSTRUCTIONS.md" }));
    await writeFileDeep(`${root}/.agents/instructions/md/INSTRUCTIONS.md`, "rule");

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
