import assert from "node:assert/strict";
import type { Embedder, VectorStore, WorkingMemoryStore } from "@arnilo/prism-memory-core";
import { createMemory, createMemoryFabric } from "../index.js";

export const PROJECT_A = "projects/alpha--00000001";
export const PROJECT_B = "projects/beta--00000002";

/**
 * Proves the scope hierarchy isolates projects over any store pair. Shared user and agent scopes
 * come back in both projects; a project fact and a path note never cross over; forgetting one
 * project's note leaves the other untouched.
 */
export async function assertScopeIsolation(
  stores: { readonly vectorStore: VectorStore; readonly workingStore: WorkingMemoryStore },
  embedder: Embedder,
): Promise<void> {
  const open = (resourceId: string) =>
    createMemory({ tenantId: "prism", resourceId, threadId: "default", embedder, ...stores });
  const projectA = open(PROJECT_A);
  const projectB = open(PROJECT_B);
  const agent = open("agent");
  const user = open("user");
  const fabric = (project: typeof projectA) =>
    createMemoryFabric({
      memory: project,
      scopes: [
        { level: "project", memory: project },
        { level: "agent", memory: agent },
        { level: "user", memory: user },
      ],
      consolidate: false,
    });
  const a = fabric(projectA);
  const b = fabric(projectB);

  const factA = await a.remember({ kind: "fact", content: "Alpha deploy token rotates weekly", scope: "project", key: "deploy.rotation" });
  const factB = await b.remember({ kind: "fact", content: "Beta deploy token rotates weekly", scope: "project", key: "deploy.rotation" });
  const preference = await a.remember({ kind: "preference", content: "Prefer pnpm over npm scripts", scope: "user" });
  const agentNote = await a.remember({ kind: "fact", content: "Run the typecheck before committing", scope: "agent" });
  const pathNote = await a.remember({
    kind: "procedure",
    content: "Alpha release checklist",
    scope: "path",
    appliesTo: ["packages/**"],
  });

  const facts = async (fabric: typeof a) => (await fabric.recall("deploy token rotates", { topK: 5 })).hits.map((hit) => hit.id);
  assert.deepEqual(await facts(a), [factA.id], "project A sees only its own fact");
  assert.deepEqual(await facts(b), [factB.id], "project B sees only its own fact");

  assert.ok((await b.recall("pnpm npm scripts", { topK: 5 })).hits.some((hit) => hit.id === preference.id), "the user preference crosses projects");
  assert.ok((await b.recall("typecheck committing", { topK: 5 })).hits.some((hit) => hit.id === agentNote.id), "the agent note crosses projects");

  const touched = ["packages/memory/fabric/src/index.ts"];
  const pathHits = await a.recall("alpha release checklist", { topK: 5, kinds: ["procedure"], touchedPaths: touched });
  assert.ok(pathHits.hits.some((hit) => hit.id === pathNote.id), "the path note is recalled on a matching touched path");
  const leaked = await b.recall("alpha release checklist", { topK: 5, kinds: ["procedure"], touchedPaths: touched });
  assert.ok(!leaked.hits.some((hit) => hit.id === pathNote.id), "the path note never crosses into project B");

  assert.equal((await a.forget({ id: factA.id })).deleted, 1);
  assert.deepEqual(await facts(a), [], "forgetting in A removes only A's fact");
  assert.deepEqual(await facts(b), [factB.id], "forgetting in A leaves B untouched");
}
