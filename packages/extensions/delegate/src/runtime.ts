import {
  type AgentEvent,
  type Decision,
  type EventOrigin,
  type ModelRef,
  type PackageAPI,
  parseModelRef,
  type PendingDecision,
  type Principal,
  type RunOptions,
  type RunResult,
  type Session,
  type SessionContext,
  type Usage,
} from "@arnilo/prism";
import { createActivityReporter } from "./activity.js";
import type { DelegateChildConfig, DelegateConfig } from "./config.js";
import { DEFAULT_MAX_CONCURRENT, DEFAULT_MAX_DEPTH, DEFAULT_QUEUE_TIMEOUT_MS } from "./config.js";
import { buildSeededContext, type ContextUsed, resolveChildContext } from "./context.js";
import { type DelegationMerge, type IsolatedWorktree, type IsolationWorkspace, mergeMessage } from "./isolation.js";
import { type ResolvedDelegateCeilings, resolveChildLimits, resolveDelegateCeilings, resolveResultMaxChars } from "./limits.js";
import { createSlotQueue } from "./queue.js";
import { type DelegateStepInput, delegateStepData, MAX_DELEGATE_STEP_APPROVALS } from "./step.js";

export const DELEGATE_PACKAGE = "@arnilo/prism-extensions/delegate";

/** The `origin.agentId` the delegate reports for a child: a stable label, since the child runs on the parent's agent. */
const childAgentId = (name: string) => `delegate-${name}`;

export type DelegationStatus = RunResult["status"] | "cancelled" | "running";

export interface DelegationOutcome {
  readonly delegationId: string;
  readonly child: string;
  readonly status: DelegationStatus;
  readonly text: string;
  /** Provider turns the child completed in this leg; `0` when it never started. */
  readonly turns: number;
  /** The child's own usage. It is also charged to the parent's run, so do not add it to the parent's totals. */
  readonly usage?: Usage;
  readonly pending?: readonly PendingDecision[];
  readonly error?: string;
  /** The child session, in the agent's store: resume a suspended async child through it. */
  readonly sessionId?: string;
  /** The child run, for a suspended child's `AgentDelegationSuspendedError`. */
  readonly runId?: string;
  /** Present for an `isolation: "worktree"` child: what happened to its branch. */
  readonly merge?: DelegationMerge;
  /** Present when the child was seeded with the parent's conversation: how much of it it got. */
  readonly context?: ContextUsed;
}

interface Delegation {
  readonly id: string;
  readonly child: string;
  readonly parentSessionId: string;
  readonly controller: AbortController;
  readonly done: Promise<DelegationOutcome>;
  /** An async delegation the model started: the `run.end` announcement names it once. */
  readonly announce?: { announced: boolean; settled: boolean };
}

/** The `delegate`, `delegate_wait` and `delegate_cancel` tools: a child below `maxDepth` gets them on its allow-list. */
export const DELEGATE_TOOL_NAMES = ["delegate", "delegate_wait", "delegate_cancel"] as const;
/** At most this many delegations are named in one `run.end` announcement; the rest are counted. */
export const MAX_ANNOUNCED_DELEGATIONS = 8;

export interface DelegateStartInput {
  readonly child: string;
  readonly input: string;
  readonly mode: "sync" | "async";
  readonly parentSessionId: string;
  readonly parentRunId: string;
  readonly session?: SessionContext;
  readonly principal?: Principal;
  readonly signal?: AbortSignal;
  /** The calling run's interactivity (`ToolExecutionContext.interactive`); the child run inherits it. */
  readonly interactive?: boolean;
  /** Internal: the `delegate` service may start a configured hidden child; the model-facing tool may not. */
  readonly allowHidden?: boolean;
}

/** What `resumeNested` passes back: the suspended child session, the child-visible decisions, and the hosting call. */
export interface DelegateResumeInput {
  readonly childSessionId: string;
  readonly decisions: readonly Decision[];
  readonly parentSessionId: string;
  readonly session?: SessionContext;
  readonly principal?: Principal;
  readonly signal?: AbortSignal;
  readonly interactive?: boolean;
}

