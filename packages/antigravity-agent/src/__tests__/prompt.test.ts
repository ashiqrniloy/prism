import assert from "node:assert/strict";
import { test } from "node:test";
import { AntigravityWorkspaceConfigError, buildCustomAgentInstructions, resolveToolPolicy } from "../index.js";

test("buildCustomAgentInstructions: generates structured prompt sections", () => {
  const policy = resolveToolPolicy({
    policy: "prism-mutators",
    serverName: "prism",
    allowedMcpTools: ["read_file", "edit_file", "execute_command"],
  });

  const instructions = buildCustomAgentInstructions({
    systemPrompt: "You are an expert TypeScript developer.",
    taskInstructions: "Fix the failing type checks.",
    skills: [
      {
        name: "test-runner",
        description: "Runs node test runner",
        instructions: "Always run npm test after modifying files.",
      },
    ],
    context: ["Repository uses npm workspaces.", { title: "Active Branch", content: "main" }],
    toolPolicy: policy,
    exposedMcpTools: ["read_file", "edit_file", "execute_command"],
    serverName: "prism",
  });

  assert.match(instructions, /## Prism Capabilities & Tool Policy/);
  assert.match(instructions, /`prism:read_file`/);
  assert.match(instructions, /`prism:edit_file`/);
  assert.match(instructions, /`prism:execute_command`/);
  assert.match(instructions, /State-changing operations.*MUST be routed through the corresponding Prism MCP tools/);
  assert.match(instructions, /## System Instructions\nYou are an expert TypeScript developer\./);
  assert.match(instructions, /## Task Directives\nFix the failing type checks\./);
  assert.match(
    instructions,
    /## Active Skills\n\n### Skill: test-runner - Runs node test runner\nAlways run npm test after modifying files\./,
  );
  assert.match(instructions, /## Context\n\nRepository uses npm workspaces\.\n\n### Active Branch\nmain/);
});

test("buildCustomAgentInstructions: handles empty and minimal options cleanly", () => {
  const empty = buildCustomAgentInstructions();
  assert.equal(empty, "");

  const sysOnly = buildCustomAgentInstructions({ systemPrompt: "Hello" });
  assert.equal(sysOnly, "## System Instructions\nHello");
});

test("buildCustomAgentInstructions: rejects oversized instructions exceeding limit", () => {
  const oversized = "x".repeat(300 * 1024);
  assert.throws(() => buildCustomAgentInstructions({ systemPrompt: oversized }), AntigravityWorkspaceConfigError);
});
