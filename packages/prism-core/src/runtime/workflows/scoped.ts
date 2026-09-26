import type { JsonObject } from "@arnilo/prism";
import { WorkflowDefinitionError } from "./errors.js";
import { workflowNode } from "./nodes.js";
import type {
  AgentNodeDefinition,
  ConditionalNodeDefinition,
  FanOutNodeDefinition,
  FunctionNodeDefinition,
  JoinNodeDefinition,
  NestedWorkflowNodeDefinition,
  RouteNodeDefinition,
  ToolNodeDefinition,
  WorkflowDefinition,
  WorkflowNodeContext,
  WorkflowNodeDefinition,
  WorkflowRunResult,
} from "./types.js";

/** Scope identifier validation preventing prototype pollution or invalid path keys. */
export function validateScopeKey(scopeKey: string): void {
  if (
    !scopeKey ||
    typeof scopeKey !== "string" ||
    scopeKey === "__proto__" ||
    scopeKey === "constructor" ||
    scopeKey === "prototype" ||
    !/^[a-zA-Z0-9_-]+$/.test(scopeKey)
  ) {
    throw new WorkflowDefinitionError(`Invalid scope key: "${scopeKey}". Must be a non-empty alphanumeric identifier.`);
  }
}

/** Extended node context providing both the scoped state slice and un-scoped root state. */
export interface ScopedWorkflowNodeContext extends WorkflowNodeContext {
  /** The un-scoped root workflow state dictionary. */
  readonly rootState: Readonly<JsonObject>;
  /** Update the root workflow state dictionary directly. */
  updateRootState(patch: JsonObject, options?: { readonly mode?: "merge" | "replace" }): Promise<Readonly<JsonObject>>;
}

/** Access a typed scoped state slice from root workflow state, defaulting to empty object. */
export function createScopedState<TScoped extends JsonObject = JsonObject>(rootState: JsonObject | undefined, scopeKey: string): TScoped {
  validateScopeKey(scopeKey);
  if (!rootState || typeof rootState !== "object") return {} as TScoped;
  const raw = rootState[scopeKey];
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as TScoped;
  }
  return {} as TScoped;
}

/** Wraps a WorkflowNodeContext so state reads and updates are isolated to `scopeKey`. */
export function createScopedContext(ctx: WorkflowNodeContext, scopeKey: string): ScopedWorkflowNodeContext {
  validateScopeKey(scopeKey);
  const rootState = ctx.state ?? {};
  const scopedState = createScopedState(rootState, scopeKey);

  return {
    ...ctx,
    rootState,
    state: scopedState,
    updateRootState: (patch, options) => ctx.updateState(patch, options),
    async updateState(patch: JsonObject, options?: { readonly mode?: "merge" | "replace" }) {
      const current = createScopedState(ctx.state ?? {}, scopeKey);
      const newScoped = options?.mode === "replace" ? { ...patch } : { ...current, ...patch };
      await ctx.updateState({ [scopeKey]: newScoped }, { mode: "merge" });
      return newScoped;
    },
  };
}

/**
 * Higher-order wrapper that isolates any workflow node definition's state access to `scopeKey`.
 * Inside the wrapped node, `ctx.state` points to `ctx.state[scopeKey]`, `ctx.updateState(patch)`
 * mutates only `scopeKey`, and `ctx.rootState` provides un-scoped read access to the parent state.
 */
