import assert from "node:assert/strict";
import { Duplex } from "node:stream";
import { describe, it } from "node:test";
import {
  type CheckpointStore,
  createAgent,
  createMemoryCheckpointStore,
  createMemoryLeaseStore,
  createMemorySessionStore,
  providerDone,
  providerTextDelta,
} from "@arnilo/prism";
import { createMessagingRuntime } from "../index.js";
import { createSignalAdapter, SIGNAL_CLI_VERSION, type SignalAdapterOptions } from "../signal.js";

// Sanitized signal-cli v0.14.8 `subscribeReceive` notification shape from its pinned JSON-RPC manual.
const SIGNAL_ACCOUNT = "+15550001111";
const SIGNAL_SENDER_UUID = "11111111-2222-4333-8444-555555555555";

function manualDirectMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    method: "receive",
    params: {
      subscription: 0,
      result: {
        account: SIGNAL_ACCOUNT,
        envelope: {
          sourceUuid: SIGNAL_SENDER_UUID,
          sourceDevice: 2,
          timestamp: 1693064367769,
          dataMessage: { timestamp: 1693064367769, message: "hello Prism", attachments: [] },
        },
      },
    },
    ...overrides,
  };
}

const CONNECTION = "signal-main";
const OWNER = { tenantId: "signal-service" };

type RpcRequest = { readonly id?: string; readonly method?: string; readonly params?: Record<string, unknown> };

class FakeSignalSocket extends Duplex {
  readonly requests: RpcRequest[] = [];

  constructor(private readonly handle: (request: RpcRequest, socket: FakeSignalSocket) => void = respondNormally) {
    super();
  }

  connect(): void {
    queueMicrotask(() => this.emit("connect"));
  }

  respond(response: Record<string, unknown>): void {
    this.push(Buffer.from(`${JSON.stringify(response)}\n`, "utf8"));
  }

  notify(message: Record<string, unknown>): void {
    this.respond(message);
  }

  _read(): void {}

  _write(chunk: Buffer, _: BufferEncoding, callback: (error?: Error | null) => void): void {
    for (const line of chunk.toString("utf8").trim().split("\n")) {
      if (line.length === 0) continue;
      const request = JSON.parse(line) as RpcRequest;
      this.requests.push(request);
      this.handle(request, this);
    }
    callback();
  }
}

function respondNormally(request: RpcRequest, socket: FakeSignalSocket): void {
  if (request.id === undefined) return;
  if (request.method === "subscribeReceive") socket.respond({ jsonrpc: "2.0", id: request.id, result: 0 });
  else if (request.method === "unsubscribeReceive") socket.respond({ jsonrpc: "2.0", id: request.id, result: 0 });
  else if (request.method === "send") socket.respond({ jsonrpc: "2.0", id: request.id, result: { timestamp: 123 } });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for Signal adapter");
}

function options(socket: FakeSignalSocket, overrides: Partial<SignalAdapterOptions> = {}): SignalAdapterOptions {
  return {
    connectionId: CONNECTION,
    socketPath: "/run/prism/signal.sock",
    account: SIGNAL_ACCOUNT,
    signalCliVersion: SIGNAL_CLI_VERSION,
    policy: { acceptableUse: "operator_approved", gplDistribution: "operator_approved", termsVersion: "current" },
    checkpoints: createMemoryCheckpointStore(),
    leases: createMemoryLeaseStore(),
    cursorOwnership: OWNER,
    connect: () => {
      socket.connect();
      return socket as never;
    },
    reconnectDelayMs: 1,
    maxReconnectDelayMs: 2,
    ...overrides,
  };
}

function mismatchedAccount(): Record<string, unknown> {
  const message = manualDirectMessage();
  const params = message.params as Record<string, unknown>;
  const result = params.result as Record<string, unknown>;
  result.account = "+15559990000";
  return message;
}

