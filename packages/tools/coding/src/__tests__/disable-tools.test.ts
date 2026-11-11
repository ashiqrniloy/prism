import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderRequest } from "@arnilo/prism";
import { createAgent } from "@arnilo/prism";
import { mockProvider, providerDone, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import toolsCoding from "../index.js";

/**
 * `disable.tools` removes a package-provided tool before dispatch (plan 154 Task 8). The host's own
 * `tools.add` and a package's tool share one registry, so the disabled name must vanish from
 * `agent.tools`, from the tools the provider is offered, and from dispatch — a call to it is blocked
 * as an unknown tool and never runs.
 */

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-tools-coding-disable-"));
  dirs.push(dir);
  return dir;
}

/** Records the tool names of every provider turn, then asks for one shell call. */
function recordingProvider(seen: string[][]) {
  return mockProvider([[providerToolCall(toolCallContent("call-1", "shell", { command: "echo hi" })), providerDone()], [providerDone()]], {
    id: "recorder",
    onRequest: (request: ProviderRequest) => seen.push((request.tools ?? []).map((tool) => tool.name)),
  });
}

describe("@arnilo/prism-tools/coding disable.tools", () => {
  it("disable_tools_shell_removes_shell", async () => {
    const root = await tempRoot();
    const seen: string[][] = [];
    const agent = await createAgent({
      model: { provider: "recorder", model: "m" },
      ownership: { tenantId: "local" },
      principal: { kind: "user", id: "local" },
      disable: { tools: ["shell"] },
      packages: [recordingProvider(seen), toolsCoding({ root })],
    });
    try {
      const names = agent.tools.map((tool) => tool.name);
      assert.equal(names.includes("shell"), false, `shell must be gone, got ${names.join(", ")}`);
      assert.equal(names.includes("read"), true, "the other tools stay registered");
      assert.deepEqual(agent.inspect().disabled.tools, ["shell"], "inspect() reports the removal");

      const session = await agent.session({ id: "disable-shell", create: true });
      const events = [];
      for await (const event of session.stream("run the shell")) events.push(event);
      await session.close();

      assert.equal(seen.length >= 1, true);
      assert.equal(seen[0]?.includes("shell"), false, `the provider never sees shell, got ${seen[0]?.join(", ")}`);
      assert.equal(
        events.some((event) => event.type === "tool.started"),
        false,
        "a disabled tool is not dispatched",
      );
      const blocked = events.find((event) => event.type === "tool.completed" && event.status === "blocked");
      assert.equal(blocked?.type === "tool.completed" ? blocked.reason : undefined, "unknown_tool");
      assert.match(blocked?.type === "tool.completed" ? (blocked.error?.message ?? "") : "", /Unknown tool: shell/);
    } finally {
      await agent.dispose();
    }
  });
});
