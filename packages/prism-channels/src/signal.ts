// Plan 079 Task 7: experimental signal-cli v0.14.8 Unix-socket adapter. Importing and
// construction are inert: hosts run and supervise signal-cli; this code only connects on start().
import { createHash, randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import type { CheckpointStore, LeaseRecord, LeaseStore, OwnershipScope } from "@arnilo/prism";
import { retryableAdmission } from "./admission.js";
import type { ChannelAdapter, ChannelInboundEvent, ChannelReceive, ChannelReply, ChannelSendResult } from "./types.js";

/** Only this externally operated signal-cli release's JSON-RPC shape is supported. */
export const SIGNAL_CLI_VERSION = "0.14.8";

const DEFAULT_FRAME_BYTES = 128 * 1024;
const HARD_FRAME_BYTES = 512 * 1024;
const DEFAULT_PENDING_REQUESTS = 16;
const HARD_PENDING_REQUESTS = 64;
const DEFAULT_PENDING_EVENTS = 32;
const HARD_PENDING_EVENTS = 128;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000;
const DEFAULT_LEASE_TTL_MS = 90_000;
const SIGNAL_TEXT_CODE_UNITS = 2_000;
const RECEIVER_LEASE_NAMESPACE = "prism.channels.v1.signal.receiver";
const RECEIVER_READY_NAMESPACE = "prism.channels.v1.signal.receiver";
const RECEIVER_KEY_PREFIX = "r1:";
const SERVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Explicit host attestation; Prism does not decide Signal acceptable use or GPL obligations. */
export interface SignalPolicyGate {
  readonly acceptableUse: "operator_approved";
  readonly gplDistribution: "operator_approved";
  /** Host's recorded current Signal Terms version/date; revisiting it is an operator obligation. */
  readonly termsVersion: string;
}

export interface SignalAdapterOptions {
  /** Stable host-selected connection id; never read from Signal input. */
  readonly connectionId: string;
  /** Absolute, host-selected private Unix socket path; TCP and HTTP bridges are unsupported. */
  readonly socketPath: string;
  /** Account selected by the externally supervised signal-cli daemon. */
  readonly account: string;
  /** Must be the adapter's fixed compatibility target, `SIGNAL_CLI_VERSION`. */
  readonly signalCliVersion: typeof SIGNAL_CLI_VERSION;
  /** Explicit operator policy/license gate; construction rejects a missing or malformed attestation. */
  readonly policy: SignalPolicyGate;
  /** Probed before subscription so unavailable durable storage prevents receipt. */
  readonly checkpoints: CheckpointStore;
  /** Service-owned receiver lease; one subscriber per connection. */
  readonly leases: LeaseStore;
  readonly cursorOwnership: OwnershipScope;
  /** Set only for a signal-cli daemon started without `-a`; RPCs then include the configured account. */
  readonly multiAccount?: boolean;
  /** Test seam. Defaults to Node's `createConnection(socketPath)`. */
  readonly connect?: (socketPath: string) => Socket;
  readonly maxFrameBytes?: number;
  readonly maxPendingRequests?: number;
  readonly maxPendingEvents?: number;
  readonly requestTimeoutMs?: number;
  readonly reconnectDelayMs?: number;
  readonly maxReconnectDelayMs?: number;
  readonly leaseTtlMs?: number;
}

export interface SignalAdapterHealth {
  readonly bridge: "unavailable" | "connected";
  readonly subscription: "inactive" | "active" | "paused";
  readonly account: "unverified" | "ready" | "mismatch" | "identity_changed";
}

/** Channel adapter plus bounded, payload-free bridge/subscription/account status. */
export type SignalAdapter = ChannelAdapter & { health(): SignalAdapterHealth };

type Pending = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

class SignalRpcError extends Error {
  constructor(readonly detail: string) {
    super("Signal RPC request failed");
    this.name = "SignalRpcError";
  }
}

class SignalTransportError extends Error {
  constructor() {
    super("Signal bridge unavailable");
    this.name = "SignalTransportError";
  }
}

class SignalDeliveryUnknownError extends Error {
  constructor() {
    super("Signal delivery outcome unknown");
    this.name = "SignalDeliveryUnknownError";
  }
}

class SignalLineReader {
  private buffer = Buffer.alloc(0);

  constructor(private readonly maxFrameBytes: number) {}

  push(chunk: Buffer): unknown[] {
    if (chunk.byteLength > this.maxFrameBytes || this.buffer.byteLength + chunk.byteLength > this.maxFrameBytes + 1) {
      throw new RangeError("Signal JSON-RPC frame exceeds maxFrameBytes");
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    for (;;) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline < 0) break;
      const line = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      if (line.byteLength === 0) continue;
      if (line.byteLength > this.maxFrameBytes) throw new RangeError("Signal JSON-RPC frame exceeds maxFrameBytes");
      try {
        messages.push(JSON.parse(line.subarray(0, line.byteLength > 0 && line.at(-1) === 0x0d ? -1 : undefined).toString("utf8")));
      } catch {
        throw new TypeError("Signal JSON-RPC frame is malformed");
      }
    }
    return messages;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function bounded(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new TypeError(`Signal ${name} must be an integer between ${min} and ${max}`);
  }
  return resolved;
}

function scope(ownership: OwnershipScope): OwnershipScope {
  return {
    ...(ownership.tenantId === undefined ? {} : { tenantId: ownership.tenantId }),
    ...(ownership.accountId === undefined ? {} : { accountId: ownership.accountId }),
    ...(ownership.userId === undefined ? {} : { userId: ownership.userId }),
  };
}

function receiverKey(connectionId: string): string {
  return `${RECEIVER_KEY_PREFIX}${connectionId}`;
}

function rpcId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function serviceId(value: unknown): string | undefined {
  return typeof value === "string" && SERVICE_ID.test(value) ? value.toLowerCase() : undefined;
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const point of text) {
    if (chunk.length > 0 && chunk.length + point.length > SIGNAL_TEXT_CODE_UNITS) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += point;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

function approvalText(controls: ChannelReply["controls"]): string | undefined {
  if (controls === undefined) return undefined;
  if (controls.length === 0 || controls.length > 2) return undefined;
  const commands: string[] = [];
  for (const control of controls) {
    const match = /^p:([ad]):([A-Za-z0-9_-]{32,64})$/.exec(control.value);
    if (match === null || match[1] === undefined || match[2] === undefined) return undefined;
    commands.push(match[1] === "a" ? `Reply /approve ${match[2]} to allow once.` : `Reply /deny ${match[2]} to deny.`);
  }
  return commands.join("\n");
}

function replyChunks(reply: ChannelReply): string[] | undefined {
  const controls = approvalText(reply.controls);
  if (reply.controls !== undefined && controls === undefined) return undefined;
  const chunks = chunkText(reply.text);
  if (controls === undefined) return chunks;
  if (chunks.length === 0) return chunkText(controls);
  const last = chunks.length - 1;
  const combined = `${chunks[last]}\n\n${controls}`;
  if (combined.length <= SIGNAL_TEXT_CODE_UNITS) {
    chunks[last] = combined;
  } else {
    chunks.push(...chunkText(controls));
  }
  return chunks;
}

function rpcFailureReason(
  error: SignalRpcError,
): "signal_rate_limited" | "signal_captcha_required" | "signal_relink_required" | "signal_identity_changed" | "signal_rpc_error" {
  const detail = error.detail.toLowerCase();
  if (detail.includes("captcha")) return "signal_captcha_required";
  if (detail.includes("rate") || detail.includes("429")) return "signal_rate_limited";
  if (detail.includes("untrusted identity") || detail.includes("identity key")) return "signal_identity_changed";
  if (detail.includes("relink") || detail.includes("unregistered")) return "signal_relink_required";
  return "signal_rpc_error";
}

function notificationEvent(
  value: unknown,
  connectionId: string,
  account: string,
  subscription: number | undefined,
): ChannelInboundEvent | "account_mismatch" | undefined {
  const message = asRecord(value);
  if (message?.jsonrpc !== "2.0" || message.method !== "receive") return undefined;
  const params = asRecord(message.params);
  const result = params === undefined ? undefined : asRecord(params.result);
  if (result === undefined || integer(params?.subscription) !== subscription) return undefined;
  if (result.account !== account) return "account_mismatch";
  const envelope = asRecord(result.envelope);
  const actorId = serviceId(envelope?.sourceUuid);
  const timestamp = integer(envelope?.timestamp);
  const sourceDevice = integer(envelope?.sourceDevice);
  const dataMessage = asRecord(envelope?.dataMessage);
  if (
    actorId === undefined ||
    timestamp === undefined ||
    sourceDevice === undefined ||
    dataMessage === undefined ||
    typeof dataMessage.message !== "string" ||
    dataMessage.groupInfo !== undefined ||
    (dataMessage.attachments !== undefined && (!Array.isArray(dataMessage.attachments) || dataMessage.attachments.length > 0))
  ) {
    return undefined;
  }
  const eventId = createHash("sha256")
    .update(
      `${connectionId}\u0000${account}\u0000${actorId}\u0000${sourceDevice}\u0000${timestamp}\u0000${integer(dataMessage.timestamp) ?? timestamp}`,
    )
    .digest("base64url");
  return {
    connectionId,
    externalConversationId: actorId,
    externalActorId: actorId,
    eventId,
    text: dataMessage.message,
    receivedAt: new Date().toISOString(),
    claims: { platform: "signal", messageType: "direct_text" },
  };
}

function validateOptions(options: SignalAdapterOptions): void {
  if (
    typeof options.connectionId !== "string" ||
    options.connectionId.length === 0 ||
    Buffer.byteLength(options.connectionId, "utf8") > 256
  ) {
    throw new TypeError("Signal connectionId must be a bounded non-empty string");
  }
  if (
    typeof options.socketPath !== "string" ||
    !options.socketPath.startsWith("/") ||
    options.socketPath.includes("\0") ||
    Buffer.byteLength(options.socketPath, "utf8") > 1024
  ) {
    throw new TypeError("Signal socketPath must be a bounded absolute Unix socket path");
  }
  if (typeof options.account !== "string" || options.account.length === 0 || Buffer.byteLength(options.account, "utf8") > 128) {
    throw new TypeError("Signal account must be a bounded non-empty string");
  }
  if (options.signalCliVersion !== SIGNAL_CLI_VERSION) throw new TypeError(`Signal adapter supports signal-cli ${SIGNAL_CLI_VERSION} only`);
  if (
    options.policy?.acceptableUse !== "operator_approved" ||
    options.policy.gplDistribution !== "operator_approved" ||
    typeof options.policy.termsVersion !== "string" ||
    !/^\S{1,64}$/.test(options.policy.termsVersion)
  ) {
    throw new TypeError("Signal requires an explicit operator policy and GPL attestation");
  }
}

/**
 * Creates a Node-only adapter for an externally supervised, manual-receive signal-cli v0.14.8
 * Unix socket. It exposes only subscribe/unsubscribe/send JSON-RPC methods and never spawns,
 * registers, links, trusts identities, or opens a TCP/HTTP bridge.
 */
export function createSignalAdapter(options: SignalAdapterOptions): SignalAdapter {
  validateOptions(options);
  const maxFrameBytes = bounded(options.maxFrameBytes, DEFAULT_FRAME_BYTES, 1024, HARD_FRAME_BYTES, "maxFrameBytes");
  const maxPendingRequests = bounded(options.maxPendingRequests, DEFAULT_PENDING_REQUESTS, 1, HARD_PENDING_REQUESTS, "maxPendingRequests");
  const maxPendingEvents = bounded(options.maxPendingEvents, DEFAULT_PENDING_EVENTS, 1, HARD_PENDING_EVENTS, "maxPendingEvents");
  const requestTimeoutMs = bounded(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 100, 60_000, "requestTimeoutMs");
  const reconnectDelayMs = bounded(options.reconnectDelayMs, DEFAULT_RECONNECT_DELAY_MS, 1, 60_000, "reconnectDelayMs");
  const maxReconnectDelayMs = bounded(
    options.maxReconnectDelayMs,
    DEFAULT_MAX_RECONNECT_DELAY_MS,
    reconnectDelayMs,
    60_000,
    "maxReconnectDelayMs",
  );
  const leaseTtlMs = bounded(options.leaseTtlMs, DEFAULT_LEASE_TTL_MS, 5_000, 300_000, "leaseTtlMs");
  const ownerId = `signal-receiver-${randomUUID()}`;
  const connect = options.connect ?? ((socketPath: string) => createConnection(socketPath));
  const pending = new Map<string, Pending>();
  let health: SignalAdapterHealth = { bridge: "unavailable", subscription: "inactive", account: "unverified" };
  let socket: Socket | undefined;
  let lease: LeaseRecord | undefined;
  let controller: AbortController | undefined;
  let renewTimer: ReturnType<typeof setInterval> | undefined;
  let reconnecting: Promise<void> | undefined;
  let receive: ChannelReceive | undefined;
  let subscription: number | undefined;
  let accepting = false;
  let queuedEvents = 0;
  let nextRequestId = 0;
  let stopped = false;

  function setHealth(next: Partial<SignalAdapterHealth>): void {
    health = { ...health, ...next };
  }

  function rejectPending(error: Error): void {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  }

  function rpcParams(params: Record<string, unknown>): Record<string, unknown> {
    return options.multiAccount ? { account: options.account, ...params } : params;
  }

  function write(payload: Record<string, unknown>): void {
    const current = socket;
    const frame = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
    if (current === undefined || current.destroyed || !current.writable) throw new SignalTransportError();
    if (frame.byteLength > maxFrameBytes) throw new RangeError("Signal JSON-RPC request exceeds maxFrameBytes");
    try {
      current.write(frame);
    } catch {
      throw new SignalTransportError();
    }
  }

  function notify(method: "unsubscribeReceive", params: Record<string, unknown>): void {
    write({ jsonrpc: "2.0", method, params: rpcParams(params) });
  }

  function request(method: "subscribeReceive" | "unsubscribeReceive" | "send", params: Record<string, unknown>): Promise<unknown> {
    if (pending.size >= maxPendingRequests)
      return Promise.reject(new RangeError("Signal pending JSON-RPC requests exceed maxPendingRequests"));
    const id = `p${++nextRequestId}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new SignalTransportError());
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        write({ jsonrpc: "2.0", id, method, params: rpcParams(params) });
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new SignalTransportError());
      }
    });
  }

  async function probeWriter(): Promise<void> {
    const current = await options.checkpoints.loadCheckpoint({
      namespace: RECEIVER_READY_NAMESPACE,
      key: receiverKey(options.connectionId),
      ...scope(options.cursorOwnership),
    });
    await options.checkpoints.saveCheckpoint({
      namespace: RECEIVER_READY_NAMESPACE,
      key: receiverKey(options.connectionId),
      ...scope(options.cursorOwnership),
      category: "channel-signal-receiver",
      expectedVersion: current?.version ?? 0,
      version: (current?.version ?? 0) + 1,
      value: { schema: 1, updatedAt: new Date().toISOString() },
    });
  }

  async function renew(): Promise<void> {
    const current = lease;
    const signal = controller?.signal;
    if (current === undefined || signal === undefined || signal.aborted) return;
    try {
      const renewed = await options.leases.renewLease({
        namespace: RECEIVER_LEASE_NAMESPACE,
        key: receiverKey(options.connectionId),
        ...scope(options.cursorOwnership),
        ownerId,
        token: current.token,
        ttlMs: leaseTtlMs,
        signal,
      });
      if (renewed === null) throw new Error("lease lost");
      lease = renewed;
    } catch {
      accepting = false;
      setHealth({ bridge: "unavailable", subscription: "paused" });
      controller?.abort(new Error("Signal receiver lease lost"));
    }
  }

  async function release(): Promise<void> {
    const current = lease;
    lease = undefined;
    if (current === undefined) return;
    try {
      await options.leases.releaseLease({
        namespace: RECEIVER_LEASE_NAMESPACE,
        key: receiverKey(options.connectionId),
        ...scope(options.cursorOwnership),
        ownerId,
        token: current.token,
      });
    } catch {
      // A lease expiry/release failure cannot make this process the receiver again.
    }
  }

  function pause(forAccountMismatch = false): void {
    if (!accepting && health.subscription === "paused") return;
    accepting = false;
    const currentSubscription = subscription;
    subscription = undefined;
    setHealth({ subscription: "paused", ...(forAccountMismatch ? { account: "mismatch" as const } : {}) });
    if (currentSubscription !== undefined) {
      try {
        notify("unsubscribeReceive", { subscription: currentSubscription });
      } catch {
        // Closing the socket removes this subscriber even when the unsubscribe write was ambiguous.
      }
    }
    socket?.destroy();
    if (!forAccountMismatch && receive !== undefined) startReconnect();
  }

  function enqueueNotification(message: unknown): void {
    const event = notificationEvent(message, options.connectionId, options.account, subscription);
    if (event === "account_mismatch") {
      pause(true);
      return;
    }
    if (event === undefined || !accepting || receive === undefined) return;
    if (queuedEvents >= maxPendingEvents) {
      pause();
      return;
    }
    const receiver = receive;
    queuedEvents += 1;
    void Promise.resolve()
      .then(async () => {
        if (!accepting) return;
        const admission = await receiver(event);
        if (retryableAdmission(admission)) pause();
      })
      .catch(() => pause())
      .finally(() => {
        queuedEvents -= 1;
      });
  }

  function handleMessage(message: unknown): void {
    const response = asRecord(message);
    if (response?.jsonrpc !== "2.0") throw new TypeError("Signal JSON-RPC response is malformed");
    const id = rpcId(response.id);
    if (id !== undefined) {
      const entry = pending.get(id);
      if (entry === undefined) return;
      pending.delete(id);
      clearTimeout(entry.timer);
      const error = asRecord(response.error);
      if (error !== undefined) {
        entry.reject(new SignalRpcError(typeof error.message === "string" ? error.message.slice(0, 256) : "rpc error"));
      } else {
        entry.resolve(response.result);
      }
      return;
    }
    if (response.method === "receive") enqueueNotification(response);
  }

  function startReconnect(): void {
    if (reconnecting !== undefined || stopped || controller?.signal.aborted) return;
    reconnecting = (async () => {
      let delayMs = reconnectDelayMs;
      while (!stopped && !controller?.signal.aborted) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        if (stopped || controller?.signal.aborted) return;
        try {
          await probeWriter();
          await open();
          return;
        } catch {
          delayMs = Math.min(maxReconnectDelayMs, delayMs * 2);
        }
      }
    })().finally(() => {
      reconnecting = undefined;
    });
  }

  async function open(): Promise<void> {
    const signal = controller?.signal;
    if (signal === undefined || signal.aborted) throw new SignalTransportError();
    const current = await new Promise<Socket>((resolve, reject) => {
      let candidate: Socket;
      try {
        candidate = connect(options.socketPath);
      } catch {
        reject(new SignalTransportError());
        return;
      }
      const cleanup = () => {
        candidate.removeListener("connect", onConnect);
        candidate.removeListener("error", onError);
      };
      const onConnect = () => {
        cleanup();
        resolve(candidate);
      };
      const onError = () => {
        cleanup();
        candidate.destroy();
        reject(new SignalTransportError());
      };
      candidate.once("connect", onConnect);
      candidate.once("error", onError);
      signal.addEventListener(
        "abort",
        () => {
          cleanup();
          candidate.destroy();
          reject(new SignalTransportError());
        },
        { once: true },
      );
    });
    if (signal.aborted) {
      current.destroy();
      throw new SignalTransportError();
    }
    const reader = new SignalLineReader(maxFrameBytes);
    socket = current;
    setHealth({ bridge: "connected", subscription: "inactive" });
    const disconnect = () => {
      if (socket !== current) return;
      const paused = health.subscription === "paused";
      const wasSubscribed = subscription !== undefined;
      socket = undefined;
      accepting = false;
      subscription = undefined;
      setHealth({ bridge: "unavailable", subscription: paused ? "paused" : "inactive" });
      rejectPending(new SignalTransportError());
      if (wasSubscribed && !paused && !stopped && !signal.aborted && receive !== undefined) startReconnect();
    };
    current.on("data", (chunk: Buffer) => {
      try {
        for (const message of reader.push(Buffer.from(chunk))) handleMessage(message);
      } catch {
        current.destroy();
      }
    });
    current.on("error", () => {
      current.destroy();
      disconnect();
    });
    current.on("close", disconnect);
    try {
      const subscribed = integer(await request("subscribeReceive", {}));
      if (subscribed === undefined) throw new TypeError("Signal subscription response is malformed");
      subscription = subscribed;
      accepting = true;
      setHealth({ subscription: "active", account: "ready" });
    } catch (error) {
      current.destroy();
      throw error;
    }
  }

  return {
    connectionId: options.connectionId,
    capabilities: { acknowledgement: "none", controls: "command", maxTextCodeUnits: SIGNAL_TEXT_CODE_UNITS },
    health: () => ({ ...health }),
    async start(receiver) {
      if (stopped) throw new Error("Signal adapter is stopped");
      if (controller !== undefined) throw new Error("Signal adapter is already started");
      controller = new AbortController();
      receive = receiver;
      try {
        const acquired = await options.leases.tryAcquireLease({
          namespace: RECEIVER_LEASE_NAMESPACE,
          key: receiverKey(options.connectionId),
          ...scope(options.cursorOwnership),
          ownerId,
          ttlMs: leaseTtlMs,
          signal: controller.signal,
        });
        if (acquired === null) throw new Error("Signal receiver is already active");
        lease = acquired;
        await probeWriter();
        await open();
        renewTimer = setInterval(() => void renew(), Math.max(1_000, Math.floor(leaseTtlMs / 2)));
        renewTimer.unref?.();
      } catch (error) {
        controller.abort();
        controller = undefined;
        receive = undefined;
        await release();
        throw error instanceof Error && error.message === "Signal receiver is already active"
          ? error
          : new Error("Signal adapter start failed");
      }
    },
    async send(reply): Promise<ChannelSendResult> {
      if (reply.connectionId !== options.connectionId || serviceId(reply.externalConversationId) === undefined) {
        return { delivered: false, reason: "invalid_destination" };
      }
      if (health.account === "mismatch") return { delivered: false, reason: "signal_account_mismatch" };
      if (health.account === "identity_changed") return { delivered: false, reason: "signal_identity_changed" };
      const chunks = replyChunks(reply);
      if (chunks === undefined) return { delivered: false, reason: "invalid_controls" };
      if (chunks.length === 0) return { delivered: false, reason: "empty_reply" };
      if (socket === undefined) return { delivered: false, reason: "signal_unavailable" };
      let messageId: string | undefined;
      let sent = false;
      try {
        for (const message of chunks) {
          const result = asRecord(await request("send", { recipient: [reply.externalConversationId], message }));
          const timestamp = integer(result?.timestamp);
          if (timestamp !== undefined) messageId = String(timestamp);
          sent = true;
        }
        return { delivered: true, ...(messageId === undefined ? {} : { messageId }) };
      } catch (error) {
        if (error instanceof SignalRpcError && !sent) {
          const reason = rpcFailureReason(error);
          if (reason === "signal_identity_changed") setHealth({ account: "identity_changed" });
          return { delivered: false, reason };
        }
        throw new SignalDeliveryUnknownError();
      }
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(renewTimer);
      renewTimer = undefined;
      accepting = false;
      const currentSubscription = subscription;
      subscription = undefined;
      if (currentSubscription !== undefined && socket !== undefined) {
        try {
          await request("unsubscribeReceive", { subscription: currentSubscription });
        } catch {
          // Socket closure makes an unconfirmed unsubscribe non-delivery explicit, not retried.
        }
      }
      controller?.abort(new Error("Signal adapter stopped"));
      socket?.destroy();
      socket = undefined;
      rejectPending(new SignalTransportError());
      await reconnecting;
      await release();
      setHealth({ bridge: "unavailable", subscription: "inactive" });
    },
  };
}
