import assert from "node:assert/strict";
import {
  type AIProvider,
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  type SessionStore,
  toolCallContent,
} from "@arnilo/prism";
import {
  createObservationalMemory,
  createWorkScopeController,
  foldObservationalMemoryLedger,
  foldWorkScopeMap,
  projectWorkMemory,
  withWorkScope,
} from "@arnilo/prism-memory/compaction/observational-memory";

const model = { provider: "mock", model: "demo" };
const workerModel = { provider: "mock", model: "memory" };

function observationProvider(store: SessionStore, sessionId: string): AIProvider {
  return {
    id: "memory",
    async *generate() {
      const source = (await store.list(sessionId)).filter((entry) => entry.kind === "message" && entry.message?.role === "user").at(-1);
      if (source) {
        yield providerToolCall(
          toolCallContent("observation", "record_observation", {
            content: "Completed coding task.",
            relevance: "high",
            sourceEntryIds: [source.id],
          }),
        );
      }
      yield providerDone();
    },
  };
}

// functionNode({
//   execute: (ctx) => withWorkScope(controller, { id: ctx.nodeId, kind: "workflow-node" }, () => session.run("work")),
// });
// runWorkflow remains unaware.
export async function demo() {
  const store = createMemorySessionStore();
  const agent = createAgent({ model, provider: createMockProvider([providerTextDelta("ok"), providerDone()]), store });
  const baseSession = agent.createSession({ id: "work-scopes" });
  const memory = createObservationalMemory({
    observation: { provider: observationProvider(store, baseSession.id), model: workerModel },
    overrides: { observation: { messageTokens: 1 }, reflection: { observationTokens: 1_000 }, agentMaxTurns: 1 },
  });
  const attached = memory.attach(baseSession, {
    appendEntry: (entry, options) => store.append(entry, options),
    sessionModel: model,
  });
  const controller = createWorkScopeController({
    session: attached.session,
    appendEntry: (entry, options) => store.append(entry, options),
  });

  await withWorkScope(controller, { id: "roadmap:0.8", kind: "roadmap", label: "0.8" }, async () => {
    await withWorkScope(controller, { id: "phase:1", parentId: "roadmap:0.8", kind: "phase", label: "Phase 1" }, async () => {
      await withWorkScope(controller, { id: "plan:077", parentId: "phase:1", kind: "plan", label: "Work scopes" }, async () => {
        await withWorkScope(controller, { id: "task:1", parentId: "plan:077", kind: "task", label: "Task 1" }, () =>
          attached.session.run("complete task 1"),
        );
        await withWorkScope(controller, { id: "task:15", parentId: "plan:077", kind: "task", label: "Task 15" }, () =>
          attached.session.run("complete task 15"),
        );
      });
    });
  });

  const entries = await attached.session.entries();
  const ledger = foldObservationalMemoryLedger(entries);
  const [task1, task15] = ledger.observations;
  assert(task1 && task15);
  const project = (from: string, include: "self+ancestors" | "self+descendants", closed?: "hide" | "include") =>
    projectWorkMemory(ledger, foldWorkScopeMap(entries), { from, include, closed });
  assert.equal(
    project("task:15", "self+ancestors").observations.some((item) => item.id === task1.id),
    false,
  );

  await controller.bind("roadmap:0.8", [`om:${task1.id}`]);
  const promoted = projectWorkMemory(
    foldObservationalMemoryLedger(await attached.session.entries()),
    foldWorkScopeMap(await attached.session.entries()),
    {
      from: "task:15",
      include: "self+ancestors",
    },
  );
  assert.equal(
    promoted.observations.some((item) => item.id === task1.id),
    true,
  );

  for (const id of ["task:1", "task:15", "plan:077", "phase:1"]) await controller.close(id);
  const closedPhase = projectWorkMemory(
    foldObservationalMemoryLedger(await attached.session.entries()),
    foldWorkScopeMap(await attached.session.entries()),
    {
      from: "phase:1",
      include: "self+descendants",
      closed: "include",
    },
  );
  assert.deepEqual(new Set(closedPhase.observations.map((item) => item.id)), new Set([task1.id, task15.id]));

  let phase2Ids: readonly string[] = [];
  await withWorkScope(controller, { id: "phase:2", parentId: "roadmap:0.8", kind: "phase", label: "Phase 2" }, async () => {
    phase2Ids = projectWorkMemory(
      foldObservationalMemoryLedger(await attached.session.entries()),
      foldWorkScopeMap(await attached.session.entries()),
      {
        from: "phase:2",
        include: "self+ancestors",
      },
    ).observations.map((item) => item.id);
    assert.deepEqual(phase2Ids, [task1.id]);
  });

  return { task1Id: task1.id, task15Id: task15.id, phase2Ids };
}

export async function main() {
  console.log(JSON.stringify(await demo()));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
