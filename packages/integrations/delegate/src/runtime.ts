import {
  type Agent,
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  type EventOrigin,
  type ModelConfig,
  type ModelRef,
  type HostPort,
  type HostUi,
  type HostUiRequest,
  type HostUiRequestKind,
  type PackageAPI,
  type PackageInstance,
  type PendingDecision,
  type Principal,
  parseModelRef,
  type RunResult,
  type Session,
  type SessionContext,
  type SessionEntry,
  type Skill,
  type Usage,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import type { DelegateChildConfig, DelegateConfig } from "./config.js";
import { DEFAULT_MAX_CONCURRENT } from "./config.js";
import {
  type DelegationMerge,
  type IsolationWorkspace,
  type IsolatedWorktree,
  isolationProbe,
  mergeMessage,
} from "./isolation.js";
import { buildSeededContext, type ContextUsed, resolveChildContext } from "./context.js";
import { HARD_RETAINED_RESULT_CHARS, resolveChildLimits, resolveResultMaxChars } from "./limits.js";
import { type DelegateStepInput, delegateStepData } from "./step.js";

export const DELEGATE_PACKAGE = "@arnilo/prism-delegate";

/** The child agent's id, as `createAgent` builds it; the delegate's `origin.agentId` reports the same value. */
const childAgentId = (name: string) => `delegate-${name}`;

export type DelegationStatus = RunResult["status"] | "cancelled" | "running";

export interface DelegationOutcome {
  readonly delegationId: string;
  readonly child: string;
  readonly status: DelegationStatus;
  readonly text: string;
  /** Provider turns the child completed; `0` when it never started. */
  readonly turns: number;
  readonly usage?: Usage;
  readonly pending?: readonly PendingDecision[];
  readonly error?: string;
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
}

export interface DelegateStartInput {
  readonly child: string;
  readonly input: string;
  readonly mode: "sync" | "async";
  readonly parentSessionId: string;
  readonly parentRunId: string;
  readonly session?: SessionContext;
  readonly principal?: Principal;
  readonly signal?: AbortSignal;
  /** Internal: the `delegate` service may start a configured hidden child; the model-facing tool may not. */
  readonly allowHidden?: boolean;
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

/** The parent's skills the child gets; an unknown name is a configuration error, not a silent drop. */
function selectSkills(all: readonly Skill[], request: DelegateChildConfig["skills"]): readonly Skill[] {
  if (request === "none") return [];
  if (request === undefined || request === "inherit") return all;
  const byName = new Map(all.map((skill) => [skill.name, skill]));
  return request.map((name) => {
    const skill = byName.get(name);
    if (!skill) throw new DelegateError(`Unknown skill for the child: ${name}`);
    return skill;
  });
}

/**
 * Prefixes the child's name into the request's untrusted text. `package`/`sessionId` are kernel-set and the
 * setup-time port carries neither the child's package nor its session, so text is the only attribution left.
 */
function childHostUi(name: string, ui: HostUi): HostUi {
  const label = `[${name}] `;
  const request = <K extends HostUiRequestKind>(input: Extract<HostUiRequest, { kind: K }>) => {
    // `notify` carries `message` instead of `title`; every request's user-visible text is prefixed.
    const prefixed = { ...input } as unknown as Record<string, unknown>;
    for (const key of ["title", "detail", "message"]) {
      if (typeof prefixed[key] === "string") prefixed[key] = `${label}${String(prefixed[key])}`;
    }
    return ui.request(prefixed as unknown as Extract<HostUiRequest, { kind: K }>);
  };
  return { request };
}

/** Binds one worktree to the child's session; a sandboxed service refuses, and that is `isolation_unavailable`. */
async function createWorktree(workspace: IsolationWorkspace, sessionId: string): Promise<IsolatedWorktree> {
  try {
    return await workspace.worktree.create({ sessionId });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: unknown }).code;
    throw new DelegateError(
      code === "workspace_sandbox_unsupported" ? `isolation_unavailable: ${detail}` : `The child's worktree could not be created: ${detail}`,
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
function describeChild(name: string, child: DelegateChildConfig): { line: string; missing: boolean } {
  const explicit = child.description?.trim();
  if (explicit) return { line: explicit, missing: false };
  const first = child.instructions?.trim().split(/(?<=[.!?])\s/)[0]?.trim();
  return first ? { line: first, missing: false } : { line: "(no description)", missing: true };
}

/** One child per delegation, built with `createAgent` over the inherited package instances. */
export function createDelegateRuntime(prism: PackageAPI<DelegateConfig>, resolved?: Readonly<Record<string, DelegateChildConfig>>) {
  const config = prism.config;
  const children = resolved ?? config.children ?? {};
  const hostUi = prism.host.ui;
  // A file's `tools:` list is mapped at setup, but the tools a child can see are the parent's: `RunOptions.tools.only`
  // fails closed on a name the agent does not register, so an unavailable name is dropped once per child instead.
  const availableTools = new Map<string, readonly string[] | undefined>();
  const resolveToolNames = (name: string, only: readonly string[] | undefined): readonly string[] | undefined => {
    if (only === undefined) return undefined;
    if (availableTools.has(name)) return availableTools.get(name);
    const names = new Set(prism.tools.list().map((tool) => tool.name));
    const kept = only.filter((tool) => names.has(tool));
    const dropped = only.filter((tool) => !names.has(tool));
    if (dropped.length > 0)
      prism.status.note(
        kept.length === 0 ? "warn" : "info",
        `Delegate child ${name} asks for tools this agent does not register and they were dropped: ${dropped.join(", ")}.`,
      );
    availableTools.set(name, kept);
    return kept;
  };
  const maxConcurrent = config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const delegations = new Map<string, Delegation>();
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
  let active = 0;
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
    if (entry.context.mode === "lastTurns" && entry.context.clamped)
      prism.status.note("info", `Delegate child ${entry.name} asks for more context than the hard cap; using ${entry.context.maxChars} chars.`);
  }
  const resultMaxChars: Record<string, number> = Object.fromEntries(
    Object.entries(children).map(([name, child]) => [name, resolveResultMaxChars(child.resultMaxChars)]),
  );

  const emit = (input: DelegateStepInput): void => {
    try {
      prism.events.emit("delegate.step", delegateStepData(input));
    } catch {
      // Reporting is advisory and never fails a delegation.
    }
  };

  const childModel = (child: DelegateChildConfig, parent: ModelConfig | undefined): ModelConfig => {
    const ref: ModelRef =
      child.model ??
      parent ??
      (() => {
        throw new DelegateError("No model for the child: set the child's model");
      })();
    return typeof ref === "string" || !("provider" in ref) ? parseModelRef(ref) : (ref as ModelConfig);
  };

  const buildAgent = (
    name: string,
    child: DelegateChildConfig,
    parent: ModelConfig | undefined,
    principal: Principal | undefined,
    probe?: PackageInstance,
    seed?: { readonly sessionId: string; readonly entries: readonly SessionEntry[] },
  ): Promise<Agent> => {
    // `instances()` hands back frozen records; the definition rebuilds a loadable instance bound to the same config.
    const inherited: readonly PackageInstance[] = prism.packages
      .instances(child.inherit)
      .map((instance) => instance.definition((instance.config ?? {}) as never, { optional: instance.optional }));
    const model = childModel(child, parent);
    // The child reaches the parent's providers through the parent's model resolution, so it holds no credential.
    const bridge = providerPackage("prism-delegate-provider-bridge", [
      {
        id: model.provider,
        generate: (request) => {
          const { model: _ignored, ...rest } = request;
          return prism.models.client({ provider: model.provider, model: request.model.model }).generate(rest);
        },
      },
    ]);
    return createAgent({
      id: childAgentId(name),
      model: { provider: model.provider, model: model.model },
      instructions: childInstructions(child.instructions),
      slots: { store: seed === undefined ? createMemorySessionStore() : createMemorySessionStore(seed.entries) },
      ...(config.ownership === undefined ? {} : { ownership: config.ownership }),
      // The isolation probe goes last: services are provided during `setup`, so load order is what lets
      // it see the inherited coding instance's `workspace` service.
      packages: [bridge, ...inherited, ...(probe === undefined ? [] : [probe])],
      limits: resolveChildLimits(child.limits),
      skills: { add: selectSkills(prism.skills.list(), child.skills) },
      ...(hostUi === undefined ? {} : { host: { ui: childHostUi(name, hostUi) } as HostPort }),
      ...(principal === undefined ? {} : { principal }),
    });
  };

  const run = async (
    id: string,
    name: string,
    child: DelegateChildConfig,
    input: DelegateStartInput,
    controller: AbortController,
  ): Promise<DelegationOutcome> => {
    let agent: Agent | undefined;
    let session: Session | undefined;
    let worktree: IsolatedWorktree | undefined;
    let turns = 0;
    let usedContext: ContextUsed | undefined;
    const isolated = child.isolation === "worktree";
    const report = child.report ?? "on-complete";
    // The child's origin (K3): the delegate reports it instead of a bare `child` field, so a UI routes a
    // subagent's activity with the same code it uses for a vendor agent.
    const origin: EventOrigin = { kind: "prism", agent: name, agentId: childAgentId(name), delegationId: id, depth: 1 };
    try {
      emit({ origin, phase: "started" });
      const context = resolveChildContext(child.context);
      // A child that is configured to see the conversation never runs blind: without a session it fails.
      if (context.mode !== "none" && input.session === undefined) {
        throw new DelegateError(`context_unavailable: child ${name} is configured with context ${JSON.stringify(context.mode)} but the delegation has no session`);
      }
      const seeded =
        context.mode === "none" || input.session === undefined
          ? undefined
          : await buildSeededContext({
              prism,
              session: input.session,
              model: childModel(child, input.session.model),
              context,
              ownership: config.ownership,
              ...(controller.signal === undefined ? {} : {}),
            }).catch((error: unknown) => {
              throw new DelegateError(`context_unavailable: ${error instanceof Error ? error.message : String(error)}`);
            });
      usedContext = seeded?.used;
      const capture: { workspace?: IsolationWorkspace } = {};
      agent = await buildAgent(name, child, input.session?.model, input.principal, isolated ? isolationProbe(capture) : undefined, seeded);
      if (isolated && capture.workspace === undefined) {
        throw new DelegateError(
          `isolation_unavailable: child ${name} has no "workspace" service; inherit a package that provides one, for example @arnilo/prism-tools-coding with workspace.enabled`,
        );
      }
      session = await agent.session(seeded === undefined ? undefined : { id: seeded.sessionId, create: true });
      if (capture.workspace !== undefined) worktree = await createWorktree(capture.workspace, session.id);
      const events = session.subscribe({ acrossRuns: true });
      const pump = (async () => {
        for await (const event of events as AsyncIterable<AgentEvent>) {
          if (event.type === "turn.completed") {
            turns += 1;
            if (report !== "on-complete") emit({ origin, phase: "milestone", turn: turns });
          } else if (event.type === "tool.completed" && report === "stream") {
            emit({ origin, phase: "milestone", turn: turns });
          }
        }
      })().catch(() => undefined);
      const only = resolveToolNames(name, child.tools?.only);
      const result = await session.run(input.input, {
        signal: controller.signal,
        ...(only === undefined ? {} : { tools: { only } }),
      });
      await session.close();
      await pump;
      const status: DelegationStatus = controller.signal.aborted && result.status !== "suspended" ? "cancelled" : result.status;
      const merge =
        worktree === undefined || capture.workspace === undefined
          ? undefined
          : await serialized(() => settle(capture.workspace as IsolationWorkspace, name, input.input, worktree as IsolatedWorktree, status));
      emit({
        origin,
        phase: "finished",
        status,
        ...(result.usage?.totalTokens === undefined ? {} : { totalTokens: result.usage.totalTokens }),
      });
      return {
        delegationId: id,
        child: name,
        status,
        // Retained for paging; the tools cap what the parent's context sees.
        text: result.text.slice(0, HARD_RETAINED_RESULT_CHARS),
        turns,
        ...(result.usage === undefined ? {} : { usage: result.usage }),
        ...(result.pending === undefined ? {} : { pending: result.pending }),
        ...(result.error === undefined ? {} : { error: result.error.message }),
        ...(merge === undefined ? {} : { merge }),
        ...(usedContext === undefined ? {} : { context: usedContext }),
      };
    } catch (error) {
      emit({ origin, phase: "error" });
      return {
        delegationId: id,
        child: name,
        status: controller.signal.aborted ? "cancelled" : "failed",
        text: "",
        turns,
        error: error instanceof Error ? error.message : "Delegation failed",
      };
    } finally {
      active -= 1;
      // `tools-coding` registers no `onDispose` for active worktrees, so this package owns it: a merged
      // branch is deleted by the service, an unmerged one is kept, and a skipped child's uncommitted edits go.
      await worktree?.dispose({ force: true }).catch(() => undefined);
      await session?.close().catch(() => undefined);
      await agent?.dispose().catch(() => undefined);
    }
  };

  // The parent session's end releases its delegations: a map entry is only useful while it can be waited on.
  prism.hooks.on("session.closed", (event) => {
    for (const [id, delegation] of delegations) if (delegation.parentSessionId === event.sessionId) delegations.delete(id);
  });

  return {
    /** Visible children only: a hidden child is absent from the tool's `child` enum. */
    childNames: Object.keys(children).filter((name) => !isHidden(children[name] as DelegateChildConfig)),
    description,
    resultMaxChars,
    start(
      input: DelegateStartInput,
    ): Promise<DelegationOutcome> | { readonly delegationId: string; readonly status: "running"; readonly child: string } {
      const child = Object.hasOwn(children, input.child) ? children[input.child] : undefined;
      if (!child || (isHidden(child) && input.allowHidden !== true)) throw new DelegateError("Unknown child");
      if (active >= maxConcurrent) throw new DelegateError(`At most ${maxConcurrent} delegations may run at once`);
      const id = `dlg_${++sequence}_${crypto.randomUUID().slice(0, 8)}`;
      const controller = new AbortController();
      // A sync delegation is part of the calling tool call, so that call's abort cancels it. An async one
      // outlives the call and ends with the parent session, tracked as that session's background work.
      const detached = input.mode === "async";
      if (!detached && input.signal) {
        if (input.signal.aborted) controller.abort(input.signal.reason);
        else input.signal.addEventListener("abort", () => controller.abort(input.signal?.reason), { once: true });
      }
      active += 1;
      const done = run(id, input.child, child, input, controller);
      delegations.set(id, { id, child: input.child, parentSessionId: input.parentSessionId, controller, done });
      if (detached)
        input.session?.background(`delegate:${id}`, async (signal) => {
          signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
          await done;
        });
      if (detached) return { delegationId: id, status: "running", child: input.child };
      return done;
    },
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
      return active;
    },
  };
}

export type DelegateRuntime = ReturnType<typeof createDelegateRuntime>;
