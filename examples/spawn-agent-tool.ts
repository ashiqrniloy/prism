import assert from "node:assert/strict";
import {
  type AgentIdentity,
  createAgent,
  createMockProvider,
  narrowIdentity,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type ToolDefinition,
} from "@arnilo/prism";
import { createSpawnAgentTool, createSupervisor, createWaitAgentTool } from "@arnilo/prism-core/runtime/supervisor";

/** The explore child's whole tool set: read-only, host-owned, no write path. */
const readOnly: ToolDefinition = {
  name: "read",
  exclusive: false,
  description: "Read one file.",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  execute: (args, context) => ({ toolCallId: context.toolCallId, name: "read", content: [], value: { path: args.path } }),
};

export async function demo(): Promise<{ readonly spawned: number; readonly refused: readonly string[]; readonly status: string }> {
  // `narrowIdentity` is the guard the supervisor applies to every child; calling it at host
  // construction time means a widening grant fails before any agent exists.
  const host: AgentIdentity = {
    tenantId: "demo",
    userId: "demo",
    principal: { kind: "user", id: "demo" },
    scopes: ["read", "write"],
    issuedAt: "2026-09-01T00:00:00.000Z",
    verified: true,
  };
  const exploreGrant = narrowIdentity(host, { scopes: ["read"] });
  assert.throws(() => narrowIdentity(host, { scopes: ["admin"] }), "child scopes cannot widen");

  let turns = 0;
  let spawned = 0;
  let live = 0;
  let peak = 0;
  const refused: string[] = [];
  const handles: string[] = [];
  const supervisor = createSupervisor({
    id: "demo-spawn",
    ownership: { tenantId: "demo", userId: "demo" },
    identity: host,
    limits: { maxActiveChildren: 2 },
    children: {
      explore: {
        description: "Read-only research.",
        // Host-authored grant; the supervisor derives each child identity from it.
        scopes: exploreGrant.scopes,
        createAgent: (context) => {
          spawned += 1;
          live += 1;
          peak = Math.max(peak, live);
          assert.deepEqual([...(context.identity?.scopes ?? [])], ["read"], "the child identity is narrowed, never widened");
          return createAgent({
            model: { provider: "mock", model: "demo" },
            provider: createMockProvider([providerTextDelta("research complete"), providerDone()]),
            tools: [readOnly],
          });
        },
      },
    },
    hooks: {
      after: () => {
        live -= 1;
      },
    },
  });
  assert.deepEqual([...supervisor.childIds], ["explore"], "the model can only reach catalogued children");

  // The parent model passes child IDs only; the host keeps the local handles.
  const spawn = createSpawnAgentTool({ supervisor });
  const observedSpawn: ToolDefinition = {
    ...spawn,
    async execute(args, context) {
      const result = await spawn.execute(args, context);
      if (result.error) refused.push(String(args.childId));
      const handle = result.value as { readonly delegationId?: string } | undefined;
      if (handle?.delegationId) handles.push(handle.delegationId);
      return result;
    },
  };
  const parent = createAgent({
    model: { provider: "mock", model: "demo" },
    provider: {
      id: "mock",
      async *generate() {
        if (++turns === 1) {
          for (const [index, input] of ["auth", "billing"].entries()) {
            yield providerToolCall({
              type: "tool_call",
              id: `explore-${index}`,
              name: "spawn_agent",
              arguments: { childId: "explore", input, mode: "async" },
            });
          }
          // Not in the catalog: the tool refuses it before any delegation.
          yield providerToolCall({ type: "tool_call", id: "deploy", name: "spawn_agent", arguments: { childId: "deploy", input: "push" } });
          yield providerDone();
          return;
        }
        if (turns === 2) {
          for (const [index, delegationId] of handles.entries()) {
            yield providerToolCall({ type: "tool_call", id: `wait-${index}`, name: "wait_agent", arguments: { delegationId } });
          }
          yield providerDone();
          return;
        }
        yield providerTextDelta("done");
        yield providerDone();
      },
    },
    tools: [observedSpawn, createWaitAgentTool({ supervisor })],
  });
  const result = await parent.createSession().run("Research auth and billing.", {
    loop: { strategy: "single-shot", toolConcurrency: 3 },
  });
  assert.equal(result.status, "succeeded");
  assert.equal(spawned, 2, "both explores ran");
  assert.equal(peak, 2, "both explores ran in parallel");
  assert.deepEqual(refused, ["deploy"], "an uncatalogued child fails closed");
  assert.equal(handles.length, 2);
  assert.equal(supervisor.activeChildren, 0, "every handle was joined");
  return { spawned, refused, status: result.status };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await demo()));
}
