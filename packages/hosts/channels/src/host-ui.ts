import { randomUUID } from "node:crypto";
import type { HostUi, HostUiRequest, HostUiRequestKind, HostUiResponse, OwnershipScope } from "@arnilo/prism";
import { createChannelUiRequestStore } from "./approvals.js";
import { ownershipFromIdentity } from "./identity.js";
import { createChannelPairingStore } from "./pairing.js";
import type { RuntimeCore } from "./runtime-core.js";
import type { RuntimeContext } from "./runtime-types.js";
import type {
  ChannelAdmission,
  ChannelConnectionHandle,
  ChannelInboundEvent,
  ChannelReply,
  ChannelReplyControl,
  ChannelReplyRecord,
  ChannelRuntime,
  ChannelSendResult,
} from "./types.js";

export interface ChannelHostUiOptions {
  readonly connection: ChannelConnectionHandle;
  /** `pair:<token>` for a pairing already consumed by the trusted host. */
  readonly chat: string;
  readonly ownership: OwnershipScope;
  readonly kinds?: readonly HostUiRequestKind[];
}

const unavailable = { status: "unavailable" } as const;
const bindings = new WeakMap<object, { service: ReturnType<typeof createChannelUi>; connectionId: string }>();
const runtimes = new WeakMap<ChannelRuntime, ReturnType<typeof createChannelUi>>();
const supported = ["confirm", "select", "input", "notify"];

export function channelHostUi(options: ChannelHostUiOptions): HostUi {
  const ownership = { ...options.ownership };
  const kinds = options.kinds && [...options.kinds];
  const { connection, chat } = options;
  return {
    async request<K extends HostUiRequestKind>(request: Extract<HostUiRequest, { kind: K }>): Promise<HostUiResponse<K>> {
      const bound = bindings.get(connection);
      if (!bound || !supported.includes(request.kind) || (kinds && !kinds.includes(request.kind))) return unavailable;
      try {
        return (await bound.service.request(bound.connectionId, chat, ownership, structuredClone(request))) as HostUiResponse<K>;
      } catch {
        return unavailable;
      }
    },
  };
}

/** Internal connection binding; only the library's constructed connections are accepted. */
export function bindChannelHostUi(connection: ChannelConnectionHandle, runtime: ChannelRuntime, connectionId: string): void {
  const service = runtimes.get(runtime);
  if (service) bindings.set(connection, { service, connectionId });
}

export function registerChannelHostUi(runtime: ChannelRuntime, ctx: RuntimeContext, core: RuntimeCore) {
  const service = createChannelUi(ctx, core);
  runtimes.set(runtime, service);
  return service;
}

function sameOwnership(a: OwnershipScope, b: OwnershipScope): boolean {
  return a.tenantId === b.tenantId && a.accountId === b.accountId && a.userId === b.userId;
}

