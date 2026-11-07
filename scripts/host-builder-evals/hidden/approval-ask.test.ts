import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createScriptedHostUi,
  mockProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism/testing";
import { createHost } from "../src/host.ts";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hbe-approval-"));
  writeFileSync(join(root, "note.txt"), "before\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const EDIT = { path: "note.txt", edits: [{ oldText: "before", newText: "after" }] };

async function run(calls: Array<[string, Record<string, unknown>]>, ui?: ReturnType<typeof createScriptedHostUi>["ui"]) {
  const turns = calls.map(([name, args], index) => [providerToolCall(toolCallContent(`c${index}`, name, args)), providerDone()]);
  const agent = await createHost({
    model: { provider: "mock", model: "demo" },
    root,
    ...(ui ? { ui } : {}),
    providers: [mockProvider([...turns, [providerTextDelta("done"), providerDone()]] as never)],
  });
  try {
    const session = await agent.session();
    return await session.run("go");
  } finally {
    await agent.dispose();
  }
}

test("an approved edit runs and asks exactly once", async () => {
  const gate = createScriptedHostUi({ confirm: true, select: "once" });
  const result = await run([["edit", EDIT]], gate.ui);
  expect(result.status).toBe("completed");
  expect(readFileSync(join(root, "note.txt"), "utf8").trim()).toBe("after");
  expect(gate.requestsOf("confirm").length).toBe(1);
});

test("a refused edit never runs", async () => {
  const gate = createScriptedHostUi({ confirm: false });
  await run([["edit", EDIT]], gate.ui);
  expect(readFileSync(join(root, "note.txt"), "utf8").trim()).toBe("before");
  expect(gate.requestsOf("confirm").length).toBe(1);
});

test("shell and write ask too", async () => {
  const gate = createScriptedHostUi({ confirm: false });
  await run(
    [
      ["shell", { command: "echo changed > note.txt" }],
      ["write", { path: "note.txt", content: "overwritten\n" }],
    ],
    gate.ui,
  );
  expect(readFileSync(join(root, "note.txt"), "utf8").trim()).toBe("before");
  expect(gate.requestsOf("confirm").length).toBe(2);
});

test("with nobody to ask, the edit is refused", async () => {
  await run([["edit", EDIT]]);
  expect(readFileSync(join(root, "note.txt"), "utf8").trim()).toBe("before");
});

test("an unavailable UI refuses the edit", async () => {
  const gate = createScriptedHostUi(() => ({ status: "unavailable" }));
  await run([["edit", EDIT]], gate.ui);
  expect(readFileSync(join(root, "note.txt"), "utf8").trim()).toBe("before");
});

test("reads never ask", async () => {
  const gate = createScriptedHostUi({ confirm: false });
  const result = await run(
    [
      ["read", { path: "note.txt" }],
      ["grep", { pattern: "before", path: "." }],
    ],
    gate.ui,
  );
  expect(result.status).toBe("completed");
  expect(gate.requestsOf("confirm").length).toBe(0);
});
