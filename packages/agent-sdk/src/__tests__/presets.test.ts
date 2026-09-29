import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import {
  createMockProvider,
  type ExecutionPolicy,
  providerDone,
  providerTextDelta,
  type ToolDefinition,
  type ToolRegistry,
} from "@arnilo/prism";
import { AgentSdkConfigError, barePreset, codingPreset, defineAgent, mergeAgentConfig } from "../index.js";

function stubTool(name: string, description = `stub:${name}`): ToolDefinition {
  return {
    name,
    description,
    execute: () => ({ toolCallId: "1", name, value: "done" }),
  };
}

describe("presets", () => {
  const defaultModel = { provider: "mock", model: "mock-model" };

  it("barePreset + mock provider runs with empty registry", async () => {
    const provider = createMockProvider([providerTextDelta("Hello from bare preset!"), providerDone()]);

    const app = await defineAgent({
      ...barePreset(),
      model: defaultModel,
      provider,
    });

    const tools = (app.agent.config.tools as ToolRegistry).list();
    assert.strictEqual(tools.length, 0);

    const session = app.createSession();
    const result = await session.run("test");
    assert.strictEqual(result.status, "succeeded");
    assert.strictEqual(result.text, "Hello from bare preset!");

    await app.dispose();
  });

  it("codingPreset registers the nine default tools; host exclude removes one; host replace wins over preset plane", async () => {
    const provider = createMockProvider([providerTextDelta("ok"), providerDone()]);
    const preset = codingPreset({ cwd: "/test/dir" });

    // Verify 9 tools in preset
    const presetPlane = preset.tools?.planes?.coding;
    assert.ok(Array.isArray(presetPlane));
    assert.strictEqual(presetPlane.length, 9);
    assert.deepStrictEqual(
      presetPlane.map((t) => t.name),
      ["shell", "read", "write", "edit", "repo_list", "repo_search", "glob", "delete", "move"],
    );

    // Host exclude "shell", host replace "read"
    const customRead = stubTool("read", "custom read replacement");
    const merged = mergeAgentConfig(preset, {
      tools: {
        exclude: ["shell"],
        replace: { read: customRead },
      },
    });

    const app = await defineAgent({
      ...merged,
      model: defaultModel,
      provider,
    });

    const tools = (app.agent.config.tools as ToolRegistry).list();
    // shell is removed; 8 tools remain
    assert.strictEqual(tools.length, 8);
    assert.strictEqual(
      tools.some((t) => t.name === "shell"),
      false,
    );

    // read was replaced in place
    const readTool = tools.find((t) => t.name === "read");
    assert.ok(readTool);
    assert.strictEqual(readTool.description, "custom read replacement");

    await app.dispose();
  });

  it("git plane opt-in (planes.git: true) yields createGitTools set, not in codingPreset default", () => {
    const defaultPreset = codingPreset({ cwd: "/test/dir" });
    assert.strictEqual(defaultPreset.tools?.planes?.git, undefined);
    assert.ok(defaultPreset.tools?.planes?.coding);

    const gitOptIn = codingPreset({
      cwd: "/test/dir",
      planes: { git: true },
    });
    assert.ok(gitOptIn.tools?.planes?.coding);
    assert.ok(gitOptIn.tools?.planes?.git);

    const gitTools = gitOptIn.tools?.planes?.git as readonly ToolDefinition[];
    assert.strictEqual(gitTools.length, 7);
    assert.deepStrictEqual(
      gitTools.map((t) => t.name),
      ["git_status", "git_diff", "git_branch", "git_worktree", "git_apply", "git_commit", "git_pr_handoff"],
    );
  });

  it("codingPreset fails closed on empty or invalid cwd", () => {
    assert.throws(
      // @ts-expect-error testing invalid input
      () => codingPreset({}),
      (err: unknown) => {
        assert.ok(err instanceof AgentSdkConfigError);
        assert.ok(err.message.includes("cwd"));
        return true;
      },
    );
  });

  describe("mergeAgentConfig", () => {
    it("scalar override wins, tool-plane fields deep-merge, no shared-reference mutation between base and override", () => {
      const tool1 = stubTool("tool1");
      const tool2 = stubTool("tool2");
      const toolR1 = stubTool("toolR1", "base replace");
      const toolR1Override = stubTool("toolR1", "override replace");
      const toolR2 = stubTool("toolR2", "new replace");
      const toolA1 = stubTool("toolA1");
      const toolA2 = stubTool("toolA2");

      const base = {
        workspaceRoot: "/base/path",
        id: "base-agent",
        tools: {
          planes: { p1: [tool1] },
          exclude: ["e1"],
          replace: { toolR1 },
          add: [toolA1],
        },
        skills: {
          workspaceRoot: "/base/skills",
          exclude: ["sk_base"],
          add: [],
        },
        instructions: {
          text: "base text",
          agentsMd: true,
        },
      };

      const override = {
        workspaceRoot: "/override/path",
        tools: {
          planes: { p2: [tool2] },
          exclude: ["e2"],
          replace: { toolR1: toolR1Override, toolR2 },
          add: [toolA2],
        },
        skills: {
          workspaceRoot: "/override/skills",
          exclude: ["sk_override"],
        },
        instructions: {
          text: "override text",
        },
      };

      const merged = mergeAgentConfig(base, override);

      // Scalar override wins
      assert.strictEqual(merged.workspaceRoot, "/override/path");
      assert.strictEqual(merged.id, "base-agent");

      // Tool planes merge
      assert.ok(merged.tools?.planes?.p1);
      assert.ok(merged.tools?.planes?.p2);
      assert.deepStrictEqual(merged.tools?.exclude, ["e1", "e2"]);
      assert.deepStrictEqual(merged.tools?.add, [toolA1, toolA2]);
      assert.strictEqual(merged.tools?.replace?.toolR1.description, "override replace");
      assert.strictEqual(merged.tools?.replace?.toolR2.description, "new replace");

      // Skills merge
      assert.strictEqual(merged.skills?.workspaceRoot, "/override/skills");
      assert.deepStrictEqual(merged.skills?.exclude, ["sk_base", "sk_override"]);

      // Instructions merge
      assert.deepStrictEqual(merged.instructions, {
        text: "override text",
        agentsMd: true,
      });

      // No shared-reference mutation: mutating base arrays after merge does NOT affect merged
      base.tools.exclude.push("e_mutated");
      base.tools.add.push(stubTool("mutated_add"));
      assert.deepStrictEqual(merged.tools?.exclude, ["e1", "e2"]);
      assert.deepStrictEqual(merged.tools?.add, [toolA1, toolA2]);

      // Mutating merged does not affect base or override
      assert.ok(merged.tools?.exclude);
      (merged.tools.exclude as string[]).push("merged_mutated");
      assert.deepStrictEqual(base.tools.exclude, ["e1", "e_mutated"]);
      assert.deepStrictEqual(override.tools.exclude, ["e2"]);
    });

    it("mcp concatenates servers and keeps allow/connectTimeoutMs/executionPolicy with override precedence", () => {
      const policy = { check: async () => ({ allowed: true }) } as unknown as ExecutionPolicy;
      const base = {
        mcp: {
          servers: [{ serverId: "a", command: "a", allow: "stdio" }],
          allow: ["https://a.example"],
          connectTimeoutMs: 1000,
        },
      };
      const override = {
        mcp: {
          servers: [{ serverId: "b", command: "b", allow: "stdio" }],
          connectTimeoutMs: 2000,
          executionPolicy: policy,
        },
      };

      const merged = mergeAgentConfig(base, override);
      assert.deepStrictEqual(
        merged.mcp?.servers?.map((server) => server.serverId),
        ["a", "b"],
      );
      assert.deepStrictEqual(merged.mcp?.allow, ["https://a.example"]);
      assert.strictEqual(merged.mcp?.connectTimeoutMs, 2000);
      assert.strictEqual(merged.mcp?.executionPolicy, policy);
    });
  });
});
