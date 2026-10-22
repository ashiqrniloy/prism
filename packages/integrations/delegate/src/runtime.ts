import {
  type Agent,
  type AgentEvent,
  createAgent,
  createMemorySessionStore,
  type EventOrigin,
  type ModelConfig,
  type ModelRef,
  type PackageAPI,
  type PackageInstance,
  type PendingDecision,
  type Principal,
  parseModelRef,
  type RunResult,
  type Session,
  type SessionContext,
  type Usage,
} from "@arnilo/prism";
import { providerPackage } from "@arnilo/prism/provider-kit";
import type { DelegateChildConfig, DelegateConfig } from "./config.js";
import { DEFAULT_MAX_CONCURRENT } from "./config.js";
import { resolveChildLimits } from "./limits.js";
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
  readonly usage?: Usage;
  readonly pending?: readonly PendingDecision[];
  readonly error?: string;
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
}

export class DelegateError extends Error {
  readonly code = "ERR_PRISM_DELEGATE";
  constructor(message: string) {
    super(message);
    this.name = "DelegateError";
  }
}

/** One child per delegation, built with `createAgent` over the inherited package instances. */
export function createDelegateRuntime(prism: PackageAPI<DelegateConfig>) {
  const config = prism.config;
  const children = config.children ?? {};
  const maxConcurrent = config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const delegations = new Map<string, Delegation>();
  let sequence = 0;
  let active = 0;

  const emit = (input: DelegateStepInput): void => {
    try {
      prism.events.emit("delegate.step", delegateStepData(input));
    } catch {
      // Reporting is advisory and never fails a delegation.
    }
  };

  const buildAgent = (
    name: string,
    child: DelegateChildConfig,
    parent: ModelConfig | undefined,
    principal: Principal | undefined,
  ): Promise<Agent> => {
    // `instances()` hands back frozen records; the definition rebuilds a loadable instance bound to the same config.
    const inherited: readonly PackageInstance[] = prism.packages
      .instances(child.inherit)
      .map((instance) => instance.definition((instance.config ?? {}) as never, { optional: instance.optional }));
    const ref: ModelRef =
      child.model ??
      parent ??
      (() => {
        throw new DelegateError("No model for the child: set the child's model");
      })();
    const model: ModelConfig = typeof ref === "string" || !("provider" in ref) ? parseModelRef(ref) : (ref as ModelConfig);
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
      ...(child.instructions === undefined ? {} : { instructions: child.instructions }),
      slots: { store: createMemorySessionStore() },
      packages: [bridge, ...inherited],
      limits: resolveChildLimits(child.limits, child.budgetShare),
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
    let turns = 0;
    const report = child.report ?? "on-complete";
    // The child's origin (K3): the delegate reports it instead of a bare `child` field, so a UI routes a
    // subagent's activity with the same code it uses for a vendor agent.
    const origin: EventOrigin = { kind: "prism", agent: name, agentId: childAgentId(name), delegationId: id, depth: 1 };
    try {
      emit({ origin, phase: "started" });
      agent = await buildAgent(name, child, input.session?.model, input.principal);
      session = await agent.session();
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
      const result = await session.run(input.input, {
        signal: controller.signal,
        ...(child.tools?.only === undefined ? {} : { tools: { only: child.tools.only } }),
      });
      await session.close();
      await pump;
      const status: DelegationStatus = controller.signal.aborted && result.status !== "suspended" ? "cancelled" : result.status;
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
        text: result.text,
        ...(result.usage === undefined ? {} : { usage: result.usage }),
        ...(result.pending === undefined ? {} : { pending: result.pending }),
        ...(result.error === undefined ? {} : { error: result.error.message }),
      };
    } catch (error) {
      emit({ origin, phase: "error" });
      return {
        delegationId: id,
        child: name,
        status: controller.signal.aborted ? "cancelled" : "failed",
        text: "",
        error: error instanceof Error ? error.message : "Delegation failed",
      };
    } finally {
      active -= 1;
      await session?.close().catch(() => undefined);
      await agent?.dispose().catch(() => undefined);
    }
  };

  return {
    childNames: Object.keys(children),
    start(
      input: DelegateStartInput,
    ): Promise<DelegationOutcome> | { readonly delegationId: string; readonly status: "running"; readonly child: string } {
      const child = Object.hasOwn(children, input.child) ? children[input.child] : undefined;
      if (!child) throw new DelegateError("Unknown child");
      if (active >= maxConcurrent) throw new DelegateError(`At most ${maxConcurrent} delegations may run at once`);
      const id = `dlg_${++sequence}_${crypto.randomUUID().slice(0, 8)}`;
      const controller = new AbortController();
      const lifetime = child.lifetime ?? "task";
      const detached = lifetime === "session";
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
      if (input.mode === "async" || detached) return { delegationId: id, status: "running", child: input.child };
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
    get active(): number {
      return active;
    },
  };
}

export type DelegateRuntime = ReturnType<typeof createDelegateRuntime>;
