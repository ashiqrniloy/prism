import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AIProvider, ProviderRequest, Skill, ToolDefinition, ToolRegistry, TrustPolicy } from "../index.js";
import { createContributionRegistries } from "../index.js";
import { discoverAgentBundles, resolveAgentBundle } from "../node/agent-definitions.js";
import { discoverContributions } from "../node/contribution-discovery.js";

const provider: AIProvider = {
  id: "mock",
  async *generate() {
    yield { type: "done" };
  },
};

function toolNames(tools: ToolRegistry | readonly ToolDefinition[] | undefined): string[] {
  if (!tools) return [];
  return "list" in tools ? tools.list().map((t) => t.name) : tools.map((t) => t.name);
}

function skillNames(skills: { list(): readonly Skill[] } | readonly Skill[] | undefined): string[] {
  if (!skills) return [];
  return "list" in skills ? skills.list().map((s) => s.name) : skills.map((s) => s.name);
}

async function makeConfigDir(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "prism-appconfig-"));
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return root;
}

async function makeWorkspaceDir(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "prism-workspace-"));
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return root;
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "." : path.slice(0, idx);
}

function baseContext() {
  const registries = createContributionRegistries();
  registries.providers.register(provider);
  registries.models.register({ provider: "mock", model: "demo" });
  return { registries };
}

describe("discoverAgentBundles", () => {
  it("finds two agents under <configRoot>/agents/<name>/AGENT.md", async () => {
    const root = await makeConfigDir({
      "agents/SYSTEM.md": "# System",
      "agents/coding/AGENT.md": ["---", "name: coding", "---", ""].join("\n"),
      "agents/office/AGENT.md": ["---", "name: office", "---", ""].join("\n"),
    });

    const bundles = await discoverAgentBundles({ configRoot: root });
    assert.equal(bundles.length, 2);
    const names = bundles.map((b) => b.name).sort();
    assert.deepEqual(names, ["coding", "office"]);
    for (const bundle of bundles) {
      assert.equal(bundle.configRoot, root);
      assert.equal(bundle.systemPromptPath, join(root, "agents/SYSTEM.md"));
      assert.ok(bundle.path.endsWith(`/AGENT.md`), `expected AGENT.md path, got ${bundle.path}`);
    }
  });

  it("discovers global skills and per-agent skills", async () => {
    const root = await makeConfigDir({
      "agents/skills/plan/SKILL.md": ["---", "name: plan", "---", ""].join("\n"),
      "agents/coding/AGENT.md": ["---", "name: coding", "---", ""].join("\n"),
      "agents/coding/skills/code-style/SKILL.md": ["---", "name: code-style", "---", ""].join("\n"),
    });

    const [bundle] = await discoverAgentBundles({ configRoot: root });
    assert.equal(bundle?.name, "coding");
    assert.deepEqual(
      bundle?.globalSkills.map((p) => parentDirName(p)),
      ["plan"],
    );
    assert.deepEqual(
      bundle?.agentSkills.map((p) => parentDirName(p)),
      ["code-style"],
    );
  });

  it("discovers global tools and per-agent tools", async () => {
    const root = await makeConfigDir({
      "agents/tools/read-file/manifest.json": JSON.stringify({ name: "read-file" }),
      "agents/coding/AGENT.md": ["---", "name: coding", "---", ""].join("\n"),
      "agents/coding/tools/run-tests/manifest.json": JSON.stringify({ name: "run-tests" }),
    });

    const [bundle] = await discoverAgentBundles({ configRoot: root });
    assert.equal(bundle?.name, "coding");
    assert.deepEqual(
      bundle?.globalTools.map((p) => parentDirName(p)),
      ["read-file"],
    );
    assert.deepEqual(
      bundle?.agentTools.map((p) => parentDirName(p)),
      ["run-tests"],
    );
  });

  it("is exported from the node subpath", () => {
    assert.equal(typeof discoverAgentBundles, "function");
  });
});