function createChannelUi(ctx: RuntimeContext, core: RuntimeCore) {
  const store = ctx.options.checkpoints && createChannelUiRequestStore(ctx.options.checkpoints);
  const pairings = ctx.options.checkpoints && createChannelPairingStore({ checkpoints: ctx.options.checkpoints });
  const pending = new Map<
    string,
    {
      binding: string;
      token?: string;
      request: HostUiRequest;
      finish: (answer: HostUiResponse) => void;
    }
  >();
  const waiting = new Set<() => void>();
  let closed = false;

  async function send(ownership: OwnershipScope, reply: ChannelReply, requestId?: string): Promise<boolean> {
    if (closed || ctx.stopped || !ctx.replies || (requestId !== undefined && !pending.has(requestId))) return false;
    const now = new Date().toISOString();
    const operationId = `chan-ui-${randomUUID()}`;
    const key = { ownership, connectionId: reply.connectionId, operationId };
    const record: ChannelReplyRecord = { ...reply, operationId, state: "pending", attempts: 0, createdAt: now, updatedAt: now };
    const staged = await ctx.replies.stage(key, record);
    if (!staged || closed || ctx.stopped || (requestId !== undefined && !pending.has(requestId))) return false;
    let result: ChannelSendResult;
    try {
      result = await ctx.options.deliver(reply);
    } catch {
      await ctx.replies.mark(
        key,
        { ...record, state: "delivery_unknown", attempts: 1, updatedAt: new Date().toISOString() },
        staged.version,
      );
      ctx.counters.deliveryFailures++;
      return false;
    }
    const delivered = result.delivered;
    const marked = await ctx.replies.mark(
      key,
      {
        ...record,
        state: delivered ? "delivered" : "delivery_failed",
        attempts: 1,
        ...(result.messageId === undefined ? {} : { messageId: result.messageId }),
        updatedAt: new Date().toISOString(),
      },
      staged.version,
    );
    if (delivered) ctx.counters.deliveries++;
    else ctx.counters.deliveryFailures++;
    return delivered && marked !== null;
  }

  async function request(connectionId: string, chat: string, ownership: OwnershipScope, request: HostUiRequest): Promise<HostUiResponse> {
    if (closed || ctx.stopped || waiting.size >= ctx.limits.maxPendingPerProcess) return unavailable;
    const deadline = Date.now() + ctx.limits.approvalTtlMs;
    const requestId = randomUUID();
    let cancel = () => {};
    const cancelled = new Promise<HostUiResponse>((resolve) => {
      cancel = () => resolve(unavailable);
    });
    waiting.add(cancel);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        cancelled,
        offer(connectionId, chat, ownership, request, deadline, requestId),
        new Promise<HostUiResponse>((resolve) => {
          timer = setTimeout(() => resolve(unavailable), ctx.limits.approvalTtlMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      waiting.delete(cancel);
      pending.get(requestId)?.finish(unavailable);
    }
  }

  async function offer(
    connectionId: string,
    chat: string,
    ownership: OwnershipScope,
    request: HostUiRequest,
    deadline: number,
    requestId: string,
  ): Promise<HostUiResponse> {
    if (closed || ctx.stopped || !ctx.options.authorize || !store || !pairings || !/^pair:[A-Za-z0-9_-]{43}$/.test(chat))
      return unavailable;
    if (
      request.kind === "notify"
        ? typeof request.message !== "string"
        : !("title" in request) ||
          typeof request.title !== "string" ||
          ("detail" in request && request.detail !== undefined && typeof request.detail !== "string")
    )
      return unavailable;
    try {
      const pair = await pairings.resolve({ ...ownership, connectionId, token: chat.slice(5) });
      if (!pair || closed || ctx.stopped || Date.now() >= deadline) return unavailable;
      const event: ChannelInboundEvent = {
        connectionId,
        externalConversationId: pair.externalConversationId,
        externalActorId: pair.externalActorId,
        ...(pair.threadId === undefined ? {} : { threadId: pair.threadId }),
        eventId: `ui-${randomUUID()}`,
        text: "",
      };
      if (!core.validEvent(event)) return unavailable;
      const authorization = await core.authorizeEvent(event, "approval");
      if (
        "status" in authorization ||
        authorization.grantRevision !== pair.grantRevision ||
        !sameOwnership(ownership, ownershipFromIdentity(authorization.identity)) ||
        closed ||
        ctx.stopped ||
        Date.now() >= deadline
      )
        return unavailable;
      if (
        request.kind === "select" &&
        (!Array.isArray(request.options) ||
          request.options.length < 1 ||
          request.options.length > 8 ||
          (request.multiple !== undefined && typeof request.multiple !== "boolean") ||
          request.options.some((o) => !o || typeof o.value !== "string" || (o.label !== undefined && typeof o.label !== "string")) ||
          new Set(request.options.map((o) => o.value)).size !== request.options.length)
      )
        return unavailable;
      if (request.kind !== "notify" && request.kind !== "confirm" && request.kind !== "select" && request.kind !== "input")
        return unavailable;
      const binding = JSON.stringify([
        connectionId,
        ownership.tenantId,
        ownership.accountId,
        ownership.userId,
        pair.externalConversationId,
        pair.externalActorId,
        pair.threadId,
      ]);
      if (
        pending.size >= ctx.limits.maxPendingPerProcess ||
        [...pending.values()].filter((p) => p.binding === binding).length >= ctx.limits.maxPendingPerBinding
      )
        return unavailable;
      return await new Promise<HostUiResponse>((resolve) => {
        const finish = (answer: HostUiResponse) => {
          if (!pending.delete(requestId)) return;
          resolve(answer);
        };
        const waiter = { binding, request, finish, token: undefined as string | undefined };
        pending.set(requestId, waiter);
        const deliver = async () => {
          let token: string | undefined;
          if (request.kind !== "notify") {
            const created = await store.create({
              ownership,
              identity: authorization.identity,
              ...event,
              grantRevision: authorization.grantRevision,
              requestId,
              valueKind: request.kind,
              ttlMs: Math.max(1, deadline - Date.now()),
            });
            token = created.token;
            waiter.token = token;
          }
          if (!pending.has(requestId) || closed || ctx.stopped) return;
          let text =
            request.kind === "notify" ? request.message : [request.title, request.detail].filter((v) => v !== undefined).join("\n\n");
          let controls: ChannelReplyControl[] | undefined;
          if (request.kind === "confirm") controls = ["Yes", "No"].map((label, i) => ({ label, value: `q:${token}:${i}` }));
          if (request.kind === "select") {
            if (request.multiple)
              text += `\n\n${request.options.map((o, i) => `${i}: ${o.label ?? o.value}`).join("\n")}\nReply /answer ${token} <comma-separated indexes>`;
            else controls = request.options.map((o, i) => ({ label: o.label ?? o.value, value: `q:${token}:${i}` }));
          }
          if (request.kind === "input") text += `\n\nReply /answer ${token} <text>`;
          text = core.redact(text);
          controls = controls?.map((c) => ({ ...c, label: core.redact(c.label) }));
          // Both transports fit one message, including Signal's rendered reply commands.
          const rendered =
            text +
            (controls
              ? `\n\n${controls.map((c) => `Reply /answer ${c.value.split(":")[1]} ${c.value.split(":")[2]} (${c.label})`).join("\n")}`
              : "");
          if (
            typeof text !== "string" ||
            !text.length ||
            rendered.length > 2000 ||
            Buffer.byteLength(rendered) > ctx.limits.maxResponseBytes ||
            controls?.some((c) => !c.label.length || Buffer.byteLength(c.label) > 64)
          ) {
            finish(unavailable);
            return;
          }
          const delivered = await send(
            ownership,
            {
              connectionId,
              externalConversationId: pair.externalConversationId,
              ...(pair.threadId === undefined ? {} : { threadId: pair.threadId }),
              text,
              kind: "notice",
              ...(controls ? { controls } : {}),
            },
            requestId,
          );
          if (!delivered) finish(unavailable);
          else if (request.kind === "notify") finish({ status: "answered", value: undefined });
        };
        void deliver().catch(() => {
          ctx.counters.storageFailures++;
          finish(unavailable);
        });
      });
    } catch {
      ctx.counters.storageFailures++;
      return unavailable;
    }
  }

  async function admit(event: ChannelInboundEvent): Promise<ChannelAdmission | undefined> {
    if (!/^\/answer(?:\s|$)/.test(event.text)) return undefined;
    if (!ctx.options.authorize || !store) return core.denial("rejected");
    const authorization = await core.authorizeEvent(event, "approval");
    if ("status" in authorization) return authorization;
    const match = /^\/answer ([A-Za-z0-9_-]{43}) ([\s\S]*)$/.exec(event.text);
    if (!match) return core.denial("rejected");
    const [, token, value] = match;
    const ownership = ownershipFromIdentity(authorization.identity);
    try {
      const key = { ownership, connectionId: event.connectionId, token };
      const stored = await store.load(key);
      if (!stored) return core.denial("rejected");
      const r = stored.record;
      if (
        r.externalConversationId !== event.externalConversationId ||
        r.externalActorId !== event.externalActorId ||
        r.threadId !== event.threadId ||
        r.principalKind !== authorization.identity.principal.kind ||
        r.principalId !== authorization.identity.principal.id ||
        r.grantRevision !== authorization.grantRevision
      )
        return core.denial("rejected");
      const waiter = pending.get(r.requestId);
      const expired = async () => {
        await send(ownership, {
          connectionId: event.connectionId,
          externalConversationId: event.externalConversationId,
          ...(event.threadId === undefined ? {} : { threadId: event.threadId }),
          text: "This request has expired.",
          kind: "notice",
        });
        return { status: "accepted" } as const;
      };
      if (r.state !== "pending" || Date.parse(r.expiresAt) <= Date.now() || !waiter || waiter.token !== token) return await expired();
      const req = waiter.request;
      if (r.valueKind !== req.kind) return core.denial("rejected");
      let answer: HostUiResponse;
      if (req.kind === "input") answer = { status: "answered", value };
      else if (req.kind === "confirm" && /^[01]$/.test(value)) answer = { status: "answered", value: value === "0" };
      else if (req.kind === "select") {
        const parts = value.split(",");
        if (
          (!req.multiple && parts.length !== 1) ||
          parts.some((p) => !/^[0-7]$/.test(p) || Number(p) >= req.options.length) ||
          new Set(parts).size !== parts.length
        )
          return core.denial("rejected");
        const values = parts.map((p) => req.options[Number(p)].value);
        answer = { status: "answered", value: req.multiple ? values : values[0] };
      } else return core.denial("rejected");
      const consumed = await store.consume({ ...key, expectedVersion: stored.version });
      if (consumed !== "consumed" || pending.get(r.requestId) !== waiter || closed || ctx.stopped) return await expired();
      waiter.finish(answer);
      ctx.counters.admitted++;
      return { status: "accepted" };
    } catch {
      ctx.counters.storageFailures++;
      return core.denial("unavailable");
    }
  }

  return {
    request,
    admit,
    close() {
      closed = true;
      for (const cancel of waiting) cancel();
      for (const waiter of pending.values()) waiter.finish(unavailable);
    },
  };
}
