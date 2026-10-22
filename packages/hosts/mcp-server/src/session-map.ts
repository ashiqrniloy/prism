import type { HostPort } from "@arnilo/prism";

/** One MCP session bound to the agent session running under it. */
export interface BoundMcpSession {
  /** True only on a 2025-era connection whose client advertised `elicitation.form`. */
  readonly elicitation: boolean;
  elicit(request: ElicitRequest): Promise<ElicitResult>;
}

export interface ElicitRequest {
  readonly kind: "confirm" | "select" | "input";
  readonly title: string;
  readonly detail?: string;
  readonly options?: readonly { readonly value: string; readonly label?: string }[];
}

export type ElicitResult =
  | { readonly status: "answered"; readonly value: boolean | string | readonly string[] }
  | { readonly status: "dismissed" }
  | { readonly status: "unavailable" };

const branded = new WeakSet<object>();
const tables = new WeakMap<object, Map<string, BoundMcpSession>>();

export function brandMcpHost(port: HostPort): void {
  branded.add(port);
  tables.set(port, new Map());
}

export function isMcpHost(port: HostPort | undefined): port is HostPort {
  return port !== undefined && branded.has(port);
}

export function bindMcpSession(port: HostPort | undefined, sessionId: string, bound: BoundMcpSession): void {
  if (!port) return;
  tables.get(port)?.set(sessionId, bound);
}

export function unbindMcpSession(port: HostPort | undefined, sessionId: string): void {
  if (!port) return;
  tables.get(port)?.delete(sessionId);
}

export function boundMcpSession(port: HostPort, sessionId: string | undefined): BoundMcpSession | undefined {
  if (!sessionId) return undefined;
  return tables.get(port)?.get(sessionId);
}
