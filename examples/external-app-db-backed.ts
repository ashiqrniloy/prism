import {
  createAgent,
  createAgentSession,
  createMockProvider,
  createProviderResolver,
  createSecretRedactor,
  createSkillRegistry,
  createToolRegistry,
  providerDone,
  providerTextDelta,
  providerToolCall,
  providerUsage,
  SessionAppendConflictError,
  type AgentEvent,
  type AgentEventRecord,
  type ContextProvider,
  type CredentialResolver,
  type ModelConfig,
  type PersistencePage,
  type ProductionPersistenceStore,
  type RunLedger,
  type RunRecord,
  type SessionBranchRead,
  type SessionEntry,
  type SessionStore,
  type SessionAppendOptions,
  type Skill,
  type ToolCallRecord,
  type ToolDefinition,
  type ToolResult,
  type UsageRecord,
} from "@arnilo/prism";
import { assertSessionStoreConforms } from "@arnilo/prism/testing/session-store-conformance";

// Phase 41 — End-to-end external-app example with a DB-backed adapter
// reference mock.
//
// An external host implements the persistence/runtime contracts straight from
// the docs: a `SessionStore` (atomic append + `readBranchPath`), a `RunLedger`
// (durable run/event/tool/usage rows), and the `ProductionPersistenceStore`
// read queries used to resume a prior run timeline. No real database, no
// network — everything runs against the mock provider. This is boilerplate a
// host can lift into its own SQL/NoSQL adapter.
//
// Demonstrates: explicit tools + skills, mock provider, branch-handle checkout,
// fork, and timeline resume via the ledger reads — without reading Prism source.

const FAKE_SECRET = "FAKE_SECRET_PHASE41TOKEN";
const FAKE_API_KEY = "FAKE_KEY_phase41caller"; // caller-supplied credential resolver value

// --- Host-owned tool + skill (explicit capability activation, Phase 38) -----

const saveNoteTool: ToolDefinition = {
  name: "notes/save",
  description: "Persist a short note string.",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  execute(args, ctx): ToolResult {
    return { toolCallId: ctx.toolCallId, name: "notes/save", value: (args as { text: string }).text };
  },
};

const summarizeContext: ContextProvider = {
  name: "notes/summary-context",
  resolve() {
    return [{ id: "sum-ctx", title: "Summary style", content: "Summaries are one sentence." }];
  },
};

const summarizeSkill: Skill = {
  name: "summarize-skill",
  description: "Activates summary context and the notes/save tool.",
  instructions: "Summarize the request, then save the summary.",
  context: [summarizeContext],
  toolNames: ["notes/save"], // enforced fail-closed before the first provider turn
};

// --- DB-backed adapter reference mock ---------------------------------------
// Implements `SessionStore` + `RunLedger` + `ProductionPersistenceStore`
// against in-memory tables. A real host swaps these bodies for SQL/NoSQL; the
// contract shapes and redaction expectations are identical.

interface IdempotencyRow {
  readonly key: string;
  readonly parentId: string;
  readonly entryId: string;
}

