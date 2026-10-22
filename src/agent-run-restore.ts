/**
 * Session-state restore for a resumed run. The run state a suspension persists carries the pieces of
 * session state the run owned (loaded skills). Both resume entry points, `session.resume` and the
 * checkpoint lifecycle, rebuild a session from it through here, so a resumed run renders what the
 * suspended one did.
 *
 * Keys a 0.12 checkpoint carries for stages the kernel no longer runs (`activatedToolNames`,
 * `attentionSticky`, `attentionFold`, and `guardrailPacks` — moved to `@arnilo/prism-guardrail-packs`
 * in plan 159 Task 5) are simply not read: the run resumes without them instead of failing the load.
 */
import type { StoredAgentRunState } from "./agent-run-state.js";
import type { LoadedSkillBodiesEntry } from "./skill-load.js";

/** The restore surface of a session; `RuntimeAgentSession` implements it. */
export interface RunRestoreTarget {
  restoreLoadedSkills(names: readonly string[]): void;
  restoreLoadedSkillBodies(bodies: readonly LoadedSkillBodiesEntry[]): void;
}

export interface RunRestoreOptions {
  /** The host opted into persisting session state: restore loaded skills. */
  readonly persistSessionState?: boolean;
  /** With `persistSessionState`: restore the exact skill instructions, registry-independently. */
  readonly includeSkillBodies?: boolean;
}

export function restoreRunSessionState(session: RunRestoreTarget, state: StoredAgentRunState, options: RunRestoreOptions): void {
  // Names only; bodies re-resolve from the live registry the next time the model (re)loads them via load_skill.
  if (options.persistSessionState && state.sessionState?.loadedSkillNames) {
    session.restoreLoadedSkills(state.sessionState.loadedSkillNames);
  }
  // Plan 018 Task 6: restore exact instructions so the resumed session renders them without a load_skill round-trip.
  if (options.persistSessionState && options.includeSkillBodies && state.sessionState?.loadedSkillBodies) {
    session.restoreLoadedSkillBodies(state.sessionState.loadedSkillBodies);
  }
}
