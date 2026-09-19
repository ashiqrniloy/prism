import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAgent,
  createMemorySessionStore,
  createMockProvider,
  createSessionEntry,
  providerDone,
  providerTextDelta,
  type SessionEntry,
} from "@arnilo/prism";
import { appendCustomEntry } from "../append-custom.js";
import {
  buildObservationalMemoryContextBlocks,
  createMemoryViewCommand,
  createObservationalMemory,
  createRecallMemoryTool,
  createWorkScopeController,
  foldWorkScopeGrants,
  foldWorkScopeMap,
  type MemoryObservation,
  OBSERVATIONS_RECORDED,
  recallObservationalMemory,
  resolveSharedScopes,
  SESSION_WORK_SCOPE_ID,
  type SharedScopeAccessEvent,
  WORK_SCOPE_GRANTED,
  WORK_SCOPE_REVOKED,
} from "../index.js";

const model = { provider: "mock", model: "demo" };
const now = "2026-09-19T00:00:00.000Z";
const SCOPE = "build-42";
const context = { sessionId: "s15", runId: "r1", toolCallId: "t1" };

function observation(id: string, content: string, sourceEntryIds: readonly string[]): MemoryObservation {
  return { id, content, timestamp: now, relevance: "high", sourceEntryIds, tokenCount: content.length };
}

function entry(id: string, data: unknown): SessionEntry {
  return createSessionEntry({ id, sessionId: "s1", timestamp: now, kind: "custom", data });
}

async function fixture(sessionIds: readonly string[]) {
  const store = createMemorySessionStore();
  const agent = createAgent({ model, provider: createMockProvider([providerTextDelta("ok"), providerDone()]), store });
  const sessions = new Map<string, ReturnType<typeof agent.createSession>>();
  for (const id of sessionIds) {
    const session = agent.createSession({ id });
    await session.run(`hello ${id}`);
    sessions.set(id, session);
  }
  const appendEntry = (entry: SessionEntry, options?: { expectedParentId?: string }) => store.append(entry, options);
  const controller = (sessionId: string) => {
    const session = sessions.get(sessionId)!;
    return {
      session,
      scopes: createWorkScopeController({ session, appendEntry }),
      remember: (data: unknown) => appendCustomEntry({ session, appendEntry }, data),
    };
  };
  const sharedScopes = (ownerSessionId: string) => ({
    [SCOPE]: { ownerSessionId, entries: (sessionId: string) => store.list(sessionId) },
  });
  return { store, sessions, controller, sharedScopes };
}

