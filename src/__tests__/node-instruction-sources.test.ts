import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";
import type { DiscoveredContribution } from "../contracts.js";
import { discoverContributions } from "../node/contribution-discovery.js";
import { loadInstructionSource, loadInstructionSources } from "../node/instruction-sources.js";

async function makeRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-inj-${prefix}-`));
}
async function writeFileDeep(path: string, text: string): Promise<void> {
  await mkdir(path.split("/").slice(0, -1).join("/"), { recursive: true });
  await writeFile(path, text, "utf8");
}
describe("loadInstructionSource (Phase 30 Task 7)", () => {
  it("loads a markdown-only discovered instructions contribution as a static source", async () => {
    const root = await makeRoot("md");
    await writeFileDeep(
      `${root}/.agents/instructions/json-always/manifest.json`,
      JSON.stringify({ name: "json-always", resource: "./INSTRUCTIONS.md" }),
    );
    await writeFileDeep(`${root}/.agents/instructions/json-always/INSTRUCTIONS.md`, "Always answer in JSON");

    const [contribution] = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });
    assert.equal(contribution?.kind, "instructions");
    const source = await loadInstructionSource(contribution);
    assert.equal(source?.name, "json-always");
    assert.equal(source?.instructions, "Always answer in JSON");
  });

  it("project_instructions_still_require_trust", async () => {
    const root = await makeRoot("reg");
    await writeFileDeep(
      `${root}/.agents/instructions/json-always/manifest.json`,
      JSON.stringify({ name: "json-always", resource: "./INSTRUCTIONS.md" }),
    );
    await writeFileDeep(`${root}/.agents/instructions/json-always/INSTRUCTIONS.md`, "Always answer in JSON");

    const contributions = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });
    const sources = await loadInstructionSources(contributions);
    const byName = new Map(sources.map((source) => [source.name, source]));
    assert.equal(byName.size, 1);
    assert.equal(byName.get("json-always")?.instructions, "Always answer in JSON");
  });

  it("module-referenced declaration is not auto-imported by core (skipped without a host loader)", async () => {
    const root = await makeRoot("mod-noimport");
    await writeFileDeep(
      `${root}/.agents/instructions/code-inj/manifest.json`,
      JSON.stringify({ name: "code-inj", module: "./inj.js", exportName: "default" }),
    );
    const [contribution] = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });
    const source = await loadInstructionSource(contribution);
    assert.equal(source, undefined, "core must not auto-import module instruction sources");
  });

  it("module-referenced source loads when the host supplies a moduleLoader", async () => {
    const root = await makeRoot("mod-load");
    await writeFileDeep(
      `${root}/.agents/instructions/code-inj/manifest.json`,
      JSON.stringify({ name: "code-inj", module: "./inj.js", exportName: "schemaInjector" }),
    );
    const [contribution] = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });
    const source = await loadInstructionSource(contribution, {
      moduleLoader: async () => ({ instructions: "schema" }),
    });
    assert.equal(source?.name, "code-inj", "adapter pins name to the contribution name");
    assert.equal(source?.instructions, "schema");
  });

  it("rejects a markdown resource escaping its contribution directory", async () => {
    const root = await makeRoot("escape");
    await writeFileDeep(`${root}/.agents/instructions/escape/manifest.json`, JSON.stringify({ name: "escape", resource: "../outside.md" }));
    await writeFileDeep(`${root}/.agents/instructions/outside.md`, "outside");

    const [contribution] = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });

    await assert.rejects(() => loadInstructionSource(contribution), /escapes contribution directory/);
  });

  it("rejects a markdown resource symlink escaping its contribution directory", async () => {
    const root = await makeRoot("resource-link");
    const outside = await mkdtemp(join(tmpdir(), "prism-outside-inj-"));
    await writeFileDeep(`${outside}/outside.md`, "outside");
    await writeFileDeep(`${root}/.agents/instructions/link/manifest.json`, JSON.stringify({ name: "link", resource: "./INSTRUCTIONS.md" }));
    await symlink(`${outside}/outside.md`, `${root}/.agents/instructions/link/INSTRUCTIONS.md`);

    const [contribution] = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });

    await assert.rejects(() => loadInstructionSource(contribution), /escapes contribution directory/);
  });

  it("checks resource permission before reading markdown text", async () => {
    const root = await makeRoot("resource-permission");
    await writeFileDeep(
      `${root}/.agents/instructions/blocked/manifest.json`,
      JSON.stringify({ name: "blocked", resource: "./missing.md" }),
    );
    const [contribution] = await discoverContributions({ kinds: ["instructions"], workspaceRoot: root });

    await assert.rejects(
      () => loadInstructionSource(contribution, { permission: { check: () => ({ allowed: false, reason: "blocked" }) } }),
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

    const source = await loadInstructionSource(contribution, {
      resourceTrust: { check: (req) => ({ trusted: req.target === `${outside}/shared.md` }) },
      permission: {
        check: (req) => {
          checked.push(`${req.kind}:${req.action}:${req.target}`);
          return { allowed: true };
        },
      },
    });

    assert.equal(source?.instructions, "trusted outside");
    assert.deepEqual(checked, [`resource:load:${outside}/shared.md`]);
  });

  it("loadInstructionSources ignores non-instructions contributions", async () => {
    const root = await makeRoot("mixed");
    await writeFileDeep(`${root}/.agents/skills/a-skill/SKILL.md`, "---\nname: a-skill\n---\nbody\n");
    await writeFileDeep(`${root}/.agents/instructions/md/manifest.json`, JSON.stringify({ name: "md", resource: "./INSTRUCTIONS.md" }));
    await writeFileDeep(`${root}/.agents/instructions/md/INSTRUCTIONS.md`, "rule");

    const contributions = await discoverContributions({ kinds: ["skill", "instructions"], workspaceRoot: root });
    const sources = await loadInstructionSources(contributions);
    assert.equal(sources.length, 1);
    assert.equal(sources[0]?.name, "md");
  });

  it("returns undefined for a non-instructions contribution (type guard)", async () => {
    const fake = { kind: "skill", name: "x", origin: "workspace", path: "/x" } as unknown as DiscoveredContribution;
    const injector = await loadInstructionSource(fake);
    assert.equal(injector, undefined);
  });
});
