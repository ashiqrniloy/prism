/**
 * Phase 10 Task 5 — session modes and configuration options.
 * Modes: host table advertised on new/load/resume, set_mode validates + runs
 * the host apply hook + emits current_mode_update; unknown ids fail closed.
 * Config options: gated per type on the client's session.configOptions.boolean
 * advertisement (B3) — only boolean options are advertised; select options are
 * never settable (ERR_PRISM_ACP_CAPABILITY) until the ACP spec defines a
 * select capability. Values validated against declared type, onChange hook,
 * and config_option_update notifications with the full current-value set.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ClientContext, client, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { AgentRunLifecycle, AgentSession } from "@arnilo/prism";
import {
  type AcpConfigOptionsSeam,
  AcpError,
  type AcpModesSeam,
  type CreatePrismAcpAgentOptions,
  createPrismAcpAgent,
} from "../acp/index.js";

const authorization = { ownership: { userId: "user-1" } };
const stream = { async *stream() {} } as unknown as AgentSession;
const session = (id: string) => ({ session: { ...stream, id } }) as unknown as { session: AgentSession };

function makeAgent(overrides: Partial<CreatePrismAcpAgentOptions> = {}): {
  app: ReturnType<typeof createPrismAcpAgent>;
  applied: Array<{ sessionId?: string; fromModeId?: string; modeId: string }>;
  changed: Array<{ sessionId: string; configId: string; value: boolean | string }>;
  updates: unknown[];
} {
  const applied: Array<{ sessionId?: string; fromModeId?: string; modeId: string }> = [];
  const changed: Array<{ sessionId: string; configId: string; value: boolean | string }> = [];
  const updates: unknown[] = [];
  const modesSeam: AcpModesSeam = {
    defaultModeId: "review",
    modes: [
      {
        id: "review",
        name: "Review",
        apply: (input) => {
          applied.push(input);
        },
      },
      {
        id: "edit",
        name: "Edit",
        apply: (input) => {
          applied.push(input);
        },
      },
    ],
  };
  const configOptionsSeam: AcpConfigOptionsSeam = {
    options: [
      { type: "boolean", id: "verbose", name: "Verbose", defaultValue: false },
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
    onChange: (input) => {
      changed.push(input);
    },
  };
  const app = createPrismAcpAgent({
    authorize: () => authorization,
    sessionFactory: ({ sessionId }) => session(sessionId ?? "host-session"),
    lifecycle: {} as AgentRunLifecycle,
    modes: modesSeam,
    configOptions: configOptionsSeam,
    ...overrides,
  });
  return { app, applied, changed, updates };
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

/** Client with an update recorder for notification assertions. */
async function connectRecording(
  app: ReturnType<typeof createPrismAcpAgent>,
  updates: unknown[],
  run: (connection: ClientContext, sessionId: string) => Promise<void>,
): Promise<void> {
  const acpClient = client().onNotification(methods.client.session.update, ({ params }) => {
    updates.push(params);
  });
  await acpClient.connectWith(app, async (connection) => {
    await connection.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { session: { configOptions: { boolean: {} } } },
    });
    const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
    await run(connection, created.sessionId);
  });
}

function rejectsWith(promise: Promise<unknown>, text: string): Promise<void> {
  return assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { code: number }).code, -32603);
    assert.ok(String((error as { data?: { details?: unknown } }).data?.details).includes(text));
    return true;
  });
}

/**
 * Plan 013 Task 5 — host-owned mode/config persistence, exactly as documented
 * in docs/acp.md "Persistence and ownership": the agent never persists; a host
 * that does MUST scope by ownership and refuse cross-tenant restores. Keyed by
 * sessionId alone (session ids may collide across tenants); the ownership guard
 * is what makes it safe. This fixture is the tested form of the docs example.
 */
class HostModeConfigStore {
  private readonly entries = new Map<string, { userId: string; modeId?: string; configValues: Record<string, boolean | string> }>();