function createDbBackedReferenceStore(): SessionStore & RunLedger & ProductionPersistenceStore {
  const entries = new Map<string, SessionEntry>();
  const idempotency = new Map<string, IdempotencyRow>();
  const runs: RunRecord[] = [];
  const events: AgentEventRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const usage: UsageRecord[] = [];

  const bySession = (sid: string) =>
    [...entries.values()].filter((e) => e.sessionId === sid).sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const readBranchPath = async (query: SessionBranchRead): Promise<PersistencePage<SessionEntry>> => {
    const scoped = bySession(query.sessionId);
    let leafId = query.leafId;
    if (!leafId) {
      // Latest leaf = the most recently appended entry that no other entry points at as parent.
      const childTargets = new Set(scoped.map((e) => e.parentId).filter((p): p is string => Boolean(p)));
      leafId = scoped.filter((e) => !childTargets.has(e.id)).at(-1)?.id;
    }
    const chain: SessionEntry[] = [];
    let cursor = scoped.find((e) => e.id === leafId);
    while (cursor) {
      chain.unshift(cursor);
      cursor = cursor.parentId ? scoped.find((e) => e.id === cursor!.parentId) : undefined;
    }
    return { items: chain };
  };

  return {
    name: "db-backed-reference-mock",
    metadata: { kind: "reference", multiProcess: false },

    // --- SessionStore: atomic append + DB-friendly branch read ---
    async append(entry: SessionEntry, options?: SessionAppendOptions): Promise<void> {
      // 1. expectedParentId existence check (mirrors the conditional-append transaction pattern).
      if (options?.expectedParentId && !entries.has(options.expectedParentId)) {
        throw new SessionAppendConflictError({ code: "session_append_conflict", expectedParentId: options.expectedParentId });
      }
      // 2. idempotency dedup: exact retry for the same parent + key is rejected as a duplicate.
      if (options?.idempotencyKey) {
        const rowKey = `${options.expectedParentId ?? ""}:${options.idempotencyKey}`;
        const existing = idempotency.get(rowKey);
        if (existing) {
          throw new SessionAppendConflictError({ code: "session_append_conflict", idempotencyDuplicate: true });
        }
        idempotency.set(rowKey, { key: rowKey, parentId: options.expectedParentId ?? "", entryId: entry.id });
      }
      // 3. duplicate entry id fails closed.
      if (entries.has(entry.id)) {
        throw new Error(`Duplicate session entry id: ${entry.id}`);
      }
      entries.set(entry.id, entry);
    },
    async list(sessionId: string): Promise<readonly SessionEntry[]> {
      return bySession(sessionId);
    },
    async get(id: string): Promise<SessionEntry | undefined> {
      return entries.get(id);
    },
    readBranchPath,

    // --- RunLedger: durable run/event/tool/usage rows (runtime already redacted them) ---
    appendRun(record: RunRecord): void {
      runs.push(record);
    },
    appendEvent(record: AgentEventRecord): void {
      events.push(record);
    },
    appendToolCall(record: ToolCallRecord): void {
      toolCalls.push(record);
    },
    appendUsage(record: UsageRecord): void {
      usage.push(record);
    },

    // --- ProductionPersistenceStore reads (host fills sessions/branches/
    //     definitions/retention/migrations record tables separately) ---
    async querySessions(): Promise<PersistencePage<never>> {
      return { items: [] };
    },
    async queryBranches(): Promise<PersistencePage<never>> {
      return { items: [] };
    },
    async queryEntries(query): Promise<PersistencePage<SessionEntry>> {
      let rows = [...entries.values()];
      if (query.sessionId) rows = rows.filter((e) => e.sessionId === query.sessionId);
      if (query.runId) rows = rows.filter((e) => e.runId === query.runId);
      rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      return { items: rows.slice(0, query.limit ?? rows.length) };
    },
    async queryRuns(query): Promise<PersistencePage<RunRecord>> {
      // RunQuery has no runId field (runs are addressable by sessionId/branchId/status);
      // narrow to one run by filtering the page by record id afterwards.
      let rows = runs;
      if (query.sessionId) rows = rows.filter((r) => r.sessionId === query.sessionId);
      return { items: rows };
    },
    async queryEvents(query): Promise<PersistencePage<AgentEventRecord>> {
      let rows = events;
      if (query.sessionId) rows = rows.filter((e) => e.sessionId === query.sessionId);
      if (query.runId) rows = rows.filter((e) => e.runId === query.runId);
      return { items: rows };
    },
    async queryToolCalls(query): Promise<PersistencePage<ToolCallRecord>> {
      let rows = toolCalls;
      if (query.sessionId) rows = rows.filter((c) => c.sessionId === query.sessionId);
      if (query.runId) rows = rows.filter((c) => c.runId === query.runId);
      if (query.name) rows = rows.filter((c) => c.name === query.name);
      return { items: rows };
    },
    async queryUsage(query): Promise<PersistencePage<UsageRecord>> {
      let rows = usage;
      if (query.sessionId) rows = rows.filter((u) => u.sessionId === query.sessionId);
      if (query.runId) rows = rows.filter((u) => u.runId === query.runId);
      return { items: rows };
    },
    async queryAgentDefinitions(): Promise<PersistencePage<never>> {
      return { items: [] };
    },
    async queryRetentionPolicies(): Promise<PersistencePage<never>> {
      return { items: [] };
    },
    async queryMigrations(): Promise<PersistencePage<never>> {
      return { items: [] };
    },
  };
}

// --- Demo driver -----------------------------------------------------------

async function collectEvents(subscription: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of subscription) out.push(event);
  return out;
}

// Caller-supplied credential resolver with a fake value. The mock provider
// ignores it; it exists to prove secrets stay out of the ledger/timeline/log.
const fakeCredentialResolver: CredentialResolver = {
  resolve: () => ({ type: "api_key", value: FAKE_API_KEY, provider: "mock" }),
};

