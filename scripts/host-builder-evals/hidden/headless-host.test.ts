import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { createHost } from "../src/host.ts";

let root = "";
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "hbe-headless-"));
  writeFileSync(join(root, "note.txt"), "hello from the note\n");
  mkdirSync(join(root, ".agents/skills/probe"), { recursive: true });
  writeFileSync(join(root, ".agents/skills/probe/SKILL.md"), "---\nname: probe\ndescription: A probe skill.\n---\n\nProbe instructions.\n");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("a headless host runs coding tools rooted at root with project skills", async () => {
  let last: { messages: Array<{ content: Array<{ type: string; content?: unknown; error?: unknown }> }> } | undefined;
  const agent = await createHost({
    model: { provider: "mock", model: "demo" },
    root,
    providers: [
      mockProvider(
        [
          [providerToolCall(toolCallContent("c1", "read", { path: "note.txt" })), providerDone()],
          [providerToolCall(toolCallContent("c2", "shell", { command: "echo hosted-ok" })), providerDone()],
          [providerTextDelta("done"), providerDone()],
        ],
        { onRequest: (request: never) => void (last = request) },
      ),
    ],
  });
  try {
    expect(agent.skills.some((skill) => skill.name === "probe")).toBe(true);
    const session = await agent.session();
    const result = await session.run("read the note and echo");
    expect(result.status).toBe("completed");
    const results = (last?.messages ?? []).flatMap((message) => message.content).filter((block) => block.type === "tool_result");
    const text = JSON.stringify(results);
    expect(text).toContain("hello from the note");
    expect(text).toContain("hosted-ok");
    expect(text).not.toContain("requires a principal");
    const names = agent.inspect().packages.map((entry: { name: string }) => entry.name);
    expect(names).toContain("@arnilo/prism-tools-coding");
    expect(names).toContain("@arnilo/prism-context-files");
  } finally {
    await agent.dispose();
  }
});
