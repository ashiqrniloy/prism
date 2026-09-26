import type { JsonObject } from "@arnilo/prism";
import { defineWorkflow } from "./define.js";
import { WorkflowDefinitionError } from "./errors.js";
import { routeNode } from "./nodes.js";
import type { ScopedWorkflowNodeContext } from "./scoped.js";
import type { RouteNodeDefinition, WorkflowDefinition, WorkflowLimits, WorkflowNodeContext, WorkflowNodeDefinition } from "./types.js";

/** Typed event transmitted across agents in an event-driven swarm workflow. */
export interface SwarmEvent<TPayload = unknown> {
  /** Topic identifier (e.g., "task:billing", "incident:p1", "review:request"). */
  readonly topic: string;
  /** Identifier of the publishing agent or component. */
  readonly sender: string;
  /** Optional structured payload associated with the event. */
  readonly payload?: TPayload;
  /** Optional ISO timestamp marking when the event was produced. */
  readonly timestamp?: string;
}

/** Access the pending swarm events array from root state. */
export function getSwarmEvents(ctx: WorkflowNodeContext): readonly SwarmEvent[] {
  const root = (ctx as ScopedWorkflowNodeContext).rootState ?? ctx.state ?? {};
  if (Array.isArray(root.__swarmActiveEvents) && root.__swarmActiveEvents.length > 0) {
    return root.__swarmActiveEvents as unknown as readonly SwarmEvent[];
  }
  if (Array.isArray(root.__swarmEvents)) {
    return root.__swarmEvents as unknown as readonly SwarmEvent[];
  }
  return [];
}

/** Access the active swarm events currently dispatched to this superstep wave. */
export function getActiveSwarmEvents(ctx: WorkflowNodeContext): readonly SwarmEvent[] {
  const root = (ctx as ScopedWorkflowNodeContext).rootState ?? ctx.state ?? {};
  if (Array.isArray(root.__swarmActiveEvents)) {
    return root.__swarmActiveEvents as unknown as readonly SwarmEvent[];
  }
  return [];
}

/** Finds the first swarm event matching a topic in the current event context. */
export function findSwarmEvent<TPayload = unknown>(ctx: WorkflowNodeContext, topic: string): SwarmEvent<TPayload> | undefined {
  const events = getSwarmEvents(ctx);
  return events.find((e) => matchSwarmTopic(topic, e.topic)) as SwarmEvent<TPayload> | undefined;
}

/**
 * Publish a typed topic event to the swarm event stream.
 * Safely handles both regular and scoped workflow contexts by targeting root state.
 */
export async function publishSwarmEvent<TPayload = unknown>(ctx: WorkflowNodeContext, event: SwarmEvent<TPayload>): Promise<void> {
  if (!event || typeof event !== "object" || !event.topic || typeof event.topic !== "string") {
    throw new WorkflowDefinitionError("SwarmEvent requires a non-empty string topic");
  }
  if (!event.sender || typeof event.sender !== "string") {
    throw new WorkflowDefinitionError("SwarmEvent requires a non-empty string sender");
  }

  const scopedCtx = ctx as ScopedWorkflowNodeContext;
  const updateFn = scopedCtx.updateRootState ? scopedCtx.updateRootState.bind(scopedCtx) : ctx.updateState.bind(ctx);
  const root = scopedCtx.rootState ?? ctx.state ?? {};
  const currentPending = Array.isArray(root.__swarmEvents) ? (root.__swarmEvents as unknown as readonly SwarmEvent[]) : [];
  const stampedEvent: SwarmEvent<TPayload> = {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  };

  await updateFn({ __swarmEvents: [...currentPending, stampedEvent] as unknown as import("@arnilo/prism").JsonValue }, { mode: "merge" });
}

/** Clear published swarm events from root state to conclude an event routing round. */
export async function clearSwarmEvents(ctx: WorkflowNodeContext): Promise<void> {
  const scopedCtx = ctx as ScopedWorkflowNodeContext;
  const updateFn = scopedCtx.updateRootState ? scopedCtx.updateRootState.bind(scopedCtx) : ctx.updateState.bind(ctx);
  await updateFn({ __swarmEvents: [], __swarmActiveEvents: [] }, { mode: "merge" });
}

/** Matches a swarm event topic against a subscription pattern (exact or wildcard suffix '*'). */
export function matchSwarmTopic(pattern: string, topic: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return topic.startsWith(prefix);
  }
  return pattern === topic;
}

export interface SwarmRouterConfig {
  /**
   * Topic subscriptions mapping pattern or exact topic to array of target agent node IDs.
   * e.g. { "ticket:billing": ["billingSpecialist"], "ticket:*": ["auditLogger"] }
   */
  readonly subscriptions: Readonly<Record<string, readonly string[]>>;
  /**
   * Optional custom extractor for events to route on this step.
   * Defaults to reading pending events from root state.
   */
  readonly getEvents?: (ctx: WorkflowNodeContext) => readonly SwarmEvent[] | Promise<readonly SwarmEvent[]>;
  /**
   * Optional default target nodes to activate if no events match or no events were published.
   */
  readonly defaultTargets?: readonly string[] | ((ctx: WorkflowNodeContext) => readonly string[] | Promise<readonly string[]>);
  /**
   * Whether to clear or transition the routed events on route.
   * Defaults to true to prevent unbounded loops on identical events.
   */
  readonly clearEventsOnRoute?: boolean;
}

/**
 * Creates a route node configured for swarm event routing.
 * Inspects swarm events, matches topics against subscriptions, and routes to subscriber nodes.
 */
