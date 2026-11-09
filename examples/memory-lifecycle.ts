import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, type JsonObject, type ProviderRequest, type ToolDefinition } from "@arnilo/prism";
import {
  createScriptedHostUi,
  mockProvider,
  providerDone,
  providerTextDelta,
  providerToolCall,
  toolCallContent,
} from "@arnilo/prism/testing";
import { createMemoryVectorStore, type Memory, type VectorStore } from "@arnilo/prism-memory-core";
import memorySystem, {
  createMemory,
  createLongTermMemory,
  encodeMemoryNoteMetadata,
  resolveLifecycleConfig,
  SCOPE_CLOCK_COUNTER,
} from "@arnilo/prism-memory-system";

// Memory lifecycle demo: one note's whole life, from a candidate to verified, shadowed, archived and revived.
//
// What this shows:
//   1. A user preference written in project A and recalled in project B (one `user` resource).
//   2. A procedure verified by use in A and B, and an `agent` scope that no model tool can write.
//   3. A project exception that shadows the preference inside A only.
//   4. An unused episode archived by the rule, then found through archive search and revived by citing it.
//   5. A capacity budget that folds duplicate notes and evicts the weakest survivor.
//   6. The three delivery tiers in one session: the standing rules in the prefix, a path cue in the tail
//      after a file read, and a team note a person approved with memory:share.
//
// The lifecycle is metadata-only: no model call, no network, no provider. Time is the per-resource
// scope-session counter, so the demo advances the counter instead of running twenty sessions.
//
// Run: node examples/memory-lifecycle.ts

const TENANT = "demo";
const PROJECT_A = "projects/alpha--11111111";
const PROJECT_B = "projects/beta--22222222";
const USER = "user";
const AGENT = "agent";
const EPISODE = "eeeeeeee0001";

const stores = { vectorStore: createMemoryVectorStore() };
const memoryFor = (resourceId: string) =>
  createMemory({ tenantId: TENANT, resourceId, threadId: "default", vectorStore: stores.vectorStore });
const projectA = memoryFor(PROJECT_A);
const projectB = memoryFor(PROJECT_B);
const user = memoryFor(USER);
const agent = memoryFor(AGENT);

/** A project's own fabric: it writes its project scope and reads the wider ones above it. */
const projectFabric = (memory: Memory) =>
  createLongTermMemory({
    memory,
    scopes: [
      { level: "project", memory },
      { level: "agent", memory: agent },
      { level: "user", memory: user },
    ],
    vectorStore: stores.vectorStore,
    consolidate: false,
  });
const inA = projectFabric(projectA);
const inB = projectFabric(projectB);

/** The scope clock is the store's per-resource session counter; one increment is one session. */
async function sessions(store: VectorStore, resourceId: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await store.scopeCounter!.increment({ tenantId: TENANT, resourceId, name: SCOPE_CLOCK_COUNTER });
  }
}

const statusOf = async (memory: Memory, id: string) => (await memory.getEntry(id))?.metadata?.status;

// 1. A preference in the shared `user` scope: written from A, cited from B in another session.
const preference = await inA.remember({
  kind: "preference",
  scope: "user",
  key: "package-manager",
  content: "Prefer pnpm for project scripts",
});
const preferenceInB = (await inB.recall("pnpm project scripts", { topK: 3 })).hits.filter((hit) => hit.id === preference.id).length;
await inB.recordUses("session-b1", [preference.id], { clock: 1 });

// 2. The same procedure proven once in each project: two citing sessions each, so both verify. Nothing widens it.
const lesson = "Drain the canary pool before every rollback";
const inProjectA = await inA.remember({ kind: "procedure", key: "canary.drain", content: lesson });
const inProjectB = await inB.remember({ kind: "procedure", key: "canary.drain", content: lesson });
for (const noteId of [inProjectA.id, inProjectB.id]) {
  await inA.recordUses("session-a1", [noteId], { clock: 1, verifyAfterSessions: 2 });
  await inB.recordUses("session-a2", [noteId], { clock: 2, verifyAfterSessions: 2 });
}
const verified = (await Promise.all([statusOf(projectA, inProjectA.id), statusOf(projectB, inProjectB.id)])).filter(
  (status) => status === "verified",
).length;

// 3. A project exception with the same key: narrowest scope wins, so A reads its own opinion.
const exception = await inA.remember({
  kind: "preference",
  scope: "project",
  key: "package-manager",
  overrides: preference.id,
  content: "Alpha keeps npm for release scripts",
});
const shadowed = async (fabric: typeof inA) =>
  (await fabric.recall("project release scripts pnpm npm", { topK: 5 })).explain.filter((entry) => entry.shadowedBy !== undefined).length;