describe("resolveAgentBundle", () => {
  it("resolves an agent with global + repo + agent-specific skills as a union", async () => {
    const configRoot = await makeConfigDir({
      "agents/SYSTEM.md": "# System",
      "agents/skills/global-skill/SKILL.md": ["---", "name: global-skill", "---", ""].join("\n"),
      "agents/coding/AGENT.md": [
        "---",
        "name: coding",
        "model: mock/demo",
        "skills:",
        "  - agent-skill",
        "  - global-skill",
        "  - repo-skill",
        "---",
        "",
      ].join("\n"),
      "agents/coding/skills/agent-skill/SKILL.md": ["---", "name: agent-skill", "---", ""].join("\n"),
    });
    const workspaceRoot = await makeWorkspaceDir({
      ".agents/skills/repo-skill/SKILL.md": ["---", "name: repo-skill", "---", ""].join("\n"),
    });

    const [bundle] = await discoverAgentBundles({ configRoot });
    const repoContributions = await discoverContributions({ kinds: ["skill"], workspaceRoot });
    const agent = await resolveAgentBundle(bundle!, {
      ...baseContext(),
      workspaceRoot,
      repoContributions,
      include: { repoPrompt: false },
    });

    assert.deepEqual(skillNames(agent.config.skills).sort(), ["agent-skill", "global-skill", "repo-skill"]);
  });

  it("excluding repoSkills removes repo skills from the agent", async () => {
    const configRoot = await makeConfigDir({
      "agents/SYSTEM.md": "# System",
      "agents/skills/global-skill/SKILL.md": ["---", "name: global-skill", "---", ""].join("\n"),
      "agents/coding/AGENT.md": [
        "---",
        "name: coding",
        "model: mock/demo",
        "skills:",
        "  - agent-skill",
        "  - global-skill",
        "---",
        "",
      ].join("\n"),
      "agents/coding/skills/agent-skill/SKILL.md": ["---", "name: agent-skill", "---", ""].join("\n"),
    });
    const workspaceRoot = await makeWorkspaceDir({
      ".agents/skills/repo-skill/SKILL.md": ["---", "name: repo-skill", "---", ""].join("\n"),
    });

    const [bundle] = await discoverAgentBundles({ configRoot });
    const repoContributions = await discoverContributions({ kinds: ["skill"], workspaceRoot });
    const agent = await resolveAgentBundle(bundle!, {
      ...baseContext(),
      workspaceRoot,
      repoContributions,
      include: { repoSkills: false, repoPrompt: false },
    });

    assert.deepEqual(skillNames(agent.config.skills).sort(), ["agent-skill", "global-skill"]);
  });

  it("excluding agentPrompt removes the per-agent AGENT.md prompt layer", async () => {
    const configRoot = await makeConfigDir({
      "agents/SYSTEM.md": "App global system prompt.",
      "agents/coding/AGENT.md": [
        "---",
        "name: coding",
        "model: mock/demo",
        "---",
        "",
        "Per-agent custom prompt.",
      ].join("\n"),
    });
    const workspaceRoot = await makeWorkspaceDir({
      "AGENTS.md": "Repo project prompt.",
    });

    let request!: ProviderRequest;
    const capturingProvider: AIProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield { type: "done" };
      },
    };
    const ctx = baseContext();
    ctx.registries.providers.register(capturingProvider);

    const [bundle] = await discoverAgentBundles({ configRoot });
    const agent = await resolveAgentBundle(bundle!, {
      ...ctx,
      workspaceRoot,
      include: { agentPrompt: false },
    });

    await agent.createSession().run("Hi");

    const text = request.messages.flatMap((m) => m.content).map((b) => (b.type === "text" ? b.text : "")).join("\n");
    assert.ok(text.includes("App global system prompt."), "SYSTEM.md layer missing");
    assert.ok(text.includes("Repo project prompt."), "AGENTS.md layer missing");
    assert.ok(!text.includes("Per-agent custom prompt."), "AGENT.md prompt layer should be excluded");
  });

  async function buildThreePromptBundle() {
    const configRoot = await makeConfigDir({
      "agents/SYSTEM.md": "GLOBAL_SYSTEM_LAYER",
      "agents/coding/AGENT.md": [
        "---",
        "name: coding",
        "model: mock/demo",
        "---",
        "",
        "AGENT_BODY_LAYER",
      ].join("\n"),
    });
    const workspaceRoot = await makeWorkspaceDir({
      "AGENTS.md": "REPO_PROJECT_LAYER",
    });
    return { configRoot, workspaceRoot };
  }

  async function capturePromptText(include: Record<string, boolean>): Promise<string> {
    const { configRoot, workspaceRoot } = await buildThreePromptBundle();
    let request!: ProviderRequest;
    const capturingProvider: AIProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield { type: "done" };
      },
    };
    const ctx = baseContext();
    ctx.registries.providers.register(capturingProvider);

    const [bundle] = await discoverAgentBundles({ configRoot });
    const agent = await resolveAgentBundle(bundle!, {
      ...ctx,
      workspaceRoot,
      include,
    });

    await agent.createSession().run("Hi");
    return request.messages.flatMap((m) => m.content).map((b) => (b.type === "text" ? b.text : "")).join("\n");
  }

  it("appends all three prompt sources in SYSTEM.md -> AGENT.md -> AGENTS.md order", async () => {
    const text = await capturePromptText({});
    const sys = text.indexOf("GLOBAL_SYSTEM_LAYER");
    const agent = text.indexOf("AGENT_BODY_LAYER");
    const repo = text.indexOf("REPO_PROJECT_LAYER");
    assert.ok(sys >= 0, "SYSTEM.md layer missing");
    assert.ok(agent >= 0, "AGENT.md layer missing");
    assert.ok(repo >= 0, "AGENTS.md layer missing");
    assert.ok(sys < agent, `SYSTEM.md must precede AGENT.md (sys=${sys}, agent=${agent})`);
    assert.ok(agent < repo, `AGENT.md must precede AGENTS.md (agent=${agent}, repo=${repo})`);
  });

  it("disabling systemPrompt omits SYSTEM.md but keeps the other layers", async () => {
    const text = await capturePromptText({ systemPrompt: false });
    assert.ok(!text.includes("GLOBAL_SYSTEM_LAYER"), "SYSTEM.md should be omitted");
    assert.ok(text.includes("AGENT_BODY_LAYER"), "AGENT.md layer missing");
    assert.ok(text.includes("REPO_PROJECT_LAYER"), "AGENTS.md layer missing");
  });

  it("disabling repoPrompt omits AGENTS.md but keeps the other layers", async () => {
    const text = await capturePromptText({ repoPrompt: false });
    assert.ok(!text.includes("REPO_PROJECT_LAYER"), "AGENTS.md should be omitted");
    assert.ok(text.includes("GLOBAL_SYSTEM_LAYER"), "SYSTEM.md layer missing");
    assert.ok(text.includes("AGENT_BODY_LAYER"), "AGENT.md layer missing");
  });

  it("trust-gates the workspace root and app-config root independently", async () => {
    const { configRoot, workspaceRoot } = await buildThreePromptBundle();
    let request!: ProviderRequest;
    const capturingProvider: AIProvider = {
      id: "mock",
      async *generate(input) {
        request = input;
        yield { type: "done" };
      },
    };
    const ctx = baseContext();
    ctx.registries.providers.register(capturingProvider);

    const [bundle] = await discoverAgentBundles({ configRoot });

    // Deny the workspace AGENTS.md only; SYSTEM.md (config root) still loads.
    const denyRepoTrust: TrustPolicy = {
      check: (req) =>
        req.target === join(workspaceRoot, "AGENTS.md")
          ? { trusted: false, reason: "repo denied" }
          : { trusted: true },
    };
    const deniedRepo = await resolveAgentBundle(bundle!, {
      ...ctx,
      workspaceRoot,
      trust: denyRepoTrust,
    });
    await deniedRepo.createSession().run("Hi");
    const deniedRepoText = request.messages.flatMap((m) => m.content).map((b) => (b.type === "text" ? b.text : "")).join("\n");
    assert.ok(deniedRepoText.includes("GLOBAL_SYSTEM_LAYER"), "SYSTEM.md should still load when only repo is denied");
    assert.ok(!deniedRepoText.includes("REPO_PROJECT_LAYER"), "AGENTS.md should be skipped when untrusted");

    // Deny the SYSTEM.md (config root) only; AGENTS.md (workspace) still loads.
    const denySystemTrust: TrustPolicy = {
      check: (req) =>
        req.target === bundle!.systemPromptPath
          ? { trusted: false, reason: "system denied" }
          : { trusted: true },
    };
    const deniedSystem = await resolveAgentBundle(bundle!, {
      ...ctx,
      workspaceRoot,
      trust: denySystemTrust,
    });
    await deniedSystem.createSession().run("Hi");
    const deniedSystemText = request.messages.flatMap((m) => m.content).map((b) => (b.type === "text" ? b.text : "")).join("\n");
    assert.ok(!deniedSystemText.includes("GLOBAL_SYSTEM_LAYER"), "SYSTEM.md should be skipped when untrusted");
    assert.ok(deniedSystemText.includes("REPO_PROJECT_LAYER"), "AGENTS.md should still load when only system is denied");
  });

  it("app-config global skills are available to every agent bundle", async () => {
    const configRoot = await makeConfigDir({
      "agents/skills/shared/SKILL.md": ["---", "name: shared", "---", ""].join("\n"),
      "agents/coding/AGENT.md": [
        "---", "name: coding", "model: mock/demo", "skills:", "  - shared", "---", "",
      ].join("\n"),
      "agents/office/AGENT.md": [
        "---", "name: office", "model: mock/demo", "skills:", "  - shared", "---", "",
      ].join("\n"),
    });

    const bundles = await discoverAgentBundles({ configRoot });
    assert.equal(bundles.length, 2);
    for (const bundle of bundles) {
      const agent = await resolveAgentBundle(bundle, { ...baseContext(), include: { repoPrompt: false } });
      assert.deepEqual(skillNames(agent.config.skills), ["shared"], `${bundle.name} should see the global skill`);
    }
  });

  it("per-agent skills are scoped to that agent's bundle (absent from a sibling)", async () => {
    const configRoot = await makeConfigDir({
      "agents/coding/AGENT.md": [
        "---", "name: coding", "model: mock/demo", "skills:", "  - code-style", "---", "",
      ].join("\n"),
      "agents/coding/skills/code-style/SKILL.md": ["---", "name: code-style", "---", ""].join("\n"),
      "agents/office/AGENT.md": [
        "---", "name: office", "model: mock/demo", "skills:", "  - shared", "---", "",
      ].join("\n"),
      "agents/office/skills/shared/SKILL.md": ["---", "name: shared", "---", ""].join("\n"),
    });

    const bundles = await discoverAgentBundles({ configRoot });
    const coding = bundles.find((b) => b.name === "coding")!;
    const office = bundles.find((b) => b.name === "office")!;
    // code-style lives only under coding/; office does not see it.
    assert.ok(coding.agentSkills.some((p) => p.includes("code-style")), "coding bundle has its per-agent skill");
    assert.ok(!office.agentSkills.some((p) => p.includes("code-style")), "office bundle does not carry coding's per-agent skill");
  });

  it("tool access is controlled by the agent's tools list resolved against the app-global + per-agent union", async () => {
    const configRoot = await makeConfigDir({
      "agents/tools/read/manifest.json": JSON.stringify({ name: "read" }),
      "agents/coding/AGENT.md": [
        "---",
        "name: coding",
        "model: mock/demo",
        "tools:",
        "  - read",
        "  - run-tests",
        "---",
        "",
      ].join("\n"),
      "agents/coding/tools/run-tests/manifest.json": JSON.stringify({ name: "run-tests" }),
      // Declared in the agent directory but NOT in the agent's tools list → must not be active.
      "agents/coding/tools/lint/manifest.json": JSON.stringify({ name: "lint" }),
    });

    const [bundle] = await discoverAgentBundles({ configRoot });
    const agent = await resolveAgentBundle(bundle!, { ...baseContext(), include: { repoPrompt: false } });

    assert.deepEqual(toolNames(agent.config.tools).sort(), ["read", "run-tests"]);
  });

  it("excluding agentTools removes the per-agent tools from the agent", async () => {
    const configRoot = await makeConfigDir({
      "agents/tools/read/manifest.json": JSON.stringify({ name: "read" }),
      "agents/coding/AGENT.md": [
        "---",
        "name: coding",
        "model: mock/demo",
        "tools:",
        "  - read",
        "---",
        "",
      ].join("\n"),
      "agents/coding/tools/run-tests/manifest.json": JSON.stringify({ name: "run-tests" }),
    });

    const [bundle] = await discoverAgentBundles({ configRoot });
    // With agentTools excluded, the only declared tool (read) stays via the global scope;
    // run-tests (per-agent) is never registered even if it had been declared.
    const agent = await resolveAgentBundle(bundle!, {
      ...baseContext(),
      include: { agentTools: false, repoPrompt: false },
    });

    assert.deepEqual(toolNames(agent.config.tools), ["read"]);
  });

  it("duplicate skill names across included scopes throw instead of overriding", async () => {
    const configRoot = await makeConfigDir({
      "agents/SYSTEM.md": "# System",
      "agents/skills/dup/SKILL.md": ["---", "name: dup", "---", ""].join("\n"),
      "agents/coding/AGENT.md": ["---", "name: coding", "model: mock/demo", "---", ""].join("\n"),
    });
    const workspaceRoot = await makeWorkspaceDir({
      ".agents/skills/dup/SKILL.md": ["---", "name: dup", "---", ""].join("\n"),
    });

    const [bundle] = await discoverAgentBundles({ configRoot });
    const repoContributions = await discoverContributions({ kinds: ["skill"], workspaceRoot });

    await assert.rejects(
      async () =>
        resolveAgentBundle(bundle!, {
          ...baseContext(),
          workspaceRoot,
          repoContributions,
        }),
      /Duplicate skill name across scopes: dup/,
    );
  });

  it("missing tool fails closed", async () => {
    const configRoot = await makeConfigDir({
      "agents/SYSTEM.md": "# System",
      "agents/coding/AGENT.md": [
        "---",
        "name: coding",
        "model: mock/demo",
        "tools:",
        "  - missing",
        "---",
        "",
      ].join("\n"),
    });

    const [bundle] = await discoverAgentBundles({ configRoot });

    await assert.rejects(
      async () =>
        resolveAgentBundle(bundle!, {
          ...baseContext(),
        }),
      /Unknown tool: missing/,
    );
  });

  it("is exported from the node subpath", () => {
    assert.equal(typeof resolveAgentBundle, "function");
  });
});

function parentDirName(path: string): string {
  const parts = path.split(/[/\\]+/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1] ?? "";
}
