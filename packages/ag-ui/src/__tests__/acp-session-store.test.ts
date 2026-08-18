/**
 * Phase 18 Task 2 — durable ACP session store behind a host-owned seam
 * (plan 018 closeout acp-session-store). Threat-model mapping (docs/_evidence/
 * phase18-primitive-review.md):
 *   T1 cross-tenant refusal (never merge by sessionId alone)
 *   T2 redaction at the store boundary
 *   T3 corrupt/stale records fail closed (dropped, never merged)
 *   T5 registry cap enforced on restore
 *   T6 no implicit activation (store touched only when authorized + seam present)
 *   T7 restart restore of mode/config state
 *   T8 per-session mode/config isolation (unknown ids/values drop)
 *   T9 oversized entries refused (save boundary) / dropped (restore)
 * Store failure fails the request (host sees it); evict on close/delete.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ClientContext, client, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { AgentRunLifecycle, AgentSession, SecretRedactor } from "@arnilo/prism";
import {
  type AcpConfigOptionsSeam,
  AcpError,
  type AcpModesSeam,
  type AcpSessionStore,
  type CreatePrismAcpAgentOptions,
  createPrismAcpAgent,
  type PersistedAcpSession,
} from "../acp/index.js";
import { validatePersistedSession } from "../acp/session-store.js";

const stream = { async *stream() {} } as unknown as AgentSession;
const session = (id: string) => ({ session: { ...stream, id } }) as unknown as { session: AgentSession };
const iso = "2026-08-11T12:00:00.000Z";

/** In-memory AcpSessionStore fixture; also serves as the shared store across "restarts". */
class MemorySessionStore implements AcpSessionStore {
  readonly entries = new Map<string, PersistedAcpSession>();
  loads = 0;
  saves: PersistedAcpSession[] = [];
  evicts: string[] = [];
  async save(entry: PersistedAcpSession): Promise<void> {
    this.entries.set(entry.sessionId, entry);
    this.saves.push(entry);
  }
  async loadAll(): Promise<readonly PersistedAcpSession[]> {
    this.loads++;
    return [...this.entries.values()];
  }
  async evict(sessionId: string): Promise<void> {
    this.entries.delete(sessionId);
    this.evicts.push(sessionId);
  }
}

function makeAgent(
  store: AcpSessionStore | undefined,
  overrides: Partial<CreatePrismAcpAgentOptions> = {},
): ReturnType<typeof createPrismAcpAgent> {
  const modesSeam: AcpModesSeam = {
    defaultModeId: "review",
    modes: [
      { id: "review", name: "Review" },
      { id: "edit", name: "Edit" },
    ],
  };
  const configOptionsSeam: AcpConfigOptionsSeam = {
    options: [
      { type: "boolean", id: "verbose", name: "Verbose", defaultValue: false },
      { type: "boolean", id: "quiet", name: "Quiet", defaultValue: false },
      {
        type: "select",
        id: "depth",
        name: "Depth",
        defaultValue: "shallow",
        options: [
          { value: "shallow", name: "Shallow" },
          { value: "deep", name: "Deep" },
        ],
      },
    ],
  };
  return createPrismAcpAgent({
    authorize: () => ({ ownership: { userId: "user-1" } }),
    sessionFactory: ({ sessionId }) => session(sessionId ?? "host-session"),
    lifecycle: {} as AgentRunLifecycle,
    modes: modesSeam,
    configOptions: configOptionsSeam,
    ...(store ? { sessionStore: store } : {}),
    ...overrides,
  });
}

async function connect(app: ReturnType<typeof createPrismAcpAgent>, run: (connection: ClientContext) => Promise<void>): Promise<void> {
  const acpClient = client().onNotification(methods.client.session.update, () => void 0);
  await acpClient.connectWith(app, async (connection) => {
    await connection.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { session: { configOptions: { boolean: {} } } },
    });
    await run(connection);
  });
}

function rejectsWith(promise: Promise<unknown>, text: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { code: number }).code, -32603);
    assert.ok(String((error as { data?: { details?: unknown } }).data?.details).includes(text));
    return true;
  });
}

