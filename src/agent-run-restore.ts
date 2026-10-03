/**
 * Session-state restore for a resumed run. The run state a suspension persists carries the pieces of
 * session state the run owned (guardrail packs, loaded skills, activated tools, the attention frontier
 * and fold ledger). Both resume entry points, `session.resume` and the checkpoint lifecycle, rebuild a
 * session from it through here, so a resumed run enforces and renders what the suspended one did.
 */
import type { StoredAgentRunState } from "./agent-run-state.js";
import type { AttentionFoldLedger, PersistedAttentionStickyFrontier } from "./attention-compiler.js";
import { parseAttentionStickyFrontier, restoreAttentionFoldLedger } from "./attention-compiler.js";
import type { GuardrailPackRef } from "./contracts.js";
import type { LoadedSkillBodiesEntry } from "./skill-load.js";

/** The restore surface of a session; `RuntimeAgentSession` implements it. */
export interface RunRestoreTarget {
  restoreGuardrailPacks(refs: readonly GuardrailPackRef[], state?: Readonly<Record<string, unknown>>): void;
  restoreLoadedSkills(names: readonly string[]): void;
  restoreActivatedTools(names: readonly string[]): void;
  restoreAttentionSticky(frontier: PersistedAttentionStickyFrontier): void;
  restoreAttentionFold(ledger: AttentionFoldLedger): void;
  restoreLoadedSkillBodies(bodies: readonly LoadedSkillBodiesEntry[]): void;
}

export interface RunRestoreOptions {
  /** The host opted into persisting session state: restore loaded skills, activated tools, and the sticky frontier. */
  readonly persistSessionState?: boolean;
  /** With `persistSessionState`: restore the exact skill instructions, registry-independently. */
  readonly includeSkillBodies?: boolean;
}

export function restoreRunSessionState(session: RunRestoreTarget, state: StoredAgentRunState, options: RunRestoreOptions): void {
  // Plan 104 T2: pack enforcement rides the run state. A run without `persistSessionState` never
  // writes the key, so its presence is the host's opt-in; restore before any turn or fail closed on a mismatch.
  if (state.sessionState?.guardrailPacks) {
    session.restoreGuardrailPacks(state.sessionState.guardrailPacks.packs, state.sessionState.guardrailPacks.state);
  }
  // Names only; bodies re-resolve from the live registry the next time the model (re)loads them via load_skill.
  if (options.persistSessionState && state.sessionState?.loadedSkillNames) {
    session.restoreLoadedSkills(state.sessionState.loadedSkillNames);
  }
  // Plan 041: re-add search-activated tool names (names only; absent tools stay inert until re-searched).
  if (options.persistSessionState && state.sessionState?.activatedToolNames) {
    session.restoreActivatedTools(state.sessionState.activatedToolNames);
  }
  // Plan 074 P3: restore sticky attention mutations so the first turn after a resume keeps its stubs.
  if (options.persistSessionState && state.sessionState?.attentionSticky) {
    const frontier = parseAttentionStickyFrontier(state.sessionState.attentionSticky);
    if (frontier) session.restoreAttentionSticky(frontier);
  }
  // Plan 086 T3: durable folding writes its own ledger (with the frontier it belongs to), so it is
  // restored whenever the run state carries one. Without the frontier the ledger's rows would not be
  // re-applied on an under-ratio turn, so the two ride together.
  if (state.sessionState?.attentionFold) {
    const ledger = restoreAttentionFoldLedger(state.sessionState.attentionFold);
    if (ledger) {
      session.restoreAttentionFold(ledger);
      if (!options.persistSessionState && state.sessionState.attentionSticky) {
        const frontier = parseAttentionStickyFrontier(state.sessionState.attentionSticky);
        if (frontier) session.restoreAttentionSticky(frontier);
      }
    }
  }
  // Plan 018 Task 6: restore exact instructions so the resumed session renders them without a load_skill round-trip.
  if (options.persistSessionState && options.includeSkillBodies && state.sessionState?.loadedSkillBodies) {
    session.restoreLoadedSkillBodies(state.sessionState.loadedSkillBodies);
  }
}
