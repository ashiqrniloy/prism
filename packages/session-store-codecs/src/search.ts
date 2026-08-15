import { DEFAULT_MAX_SESSION_SEARCH_SNIPPET_BYTES, SESSION_SEARCH_WORKSPACE_METADATA_KEY, type SessionEntry } from "@arnilo/prism";

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
  if (typeof workspaceRoot !== "string") return undefined;
  return { [SESSION_SEARCH_WORKSPACE_METADATA_KEY]: workspaceRoot };
}
