/**
 * Phase 10 Task 5 — session modes and configuration options.
 * Modes: host table advertised on new/load/resume, set_mode validates + runs
 * the host apply hook + emits current_mode_update; unknown ids fail closed.
 * Config options: gated on the client's session.configOptions.boolean
 * advertisement, validated against declared type, onChange hook, and
 * config_option_update notifications with the full current-value set.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { client, methods, PROTOCOL_VERSION, type ClientContext } from "@agentclientprotocol/sdk";
import type { AgentRunLifecycle, AgentSession } from "@arnilo/prism";
import { createPrismAcpAgent, type AcpConfigOptionsSeam, type AcpModesSeam, type CreatePrismAcpAgentOptions } from "../acp/index.js";

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
  const acpClient = client().onNotification(methods.client.session.update, ({ params }) => void 0);
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

  it("returns configOptions with defaults on session/new when advertised", async () => {
    const { app } = makeAgent();
    await connect(app, async (connection) => {
      const created = await connection.request(methods.agent.session.new, { cwd: "/w", mcpServers: [] });
      assert.deepEqual(created.configOptions, [
        { type: "boolean", id: "verbose", name: "Verbose", defaultValue: false, currentValue: false },
        {
          type: "select",
          id: "depth",
          name: "Depth",
          defaultValue: "shallow",
          currentValue: "shallow",
          options: [
            { value: "shallow", name: "Shallow" },
            { value: "deep", name: "Deep" },
          ],
        },
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
      assert.equal(response.configOptions[1].currentValue, "shallow");
      assert.deepEqual(
        changed.map(({ sessionId: sid, configId, value }) => ({ sessionId: sid, configId, value })),
        [{ sessionId, configId: "verbose", value: true }],
      );

      const update = updates.at(-1) as { update: { sessionUpdate: string; configOptions: Array<{ currentValue: unknown }> } };
      assert.equal(update.update.sessionUpdate, "config_option_update");
      assert.equal(update.update.configOptions[0].currentValue, true);

      // Select value persists too.
      const second = await connection.request<import("@agentclientprotocol/sdk").SetSessionConfigOptionResponse>(
        methods.agent.session.setConfigOption,
        { sessionId, configId: "depth", type: "select", value: "deep" },
      );
      assert.equal(second.configOptions[1].currentValue, "deep");
      assert.deepEqual(
        changed.map(({ sessionId: sid, configId, value }) => ({ sessionId: sid, configId, value })),
        [
          { sessionId, configId: "verbose", value: true },
          { sessionId, configId: "depth", value: "deep" },
        ],
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
      await rejectsWith(
        connection.request(methods.agent.session.setConfigOption, { sessionId, configId: "depth", type: "select", value: "sideways" }),
        "no select value",
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
      assert.equal(loaded.configOptions!.length, 2);
      const resumed = await connection.request(methods.agent.session.resume, { sessionId: "r", cwd: "/w" });
      assert.equal(resumed.modes!.currentModeId, "review");
      assert.equal(resumed.configOptions!.length, 2);
    });
  });
});
