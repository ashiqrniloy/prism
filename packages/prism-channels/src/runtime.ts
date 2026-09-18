import { randomUUID } from "node:crypto";
import { createChannelApprovalStore } from "./approvals.js";
import { createChannelDeliveryJournal } from "./delivery.js";
import { resolveChannelLimits } from "./limits.js";
import { createRuntimeAdmit } from "./runtime-admit.js";
import { createRuntimeCore } from "./runtime-core.js";
import { createRuntimeReconcile } from "./runtime-reconcile.js";
import { createRuntimeTurn } from "./runtime-turn.js";
import type { Counters, RuntimeContext } from "./runtime-types.js";
import { createChannelStateStore } from "./state.js";
import type { MessagingRuntime, MessagingRuntimeOptions } from "./types.js";

export function createMessagingRuntime(options: MessagingRuntimeOptions): MessagingRuntime {
  const limits = resolveChannelLimits(options.limits);
  const journal =
    options.checkpoints === undefined
      ? undefined
      : createChannelStateStore({ checkpoints: options.checkpoints, maxJournalRecordBytes: limits.maxJournalRecordBytes });
  const replies =
    options.checkpoints === undefined
      ? undefined
      : createChannelDeliveryJournal({ checkpoints: options.checkpoints, maxJournalRecordBytes: limits.maxJournalRecordBytes });
  const counters: Counters = {
    admitted: 0,
    denied: 0,
    unsupported: 0,
    duplicates: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    suspended: 0,
    deliveries: 0,
    deliveryFailures: 0,
    truncated: 0,
    storageFailures: 0,
    leaseLosses: 0,
  };
  const ctx: RuntimeContext = {
    options,
    limits,
    redactor: options.redactor,
    journal,
    replies,
    approvals: options.checkpoints === undefined ? undefined : createChannelApprovalStore(options.checkpoints),
    leaseOwnerId: `channel-runtime-${randomUUID()}`,
    counters,
    routes: new Map(),
    currentAliases: new Map(),
    seenEvents: new Map(),
    inflight: new Set(),
    slotWaiters: [],
    activeRuns: 0,
    stopped: false,
  };
  const core = createRuntimeCore(ctx);
  const turns = createRuntimeTurn(ctx, core);
  const admissions = createRuntimeAdmit(ctx, core, turns);
  const recovery = createRuntimeReconcile(ctx, core);
  return {
    admit: admissions.admit,
    notify: admissions.notifyBinding,
    drain: recovery.drain,
    diagnostics: recovery.diagnostics,
    stop: recovery.stop,
    reconcile: recovery.reconcile,
    listUnresolved: recovery.listUnresolved,
    prune: recovery.prune,
  };
}
