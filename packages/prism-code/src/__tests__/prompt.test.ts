import { describe, expect, it } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AIProvider, createStaticTrustPolicy, type Message, type ProviderRequest, providerDone } from "@arnilo/prism";
import type { PrismCodeConfig } from "../config.js";
import { assembleAppAgent } from "../headless.js";
import { CODING_SYSTEM_PROMPT, resolvePrismCodeInstructions } from "../prompt.js";

function createCapturingProvider(captured: ProviderRequest[]): AIProvider {
  return {
    id: "mock",
    async *generate(req: ProviderRequest) {
      captured.push(req);
      yield providerDone(undefined, "end_turn");
    },
  };
}

function extractSystemText(messages: readonly Message[]): string {
  const systemMsg = messages.find((m) => m.role === "system");
  if (!systemMsg) return "";
  if (typeof systemMsg.content === "string") return systemMsg.content;
  return systemMsg.content
    .map((part) => (typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : ""))
    .join("");
}

function extractContextText(messages: readonly Message[]): string {
  // Context blocks are rendered as system messages with "Environment:\n" or similar
  const contextMsgs = messages.filter((m) => {
    if (m.role !== "system") return false;
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return text.includes("Environment:") || text.includes("Working directory:");
  });
  return contextMsgs.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
}

