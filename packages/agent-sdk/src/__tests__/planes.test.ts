import { afterEach, beforeEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpToolBridge } from "@arnilo/prism-mcp";
import {
  AgentSdkConfigError,
  assembleHooksPlane,
  assembleInstructionsPlane,
  assembleMcpPlane,
  assembleSkillsPlane,
  assertServerAllowed,
  parseAllowDestination,
} from "../index.js";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `prism-agent-sdk-${prefix}-`));
}

async function writeFileDeep(filePath: string, text: string): Promise<void> {
  const dir = join(filePath, "..");
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, text, "utf8");
}

describe("planes/skills", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir("skills");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty skills when no workspaceRoot or additions are provided", async () => {
    const result = await assembleSkillsPlane();
    assert.deepStrictEqual(result.discoveredSkills, []);
    assert.strictEqual(result.skills, undefined);
  });

  it("discovers skills from .agents/skills and excludes named skills", async () => {
    await writeFileDeep(
      join(tempDir, ".agents/skills/alpha/SKILL.md"),
      "---\nname: alpha\ndescription: alpha skill\n---\nAlpha instructions\n",
    );
    await writeFileDeep(
      join(tempDir, ".agents/skills/beta/SKILL.md"),
      "---\nname: beta\ndescription: beta skill\n---\nBeta instructions\n",
    );

    // Discovers both
    const all = await assembleSkillsPlane({ workspaceRoot: tempDir });
    assert.strictEqual(all.discoveredSkills.length, 2);
    assert.ok(all.skills);
    assert.ok(all.skills.get("alpha"));
    assert.ok(all.skills.get("beta"));

    // Exclude 'beta'
    const filtered = await assembleSkillsPlane({
      workspaceRoot: tempDir,
      exclude: ["beta"],
    });
    assert.strictEqual(filtered.discoveredSkills.length, 1);
    assert.strictEqual(filtered.discoveredSkills[0].name, "alpha");
    assert.ok(filtered.skills);
    assert.ok(filtered.skills.get("alpha"));
    assert.strictEqual(filtered.skills.get("beta"), undefined);
  });

  it("skills plane: roots option discovers from custom roots and defaults activateAll to true", async () => {
    const globalDir = join(tempDir, "global-skills");
    await writeFileDeep(
      join(globalDir, "my-tool-skill/SKILL.md"),
      "---\nname: my-tool-skill\ndescription: tool skill\n---\nTool instructions\n",
    );

    const result = await assembleSkillsPlane({
      roots: [{ dir: globalDir, origin: "global", layout: "flat" }],
    });

    assert.strictEqual(result.discoveredSkills.length, 1);
    assert.strictEqual(result.discoveredSkills[0].name, "my-tool-skill");
    assert.ok(result.skills?.get("my-tool-skill"));
    assert.strictEqual(result.activateAllSkills, true);

    // Explicit activateAll: false
    const deactivated = await assembleSkillsPlane({
      roots: [{ dir: globalDir, origin: "global", layout: "flat" }],
      activateAll: false,
    });
    assert.strictEqual(deactivated.activateAllSkills, false);
  });
});

describe("planes/instructions", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir("instructions");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns base text instructions when given a string without workspaceRoot", async () => {
    const result = await assembleInstructionsPlane({
      instructions: "You are a concise assistant.",
    });
    assert.strictEqual(result.instructionsText, "You are a concise assistant.");
    assert.deepStrictEqual(result.systemPromptLayers, []);
  });

  it("auto-loads AGENTS.md when workspaceRoot is provided and agentsMd is not false", async () => {
    await writeFileDeep(join(tempDir, "AGENTS.md"), "# Project Guidelines\nFormat diffs cleanly.\n");

    const result = await assembleInstructionsPlane({
      instructions: { text: "Base prompt" },
      workspaceRoot: tempDir,
    });

    assert.strictEqual(result.instructionsText, "Base prompt");
    assert.strictEqual(result.systemPromptLayers.length, 1);
    assert.strictEqual(result.systemPromptLayers[0].id, "agents-md");
    assert.ok(result.systemPromptLayers[0].text.includes("Format diffs cleanly."));
  });

  it("does not load AGENTS.md when agentsMd is explicitly false", async () => {
    await writeFileDeep(join(tempDir, "AGENTS.md"), "# Project Guidelines\nFormat diffs cleanly.\n");

    const result = await assembleInstructionsPlane({
      instructions: { text: "Base prompt", agentsMd: false },
      workspaceRoot: tempDir,
    });

    assert.strictEqual(result.instructionsText, "Base prompt");
    assert.deepStrictEqual(result.systemPromptLayers, []);
  });
});

