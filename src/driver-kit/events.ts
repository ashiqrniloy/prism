import { EXTERNAL_ACTIVITY_EVENTS } from "../loop/index.js";

/** The standard `agent.*` package event names. Re-exported from the kernel, never redefined. */
export { EXTERNAL_ACTIVITY_EVENTS };

export type AgentEventName = (typeof EXTERNAL_ACTIVITY_EVENTS)[keyof typeof EXTERNAL_ACTIVITY_EVENTS];

const NAMES: ReadonlySet<string> = new Set(Object.values(EXTERNAL_ACTIVITY_EVENTS));

/** True when `name` is one of the standard `agent.*` event names. */
export function isAgentEventName(name: string): name is AgentEventName {
  return NAMES.has(name);
}

type Guards = { [K in keyof typeof EXTERNAL_ACTIVITY_EVENTS as `is${Capitalize<K>}Event`]: (name: string) => boolean };

/** One guard per standard name, over a `package.event` name: `isSkillEvent("agent.skill")`. */
export const agentEventGuards: Guards = Object.fromEntries(
  Object.entries(EXTERNAL_ACTIVITY_EVENTS).map(([kind, name]) => [
    `is${kind[0]?.toUpperCase()}${kind.slice(1)}Event`,
    (candidate: string) => candidate === name,
  ]),
) as Guards;
