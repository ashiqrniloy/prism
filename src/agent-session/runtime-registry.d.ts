/**
 * Per-agent kernel runtime registry (leaf module). Kept free of session imports so
 * `agent-run-state.ts` can read an agent's hook registrations for the durable fingerprint
 * without forming a cycle through `create-agent.ts` → `session.ts`.
 */
import type { Agent, AgentConfig, AgentEvent, Skill, ToolDefinition } from "../contracts.js";
import type { HookBus } from "../hooks/index.js";
import type { LoopStrategy } from "../loop/types.js";
import type { LoadedPackages } from "../packages/loader.js";
import type { SlotRegistry } from "../slots/index.js";
/** Per-agent kernel runtime: the host hook bus and the slot registry. Never public. */
export interface AgentRuntime {
    /** Swapped atomically by `agent.reload()`; sessions re-bind on their next use. */
    hooks: HookBus;
    slots: SlotRegistry;
    /** Loaded packages, their declared capabilities, and status notes. */
    packages: LoadedPackages;
    /** Set for the duration of `agent.reload()`: a run that starts now would see a half-swapped runtime. */
    reloading?: boolean;
    /**
     * Plan 177 Task 5: sessions open on this agent, added when a session opens and dropped by its
     * `close()`. `dispose()` aborts and closes each one. Structural type keeps this leaf session-free.
     */
    readonly openSessions: Set<{
        close(): Promise<void>;
    }>;
    /**
     * Route `hook.error`/`emit` events to the emitting session. The bus is per-agent but events are
     * per-run; the session sets the sink for the duration of its run.
     * ponytail: one sink per agent — concurrent runs on one agent share it; per-run sinks if that matters.
     */
    setEventSink(sink: ((event: AgentEvent) => void) | undefined): void;
    emitAgentEvent?(event: AgentEvent): void;
}
export declare function registerAgentRuntime(agent: Agent, runtime: AgentRuntime): void;
export declare function agentRuntime(agent: Agent): AgentRuntime;
/** Non-throwing lookup for kernel internals that may see a hand-rolled `Agent` object. */
export declare function tryAgentRuntime(agent: Agent): AgentRuntime | undefined;
/** Registration-id marker for session-scoped hooks (session packs), excluded from the fingerprint. */
export declare const SESSION_HOOK_ID_MARKER = "#session-";
/** Whether a registration id belongs to a session-scoped hook (session packs, not agent definition). */
export declare function isSessionScopedHookId(id: string): boolean;
/**
 * Sorted registration ids, owner-scoped. Part of the durable fingerprint (roadmap §2.5).
 * Session-scoped pack hooks (id suffix `#session-<n>`) are run state restored from the checkpoint,
 * not agent definition, so they are excluded or a save/resume would always mismatch.
 */
export declare function agentHookIds(agent: Agent): readonly string[];
/**
 * The loop an agent runs when it is not the kernel default: a direct `AgentConfig.slots.loop`, or the
 * loop a package provided (named by owner, or the only provider). `undefined` means the default loop.
 * Durable fingerprints and the durable-loop check read this, not `config.slots.loop`, so a package's
 * loop is covered too.
 */
export declare function assignedLoop(agent: Agent): LoopStrategy | undefined;
/** Whether packages add or `disable` removes any tool, so the host's own tools are not the whole view. */
export declare function packagesAffectTools(agent: Agent): boolean;
/**
 * The agent's tools: the host's `AgentConfig.tools` plus what packages registered, minus `disable`.
 * `agent.config` stays the host's input and a host registry is never mutated, so every reader goes
 * through here (plan 146 Task 1 A2). The host's own list is returned untouched when nothing merges.
 */
export declare function agentToolList(agent: Agent): readonly ToolDefinition[];
/** The same merge for a config/package pair that is not the agent's committed runtime (reload assembly). */
export declare function toolListFor(config: AgentConfig, packages: LoadedPackages | undefined): readonly ToolDefinition[];
/**
 * `AgentConfig.skills` with package skills merged in and `disable` applied, keeping the host's shape: a
 * registry stays a registry (skills activate on demand) and an array stays an array.
 */
export declare function agentSkillSource(agent: Agent): readonly Skill[];
/** The same merge for a config/package pair that is not the agent's committed runtime (reload assembly). */
export declare function skillSourceFor(config: AgentConfig, packages: LoadedPackages | undefined): readonly Skill[];
/** The package that registered `tool`, when a package did. */
export declare function toolOwner(agent: Agent, tool: string): string | undefined;
