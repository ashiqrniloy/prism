import {
  type Agent,
  type AgentEvent,
  AgentRunError,
  type AgentRunResult,
  type AgentSession,
  type ContentBlock,
  createAgentRunLifecycle,
  type Message,
  type OwnershipScope,
  ownershipFromIdentity,
} from "@arnilo/prism";
import type { RuntimeCore } from "./runtime-core.js";
import {
  GENERIC_FAILURE,
  MAX_ERROR_BYTES,
  type RouteState,
  type RuntimeContext,
  type Turn,
  UNSUPPORTED_MEDIA_NOTICE,
} from "./runtime-types.js";
import type {
  ChannelAction,
  ChannelAgentResolverInput,
  ChannelApprovalControl,
  ChannelApprovalOutcome,
  ChannelAssistantDelta,
  ChannelInboundEvent,
  ChannelOperationState,
  ChannelReply,
  ChannelReplyControl,
  ChannelSendResult,
} from "./types.js";

export function createRuntimeTurn(ctx: RuntimeContext, core: RuntimeCore) {
  const { approvals, counters, journal, limits, options, replies } = ctx;
  const {
    acquireSlot,
    authorizeEvent,
    boundText,
    claimTurn,
    dropOperation,
    identityActive,
    nowIso,
    persistBinding,
    redact,
    releaseLease,
    replyKeyFor,
    resolveBinding,
    settleOperation,
    track,
  } = core;
  async function sendReply(turn: Turn, text: string, kind: "final" | "notice", controls?: readonly ChannelReplyControl[]): Promise<void> {
    if (!identityActive(turn.authorization.identity)) {
      counters.failed += 1;
      return;
    }
    const bounded = boundText(text, limits.maxResponseBytes);
    const reply: ChannelReply = {
      connectionId: turn.event.connectionId,
      externalConversationId: turn.event.externalConversationId,
      text: bounded,
      kind,
      ...(controls === undefined ? {} : { controls }),
      ...(turn.event.threadId === undefined ? {} : { threadId: turn.event.threadId }),
      inReplyTo: turn.event.eventId,
    };
    const store = replies;
    let stagedVersion: number | undefined;
    if (store !== undefined) {
      const keyInput = replyKeyFor(turn);
      try {
        const existing = await store.load(keyInput);
        // A settled or ambiguous reply is never resent automatically; only an authorized reconcile does.
        if (existing !== null && existing.record.state !== "pending") return;
        if (existing === null) {
          const staged = await store.mark(
            keyInput,
            {
              operationId: turn.operationId,
              connectionId: turn.event.connectionId,
              externalConversationId: turn.event.externalConversationId,
              ...(turn.event.threadId === undefined ? {} : { threadId: turn.event.threadId }),
              kind,
              text: bounded,
              ...(controls === undefined ? {} : { controls }),
              state: "pending",
              attempts: 0,
              createdAt: nowIso(),
              updatedAt: nowIso(),
            },
            0,
          );
          if (staged === null) {
            counters.storageFailures += 1;
            return; // invariant: a reply is persisted before it is sent
          }
          stagedVersion = staged.version;
        } else {
          stagedVersion = existing.version;
        }
      } catch {
        counters.storageFailures += 1;
        return;
      }
    }

    let result: ChannelSendResult | undefined;
    let ambiguous = false;
    try {
      result = await options.deliver(reply);
    } catch {
      ambiguous = true;
    }
    if (result?.delivered) counters.deliveries += 1;
    else if (!ambiguous) counters.deliveryFailures += 1;

    if (store === undefined || stagedVersion === undefined) return;
    const state = ambiguous ? "delivery_unknown" : result?.delivered ? "delivered" : "delivery_failed";
    try {
      const current = await store.load(replyKeyFor(turn));
      const saved = await store.mark(
        replyKeyFor(turn),
        {
          ...(current?.record ?? {
            operationId: turn.operationId,
            connectionId: turn.event.connectionId,
            externalConversationId: turn.event.externalConversationId,
            ...(turn.event.threadId === undefined ? {} : { threadId: turn.event.threadId }),
            kind,
            text: bounded,
            ...(controls === undefined ? {} : { controls }),
            state: "pending" as const,
            attempts: 0,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          }),
          state,
          attempts: (current?.record.attempts ?? 0) + 1,
          updatedAt: nowIso(),
          ...(result?.messageId === undefined ? {} : { messageId: result.messageId }),
          ...(result?.reason === undefined ? {} : { reason: boundText(result.reason, MAX_ERROR_BYTES) }),
        },
        current?.version ?? stagedVersion,
        turn.lease?.fencingToken,
      );
      if (saved === null) counters.storageFailures += 1;
      else if (turn.opRecord !== undefined) await settleOperation(turn, turn.opRecord.state, { replyStaged: true });
    } catch {
      counters.storageFailures += 1;
    }
  }

  async function notify(turn: Turn, text: string, controls?: readonly ChannelReplyControl[]): Promise<void> {
    await sendReply(turn, text, "notice", controls);
  }

  function failureNotice(message: string | undefined): string {
    const redacted = message === undefined ? "" : redact(message).trim();
    if (redacted.length === 0) return GENERIC_FAILURE;
    return `Request failed: ${boundText(redacted, MAX_ERROR_BYTES)}`;
  }

  function operationStateFor(status: AgentRunResult["status"]): ChannelOperationState {
    if (status === "succeeded") return "succeeded";
    if (status === "aborted") return "cancelled";
    if (status === "suspended") return "suspended";
    return "failed";
  }

  function sameOwnership(left: OwnershipScope, right: OwnershipScope): boolean {
    return left.tenantId === right.tenantId && left.accountId === right.accountId && left.userId === right.userId;
  }

  function approvalFromEvent(event: ChannelInboundEvent): ChannelApprovalControl | undefined {
    if (event.approval !== undefined) {
      const control = event.approval;
      if (
        typeof control?.token === "string" &&
        /^[A-Za-z0-9_-]{32,64}$/.test(control.token) &&
        (control.outcome === "allow_once" || control.outcome === "reject_once")
      ) {
        return control;
      }
      return undefined;
    }
    const match = /^\/(approve|deny)\s+([A-Za-z0-9_-]{32,64})$/i.exec(event.text.trim());
    if (match === null || match[1] === undefined || match[2] === undefined) return undefined;
    return { token: match[2], outcome: match[1].toLowerCase() === "approve" ? "allow_once" : "reject_once" };
  }

  async function approvalLifecycle(turn: Turn, route: RouteState, knownAgent?: Agent) {
    if (options.checkpoints === undefined) throw new Error("durable approvals are unavailable");
    const resolve = async (agent: Agent | undefined = undefined) => {
      const resolved =
        agent ??
        (await options.resolveAgent({
          agentAlias: route.alias,
          identity: turn.authorization.identity,
          ownership: turn.ownership,
          connectionId: route.connectionId,
          externalConversationId: route.externalConversationId,
        }));
      const runState = resolved.config.runState;
      const agentId = resolved.config.id ?? resolved.config.name;
      if (
        runState === undefined ||
        runState.checkpoints !== options.checkpoints ||
        typeof runState.definitionRevision !== "string" ||
        runState.definitionRevision.length === 0 ||
        typeof agentId !== "string" ||
        agentId.length === 0
      ) {
        throw new Error("agent does not support durable approval resume");
      }
      return { agent: resolved, agentId, definitionRevision: runState.definitionRevision };
    };
    const current = await resolve(knownAgent);
    return {
      ...current,
      lifecycle: createAgentRunLifecycle({
        checkpoints: options.checkpoints,
        resolveAgent: async () => resolve(),
      }),
    };
  }

  function approvalText(reason: string, toolName: string | undefined): string {
    const detail = boundText(redact(reason), MAX_ERROR_BYTES).trim();
    const target = toolName === undefined ? "a tool action" : `tool ${toolName}`;
    return detail.length === 0 ? `Approval required for ${target}.` : `Approval required for ${target}: ${detail}`;
  }

  async function stageApprovalControls(
    turn: Turn,
    route: RouteState,
    agent?: Agent,
  ): Promise<{
    readonly text: string;
    readonly controls?: readonly ChannelReplyControl[];
  }> {
    const suspended = route.suspendedRun;
    if (approvals === undefined || suspended === undefined) return { text: "This request requires an authenticated host decision." };
    try {
      const prepared = await approvalLifecycle(turn, route, agent);
      const status = await prepared.lifecycle.status(
        { runId: suspended.runId, sessionId: suspended.sessionId },
        { ownership: turn.ownership, agentId: prepared.agentId },
      );
      if (status.state.status !== "suspended") return { text: "This request is no longer awaiting a decision." };
      const pending = status.state.interruption?.pendingDecisions?.find((entry) => entry.kind === "tool_approval");
      if (pending === undefined) return { text: "This request requires an authenticated host decision." };
      const controls: ChannelReplyControl[] = [];
      for (const outcome of ["allow_once", "reject_once"] as const) {
        const created = await approvals.create({
          ownership: turn.ownership,
          identity: turn.authorization.identity,
          connectionId: turn.event.connectionId,
          externalConversationId: turn.event.externalConversationId,
          externalActorId: turn.event.externalActorId,
          ...(turn.event.threadId === undefined ? {} : { threadId: turn.event.threadId }),
          grantRevision: turn.authorization.grantRevision,
          agentAlias: route.alias,
          definitionRevision: prepared.definitionRevision,
          sessionId: suspended.sessionId,
          runId: suspended.runId,
          approvalId: pending.approvalId,
          expectedVersion: status.version,
          outcome,
          ttlMs: limits.approvalTtlMs,
        });
        controls.push({
          label: outcome === "allow_once" ? "Allow once" : "Deny",
          value: `p:${outcome === "allow_once" ? "a" : "d"}:${created.token}`,
        });
      }
      return { text: approvalText(pending.reason, pending.scope.toolName), controls };
    } catch {
      counters.storageFailures += 1;
      return { text: "This request requires an authenticated host decision." };
    }
  }

  async function settleSuspendedOperation(
    route: RouteState,
    ownership: OwnershipScope,
    state: ChannelOperationState,
    errorCode?: string,
  ): Promise<void> {
    if (journal === undefined || route.suspendedRun === undefined) return;
    const keyInput = { ownership, connectionId: route.connectionId, operationId: route.suspendedRun.operationId };
    try {
      const current = await journal.loadOperation(keyInput);
      if (current === null) return;
      const saved = await journal.saveOperation(
        keyInput,
        {
          ...current.record,
          state,
          updatedAt: nowIso(),
          ...(errorCode === undefined ? {} : { errorCode }),
        },
        current.version,
        route.lease?.fencingToken,
      );
      if (saved === null) counters.storageFailures += 1;
    } catch {
      counters.storageFailures += 1;
    }
  }

  async function resumeSuspended(
    route: RouteState,
    turn: Turn,
    expectedVersion: number,
    decision:
      | { readonly decision: "deny" }
      | { readonly decisions: readonly [{ readonly approvalId: string; readonly outcome: ChannelApprovalOutcome }] },
    action: ChannelAction,
    approval?: {
      readonly grantRevision: string;
      readonly definitionRevision: string;
      readonly approvalId: string;
      readonly principalKind: string;
      readonly principalId: string;
    },
  ): Promise<void> {
    try {
      const authorized = await authorizeEvent(turn.event, action);
      if ("status" in authorized) return;
      const ownership = ownershipFromIdentity(authorized.identity);
      if (!sameOwnership(ownership, turn.ownership)) return;
      if (
        approval !== undefined &&
        (authorized.grantRevision !== approval.grantRevision ||
          authorized.identity.principal.kind !== approval.principalKind ||
          authorized.identity.principal.id !== approval.principalId ||
          !authorized.agentAliases.includes(route.alias))
      ) {
        return;
      }
      const resumedTurn: Turn = { ...turn, authorization: authorized, ownership };
      const prepared = await approvalLifecycle(resumedTurn, route);
      if (approval !== undefined && prepared.definitionRevision !== approval.definitionRevision) return;
      const suspended = route.suspendedRun;
      if (suspended === undefined) return;
      const ref = { runId: suspended.runId, sessionId: suspended.sessionId };
      const before = await prepared.lifecycle.status(ref, { ownership, agentId: prepared.agentId, signal: turn.controller?.signal });
      if (before.state.status !== "suspended" || before.version !== expectedVersion) return;
      let finalText = "";
      const preview = createPreview(route, () => turn.controller?.signal.aborted !== true);
      try {
        for await (const event of prepared.lifecycle.resumeStream(
          ref,
          { expectedVersion, ...decision },
          {
            ownership,
            agentId: prepared.agentId,
            signal: turn.controller?.signal,
            maxQueuedEvents: 64,
            overflow: "close",
          },
        )) {
          preview(event);
          if (event.type === "message_finished" && event.message.role === "assistant") {
            finalText = event.message.content
              .filter((content) => content.type === "text")
              .map((content) => content.text)
              .join("");
          }
        }
      } catch {
        // The durable status below determines whether an abort/failure actually settled the run.
      }
      const after = await prepared.lifecycle.status(ref, { ownership, agentId: prepared.agentId });
      if (after.state.status === "suspended") {
        route.suspended = true;
        await persistBinding(route, ownership);
        const next = await stageApprovalControls(resumedTurn, route, prepared.agent);
        await notify(resumedTurn, next.text, next.controls);
        return;
      }
      const state = after.state.status === "succeeded" ? "succeeded" : after.state.status === "aborted" ? "cancelled" : "failed";
      await settleSuspendedOperation(route, ownership, state, after.state.status === "denied" ? "denied" : undefined);
      route.suspended = false;
      route.suspendedRun = undefined;
      await persistBinding(route, ownership);
      if (after.state.status === "succeeded") {
        if (finalText.trim().length === 0) await notify(resumedTurn, "The request completed without a text answer.");
        else await sendReply(resumedTurn, redact(finalText), "final");
      } else if (after.state.status === "denied") {
        await notify(resumedTurn, "Approval denied. The request will not continue.");
      } else if (after.state.status === "aborted") {
        counters.cancelled += 1;
        await notify(resumedTurn, "Request cancelled.");
      } else {
        counters.failed += 1;
        await notify(resumedTurn, GENERIC_FAILURE);
      }
    } catch {
      counters.failed += 1;
      // A failed resumption remains suspended; a new authorized status check can issue fresh controls.
      const retry = await stageApprovalControls(turn, route);
      await notify(turn, retry.text, retry.controls);
    } finally {
      turn.controller = undefined;
      route.resuming = false;
      if (route.active === turn) route.active = undefined;
    }
  }

  /**
   * Assistant-text preview accumulator for one turn: cumulative, redacted, never journaled and
   * never allowed to fail the turn. Resets on each new assistant message so a tool-call preamble
   * does not leak into the preview of the answer that follows it.
   */
  function createPreview(route: RouteState, isLive: () => boolean): (event: AgentEvent) => void {
    const onDelta = options.onAssistantDelta;
    if (onDelta === undefined) return () => undefined;
    let runId: string | undefined;
    let text = "";
    return (event) => {
      if (event.type === "message_started") {
        runId = event.runId;
        text = "";
        return;
      }
      if (event.type !== "message_delta" || event.content.type !== "text") return;
      if (runId !== undefined && event.runId !== runId) return;
      text += event.content.text;
      if (!isLive()) return;
      const preview = redact(text);
      if (preview.trim().length === 0) return;
      const delta: ChannelAssistantDelta = {
        connectionId: route.connectionId,
        externalConversationId: route.externalConversationId,
        ...(route.threadId === undefined ? {} : { threadId: route.threadId }),
        text: preview,
      };
      try {
        onDelta(delta);
      } catch {
        // Preview only: a throwing host callback must never fail the turn.
      }
    };
  }

  /**
   * Turn input for one admitted event. Voice/document text was already produced by the adapter; an
   * image becomes model input only when the resolved agent's model declares `image` input *and* the
   * host wired `fetchAttachment` — otherwise the turn is refused with a bounded notice instead of
   * silently running without the attachment or dumping bytes into the journal.
   */
  async function mediaTurnInput(agent: Agent, turn: Turn): Promise<string | Message | "unsupported"> {
    const attachments = turn.event.attachments ?? [];
    if (attachments.length === 0) return turn.event.text;
    const images = attachments.filter((ref) => ref.kind === "image");
    if (images.length === 0) return turn.event.text.trim().length === 0 ? "unsupported" : turn.event.text;
    const declaresImage = agent.config?.model?.capabilities?.input?.includes("image") === true;
    const fetchAttachment = options.fetchAttachment;
    if (!declaresImage || fetchAttachment === undefined) return "unsupported";
    const content: ContentBlock[] = turn.event.text.length === 0 ? [] : [{ type: "text", text: turn.event.text }];
    for (const ref of images) {
      const fetched = await fetchAttachment(ref).catch(() => undefined);
      if (fetched === undefined || fetched === null || !(fetched.bytes instanceof Uint8Array) || fetched.bytes.byteLength === 0) {
        return "unsupported";
      }
      content.push({
        type: "image",
        ...(typeof fetched.mimeType === "string" && fetched.mimeType.length > 0 ? { mimeType: fetched.mimeType } : {}),
        data: Buffer.from(fetched.bytes).toString("base64"),
      });
    }
    return { role: "user", content };
  }

  /**
   * Same execution as `session.run`, subscribed first so partial answer text can be previewed.
   * The subscription is bounded (default queue policy), so a slow preview callback can only drop
   * previews — the returned result always comes from the run itself.
   */
  async function runWithPreview(
    session: AgentSession,
    input: string | Message | readonly Message[],
    turn: Turn,
    route: RouteState,
    controller: AbortController,
  ): Promise<AgentRunResult> {
    const subscription = session.subscribe();
    const runPromise = session
      .run(input, {
        identity: turn.authorization.identity,
        signal: controller.signal,
        idempotencyKey: turn.operationId,
      })
      .catch((error: unknown) => {
        if (error instanceof AgentRunError) return error.result;
        throw error;
      });
    const preview = createPreview(route, () => !controller.signal.aborted && !turn.cancelled);
    for await (const event of subscription) preview(event);
    return await runPromise;
  }

  async function runTurn(route: RouteState, turn: Turn): Promise<void> {
    if (turn.cancelled) {
      counters.cancelled += 1;
      await settleOperation(turn, "cancelled", { errorCode: "cancelled_before_start" });
      await notify(turn, "Request cancelled before it started.");
      return;
    }
    if (!identityActive(turn.authorization.identity)) {
      counters.denied += 1;
      await settleOperation(turn, "failed", { errorCode: "identity_revoked" });
      return;
    }
    const release = await acquireSlot();
    try {
      if (turn.cancelled) {
        // cancelled while waiting for a concurrency slot (host shutdown)
        await settleOperation(turn, "cancelled", { errorCode: "cancelled_while_queued" });
        return;
      }
      if (!identityActive(turn.authorization.identity)) {
        counters.denied += 1;
        await settleOperation(turn, "failed", { errorCode: "identity_revoked" });
        return;
      }
      const resolverInput: ChannelAgentResolverInput = {
        agentAlias: route.alias,
        identity: turn.authorization.identity,
        ownership: turn.ownership,
        connectionId: route.connectionId,
        externalConversationId: route.externalConversationId,
      };
      const agent: Agent = await options.resolveAgent(resolverInput);
      const input = await mediaTurnInput(agent, turn);
      if (input === "unsupported") {
        counters.unsupported += 1;
        await settleOperation(turn, "failed", { errorCode: "unsupported_media" });
        await notify(turn, UNSUPPORTED_MEDIA_NOTICE);
        return;
      }
      const binding = await resolveBinding(turn, route);
      const claim = await claimTurn(turn, route);
      if (claim !== "ok") {
        // Another worker owns this binding, or the journal is unavailable: never run unclaimed work.
        if (claim === "deferred") {
          counters.duplicates += 1;
          // Our record is unclaimed (a same-event race would have been a duplicate at admission),
          // so dropping it keeps the event retryable instead of dead-lettering it silently.
          await dropOperation(turn);
        }
        return;
      }
      const session = agent.createSession({
        id: binding.sessionId,
        ...(binding.leafId === undefined ? {} : { leafId: binding.leafId }),
      });
      const controller = new AbortController();
      turn.controller = controller;
      let result: AgentRunResult;
      try {
        result =
          options.onAssistantDelta === undefined
            ? await session.run(input, {
                identity: turn.authorization.identity,
                signal: controller.signal,
                idempotencyKey: turn.operationId,
              })
            : await runWithPreview(session, input, turn, route, controller);
      } catch (error) {
        if (error instanceof AgentRunError) result = error.result;
        else throw error;
      } finally {
        turn.controller = undefined;
      }
      if (result.status !== "suspended" && result.leafId !== undefined) route.leafId = result.leafId;
      route.suspended = result.status === "suspended";
      route.suspendedRun =
        result.status === "suspended" ? { operationId: turn.operationId, runId: result.runId, sessionId: result.sessionId } : undefined;
      await settleOperation(turn, operationStateFor(result.status), {
        runId: result.runId,
        sessionId: result.sessionId,
        ...(result.error?.code === undefined ? {} : { errorCode: String(result.error.code) }),
      });
      await persistBinding(route, turn.ownership);
      if (result.status === "succeeded") {
        counters.completed += 1;
        if (result.text.trim().length === 0) await notify(turn, "The request completed without a text answer.");
        else await sendReply(turn, redact(result.text), "final");
        return;
      }
      if (result.status === "aborted") {
        counters.cancelled += 1;
        await notify(turn, "Request cancelled.");
        return;
      }
      if (result.status === "suspended") {
        counters.suspended += 1;
        const approval = await stageApprovalControls(turn, route, agent);
        await notify(turn, approval.text, approval.controls);
        return;
      }
      counters.failed += 1;
      await notify(turn, failureNotice(result.error?.message));
    } catch (error) {
      counters.failed += 1;
      await settleOperation(turn, "failed", {
        errorCode: error instanceof AgentRunError ? String(error.result.error?.code ?? "run_failed") : "runtime_error",
      });
      await notify(turn, failureNotice(error instanceof Error ? error.message : undefined));
    } finally {
      release();
    }
  }

  async function pumpRoute(route: RouteState): Promise<void> {
    for (;;) {
      const turn = route.queue.shift();
      if (turn === undefined) return;
      route.active = turn;
      await runTurn(route, turn);
      route.active = undefined;
    }
  }

  function scheduleRoute(route: RouteState): void {
    if (route.pumping) return;
    route.pumping = true;
    const task = pumpRoute(route).then(async () => {
      route.pumping = false;
      if (route.queue.length > 0) {
        scheduleRoute(route);
        return;
      }
      // Route is idle: an idle route no longer forces a lease to be held.
      if (route.ownershipHint !== undefined) await releaseLease(route, route.ownershipHint);
    });
    track(task);
  }

  function enqueue(route: RouteState, turn: Turn, ownershipKey: OwnershipScope): void {
    route.ownershipHint = ownershipKey;
    route.queue.push(turn);
    scheduleRoute(route);
  }

  function commandNotice(turn: Turn, text: string): void {
    track(notify(turn, text));
  }

  function startResume(
    route: RouteState,
    turn: Turn,
    expectedVersion: number,
    decision:
      | { readonly decision: "deny" }
      | { readonly decisions: readonly [{ readonly approvalId: string; readonly outcome: ChannelApprovalOutcome }] },
    action: ChannelAction,
    approval?: {
      readonly grantRevision: string;
      readonly definitionRevision: string;
      readonly approvalId: string;
      readonly principalKind: string;
      readonly principalId: string;
    },
  ): void {
    route.resuming = true;
    route.active = turn;
    turn.controller = new AbortController();
    track(resumeSuspended(route, turn, expectedVersion, decision, action, approval));
  }

  return { approvalFromEvent, approvalLifecycle, commandNotice, enqueue, notify, sameOwnership, startResume };
}

export type RuntimeTurn = ReturnType<typeof createRuntimeTurn>;
