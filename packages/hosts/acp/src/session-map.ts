import type { HostPort } from "@arnilo/prism";

/** One ACP session bound to the connection that owns it. */
export interface BoundAcpSession {
  readonly elicitation: boolean;
  notify(text: string): Promise<void>;
  elicit(request: ElicitRequest): Promise<ElicitResult>;
  /** Unblock a permission wait. The prompt maps the result to `reject_once` and does not run the tool. */
  cancelPermission(): void;
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
const tables = new WeakMap<object, Map<string, BoundAcpSession>>();

export function brandAcpHost(port: HostPort): void {
  branded.add(port);
  tables.set(port, new Map());
}

export function isAcpHost(port: HostPort | undefined): port is HostPort {
  return port !== undefined && branded.has(port);
}

export function bindAcpSession(port: HostPort | undefined, sessionId: string, bound: BoundAcpSession): void {
  if (!port) return;
  tables.get(port)?.set(sessionId, bound);
}

export function unbindAcpSession(port: HostPort | undefined, sessionId: string): void {
  if (!port) return;
  tables.get(port)?.delete(sessionId);
}

export function boundAcpSession(port: HostPort, sessionId: string | undefined): BoundAcpSession | undefined {
  if (!sessionId) return undefined;
  return tables.get(port)?.get(sessionId);
}
