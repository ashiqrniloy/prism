import { afterEach, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent } from "@arnilo/prism";
import { mockProvider, providerDone, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import toolsCoding from "../index.js";

/**
 * The plugin wiring for background processes (plan 189 Task 9): `session.closed` — also emitted for
 * every open session by `agent.dispose()` — must kill every process the session started, so a
 * background command never outlives the session that started it.
 */

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() as string, { recursive: true, force: true });
});

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "prism-tools-coding-bg-"));
  dirs.push(dir);
  return dir;
}

/** Poll for a pid to disappear; a killed process may take a moment to be reaped. */
async function waitForDeath(pid: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/** One shell call that records its own shell pid, then blocks. */
function backgroundProvider(): ReturnType<typeof mockProvider> {
  return mockProvider(
    [
      [
        providerToolCall(toolCallContent("call-1", "shell", { command: "sh -c 'echo $$ > pid.txt; sleep 30'", background: true })),
        providerDone(),
      ],
      [providerDone()],
    ],
    { id: "background" },
  );
}

describe("@arnilo/prism-tools-coding background processes", () => {
  it("background_processes_killed_on_session_close", async () => {
    const root = await tempRoot();
    const agent = await createAgent({
      model: { provider: "background", model: "m" },
      ownership: { tenantId: "local" },
      principal: { kind: "user", id: "local" },
      packages: [backgroundProvider(), toolsCoding({ root })],
    });
    try {
      const session = await agent.session({ id: "bg-close", create: true });
      const texts: string[] = [];
      for await (const event of session.stream("start the dev server")) {
        if (event.type === "tool.completed") texts.push(JSON.stringify(event));
      }
      const started = texts.join("\n");
      assert.match(started, /Started process proc_[0-9a-f]+/, "the call returns the process id");
      const pid = Number((await readFile(join(root, "pid.txt"), "utf8")).trim());
      assert.ok(pid > 0, "the background command wrote its pid");
      process.kill(pid, 0); // throws if it never started

      await session.close();
      assert.equal(await waitForDeath(pid), true, "the background process must not survive session.closed");
    } finally {
      await agent.dispose();
    }
  }, 20_000);

  it("background_processes_killed_on_agent_dispose", async () => {
    const root = await tempRoot();
    const agent = await createAgent({
      model: { provider: "background", model: "m" },
      ownership: { tenantId: "local" },
      principal: { kind: "user", id: "local" },
      packages: [backgroundProvider(), toolsCoding({ root })],
    });
    const session = await agent.session({ id: "bg-dispose", create: true });
    for await (const _event of session.stream("start the dev server")) {
      // drain
    }
    const pid = Number((await readFile(join(root, "pid.txt"), "utf8")).trim());
    // No session.close(): dispose closes every open session itself.
    await agent.dispose();
    assert.equal(await waitForDeath(pid), true, "the background process must not survive agent.dispose()");
  }, 20_000);

  it("shell_output_is_registered_with_shell", async () => {
    const root = await tempRoot();
    const agent = await createAgent({
      model: { provider: "background", model: "m" },
      ownership: { tenantId: "local" },
      principal: { kind: "user", id: "local" },
      packages: [toolsCoding({ root })],
    });
    try {
      const names = agent.tools.map((tool) => tool.name);
      assert.equal(names.includes("shell"), true);
      assert.equal(names.includes("shell_output"), true);
      // The schema reaches the provider, not `agent.tools`; the unit test pins the shape.
      assert.equal(agent.inspect().packages.length > 0, true);
    } finally {
      await agent.dispose();
    }
  });
});
