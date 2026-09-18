import { createHash } from "node:crypto";
import { type AgentIdentity, type OwnershipScope, ownershipFromIdentity } from "@arnilo/prism";
import type { RuntimeCore } from "./runtime-core.js";
import type { RuntimeTurn } from "./runtime-turn.js";
import { COMMAND_NAMES, HELP_TEXT, MAX_ID_BYTES, type RouteState, type RuntimeContext, type Turn } from "./runtime-types.js";
import type { ChannelBindingRecord } from "./state.js";
import type { ChannelAction, ChannelAdmission, ChannelAuthorization, ChannelInboundEvent, ChannelNotifyInput } from "./types.js";

export function createRuntimeAdmit(ctx: RuntimeContext, core: RuntimeCore, turnRuntime: RuntimeTurn) {
  const { approvals, counters, currentAliases, journal, limits, routes } = ctx;
  const {
    actorKey,
    alreadySeen,
    authorizeEvent,
    beginOperation,
    bindingKeyFor,
    declaredAttachmentBytes,
    denial,
    dropOperation,
    ensureRoute,
    findRoute,
    hydrateRoute,
    identityActive,
    key,
    nowIso,
    pendingCount,
    redact,
    resolveAlias,
    resolveNewSessionId,
    settleOperation,
    track,
    unsupported,
    validEvent,
  } = core;
  const { approvalFromEvent, approvalLifecycle, commandNotice, enqueue, notify, sameOwnership, startResume } = turnRuntime;
  async function handleApproval(event: ChannelInboundEvent, authorization: ChannelAuthorization, turn: Turn): Promise<ChannelAdmission> {
    const control = approvalFromEvent(event);
    if (control === undefined || approvals === undefined) return denial(control === undefined ? "rejected" : "unavailable");
    let stored: Awaited<ReturnType<typeof approvals.load>>;
    try {
      stored = await approvals.load({ ownership: turn.ownership, connectionId: event.connectionId, token: control.token });
    } catch {
      counters.storageFailures += 1;
      return denial("unavailable");
    }
    if (stored === null) return denial("rejected");
    const record = stored.record;
    if (
      record.state !== "pending" ||
      Date.parse(record.expiresAt) <= Date.now() ||
      record.outcome !== control.outcome ||
      record.connectionId !== event.connectionId ||
      record.externalConversationId !== event.externalConversationId ||
      record.externalActorId !== event.externalActorId ||
      record.threadId !== event.threadId ||
      record.principalKind !== authorization.identity.principal.kind ||
      record.principalId !== authorization.identity.principal.id ||
      record.grantRevision !== authorization.grantRevision ||
      !authorization.agentAliases.includes(record.agentAlias)
    ) {
      return denial("rejected");
    }
    const route = ensureRoute(event, record.agentAlias);
    if (route === undefined) return denial("capacity");
    if ((await hydrateRoute(route, turn)) === "unavailable") return denial("unavailable");
    const suspended = route.suspendedRun;
    if (
      route.resuming ||
      !route.suspended ||
      suspended === undefined ||
      suspended.runId !== record.runId ||
      suspended.sessionId !== record.sessionId ||
      !sameOwnership(turn.ownership, ownershipFromIdentity(authorization.identity))
    ) {
      return denial("rejected");
    }
    try {
      const prepared = await approvalLifecycle(turn, route);
      const status = await prepared.lifecycle.status(
        { runId: record.runId, sessionId: record.sessionId },
        { ownership: turn.ownership, agentId: prepared.agentId },
      );
      if (
        prepared.definitionRevision !== record.definitionRevision ||
        status.state.status !== "suspended" ||
        status.version !== record.expectedVersion ||
        !status.state.interruption?.pendingDecisions?.some((pending) => pending.approvalId === record.approvalId)
      ) {
        return denial("rejected");
      }
      const consumed = await approvals.consume({
        ownership: turn.ownership,
        connectionId: event.connectionId,
        token: control.token,
        expectedVersion: stored.version,
      });
      if (consumed !== "consumed") return denial("rejected");
      await settleOperation(turn, "succeeded");
      startResume(
        route,
        turn,
        record.expectedVersion,
        { decisions: [{ approvalId: record.approvalId, outcome: record.outcome }] },
        "approval",
        record,
      );
      counters.admitted += 1;
      return { status: "accepted" };
    } catch {
      counters.storageFailures += 1;
      return denial("unavailable");
    }
  }

  async function handleCommand(event: ChannelInboundEvent, authorization: ChannelAuthorization, turn: Turn): Promise<ChannelAdmission> {
    const match = /^\/([A-Za-z0-9_]+)(?:\s+([\s\S]*))?$/.exec(event.text.trim());
    if (match === null || !COMMAND_NAMES.has(match[1].toLowerCase())) return unsupported("unknown_command");
    const name = match[1].toLowerCase();
    const argument = (match[2] ?? "").trim();

    if (name === "help") {
      commandNotice(turn, HELP_TEXT);
      counters.admitted += 1;
      return { status: "accepted" };
    }
    if (name === "agent") {
      if (argument.length === 0) {
        commandNotice(turn, "Usage: /agent <alias>.");
        return unsupported("invalid_argument");
      }
      if (!authorization.agentAliases.includes(argument)) {
        commandNotice(turn, "That agent alias is not available to this account.");
        return unsupported("unknown_alias");
      }
      const actor = actorKey(event);
      if (!currentAliases.has(actor) && currentAliases.size >= limits.maxRoutes) return denial("capacity");
      currentAliases.set(actor, argument);
      commandNotice(turn, `Agent set to ${argument}.`);
      counters.admitted += 1;
      return { status: "accepted" };
    }

    const route = name === "agent" ? findRoute(event, turn.alias) : ensureRoute(event, turn.alias);
    if (route === undefined) return denial("capacity");
    if (route !== undefined && (await hydrateRoute(route, turn)) === "unavailable") return denial("unavailable");
    if (name === "status") {
      const state =
        route === undefined
          ? "idle"
          : route.resuming
            ? "resuming"
            : route.active !== undefined
              ? "running"
              : route.suspended
                ? "awaiting decision"
                : route.queue.length > 0
                  ? `queued (${route.queue.length})`
                  : "idle";
      commandNotice(turn, `Agent: ${route?.alias ?? turn.alias}; state: ${state}.`);
      counters.admitted += 1;
      return { status: "accepted" };
    }
    if (name === "new") {
      if (route === undefined) return denial("capacity");
      if (route.suspended) {
        commandNotice(turn, "Resolve or cancel the suspended request before starting a new conversation.");
        counters.admitted += 1;
        return { status: "accepted" };
      }
      if (route.active !== undefined || route.queue.length > 0) {
        commandNotice(turn, "Finish or cancel the current request before starting a new conversation.");
        counters.admitted += 1;
        return { status: "accepted" };
      }
      if (journal !== undefined && route.sessionId !== undefined) {
        const nextGeneration = route.generation + 1;
        const record: ChannelBindingRecord = {
          sessionId: await resolveNewSessionId(turn, route, route.generation + 1),
          agentAlias: route.alias,
          generation: nextGeneration,
          suspended: false,
          updatedAt: nowIso(),
        };
        let saved = await journal
          .saveBinding(bindingKeyFor(route, turn.ownership), record, route.bindingVersion ?? 0, route.lease?.fencingToken)
          .catch(() => null);
        if (saved === null) {
          const current = await journal.loadBinding(bindingKeyFor(route, turn.ownership)).catch(() => null);
          saved =
            current === null
              ? null
              : await journal
                  .saveBinding(bindingKeyFor(route, turn.ownership), record, current.version, route.lease?.fencingToken)
                  .catch(() => null);
        }
        if (saved === null) {
          counters.storageFailures += 1;
          commandNotice(turn, "Could not start a new conversation. Try again.");
          return denial("unavailable");
        }
        route.bindingVersion = saved.version;
      }
      route.generation += 1;
      route.sessionId = undefined;
      route.leafId = undefined;
      route.suspended = false;
      commandNotice(turn, "Started a new conversation.");
      counters.admitted += 1;
      return { status: "accepted" };
    }
    // cancel
    if (route?.suspended && !route.resuming && route.suspendedRun !== undefined) {
      try {
        const prepared = await approvalLifecycle(turn, route);
        const status = await prepared.lifecycle.status(
          { runId: route.suspendedRun.runId, sessionId: route.suspendedRun.sessionId },
          { ownership: turn.ownership, agentId: prepared.agentId },
        );
        if (status.state.status !== "suspended") return denial("rejected");
        await settleOperation(turn, "succeeded");
        startResume(route, turn, status.version, { decision: "deny" }, "command");
        counters.admitted += 1;
        return { status: "accepted" };
      } catch {
        return denial("unavailable");
      }
    }
    const active = route?.active;
    const queued = (route?.queue ?? []).filter((turn_) => !turn_.cancelled);
    if (active?.controller !== undefined) active.controller.abort(new Error("Channel user cancelled the request"));
    for (const queuedTurn of queued) {
      queuedTurn.cancelled = true;
      track(settleOperation(queuedTurn, "cancelled", { errorCode: "cancelled_while_queued" }));
    }
    const suffix = queued.length === 1 ? "" : "s";
    if (active?.controller !== undefined && queued.length > 0) {
      commandNotice(turn, `Cancelling the current request and ${queued.length} queued request${suffix}.`);
    } else if (active?.controller !== undefined) {
      commandNotice(turn, "Cancelling the current request.");
    } else if (queued.length > 0) {
      commandNotice(turn, `Cancelled ${queued.length} queued request${suffix}.`);
    } else {
      commandNotice(turn, "Nothing to cancel.");
    }
    counters.admitted += 1;
    return { status: "accepted" };
  }

  /**
   * Validate host-supplied notify input. Ids only: nothing here is used as a destination, and
   * `text` reaches the bound conversation alone (redacted, bounded by the reply cap).
   */
  function validNotifyInput(input: ChannelNotifyInput): boolean {
    if (input === null || typeof input !== "object") return false;
    if (typeof input.text !== "string" || input.text.trim().length === 0) return false;
    if (input.threadId !== undefined && !boundedId(input.threadId)) return false;
    return boundedId(input.connectionId) && boundedId(input.externalConversationId) && boundedId(input.notifyId, 8);
  }

  function boundedId(value: string, reserved = 0): boolean {
    return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= MAX_ID_BYTES - reserved;
  }

  /**
   * The one already-bound route this notice may address: exact destination, same ownership (when
   * the route recorded it), and never a guess. Several bindings for one owned pair (the host moved
   * the conversation to another alias) resolve to the current selection or fail closed — notify is
   * unicast to a bound pair and has no fan-out.
   */
  function notifyRoute(input: ChannelNotifyInput, ownership: OwnershipScope): RouteState | undefined {
    const candidates: RouteState[] = [];
    for (const route of routes.values()) {
      if (route.connectionId !== input.connectionId) continue;
      if (route.externalConversationId !== input.externalConversationId) continue;
      if (route.threadId !== input.threadId) continue;
      if (route.ownershipHint !== undefined && !sameOwnership(route.ownershipHint, ownership)) continue;
      candidates.push(route);
    }
    if (candidates.length <= 1) return candidates[0];
    const current = candidates.filter(
      (route) =>
        route.alias === currentAliases.get(key([route.connectionId, route.externalConversationId, route.threadId, route.externalActorId])),
    );
    return current.length === 1 ? current[0] : undefined;
  }

  function samePrincipal(left: AgentIdentity, right: AgentIdentity): boolean {
    return left.principal.kind === right.principal.kind && left.principal.id === right.principal.id;
  }

  /**
   * Host-initiated unicast notice: authorize the notification action for the bound actor, confirm
   * the caller's identity is the one that grant names, and reuse the notice reply path (staged
   * reply → `deliver`) without ever starting an agent run or touching the turn queue.
   */
  async function notifyBinding(input: ChannelNotifyInput): Promise<ChannelAdmission> {
    if (ctx.stopped) return denial("stopped");
    if (!validNotifyInput(input)) return denial("malformed");
    if (!identityActive(input.identity)) return denial("revoked");
    let ownership: OwnershipScope;
    try {
      ownership = ownershipFromIdentity(input.identity);
    } catch {
      return denial("malformed");
    }
    const route = notifyRoute(input, ownership);
    if (route === undefined) return denial("rejected");
    const event: ChannelInboundEvent = {
      connectionId: route.connectionId,
      externalConversationId: route.externalConversationId,
      externalActorId: route.externalActorId,
      ...(route.threadId === undefined ? {} : { threadId: route.threadId }),
      eventId: `notify-${input.notifyId}`,
      text: "",
    };
    const authorization = await authorizeEvent(event, "notify");
    if ("status" in authorization) return authorization;
    if (authorization.notifications !== true) return denial("rejected");
    if (!authorization.agentAliases.includes(route.alias)) return denial("rejected");
    if (!samePrincipal(authorization.identity, input.identity)) return denial("rejected");
    if (!sameOwnership(ownershipFromIdentity(authorization.identity), ownership)) return denial("rejected");
    const operationId = `chan-op-${createHash("sha256")
      .update(
        key([
          "notify",
          route.connectionId,
          ownership.tenantId,
          ownership.accountId,
          ownership.userId,
          route.externalActorId,
          route.alias,
          input.notifyId,
        ]),
      )
      .digest("hex")
      .slice(0, 32)}`;
    const turn: Turn = { event, authorization, ownership, alias: route.alias, operationId, cancelled: false };
    const hydrated = await hydrateRoute(route, turn, false);
    if (hydrated === "unavailable") return denial("unavailable");
    if (hydrated === "missing") return denial("rejected");
    if (pendingCount() >= limits.maxPendingPerProcess) return denial("capacity");
    if (journal !== undefined) {
      const begun = await beginOperation(turn, "notify", { advanceCursor: false });
      if (begun === "unavailable") return denial("unavailable");
      if (begun === "duplicate") {
        counters.duplicates += 1;
        counters.admitted += 1;
        return { status: "accepted", operationId, duplicate: true };
      }
    } else if (alreadySeen(event)) {
      counters.duplicates += 1;
      counters.admitted += 1;
      return { status: "accepted", operationId, duplicate: true };
    }
    await notify(turn, redact(input.text));
    await settleOperation(turn, "succeeded");
    counters.admitted += 1;
    return { status: "accepted", operationId };
  }

  async function admit(event: ChannelInboundEvent): Promise<ChannelAdmission> {
    if (ctx.stopped) return denial("stopped");
    if (!validEvent(event)) return denial("malformed");
    if (Buffer.byteLength(event.text, "utf8") > limits.maxInputBytes) return denial("oversized");
    if (declaredAttachmentBytes(event) > limits.maxAttachmentBytes) return denial("oversized");
    const control = approvalFromEvent(event);
    const isCommand = control === undefined && event.text.trimStart().startsWith("/");
    const action: ChannelAction = control === undefined ? (isCommand ? "command" : "message") : "approval";
    const authorization = await authorizeEvent(event, action);
    if ("status" in authorization) return authorization;

    const alias = resolveAlias(event, authorization);
    if (alias === undefined) return denial("rejected");
    const ownership = ownershipFromIdentity(authorization.identity);
    const operationId = `chan-op-${createHash("sha256")
      .update(key([event.connectionId, event.eventId]))
      .digest("hex")
      .slice(0, 32)}`;
    const turn: Turn = { event, authorization, ownership, alias, operationId, cancelled: false };

    if (journal !== undefined) {
      const begun = await beginOperation(turn, action);
      if (begun === "unavailable") return denial("unavailable");
      if (begun === "duplicate") {
        counters.duplicates += 1;
        counters.admitted += 1;
        return { status: "accepted", operationId, duplicate: true };
      }
    } else if (isCommand === false && alreadySeen(event)) {
      counters.duplicates += 1;
      counters.admitted += 1;
      return { status: "accepted", operationId, duplicate: true };
    }

    try {
      if (action === "approval") {
        const outcome = await handleApproval(event, authorization, turn);
        if (outcome.status === "accepted") await settleOperation(turn, "succeeded");
        else await dropOperation(turn);
        return outcome;
      }
      if (isCommand) {
        const outcome = await handleCommand(event, authorization, turn);
        if (outcome.status === "accepted") {
          await settleOperation(turn, "succeeded");
          if (turn.opRecord !== undefined && turn.opRecord.state === "accepted") counters.storageFailures += 1;
        } else {
          await dropOperation(turn); // denied or unsupported commands stay retryable
        }
        return outcome;
      }

      const route = ensureRoute(event, alias);
      if (route === undefined) {
        await dropOperation(turn);
        return denial("capacity");
      }
      if ((await hydrateRoute(route, turn)) === "unavailable") {
        await dropOperation(turn);
        return denial("unavailable");
      }
      if (route.suspended) {
        track(notify(turn, "A previous request is awaiting an operator decision."));
        await dropOperation(turn);
        return denial("awaiting_decision");
      }
      if (route.queue.length >= limits.maxPendingPerBinding || pendingCount() >= limits.maxPendingPerProcess) {
        await dropOperation(turn);
        return denial("capacity");
      }
      enqueue(route, turn, ownership);
      counters.admitted += 1;
      return { status: "accepted", operationId };
    } catch (error) {
      await dropOperation(turn).catch(() => undefined);
      counters.failed += 1;
      return denial(error instanceof TypeError ? "malformed" : "unavailable");
    }
  }

  return { admit, notifyBinding };
}