describe("ACP durable session store (phase 18 Task 2)", () => {
  it("T7: saves on new/setMode/setConfigOption and restores mode/config on a restarted agent", async () => {
    const store = new MemorySessionStore();
    let sessionId = "";
    await connect(makeAgent(store), async (connection) => {
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      sessionId = created.sessionId;
      await connection.request(methods.agent.session.setMode, { sessionId, modeId: "edit" });
      await connection.request(methods.agent.session.setConfigOption, { sessionId, configId: "verbose", type: "boolean", value: true });
    });
    assert.equal(store.saves.length, 3, "new + setMode + setConfigOption each persist");
    const entry = store.entries.get(sessionId)!;
    assert.equal(entry.modeId, "edit");
    assert.deepEqual(entry.configValues, { verbose: true, quiet: false, depth: "shallow" });
    assert.equal(entry.ownership.userId, "user-1");
    assert.equal(entry.cwd, "/w");

    // "restart": a fresh agent over the same store restores on first authorized touch
    const applied: Array<{ fromModeId?: string }> = [];
    const restarted = makeAgent(store, {
      modes: {
        defaultModeId: "review",
        modes: [
          { id: "review", name: "Review" },
          {
            id: "edit",
            name: "Edit",
            apply: (input) => {
              applied.push({ fromModeId: input.fromModeId });
            },
          },
        ],
      },
    });
    await connect(restarted, async (connection) => {
      // T8: restored mode/config values are live — setMode sees the restored fromModeId,
      // and the configOption response carries the restored verbose=true (a fresh map would show default false)
      await connection.request(methods.agent.session.setMode, { sessionId, modeId: "edit" });
      const updated = (await connection.request(methods.agent.session.setConfigOption, {
        sessionId,
        configId: "quiet",
        type: "boolean",
        value: true,
      })) as { configOptions: Array<{ id: string; currentValue: boolean | string }> };
      assert.deepEqual(
        updated.configOptions.find((o: { id: string }) => o.id === "verbose")?.currentValue,
        true,
        "restored configValues visible before any mutation of that option",
      );
    });
    assert.deepEqual(applied, [{ fromModeId: "edit" }], "restored modeId observed by the mode apply hook");
    assert.equal(store.loads, 2, "one loadAll per agent instance, never more");
  });

  it("T1: a stored entry whose ownership differs from the authorization is never restored (sessionId alone is not a key)", async () => {
    const store = new MemorySessionStore();
    store.entries.set("s-a", {
      sessionId: "s-a",
      ownership: { userId: "user-a" },
      modeId: "edit",
      configValues: { verbose: true, depth: "shallow" },
      cwd: "/w",
      additionalDirectories: [],
      updatedAt: iso,
    });
    // tenant B cannot reach tenant A's session even knowing its id
    await connect(makeAgent(store, { authorize: () => ({ ownership: { userId: "user-b" } }) }), async (connection) => {
      await rejectsWith(connection.request(methods.agent.session.setMode, { sessionId: "s-a", modeId: "review" }), "Unknown ACP session");
    });
    // tenant A restores it fine
    await connect(makeAgent(store, { authorize: () => ({ ownership: { userId: "user-a" } }) }), async (connection) => {
      await connection.request(methods.agent.session.setMode, { sessionId: "s-a", modeId: "edit" });
    });
  });

  it("T3/T8: corrupt or seam-mismatched records fail closed (dropped, never merged)", async () => {
    const store = new MemorySessionStore();
    const base = {
      ownership: { userId: "user-1" },
      configValues: { verbose: true, depth: "shallow" },
      cwd: "/w",
      additionalDirectories: [],
      updatedAt: iso,
    };
    store.entries.set("ok", { ...base, sessionId: "ok", modeId: "edit" });
    store.entries.set("bad-mode", { ...base, sessionId: "bad-mode", modeId: "nope" }); // unknown mode id
    store.entries.set("bad-config", { ...base, sessionId: "bad-config", configValues: { verbose: true, depth: "nope" } }); // invalid select value
    store.entries.set("bad-key", { ...base, sessionId: "bad-key", configValues: { verbose: true, mystery: true } }); // unknown option
    store.entries.set("bad-cwd", { ...base, sessionId: "bad-cwd", cwd: "relative" }); // non-absolute cwd
    await connect(makeAgent(store), async (connection) => {
      await connection.request(methods.agent.session.setMode, { sessionId: "ok", modeId: "review" }); // restored
      for (const bad of ["bad-mode", "bad-config", "bad-key", "bad-cwd"]) {
        await rejectsWith(connection.request(methods.agent.session.setMode, { sessionId: bad, modeId: "review" }), "Unknown ACP session");
      }
    });
  });

  it("T3: config values without a configOptions seam, and mode without a modes seam, fail closed", async () => {
    const store = new MemorySessionStore();
    store.entries.set("no-seam", {
      sessionId: "no-seam",
      ownership: { userId: "user-1" },
      modeId: "edit",
      configValues: { verbose: true, depth: "shallow" },
      cwd: "/w",
      additionalDirectories: [],
      updatedAt: iso,
    });
    const bare = createPrismAcpAgent({
      authorize: () => ({ ownership: { userId: "user-1" } }),
      sessionFactory: ({ sessionId }) => session(sessionId ?? "host-session"),
      lifecycle: {} as AgentRunLifecycle,
      sessionStore: store,
    });
    await connect(bare, async (connection) => {
      await rejectsWith(
        connection.request(methods.agent.session.prompt, { sessionId: "no-seam", prompt: [{ type: "text", text: "hi" }] }),
        "Unknown ACP session",
      );
    });
  });

  it("T5: the registry cap is enforced on restore; overflow entries fail closed", async () => {
    const store = new MemorySessionStore();
    for (const id of ["s1", "s2", "s3"]) {
      store.entries.set(id, {
        sessionId: id,
        ownership: { userId: "user-1" },
        configValues: { verbose: false, depth: "shallow" },
        cwd: "/w",
        additionalDirectories: [],
        updatedAt: iso,
      });
    }
    const app = makeAgent(store, { limits: { acpSessions: 2 } });
    await connect(app, async (connection) => {
      await connection.request(methods.agent.session.setMode, { sessionId: "s1", modeId: "review" });
      await connection.request(methods.agent.session.setMode, { sessionId: "s2", modeId: "review" });
      await rejectsWith(connection.request(methods.agent.session.setMode, { sessionId: "s3", modeId: "review" }), "Unknown ACP session");
    });
  });

  it("T9: oversized persisted entries are refused at the save boundary and dropped at restore", async () => {
    const store = new MemorySessionStore();
    assert.throws(
      () =>
        validatePersistedSession({
          sessionId: "s",
          ownership: {},
          configValues: {},
          cwd: "/".padEnd(5000, "a"),
          additionalDirectories: [],
          updatedAt: iso,
        }),
      AcpError,
    );
    store.entries.set("huge", {
      sessionId: "huge",
      ownership: { userId: "user-1" },
      configValues: {},
      cwd: "/".padEnd(5000, "a"),
      additionalDirectories: [],
      updatedAt: iso,
    });
    await connect(makeAgent(store), async (connection) => {
      await rejectsWith(connection.request(methods.agent.session.setMode, { sessionId: "huge", modeId: "review" }), "Unknown ACP session");
    });
  });

  it("T2: persisted entries pass through the redactor at the store boundary", async () => {
    // substring redaction keeps shape valid (absolute path) while proving the redactor ran
    const redactor: SecretRedactor = { redact: (value) => JSON.parse(JSON.stringify(value).replaceAll("secret", "[REDACTED]")) };
    const store = new MemorySessionStore();
    await connect(makeAgent(store, { redactor }), async (connection) => {
      await connection.request(methods.agent.session.new, { cwd: "/secret-w", mcpServers: [] });
    });
    await connect(makeAgent(store, { redactor }), async (connection) => {
      await connection.request(methods.agent.session.new, { cwd: "/plain-w", mcpServers: [] });
    });
    const saved = [...store.saves].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    assert.equal(saved.length, 2);
    assert.ok(
      saved.some((entry) => entry.cwd === "/[REDACTED]-w"),
      "secret-bearing cwd redacted before save",
    );
    assert.ok(
      saved.some((entry) => entry.cwd === "/plain-w"),
      "clean values pass through unchanged",
    );
  });

  it("T6: no implicit activation — an unauthorized request never opens the store; evict runs on close", async () => {
    const store = new MemorySessionStore();
    const denied = createPrismAcpAgent({
      authorize: () => false,
      sessionFactory: ({ sessionId }) => session(sessionId ?? "host-session"),
      lifecycle: {} as AgentRunLifecycle,
      sessionStore: store,
    });
    await connect(denied, async (connection) => {
      await rejectsWith(
        connection.request(methods.agent.session.prompt, { sessionId: "s", prompt: [{ type: "text", text: "hi" }] }),
        "Unauthorized ACP session",
      );
    });
    assert.equal(store.loads, 0, "store never opened without authorization");

    let createdId = "";
    await connect(makeAgent(store), async (connection) => {
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      createdId = created.sessionId;
      await connection.request(methods.agent.session.close, { sessionId: created.sessionId });
    });
    assert.ok(store.evicts.includes(createdId), "close evicts the persisted entry");
    assert.ok(!store.entries.has(createdId), "entry gone from the store after close");
  });
});
