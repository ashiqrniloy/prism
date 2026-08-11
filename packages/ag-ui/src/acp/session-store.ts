/**
 * Phase 18 Task 2 — durable ACP session store behind a host-owned seam
 * (plan 018, closeout acp-session-store, demanded by Clay 2026-08-11).
 *
 * The agent's active-session registry is an in-memory Map (cap 32 default /
 * 128 hard) that dies with the process. This seam lets a host persist
 * registry entries (ownership, mode/config, cwd, additional directories) so
 * a restarted agent restores live sessions on first authorized touch.
 *
 * Contract (mirrors docs/acp.md "Persistence and ownership"):
 * - absent seam => the agent behaves byte-identical to 0.1.5 (in-memory only);
 * - entries are keyed by ownership, never by sessionId alone: a restore whose
 *   authorization differs from a stored entry's ownership never merges it;
 * - persisted shape excludes ephemeral stream state (client/controller/budget)
 *   and pending decisions; the live AgentSession binding is re-resolved
 *   through the host sessionFactory at restore time;
 * - the store is host-owned: no integrity/tamper claims beyond the host's
 *   storage (at-least-once, no exactly-once).
 */
import { isAbsolute } from "node:path";
import type { OwnershipScope } from "@arnilo/prism";
import { AcpError } from "./errors.js";

/** Byte caps for persisted entries (host-tunable limits deliberately not added; YAGNI). */
const MAX_SESSION_ID_BYTES = 128;
const MAX_CWD_BYTES = 4096;
const MAX_DIRECTORY_BYTES = 4096;
const MAX_DIRECTORIES = 16;
const MAX_MODE_ID_BYTES = 128;
const MAX_CONFIG_KEYS = 32;
const MAX_CONFIG_KEY_BYTES = 128;
const MAX_CONFIG_VALUE_BYTES = 4096;

/** One persisted registry entry; the frozen shape written by `AcpSessionStore.save`. */
export interface PersistedAcpSession {
  readonly sessionId: string;
  /** Ownership bound by the host `authorize` seam; the only valid key. */
  readonly ownership: OwnershipScope;
  /** Current mode id, restored via the modes seam (unknown ids fail closed). */
  readonly modeId?: string;
  /** Current config-option values, restored via the configOptions seam. */
  readonly configValues: Readonly<Record<string, boolean | string>>;
  /** Absolute working directory; re-validated on restore. */
  readonly cwd: string;
  /** Policy-checked additional roots; re-validated on restore. */
  readonly additionalDirectories: readonly string[];
  /** ISO 8601 timestamp of last persisted state change. */
  readonly updatedAt: string;
}

/** Host-owned durability seam (plan 018 Task 2). Absent seam => in-memory 0.1.5 behavior. */
export interface AcpSessionStore {
  /** Upsert a session's persisted state (on register, mode/config change). */
  save(entry: PersistedAcpSession): Promise<void>;
  /** All persisted entries, bounded by the host; called once per agent instance, lazily on first authorized touch. */
  loadAll(signal: AbortSignal): Promise<readonly PersistedAcpSession[]>;
  /** Remove a session's persisted state (on close/delete). */
  evict(sessionId: string, signal: AbortSignal): Promise<void>;
}

/** Canonical ownership key — the only valid key for persisted entries. */
export function ownershipKey(ownership: OwnershipScope): string {
  return `${ownership.tenantId ?? ""}|${ownership.accountId ?? ""}|${ownership.userId ?? ""}`;
}

/** Shape + byte-cap validation. Throws ERR_PRISM_ACP_LIMIT/ERR_PRISM_ACP_INPUT (save boundary fails the request). */
export function validatePersistedSession(entry: PersistedAcpSession): void {
  const { sessionId, ownership, cwd, additionalDirectories, modeId, configValues, updatedAt } = entry;
  if (typeof sessionId !== "string" || sessionId.length === 0 || Buffer.byteLength(sessionId, "utf8") > MAX_SESSION_ID_BYTES) {
    throw new AcpError("ERR_PRISM_ACP_LIMIT", `invalid session id (max ${MAX_SESSION_ID_BYTES} bytes)`);
  }
  if (typeof ownership !== "object" || ownership === null) throw new AcpError("ERR_PRISM_ACP_INPUT", "invalid ownership");
  if (typeof cwd !== "string" || !isAbsolute(cwd) || Buffer.byteLength(cwd, "utf8") > MAX_CWD_BYTES) {
    throw new AcpError("ERR_PRISM_ACP_LIMIT", `invalid cwd (absolute, max ${MAX_CWD_BYTES} bytes)`);
  }
  if (!Array.isArray(additionalDirectories) || additionalDirectories.length > MAX_DIRECTORIES) {
    throw new AcpError("ERR_PRISM_ACP_LIMIT", `invalid additionalDirectories (max ${MAX_DIRECTORIES})`);
  }
  for (const dir of additionalDirectories) {
    if (typeof dir !== "string" || !isAbsolute(dir) || Buffer.byteLength(dir, "utf8") > MAX_DIRECTORY_BYTES) {
      throw new AcpError("ERR_PRISM_ACP_LIMIT", `invalid additionalDirectories entry (absolute, max ${MAX_DIRECTORY_BYTES} bytes)`);
    }
  }
  if (
    modeId !== undefined &&
    (typeof modeId !== "string" || modeId.length === 0 || Buffer.byteLength(modeId, "utf8") > MAX_MODE_ID_BYTES)
  ) {
    throw new AcpError("ERR_PRISM_ACP_LIMIT", `invalid modeId (max ${MAX_MODE_ID_BYTES} bytes)`);
  }
  if (typeof configValues !== "object" || configValues === null || Object.keys(configValues).length > MAX_CONFIG_KEYS) {
    throw new AcpError("ERR_PRISM_ACP_LIMIT", `invalid configValues (max ${MAX_CONFIG_KEYS} keys)`);
  }
  for (const [key, value] of Object.entries(configValues)) {
    if (Buffer.byteLength(key, "utf8") > MAX_CONFIG_KEY_BYTES)
      throw new AcpError("ERR_PRISM_ACP_LIMIT", `invalid config key (max ${MAX_CONFIG_KEY_BYTES} bytes)`);
    if (typeof value === "string" && Buffer.byteLength(value, "utf8") > MAX_CONFIG_VALUE_BYTES) {
      throw new AcpError("ERR_PRISM_ACP_LIMIT", `invalid config value (max ${MAX_CONFIG_VALUE_BYTES} bytes)`);
    }
    if (typeof value !== "boolean" && typeof value !== "string") throw new AcpError("ERR_PRISM_ACP_INPUT", "invalid config value type");
  }
  if (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))) {
    throw new AcpError("ERR_PRISM_ACP_INPUT", "invalid updatedAt (ISO 8601)");
  }
}