export function withNodeScope<TNode extends WorkflowNodeDefinition>(scopeKey: string, node: TNode): TNode {
  validateScopeKey(scopeKey);

  switch (node.kind) {
    case "function": {
      const fnNode = node as FunctionNodeDefinition;
      return {
        ...fnNode,
        scope: scopeKey,
        execute: (ctx: WorkflowNodeContext) => fnNode.execute(createScopedContext(ctx, scopeKey)),
      } as unknown as TNode;
    }

    case "route": {
      const route = node as RouteNodeDefinition;
      return {
        ...route,
        scope: scopeKey,
        select: (ctx: WorkflowNodeContext) => route.select(createScopedContext(ctx, scopeKey)),
      } as unknown as TNode;
    }

    case "conditional": {
      const cond = node as ConditionalNodeDefinition;
      return {
        ...cond,
        scope: scopeKey,
        when: (ctx: WorkflowNodeContext) => cond.when(createScopedContext(ctx, scopeKey)),
      } as unknown as TNode;
    }

    case "tool": {
      const tool = node as ToolNodeDefinition;
      return {
        ...tool,
        scope: scopeKey,
        args: (ctx: WorkflowNodeContext) => tool.args(createScopedContext(ctx, scopeKey)),
        ...(tool.action
          ? { action: (ctx: WorkflowNodeContext, args: JsonObject) => tool.action?.(createScopedContext(ctx, scopeKey), args) }
          : {}),
        ...(tool.approval
          ? {
              approval: {
                ...tool.approval,
                ...(tool.approval.data
                  ? {
                      data: (ctx: WorkflowNodeContext, args: JsonObject) => tool.approval?.data?.(createScopedContext(ctx, scopeKey), args),
                    }
                  : {}),
              },
            }
          : {}),
      } as unknown as TNode;
    }

    case "agent": {
      const ag = node as AgentNodeDefinition;
      return {
        ...ag,
        scope: scopeKey,
        ...(ag.input ? { input: (ctx: WorkflowNodeContext) => ag.input?.(createScopedContext(ctx, scopeKey)) } : {}),
        ...(ag.output
          ? {
              output: (ctx: WorkflowNodeContext & { readonly session: import("@arnilo/prism").AgentSession }) => {
                const scopedCtx = createScopedContext(ctx, scopeKey);
                return ag.output?.(Object.assign(scopedCtx, { session: ctx.session }));
              },
            }
          : {}),
      } as unknown as TNode;
    }

    case "fan_out": {
      const fan = node as FanOutNodeDefinition;
      return {
        ...fan,
        scope: scopeKey,
        items: (ctx: WorkflowNodeContext) => fan.items(createScopedContext(ctx, scopeKey)),
        map: (item: unknown, index: number, ctx: WorkflowNodeContext) => fan.map(item, index, createScopedContext(ctx, scopeKey)),
      } as unknown as TNode;
    }

    case "join": {
      const join = node as JoinNodeDefinition;
      return {
        ...join,
        scope: scopeKey,
        ...(join.reduce
          ? { reduce: (items: readonly unknown[], ctx: WorkflowNodeContext) => join.reduce?.(items, createScopedContext(ctx, scopeKey)) }
          : {}),
      } as unknown as TNode;
    }

    case "workflow": {
      const wf = node as NestedWorkflowNodeDefinition;
      return {
        ...wf,
        scope: scopeKey,
        ...(wf.input ? { input: (ctx: WorkflowNodeContext) => wf.input?.(createScopedContext(ctx, scopeKey)) } : {}),
        ...(wf.output
          ? { output: (res: WorkflowRunResult, ctx: WorkflowNodeContext) => wf.output?.(res, createScopedContext(ctx, scopeKey)) }
          : {}),
      } as unknown as TNode;
    }

    default:
      return { ...node, scope: scopeKey };
  }
}

export interface ScopedSubgraphConfig {
  /** The state key namespace under which the subgraph executes and stores its deliverables. */
  readonly scope: string;
  /** The child workflow definition to run. */
  readonly workflow: WorkflowDefinition;
  /** Optional input mapper passing data to the child workflow; defaults to scoped state. */
  readonly input?: (ctx: ScopedWorkflowNodeContext) => unknown | Promise<unknown>;
  /** Optional output mapper projecting subgraph deliverables back to parent state or return value. */
  readonly output?: (result: WorkflowRunResult, ctx: ScopedWorkflowNodeContext) => unknown | Promise<unknown>;
  readonly activation?: "all" | "any";
  readonly retries?: number;
  readonly timeoutMs?: number;
}

/**
 * Creates a nested workflow node that executes in an isolated state sub-namespace,
 * automatically recording child state changes under `ctx.state[scope]` without
 * polluting sibling keys in parent workflow state.
 */
export function scopedSubgraphNode(config: ScopedSubgraphConfig): NestedWorkflowNodeDefinition {
  const scopeKey = config.scope;
  validateScopeKey(scopeKey);

  return workflowNode({
    scope: scopeKey,
    workflow: config.workflow,
    activation: config.activation,
    retries: config.retries,
    timeoutMs: config.timeoutMs,
    input: async (ctx) => {
      const scopedCtx = createScopedContext(ctx, scopeKey);
      if (config.input) {
        return config.input(scopedCtx);
      }
      return scopedCtx.state;
    },
    output: async (result, ctx) => {
      const scopedCtx = createScopedContext(ctx, scopeKey);
      if (config.output) {
        return config.output(result, scopedCtx);
      }
      return result.outputs;
    },
  });
}
