import { type AgentIdentity, ownershipFromIdentity } from "@arnilo/prism";
import { type ChannelReplyKeyInput, isSettledReply } from "./delivery.js";
import type { RuntimeCore } from "./runtime-core.js";
import { MAX_ERROR_BYTES, type RuntimeContext } from "./runtime-types.js";
import {
  CHANNEL_JOURNAL_NAMESPACES,
  type ChannelBindingRecord,
  type ChannelOperationKeyInput,
  type StoredChannelRecord,
  UNRESOLVED_OPERATION_STATES,
} from "./state.js";
import type {
  ChannelDiagnostics,
  ChannelOperationRecord,
  ChannelOperationState,
  ChannelPruneResult,
  ChannelReconcileInput,
  ChannelReconcileResult,
  ChannelReply,
  ChannelReplyRecord,
  ChannelSendResult,
  ChannelUnresolvedOperation,
  MessagingRuntimeDrainResult,
} from "./types.js";

export function createRuntimeReconcile(ctx: RuntimeContext, core: RuntimeCore) {
  const { counters, inflight, journal, limits, options, replies, routes } = ctx;
  const { boundText, identityActive, nowIso, pendingCount, releaseLease, settleOperation, track } = core;
  async function drain(options_: { readonly deadlineMs?: number } = {}): Promise<MessagingRuntimeDrainResult> {
    const deadline = options_.deadlineMs === undefined ? undefined : Date.now() + Math.max(0, options_.deadlineMs);
    while (inflight.size > 0) {
      const waits = [...inflight];
      if (deadline === undefined) {
        await Promise.all(waits);
        continue;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await Promise.race([Promise.all(waits), delay(remaining)]);
    }
    return {
      settled: inflight.size === 0,
      pending: inflight.size,
      completed: counters.completed,
      failed: counters.failed,
      cancelled: counters.cancelled,
    };
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms).unref();
    });
  }

  async function stop(): Promise<void> {
    ctx.stopped = true;
    for (const route of routes.values()) {
      for (const queued of route.queue) {
        if (!queued.cancelled) {
          queued.cancelled = true;
          counters.cancelled += 1;
          track(settleOperation(queued, "cancelled", { errorCode: "cancelled_at_shutdown" }));
        }
      }
      route.queue.length = 0;
      const active = route.active;
      if (active?.controller !== undefined) active.controller.abort(new Error("Channel runtime stopped"));
      else if (active !== undefined && !active.cancelled) {
        // Waiting for a concurrency slot: no controller exists yet, so mark it so it exits.
        active.cancelled = true;
        counters.cancelled += 1;
      }
    }
    await drain({ deadlineMs: limits.stopDeadlineMs });
    for (const route of routes.values()) {
      if (route.ownershipHint !== undefined) await releaseLease(route, route.ownershipHint);
    }
  }

  async function reconcile(input: ChannelReconcileInput): Promise<ChannelReconcileResult> {
    if (journal === undefined || replies === undefined) return { status: "unavailable" };
    if (!identityActive(input.identity)) return { status: "denied" };
    if (
      typeof input.operationId !== "string" ||
      input.operationId.length === 0 ||
      typeof input.connectionId !== "string" ||
      !Number.isSafeInteger(input.expectedVersion)
    ) {
      return { status: "not_found" };
    }
    const ownership = ownershipFromIdentity(input.identity);
    const keyInput: ChannelOperationKeyInput = {
      ownership,
      connectionId: input.connectionId,
      operationId: input.operationId,
    };
    let stored: StoredChannelRecord<ChannelOperationRecord> | null;
    try {
      stored = await journal.loadOperation(keyInput);
    } catch {
      counters.storageFailures += 1;
      return { status: "unavailable" };
    }
    if (stored === null) return { status: "not_found" };
    if (stored.version !== input.expectedVersion) return { status: "conflict", state: stored.record.state };

    // Unproven model/tool work: never replayed. Resolution is an explicit, recorded dead-letter.
    if (stored.record.state === "executing") {
      if (input.acknowledgeDuplicateRisk !== true) return { status: "conflict", state: stored.record.state, detail: "duplicate_risk" };
      const saved = await journal
        .saveOperation(keyInput, { ...stored.record, state: "execution_unknown", updatedAt: nowIso() }, stored.version, stored.fencingToken)
        .catch(() => null);
      if (saved === null) return { status: "conflict", state: stored.record.state };
      return { status: "resolved", outcome: "execution_unknown", state: "execution_unknown" };
    }
    if (stored.record.state === "accepted") {
      const saved = await journal
        .saveOperation(keyInput, { ...stored.record, state: "abandoned", updatedAt: nowIso() }, stored.version, stored.fencingToken)
        .catch(() => null);
      if (saved === null) return { status: "conflict", state: stored.record.state };
      return { status: "resolved", outcome: "abandoned", state: "abandoned" };
    }

    // Settled work may still have an undelivered or ambiguous reply: resending needs the ack.
    const replyKey: ChannelReplyKeyInput = {
      ownership,
      connectionId: input.connectionId,
      operationId: input.operationId,
    };
    const staged = await replies.load(replyKey).catch(() => null);
    if (staged === null) return { status: "resolved", outcome: "none", state: stored.record.state };
    const resendable =
      staged.record.state === "pending" || staged.record.state === "delivery_unknown" || staged.record.state === "delivery_failed";
    if (!resendable) return { status: "resolved", outcome: "none", state: stored.record.state };
    // A known failure is safe to retry; `pending`/`delivery_unknown` may already have landed.
    if (staged.record.state !== "delivery_failed" && input.acknowledgeDuplicateRisk !== true) {
      return { status: "conflict", state: stored.record.state, detail: "duplicate_risk" };
    }
    const reply: ChannelReply = {
      connectionId: staged.record.connectionId,
      externalConversationId: staged.record.externalConversationId,
      text: staged.record.text,
      kind: staged.record.kind,
      ...(staged.record.controls === undefined ? {} : { controls: staged.record.controls }),
      ...(staged.record.threadId === undefined ? {} : { threadId: staged.record.threadId }),
    };
    let result: ChannelSendResult | undefined;
    let ambiguous = false;
    try {
      result = await options.deliver(reply);
    } catch {
      ambiguous = true;
    }
    const state = ambiguous ? "delivery_unknown" : result?.delivered ? "delivered" : "delivery_failed";
    if (result?.delivered) counters.deliveries += 1;
    else if (!ambiguous) counters.deliveryFailures += 1;
    const updated: ChannelReplyRecord = {
      ...staged.record,
      state,
      attempts: staged.record.attempts + 1,
      updatedAt: nowIso(),
      ...(result?.messageId === undefined ? {} : { messageId: result.messageId }),
      ...(result?.reason === undefined ? {} : { reason: boundText(result.reason, MAX_ERROR_BYTES) }),
    };
    const saved = await replies.mark(replyKey, updated, staged.version).catch(() => null);
    if (saved === null) {
      counters.storageFailures += 1;
      return { status: "conflict", state: stored.record.state };
    }
    return {
      status: "resolved",
      outcome: result?.delivered ? "reply_delivered" : ambiguous ? "reply_unknown" : "reply_failed",
      state: stored.record.state,
    };
  }

  async function listUnresolved(input: {
    readonly identity: AgentIdentity;
    readonly limit?: number;
  }): Promise<readonly ChannelUnresolvedOperation[]> {
    if (journal === undefined) return [];
    if (!identityActive(input.identity)) return [];
    const limit = Math.min(Math.max(1, input.limit ?? limits.maxJournalPage), limits.maxJournalPage);
    const items = await journal
      .list<ChannelOperationRecord>({
        ownership: ownershipFromIdentity(input.identity),
        namespace: CHANNEL_JOURNAL_NAMESPACES.operation,
        limit,
      })
      .catch(() => null);
    if (items === null) {
      counters.storageFailures += 1;
      return [];
    }
    const unresolved: ChannelUnresolvedOperation[] = [];
    for (const item of items) {
      if (UNRESOLVED_OPERATION_STATES.includes(item.record.state)) {
        unresolved.push({
          operationId: item.record.operationId,
          connectionId: item.record.connectionId,
          state: item.record.state,
          version: item.version,
          updatedAt: item.updatedAt,
        });
        continue;
      }
      const reply = await replies
        ?.load({
          ownership: ownershipFromIdentity(input.identity),
          connectionId: item.record.connectionId,
          operationId: item.record.operationId,
        })
        .catch(() => null);
      const replyState = reply?.record.state;
      const needsReplyWork = replyState === "pending" || replyState === "delivery_unknown" || replyState === "delivery_failed";
      if (!needsReplyWork && !UNRESOLVED_OPERATION_STATES.includes(item.record.state)) continue;
      unresolved.push({
        operationId: item.record.operationId,
        connectionId: item.record.connectionId,
        state: item.record.state,
        ...(replyState === undefined ? {} : { replyState }),
        version: item.version,
        updatedAt: item.updatedAt,
      });
    }
    return unresolved;
  }

  /** Retention sweep. Unresolved operations and unsettled replies are never deleted; pages are bounded. */
  async function prune(input: { readonly identity: AgentIdentity; readonly now?: string }): Promise<ChannelPruneResult> {
    const result: { scanned: number; deleted: number; retained: number } = { scanned: 0, deleted: 0, retained: 0 };
    if (journal === undefined) return result;
    if (!identityActive(input.identity)) return result;
    const store = journal;
    const ownership = ownershipFromIdentity(input.identity);
    const cutoff = Date.parse(input.now ?? nowIso()) - limits.retentionDays * 24 * 60 * 60_000;
    const page = limits.maxJournalPage;

    async function sweep(
      namespace: (typeof CHANNEL_JOURNAL_NAMESPACES)[keyof typeof CHANNEL_JOURNAL_NAMESPACES],
      keep: (record: unknown) => boolean,
    ) {
      const items = await store.list<unknown>({ ownership, namespace, limit: page }).catch(() => null);
      if (items === null) {
        counters.storageFailures += 1;
        return;
      }
      for (const item of items) {
        result.scanned += 1;
        // The record's own stamp is authoritative (it records when the state transition happened);
        // the store's `updatedAt` is the fallback for records that carry none.
        const own = (item.record as { updatedAt?: unknown }).updatedAt;
        const stamp = typeof own === "string" && Number.isFinite(Date.parse(own)) ? own : item.updatedAt;
        if (Date.parse(stamp) > cutoff || keep(item.record)) {
          result.retained += 1;
          continue;
        }
        const deleted = await store.remove({ ownership, namespace, key: item.key }).catch(() => false);
        if (deleted === true) result.deleted += 1;
        else {
          counters.storageFailures += 1;
          result.retained += 1;
        }
      }
    }

    await sweep(CHANNEL_JOURNAL_NAMESPACES.operation, (record) => {
      const state = (record as Partial<ChannelOperationRecord>).state;
      return typeof state !== "string" || UNRESOLVED_OPERATION_STATES.includes(state as ChannelOperationState);
    });
    await sweep(CHANNEL_JOURNAL_NAMESPACES.reply, (record) => !isSettledReply(record as ChannelReplyRecord));
    await sweep(CHANNEL_JOURNAL_NAMESPACES.binding, (record) => (record as Partial<ChannelBindingRecord>).suspended === true);
    await sweep(CHANNEL_JOURNAL_NAMESPACES.cursor, () => false);
    await sweep(CHANNEL_JOURNAL_NAMESPACES.control, () => false);
    return result;
  }

  function diagnostics(): ChannelDiagnostics {
    return {
      admitted: counters.admitted,
      denied: counters.denied,
      unsupported: counters.unsupported,
      duplicates: counters.duplicates,
      queued: pendingCount(),
      active: ctx.activeRuns,
      completed: counters.completed,
      failed: counters.failed,
      cancelled: counters.cancelled,
      suspended: counters.suspended,
      deliveries: counters.deliveries,
      deliveryFailures: counters.deliveryFailures,
      truncated: counters.truncated,
      storageFailures: counters.storageFailures,
      leaseLosses: counters.leaseLosses,
    };
  }

  return { drain, diagnostics, listUnresolved, prune, reconcile, stop };
}
