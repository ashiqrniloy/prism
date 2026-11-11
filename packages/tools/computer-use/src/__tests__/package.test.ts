import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { ToolDefinition, ToolResult } from "@arnilo/prism";
import { createAgent, definePackage } from "@arnilo/prism";
import { mockProvider, packageConformance, providerDone, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { approvalPackage } from "@arnilo/prism-extensions/approval";
import type { McpToolBridge } from "@arnilo/prism-extensions/mcp";
import { createComputerUseLinuxTools } from "../create.js";
import toolsComputerUse from "../index.js";

const DEVICE = { enabled: true, requireApproval: true, sandbox: "test-desktop" } as const;
const RUN_LIMITS = { maxTurns: 8, maxToolCalls: 20 } as const;

function remoteTool(name: string, value: unknown = true): ToolDefinition {
  return {
    name,
    parameters: { type: "object", additionalProperties: true },
    async execute(_args, ctx): Promise<ToolResult> {
      return { toolCallId: ctx.toolCallId, name, value };
    },
  };
}

function fakeBridge(tools: readonly ToolDefinition[], onClose?: () => void): McpToolBridge {
  return { tools, refresh: async () => {}, close: async () => onClose?.() };
}

/** A probe package that supplies the package's optional MCP bridge service. */
function bridgeProbe(bridge: McpToolBridge) {
  return definePackage<Record<string, never>>({
    name: "test-computer-use-bridge",
    version: "0.0.0",
    requires: { api: 1 },
    setup: (prism) => {
      prism.services.provide("computer-use.mcp", async () => bridge);
    },
  });
}

function toolResults(entries: readonly { kind: string; message?: { content: readonly unknown[] } }[]) {
  return entries.flatMap((entry) =>
    entry.kind === "message" && entry.message
      ? (entry.message.content.filter(
          (block): block is { type: "tool_result"; error?: { code: string; message: string } } =>
            (block as { type: string }).type === "tool_result",
        ) as { type: "tool_result"; error?: { code: string; message: string } }[])
      : [],
  );
}

describe("@arnilo/prism-tools/computer-use package", () => {
  it("tools_computer_use_package_conformance", async () => {
    const result = await packageConformance(
      toolsComputerUse({ command: "/nonexistent/computer-use-linux", device: DEVICE, runLimits: RUN_LIMITS }),
    );
    assert.deepEqual(
      result.checks.filter((check) => !check.ok),
      [],
    );
    assert.equal(result.ok, true);
  });

  it("tools_computer_use_probe_failure_notes", async () => {
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [toolsComputerUse({ command: "/nonexistent/computer-use-linux", device: DEVICE, runLimits: RUN_LIMITS })],
    });
    try {
      assert.equal(agent.tools.length, 0);
      assert.equal(agent.inspect().skills.length, 0);
      assert.ok(
        agent.inspect().statusNotes.some((note) => note.level === "warn" && note.message.startsWith("computer-use:")),
        "the missing binary is noted",
      );
    } finally {
      await agent.dispose();
    }
  });

  it("tools_computer_use_registers_with_effects_and_disposes", async () => {
    let closed = false;
    const bridge = fakeBridge([remoteTool("doctor"), remoteTool("click")], () => {
      closed = true;
    });
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      packages: [bridgeProbe(bridge), toolsComputerUse({ command: process.execPath, device: DEVICE, runLimits: RUN_LIMITS })],
    });
    try {
      assert.deepEqual(agent.tools.map((tool) => tool.name).sort(), ["click", "doctor"]);
      for (const tool of agent.tools) {
        assert.deepEqual(tool.effects, ["external"], `${tool.name} must declare external`);
        assert.equal(tool.package, "@arnilo/prism-tools/computer-use");
      }
      assert.ok(
        agent.inspect().skills.some((skill) => skill.name === "computer-use-linux"),
        "the bundled skill registers",
      );
      await agent.dispose();
      assert.equal(closed, true, "dispose closes the MCP bridge");
    } finally {
      await agent.dispose();
    }
  });

  it("tools_computer_use_mutating_denied_in_auto", async () => {
    const desktop = await createComputerUseLinuxTools({
      platform: "linux",
      device: { kind: "desktop-control", ...DEVICE },
      runLimits: RUN_LIMITS,
      approved: false,
      connect: async () => fakeBridge([remoteTool("doctor"), remoteTool("click")]),
    });
    const provider = mockProvider([[providerToolCall(toolCallContent("c1", "click", { x: 1, y: 1 })), providerDone()], [providerDone()]], {
      id: "mock",
    });
    const agent = await createAgent({
      model: { provider: "mock", model: "m" },
      tools: { add: desktop.tools },
      packages: [provider, approvalPackage({ mode: "auto" })],
    });
    try {
      const session = await agent.session({ id: "computer-use-auto", create: true });
      await session.run("click the desktop");
      await session.close();
      const denied = toolResults(await session.entries()).find((block) => block.error !== undefined);
      assert.ok(denied, "a mutating call was not denied under approval auto");
      assert.match(denied.error?.message ?? "", /approval|device/i);
      await desktop.close();
    } finally {
      await agent.dispose();
      await desktop.close();
    }
  });
});
