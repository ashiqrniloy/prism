import type { ModelConfig } from "./contracts.js";

/**
 * The session as a package sees it (roadmap §2.6): carried as `HookContext.session` and handed to
 * `when` predicates and commands. The kernel binds one view per owner, so `background` is checked
 * against the calling package's declared capabilities.
 */
export interface SessionContext {
  readonly id: string;
  /** Opaque host principal; packages own identity enforcement. */
  readonly principal?: import("./identity.js").Principal;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly model: ModelConfig;
  /**
   * Starts a tracked async task. Needs the `"background"` capability. The task receives a signal
   * that aborts when the session closes.
   */
  background(name: string, task: (signal: AbortSignal) => Promise<unknown>): void;
}