describe("planes/hooks", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir("hooks");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty object when hooks is not configured", async () => {
    const result = await assembleHooksPlane();
    assert.deepStrictEqual(result, {});
  });

  it("throws AgentSdkConfigError when hooks file is outside trusted roots", async () => {
    const otherDir = await makeTempDir("other");
    const hookPath = join(otherDir, "hooks.json");
    await writeFile(hookPath, JSON.stringify({ hooks: {} }), "utf8");

    try {
      await assert.rejects(
        async () => {
          await assembleHooksPlane({
            hooks: { file: hookPath },
            workspaceRoot: tempDir,
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof AgentSdkConfigError);
          assert.ok(err.message.includes("not trusted"));
          return true;
        },
      );
    } finally {
      await rm(otherDir, { recursive: true, force: true });
    }
  });

  it("compiles trusted hooks.json into guardrails, middleware, and stop hooks", async () => {
    const hookPath = join(tempDir, "hooks.json");
    await writeFile(
      hookPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              type: "command",
              command: "echo test",
            },
          ],
        },
      }),
      "utf8",
    );

    const result = await assembleHooksPlane({
      hooks: { file: hookPath },
      workspaceRoot: tempDir,
    });

    assert.ok(result.guardrails);
    assert.ok(result.middleware);
  });
});

describe("planes/mcp", () => {
  it("parses stdio and url destinations correctly", () => {
    assert.deepStrictEqual(parseAllowDestination("stdio"), { kind: "stdio" });
    assert.deepStrictEqual(parseAllowDestination("https://example.com/api"), { kind: "url", origin: "https://example.com", path: "/api" });
    assert.strictEqual(parseAllowDestination("not a url"), null);
    assert.strictEqual(parseAllowDestination("https://example.com/../bad"), null);
  });

  it("validates stdio server allow rules fail-closed", () => {
    // Valid stdio allow
    assertServerAllowed({
      serverId: "local",
      command: "node",
      allow: "stdio",
    });

    // Mismatched allow throws
    assert.throws(
      () =>
        assertServerAllowed({
          serverId: "local",
          command: "node",
          allow: "https://example.com",
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentSdkConfigError);
        assert.ok(err.message.includes('requires allow: "stdio"'));
        return true;
      },
    );
  });

  it("validates HTTP server allow rules fail-closed", () => {
    // Valid http allow
    assertServerAllowed({
      serverId: "remote",
      url: "https://api.example.com/mcp/v1",
      allow: "https://api.example.com/mcp",
    });

    // Origin mismatch throws
    assert.throws(
      () =>
        assertServerAllowed({
          serverId: "remote",
          url: "https://other.com/mcp",
          allow: "https://api.example.com/mcp",
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentSdkConfigError);
        assert.ok(err.message.includes("does not match allow origin"));
        return true;
      },
    );

    // Path mismatch throws
    assert.throws(
      () =>
        assertServerAllowed({
          serverId: "remote",
          url: "https://api.example.com/admin",
          allow: "https://api.example.com/mcp",
        }),
      (err: unknown) => {
        assert.ok(err instanceof AgentSdkConfigError);
        assert.ok(err.message.includes("outside allow path"));
        return true;
      },
    );
  });

  it("connects eagerly via connector and cleans up on failure", async () => {
    let _closedCount = 0;
    const mockBridge: McpToolBridge = {
      tools: [
        {
          name: "mcp_tool_1",
          description: "from mcp",
          execute: () => ({ toolCallId: "1", name: "mcp_tool_1" }),
        },
      ],
      close: async () => {
        _closedCount++;
      },
      refresh: async () => {},
    };

    const assembled = await assembleMcpPlane({
      servers: [
        {
          serverId: "test",
          command: "echo",
          allow: "stdio",
        },
      ],
      connector: async () => mockBridge,
    });

    assert.strictEqual(assembled.bridges.length, 1);
    assert.strictEqual(assembled.tools.length, 1);
    assert.strictEqual(assembled.tools[0].name, "mcp_tool_1");
  });
});