export class DelegateError extends Error {
  readonly code = "ERR_PRISM_DELEGATE";
  constructor(message: string) {
    super(message);
    this.name = "DelegateError";
  }
}

/** `Finish with a concise report for the parent: what you did, what you found, files changed, and open issues. The parent sees only this report.` */
export const DEFAULT_CHILD_INSTRUCTIONS =
  "Finish with a concise report for the parent: what you did, what you found, files changed, and open issues. The parent sees only this report.";

/** The child's system instructions: the report contract, then the host's own text. */
function childInstructions(instructions: string | undefined): string {
  return instructions === undefined ? DEFAULT_CHILD_INSTRUCTIONS : `${DEFAULT_CHILD_INSTRUCTIONS}\n\n${instructions}`;
}

/** The model the summary seed is written with: the child's, else the parent session's. */
function seedModel(ref: ModelRef | undefined): { provider: string; model: string } {
  if (ref === undefined) throw new DelegateError("No model for the child: set the child's model");
  return typeof ref === "string" || !("provider" in ref) ? parseModelRef(ref) : ref;
}

/** A suspended sync child, recorded on the parent session so a parent resumed in a new process can find its config. */
type SuspendedChild = {
  readonly child: string;
  readonly delegationId: string;
  /** The first line of the brief: the merge commit's subject, nothing more. */
  readonly brief: string;
};
type SuspendedChildren = Record<string, SuspendedChild>;

/** An isolated child's worktree, held while the child is suspended so its resume runs in the same tree. */
interface HeldWorktree {
  readonly parentSessionId: string;
  readonly child: string;
  readonly brief: string;
  readonly workspace: IsolationWorkspace;
  readonly worktree: IsolatedWorktree;
}

/** Binds one worktree to the child's session; a sandboxed service refuses, and that is `isolation_unavailable`. */
async function createWorktree(workspace: IsolationWorkspace, sessionId: string): Promise<IsolatedWorktree> {
  try {
    return await workspace.worktree.create({ sessionId });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: unknown }).code;
    throw new DelegateError(
      code === "workspace_sandbox_unsupported"
        ? `isolation_unavailable: ${detail}`
        : `The child's worktree could not be created: ${detail}`,
    );
  }
}

/**
 * A completed child's branch is merged into the parent's branch; anything else keeps the branch and
 * merges nothing. Conflicts and refusals keep the branch too, so a person can finish the work: the
 * delegate never resolves a conflict, never pushes, and never deletes an unmerged branch.
 */
async function settle(
  workspace: IsolationWorkspace,
  child: string,
  input: string,
  worktree: IsolatedWorktree,
  status: DelegationStatus,
): Promise<DelegationMerge> {
  const record = async (): Promise<void> => {
    // A kept branch that has none of the child's work is useless, and a skipped child would lose its
    // uncommitted edits with the worktree; record them on the branch first.
    await workspace.commit?.(worktree.path, { message: mergeMessage(child, input) }).catch(() => undefined);
  };
  if (status !== "completed") {
    await record();
    return { status: "skipped", branch: worktree.branch };
  }
  if (worktree.parentBranch === "HEAD") {
    await record();
    return { status: "refused", reason: "the parent repository is on a detached HEAD", branch: worktree.branch };
  }
  const files = await workspace
    .diff?.(worktree.path)
    .then((diff) => diff.changes.map((change) => change.path))
    .catch(() => [] as readonly string[]);
  try {
    const merged = await workspace.merge(worktree.path, {
      into: worktree.parentBranch,
      commit: { message: mergeMessage(child, input) },
    });
    if (merged.status === "merged" && merged.commit !== undefined) {
      return { status: "merged", commit: merged.commit, files: files ?? [] };
    }
    await record();
    return { status: "conflict", files: merged.files ?? [], branch: worktree.branch };
  } catch (error) {
    await record();
    return { status: "refused", reason: error instanceof Error ? error.message : String(error), branch: worktree.branch };
  }
}

/** One description line per child, from config: the explicit `description`, else the first sentence of `instructions`. */
function describeChild(_name: string, child: DelegateChildConfig): { line: string; missing: boolean } {
  const explicit = child.description?.trim();
  if (explicit) return { line: explicit, missing: false };
  const first = child.instructions
    ?.trim()
    .split(/(?<=[.!?])\s/)[0]
    ?.trim();
  return first ? { line: first, missing: false } : { line: "(no description)", missing: true };
}

