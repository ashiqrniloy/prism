import { createHash } from "node:crypto";
import { type AgentIdentity, assertIdentityActive, type OwnershipScope } from "@arnilo/prism";
import type { ChannelReplyKeyInput } from "./delivery.js";
import {
  MAX_ATTACHMENT_META_BYTES,
  MAX_ATTACHMENT_REFS,
  MAX_ID_BYTES,
  type RouteState,
  type RuntimeContext,
  TRUNCATION_MARKER,
  type Turn,
} from "./runtime-types.js";
import {
  CHANNEL_JOURNAL_NAMESPACES,
  type ChannelBindingKeyInput,
  type ChannelBindingRecord,
  type ChannelOperationKeyInput,
  type StoredChannelRecord,
} from "./state.js";
import type {
  ChannelAction,
  ChannelAdmission,
  ChannelAttachmentRef,
  ChannelAuthorization,
  ChannelAuthorizeInput,
  ChannelBinding,
  ChannelBindingInput,
  ChannelDenialReason,
  ChannelInboundEvent,
  ChannelOperationRecord,
  ChannelOperationState,
  ChannelUnsupportedReason,
} from "./types.js";

export function createRuntimeCore(ctx: RuntimeContext) {
  const { counters, currentAliases, inflight, journal, leaseOwnerId, limits, options, redactor, routes, seenEvents, slotWaiters } = ctx;
  function key(parts: readonly (string | undefined)[]): string {
    return parts.map((part) => part ?? "").join("\u0000");
  }

  function actorKey(event: ChannelInboundEvent): string {
    return key([event.connectionId, event.externalConversationId, event.threadId, event.externalActorId]);
  }

  function nowIso(): string {
    return new Date().toISOString();
  }

  function boundText(text: string, maxBytes: number): string {
    if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
    counters.truncated += 1;
    const head = Buffer.from(text, "utf8")
      .subarray(0, Math.max(0, maxBytes - Buffer.byteLength(TRUNCATION_MARKER, "utf8")))
      .toString("utf8")
      .replace(/\uFFFD*$/, "");
    return `${head}${TRUNCATION_MARKER}`;
  }

  function redact(text: string): string {
    return redactor === undefined ? text : redactor.redact(text);
  }

  function denial(reason: ChannelDenialReason): ChannelAdmission {
    counters.denied += 1;
    return { status: "denied", reason };
  }

  function unsupported(reason: ChannelUnsupportedReason): ChannelAdmission {
    counters.unsupported += 1;
    return { status: "unsupported", reason };
  }

  function identityActive(identity: AgentIdentity): boolean {
    try {
      assertIdentityActive(identity);
      return true;
    } catch {
      return false;
    }
  }

  function validEvent(event: ChannelInboundEvent): boolean {
    for (const value of [event.connectionId, event.externalConversationId, event.externalActorId, event.eventId]) {
      if (typeof value !== "string" || value.length === 0) return false;
    }
    if (typeof event.text !== "string") return false;
    if (
      event.approval !== undefined &&
      (typeof event.approval.token !== "string" ||
        !/^[A-Za-z0-9_-]{32,64}$/.test(event.approval.token) ||
        (event.approval.outcome !== "allow_once" && event.approval.outcome !== "reject_once"))
    ) {
      return false;
    }
    if (event.threadId !== undefined && typeof event.threadId !== "string") return false;
    if (event.attachments !== undefined && !validAttachments(event.attachments)) return false;
    const ids = [event.connectionId, event.externalConversationId, event.externalActorId, event.eventId, event.threadId];
    return ids.every((value) => value === undefined || Buffer.byteLength(value, "utf8") <= MAX_ID_BYTES);
  }

  /** Sum of transport-declared attachment sizes; the adapter still bounds the actual body it reads. */
  function declaredAttachmentBytes(event: ChannelInboundEvent): number {
    let total = 0;
    for (const ref of event.attachments ?? []) total += ref.byteLength ?? 0;
    return total;
  }

  /** Attachment *references* only: bounded count, bounded metadata, no bytes and no URLs. */
  function validAttachments(attachments: readonly ChannelAttachmentRef[]): boolean {
    if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENT_REFS) return false;
    return attachments.every((ref) => {
      if (ref === null || typeof ref !== "object") return false;
      if (ref.kind !== "image" && ref.kind !== "document" && ref.kind !== "voice") return false;
      if (typeof ref.transportFileId !== "string" || ref.transportFileId.length === 0) return false;
      if (Buffer.byteLength(ref.transportFileId, "utf8") > MAX_ID_BYTES) return false;
      if (
        ref.mimeType !== undefined &&
        (typeof ref.mimeType !== "string" || Buffer.byteLength(ref.mimeType, "utf8") > MAX_ATTACHMENT_META_BYTES)
      ) {
        return false;
      }
      if (
        ref.fileName !== undefined &&
        (typeof ref.fileName !== "string" || Buffer.byteLength(ref.fileName, "utf8") > MAX_ATTACHMENT_META_BYTES)
      ) {
        return false;
      }
      return ref.byteLength === undefined || (Number.isSafeInteger(ref.byteLength) && ref.byteLength >= 0);
    });
  }

  async function authorizeEvent(event: ChannelInboundEvent, action: ChannelAction): Promise<ChannelAuthorization | ChannelAdmission> {
    const input: ChannelAuthorizeInput = {
      connectionId: event.connectionId,
      externalConversationId: event.externalConversationId,
      externalActorId: event.externalActorId,
      eventId: event.eventId,
      text: event.text,
      action,
      ...(event.threadId === undefined ? {} : { threadId: event.threadId }),
      receivedAt: event.receivedAt ?? new Date().toISOString(),
      ...(event.claims === undefined ? {} : { claims: event.claims }),
    };
    let result: ChannelAuthorization | false | undefined;
    try {
      result = await options.authorize(input);
    } catch {
      return denial("authorization_failed");
    }
    if (!result || result.identity === undefined) return denial("rejected");
    if (!identityActive(result.identity)) return denial("revoked");
    if (!Array.isArray(result.agentAliases) || result.agentAliases.length === 0) return denial("rejected");
    if (typeof result.grantRevision !== "string" || result.grantRevision.length === 0) return denial("rejected");
    return result;
  }

  function recentEvents(connectionId: string): { ids: Set<string>; order: string[] } {
    let entry = seenEvents.get(connectionId);
    if (!entry) {
      if (seenEvents.size >= limits.maxRoutes) return { ids: new Set(), order: [] };
      entry = { ids: new Set(), order: [] };
      seenEvents.set(connectionId, entry);
    }
    return entry;
  }

  function alreadySeen(event: ChannelInboundEvent): boolean {
    const entry = recentEvents(event.connectionId);
    if (entry.ids.has(event.eventId)) return true;
    entry.ids.add(event.eventId);
    entry.order.push(event.eventId);
    while (entry.order.length > limits.maxSeenEventsPerConnection) {
      const oldest = entry.order.shift();
      if (oldest !== undefined) entry.ids.delete(oldest);
    }
    return false;
  }

  function pendingCount(): number {
    let pending = 0;
    for (const route of routes.values()) pending += route.queue.length;
    return pending;
  }

  function resolveAlias(event: ChannelInboundEvent, authorization: ChannelAuthorization): string | undefined {
    const actor = actorKey(event);
    const selected = currentAliases.get(actor);
    if (selected !== undefined && authorization.agentAliases.includes(selected)) return selected;
    const fallback = authorization.defaultAgentAlias ?? authorization.agentAliases[0];
    return fallback !== undefined && authorization.agentAliases.includes(fallback) ? fallback : undefined;
  }

  function ensureRoute(event: ChannelInboundEvent, alias: string): RouteState | undefined {
    const routeKey = key([actorKey(event), alias]);
    const existing = routes.get(routeKey);
    if (existing) return existing;
    if (routes.size >= limits.maxRoutes) return undefined;
    const created: RouteState = {
      connectionId: event.connectionId,
      externalConversationId: event.externalConversationId,
      externalActorId: event.externalActorId,
      ...(event.threadId === undefined ? {} : { threadId: event.threadId }),
      alias,
      generation: 0,
      suspended: false,
      resuming: false,
      pumping: false,
      hydrated: false,
      queue: [],
    };
    routes.set(routeKey, created);
    currentAliases.set(actorKey(event), alias);
    return created;
  }

  /** Lookup only: `/status` and `/cancel` from a fresh actor must not allocate a route. */
  function findRoute(event: ChannelInboundEvent, alias: string): RouteState | undefined {
    return routes.get(key([actorKey(event), alias]));
  }

  function bindingInputFor(route: RouteState, turn: Turn, generation: number = route.generation): ChannelBindingInput {
    return {
      connectionId: route.connectionId,
      externalConversationId: route.externalConversationId,
      externalActorId: route.externalActorId,
      ...(route.threadId === undefined ? {} : { threadId: route.threadId }),
      identity: turn.authorization.identity,
      ownership: turn.ownership,
      agentAlias: route.alias,
      generation,
    };
  }

  function bindingKeyFor(route: RouteState, ownership: OwnershipScope): ChannelBindingKeyInput {
    return {
      ownership,
      connectionId: route.connectionId,
      externalConversationId: route.externalConversationId,
      externalActorId: route.externalActorId,
      ...(route.threadId === undefined ? {} : { threadId: route.threadId }),
      agentAlias: route.alias,
    };
  }

  function operationKeyFor(ownership: OwnershipScope, event: ChannelInboundEvent, operationId: string): ChannelOperationKeyInput {
    return { ownership, connectionId: event.connectionId, operationId };
  }

  function operationKeyForTurn(turn: Turn): ChannelOperationKeyInput {
    return operationKeyFor(turn.ownership, turn.event, turn.operationId);
  }

  function replyKeyFor(turn: Turn): ChannelReplyKeyInput {
    return { ownership: turn.ownership, connectionId: turn.event.connectionId, operationId: turn.operationId };
  }

  function deriveSessionId(input: ChannelBindingInput): string {
    const digest = createHash("sha256")
      .update(
        key([
          input.connectionId,
          input.externalConversationId,
          input.threadId,
          input.externalActorId,
          input.ownership.tenantId,
          input.ownership.accountId,
          input.ownership.userId,
          input.agentAlias,
          String(input.generation),
        ]),
      )
      .digest("hex");
    return `chan-${digest.slice(0, 40)}`;
  }

  async function resolveNewSessionId(turn: Turn, route: RouteState, generation: number = route.generation): Promise<string> {
    const input = bindingInputFor(route, turn, generation);
    const binding = options.resolveBinding === undefined ? { sessionId: deriveSessionId(input) } : await options.resolveBinding(input);
    if (
      typeof binding?.sessionId !== "string" ||
      binding.sessionId.length === 0 ||
      Buffer.byteLength(binding.sessionId, "utf8") > MAX_ID_BYTES
    ) {
      throw new TypeError("Channel binding must provide a non-empty sessionId of at most 256 bytes");
    }
    return binding.sessionId;
  }

  async function resolveBinding(turn: Turn, route: RouteState): Promise<ChannelBinding> {
    if (route.sessionId !== undefined)
      return { sessionId: route.sessionId, ...(route.leafId === undefined ? {} : { leafId: route.leafId }) };
    const binding = await options.resolveBinding?.(bindingInputFor(route, turn));
    const sessionId = binding?.sessionId ?? deriveSessionId(bindingInputFor(route, turn));
    if (typeof sessionId !== "string" || sessionId.length === 0 || Buffer.byteLength(sessionId, "utf8") > MAX_ID_BYTES) {
      throw new TypeError("Channel binding must provide a non-empty sessionId of at most 256 bytes");
    }
    route.sessionId = sessionId;
    if (binding?.leafId !== undefined) route.leafId = binding.leafId;
    return { sessionId: route.sessionId, ...(route.leafId === undefined ? {} : { leafId: route.leafId }) };
  }

  function track(task: Promise<void>): void {
    inflight.add(task);
    const remove = (): void => {
      inflight.delete(task);
    };
    task.then(remove, remove);
  }

  // ── durable journal helpers ────────────────────────────────────────────────

  /** Load (or create once) the durable binding for a route; survives restarts and `/new`. */
  async function hydrateRoute(route: RouteState, turn: Turn, create = true): Promise<"ok" | "missing" | "unavailable"> {
    if (journal === undefined || route.hydrated) return "ok";
    try {
      const keyInput = bindingKeyFor(route, turn.ownership);
      let stored = await journal.loadBinding(keyInput);
      if (stored === null) {
        if (!create) return "missing";
        const record: ChannelBindingRecord = {
          sessionId: await resolveNewSessionId(turn, route),
          agentAlias: route.alias,
          generation: route.generation,
          suspended: false,
          updatedAt: nowIso(),
        };
        stored = await journal.createBinding(keyInput, record);
        if (stored === null) stored = await journal.loadBinding(keyInput);
        if (stored === null) {
          counters.storageFailures += 1;
          return "unavailable";
        }
      }
      route.sessionId = stored.record.sessionId;
      route.leafId = stored.record.leafId;
      route.generation = stored.record.generation;
      route.suspended = stored.record.suspended;
      route.suspendedRun = stored.record.suspendedRun;
      route.bindingVersion = stored.version;
      route.hydrated = true;
      return "ok";
    } catch {
      counters.storageFailures += 1;
      return "unavailable";
    }
  }

  async function persistBinding(route: RouteState, ownership: OwnershipScope): Promise<void> {
    if (journal === undefined || route.sessionId === undefined) return;
    const record: ChannelBindingRecord = {
      sessionId: route.sessionId,
      ...(route.leafId === undefined ? {} : { leafId: route.leafId }),
      agentAlias: route.alias,
      generation: route.generation,
      suspended: route.suspended,
      ...(route.suspendedRun === undefined ? {} : { suspendedRun: route.suspendedRun }),
      updatedAt: nowIso(),
    };
    try {
      const saved = await journal.saveBinding(
        bindingKeyFor(route, ownership),
        record,
        route.bindingVersion ?? 0,
        route.lease?.fencingToken,
      );
      if (saved === null) counters.storageFailures += 1;
      else route.bindingVersion = saved.version;
    } catch {
      counters.storageFailures += 1;
    }
  }

  /** Durable dedup + admission: the operation record exists before any effect or transport ack. */
  async function beginOperation(
    turn: Turn,
    kind: ChannelAction,
    options_: { readonly advanceCursor?: boolean } = {},
  ): Promise<"unavailable" | "duplicate" | StoredChannelRecord<ChannelOperationRecord>> {
    const store = journal;
    if (store === undefined) return "duplicate";
    const record: ChannelOperationRecord = {
      operationId: turn.operationId,
      eventId: turn.event.eventId,
      kind,
      connectionId: turn.event.connectionId,
      externalConversationId: turn.event.externalConversationId,
      externalActorId: turn.event.externalActorId,
      ...(turn.event.threadId === undefined ? {} : { threadId: turn.event.threadId }),
      agentAlias: turn.alias,
      state: "accepted",
      replyStaged: false,
      attempts: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    try {
      const created = await store.createOperation(operationKeyForTurn(turn), record);
      if (created === null) return "duplicate";
      turn.opVersion = created.version;
      turn.opRecord = created.record;
      if (options_.advanceCursor === false) return created;
      try {
        await store.advanceCursor({ ownership: turn.ownership, connectionId: turn.event.connectionId }, turn.event.eventId);
      } catch {
        counters.storageFailures += 1; // ordering evidence only; the operation is already durable
      }
      return created;
    } catch {
      counters.storageFailures += 1;
      return "unavailable";
    }
  }

  async function settleOperation(
    turn: Turn,
    state: ChannelOperationState,
    extra: {
      readonly runId?: string;
      readonly sessionId?: string;
      readonly errorCode?: string;
      readonly replyStaged?: boolean;
      readonly attempt?: boolean;
    } = {},
  ): Promise<void> {
    const store = journal;
    if (store === undefined || turn.opRecord === undefined) return;
    const previous = turn.opRecord;
    const record: ChannelOperationRecord = {
      ...previous,
      state,
      updatedAt: nowIso(),
      ...(extra.runId === undefined ? {} : { runId: extra.runId }),
      ...(extra.sessionId === undefined ? {} : { sessionId: extra.sessionId }),
      ...(extra.errorCode === undefined ? {} : { errorCode: extra.errorCode }),
      ...(extra.replyStaged === undefined ? {} : { replyStaged: extra.replyStaged }),
      attempts: previous.attempts + (extra.attempt === true ? 1 : 0),
    };
    try {
      const saved = await store.saveOperation(operationKeyForTurn(turn), record, turn.opVersion ?? 0, turn.lease?.fencingToken);
      if (saved === null) counters.storageFailures += 1;
      else {
        turn.opVersion = saved.version;
        turn.opRecord = saved.record;
      }
    } catch {
      counters.storageFailures += 1;
    }
  }

  /** A denial or a command that applied nothing must stay retryable: drop its record. */
  async function dropOperation(turn: Turn): Promise<void> {
    if (journal === undefined || turn.opRecord === undefined) return;
    try {
      await journal.removeOperation(operationKeyForTurn(turn));
      turn.opRecord = undefined;
      turn.opVersion = undefined;
    } catch {
      counters.storageFailures += 1;
    }
  }

  async function ensureLease(route: RouteState, ownership: OwnershipScope): Promise<"ok" | "lost"> {
    if (options.leases === undefined) return "ok";
    const keyInput = bindingKeyFor(route, ownership);
    const key = `${CHANNEL_JOURNAL_NAMESPACES.binding}:${keyInput.connectionId}:${keyInput.externalConversationId}:${keyInput.externalActorId}:${keyInput.agentAlias}`;
    const now = Date.now();
    const current = route.lease;
    if (current !== undefined && current.expiresAt - now > limits.leaseTtlMs / 3) return "ok";
    try {
      if (current !== undefined) {
        const renewed = await options.leases.renewLease({
          namespace: CHANNEL_JOURNAL_NAMESPACES.binding,
          key,
          ...keyInput.ownership,
          ownerId: leaseOwnerId,
          token: current.token,
          ttlMs: limits.leaseTtlMs,
        });
        if (renewed !== null) {
          route.lease = {
            key,
            token: renewed.token,
            fencingToken: renewed.fencingToken,
            expiresAt: Date.parse(renewed.expiresAt),
          };
          return "ok";
        }
        route.lease = undefined;
        counters.leaseLosses += 1;
        return "lost";
      }
      const acquired = await options.leases.tryAcquireLease({
        namespace: CHANNEL_JOURNAL_NAMESPACES.binding,
        key,
        ...keyInput.ownership,
        ownerId: leaseOwnerId,
        ttlMs: limits.leaseTtlMs,
      });
      if (acquired === null) {
        counters.leaseLosses += 1;
        return "lost"; // another worker owns this binding; never a second receiver
      }
      route.lease = { key, token: acquired.token, fencingToken: acquired.fencingToken, expiresAt: Date.parse(acquired.expiresAt) };
      return "ok";
    } catch {
      counters.storageFailures += 1;
      return "lost";
    }
  }

  async function releaseLease(route: RouteState, ownership: OwnershipScope): Promise<void> {
    if (options.leases === undefined || route.lease === undefined) return;
    const lease = route.lease;
    try {
      await options.leases.releaseLease({
        namespace: CHANNEL_JOURNAL_NAMESPACES.binding,
        key: lease.key,
        ...ownership,
        ownerId: leaseOwnerId,
        token: lease.token,
      });
      route.lease = undefined;
    } catch {
      counters.storageFailures += 1;
    }
  }

  /** CAS claim before provider work: exactly one worker moves `accepted` → `executing`. */
  async function claimTurn(turn: Turn, route: RouteState): Promise<"ok" | "deferred" | "unavailable"> {
    const store = journal;
    if (store === undefined || turn.opRecord === undefined) return "ok";
    if ((await ensureLease(route, turn.ownership)) === "lost") return "deferred";
    try {
      const saved = await store.saveOperation(
        operationKeyForTurn(turn),
        { ...turn.opRecord, state: "executing", updatedAt: nowIso() },
        turn.opVersion ?? 0,
        route.lease?.fencingToken,
      );
      if (saved === null) {
        counters.storageFailures += 1;
        return "deferred";
      }
      turn.opVersion = saved.version;
      turn.opRecord = saved.record;
      turn.lease = route.lease;
      return "ok";
    } catch {
      counters.storageFailures += 1;
      return "unavailable"; // fail closed: never run unclaimed work
    }
  }

  async function acquireSlot(): Promise<() => void> {
    if (ctx.activeRuns < limits.maxActiveSessions) {
      ctx.activeRuns += 1;
      return releaseSlot;
    }
    await new Promise<void>((resolve) => {
      slotWaiters.push(resolve);
    });
    return releaseSlot;
  }

  function releaseSlot(): void {
    const next = slotWaiters.shift();
    if (next !== undefined) {
      next();
      return;
    }
    ctx.activeRuns -= 1;
  }

  return {
    key,
    actorKey,
    nowIso,
    boundText,
    redact,
    denial,
    unsupported,
    identityActive,
    validEvent,
    declaredAttachmentBytes,
    authorizeEvent,
    alreadySeen,
    pendingCount,
    resolveAlias,
    ensureRoute,
    findRoute,
    bindingKeyFor,
    operationKeyFor,
    operationKeyForTurn,
    replyKeyFor,
    resolveNewSessionId,
    resolveBinding,
    track,
    hydrateRoute,
    persistBinding,
    beginOperation,
    settleOperation,
    dropOperation,
    ensureLease,
    releaseLease,
    claimTurn,
    acquireSlot,
  };
}

export type RuntimeCore = ReturnType<typeof createRuntimeCore>;