describe("coding agent prompt and instructions layering", () => {
  it("base prompt + environment block is within the 2 KB constraint and covers required sections", () => {
    const baseBytes = Buffer.byteLength(CODING_SYSTEM_PROMPT, "utf-8");
    assert.ok(baseBytes > 500, `base prompt is too small: ${baseBytes} bytes`);
    assert.ok(baseBytes < 1600, `base prompt exceeds budget: ${baseBytes} bytes`);

    expect(CODING_SYSTEM_PROMPT).toMatchSnapshot();

    // Verify required sections
    assert.ok(CODING_SYSTEM_PROMPT.includes("Tool-Use Conventions"));
    assert.ok(CODING_SYSTEM_PROMPT.includes("Read before edit"));
    assert.ok(CODING_SYSTEM_PROMPT.includes("Prefer edit over write"));
    assert.ok(CODING_SYSTEM_PROMPT.includes("Verify changes") || CODING_SYSTEM_PROMPT.includes("checks"));
    assert.ok(CODING_SYSTEM_PROMPT.includes("Autonomy and Task Execution"));
    assert.ok(CODING_SYSTEM_PROMPT.includes("todo_write"));
    assert.ok(CODING_SYSTEM_PROMPT.includes("ask_user_decision"));
    assert.ok(CODING_SYSTEM_PROMPT.includes("Safety Rules"));
    assert.ok(CODING_SYSTEM_PROMPT.includes("Output Style"));

    // Sample environment block
    const sampleEnv = [
      "Environment:",
      "Working directory: /home/user/project/packages/subpkg",
      "Repository root: /home/user/project",
      "OS: linux (x64)",
      "Shell: /bin/bash",
      "Date: 2026-09-28",
      "Git branch: feature/branch-a",
      "Git dirty: false",
      "Model: anthropic/claude-sonnet-4-5",
    ].join("\n");

    const totalBytes = baseBytes + Buffer.byteLength(sampleEnv, "utf-8");
    assert.ok(totalBytes <= 2048, `base prompt + environment block must be <= 2048 bytes, got ${totalBytes}`);
  });

  it("first provider request includes base prompt, global AGENTS.md, repo AGENTS.md (from subdir), and environment block", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "prism-prompt-test-"));
    const agentsHome = join(tempDir, "agents-home");
    const prismHome = join(tempDir, "prism-home");
    const repoRoot = join(tempDir, "repo");
    const subDir = join(repoRoot, "packages", "sub");

    try {
      // 1. ~/.agents/agent/AGENTS.md
      await mkdir(join(agentsHome, ".agents", "agent"), { recursive: true });
      await writeFile(join(agentsHome, ".agents", "agent", "AGENTS.md"), "GLOBAL AGENTS FROM ~/.agents");

      // 2. ~/.prism/agent/AGENTS.md
      await mkdir(join(prismHome, "agent"), { recursive: true });
      await writeFile(join(prismHome, "agent", "AGENTS.md"), "GLOBAL AGENTS FROM ~/.prism");

      // 3. <repo>/AGENTS.md and .git
      await mkdir(subDir, { recursive: true });
      await mkdir(join(repoRoot, ".git"), { recursive: true });
      await writeFile(join(repoRoot, ".git", "HEAD"), "ref: refs/heads/feature/layered\n");
      await writeFile(join(repoRoot, "AGENTS.md"), "REPO AGENTS AT GIT ROOT");

      const config: PrismCodeConfig = {
        cwd: subDir,
        tools: { planes: { coding: false } }, // bare tools for lightweight test
      };

      const captured: ProviderRequest[] = [];
      const mock = createCapturingProvider(captured);

      // Resolve instructions passing explicit homes for testing
      const instructions = resolvePrismCodeInstructions({
        config,
        repoRoot,
        home: prismHome,
        agentsHome,
      });

      const definition = await assembleAppAgent(
        {
          ...config,
          instructions,
        },
        mock,
      );

      const session = definition.createSession();
      await session.run("hello agent");

      assert.equal(captured.length, 1);
      const req = captured[0];
      assert.ok(req);

      const sysText = extractSystemText(req.messages);
      assert.ok(sysText.includes("You are Prism Code"), "base prompt missing");
      assert.ok(sysText.includes("GLOBAL AGENTS FROM ~/.agents"), "global ~/.agents missing");
      assert.ok(sysText.includes("GLOBAL AGENTS FROM ~/.prism"), "global ~/.prism missing");
      assert.ok(sysText.includes("REPO AGENTS AT GIT ROOT"), "repo AGENTS.md missing");

      // Verify order: Base -> ~/.agents -> ~/.prism -> repo
      const idxBase = sysText.indexOf("You are Prism Code");
      const idxGlobalAgents = sysText.indexOf("GLOBAL AGENTS FROM ~/.agents");
      const idxPrismAgents = sysText.indexOf("GLOBAL AGENTS FROM ~/.prism");
      const idxRepoAgents = sysText.indexOf("REPO AGENTS AT GIT ROOT");

      assert.ok(idxBase < idxGlobalAgents, "base should precede global ~/.agents");
      assert.ok(idxGlobalAgents < idxPrismAgents, "~/.agents should precede ~/.prism");
      assert.ok(idxPrismAgents < idxRepoAgents, "~/.prism should precede repo AGENTS.md");

      // Verify environment block in context
      const ctxText = extractContextText(req.messages);
      assert.ok(ctxText.includes(`Working directory: ${subDir}`));
      assert.ok(ctxText.includes(`Repository root: ${repoRoot}`));
      assert.ok(ctxText.includes(new Date().toISOString().slice(0, 10)));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("SYSTEM.md replaces the base prompt (mode: replace)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "prism-prompt-sys-"));
    const prismHome = join(tempDir, "prism-home");
    const repoRoot = join(tempDir, "repo");

    try {
      await mkdir(join(prismHome, "agent"), { recursive: true });
      await writeFile(join(prismHome, "agent", "SYSTEM.md"), "CUSTOM USER SYSTEM PROMPT OVERRIDE");

      await mkdir(join(repoRoot, ".git"), { recursive: true });
      await writeFile(join(repoRoot, "AGENTS.md"), "REPO AGENTS CONTENT");

      const config: PrismCodeConfig = {
        cwd: repoRoot,
        tools: { planes: { coding: false } },
      };

      const captured: ProviderRequest[] = [];
      const mock = createCapturingProvider(captured);

      const instructions = resolvePrismCodeInstructions({
        config,
        repoRoot,
        home: prismHome,
      });

      const definition = await assembleAppAgent(
        {
          ...config,
          instructions,
        },
        mock,
      );

      const session = definition.createSession();
      await session.run("hello agent");

      assert.equal(captured.length, 1);
      const req = captured[0];
      assert.ok(req);

      const sysText = extractSystemText(req.messages);
      assert.ok(sysText.includes("CUSTOM USER SYSTEM PROMPT OVERRIDE"), "SYSTEM.md missing");
      assert.ok(sysText.includes("REPO AGENTS CONTENT"), "AGENTS.md missing");
      assert.ok(!sysText.includes("You are Prism Code"), "CODING_SYSTEM_PROMPT should have been replaced");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("--no-agents-md drops all AGENTS.md layers", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "prism-prompt-no-agents-"));
    const agentsHome = join(tempDir, "agents-home");
    const prismHome = join(tempDir, "prism-home");
    const repoRoot = join(tempDir, "repo");

    try {
      await mkdir(join(agentsHome, ".agents", "agent"), { recursive: true });
      await writeFile(join(agentsHome, ".agents", "agent", "AGENTS.md"), "SHOULD NOT LOAD GLOBAL AGENTS");

      await mkdir(join(repoRoot, ".git"), { recursive: true });
      await writeFile(join(repoRoot, "AGENTS.md"), "SHOULD NOT LOAD REPO AGENTS");

      const config: PrismCodeConfig = {
        cwd: repoRoot,
        tools: { planes: { coding: false } },
        instructions: { agentsMd: false },
      };

      const captured: ProviderRequest[] = [];
      const mock = createCapturingProvider(captured);

      const instructions = resolvePrismCodeInstructions({
        config,
        repoRoot,
        home: prismHome,
        agentsHome,
      });

      const definition = await assembleAppAgent(
        {
          ...config,
          instructions,
        },
        mock,
      );

      const session = definition.createSession();
      await session.run("hello agent");

      assert.equal(captured.length, 1);
      const req = captured[0];
      assert.ok(req);

      const sysText = extractSystemText(req.messages);
      assert.ok(sysText.includes("You are Prism Code"), "base prompt missing");
      assert.ok(!sysText.includes("SHOULD NOT LOAD GLOBAL AGENTS"));
      assert.ok(!sysText.includes("SHOULD NOT LOAD REPO AGENTS"));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("--no-system-md drops SYSTEM.md and preserves base prompt", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "prism-prompt-no-sys-"));
    const prismHome = join(tempDir, "prism-home");
    const repoRoot = join(tempDir, "repo");

    try {
      await mkdir(join(prismHome, "agent"), { recursive: true });
      await writeFile(join(prismHome, "agent", "SYSTEM.md"), "SHOULD NOT REPLACE");

      const config: PrismCodeConfig = {
        cwd: repoRoot,
        tools: { planes: { coding: false } },
        instructions: { systemMd: false },
      };

      const captured: ProviderRequest[] = [];
      const mock = createCapturingProvider(captured);

      const instructions = resolvePrismCodeInstructions({
        config,
        repoRoot,
        home: prismHome,
      });

      const definition = await assembleAppAgent(
        {
          ...config,
          instructions,
        },
        mock,
      );

      const session = definition.createSession();
      await session.run("hello agent");

      assert.equal(captured.length, 1);
      const req = captured[0];
      assert.ok(req);

      const sysText = extractSystemText(req.messages);
      assert.ok(sysText.includes("You are Prism Code"), "base prompt should remain");
      assert.ok(!sysText.includes("SHOULD NOT REPLACE"), "SYSTEM.md should not load");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("prefix hash is unchanged across two runs on different branches (only tail/environment differs)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "prism-prefix-hash-"));
    const repoRoot = join(tempDir, "repo");

    try {
      await mkdir(join(repoRoot, ".git"), { recursive: true });
      await writeFile(join(repoRoot, "AGENTS.md"), "STABLE REPO INSTRUCTIONS");

      const config: PrismCodeConfig = {
        cwd: repoRoot,
        tools: { planes: { coding: false } },
      };

      const captured: ProviderRequest[] = [];
      const mock = createCapturingProvider(captured);

      const instructions = resolvePrismCodeInstructions({
        config,
        repoRoot,
      });

      // Run 1 on branch alpha
      await writeFile(join(repoRoot, ".git", "HEAD"), "ref: refs/heads/feature/alpha\n");
      const def1 = await assembleAppAgent(
        {
          ...config,
          instructions,
        },
        mock,
      );
      const s1 = def1.createSession();
      await s1.run("run 1");

      // Switch branch to beta
      await writeFile(join(repoRoot, ".git", "HEAD"), "ref: refs/heads/feature/beta\n");

      // Run 2 on branch beta
      const def2 = await assembleAppAgent(
        {
          ...config,
          instructions,
        },
        mock,
      );
      const s2 = def2.createSession();
      await s2.run("run 2");

      assert.equal(captured.length, 2);
      const req1 = captured[0];
      const req2 = captured[1];
      assert.ok(req1);
      assert.ok(req2);

      // Leading system message is the system prompt prefix
      const prefix1 = req1.messages[0];
      const prefix2 = req2.messages[0];
      assert.ok(prefix1);
      assert.ok(prefix2);

      assert.equal(prefix1.role, "system");
      assert.equal(prefix2.role, "system");

      const hash1 = createHash("sha256").update(JSON.stringify(prefix1)).digest("hex");
      const hash2 = createHash("sha256").update(JSON.stringify(prefix2)).digest("hex");

      assert.equal(hash1, hash2, "prefix hash must be identical across runs on different branches");

      // But the context blocks differ because the branch differs
      const ctx1 = extractContextText(req1.messages);
      const ctx2 = extractContextText(req2.messages);

      assert.ok(ctx1.includes("feature/alpha"));
      assert.ok(ctx2.includes("feature/beta"));
      assert.notEqual(ctx1, ctx2);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("untrusted workspace AGENTS.md contributes nothing (fail-closed trust)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "prism-untrusted-"));
    const agentsHome = join(tempDir, "agents-home");
    const repoRoot = join(tempDir, "repo");

    try {
      await mkdir(join(agentsHome, ".agents", "agent"), { recursive: true });
      await writeFile(join(agentsHome, ".agents", "agent", "AGENTS.md"), "USER GLOBAL AGENTS");

      await mkdir(join(repoRoot, ".git"), { recursive: true });
      await writeFile(join(repoRoot, "AGENTS.md"), "UNTRUSTED REPO AGENTS");

      const config: PrismCodeConfig = {
        cwd: repoRoot,
        tools: { planes: { coding: false } },
      };

      const captured: ProviderRequest[] = [];
      const mock = createCapturingProvider(captured);

      const instructions = resolvePrismCodeInstructions({
        config,
        repoRoot,
        agentsHome,
      });

      // Pass static false trust policy: workspace is untrusted
      const untrustedPolicy = createStaticTrustPolicy(false);

      const definition = await assembleAppAgent(
        {
          ...config,
          instructions,
        },
        mock,
        undefined,
        undefined,
        undefined,
        undefined,
        untrustedPolicy,
      );

      const session = definition.createSession();
      await session.run("hello");

      assert.equal(captured.length, 1);
      const req = captured[0];
      assert.ok(req);

      const sysText = extractSystemText(req.messages);
      assert.ok(sysText.includes("USER GLOBAL AGENTS"), "user global instructions should still load");
      assert.ok(!sysText.includes("UNTRUSTED REPO AGENTS"), "untrusted repo instructions must be dropped");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
