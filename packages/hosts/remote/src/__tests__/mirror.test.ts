import { describe, expect, test } from "bun:test";
import {
  createAgent,
  createMemorySessionStore,
  createSessionIndex,
  providerDone,
  providerTextDelta,
  SESSION_LINKS_DATA_KEY,
} from "@arnilo/prism";
import { mockProvider } from "@arnilo/prism/testing";
import { connectAgent, remoteHostUi } from "../index.js";
import { connectProxy, gatedAgent } from "./helpers.js";

describe("mirror", () => {
  test("mirror_is_found_by_session_index", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui, text: "remote-answer" });
    const local = createMemorySessionStore();
    const { proxy } = await connectProxy(await build(), ui, { mirror: local, ownership: { tenantId: "t1" } });
    const session = await proxy.session({ parent: { sessionId: "parent-1", workflowRunId: "wf-1" } });
    await session.run("remote-question");

    // The host's own message lands in the same store under the same workflow run.
    const own = await createAgent({
      model: { provider: "mock", model: "m" },
      slots: { store: local },
      ownership: { tenantId: "t1" },
      packages: [mockProvider([[providerTextDelta("own-answer"), providerDone()]])],
    });
    await (await own.session({ parent: { workflowRunId: "wf-1" } })).run("own-question");

    const index = createSessionIndex(local, { ownership: { tenantId: "t1" } });
    const remoteHit = await index.search({ query: "remote-answer", workflowRunId: "wf-1" });
    expect(remoteHit.items.map((hit) => hit.sessionId)).toEqual([session.id]);
    const ownHit = await index.search({ query: "own-answer", workflowRunId: "wf-1" });
    expect(ownHit.items).toHaveLength(1);
    expect(ownHit.items[0]?.sessionId).not.toBe(session.id);

    const entries = await session.entries();
    expect(entries[0]?.kind).toBe("metadata");
    expect(entries[0]?.data).toMatchObject({
      [SESSION_LINKS_DATA_KEY]: { sessionId: "parent-1", workflowRunId: "wf-1", actor: { kind: "prism", agent: "served-agent" } },
    });
    const messages = entries.filter((entry) => entry.kind === "message");
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0]?.parentId).toBe(entries[0]?.id);
    for (const entry of entries) {
      expect(entry.metadata?.tenantId).toBe("t1");
      expect(entry.metadata?.remote).toBe("ep-proxy");
    }
    await proxy.dispose();
  });

  test("mirror_reopen_does_not_duplicate_links", async () => {
    const ui = remoteHostUi();
    const { build } = gatedAgent({ gate: false, ui });
    const local = createMemorySessionStore();
    const { proxy } = await connectProxy(await build(), ui, { mirror: local });
    const first = await proxy.session();
    await first.run("one");
    const before = (await first.entries()).filter((entry) => entry.kind === "metadata").length;
    const again = await proxy.session({ id: first.id });
    await again.run("two");
    const entries = await again.entries();
    expect(entries.filter((entry) => entry.kind === "metadata").length).toBe(before);
    await proxy.dispose();
  });

  test("stdio_child_serves_and_proxy_attributes", async () => {
    const proxy = await connectAgent({
      kind: "stdio",
      command: [process.execPath, new URL("./fixtures/serve-stdio.ts", import.meta.url).pathname],
    });
    expect(proxy.id).toBe("child");
    const session = await proxy.session();
    const result = await session.run("hi");
    expect(result.text).toBe("from the child");
    expect((proxy.inspect() as unknown as { remote: { endpointId: string } }).remote.endpointId).toBe("ep-child");
    await proxy.dispose();
  });
});
