import type { AgentEvent, JsonValue } from "../contracts.js";
import { HOOK_CATALOG } from "./catalog.js";
import { HookError } from "./errors.js";

const MAX_EVENT_NAME = 128;

/**
 * Kernel-internal test seam: a hook context carries a raw event sink under this symbol so
 * `src/testing` can inject synthetic catalog events. Not exported from any barrel, so no
 * loop, hook, or package can reach it.
 */
export const RAW_EMIT = Symbol("prism.hooks.rawEmit");

/**
 * Build the one event a loop or hook may emit: a `package.event` owned by `owner`. A `name` that is a
 * catalog event or hook name (`tool.completed`, `run.started`, …) is rejected, so neither surface can
 * forge a primitive-owned event even through a cast. Redaction runs where the event is dispatched.
 */
export function packageEventFor(owner: string, sessionId: string, runId: string, name: string, data: JsonValue): AgentEvent {
  if (typeof name !== "string" || name.length === 0 || name.length > MAX_EVENT_NAME) {
    throw new TypeError(`package event name must be 1-${MAX_EVENT_NAME} characters`);
  }
  if (Object.hasOwn(HOOK_CATALOG, name)) {
    throw new HookError(`emit: "${name}" is a catalog event and cannot be emitted`, { owner, hook: name, code: "emit_reserved_name" });
  }
  return { type: "package.event", sessionId, runId, package: owner, name, data };
}
