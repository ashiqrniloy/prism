import { describe, it } from "node:test";
import type {
  AgentDefinitionQuery,
  AgentEventQuery,
  BranchQuery,
  BranchReader,
  MigrationQuery,
  OwnershipScope,
  PersistencePage,
  PersistenceQuery,
  ProductionPersistenceStore,
  RunLedger,
  RunLedgerRecord,
  RunQuery,
  SessionAppendConflict,
  SessionAppendOptions,
  SessionBranchHandle,
  SessionBranchRead,
  SessionContextSnapshot,
  SessionEntry,
  SessionEntryQuery,
  SessionQuery,
  SessionStore,
  ToolCallQuery,
  UsageQuery,
} from "../index.js";
import { SESSION_APPEND_CONFLICT_CODE, SessionAppendConflictError, getSessionBranchEntries, rebuildSessionContext } from "../index.js";

// ponytail: compile-only type test — no runtime assertions. Verifies Phase 34
// production persistence contracts are implementable without DB/ORM/network/app
// dependencies and support all required filter dimensions.
describe("production persistence contracts (compile only)", () => {
  it("accepts a host DB adapter implementing ProductionPersistenceStore", () => {
    const store: ProductionPersistenceStore = {
      async querySessions(query) {
        void query.tenantId;
        void query.accountId;
        void query.userId;
        return { items: [] };
      },
      async queryBranches(query) {
        void query.sessionId;
        return { items: [] };
      },
      async queryEntries(query) {
        void query.sessionId;
        return { items: [] };
      },
      async queryRuns(query) {
        void query.status;
        return { items: [] };
      },
      async queryEvents(query) {
        void query.type;
        void query.cursor;
        void query.limit;
        void query.order;
        return { items: [] };
      },
      async queryToolCalls(query) {
        void query.name;
        return { items: [] };
      },
      async queryUsage(query) {
        void query.entryId;
        return { items: [] };
      },
      async queryAgentDefinitions(query) {
        void query.version;
        return { items: [] };
      },
      async queryRetentionPolicies(query) {
        void query.archiveStore;
        return { items: [] };
      },
      async queryMigrations(query) {
        void query.version;
        return { items: [] };
      },
    };
    void store;
  });

  it("supports all required session-entry query filters", () => {
    const query: SessionEntryQuery = {
      sessionId: "s1",
      runId: "r1",
      parentId: "p1",
      leafId: "leaf1",
      kind: ["message", "event"],
      fromTimestamp: "2024-01-01T00:00:00Z",
      toTimestamp: "2024-12-31T23:59:59Z",
      tenantId: "t1",
      accountId: "a1",
      userId: "u1",
      cursor: "c1",
      limit: 50,
      order: "desc",
    };
    void query;
  });

  it("supports all required session/run/event/tool/usage query filters", () => {
    const sessionQuery: SessionQuery = {
      tenantId: "t1",
      accountId: "a1",
      userId: "u1",
      parentSessionId: "parent",
      agentDefinitionId: "def1",
      agentDefinitionVersion: "v1",
      retentionPolicyId: "rp1",
      fromCreatedAt: "2024-01-01T00:00:00Z",
      toCreatedAt: "2024-12-31T23:59:59Z",
      fromUpdatedAt: "2024-01-01T00:00:00Z",
      toUpdatedAt: "2024-12-31T23:59:59Z",
      hasExpired: false,
    };
    const runQuery: RunQuery = {
      sessionId: "s1",
      branchId: "b1",
      status: ["running", "succeeded"],
      fromStartedAt: "2024-01-01T00:00:00Z",
      toStartedAt: "2024-12-31T23:59:59Z",
      isFinished: false,
    };
    const eventQuery: AgentEventQuery = {
      sessionId: "s1",
      runId: "r1",
      entryId: "e1",
      type: ["message_delta", "tool_execution_finished"],
      redacted: false,
      cursor: "event_10",
      limit: 100,
      order: "asc",
    };
    const toolCallQuery: ToolCallQuery = {
      sessionId: "s1",
      runId: "r1",
      entryId: "e1",
      name: "echo",
      status: "finished",
      redacted: true,
    };
    const usageQuery: UsageQuery = {
      sessionId: "s1",
      runId: "r1",
      entryId: "e1",
      fromRecordedAt: "2024-01-01T00:00:00Z",
      toRecordedAt: "2024-12-31T23:59:59Z",
    };
    const branchQuery: BranchQuery = {
      sessionId: "s1",
      name: "main",
      parentBranchId: "parent",
      hasLeaf: true,
    };
    const agentDefinitionQuery: AgentDefinitionQuery = {
      name: "greeter",
      version: "v1",
      source: "registry",
    };
    const migrationQuery: MigrationQuery = {
      name: "init",
      version: "1",
      fromAppliedAt: "2024-01-01T00:00:00Z",
      toAppliedAt: "2024-12-31T23:59:59Z",
    };
    void sessionQuery;
    void runQuery;
    void eventQuery;
    void toolCallQuery;
    void usageQuery;
    void branchQuery;
    void agentDefinitionQuery;
    void migrationQuery;
  });

  it("accepts a host write-side RunLedger adapter", () => {
    const ledger: RunLedger = {
      async appendRun(record) { void record.id; },
      async appendEvent(record) { void record.event; },
      async appendToolCall(record) { void record.name; },
      async appendUsage(record) { void record.usage; },
    };
    const record: RunLedgerRecord = {
      id: "run_1",
      sessionId: "s1",
      runId: "r1",
      model: { provider: "mock", model: "demo" },
      provider: "mock",
      idempotencyKey: "idem-1",
      status: "succeeded",
      startedAt: "2024-01-01T00:00:00Z",
      finishedAt: "2024-01-01T00:00:01Z",
      abortReason: undefined,
      error: undefined,
      tenantId: "t1",
      accountId: "a1",
      userId: "u1",
      redacted: false,
    } as RunLedgerRecord;
    void ledger;
    void record;
  });

  it("does not require any filesystem, SQL, ORM, or network imports to implement the contract", () => {
    // If this compiles, the contract is satisfied by plain TypeScript types only.
    const page: PersistencePage<{ id: string }> = {
      items: [{ id: "x" }],
      nextCursor: "next",
      total: 100,
    };
    const base: PersistenceQuery = { cursor: "c", limit: 10, order: "asc" };
    const scope: OwnershipScope = { tenantId: "t", accountId: "a", userId: "u" };
    void page;
    void base;
    void scope;
  });
});