/** How a child session's run ended, from a `run` result or a `resume` stream. */
interface ChildEnd {
  readonly status: RunResult["status"];
  readonly runId?: string;
  readonly usage?: Usage;
  readonly pending?: readonly PendingDecision[];
  readonly error?: string;
}

/** The text of the child's last assistant message: what a resumed run's stream does not carry. */
async function lastAssistantText(session: Session): Promise<string> {
  const messages = await session.messages();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  }
  return "";
}

/** One child per delegation: a session linked to the parent's, on the parent's own agent. */
export function createDelegateRuntime(
  prism: PackageAPI<DelegateConfig>,
  resolved?: Readonly<Record<string, DelegateChildConfig>>,
  ceilings: ResolvedDelegateCeilings = resolveDelegateCeilings(prism.config.ceilings),
) {
  const config = prism.config;
  const children = resolved ?? config.children ?? {};
  const maxDepth = config.maxDepth ?? DEFAULT_MAX_DEPTH;
  /** A root session is depth 0; a hand-built context without `depth` counts as a root. */
  const depthOf = (session: SessionContext | undefined): number => session?.depth ?? 0;
  const suspendedState = prism.state.session<SuspendedChildren>("suspended-children", {});
  // Notes about dropped tool names are setup facts once seen; a child's allow-list is still read per delegation.
  const notedDrops = new Set<string>();
  /**
   * The child's allow-list: the tools registered by its inherited packages, narrowed by `tools.only`. Never `undefined`,
   * which would mean every tool. A name no inherited package registers is dropped with one note (an agent file may list
   * a tool this agent does not have); an inherited package that is not loaded fails the delegation.
   */
  const allowListFor = (name: string, child: DelegateChildConfig, childDepth: number): readonly string[] => {
    prism.packages.instances(child.inherit);
    // This package is never inherited, so a child that may delegate again gets its tools here (Task 5).
    const delegating =
      childDepth < maxDepth
        ? prism.tools
            .list()
            .filter((tool) => tool.package === DELEGATE_PACKAGE && (DELEGATE_TOOL_NAMES as readonly string[]).includes(tool.name))
            .map((tool) => tool.name)
        : [];
    const inherited = new Set(child.inherit);
    const own = prism.tools
      .list()
      .filter((tool) => inherited.has(tool.package))
      .map((tool) => tool.name);
    const only = child.tools?.only;
    if (only === undefined) return [...own, ...delegating];
    const available = new Set(own);
    const kept = only.filter((tool) => available.has(tool));
    const dropped = only.filter((tool) => !available.has(tool));
    if (dropped.length > 0 && !notedDrops.has(name)) {
      notedDrops.add(name);
      prism.status.note(
        kept.length === 0 ? "warn" : "info",
        `Delegate child ${name} asks for tools its inherited packages do not register and they were dropped: ${dropped.join(", ")}.`,
      );
    }
    return [...kept, ...delegating];
  };
  /**
   * The parent's skills the child gets. `inherit` keeps every skill whose `requiresTools` the child's allow-list holds
   * (so the `delegate` skill never reaches a child); an unknown name is a configuration error, not a silent drop.
   */
  const skillsFor = (request: DelegateChildConfig["skills"], tools: readonly string[]): RunOptions["skills"] => {
    if (request === "none") return false;
    const all = prism.skills.list();
    if (request === undefined || request === "inherit") {
      const allowed = new Set(tools);
      const kept = all.filter((skill) => (skill.requiresTools ?? []).every((tool) => allowed.has(tool)));
      if (kept.length === all.length) return undefined;
      return kept.length === 0 ? false : { only: kept.map((skill) => skill.name) };
    }
    const known = new Set(all.map((skill) => skill.name));
    for (const skill of request) if (!known.has(skill)) throw new DelegateError(`Unknown skill for the child: ${skill}`);
    return request.length === 0 ? false : { only: request };
  };
  /** Every per-run option a child gets, assembled in one place for both `run` and `resume`. */
  const childRunOptions = (
    name: string,
    child: DelegateChildConfig,
    input: { session?: SessionContext; principal?: Principal; interactive?: boolean },
    signal: AbortSignal,
    leg: "run" | "resume",
  ): RunOptions => {
    // A durable resume refuses `RunOptions.model` (the agent's model is part of the suspended run's fingerprint).
    const model: ModelRef | undefined = leg === "resume" ? undefined : (child.model ?? input.session?.model);
    const only = allowListFor(name, child, depthOf(input.session) + 1);
    const skills = skillsFor(child.skills, only);
    return {
      signal,
      ...(model === undefined ? {} : { model }),
      systemPrompt: { id: "delegate-child", source: "run", mode: "replace", text: childInstructions(child.instructions) },
      tools: { only },
      ...(skills === undefined ? {} : { skills }),
      limits: resolveChildLimits(child.limits, ceilings),
      // A headless parent gets a child whose asks suspend, so they reach the parent's host through `session.resume`.
      interactive: input.interactive ?? true,
      ...(input.principal === undefined ? {} : { principal: input.principal }),
      // The child's turns count against the parent's run (and through it, its ancestors').
      ...(input.session === undefined ? {} : { chargeTo: input.session }),
    };
  };
  const maxConcurrent = config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  // One queue per agent: every depth's delegations share it, so `maxConcurrent` bounds the whole tree.
  const slots = createSlotQueue({
    limit: maxConcurrent,
    timeoutMs: config.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS,
    onRefused: (reason) =>
      new DelegateError(
        reason === "aborted"
          ? "The delegation was aborted while it waited for a slot"
          : reason === "timeout"
            ? `At most ${maxConcurrent} delegations may run at once, and no slot freed within ${config.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS} ms`
            : `At most ${maxConcurrent} delegations may run at once`,
      ),
  });
  const delegations = new Map<string, Delegation>();
  const heldWorktrees = new Map<string, HeldWorktree>();
  // Merges advance one ref each; two children finishing together must not race on the same compare-and-swap.
  let mergeQueue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const next = mergeQueue.then(task, task);
    mergeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  let sequence = 0;
  // Built once: the tool description and the missing-description notes are setup-time facts.
  const isHidden = (child: DelegateChildConfig): boolean => child.hidden === true;
  const described = Object.entries(children)
    .filter(([, child]) => !isHidden(child))
    .map(([name, child]) => ({ name, ...describeChild(name, child), context: resolveChildContext(child.context) }));
  const contextSuffix = (context: ReturnType<typeof resolveChildContext>): string => {
    if (context.mode === "none") return "";
    if (context.mode === "summary") return " (sees a summary of this conversation)";
    return ` (sees the last ${context.lastTurns} turns of this conversation)`;
  };
  const description = [
    "Run a child agent on a task. The child sees only your input unless its line says it sees this conversation. Children:",
    ...described.map((entry) => `- ${entry.name}: ${entry.line}${contextSuffix(entry.context)}`),
  ].join("\n");
  for (const entry of described) {
    if (entry.missing) prism.status.note("info", `Delegate child ${entry.name} has no description; add one so the model can choose it.`);
  }
  const resultMaxChars: Record<string, number> = Object.fromEntries(
    Object.entries(children).map(([name, child]) => [name, resolveResultMaxChars(child.resultMaxChars, ceilings)]),
  );

  const emit = (input: DelegateStepInput): void => {
    try {
      prism.events.emit("delegate.step", delegateStepData(input));
    } catch {
      // Reporting is advisory and never fails a delegation.
    }
  };

  /**
   * Counts the child's turns and reports milestones while one leg (a run or a resume) is in flight. Under `stream`, the
   * child's tool starts and finishes and its text also go out as bounded `delegate.activity` events.
   */
  const watch = (session: Session, origin: EventOrigin, report: DelegateChildConfig["report"], parentSessionId: string) => {
    let turns = 0;
    const activity =
      report === "stream"
        ? createActivityReporter({
            origin,
            parentSessionId,
            ...(config.activityFlushMs === undefined ? {} : { flushMs: config.activityFlushMs }),
            emit: (data) => prism.events.emit("delegate.activity", data),
          })
        : undefined;
    const events = session.subscribe({ acrossRuns: true });
    const pump = (async () => {
      for await (const event of events as AsyncIterable<AgentEvent>) {
        activity?.onEvent(event);
        if (event.type === "turn.completed") {
          turns += 1;
          if (report !== "on-complete") emit({ origin, phase: "milestone", turn: turns });
        } else if (event.type === "tool.completed" && report === "stream") {
          emit({ origin, phase: "milestone", turn: turns });
        }
      }
    })()
      .catch(() => undefined)
      .finally(() => activity?.end());
    return {
      get turns() {
        return turns;
      },
      /** The session's close ends the subscription. */
      done: pump,
    };
  };

  const recordSuspended = async (session: SessionContext | undefined, childSessionId: string, entry: SuspendedChild | undefined) => {
    if (session === undefined) return;
    const current = suspendedState.get(session);
    if (entry === undefined && !Object.hasOwn(current, childSessionId)) return;
    const { [childSessionId]: _dropped, ...rest } = current;
    await suspendedState.set(session, entry === undefined ? rest : { ...rest, [childSessionId]: entry });
  };

  /**
   * After one leg ends: settle an isolated child's branch (or hold its worktree while it is suspended), report, and
   * build the outcome. A sync child's suspension is recorded on the parent session for `resumeNested`.
   */
  const finishLeg = async (leg: {
    readonly id: string;
    readonly name: string;
    readonly brief: string;
    readonly parentSessionId: string;
    readonly parentSession?: SessionContext;
    readonly sync: boolean;
    readonly session: Session;
    readonly end: ChildEnd;
    readonly text: string;
    readonly turns: number;
    readonly controller: AbortController;
    readonly origin: EventOrigin;
    readonly isolation?: { readonly workspace: IsolationWorkspace; readonly worktree: IsolatedWorktree };
    readonly context?: ContextUsed;
  }): Promise<DelegationOutcome> => {
    const { end, session } = leg;
    const status: DelegationStatus = leg.controller.signal.aborted && end.status !== "suspended" ? "cancelled" : end.status;
    let merge: DelegationMerge | undefined;
    heldWorktrees.delete(session.id);
    if (leg.isolation !== undefined) {
      const { workspace, worktree } = leg.isolation;
      if (status === "suspended") {
        heldWorktrees.set(session.id, { parentSessionId: leg.parentSessionId, child: leg.name, brief: leg.brief, workspace, worktree });
      } else {
        merge = await serialized(() => settle(workspace, leg.name, leg.brief, worktree, status));
        await worktree.dispose({ force: true }).catch(() => undefined);
      }
    }
    if (leg.sync) {
      await recordSuspended(
        leg.parentSession,
        session.id,
        status === "suspended" ? { child: leg.name, delegationId: leg.id, brief: leg.brief } : undefined,
      );
    }
    emit({
      origin: leg.origin,
      phase: "finished",
      status,
      ...(end.usage?.totalTokens === undefined ? {} : { totalTokens: end.usage.totalTokens }),
      sessionId: session.id,
      ...(status === "suspended" && end.pending !== undefined
        ? { approvalIds: end.pending.slice(0, MAX_DELEGATE_STEP_APPROVALS).map((decision) => decision.approvalId) }
        : {}),
    });
    return {
      delegationId: leg.id,
      child: leg.name,
      status,
      // Retained for paging; the tools cap what the parent's context sees.
      text: leg.text.slice(0, ceilings.retainedResultChars),
      turns: leg.turns,
      sessionId: session.id,
      ...(end.runId === undefined ? {} : { runId: end.runId }),
      ...(end.usage === undefined ? {} : { usage: end.usage }),
      ...(end.pending === undefined ? {} : { pending: end.pending }),
      ...(end.error === undefined ? {} : { error: end.error }),
      ...(merge === undefined ? {} : { merge }),
      ...(leg.context === undefined ? {} : { context: leg.context }),
    };
  };

  const originFor = (name: string, id: string, depth: number): EventOrigin => ({
    kind: "prism",
    agent: name,
    agentId: childAgentId(name),
    delegationId: id,
    depth,
  });

  const failedOutcome = (id: string, name: string, controller: AbortController, turns: number, error: unknown): DelegationOutcome => ({
    delegationId: id,
    child: name,
    status: controller.signal.aborted ? "cancelled" : "failed",
    text: "",
    turns,
    error: error instanceof Error ? error.message : "Delegation failed",
  });

  const run = async (
    id: string,
    name: string,
    child: DelegateChildConfig,
    input: DelegateStartInput,
    controller: AbortController,
  ): Promise<DelegationOutcome> => {
    let session: Session | undefined;
    let isolation: { workspace: IsolationWorkspace; worktree: IsolatedWorktree } | undefined;
    let settled = false;
    let watcher: ReturnType<typeof watch> | undefined;
    // The child's origin (K3): the delegate reports it instead of a bare `child` field, so a UI routes a
    // subagent's activity with the same code it uses for a vendor agent.
    const origin = originFor(name, id, depthOf(input.session) + 1);
    const brief = input.input.trim().split("\n")[0]?.trim() ?? "";
    try {
      emit({ origin, phase: "started" });
      const context = resolveChildContext(child.context);
      // A child that is configured to see the conversation never runs blind: without a session it fails.
      if (context.mode !== "none" && input.session === undefined) {
        throw new DelegateError(
          `context_unavailable: child ${name} is configured with context ${JSON.stringify(context.mode)} but the delegation has no session`,
        );
      }
      // Assembled (and checked) before the child opens, so a bad config leaves no session behind.
      const options = childRunOptions(name, child, input, controller.signal, "run");
      const seeded =
        context.mode === "none" || input.session === undefined
          ? undefined
          : await buildSeededContext({
              prism,
              session: input.session,
              model: seedModel(child.model ?? input.session.model),
              context,
            }).catch((error: unknown) => {
              throw new DelegateError(`context_unavailable: ${error instanceof Error ? error.message : String(error)}`);
            });
      const workspace = child.isolation === "worktree" ? prism.services.consume<IsolationWorkspace>("workspace") : undefined;
      if (child.isolation === "worktree" && workspace === undefined) {
        throw new DelegateError(
          `isolation_unavailable: child ${name} has no "workspace" service; load a package that provides one, for example @arnilo/prism-tools/coding with workspace.enabled`,
        );
      }
      session = await prism.sessions.open({
        parent: { sessionId: input.parentSessionId, delegationId: id },
        ...(seeded === undefined ? {} : { seed: seeded.seed }),
      });
      if (workspace !== undefined) isolation = { workspace, worktree: await createWorktree(workspace, session.id) };
      watcher = watch(session, origin, child.report ?? "on-complete", input.parentSessionId);
      const result = await session.run(input.input, options);
      await session.close();
      await watcher.done;
      settled = true;
      return await finishLeg({
        id,
        name,
        brief,
        parentSessionId: input.parentSessionId,
        ...(input.session === undefined ? {} : { parentSession: input.session }),
        sync: input.mode === "sync",
        session,
        end: {
          status: result.status,
          runId: result.runId,
          ...(result.usage === undefined ? {} : { usage: result.usage }),
          ...(result.pending === undefined ? {} : { pending: result.pending }),
          ...(result.error === undefined ? {} : { error: result.error.message }),
        },
        text: result.text,
        turns: watcher.turns,
        controller,
        origin,
        ...(isolation === undefined ? {} : { isolation }),
        ...(seeded === undefined ? {} : { context: seeded.used }),
      });
    } catch (error) {
      emit({ origin, phase: "error" });
      if (!settled && isolation !== undefined) await isolation.worktree.dispose({ force: true }).catch(() => undefined);
      return failedOutcome(id, name, controller, watcher?.turns ?? 0, error);
    } finally {
      slots.release();
      await session?.close().catch(() => undefined);
    }
  };

  /** Resumes a suspended sync child through the parent's `resumeNested`; reopens it from the store when it is not open. */
  const resume = async (input: DelegateResumeInput): Promise<DelegationOutcome> => {
    const record = input.session === undefined ? undefined : suspendedState.get(input.session)[input.childSessionId];
    if (record === undefined) throw new DelegateError(`Unknown suspended child session ${input.childSessionId}`);
    const name = record.child;
    const child = Object.hasOwn(children, name) ? children[name] : undefined;
    if (child === undefined) throw new DelegateError(`Child ${name} is no longer configured`);
    const held = heldWorktrees.get(input.childSessionId);
    // Fail closed: a resumed isolated child must not write into the parent's tree.
    if (child.isolation === "worktree" && held === undefined) {
      throw new DelegateError(
        `isolation_unavailable: child ${name}'s worktree did not survive; its branch is kept, and the child cannot resume outside it`,
      );
    }
    const controller = new AbortController();
    if (input.signal) {
      if (input.signal.aborted) controller.abort(input.signal.reason);
      else input.signal.addEventListener("abort", () => controller.abort(input.signal?.reason), { once: true });
    }
    const origin = originFor(name, record.delegationId, depthOf(input.session) + 1);
    let session: Session | undefined;
    let watcher: ReturnType<typeof watch> | undefined;
    // A resume continues a call that already holds its place in the round: it takes a slot without waiting.
    slots.force();
    const done = (async () => {
      try {
        const options = childRunOptions(name, child, input, controller.signal, "resume");
        session = await prism.sessions.open({ parent: { sessionId: input.parentSessionId }, id: input.childSessionId });
        watcher = watch(session, origin, child.report ?? "on-complete", input.parentSessionId);
        let end: ChildEnd = { status: "failed", error: "The child's resume ended without a result" };
        for await (const event of session.resume(input.decisions, options)) {
          if (event.type === "run.completed")
            end = { status: event.status, runId: event.runId, ...(event.usage === undefined ? {} : { usage: event.usage }) };
          else if (event.type === "run.suspended")
            end = { status: "suspended", runId: event.runId, pending: event.interruption.pendingDecisions ?? [] };
          else if (event.type === "run.failed")
            end = { status: "failed", ...(event.runId === undefined ? {} : { runId: event.runId }), error: event.error.message };
        }
        const text = end.status === "suspended" ? "" : await lastAssistantText(session);
        await session.close();
        await watcher.done;
        return await finishLeg({
          id: record.delegationId,
          name,
          brief: record.brief,
          parentSessionId: input.parentSessionId,
          ...(input.session === undefined ? {} : { parentSession: input.session }),
          sync: true,
          session,
          end,
          text,
          turns: watcher.turns,
          controller,
          origin,
          ...(held === undefined ? {} : { isolation: { workspace: held.workspace, worktree: held.worktree } }),
        });
      } catch (error) {
        emit({ origin, phase: "error" });
        return failedOutcome(record.delegationId, name, controller, watcher?.turns ?? 0, error);
      } finally {
        slots.release();
        await session?.close().catch(() => undefined);
      }
    })();
    delegations.set(record.delegationId, {
      id: record.delegationId,
      child: name,
      parentSessionId: input.parentSessionId,
      controller,
      done,
    });
    return done;
  };

  // The parent session's end releases its delegations: a map entry is only useful while it can be waited on. A held
  // worktree whose child never resumed keeps its branch (its work is committed there) and is released.
  prism.hooks.on("session.closed", async (event) => {
    for (const [id, delegation] of delegations) if (delegation.parentSessionId === event.sessionId) delegations.delete(id);
    for (const [childSessionId, held] of heldWorktrees) {
      if (held.parentSessionId !== event.sessionId) continue;
      heldWorktrees.delete(childSessionId);
      await serialized(() => settle(held.workspace, held.child, held.brief, held.worktree, "suspended")).catch(() => undefined);
      await held.worktree.dispose({ force: true }).catch(() => undefined);
    }
  });

  return {
    /** Visible children only: a hidden child is absent from the tool's `child` enum. */
    childNames: Object.keys(children).filter((name) => !isHidden(children[name] as DelegateChildConfig)),
    description,
    resultMaxChars,
    /**
     * Starts one delegation once a slot is free. A call over `maxConcurrent` waits up to `queueTimeoutMs` in call order;
     * an async call returns `running` only after it holds its slot.
     */
    async start(
      input: DelegateStartInput,
    ): Promise<DelegationOutcome | { readonly delegationId: string; readonly status: "running"; readonly child: string }> {
      const child = Object.hasOwn(children, input.child) ? children[input.child] : undefined;
      if (!child || (isHidden(child) && input.allowHidden !== true)) throw new DelegateError("Unknown child");
      // Fail closed even when a `when` predicate was bypassed: the caller's session is already as deep as allowed.
      const parentDepth = depthOf(input.session);
      if (parentDepth >= maxDepth) {
        throw new DelegateError(`depth_exceeded: this session is at depth ${parentDepth} and maxDepth is ${maxDepth}`);
      }
      await slots.acquire(input.signal === undefined ? {} : { signal: input.signal });
      const id = `dlg_${++sequence}_${crypto.randomUUID().slice(0, 8)}`;
      const controller = new AbortController();
      // A sync delegation is part of the calling tool call, so that call's abort cancels it. An async one
      // outlives the call and ends with the parent session, tracked as that session's background work.
      const detached = input.mode === "async";
      if (!detached && input.signal) {
        if (input.signal.aborted) controller.abort(input.signal.reason);
        else input.signal.addEventListener("abort", () => controller.abort(input.signal?.reason), { once: true });
      }
      const announce = detached && input.allowHidden !== true ? { announced: false, settled: false } : undefined;
      const done = run(id, input.child, child, input, controller);
      if (announce !== undefined)
        void done.then(() => {
          announce.settled = true;
        });
      delegations.set(id, {
        id,
        child: input.child,
        parentSessionId: input.parentSessionId,
        controller,
        done,
        ...(announce === undefined ? {} : { announce }),
      });
      if (detached)
        input.session?.background(`delegate:${id}`, async (signal) => {
          signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
          await done;
        });
      if (detached) return { delegationId: id, status: "running", child: input.child };
      return done;
    },
    resume,
    async wait(id: string, parentSessionId: string, signal?: AbortSignal): Promise<DelegationOutcome> {
      const delegation = delegations.get(id);
      if (!delegation || delegation.parentSessionId !== parentSessionId) throw new DelegateError("Unknown delegation");
      const outcome = await new Promise<DelegationOutcome>((resolve, reject) => {
        if (signal?.aborted) return reject(new DelegateError("Wait aborted"));
        signal?.addEventListener("abort", () => reject(new DelegateError("Wait aborted")), { once: true });
        delegation.done.then(resolve, reject);
      });
      return outcome;
    },
    cancel(id: string, parentSessionId: string): "cancelling" | "terminal" {
      const delegation = delegations.get(id);
      if (!delegation || delegation.parentSessionId !== parentSessionId) throw new DelegateError("Unknown delegation");
      // The model chose to stop it: the `run.end` announcement never names it.
      if (delegation.announce !== undefined) delegation.announce.announced = true;
      if (delegation.controller.signal.aborted) return "terminal";
      delegation.controller.abort(new DelegateError("Delegation cancelled"));
      return "cancelling";
    },
    abortAll(): void {
      for (const delegation of delegations.values()) delegation.controller.abort(new DelegateError("Delegate package disposed"));
    },
    /** Drops a delegation whose answer is fully served; its text is the only reason the entry existed. */
    release(id: string, parentSessionId: string): void {
      const delegation = delegations.get(id);
      if (delegation?.parentSessionId === parentSessionId) delegations.delete(id);
    },
    get active(): number {
      return slots.active;
    },
    /** The configured `maxDepth`; a session at this depth or deeper never sees `delegate`. */
    maxDepth,
    /**
     * The async delegations of this session the model has not been told about since they started: still running, or
     * finished and unread. Each is returned once.
     */
    takeUnannounced(parentSessionId: string): readonly { readonly id: string; readonly child: string; readonly settled: boolean }[] {
      const out: { id: string; child: string; settled: boolean }[] = [];
      for (const delegation of delegations.values()) {
        const announce = delegation.announce;
        if (delegation.parentSessionId !== parentSessionId || announce === undefined || announce.announced) continue;
        announce.announced = true;
        out.push({ id: delegation.id, child: delegation.child, settled: announce.settled });
      }
      return out;
    },
  };
}

export type DelegateRuntime = ReturnType<typeof createDelegateRuntime>;
