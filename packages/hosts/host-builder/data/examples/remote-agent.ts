import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Agent,
  createAgent,
  createSessionIndex,
  definePackage,
  type HostUi,
  providerDone,
  providerTextDelta,
  type SessionStore,
} from "@arnilo/prism";
import { createScriptedHostUi, mockProvider } from "@arnilo/prism/testing";

import sqliteStore, { createSqlitePersistence } from "@arnilo/prism-store-sqlite";
import workflows, { agentNode, defineWorkflow, startWorkflow, type WorkflowRun } from "@arnilo/prism-workflows";

// Keep Bun transport declarations out of the examples compiler (see the conformance fixture).
const remoteModule = "@arnilo/prism-remote";
const connectAgent: (
  endpoint: { kind: "stdio"; command: string[] },
  options: { host: { ui: HostUi }; mirror: SessionStore },
) => Promise<Agent> = (await import(remoteModule)).connectAgent;

// Run offline: bun examples/remote-agent.ts (also works as emitted JavaScript).
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`remote_agent_example_output: ${message}`);
}

export async function demo() {
  const root = mkdtempSync(join(tmpdir(), "prism-remote-"));
  const path = join(root, "sessions.db");
  const store = createSqlitePersistence({ filename: path });
  const agents: Agent[] = [];
  try {
    const scripted = createScriptedHostUi({ confirm: true, select: "once" });
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    const remote = await connectAgent(
      {
        kind: "stdio",
        command: [process.execPath, fileURLToPath(new URL(`./remote-agent-server.${extension}`, import.meta.url))],
      },
      { host: { ui: scripted.ui }, mirror: store },
    );
    agents.push(remote);
    const local = await createAgent({
      id: "local-reviewer",
      model: { provider: "mock", model: "demo" },
      packages: [sqliteStore({ path }), mockProvider([[providerTextDelta("Local reviewed report"), providerDone()]])],
    });
    agents.push(local);
    const flow = defineWorkflow({
      id: "remote-review",
      revision: "1",
      nodes: {
        plan: agentNode({ agent: remote, input: () => "Save the report" }),
        review: agentNode({ agent: local, input: (ctx) => `Review: ${String(ctx.upstream.plan)}` }),
      },
      edges: [["plan", "review"]],
    });
    const host = await createAgent({
      model: { provider: "mock", model: "demo" },
      packages: [
        sqliteStore({ path }),
        mockProvider([[providerDone()]]),
        workflows,
        definePackage({
          name: "@example/remote-workflow",
          version: "1.0.0",
          requires: { api: 1 },
          setup(prism) {
            prism.commands.register({
              name: "review",
              description: "Run the remote and local agents",
              run: (_args, ctx) => startWorkflow(flow, "report", { prism, session: ctx.session! }),
            });
          },
        }),
      ],
    });
    agents.push(host);
    const parent = await host.session();
    const run = (await host.commands.run("review", undefined, { session: parent })) as WorkflowRun;
    let remoteEvents = 0;
    let externalTools = 0;
    for await (const event of run.stream()) {
      console.log(JSON.stringify(event));
      if ("origin" in event && event.origin?.remote === "example-remote") {
        remoteEvents++;
        if (event.type.startsWith("tool.")) {
          assert(event.origin.executedBy === "external", "remote tool attribution");
          externalTools++;
        }
      }
    }
    const result = await run.result();
    const hits = await createSessionIndex(store).search({ query: "report", workflowRunId: run.id });
    assert(result.status === "succeeded", `workflow ${result.status}`);
    assert(scripted.requestsOf("confirm").length === 1, "approval did not reach local HostUi");
    assert(remoteEvents > 0 && externalTools > 0, "origin.remote missing");
    assert(hits.items.length === 2, `expected two search hits, got ${hits.items.length}`);
    assert(
      hits.items.some((hit) => (hit.snippet ?? "").includes("Remote approved")),
      "remote reply missing",
    );
    assert(
      hits.items.some((hit) => (hit.snippet ?? "").includes("Local reviewed")),
      "local reply missing",
    );
    await parent.close();
    return { status: result.status, approved: true, remoteEvents, searchHits: hits.items };
  } finally {
    try {
      for (const agent of agents.reverse()) await agent.dispose();
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(await demo()));
