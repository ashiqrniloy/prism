import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, ProviderRequest } from "@arnilo/prism";
import { HARD_MAX_SKILL_INSTRUCTION_BYTES, createAgent, providerDone } from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import { createMockProvider } from "@arnilo/prism/testing";
import { type ContextFilesConfig, contextFiles } from "../index.js";

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-context-skills-"));
  dirs.push(dir);
  return dir;
}

async function writeSkill(root: string, name: string, description: string, body = `${name} body`): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  await writeFile(path, `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
  return path;
}

async function load(
  root: string,
  config: Omit<ContextFilesConfig, "root"> = {},
  extra: Partial<Parameters<typeof createAgent>[0]> = {},
): Promise<Agent> {
  return await createAgent({
    model: { provider: "mock", model: "m" },
    packages: [contextFiles({ root, ...config })],
    ...extra,
  });
}

function skillNames(agent: Agent): readonly string[] {
  return agent.skills.map((skill) => skill.name).sort();
}

function notes(agent: Agent): string {
  return agent
    .inspect()
    .statusNotes.map((note) => `${note.level}:${note.message}`)
    .join("\n");
}

function capturingProvider(captured: ProviderRequest[]) {
  return providerPackage("capture", [createMockProvider([providerDone()], { onRequest: (request) => captured.push(request) })]);
}

function systemText(request: ProviderRequest | undefined): string {
  const first = request?.messages[0];
  return (first?.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n") ?? "").replace(
    /^System instruction:\n/,
    "",
  );
}

describe("context-files skill discovery", () => {
  it("discovers_agents_and_claude_skill_dirs", async () => {
    const root = await tempRoot();
    await writeSkill(join(root, ".agents", "skills"), "alpha", "Alpha skill.");
    await writeSkill(join(root, ".claude", "skills"), "beta", "Beta skill.");
    const agent = await load(root);
    try {
      assert.deepEqual(skillNames(agent), ["alpha", "beta"]);
      assert.deepEqual(
        agent.skills.map((skill) => skill.package),
        ["@arnilo/prism-context-files", "@arnilo/prism-context-files"],
      );
    } finally {
      await agent.dispose();
    }
  });

  it("symlinked_root_scanned_once", async () => {
    const root = await tempRoot();
    await writeSkill(join(root, ".agents", "skills"), "alpha", "Alpha skill.");
    await mkdir(join(root, ".claude"), { recursive: true });
    await symlink(join(root, ".agents", "skills"), join(root, ".claude", "skills"), "dir");
    const agent = await load(root);
    try {
      assert.deepEqual(skillNames(agent), ["alpha"]);
      assert.equal(notes(agent).includes("already registered from"), false, "the symlinked root was scanned twice");
    } finally {
      await agent.dispose();
    }
  });

  it("project_skill_wins_over_global_duplicate_with_note", async () => {
    const root = await tempRoot();
    const global = await tempRoot();
    await writeSkill(join(root, ".agents", "skills"), "shared", "project version");
    const globalPath = await writeSkill(join(global, ".agents", "skills"), "shared", "global version");
    const agent = await load(root, { globalRoot: global });
    try {
      assert.deepEqual(skillNames(agent), ["shared"]);
      assert.equal(agent.skills[0]?.description, "project version");
      assert.match(notes(agent), new RegExp(`skipped skill .*${globalPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    } finally {
      await agent.dispose();
    }
  });

  it("global_roots_require_global_root", async () => {
    const root = await tempRoot();
    const home = await tempRoot();
    await writeSkill(join(home, ".claude", "skills"), "home-skill", "Home skill.");
    await writeSkill(join(home, ".codex", "skills"), "codex-skill", "Codex skill.");
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const without = await load(root);
      try {
        assert.deepEqual(skillNames(without), []);
      } finally {
        await without.dispose();
      }
      const withRoot = await load(root, { globalRoot: home });
      try {
        assert.deepEqual(skillNames(withRoot), ["codex-skill", "home-skill"]);
      } finally {
        await withRoot.dispose();
      }
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });

  it("requires_tools_malformed_discovered_skill_skipped_with_note", async () => {
    const root = await tempRoot();
    const skills = join(root, ".agents", "skills");
    await writeSkill(skills, "good", "Good skill.");
    const dir = join(skills, "gated");
    await mkdir(dir, { recursive: true });
    const bad = join(dir, "SKILL.md");
    await writeFile(bad, "---\nname: gated\ndescription: d\nmetadata:\n  prism-requires-tools: bad/name\n---\nbody\n");
    const ok = join(skills, "ok");
    await mkdir(ok, { recursive: true });
    await writeFile(join(ok, "SKILL.md"), "---\nname: ok\ndescription: d\nmetadata:\n  prism-requires-tools: web_search memory.recall\n---\nbody\n");
    const agent = await load(root);
    try {
      assert.deepEqual(skillNames(agent), ["good", "ok"]);
      assert.match(notes(agent), /skipped skill .*gated.*prism-requires-tools/);
      assert.deepEqual(agent.skills.find((skill) => skill.name === "ok")?.requiresTools, ["web_search", "memory.recall"]);
    } finally {
      await agent.dispose();
    }
  });

  it("malformed_skill_skipped_with_note_not_thrown", async () => {
    const root = await tempRoot();
    await writeSkill(join(root, ".agents", "skills"), "good", "Good skill.");
    const bad = await writeSkill(join(root, ".agents", "skills"), "bad!", "Broken skill.");
    const dir = join(root, ".agents", "skills", "huge");
    await mkdir(dir, { recursive: true });
    const huge = join(dir, "SKILL.md");
    await writeFile(huge, `---\nname: huge\n---\n${"x".repeat(HARD_MAX_SKILL_INSTRUCTION_BYTES + 1)}`);
    const agent = await load(root);
    try {
      assert.deepEqual(skillNames(agent), ["good"]);
      assert.match(notes(agent), new RegExp(`skipped skill .*${bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.match(notes(agent), new RegExp(`skipped skill .*${huge.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    } finally {
      await agent.dispose();
    }
  });

  it("skill_conflict_with_host_skipped_with_note", async () => {
    const root = await tempRoot();
    const path = await writeSkill(join(root, ".agents", "skills"), "shared", "disk version");
    const agent = await load(root, {}, { skills: { add: [{ name: "shared", description: "host version", instructions: "host" }] } });
    try {
      assert.deepEqual(skillNames(agent), ["shared"]);
      assert.equal(agent.skills[0]?.description, "host version");
      assert.match(notes(agent), new RegExp(`skipped skill .*${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    } finally {
      await agent.dispose();
    }
  });

  it("skill_escaping_trusted_root_skipped", async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    const outsidePath = await writeSkill(outside, "evil", "Escaped skill.");
    const dir = join(root, ".agents", "skills", "evil");
    await mkdir(dir, { recursive: true });
    const candidate = join(dir, "SKILL.md");
    await symlink(outsidePath, candidate);
    const agent = await load(root);
    try {
      assert.deepEqual(skillNames(agent), []);
      assert.match(notes(agent), new RegExp(`skipped skill .*${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: outside trusted roots`));
    } finally {
      await agent.dispose();
    }
  });

  it("skills_config_enabled_and_roots_control_discovery", async () => {
    const root = await tempRoot();
    await writeSkill(join(root, ".agents", "skills"), "default-skill", "Default skill.");
    const custom = join(root, "custom-skills");
    await writeSkill(custom, "custom-skill", "Custom skill.");

    const disabled = await load(root, { skills: { enabled: false } });
    try {
      assert.deepEqual(skillNames(disabled), []);
    } finally {
      await disabled.dispose();
    }

    const replaced = await load(root, { skills: { roots: ["custom-skills"] } });
    try {
      assert.deepEqual(skillNames(replaced), ["custom-skill"]);
    } finally {
      await replaced.dispose();
    }

    const empty = await load(root, { skills: { roots: [] } });
    try {
      assert.deepEqual(skillNames(empty), []);
    } finally {
      await empty.dispose();
    }
  });

  it("claude_md_used_when_agents_md_absent", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "CLAUDE.md"), "CLAUDE-RULE");
    const captured: ProviderRequest[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [capturingProvider(captured), contextFiles({ root })],
      instructions: "BASE",
    });
    const session = await agent.session();
    try {
      await session.run("hi");
      assert.equal(systemText(captured[0]), "BASE\n\nCLAUDE-RULE");
    } finally {
      await agent.dispose();
    }
  });

  it("agents_md_wins_over_claude_md", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "AGENTS.md"), "AGENTS-RULE");
    await writeFile(join(root, "CLAUDE.md"), "CLAUDE-RULE");
    const captured: ProviderRequest[] = [];
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [capturingProvider(captured), contextFiles({ root })],
      instructions: "BASE",
    });
    const session = await agent.session();
    try {
      await session.run("hi");
      assert.equal(systemText(captured[0]), "BASE\n\nAGENTS-RULE");
    } finally {
      await agent.dispose();
    }
  });

  it("allowed_tools_metadata_grants_nothing", async () => {
    const root = await tempRoot();
    const dir = join(root, ".agents", "skills", "safe");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "---\nname: safe\ndescription: Safe skill.\nallowed-tools: read, write, edit\n---\nBody.\n");
    const agent = await load(root);
    try {
      assert.deepEqual(skillNames(agent), ["safe"]);
      assert.equal(
        agent.inspect().tools.some((tool) => ["read", "write", "edit"].includes(tool.name)),
        false,
        "an allowed-tools frontmatter field granted a tool",
      );
    } finally {
      await agent.dispose();
    }
  });
});