export function swarmRouterNode(config: SwarmRouterConfig): RouteNodeDefinition {
  if (!config || typeof config.subscriptions !== "object" || config.subscriptions === null) {
    throw new WorkflowDefinitionError("swarmRouterNode requires a subscriptions record");
  }

  return routeNode({
    activation: "any",
    select: async (ctx: WorkflowNodeContext): Promise<readonly string[]> => {
      const rootState = (ctx as ScopedWorkflowNodeContext).rootState ?? ctx.state ?? {};
      const pendingEvents = Array.isArray(rootState.__swarmEvents) ? (rootState.__swarmEvents as unknown as SwarmEvent[]) : [];
      const events = config.getEvents ? await config.getEvents(ctx) : pendingEvents;
      const initialRouted = Boolean(rootState.__swarmInitialRouted);
      const scopedCtx = ctx as ScopedWorkflowNodeContext;
      const updateFn = scopedCtx.updateRootState ? scopedCtx.updateRootState.bind(scopedCtx) : ctx.updateState.bind(ctx);

      if (events.length === 0) {
        await updateFn({ __swarmActiveEvents: [] }, { mode: "merge" });
        if (!initialRouted && config.defaultTargets) {
          await updateFn({ __swarmInitialRouted: true }, { mode: "merge" });
          const targets = typeof config.defaultTargets === "function" ? await config.defaultTargets(ctx) : config.defaultTargets;
          return [...new Set(targets)].sort();
        }
        return [];
      }

      const targets = new Set<string>();
      for (const event of events) {
        for (const [pattern, subscribers] of Object.entries(config.subscriptions)) {
          if (matchSwarmTopic(pattern, event.topic)) {
            for (const sub of subscribers) {
              if (sub) targets.add(sub);
            }
          }
        }
      }

      if (config.clearEventsOnRoute !== false) {
        await updateFn(
          {
            __swarmActiveEvents: [...events] as unknown as import("@arnilo/prism").JsonValue,
            __swarmEvents: [],
            __swarmInitialRouted: true,
          },
          { mode: "merge" },
        );
      } else if (!initialRouted) {
        await updateFn({ __swarmInitialRouted: true }, { mode: "merge" });
      }

      if (targets.size === 0 && config.defaultTargets) {
        const fallback = typeof config.defaultTargets === "function" ? await config.defaultTargets(ctx) : config.defaultTargets;
        for (const fb of fallback) {
          if (fb) targets.add(fb);
        }
      }

      return [...targets].sort();
    },
  });
}

export interface DefineSwarmWorkflowInput {
  /** Unique identifier for the swarm workflow. */
  readonly id: string;
  /** Workflow schema revision. Defaults to "1". */
  readonly revision?: string;
  /** Maximum number of superstep waves allowed before throwing WorkflowSuperstepLimitError. */
  readonly maxSupersteps: number;
  /** Optional custom ID for the central router node. Defaults to "router". */
  readonly routerId?: string;
  /** Map of agent nodes participating in the swarm. */
  readonly agents: Readonly<Record<string, WorkflowNodeDefinition>>;
  /** Topic subscriptions routing published events to designated agent nodes. */
  readonly subscriptions: Readonly<Record<string, readonly string[]>>;
  /** Optional initial default target agents if the swarm is launched with no initial events. */
  readonly defaultTargets?: readonly string[];
  /** Optional initial workflow state. */
  readonly initialState?: JsonObject;
  /** Optional resource and execution limits. */
  readonly limits?: WorkflowLimits;
}

/**
 * Builds a cyclic event-driven multi-agent swarm workflow.
 * Connects the declared agents to a central swarm router node using `activation: "any"`
 * so agents activate whenever matching topic events are published.
 */
export function defineSwarmWorkflow(input: DefineSwarmWorkflowInput): WorkflowDefinition {
  if (!input?.id) {
    throw new WorkflowDefinitionError("defineSwarmWorkflow requires an id");
  }
  if (!input.maxSupersteps || typeof input.maxSupersteps !== "number" || input.maxSupersteps < 1) {
    throw new WorkflowDefinitionError("defineSwarmWorkflow requires maxSupersteps >= 1");
  }
  if (!input.agents || Object.keys(input.agents).length === 0) {
    throw new WorkflowDefinitionError("defineSwarmWorkflow requires at least one agent");
  }

  const routerId = input.routerId ?? "router";
  if (input.agents[routerId]) {
    throw new WorkflowDefinitionError(`Swarm agent name cannot collide with routerId "${routerId}"`);
  }

  const agentNames = new Set(Object.keys(input.agents));

  // Validate all subscription targets exist
  for (const [pattern, subscribers] of Object.entries(input.subscriptions ?? {})) {
    for (const sub of subscribers) {
      if (!agentNames.has(sub)) {
        throw new WorkflowDefinitionError(`Swarm subscription "${pattern}" targets unknown agent "${sub}"`);
      }
    }
  }

  // Validate default targets exist
  for (const defTarget of input.defaultTargets ?? []) {
    if (!agentNames.has(defTarget)) {
      throw new WorkflowDefinitionError(`Swarm defaultTargets specifies unknown agent "${defTarget}"`);
    }
  }

  const router = swarmRouterNode({
    subscriptions: input.subscriptions ?? {},
    defaultTargets: input.defaultTargets,
    clearEventsOnRoute: true,
  });

  const nodes: Record<string, WorkflowNodeDefinition> = {
    [routerId]: router,
    ...input.agents,
  };

  const edges: [string, string][] = [];
  for (const agentId of Object.keys(input.agents)) {
    edges.push([routerId, agentId]);
    edges.push([agentId, routerId]);
  }

  return defineWorkflow({
    id: input.id,
    revision: input.revision ?? "1",
    nodes,
    edges,
    limits: {
      ...input.limits,
      maxSupersteps: input.maxSupersteps,
    },
    state: input.initialState ? { initial: input.initialState } : undefined,
  });
}