describe("observational memory shared work scopes", () => {
  it("shared_scope_merges_only_scope_bound_memory_from_granted_branches", async () => {
    const { store, controller, sharedScopes } = await fixture(["s1", "s3", "s15"]);
    const owner = controller("s1");
    await owner.scopes.open({ id: SCOPE, kind: "build" });
    await owner.scopes.grant(SCOPE, ["s3", "s15"]);
    await owner.scopes.open({ id: "private:1", parentId: SCOPE });
    const s1Source = (await owner.session.entries())[0]!.id;
    const shared = observation("aaaaaaaaaaaa", "phase one constraint", [s1Source]);
    const secret = observation("bbbbbbbbbbbb", "private scratch note", [s1Source]);
    await owner.remember({ type: OBSERVATIONS_RECORDED, observations: [shared, secret], coversUpToId: s1Source });
    await owner.scopes.bind(SCOPE, [`om:${shared.id}`]);
    await owner.scopes.bind("private:1", [`om:${secret.id}`]);

    const contributor = controller("s3");
    await contributor.scopes.open({ id: SCOPE, kind: "build" });
    const s3Source = (await contributor.session.entries())[0]!.id;
    const s3Observation = observation("cccccccccccc", "phase two finding", [s3Source]);
    await contributor.remember({ type: OBSERVATIONS_RECORDED, observations: [s3Observation], coversUpToId: s3Source });
    await contributor.scopes.bind(SCOPE, [`om:${s3Observation.id}`]);

    const reader = controller("s15");
    await reader.scopes.open({ id: SCOPE, kind: "build" });
    await reader.scopes.enter(SCOPE);
    const audits: SharedScopeAccessEvent[] = [];
    const resolved = await resolveSharedScopes({
      scopes: sharedScopes("s1"),
      principalId: "s15",
      map: foldWorkScopeMap(await reader.session.entries()),
      onAccess: (event) => audits.push(event),
    });

    assert.equal(resolved.length, 1);
    assert.deepEqual(resolved[0]!.branches, ["s1", "s3"]);
    assert.deepEqual(resolved[0]!.observations.map((item) => item.id).sort(), [shared.id, s3Observation.id].sort());
    assert.deepEqual(audits, [
      { scopeId: SCOPE, ownerSessionId: "s1", principalId: "s15", granted: true, branches: 2, observations: 2, reflections: 0 },
    ]);

    const entries = await reader.session.entries();
    const blocks = buildObservationalMemoryContextBlocks(entries, { shared: resolved });
    const raw = blocks.find((block) => block.title === "observational-memory")?.content;
    const memory = typeof raw === "string" ? raw : "";
    assert.match(memory, /phase one constraint/);
    assert.match(memory, /phase two finding/);
    assert.equal(memory.includes("private scratch note"), false);

    const recalled = recallObservationalMemory(entries, shared.id, [], { shared: resolved });
    assert.equal(recalled.found, true);
    assert.equal(recalled.kind, "observation");
    assert.deepEqual(
      recalled.sourceEntries?.map((item) => item.id),
      [s1Source],
    );
    assert.deepEqual(recalled.missingSourceEntryIds, []);

    const tool = createRecallMemoryTool({ getEntries: (sessionId) => store.list(sessionId), sharedScopes: sharedScopes("s1") });
    const result = await tool.execute({ id: s3Observation.id }, context);
    assert.equal((result.value as { found: boolean }).found, true);
    assert.equal((result.value as { kind: string }).kind, "observation");
    assert.match(result.content?.[0]?.type === "text" ? result.content[0].text : "", /phase two finding/);
  });

  it("shared_scope_is_fail_closed_on_missing_grant_scope_and_unreadable_owner", async () => {
    const { controller, sharedScopes } = await fixture(["s1", "s15"]);
    const owner = controller("s1");
    await owner.scopes.open({ id: SCOPE });
    const reader = controller("s15");
    await reader.scopes.open({ id: SCOPE });
    const readerMap = foldWorkScopeMap(await reader.session.entries());
    const audits: SharedScopeAccessEvent[] = [];
    const onAccess = (event: SharedScopeAccessEvent) => audits.push(event);

    assert.deepEqual(await resolveSharedScopes({ scopes: sharedScopes("s1"), principalId: "s15", map: readerMap, onAccess }), []);
    assert.deepEqual(
      await resolveSharedScopes({
        scopes: { [SCOPE]: { ownerSessionId: "s1", entries: () => Promise.reject(new Error("denied")) } },
        principalId: "s15",
        map: readerMap,
        onAccess,
      }),
      [],
    );
    assert.deepEqual(
      await resolveSharedScopes({
        scopes: { [SCOPE]: { ownerSessionId: "s1", entries: () => [] } },
        principalId: "s15",
        map: readerMap,
        onAccess,
      }),
      [],
    );
    assert.deepEqual(
      await resolveSharedScopes({ scopes: sharedScopes("s1"), principalId: "s15", map: foldWorkScopeMap([]), onAccess }),
      [],
    );

    assert.deepEqual(
      audits.map((event) => [event.reason, event.granted]),
      [
        ["not_granted", false],
        ["unavailable", false],
        ["unknown_scope", false],
        ["not_opened", false],
      ],
    );
  });

  it("shared_scope_grants_come_from_the_owner_branch_and_revocation_takes_effect_next_read", async () => {
    const { controller, sharedScopes } = await fixture(["s1", "s3", "s15"]);
    const owner = controller("s1");
    await owner.scopes.open({ id: SCOPE });
    await owner.scopes.grant(SCOPE, ["s3"]);
    const source = (await owner.session.entries())[0]!.id;
    const memory = observation("dddddddddddd", "owner fact", [source]);
    await owner.remember({ type: OBSERVATIONS_RECORDED, observations: [memory], coversUpToId: source });
    await owner.scopes.bind(SCOPE, [`om:${memory.id}`]);

    const contributor = controller("s3");
    await contributor.scopes.open({ id: SCOPE });
    const contributorSource = (await contributor.session.entries())[0]!.id;
    const contributorMemory = observation("eeeeeeeeeeee", "contributor fact", [contributorSource]);
    await contributor.remember({ type: OBSERVATIONS_RECORDED, observations: [contributorMemory], coversUpToId: contributorSource });
    await contributor.scopes.bind(SCOPE, [`om:${contributorMemory.id}`]);

    const reader = controller("s15");
    await reader.scopes.open({ id: SCOPE });
    // A grant in a non-owner branch is inert: only the owner branch is grant authority.
    await reader.scopes.grant(SCOPE, ["s15"]);
    const readerMap = foldWorkScopeMap(await reader.session.entries());

    assert.deepEqual(await resolveSharedScopes({ scopes: sharedScopes("s1"), principalId: "s15", map: readerMap }), []);

    await owner.scopes.grant(SCOPE, ["s15"]);
    const granted = await resolveSharedScopes({ scopes: sharedScopes("s1"), principalId: "s15", map: readerMap });
    assert.equal(granted.length, 1);
    assert.deepEqual(granted[0]!.branches, ["s1", "s3"]);

    await owner.scopes.revoke(SCOPE, ["s3"]);
    const revoked = await resolveSharedScopes({ scopes: sharedScopes("s1"), principalId: "s15", map: readerMap });
    assert.deepEqual(revoked[0]!.branches, ["s1"]);
    assert.deepEqual(
      revoked[0]!.observations.map((item) => item.id),
      [memory.id],
    );
  });

  it("shared_scope_without_config_reads_no_branches", async () => {
    let reads = 0;
    const resolved = await resolveSharedScopes({
      scopes: undefined,
      principalId: "s15",
      map: foldWorkScopeMap([]),
      onAccess: () => {
        reads += 1;
      },
    });
    assert.deepEqual(resolved, []);
    assert.equal(reads, 0);
  });

  it("work_scope_grant_and_revoke_records_are_validated_and_folded", async () => {
    const { controller } = await fixture(["s1"]);
    const { scopes, session } = controller("s1");
    await scopes.open({ id: SCOPE });
    await assert.rejects(() => scopes.grant(SESSION_WORK_SCOPE_ID, ["s3"]), /reserved/);
    await assert.rejects(() => scopes.grant("missing", ["s3"]), /Unknown work scope/);
    await assert.rejects(() => scopes.grant(SCOPE, []), /principal ids/);
    await assert.rejects(() => scopes.grant(SCOPE, ["  padded  "]), /principal ids/);
    await assert.rejects(() => scopes.grant(SCOPE, ["line\nbreak"]), /principal ids/);
    await scopes.grant(SCOPE, ["s3", "s4", "s3"]);
    assert.deepEqual([...(foldWorkScopeGrants(await session.entries()).get(SCOPE) ?? [])], ["s3", "s4"]);
    await scopes.revoke(SCOPE, ["s3"]);
    assert.deepEqual([...(foldWorkScopeGrants(await session.entries()).get(SCOPE) ?? [])], ["s4"]);
    assert.equal(foldWorkScopeGrants([entry("bad", { type: WORK_SCOPE_GRANTED, scopeId: SCOPE, principalIds: [""] })]).size, 0);
    assert.equal(foldWorkScopeGrants([entry("revoked", { type: WORK_SCOPE_REVOKED, scopeId: SCOPE, principalIds: ["s3"] })]).size, 0);
  });

  it("om_view_renders_shared_scope_memory", async () => {
    const { store, controller, sharedScopes } = await fixture(["s1", "s15"]);
    const owner = controller("s1");
    await owner.scopes.open({ id: SCOPE });
    await owner.scopes.grant(SCOPE, ["s15"]);
    const source = (await owner.session.entries())[0]!.id;
    const memory = observation("ffffffffffff", "shared view fact", [source]);
    await owner.remember({ type: OBSERVATIONS_RECORDED, observations: [memory], coversUpToId: source });
    await owner.scopes.bind(SCOPE, [`om:${memory.id}`]);
    const reader = controller("s15");
    await reader.scopes.open({ id: SCOPE });

    const command = createMemoryViewCommand({ getEntries: (sessionId) => store.list(sessionId), sharedScopes: sharedScopes("s1") });
    const result = await command.execute({}, { sessionId: "s15", runId: "r1" });
    const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
    assert.match(text, /shared view fact/);
  });

  it("attached_context_without_shared_scopes_matches_the_local_projection", async () => {
    const store = createMemorySessionStore();
    const agent = createAgent({ model, provider: createMockProvider([providerTextDelta("ok"), providerDone()]), store });
    const session = agent.createSession({ id: "s15" });
    await session.run("hello s15");
    const appendEntry = (item: SessionEntry, options?: { expectedParentId?: string }) => store.append(item, options);
    const scopes = createWorkScopeController({ session, appendEntry });
    await scopes.open({ id: SCOPE });
    await scopes.enter(SCOPE);
    const source = (await session.entries())[0]!.id;
    const memory = observation("999999999999", "local only fact", [source]);
    await appendCustomEntry({ session, appendEntry }, { type: OBSERVATIONS_RECORDED, observations: [memory], coversUpToId: source });
    await scopes.bind(SCOPE, [`om:${memory.id}`]);

    const attached = createObservationalMemory({}).attach(session, { appendEntry });
    assert.deepEqual(
      await attached.contextProvider.resolve({ messages: [] }),
      buildObservationalMemoryContextBlocks(await session.entries(), { keepRecentEntries: 8 }),
    );
  });
});
