import assert from "node:assert/strict";
import { type ModelProvider, createAgent, createMemorySessionStore, providerDone, providerTextDelta, providerToolCall, type SessionEntry, type SessionStore, toolCallContent } from "@arnilo/prism";
import {
  createObservationalMemory,
  createRecallMemoryTool,
  createWorkScopeController,
  foldObservationalMemoryLedger,
  foldWorkScopeMap,
  resolveSharedScopes,
  type SharedScopeAccessEvent,
  withWorkScope,
} from "@arnilo/prism-memory/compaction/observational-memory";
import { mockProvider } from "@arnilo/prism/testing";

const model = { provider: "mock", model: "demo" };
const workerModel = { provider: "mock", model: "memory" };
const SCOPE = "release:0.9";
const PRIVATE = "release:0.9:notes";
const memoryOverrides = { observation: { messageTokens: 1 }, reflection: { observationTokens: 1_000 }, agentMaxTurns: 1 };

// Worker that records one fixed observation per turn, attributed to the turn's user message.
function observationWorker(store: SessionStore, sessionId: string, content: string): ModelProvider {
  return {
    id: "memory",
    async *generate() {
      const source = (await store.list(sessionId)).filter((entry) => entry.kind === "message" && entry.message?.role === "user").at(-1);
      if (source) {
        yield providerToolCall(
          toolCallContent("observation", "record_observation", { content, relevance: "high", sourceEntryIds: [source.id] }),
        );
      }
      yield providerDone();
    },
  };
}

export async function demo() {
  const store = createMemorySessionStore();
  const agent = await createAgent({ model, packages: [mockProvider([[providerTextDelta("ok"), providerDone()]])], slots: { store } });
  const appendEntry = (entry: SessionEntry, options?: { expectedParentId?: string }) => store.append(entry, options);

  // The host does not choose session ids: open the three participants first and key them by their generated ids.
  const [ownerSession, builderSession, reviewerSession] = [await agent.session(), await agent.session(), await agent.session()];
  const label = new Map([
    [ownerSession.id, "owner"],
    [builderSession.id, "builder"],
    [reviewerSession.id, "reviewer"],
  ]);
  const labels = (ids: readonly string[] | undefined) => ids?.map((id) => label.get(id) ?? id);

  const participant = (session: typeof reviewerSession) => ({ session, scopes: createWorkScopeController({ session, appendEntry }) });
  const worker = (session: typeof ownerSession, fact: string) => {
    const memory = createObservationalMemory({
      observation: { provider: observationWorker(store, session.id, fact), model: workerModel },
      overrides: memoryOverrides,
    });
    const attached = memory.attach(session, { appendEntry, sessionModel: model });
    return { session: attached.session, scopes: createWorkScopeController({ session: attached.session, appendEntry }) };
  };

  // Owner: opens the shared scope, grants the other participants, keeps a private child scope.
  const owner = worker(ownerSession, "Owner: grants are owner-branch only and revocation lands on the next read.");
  await owner.scopes.open({ id: SCOPE, kind: "release", label: "0.9" });
  await owner.scopes.grant(SCOPE, [builderSession.id, reviewerSession.id]);
  await owner.scopes.open({ id: PRIVATE, parentId: SCOPE, kind: "scratch", label: "notes" });
  await withWorkScope(owner.scopes, { id: SCOPE, kind: "release" }, () => owner.session.run("record the release constraint"));
  await withWorkScope(owner.scopes, { id: PRIVATE, kind: "scratch" }, () => owner.session.run("park a private aside"));

  // Builder: opens the same scope locally and contributes its own bound observation.
  const builder = worker(builderSession, "Builder: the coverage gate runs before the shared read.");
  await withWorkScope(builder.scopes, { id: SCOPE, kind: "release" }, () => builder.session.run("record the build finding"));

  const sharedScopes = { [SCOPE]: { ownerSessionId: ownerSession.id, entries: (sessionId: string) => store.list(sessionId) } };

  // Reviewer: enters the shared scope, then reads it through the attached context provider.
  const reviewer = participant(reviewerSession);
  const accesses: SharedScopeAccessEvent[] = [];
  const attached = createObservationalMemory({}).attach(reviewer.session, {
    appendEntry,
    sessionModel: model,
    sharedScopes,
    onScopeAccess: (event) => accesses.push(event),
  });
  await withWorkScope(reviewer.scopes, { id: SCOPE, kind: "release" }, async () => {
    const blocks =
      (
        await attached.contextBuild(
          { messages: [] },
          { sessionId: "s", runId: "r", emit: () => undefined, reject: () => ({ __prismHookRejection: "x" }) },
        )
      )?.context ?? [];
    const block = blocks.find((item) => item.title === "observational-memory");
    const rendered = typeof block?.content === "string" ? block.content : "";
    assert.match(rendered, /grants are owner-branch only/);
    assert.match(rendered, /coverage gate runs before the shared read/);
    assert.equal(rendered.includes("private aside"), false);
    return undefined;
  });

  // Exact-id recall resolves shared branches too, and still returns source evidence from the foreign branch.
  const builderLedger = foldObservationalMemoryLedger(await builder.session.entries());
  const [finding] = builderLedger.observations;
  assert(finding);
  const recall = createRecallMemoryTool({ getEntries: (sessionId: string) => store.list(sessionId), sharedScopes });
  const result = await recall.execute({ id: finding.id }, { sessionId: reviewerSession.id, runId: "r1", toolCallId: "t1" });
  const recalled = result.value as { found: boolean; kind: string; sourceEntries?: readonly { id: string }[] };
  assert.equal(recalled.found, true);
  assert.equal(recalled.kind, "observation");
  assert.equal(recalled.sourceEntries?.length, 1);
  assert.match(result.content?.[0]?.type === "text" ? result.content[0].text : "", /coverage gate runs before the shared read/);

  const reviewerMap = foldWorkScopeMap(await reviewer.session.entries());
  const resolve = () => resolveSharedScopes({ scopes: sharedScopes, principalId: reviewerSession.id, map: reviewerMap });
  const before = await resolve();
  await owner.scopes.revoke(SCOPE, [builderSession.id]);
  const after = await resolve();
  assert.deepEqual(labels(before[0]?.branches)?.sort(), ["builder", "owner"]);
  assert.deepEqual(labels(after[0]?.branches), ["owner"]);

  return {
    scope: SCOPE,
    branches: labels(before[0]?.branches)?.sort(),
    sharedObservationIds: before[0]?.observations.map((item) => item.id),
    branchesAfterRevoke: labels(after[0]?.branches),
    recalled: { id: finding.id, content: finding.content },
    audits: accesses.map((event) => [event.scopeId, event.granted]),
  };
}

export async function main() {
  console.log(JSON.stringify(await demo(), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
