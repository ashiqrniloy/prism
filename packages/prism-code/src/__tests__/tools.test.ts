import { describe, it } from "bun:test";
import assert from "node:assert";
import type { ToolDefinition } from "@arnilo/prism";
import { BUNDLED_CODING_TOOLS, CORE_CODING_TOOL_NAMES, GIT_TOOL_NAMES, resolveCodingToolSet } from "../tools.js";

describe("Bundled Coding Tools Inventory & Opt-in Resolution", () => {
  it("inventory declares core nine + todo_write + ask_user_decision as defaultOn and git/checks as opt-in", () => {
    const defaultOnTools = BUNDLED_CODING_TOOLS.filter((t) => t.defaultOn);
    const optInTools = BUNDLED_CODING_TOOLS.filter((t) => !t.defaultOn);

    // 9 core tools + todo_write + ask_user_decision default on
    assert.strictEqual(defaultOnTools.length, 11);
    for (const tool of defaultOnTools) {
      if (tool.name === "todo_write") {
        assert.strictEqual(tool.category, "plan");
        continue;
      }
      if (tool.name === "ask_user_decision") {
        assert.strictEqual(tool.category, "decision");
        continue;
      }
      assert.strictEqual(CORE_CODING_TOOL_NAMES.has(tool.name), true);
      assert.strictEqual(tool.category, "core");
    }

    // Opt-in: 7 git tools + coding_check (registered only with config-declared commands)
    assert.ok(optInTools.length >= 8);
    const optInNames = new Set(optInTools.map((t) => t.name));
    for (const gitName of GIT_TOOL_NAMES) {
      assert.strictEqual(optInNames.has(gitName), true);
    }
    assert.strictEqual(optInNames.has("coding_check"), true);
  });

  it("default resolution is core nine + todo_write + ask_user_decision, without checks or git", () => {
    const tools = resolveCodingToolSet({ cwd: process.cwd() });
    assert.strictEqual(tools.length, 11);
    const names = new Set(tools.map((t) => t.name));

    for (const coreName of CORE_CODING_TOOL_NAMES) {
      assert.strictEqual(names.has(coreName), true, `Missing core tool ${coreName}`);
    }

    assert.strictEqual(names.has("ask_user_decision"), true);
    // Unsafe opt-ins must NOT be present
    for (const gitName of GIT_TOOL_NAMES) {
      assert.strictEqual(names.has(gitName), false, `Opt-in tool ${gitName} must not be present by default`);
    }
    assert.strictEqual(names.has("coding_check"), false);
  });

  it("loop.continueOnOpenTodos: false disables the todo_write tool", () => {
    const tools = resolveCodingToolSet({
      cwd: process.cwd(),
      config: { cwd: process.cwd(), loop: { continueOnOpenTodos: false } },
    });
    assert.strictEqual(tools.length, 10);
    assert.strictEqual(
      tools.some((t) => t.name === "todo_write"),
      false,
    );
  });

  it("opt-in via planes.git adds 7 git tools safely", () => {
    const tools = resolveCodingToolSet({
      cwd: process.cwd(),
      config: {
        cwd: process.cwd(),
        tools: {
          planes: { git: true },
        },
      },
    });

    const names = new Set(tools.map((t) => t.name));
    assert.strictEqual(tools.length, 11 + 7);
    for (const gitName of GIT_TOOL_NAMES) {
      assert.strictEqual(names.has(gitName), true);
    }
  });

  it("coding_check registers only when config declares named checks", () => {
    const withoutChecks = resolveCodingToolSet({
      cwd: process.cwd(),
      config: { cwd: process.cwd(), tools: { optIn: ["coding_checks"] } },
    });
    assert.strictEqual(
      withoutChecks.some((t) => t.name === "coding_check"),
      false,
    );

    const tools = resolveCodingToolSet({
      cwd: process.cwd(),
      config: {
        cwd: process.cwd(),
        checks: { test: { command: "bun", args: ["test"] } },
        tools: { optIn: ["git"] },
      },
    });

    const names = new Set(tools.map((t) => t.name));
    assert.strictEqual(names.has("coding_check"), true);
    assert.strictEqual(names.has("git_status"), true);
  });

  it("exclusions remove tools even when opted in", () => {
    const tools = resolveCodingToolSet({
      cwd: process.cwd(),
      config: {
        cwd: process.cwd(),
        tools: {
          planes: { git: true },
          exclude: ["shell", "git_commit", "delete"],
        },
      },
    });

    const names = new Set(tools.map((t) => t.name));
    assert.strictEqual(names.has("shell"), false);
    assert.strictEqual(names.has("git_commit"), false);
    assert.strictEqual(names.has("delete"), false);
    assert.strictEqual(names.has("read"), true);
    assert.strictEqual(names.has("git_status"), true);
  });

  it("replacements replace matching tools in the resolved set", () => {
    const mockReplacement: ToolDefinition = {
      name: "shell",
      description: "Custom sandboxed shell",
      parameters: { type: "object" },
      execute: async (ctx: any) => ({
        toolCallId: ctx?.toolCallId ?? "call_1",
        name: "shell",
        content: [{ type: "text", text: "sandboxed" }],
      }),
    };

    const tools = resolveCodingToolSet({
      cwd: process.cwd(),
      replaceTools: {
        shell: mockReplacement,
      },
    });

    const shellTool = tools.find((t) => t.name === "shell");
    assert.ok(shellTool);
    assert.strictEqual(shellTool.description, "Custom sandboxed shell");
  });

  it("read-only mode resolves only the 4 read tools and ignores opt-ins that write", () => {
    const tools = resolveCodingToolSet({
      cwd: process.cwd(),
      isReadOnly: true,
      config: {
        cwd: process.cwd(),
        tools: {
          planes: { git: true }, // git write tools must NOT be included in read-only
        },
      },
    });

    assert.strictEqual(tools.length, 4);
    const names = new Set(tools.map((t) => t.name));
    assert.strictEqual(names.has("read"), true);
    assert.strictEqual(names.has("repo_list"), true);
    assert.strictEqual(names.has("repo_search"), true);
    assert.strictEqual(names.has("glob"), true);
    assert.strictEqual(names.has("shell"), false);
    assert.strictEqual(names.has("write"), false);
    assert.strictEqual(names.has("git_commit"), false);
  });
});