  save(userId: string, sessionId: string, state: { modeId?: string; configValues: Record<string, boolean | string> }): void {
    this.entries.set(sessionId, { userId, ...state });
  }

  restore(userId: string, sessionId: string): { modeId?: string; configValues: Record<string, boolean | string> } | undefined {
    const entry = this.entries.get(sessionId);
    if (entry && entry.userId !== userId) {
      throw new AcpError("ERR_PRISM_ACP_INPUT", `mode/config load rejected: ownership mismatch for session '${sessionId}'`);
    }
    return entry; // absent or cross-tenant -> nothing restored, fail closed
  }
}

describe("ACP session modes and config options (Task 5)", () => {
  it("returns modes state on session/new with the default mode current", async () => {
    const { app } = makeAgent();
    await connect(app, async (connection) => {
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      assert.deepEqual(created.modes, {
        currentModeId: "review",
        availableModes: [
          { id: "review", name: "Review" },
          { id: "edit", name: "Edit" },
        ],
      });
    });
  });

  it("defaults the initial mode to the first mode when no defaultModeId is given", async () => {
    const { app } = makeAgent({
      modes: {
        modes: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
      },
    });
    await connect(app, async (connection) => {
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      assert.equal(created.modes!.currentModeId, "a");
    });
  });

  it("switches mode: apply hook runs, current_mode_update notifies, state persists", async () => {
    const { app, applied, updates } = makeAgent();
    await connectRecording(app, updates, async (connection, sessionId) => {
      const result = await connection.request(methods.agent.session.setMode, { sessionId, modeId: "edit" });
      assert.deepEqual(result, {});
      assert.deepEqual(
        applied.map(({ sessionId: sid, fromModeId, modeId: mid }) => ({ sessionId: sid, fromModeId, modeId: mid })),
        [{ sessionId, fromModeId: "review", modeId: "edit" }],
      );
      const update = updates.at(-1) as { update: { sessionUpdate: string; currentModeId: string } };
      assert.equal(update.update.sessionUpdate, "current_mode_update");
      assert.equal(update.update.currentModeId, "edit");

      // Switch back: fromModeId reflects the persisted state.
      await connection.request(methods.agent.session.setMode, { sessionId, modeId: "review" });
      assert.deepEqual(
        applied.map(({ sessionId: sid, fromModeId, modeId: mid }) => ({ sessionId: sid, fromModeId, modeId: mid })),
        [
          { sessionId, fromModeId: "review", modeId: "edit" },
          { sessionId, fromModeId: "edit", modeId: "review" },
        ],
      );
    });
  });

  it("fails closed on unknown mode ids and unknown sessions; apply failures leave the mode unchanged", async () => {
    const { app, applied, updates } = makeAgent();
    await connectRecording(app, updates, async (connection, sessionId) => {
      await rejectsWith(connection.request(methods.agent.session.setMode, { sessionId, modeId: "nope" }), "unknown mode");
      assert.equal(applied.length, 0);
      assert.equal(updates.length, 0);

      await rejectsWith(connection.request(methods.agent.session.setMode, { sessionId: "ghost", modeId: "edit" }), "Unknown ACP session");
      assert.equal(applied.length, 0);
    });
  });

  it("rejects mode tables over the cap and invalid defaults at creation", () => {
    const tooMany = Array.from({ length: 17 }, (_, i) => ({ id: `m${i}`, name: `M${i}` }));
    assert.throws(
      () => makeAgent({ modes: { modes: tooMany } }),
      (error: unknown) => (error as { code: string }).code === "ERR_PRISM_ACP_LIMIT",
    );
    assert.throws(
      () => makeAgent({ modes: { modes: [{ id: "a", name: "A" }], defaultModeId: "ghost" } }),
      (error: unknown) => (error as { code: string }).code === "ERR_PRISM_ACP_INPUT",
    );
  });

  it("returns configOptions only when the client advertised session.configOptions.boolean", async () => {
    const { app } = makeAgent();
    const acpClient = client();
    await acpClient.connectWith(app, async (connection) => {
      await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      assert.equal(created.configOptions, undefined, "configOptions must be omitted without the client advertisement");
      assert.ok(created.modes, "modes are not client-gated");
    });
  });

  it("returns configOptions with defaults on session/new when advertised (B3: boolean only)", async () => {
    const { app } = makeAgent();
    await connect(app, async (connection) => {
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      assert.deepEqual(created.configOptions, [
        { type: "boolean", id: "verbose", name: "Verbose", defaultValue: false, currentValue: false },
      ]);
    });
  });

  it("sets config options: onChange runs, full set echoes with the new currentValue", async () => {
    const { app, changed, updates } = makeAgent();
    await connectRecording(app, updates, async (connection, sessionId) => {
      const response = await connection.request(methods.agent.session.setConfigOption, {
        sessionId,
        configId: "verbose",
        type: "boolean",
        value: true,
      });
      assert.equal(response.configOptions[0].currentValue, true);
      assert.equal(response.configOptions.length, 1); // B3: select options are not advertised
      assert.deepEqual(
        changed.map(({ sessionId: sid, configId, value }) => ({ sessionId: sid, configId, value })),
        [{ sessionId, configId: "verbose", value: true }],
      );

      const update = updates.at(-1) as { update: { sessionUpdate: string; configOptions: Array<{ currentValue: unknown }> } };
      assert.equal(update.update.sessionUpdate, "config_option_update");
      assert.equal(update.update.configOptions[0].currentValue, true);

      // B3: select options are never settable, even with the boolean advertisement.
      await rejectsWith(
        connection.request(methods.agent.session.setConfigOption, { sessionId, configId: "depth", type: "select", value: "deep" }),
        "select options are not settable",
      );
      assert.deepEqual(
        changed.map(({ sessionId: sid, configId, value }) => ({ sessionId: sid, configId, value })),
        [{ sessionId, configId: "verbose", value: true }],
      );
    });
  });

  it("rejects unknown options, type mismatches, and unknown select values", async () => {
    const { app } = makeAgent();
    await connectRecording(app, [], async (connection, sessionId) => {
      await rejectsWith(
        connection.request(methods.agent.session.setConfigOption, { sessionId, configId: "ghost", type: "boolean", value: true }),
        "unknown config option",
      );
      await rejectsWith(
        connection.request(methods.agent.session.setConfigOption, { sessionId, configId: "verbose", type: "select", value: "x" }),
        "expects a boolean",
      );
      // B3: select options are gated before value validation.
      await rejectsWith(
        connection.request(methods.agent.session.setConfigOption, { sessionId, configId: "depth", type: "select", value: "sideways" }),
        "select options are not settable",
      );
    });
  });

  it("rejects set_config_option when the client did not advertise config options", async () => {
    const { app } = makeAgent();
    const acpClient = client();
    await acpClient.connectWith(app, async (connection) => {
      await connection.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION });
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      await rejectsWith(
        connection.request(methods.agent.session.setConfigOption, {
          sessionId: created.sessionId,
          configId: "verbose",
          type: "boolean",
          value: true,
        }),
        "did not advertise",
      );
    });
  });

  it("rejects config option tables over the cap at creation", () => {
    const tooMany = Array.from({ length: 17 }, (_, i) => ({ type: "boolean" as const, id: `o${i}`, name: `O${i}`, defaultValue: false }));
    assert.throws(
      () => makeAgent({ configOptions: { options: tooMany } }),
      (error: unknown) => (error as { code: string }).code === "ERR_PRISM_ACP_LIMIT",
    );
  });

  it("returns modes and configOptions on load and resume", async () => {
    const { app } = makeAgent({
      sessions: { load: () => session("l"), resume: () => session("r") },
    });
    await connect(app, async (connection) => {
      const loaded = await connection.request(methods.agent.session.load, { sessionId: "l", cwd: "/w", mcpServers: [] });
      assert.equal(loaded.modes!.currentModeId, "review");
      assert.equal(loaded.configOptions!.length, 1); // B3: boolean only
      const resumed = await connection.request(methods.agent.session.resume, { sessionId: "r", cwd: "/w" });
      assert.equal(resumed.modes!.currentModeId, "review");
      assert.equal(resumed.configOptions!.length, 1); // B3: boolean only
    });
  });

  it("host mode/config persistence is ownership-scoped: cross-tenant restore rejects, same-tenant restore applies", () => {
    const store = new HostModeConfigStore();
    store.save("tenant-a", "s1", { modeId: "edit", configValues: { verbose: true } });

    // Same-tenant restore returns the tenant's own state.
    assert.deepEqual(store.restore("tenant-a", "s1"), { userId: "tenant-a", modeId: "edit", configValues: { verbose: true } });

    // The same sessionId under another tenant (session ids may collide across
    // tenants) overwrites the entry; the ownership guard must refuse, never
    // returning the other tenant's mode/config.
    store.save("tenant-b", "s1", { modeId: "review", configValues: { verbose: false } });
    assert.deepEqual(store.restore("tenant-b", "s1"), { userId: "tenant-b", modeId: "review", configValues: { verbose: false } });
    assert.throws(
      () => store.restore("tenant-a", "s1"),
      (error: unknown) => {
        assert.ok(error instanceof AcpError);
        assert.equal(error.code, "ERR_PRISM_ACP_INPUT");
        assert.match(error.message, /ownership mismatch/);
        return true;
      },
      "cross-tenant restore must reject with ERR_PRISM_ACP_INPUT",
    );

    // Absent state restores as undefined: fail closed, nothing to apply.
    assert.equal(store.restore("tenant-a", "s2"), undefined);
  });

  it("agent stays a thin per-session registry: a new session never inherits another session's mode/config", async () => {
    let next = 0;
    const { app, updates } = makeAgent({
      sessionFactory: ({ sessionId }) => session(sessionId ?? `host-session-${++next}`),
    });
    await connectRecording(app, updates, async (connection, firstId) => {
      await connection.request(methods.agent.session.setMode, { sessionId: firstId, modeId: "edit" });
      await connection.request(methods.agent.session.setConfigOption, {
        sessionId: firstId,
        configId: "verbose",
        type: "boolean",
        value: true,
      });

      // A fresh session starts from the seams' defaults — no inherited mode/config.
      const second = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      assert.notEqual(second.sessionId, firstId);
      assert.equal(second.modes!.currentModeId, "review", "defaults recomputed — no inherited mode");
      const verbose = second.configOptions!.find((option) => option.id === "verbose")!;
      assert.equal(verbose.currentValue, false, "defaults recomputed — no inherited config value");
    });
  });

  it("cross-tenant session load fails closed at the authorize seam (host binds ownership)", async () => {
    const owners = new Map<string, string>();
    let tenant = "tenant-a";
    const { app } = makeAgent({
      authorize: ({ sessionId }) => {
        // Host binds transport identity to ownership; a load/resume of a session
        // owned by another tenant is refused before any mode/config state is reachable.
        if (sessionId && owners.get(sessionId) !== tenant) return false;
        return { ownership: { userId: tenant } };
      },
      sessions: { load: () => session("l") },
    });

    await connect(app, async (connection) => {
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      owners.set(created.sessionId, tenant);
    });

    tenant = "tenant-b";
    await connect(app, async (connection) => {
      await rejectsWith(
        connection.request(methods.agent.session.load, { sessionId: "host-session", cwd: "/w", mcpServers: [] }),
        "Unauthorized ACP session",
      );
    });
  });
});