// 4. An episode nothing ever cited, written at the first session and left alone since.
await projectA.remember(
  {
    entries: [
      {
        id: EPISODE,
        text: "debugging the flaky deploy on friday",
        createdAt: "2026-01-02T00:00:00.000Z",
        metadata: { fabric: encodeMemoryNoteMetadata({ kind: "episode", created: 0 }), status: "candidate" },
      },
    ],
  },
  { wait: true },
);

// Twenty sessions later: the episode is below both strengths and past its grace, everything cited is not.
for (const resourceId of [PROJECT_A, PROJECT_B, USER, AGENT]) await sessions(stores.vectorStore, resourceId, 20);

const maintainer = createLongTermMemory({
  memory: projectA,
  scopes: [
    { level: "project", memory: projectA },
    { level: "project", memory: projectB },
    { level: "agent", memory: agent },
    { level: "user", memory: user },
  ],
  vectorStore: stores.vectorStore,
  lifecycle: resolveLifecycleConfig({}),
  consolidate: false,
});
const report = await maintainer.maintain();

// 5. Archive search: the archived episode is appended, marked, then revived by citing it.
// Default recall kinds are fact, preference, and file; `["all"]` names every kind in one word.
const archived = (await maintainer.recall("flaky deploy friday", { includeArchived: true, kinds: ["all"] })).hits.filter(
  (hit) => hit.status === "archived",
).length;
await maintainer.recordUses("session-revive", [EPISODE], { clock: 20 });
const revived =
  (await statusOf(projectA, EPISODE)) === "candidate" && (await projectA.getEntry(EPISODE))?.metadata?.auditVerb === "revived";

// A model tool cannot write the `agent` scope. The project copy is stored; nothing above the project sees it.
const insert = inA.tools().find((tool) => tool.name === "memory.insert")!;
const refused = await insert.execute(
  { kind: "fact", scope: "agent", key: "deploy.region", text: "alpha region = eu-west" },
  { sessionId: "session-a3", runId: "r1", toolCallId: "c1" },
);
if (!String(refused.error?.message).includes("not writable")) throw new Error("agent tool write was not refused");
const local = await insert.execute(
  { kind: "fact", scope: "project", key: "deploy.region", text: "alpha region = eu-west" },
  { sessionId: "session-a3", runId: "r1", toolCallId: "c2" },
);
if (local.error !== undefined || (await agent.recall("eu-west", { topK: 2 })).hits.length !== 0)
  throw new Error("project fact escaped the project");

if (preferenceInB !== 1 || (await shadowed(inB)) !== 0 || (await shadowed(inA)) !== 1) throw new Error("scope shadowing failed");
if (verified !== 2 || (await agent.recall(lesson, { topK: 2 })).hits.length !== 0) throw new Error("verification or agent isolation failed");
if (report.archived !== 1 || archived !== 1 || !revived) throw new Error("archive and revival failed");

// 6. A capacity budget: two same-key notes fold first, then the weakest note is evicted.
const budgetStores = { vectorStore: createMemoryVectorStore() };
const cramped = createMemory({
  tenantId: TENANT,
  resourceId: "projects/gamma--33333333",
  threadId: "default",
  vectorStore: budgetStores.vectorStore,
});
const budget = createLongTermMemory({
  memory: cramped,
  vectorStore: budgetStores.vectorStore,
  lifecycle: resolveLifecycleConfig({ capacity: { project: { notes: 3 } } }),
  consolidate: false,
});
await budget.remember({ kind: "fact", key: "deploy.probe", content: "Deploy probes the canary pool first" });
await budget.remember({ kind: "fact", key: "deploy.probe", content: "Deploy always probes the canary pool" });
await budget.remember({ kind: "fact", key: "deploy.retry", content: "Deploy retries twice" });
await budget.remember({ kind: "fact", key: "deploy.window", content: "Deploys pause inside the freeze window" });
await budget.remember({ kind: "fact", key: "deploy.owner", content: "Release owner signs off deploys" });
const capacity = await budget.maintain();
if (capacity.merged !== 1 || capacity.evicted !== 1 || capacity.overBudget.length !== 0) throw new Error("capacity failed");

// 6. Delivery tiers and the team store, driven through a real agent so the blocks are the ones a model
//    receives. The mock provider only replays a script and records each request, which is where the
//    prefix and the tail are read from; no model call and no network.
const deliveryRoot = await mkdtemp(join(tmpdir(), "delivery-demo-"));
const deliveryProject = join(deliveryRoot, "project");
await mkdir(join(deliveryProject, "packages", "memory"), { recursive: true });
await mkdir(join(deliveryProject, ".prism", "memory"), { recursive: true });
await writeFile(join(deliveryProject, "packages", "memory", "plan.md"), "# memory plan\n");