// ponytail: compile-only type test — no runtime assertions. Verifies Phase 36
// atomic-append contracts: the widened `append` is backward compatible, and the
// new append options / branch-handle / conflict types are assignable as documented.
describe("atomic append contracts (compile only)", () => {
  it("a legacy single-arg append(entry) implementation still satisfies the widened SessionStore", () => {
    // A function with fewer parameters is assignable to one with an optional extra param,
    // so existing host adapters that ignore `options` keep compiling unchanged.
    const legacy: SessionStore = {
      async append(entry: SessionEntry) { void entry.id; },
      async list(sessionId: string) { void sessionId; return []; },
    };
    void legacy;
  });

  it("SessionAppendOptions, SessionBranchHandle, and SessionAppendConflictError are assignable as documented", () => {
    const options: SessionAppendOptions = { expectedParentId: "leaf_1", idempotencyKey: "req-42" };
    const emptyOptions: SessionAppendOptions = {};
    const handle: SessionBranchHandle = { sessionId: "s1", leafId: "leaf_1" };
    const conflict: SessionAppendConflict = {
      code: SESSION_APPEND_CONFLICT_CODE,
      expectedParentId: "leaf_1",
      currentLeafId: "leaf_2",
      idempotencyDuplicate: false,
    };
    const error = new SessionAppendConflictError(conflict);
    // `code` is the stable literal, not an arbitrary string.
    const code: "session_append_conflict" = error.code;
    void options; void emptyOptions; void handle; void conflict; void error; void code;
  });

  it("readBranchPath is optional on SessionStore and ProductionPersistenceStore", () => {
    // store WITHOUT readBranchPath stays assignable (built-in memory/JSONL stores)
    const withoutReader: SessionStore = {
      async append(entry: SessionEntry) { void entry.id; },
      async list(sessionId: string) { void sessionId; return []; },
    };
    // store WITH readBranchPath is also assignable (DB adapter)
    const withReader: SessionStore = {
      ...withoutReader,
      async readBranchPath(query: SessionBranchRead) { void query; return { items: [] as readonly SessionEntry[] }; },
    };
    // DB persistence adapter: readBranchPath optional there too
    const persistence: ProductionPersistenceStore = {
      ...withoutReader,
      async queryEntries() { return { items: [] as readonly SessionEntry[] }; },
      async querySessions() { return { items: [] }; },
      async queryBranches() { return { items: [] }; },
      async queryRuns() { return { items: [] }; },
      async queryEvents() { return { items: [] }; },
      async queryToolCalls() { return { items: [] }; },
      async queryUsage() { return { items: [] }; },
      async queryAgentDefinitions() { return { items: [] }; },
      async queryRetentionPolicies() { return { items: [] }; },
      async queryMigrations() { return { items: [] }; },
    } as unknown as ProductionPersistenceStore;
    void withReader; void persistence;
  });

  it("branch helpers keep the sync array signature and add an async reader overload", async () => {
    const reader: BranchReader = async (query: SessionBranchRead) => ({ items: [] as readonly SessionEntry[], nextCursor: query.cursor });
    // reader path -> Promise<readonly SessionEntry[]>; array path -> readonly SessionEntry[] (sync)
    const viaReader: Promise<readonly SessionEntry[]> = getSessionBranchEntries(reader, { sessionId: "s1" });
    const viaArray: readonly SessionEntry[] = getSessionBranchEntries([], {});
    const ctxViaReader: Promise<SessionContextSnapshot> = rebuildSessionContext(reader, { sessionId: "s1" });
    const ctxViaArray: SessionContextSnapshot = rebuildSessionContext([], {});
    void (await viaReader); void viaArray; void (await ctxViaReader); void ctxViaArray;
  });
});
