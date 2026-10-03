import type { AgentEventPayload } from "../contracts.js";
import { type DecideHookName, HOOK_KINDS, type HookKind, type HookName, type NamedHookName, type ObserveHookName } from "./types.js";

/**
 * Every observe hook name, keyed as a `Record` so a new `AgentEvent` type fails to compile until
 * it is listed. The runtime list is derived from this table.
 */
const OBSERVE_HOOKS: Record<AgentEventPayload["type"], true> = {
  "session.opened": true,
  "session.closed": true,
  "run.started": true,
  "run.completed": true,
  "run.failed": true,
  "run.suspended": true,
  "turn.started": true,
  "turn.completed": true,
  "message.delta": true,
  "message.completed": true,
  "tool.started": true,
  "tool.progress": true,
  "tool.completed": true,
  "decision.pending": true,
  "decision.resolved": true,
  "compaction.started": true,
  "compaction.completed": true,
  "background.started": true,
  "background.completed": true,
  "background.failed": true,
  "hook.error": true,
  "package.status": true,
  "package.event": true,
};
export const OBSERVE_HOOK_NAMES = Object.keys(OBSERVE_HOOKS) as readonly ObserveHookName[];

export interface HookCatalogEntry {
  readonly kind: HookKind;
}

const NAMED_HOOK_CATALOG = Object.fromEntries(
  (Object.entries(HOOK_KINDS) as Array<[NamedHookName, HookKind]>).map(([name, kind]) => [name, { kind }]),
) as Record<NamedHookName, HookCatalogEntry>;

const OBSERVE_HOOK_CATALOG = Object.fromEntries(OBSERVE_HOOK_NAMES.map((name) => [name, { kind: "observe" as const }])) as Record<
  ObserveHookName,
  HookCatalogEntry
>;

/** Frozen catalog: every hook name with its kind. */
export const HOOK_CATALOG: Readonly<Record<HookName, HookCatalogEntry>> = Object.freeze({
  ...NAMED_HOOK_CATALOG,
  ...OBSERVE_HOOK_CATALOG,
});

/** Combination rule ids for decide hooks, kept as data so Phase 2 extends the table, not control flow. */
export type DecideCombination = "any-stop" | "tool-call" | "first-continue" | "any-compact";

export const HOOK_COMBINATION: Readonly<Record<DecideHookName, DecideCombination>> = Object.freeze({
  "turn.before": "any-stop",
  "tool.call": "tool-call",
  "run.end": "first-continue",
  "compaction.when": "any-compact",
});