export async function demo(): Promise<{
  liveEventCount: number;
  toolCallNames: string[];
  branchHandleCheckout: boolean;
  forkDiverged: boolean;
  resumedRunCount: number;
  resumedEventTypes: string[];
  resumedUsageRuns: string[];
  secretRedactedFromLedger: boolean;
  credentialNeverLogged: boolean;
  conformancePassed: boolean;
}> {
  await assertSessionStoreConforms(createDbBackedReferenceStore(), { exerciseReadBranchPath: true });
  const conformancePassed = true;
  const store = createDbBackedReferenceStore();

  const model: ModelConfig = { provider: "mock", model: "demo" };
  const provider = createMockProvider(
    [
      providerToolCall({ type: "tool_call", id: "tc_save", name: "notes/save", arguments: { text: "saved summary" } }),
      providerTextDelta("Summary saved."),
      providerUsage({ inputTokens: 12, outputTokens: 8, totalTokens: 20 }),
      providerDone(),
    ],
    { id: "mock" },
  );

  const agent = createAgent({
    model,
    providerSource: createProviderResolver([provider]),
    instructions: "You are a concise assistant.",
    tools: createToolRegistry([saveNoteTool]),
    skills: createSkillRegistry([summarizeSkill]),
    store,
    runLedger: store,
    ownership: { tenantId: "tenant-1", accountId: "acct-1", userId: "user-1" },
    credentials: fakeCredentialResolver,
    redactor: createSecretRedactor([FAKE_SECRET, FAKE_API_KEY]),
  });

  // Initial session via the createAgentSession seam, sharing the DB-backed store.
  const session = createAgentSession({ agent, id: "session-1", store });

  // Run 1 — the prompt carries a fake secret that must be redacted before storage.
  const reader1 = collectEvents(session.subscribe());
  await session.run(`Summarize this. Do not reveal ${FAKE_SECRET}.`, { activeSkills: ["summarize-skill"] });
  const events1 = await reader1;
  const run1Id = events1.find((e) => e.type === "agent_started")?.runId ?? "";
  const branchHandleLeaf = session.leafId; // durable (sessionId, leafId) handle

  // Run 2 advances the main branch past run 1.
  await session.run("Add a one-word follow-up.");

  // Branch-handle checkout: rewind to the run-1 leaf, then fork a divergent branch.
  await session.checkout(branchHandleLeaf);
  const forked = session.fork({ leafId: branchHandleLeaf });
  const readerFork = collectEvents(forked.subscribe());
  await forked.run("Divergent turn on the forked branch.", { activeSkills: ["summarize-skill"] });
  const forkEvents = await readerFork;
  const forkLeaf = forked.leafId;

  // Resume run 1's timeline from the ledger via ProductionPersistenceStore reads
  // — no Prism source, no in-memory capture. This is the audit/replay path.
  const resumedRuns = await store.queryRuns({ sessionId: session.id });
  const resumedRunOneEvents = await store.queryEvents({ runId: run1Id });
  const resumedToolCalls = await store.queryToolCalls({ sessionId: session.id, name: "notes/save" });
  const resumedUsage = await store.queryUsage({ runId: run1Id });

  // Did the fork actually diverge from the main line at the shared leaf?
  // readBranchPath is optional on the contract; this reference store always implements it.
  const forkBranch = await store.readBranchPath!({ sessionId: session.id, leafId: forkLeaf });
  const forkDiverged = Boolean(forkLeaf && forkLeaf !== branchHandleLeaf && forkBranch.items.length > 0);

  // Scan every persisted ledger/entry payload for the raw secrets.
  const allLedgerText = JSON.stringify({
    events: (await store.queryEvents({ sessionId: session.id })).items,
    toolCalls: resumedToolCalls.items,
    usage: resumedUsage.items,
    entries: (await store.queryEntries({ sessionId: session.id })).items,
  });
  const secretRedactedFromLedger = !allLedgerText.includes(FAKE_SECRET) && !allLedgerText.includes(FAKE_API_KEY);
  // Credential resolver value must never appear in live events either.
  const credentialNeverLogged = !JSON.stringify([...events1, ...forkEvents]).includes(FAKE_API_KEY);

  return {
    liveEventCount: events1.length,
    toolCallNames: resumedToolCalls.items.map((c) => c.name),
    branchHandleCheckout: Boolean(branchHandleLeaf) && session.leafId === branchHandleLeaf,
    forkDiverged,
    resumedRunCount: resumedRuns.items.filter((r) => r.sessionId === session.id).length,
    resumedEventTypes: resumedRunOneEvents.items.map((e) => e.type),
    resumedUsageRuns: resumedUsage.items.map((u) => u.runId).filter((r): r is string => Boolean(r)),
    secretRedactedFromLedger,
    credentialNeverLogged,
    conformancePassed,
  };
}

export async function main(): Promise<void> {
  const result = await demo();
  console.log(JSON.stringify(result));

  // Fail fast if the demo does not behave as expected.
  if (!result.branchHandleCheckout) throw new Error("expected checkout to re-point the branch leaf");
  if (!result.forkDiverged) throw new Error("expected the forked branch to diverge from the shared leaf");
  if (!result.toolCallNames.includes("notes/save")) throw new Error("expected notes/save tool call persisted in ledger");
  if (result.resumedRunCount < 1) throw new Error("expected at least one run resumable from the ledger");
  if (result.resumedEventTypes.length === 0) throw new Error("expected run-1 events resumable from the ledger");
  if (result.resumedUsageRuns.length === 0) throw new Error("expected run-1 usage resumable from the ledger");
  if (!result.secretRedactedFromLedger) throw new Error("expected raw secrets redacted from the persisted ledger/entries");
  if (!result.credentialNeverLogged) throw new Error("expected caller credential value to never enter the event stream");
  if (!result.conformancePassed) throw new Error("expected DB-backed reference store to pass SessionStore conformance");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
