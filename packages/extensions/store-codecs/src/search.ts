import {
  DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES,
  SESSION_SEARCH_WORKSPACE_METADATA_KEY,
  SESSION_TITLE_METADATA_KEY,
  type SessionEntry,
  type SessionLinkFilter,
  type SessionSummary,
  sessionLinksOfEntry,
} from "@arnilo/prism";

export function entrySearchFields(entry: SessionEntry): { label: string; summary: string; body: string } {
  const texts: string[] = [];
  for (const block of entry.message?.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") texts.push(block.text);
  }
  // ponytail: 64KiB body cap keeps FTS dual-write bounded; raise if hosts need longer message search.
  return {
    label: entry.label ?? "",
    summary: entry.summary ?? "",
    body: texts.join("\n").slice(0, 64 * 1024),
  };
}

export function clipSearchSnippet(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES) return value;
  return new TextDecoder().decode(bytes.slice(0, DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES));
}

export function parseSessionMetadata(raw: string | null): Readonly<Record<string, unknown>> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Readonly<Record<string, unknown>>) : undefined;
  } catch {
    return undefined;
  }
}

export function safeSearchMetadata(metadata: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> | undefined {
  if (!metadata) return undefined;
  const workspaceRoot = metadata[SESSION_SEARCH_WORKSPACE_METADATA_KEY];
  const title = metadata[SESSION_TITLE_METADATA_KEY];
  const safe: Record<string, unknown> = {};
  if (typeof workspaceRoot === "string") safe[SESSION_SEARCH_WORKSPACE_METADATA_KEY] = workspaceRoot;
  if (typeof title === "string") safe[SESSION_TITLE_METADATA_KEY] = title;
  return Object.keys(safe).length > 0 ? safe : undefined;
}

/** Link columns of `prism_sessions` (migration 010), in the order `sessionLinkColumns` returns them. */
export const SESSION_LINK_COLUMN_NAMES = [
  "parent_session_id",
  "agent_id",
  "workflow_run_id",
  "delegation_id",
  "actor_kind",
  "actor_agent",
  "actor_vendor",
] as const;

/**
 * The column values for the links stamped on `entry`, or `undefined` when it carries none. The entry stays
 * the source of truth; these columns only index it.
 */
export function sessionLinkColumns(entry: SessionEntry): readonly (string | null)[] | undefined {
  const links = sessionLinksOfEntry(entry);
  if (!links) return undefined;
  return [
    links.sessionId ?? null,
    links.agentId ?? null,
    links.workflowRunId ?? null,
    links.delegationId ?? null,
    links.actor?.kind ?? null,
    links.actor?.agent ?? null,
    links.actor?.vendor ?? null,
  ];
}

/** `SessionSummary` link fields from a `prism_sessions` row; NULL columns (legacy rows) read as absent. */
export function sessionLinkSummaryFields(row: Readonly<Record<string, unknown>>): Partial<SessionSummary> {
  const text = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);
  const actorKind = row.actor_kind === "prism" || row.actor_kind === "external" ? row.actor_kind : undefined;
  const actorAgent = text(row.actor_agent);
  const actorVendor = text(row.actor_vendor);
  return {
    ...(text(row.agent_id) ? { agentId: text(row.agent_id) } : {}),
    ...(text(row.parent_session_id) ? { parentSessionId: text(row.parent_session_id) } : {}),
    ...(text(row.workflow_run_id) ? { workflowRunId: text(row.workflow_run_id) } : {}),
    ...(text(row.delegation_id) ? { delegationId: text(row.delegation_id) } : {}),
    ...(actorKind && actorAgent ? { actor: { kind: actorKind, agent: actorAgent, ...(actorVendor ? { vendor: actorVendor } : {}) } } : {}),
  };
}

/** `[column, value]` pairs for each link filter field set on `filter`. */
export function sessionLinkFilterColumns(filter: SessionLinkFilter): readonly (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [];
  if (filter.agentId !== undefined) pairs.push(["agent_id", filter.agentId]);
  if (filter.parentSessionId !== undefined) pairs.push(["parent_session_id", filter.parentSessionId]);
  if (filter.workflowRunId !== undefined) pairs.push(["workflow_run_id", filter.workflowRunId]);
  if (filter.delegationId !== undefined) pairs.push(["delegation_id", filter.delegationId]);
  if (filter.actorKind !== undefined) pairs.push(["actor_kind", filter.actorKind]);
  if (filter.actorAgent !== undefined) pairs.push(["actor_agent", filter.actorAgent]);
  return pairs;
}
