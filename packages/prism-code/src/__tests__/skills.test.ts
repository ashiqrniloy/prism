import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AIProvider, ProviderRequest } from "@arnilo/prism";
import { providerDone, providerTextDelta } from "@arnilo/prism";
import { assembleAppAgent } from "../headless.js";
import { createSkillCommands, findRepoRoot, formatSkillsList, inspectSkills, isUserOwned, resolveSkillRoots } from "../skills.js";
import { handleSlashCommand } from "../tui/commands.js";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-code-skills-${prefix}-`));
}

async function createSkillFile(dir: string, name: string, description: string, instructions: string): Promise<string> {
  const skillDir = join(dir, name);
  await mkdir(skillDir, { recursive: true });
  const content = `---
name: ${name}
description: ${description}
---

${instructions}
`;
  const filePath = join(skillDir, "SKILL.md");
  await writeFile(filePath, content, "utf8");
  return filePath;
}

describe("skills plane: discovery, roots, and precedence", () => {
  it("findRepoRoot discovers git root upwards and falls back to cwd", async () => {
    const root = await makeTempDir("find-repo-root");
    try {
      const gitDir = join(root, ".git");
      await mkdir(gitDir, { recursive: true });

      const deepDir = join(root, "packages", "sub", "deep");
      await mkdir(deepDir, { recursive: true });

      // Inside git repo
      assert.strictEqual(findRepoRoot(deepDir), root);
      assert.strictEqual(findRepoRoot(root), root);

      // Outside git repo
      const nonRepo = await makeTempDir("non-repo");
      try {
        assert.strictEqual(findRepoRoot(nonRepo), nonRepo);
      } finally {
        await rm(nonRepo, { recursive: true, force: true });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves 5 discovery roots in increasing precedence", async () => {
    const tempDir = await makeTempDir("roots-precedence");
    try {
      const agentsHome = join(tempDir, "mock-home-agents");
      const prismHome = join(tempDir, "mock-home-prism");
      const configDir = join(tempDir, "custom-skills");
      const repoRoot = join(tempDir, "my-repo");

      const roots = resolveSkillRoots({ cwd: repoRoot, skills: { dirs: [configDir] } }, prismHome, repoRoot, agentsHome);

      assert.strictEqual(roots.length, 5);
      // 1. ~/.agents/agent/skills (origin global)
      assert.strictEqual(roots[0]?.dir, join(agentsHome, ".agents", "agent", "skills"));
      assert.strictEqual(roots[0]?.origin, "global");

      // 2. ~/.prism/agent/skills (origin global)
      assert.strictEqual(roots[1]?.dir, join(prismHome, "agent", "skills"));
      assert.strictEqual(roots[1]?.origin, "global");

      // 3. skills.dirs (origin workspace)
      assert.strictEqual(roots[2]?.dir, configDir);
      assert.strictEqual(roots[2]?.origin, "workspace");

      // 4. <repo>/.agents/skills (compat, origin workspace)
      assert.strictEqual(roots[3]?.dir, join(repoRoot, ".agents", "skills"));
      assert.strictEqual(roots[3]?.origin, "workspace");

      // 5. <repo>/.agents/agent/skills (origin workspace)
      assert.strictEqual(roots[4]?.dir, join(repoRoot, ".agents", "agent", "skills"));
      assert.strictEqual(roots[4]?.origin, "workspace");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("skills.compat: false disables the compat <repo>/.agents/skills root", async () => {
    const tempDir = await makeTempDir("compat-false");
    try {
      const repoRoot = join(tempDir, "my-repo");
      const roots = resolveSkillRoots(
        { cwd: repoRoot, skills: { compat: false } },
        join(tempDir, "prism"),
        repoRoot,
        join(tempDir, "agents"),
      );

      // Should not include <repo>/.agents/skills
      assert.ok(!roots.some((r) => r.dir === join(repoRoot, ".agents", "skills")));
      // Still includes <repo>/.agents/agent/skills
      assert.ok(roots.some((r) => r.dir === join(repoRoot, ".agents", "agent", "skills")));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("inspectSkills resolves layer origins, collision precedence, and shadowed layers", async () => {
    const tempDir = await makeTempDir("inspect-skills");
    try {
      const agentsHome = join(tempDir, "agents-home");
      const prismHome = join(tempDir, "prism-home");
      const configDir = join(tempDir, "config-skills");
      const repoRoot = join(tempDir, "repo");

      // 1. ~/.agents/agent/skills: skill-agents & colliding
      await createSkillFile(
        join(agentsHome, ".agents", "agent", "skills"),
        "agents-only",
        "Agents global skill",
        "Instructions from agents global",
      );
      await createSkillFile(
        join(agentsHome, ".agents", "agent", "skills"),
        "colliding",
        "Colliding skill from agents",
        "Instructions from agents global",
      );

      // 2. ~/.prism/agent/skills: colliding
      await createSkillFile(
        join(prismHome, "agent", "skills"),
        "colliding",
        "Colliding skill from prism",
        "Instructions from prism global",
      );

      // 3. config skills.dirs: config-only & colliding
      await createSkillFile(configDir, "config-only", "Config skill", "Instructions from config dir");
      await createSkillFile(configDir, "colliding", "Colliding skill from config", "Instructions from config dir");

      // 4. <repo>/.agents/agent/skills: project-only & colliding
      await createSkillFile(join(repoRoot, ".agents", "agent", "skills"), "project-only", "Project skill", "Instructions from project");
      await createSkillFile(
        join(repoRoot, ".agents", "agent", "skills"),
        "colliding",
        "Colliding skill from project",
        "Instructions from project",
      );

      const skills = await inspectSkills(
        { cwd: repoRoot, skills: { dirs: [configDir] } },
        {
          home: prismHome,
          repoRoot,
          agentsHome,
          loadedSkillNames: ["project-only"],
        },
      );

      assert.strictEqual(skills.length, 4);

      const colliding = skills.find((s) => s.name === "colliding");
      assert.ok(colliding);
      // Project root is highest precedence, so it wins
      assert.strictEqual(colliding.origin, "project");
      assert.deepStrictEqual(colliding.shadowedOrigins, ["agents", "prism", "config"]);

      const agentsOnly = skills.find((s) => s.name === "agents-only");
      assert.ok(agentsOnly);
      assert.strictEqual(agentsOnly.origin, "agents");
      assert.strictEqual(agentsOnly.loaded, false);

      const configOnly = skills.find((s) => s.name === "config-only");
      assert.ok(configOnly);
      assert.strictEqual(configOnly.origin, "config");

      const projectOnly = skills.find((s) => s.name === "project-only");
      assert.ok(projectOnly);
      assert.strictEqual(projectOnly.origin, "project");
      assert.strictEqual(projectOnly.loaded, true);

      // Test formatting
      const formatted = formatSkillsList(skills);
      assert.ok(formatted.includes("Skills (4 available, 1 loaded):"));
      assert.ok(formatted.includes("• colliding [project] (overrode agents, prism, config) [not loaded]"));
      assert.ok(formatted.includes("• project-only [project] [loaded]"));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("skills.exclude filters skills out of discovery and inspection", async () => {
    const tempDir = await makeTempDir("skills-exclude");
    try {
      const repoRoot = join(tempDir, "repo");
      await createSkillFile(join(repoRoot, ".agents", "agent", "skills"), "kept-skill", "Kept", "Kept body");
      await createSkillFile(join(repoRoot, ".agents", "agent", "skills"), "excluded-skill", "Excluded", "Excluded body");

      const skills = await inspectSkills({ cwd: repoRoot, skills: { exclude: ["excluded-skill"] } }, { repoRoot });

      assert.strictEqual(skills.length, 1);
      assert.strictEqual(skills[0]?.name, "kept-skill");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("skills plane: slash commands", () => {
  it("createSkillCommands provides /skills and /skill commands", async () => {
    const tempDir = await makeTempDir("slash-cmds");
    try {
      const repoRoot = join(tempDir, "repo");
      await createSkillFile(join(repoRoot, ".agents", "agent", "skills"), "cmd-test-skill", "Command test skill", "Do things");

      const commands = createSkillCommands({ cwd: repoRoot });
      const skillsCmd = commands.find((c) => c.name === "skills");
      const skillCmd = commands.find((c) => c.name === "skill");

      assert.ok(skillsCmd);
      assert.ok(skillCmd);

      const loadedNames: string[] = [];
      const mockSession = {
        id: "test-sess",
        getLoadedSkillNames: () => loadedNames,
        restoreLoadedSkills: (names: readonly string[]) => {
          loadedNames.push(...names);
        },
      };

      // 1. Run /skills before loading
      const skillsRes = await skillsCmd.execute({}, { metadata: { session: mockSession } });
      assert.strictEqual(skillsRes.name, "skills");
      const skillsText = skillsRes.content?.[0]?.type === "text" ? skillsRes.content[0].text : "";
      assert.ok(skillsText.includes("cmd-test-skill [project] [not loaded]"));

      // 2. Run /skill without name -> error
      const errRes = await skillCmd.execute({}, { metadata: { session: mockSession } });
      assert.strictEqual(errRes.name, "skill");
      assert.ok(errRes.error?.message.includes("Usage: /skill <name>"));

      // 3. Run /skill cmd-test-skill -> success
      const loadRes = await skillCmd.execute({ text: "cmd-test-skill" }, { metadata: { session: mockSession } });
      assert.strictEqual(loadRes.name, "skill");
      assert.deepStrictEqual(loadedNames, ["cmd-test-skill"]);

      // 4. Run /skills after loading -> loaded state reflected
      const skillsRes2 = await skillsCmd.execute({}, { metadata: { session: mockSession } });
      const skillsText2 = skillsRes2.content?.[0]?.type === "text" ? skillsRes2.content[0].text : "";
      assert.ok(skillsText2.includes("cmd-test-skill [project] [loaded]"));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("skills plane: progressive disclosure and load_skill tool", () => {
  it("progressive disclosure: catalog in turn 1 without body, body in turn 2 after load_skill", async () => {
    const tempDir = await makeTempDir("progressive-disclosure");
    try {
      const repoRoot = join(tempDir, "repo");
      const _skillPath = await createSkillFile(
        join(repoRoot, ".agents", "agent", "skills"),
        "linter",
        "Project linter skill",
        "You must run linter before saving any code.",
      );

      const recordedRequests: ProviderRequest[] = [];
      const mockProvider: AIProvider = {
        id: "mock-prov",
        async *generate(req) {
          recordedRequests.push(req);
          yield providerTextDelta("Mock turn response");
          yield providerDone();
        },
      };

      const definition = await assembleAppAgent(
        {
          cwd: repoRoot,
          tools: { planes: { coding: false } },
        },
        mockProvider,
      );

      // Verify load_skill tool is registered by default
      const tools = definition.agent.config.tools as any;
      const loadSkillTool = tools.resolve("load_skill");
      assert.ok(loadSkillTool, "load_skill tool should be registered by default");

      const session = definition.createSession({ id: "test-prog-session" });

      // Turn 1
      await session.run("First prompt");
      assert.strictEqual(recordedRequests.length, 1);
      const turn1Messages = recordedRequests[0]?.messages ?? [];

      // Turn 1 must contain the catalog entry
      const catalogMsg = turn1Messages.find(
        (m) => m.role === "system" && m.content.some((c) => c.type === "text" && c.text.includes("Skill linter: Project linter skill")),
      );
      assert.ok(catalogMsg, "Turn 1 must contain the skill catalog line");

      // Turn 1 must NOT contain the skill body
      const hasBodyTurn1 = turn1Messages.some((m) =>
        m.content.some((c) => c.type === "text" && c.text.includes("You must run linter before saving")),
      );
      assert.strictEqual(hasBodyTurn1, false, "Turn 1 must not contain the skill body");

      // Load the skill using load_skill tool
      const toolContext: any = {
        toolCallId: "call_1",
        metadata: {
          loadedSkills: (session as any).loadedSkills,
          activeTools: tools.list(),
          activeSkillNames: ["linter"],
        },
      };
      const loadResult = await loadSkillTool.execute({ name: "linter" }, toolContext);
      assert.strictEqual(loadResult.name, "load_skill");
      assert.strictEqual(loadResult.value?.ok, true);
      // Tool output must contain the skill directory
      const skillDir = join(repoRoot, ".agents", "agent", "skills", "linter");
      const loadText = typeof (loadResult.value as any)?.text === "string" ? (loadResult.value as any).text : "";
      assert.ok(loadText.includes(`Skill directory: ${skillDir}`), "Tool output must include the skill directory");

      // Turn 2
      await session.run("Second prompt");
      assert.strictEqual(recordedRequests.length, 2);
      const turn2Messages = recordedRequests[1]?.messages ?? [];

      // Turn 2 MUST contain the skill body now that it is loaded!
      const hasBodyTurn2 = turn2Messages.some((m) =>
        m.content.some((c) => c.type === "text" && c.text.includes("You must run linter before saving")),
      );
      assert.strictEqual(hasBodyTurn2, true, "Turn 2 must contain the loaded skill body");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("eager disclosure: load_skill tool omitted and body included in turn 1", async () => {
    const tempDir = await makeTempDir("eager-disclosure");
    try {
      const repoRoot = join(tempDir, "repo");
      await createSkillFile(
        join(repoRoot, ".agents", "agent", "skills"),
        "formatter",
        "Project formatter skill",
        "Format code with prettier.",
      );

      const recordedRequests: ProviderRequest[] = [];
      const mockProvider: AIProvider = {
        id: "mock-prov",
        async *generate(req) {
          recordedRequests.push(req);
          yield providerTextDelta("Mock turn response");
          yield providerDone();
        },
      };

      const definition = await assembleAppAgent(
        {
          cwd: repoRoot,
          skills: { disclosure: "eager" },
          tools: { planes: { coding: false } },
        },
        mockProvider,
      );

      // In eager mode, load_skill tool should NOT be registered
      let toolFound = false;
      try {
        (definition.agent.config.tools as any).resolve("load_skill");
        toolFound = true;
      } catch {
        toolFound = false;
      }
      assert.strictEqual(toolFound, false, "load_skill tool should not be registered in eager mode");

      const session = definition.createSession({ id: "test-eager-session" });
      await session.run("Hello eager");

      assert.strictEqual(recordedRequests.length, 1);
      const turn1Messages = recordedRequests[0]?.messages ?? [];

      // Turn 1 in eager mode contains the skill body immediately
      const hasBody = turn1Messages.some((m) => m.content.some((c) => c.type === "text" && c.text.includes("Format code with prettier.")));
      assert.strictEqual(hasBody, true, "Turn 1 in eager mode must contain the skill body");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("resumed session restores loaded skills across runs", async () => {
    const tempDir = await makeTempDir("resume-loaded-skills");
    try {
      const repoRoot = join(tempDir, "repo");
      await createSkillFile(join(repoRoot, ".agents", "agent", "skills"), "tester", "Tester skill", "Test all things thoroughly.");

      const recordedRequests: ProviderRequest[] = [];
      const mockProvider: AIProvider = {
        id: "mock-prov",
        async *generate(req) {
          recordedRequests.push(req);
          yield providerTextDelta("Mock turn response");
          yield providerDone();
        },
      };

      const definition = await assembleAppAgent(
        {
          cwd: repoRoot,
          store: { type: "sqlite", path: join(tempDir, "test.db") },
          tools: { planes: { coding: false } },
        },
        mockProvider,
      );

      const session1 = definition.createSession({ id: "resumed-session-1" });
      // Preload skill via restoreLoadedSkills
      session1.restoreLoadedSkills?.(["tester"]);

      await session1.run("First prompt");
      assert.strictEqual(recordedRequests.length, 1);
      const turn1Messages = recordedRequests[0]?.messages ?? [];
      const hasBodyTurn1 = turn1Messages.some((m) =>
        m.content.some((c) => c.type === "text" && c.text.includes("Test all things thoroughly.")),
      );
      assert.strictEqual(hasBodyTurn1, true, "Turn 1 must have loaded skill body");

      // Verify getLoadedSkillNames reports tester
      assert.deepStrictEqual(session1.getLoadedSkillNames?.(), ["tester"]);

      // Re-create / resume session with same id
      const session2 = definition.createSession({ id: "resumed-session-1" });
      // When restored from checkpoint or explicitly resumed:
      session2.restoreLoadedSkills?.(session1.getLoadedSkillNames?.() ?? []);

      await session2.run("Second prompt");
      assert.strictEqual(recordedRequests.length, 2);
      const turn2Messages = recordedRequests[1]?.messages ?? [];
      const hasBodyTurn2 = turn2Messages.some((m) =>
        m.content.some((c) => c.type === "text" && c.text.includes("Test all things thoroughly.")),
      );
      assert.strictEqual(hasBodyTurn2, true, "Turn 2 must preserve loaded skill body");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("TUI handleSlashCommand dispatches /skills and /skill", async () => {
    const tempDir = await makeTempDir("tui-slash");
    try {
      const repoRoot = join(tempDir, "repo");
      await createSkillFile(join(repoRoot, ".agents", "agent", "skills"), "tui-skill", "TUI skill", "TUI skill instructions");

      const streamEntries: any[] = [];
      const mockStream = { appendOrUpdate: (entry: any) => streamEntries.push(entry) };
      const loaded: string[] = [];
      const mockSession = {
        id: "tui-sess",
        getLoadedSkillNames: () => loaded,
        restoreLoadedSkills: (names: readonly string[]) => {
          loaded.push(...names);
        },
      };

      const context: any = {
        config: { cwd: repoRoot },
        session: mockSession,
        stream: mockStream,
      };

      // 1. /skills lists tui-skill as not loaded
      const res1 = await handleSlashCommand("/skills", context);
      assert.strictEqual(res1.handled, true);
      const entry1 = streamEntries.find((e) => e.text?.includes("tui-skill [project] [not loaded]"));
      assert.ok(entry1, "Expected /skills to list not loaded skill");

      // 2. /skill without argument produces error
      const res2 = await handleSlashCommand("/skill", context);
      assert.strictEqual(res2.handled, true);
      const entry2 = streamEntries.find((e) => e.type === "error" && e.message?.includes("Usage: /skill <name>"));
      assert.ok(entry2, "Expected error on empty /skill");

      // 3. /skill tui-skill loads the skill
      const res3 = await handleSlashCommand("/skill tui-skill", context);
      assert.strictEqual(res3.handled, true);
      assert.deepStrictEqual(loaded, ["tui-skill"]);

      // 4. /skills now reports loaded
      streamEntries.length = 0;
      await handleSlashCommand("/skills", context);
      const entry4 = streamEntries.find((e) => e.text?.includes("tui-skill [project] [loaded]"));
      assert.ok(entry4, "Expected /skills to list loaded skill");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("isUserOwned returns true for nonexistent paths and process-owned paths", async () => {
    const tempDir = await makeTempDir("user-owned");
    try {
      assert.strictEqual(isUserOwned(tempDir), true);
      assert.strictEqual(isUserOwned(join(tempDir, "does-not-exist")), true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
