import { createHash } from "node:crypto";
import type { AgentIdentity, OwnershipScope, ToolEffectKey, ToolEffectRecord, ToolEffectStore, ToolResult } from "@arnilo/prism";

/** Host-supplied identity/ownership for UI-initiated effect recording. */
export interface AgUiMcpAppEffectContext {
  readonly identity: AgentIdentity;
  readonly ownership: OwnershipScope;
}

export interface ReconcileAppEffectInput {
  readonly effectStore: ToolEffectStore;
  readonly identity: AgentIdentity;
  readonly ownership: OwnershipScope;
  readonly sessionId: string;
  readonly runId: string;
  readonly toolName: string;
  /** Exact arguments of the UI call; hashed into the effect key. */
  readonly arguments: Record<string, unknown>;
  readonly toolCallId?: string;
  readonly outcome: "completed" | "failed_retryable" | "failed_terminal";
  readonly result?: ToolResult;
  readonly failure?: { readonly code: string; readonly reference?: string };
}

export interface AppEffectKeyInput {
  readonly ownership: OwnershipScope;
  readonly sessionId: string;
  readonly runId: string;
  readonly toolName: string;
  readonly argumentsHash: string;
}

/** Stable effect key: identity + ownership + tool name + arguments hash (Phase 7 pattern). */
export function deriveAppEffectKey(input: AppEffectKeyInput): string {
  return `prism:ag-ui-app:v1:${hashJson({
    tenant: input.ownership.tenantId,
    account: input.ownership.accountId,
    user: input.ownership.userId,
    session: input.sessionId,
    run: input.runId,
    toolName: input.toolName,
    argumentsHash: input.argumentsHash,
  })}`;
}

export function hashJson(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

/**
 * Resolve a UI mutation whose outcome is unknown after dispatch (FR-4).
 *
 * The proxy never auto-retries; the host decides. This helper reads the
 * recorded effect and, when it is `unknown`, resolves it against the actual
 * outcome via the claim/CAS lifecycle. Returns the resulting record, or
 * `undefined` when no effect was recorded for the call. A record that is
 * already `completed`/`failed_*` is returned unchanged; a `dispatched` record
 * is still in flight and is left untouched.
 */
export async function reconcileAppEffect(input: ReconcileAppEffectInput): Promise<ToolEffectRecord | undefined> {
  const { effectStore, identity, ownership, sessionId, runId, toolName, arguments: args, toolCallId, outcome, result, failure } = input;
  const argumentsHash = hashJson(args);
  const key = deriveAppEffectKey({ ownership, sessionId, runId, toolName, argumentsHash });
  const base: ToolEffectKey = {
    identity,
    ownership,
    key,
    sessionId,
    runId,
    toolCallId: toolCallId ?? `app:${toolName}`,
    toolName,
    argumentsHash,
  };
  const record = await effectStore.get(base);
  if (!record) return undefined;
  if (record.status !== "unknown") return record;
  return effectStore.resolveUnknown({
    ...base,
    expectedVersion: record.version,
    status: outcome,
    ...(result === undefined ? {} : { result }),
    ...(failure === undefined ? {} : { failure }),
  });
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