describe("plan 079 Signal adapter", () => {
  it("is inert until start and rejects a missing policy/version gate", () => {
    const socket = new FakeSignalSocket();
    let connections = 0;
    createSignalAdapter(
      options(socket, {
        connect: () => {
          connections += 1;
          return socket as never;
        },
      }),
    );
    assert.equal(connections, 0);
    assert.throws(() => createSignalAdapter(options(socket, { signalCliVersion: "0.14.7" as typeof SIGNAL_CLI_VERSION })), /0.14.8 only/);
    assert.throws(
      () =>
        createSignalAdapter(
          options(socket, { policy: { acceptableUse: "operator_approved", gplDistribution: "operator_approved", termsVersion: "" } }),
        ),
      /explicit operator policy/,
    );
  });

  it("routes a pinned manual-wrapper UUID DM through the runtime and sends only to that UUID", async () => {
    const socket = new FakeSignalSocket();
    const adapterOptions = options(socket);
    const adapter = createSignalAdapter(adapterOptions);
    const agent = createAgent({
      id: "signal-agent",
      model: { provider: "mock", model: "demo" },
      store: createMemorySessionStore(),
      provider: {
        id: "mock",
        async *generate() {
          yield providerTextDelta("final answer");
          yield providerDone();
        },
      },
    });
    const runtime = createMessagingRuntime({
      checkpoints: adapterOptions.checkpoints,
      leases: adapterOptions.leases,
      authorize: () => ({
        identity: {
          tenantId: "tenant-1",
          userId: "user-1",
          principal: { kind: "user", id: "user-1" },
          scopes: ["chat"],
          issuedAt: new Date(0).toISOString(),
          verified: true,
        },
        agentAliases: ["primary"],
        grantRevision: "grant-1",
      }),
      resolveAgent: () => agent,
      deliver: (reply) => adapter.send(reply),
    });

    await adapter.start((event) => runtime.admit(event));
    socket.notify(manualDirectMessage());
    await waitFor(() => socket.requests.some((request) => request.method === "send"));
    await runtime.drain();
    await adapter.stop();
    await runtime.stop();

    const sent = socket.requests.find((request) => request.method === "send");
    assert.deepEqual(sent?.params, { recipient: [SIGNAL_SENDER_UUID], message: "final answer" });
    assert.equal(adapter.capabilities.acknowledgement, "none");
  });

  it("filters groups, attachments, sync/receipt traffic, malformed wrappers, and unrelated RPC", async () => {
    const socket = new FakeSignalSocket();
    const adapter = createSignalAdapter(options(socket));
    const received: string[] = [];
    await adapter.start((event) => {
      received.push(event.text);
      return { status: "accepted" };
    });

    const group = manualDirectMessage();
    (((group.params as Record<string, unknown>).result as Record<string, unknown>).envelope as Record<string, unknown>).dataMessage = {
      message: "group",
      attachments: [],
      groupInfo: { groupId: "ignored" },
    };
    const attachment = manualDirectMessage();
    (
      (((attachment.params as Record<string, unknown>).result as Record<string, unknown>).envelope as Record<string, unknown>)
        .dataMessage as Record<string, unknown>
    ).attachments = [{}];
    socket.notify(group);
    socket.notify(attachment);
    socket.notify({
      jsonrpc: "2.0",
      method: "receive",
      params: { subscription: 0, result: { account: SIGNAL_ACCOUNT, envelope: { receiptMessage: {} } } },
    });
    socket.notify({ jsonrpc: "2.0", method: "send", params: {} });
    socket.notify(manualDirectMessage());
    await waitFor(() => received.length === 1);
    await adapter.stop();

    assert.deepEqual(received, ["hello Prism"]);
  });

  it("denies an account mismatch before admission and exposes a bounded health state", async () => {
    const socket = new FakeSignalSocket();
    const adapter = createSignalAdapter(options(socket));
    let calls = 0;
    await adapter.start(() => {
      calls += 1;
      return { status: "accepted" };
    });
    socket.notify(mismatchedAccount());
    await waitFor(() => adapter.health().account === "mismatch");
    await adapter.stop();

    assert.equal(calls, 0);
    assert.deepEqual(adapter.health(), { bridge: "unavailable", subscription: "inactive", account: "mismatch" });
  });

  it("pauses intake on storage/capacity failure and reconnects only after the bridge recovers", async () => {
    const first = new FakeSignalSocket();
    const second = new FakeSignalSocket();
    let connections = 0;
    const adapter = createSignalAdapter(
      options(first, {
        connect: () => {
          const socket = connections++ === 0 ? first : second;
          socket.connect();
          return socket as never;
        },
      }),
    );
    await adapter.start(() => ({ status: "denied", reason: "unavailable" }));
    first.notify(manualDirectMessage());
    await waitFor(() => connections === 2 && adapter.health().subscription === "active");
    await adapter.stop();

    assert.ok(second.requests.some((request) => request.method === "subscribeReceive"));
  });

  it("fails startup before subscription when the durable writer is unavailable", async () => {
    const socket = new FakeSignalSocket();
    const checkpoints = createMemoryCheckpointStore();
    const unavailable = new Proxy(checkpoints, {
      get(target, key, receiver) {
        if (key === "saveCheckpoint") return async () => Promise.reject(new Error("unavailable"));
        return Reflect.get(target, key, receiver);
      },
    }) as CheckpointStore;
    const adapter = createSignalAdapter(options(socket, { checkpoints: unavailable }));

    await assert.rejects(
      adapter.start(() => ({ status: "accepted" })),
      /Signal adapter start failed/,
    );
    assert.equal(socket.requests.length, 0);
  });

  it("reconnects after a subscribed bridge disconnect, but fails a disconnect before subscription", async () => {
    const first = new FakeSignalSocket();
    const second = new FakeSignalSocket();
    let connections = 0;
    const adapter = createSignalAdapter(
      options(first, {
        connect: () => {
          const socket = connections++ === 0 ? first : second;
          socket.connect();
          return socket as never;
        },
      }),
    );
    await adapter.start(() => ({ status: "accepted" }));
    first.destroy();
    await waitFor(() => connections === 2 && adapter.health().subscription === "active");
    await adapter.stop();

    const dropped = new FakeSignalSocket((request, socket) => {
      if (request.method === "subscribeReceive") socket.destroy();
    });
    const failing = createSignalAdapter(options(dropped));
    await assert.rejects(
      failing.start(() => ({ status: "accepted" })),
      /Signal adapter start failed/,
    );
  });

  it("drops an oversized frame and reconnects without admitting it", async () => {
    const first = new FakeSignalSocket();
    const second = new FakeSignalSocket();
    let connections = 0;
    const adapter = createSignalAdapter(
      options(first, {
        maxFrameBytes: 1024,
        connect: () => {
          const socket = connections++ === 0 ? first : second;
          socket.connect();
          return socket as never;
        },
      }),
    );
    let calls = 0;
    await adapter.start(() => {
      calls += 1;
      return { status: "accepted" };
    });
    const oversized = JSON.stringify({
      jsonrpc: "2.0",
      method: "receive",
      params: { subscription: 0, result: { pad: "x".repeat(2000) } },
    });
    assert.ok(Buffer.byteLength(oversized, "utf8") > 1024);
    first.push(Buffer.from(`${oversized}\n`, "utf8"));
    await waitFor(() => connections === 2 && adapter.health().subscription === "active");
    await adapter.stop();

    assert.equal(calls, 0);
  });

  it("survives a kill between receipt and commit without a second admission", async () => {
    const first = new FakeSignalSocket();
    const second = new FakeSignalSocket();
    let connections = 0;
    let releaseAdmission!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseAdmission = resolve;
    });
    let admissions = 0;
    const adapter = createSignalAdapter(
      options(first, {
        connect: () => {
          const socket = connections++ === 0 ? first : second;
          socket.connect();
          return socket as never;
        },
      }),
    );
    await adapter.start(async () => {
      admissions += 1;
      await gate;
      return { status: "accepted" };
    });
    first.notify(manualDirectMessage());
    await waitFor(() => admissions === 1);
    first.destroy();
    releaseAdmission();
    await waitFor(() => connections === 2 && adapter.health().subscription === "active");
    await adapter.stop();

    assert.equal(admissions, 1);
  });

  it("maps known daemon errors, refuses changed identities, and keeps transport loss ambiguous", async () => {
    for (const [detail, reason] of [
      ["rate limit", "signal_rate_limited"],
      ["CAPTCHA required", "signal_captcha_required"],
      ["relink required", "signal_relink_required"],
    ] as const) {
      const socket = new FakeSignalSocket((request, current) => {
        if (request.id !== undefined && request.method === "subscribeReceive")
          current.respond({ jsonrpc: "2.0", id: request.id, result: 0 });
        else if (request.id !== undefined && request.method === "send")
          current.respond({ jsonrpc: "2.0", id: request.id, error: { message: detail } });
        else respondNormally(request, current);
      });
      const adapter = createSignalAdapter(options(socket));
      await adapter.start(() => ({ status: "accepted" }));
      assert.deepEqual(
        await adapter.send({ connectionId: CONNECTION, externalConversationId: SIGNAL_SENDER_UUID, kind: "final", text: "x" }),
        {
          delivered: false,
          reason,
        },
      );
      await adapter.stop();
    }

    const identitySocket = new FakeSignalSocket((request, socket) => {
      if (request.id !== undefined && request.method === "subscribeReceive") socket.respond({ jsonrpc: "2.0", id: request.id, result: 0 });
      else if (request.id !== undefined && request.method === "send")
        socket.respond({ jsonrpc: "2.0", id: request.id, error: { message: "Untrusted identity key" } });
      else respondNormally(request, socket);
    });
    const identityAdapter = createSignalAdapter(options(identitySocket));
    await identityAdapter.start(() => ({ status: "accepted" }));
    assert.deepEqual(
      await identityAdapter.send({ connectionId: CONNECTION, externalConversationId: SIGNAL_SENDER_UUID, kind: "final", text: "x" }),
      {
        delivered: false,
        reason: "signal_identity_changed",
      },
    );
    assert.equal(identityAdapter.health().account, "identity_changed");
    await identityAdapter.stop();

    const lostSocket = new FakeSignalSocket((request, socket) => {
      if (request.id !== undefined && request.method === "subscribeReceive") socket.respond({ jsonrpc: "2.0", id: request.id, result: 0 });
      else if (request.method === "send") socket.destroy();
      else respondNormally(request, socket);
    });
    const lostAdapter = createSignalAdapter(options(lostSocket));
    await lostAdapter.start(() => ({ status: "accepted" }));
    await assert.rejects(
      lostAdapter.send({ connectionId: CONNECTION, externalConversationId: SIGNAL_SENDER_UUID, kind: "final", text: "x" }),
      /Signal delivery outcome unknown/,
    );
    await lostAdapter.stop();
  });

  it("renders only server-shaped approval controls as /approve and /deny commands", async () => {
    const socket = new FakeSignalSocket();
    const adapter = createSignalAdapter(options(socket));
    await adapter.start(() => ({ status: "accepted" }));
    const token = "a".repeat(43);
    assert.deepEqual(
      await adapter.send({
        connectionId: CONNECTION,
        externalConversationId: SIGNAL_SENDER_UUID,
        kind: "notice",
        text: "Approval required.",
        controls: [
          { label: "Allow once", value: `p:a:${token}` },
          { label: "Deny", value: `p:d:${token}` },
        ],
      }),
      { delivered: true, messageId: "123" },
    );
    await adapter.stop();

    const sent = socket.requests.find((request) => request.method === "send");
    assert.equal(
      String(sent?.params?.message),
      `Approval required.\n\nReply /approve ${token} to allow once.\nReply /deny ${token} to deny.`,
    );
  });
});
