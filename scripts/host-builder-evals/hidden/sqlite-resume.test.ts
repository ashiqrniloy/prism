import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockProvider, providerDone, providerTextDelta } from "@arnilo/prism/testing";
import { createHost } from "../src/host.ts";

let dir = "";
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), "hbe-sqlite-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const providers = (...texts: string[]) => [mockProvider(texts.map((text) => [providerTextDelta(text), providerDone()]) as never)];

test("a new host over the same database reopens the session by id with its messages", async () => {
  const dbPath = join(dir, "sessions.db");
  const first = await createHost({
    model: { provider: "mock", model: "demo" },
    providers: providers("First answer.", "Second answer."),
    dbPath,
  });
  const session = await first.session();
  await session.run("first question");
  await session.run("second question");
  const before = await session.messages();
  const id = session.id;
  await first.dispose();
  expect(existsSync(dbPath)).toBe(true);

  const second = await createHost({ model: { provider: "mock", model: "demo" }, providers: providers("Third answer."), dbPath });
  try {
    const reopened = await second.session({ id });
    expect(reopened.id).toBe(id);
    const after = await reopened.messages();
    expect(after.length).toBe(before.length);
    expect(JSON.stringify(after)).toContain("first question");
    expect(JSON.stringify(after)).toContain("Second answer.");
    await reopened.run("third question");
    expect((await reopened.messages()).length).toBe(before.length + 2);
  } finally {
    await second.dispose();
  }
});

test("without dbPath the host still works in memory", async () => {
  const agent = await createHost({ model: { provider: "mock", model: "demo" }, providers: providers("Only answer.") });
  try {
    const session = await agent.session();
    const result = await session.run("hello");
    expect(result.status).toBe("completed");
  } finally {
    await agent.dispose();
  }
});
