import type { AgentEvent, JsonValue } from "../contracts.js";
/**
 * Kernel-internal test seam: a hook context carries a raw event sink under this symbol so
 * `src/testing` can inject synthetic catalog events. Not exported from any barrel, so no
 * loop, hook, or package can reach it.
 */
export declare const RAW_EMIT: unique symbol;
/**
 * Build the one event a loop or hook may emit: a `package.event` owned by `owner`. A `name` that is a
 * catalog event or hook name (`tool.completed`, `run.started`, …) is rejected, so neither surface can
 * forge a primitive-owned event even through a cast. Redaction runs where the event is dispatched.
 */
export declare function packageEventFor(owner: string, sessionId: string, runId: string, name: string, data: JsonValue): AgentEvent;