const requests: ProviderRequest[] = [];
const readTool: ToolDefinition = {
  name: "read",
  description: "Read one project file.",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  execute(args, context) {
    const path = String((args as { path?: string }).path ?? "");
    return { toolCallId: context.toolCallId, name: "read", value: { path, text: "# memory plan" } };
  },
};
const memoryScript = [
  [
    providerToolCall(toolCallContent("d1", "memory.insert", { kind: "preference", text: "Prefers bun over npm", scope: "user" })),
    providerDone(),
  ],
  [providerTextDelta("stored"), providerDone()],
  [
    providerToolCall(
      toolCallContent("d2", "memory.insert", {
        kind: "procedure",
        text: "Run memory suites with --timeout=0",
        scope: "path",
        appliesTo: ["packages/memory/**"],
      }),
    ),
    providerDone(),
  ],
  [providerTextDelta("stored"), providerDone()],
  [providerToolCall(toolCallContent("d3", "read", { path: "packages/memory/plan.md" })), providerDone()],
  [providerTextDelta("read"), providerDone()],
  ...Array.from({ length: 10 }, (_unused, turn) => [providerTextDelta(`turn ${turn}`), providerDone()] as const),
];
const scripted = createScriptedHostUi({ confirm: true });
const deliveryAgent = await createAgent({
  model: { provider: "mock", model: "main" },
  // The person on the other side of memory:share: a scripted host that approves the one confirm.
  host: { ui: scripted.ui },
  tools: { add: [readTool] },
  packages: [
    mockProvider(memoryScript, { onRequest: (request) => requests.push(request) }),
    // `rules.scopes: ["user"]` keeps the project path note out of the standing rules, so the same note
    // reaches the model through the cue tail instead.
    memorySystem({ ltm: {
      tools: { root: deliveryRoot },
      scopes: { project: { root: deliveryProject } },
      team: { dir: ".prism/memory" },
      rules: { scopes: ["user"] },
    } }),
  ],
});
const deliverySession = await deliveryAgent.session({ id: "delivery-demo", create: true });
try {
  await deliverySession.run("remember the package manager");
  await deliverySession.run("remember the suite command");
  // The preference reaches the standing rules at the next epoch; inserts leave the current prefix stable.
  await deliverySession.compact();
  await deliverySession.run("read the memory plan");
  for (let turn = 0; turn < 10; turn += 1) await deliverySession.run(`turn ${turn}`);

  const prefix = (request: ProviderRequest) => JSON.stringify(request.context ?? []);
  const quiet = requests.slice(6);
  const cueBlock = requests.find((request) => request.messages.some((message) => message.metadata?.contextBlocks));
  const listed = (await deliveryAgent.commands.run("memory:lifecycle", {}, { session: deliverySession })) as {
    notes: { id: string; kind: string }[];
  };
  const pathNote = listed.notes.find((note) => note.kind === "procedure");
  if (pathNote === undefined) throw new Error("the project path note is missing");
  const shared = (await deliveryAgent.commands.run("memory:share", { id: pathNote.id } as JsonObject, {
    session: deliverySession,
  })) as { ok: boolean; path: string };

  if (!/Standing rules \(user\): \[[0-9a-f]{12}\] Prefers bun over npm/.test(prefix(requests[4]!))) throw new Error("core block missing");
  if (quiet.length !== 10 || new Set(quiet.map(prefix)).size !== 1) throw new Error("prefix not byte-identical across quiet turns");
  if (!JSON.stringify(cueBlock).includes("path procedure (for packages/memory/**)")) throw new Error("path cue missing");
  if (requests.filter((request) => JSON.stringify(request).includes("path procedure (for packages/memory/**)")).length !== 1) {
    throw new Error("a cue must be injected once per session");
  }
  if (!shared.ok) throw new Error(`share refused: ${JSON.stringify(shared)}`);
  const asked = scripted.requestsOf("confirm");
  if (asked.length !== 1 || !asked[0]!.detail?.includes("Run memory suites with --timeout=0")) throw new Error("share needs approval");
  if (!(await readFile(join(deliveryProject, ".prism", "memory", shared.path), "utf8")).includes("shared-to-team")) {
    throw new Error("shared note missing from the team store");
  }
  await deliverySession.close();
} finally {
  await deliveryAgent.dispose();
}

// Counts only: the demo proves its own assertions, so the output is the tally a transcript can be diffed on.
console.log(
  JSON.stringify({
    preference: { recalledInB: preferenceInB, useSessions: 1, shadowedInA: 1, shadowedInB: 0 },
    procedure: { verifiedInProjects: verified },
    exception: { overrides: exception.overrides === preference.id ? 1 : 0 },
    archive: { archived: report.archived, archivedHits: archived, revived: revived ? 1 : 0 },
    maintenance: { merged: report.merged, evicted: report.evicted },
    capacity: { merged: capacity.merged, evicted: capacity.evicted, notes: 3 },
    delivery: { prefixes: 10, cues: 1, shares: 1 },
  }),
);
