/**
 * The wire contract between the callback broker and `prism relay`. This module has no imports, so the relay
 * loads nothing from the kit or the kernel beyond what it needs to move bytes.
 */

/** The descriptor the broker writes into the run directory before the vendor process starts. */
export const RELAY_DESCRIPTOR_FILE = "relay.json";
/** The per-run Unix socket, created inside the run directory. */
export const RELAY_SOCKET_FILE = "relay.sock";
/** Longest accepted header line, in bytes. */
export const RELAY_MAX_HEADER_BYTES = 1024;
/** Largest accepted hook payload, MCP line, or answer, in bytes. */
export const RELAY_MAX_BODY_BYTES = 1024 * 1024;

/** The first line a client writes on the socket; it selects the route. */
export type RelayChannel = "hook" | "mcp";

/** A hook answer as the relay prints it: `stdout` verbatim, then exit with `exitCode`. */
export interface RelayAnswer {
  readonly exitCode: number;
  readonly stdout: string;
}

/** What the relay prints when it cannot get an answer from the broker. */
export interface RelayDescriptor {
  readonly version: 1;
  readonly socket: string;
  readonly timeoutMs: number;
  readonly failClosed: RelayAnswer;
}

/** One MCP response on the socket. An empty `body` writes nothing to the client (a notification). */
export interface RelayMcpFrame {
  readonly status: number;
  readonly body: string;
}

export function relayHeader(channel: RelayChannel): string {
  return `${JSON.stringify({ channel })}\n`;
}

export function isRelayAnswer(value: unknown): value is RelayAnswer {
  return (
    isRecord(value) &&
    Number.isInteger(value.exitCode) &&
    (value.exitCode as number) >= 0 &&
    (value.exitCode as number) <= 255 &&
    typeof value.stdout === "string"
  );
}

export function isRelayDescriptor(value: unknown): value is RelayDescriptor {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.socket === "string" &&
    typeof value.timeoutMs === "number" &&
    value.timeoutMs > 0 &&
    isRelayAnswer(value.failClosed)
  );
}

export function isRelayMcpFrame(value: unknown): value is RelayMcpFrame {
  return isRecord(value) && typeof value.status === "number" && typeof value.body === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
