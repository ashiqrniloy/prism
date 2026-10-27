import type { ModelConfig } from "./contracts.js";
import type { SessionEntry } from "./contracts-core/session.js";
/**
 * The session as a package sees it (roadmap §2.6): carried as `HookContext.session` and handed to
 * `when` predicates and commands. The kernel binds one view per owner, so `background` is checked
 * against the calling package's declared capabilities.
 */
export interface SessionContext {
    readonly id: string;
    /** Opaque host principal; packages own identity enforcement. */
    readonly principal?: import("./contracts-core/principal.js").Principal;
    readonly metadata?: Readonly<Record<string, unknown>>;
    /** The agent's model; absent on a model-less agent. */
    readonly model?: ModelConfig;
    /**
     * The session's current branch as persisted (already redacted). Needs the `"session-state"` capability.
     * One branch read per call and never cached, so read it from a background task or command, not per
     * `context.build`. Called before the session has read its branch, it reads the branch first.
     */
    entries(): Promise<readonly SessionEntry[]>;
    /**
     * Starts a tracked async task. Needs the `"background"` capability. The task receives a signal
     * that aborts when the session closes.
     */
    background(name: string, task: (signal: AbortSignal) => Promise<unknown>): void;
}
