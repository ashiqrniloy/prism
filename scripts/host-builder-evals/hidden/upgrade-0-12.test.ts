import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockProvider, providerDone, providerTextDelta, providerToolCall, toolCallContent } from "@arnilo/prism/testing";
import { createHost } from "../src/host.ts";

let root = "";
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "hbe-upgrade-"));
  writeFileSync(join(root, "note.txt"), "hello from the note\n");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("the upgraded host runs on 0.13 with the coding tools rooted at root", async () => {
  let last: { messages: Array<{ content: Array<{ type: string }> }> } | undefined;
  const agent = await createHost({
    root,
    providers: [
      mockProvider(
        [
          [providerToolCall(toolCallContent("c1", "read", { path: "note.txt" })), providerDone()],
          [providerToolCall(toolCallContent("c2", "shell", { command: "echo upgraded-ok" })), providerDone()],
          [providerTextDelta("done"), providerDone()],
        ],
        { onRequest: (request: never) => void (last = request) },
      ),
    ],
  });
  try {
    const session = await agent.session();
    const result = await session.run("go");
    expect(result.status).toBe("completed");
    const text = JSON.stringify(
      (last?.messages ?? []).flatMap((message) => message.content).filter((block) => block.type === "tool_result"),
    );
    expect(text).toContain("hello from the note");
    expect(text).toContain("upgraded-ok");
    expect(agent.inspect().packages.map((entry: { name: string }) => entry.name)).toContain("@arnilo/prism-tools/coding");
  } finally {
    await agent.dispose();
  }
});

test("the upgraded host uses the mock provider's demo model and keeps files inside root", async () => {
  let model: unknown;
  const agent = await createHost({
    root,
    providers: [
      mockProvider([[providerTextDelta("ok"), providerDone()]], {
        onRequest: (request: { model?: unknown }) => void (model = request.model),
      }),
    ],
  });
  try {
    const session = await agent.session();
    await session.run("hi");
    expect(JSON.stringify(model)).toContain("demo");
  } finally {
    await agent.dispose();
  }
});
