import { expect, test } from "bun:test";
import { mockProvider } from "@arnilo/prism/testing";
import { createHost } from "../src/host.ts";

test("memory-compaction owns the compaction slot and the local package still loads", async () => {
  const agent = await createHost({ model: { provider: "mock", model: "demo" }, providers: [mockProvider()] });
  try {
    const inspection = agent.inspect();
    expect(inspection.slots.compaction).toBe("@arnilo/prism-memory-compaction");
    const names = inspection.packages.map((entry: { name: string }) => entry.name);
    expect(names).toContain("@arnilo/prism-memory-compaction");
    expect(names).toContain("@acme/local-compaction");
    expect(await agent.commands.run("local:ping")).toBe("pong");
  } finally {
    await agent.dispose();
  }
});

test("the host keeps the model and providers it was given", async () => {
  const agent = await createHost({ model: { provider: "mock", model: "demo" }, providers: [mockProvider()] });
  try {
    const session = await agent.session();
    expect((await session.run("hi")).status).toBe("completed");
  } finally {
    await agent.dispose();
  }
});
