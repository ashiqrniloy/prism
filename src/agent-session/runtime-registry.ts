/**
 * Per-agent kernel runtime registry (leaf module). Kept free of session imports so
 * `agent-run-state.ts` can read an agent's hook registrations for the durable fingerprint
 * without forming a cycle through `create-agent.ts` → `session.ts`.
 */
import type { Agent, AgentEvent, Skill, ToolDefinition } from "../contracts.js";
import type { HookBus } from "../hooks/index.js";
import type { LoopStrategy } from "../loop/types.js";
import { PackageLoadError } from "../packages/errors.js";
import type { LoadedPackages } from "../packages/loader.js";
import type { SlotRegistry } from "../slots/index.js";

/** Per-agent kernel runtime: the host hook bus and the slot registry. Never public. */
export interface AgentRuntime {
  readonly hooks: HookBus;
  readonly slots: SlotRegistry;
  /** Loaded packages, their declared capabilities, and status notes. */
  readonly packages: LoadedPackages;
  /**
   * Route `hook.error`/`emit` events to the emitting session. The bus is per-agent but events are
   * per-run; the session sets the sink for the duration of its run.
   * ponytail: one sink per agent — concurrent runs on one agent share it; per-run sinks if that matters.
   */
  setEventSink(sink: ((event: AgentEvent) => void) | undefined): void;
  emitAgentEvent?(event: AgentEvent): void;
}

const runtimes = new WeakMap<Agent, AgentRuntime>();

export function registerAgentRuntime(agent: Agent, runtime: AgentRuntime): void {
  runtimes.set(agent, runtime);
}

export function agentRuntime(agent: Agent): AgentRuntime {
  const runtime = runtimes.get(agent);
  if (!runtime) throw new Error("Agent was not created by createAgent()");
  return runtime;
}

/** Non-throwing lookup for kernel internals that may see a hand-rolled `Agent` object. */
export function tryAgentRuntime(agent: Agent): AgentRuntime | undefined {
  return runtimes.get(agent);
}

/** Registration-id marker for session-scoped hooks (session packs), excluded from the fingerprint. */
export const SESSION_HOOK_ID_MARKER = "#session-";

/** Whether a registration id belongs to a session-scoped hook (session packs, not agent definition). */
export function isSessionScopedHookId(id: string): boolean {
  return id.includes(SESSION_HOOK_ID_MARKER);
}

/**
 * Sorted registration ids, owner-scoped. Part of the durable fingerprint (roadmap §2.5).
 * Session-scoped pack hooks (id suffix `#session-<n>`) are run state restored from the checkpoint,
 * not agent definition, so they are excluded or a save/resume would always mismatch.
 */
export function agentHookIds(agent: Agent): readonly string[] {
  const hooks = tryAgentRuntime(agent)?.hooks;
  return hooks
    ? hooks
        .registrations()
        .filter((registration) => !isSessionScopedHookId(registration.id))
        .map((registration) => registration.id)
        .sort()
    : [];
}

/**
 * The loop an agent runs when it is not the kernel default: a direct `AgentConfig.slots.loop`, or the
 * loop a package provided (named by owner, or the only provider). `undefined` means the default loop.
 * Durable fingerprints and the durable-loop check read this, not `config.slots.loop`, so a package's
 * loop is covered too.
 */
export function assignedLoop(agent: Agent): LoopStrategy | undefined {
  const assigned = agent.config.slots?.loop;
  const slots = tryAgentRuntime(agent)?.slots;
  if (!slots) return typeof assigned === "string" ? undefined : assigned;
  return slots.ownerOf("loop", assigned) === "kernel" ? undefined : slots.resolve("loop", assigned);
}

/** Whether packages add or `disable` removes any tool, so the host's own tools are not the whole view. */
export function packagesAffectTools(agent: Agent): boolean {
  const packages = tryAgentRuntime(agent)?.packages;
  return Boolean(packages && (packages.tools().length > 0 || packages.disabled.tools.size > 0));
}

/**
 * The agent's tools: the host's `AgentConfig.tools` plus what packages registered, minus `disable`.
 * `agent.config` stays the host's input and a host registry is never mutated, so every reader goes
 * through here (plan 146 Task 1 A2). The host's own list is returned untouched when nothing merges.
 */
export function agentToolList(agent: Agent): readonly ToolDefinition[] {
  const host = agent.config.tools?.add ?? [];
  const packages = tryAgentRuntime(agent)?.packages;
  const added = packages?.tools() ?? [];
  const disabled = packages?.disabled.tools;
  if (added.length === 0 && !disabled?.size) return host;
  const kept = host.filter((tool) => !disabled?.has(tool.name));
  const names = new Set(kept.map((tool) => tool.name));
  for (const { owner, tool } of added) {
    // A dynamic host registry can grow a name after the load-time check: fail closed, never replace.
    if (names.has(tool.name)) {
      throw new PackageLoadError("tool_conflict", `Tool ${tool.name} from ${owner} collides with a host tool.`, { package: owner });
    }
    names.add(tool.name);
  }
  return [...kept, ...added.map((entry) => entry.tool)];
}

/**
 * `AgentConfig.skills` with package skills merged in and `disable` applied, keeping the host's shape: a
 * registry stays a registry (skills activate on demand) and an array stays an array.
 */
export function agentSkillSource(agent: Agent): readonly Skill[] {
  const host = agent.config.skills?.add ?? [];
  const packages = tryAgentRuntime(agent)?.packages;
  const added = packages?.skills() ?? [];
  const disabled = packages?.disabled.skills;
  if (added.length === 0 && !disabled?.size) return host;
  const kept = host.filter((skill) => !disabled?.has(skill.name));
  const names = new Set(kept.map((skill) => skill.name));
  for (const skill of added) {
    if (names.has(skill.name)) throw new PackageLoadError("skill_conflict", `Skill ${skill.name} collides with a host skill.`);
    names.add(skill.name);
  }
  return [...kept, ...added];
}

/** The package that registered `tool`, when a package did. */
export function toolOwner(agent: Agent, tool: string): string | undefined {
  return tryAgentRuntime(agent)
    ?.packages.tools()
    .find((entry) => entry.tool.name === tool)?.owner;
}
